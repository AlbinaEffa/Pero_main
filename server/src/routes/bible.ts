import express from 'express';
import { createHash } from 'crypto';
import { eq, and, ne, inArray, desc, sql } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { db } from '../db/client.js';
import { retrieveCrossChapterPassages, searchBookPassages, searchSeriesPassages } from '../lib/semanticRetrieval.js';
import { refreshEntityEmbeddings } from '../lib/entityEmbeddings.js';
import { authenticateToken } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimiter.js';
import { guardChat } from '../lib/aiGuard.js';
import { stripHtml } from '../lib/html.js';
import { getAIProvider, getEmbeddingProvider } from '../lib/aiProvider.js';
import { aiQuota } from '../lib/quota.js';
import { checkBibleChapterLimit } from '../lib/planLimits.js';
import { enqueueJob } from '../jobs/queue.js';
import {
  isValidUUID, cleanJsonResponse,
  BASE_EXTRACTION_PROMPT, EXTRACTION_SCHEMA, processExtractionResults, sanitizePov, sanitizeSynopsis, isLowInfoChapterTitle,
  buildStoryBibleContext, buildContradictionPrompt,
  type AiEntity, type AiRelation,
} from '../lib/extraction.js';

const router = express.Router();

const ai = getAIProvider();

// ── helpers ──────────────────────────────────────────────────────────────────

async function assertProjectOwnership(projectId: string, userId: string): Promise<boolean> {
  if (!isValidUUID(projectId)) return false;
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)));
  return rows.length > 0;
}

async function assertEntityOwnership(entityId: string, userId: string): Promise<boolean> {
  if (!isValidUUID(entityId)) return false;
  const rows = await db
    .select({ id: schema.storyEntities.id })
    .from(schema.storyEntities)
    .innerJoin(schema.projects, eq(schema.storyEntities.projectId, schema.projects.id))
    .where(and(eq(schema.storyEntities.id, entityId), eq(schema.projects.userId, userId)));
  return rows.length > 0;
}

// ── Content hashing & diff ────────────────────────────────────────────────────

/**
 * Short SHA-256 hash of plain text. 16 hex chars = 64 bits of collision resistance,
 * plenty for change detection. Stored in chapters.lastExtractedContentHash.
 */
function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Split plain text into non-trivial paragraphs (strips blanks & very short lines).
 */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}|\r\n{2,}/)
    .map(p => p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 30);
}

interface ParagraphDiff {
  /** Paragraphs that are new or changed (not present in the old version). */
  changedParagraphs: string[];
  /** Ratio of changed paragraphs to total paragraphs in the new text. */
  changeRatio: number;
}

/**
 * Compare two plain-text versions of a chapter at paragraph level.
 * Returns paragraphs that are new or modified in the new version.
 */
function diffParagraphs(oldText: string, newText: string): ParagraphDiff {
  const oldParas = splitParagraphs(oldText);
  const newParas = splitParagraphs(newText);

  // Build a set of hashes from the old version for O(1) lookup
  const oldHashes = new Set(oldParas.map(p => contentHash(p)));

  const changedParagraphs = newParas.filter(p => !oldHashes.has(contentHash(p)));
  const changeRatio = newParas.length > 0 ? changedParagraphs.length / newParas.length : 1;

  return { changedParagraphs, changeRatio };
}

// ── AI prompts ────────────────────────────────────────────────────────────────


/**
 * Recheck prompt — tells the AI about already-approved entities.
 * Key difference from old version: explicitly asks AI to SKIP entities with no new info,
 * which avoids noisy "same description" update suggestions.
 */
function buildRecheckPrompt(
  approvedEntities: { name: string; type: string; description: string | null }[]
): string {
  if (approvedEntities.length === 0) return BASE_EXTRACTION_PROMPT;

  const list = approvedEntities
    .map(e => `• ${e.name} (${e.type}): ${e.description ?? '—'}`)
    .join('\n');

  return `Ты — литературный редактор, обновляющий справочник произведения.

Уже одобренные сущности проекта:
${list}

ЗАДАЧА — проанализировать текст главы:

1. Для ИЗВЕСТНЫХ сущностей (из списка выше):
   • Если глава раскрывает НОВЫЙ факт, уточнение или противоречие → верни сущность с обновлённым описанием.
   • Если новых деталей нет → НЕ включай эту сущность в ответ вообще.
   • Не предлагай обновление ради косметических изменений формулировки.

2. Для НОВЫХ сущностей (которых нет в списке):
   • Добавь по общим правилам (только именованные, только с конкретными деталями).

ТРЕБОВАНИЯ:
• Описание — строго из текста. Никаких домыслов.
• Используй каноническое имя из списка при совпадении (не новую форму).
• Если ничего нового нет — верни пустой массив entities.
• Для каждой сущности добавь significance ("major"/"moderate"/"minor") и attributes (только подтверждённые текстом поля).
  Для character доступны также: background (предыстория), motivations (мотивация),
  speech (манера речи), secrets (тайны), plotRelevance (зачем сюжету).
• Для character добавь events: 0–3 сюжетно значимых события персонажа В ЭТОЙ главе
  ({ "title": "2–4 слова", "description": "одно предложение", "eventType": "conflict"|"relationship"|"status"|"revelation"|"other",
     "timeLabel": "маркер времени из текста, если есть («за год до», «той же ночью»), иначе опусти",
     "timeHint": "'present' | 'flashback' | 'past' | 'future' (по умолчанию 'present')" }).
• Добавь relations: связи между сущностями (из списка или новыми), ЯВНО подтверждённые текстом:
  [{ "from": "Имя", "to": "Имя", "relation": "краткий тип («мать», «наставник», «живёт в»)" }].
  Для ЛОКАЦИЙ добавляй вложенность: relation «находится в»/«часть» (меньшее место → большее).

Ответ — строго JSON, без markdown. Имена и описания бери ТОЛЬКО из текста
(не подставляй слова «Имя», «Название», «Описание» как значения).
Структура (пример на вымышленных данных, не копируй):
{
  "entities": [
    {
      "type": "character",
      "name": "Кейлен",
      "description": "Капитан стражи. В этой главе раскрывает свой план побега.",
      "significance": "major",
      "attributes": { "appearance": "светловолосый", "role": "капитан стражи" },
      "events": [{ "title": "Раскрытие плана", "description": "Делится планом побега с сестрой.", "eventType": "conflict" }]
    }
  ],
  "relations": [{ "from": "Кейлен", "to": "Мира", "relation": "союзник" }],
  "chapterSummary": "Рабочее название главы (2–4 слова)"
}`;
}

/**
 * Incremental recheck prompt — only the CHANGED paragraphs are sent.
 * Much cheaper: ~10–20% of the tokens of a full recheck for small edits.
 */
function buildIncrementalRecheckPrompt(
  approvedEntities: { name: string; type: string; description: string | null }[],
  changedParagraphs: string[]
): string {
  const list = approvedEntities.length > 0
    ? approvedEntities.map(e => `• ${e.name} (${e.type}): ${e.description ?? '—'}`).join('\n')
    : '(нет одобренных сущностей)';

  const paragraphsText = changedParagraphs
    .map((p, i) => `[Фрагмент ${i + 1}]\n${p}`)
    .join('\n\n');

  return `Ты — литературный редактор, обновляющий справочник произведения.

В главу были внесены правки. Ниже — ТОЛЬКО изменённые или добавленные фрагменты текста:

${paragraphsText}

Уже одобренные сущности проекта:
${list}

ЗАДАЧА — проверить изменённые фрагменты:
1. Для ИЗВЕСТНЫХ сущностей: если изменения раскрывают новый факт → предложи обновление описания.
2. Для НОВЫХ сущностей: если в изменениях появилась новая именованная сущность с деталями → добавь.
3. Если изменения не затрагивают сущности → верни пустой массив entities.

НЕ анализируй то, что не изменилось. Описание — строго из текста.
Для каждой сущности добавь significance ("major"/"moderate"/"minor") и attributes (только подтверждённые текстом поля).
Для character добавь events (0–3 события персонажа в изменённых фрагментах; если есть
маркер времени — timeLabel + timeHint 'flashback'/'present') и relations (связи, явно
подтверждённые текстом; для локаций — вложенность «находится в»/«часть») — по общим правилам.

Ответ — строго JSON, без markdown. Имена/описания — ТОЛЬКО из текста
(слова «Имя», «Название», «Описание» как значения не подставляй).
Структура (пример на вымышленных данных, не копируй):
{
  "entities": [
    {
      "type": "character",
      "name": "Кейлен",
      "description": "Капитан стражи; в правке упомянут новый шрам на руке.",
      "significance": "moderate",
      "attributes": { "appearance": "шрам на правой руке" },
      "events": []
    }
  ],
  "relations": [],
  "chapterSummary": null
}`;
}

/**
 * Batch recheck prompt — analyze multiple chapters in a single API call.
 * Reduces N API calls to ceil(N / BATCH_SIZE) calls.
 */
function buildBatchRecheckPrompt(
  approvedEntities: { name: string; type: string; description: string | null }[],
  chapters: { chapterId: string; title: string; plainText: string }[]
): string {
  const list = approvedEntities.length > 0
    ? approvedEntities.map(e => `• ${e.name} (${e.type}): ${e.description ?? '—'}`).join('\n')
    : '(нет одобренных сущностей)';

  const chapterBlocks = chapters.map(ch =>
    `=== ГЛАВА: «${ch.title}» | id: ${ch.chapterId} ===\n${ch.plainText}`
  ).join('\n\n');

  return `Ты — литературный редактор, обновляющий справочник произведения.

Уже одобренные сущности проекта:
${list}

Проанализируй следующие главы. Для каждой главы:
1. Найди НОВЫЕ факты об известных сущностях → предложи обновление описания.
2. Найди новые именованные сущности с деталями → добавь.
3. Если нет ничего нового — верни пустой массив entities для этой главы.

Критерии качества:
• Описание — только из текста. Никаких домыслов.
• Не предлагай косметические переформулировки.
• Для известных сущностей: включай ТОЛЬКО если есть новая информация.
• Для каждой сущности добавь significance ("major"/"moderate"/"minor") и attributes (только подтверждённые текстом поля).
  Для character доступны также: background, motivations, speech, secrets, plotRelevance.
• Для character добавь events: 0–3 сюжетно значимых события персонажа в данной главе
  ({ "title": "2–4 слова", "description": "одно предложение", "eventType": "conflict"|"relationship"|"status"|"revelation"|"other",
     "timeLabel": "маркер времени из текста, если есть, иначе опусти", "timeHint": "'present'|'flashback'|'past'|'future'" }).
• Для каждой главы добавь relations: связи между сущностями, ЯВНО подтверждённые текстом
  ([{ "from": "Имя", "to": "Имя", "relation": "краткий тип" }]). Для локаций — вложенность «находится в»/«часть».

${chapterBlocks}

Ответ — строго JSON, без markdown. Имена/описания — ТОЛЬКО из текста глав
(слова «Имя», «Название», «Описание» как значения не подставляй).
Структура (пример на вымышленных данных, не копируй):
{
  "chapters": [
    {
      "chapterId": "uuid-главы",
      "entities": [
        {
          "type": "character",
          "name": "Кейлен",
          "description": "Капитан стражи. Принимает командование гарнизоном.",
          "significance": "major",
          "attributes": { "appearance": "светловолосый", "role": "капитан стражи" },
          "events": [{ "title": "Побег из крепости", "description": "Сбегает через подземный ход.", "eventType": "status" }]
        }
      ],
      "relations": [{ "from": "Кейлен", "to": "Мира", "relation": "сестра" }],
      "chapterSummary": "2–4 слова или null"
    }
  ]
}`;
}


// ── POST /api/bible/extract ───────────────────────────────────────────────────

router.post('/extract',
  authenticateToken,
  rateLimit('bible:extract', 20, 60 * 60 * 1000),
  aiQuota,
  async (req: any, res) => {
    try {
      if (!ai) return res.status(503).json({ error: 'AI is not configured' });

      const { chapterContent, projectId, chapterId } = req.body;
      if (!chapterContent) return res.status(400).json({ error: 'chapterContent is required' });

      // Ownership check BEFORE the AI call — never burn tokens on unauthorized requests
      const hasProject = Boolean(projectId && isValidUUID(projectId));
      if (hasProject) {
        const isOwner = await assertProjectOwnership(projectId, req.user.userId);
        if (!isOwner) return res.status(403).json({ error: 'Access denied to this project' });
        // Лимит Free: Мир анализирует первые 30 глав (гейт ДО AI — токены не жжём)
        if (chapterId && isValidUUID(chapterId)) {
          const denial = await checkBibleChapterLimit(req.user.userId, projectId, chapterId);
          if (denial) return res.status(402).json(denial);
        }
      }

      const plainText = stripHtml(chapterContent);

      const response = await guardChat(
        () => ai.generate({
          contents: `${BASE_EXTRACTION_PROMPT}\n\nТекст главы:\n"""\n${plainText}\n"""`,
          temperature: 0.15,
          responseSchema: EXTRACTION_SCHEMA,
          responseSchemaName: 'entity_extraction',
        }),
        { userId: req.user.userId, projectId: projectId ?? null, route: 'bible:extract' }
      );

      const raw = response.text || '{"entities":[]}';
      let parsed: { entities: AiEntity[]; relations?: AiRelation[]; chapterSummary?: string; pov?: unknown; synopsis?: unknown };
      try {
        parsed = JSON.parse(cleanJsonResponse(raw));
      } catch {
        console.error('Failed to parse AI response:', raw.slice(0, 200));
        return res.status(500).json({ error: 'AI returned invalid JSON' });
      }

      const entities = Array.isArray(parsed) ? parsed : (parsed.entities || []);
      const relations = Array.isArray(parsed) ? [] : (parsed.relations || []);

      if (hasProject) {
        let chapterTitle: string | null = null;
        if (chapterId && isValidUUID(chapterId)) {
          const rows = await db.select({ title: schema.chapters.title }).from(schema.chapters).where(eq(schema.chapters.id, chapterId));
          chapterTitle = rows[0]?.title ?? null;
        }

        const { newSuggestions, updateSuggestions, newLinks, newEvents } = await processExtractionResults(
          entities, relations, projectId, chapterId ?? null, chapterTitle, plainText,
        );

        if (chapterId && isValidUUID(chapterId)) {
          try {
            const updatePayload: Record<string, unknown> = {
              lastExtractedAt: new Date(),
              lastExtractedContentHash: contentHash(plainText),
            };
            if (parsed.chapterSummary && isLowInfoChapterTitle(chapterTitle)) {
              updatePayload.title = parsed.chapterSummary.substring(0, 100);
            }
            const pov = sanitizePov(parsed.pov);
            if (pov) updatePayload.povCharacter = pov;
            const synopsis = sanitizeSynopsis(parsed.synopsis);
            if (synopsis) updatePayload.summary = synopsis;
            await db.update(schema.chapters).set(updatePayload).where(eq(schema.chapters.id, chapterId));
          } catch (e) {
            console.warn('[bible:extract] Failed to update chapter metadata:', e);
          }
        }

        return res.json({
          entities: newSuggestions,
          updates:  updateSuggestions,
          total:    newSuggestions.length + updateSuggestions.length,
          linksAdded:  newLinks,
          eventsAdded: newEvents,
          chapterSummary: parsed.chapterSummary,
        });
      }

      // Demo mode (no projectId)
      const demoEntities = entities.map((e, i) => ({
        id: `demo-${Date.now()}-${i}`,
        type: e.type,
        name: e.name,
        description: e.description || '',
        status: 'pending',
      }));
      res.json({ entities: demoEntities, updates: [], total: demoEntities.length });

    } catch (error) {
      console.error('Error extracting entities:', error);
      res.status(500).json({ error: 'Failed to extract entities' });
    }
  }
);

// ── POST /api/bible/recheck/chapter/:chapterId ────────────────────────────────
//
// Incremental strategy:
//   1. If chapter content hash === stored hash → skip (zero API cost)
//   2. If < 40% of paragraphs changed → incremental prompt (only changed paragraphs)
//   3. Otherwise → full extraction with recheck prompt
//
router.post('/recheck/chapter/:chapterId',
  authenticateToken,
  rateLimit('bible:extract', 20, 60 * 60 * 1000),
  aiQuota,
  async (req: any, res) => {
    try {
      if (!ai) return res.status(503).json({ error: 'AI is not configured' });

      const { chapterId } = req.params;
      if (!isValidUUID(chapterId)) return res.status(400).json({ error: 'Invalid chapterId' });

      const chapterRows = await db
        .select({
          content:                   schema.chapters.content,
          title:                     schema.chapters.title,
          projectId:                 schema.chapters.projectId,
          lastExtractedContentHash:  schema.chapters.lastExtractedContentHash,
        })
        .from(schema.chapters)
        .innerJoin(schema.projects, eq(schema.chapters.projectId, schema.projects.id))
        .where(and(eq(schema.chapters.id, chapterId), eq(schema.projects.userId, req.user.userId)));

      if (!chapterRows.length) return res.status(403).json({ error: 'Chapter not found or access denied' });

      const { content, title: chapterTitle, projectId, lastExtractedContentHash: storedHash } = chapterRows[0];
      const plainText = stripHtml(content ?? '');

      if (!plainText) return res.json({ entities: [], updates: [], total: 0, note: 'empty' });

      // ── Step 1: Skip if content unchanged ────────────────────────────────────
      const currentHash = contentHash(plainText);
      if (storedHash && storedHash === currentHash) {
        return res.json({ entities: [], updates: [], total: 0, note: 'no_changes' });
      }

      // Лимит Free: Мир анализирует первые 30 глав (гейт ДО AI — токены не жжём)
      const denial = await checkBibleChapterLimit(req.user.userId, projectId, chapterId);
      if (denial) return res.status(402).json(denial);

      // ── Step 2: Determine extraction strategy ────────────────────────────────
      const approvedEntities = await db
        .select({ id: schema.storyEntities.id, name: schema.storyEntities.name, type: schema.storyEntities.type, description: schema.storyEntities.description })
        .from(schema.storyEntities)
        .where(and(eq(schema.storyEntities.projectId, projectId), eq(schema.storyEntities.status, 'approved')));

      let prompt: string;
      let isIncremental = false;

      if (storedHash) {
        // We have a previous extraction — compute paragraph diff
        // We don't store the old plain text, but we can reconstruct "what changed"
        // by diffing the current paragraphs against a hash-only snapshot.
        // Since we only stored the overall hash (not per-paragraph), we fall back to
        // full recheck but with the cheaper incremental prompt when change ratio is low.
        //
        // For a true paragraph diff we need the old text — use the stored hash as a signal
        // that extraction was done before, then do a full recheck (with approved entity context).
        // TODO: for future optimization, store per-paragraph hashes in a separate column.
        prompt = buildRecheckPrompt(approvedEntities);
      } else {
        // First recheck ever — full extraction
        prompt = approvedEntities.length > 0
          ? buildRecheckPrompt(approvedEntities)
          : BASE_EXTRACTION_PROMPT;
      }

      const response = await guardChat(
        () => ai.generate({
          contents: `${prompt}\n\nТекст главы:\n"""\n${plainText}\n"""`,
          temperature: 0.15,
          responseSchema: EXTRACTION_SCHEMA,
          responseSchemaName: 'entity_extraction',
        }),
        { userId: req.user.userId, projectId, route: 'bible:recheck' }
      );

      const raw = response.text || '{"entities":[]}';
      let parsed: { entities: AiEntity[]; relations?: AiRelation[]; chapterSummary?: string; pov?: unknown; synopsis?: unknown };
      try {
        parsed = JSON.parse(cleanJsonResponse(raw));
      } catch {
        return res.status(500).json({ error: 'AI returned invalid JSON' });
      }
      const entities = Array.isArray(parsed) ? parsed : (parsed.entities || []);
      const relations = Array.isArray(parsed) ? [] : (parsed.relations || []);

      const { newSuggestions, updateSuggestions, newLinks, newEvents } = await processExtractionResults(
        entities, relations, projectId, chapterId, chapterTitle, plainText,
      );

      // Update freshness metadata
      try {
        const updatePayload: Record<string, unknown> = {
          lastExtractedAt: new Date(),
          lastExtractedContentHash: currentHash,
        };
        if (parsed.chapterSummary && chapterTitle && /^Глава \d+$/.test(chapterTitle.trim())) {
          updatePayload.title = parsed.chapterSummary.substring(0, 100);
        }
        const pov = sanitizePov(parsed.pov);
        if (pov) updatePayload.povCharacter = pov;
        await db.update(schema.chapters).set(updatePayload).where(eq(schema.chapters.id, chapterId));
      } catch (e) {
        console.warn('[bible:recheck] Failed to update chapter metadata:', e);
      }

      res.json({
        entities: newSuggestions,
        updates:  updateSuggestions,
        total:    newSuggestions.length + updateSuggestions.length,
        linksAdded:  newLinks,
        eventsAdded: newEvents,
        chapterSummary: parsed.chapterSummary,
        mode: isIncremental ? 'incremental' : 'full',
      });
    } catch (error) {
      console.error('Error in POST /bible/recheck/chapter:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── POST /api/bible/recheck/batch ─────────────────────────────────────────────
//
// Batch recheck: process up to BATCH_SIZE chapters in a SINGLE API call.
// Used by "Recheck All Stale" to replace N sequential calls with ceil(N/BATCH_SIZE) calls.
//
// Body: { projectId: string; chapterIds: string[] }
//
const BATCH_SIZE = 6; // chapters per API call — keeps prompt under ~40k tokens

router.post('/recheck/batch',
  authenticateToken,
  rateLimit('bible:extract', 10, 60 * 60 * 1000),  // lower limit — each call is expensive
  aiQuota,
  async (req: any, res) => {
    try {
      if (!ai) return res.status(503).json({ error: 'AI is not configured' });

      const { projectId, chapterIds } = req.body as { projectId: string; chapterIds: string[] };
      if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid projectId' });
      if (!Array.isArray(chapterIds) || chapterIds.length === 0) {
        return res.status(400).json({ error: 'chapterIds must be a non-empty array' });
      }

      const isOwner = await assertProjectOwnership(projectId, req.user.userId);
      if (!isOwner) return res.status(403).json({ error: 'Access denied' });

      // Fetch all requested chapters (that belong to this project)
      const validIds = chapterIds.filter(isValidUUID);
      const chapterRows = await db
        .select({
          id:      schema.chapters.id,
          title:   schema.chapters.title,
          content: schema.chapters.content,
          lastExtractedContentHash: schema.chapters.lastExtractedContentHash,
        })
        .from(schema.chapters)
        .where(and(
          eq(schema.chapters.projectId, projectId),
          inArray(schema.chapters.id, validIds),
        ));

      // Fetch approved entities once for all chapters
      const approvedEntities = await db
        .select({ id: schema.storyEntities.id, name: schema.storyEntities.name, type: schema.storyEntities.type, description: schema.storyEntities.description })
        .from(schema.storyEntities)
        .where(and(eq(schema.storyEntities.projectId, projectId), eq(schema.storyEntities.status, 'approved')));

      // Filter out unchanged chapters (hash match) — free skip
      const toProcess = chapterRows
        .map(ch => {
          const plainText = stripHtml(ch.content ?? '');
          const hash = contentHash(plainText);
          return { ...ch, plainText, hash };
        })
        .filter(ch => ch.plainText.length > 0 && ch.hash !== ch.lastExtractedContentHash);

      if (toProcess.length === 0) {
        return res.json({ results: [], skipped: chapterRows.length, note: 'all_unchanged' });
      }

      const allNewSuggestions: (typeof schema.storyEntities.$inferSelect)[] = [];
      const allUpdateSuggestions: (typeof schema.bibleUpdateSuggestions.$inferSelect)[] = [];
      const processedIds: string[] = [];

      // Process in batches
      for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
        const batch = toProcess.slice(i, i + BATCH_SIZE);

        const batchInput = batch.map(ch => ({
          chapterId: ch.id,
          title: ch.title,
          // Limit each chapter to ~6000 chars to keep batch prompt manageable
          plainText: ch.plainText.slice(0, 6000),
        }));

        const batchPrompt = buildBatchRecheckPrompt(approvedEntities, batchInput);

        let batchResponse;
        try {
          batchResponse = await guardChat(
            () => ai.generate({ contents: batchPrompt, temperature: 0.15 }),
            { userId: req.user.userId, projectId, route: 'bible:recheck' }
          );
        } catch (err) {
          console.error('[bible:recheck/batch] API error for batch:', err);
          continue; // Skip this batch, process next
        }

        const raw = batchResponse.text || '{"chapters":[]}';
        let batchParsed: { chapters: { chapterId: string; entities: AiEntity[]; relations?: AiRelation[]; chapterSummary?: string | null; pov?: unknown; synopsis?: unknown }[] };
        try {
          batchParsed = JSON.parse(cleanJsonResponse(raw));
        } catch {
          console.error('[bible:recheck/batch] Invalid JSON from AI:', raw.slice(0, 200));
          continue;
        }

        if (!Array.isArray(batchParsed.chapters)) continue;

        for (const chResult of batchParsed.chapters) {
          if (!isValidUUID(chResult.chapterId)) continue;
          const chMeta = batch.find(ch => ch.id === chResult.chapterId);
          if (!chMeta) continue;

          const entities = Array.isArray(chResult.entities) ? chResult.entities : [];
          const relations = Array.isArray(chResult.relations) ? chResult.relations : [];

          const { newSuggestions, updateSuggestions } = await processExtractionResults(
            entities, relations, projectId, chResult.chapterId, chMeta.title, chMeta.plainText,
          );

          allNewSuggestions.push(...newSuggestions);
          allUpdateSuggestions.push(...updateSuggestions);

          // Update chapter freshness
          try {
            const updatePayload: Record<string, unknown> = {
              lastExtractedAt: new Date(),
              lastExtractedContentHash: chMeta.hash,
            };
            if (chResult.chapterSummary && isLowInfoChapterTitle(chMeta.title)) {
              updatePayload.title = chResult.chapterSummary.substring(0, 100);
            }
            const pov = sanitizePov(chResult.pov);
            if (pov) updatePayload.povCharacter = pov;
            const synopsis = sanitizeSynopsis(chResult.synopsis);
            if (synopsis) updatePayload.summary = synopsis;
            await db.update(schema.chapters).set(updatePayload).where(eq(schema.chapters.id, chResult.chapterId));
          } catch (e) {
            console.warn('[bible:recheck/batch] Failed to update chapter metadata:', e);
          }
          processedIds.push(chResult.chapterId);
        }
      }

      res.json({
        entities: allNewSuggestions,
        updates:  allUpdateSuggestions,
        total:    allNewSuggestions.length + allUpdateSuggestions.length,
        processed: processedIds.length,
        skipped:   chapterRows.length - toProcess.length,
      });
    } catch (error) {
      console.error('Error in POST /bible/recheck/batch:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── POST /api/bible/updates/bulk-dismiss ─────────────────────────────────────

router.post('/updates/bulk-dismiss', authenticateToken, async (req: any, res) => {
  try {
    const { projectId, chapterId } = req.body;
    if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid projectId' });
    if (!isValidUUID(chapterId)) return res.status(400).json({ error: 'Invalid chapterId' });

    const isOwner = await assertProjectOwnership(projectId, req.user.userId);
    if (!isOwner) return res.status(403).json({ error: 'Access denied' });

    const dismissed = await db
      .update(schema.bibleUpdateSuggestions)
      .set({ status: 'dismissed', updatedAt: new Date() })
      .where(and(
        eq(schema.bibleUpdateSuggestions.projectId, projectId),
        eq(schema.bibleUpdateSuggestions.chapterId, chapterId),
        eq(schema.bibleUpdateSuggestions.status, 'pending'),
      ))
      .returning({ id: schema.bibleUpdateSuggestions.id });

    res.json({ dismissed: dismissed.length });
  } catch (error) {
    console.error('Error bulk-dismissing bible updates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/bible/updates/bulk-reject ──────────────────────────────────────

router.post('/updates/bulk-reject', authenticateToken, async (req: any, res) => {
  try {
    const { projectId, chapterId } = req.body;
    if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid projectId' });
    if (!isValidUUID(chapterId)) return res.status(400).json({ error: 'Invalid chapterId' });

    const isOwner = await assertProjectOwnership(projectId, req.user.userId);
    if (!isOwner) return res.status(403).json({ error: 'Access denied' });

    const rejected = await db
      .update(schema.bibleUpdateSuggestions)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(and(
        eq(schema.bibleUpdateSuggestions.projectId, projectId),
        eq(schema.bibleUpdateSuggestions.chapterId, chapterId),
        eq(schema.bibleUpdateSuggestions.status, 'pending'),
      ))
      .returning({ id: schema.bibleUpdateSuggestions.id });

    res.json({ rejected: rejected.length });
  } catch (error) {
    console.error('Error bulk-rejecting bible updates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/bible/:projectId/updates ─────────────────────────────────────────

router.get('/:projectId/updates', authenticateToken, async (req: any, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid project ID' });

    const isOwner = await assertProjectOwnership(projectId, req.user.userId);
    if (!isOwner) return res.status(403).json({ error: 'Access denied' });

    const rows = await db
      .select({
        id:                  schema.bibleUpdateSuggestions.id,
        entityId:            schema.bibleUpdateSuggestions.entityId,
        entityType:          schema.storyEntities.type,
        entityName:          schema.storyEntities.name,
        chapterId:           schema.bibleUpdateSuggestions.chapterId,
        chapterTitle:        schema.bibleUpdateSuggestions.chapterTitle,
        previousDescription: schema.bibleUpdateSuggestions.previousDescription,
        proposedDescription: schema.bibleUpdateSuggestions.proposedDescription,
        sourceExcerpt:       schema.bibleUpdateSuggestions.sourceExcerpt,
        reason:              schema.bibleUpdateSuggestions.reason,
        status:              schema.bibleUpdateSuggestions.status,
        createdAt:           schema.bibleUpdateSuggestions.createdAt,
      })
      .from(schema.bibleUpdateSuggestions)
      .innerJoin(schema.storyEntities, eq(schema.bibleUpdateSuggestions.entityId, schema.storyEntities.id))
      .where(and(
        eq(schema.bibleUpdateSuggestions.projectId, projectId),
        eq(schema.bibleUpdateSuggestions.status, 'pending'),
      ));

    res.json({ updates: rows });
  } catch (error) {
    console.error('Error fetching bible updates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/bible/updates/:updateId/accept ─────────────────────────────────

router.post('/updates/:updateId/accept', authenticateToken, async (req: any, res) => {
  try {
    const { updateId } = req.params;
    if (!isValidUUID(updateId)) return res.status(400).json({ error: 'Invalid update ID' });

    const rows = await db
      .select({ update: schema.bibleUpdateSuggestions, userId: schema.projects.userId })
      .from(schema.bibleUpdateSuggestions)
      .innerJoin(schema.projects, eq(schema.bibleUpdateSuggestions.projectId, schema.projects.id))
      .where(eq(schema.bibleUpdateSuggestions.id, updateId));

    if (!rows.length || rows[0].userId !== req.user.userId) {
      return res.status(403).json({ error: 'Not found or access denied' });
    }
    const { update } = rows[0];
    if (update.status !== 'pending') {
      return res.status(400).json({ error: 'Update suggestion already processed' });
    }

    await db.update(schema.storyEntities)
      // description меняется → сбрасываем кэш эмбеддинга карточки
      .set({ description: update.proposedDescription, embedding: null, embeddingText: null })
      .where(eq(schema.storyEntities.id, update.entityId));

    const [accepted] = await db
      .update(schema.bibleUpdateSuggestions)
      .set({ status: 'accepted', updatedAt: new Date() })
      .where(eq(schema.bibleUpdateSuggestions.id, updateId))
      .returning();

    // Dismiss sibling pending suggestions with the same proposal (now redundant)
    await db
      .update(schema.bibleUpdateSuggestions)
      .set({ status: 'dismissed', updatedAt: new Date() })
      .where(and(
        eq(schema.bibleUpdateSuggestions.entityId, update.entityId),
        eq(schema.bibleUpdateSuggestions.status, 'pending'),
        eq(schema.bibleUpdateSuggestions.proposedDescription, update.proposedDescription),
        ne(schema.bibleUpdateSuggestions.id, updateId),
      ));

    res.json({ update: accepted });
  } catch (error) {
    console.error('Error accepting bible update:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/bible/updates/:updateId/reject ─────────────────────────────────

router.post('/updates/:updateId/reject', authenticateToken, async (req: any, res) => {
  try {
    const { updateId } = req.params;
    if (!isValidUUID(updateId)) return res.status(400).json({ error: 'Invalid update ID' });

    const rows = await db
      .select({ userId: schema.projects.userId, status: schema.bibleUpdateSuggestions.status })
      .from(schema.bibleUpdateSuggestions)
      .innerJoin(schema.projects, eq(schema.bibleUpdateSuggestions.projectId, schema.projects.id))
      .where(eq(schema.bibleUpdateSuggestions.id, updateId));

    if (!rows.length || rows[0].userId !== req.user.userId) {
      return res.status(403).json({ error: 'Not found or access denied' });
    }

    const [rejected] = await db
      .update(schema.bibleUpdateSuggestions)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(eq(schema.bibleUpdateSuggestions.id, updateId))
      .returning();

    res.json({ update: rejected });
  } catch (error) {
    console.error('Error rejecting bible update:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/bible/updates/:updateId/dismiss ────────────────────────────────

router.post('/updates/:updateId/dismiss', authenticateToken, async (req: any, res) => {
  try {
    const { updateId } = req.params;
    if (!isValidUUID(updateId)) return res.status(400).json({ error: 'Invalid update ID' });

    const rows = await db
      .select({ userId: schema.projects.userId })
      .from(schema.bibleUpdateSuggestions)
      .innerJoin(schema.projects, eq(schema.bibleUpdateSuggestions.projectId, schema.projects.id))
      .where(eq(schema.bibleUpdateSuggestions.id, updateId));

    if (!rows.length || rows[0].userId !== req.user.userId) {
      return res.status(403).json({ error: 'Not found or access denied' });
    }

    const [dismissed] = await db
      .update(schema.bibleUpdateSuggestions)
      .set({ status: 'dismissed', updatedAt: new Date() })
      .where(eq(schema.bibleUpdateSuggestions.id, updateId))
      .returning();

    res.json({ update: dismissed });
  } catch (error) {
    console.error('Error dismissing bible update:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/bible/:projectId/letter — «письмо от Пера» для Карты мира ──────
//
// Один дешёвый AI-вызов поверх уже извлечённой библии: тёплый итог онбординга
// в тоне литературного редактора. Вне aiQuota (aha-момент онбординга не душим),
// но под жёстким rate limit — письмо нужно один раз после импорта.

router.post('/:projectId/letter',
  authenticateToken,
  rateLimit('bible:letter', 5, 60 * 60 * 1000),
  async (req: any, res) => {
    try {
      if (!ai) return res.status(503).json({ error: 'AI is not configured' });

      const { projectId } = req.params;
      if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid project ID' });

      const isOwner = await assertProjectOwnership(projectId, req.user.userId);
      if (!isOwner) return res.status(403).json({ error: 'Access denied' });

      const [entities, projectRows, pendingUpdates] = await Promise.all([
        db.select({
            type: schema.storyEntities.type,
            name: schema.storyEntities.name,
            description: schema.storyEntities.description,
            significance: schema.storyEntities.significance,
            attributes: schema.storyEntities.attributes,
          })
          .from(schema.storyEntities)
          .where(and(eq(schema.storyEntities.projectId, projectId), ne(schema.storyEntities.status, 'rejected'))),
        db.select({ title: schema.projects.title }).from(schema.projects).where(eq(schema.projects.id, projectId)),
        db.select({ id: schema.bibleUpdateSuggestions.id })
          .from(schema.bibleUpdateSuggestions)
          .where(and(
            eq(schema.bibleUpdateSuggestions.projectId, projectId),
            eq(schema.bibleUpdateSuggestions.status, 'pending'),
          )),
      ]);

      if (entities.length === 0) {
        return res.json({ letter: null, note: 'empty_bible' });
      }

      const counts = {
        characters: entities.filter(e => e.type === 'character').length,
        locations:  entities.filter(e => e.type === 'location').length,
        items:      entities.filter(e => e.type === 'item').length,
        rules:      entities.filter(e => e.type === 'rule').length,
      };
      const majors = entities
        .filter(e => e.type === 'character' && e.significance === 'major')
        .slice(0, 4)
        .map(e => {
          const attrs = (e.attributes ?? {}) as Record<string, unknown>;
          const detail = [attrs.motivations, attrs.secrets, attrs.role]
            .find(v => typeof v === 'string' && v.trim());
          return `${e.name}: ${e.description ?? ''}${detail ? ` (${detail})` : ''}`;
        })
        .join('\n');

      const prompt = `Ты — Перо, литературный редактор-хранитель. Автор только что доверил тебе рукопись «${projectRows[0]?.title ?? 'без названия'}», и ты её прочитал.

Напиши автору короткое тёплое письмо (3–5 предложений, обращение на «вы»):
1. Скажи, что прочитал историю, назови масштаб мира: ${counts.characters} персонажей, ${counts.locations} локаций, ${counts.items} предметов, ${counts.rules} правил мира.
2. Назови, кто, по-твоему, в сердце истории (выбери из списка ниже), и одну интригующую деталь о нём.
3. ${pendingUpdates.length > 0 ? `Упомяни, что заметил ${pendingUpdates.length} мест, где мир уточняется по ходу текста — предложи взглянуть.` : 'Скажи, что мир выглядит цельным.'}
4. Закончи одной фразой о том, что теперь будешь помнить этот мир вместо автора.

Главные персонажи:
${majors || '(главные персонажи не размечены)'}

СТРОГО: используй только факты из этого письма-задания, ничего не выдумывай. Без пафоса и канцелярита. Не используй markdown. Ответ — только текст письма.`;

      const response = await guardChat(
        () => ai.generate({ contents: prompt, temperature: 0.7 }),
        { userId: req.user.userId, projectId, route: 'bible:letter' }
      );

      const letter = (response.text ?? '').trim();
      if (!letter) return res.json({ letter: null, note: 'empty_response' });

      res.json({ letter: letter.slice(0, 1200) });
    } catch (error) {
      console.error('Error generating bible letter:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── GET /api/bible/:projectId — entities + links + timeline events ───────────

router.get('/:projectId', authenticateToken, async (req: any, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid project ID' });

    const isOwner = await assertProjectOwnership(projectId, req.user.userId);
    if (!isOwner) return res.status(403).json({ error: 'Access denied to this project' });

    const [entities, links, events] = await Promise.all([
      db.select().from(schema.storyEntities).where(eq(schema.storyEntities.projectId, projectId)),
      db.select().from(schema.entityLinks).where(eq(schema.entityLinks.projectId, projectId)),
      db.select().from(schema.entityEvents).where(eq(schema.entityEvents.projectId, projectId)),
    ]);

    res.json({ entities, links, events });
  } catch (error) {
    console.error('Error fetching entities:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/bible/:entityId — manual edit by the author ───────────────────
//
// Body: { name?, description?, significance?, attributes? }
// Авторская правка — источник истины: перезаписывает поля целиком.

// ── POST /api/bible/:projectId/entities — ручное создание сущности из выделения ──
// Автор сам отметил имя в тексте → запись авторитетная, сразу 'approved'
// (в отличие от ИИ-находок, что идут в pending-инбокс). Дедуп по имени: если такая
// уже есть — возвращаем её, нового дубля не плодим.
const ALLOWED_ENTITY_TYPES = ['character', 'location', 'item', 'rule'];

router.post('/:projectId/entities', authenticateToken, async (req: any, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid project ID' });

    const isOwner = await assertProjectOwnership(projectId, req.user.userId);
    if (!isOwner) return res.status(403).json({ error: 'Access denied' });

    const { type, name, description } = req.body ?? {};
    if (!ALLOWED_ENTITY_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Invalid entity type' });
    }
    const cleanName = typeof name === 'string' ? name.trim().slice(0, 200) : '';
    if (!cleanName) return res.status(400).json({ error: 'Name is required' });

    // Дедуп: точное совпадение имени (без регистра) в этом проекте
    const existing = await db
      .select()
      .from(schema.storyEntities)
      .where(and(
        eq(schema.storyEntities.projectId, projectId),
        eq(schema.storyEntities.type, type),
      ));
    const dup = existing.find(e => e.name.trim().toLowerCase() === cleanName.toLowerCase());
    if (dup) return res.json(dup);

    const [created] = await db
      .insert(schema.storyEntities)
      .values({
        projectId,
        type,
        name: cleanName,
        description: typeof description === 'string' ? description.slice(0, 4000) : null,
        status: 'approved',
      })
      .returning();

    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating entity:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Глобальный пересчёт significance по ПРИСУТСТВИЮ.
 * Значимость, выставленная ИИ по-главно, всегда «major» (важный-в-главе ⇒ major).
 * Здесь судим по охвату: в скольких РАЗНЫХ главах сущность фигурирует (chapterId сущности +
 * её события + её связи). Пороги адаптивны к длине книги. Возвращает распределение.
 */
export async function recomputeSignificance(projectId: string): Promise<{ updated: number; dist: Record<string, number> }> {
  const entities = await db.select({ id: schema.storyEntities.id, chapterId: schema.storyEntities.chapterId, significance: schema.storyEntities.significance })
    .from(schema.storyEntities)
    .where(and(eq(schema.storyEntities.projectId, projectId), eq(schema.storyEntities.status, 'approved')));
  if (entities.length === 0) return { updated: 0, dist: {} };

  const events = await db.select({ entityId: schema.entityEvents.entityId, chapterId: schema.entityEvents.chapterId })
    .from(schema.entityEvents).where(eq(schema.entityEvents.projectId, projectId));
  const links = await db.select({ s: schema.entityLinks.sourceEntityId, t: schema.entityLinks.targetEntityId, chapterId: schema.entityLinks.chapterId })
    .from(schema.entityLinks).where(eq(schema.entityLinks.projectId, projectId));

  const presence = new Map<string, Set<string>>();
  const add = (eid: string | null, cid: string | null) => {
    if (!eid || !cid) return;
    if (!presence.has(eid)) presence.set(eid, new Set());
    presence.get(eid)!.add(cid);
  };
  entities.forEach(e => add(e.id, e.chapterId));
  events.forEach(ev => add(ev.entityId, ev.chapterId));
  links.forEach(l => { add(l.s, l.chapterId); add(l.t, l.chapterId); });

  // Сколько всего глав в проекте (для адаптивных порогов).
  const [{ total }] = await db.select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.chapters).where(eq(schema.chapters.projectId, projectId));
  const majorT = Math.max(5, Math.round(total * 0.1));   // ~ в 10% глав и больше → major
  const modT = Math.max(2, Math.round(total * 0.035));   // ~3.5% → moderate, иначе minor
  const tier = (n: number) => (n >= majorT ? 'major' : n >= modT ? 'moderate' : 'minor');

  const dist: Record<string, number> = { major: 0, moderate: 0, minor: 0 };
  let updated = 0;
  for (const e of entities) {
    const n = presence.get(e.id)?.size ?? 0;
    const sig = tier(n);
    dist[sig]++;
    if (e.significance !== sig) {
      await db.update(schema.storyEntities).set({ significance: sig }).where(eq(schema.storyEntities.id, e.id));
      updated++;
    }
  }
  return { updated, dist };
}

// POST /api/bible/:projectId/recompute-significance — пересчитать значимость по присутствию
router.post('/:projectId/recompute-significance', authenticateToken, async (req: any, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid project ID' });
    if (!(await assertProjectOwnership(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });
    const result = await recomputeSignificance(projectId);
    res.json(result);
  } catch (error) {
    console.error('Error recomputing significance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:entityId', authenticateToken, async (req: any, res) => {
  try {
    const { entityId } = req.params;
    if (!isValidUUID(entityId)) return res.status(400).json({ error: 'Invalid entity ID' });

    const isOwner = await assertEntityOwnership(entityId, req.user.userId);
    if (!isOwner) return res.status(403).json({ error: 'Access denied' });

    const { name, description, significance, attributes } = req.body ?? {};
    const patch: Record<string, unknown> = {};

    if (typeof name === 'string' && name.trim()) patch.name = name.trim().slice(0, 200);
    if (typeof description === 'string') patch.description = description.slice(0, 4000);
    if (significance === null || ['major', 'moderate', 'minor'].includes(significance)) {
      patch.significance = significance;
    }
    if (attributes !== undefined) {
      if (attributes !== null && (typeof attributes !== 'object' || Array.isArray(attributes))) {
        return res.status(400).json({ error: 'attributes must be an object or null' });
      }
      patch.attributes = attributes;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    // Изменились имя/описание → семантический эмбеддинг карточки устарел: сбрасываем
    // кэш, refreshEntityEmbeddings пересчитает его при следующем использовании.
    if (patch.name !== undefined || patch.description !== undefined) {
      patch.embedding = null;
      patch.embeddingText = null;
    }

    const updated = await db
      .update(schema.storyEntities)
      .set(patch)
      .where(eq(schema.storyEntities.id, entityId))
      .returning();

    if (!updated.length) return res.status(404).json({ error: 'Entity not found' });
    res.json({ entity: updated[0] });
  } catch (error) {
    console.error('Error updating entity:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/bible/:projectId/merge — слить дубли одного имени в одну сущность ──
// Лечит корень нестыковок: один герой записан несколько раз с разными описаниями.
const SIG_RANK_MERGE: Record<string, number> = { major: 0, moderate: 1, minor: 2 };

router.post('/:projectId/merge', authenticateToken, async (req: any, res) => {
  try {
    const { projectId } = req.params;
    const { name, ids, survivorId } = req.body ?? {};
    if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid project ID' });

    const isOwner = await assertProjectOwnership(projectId, req.user.userId);
    if (!isOwner) return res.status(403).json({ error: 'Access denied to this project' });

    const ents = await db.select().from(schema.storyEntities)
      .where(and(eq(schema.storyEntities.projectId, projectId), eq(schema.storyEntities.status, 'approved')));

    // Два режима: по имени (дубли одного имени) и по ids (варианты разных имён — Риз/Ризанд).
    let group: typeof ents;
    if (Array.isArray(ids) && ids.length >= 2) {
      const idSet = new Set(ids.filter((x: unknown) => typeof x === 'string'));
      group = ents.filter(e => idSet.has(e.id));
    } else if (typeof name === 'string' && name.trim()) {
      group = ents.filter(e => e.name.trim().toLowerCase() === name.trim().toLowerCase());
    } else {
      return res.status(400).json({ error: 'name or ids[] is required' });
    }
    if (group.length < 2) return res.json({ merged: 0 });

    // Выживший: явный выбор автора (survivorId) приоритетен; иначе самый «канонический»
    // по значимости, затем по длине описания.
    const chosen = typeof survivorId === 'string' ? group.find(e => e.id === survivorId) : undefined;
    const survivor = chosen ?? group.reduce((a, b) => {
      const ra = SIG_RANK_MERGE[a.significance ?? 'minor'] ?? 2;
      const rb = SIG_RANK_MERGE[b.significance ?? 'minor'] ?? 2;
      if (rb !== ra) return rb < ra ? b : a;
      return (b.description?.length ?? 0) > (a.description?.length ?? 0) ? b : a;
    });
    const others = group.filter(e => e.id !== survivor.id);
    const otherIds = others.map(e => e.id);

    // Имена слитых вариантов + их алиасы → в aliases выжившего (чтобы извлечение
    // дальше узнавало «Ризанд» как «Риз», а не плодило дубль заново).
    const attrs = (survivor.attributes ?? {}) as Record<string, unknown>;
    const aliasSet = new Set<string>(Array.isArray(attrs.aliases) ? (attrs.aliases as string[]) : []);
    for (const o of others) {
      if (o.name && o.name.trim().toLowerCase() !== survivor.name.trim().toLowerCase()) aliasSet.add(o.name.trim());
      const oa = (o.attributes ?? {}) as Record<string, unknown>;
      if (Array.isArray(oa.aliases)) for (const al of oa.aliases as string[]) if (al?.trim()) aliasSet.add(al.trim());
    }
    const survivorName = survivor.name.trim().toLowerCase();
    const aliases = [...aliasSet].filter(a => a.toLowerCase() !== survivorName);

    await db.update(schema.entityLinks).set({ sourceEntityId: survivor.id }).where(inArray(schema.entityLinks.sourceEntityId, otherIds));
    await db.update(schema.entityLinks).set({ targetEntityId: survivor.id }).where(inArray(schema.entityLinks.targetEntityId, otherIds));
    await db.update(schema.entityEvents).set({ entityId: survivor.id }).where(inArray(schema.entityEvents.entityId, otherIds));
    await db.update(schema.storyEntities)
      .set({ attributes: { ...attrs, aliases } })
      .where(eq(schema.storyEntities.id, survivor.id));
    await db.delete(schema.storyEntities).where(inArray(schema.storyEntities.id, otherIds));

    res.json({ merged: otherIds.length, survivorId: survivor.id, aliases });
  } catch (error) {
    console.error('Error merging entities:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/bible/:projectId/semantic-duplicates — дубли ПО СМЫСЛУ (эмбеддинги) ──
// Лексический детектор (StoryBiblePanel) ловит варианты написания (Ласэн/Ласён). Этот —
// семантические дубли с РАЗНЫМИ именами («Король» ↔ «Король Сонного королевства»): эмбеддит
// имя+описание и сравнивает косинусом внутри типа. Локальный Ollama → без API-токенов.
function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ── POST /api/bible/:projectId/semantic-search — линза «Эхо»: поиск по смыслу ──
// Эмбеддит запрос локально (Ollama), косинус по чанкам книги, отдаёт фрагменты с главой.
// Без API-токенов. НЕ под aiQuota (это локальный эмбеддинг, не интерактивный AI-вызов).
router.post('/:projectId/semantic-search', authenticateToken, async (req: any, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid project ID' });
    if (!(await assertProjectOwnership(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });

    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!query) return res.json({ results: [] });
    const topK = Math.min(30, Math.max(1, Number(req.body?.topK) || 12));

    // scope:'series' — искать по всем книгам серии (Эхо · Вся серия). Иначе — по текущей книге.
    if (req.body?.scope === 'series') {
      const [proj] = await db.select({ seriesId: schema.projects.seriesId }).from(schema.projects)
        .where(eq(schema.projects.id, projectId));
      if (proj?.seriesId) {
        const results = await searchSeriesPassages(proj.seriesId, query, topK);
        return res.json({ results, scope: 'series' });
      }
    }
    const results = await searchBookPassages(projectId, query, topK);
    res.json({ results, scope: 'book' });
  } catch (error) {
    console.error('Error in semantic-search:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/semantic-duplicates', authenticateToken, async (req: any, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid project ID' });
    if (!(await assertProjectOwnership(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });

    const embedder = getEmbeddingProvider();
    if (!embedder) return res.json({ pairs: [], note: 'embeddings not configured' });

    const threshold = Math.min(0.99, Math.max(0.7, Number(req.body?.threshold) || 0.85));
    const typeFilter = typeof req.body?.type === 'string' ? req.body.type : null;

    // Кэшированные эмбеддинги: пересчитываются только изменившиеся карточки (см.
    // refreshEntityEmbeddings) — первый клик прогревает, дальше мгновенно.
    const refreshed = await refreshEntityEmbeddings(projectId);
    const vecs = (typeFilter ? refreshed.filter(e => e.type === typeFilter) : refreshed)
      .map(e => ({ id: e.id, name: e.name, type: e.type, v: e.embedding }));

    const pairs: any[] = [];
    for (let i = 0; i < vecs.length; i++) {
      for (let j = i + 1; j < vecs.length; j++) {
        if (vecs[i].type !== vecs[j].type) continue;
        if (vecs[i].name.trim().toLowerCase() === vecs[j].name.trim().toLowerCase()) continue; // точные имена — лексический детектор/merge-by-name
        const sim = cosineSim(vecs[i].v, vecs[j].v);
        if (sim >= threshold) pairs.push({
          type: vecs[i].type,
          similarity: Math.round(sim * 1000) / 1000,
          a: { id: vecs[i].id, name: vecs[i].name },
          b: { id: vecs[j].id, name: vecs[j].name },
        });
      }
    }
    pairs.sort((x, y) => y.similarity - x.similarity);
    res.json({ pairs: pairs.slice(0, 50), embedded: vecs.length, total: vecs.length });
  } catch (error) {
    console.error('Error finding semantic duplicates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/bible/:projectId/suggested-links — «вероятные связи по смыслу» ──
// Пары approved-сущностей, близкие по эмбеддингу карточки (роль/описание), у которых
// связь ЕЩЁ не отмечена. Это подсказка «между ними, возможно, есть отношение» — не
// гарантия. Исключаем: уже связанные пары, точные совпадения имён (это дедуп, не связь),
// и почти-идентичные (>0.9 — вероятный дубль). Эмбеддинги из кэша (refreshEntityEmbeddings).
router.post('/:projectId/suggested-links', authenticateToken, async (req: any, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid project ID' });
    if (!(await assertProjectOwnership(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });

    const threshold = Math.min(0.9, Math.max(0.45, Number(req.body?.threshold) || 0.58));
    const vecs = await refreshEntityEmbeddings(projectId);
    if (vecs.length < 2) return res.json({ pairs: [], note: 'недостаточно эмбеддингов' });

    // уже существующие связи (в обе стороны) — ключ "id<id"
    const linkRows = await db
      .select({ s: schema.entityLinks.sourceEntityId, t: schema.entityLinks.targetEntityId })
      .from(schema.entityLinks)
      .where(eq(schema.entityLinks.projectId, projectId));
    const linked = new Set(linkRows.map(l => [l.s, l.t].sort().join('<')));

    const byId = new Map(vecs.map(v => [v.id, v]));
    const pairs: any[] = [];
    for (let i = 0; i < vecs.length; i++) {
      for (let j = i + 1; j < vecs.length; j++) {
        const a = vecs[i], b = vecs[j];
        if (linked.has([a.id, b.id].sort().join('<'))) continue;       // связь уже есть
        if (a.name.trim().toLowerCase() === b.name.trim().toLowerCase()) continue; // одно имя → дедуп
        const sim = cosineSim(a.embedding, b.embedding);
        if (sim >= threshold && sim < 0.9) {
          pairs.push({
            similarity: Math.round(sim * 1000) / 1000,
            a: { id: a.id, name: a.name, type: a.type },
            b: { id: b.id, name: b.name, type: b.type },
          });
        }
      }
    }
    pairs.sort((x, y) => y.similarity - x.similarity);
    res.json({ pairs: pairs.slice(0, 25), considered: vecs.length });
  } catch (error) {
    console.error('Error suggesting links:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/bible/:projectId/links — создать связь (подтверждение вероятной) ──
router.post('/:projectId/links', authenticateToken, async (req: any, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid project ID' });
    if (!(await assertProjectOwnership(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });

    const { sourceEntityId, targetEntityId } = req.body ?? {};
    const relation = (typeof req.body?.relation === 'string' && req.body.relation.trim())
      ? req.body.relation.trim().slice(0, 80) : 'связан с';
    if (!isValidUUID(sourceEntityId) || !isValidUUID(targetEntityId) || sourceEntityId === targetEntityId)
      return res.status(400).json({ error: 'Valid distinct sourceEntityId/targetEntityId required' });

    // обе сущности принадлежат проекту
    const ents = await db.select({ id: schema.storyEntities.id })
      .from(schema.storyEntities)
      .where(and(eq(schema.storyEntities.projectId, projectId),
        inArray(schema.storyEntities.id, [sourceEntityId, targetEntityId])));
    if (ents.length !== 2) return res.status(400).json({ error: 'Entities not in project' });

    const [link] = await db.insert(schema.entityLinks)
      .values({ projectId, sourceEntityId, targetEntityId, relation })
      .returning();
    res.json({ link });
  } catch (error) {
    console.error('Error creating entity link:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/bible/links/:linkId — remove a wrong connection ──────────────

router.delete('/links/:linkId', authenticateToken, async (req: any, res) => {
  try {
    const { linkId } = req.params;
    if (!isValidUUID(linkId)) return res.status(400).json({ error: 'Invalid link ID' });

    const rows = await db
      .select({ id: schema.entityLinks.id })
      .from(schema.entityLinks)
      .innerJoin(schema.projects, eq(schema.entityLinks.projectId, schema.projects.id))
      .where(and(eq(schema.entityLinks.id, linkId), eq(schema.projects.userId, req.user.userId)));

    if (!rows.length) return res.status(403).json({ error: 'Not found or access denied' });

    await db.delete(schema.entityLinks).where(eq(schema.entityLinks.id, linkId));
    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting entity link:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/bible/events/:eventId — remove a wrong timeline event ────────

router.delete('/events/:eventId', authenticateToken, async (req: any, res) => {
  try {
    const { eventId } = req.params;
    if (!isValidUUID(eventId)) return res.status(400).json({ error: 'Invalid event ID' });

    const rows = await db
      .select({ id: schema.entityEvents.id })
      .from(schema.entityEvents)
      .innerJoin(schema.projects, eq(schema.entityEvents.projectId, schema.projects.id))
      .where(and(eq(schema.entityEvents.id, eventId), eq(schema.projects.userId, req.user.userId)));

    if (!rows.length) return res.status(403).json({ error: 'Not found or access denied' });

    await db.delete(schema.entityEvents).where(eq(schema.entityEvents.id, eventId));
    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting entity event:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/bible/:entityId/approve ───────────────────────────────────────

router.patch('/:entityId/approve', authenticateToken, async (req: any, res) => {
  try {
    const { entityId } = req.params;
    if (!isValidUUID(entityId)) return res.json({ ok: true, demo: true });

    const isOwner = await assertEntityOwnership(entityId, req.user.userId);
    if (!isOwner) return res.status(403).json({ error: 'Access denied' });

    const updated = await db
      .update(schema.storyEntities)
      .set({ status: 'approved' })
      .where(eq(schema.storyEntities.id, entityId))
      .returning();

    if (!updated.length) return res.status(404).json({ error: 'Entity not found' });
    res.json({ entity: updated[0] });
  } catch (error) {
    console.error('Error approving entity:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/bible/:entityId/reject ────────────────────────────────────────

router.patch('/:entityId/reject', authenticateToken, async (req: any, res) => {
  try {
    const { entityId } = req.params;
    if (!isValidUUID(entityId)) return res.json({ ok: true, demo: true });

    const isOwner = await assertEntityOwnership(entityId, req.user.userId);
    if (!isOwner) return res.status(403).json({ error: 'Access denied' });

    const updated = await db
      .update(schema.storyEntities)
      .set({ status: 'rejected' })
      .where(eq(schema.storyEntities.id, entityId))
      .returning();

    if (!updated.length) return res.status(404).json({ error: 'Entity not found' });
    res.json({ entity: updated[0] });
  } catch (error) {
    console.error('Error rejecting entity:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/bible/:projectId/suggestions/:id/merge-into — «это тот же X» ─────
// Находка-вариант (опечатка/склонение) → объединить с существующей сущностью: имя находки
// (и её алиасы) уходят в алиасы цели, связи/события переносятся, находка удаляется.
// Рукопись НЕ трогаем — это слияние КАРТОЧЕК, не правка текста.
router.post('/:projectId/suggestions/:id/merge-into', authenticateToken, async (req: any, res) => {
  try {
    const { projectId, id } = req.params;
    const { targetId } = req.body ?? {};
    if (!isValidUUID(projectId) || !isValidUUID(id) || !isValidUUID(targetId) || id === targetId)
      return res.status(400).json({ error: 'Valid distinct ids required' });
    if (!(await assertProjectOwnership(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });

    const rows = await db.select().from(schema.storyEntities)
      .where(and(eq(schema.storyEntities.projectId, projectId), inArray(schema.storyEntities.id, [id, targetId])));
    const sug = rows.find(r => r.id === id), target = rows.find(r => r.id === targetId);
    if (!sug || !target) return res.status(404).json({ error: 'Not found in project' });

    // имя находки + её алиасы → в алиасы цели (без дублей, не считая само имя цели)
    const tAttrs = (target.attributes ?? {}) as Record<string, unknown>;
    const curAliases = Array.isArray(tAttrs.aliases) ? (tAttrs.aliases as string[]) : [];
    const sAttrs = (sug.attributes ?? {}) as Record<string, unknown>;
    const incoming = [sug.name, ...(Array.isArray(sAttrs.aliases) ? (sAttrs.aliases as string[]) : [])];
    const merged = [...curAliases];
    for (const a of incoming) {
      const t = (a ?? '').trim();
      if (t && t.toLowerCase() !== target.name.trim().toLowerCase()
          && !merged.some(x => x.trim().toLowerCase() === t.toLowerCase())) merged.push(t);
    }
    await db.update(schema.storyEntities)
      .set({ attributes: { ...tAttrs, aliases: merged }, embedding: null, embeddingText: null })
      .where(eq(schema.storyEntities.id, targetId));

    // перенос связей/событий находки на цель (на случай если успели привязаться)
    await db.update(schema.entityLinks).set({ sourceEntityId: targetId }).where(eq(schema.entityLinks.sourceEntityId, id));
    await db.update(schema.entityLinks).set({ targetEntityId: targetId }).where(eq(schema.entityLinks.targetEntityId, id));
    await db.update(schema.entityEvents).set({ entityId: targetId }).where(eq(schema.entityEvents.entityId, id));

    await db.delete(schema.storyEntities).where(eq(schema.storyEntities.id, id));
    res.json({ ok: true, target: { id: target.id, name: target.name } });
  } catch (error) {
    console.error('Error merging suggestion:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Contradiction report (PRD P1.2, full-book) ────────────────────────────────

/** Отчёт «завис» — running, но не двигался дольше этого срока (воркер умер/таймаут). */
const REPORT_STALE_MS = 15 * 60 * 1000;

// POST /api/bible/:projectId/contradictions/scan — запустить проверку всей книги
router.post('/:projectId/contradictions/scan',
  authenticateToken,
  rateLimit('bible:contradictions', 6, 60 * 60 * 1000),
  aiQuota,
  async (req: any, res) => {
    try {
      if (!ai) return res.status(503).json({ error: 'AI is not configured' });
      const { projectId } = req.params;
      if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid project ID' });

      const isOwner = await assertProjectOwnership(projectId, req.user.userId);
      if (!isOwner) return res.status(403).json({ error: 'Access denied' });

      // Не запускать второй прогон, пока идёт живой первый
      const running = await db
        .select({ id: schema.contradictionReports.id, updatedAt: schema.contradictionReports.updatedAt })
        .from(schema.contradictionReports)
        .where(and(
          eq(schema.contradictionReports.projectId, projectId),
          eq(schema.contradictionReports.status, 'running'),
        ));
      const liveRunning = running.find(r => Date.now() - new Date(r.updatedAt).getTime() < REPORT_STALE_MS);
      if (liveRunning) {
        return res.status(409).json({ error: 'Проверка уже идёт', reportId: liveRunning.id });
      }

      const [report] = await db.insert(schema.contradictionReports).values({
        projectId, status: 'running', totalChapters: 0, scannedChapters: 0,
      }).returning();

      await enqueueJob('scan_contradictions', { reportId: report.id }, {
        projectId, userId: req.user.userId, maxAttempts: 2,
      });

      res.json({ reportId: report.id, status: 'running' });
    } catch (error) {
      console.error('Error starting contradiction scan:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── POST /:projectId/contradictions/scan-chapter — проактивная пер-главная проверка ──
// Тихо обновляет отчёт после «Прочитать»: проверяет ОДНУ главу против Мира и заменяет
// её противоречия в последнем отчёте (создаёт отчёт, если его ещё нет). Дёшево — 1 глава.
const VALID_SEV = new Set(['low', 'medium', 'high']);
router.post('/:projectId/contradictions/scan-chapter',
  authenticateToken, rateLimit('ai:scan-chapter', 60, 60 * 60 * 1000), aiQuota,
  async (req: any, res) => {
  try {
    if (!ai) return res.status(503).json({ error: 'AI service is not configured' });
    const { projectId } = req.params;
    const { chapterId } = req.body ?? {};
    if (!isValidUUID(projectId) || !isValidUUID(chapterId)) return res.status(400).json({ error: 'Invalid id' });
    if (!(await assertProjectOwnership(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });

    const [chapter] = await db.select().from(schema.chapters)
      .where(and(eq(schema.chapters.id, chapterId), eq(schema.chapters.projectId, projectId)));
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

    const entities = await db.select().from(schema.storyEntities)
      .where(and(eq(schema.storyEntities.projectId, projectId), eq(schema.storyEntities.status, 'approved')));
    if (entities.length === 0) return res.json({ issues: [] }); // нечего сверять

    const plainText = stripHtml(chapter.content ?? '');
    if (plainText.split(/\s+/).filter(Boolean).length < 50) return res.json({ issues: [] });

    const links = await db.select().from(schema.entityLinks).where(eq(schema.entityLinks.projectId, projectId));
    const storyBible = buildStoryBibleContext(entities, links);
    // RAG: подтягиваем близкие по смыслу места из ДРУГИХ глав (синопсис как запрос, иначе текст).
    const related = await retrieveCrossChapterPassages(projectId, chapterId, chapter.summary || plainText, 6);
    const prompt = buildContradictionPrompt(storyBible, chapter.title, plainText.slice(0, 12000), related);

    const response = await guardChat(
      () => ai.generate({ contents: prompt, temperature: 0.1 }),
      { userId: req.user.userId, projectId, route: 'report:contradictions-chapter' },
    );
    let parsed: any[] = [];
    try { const p = JSON.parse(cleanJsonResponse(response.text ?? '[]')); if (Array.isArray(p)) parsed = p; } catch { /* кривой JSON — считаем «без противоречий» */ }

    // Последний отчёт или новый.
    let [report] = await db.select().from(schema.contradictionReports)
      .where(eq(schema.contradictionReports.projectId, projectId))
      .orderBy(desc(schema.contradictionReports.createdAt)).limit(1);
    if (!report) {
      [report] = await db.insert(schema.contradictionReports)
        .values({ projectId, status: 'done', totalChapters: 0, scannedChapters: 0 }).returning();
    }

    // Заменяем противоречия именно этой главы (остальные не трогаем).
    await db.delete(schema.contradictionIssues)
      .where(and(eq(schema.contradictionIssues.reportId, report.id), eq(schema.contradictionIssues.chapterId, chapterId)));

    const rows = parsed
      .filter(it => it && typeof it.issue === 'string' && it.issue.trim())
      .map(it => ({
        reportId: report.id, projectId, chapterId, chapterTitle: chapter.title,
        entityName: (typeof it.entity === 'string' ? it.entity : '').slice(0, 200) || null,
        issue: (it.issue.trim() + (typeof it.canon === 'string' && it.canon.trim() ? ` · Канон: ${it.canon.trim()}` : '')).slice(0, 1000),
        quote: (typeof it.quote === 'string' ? it.quote.trim().slice(0, 300) : '') || null,
        severity: VALID_SEV.has(it.severity) ? it.severity : 'medium',
        status: 'open' as const,
      }));
    if (rows.length > 0) await db.insert(schema.contradictionIssues).values(rows);
    await db.update(schema.contradictionReports).set({ updatedAt: new Date() }).where(eq(schema.contradictionReports.id, report.id));

    res.json({ issues: rows.length });
  } catch (error) {
    console.error('Error scanning chapter for contradictions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/bible/:projectId/contradictions — последний отчёт + открытые противоречия
router.get('/:projectId/contradictions', authenticateToken, async (req: any, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid project ID' });

    const isOwner = await assertProjectOwnership(projectId, req.user.userId);
    if (!isOwner) return res.status(403).json({ error: 'Access denied' });

    const reports = await db
      .select()
      .from(schema.contradictionReports)
      .where(eq(schema.contradictionReports.projectId, projectId))
      .orderBy(desc(schema.contradictionReports.createdAt))
      .limit(1);

    if (reports.length === 0) return res.json({ report: null, issues: [] });

    let report = reports[0];

    // Подстраховка: подвисший running переводим в failed, чтобы UI не крутил вечно
    if (report.status === 'running' && Date.now() - new Date(report.updatedAt).getTime() > REPORT_STALE_MS) {
      const [updated] = await db.update(schema.contradictionReports)
        .set({ status: 'failed', error: 'Проверка прервалась — попробуйте запустить заново.', updatedAt: new Date() })
        .where(eq(schema.contradictionReports.id, report.id))
        .returning();
      report = updated;
    }

    const issues = await db
      .select()
      .from(schema.contradictionIssues)
      .where(and(
        eq(schema.contradictionIssues.reportId, report.id),
        eq(schema.contradictionIssues.status, 'open'),
      ))
      .orderBy(desc(schema.contradictionIssues.createdAt));

    res.json({ report, issues });
  } catch (error) {
    console.error('Error fetching contradiction report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/bible/contradictions/:issueId/dismiss — отклонить ложное срабатывание
router.post('/contradictions/:issueId/dismiss', authenticateToken, async (req: any, res) => {
  try {
    const { issueId } = req.params;
    if (!isValidUUID(issueId)) return res.status(400).json({ error: 'Invalid issue ID' });

    const rows = await db
      .select({ userId: schema.projects.userId })
      .from(schema.contradictionIssues)
      .innerJoin(schema.projects, eq(schema.contradictionIssues.projectId, schema.projects.id))
      .where(eq(schema.contradictionIssues.id, issueId));

    if (!rows.length || rows[0].userId !== req.user.userId) {
      return res.status(403).json({ error: 'Not found or access denied' });
    }

    await db.update(schema.contradictionIssues)
      .set({ status: 'dismissed' })
      .where(eq(schema.contradictionIssues.id, issueId));

    res.json({ ok: true });
  } catch (error) {
    console.error('Error dismissing contradiction:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
