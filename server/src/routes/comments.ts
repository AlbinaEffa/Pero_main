/**
 * Комментарии — авторские пометки, привязанные к диапазону текста главы.
 * Якорь хранится в документе главы (марка `comment`, её commentId === comments.id),
 * тело/статус — здесь. В отличие от notes (доска идей) комментарий приклеен к МЕСТУ
 * и решается. Действие «→ в заметки» переносит комментарий на доску идей (note) —
 * см. POST /:id/to-note: комментарий снимается, появляется note.
 */
import express from 'express';
import { randomUUID } from 'crypto';
import { and, eq, asc } from 'drizzle-orm';
import { authenticateToken } from '../middleware/auth.js';
import * as schema from '../db/schema.js';
import { db } from '../db/client.js';
import { isValidUUID } from '../lib/extraction.js';

const router = express.Router();

async function assertProjectOwnership(projectId: string, userId: string): Promise<boolean> {
  if (!isValidUUID(projectId)) return false;
  const rows = await db.select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)));
  return rows.length > 0;
}

async function getOwnedComment(commentId: string, userId: string) {
  if (!isValidUUID(commentId)) return null;
  const rows = await db.select()
    .from(schema.comments)
    .innerJoin(schema.projects, eq(schema.comments.projectId, schema.projects.id))
    .where(and(eq(schema.comments.id, commentId), eq(schema.projects.userId, userId)));
  return rows[0]?.comments ?? null;
}

// ── GET /api/comments/:projectId?chapterId=… — комментарии проекта/главы ──────
router.get('/:projectId', authenticateToken, async (req: any, res) => {
  try {
    const { projectId } = req.params;
    const { chapterId } = req.query;
    if (!(await assertProjectOwnership(projectId, req.user.userId))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const where = chapterId && isValidUUID(chapterId as string)
      ? and(eq(schema.comments.projectId, projectId), eq(schema.comments.chapterId, chapterId as string))
      : eq(schema.comments.projectId, projectId);
    const rows = await db.select().from(schema.comments)
      .where(where)
      .orderBy(asc(schema.comments.createdAt));
    res.json({ comments: rows });
  } catch (error) {
    console.error('Error listing comments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/comments/:projectId — создать комментарий ───────────────────────
// Принимает клиентский id (=== commentId марки), чтобы марка и строка были связаны атомарно.
router.post('/:projectId', authenticateToken, async (req: any, res) => {
  try {
    const { projectId } = req.params;
    const { id, chapterId, body, quote, source } = req.body ?? {};
    if (!(await assertProjectOwnership(projectId, req.user.userId))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!chapterId || !isValidUUID(chapterId)) {
      return res.status(400).json({ error: 'chapterId required' });
    }
    if (id && !isValidUUID(id)) {
      return res.status(400).json({ error: 'invalid id' });
    }
    // Глава должна принадлежать ЭТОМУ проекту — иначе комментарий повиснет на чужой главе.
    const chapterRows = await db.select({ id: schema.chapters.id })
      .from(schema.chapters)
      .where(and(eq(schema.chapters.id, chapterId), eq(schema.chapters.projectId, projectId)));
    if (chapterRows.length === 0) {
      return res.status(400).json({ error: 'chapter not in project' });
    }
    const [row] = await db.insert(schema.comments).values({
      ...(id ? { id } : {}),
      projectId,
      chapterId,
      userId: req.user.userId,
      body: typeof body === 'string' ? body.slice(0, 4000) : '',
      quote: typeof quote === 'string' ? quote.slice(0, 2000) : '',
      source: source === 'pero' ? 'pero' : 'author',
    }).returning();
    res.status(201).json(row);
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/comments/item/:id — правка тела / resolve ───────────────────────
router.patch('/item/:id', authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params;
    const existing = await getOwnedComment(id, req.user.userId);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const patch: Record<string, any> = { updatedAt: new Date() };
    if (typeof req.body?.body === 'string') patch.body = req.body.body.slice(0, 4000);
    if (typeof req.body?.resolved === 'boolean') patch.resolved = req.body.resolved;
    const [row] = await db.update(schema.comments)
      .set(patch)
      .where(eq(schema.comments.id, id))
      .returning();
    res.json(row);
  } catch (error) {
    console.error('Error updating comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/comments/item/:id ─────────────────────────────────────────────
router.delete('/item/:id', authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params;
    const existing = await getOwnedComment(id, req.user.userId);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    await db.delete(schema.comments).where(eq(schema.comments.id, id));
    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/comments/item/:id/to-note — перенести комментарий в Заметки ──────
// Создаёт note (тело = тело комментария, при пустом — снимок цитаты) и УДАЛЯЕТ комментарий.
// Якорь-марку снимает клиент (по вернувшемуся removed=id). Возвращает созданную заметку.
router.post('/item/:id/to-note', authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params;
    const existing = await getOwnedComment(id, req.user.userId);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const noteBody = (existing.body?.trim() || (existing.quote ? `«${existing.quote}»` : '')).slice(0, 4000);
    // Транзакция: либо заметка создана И комментарий удалён, либо ничего (без дублей).
    const note = await db.transaction(async (tx) => {
      const [n] = await tx.insert(schema.notes).values({
        projectId: existing.projectId,
        userId: req.user.userId,
        kind: 'note',
        body: noteBody,
        chapterId: existing.chapterId,
      }).returning();
      await tx.delete(schema.comments).where(eq(schema.comments.id, id));
      return n;
    });
    res.json({ note, removed: id });
  } catch (error) {
    console.error('Error moving comment to note:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/comments/item/:id/reply — добавить ответ в тред ──────────────────
router.post('/item/:id/reply', authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params;
    const body = typeof req.body?.body === 'string' ? req.body.body.trim().slice(0, 4000) : '';
    if (!body) return res.status(400).json({ error: 'empty reply' });
    const existing = await getOwnedComment(id, req.user.userId);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const reply = { id: randomUUID(), body, author: 'author' as const, createdAt: new Date().toISOString() };
    const replies = [...(existing.replies ?? []), reply];
    const [row] = await db.update(schema.comments)
      .set({ replies, updatedAt: new Date() })
      .where(eq(schema.comments.id, id))
      .returning();
    res.json(row);
  } catch (error) {
    console.error('Error adding reply:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
