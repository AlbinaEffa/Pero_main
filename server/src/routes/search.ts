import express from 'express';
import { eq, and, ilike, or, ne } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { db } from '../db/client.js';
import { authenticateToken } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimiter.js';

const router = express.Router();

const isValidUUID = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/**
 * Escape PostgreSQL ILIKE wildcards (% _ \) in user-supplied strings.
 * Without this, a query of "%%" would match every row.
 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
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

/** Extract a short snippet around the first occurrence of query in HTML content */
/**
 * Extract a clean text fingerprint around the first occurrence of query.
 * No ellipsis markers — the result is raw text that can be searched verbatim
 * in the editor document to locate the exact match position.
 */
function extractMatchText(htmlContent: string | null, query: string, contextChars = 15): string {
  if (!htmlContent) return query;
  const text = stripHtml(htmlContent).replace(/\s+/g, ' ').trim();
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return query;
  const start = Math.max(0, idx - contextChars);
  const end   = Math.min(text.length, idx + query.length + contextChars);
  return text.slice(start, end);
}

/** Extract a short snippet around the first occurrence of query in HTML content */
function extractSnippet(htmlContent: string | null, query: string, maxLen = 220): string {
  if (!htmlContent) return '';
  const text = stripHtml(htmlContent);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) {
    return text.slice(0, maxLen) + (text.length > maxLen ? '…' : '');
  }
  const start = Math.max(0, idx - 90);
  const end   = Math.min(text.length, idx + query.length + 90);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

export type SearchResultType = 'chapter' | 'text_match' | 'character' | 'location' | 'item' | 'rule';

export interface SearchResult {
  id:           string;
  type:         SearchResultType;
  title:        string;
  snippet:      string;
  /** Clean-text fingerprint (±15 chars around the match) for precise jump-to-match in the editor. */
  matchText?:   string;
  chapterId:    string | null;
  chapterTitle: string | null;
  entityId?:    string;
}

// ─── GET /api/search?projectId=:id&q=:query ───────────────────────────────────
// Returns up to ~25 results grouped as chapter-title hits, text matches, entities.
// Rate limit: 60 requests / minute (debounced on the client, but still guarded server-side).

router.get('/',
  authenticateToken,
  rateLimit('search', 60, 60_000),
  async (req: any, res) => {
    try {
      const { projectId, q } = req.query as { projectId?: string; q?: string };

      if (!projectId || !isValidUUID(projectId))
        return res.status(400).json({ error: 'Valid projectId is required' });

      const query = q?.trim() ?? '';
      if (query.length < 2) return res.json({ results: [] });

      // ── Ownership check (serial — must complete before data queries) ──────
      const proj = await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, req.user.userId)));
      if (proj.length === 0) return res.status(403).json({ error: 'Access denied' });

      // Escape wildcards so user input is treated as a literal string by ILIKE.
      const escaped = escapeLike(query);
      const pattern = `%${escaped}%`;

      // ── Run all four data queries in parallel ─────────────────────────────
      const [titleMatches, contentMatches, entityMatches, allChapters] = await Promise.all([

        // 1. Chapter title matches
        db.select({
          id:    schema.chapters.id,
          title: schema.chapters.title,
          order: schema.chapters.order,
        })
        .from(schema.chapters)
        .where(and(
          eq(schema.chapters.projectId, projectId),
          ilike(schema.chapters.title, pattern)
        ))
        .orderBy(schema.chapters.order)
        .limit(5),

        // 2. Chapter content matches
        db.select({
          id:      schema.chapters.id,
          title:   schema.chapters.title,
          content: schema.chapters.content,
          order:   schema.chapters.order,
        })
        .from(schema.chapters)
        .where(and(
          eq(schema.chapters.projectId, projectId),
          ilike(schema.chapters.content, pattern)
        ))
        .orderBy(schema.chapters.order)
        .limit(10),

        // 3. Story Bible entity matches
        db.select({
          id:          schema.storyEntities.id,
          type:        schema.storyEntities.type,
          name:        schema.storyEntities.name,
          description: schema.storyEntities.description,
          chapterId:   schema.storyEntities.chapterId,
        })
        .from(schema.storyEntities)
        .where(and(
          eq(schema.storyEntities.projectId, projectId),
          ne(schema.storyEntities.status, 'rejected'),
          or(
            ilike(schema.storyEntities.name, pattern),
            ilike(schema.storyEntities.description, pattern)
          )
        ))
        .limit(10),

        // 4. All chapter ids+titles for entity → chapterTitle lookup
        db.select({ id: schema.chapters.id, title: schema.chapters.title })
          .from(schema.chapters)
          .where(eq(schema.chapters.projectId, projectId)),
      ]);

      const chapterMap   = new Map(allChapters.map(c => [c.id, c.title]));
      const titleMatchIds = new Set(titleMatches.map(c => c.id));

      // ── Assemble results ──────────────────────────────────────────────────
      const results: SearchResult[] = [];

      // Chapter title hits
      for (const ch of titleMatches) {
        results.push({
          id:           `chapter-${ch.id}`,
          type:         'chapter',
          title:        ch.title,
          snippet:      '',
          chapterId:    ch.id,
          chapterTitle: ch.title,
        });
      }

      // Text matches (deduplicate chapters already matched by title)
      for (const ch of contentMatches) {
        if (titleMatchIds.has(ch.id)) continue;
        results.push({
          id:           `text-${ch.id}`,
          type:         'text_match',
          title:        ch.title,
          snippet:      extractSnippet(ch.content, query),
          matchText:    extractMatchText(ch.content, query),
          chapterId:    ch.id,
          chapterTitle: ch.title,
        });
      }

      // Entity matches
      const validEntityTypes = new Set<string>(['character', 'location', 'item', 'rule']);
      for (const e of entityMatches) {
        const type = validEntityTypes.has(e.type)
          ? (e.type as 'character' | 'location' | 'item' | 'rule')
          : 'character';
        const chapterTitle = e.chapterId ? (chapterMap.get(e.chapterId) ?? null) : null;
        results.push({
          id:           `entity-${e.id}`,
          type,
          title:        e.name,
          snippet:      e.description ?? '',
          chapterId:    e.chapterId ?? null,
          chapterTitle,
          entityId:     e.id,
        });
      }

      res.json({ results });
    } catch (error) {
      console.error('Error in GET /search:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
