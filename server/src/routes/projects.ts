import express from 'express';
import { eq, and, asc, desc, inArray, sql } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { db } from '../db/client.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Helper: verify project ownership
async function assertOwnership(projectId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)));
  return rows.length > 0;
}

// GET /api/projects — list projects enriched with word counts + chapter stats
router.get('/', authenticateToken, async (req: any, res) => {
  try {
    // Most recently edited projects appear first
    const projects = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.userId, req.user.userId))
      .orderBy(desc(schema.projects.updatedAt));

    const wordCountMap: Record<string, number> = {};
    const chapterStatsMap: Record<string, {
      chapterCount: number;
      doneCount: number;
      lastChapterId: string | null;
    }> = {};

    if (projects.length > 0) {
      const projectIds = projects.map(p => p.id);

      // Word count: strip HTML, split on whitespace, sum per project
      const counts = await db
        .select({
          projectId: schema.chapters.projectId,
          wordCount: sql<number>`
            COALESCE(SUM(
              CASE
                WHEN trim(regexp_replace(COALESCE(${schema.chapters.content}, ''), '<[^>]*>', ' ', 'g')) = '' THEN 0
                ELSE array_length(
                  regexp_split_to_array(
                    trim(regexp_replace(${schema.chapters.content}, '<[^>]*>', ' ', 'g')),
                    '[[:space:]]+'
                  ), 1)
              END
            ), 0)`.mapWith(Number),
        })
        .from(schema.chapters)
        .where(inArray(schema.chapters.projectId, projectIds))
        .groupBy(schema.chapters.projectId);

      counts.forEach(r => { wordCountMap[r.projectId] = r.wordCount; });

      // Chapter stats: total, done, and last-edited chapter id — all in one pass
      const stats = await db
        .select({
          projectId: schema.chapters.projectId,
          chapterCount: sql<number>`count(*)`.mapWith(Number),
          doneCount: sql<number>`count(*) filter (where ${schema.chapters.status} = 'done')`.mapWith(Number),
          // array_agg with ORDER BY returns sorted array; [1] picks the first element (most recent)
          lastChapterId: sql<string | null>`(array_agg(${schema.chapters.id} order by ${schema.chapters.updatedAt} desc nulls last))[1]`,
        })
        .from(schema.chapters)
        .where(inArray(schema.chapters.projectId, projectIds))
        .groupBy(schema.chapters.projectId);

      stats.forEach(r => {
        chapterStatsMap[r.projectId] = {
          chapterCount:   r.chapterCount,
          doneCount:      r.doneCount,
          lastChapterId:  r.lastChapterId,
        };
      });
    }

    res.json({
      projects: projects.map(p => ({
        ...p,
        wordCount:       wordCountMap[p.id]                    ?? 0,
        chapterCount:    chapterStatsMap[p.id]?.chapterCount   ?? 0,
        doneChapterCount: chapterStatsMap[p.id]?.doneCount     ?? 0,
        lastChapterId:   chapterStatsMap[p.id]?.lastChapterId  ?? null,
      })),
    });
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id
router.get('/:id', authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params;
    const rows = await db
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, req.user.userId)));

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }
    res.json({ project: rows[0] });
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects — create project + first chapter in a transaction
router.post('/', authenticateToken, async (req: any, res) => {
  try {
    const { title, genre, color } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const { project, chapter } = await db.transaction(async (tx) => {
      const [project] = await tx
        .insert(schema.projects)
        .values({
          userId: req.user.userId,
          title: title.trim(),
          genre: genre || null,
          color: color || '#3A4F41',
          status: 'active',
        })
        .returning();

      const [chapter] = await tx
        .insert(schema.chapters)
        .values({
          projectId: project.id,
          title: 'Глава 1',
          content: '',
        })
        .returning();

      return { project, chapter };
    });

    res.status(201).json({ project, chapter });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/projects/:id — update title, genre, color, status
router.patch('/:id', authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params;
    const owned = await assertOwnership(id, req.user.userId);
    if (!owned) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { title, genre, color, status } = req.body;

    const patch: {
      title?: string;
      genre?: string | null;
      color?: string;
      status?: string;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (title !== undefined) {
      if (!title.trim()) return res.status(400).json({ error: 'Title cannot be empty' });
      patch.title = title.trim();
    }
    if (genre !== undefined) patch.genre = genre || null;
    if (color !== undefined) patch.color = color;
    if (status !== undefined) patch.status = status;

    // Only updatedAt means no real fields were sent
    if (Object.keys(patch).length === 1) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const [updated] = await db
      .update(schema.projects)
      .set(patch)
      .where(eq(schema.projects.id, id))
      .returning();

    res.json({ project: updated });
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/projects/:id — cascade delete in a transaction
router.delete('/:id', authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params;
    const owned = await assertOwnership(id, req.user.userId);
    if (!owned) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await db.transaction(async (tx) => {
      await tx.delete(schema.storyEntities).where(eq(schema.storyEntities.projectId, id));
      await tx.delete(schema.chapters).where(eq(schema.chapters.projectId, id));
      await tx.delete(schema.projects).where(eq(schema.projects.id, id));
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id/chapters — list chapters ordered by creation time
router.get('/:id/chapters', authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params;
    const owned = await assertOwnership(id, req.user.userId);
    if (!owned) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const chapters = await db
      .select()
      .from(schema.chapters)
      .where(eq(schema.chapters.projectId, id))
      .orderBy(asc(schema.chapters.order), asc(schema.chapters.createdAt));

    res.json({ chapters });
  } catch (error) {
    console.error('Error fetching chapters:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects/:id/chapters
router.post('/:id/chapters', authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;

    const owned = await assertOwnership(id, req.user.userId);
    if (!owned) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Set order = current chapter count so the new chapter goes to end
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.chapters)
      .where(eq(schema.chapters.projectId, id));

    const [chapter] = await db
      .insert(schema.chapters)
      .values({
        projectId: id,
        title: title || 'Новая глава',
        content: '',
        order: count,
      })
      .returning();

    res.status(201).json({ chapter });
  } catch (error) {
    console.error('Error creating chapter:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/projects/:id/chapters/order — bulk reorder
router.put('/:id/chapters/order', authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { ids } = req.body as { ids: string[] };

    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array' });
    }

    const owned = await assertOwnership(id, req.user.userId);
    if (!owned) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx
          .update(schema.chapters)
          .set({ order: i })
          .where(and(eq(schema.chapters.id, ids[i]), eq(schema.chapters.projectId, id)));
      }
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error reordering chapters:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
