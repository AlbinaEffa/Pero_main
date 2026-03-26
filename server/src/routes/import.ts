import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import * as pdfParsePkg from 'pdf-parse';
const pdfParse: (buf: Buffer) => Promise<{ text: string }> =
  (pdfParsePkg as any).default ?? (pdfParsePkg as any);
import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';
// GoogleGenAI removed — entity extraction now happens in the job worker, not here
import * as schema from '../db/schema.js';
import { db } from '../db/client.js';
import { authenticateToken } from '../middleware/auth.js';
import { eq, and } from 'drizzle-orm';
import { enqueueJobs } from '../jobs/queue.js';
import { idempotency } from '../middleware/idempotency.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// AI client removed from import route — extraction runs via job worker

// ─── Text Extractors ──────────────────────────────────────────────────────────

async function extractTxt(buffer: Buffer): Promise<string> {
  // Try UTF-8, fall back to latin1 for legacy Russian encodings
  const text = buffer.toString('utf-8');
  if (text.includes('\uFFFD')) return buffer.toString('latin1');
  return text;
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text;
}

async function extractEpub(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);

  // Locate OPF manifest via META-INF/container.xml
  let opfPath: string | undefined;
  const containerXml = await zip.file('META-INF/container.xml')?.async('text');
  if (containerXml) {
    const match = containerXml.match(/full-path="([^"]+\.opf)"/i);
    if (match) opfPath = match[1];
  }
  if (!opfPath) {
    opfPath = Object.keys(zip.files).find(f => f.endsWith('.opf'));
  }
  if (!opfPath) return '';

  const opfContent = (await zip.file(opfPath)?.async('text')) ?? '';
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  // Build id → href map from manifest items
  const itemMap: Record<string, string> = {};
  for (const m of opfContent.matchAll(/<item[^>]+id="([^"]+)"[^>]+href="([^"]+)"[^>]*>/gi)) {
    itemMap[m[1]] = m[2];
  }

  // Walk spine in order
  const parts: string[] = [];
  for (const m of opfContent.matchAll(/<itemref[^>]+idref="([^"]+)"/gi)) {
    const href = itemMap[m[1]];
    if (!href) continue;
    // href might contain a fragment like chapter.html#anchor — strip it
    const filePath = opfDir + href.split('#')[0];
    const html = (await zip.file(filePath)?.async('text')) ?? '';
    const text = html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s{3,}/g, '\n\n')
      .trim();
    if (text) parts.push(text);
  }

  return parts.join('\n\n');
}

async function extractFb2(buffer: Buffer): Promise<string> {
  const xmlStr = buffer.toString('utf-8');
  let parsed: any;
  try {
    parsed = await parseStringPromise(xmlStr, { explicitArray: true });
  } catch {
    return xmlStr.replace(/<[^>]+>/g, ' ').replace(/\s{3,}/g, '\n\n');
  }

  const fb = parsed?.FictionBook;
  if (!fb) return xmlStr.replace(/<[^>]+>/g, ' ');

  const bodies: any[] = Array.isArray(fb.body) ? fb.body : fb.body ? [fb.body] : [];
  const textParts: string[] = [];

  function extractSection(sectionOrArr: any): void {
    const sections = Array.isArray(sectionOrArr) ? sectionOrArr : [sectionOrArr];
    for (const s of sections) {
      if (!s) continue;
      // Title
      if (s.title) {
        const titles = Array.isArray(s.title) ? s.title : [s.title];
        for (const t of titles) {
          const ps: any[] = Array.isArray(t.p) ? t.p : t.p ? [t.p] : [];
          const titleText = ps.map((p: any) => (typeof p === 'string' ? p : p._ ?? '')).join(' ').trim();
          if (titleText) textParts.push('\n' + titleText + '\n');
        }
      }
      // Paragraphs
      if (s.p) {
        const ps = Array.isArray(s.p) ? s.p : [s.p];
        for (const p of ps) {
          const text = (typeof p === 'string' ? p : p._ ?? '').trim();
          if (text) textParts.push(text);
        }
      }
      // Epigraph
      if (s.epigraph) {
        const epis = Array.isArray(s.epigraph) ? s.epigraph : [s.epigraph];
        for (const e of epis) {
          if (e.p) {
            const ps = Array.isArray(e.p) ? e.p : [e.p];
            for (const p of ps) {
              const text = (typeof p === 'string' ? p : p._ ?? '').trim();
              if (text) textParts.push(text);
            }
          }
        }
      }
      // Nested sections
      if (s.section) extractSection(s.section);
    }
  }

  for (const body of bodies) {
    if (body.section) extractSection(body.section);
  }

  return textParts.join('\n');
}

// ─── Chapter Splitter ─────────────────────────────────────────────────────────

const CHAPTER_RE =
  /^(?:Глава|ГЛАВА|Chapter|CHAPTER|Часть|ЧАСТЬ|Раздел|РАЗДЕЛ|Книга|КНИГА|Пролог|ПРОЛОГ|Эпилог|ЭПИЛОГ|Вступление|ВСТУПЛЕНИЕ)[\s\wА-ЯЁа-яё\d.,!?:IVXLCDMivxlcdm«»—–-]{0,100}$/gm;

interface ParsedChapter {
  index: number;
  title: string;
  content: string;
  wordCount: number;
  preview: string;
}

function countWords(text: string): number {
  const stripped = text.replace(/<[^>]*>/g, ' ').trim();
  if (!stripped) return 0;
  return stripped.split(/\s+/).length;
}

function splitIntoChapters(text: string): Omit<ParsedChapter, 'index' | 'preview'>[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // ── 1. Try heading-based split ──
  const matches: { index: number; heading: string }[] = [];
  let m: RegExpExecArray | null;
  CHAPTER_RE.lastIndex = 0;
  while ((m = CHAPTER_RE.exec(normalized)) !== null) {
    const heading = m[0].trim();
    if (heading.length > 2) matches.push({ index: m.index, heading });
  }

  if (matches.length >= 2) {
    const chapters: Omit<ParsedChapter, 'index' | 'preview'>[] = [];
    for (let i = 0; i < matches.length; i++) {
      const contentStart = matches[i].index + matches[i].heading.length;
      const contentEnd = i < matches.length - 1 ? matches[i + 1].index : normalized.length;
      const content = normalized.slice(contentStart, contentEnd).replace(/^\n+/, '').trimEnd();
      const wc = countWords(content);
      if (wc >= 10) chapters.push({ title: matches[i].heading, content, wordCount: wc });
    }
    if (chapters.length >= 2) return chapters;
  }

  // ── 2. Fallback: word-count chunks (~3000 words each) ──
  const TARGET_WORDS = 3000;
  const paragraphs = normalized.split(/\n{2,}/).filter(p => p.trim().length > 0);
  const chapters: Omit<ParsedChapter, 'index' | 'preview'>[] = [];
  let current: string[] = [];
  let wordCount = 0;
  let chapterNum = 1;

  for (const para of paragraphs) {
    const pw = countWords(para);
    if (wordCount > 0 && wordCount + pw > TARGET_WORDS) {
      const content = current.join('\n\n').trim();
      chapters.push({ title: `Глава ${chapterNum}`, content, wordCount });
      chapterNum++;
      current = [para];
      wordCount = pw;
    } else {
      current.push(para);
      wordCount += pw;
    }
  }
  if (current.length > 0) {
    const content = current.join('\n\n').trim();
    chapters.push({ title: `Глава ${chapterNum}`, content, wordCount: countWords(content) });
  }

  return chapters.length > 0
    ? chapters
    : [{ title: 'Глава 1', content: normalized.trim(), wordCount: countWords(normalized) }];
}

function detectTitle(text: string, filename: string): string {
  const CHAPTER_START = /^(?:Глава|ГЛАВА|Chapter|CHAPTER|Часть|ЧАСТЬ|Раздел|РАЗДЕЛ)/i;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 10)) {
    if (!CHAPTER_START.test(line) && line.length >= 3 && line.length <= 120) {
      return line;
    }
  }
  return filename.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Без названия';
}

// Background extraction is now handled by the job worker (src/jobs/worker.ts)
// This route just enqueues jobs and returns immediately.

// ─── POST /api/import/parse ───────────────────────────────────────────────────
// Accepts multipart/form-data with a `file` field.
// Returns { title, totalWords, chapters: ParsedChapter[] }

router.post('/parse', authenticateToken, upload.single('file'), async (req: any, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { originalname, buffer } = req.file;
    const ext = (originalname.split('.').pop() ?? '').toLowerCase();

    let text = '';
    try {
      if (ext === 'txt')       text = await extractTxt(buffer);
      else if (ext === 'docx') text = await extractDocx(buffer);
      else if (ext === 'pdf')  text = await extractPdf(buffer);
      else if (ext === 'epub') text = await extractEpub(buffer);
      else if (ext === 'fb2')  text = await extractFb2(buffer);
      else return res.status(400).json({ error: `Формат .${ext} не поддерживается` });
    } catch (e) {
      console.error(`Parse error for .${ext}:`, e);
      return res.status(422).json({ error: `Не удалось прочитать файл. Убедитесь, что он не повреждён.` });
    }

    if (!text.trim()) return res.status(422).json({ error: 'Файл пустой или не содержит текста.' });

    const rawChapters = splitIntoChapters(text);
    const detectedTitle = detectTitle(text, originalname);
    const totalWords = rawChapters.reduce((s, c) => s + c.wordCount, 0);

    res.json({
      title: detectedTitle,
      totalWords,
      chapters: rawChapters.map((c, i) => ({
        index: i,
        title: c.title,
        content: c.content,
        wordCount: c.wordCount,
        preview: c.content.slice(0, 220).trimEnd() + (c.content.length > 220 ? '…' : ''),
      })),
    });
  } catch (error) {
    console.error('Error in POST /import/parse:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/import/create ──────────────────────────────────────────────────
// Body: { title, genre, color, chapters: [{title, content}] }
// Creates project + chapters in one transaction, fires background extraction.
// Returns { project, firstChapterId }

router.post('/create', authenticateToken, idempotency(), async (req: any, res) => {
  try {
    const { title, genre, color, chapters } = req.body;

    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
    if (!Array.isArray(chapters) || chapters.length === 0) {
      return res.status(400).json({ error: 'chapters must be a non-empty array' });
    }

    const chaptersToInsert = (chapters as { title: string; content: string }[]).slice(0, 100);

    const { project, insertedChapters } = await db.transaction(async (tx) => {
      const [project] = await tx.insert(schema.projects).values({
        userId: req.user.userId,
        title: title.trim(),
        genre: genre || null,
        color: color || '#3A4F41',
        status: 'active',
      }).returning();

      const insertedChapters = await tx.insert(schema.chapters).values(
        chaptersToInsert.map((c, i) => ({
          projectId: project.id,
          title: c.title || `Глава ${i + 1}`,
          content: c.content || '',
          order: i,
        }))
      ).returning();

      return { project, insertedChapters };
    });

    // Enqueue entity extraction + embedding jobs for each chapter — survives restarts
    const jobItems = insertedChapters.flatMap(c => {
      const plainContent = c.content || '';
      const wordCount = plainContent.split(/\s+/).filter(Boolean).length;
      if (wordCount < 50) return [];
      return [
        {
          type: 'extract_entities' as const,
          payload: { chapterId: c.id, content: plainContent },
          projectId: project.id,
          userId: req.user.userId,
        },
        {
          type: 'embed_chapter' as const,
          payload: { chapterId: c.id, content: plainContent },
          projectId: project.id,
          userId: req.user.userId,
        },
      ];
    });

    let jobIds: string[] = [];
    let processingStarted = true;
    try {
      jobIds = await enqueueJobs(jobItems);
    } catch (e) {
      // Non-fatal — project was created successfully; jobs can be re-enqueued later
      console.warn('[import] Failed to enqueue jobs:', e);
      processingStarted = false;
    }

    res.status(201).json({
      project,
      firstChapterId: insertedChapters[0]?.id ?? null,
      jobCount: jobIds.length,
      processingStarted,
      ...(processingStarted ? {} : {
        processingWarning: 'Фоновая обработка не запущена. Используйте повторную постановку задач на странице проекта.',
      }),
    });
  } catch (error) {
    console.error('Error in POST /import/create:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
