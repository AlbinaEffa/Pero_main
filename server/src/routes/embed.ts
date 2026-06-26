import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { eq, and, sql } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { db } from '../db/client.js';
import { authenticateToken } from '../middleware/auth.js';
import { stripHtml } from '../lib/html.js';
import { getEmbeddingProvider, type EmbedTaskType } from '../lib/aiProvider.js';
import { enqueueJobs } from '../jobs/queue.js';

async function assertChapterOwnership(chapterId: string, projectId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.chapters.id })
    .from(schema.chapters)
    .innerJoin(schema.projects, eq(schema.chapters.projectId, schema.projects.id))
    .where(
      and(
        eq(schema.chapters.id, chapterId),
        eq(schema.chapters.projectId, projectId),
        eq(schema.projects.userId, userId)
      )
    );
  return rows.length > 0;
}

const router = express.Router();

const embedder = getEmbeddingProvider();

const isValidUUID = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// ─── Text Chunker ─────────────────────────────────────────────────────────────
// Splits plain text into overlapping word-chunks.
// chunk_size=400 words, overlap=60 words → sliding window.

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

// stripHtml imported from lib/html.ts

// ─── Embedding Helper ─────────────────────────────────────────────────────────

async function embedText(text: string, taskType: EmbedTaskType): Promise<number[] | null> {
  if (!embedder) return null;
  return embedder.embed(text, taskType);
}

// ─── POST /api/embed/chapter ─────────────────────────────────────────────────
// Body: { projectId, chapterId, content }  (content = HTML from tiptap)
// Strips HTML, chunks, embeds each chunk, deletes old chunks for this chapter,
// inserts new ones. Silently skips if pgvector not installed.

router.post('/chapter', authenticateToken, async (req: any, res) => {
  try {
    const { projectId, chapterId, content } = req.body;

    if (!projectId || !isValidUUID(projectId))
      return res.status(400).json({ error: 'Valid projectId is required' });
    if (!chapterId || !isValidUUID(chapterId))
      return res.status(400).json({ error: 'Valid chapterId is required' });

    const isOwner = await assertChapterOwnership(chapterId, projectId, req.user.userId);
    if (!isOwner) return res.status(403).json({ error: 'Access denied' });

    if (!content?.trim())
      return res.json({ ok: true, chunks: 0, note: 'empty content — skipped' });

    if (!embedder)
      return res.json({ ok: true, chunks: 0, note: 'AI not configured — skipping embedding' });

    const plainText = stripHtml(content);
    const chunks = chunkText(plainText);

    if (chunks.length === 0)
      return res.json({ ok: true, chunks: 0, note: 'No chunks produced' });

    // Embed all chunks (sequentially to avoid rate limits)
    const embeddedChunks: { text: string; embedding: number[]; index: number }[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const vec = await embedText(chunks[i], 'document');
      if (vec) embeddedChunks.push({ text: chunks[i], embedding: vec, index: i });
    }

    if (embeddedChunks.length === 0)
      return res.json({ ok: true, chunks: 0, note: 'Embedding failed for all chunks' });

    // Delete old chunks for this chapter, then insert new ones — wrapped in try/catch
    // for graceful degradation if pgvector/table not yet installed.
    try {
      // Delete existing chunks for this chapter
      await db
        .delete(schema.semanticMemory)
        .where(
          and(
            eq(schema.semanticMemory.chapterId, chapterId),
            eq(schema.semanticMemory.projectId, projectId)
          )
        );

      // Insert new chunks with embeddings
      await db.insert(schema.semanticMemory).values(
        embeddedChunks.map(c => ({
          userId: req.user.userId,
          projectId,
          chapterId,
          chunkText: c.text,
          embedding: c.embedding,
          metadata: { chunkIndex: c.index },
        }))
      );
    } catch (dbErr: any) {
      // 42P01 = table doesn't exist, 42703 = column doesn't exist (pgvector not installed)
      if (['42P01', '42703'].includes(dbErr?.code)) {
        console.info('pgvector not installed — skipping semantic_memory write');
        return res.json({ ok: true, chunks: 0, note: 'pgvector not installed' });
      }
      throw dbErr;
    }

    res.json({ ok: true, chunks: embeddedChunks.length });
  } catch (error) {
    console.error('Error in POST /embed/chapter:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/embed/project/:projectId ───────────────────────────────────────
// Бэкфилл: проэмбеддить ВСЕ главы книги. Не держим HTTP открытым на минуты —
// ставим по одному фоновому job'у embed_chapter на главу (worker эмбеддит через
// провайдер; локально это Ollama → бесплатно, без API-токенов). Идемпотентно:
// worker удаляет старые чанки главы перед вставкой новых.
router.post('/project/:projectId', authenticateToken, async (req: any, res) => {
  try {
    const { projectId } = req.params;
    if (!projectId || !isValidUUID(projectId))
      return res.status(400).json({ error: 'Valid projectId is required' });

    // Ownership: проект принадлежит пользователю
    const owned = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, req.user.userId)));
    if (owned.length === 0) return res.status(403).json({ error: 'Access denied' });

    if (!embedder)
      return res.json({ ok: true, enqueued: 0, note: 'embeddings not configured' });

    const chapters = await db
      .select({ id: schema.chapters.id, content: schema.chapters.content })
      .from(schema.chapters)
      .where(eq(schema.chapters.projectId, projectId));

    // Только главы с непустым текстом — пустые чанкер всё равно отбросит
    const jobs = chapters
      .filter(c => stripHtml(c.content ?? '').trim().length > 0)
      .map(c => ({
        type: 'embed_chapter' as const,
        payload: { chapterId: c.id, content: c.content ?? '' },
        projectId,
        userId: req.user.userId,
      }));

    if (jobs.length === 0)
      return res.json({ ok: true, enqueued: 0, note: 'no chapters with text' });

    await enqueueJobs(jobs);
    res.json({ ok: true, enqueued: jobs.length, total: chapters.length });
  } catch (error) {
    console.error('Error in POST /embed/project:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
