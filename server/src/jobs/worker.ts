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
import { eq, and, asc, lt } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import type { ExtractEntitiesPayload, EmbedChapterPayload, ScanContradictionsPayload } from './queue.js';
import { stripHtml } from '../lib/html.js';
import { guardChat, guardEmbed } from '../lib/aiGuard.js';
import { pool as sharedPool } from '../db/client.js';
import { getAIProvider, getEmbeddingProvider, type AIProvider } from '../lib/aiProvider.js';
import {
  EXTRACTION_SCHEMA, cleanJsonResponse, processExtractionResults, sanitizePov,
  sanitizeSynopsis, isLowInfoChapterTitle,
  type AiEntity, type AiRelation,
} from '../lib/extraction.js';
import {
  BASE_EXTRACTION_PROMPT, buildStoryBibleContext, buildContradictionPrompt, type RawContradiction,
} from '../lib/extractionPrompts.js';
import { retrieveCrossChapterPassages, retrieveCrossBookPassages } from '../lib/semanticRetrieval.js';

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
// Extraction prompt и обработка результатов — ОБЩИЕ с bible.ts (lib/extraction.ts):
// импортированные главы получают тот же богатый результат, что и интерактивный
// анализ — significance, attributes, связи и события таймлайна.

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
        contents: `${BASE_EXTRACTION_PROMPT}\n\n<chapter_content>\n${plainText}\n</chapter_content>`,
        temperature: 0.15,
        responseSchema: EXTRACTION_SCHEMA,      // структурный вывод для локальных моделей (Ollama)
        responseSchemaName: 'entity_extraction',
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
  const cleaned = cleanJsonResponse(raw);

  let parsed: { entities?: AiEntity[]; relations?: AiRelation[]; pov?: unknown; synopsis?: unknown; chapterSummary?: unknown };
  let entities: AiEntity[] = [];
  let relations: AiRelation[] = [];
  let pov: string | null = null;
  let synopsis: string | null = null;
  let chapterSummary: string | null = null;
  try {
    parsed = JSON.parse(cleaned);
    // Handle both array format (legacy) and new object format
    entities = Array.isArray(parsed) ? parsed : (parsed.entities ?? []);
    relations = Array.isArray(parsed) ? [] : (parsed.relations ?? []);
    pov = Array.isArray(parsed) ? null : sanitizePov(parsed.pov);
    synopsis = Array.isArray(parsed) ? null : sanitizeSynopsis(parsed.synopsis);
    chapterSummary = Array.isArray(parsed) ? null : (typeof parsed.chapterSummary === 'string' ? parsed.chapterSummary.trim() : null);
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

  // Заголовок главы — для подписи update suggestions и событий таймлайна
  const chapterRows = await db
    .select({ title: schema.chapters.title })
    .from(schema.chapters)
    .where(eq(schema.chapters.id, payload.chapterId));
  const chapterTitle = chapterRows[0]?.title ?? null;

  // Общий конвейер: pending-сущности, update suggestions для одобренных,
  // аддитивное обогащение атрибутов, entity_links и entity_events — с дедупом.
  await processExtractionResults(
    entities, relations, projectId, payload.chapterId, chapterTitle, plainText,
  );

  // Отметить главу как проанализированную (+ POV, синопсис, и имя главы, если было «сырым»).
  const chapterUpdate: Record<string, unknown> = { lastExtractedAt: new Date() };
  if (pov) chapterUpdate.povCharacter = pov;
  if (synopsis) chapterUpdate.summary = synopsis;
  if (chapterSummary && isLowInfoChapterTitle(chapterTitle)) {
    chapterUpdate.title = chapterSummary.slice(0, 100);
  }
  await db.update(schema.chapters)
    .set(chapterUpdate)
    .where(eq(schema.chapters.id, payload.chapterId));
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

  // Контент может прийти в payload (импорт/бэкфилл) либо отсутствовать (отложенная
  // джоба от scheduleChapterEmbed) — тогда читаем АКТУАЛЬНЫЙ текст главы из БД,
  // чтобы переэмбеддить самую свежую версию, а не устаревший снимок.
  let html = payload.content;
  if (!html) {
    const [ch] = await db
      .select({ content: schema.chapters.content })
      .from(schema.chapters)
      .where(eq(schema.chapters.id, payload.chapterId));
    html = ch?.content ?? '';
  }
  const plainText = stripHtml(html);
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

// ── scan_contradictions (PRD P1.2, full-book) ─────────────────────────────────
//
// Гонит ВСЕ главы проекта через промпт консистентности с полным контекстом
// библии, пишет найденные противоречия в contradiction_issues и обновляет
// прогресс в contradiction_reports (поллится с фронта). Главы по одной — каждая
// проверяется на весь свод фактов; устойчиво к сбою отдельной главы.

const CONTRADICTION_CHAPTER_CHAR_CAP = 12_000; // ~весь текст средней главы

const VALID_SEVERITY = new Set(['low', 'medium', 'high']);

async function handleScanContradictions(
  payload: ScanContradictionsPayload,
  projectId: string,
  userId: string,
): Promise<void> {
  if (!aiClient) throw new Error('AI client not configured (no API key for AI provider)');
  const db = drizzle(sharedPool, { schema });
  const { reportId } = payload;

  // Контекст библии — один раз на весь прогон
  const [entities, links] = await Promise.all([
    db.select().from(schema.storyEntities)
      .where(and(eq(schema.storyEntities.projectId, projectId), eq(schema.storyEntities.status, 'approved'))),
    db.select().from(schema.entityLinks).where(eq(schema.entityLinks.projectId, projectId)),
  ]);

  if (entities.length === 0) {
    await db.update(schema.contradictionReports)
      .set({ status: 'done', error: 'Нет одобренных сущностей — нечего проверять.', updatedAt: new Date() })
      .where(eq(schema.contradictionReports.id, reportId));
    return;
  }

  const storyBible = buildStoryBibleContext(entities, links);

  // E3: если книга в серии — подтянуть канон из ПРЕДЫДУЩИХ книг (series_order меньше текущего),
  // чтобы ловить нестыковки МЕЖДУ книгами. Нужен заданный порядок книги.
  let earlierBookIds: string[] = [];
  let priorCanonLines: string[] = []; // E4: явный канон-снимок предыдущих книг (если зафиксирован)
  const [thisProj] = await db.select({ seriesId: schema.projects.seriesId, seriesOrder: schema.projects.seriesOrder })
    .from(schema.projects).where(eq(schema.projects.id, projectId));
  if (thisProj?.seriesId != null && thisProj.seriesOrder != null) {
    const earlier = await db.select({ id: schema.projects.id, title: schema.projects.title, snapshot: schema.projects.worldSnapshot })
      .from(schema.projects)
      .where(and(eq(schema.projects.seriesId, thisProj.seriesId), lt(schema.projects.seriesOrder, thisProj.seriesOrder)));
    earlierBookIds = earlier.map(e => e.id);
    for (const b of earlier) {
      const snap = (Array.isArray(b.snapshot) ? b.snapshot : []) as { name?: string; type?: string; state?: string | null }[];
      for (const it of snap.slice(0, 40)) {
        if (!it?.name) continue;
        priorCanonLines.push(`[Из книги «${b.title}», итог] ${it.name}${it.type ? ` (${it.type})` : ''}${it.state ? ` — ${it.state}` : ''}`);
      }
    }
  }

  const chapters = await db.select({
      id: schema.chapters.id, title: schema.chapters.title, content: schema.chapters.content,
    })
    .from(schema.chapters)
    .where(eq(schema.chapters.projectId, projectId))
    .orderBy(asc(schema.chapters.order));

  const withText = chapters
    .map(ch => ({ ...ch, plainText: stripHtml(ch.content ?? '') }))
    .filter(ch => ch.plainText.split(/\s+/).filter(Boolean).length >= 50);

  await db.update(schema.contradictionReports)
    .set({ totalChapters: withText.length, updatedAt: new Date() })
    .where(eq(schema.contradictionReports.id, reportId));

  let scanned = 0;
  for (const ch of withText) {
    // RAG: близкие по смыслу места из ДРУГИХ глав (для сверки по всей книге, а не только с Миром).
    const related = await retrieveCrossChapterPassages(projectId, ch.id, ch.plainText, 6);
    // E3: канон из предыдущих книг серии, помечен «[Из книги «X»]» — чтобы ИИ ловил межкнижные нестыковки.
    const crossBook = earlierBookIds.length
      ? (await retrieveCrossBookPassages(earlierBookIds, ch.plainText, 4)).map(p => `[Из книги «${p.bookTitle ?? '?'}»] ${p.chunkText}`)
      : [];
    const prompt = buildContradictionPrompt(storyBible, ch.title, ch.plainText.slice(0, CONTRADICTION_CHAPTER_CHAR_CAP), [...related, ...priorCanonLines, ...crossBook]);

    try {
      const response = await guardChat(
        () => aiClient!.generate({ contents: prompt, temperature: 0.1 }),
        { userId, projectId, route: 'report:contradictions', circuit: 'extract', timeoutMs: 60_000 }
      );
      const cleaned = cleanJsonResponse(response.text ?? '[]');
      let issues: RawContradiction[] = [];
      try {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) issues = parsed;
      } catch {
        // Кривой JSON по одной главе — пропускаем, не валим весь отчёт
      }

      const rows = issues
        .filter(it => it && typeof it.issue === 'string' && it.issue.trim())
        .map(it => ({
          reportId,
          projectId,
          chapterId: ch.id,
          chapterTitle: ch.title,
          entityName: (typeof it.entity === 'string' ? it.entity : '').slice(0, 200) || null,
          issue: (it.issue.trim() + (it.canon && String(it.canon).trim() ? ` · Канон: ${String(it.canon).trim()}` : '')).slice(0, 1000),
          quote: (typeof it.quote === 'string' ? it.quote.trim().slice(0, 300) : '') || null,
          severity: VALID_SEVERITY.has(it.severity) ? it.severity : 'medium',
          kind: it.kind === 'development' ? 'development' : 'contradiction',
          status: 'open' as const,
        }));
      if (rows.length > 0) await db.insert(schema.contradictionIssues).values(rows);
    } catch (err: any) {
      const status = err?.status ?? err?.error?.code ?? err?.code;
      if (status === 429 || String(err?.message ?? '').includes('429')) {
        // Квота исчерпана — завершаем отчёт частично, дальше смысла нет
        await db.update(schema.contradictionReports)
          .set({ status: 'done', error: `Проверено ${scanned} из ${withText.length} глав — закончилась дневная квота AI.`, scannedChapters: scanned, updatedAt: new Date() })
          .where(eq(schema.contradictionReports.id, reportId));
        return;
      }
      if (err?.isCircuitOpen) throw new WorkerHandlerError('AI circuit open — will retry', true);
      // Прочая ошибка по главе — пропускаем главу, продолжаем
      console.warn(`[worker] scan_contradictions: глава ${ch.id} пропущена:`, err?.message ?? err);
    }

    scanned++;
    await db.update(schema.contradictionReports)
      .set({ scannedChapters: scanned, updatedAt: new Date() })
      .where(eq(schema.contradictionReports.id, reportId));
  }

  await db.update(schema.contradictionReports)
    .set({ status: 'done', updatedAt: new Date() })
    .where(eq(schema.contradictionReports.id, reportId));
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
        case 'scan_contradictions':
          await handleScanContradictions(
            job.payload as ScanContradictionsPayload,
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
  pollHandle = setInterval(() => drainQueue(), POLL_INTERVAL_MS);

  console.log('[worker] Started — polling every', POLL_INTERVAL_MS / 1000, 's');
}

let pollHandle: ReturnType<typeof setInterval> | null = null;
let shuttingDown = false;

/**
 * Graceful shutdown воркера: останавливаем поллинг (новые проходы не стартуют) и ждём,
 * пока завершится текущий drainQueue (in-flight джобы дописываются). Зовётся из index.ts
 * на SIGTERM/SIGINT ДО закрытия пула — иначе джоба могла оборваться на записи.
 */
export async function stopWorker(timeoutMs = 8_000): Promise<void> {
  shuttingDown = true;
  if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
  const deadline = Date.now() + timeoutMs;
  while (draining && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('[worker] Stopped — in-flight drain', draining ? 'timed out' : 'finished');
}

/**
 * Сколько джоб обрабатываем параллельно. ВАЖНО: каждая джоба держит одно соединение
 * пула на всё своё время (claim → AI-вызов → запись), а обработчик берёт ВТОРОЕ
 * соединение для записи результатов. При max=20 в пуле безопасный потолок —
 * существенно ниже 20/2: берём 4 (→ ≤8 соединений), оставляя запас API-запросам и
 * поллингу прогресса. Раньше параллелизм был неограничен (setInterval плодил
 * наслаивающиеся drainQueue), что исчерпывало пул и приводило к дедлоку на импорте.
 */
const MAX_CONCURRENT_JOBS = 4;
let draining = false;

/** Run jobs until the queue is empty, then return. Non-reentrant + bounded concurrency. */
async function drainQueue(): Promise<void> {
  if (draining || shuttingDown) return; // не наслаиваем проходы; не стартуем при остановке
  draining = true;
  try {
    let anyRan = true;
    while (anyRan) {
      // Берём пачку джоб параллельно; каждая claim'ит свою через SKIP LOCKED.
      const results = await Promise.all(
        Array.from({ length: MAX_CONCURRENT_JOBS }, () => pickAndRunJob()),
      );
      anyRan = results.some(Boolean);
    }
  } catch (e) {
    console.error('[worker] Unhandled error in drainQueue:', e);
  } finally {
    draining = false;
  }
}
