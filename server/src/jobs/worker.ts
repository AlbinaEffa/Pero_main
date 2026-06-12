/**
 * Background job worker — runs in the same Node.js process as the server.
 *
 * Design:
 *  • Polls the `jobs` table every POLL_INTERVAL_MS using SELECT ... FOR UPDATE SKIP LOCKED
 *    so multiple worker instances (future horizontal scaling) never double-process a job.
 *  • On startup, resets "stuck" running jobs (left over from a server crash) back to queued.
 *  • Exponential backoff on failure: 30s × 2^attempts, up to max_attempts then → failed.
 *  • All job logic (handlers) lives here — import.ts just enqueues.
 *
 * Supported job types:
 *  • extract_entities  — run AI entity extraction on one chapter
 *  • embed_chapter     — chunk + embed one chapter via the embedding provider
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import type { ExtractEntitiesPayload, EmbedChapterPayload } from './queue.js';
import { stripHtml } from '../lib/html.js';
import { guardChat, guardEmbed } from '../lib/aiGuard.js';
import { pool as sharedPool } from '../db/client.js';
import { getAIProvider, getEmbeddingProvider, type AIProvider } from '../lib/aiProvider.js';

const POLL_INTERVAL_MS   = 5_000;  // check for new jobs every 5 seconds
const STUCK_JOB_MINUTES  = 5;      // running jobs older than this are assumed crashed
const BACKOFF_BASE_S     = 30;     // first retry delay (seconds)
const BACKOFF_MAX_EXP    = 6;      // max exponent → 30 * 2^6 = 1920s (~32 min)

/**
 * Explicit handler result type.
 *
 * Handlers should:
 *  • return normally           → success (job → succeeded)
 *  • throw WorkerHandlerError  → controlled failure with explicit retry policy
 *  • throw any other Error     → unexpected failure (goes through normal retry)
 *
 * soft_skip: content not worth processing (too short, empty) → mark succeeded without doing work
 * retryable_error: transient failure (API down, network) → retry with backoff
 * permanent_error: unrecoverable failure (bad model output) → skip retries, mark failed immediately
 */
export class WorkerHandlerError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'WorkerHandlerError';
    this.retryable = retryable;
  }
}

let aiClient: AIProvider | null = null;

// ── Text helpers ─────────────────────────────────────────────────────────────
// stripHtml imported from ../lib/html.js

function chunkText(text: string, chunkSize = 400, overlap = 60): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end === words.length) break;
    start += chunkSize - overlap;
  }
  return chunks;
}

// ── Job handlers ─────────────────────────────────────────────────────────────

/**
 * Extraction prompt for the background worker.
 * Kept in sync with the high-quality prompt in bible.ts so that
 * imported chapters produce the same quality as manually extracted ones.
 */
const EXTRACTION_PROMPT = `Ты — литературный редактор, составляющий справочник к произведению.

Извлеки из текста главы ТОЛЬКО значимые именованные сущности четырёх категорий:

• character — персонаж с именем или устойчивым прозвищем (не «солдат», не «толпа»).
  Включай только если о нём есть хотя бы одна конкретная деталь: внешность, характер, роль.
  Описание: «[Кто он/она]. [Ключевая черта из текста]. [Роль в этой главе].»

• location — конкретное, описанное место действия.
  Описание: «[Что за место]. [Ключевые детали из текста].»

• item — предмет, важный для сюжета или магической системы.
  Описание: «[Что это]. [Физическое или магическое свойство из текста].»

• rule — закон мира, магическая система, политический строй, религия мира.
  Описание: «[В чём суть правила]. [Как оно работает согласно тексту].»

ТРЕБОВАНИЯ:
1. Не выдумывай ничего. Каждое слово описания должно быть подтверждено текстом.
2. Не добавляй сущности, упомянутые лишь вскользь (одно-два слова без деталей).
3. Используй каноническое имя. Не дублируй одну сущность под разными именами.
4. Если сущностей нет — верни пустой массив entities.

Ответ — строго JSON, без markdown-обёртки:
{
  "entities": [
    {"type": "character", "name": "Имя", "description": "..."},
    {"type": "location",  "name": "Название", "description": "..."}
  ],
  "chapterSummary": "Рабочее название главы (2–4 слова)"
}`;

async function handleExtractEntities(
  payload: ExtractEntitiesPayload,
  projectId: string,
  userId: string,
): Promise<void> {
  if (!aiClient) throw new Error('AI client not configured (no API key for AI provider)');

  const db = drizzle(sharedPool, { schema });

  // Skip chapters with very little content
  const wordCount = payload.content.split(/\s+/).filter(Boolean).length;
  if (wordCount < 50) return;

  // Use plain text from the payload (already stripped by importer) or strip HTML
  const plainText = payload.content
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let response;
  try {
    response = await guardChat(
      () => aiClient!.generate({
        // No truncation — send full chapter content
        contents: `${EXTRACTION_PROMPT}\n\n<chapter_content>\n${plainText}\n</chapter_content>`,
        temperature: 0.15,
      }),
      { userId, projectId, route: 'worker:extract_entities', circuit: 'extract', timeoutMs: 60_000 }
    );
  } catch (err: any) {
    // 429 = quota exceeded — soft-skip so spinner clears; retrying won't help on free tier
    const status = err?.status ?? err?.error?.code ?? err?.code;
    if (status === 429 || String(err?.message ?? '').includes('429')) {
      console.warn('[worker] extract_entities: AI quota exceeded — skipping (soft-skip)');
      return;
    }
    // Circuit open = transient, retryable
    if (err?.isCircuitOpen) {
      throw new WorkerHandlerError('AI circuit open — will retry', true);
    }
    throw err;
  }

  const raw = response.text ?? '{"entities":[]}';
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  let parsed: { entities?: { type: string; name: string; description: string }[] };
  let entities: { type: string; name: string; description: string }[] = [];
  try {
    parsed = JSON.parse(cleaned);
    // Handle both array format (legacy) and new object format
    entities = Array.isArray(parsed) ? parsed : (parsed.entities ?? []);
  } catch {
    // Malformed JSON from model — permanent failure, retrying won't help
    throw new WorkerHandlerError(
      `Model returned malformed JSON (first 120 chars): ${cleaned.slice(0, 120)}`,
      false
    );
  }
  if (!Array.isArray(entities)) {
    throw new WorkerHandlerError('Model response entities is not a JSON array', false);
  }
  if (entities.length === 0) return; // Valid empty response — soft skip, mark succeeded

  // Dedup against existing entities for this project (case-insensitive name check)
  const existing = await db
    .select({ name: schema.storyEntities.name })
    .from(schema.storyEntities)
    .where(eq(schema.storyEntities.projectId, projectId));

  const knownNames = new Set(existing.map(e => e.name.toLowerCase()));

  const toInsert = entities.filter(
    e => e.name && !knownNames.has(e.name.toLowerCase())
  );

  if (toInsert.length > 0) {
    await db.insert(schema.storyEntities).values(
      toInsert.map(e => ({
        projectId,
        chapterId: payload.chapterId,
        type: e.type || 'character',
        name: e.name,
        description: e.description || '',
        status: 'pending' as const,
      }))
    );
  }
}

async function handleEmbedChapter(
  payload: EmbedChapterPayload,
  projectId: string,
  userId: string,
): Promise<void> {
  const embedder = getEmbeddingProvider();
  if (!embedder) {
    console.info('[worker] embed_chapter: embedding provider not configured — skipping');
    return;
  }

  const db = drizzle(sharedPool, { schema });
  const plainText = stripHtml(payload.content);
  const chunks = chunkText(plainText);
  if (chunks.length === 0) return;

  const embedded: { text: string; vec: number[]; idx: number }[] = [];

  for (let i = 0; i < chunks.length; i++) {
    try {
      const vec = await guardEmbed(
        () => embedder.embed(chunks[i], 'document'),
        { userId, projectId, route: 'worker:embed_chapter', inputChars: chunks[i].length }
      );
      if (vec) embedded.push({ text: chunks[i], vec, idx: i });
    } catch (e: any) {
      if (e?.isCircuitOpen) {
        // Circuit open — abort entire embed, will retry job later
        throw new WorkerHandlerError('Embed circuit open — will retry', true);
      }
      console.warn(`[worker] embed chunk ${i} failed:`, e);
    }
  }

  if (embedded.length === 0) {
    // Every chunk failed — log and soft-skip so the spinner clears; won't block isProcessing forever
    console.warn(`[worker] embed_chapter: all ${chunks.length} chunk(s) failed — skipping (embedding API may be unavailable)`);
    return;
  }

  try {
    // Delete old chunks for this chapter, then insert new ones
    await db
      .delete(schema.semanticMemory)
      .where(
        and(
          eq(schema.semanticMemory.chapterId, payload.chapterId),
          eq(schema.semanticMemory.projectId, projectId)
        )
      );

    await db.insert(schema.semanticMemory).values(
      embedded.map(c => ({
        userId,
        projectId,
        chapterId: payload.chapterId,
        chunkText: c.text,
        embedding: c.vec,
        metadata: { chunkIndex: c.idx },
      }))
    );
  } catch (dbErr: any) {
    // 42P01 = table doesn't exist, 42703 = column doesn't exist (pgvector not installed)
    if (['42P01', '42703'].includes(dbErr?.code)) {
      console.info('[worker] pgvector not installed — skipping semantic_memory write');
      return; // Not an error worth retrying
    }
    throw dbErr;
  }
}

// ── Core worker loop ──────────────────────────────────────────────────────────

async function pickAndRunJob(): Promise<boolean> {
  const client = await sharedPool.connect();

  try {
    // Atomically pick the oldest queued job that's ready to run
    const { rows } = await client.query<{
      id: string; type: string; payload: any;
      attempts: number; max_attempts: number;
      project_id: string; user_id: string;
    }>(
      `UPDATE jobs
       SET status = 'running', attempts = attempts + 1, updated_at = NOW()
       WHERE id = (
         SELECT id FROM jobs
         WHERE status = 'queued' AND run_after <= NOW()
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, type, payload, attempts, max_attempts, project_id, user_id`
    );

    if (rows.length === 0) return false; // Nothing to do

    const job = rows[0];
    console.log(`[worker] ▶ job ${job.id} (${job.type}) attempt ${job.attempts}/${job.max_attempts}`);

    try {
      switch (job.type) {
        case 'extract_entities':
          await handleExtractEntities(
            job.payload as ExtractEntitiesPayload,
            job.project_id,
            job.user_id,
          );
          break;
        case 'embed_chapter':
          await handleEmbedChapter(
            job.payload as EmbedChapterPayload,
            job.project_id,
            job.user_id,
          );
          break;
        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }

      await client.query(
        `UPDATE jobs SET status = 'succeeded', updated_at = NOW() WHERE id = $1`,
        [job.id]
      );
      console.log(`[worker] ✓ job ${job.id} (${job.type})`);

    } catch (err: any) {
      const errMsg = (err?.message ?? String(err)).slice(0, 500);

      // A non-retryable WorkerHandlerError skips straight to failed regardless of attempts left
      const isPermanent =
        (err instanceof WorkerHandlerError && !err.retryable) ||
        job.attempts >= job.max_attempts;

      if (isPermanent) {
        await client.query(
          `UPDATE jobs SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2`,
          [errMsg, job.id]
        );
        console.error(`[worker] ✗ job ${job.id} (${job.type}) permanently failed: ${errMsg}`);
      } else {
        // Exponential backoff with ceiling: 30s, 60s, 120s, …, max ~32 min
        const delaySec = BACKOFF_BASE_S * Math.pow(2, Math.min(job.attempts - 1, BACKOFF_MAX_EXP));
        await client.query(
          `UPDATE jobs
           SET status = 'queued',
               error  = $1,
               run_after = NOW() + ($2 || ' seconds')::interval,
               updated_at = NOW()
           WHERE id = $3`,
          [errMsg, String(delaySec), job.id]
        );
        console.warn(
          `[worker] ↩ job ${job.id} (${job.type}) will retry in ${delaySec}s (attempt ${job.attempts}/${job.max_attempts})`
        );
      }
    }

    return true; // processed a job
  } finally {
    client.release();
  }
}

async function recoverStuckJobs(): Promise<void> {
  const { rowCount } = await sharedPool.query(
    `UPDATE jobs
     SET status = 'queued', run_after = NOW(), updated_at = NOW()
     WHERE status = 'running'
       AND updated_at < NOW() - ($1 || ' minutes')::interval`,
    [String(STUCK_JOB_MINUTES)]
  );
  if (rowCount && rowCount > 0) {
    console.log(`[worker] Recovered ${rowCount} stuck job(s)`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startWorker(connectionString: string): void {
  // connectionString kept in signature for backward-compat but we now use the shared pool.
  // It is still used below by recoverStuckJobs and pickAndRunJob via sharedPool.
  void connectionString; // suppress unused-variable lint

  aiClient = getAIProvider();
  if (!aiClient) {
    console.warn('[worker] AI provider not configured — jobs will be processed but AI calls will fail gracefully');
  }

  // Recover any stuck jobs from a previous crash before accepting new work
  recoverStuckJobs().catch(e =>
    console.warn('[worker] recoverStuckJobs failed:', e)
  );

  // Drain the queue on startup in case there are pending jobs
  setTimeout(() => drainQueue(), 3_000);

  // Steady-state polling
  setInterval(() => drainQueue(), POLL_INTERVAL_MS);

  console.log('[worker] Started — polling every', POLL_INTERVAL_MS / 1000, 's');
}

/** Run jobs until the queue is empty, then return. */
async function drainQueue(): Promise<void> {
  try {
    // Process jobs one by one until none are available
    let ran = true;
    while (ran) {
      ran = await pickAndRunJob();
    }
  } catch (e) {
    console.error('[worker] Unhandled error in drainQueue:', e);
  }
}
