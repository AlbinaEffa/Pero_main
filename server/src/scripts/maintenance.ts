#!/usr/bin/env tsx
/**
 * Pero maintenance CLI — cleanup and reindex commands.
 *
 * Usage (run from /server):
 *   npx tsx src/scripts/maintenance.ts <command> [options]
 *
 * Commands:
 *   jobs:cleanup [--days 30]           Delete finished/failed jobs older than N days
 *   embeddings:cleanup                 Delete embeddings for chapters that no longer exist
 *   chat:cleanup [--days 90]           Delete chat history older than N days
 *   project:reindex --id <projectId>   Re-enqueue embed_chapter for all chapters
 *   project:reextract --id <projectId> Re-enqueue extract_entities for all chapters
 *   costs:report [--days 7]            Print cost summary to stdout
 *   status                             Print DB table row counts + job stats
 *   vacuum                             VACUUM ANALYZE on key tables
 */

import 'dotenv/config';
import pkg from 'pg';

const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Arg parsing ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

function arg(name: string, fallback?: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : fallback;
}

function requireArg(name: string): string {
  const val = arg(name);
  if (!val) {
    console.error(`Missing required argument: --${name}`);
    process.exit(1);
  }
  return val;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function run(label: string, query: string, params: unknown[] = []) {
  const t0 = Date.now();
  const result = await pool.query(query, params);
  const elapsed = Date.now() - t0;
  console.log(`[${label}] ${result.rowCount ?? 0} row(s) affected (${elapsed}ms)`);
  return result;
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function jobsCleanup() {
  const days = parseInt(arg('days', '30')!);
  console.log(`Deleting succeeded/failed jobs older than ${days} days...`);
  await run(
    'jobs:cleanup',
    `DELETE FROM jobs
     WHERE status IN ('succeeded','failed')
       AND updated_at < NOW() - ($1 || ' days')::INTERVAL`,
    [String(days)]
  );
}

async function embeddingsCleanup() {
  console.log('Deleting embeddings for deleted chapters...');
  await run(
    'embeddings:cleanup',
    `DELETE FROM semantic_memory sm
     WHERE NOT EXISTS (
       SELECT 1 FROM chapters c WHERE c.id = sm.chapter_id
     )`
  );
}

async function chatCleanup() {
  const days = parseInt(arg('days', '90')!);
  console.log(`Deleting chat history older than ${days} days...`);
  await run(
    'chat:cleanup',
    `DELETE FROM chat_history
     WHERE timestamp < NOW() - ($1 || ' days')::INTERVAL`,
    [String(days)]
  );
}

async function projectReindex() {
  const projectId = requireArg('id');
  console.log(`Re-enqueuing embed_chapter for project ${projectId}...`);

  const { rows: chapters } = await pool.query<{ id: string; content: string }>(
    'SELECT id, content FROM chapters WHERE project_id = $1',
    [projectId]
  );

  const { rows: project } = await pool.query<{ user_id: string }>(
    'SELECT user_id FROM projects WHERE id = $1',
    [projectId]
  );

  if (!project[0]) { console.error('Project not found'); process.exit(1); }

  const userId = project[0].user_id;

  // Delete existing embeddings for this project first
  await run(
    'embeddings:delete-old',
    'DELETE FROM semantic_memory WHERE project_id = $1',
    [projectId]
  );

  for (const ch of chapters) {
    await pool.query(
      `INSERT INTO jobs (type, payload, status, max_attempts, project_id, user_id)
       VALUES ('embed_chapter', $1, 'queued', 3, $2, $3)`,
      [JSON.stringify({ chapterId: ch.id, content: ch.content ?? '' }), projectId, userId]
    );
  }
  console.log(`[project:reindex] Enqueued ${chapters.length} embed jobs`);
}

async function projectReextract() {
  const projectId = requireArg('id');
  console.log(`Re-enqueuing extract_entities for project ${projectId}...`);

  const { rows: chapters } = await pool.query<{ id: string; content: string }>(
    'SELECT id, content FROM chapters WHERE project_id = $1',
    [projectId]
  );

  const { rows: project } = await pool.query<{ user_id: string }>(
    'SELECT user_id FROM projects WHERE id = $1',
    [projectId]
  );

  if (!project[0]) { console.error('Project not found'); process.exit(1); }
  const userId = project[0].user_id;

  // Delete existing pending/failed entities so we start fresh
  await run(
    'entities:delete-pending',
    `DELETE FROM story_entities WHERE project_id = $1 AND status IN ('pending','failed')`,
    [projectId]
  );

  for (const ch of chapters) {
    await pool.query(
      `INSERT INTO jobs (type, payload, status, max_attempts, project_id, user_id)
       VALUES ('extract_entities', $1, 'queued', 3, $2, $3)`,
      [JSON.stringify({ chapterId: ch.id, content: ch.content ?? '' }), projectId, userId]
    );
  }
  console.log(`[project:reextract] Enqueued ${chapters.length} extract jobs`);
}

async function costsReport() {
  const days = parseInt(arg('days', '7')!);
  console.log(`\n=== Cost Report (last ${days} days) ===\n`);

  const { rows: byUser } = await pool.query<{
    email: string; calls: string; input_tokens: string;
    output_tokens: string; total_usd: string;
  }>(
    `SELECT u.email,
            COUNT(c.id)::text              AS calls,
            SUM(c.input_tokens)::text      AS input_tokens,
            SUM(c.output_tokens)::text     AS output_tokens,
            SUM(c.estimated_cost_usd)::text AS total_usd
     FROM cost_logs c
     JOIN users u ON u.id = c.user_id
     WHERE c.created_at > NOW() - ($1 || ' days')::INTERVAL
     GROUP BY u.email
     ORDER BY SUM(c.estimated_cost_usd) DESC`,
    [String(days)]
  );

  const { rows: byRoute } = await pool.query<{
    route: string; model: string; calls: string; total_usd: string;
  }>(
    `SELECT route, model,
            COUNT(*)::text                 AS calls,
            SUM(estimated_cost_usd)::text  AS total_usd
     FROM cost_logs
     WHERE created_at > NOW() - ($1 || ' days')::INTERVAL
     GROUP BY route, model
     ORDER BY SUM(estimated_cost_usd) DESC`,
    [String(days)]
  );

  const { rows: total } = await pool.query<{ total_usd: string; calls: string }>(
    `SELECT SUM(estimated_cost_usd)::text AS total_usd, COUNT(*)::text AS calls
     FROM cost_logs
     WHERE created_at > NOW() - ($1 || ' days')::INTERVAL`,
    [String(days)]
  );

  console.log('By user:');
  console.table(byUser);
  console.log('\nBy route/model:');
  console.table(byRoute);
  console.log(`\nTotal: $${parseFloat(total[0]?.total_usd ?? '0').toFixed(4)} across ${total[0]?.calls ?? 0} calls`);
}

async function status() {
  console.log('\n=== Database Status ===\n');

  const tables = ['users','projects','chapters','jobs','semantic_memory',
                  'story_entities','chat_history','cost_logs','feedback'];

  for (const t of tables) {
    try {
      const { rows } = await pool.query(`SELECT COUNT(*)::text AS count FROM ${t}`);
      console.log(`  ${t.padEnd(20)} ${rows[0].count} rows`);
    } catch {
      console.log(`  ${t.padEnd(20)} (table not found)`);
    }
  }

  console.log('\nJob queue:');
  const { rows: jobRows } = await pool.query<{ status: string; type: string; count: string }>(
    `SELECT status, type, COUNT(*)::text AS count FROM jobs GROUP BY status, type ORDER BY status`
  );
  console.table(jobRows);
}

async function vacuum() {
  const tables = ['jobs','semantic_memory','chat_history','cost_logs'];
  for (const t of tables) {
    console.log(`VACUUM ANALYZE ${t}...`);
    try {
      await pool.query(`VACUUM ANALYZE ${t}`);
      console.log(`  done`);
    } catch (e: any) {
      console.warn(`  skipped: ${e.message}`);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

const commands: Record<string, () => Promise<void>> = {
  'jobs:cleanup':        jobsCleanup,
  'embeddings:cleanup':  embeddingsCleanup,
  'chat:cleanup':        chatCleanup,
  'project:reindex':     projectReindex,
  'project:reextract':   projectReextract,
  'costs:report':        costsReport,
  'status':              status,
  'vacuum':              vacuum,
};

if (!command || !commands[command]) {
  console.log('Available commands:\n' + Object.keys(commands).map(c => `  ${c}`).join('\n'));
  process.exit(command ? 1 : 0);
}

try {
  await commands[command]();
} catch (err) {
  console.error('Error:', err);
  process.exit(1);
} finally {
  await pool.end();
}
