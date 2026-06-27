/**
 * Интеграционные тесты лимитов Free-тарифа (пейволл) — бета-критично, раньше проверялось
 * только вручную. Бьёт в реальную БД (нужен DATABASE_URL + server-db-1). Своя чистка.
 * AI НЕ трогается: гейт создания проекта срабатывает до любых AI-вызовов.
 *
 * Допущение: FREE_MAX_PROJECTS = 1 (дефолт). При env-override тест корректно «упадёт».
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
const { Pool } = pkg;
import { eq, inArray } from 'drizzle-orm';

import { app } from '../app.js';
import { users, projects, chapters } from '../db/schema.js';
import { checkBibleChapterLimit } from '../lib/planLimits.js';

const RUN = Date.now();
const EMAIL = `test-limits-${RUN}@pero.test`;
const PASSWORD = 'Test1234!';
const ctx = { token: '', userId: '', projectIds: [] as string[] };

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

beforeAll(async () => {
  const res = await request(app).post('/api/auth/register').send({ email: EMAIL, password: PASSWORD });
  expect(res.status, `Register failed: ${JSON.stringify(res.body)}`).toBe(201);
  ctx.token = res.body.token;
  ctx.userId = res.body.user.id;
});

afterAll(async () => {
  if (ctx.projectIds.length) {
    await db.delete(chapters).where(inArray(chapters.projectId, ctx.projectIds)).catch(() => {});
    await db.delete(projects).where(inArray(projects.id, ctx.projectIds)).catch(() => {});
  }
  if (ctx.userId) await db.delete(users).where(eq(users.id, ctx.userId)).catch(() => {});
  await pool.end();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Free-tier: лимит проектов (пейволл)', () => {
  it('новый free-юзер: первый проект создаётся (201)', async () => {
    const res = await request(app).post('/api/projects').set(auth(ctx.token)).send({ title: `Limit-1-${RUN}` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    ctx.projectIds.push(res.body.project.id);
  });

  it('второй проект → 402 PLAN_LIMIT_PROJECTS (free)', async () => {
    const res = await request(app).post('/api/projects').set(auth(ctx.token)).send({ title: `Limit-2-${RUN}` });
    if (res.body?.project?.id) ctx.projectIds.push(res.body.project.id); // подстраховка cleanup
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('PLAN_LIMIT_PROJECTS');
    expect(res.body.plan).toBe('free');
    expect(typeof res.body.error).toBe('string');
  });

  it('импорт второго проекта тоже блокируется (402)', async () => {
    const res = await request(app).post('/api/import/create').set(auth(ctx.token))
      .send({ title: `Limit-imp-${RUN}`, chapters: [{ title: 'Глава 1', content: '<p>текст</p>' }] });
    if (res.body?.project?.id) ctx.projectIds.push(res.body.project.id);
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('PLAN_LIMIT_PROJECTS');
  });
});

describe('Free-tier: лимит глав библии (пейволл)', () => {
  // Главы ранжируются по "order"; FREE_BIBLE_CHAPTERS = 30 (дефолт). 31 глава (order 0..30):
  // глава order=29 — ранг 30 (в лимите), order=30 — ранг 31 (за лимитом).
  const byOrder: string[] = [];

  beforeAll(async () => {
    const projectId = ctx.projectIds[0];
    expect(projectId, 'нужен проект, созданный в предыдущем блоке').toBeTruthy();
    // Проект мог создаться с дефолтной главой — чистим, чтобы order 0..30 были единственными.
    await db.delete(chapters).where(eq(chapters.projectId, projectId));
    const rows = await db.insert(chapters)
      .values(Array.from({ length: 31 }, (_, i) => ({ projectId, title: `Гл ${i}`, order: i })))
      .returning({ id: chapters.id, order: chapters.order });
    for (const r of rows) byOrder[r.order ?? 0] = r.id;
  });

  it('глава ранга 30 (в лимите) → не блокируется', async () => {
    const denial = await checkBibleChapterLimit(ctx.userId, ctx.projectIds[0], byOrder[29]);
    expect(denial).toBeNull();
  });

  it('глава ранга 31 (за лимитом) → PLAN_LIMIT_BIBLE_CHAPTERS', async () => {
    const denial = await checkBibleChapterLimit(ctx.userId, ctx.projectIds[0], byOrder[30]);
    expect(denial).not.toBeNull();
    expect(denial?.code).toBe('PLAN_LIMIT_BIBLE_CHAPTERS');
    expect(denial?.plan).toBe('free');
    expect(denial?.limit).toBe(30);
  });

  it('эндпоинт /bible/extract на главе за лимитом → 402 ДО AI', async () => {
    const res = await request(app).post('/api/bible/extract').set(auth(ctx.token))
      .send({ projectId: ctx.projectIds[0], chapterId: byOrder[30], chapterContent: '<p>текст</p>' });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('PLAN_LIMIT_BIBLE_CHAPTERS');
  });
});
