/**
 * POST /api/feedback
 * Body: { type, message, page?, metadata? }
 *
 * Auth is optional — we accept feedback even from unauthenticated users
 * (though the frontend always sends it from a logged-in context).
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import * as schema from '../db/schema.js';
import { db } from '../db/client.js';

const router = express.Router();

// Optional auth middleware — populate req.user if token present, never block
const tryAuth = (req: any, res: any, next: any) => {
  const header = req.headers['authorization'];
  if (!header) return next();
  authenticateToken(req, res, next);
};

const VALID_TYPES = new Set(['bug', 'idea', 'praise', 'general']);

router.post('/', tryAuth, async (req: any, res) => {
  try {
    const { type = 'general', message, page, metadata } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }
    if (message.length > 4000) {
      return res.status(400).json({ error: 'message too long' });
    }

    await db.insert(schema.feedback).values({
      userId:   req.user?.userId ?? null,
      type:     VALID_TYPES.has(type) ? type : 'general',
      message:  message.trim(),
      page:     page ?? null,
      metadata: metadata ?? null,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /feedback:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
