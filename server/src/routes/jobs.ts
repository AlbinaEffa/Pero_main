/**
 * Jobs API — processing status + retry
 *
 * GET  /api/jobs?projectId=xxx
 *   Rich response with per-type breakdown and chapter titles.
 *   Used by ProcessingStatusPanel to show granular progress.
 *
 * POST /api/jobs/:id/retry
 *   Reset one failed job back to queued. Returns updated job.
 *
 * POST /api/jobs/retry-failed
 *   Body: { projectId }
 *   Reset all failed jobs for a project. Returns count.
 */

import express from 'express';
import { eq, and } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { pool, db } from '../db/client.js';
import { authenticateToken } from '../middleware/auth.js';
import { enqueueJobs } from '../jobs/queue.js';

const router = express.Router();

const isValidUUID = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// ── Helpers ───────────────────────────────────────────────────────────────────

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

function makeCounts(jobs: { status: string }[]) {
  return {
    total:     jobs.length,
    queued:    jobs.filter(j => j.status === 'queued').length,
    running:   jobs.filter(j => j.status === 'running').length,
    succeeded: jobs.filter(j => j.status === 'succeeded').length,
    failed:    jobs.filter(j => j.status === 'failed').length,
  };
}

async function assertProjectOwnership(projectId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)));
  return rows.length > 0;
}

// ── GET /api/jobs?projectId=xxx ───────────────────────────────────────────────

router.get('/', authenticateToken, async (req: any, res) => {
  try {
    const { projectId } = req.query as { projectId?: string };

    if (!projectId || !isValidUUID(projectId)) {
      return res.status(400).json({ error: 'Valid projectId is required' });
    }

    if (!(await assertProjectOwnership(projectId, req.user.userId))) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Raw SQL to extract chapterId from JSONB payload and join chapter title/order
    const { rows } = await pool.query<{
      id: string;
      type: string;
      status: JobStatus;
      attempts: number;
      max_attempts: number;
      error: string | null;
      created_at: string;
      chapter_id: string | null;
      chapter_title: string | null;
      chapter_order: number | null;
    }>(
      `SELECT
         j.id,
         j.type,
         j.status,
         j.attempts,
         j.max_attempts,
         j.error,
         j.created_at,
         (j.payload->>'chapterId') AS chapter_id,
         c.title                   AS chapter_title,
         c."order"                 AS chapter_order
       FROM jobs j
       LEFT JOIN chapters c
              ON c.id = (j.payload->>'chapterId')::uuid
       WHERE j.project_id = $1
       ORDER BY c."order" ASC NULLS LAST, j.created_at ASC
       LIMIT 300`,
      [projectId]
    );

    const summary = makeCounts(rows);
    const byType = {
      extract_entities: makeCounts(rows.filter(j => j.type === 'extract_entities')),
      embed_chapter:    makeCounts(rows.filter(j => j.type === 'embed_chapter')),
    };

    // Derive readable states for the UI
    const bibleState =
      byType.extract_entities.total === 0             ? 'idle' :
      byType.extract_entities.running > 0 ||
        byType.extract_entities.queued > 0            ? 'processing' :
      byType.extract_entities.failed > 0 &&
        byType.extract_entities.succeeded === 0       ? 'failed' :
      byType.extract_entities.failed > 0              ? 'partial' :
                                                         'done';

    const memoryState =
      byType.embed_chapter.total === 0                ? 'idle' :
      byType.embed_chapter.running > 0 ||
        byType.embed_chapter.queued > 0               ? 'processing' :
      byType.embed_chapter.failed > 0 &&
        byType.embed_chapter.succeeded === 0          ? 'failed' :
      byType.embed_chapter.failed > 0                 ? 'partial' :
                                                         'done';

    res.json({
      isProcessing: summary.queued > 0 || summary.running > 0,
      summary,
      byType,
      bibleState,
      memoryState,
      jobs: rows.map(j => ({
        id: j.id,
        type: j.type,
        status: j.status,
        attempts: j.attempts,
        maxAttempts: j.max_attempts,
        error: j.error,
        createdAt: j.created_at,
        chapterId: j.chapter_id,
        chapterTitle: j.chapter_title,
        chapterOrder: j.chapter_order,
      })),
    });
  } catch (error) {
    console.error('Error in GET /jobs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/jobs/:id/retry ──────────────────────────────────────────────────

router.post('/:id/retry', authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params;

    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }

    // Fetch job and verify ownership via project
    const { rows: jobRows } = await pool.query<{
      id: string; status: string; project_id: string;
    }>(
      `SELECT j.id, j.status, j.project_id
       FROM jobs j
       JOIN projects p ON p.id = j.project_id
       WHERE j.id = $1 AND p.user_id = $2`,
      [id, req.user.userId]
    );

    if (jobRows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (jobRows[0].status !== 'failed') {
      return res.status(400).json({ error: 'Only failed jobs can be retried' });
    }

    const { rows: updated } = await pool.query<{ id: string; status: string }>(
      `UPDATE jobs
       SET status = 'queued',
           attempts = 0,
           error = NULL,
           run_after = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, status`,
      [id]
    );

    res.json({ job: updated[0] });
  } catch (error) {
    console.error('Error in POST /jobs/:id/retry:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/jobs/retry-failed ───────────────────────────────────────────────

router.post('/retry-failed', authenticateToken, async (req: any, res) => {
  try {
    const { projectId } = req.body as { projectId?: string };

    if (!projectId || !isValidUUID(projectId)) {
      return res.status(400).json({ error: 'Valid projectId is required' });
    }

    if (!(await assertProjectOwnership(projectId, req.user.userId))) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { rowCount } = await pool.query(
      `UPDATE jobs
       SET status = 'queued',
           attempts = 0,
           error = NULL,
           run_after = NOW(),
           updated_at = NOW()
       WHERE project_id = $1 AND status = 'failed'`,
      [projectId]
    );

    res.json({ retried: rowCount ?? 0 });
  } catch (error) {
    console.error('Error in POST /jobs/retry-failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/jobs/enqueue-project ────────────────────────────────────────────
// Re-enqueue processing for ALL chapters of a project.
// Deletes any existing terminal (succeeded/failed) jobs first,
// then creates fresh extract_entities + embed_chapter jobs for each chapter
// with enough content. Skips chapters that already have queued/running jobs.

router.post('/enqueue-project', authenticateToken, async (req: any, res) => {
  try {
    const { projectId } = req.body as { projectId?: string };

    if (!projectId || !isValidUUID(projectId)) {
      return res.status(400).json({ error: 'Valid projectId is required' });
    }

    if (!(await assertProjectOwnership(projectId, req.user.userId))) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Don't enqueue if jobs are already in flight for this project
    const { rows: active } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM jobs
       WHERE project_id = $1 AND status IN ('queued', 'running')`,
      [projectId]
    );
    if (parseInt(active[0].count, 10) > 0) {
      return res.status(409).json({ error: 'Processing is already in progress for this project' });
    }

    // Fetch all chapters with their content
    const { rows: chapters } = await pool.query<{
      id: string; content: string | null;
    }>(
      `SELECT id, content FROM chapters WHERE project_id = $1`,
      [projectId]
    );

    const items = chapters.flatMap(c => {
      const text = (c.content ?? '').replace(/<[^>]+>/g, ' ');
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      if (wordCount < 50) return [];
      return [
        {
          type: 'extract_entities' as const,
          payload: { chapterId: c.id, content: text },
          projectId,
          userId: req.user.userId,
        },
        {
          type: 'embed_chapter' as const,
          payload: { chapterId: c.id, content: c.content ?? '' },
          projectId,
          userId: req.user.userId,
        },
      ];
    });

    if (items.length === 0) {
      return res.json({ enqueued: 0, message: 'No chapters with sufficient content found' });
    }

    const jobIds = await enqueueJobs(items);
    res.json({ enqueued: jobIds.length });
  } catch (error) {
    console.error('Error in POST /jobs/enqueue-project:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
