/**
 * Idempotency key middleware for mutating endpoints.
 *
 * Client sends:  X-Idempotency-Key: <uuid>
 * Server stores: { responseBody, statusCode } in an in-memory cache for 10 minutes.
 * Duplicate request within the window returns the cached response immediately.
 *
 * This prevents duplicate projects/chapters from:
 *   - Double-clicks on "Создать"
 *   - Network retries after timeout
 *   - Browser refresh mid-submit
 *
 * In-memory cache is sufficient for single-instance beta.
 * For multi-instance: replace with Redis SETNX.
 *
 * Usage:
 *   router.post('/create', authenticateToken, idempotency(), handler)
 */

import { Request, Response, NextFunction } from 'express';

interface CachedResponse {
  statusCode: number;
  body: unknown;
  expiresAt: number;
}

const cache = new Map<string, CachedResponse>();
const TTL_MS = 10 * 60 * 1000; // 10 minutes

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt < now) cache.delete(key);
  }
}, 5 * 60 * 1000).unref();

export function idempotency() {
  return (req: any, res: Response, next: NextFunction) => {
    const key = req.headers['x-idempotency-key'] as string | undefined;
    if (!key) return next();

    const userId = req.user?.userId ?? 'anon';
    const cacheKey = `${userId}:${key}`;
    const now = Date.now();

    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      res.setHeader('X-Idempotency-Replayed', 'true');
      return res.status(cached.statusCode).json(cached.body);
    }

    // Intercept res.json() to capture the response
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cache.set(cacheKey, {
          statusCode: res.statusCode,
          body,
          expiresAt: now + TTL_MS,
        });
      }
      return originalJson(body);
    };

    next();
  };
}
