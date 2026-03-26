/**
 * Per-user sliding window rate limiter — no Redis required.
 *
 * Uses an in-memory Map keyed by `userId:routeKey`. On a multi-instance
 * deployment this should be replaced with Redis + lua script, but for
 * single-instance beta it is perfectly sufficient.
 *
 * Usage:
 *   router.post('/chat', authenticateToken, rateLimit('ai:chat', 30, 60 * 60 * 1000), handler)
 *   // → 30 requests per hour per user on this route
 */

import { Request, Response, NextFunction } from 'express';

interface Window {
  timestamps: number[];
  /** evict entries older than this (ms from epoch) */
  evictBefore: number;
}

const store = new Map<string, Window>();

/** Prune the global store every 10 minutes to avoid unbounded memory growth */
setInterval(() => {
  const now = Date.now();
  for (const [key, win] of store.entries()) {
    if (win.evictBefore < now) store.delete(key);
  }
}, 10 * 60 * 1000).unref(); // .unref() so the interval doesn't keep the process alive

/**
 * Returns an Express middleware that enforces `maxRequests` within `windowMs`.
 *
 * @param routeKey  Short identifier added to the rate-limit key, e.g. 'ai:chat'
 * @param maxRequests  Maximum allowed requests per window
 * @param windowMs  Window duration in ms (default: 1 hour)
 */
export function rateLimit(
  routeKey: string,
  maxRequests: number,
  windowMs = 60 * 60 * 1000
) {
  return (req: any, res: Response, next: NextFunction) => {
    const userId = req.user?.userId;
    if (!userId) return next(); // unauthenticated — let auth middleware handle it

    const key = `${userId}:${routeKey}`;
    const now = Date.now();
    const cutoff = now - windowMs;

    const win = store.get(key) ?? { timestamps: [], evictBefore: now + windowMs };
    // Evict timestamps outside the window
    win.timestamps = win.timestamps.filter(t => t > cutoff);

    if (win.timestamps.length >= maxRequests) {
      const oldest = win.timestamps[0];
      const retryAfterSec = Math.ceil((oldest + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      res.setHeader('X-RateLimit-Limit',     String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset',     String(Math.ceil((oldest + windowMs) / 1000)));
      return res.status(429).json({
        error: 'Слишком много запросов. Подождите немного.',
        retryAfterSec,
      });
    }

    win.timestamps.push(now);
    win.evictBefore = now + windowMs;
    store.set(key, win);

    res.setHeader('X-RateLimit-Limit',     String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(maxRequests - win.timestamps.length));

    next();
  };
}

/** Expose store for testing */
export const _rateLimitStore = store;
