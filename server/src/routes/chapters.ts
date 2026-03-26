import express from 'express';
import { eq, and } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { db } from '../db/client.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

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
router.get('/:id', authenticateToken, async (req: any, res) => {
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
router.put('/:id', authenticateToken, async (req: any, res) => {
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
    const updated = await db
      .update(schema.chapters)
      .set(contentChanged ? { content, updatedAt: new Date() } : { content })
      .where(eq(schema.chapters.id, id))
      .returning();

    res.json({ chapter: updated[0] });
  } catch (error) {
    console.error('Error saving chapter:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// PATCH /api/chapters/:id — rename, set status, set order
router.patch('/:id', authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { title, status, order } = req.body;

    const row = await getChapterForUser(id, req.user.userId);
    if (!row) {
      return res.status(404).json({ error: 'Chapter not found or access denied' });
    }

    const patch: {
      title?: string;
      status?: string;
      order?: number;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (title !== undefined) {
      if (!title.trim()) return res.status(400).json({ error: 'Title cannot be empty' });
      patch.title = title.trim();
    }
    if (status !== undefined) patch.status = status;
    if (order !== undefined) patch.order = order;

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
