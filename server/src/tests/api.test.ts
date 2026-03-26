/**
 * Critical-path integration tests.
 * Requires DATABASE_URL set in server/.env (hits the real database).
 *
 * Each run uses a unique email suffix (timestamp) so parallel runs don't collide.
 * afterAll cleans up all created rows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
const { Pool } = pkg;
import { eq } from 'drizzle-orm';

import { app } from '../app.js';
import { users, projects, chapters, storyEntities } from '../db/schema.js';

// ── Test state ──────────────────────────────────────────────────────────────

const RUN = Date.now();
const EMAIL_A = `test-a-${RUN}@pero.test`;
const EMAIL_B = `test-b-${RUN}@pero.test`;
const PASSWORD = 'Test1234!';

const ctx = {
  tokenA: '',
  userAId: '',
  tokenB: '',
  userBId: '',
  projectId: '',
  chapterId: '',
};

// Direct DB access for setup/teardown that can't go through the API
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// ── Global setup ─────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Register user A
  const resA = await request(app)
    .post('/api/auth/register')
    .send({ email: EMAIL_A, password: PASSWORD, displayName: 'Test A' });

  expect(resA.status, `Register A failed: ${JSON.stringify(resA.body)}`).toBe(201);
  ctx.tokenA = resA.body.token;
  ctx.userAId = resA.body.user.id;

  // Register user B
  const resB = await request(app)
    .post('/api/auth/register')
    .send({ email: EMAIL_B, password: PASSWORD });

  expect(resB.status, `Register B failed: ${JSON.stringify(resB.body)}`).toBe(201);
  ctx.tokenB = resB.body.token;
  ctx.userBId = resB.body.user.id;

  // Create project + first chapter as user A
  const resP = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${ctx.tokenA}`)
    .send({ title: `Test-${RUN}`, genre: 'test' });

  expect(resP.status, `Create project failed: ${JSON.stringify(resP.body)}`).toBe(201);
  ctx.projectId = resP.body.project.id;
  ctx.chapterId = resP.body.chapter.id;
});

afterAll(async () => {
  if (ctx.projectId) {
    await db.delete(storyEntities).where(eq(storyEntities.projectId, ctx.projectId)).catch(() => {});
    await db.delete(chapters).where(eq(chapters.projectId, ctx.projectId)).catch(() => {});
    await db.delete(projects).where(eq(projects.id, ctx.projectId)).catch(() => {});
  }
  if (ctx.userAId) await db.delete(users).where(eq(users.id, ctx.userAId)).catch(() => {});
  if (ctx.userBId) await db.delete(users).where(eq(users.id, ctx.userBId)).catch(() => {});
  await pool.end();
});

// ── Auth ─────────────────────────────────────────────────────────────────────

describe('Auth', () => {
  it('login with valid credentials returns token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: EMAIL_A, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('login with wrong password returns 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: EMAIL_A, password: 'wrong_password' });

    expect(res.status).toBe(401);
  });

  it('GET /auth/me without token returns 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET /auth/me with valid token returns user without passwordHash', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${ctx.tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(EMAIL_A);
    expect(res.body.user.passwordHash).toBeUndefined();
  });
});

// ── Chapter save / load ───────────────────────────────────────────────────────

describe('Chapter save/load', () => {
  it('saves content with PUT /chapters/:id', async () => {
    const res = await request(app)
      .put(`/api/chapters/${ctx.chapterId}`)
      .set('Authorization', `Bearer ${ctx.tokenA}`)
      .send({ content: '<p>Hello world</p>' });

    expect(res.status).toBe(200);
    expect(res.body.chapter.content).toBe('<p>Hello world</p>');
  });

  it('loads saved content with GET /chapters/:id', async () => {
    const res = await request(app)
      .get(`/api/chapters/${ctx.chapterId}`)
      .set('Authorization', `Bearer ${ctx.tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.chapter.content).toBe('<p>Hello world</p>');
  });

  it('PUT without content returns 400', async () => {
    const res = await request(app)
      .put(`/api/chapters/${ctx.chapterId}`)
      .set('Authorization', `Bearer ${ctx.tokenA}`)
      .send({});

    expect(res.status).toBe(400);
  });
});

// ── Ownership ─────────────────────────────────────────────────────────────────

describe('Ownership', () => {
  it('user B cannot read user A\'s chapter → 404', async () => {
    const res = await request(app)
      .get(`/api/chapters/${ctx.chapterId}`)
      .set('Authorization', `Bearer ${ctx.tokenB}`);

    expect(res.status).toBe(404);
  });

  it('user B cannot write to user A\'s chapter → 404', async () => {
    const res = await request(app)
      .put(`/api/chapters/${ctx.chapterId}`)
      .set('Authorization', `Bearer ${ctx.tokenB}`)
      .send({ content: 'hacked' });

    expect(res.status).toBe(404);
  });

  it('user B cannot list user A\'s project chapters → 403', async () => {
    const res = await request(app)
      .get(`/api/projects/${ctx.projectId}/chapters`)
      .set('Authorization', `Bearer ${ctx.tokenB}`);

    expect(res.status).toBe(403);
  });

  it('user B cannot delete user A\'s project → 403', async () => {
    const res = await request(app)
      .delete(`/api/projects/${ctx.projectId}`)
      .set('Authorization', `Bearer ${ctx.tokenB}`);

    expect(res.status).toBe(403);
  });
});

// ── Bible extraction ──────────────────────────────────────────────────────────

describe('Bible extraction', () => {
  it('POST /bible/extract without auth → 401', async () => {
    const res = await request(app)
      .post('/api/bible/extract')
      .send({ chapterContent: 'Мария вошла в замок.', projectId: ctx.projectId });

    expect(res.status).toBe(401);
  });

  it('user B cannot extract into user A\'s project → 403 or 503 (no AI key)', async () => {
    const res = await request(app)
      .post('/api/bible/extract')
      .set('Authorization', `Bearer ${ctx.tokenB}`)
      .send({ chapterContent: 'Мария вошла в замок.', projectId: ctx.projectId });

    // 403 = ownership check fired first; 503 = AI not configured (checked first in some builds)
    expect([403, 503]).toContain(res.status);
  });
});

// ── Bible approve / reject ────────────────────────────────────────────────────

describe('Bible approve/reject', () => {
  let entityId = '';
  let entity2Id = '';

  beforeAll(async () => {
    // Insert test entities directly — bypasses the AI extraction step
    const e1 = (await db.insert(storyEntities).values({
      projectId: ctx.projectId,
      type: 'character',
      name: `Hero-${RUN}`,
      description: 'Test hero',
      status: 'pending',
    }).returning())[0];

    const e2 = (await db.insert(storyEntities).values({
      projectId: ctx.projectId,
      type: 'location',
      name: `Castle-${RUN}`,
      description: 'Test castle',
      status: 'pending',
    }).returning())[0];

    entityId = e1.id;
    entity2Id = e2.id;
  });

  it('owner approves entity → status becomes approved', async () => {
    const res = await request(app)
      .patch(`/api/bible/${entityId}/approve`)
      .set('Authorization', `Bearer ${ctx.tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.entity.status).toBe('approved');
  });

  it('owner rejects entity → status becomes rejected', async () => {
    const res = await request(app)
      .patch(`/api/bible/${entity2Id}/reject`)
      .set('Authorization', `Bearer ${ctx.tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.entity.status).toBe('rejected');
  });

  it('non-owner cannot approve another user\'s entity → 403', async () => {
    const res = await request(app)
      .patch(`/api/bible/${entityId}/approve`)
      .set('Authorization', `Bearer ${ctx.tokenB}`);

    expect(res.status).toBe(403);
  });
});
