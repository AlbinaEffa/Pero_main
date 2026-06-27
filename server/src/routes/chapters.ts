import express from 'express';
import { eq, and } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { db } from '../db/client.js';
import { authenticateToken, type AuthedRequest } from '../middleware/auth.js';
import { stripHtml, wordCount } from '../lib/html.js';
import { scheduleChapterEmbed } from '../jobs/queue.js';

const router = express.Router();

function normalizeChapterContent(content: string | null | undefined): string {
  if (!content) return '';
  return stripHtml(content);
}

// Helper: verify chapter exists and belongs to this user's project
async function getChapterForUser(chapterId: string, userId: string) {
  const rows = await db
    .select({ chapter: schema.chapters, project: schema.projects })
    .from(schema.chapters)
    .innerJoin(schema.projects, eq(schema.chapters.projectId, schema.projects.id))
    .where(
      and(
        eq(schema.chapters.id, chapterId),
        eq(schema.projects.userId, userId)
      )
    );
  return rows[0] ?? null;
}

// GET /api/chapters/:id
router.get('/:id', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const { id } = req.params;
    const row = await getChapterForUser(id, req.user.userId);

    if (!row) {
      return res.status(404).json({ error: 'Chapter not found or access denied' });
    }

    res.json({ chapter: row.chapter });
  } catch (error) {
    console.error('Error fetching chapter:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/chapters/:id
router.put('/:id', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    if (content === undefined) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Ownership check first
    const row = await getChapterForUser(id, req.user.userId);
    if (!row) {
      return res.status(404).json({ error: 'Chapter not found or access denied' });
    }

    // Compare normalized manuscript text, not raw HTML. This avoids false stale
    // states when TipTap serializes equivalent markup slightly differently.
    const contentChanged =
      normalizeChapterContent(row.chapter.content) !== normalizeChapterContent(content);

    // Recompute cached word count on every save (cheap compared to the regex-at-query-time approach)
    const computedWordCount = wordCount(content);

    const updated = await db
      .update(schema.chapters)
      .set(
        contentChanged
          ? {
              content,
              wordCount: computedWordCount,
              updatedAt: new Date(),
            }
          : {
              content,
              wordCount: computedWordCount,
            }
      )
      .where(eq(schema.chapters.id, id))
      .returning();

    // Изменился текст → планируем переэмбеддинг (дедуп + задержка). Durable-гарантия:
    // вектор обновится даже если вкладку закрыть до срабатывания фронт-таймера.
    // Fire-and-forget — не задерживаем ответ автосейва и не валим его при сбое очереди.
    if (contentChanged) {
      scheduleChapterEmbed(id, row.chapter.projectId, req.user.userId).catch(e =>
        console.warn('scheduleChapterEmbed failed:', e?.message ?? e),
      );
    }

    res.json({ chapter: updated[0] });
  } catch (error) {
    console.error('Error saving chapter:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// PATCH /api/chapters/:id — rename, set status, set order
router.patch('/:id', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const { id } = req.params;
    const { title, status, order, povCharacter, chapterType, plan } = req.body;

    const row = await getChapterForUser(id, req.user.userId);
    if (!row) {
      return res.status(404).json({ error: 'Chapter not found or access denied' });
    }

    const patch: {
      title?: string;
      status?: string;
      order?: number;
      povCharacter?: string | null;
      chapterType?: string;
      plan?: string | null;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (title !== undefined) {
      if (!title.trim()) return res.status(400).json({ error: 'Title cannot be empty' });
      patch.title = title.trim();
    }
    if (status !== undefined) patch.status = status;
    if (order !== undefined) patch.order = order;
    // POV-рассказчик: строка-имя или null (третье лицо/убрать). Авторская правка — авторитет.
    if (povCharacter !== undefined) {
      patch.povCharacter = typeof povCharacter === 'string' && povCharacter.trim()
        ? povCharacter.trim().slice(0, 80)
        : null;
    }
    // Тип главы — авторская правка (например, пометить эпилогом).
    if (chapterType !== undefined && ['chapter', 'prologue', 'epilogue', 'part', 'interlude', 'acknowledgments', 'dedication', 'foreword', 'afterword'].includes(chapterType)) {
      patch.chapterType = chapterType;
    }
    // Авторский план главы (режим архитектора): строка или null.
    if (plan !== undefined) patch.plan = typeof plan === 'string' && plan.trim() ? plan.trim().slice(0, 2000) : null;

    if (Object.keys(patch).length === 1) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const [updated] = await db
      .update(schema.chapters)
      .set(patch)
      .where(eq(schema.chapters.id, id))
      .returning();

    res.json({ chapter: updated });
  } catch (error) {
    console.error('Error updating chapter:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
