/**
 * Шеринг библии read-only ссылкой (Этап D, дыра USM #7 «выход наружу»).
 *
 * Автор включает публичную ссылку → любой со ссылкой видит КАТАЛОГ МИРА (сущности) + ЗАМЫСЕЛ
 * (логлайн/премис), БЕЗ входа. Рукопись/главы/связи/сюжет/пользователь НЕ раскрываются.
 * Токен случайный (неугадываемый), автор может отозвать в любой момент.
 *
 * Роуты под /api/share:
 *   GET  /:projectId/status   (auth)  — текущее состояние шеринга
 *   POST /:projectId/enable   (auth)  — включить (сгенерить токен, если нет)
 *   POST /:projectId/disable  (auth)  — отозвать (обнулить токен)
 *   GET  /public/:token       (БЕЗ AUTH) — публичная read-only библия
 */
import express from 'express';
import { randomBytes } from 'crypto';
import { eq, and } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { db } from '../db/client.js';
import { authenticateToken, type AuthedRequest } from '../middleware/auth.js';

const router = express.Router();

async function ownedProject(projectId: string, userId: string) {
  const [row] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)));
  return row ?? null;
}

// GET /:projectId/status — расшарено ли, и токен (для построения ссылки на клиенте)
router.get('/:projectId/status', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const proj = await ownedProject(req.params.projectId, req.user.userId);
    if (!proj) return res.status(403).json({ error: 'Access denied' });
    res.json({ enabled: !!proj.shareToken, token: proj.shareToken ?? null });
  } catch (e) {
    console.error('share status error', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:projectId/enable — включить шеринг (идемпотентно: если уже есть токен, вернуть его)
router.post('/:projectId/enable', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const proj = await ownedProject(req.params.projectId, req.user.userId);
    if (!proj) return res.status(403).json({ error: 'Access denied' });
    let token = proj.shareToken;
    if (!token) {
      token = randomBytes(18).toString('base64url'); // ~24 симв, URL-safe, неугадываемый
      await db.update(schema.projects)
        .set({ shareToken: token, updatedAt: new Date() })
        .where(eq(schema.projects.id, proj.id));
    }
    res.json({ enabled: true, token });
  } catch (e) {
    console.error('share enable error', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:projectId/disable — отозвать ссылку
router.post('/:projectId/disable', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const proj = await ownedProject(req.params.projectId, req.user.userId);
    if (!proj) return res.status(403).json({ error: 'Access denied' });
    await db.update(schema.projects)
      .set({ shareToken: null, updatedAt: new Date() })
      .where(eq(schema.projects.id, proj.id));
    res.json({ enabled: false, token: null });
  } catch (e) {
    console.error('share disable error', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /public/:token — ПУБЛИЧНО, без авторизации. Только безопасный срез: замысел + каталог.
router.get('/public/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token || token.length < 16) return res.status(404).json({ error: 'Not found' });
    const [proj] = await db
      .select({
        id: schema.projects.id,
        title: schema.projects.title,
        genre: schema.projects.genre,
        logline: schema.projects.logline,
        premise: schema.projects.premise,
      })
      .from(schema.projects)
      .where(eq(schema.projects.shareToken, token));
    if (!proj) return res.status(404).json({ error: 'Not found' });

    const rows = await db
      .select({
        id: schema.storyEntities.id,
        type: schema.storyEntities.type,
        name: schema.storyEntities.name,
        description: schema.storyEntities.description,
        significance: schema.storyEntities.significance,
        attributes: schema.storyEntities.attributes,
      })
      .from(schema.storyEntities)
      .where(and(eq(schema.storyEntities.projectId, proj.id), eq(schema.storyEntities.status, 'approved')));

    // Только безопасные поля; алиасы из attributes, остальное не отдаём.
    const entities = rows.map(e => ({
      id: e.id,
      type: e.type,
      name: e.name,
      description: e.description,
      significance: e.significance,
      aliases: (e.attributes as { aliases?: string[] } | null)?.aliases ?? [],
    }));

    res.json({
      project: { title: proj.title, genre: proj.genre, logline: proj.logline, premise: proj.premise },
      entities,
    });
  } catch (e) {
    console.error('share public error', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
