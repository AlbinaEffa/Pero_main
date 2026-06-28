/**
 * Серии (Этап E1, вариант A) — контейнер над книгами. Сущности остаются в книгах; серия лишь
 * группирует и упорядочивает их. Книга может быть вне серии (projects.series_id = null).
 *
 * /api/series:
 *   GET    /                      — список серий пользователя
 *   POST   /                      — создать серию { title }
 *   PATCH  /:seriesId             — переименовать { title }
 *   DELETE /:seriesId             — удалить серию (книги остаются, series_id → null)
 *   POST   /:seriesId/books       — добавить книгу в серию { projectId } (в конец)
 *   DELETE /:seriesId/books/:projectId — убрать книгу из серии
 *   PUT    /:seriesId/order        — переупорядочить книги { ids: string[] }
 */
import express from 'express';
import { eq, and, inArray, asc, sql } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { db, pool } from '../db/client.js';
import { authenticateToken, type AuthedRequest } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimiter.js';
import { aiQuota } from '../lib/quota.js';
import { guardChat } from '../lib/aiGuard.js';
import { getAIProvider } from '../lib/aiProvider.js';
import { normalizeNameRu, cleanJsonResponse } from '../lib/extraction.js';
import { buildFranchiseXrayPrompt } from '../lib/plotPrompts.js';

const router = express.Router();
const ai = getAIProvider();
const SIG_RANK: Record<string, number> = { major: 0, moderate: 1, minor: 2 };
// Служебные разделы — вне сюжетного анализа.
const NON_NARRATIVE = new Set(['acknowledgments', 'dedication', 'foreword', 'afterword', 'part']);

async function ownsSeries(seriesId: string, userId: string) {
  const [row] = await db.select().from(schema.series)
    .where(and(eq(schema.series.id, seriesId), eq(schema.series.userId, userId)));
  return row ?? null;
}

// GET / — серии пользователя (книги группирует дашборд из своего списка проектов по series_id)
router.get('/', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const rows = await db.select().from(schema.series)
      .where(eq(schema.series.userId, req.user.userId))
      .orderBy(asc(schema.series.createdAt));
    res.json({ series: rows });
  } catch (e) { console.error('series list', e); res.status(500).json({ error: 'Internal server error' }); }
});

// POST / — создать серию
router.post('/', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const title = (req.body?.title ?? '').trim();
    if (!title) return res.status(400).json({ error: 'Title required' });
    const [row] = await db.insert(schema.series)
      .values({ userId: req.user.userId, title }).returning();
    res.json({ series: row });
  } catch (e) { console.error('series create', e); res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /:seriesId — переименовать + вёдра замысла (премис/лор/герои/слоты-план)
router.patch('/:seriesId', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    if (!(await ownsSeries(req.params.seriesId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });
    const b = req.body ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (b.title !== undefined) { const t = String(b.title).trim(); if (!t) return res.status(400).json({ error: 'Title required' }); patch.title = t; }
    if (b.premise !== undefined) patch.premise = (b.premise ?? '').trim() || null;
    if (b.lore !== undefined) patch.lore = (b.lore ?? '').trim() || null;
    if (b.castNotes !== undefined) patch.castNotes = (b.castNotes ?? '').trim() || null;
    if (Array.isArray(b.plannedBooks)) patch.plannedBooks = b.plannedBooks.slice(0, 50);
    if (Array.isArray(b.franchiseThreads)) patch.franchiseThreads = b.franchiseThreads.slice(0, 50);
    const [row] = await db.update(schema.series).set(patch)
      .where(eq(schema.series.id, req.params.seriesId)).returning();
    res.json({ series: row });
  } catch (e) { console.error('series patch', e); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /:seriesId — одна серия (вёдра замысла) + её написанные книги по порядку (рабочее пространство)
router.get('/:seriesId', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const s = await ownsSeries(req.params.seriesId, req.user.userId);
    if (!s) return res.status(403).json({ error: 'Access denied' });
    const books = await db.select({ id: schema.projects.id, title: schema.projects.title, order: schema.projects.seriesOrder, status: schema.projects.status })
      .from(schema.projects).where(eq(schema.projects.seriesId, s.id)).orderBy(asc(schema.projects.seriesOrder));
    res.json({ series: s, books });
  } catch (e) { console.error('series get', e); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /:seriesId/books/create — создать НОВУЮ книгу в серии (следующий номер). Опц. из слота-плана.
// title из слота или тела; премис книги сидируется из about слота. Возвращает project для открытия.
router.post('/:seriesId/books/create', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const s = await ownsSeries(req.params.seriesId, req.user.userId);
    if (!s) return res.status(403).json({ error: 'Access denied' });
    const slotId: string | undefined = req.body?.slotId;
    const slots = (Array.isArray(s.plannedBooks) ? s.plannedBooks : []) as { id: string; title: string; about?: string }[];
    const slot = slotId ? slots.find(x => x.id === slotId) : undefined;
    const [{ maxOrder }] = await db.select({ maxOrder: sql<number>`COALESCE(MAX(${schema.projects.seriesOrder}),0)`.mapWith(Number) })
      .from(schema.projects).where(eq(schema.projects.seriesId, s.id));
    const order = (maxOrder ?? 0) + 1;
    const title = (req.body?.title ?? slot?.title ?? `Книга ${order}`).toString().trim() || `Книга ${order}`;
    const { project } = await db.transaction(async (tx) => {
      const [project] = await tx.insert(schema.projects).values({
        userId: req.user.userId, title, status: 'active',
        seriesId: s.id, seriesOrder: order, premise: slot?.about?.trim() || null,
      }).returning();
      await tx.insert(schema.chapters).values({ projectId: project.id, title: 'Глава 1', content: '' });
      if (slot) {
        await tx.update(schema.series).set({ plannedBooks: slots.filter(x => x.id !== slotId), updatedAt: new Date() })
          .where(eq(schema.series.id, s.id)); // слот «материализован» — убрать из плана
      }
      return { project };
    });
    res.status(201).json({ project });
  } catch (e) { console.error('series book create', e); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /continue/:projectId — «Написать продолжение»: завести серию из книги, если её нет (книга=#1),
// создать следующую пустую книгу и вернуть, куда идти. Ярлык в рабочее пространство.
router.post('/continue/:projectId', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const [book] = await db.select().from(schema.projects)
      .where(and(eq(schema.projects.id, req.params.projectId), eq(schema.projects.userId, req.user.userId)));
    if (!book) return res.status(403).json({ error: 'Access denied' });
    let seriesId = book.seriesId;
    if (!seriesId) {
      const [srow] = await db.insert(schema.series).values({ userId: req.user.userId, title: book.title }).returning();
      seriesId = srow.id;
      await db.update(schema.projects).set({ seriesId, seriesOrder: 1, updatedAt: new Date() }).where(eq(schema.projects.id, book.id));
    }
    const [{ maxOrder }] = await db.select({ maxOrder: sql<number>`COALESCE(MAX(${schema.projects.seriesOrder}),0)`.mapWith(Number) })
      .from(schema.projects).where(eq(schema.projects.seriesId, seriesId));
    const order = (maxOrder ?? 0) + 1;
    const { project } = await db.transaction(async (tx) => {
      const [project] = await tx.insert(schema.projects).values({
        userId: req.user.userId, title: `Книга ${order}`, status: 'active', seriesId, seriesOrder: order,
      }).returning();
      await tx.insert(schema.chapters).values({ projectId: project.id, title: 'Глава 1', content: '' });
      return { project };
    });
    res.status(201).json({ seriesId, project });
  } catch (e) { console.error('series continue', e); res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /:seriesId — удалить серию (книги отвязываются через FK ON DELETE SET NULL)
router.delete('/:seriesId', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    if (!(await ownsSeries(req.params.seriesId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });
    await db.update(schema.projects).set({ seriesOrder: null })
      .where(eq(schema.projects.seriesId, req.params.seriesId)); // подчистить порядок
    await db.delete(schema.series).where(eq(schema.series.id, req.params.seriesId));
    res.json({ ok: true });
  } catch (e) { console.error('series delete', e); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /:seriesId/books — добавить книгу в серию (в конец)
router.post('/:seriesId/books', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    if (!(await ownsSeries(req.params.seriesId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });
    const projectId = req.body?.projectId;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });
    const [proj] = await db.select().from(schema.projects)
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, req.user.userId)));
    if (!proj) return res.status(403).json({ error: 'Access denied' });
    const [{ maxOrder }] = await db.select({
      maxOrder: sql<number>`COALESCE(MAX(${schema.projects.seriesOrder}), 0)`.mapWith(Number),
    }).from(schema.projects).where(eq(schema.projects.seriesId, req.params.seriesId));
    await db.update(schema.projects)
      .set({ seriesId: req.params.seriesId, seriesOrder: (maxOrder ?? 0) + 1, updatedAt: new Date() })
      .where(eq(schema.projects.id, projectId));
    res.json({ ok: true });
  } catch (e) { console.error('series add book', e); res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /:seriesId/books/:projectId — убрать книгу из серии
router.delete('/:seriesId/books/:projectId', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    if (!(await ownsSeries(req.params.seriesId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });
    await db.update(schema.projects).set({ seriesId: null, seriesOrder: null, updatedAt: new Date() })
      .where(and(eq(schema.projects.id, req.params.projectId), eq(schema.projects.seriesId, req.params.seriesId)));
    res.json({ ok: true });
  } catch (e) { console.error('series remove book', e); res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /:seriesId/order — переупорядочить книги серии по массиву id
router.put('/:seriesId/order', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    if (!(await ownsSeries(req.params.seriesId, req.user.userId))) return res.status(403).json({ error: 'Access denied' });
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) return res.status(400).json({ error: 'ids required' });
    // обновляем порядок только у книг, реально принадлежащих этой серии
    const owned = await db.select({ id: schema.projects.id }).from(schema.projects)
      .where(and(eq(schema.projects.seriesId, req.params.seriesId), inArray(schema.projects.id, ids)));
    const ownedSet = new Set(owned.map(o => o.id));
    let order = 1;
    for (const id of ids) {
      if (!ownedSet.has(id)) continue;
      await db.update(schema.projects).set({ seriesOrder: order++ }).where(eq(schema.projects.id, id));
    }
    res.json({ ok: true });
  } catch (e) { console.error('series reorder', e); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /:seriesId/bible — единый каталог Мира через все книги серии (Этап E2).
// Сущности одноимённого типа из разных книг сливаются в одну запись (по normalizeNameRu),
// показываем, в каких книгах герой/локация встречается. Канон-описание — самое полное.
router.get('/:seriesId/bible', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const s = await ownsSeries(req.params.seriesId, req.user.userId);
    if (!s) return res.status(403).json({ error: 'Access denied' });
    const bookRows = await db.select({
        id: schema.projects.id, title: schema.projects.title, order: schema.projects.seriesOrder,
        snapshot: schema.projects.worldSnapshot, snapshotAt: schema.projects.worldSnapshotAt,
      })
      .from(schema.projects).where(eq(schema.projects.seriesId, s.id)).orderBy(asc(schema.projects.seriesOrder));
    const books = bookRows.map(b => ({
      id: b.id, title: b.title, order: b.order,
      snapshotAt: b.snapshotAt, snapshotCount: Array.isArray(b.snapshot) ? b.snapshot.length : 0,
    }));
    if (books.length === 0) return res.json({ series: { id: s.id, title: s.title }, books: [], entities: [] });

    const bookMeta = new Map(books.map(b => [b.id, b]));
    const ents = await db.select({
        id: schema.storyEntities.id, projectId: schema.storyEntities.projectId,
        type: schema.storyEntities.type, name: schema.storyEntities.name,
        description: schema.storyEntities.description, significance: schema.storyEntities.significance,
      })
      .from(schema.storyEntities)
      .where(and(inArray(schema.storyEntities.projectId, books.map(b => b.id)), eq(schema.storyEntities.status, 'approved')));

    type Grp = { type: string; name: string; description: string; significance: string | null;
      books: { projectId: string; title: string | null; order: number | null; entityId: string }[] };
    const groups = new Map<string, Grp>();
    for (const e of ents) {
      const key = `${e.type}|${normalizeNameRu(e.name)}`;
      let g = groups.get(key);
      if (!g) { g = { type: e.type, name: e.name, description: e.description ?? '', significance: e.significance ?? 'minor', books: [] }; groups.set(key, g); }
      if ((SIG_RANK[e.significance ?? 'minor'] ?? 2) < (SIG_RANK[g.significance ?? 'minor'] ?? 2)) g.significance = e.significance ?? 'minor';
      if ((e.description ?? '').length > g.description.length) { g.description = e.description ?? ''; g.name = e.name; } // самое полное описание = канон
      const bm = bookMeta.get(e.projectId);
      g.books.push({ projectId: e.projectId, title: bm?.title ?? null, order: bm?.order ?? null, entityId: e.id });
    }
    const entities = [...groups.values()].map(g => ({ ...g, books: g.books.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) }));
    res.json({ series: { id: s.id, title: s.title }, books, entities });
  } catch (e) { console.error('series bible', e); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /:seriesId/contradictions — нестыковки по ВСЕЙ серии (грань зума «Серия» в рельсе «Сверка»).
// Открытые issues из ПОСЛЕДНЕГО отчёта каждой книги серии + метка книги (cross-book ров).
router.get('/:seriesId/contradictions', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const s = await ownsSeries(req.params.seriesId, req.user.userId);
    if (!s) return res.status(403).json({ error: 'Access denied' });
    const books = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.seriesId, s.id));
    if (books.length === 0) return res.json({ issues: [] });
    const { rows } = await pool.query(
      `SELECT ci.id, ci.project_id AS "projectId", ci.chapter_id AS "chapterId", ci.entity_name AS "entityName",
              ci.issue, ci.quote, ci.severity, ci.kind, ci.status,
              p.title AS "bookTitle", p.series_order AS "bookOrder"
         FROM contradiction_issues ci
         JOIN projects p ON p.id = ci.project_id
        WHERE ci.project_id = ANY($1) AND ci.status = 'open'
          AND ci.report_id = (
            SELECT r.id FROM contradiction_reports r
             WHERE r.project_id = ci.project_id ORDER BY r.created_at DESC LIMIT 1)
        ORDER BY p.series_order NULLS LAST, ci.created_at DESC`,
      [books.map(b => b.id)],
    );
    res.json({ issues: rows });
  } catch (e) { console.error('series contradictions', e); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /:seriesId/pov — сквозная согласованность POV-рассказчиков по серии (Фаза 4, без AI).
// Детерминированно: POV-герои каждой книги + флаг ВАРИАНТОВ имени одного рассказчика между
// книгами (нормализованное написание совпадает, а буквальное — нет: «Риз» в кн.1 / «Ризанд»
// в кн.2). Это межкнижный дедуп POV — чтобы один герой не вёл серию под разными именами.
router.get('/:seriesId/pov', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const s = await ownsSeries(req.params.seriesId, req.user.userId);
    if (!s) return res.status(403).json({ error: 'Access denied' });
    const books = await db.select({ id: schema.projects.id, title: schema.projects.title, order: schema.projects.seriesOrder })
      .from(schema.projects).where(eq(schema.projects.seriesId, s.id)).orderBy(asc(schema.projects.seriesOrder));
    if (books.length === 0) return res.json({ books: [], variants: [] });

    const { rows } = await pool.query<{ project_id: string; pov: string; n: number }>(
      `SELECT project_id, pov_character AS pov, COUNT(*)::int AS n
         FROM chapters
        WHERE project_id = ANY($1) AND pov_character IS NOT NULL AND pov_character <> 'Автор'
        GROUP BY project_id, pov_character`,
      [books.map(b => b.id)],
    );

    const bookTitle = new Map(books.map(b => [b.id, b.title]));
    const perBook = books.map(b => ({
      projectId: b.id, bookTitle: b.title, order: b.order,
      pov: rows.filter(r => r.project_id === b.id).map(r => ({ name: r.pov, chapters: r.n })).sort((a, c) => c.chapters - a.chapters),
    }));

    // Варианты одного имени между книгами: группируем по нормализованному написанию.
    const byNorm = new Map<string, Map<string, Set<string>>>(); // norm → (spelling → set книг)
    for (const r of rows) {
      const norm = normalizeNameRu(r.pov);
      if (!norm) continue;
      if (!byNorm.has(norm)) byNorm.set(norm, new Map());
      const sp = byNorm.get(norm)!;
      if (!sp.has(r.pov)) sp.set(r.pov, new Set());
      sp.get(r.pov)!.add(r.project_id);
    }
    const variants = [...byNorm.values()]
      .filter(sp => sp.size > 1) // одно нормализованное имя записано по-разному
      .map(sp => ({
        spellings: [...sp.entries()].map(([name, ids]) => ({
          name, books: [...ids].map(id => bookTitle.get(id) ?? null),
        })),
      }));

    res.json({ books: perBook, variants });
  } catch (e) { console.error('series pov', e); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /:seriesId/books/:projectId/snapshot — заморозить «состояние мира на конец книги» (Этап E4).
// Снимок выводится из Мира ДЕТЕРМИНИРОВАННО (без AI): значимые сущности + их финальный статус
// (последнее событие типа 'status' по порядку глав). Старт-канон для следующей книги серии.
router.post('/:seriesId/books/:projectId/snapshot', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const s = await ownsSeries(req.params.seriesId, req.user.userId);
    if (!s) return res.status(403).json({ error: 'Access denied' });
    const [proj] = await db.select({ id: schema.projects.id }).from(schema.projects)
      .where(and(eq(schema.projects.id, req.params.projectId), eq(schema.projects.seriesId, s.id), eq(schema.projects.userId, req.user.userId)));
    if (!proj) return res.status(403).json({ error: 'Book not in this series' });

    const ents = await db.select({
        id: schema.storyEntities.id, type: schema.storyEntities.type, name: schema.storyEntities.name,
        significance: schema.storyEntities.significance,
      })
      .from(schema.storyEntities)
      .where(and(eq(schema.storyEntities.projectId, proj.id), eq(schema.storyEntities.status, 'approved'),
        inArray(schema.storyEntities.significance, ['major', 'moderate'])));

    // финальный статус каждой сущности: последнее status-событие по порядку глав
    const { rows } = await pool.query<{ entity_id: string; state: string | null }>(
      `SELECT DISTINCT ON (ee.entity_id) ee.entity_id, COALESCE(ee.description, ee.title) AS state
         FROM entity_events ee LEFT JOIN chapters c ON c.id = ee.chapter_id
        WHERE ee.project_id = $1 AND ee.event_type = 'status'
        ORDER BY ee.entity_id, c."order" DESC NULLS LAST, ee.created_at DESC`,
      [proj.id],
    );
    const stateById = new Map(rows.map(r => [r.entity_id, r.state]));
    const snapshot = ents
      .sort((a, b) => (a.significance === 'major' ? 0 : 1) - (b.significance === 'major' ? 0 : 1) || a.name.localeCompare(b.name, 'ru'))
      .map(e => ({ name: e.name, type: e.type, significance: e.significance, state: stateById.get(e.id) ?? null }));

    const at = new Date();
    await db.update(schema.projects).set({ worldSnapshot: snapshot, worldSnapshotAt: at, updatedAt: at })
      .where(eq(schema.projects.id, proj.id));
    res.json({ ok: true, count: snapshot.length, at, snapshot });
  } catch (e) { console.error('series snapshot', e); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /:seriesId/threads/xray — рентген нитей франшизы по НАПИСАННЫМ книгам.
// Перо читает синопсисы книг серии и судит статус каждой нити: провисает/в работе/отыграна.
// Один ИИ-вызов. Транзиентный отчёт (статусы не хранятся — авторский план в franchiseThreads жив).
router.post('/:seriesId/threads/xray',
  authenticateToken, rateLimit('ai:franchise-xray', 20, 60 * 60 * 1000), aiQuota,
  async (req: AuthedRequest, res) => {
  try {
    if (!ai) return res.status(503).json({ error: 'AI service is not configured' });
    const s = await ownsSeries(req.params.seriesId, req.user.userId);
    if (!s) return res.status(403).json({ error: 'Access denied' });

    const threads = (s.franchiseThreads ?? []).filter(t => t.title?.trim());
    if (threads.length === 0) {
      return res.json({ statuses: [], reason: 'Нет нитей франшизы. Распиши их на холсте серии, и Перо сверит с книгами.' });
    }

    // Написанные книги серии по порядку + их синопсисы.
    const books = await db.select({ id: schema.projects.id, title: schema.projects.title, order: schema.projects.seriesOrder })
      .from(schema.projects)
      .where(and(eq(schema.projects.seriesId, s.id), eq(schema.projects.status, 'active')))
      .orderBy(asc(schema.projects.seriesOrder));
    if (books.length === 0) {
      return res.json({ statuses: [], reason: 'В серии пока нет написанных книг — рентгену нечего читать.' });
    }

    const chapters = await db.select({ projectId: schema.chapters.projectId, title: schema.chapters.title, order: schema.chapters.order, summary: schema.chapters.summary, chapterType: schema.chapters.chapterType })
      .from(schema.chapters)
      .where(inArray(schema.chapters.projectId, books.map(b => b.id)))
      .orderBy(asc(schema.chapters.order));
    const byBook = new Map<string, typeof chapters>();
    chapters.forEach(c => { if (!byBook.has(c.projectId)) byBook.set(c.projectId, []); byBook.get(c.projectId)!.push(c); });

    const bookBlocks: string[] = [];
    books.forEach((b, bi) => {
      const cs = (byBook.get(b.id) ?? []).filter(c => !NON_NARRATIVE.has(c.chapterType ?? 'chapter') && (c.summary ?? '').trim());
      if (cs.length === 0) return;
      const lines = cs.map((c, i) => `  ${i + 1}. «${(c.title ?? '').trim() || `Глава ${i + 1}`}»: ${(c.summary ?? '').trim()}`).join('\n');
      bookBlocks.push(`=== КНИГА ${bi + 1}: «${(b.title ?? '').trim() || `Книга ${bi + 1}`}» ===\n${lines}`);
    });
    if (bookBlocks.length === 0) {
      return res.json({ statuses: [], reason: 'У книг серии ещё нет синопсисов — сначала дай Перу прочитать главы.' });
    }

    const threadList = threads.map((t, i) =>
      `[T${i + 1}] «${t.title.trim()}»${t.opensBook ? ` · откр. кн.${t.opensBook}` : ''}${t.closesBook ? ` · закр. кн.${t.closesBook}` : ''}${t.summary?.trim() ? ` — ${t.summary.trim()}` : ''}`,
    ).join('\n');

    const response = await guardChat(
      () => ai.generate({ contents: buildFranchiseXrayPrompt(threadList, bookBlocks.join('\n\n')), temperature: 0.2 }),
      { userId: req.user.userId, projectId: books[0].id, route: 'series:franchise-xray', timeoutMs: 120_000 },
    );
    let parsed: any[] = [];
    try { const p = JSON.parse(cleanJsonResponse(response.text ?? '[]')); if (Array.isArray(p)) parsed = p; } catch { /* кривой JSON */ }
    const byRef = new Map<string, any>();
    for (const v of parsed) if (v && typeof v.ref === 'string') byRef.set(v.ref.trim(), v);
    const STATUSES = new Set(['resolved', 'active', 'dangling']);

    const statuses = threads.map((t, i) => {
      const v = byRef.get(`T${i + 1}`);
      const lb = v && Number.isInteger(Number(v.lastBook)) && Number(v.lastBook) >= 1 && Number(v.lastBook) <= books.length ? Number(v.lastBook) : null;
      return {
        threadId: t.id,
        status: v && STATUSES.has(v.status) ? v.status : 'dangling',
        note: v && typeof v.note === 'string' ? v.note.trim().slice(0, 400) : '',
        lastBook: lb,
      };
    });
    res.json({ statuses });
  } catch (e) { console.error('franchise xray', e); res.status(500).json({ error: 'Internal server error' }); }
});

export default router;
