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

export default router;
