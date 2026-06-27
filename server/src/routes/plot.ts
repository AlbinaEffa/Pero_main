/**
 * Сюжет → «Линии»: сквозные сюжетные линии и «ружья Чехова».
 * Перо ЧИТАЕТ синопсисы глав (не генерит план) и выделяет линии: где введены,
 * где развиваются, разрешены ли. Незакрытые = «ружья Чехова».
 */
import express from 'express';
import { randomUUID } from 'crypto';
import { and, eq, asc, desc } from 'drizzle-orm';
import { authenticateToken, type AuthedRequest } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimiter.js';
import { aiQuota } from '../lib/quota.js';
import { guardChat } from '../lib/aiGuard.js';
import { getAIProvider } from '../lib/aiProvider.js';
import * as schema from '../db/schema.js';
import { db } from '../db/client.js';
import { isValidUUID, cleanJsonResponse, buildThreadsPrompt, buildBeatmapPrompt, buildArcsPrompt, buildDeliveryPrompt, BEAT_TEMPLATES } from '../lib/extraction.js';

const router = express.Router();
const ai = getAIProvider();

const KINDS = new Set(['main', 'subplot', 'mystery', 'promise', 'relationship']);
// Служебные разделы — вне сюжетного анализа.
const NON_NARRATIVE = new Set(['acknowledgments', 'dedication', 'foreword', 'afterword', 'part']);

async function ownsProject(projectId: string, userId: string): Promise<boolean> {
  if (!isValidUUID(projectId)) return false;
  const rows = await db.select({ id: schema.projects.id }).from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)));
  return rows.length > 0;
}

// Повествовательные главы с синопсисом + дайджест «N. «Заголовок»: синопсис».
async function chapterDigest(projectId: string) {
  const all = await db.select({
      id: schema.chapters.id, title: schema.chapters.title, order: schema.chapters.order,
      summary: schema.chapters.summary, chapterType: schema.chapters.chapterType,
    })
    .from(schema.chapters)
    .where(eq(schema.chapters.projectId, projectId))
    .orderBy(asc(schema.chapters.order));
  const narrative = all.filter(c => !NON_NARRATIVE.has(c.chapterType ?? 'chapter') && (c.summary ?? '').trim());
  const digest = narrative
    .map((c, i) => `${i + 1}. «${(c.title ?? '').trim() || `Глава ${i + 1}`}»: ${(c.summary ?? '').trim()}`)
    .join('\n');
  return { narrative, digest };
}

// Определение бит-шаблона: пресет ИЛИ кастомный (бит-архитектор).
type BeatDefList = { name: string; beats: { key: string; label: string; pct: number }[] };
async function resolveTemplate(projectId: string, key: string): Promise<BeatDefList | null> {
  if (BEAT_TEMPLATES[key]) return BEAT_TEMPLATES[key];
  const [row] = await db.select().from(schema.beatTemplates)
    .where(and(eq(schema.beatTemplates.projectId, projectId), eq(schema.beatTemplates.key, key))).limit(1);
  return row ? { name: row.name, beats: row.beats } : null;
}

// ── GET /api/plot/:projectId/threads — активные линии ────────────────────────
router.get('/:projectId/threads', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const { projectId } = req.params;
    if (!(await ownsProject(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });
    const rows = await db.select().from(schema.plotThreads)
      .where(and(eq(schema.plotThreads.projectId, projectId), eq(schema.plotThreads.userStatus, 'active')))
      .orderBy(asc(schema.plotThreads.createdAt));
    res.json({ threads: rows });
  } catch (error) {
    console.error('Error listing plot threads:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/plot/:projectId/threads/scan — извлечь линии из синопсисов ──────
router.post('/:projectId/threads/scan',
  authenticateToken, rateLimit('ai:threads-scan', 20, 60 * 60 * 1000), aiQuota,
  async (req: AuthedRequest, res) => {
  try {
    if (!ai) return res.status(503).json({ error: 'AI service is not configured' });
    const { projectId } = req.params;
    if (!(await ownsProject(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });

    const { narrative, digest } = await chapterDigest(projectId);
    if (narrative.length < 2) {
      return res.json({ threads: 0, reason: 'Мало глав с синопсисами — сначала дай Перу прочитать книгу.' });
    }

    const response = await guardChat(
      () => ai.generate({ contents: buildThreadsPrompt(digest), temperature: 0.2 }),
      { userId: req.user.userId, projectId, route: 'plot:threads', timeoutMs: 120_000 },
    );
    let parsed: any[] = [];
    try { const p = JSON.parse(cleanJsonResponse(response.text ?? '[]')); if (Array.isArray(p)) parsed = p; } catch { /* кривой JSON */ }

    const at = (n: any) => {
      const idx = Number(n) - 1;
      return Number.isInteger(idx) && idx >= 0 && idx < narrative.length ? narrative[idx] : null;
    };

    // Для резолва имён героев линии → сущности Мира.
    const charEntities = await db.select({ id: schema.storyEntities.id, name: schema.storyEntities.name })
      .from(schema.storyEntities)
      .where(and(eq(schema.storyEntities.projectId, projectId), eq(schema.storyEntities.type, 'character'), eq(schema.storyEntities.status, 'approved')));
    const charByName = new Map(charEntities.map(e => [e.name.trim().toLowerCase(), e]));

    const rows = parsed
      .filter(t => t && typeof t.title === 'string' && t.title.trim())
      .map(t => {
        const intro = at(t.introChapter);
        const last = at(t.lastChapter) ?? intro;
        const chapterIds = Array.isArray(t.chapters)
          ? [...new Set(t.chapters.map(at).filter(Boolean).map((c: any) => c.id))] as string[]
          : [];
        // Герои линии: нормализуем имена + резолвим в сущности (если есть в Мире).
        const names = Array.isArray(t.characters)
          ? [...new Set(t.characters.filter((n: any) => typeof n === 'string' && n.trim()).map((n: string) => n.trim().slice(0, 100)))] as string[]
          : [];
        const entityIds = [...new Set(names.map(n => charByName.get(n.toLowerCase())?.id).filter(Boolean))] as string[];
        return {
          projectId,
          title: t.title.trim().slice(0, 200),
          summary: (typeof t.summary === 'string' ? t.summary.trim().slice(0, 600) : '') || null,
          kind: KINDS.has(t.kind) ? t.kind : 'subplot',
          resolved: t.resolved === true,
          introChapterId: intro?.id ?? null,
          introChapterTitle: intro?.title ?? null,
          lastChapterId: last?.id ?? null,
          lastChapterTitle: last?.title ?? null,
          chapterIds: chapterIds.length ? chapterIds : (intro ? [intro.id] : []),
          characterNames: names,
          entityIds,
          origin: 'ai' as const,
          userStatus: 'active' as const,
        };
      });

    // Замена ТОЛЬКО ИИ-нитей (ручные план-нити автора переживают рентген).
    await db.delete(schema.plotThreads)
      .where(and(eq(schema.plotThreads.projectId, projectId), eq(schema.plotThreads.origin, 'ai')));
    if (rows.length > 0) await db.insert(schema.plotThreads).values(rows);

    res.json({ threads: rows.length });
  } catch (error) {
    console.error('Error scanning plot threads:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/plot/:projectId/beats?template=... — последняя бит-карта ─────────
router.get('/:projectId/beats', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const { projectId } = req.params;
    const template = String(req.query.template ?? 'romancing_the_beat');
    if (!(await ownsProject(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });
    const tpl = await resolveTemplate(projectId, template);
    if (!tpl) return res.status(400).json({ error: 'Unknown template' });
    const [row] = await db.select().from(schema.plotBeatmaps)
      .where(and(eq(schema.plotBeatmaps.projectId, projectId), eq(schema.plotBeatmaps.template, template)))
      .orderBy(desc(schema.plotBeatmaps.createdAt)).limit(1);
    res.json({ template, beats: row?.beats ?? null, definition: tpl.beats });
  } catch (error) {
    console.error('Error loading beatmap:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/plot/:projectId/beats/scan — реверс-детект битов ────────────────
router.post('/:projectId/beats/scan',
  authenticateToken, rateLimit('ai:beats-scan', 30, 60 * 60 * 1000), aiQuota,
  async (req: AuthedRequest, res) => {
  try {
    if (!ai) return res.status(503).json({ error: 'AI service is not configured' });
    const { projectId } = req.params;
    const template = String(req.body?.template ?? 'romancing_the_beat');
    if (!(await ownsProject(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });
    const tpl = await resolveTemplate(projectId, template);
    if (!tpl) return res.status(400).json({ error: 'Unknown template' });

    const { narrative, digest } = await chapterDigest(projectId);
    if (narrative.length < 2) return res.json({ beats: tpl.beats.map(b => ({ ...b, chapterId: null, chapterTitle: null })) });

    const response = await guardChat(
      () => ai.generate({ contents: buildBeatmapPrompt(tpl.beats, digest), temperature: 0.2 }),
      { userId: req.user.userId, projectId, route: 'plot:beats', timeoutMs: 120_000 },
    );
    let parsed: any[] = [];
    try { const p = JSON.parse(cleanJsonResponse(response.text ?? '[]')); if (Array.isArray(p)) parsed = p; } catch { /* кривой JSON */ }
    const byKey = new Map(parsed.filter(b => b && typeof b.key === 'string').map(b => [b.key, b]));

    const at = (n: any) => {
      const idx = Number(n) - 1;
      return Number.isInteger(idx) && idx >= 0 && idx < narrative.length ? narrative[idx] : null;
    };
    // Сохраняем авторские планы (рентген не затирает замысел).
    const [existing] = await db.select().from(schema.plotBeatmaps)
      .where(and(eq(schema.plotBeatmaps.projectId, projectId), eq(schema.plotBeatmaps.template, template)))
      .orderBy(desc(schema.plotBeatmaps.createdAt)).limit(1);
    const planByKey = new Map((existing?.beats ?? []).map(b => [b.key, b.plan ?? null]));
    const beats = tpl.beats.map(b => {
      const hit = byKey.get(b.key);
      const ch = hit ? at(hit.chapter) : null;
      return {
        key: b.key, label: b.label, pct: b.pct,
        plan: planByKey.get(b.key) ?? null,
        chapterId: ch?.id ?? null,
        chapterTitle: ch?.title ?? null,
        note: hit && typeof hit.note === 'string' ? hit.note.trim().slice(0, 300) : undefined,
      };
    });

    // Замена бит-карты этого шаблона.
    await db.delete(schema.plotBeatmaps)
      .where(and(eq(schema.plotBeatmaps.projectId, projectId), eq(schema.plotBeatmaps.template, template)));
    await db.insert(schema.plotBeatmaps).values({ projectId, template, beats });

    res.json({ template, beats });
  } catch (error) {
    console.error('Error scanning beatmap:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /api/plot/:projectId/beats — сохранить АВТОРСКИЙ план битов (до текста) ─
// Без ИИ: заполнение схемы-анкеты. Мердж планов в существующую бит-карту (или создаёт
// её из определения шаблона). Детект-поля (chapterId/note) не трогает.
router.put('/:projectId/beats', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const { projectId } = req.params;
    const template = String(req.body?.template ?? 'romancing_the_beat');
    const plans = (req.body?.plans ?? {}) as Record<string, unknown>;
    if (!(await ownsProject(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });
    const tpl = await resolveTemplate(projectId, template);
    if (!tpl) return res.status(400).json({ error: 'Unknown template' });

    const [existing] = await db.select().from(schema.plotBeatmaps)
      .where(and(eq(schema.plotBeatmaps.projectId, projectId), eq(schema.plotBeatmaps.template, template)))
      .orderBy(desc(schema.plotBeatmaps.createdAt)).limit(1);
    // База: существующая карта или пустые биты из определения шаблона.
    const base = existing?.beats ?? tpl.beats.map(b => ({ key: b.key, label: b.label, pct: b.pct, plan: null as string | null, chapterId: null, chapterTitle: null }));
    const beats = base.map(b => {
      if (Object.prototype.hasOwnProperty.call(plans, b.key)) {
        const v = plans[b.key];
        return { ...b, plan: typeof v === 'string' && v.trim() ? v.trim().slice(0, 600) : null };
      }
      return b;
    });

    await db.delete(schema.plotBeatmaps)
      .where(and(eq(schema.plotBeatmaps.projectId, projectId), eq(schema.plotBeatmaps.template, template)));
    await db.insert(schema.plotBeatmaps).values({ projectId, template, beats });

    res.json({ template, beats });
  } catch (error) {
    console.error('Error saving beat plans:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/plot/:projectId/templates — пресеты + кастомные бит-шаблоны ──────
router.get('/:projectId/templates', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const { projectId } = req.params;
    if (!(await ownsProject(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });
    const presets = Object.entries(BEAT_TEMPLATES).map(([id, t]) => ({ id, name: t.name, beats: t.beats, custom: false, rowId: null }));
    const customRows = await db.select().from(schema.beatTemplates)
      .where(eq(schema.beatTemplates.projectId, projectId)).orderBy(asc(schema.beatTemplates.createdAt));
    const custom = customRows.map(r => ({ id: r.key, name: r.name, beats: r.beats, custom: true, rowId: r.id }));
    res.json({ templates: [...presets, ...custom] });
  } catch (error) {
    console.error('Error listing templates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/plot/:projectId/templates — создать свой шаблон (бит-архитектор) ─
router.post('/:projectId/templates', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const { projectId } = req.params;
    if (!(await ownsProject(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 120) : '';
    const rawBeats = Array.isArray(req.body?.beats) ? req.body.beats : [];
    if (!name) return res.status(400).json({ error: 'Name is required' });
    // Нормализуем биты: ключ по индексу, label, pct 0..100, по возрастанию pct.
    const beats = rawBeats
      .filter((b: any) => b && typeof b.label === 'string' && b.label.trim())
      .map((b: any, i: number) => ({ key: `b${i}`, label: b.label.trim().slice(0, 80), pct: Math.max(0, Math.min(100, Math.round(Number(b.pct) || 0))) }))
      .sort((a: any, b: any) => a.pct - b.pct)
      .map((b: any, i: number) => ({ ...b, key: `b${i}` }));
    if (beats.length === 0) return res.status(400).json({ error: 'At least one beat is required' });

    const key = `custom:${randomUUID()}`;
    const [created] = await db.insert(schema.beatTemplates).values({ projectId, key, name, beats }).returning();
    res.status(201).json({ id: created.key, name: created.name, beats: created.beats, custom: true, rowId: created.id });
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/plot/:projectId/templates/:rowId — удалить свой шаблон ────────
router.delete('/:projectId/templates/:rowId', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const { projectId, rowId } = req.params;
    if (!isValidUUID(rowId)) return res.status(400).json({ error: 'Invalid id' });
    if (!(await ownsProject(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });
    const [row] = await db.select().from(schema.beatTemplates)
      .where(and(eq(schema.beatTemplates.id, rowId), eq(schema.beatTemplates.projectId, projectId)));
    if (!row) return res.status(404).json({ error: 'Not found' });
    await db.delete(schema.beatTemplates).where(eq(schema.beatTemplates.id, rowId));
    await db.delete(schema.plotBeatmaps).where(and(eq(schema.plotBeatmaps.projectId, projectId), eq(schema.plotBeatmaps.template, row.key)));
    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/plot/:projectId/arcs — арки персонажей ──────────────────────────
router.get('/:projectId/arcs', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const { projectId } = req.params;
    if (!(await ownsProject(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });
    const rows = await db.select().from(schema.characterArcs)
      .where(and(eq(schema.characterArcs.projectId, projectId), eq(schema.characterArcs.userStatus, 'active')))
      .orderBy(asc(schema.characterArcs.createdAt));
    res.json({ arcs: rows });
  } catch (error) {
    console.error('Error listing arcs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/plot/:projectId/arcs/scan — вывести арки главных героев ─────────
router.post('/:projectId/arcs/scan',
  authenticateToken, rateLimit('ai:arcs-scan', 20, 60 * 60 * 1000), aiQuota,
  async (req: AuthedRequest, res) => {
  try {
    if (!ai) return res.status(503).json({ error: 'AI service is not configured' });
    const { projectId } = req.params;
    if (!(await ownsProject(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });

    // Главные герои: персонажи со значимостью major/moderate (до 8).
    const chars = (await db.select().from(schema.storyEntities)
      .where(and(eq(schema.storyEntities.projectId, projectId), eq(schema.storyEntities.type, 'character'), eq(schema.storyEntities.status, 'approved'))))
      .filter(e => e.significance === 'major' || e.significance === 'moderate' || e.significance == null)
      .slice(0, 8);
    if (chars.length === 0) return res.json({ arcs: 0, reason: 'Нет главных героев в Мире — сначала дай Перу прочитать книгу.' });

    const { digest } = await chapterDigest(projectId);
    const charList = chars.map(c => `- ${c.name}${c.description ? `: ${c.description.slice(0, 200)}` : ''}`).join('\n');

    const response = await guardChat(
      () => ai.generate({ contents: buildArcsPrompt(charList, digest), temperature: 0.3 }),
      { userId: req.user.userId, projectId, route: 'plot:arcs', timeoutMs: 120_000 },
    );
    let parsed: any[] = [];
    try { const p = JSON.parse(cleanJsonResponse(response.text ?? '[]')); if (Array.isArray(p)) parsed = p; } catch { /* кривой JSON */ }

    const byName = new Map(chars.map(c => [c.name.trim().toLowerCase(), c]));
    const clean = (v: any) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim().slice(0, 400) : null);
    const rows = parsed
      .filter(a => a && typeof a.name === 'string' && a.name.trim())
      .map(a => {
        const ent = byName.get(a.name.trim().toLowerCase());
        return {
          projectId, entityId: ent?.id ?? null, entityName: (ent?.name ?? a.name).trim().slice(0, 200),
          want: clean(a.want), need: clean(a.need), ghost: clean(a.ghost), lie: clean(a.lie), truth: clean(a.truth),
          userStatus: 'active' as const,
        };
      })
      .filter(r => r.want || r.need || r.ghost || r.lie || r.truth);

    // Не трогаем правленые автором арки (режим архитектора переживает рентген).
    const editedIds = new Set((await db.select({ entityId: schema.characterArcs.entityId, entityName: schema.characterArcs.entityName })
      .from(schema.characterArcs)
      .where(and(eq(schema.characterArcs.projectId, projectId), eq(schema.characterArcs.userEdited, true))))
      .map(a => (a.entityId ?? a.entityName ?? '').toLowerCase()));
    const fresh = rows.filter(r => !editedIds.has((r.entityId ?? r.entityName ?? '').toLowerCase()));
    await db.delete(schema.characterArcs)
      .where(and(eq(schema.characterArcs.projectId, projectId), eq(schema.characterArcs.userEdited, false)));
    if (fresh.length > 0) await db.insert(schema.characterArcs).values(fresh);

    res.json({ arcs: fresh.length });
  } catch (error) {
    console.error('Error scanning arcs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /api/plot/arcs/:arcId — править арку вручную (переживает рентген) ──────
const ARC_FIELDS = ['want', 'need', 'ghost', 'lie', 'truth'] as const;
router.put('/arcs/:arcId', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const { arcId } = req.params;
    if (!isValidUUID(arcId)) return res.status(400).json({ error: 'Invalid id' });
    const rows = await db.select({ userId: schema.projects.userId })
      .from(schema.characterArcs)
      .innerJoin(schema.projects, eq(schema.characterArcs.projectId, schema.projects.id))
      .where(eq(schema.characterArcs.id, arcId));
    if (!rows.length || rows[0].userId !== req.user.userId) return res.status(403).json({ error: 'Not found or access denied' });

    const patch: Record<string, unknown> = { userEdited: true };
    for (const f of ARC_FIELDS) {
      const v = req.body?.[f];
      if (v !== undefined) patch[f] = typeof v === 'string' && v.trim() ? v.trim().slice(0, 400) : null;
    }
    await db.update(schema.characterArcs).set(patch).where(eq(schema.characterArcs.id, arcId));
    res.json({ ok: true });
  } catch (error) {
    console.error('Error updating arc:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/plot/:projectId/arcs — добавить арку героя вручную ──────────────
router.post('/:projectId/arcs', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const { projectId } = req.params;
    if (!(await ownsProject(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });
    const entityName = typeof req.body?.entityName === 'string' ? req.body.entityName.trim().slice(0, 200) : '';
    if (!entityName) return res.status(400).json({ error: 'entityName is required' });
    // Резолвим в сущность, если такая есть.
    const [ent] = await db.select({ id: schema.storyEntities.id }).from(schema.storyEntities)
      .where(and(eq(schema.storyEntities.projectId, projectId), eq(schema.storyEntities.name, entityName), eq(schema.storyEntities.type, 'character')));
    const [created] = await db.insert(schema.characterArcs)
      .values({ projectId, entityId: ent?.id ?? null, entityName, userEdited: true, userStatus: 'active' }).returning();
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating arc:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/plot/threads/:threadId — отклонить / отметить разрешённой ──────
router.patch('/threads/:threadId', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const { threadId } = req.params;
    if (!isValidUUID(threadId)) return res.status(400).json({ error: 'Invalid id' });
    const rows = await db.select({ userId: schema.projects.userId })
      .from(schema.plotThreads)
      .innerJoin(schema.projects, eq(schema.plotThreads.projectId, schema.projects.id))
      .where(eq(schema.plotThreads.id, threadId));
    if (!rows.length || rows[0].userId !== req.user.userId) return res.status(403).json({ error: 'Not found or access denied' });

    const { userStatus, resolved, title, summary, kind } = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (userStatus === 'active' || userStatus === 'dismissed') patch.userStatus = userStatus;
    if (typeof resolved === 'boolean') patch.resolved = resolved;
    if (typeof title === 'string' && title.trim()) patch.title = title.trim().slice(0, 200);
    if (typeof summary === 'string') patch.summary = summary.trim().slice(0, 600) || null;
    if (KINDS.has(kind)) patch.kind = kind;
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update' });

    await db.update(schema.plotThreads).set(patch).where(eq(schema.plotThreads.id, threadId));
    res.json({ ok: true });
  } catch (error) {
    console.error('Error updating plot thread:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/plot/:projectId/threads — создать ручную план-нить (до текста) ──
router.post('/:projectId/threads', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const { projectId } = req.params;
    if (!(await ownsProject(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 200) : '';
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const kind = KINDS.has(req.body?.kind) ? req.body.kind : 'subplot';
    const summary = typeof req.body?.summary === 'string' ? req.body.summary.trim().slice(0, 600) || null : null;
    const [created] = await db.insert(schema.plotThreads)
      .values({ projectId, title, kind, summary, origin: 'author', resolved: false, userStatus: 'active' })
      .returning();
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating plot thread:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/plot/:projectId/delivery/scan — «Доставил задуманное?» ──────────
// Сверяет АВТОРСКИЙ план (нити origin=author + арки userEdited + биты с планом)
// с прозой по синопсисам. Один ИИ-вызов. Транзиентный отчёт (не хранится).
router.post('/:projectId/delivery/scan',
  authenticateToken, rateLimit('ai:delivery-scan', 20, 60 * 60 * 1000), aiQuota,
  async (req: AuthedRequest, res) => {
  try {
    if (!ai) return res.status(503).json({ error: 'AI service is not configured' });
    const { projectId } = req.params;
    if (!(await ownsProject(projectId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });

    // Собираем авторские план-элементы из трёх линз «Сюжета».
    const [threads, arcs, beatmaps] = await Promise.all([
      db.select().from(schema.plotThreads).where(and(
        eq(schema.plotThreads.projectId, projectId), eq(schema.plotThreads.origin, 'author'), eq(schema.plotThreads.userStatus, 'active'))),
      db.select().from(schema.characterArcs).where(and(
        eq(schema.characterArcs.projectId, projectId), eq(schema.characterArcs.userEdited, true), eq(schema.characterArcs.userStatus, 'active'))),
      db.select().from(schema.plotBeatmaps).where(eq(schema.plotBeatmaps.projectId, projectId)),
    ]);

    type Item = { ref: string; type: 'thread' | 'arc' | 'beat'; label: string; detail: string };
    const items: Item[] = [];
    threads.forEach((t, i) => items.push({ ref: `T${i + 1}`, type: 'thread', label: t.title, detail: (t.summary ?? '').trim() }));
    arcs.forEach((a, i) => {
      const facets = [a.want && `хочет: ${a.want}`, a.need && `нужно: ${a.need}`, a.lie && `ложь: ${a.lie}`, a.truth && `истина: ${a.truth}`].filter(Boolean).join('; ');
      items.push({ ref: `A${i + 1}`, type: 'arc', label: `Арка: ${a.entityName}`, detail: facets });
    });
    let bi = 0;
    for (const bm of beatmaps) for (const b of (bm.beats ?? [])) {
      if (b.plan && b.plan.trim()) items.push({ ref: `B${++bi}`, type: 'beat', label: `Бит: ${b.label}`, detail: b.plan.trim() });
    }

    if (items.length === 0) {
      return res.json({ items: [], reason: 'Нет авторского плана. Распиши нити/арки/биты в «Сюжете», и Перо сверит их с прозой.' });
    }

    const { narrative, digest } = await chapterDigest(projectId);
    if (narrative.length < 2) {
      return res.json({ items: [], reason: 'Мало глав с синопсисами — сначала дай Перу прочитать книгу.' });
    }

    const planList = items.map(it => `[${it.ref}] (${it.type === 'thread' ? 'линия' : it.type === 'arc' ? 'арка' : 'бит'}) ${it.label}${it.detail ? ` — ${it.detail}` : ''}`).join('\n');
    const response = await guardChat(
      () => ai.generate({ contents: buildDeliveryPrompt(planList, digest), temperature: 0.2 }),
      { userId: req.user.userId, projectId, route: 'plot:delivery', timeoutMs: 120_000 },
    );
    let parsed: any[] = [];
    try { const p = JSON.parse(cleanJsonResponse(response.text ?? '[]')); if (Array.isArray(p)) parsed = p; } catch { /* кривой JSON */ }

    const verdictByRef = new Map<string, any>();
    for (const v of parsed) if (v && typeof v.ref === 'string') verdictByRef.set(v.ref.trim(), v);
    const at = (n: any) => { const idx = Number(n) - 1; return Number.isInteger(idx) && idx >= 0 && idx < narrative.length ? narrative[idx] : null; };
    const STATUSES = new Set(['delivered', 'partial', 'missing']);

    const result = items.map(it => {
      const v = verdictByRef.get(it.ref);
      const ch = v ? at(v.chapter) : null;
      return {
        ref: it.ref, type: it.type, label: it.label, detail: it.detail,
        status: v && STATUSES.has(v.status) ? v.status : 'missing',
        reason: v && typeof v.reason === 'string' ? v.reason.trim().slice(0, 400) : '',
        chapterId: ch?.id ?? null,
        chapterTitle: ch?.title ?? null,
      };
    });
    res.json({ items: result });
  } catch (error) {
    console.error('Error scanning delivery:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
