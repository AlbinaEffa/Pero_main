/**
 * Заметки/идеи — доска «пре-продакшена» автора.
 * Единая модель notes: kind (idea|note|question|todo), опц. привязка к главе/сущности.
 * Промоут: заметку → сущность в Мире (наш ров: ИИ уже читает рукопись, но автор может
 * и вручную «повысить» идею в Мир).
 */
import express from 'express';
import { and, eq, desc, sql } from 'drizzle-orm';
import { authenticateToken } from '../middleware/auth.js';
import * as schema from '../db/schema.js';
import { db } from '../db/client.js';
import { isValidUUID } from '../lib/extraction.js';

const router = express.Router();

const KINDS = ['idea', 'note', 'question', 'todo'];
const STATUSES = ['open', 'done', 'archived'];
const ENTITY_TYPES = ['character', 'location', 'item', 'rule'];

async function assertProjectOwnership(projectId: string, userId: string): Promise<boolean> {
  if (!isValidUUID(projectId)) return false;
  const rows = await db.select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)));
  return rows.length > 0;
}

async function getOwnedNote(noteId: string, userId: string) {
  if (!isValidUUID(noteId)) return null;
  const rows = await db.select()
    .from(schema.notes)
    .innerJoin(schema.projects, eq(schema.notes.projectId, schema.projects.id))
    .where(and(eq(schema.notes.id, noteId), eq(schema.projects.userId, userId)));
  return rows[0]?.notes ?? null;
}

// ── GET /api/notes/:projectId — все заметки проекта ──────────────────────────
router.get('/:projectId', authenticateToken, async (req: any, res) => {
  try {
    const { projectId } = req.params;
    if (!(await assertProjectOwnership(projectId, req.user.userId))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const rows = await db.select()
      .from(schema.notes)
      .where(eq(schema.notes.projectId, projectId))
      .orderBy(desc(schema.notes.pinned), desc(schema.notes.updatedAt));
    res.json({ notes: rows });
  } catch (error) {
    console.error('Error listing notes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/notes/:projectId — создать заметку ─────────────────────────────
router.post('/:projectId', authenticateToken, async (req: any, res) => {
  try {
    const { projectId } = req.params;
    if (!(await assertProjectOwnership(projectId, req.user.userId))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { kind, body, chapterId, entityId } = req.body ?? {};
    const cleanBody = typeof body === 'string' ? body.trim().slice(0, 8000) : '';
    if (!cleanBody) return res.status(400).json({ error: 'Body is required' });

    const [created] = await db.insert(schema.notes).values({
      projectId,
      userId: req.user.userId,
      kind: KINDS.includes(kind) ? kind : 'idea',
      body: cleanBody,
      chapterId: isValidUUID(chapterId) ? chapterId : null,
      entityId: isValidUUID(entityId) ? entityId : null,
    }).returning();
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating note:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/notes/:noteId — правка (тело/тип/статус/пин/связи) ─────────────
router.patch('/:noteId', authenticateToken, async (req: any, res) => {
  try {
    const note = await getOwnedNote(req.params.noteId, req.user.userId);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const { body, kind, status, pinned, chapterId, entityId } = req.body ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body === 'string') patch.body = body.trim().slice(0, 8000);
    if (KINDS.includes(kind)) patch.kind = kind;
    if (STATUSES.includes(status)) patch.status = status;
    if (typeof pinned === 'boolean') patch.pinned = pinned;
    if (chapterId === null || isValidUUID(chapterId)) patch.chapterId = chapterId ?? null;
    if (entityId === null || isValidUUID(entityId)) patch.entityId = entityId ?? null;

    const [updated] = await db.update(schema.notes)
      .set(patch)
      .where(eq(schema.notes.id, note.id))
      .returning();
    res.json(updated);
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/notes/:noteId ────────────────────────────────────────────────
router.delete('/:noteId', authenticateToken, async (req: any, res) => {
  try {
    const note = await getOwnedNote(req.params.noteId, req.user.userId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    await db.delete(schema.notes).where(eq(schema.notes.id, note.id));
    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/notes/:noteId/promote — заметку → сущность в Мире ───────────────
// Автор «повышает» идею в Мир: создаём approved-сущность из тела заметки,
// помечаем заметку done и связываем с созданной сущностью.
router.post('/:noteId/promote', authenticateToken, async (req: any, res) => {
  try {
    const note = await getOwnedNote(req.params.noteId, req.user.userId);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const { type, name } = req.body ?? {};
    if (!ENTITY_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid entity type' });
    // Имя — из переданного или первой строки заметки.
    const firstLine = (note.body || '').split('\n')[0].trim();
    const cleanName = (typeof name === 'string' && name.trim() ? name : firstLine).trim().slice(0, 200);
    if (!cleanName) return res.status(400).json({ error: 'Name is required' });

    // Описание — остаток заметки после первой строки (если есть).
    const rest = (note.body || '').split('\n').slice(1).join('\n').trim();

    const [entity] = await db.insert(schema.storyEntities).values({
      projectId: note.projectId,
      type,
      name: cleanName,
      description: rest || null,
      status: 'approved',
    }).returning();

    await db.update(schema.notes)
      .set({ status: 'done', entityId: entity.id, updatedAt: new Date() })
      .where(eq(schema.notes.id, note.id));

    res.status(201).json({ entity });
  } catch (error) {
    console.error('Error promoting note:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/notes/:noteId/to-chapter — заметку → новая глава ────────────────
// Идея/набросок дорастает до главы: title = первая строка, content = тело (абзацами).
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

router.post('/:noteId/to-chapter', authenticateToken, async (req: any, res) => {
  try {
    const note = await getOwnedNote(req.params.noteId, req.user.userId);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const lines = (note.body || '').split('\n');
    const title = (lines[0] || '').trim().slice(0, 200) || 'Новая глава';
    const html = lines.map(l => l.trim() ? `<p>${escapeHtml(l)}</p>` : '<p></p>').join('') || '<p></p>';

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.chapters)
      .where(eq(schema.chapters.projectId, note.projectId));

    const [chapter] = await db.insert(schema.chapters).values({
      projectId: note.projectId,
      title,
      content: html,
      order: count,
      chapterType: 'chapter',
    }).returning();

    await db.update(schema.notes)
      .set({ status: 'done', chapterId: chapter.id, updatedAt: new Date() })
      .where(eq(schema.notes.id, note.id));

    res.status(201).json({ chapter });
  } catch (error) {
    console.error('Error promoting note to chapter:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
