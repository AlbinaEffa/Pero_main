/**
 * Lightweight job enqueue helper.
 * Reuses the shared pg Pool from db/client.ts — no extra connections.
 */

import { pool } from '../db/client.js';

// ── Job payload types ─────────────────────────────────────────────────────────

export interface ExtractEntitiesPayload {
  chapterId: string;
  content: string;         // raw text (already stripped / plain)
}

export interface EmbedChapterPayload {
  chapterId: string;
  content?: string;        // HTML from tiptap. Необязателен: если не задан, воркер
                           // прочитает АКТУАЛЬНЫЙ текст главы из БД на момент запуска
                           // (нужно для дедупа отложенных джоб — см. scheduleChapterEmbed).
}

export interface ScanContradictionsPayload {
  reportId: string;        // contradiction_reports row this job fills in
}

export type JobType = 'extract_entities' | 'embed_chapter' | 'scan_contradictions';
export type JobPayload = ExtractEntitiesPayload | EmbedChapterPayload | ScanContradictionsPayload;

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

/**
 * Поставить переэмбеддинг главы как следствие сохранения — durable-гарантия свежести
 * вектора (переживает закрытие вкладки, в отличие от фронтового таймера).
 *  • Дедуп: не больше одной ожидающей джобы embed_chapter на главу — всплеск автосейвов
 *    (раз в ~1с при печати) схлопывается в одну.
 *  • Задержка delayMs: даём тексту «устаканиться», прежде чем эмбеддить.
 *  • Контент НЕ кладём в payload — воркер прочитает АКТУАЛЬНЫЙ текст главы на момент
 *    запуска, поэтому дедуп не «замораживает» устаревший снимок.
 */
export async function scheduleChapterEmbed(
  chapterId: string,
  projectId: string,
  userId: string,
  delayMs = 15_000,
): Promise<void> {
  const runAfter = new Date(Date.now() + delayMs).toISOString();
  await pool.query(
    `INSERT INTO jobs (type, payload, status, max_attempts, project_id, user_id, run_after)
     SELECT 'embed_chapter', $1, 'queued', 3, $2, $3, $4
      WHERE NOT EXISTS (
        SELECT 1 FROM jobs
         WHERE type = 'embed_chapter'
           AND status IN ('queued','running')
           AND payload->>'chapterId' = $5
      )`,
    [JSON.stringify({ chapterId }), projectId, userId, runAfter, chapterId],
  );
}
