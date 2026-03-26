import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';
import * as schema from '../db/schema.js';
import { db } from '../db/client.js';
import { authenticateToken } from '../middleware/auth.js';

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

let aiClient: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

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

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Embedding Helper ─────────────────────────────────────────────────────────

async function embedText(text: string, taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'): Promise<number[] | null> {
  if (!aiClient) return null;
  try {
    const result = await (aiClient.models as any).embedContent({
      model: 'text-embedding-004',
      content: text,
      config: { taskType },
    });
    return result.embedding?.values ?? null;
  } catch (e) {
    console.warn('embedText failed:', e);
    return null;
  }
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

    if (!aiClient)
      return res.json({ ok: true, chunks: 0, note: 'AI not configured — skipping embedding' });

    const plainText = stripHtml(content);
    const chunks = chunkText(plainText);

    if (chunks.length === 0)
      return res.json({ ok: true, chunks: 0, note: 'No chunks produced' });

    // Embed all chunks (sequentially to avoid rate limits)
    const embeddedChunks: { text: string; embedding: number[]; index: number }[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const vec = await embedText(chunks[i], 'RETRIEVAL_DOCUMENT');
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

export default router;
