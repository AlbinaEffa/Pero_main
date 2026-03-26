/**
 * Lightweight migration runner using plain pg — no drizzle-kit dependency at runtime.
 * Reads every *.sql file from /server/drizzle/, runs them in alphabetical order,
 * and records each run in _pero_migrations so they are never applied twice.
 *
 * Usage: called automatically in server/src/index.ts before app.listen().
 */

import pg from 'pg';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    // Create migrations tracking table (idempotent)
    await client.query(`
      CREATE TABLE IF NOT EXISTS _pero_migrations (
        id        SERIAL      PRIMARY KEY,
        filename  TEXT        NOT NULL UNIQUE,
        run_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Locate the drizzle/ directory relative to server/src/db/ → server/drizzle/
    const migrationsDir = path.resolve(__dirname, '../../drizzle');

    let files: string[];
    try {
      files = (await fs.readdir(migrationsDir))
        .filter(f => f.endsWith('.sql'))
        .sort(); // alphabetical == chronological naming convention
    } catch {
      console.warn('[migrate] drizzle/ directory not found — skipping migrations');
      return;
    }

    for (const file of files) {
      // Skip already-applied migrations
      const { rows } = await client.query(
        'SELECT id FROM _pero_migrations WHERE filename = $1',
        [file]
      );
      if (rows.length > 0) continue;

      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf-8');
      console.log(`[migrate] ▶ ${file}`);

      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO _pero_migrations (filename) VALUES ($1)',
          [file]
        );
        console.log(`[migrate] ✓ ${file}`);
      } catch (err: any) {
        // pgvector migrations are advisory: skip silently but do NOT record as applied.
        // That way, once the extension is installed, the migration will run properly.
        if (err.message?.includes('extension') && file.includes('vector')) {
          console.warn(`[migrate] ⚠ ${file} — pgvector not available, skipping (will retry on next startup)`);
        } else {
          console.error(`[migrate] ✗ ${file}:`, err.message);
          throw err;
        }
      }
    }

    console.log('[migrate] All migrations applied.');
  } finally {
    client.release();
    await pool.end();
  }
}
