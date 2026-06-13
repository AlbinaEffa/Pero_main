/**
 * POST /api/demo/create
 *
 * Creates a pre-seeded demo project for onboarding.
 * Returns { project, firstChapterId, jobCount } — same shape as /import/create.
 *
 * The demo is a 3-chapter Russian thriller short story with named characters,
 * locations, and items — rich enough for entity extraction and co-author to
 * produce interesting results immediately.
 *
 * Idempotent: returns 409 with the existing projectId if already created.
 */

import express from 'express';
import { eq, and } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { db } from '../db/client.js';
import { authenticateToken } from '../middleware/auth.js';
import { enqueueJobs } from '../jobs/queue.js';
import { parseManuscript, upload } from './import.js';
import { getAIProvider } from '../lib/aiProvider.js';
import { guardChat } from '../lib/aiGuard.js';
import { BASE_EXTRACTION_PROMPT, cleanJsonResponse, type AiEntity, type AiRelation } from '../lib/extraction.js';

const router = express.Router();

// ── Demo manuscript content ───────────────────────────────────────────────────

const DEMO_PROJECT = { title: 'Последний поезд', genre: 'Триллер', color: '#2C3E50' };

const DEMO_CHAPTERS: { title: string; content: string }[] = [
  {
    title: 'Глава 1. Отправление',
    content: `Иван Соколов опоздал. Часы на вокзале Брюсселя показывали восемь тридцать семь, поезд отходил в восемь сорок. Он протолкался сквозь толпу, прижимая к боку кожаный портфель — тяжёлый, неудобный, но расстаться с ним было нельзя. Внутри лежали документы, ради которых он провёл в Бельгии три месяца.

Журналист по профессии и авантюрист по характеру, Соколов работал на московскую газету «Вечерний вестник». Редактор Громов поставил ему задачу: найти доказательства причастности крупного банка к финансированию запрещённых организаций. Три месяца поисков, встреч на конспиративных квартирах, фотографий через зеркало кафе — и вот портфель.

Иван прыгнул в последний вагон за секунду до того, как двери закрылись. Поезд дёрнулся и пополз прочь с перрона. Брюссель медленно уходил назад — стеклянные фасады офисов, старые кирпичные дома, дождь на стекле.`,
  },
  {
    title: 'Глава 2. Незнакомка в купе',
    content: `Его купе оказалось занято. На нижней полке у окна сидела женщина лет тридцати — тёмные волосы, строгий серый костюм, книга на французском. Она подняла взгляд, когда он вошёл.

— Иван Соколов? — спросила она тихо.

Он замер с портфелем в руке.

— Не бойтесь, — сказала она, — меня зовут Анна Кириллова. Я из посольства. Мы ехали одним поездом уже не первый раз за эти три месяца, только вы этого не замечали.

Анна протянула ему удостоверение. Дипломатический советник, третий секретарь посольства.

— Что в портфеле, я уже знаю, — продолжила она. — Вопрос в другом: вы понимаете, что банк «Меридиан» имеет людей в московской редакции?

Соколов медленно сел напротив.

— Громов? — спросил он.

Анна кивнула. За окном мелькали бельгийские поля. Где-то на горизонте угадывалась Франция.`,
  },
  {
    title: 'Глава 3. Конечная станция',
    content: `Поезд прибыл в Париж в шесть утра. Вокзал Гар-дю-Нор был полупустым — только уборщики с машинами и несколько сонных таксистов у выхода.

Анна и Иван вышли последними. У Анны был адрес явочной квартиры на Монмартре, куда можно было переправить содержимое портфеля в обход обычных каналов.

— После этого вы свободны, — сказала Анна, застёгивая пальто. — Статью можно напечатать в «Ле Монд» или в «Гардиан». Только не в России. Не пока.

Иван посмотрел на кожаный портфель. Три месяца его жизни. Билет домой в кармане внезапно казался невозможным.

— Ладно, — сказал он. — Покажите мне Монмартр.

Они вышли на парижское утро. Моросил мелкий дождь — такой же, как в Брюсселе, только здесь он пах по-другому: кофе, булочками и ещё чем-то, что Иван не мог назвать, но что всегда напоминало ему о свободе.`,
  },
];

// ── Route ─────────────────────────────────────────────────────────────────────

router.post('/create', authenticateToken, async (req: any, res) => {
  try {
    // Idempotency: return existing demo project if already created
    const existing = await db
      .select({ id: schema.projects.id, firstChapter: schema.projects.id })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.userId, req.user.userId),
          eq(schema.projects.title, DEMO_PROJECT.title)
        )
      );

    if (existing.length > 0) {
      // Find the first chapter
      const chapters = await db
        .select({ id: schema.chapters.id })
        .from(schema.chapters)
        .where(eq(schema.chapters.projectId, existing[0].id));

      return res.status(200).json({
        project: { id: existing[0].id },
        firstChapterId: chapters[0]?.id ?? null,
        jobCount: 0,
        alreadyExists: true,
      });
    }

    // Create project + chapters in a single transaction
    const { project, insertedChapters } = await db.transaction(async tx => {
      const [project] = await tx.insert(schema.projects).values({
        userId: req.user.userId,
        title:  DEMO_PROJECT.title,
        genre:  DEMO_PROJECT.genre,
        color:  DEMO_PROJECT.color,
        status: 'active',
      }).returning();

      const insertedChapters = await tx.insert(schema.chapters).values(
        DEMO_CHAPTERS.map((c, i) => ({
          projectId: project.id,
          title:     c.title,
          content:   c.content,
          order:     i,
          status:    'draft',
        }))
      ).returning();

      return { project, insertedChapters };
    });

    // Enqueue extract_entities + embed_chapter for all 3 chapters
    let jobIds: string[] = [];
    try {
      jobIds = await enqueueJobs(
        insertedChapters.flatMap(c => [
          {
            type: 'extract_entities' as const,
            payload: { chapterId: c.id, content: c.content ?? '' },
            projectId: project.id,
            userId: req.user.userId,
          },
          {
            type: 'embed_chapter' as const,
            payload: { chapterId: c.id, content: c.content ?? '' },
            projectId: project.id,
            userId: req.user.userId,
          },
        ])
      );
    } catch (e) {
      console.warn('[demo] Failed to enqueue jobs (non-fatal):', e);
    }

    res.status(201).json({
      project,
      firstChapterId: insertedChapters[0]?.id ?? null,
      jobCount: jobIds.length,
    });
  } catch (err) {
    console.error('POST /demo/create:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/demo/extract-first ──────────────────────────────────────────────
//
// Публичный эндпоинт БЕЗ авторизации: «попробовать на своей рукописи».
// Аноним загружает рукопись → Перо реально извлекает библию ПО ПЕРВОЙ ГЛАВЕ
// (ровно один AI-вызов) и возвращает «вкус» результата. Ничего не пишется в БД.
// Чтобы построить библию всей книги — мягкая стена «создайте аккаунт».
//
// Защита от расходов/абьюза:
//   • один AI-вызов на запрос (только первая глава);
//   • текст главы обрезается до DEMO_EXTRACT_MAX_CHARS перед отправкой в модель;
//   • IP-лимит DEMO_EXTRACT_PER_IP_PER_DAY запросов в сутки (in-memory).

const DEMO_PER_IP_PER_DAY = Number(process.env.DEMO_EXTRACT_PER_IP_PER_DAY ?? 3);
const DEMO_MAX_CHARS = Number(process.env.DEMO_EXTRACT_MAX_CHARS ?? 6000);
const DAY_MS = 24 * 60 * 60 * 1000;

/** ip → timestamps(ms) успешно израсходованных слотов за последние сутки. */
const ipHits = new Map<string, number[]>();

function clientIp(req: any): string {
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim();
  return fwd || req.ip || req.socket?.remoteAddress || 'unknown';
}

/** Резервирует слот для IP. Возвращает {ok:false, retryAfterMs} если лимит исчерпан. */
function reserveIpSlot(ip: string): { ok: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const arr = (ipHits.get(ip) ?? []).filter(t => now - t < DAY_MS);
  if (arr.length >= DEMO_PER_IP_PER_DAY) {
    ipHits.set(ip, arr);
    return { ok: false, retryAfterMs: DAY_MS - (now - arr[0]) };
  }
  arr.push(now);
  ipHits.set(ip, arr);
  // Лёгкая профилактика роста карты
  if (ipHits.size > 5000) {
    for (const [k, v] of ipHits) {
      const fresh = v.filter(t => now - t < DAY_MS);
      if (fresh.length === 0) ipHits.delete(k); else ipHits.set(k, fresh);
    }
  }
  return { ok: true };
}

/** Возвращает слот IP (наша ошибка/недоступность AI — не наказываем пользователя). */
function refundIpSlot(ip: string): void {
  const arr = ipHits.get(ip);
  if (arr && arr.length) { arr.pop(); ipHits.set(ip, arr); }
}

router.post('/extract-first', upload.single('file'), async (req: any, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не получен' });

    const ai = getAIProvider();
    if (!ai) return res.status(503).json({ error: 'Демо временно недоступно — попробуйте позже.' });

    const ip = clientIp(req);
    const slot = reserveIpSlot(ip);
    if (!slot.ok) {
      const hours = Math.ceil((slot.retryAfterMs ?? DAY_MS) / 3_600_000);
      return res.status(429).json({
        code: 'DEMO_LIMIT',
        error: `Демо-лимит на сегодня исчерпан (попробуйте через ~${hours} ч). Создайте аккаунт — там Перо прочитает книгу целиком.`,
      });
    }

    // Парсинг рукописи (бесплатно, CPU). Ошибка парсинга → слот не тратим.
    let parsed;
    try {
      parsed = await parseManuscript(req.file.originalname, req.file.buffer);
    } catch (e: any) {
      refundIpSlot(ip);
      if (e?.status) return res.status(e.status).json({ error: e.message });
      throw e;
    }

    const first = parsed.chapters[0];
    if (!first) {
      refundIpSlot(ip);
      return res.status(422).json({ error: 'Не удалось выделить первую главу.' });
    }

    const plainText = first.content
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, DEMO_MAX_CHARS);

    if (plainText.split(/\s+/).filter(Boolean).length < 20) {
      refundIpSlot(ip);
      return res.status(422).json({ error: 'Первая глава слишком короткая для разбора. Попробуйте другую рукопись.' });
    }

    let response;
    try {
      response = await guardChat(
        () => ai.generate({
          contents: `${BASE_EXTRACTION_PROMPT}\n\n<chapter_content>\n${plainText}\n</chapter_content>`,
          temperature: 0.15,
        }),
        // userId=null → cost_logs пишется без привязки к пользователю, ничью квоту не тратит
        { userId: null as any, projectId: null, route: 'demo:extract_first', circuit: 'extract', timeoutMs: 60_000 },
      );
    } catch (err: any) {
      refundIpSlot(ip);
      const status = err?.status ?? err?.error?.code ?? err?.code;
      if (err?.isCircuitOpen || status === 429 || String(err?.message ?? '').includes('429')) {
        return res.status(503).json({ error: 'Перо сейчас перегружено. Попробуйте через минуту или создайте аккаунт.' });
      }
      console.error('[demo] extract-first AI error:', err);
      return res.status(502).json({ error: 'Не удалось прочитать главу. Попробуйте ещё раз.' });
    }

    // Парсим ответ модели. Ничего не сохраняем в БД — это эфемерный «вкус».
    let entities: AiEntity[] = [];
    let relations: AiRelation[] = [];
    try {
      const p = JSON.parse(cleanJsonResponse(response.text ?? '{"entities":[]}'));
      entities  = Array.isArray(p) ? p : (p.entities ?? []);
      relations = Array.isArray(p) ? [] : (p.relations ?? []);
    } catch { /* малформ JSON — отдаём пустой вкус */ }

    const safeEntities = (Array.isArray(entities) ? entities : [])
      .slice(0, 24)
      .map(e => ({
        type: ['character', 'location', 'item', 'rule'].includes(e.type) ? e.type : 'character',
        name: String(e.name ?? '').trim().slice(0, 120),
        description: String(e.description ?? '').trim().slice(0, 400),
        significance: ['major', 'moderate', 'minor'].includes(e.significance ?? '') ? e.significance : null,
      }))
      .filter(e => e.name);

    res.json({
      title: parsed.title,
      totalChapters: parsed.chapters.length,
      totalWords: parsed.totalWords,
      firstChapter: { title: first.title, wordCount: first.wordCount },
      entities: safeEntities,
      relationsCount: Array.isArray(relations) ? relations.length : 0,
    });
  } catch (error) {
    console.error('POST /demo/extract-first:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
