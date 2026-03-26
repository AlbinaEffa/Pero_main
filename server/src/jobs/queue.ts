/**
 * Lightweight job enqueue helper.
 * Uses a module-level pg Pool so all callers share a single connection pool.
 */

import pkg from 'pg';
const { Pool } = pkg;

let _pool: InstanceType<typeof Pool> | null = null;

function getPool(): InstanceType<typeof Pool> {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

// ── Job payload types ─────────────────────────────────────────────────────────

export interface ExtractEntitiesPayload {
  chapterId: string;
  content: string;         // raw text (already stripped / plain)
}

export interface EmbedChapterPayload {
  chapterId: string;
  content: string;         // HTML from tiptap — worker will strip before chunking
}

export type JobType = 'extract_entities' | 'embed_chapter';
export type JobPayload = ExtractEntitiesPayload | EmbedChapterPayload;

// ── enqueueJob ────────────────────────────────────────────────────────────────

export async function enqueueJob(
  type: JobType,
  payload: JobPayload,
  opts: {
    projectId: string;
    userId: string;
    maxAttempts?: number;
    runAfterMs?: number;   // delay before first attempt (ms), default 0
  }
): Promise<string> {
  const pool = getPool();
  const runAfter = opts.runAfterMs
    ? new Date(Date.now() + opts.runAfterMs).toISOString()
    : new Date().toISOString();

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO jobs (type, payload, status, max_attempts, project_id, user_id, run_after)
     VALUES ($1, $2, 'queued', $3, $4, $5, $6)
     RETURNING id`,
    [
      type,
      JSON.stringify(payload),
      opts.maxAttempts ?? 3,
      opts.projectId,
      opts.userId,
      runAfter,
    ]
  );
  return rows[0].id;
}

/** Enqueue multiple jobs in a single transaction — all or none. */
export async function enqueueJobs(
  items: Array<{
    type: JobType;
    payload: JobPayload;
    projectId: string;
    userId: string;
    maxAttempts?: number;
  }>
): Promise<string[]> {
  if (items.length === 0) return [];
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const ids: string[] = [];

    for (const item of items) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO jobs (type, payload, status, max_attempts, project_id, user_id)
         VALUES ($1, $2, 'queued', $3, $4, $5)
         RETURNING id`,
        [
          item.type,
          JSON.stringify(item.payload),
          item.maxAttempts ?? 3,
          item.projectId,
          item.userId,
        ]
      );
      ids.push(rows[0].id);
    }

    await client.query('COMMIT');
    return ids;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
