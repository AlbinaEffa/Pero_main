// auth.ts is imported first — its dotenv.config() runs before other routes create their Pool instances
import authRoutes from './routes/auth.js';
import projectsRoutes from './routes/projects.js';
import chaptersRoutes from './routes/chapters.js';
import aiRoutes from './routes/ai.js';
import bibleRoutes from './routes/bible.js';
import importRoutes from './routes/import.js';
import embedRoutes from './routes/embed.js';
import revisionRoutes from './routes/revision.js';
import jobsRoutes from './routes/jobs.js';
import feedbackRoutes from './routes/feedback.js';
import adminRoutes from './routes/admin.js';
import demoRoutes from './routes/demo.js';
import exportRoutes from './routes/export.js';
import searchRoutes from './routes/search.js';
import billingRoutes from './routes/billing.js';
import { getCircuitStates } from './lib/aiGuard.js';
import { requestLogger } from './middleware/requestLogger.js';

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';

export const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
// Restrict to known origins. ALLOWED_ORIGINS is a comma-separated list.
// Falls back to localhost for local development.
const rawOrigins = process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:3000';
const allowedOrigins = new Set(rawOrigins.split(',').map(o => o.trim()).filter(Boolean));

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no Origin (server-to-server, curl, Postman)
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Admin-Secret'],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
}));

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(requestLogger);
app.use(express.json({ limit: '5mb' }));

// ── IP-based rate limit for auth endpoints (brute-force protection) ───────────
// Keyed by IP, not userId — so unauthenticated attackers are limited too.
const authAttempts = new Map<string, { count: number; resetAt: number }>();
const AUTH_LIMIT   = 20;   // attempts
const AUTH_WINDOW  = 15 * 60 * 1000; // 15 minutes

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of authAttempts) {
    if (entry.resetAt < now) authAttempts.delete(ip);
  }
}, 5 * 60 * 1000).unref();

export function authRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip  = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
              || req.socket.remoteAddress
              || 'unknown';
  const now = Date.now();
  const entry = authAttempts.get(ip) ?? { count: 0, resetAt: now + AUTH_WINDOW };

  if (entry.resetAt < now) {
    entry.count  = 0;
    entry.resetAt = now + AUTH_WINDOW;
  }

  entry.count++;
  authAttempts.set(ip, entry);

  if (entry.count > AUTH_LIMIT) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      error: 'Слишком много попыток. Попробуйте через 15 минут.',
      retryAfterSec,
    });
  }

  next();
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/chapters', chaptersRoutes);
app.use('/api/ai',       aiRoutes);
app.use('/api/bible',    bibleRoutes);
app.use('/api/import',   importRoutes);
app.use('/api/embed',    embedRoutes);
app.use('/api/revision', revisionRoutes);
app.use('/api/jobs',     jobsRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/admin',    adminRoutes);
app.use('/api/demo',     demoRoutes);
app.use('/api/export',   exportRoutes);
app.use('/api/search',   searchRoutes);
app.use('/api/billing',  billingRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  const circuits = getCircuitStates();
  const anyOpen  = Object.values(circuits).some((c: any) => c.state === 'OPEN');
  res.status(anyOpen ? 503 : 200).json({
    status:   anyOpen ? 'degraded' : 'ok',
    circuits,
    uptime:   Math.floor(process.uptime()),
    memory:   process.memoryUsage().rss,
  });
});

// ── Global error handler ──────────────────────────────────────────────────────
// Catches anything thrown from route handlers (incl. CORS errors above).
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const reqId  = (req as any).reqId ?? '-';
  const status = err.status ?? err.statusCode ?? 500;
  const msg    = status < 500 ? err.message : 'Internal server error';

  if (status >= 500) {
    console.error(JSON.stringify({ reqId, error: err.message, stack: err.stack }));
  }

  if (!res.headersSent) {
    res.status(status).json({ error: msg, reqId });
  }
});
