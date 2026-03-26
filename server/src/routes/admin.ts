/**
 * Admin metrics endpoint — for manual beta session review.
 *
 * GET  /api/admin/metrics
 *
 * Protected by X-Admin-Secret header matching ADMIN_SECRET env var.
 * Returns a JSON dashboard snapshot: funnels, feedback, lost users, top users.
 *
 * Usage (curl):
 *   curl -H "X-Admin-Secret: YOUR_SECRET" http://localhost:3001/api/admin/metrics | jq
 */

import express from 'express';
import { pool } from '../db/client.js';

const router = express.Router();

function requireAdmin(req: any, res: any, next: any) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'ADMIN_SECRET not configured' });
  }
  if (req.headers['x-admin-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.get('/metrics', requireAdmin, async (_req, res) => {
  try {
    const [
      usersTotal,
      newLast7d,
      regsByDay,
      projectsByDay,
      chatByDay,
      jobStats,
      feedbackList,
      lostAtActivation,
      topUsers,
      featureAdoption,
    ] = await Promise.all([

      // ── Headline numbers ──────────────────────────────────────────────────
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM users`
      ),

      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM users
         WHERE created_at > NOW() - INTERVAL '7 days'`
      ),

      // ── Registrations per day (last 30 d) ─────────────────────────────────
      pool.query<{ day: string; count: string }>(
        `SELECT DATE(created_at) AS day, COUNT(*)::text AS count
         FROM users
         WHERE created_at > NOW() - INTERVAL '30 days'
         GROUP BY day ORDER BY day`
      ),

      // ── Projects created per day (last 14 d) ─────────────────────────────
      pool.query<{ day: string; count: string }>(
        `SELECT DATE(created_at) AS day, COUNT(*)::text AS count
         FROM projects
         WHERE created_at > NOW() - INTERVAL '14 days'
         GROUP BY day ORDER BY day`
      ),

      // ── Chat messages per day (last 14 d, user only) ──────────────────────
      pool.query<{ day: string; count: string }>(
        `SELECT DATE(timestamp) AS day, COUNT(*)::text AS count
         FROM chat_history
         WHERE timestamp > NOW() - INTERVAL '14 days'
           AND role = 'user'
         GROUP BY day ORDER BY day`
      ),

      // ── Job success / failure rates by type ───────────────────────────────
      pool.query<{ type: string; status: string; count: string }>(
        `SELECT type, status, COUNT(*)::text AS count
         FROM jobs
         GROUP BY type, status ORDER BY type, status`
      ),

      // ── Recent feedback (last 50) ─────────────────────────────────────────
      pool.query<{
        id: string; type: string; message: string;
        page: string; created_at: string; email: string;
      }>(
        `SELECT f.id, f.type, f.message, f.page, f.created_at, u.email
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         ORDER BY f.created_at DESC
         LIMIT 50`
      ),

      // ── Lost at activation: registered >24h ago, 0 chat messages ──────────
      // These users signed up but never engaged with the co-author.
      pool.query<{ email: string; created_at: string; projects: string }>(
        `SELECT u.email, u.created_at, COUNT(DISTINCT p.id)::text AS projects
         FROM users u
         LEFT JOIN chat_history ch ON ch.user_id = u.id
         LEFT JOIN projects      p  ON p.user_id  = u.id
         WHERE u.created_at < NOW() - INTERVAL '24 hours'
           AND ch.id IS NULL
         GROUP BY u.email, u.created_at
         ORDER BY u.created_at DESC
         LIMIT 20`
      ),

      // ── Top users by co-author engagement (last 30 d) ────────────────────
      pool.query<{
        email: string; chat_msgs: string;
        projects: string; entities_approved: string;
      }>(
        `SELECT
           u.email,
           COUNT(DISTINCT ch.id)::text                     AS chat_msgs,
           COUNT(DISTINCT p.id)::text                      AS projects,
           COUNT(DISTINCT se.id) FILTER (
             WHERE se.status = 'approved')::text           AS entities_approved
         FROM users u
         LEFT JOIN chat_history ch ON ch.user_id = u.id
           AND ch.timestamp > NOW() - INTERVAL '30 days'
           AND ch.role = 'user'
         LEFT JOIN projects      p  ON p.user_id  = u.id
         LEFT JOIN story_entities se ON se.project_id = p.id
         GROUP BY u.email
         ORDER BY chat_msgs::int DESC
         LIMIT 20`
      ),

      // ── Feature adoption funnel ───────────────────────────────────────────
      // What % of registered users have used each major feature?
      pool.query<{ feature: string; users: string }>(
        `SELECT feature, COUNT(DISTINCT user_id)::text AS users FROM (
           SELECT 'created_project'  AS feature, user_id FROM projects
           UNION ALL
           SELECT 'sent_chat_message', user_id FROM chat_history WHERE role = 'user'
           UNION ALL
           SELECT 'approved_entity', se.project_id AS user_id
             FROM story_entities se
             JOIN projects p ON p.id = se.project_id
             WHERE se.status = 'approved'
         ) t
         GROUP BY feature`
      ),
    ]);

    res.json({
      generatedAt: new Date().toISOString(),
      summary: {
        totalUsers:     parseInt(usersTotal.rows[0]?.count ?? '0'),
        newUsersLast7d: parseInt(newLast7d.rows[0]?.count ?? '0'),
      },
      funnels: {
        registrationsByDay: regsByDay.rows,
        projectsByDay:      projectsByDay.rows,
        chatByDay:          chatByDay.rows,
        featureAdoption:    featureAdoption.rows,
      },
      jobs:            jobStats.rows,
      recentFeedback:  feedbackList.rows,
      lostAtActivation: lostAtActivation.rows,
      topUsers:        topUsers.rows,
    });
  } catch (err) {
    console.error('GET /admin/metrics:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/admin/costs ──────────────────────────────────────────────────────
// Spending dashboard: per-user and per-route cost aggregates.

router.get('/costs', requireAdmin, async (req, res) => {
  const days = Math.min(parseInt((req.query.days as string) || '7'), 90);

  try {
    const [byUser, byRoute, byDay, total] = await Promise.all([
      pool.query<{ email: string; calls: string; input_tokens: string; output_tokens: string; total_usd: string }>(
        `SELECT u.email,
                COUNT(c.id)::text               AS calls,
                SUM(c.input_tokens)::text        AS input_tokens,
                SUM(c.output_tokens)::text       AS output_tokens,
                SUM(c.estimated_cost_usd)::text  AS total_usd
         FROM cost_logs c
         JOIN users u ON u.id = c.user_id
         WHERE c.created_at > NOW() - ($1 || ' days')::INTERVAL
         GROUP BY u.email
         ORDER BY SUM(c.estimated_cost_usd) DESC`, [days]
      ),

      pool.query<{ route: string; model: string; calls: string; total_usd: string }>(
        `SELECT route, model,
                COUNT(*)::text                  AS calls,
                SUM(estimated_cost_usd)::text   AS total_usd
         FROM cost_logs
         WHERE created_at > NOW() - ($1 || ' days')::INTERVAL
         GROUP BY route, model
         ORDER BY SUM(estimated_cost_usd) DESC`, [days]
      ),

      pool.query<{ day: string; calls: string; total_usd: string }>(
        `SELECT DATE(created_at) AS day,
                COUNT(*)::text                  AS calls,
                SUM(estimated_cost_usd)::text   AS total_usd
         FROM cost_logs
         WHERE created_at > NOW() - ($1 || ' days')::INTERVAL
         GROUP BY day ORDER BY day`, [days]
      ),

      pool.query<{ total_usd: string; calls: string }>(
        `SELECT SUM(estimated_cost_usd)::text AS total_usd, COUNT(*)::text AS calls
         FROM cost_logs
         WHERE created_at > NOW() - ($1 || ' days')::INTERVAL`, [days]
      ),
    ]);

    res.json({
      periodDays: days,
      total: {
        calls:    parseInt(total.rows[0]?.calls    ?? '0'),
        totalUsd: parseFloat(total.rows[0]?.total_usd ?? '0'),
      },
      byUser:  byUser.rows,
      byRoute: byRoute.rows,
      byDay:   byDay.rows,
    });
  } catch (err) {
    console.error('GET /admin/costs:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
