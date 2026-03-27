import express from 'express';
import { eq, and, ne } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';
import * as schema from '../db/schema.js';
import { db } from '../db/client.js';
import { authenticateToken } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimiter.js';
import { guardChat } from '../lib/aiGuard.js';

const router = express.Router();

let aiClient: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

// ── helpers ──────────────────────────────────────────────────────────────────

const isValidUUID = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

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

/** Strip HTML tags and collapse whitespace to get searchable plain text. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Canonical normalisation shared by diff-check and dedupe key. */
function normalizeDesc(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** True if two descriptions carry different information (ignoring whitespace). */
function descriptionsDiffer(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeDesc(a) !== normalizeDesc(b);
}

/**
 * Extract a plain-text excerpt (≈contextChars either side) around the first
 * occurrence of entityName.  Used as the `sourceExcerpt` stored with each
 * update suggestion and later as the jump-to-match fingerprint in the editor.
 */
/**
 * Extract a plain-text excerpt (≈contextChars either side) around the first
 * occurrence of entityName.  Used as the `sourceExcerpt` stored with each
 * update suggestion and later as the jump-to-match fingerprint in the editor.
 *
 * No ellipsis decoration — the fingerprint must be a verbatim substring of the
 * chapter text so that jumpToMatch's indexOf pass can locate it.
 */
function extractEntitySnippet(plainText: string, entityName: string, contextChars = 60): string {
  const idx = plainText.toLowerCase().indexOf(entityName.toLowerCase());
  if (idx === -1) return entityName;
  const start = Math.max(0, idx - contextChars);
  const end   = Math.min(plainText.length, idx + entityName.length + contextChars);
  return plainText.slice(start, end).trim();
}

// ── AI prompts ────────────────────────────────────────────────────────────────

const BASE_EXTRACTION_PROMPT = `Ты — литературный аналитик. Проанализируй данный текст главы и извлеки из него все упоминаемые сущности.

Категории:
- character: персонаж (имя, внешность, роль)
- location: место действия (название, описание)
- item: значимый предмет (название, свойства)
- rule: правило мира / магическая система / закон вселенной

ВАЖНО:
- Извлекай только конкретные, именованные сущности из текста.
- Описание должно быть коротким (1-2 предложения), основанным ТОЛЬКО на том, что сказано в тексте.
- Не придумывай ничего от себя.
- Верни ТОЛЬКО валидный JSON-массив без markdown-обёртки.

Формат ответа (строго JSON-объект):
{
  "entities": [
    {"type": "character", "name": "Имя", "description": "Краткое описание из текста"},
    {"type": "location", "name": "Название", "description": "Краткое описание из текста"}
  ],
  "chapterSummary": "Краткое рабочее название главы (2-3 слова)"
}

Если в тексте нет явных сущностей — верни пустой массив в поле "entities" и подходящий "chapterSummary".`;

/** For recheck: tell the AI about already-approved entities so it can propose updated descriptions. */
function buildRecheckPrompt(approvedEntities: { name: string; type: string; description: string | null }[]): string {
  if (approvedEntities.length === 0) return BASE_EXTRACTION_PROMPT;

  const list = approvedEntities
    .map(e => `- ${e.name} (${e.type}): ${e.description ?? '—'}`)
    .join('\n');

  return `Ты — литературный аналитик. Проанализируй данный текст главы.

В проекте уже одобрены следующие сущности:
${list}

Задача:
1. Для уже известных сущностей — верни их с обновлённым описанием, если глава содержит новые детали. Если новых деталей нет — можешь пропустить или вернуть с тем же описанием.
2. Для новых сущностей (которых нет в списке выше) — создай стандартную запись.

Категории:
- character: персонаж (имя, внешность, роль)
- location: место действия (название, описание)
- item: значимый предмет (название, свойства)
- rule: правило мира / магическая система / закон вселенной

ВАЖНО:
- Описание должно быть коротким (1-2 предложения), основанным ТОЛЬКО на том, что сказано в тексте.
- Не придумывай ничего от себя.
- Верни ТОЛЬКО валидный JSON-массив без markdown-обёртки.

Формат ответа (строго JSON-объект):
{
  "entities": [
    {"type": "character", "name": "Имя", "description": "..."},
    ...
  ],
  "chapterSummary": "Краткое рабочее название главы (2-3 слова)"
}

Если в тексте нет явных сущностей — верни пустой массив в поле "entities".`;
}

// ── shared: process AI extraction results ────────────────────────────────────

interface AiEntity { type: string; name: string; description: string }

interface ProcessResult {
  newSuggestions: (typeof schema.storyEntities.$inferSelect)[];
  updateSuggestions: (typeof schema.bibleUpdateSuggestions.$inferSelect)[];
}

/**
 * Given the AI-extracted entity list for a chapter, persist new/updated facts
 * while avoiding duplicates and respecting previous reviewer decisions.
 *
 * Per entity that matches an approved entry (same name, different description):
 *
 *   existing pending  with same normalised proposal  → skip  (already queued)
 *   existing dismissed with same normalised proposal → reopen (author said "not now", ok to surface again)
 *   existing rejected  with same normalised proposal → skip  (author said "wrong", respect that)
 *   no matching suggestion                           → insert new
 *
 * Entities not yet in the project are inserted as pending story_entities.
 * Entities with the same description as the canonical entry are skipped silently.
 */
async function processExtractionResults(
  entities: AiEntity[],
  projectId: string,
  chapterId: string | null,
  chapterTitle: string | null,
  /** Stripped plain text of the chapter — used to build sourceExcerpt snippets. */
  plainText: string | null,
): Promise<ProcessResult> {
  // Fetch all approved entities once
  const approved = await db
    .select({
      id: schema.storyEntities.id,
      name: schema.storyEntities.name,
      description: schema.storyEntities.description,
    })
    .from(schema.storyEntities)
    .where(and(
      eq(schema.storyEntities.projectId, projectId),
      eq(schema.storyEntities.status, 'approved'),
    ));

  const approvedMap = new Map(approved.map(e => [e.name.toLowerCase(), e]));

  const newSuggestions: (typeof schema.storyEntities.$inferSelect)[] = [];
  const updateSuggestions: (typeof schema.bibleUpdateSuggestions.$inferSelect)[] = [];
  const safeChapterId = (chapterId && isValidUUID(chapterId)) ? chapterId : null;

  for (const entity of entities) {
    const key = entity.name.toLowerCase();
    const existing = approvedMap.get(key);

    if (!existing) {
      // Brand-new entity — insert as pending story_entity
      const [inserted] = await db.insert(schema.storyEntities).values({
        projectId,
        chapterId: safeChapterId,
        type: entity.type,
        name: entity.name,
        description: entity.description || '',
        status: 'pending',
      }).returning();
      newSuggestions.push(inserted);
      continue;
    }

    if (!descriptionsDiffer(existing.description, entity.description)) {
      // Description unchanged — nothing to suggest
      continue;
    }

    // Known entity with different description: apply dedupe / reopen logic
    const normalizedProposal = normalizeDesc(entity.description);

    // Fetch ALL prior suggestions for this entity (any status) so we can match by proposal
    const priorSuggestions = await db
      .select({
        id:                  schema.bibleUpdateSuggestions.id,
        status:              schema.bibleUpdateSuggestions.status,
        proposedDescription: schema.bibleUpdateSuggestions.proposedDescription,
      })
      .from(schema.bibleUpdateSuggestions)
      .where(eq(schema.bibleUpdateSuggestions.entityId, existing.id));

    // Find the first prior suggestion whose proposal matches (normalised)
    const match = priorSuggestions.find(
      s => normalizeDesc(s.proposedDescription) === normalizedProposal,
    );

    const sourceExcerpt = plainText ? extractEntitySnippet(plainText, entity.name) : null;

    if (!match) {
      // No history for this proposal — create a fresh suggestion
      const [inserted] = await db.insert(schema.bibleUpdateSuggestions).values({
        projectId,
        entityId:            existing.id,
        chapterId:           safeChapterId,
        chapterTitle,
        previousDescription: existing.description,
        proposedDescription: entity.description || '',
        sourceExcerpt,
        reason:              null,
        status:              'pending',
      }).returning();
      updateSuggestions.push(inserted);
    } else if (match.status === 'pending') {
      // Already queued — skip to avoid duplicates
    } else if (match.status === 'dismissed') {
      // Author said "not now" before; surface it again with updated chapter context
      const [reopened] = await db
        .update(schema.bibleUpdateSuggestions)
        .set({
          status:        'pending',
          chapterId:     safeChapterId,
          chapterTitle,
          sourceExcerpt,
          updatedAt:     new Date(),
        })
        .where(eq(schema.bibleUpdateSuggestions.id, match.id))
        .returning();
      updateSuggestions.push(reopened);
    } else if (match.status === 'rejected') {
      // Author explicitly rejected this proposal — do not reopen
    }
    // 'accepted' → description was already applied; descriptionsDiffer() should return
    // false for the next recheck (canonical desc ≈ proposal), so we won't reach here.
    // Guard here just in case (no action needed).
  }

  return { newSuggestions, updateSuggestions };
}

// ── POST /api/bible/extract ───────────────────────────────────────────────────

router.post('/extract',
  authenticateToken,
  rateLimit('bible:extract', 20, 60 * 60 * 1000),
  async (req: any, res) => {
    try {
      if (!aiClient) return res.status(503).json({ error: 'AI is not configured' });

      const { chapterContent, projectId, chapterId } = req.body;
      if (!chapterContent) return res.status(400).json({ error: 'chapterContent is required' });

      const response = await guardChat(
        () => aiClient!.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `${BASE_EXTRACTION_PROMPT}\n\nТекст главы:\n"""\n${chapterContent}\n"""`,
          config: { temperature: 0.2 },
        }),
        { userId: req.user.userId, projectId: projectId ?? null, route: 'bible:extract' }
      );

      const raw = response.text || '{"entities":[]}';
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      let parsed: { entities: AiEntity[]; chapterSummary?: string };
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        console.error('Failed to parse AI response:', cleaned);
        return res.status(500).json({ error: 'AI returned invalid JSON' });
      }
      
      const entities = Array.isArray(parsed) ? parsed : (parsed.entities || []);

      if (projectId && isValidUUID(projectId)) {
        const isOwner = await assertProjectOwnership(projectId, req.user.userId);
        if (!isOwner) return res.status(403).json({ error: 'Access denied to this project' });

        // Fetch chapter title for update suggestion cards
        let chapterTitle: string | null = null;
        if (chapterId && isValidUUID(chapterId)) {
          const rows = await db
            .select({ title: schema.chapters.title })
            .from(schema.chapters)
            .where(eq(schema.chapters.id, chapterId));
          chapterTitle = rows[0]?.title ?? null;
        }

        // Strip HTML once for use as both the AI input (already stripped upstream by client)
        // and the excerpt source.  chapterContent from TipTap may be HTML.
        const plainTextForExcerpt = stripHtml(chapterContent);

        const { newSuggestions, updateSuggestions } = await processExtractionResults(
          entities, projectId, chapterId ?? null, chapterTitle, plainTextForExcerpt,
        );

        // Update lastExtractedAt, and populate chapter summary if title is default
        if (chapterId && isValidUUID(chapterId)) {
          try {
            const updatePayload: any = { lastExtractedAt: new Date() };
            if (
              parsed.chapterSummary && 
              chapterTitle && 
              /^Глава \d+$/.test(chapterTitle.trim())
            ) {
              updatePayload.title = parsed.chapterSummary.substring(0, 100);
            }
            await db.update(schema.chapters)
              .set(updatePayload)
              .where(eq(schema.chapters.id, chapterId));
          } catch (e) {
            console.warn('[bible:extract] Failed to update chapter:', e);
          }
        }

        return res.json({
          entities: newSuggestions,
          updates: updateSuggestions,
          total: newSuggestions.length + updateSuggestions.length,
          chapterSummary: parsed.chapterSummary,
        });
      }

      // Demo mode
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

router.post('/recheck/chapter/:chapterId',
  authenticateToken,
  rateLimit('bible:extract', 20, 60 * 60 * 1000),
  async (req: any, res) => {
    try {
      if (!aiClient) return res.status(503).json({ error: 'AI is not configured' });

      const { chapterId } = req.params;
      if (!isValidUUID(chapterId)) return res.status(400).json({ error: 'Invalid chapterId' });

      const chapterRows = await db
        .select({
          content: schema.chapters.content,
          title: schema.chapters.title,
          projectId: schema.chapters.projectId,
        })
        .from(schema.chapters)
        .innerJoin(schema.projects, eq(schema.chapters.projectId, schema.projects.id))
        .where(and(eq(schema.chapters.id, chapterId), eq(schema.projects.userId, req.user.userId)));

      if (!chapterRows.length) return res.status(403).json({ error: 'Chapter not found or access denied' });

      const { content, title: chapterTitle, projectId } = chapterRows[0];

      const plainText = (content ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

      if (!plainText) return res.json({ entities: [], updates: [], total: 0, note: 'Chapter is empty' });

      // Fetch approved entities to give the AI context for update detection
      const approvedEntities = await db
        .select({
          id: schema.storyEntities.id,
          name: schema.storyEntities.name,
          type: schema.storyEntities.type,
          description: schema.storyEntities.description,
        })
        .from(schema.storyEntities)
        .where(and(
          eq(schema.storyEntities.projectId, projectId),
          eq(schema.storyEntities.status, 'approved'),
        ));

      const recheckPrompt = buildRecheckPrompt(approvedEntities);

      const response = await guardChat(
        () => aiClient!.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `${recheckPrompt}\n\nТекст главы:\n"""\n${plainText}\n"""`,
          config: { temperature: 0.2 },
        }),
        { userId: req.user.userId, projectId, route: 'bible:extract' }
      );

      const raw = response.text || '{"entities":[]}';
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      let parsed: { entities: AiEntity[]; chapterSummary?: string };
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        return res.status(500).json({ error: 'AI returned invalid JSON' });
      }
      const entities = Array.isArray(parsed) ? parsed : (parsed.entities || []);

      const { newSuggestions, updateSuggestions } = await processExtractionResults(
        entities, projectId, chapterId, chapterTitle, plainText,
      );

      // Update lastExtractedAt, and populate chapter summary if title is default
      try {
        const updatePayload: any = { lastExtractedAt: new Date() };
        if (
          parsed.chapterSummary && 
          chapterTitle && 
          /^Глава \d+$/.test(chapterTitle.trim())
        ) {
          updatePayload.title = parsed.chapterSummary.substring(0, 100);
        }
        await db.update(schema.chapters)
          .set(updatePayload)
          .where(eq(schema.chapters.id, chapterId));
      } catch (e) {
        console.warn('[bible:recheck] Failed to update chapter:', e);
      }

      res.json({
        entities: newSuggestions,
        updates: updateSuggestions,
        total: newSuggestions.length + updateSuggestions.length,
        chapterSummary: parsed.chapterSummary,
      });
    } catch (error) {
      console.error('Error in POST /bible/recheck/chapter:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── POST /api/bible/updates/bulk-dismiss ─────────────────────────────────────
// Dismiss all pending update suggestions for a chapter in one operation.

router.post('/updates/bulk-dismiss', authenticateToken, async (req: any, res) => {
  try {
    const { projectId, chapterId } = req.body;
    if (!isValidUUID(projectId))  return res.status(400).json({ error: 'Invalid projectId' });
    if (!isValidUUID(chapterId))  return res.status(400).json({ error: 'Invalid chapterId' });

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
// Reject all pending update suggestions for a chapter in one operation.

router.post('/updates/bulk-reject', authenticateToken, async (req: any, res) => {
  try {
    const { projectId, chapterId } = req.body;
    if (!isValidUUID(projectId))  return res.status(400).json({ error: 'Invalid projectId' });
    if (!isValidUUID(chapterId))  return res.status(400).json({ error: 'Invalid chapterId' });

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
      .select({
        update: schema.bibleUpdateSuggestions,
        userId: schema.projects.userId,
      })
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

    // Apply proposed description to the canonical approved entity
    await db
      .update(schema.storyEntities)
      .set({ description: update.proposedDescription })
      .where(eq(schema.storyEntities.id, update.entityId));

    // Mark this suggestion as accepted
    const [accepted] = await db
      .update(schema.bibleUpdateSuggestions)
      .set({ status: 'accepted', updatedAt: new Date() })
      .where(eq(schema.bibleUpdateSuggestions.id, updateId))
      .returning();

    // Dismiss sibling pending suggestions for the same entity that propose the
    // same description — they're now redundant because the canonical entry was
    // just updated.  Pending suggestions with a *different* proposal remain
    // visible: the author may still want to review them.
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

// ── POST /api/bible/updates/:updateId/reject ──────────────────────────────────

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

// ── GET /api/bible/:projectId — list entities for a project ──────────────────

router.get('/:projectId', authenticateToken, async (req: any, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid project ID' });

    const isOwner = await assertProjectOwnership(projectId, req.user.userId);
    if (!isOwner) return res.status(403).json({ error: 'Access denied to this project' });

    const entities = await db
      .select()
      .from(schema.storyEntities)
      .where(eq(schema.storyEntities.projectId, projectId));

    res.json({ entities });
  } catch (error) {
    console.error('Error fetching entities:', error);
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

export default router;
