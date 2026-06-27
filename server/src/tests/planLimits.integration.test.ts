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
