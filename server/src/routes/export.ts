/**
 * Project export endpoints — for writers to get their work out.
 *
 * GET /api/export/:projectId/markdown   → .md  (full project, one file)
 * GET /api/export/:projectId/txt        → .txt (plain text, no markdown)
 * GET /api/export/:projectId/docx       → .docx (formatted Word document)
 * GET /api/export/:projectId/backup     → .zip  (everything: md + docx + bible.json + metadata.json)
 * GET /api/export/all                   → .zip  (all user projects — for "I want my data")
 */

import express from 'express';
import JSZip from 'jszip';
import { Document, Paragraph, TextRun, HeadingLevel, Packer, PageBreak, AlignmentType } from 'docx';
import { pool } from '../db/client.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip HTML tags → plain text, preserving paragraph breaks */
function htmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** HTML → Markdown (minimal: bold, italic, headings, paragraphs) */
function htmlToMarkdown(html: string): string {
  if (!html) return '';
  return html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
    .replace(/<u[^>]*>(.*?)<\/u>/gi, '_$1_')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Filter chapters by export mode */
function filterChapters(chapters: any[], filter: 'all' | 'draft' | 'done'): any[] {
  if (filter === 'draft') return chapters.filter(c => c.status === 'draft');
  if (filter === 'done')  return chapters.filter(c => c.status === 'done');
  return chapters;
}

/** Build a Bible appendix section in Markdown */
function buildBibleMarkdown(entities: any[]): string {
  if (entities.length === 0) return '';
  const sections: Record<string, string[]> = { character: [], location: [], item: [], rule: [] };
  const labels: Record<string, string> = { character: 'Персонажи', location: 'Локации', item: 'Предметы', rule: 'Правила мира' };
  for (const e of entities) {
    if (sections[e.type]) {
      sections[e.type].push(`### ${e.name}\n${e.description ?? ''}`);
    }
  }
  const parts: string[] = ['\n\n---\n\n# Библия истории\n'];
  for (const [type, label] of Object.entries(labels)) {
    if (sections[type].length > 0) {
      parts.push(`\n## ${label}\n\n${sections[type].join('\n\n')}`);
    }
  }
  return parts.join('\n');
}

/** Build a Markdown string for the full project */
function buildMarkdown(project: any, chapters: any[], entities: any[] = [], includeBible = false): string {
  const lines: string[] = [];
  lines.push(`# ${project.title}`);
  if (project.genre) lines.push(`\n*Жанр: ${project.genre}*`);
  lines.push(`\n*Экспортировано: ${new Date().toLocaleDateString('ru-RU')}*\n`);
  lines.push('---\n');

  for (const ch of chapters) {
    lines.push(`## ${ch.title}\n`);
    lines.push(htmlToMarkdown(ch.content || ''));
    lines.push('\n---\n');
  }

  if (includeBible && entities.length > 0) {
    lines.push(buildBibleMarkdown(entities));
  }

  return lines.join('\n');
}

/** Build a DOCX Document from the project */
function buildDocx(project: any, chapters: any[], entities: any[] = [], includeBible = false): Document {
  const children: Paragraph[] = [];

  // Title page
  children.push(
    new Paragraph({
      text: project.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );
  if (project.genre) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: `Жанр: ${project.genre}`, italics: true, color: '666666' })],
        spacing: { after: 200 },
      })
    );
  }
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: `Экспортировано ${new Date().toLocaleDateString('ru-RU')}`,
        color: '999999', size: 20,
      })],
      spacing: { after: 800 },
    })
  );

  // Chapters
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];

    // Page break before each chapter (except the first)
    if (i > 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    // Chapter heading
    children.push(
      new Paragraph({
        text: ch.title,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 400 },
      })
    );

    // Chapter body — split by paragraphs
    const text = htmlToText(ch.content || '');
    const paragraphs = text.split('\n\n').filter(Boolean);

    for (const para of paragraphs) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: para.trim(), size: 24 })],
          spacing: { after: 200, line: 360 }, // 1.5× line spacing
        })
      );
    }
  }

  // Optional Story Bible appendix
  if (includeBible && entities.length > 0) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({
      text: 'Библия истории',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 400 },
    }));
    const labels: Record<string, string> = { character: 'Персонажи', location: 'Локации', item: 'Предметы', rule: 'Правила мира' };
    const grouped: Record<string, any[]> = {};
    for (const e of entities) { (grouped[e.type] = grouped[e.type] ?? []).push(e); }
    for (const [type, label] of Object.entries(labels)) {
      const group = grouped[type] ?? [];
      if (!group.length) continue;
      children.push(new Paragraph({
        text: label,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 200 },
      }));
      for (const e of group) {
        children.push(new Paragraph({
          children: [new TextRun({ text: e.name, bold: true, size: 24 })],
          spacing: { after: 80 },
        }));
        if (e.description) {
          children.push(new Paragraph({
            children: [new TextRun({ text: e.description, italics: true, size: 22, color: '444444' })],
            spacing: { after: 200 },
          }));
        }
      }
    }
  }

  return new Document({
    creator: 'Перо — Студия писателя',
    title: project.title,
    description: project.genre ?? '',
    sections: [{ children }],
    styles: {
      default: {
        document: {
          run: { font: 'Times New Roman', size: 24 },
        },
      },
    },
  });
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getProjectWithChapters(projectId: string, userId: string) {
  const { rows: projects } = await pool.query<any>(
    'SELECT * FROM projects WHERE id=$1 AND user_id=$2', [projectId, userId]
  );
  if (!projects[0]) return null;

  const { rows: chapters } = await pool.query<any>(
    'SELECT * FROM chapters WHERE project_id=$1 ORDER BY "order" ASC', [projectId]
  );

  const { rows: entities } = await pool.query<any>(
    `SELECT * FROM story_entities WHERE project_id=$1 AND status='approved' ORDER BY type, name`,
    [projectId]
  );

  return { project: projects[0], chapters, entities };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Routes ────────────────────────────────────────────────────────────────────

/** Shared query-param parsing for export routes */
function parseExportParams(query: any): { filter: 'all' | 'draft' | 'done'; includeBible: boolean } {
  const filter = ['draft', 'done'].includes(query.filter) ? query.filter as 'draft' | 'done' : 'all';
  const includeBible = query.bible === '1' || query.bible === 'true';
  return { filter, includeBible };
}

/** Build a date-stamped file base name. */
function buildFilename(title: string, suffix = ''): string {
  const safe = title.replace(/[^\w\s\u0400-\u04FF-]/g, '').trim();
  const date = new Date().toISOString().slice(0, 10);
  return suffix ? `${safe}-${suffix}-${date}` : `${safe}-${date}`;
}

/** GET /api/export/:projectId/markdown */
router.get('/:projectId/markdown', authenticateToken, async (req: any, res) => {
  const { projectId } = req.params;
  if (!UUID_RE.test(projectId)) return res.status(400).json({ error: 'Invalid project ID' });

  const data = await getProjectWithChapters(projectId, req.user.userId);
  if (!data) return res.status(404).json({ error: 'Project not found' });

  const { filter, includeBible } = parseExportParams(req.query);
  const chapters = filterChapters(data.chapters, filter);
  const markdown = buildMarkdown(data.project, chapters, data.entities, includeBible);
  const filename = `${buildFilename(data.project.title)}.md`;

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(markdown);
});

/** GET /api/export/:projectId/txt */
router.get('/:projectId/txt', authenticateToken, async (req: any, res) => {
  const { projectId } = req.params;
  if (!UUID_RE.test(projectId)) return res.status(400).json({ error: 'Invalid project ID' });

  const data = await getProjectWithChapters(projectId, req.user.userId);
  if (!data) return res.status(404).json({ error: 'Project not found' });

  const { filter } = parseExportParams(req.query);
  const chapters = filterChapters(data.chapters, filter);
  const lines: string[] = [`${data.project.title}\n${'─'.repeat(50)}\n`];
  for (const ch of chapters) {
    lines.push(`\n${ch.title}\n${'─'.repeat(30)}\n`);
    lines.push(htmlToText(ch.content || ''));
  }

  const txt = lines.join('\n');
  const filename = `${buildFilename(data.project.title)}.txt`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(txt);
});

/** GET /api/export/:projectId/docx */
router.get('/:projectId/docx', authenticateToken, async (req: any, res) => {
  const { projectId } = req.params;
  if (!UUID_RE.test(projectId)) return res.status(400).json({ error: 'Invalid project ID' });

  const data = await getProjectWithChapters(projectId, req.user.userId);
  if (!data) return res.status(404).json({ error: 'Project not found' });

  const { filter, includeBible } = parseExportParams(req.query);
  const chapters = filterChapters(data.chapters, filter);
  const doc = buildDocx(data.project, chapters, data.entities, includeBible);
  const buffer = await Packer.toBuffer(doc);
  const filename = `${buildFilename(data.project.title)}.docx`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buffer);
});

/** GET /api/export/:projectId/backup — full ZIP archive */
router.get('/:projectId/backup', authenticateToken, async (req: any, res) => {
  const { projectId } = req.params;
  if (!UUID_RE.test(projectId)) return res.status(400).json({ error: 'Invalid project ID' });

  const data = await getProjectWithChapters(projectId, req.user.userId);
  if (!data) return res.status(404).json({ error: 'Project not found' });

  const { project, entities } = data;
  const { filter } = parseExportParams(req.query);
  const chapters = filterChapters(data.chapters, filter);
  const zip = new JSZip();

  // Manuscript (MD and DOCX only for simplicity)
  zip.file('manuscript.md', buildMarkdown(project, chapters));
  
  const docBuffer = await Packer.toBuffer(buildDocx(project, chapters));
  zip.file('manuscript.docx', docBuffer);

  // Story Bible
  const bibleByType: Record<string, any[]> = {};
  for (const e of entities) {
    (bibleByType[e.type] = bibleByType[e.type] ?? []).push({
      name: e.name, description: e.description,
    });
  }
  zip.file('bible.json', JSON.stringify(bibleByType, null, 2));

  // Metadata
  const totalWords = chapters.reduce((s, c) => {
    return s + (htmlToText(c.content || '').split(/\s+/).filter(Boolean).length);
  }, 0);
  zip.file('metadata.json', JSON.stringify({
    exportedAt: new Date().toISOString(),
    project: {
      id: project.id, title: project.title, genre: project.genre,
      chapterCount: chapters.length, wordCount: totalWords,
      createdAt: project.created_at,
    },
    recovery: 'Для восстановления импортируйте файл manuscript.md через Перо → Импорт',
  }, null, 2));

  // README
  zip.file('README.txt', [
    `РЕЗЕРВНАЯ КОПИЯ — ${project.title}`,
    `Создана: ${new Date().toLocaleString('ru-RU')}`,
    '',
    'Содержимое:',
    '  manuscript.md    — полная рукопись в формате Markdown (для импорта обратно в Перо)',
    '  manuscript.docx  — полная рукопись в формате Word',
    '  bible.json       — Библия истории (персонажи, локации, предметы, правила)',
    '  metadata.json    — статистика и метаданные проекта',
    '',
    'Восстановление:',
    '  Откройте Перо → нажмите «Импорт» → выберите manuscript.md',
    '  Ваши главы будут восстановлены автоматически.',
    '',
    'Ваши данные надёжно хранятся в базе данных Перо.',
    'Этот архив — ваша локальная копия на случай любой ситуации.',
  ].join('\n'));

  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const filename = `${project.title.replace(/[^\w\s-]/g, '').trim()}-backup.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(zipBuffer);
});

/** GET /api/export/all — all user projects as one mega-ZIP */
router.get('/all', authenticateToken, async (req: any, res) => {
  const { rows: projects } = await pool.query<any>(
    `SELECT id, title FROM projects WHERE user_id=$1 AND status='active' ORDER BY created_at DESC`,
    [req.user.userId]
  );

  const zip = new JSZip();

  for (const p of projects) {
    const data = await getProjectWithChapters(p.id, req.user.userId);
    if (!data) continue;

    const folder = zip.folder(p.title.replace(/[^\w\s-]/g, '').trim() || p.id)!;
    folder.file('manuscript.md', buildMarkdown(data.project, data.chapters));
    folder.file('bible.json', JSON.stringify(data.entities, null, 2));
    const totalWords = data.chapters.reduce((s, c) =>
      s + htmlToText(c.content || '').split(/\s+/).filter(Boolean).length, 0);
    folder.file('metadata.json', JSON.stringify({
      title: data.project.title, genre: data.project.genre,
      chapterCount: data.chapters.length, wordCount: totalWords,
    }, null, 2));
  }

  zip.file('README.txt', [
    'ПОЛНАЯ РЕЗЕРВНАЯ КОПИЯ — Перо',
    `Создана: ${new Date().toLocaleString('ru-RU')}`,
    `Проектов: ${projects.length}`,
    '',
    'Каждая папка — один проект. Для восстановления:',
    '  Откройте Перо → Импорт → выберите manuscript.md нужного проекта.',
  ].join('\n'));

  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="pero-backup-${date}.zip"`);
  res.send(zipBuffer);
});

export default router;
