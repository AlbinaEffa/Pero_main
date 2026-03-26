import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { eq, and } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';
import * as schema from '../db/schema.js';
import { pool, db } from '../db/client.js';
import { authenticateToken } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimiter.js';
import { guardChat } from '../lib/aiGuard.js';

const router = express.Router();

let aiClient: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

const isValidUUID = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function embedQuery(text: string): Promise<number[] | null> {
  if (!aiClient) return null;
  try {
    const result = await (aiClient.models as any).embedContent({
      model: 'text-embedding-004',
      content: text,
      config: { taskType: 'RETRIEVAL_QUERY' },
    });
    return result.embedding?.values ?? null;
  } catch (e) {
    console.warn('embedQuery failed:', e);
    return null;
  }
}

async function assertProjectOwnership(projectId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)));
  return rows.length > 0;
}

export interface TraceChapter {
  id: string;
  title: string;
  order: number;
  snippets: string[];
}

// ─── POST /api/revision/entity-trace ─────────────────────────────────────────
// Finds which chapters semantically mention the given entity.
// Falls back to story_entities table lookup if pgvector is unavailable.
// Body: { projectId, entityName }
// Returns: { chapters: TraceChapter[], semantic: boolean }

const revisionRateLimit = rateLimit('revision', 20, 60 * 60 * 1000); // 20/hr shared across all revision endpoints

router.post('/entity-trace', authenticateToken, revisionRateLimit, async (req: any, res) => {
  try {
    const { projectId, entityName } = req.body;

    if (!projectId || !isValidUUID(projectId))
      return res.status(400).json({ error: 'Valid projectId is required' });
    if (!entityName?.trim())
      return res.status(400).json({ error: 'entityName is required' });

    const isOwner = await assertProjectOwnership(projectId, req.user.userId);
    if (!isOwner) return res.status(403).json({ error: 'Access denied' });

    // 1. Try semantic search first
    const queryVec = await embedQuery(entityName.trim());

    if (queryVec) {
      try {
        const vecStr = `[${queryVec.join(',')}]`;
        const rows = await pool.query<{
          chunk_text: string;
          chapter_id: string | null;
          chapter_title: string | null;
          chapter_order: number | null;
        }>(
          `SELECT sm.chunk_text, sm.chapter_id,
                  c.title AS chapter_title, c."order" AS chapter_order
             FROM semantic_memory sm
             LEFT JOIN chapters c ON c.id = sm.chapter_id
            WHERE sm.project_id = $1
              AND sm.user_id    = $2
              AND sm.embedding  IS NOT NULL
              AND sm.chapter_id IS NOT NULL
            ORDER BY sm.embedding <=> $3::vector
            LIMIT 25`,
          [projectId, req.user.userId, vecStr]
        );

        // Group by chapter, keep top 2 snippets each, truncate to 200 chars
        const chapterMap = new Map<string, TraceChapter>();
        for (const row of rows.rows) {
          if (!row.chapter_id || !row.chapter_title) continue;
          if (!chapterMap.has(row.chapter_id)) {
            chapterMap.set(row.chapter_id, {
              id: row.chapter_id,
              title: row.chapter_title,
              order: row.chapter_order ?? 0,
              snippets: [],
            });
          }
          const ch = chapterMap.get(row.chapter_id)!;
          if (ch.snippets.length < 2) {
            const snippet = row.chunk_text.slice(0, 220).trimEnd();
            ch.snippets.push(snippet.length < row.chunk_text.length ? snippet + '…' : snippet);
          }
        }

        const chapters = Array.from(chapterMap.values()).sort((a, b) => a.order - b.order);
        return res.json({ chapters, semantic: true });
      } catch (e: any) {
        if (!['42P01', '42703', '42883'].includes(e?.code)) {
          console.warn('Semantic entity-trace failed, falling back:', e?.message);
        }
        // Fall through to story_entities fallback
      }
    }

    // 2. Fallback: check story_entities table for linked chapters
    const entityRows = await db
      .select({
        chapterId: schema.storyEntities.chapterId,
        name: schema.storyEntities.name,
      })
      .from(schema.storyEntities)
      .where(
        and(
          eq(schema.storyEntities.projectId, projectId),
          eq(schema.storyEntities.status, 'approved')
        )
      );

    const needle = entityName.trim().toLowerCase();
    const linkedChapterIds = [
      ...new Set(
        entityRows
          .filter(e => e.name.toLowerCase().includes(needle) || needle.includes(e.name.toLowerCase()))
          .map(e => e.chapterId)
          .filter(Boolean) as string[]
      ),
    ];

    if (linkedChapterIds.length === 0) {
      return res.json({ chapters: [], semantic: false });
    }

    const allChapters = await db
      .select({ id: schema.chapters.id, title: schema.chapters.title, order: schema.chapters.order })
      .from(schema.chapters)
      .where(eq(schema.chapters.projectId, projectId));

    const chapters: TraceChapter[] = allChapters
      .filter(c => linkedChapterIds.includes(c.id))
      .sort((a, b) => a.order - b.order)
      .map(c => ({ id: c.id, title: c.title, order: c.order, snippets: [] }));

    res.json({ chapters, semantic: false });
  } catch (error) {
    console.error('Error in POST /revision/entity-trace:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/revision/entity-arc ───────────────────────────────────────────
// Asks AI to trace how an entity evolves across the story using semantic chunks.
// Body: { projectId, entityName }
// Returns: { arc: string, mentions: number }

router.post('/entity-arc', authenticateToken, revisionRateLimit, async (req: any, res) => {
  try {
    if (!aiClient) return res.status(503).json({ error: 'AI not configured' });

    const { projectId, entityName } = req.body;

    if (!projectId || !isValidUUID(projectId))
      return res.status(400).json({ error: 'Valid projectId is required' });
    if (!entityName?.trim())
      return res.status(400).json({ error: 'entityName is required' });

    const isOwner = await assertProjectOwnership(projectId, req.user.userId);
    if (!isOwner) return res.status(403).json({ error: 'Access denied' });

    // Retrieve semantically relevant chunks for this entity
    let mentionChunks: { text: string; chapterTitle: string; order: number }[] = [];

    const queryVec = await embedQuery(entityName.trim());
    if (queryVec) {
      try {
        const vecStr = `[${queryVec.join(',')}]`;
        const rows = await pool.query<{
          chunk_text: string;
          chapter_title: string | null;
          chapter_order: number | null;
        }>(
          `SELECT sm.chunk_text, c.title AS chapter_title, c."order" AS chapter_order
             FROM semantic_memory sm
             LEFT JOIN chapters c ON c.id = sm.chapter_id
            WHERE sm.project_id = $1
              AND sm.user_id    = $2
              AND sm.embedding  IS NOT NULL
              AND sm.chapter_id IS NOT NULL
            ORDER BY sm.embedding <=> $3::vector
            LIMIT 15`,
          [projectId, req.user.userId, vecStr]
        );

        // Sort by chapter order (chronological)
        mentionChunks = rows.rows
          .filter(r => r.chapter_title)
          .map(r => ({
            text: r.chunk_text,
            chapterTitle: r.chapter_title!,
            order: r.chapter_order ?? 0,
          }))
          .sort((a, b) => a.order - b.order);
      } catch (e: any) {
        if (!['42P01', '42703', '42883'].includes(e?.code)) {
          console.warn('Semantic arc retrieval failed:', e?.message);
        }
      }
    }

    if (mentionChunks.length === 0) {
      return res.json({
        arc: 'Не найдено достаточно упоминаний для построения арки. Убедитесь, что главы проиндексированы (откройте их в редакторе).',
        mentions: 0,
      });
    }

    // Build prompt
    const formattedMentions = mentionChunks
      .map((c, i) => `[Глава: ${c.chapterTitle}]\n${c.text}`)
      .join('\n\n---\n\n');

    const prompt = `Ты — литературный аналитик. Проанализируй, как меняется "${entityName}" на протяжении рукописи.

Вот хронологические фрагменты, где упоминается этот персонаж/объект/место:

${formattedMentions}

Опиши:
1. Как этот элемент представлен в начале
2. Какие ключевые изменения происходят
3. Каким он становится в конце

Будь конкретным, цитируй детали из текста. Ответ 3–5 коротких абзаца, без вводных слов.`;

    const response = await guardChat(
      () => aiClient!.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: { temperature: 0.3 },
      }),
      { userId: req.user.userId, projectId, route: 'revision:entity-arc' }
    );

    const arc = response.text ?? '';
    res.json({ arc, mentions: mentionChunks.length });
  } catch (error) {
    console.error('Error in POST /revision/entity-arc:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/revision/bible-update ─────────────────────────────────────────
// Compares the current chapter with approved Bible entities and suggests updates.
// Body: { projectId, chapterId, chapterContent }
// Returns: { suggestions: BibleUpdateSuggestion[] }

interface BibleUpdateSuggestion {
  action: 'update' | 'add';
  entityName: string;
  currentDescription?: string;
  suggestedDescription: string;
  reason: string;
}

router.post('/bible-update', authenticateToken, revisionRateLimit, async (req: any, res) => {
  try {
    if (!aiClient) return res.status(503).json({ error: 'AI not configured' });

    const { projectId, chapterId, chapterContent } = req.body;

    if (!projectId || !isValidUUID(projectId))
      return res.status(400).json({ error: 'Valid projectId is required' });
    if (!chapterContent?.trim())
      return res.status(400).json({ error: 'chapterContent is required' });

    const isOwner = await assertProjectOwnership(projectId, req.user.userId);
    if (!isOwner) return res.status(403).json({ error: 'Access denied' });

    // Get approved entities
    const entities = await db
      .select()
      .from(schema.storyEntities)
      .where(
        and(
          eq(schema.storyEntities.projectId, projectId),
          eq(schema.storyEntities.status, 'approved')
        )
      );

    // Strip HTML from chapter content for the prompt
    const plainText = chapterContent
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 6000); // cap for prompt size

    const bibleSection = entities.length > 0
      ? entities.map(e => `- ${e.name} (${e.type}): ${e.description || '(описание отсутствует)'}`).join('\n')
      : '(Библия пуста)';

    const prompt = `Ты — редактор, который помогает обновить Библию истории.

=== ТЕКУЩАЯ БИБЛИЯ (одобренные факты) ===
${bibleSection}

=== ТЕКСТ ГЛАВЫ ===
${plainText}

=== ЗАДАЧА ===
Найди:
1. Существующие сущности из Библии, чьё описание следует ОБНОВИТЬ на основе новых деталей из главы
2. Новые именованные сущности из главы, которых ещё НЕТ в Библии

Для каждой — укажи только реальные изменения или новые факты из текста. Не выдумывай.
Если изменений нет — верни пустой массив.

Верни ТОЛЬКО валидный JSON-массив без markdown:
[
  {
    "action": "update",
    "entityName": "Имя из Библии",
    "currentDescription": "Текущее описание",
    "suggestedDescription": "Обновлённое описание с новыми деталями",
    "reason": "Краткое объяснение изменения"
  },
  {
    "action": "add",
    "entityName": "Новое имя",
    "suggestedDescription": "Описание из текста главы",
    "reason": "Почему стоит добавить"
  }
]`;

    const response = await guardChat(
      () => aiClient!.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: { temperature: 0.2 },
      }),
      { userId: req.user.userId, projectId, route: 'revision:bible-update' }
    );

    const raw = response.text ?? '[]';
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let suggestions: BibleUpdateSuggestion[] = [];
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) suggestions = parsed;
    } catch {
      // Return empty if AI gave malformed JSON
    }

    res.json({ suggestions });
  } catch (error) {
    console.error('Error in POST /revision/bible-update:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
