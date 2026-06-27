/**
 * Request logger middleware.
 *
 * Adds a unique X-Request-ID to every request (or forwards the one sent by the
 * client), then logs method + path + status + duration on response finish.
 *
 * Output format (structured JSON — easy to pipe into log aggregators):
 *   {"ts":"2026-04-11T10:00:00.000Z","reqId":"abc123","method":"POST","path":"/api/ai/chat","status":200,"ms":312,"ip":"1.2.3.4"}
 *
 * Errors (5xx) are logged at a louder level so they stand out.
 */

import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';

function shortId(): string {
  return randomBytes(6).toString('hex'); // 12 hex chars — short and unique enough
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const reqId = (req.headers['x-request-id'] as string) || shortId();
  const start = Date.now();

  // Attach to req so route handlers can reference it in their own logs
  req.reqId = reqId;

  // Echo back so clients / load-balancers can correlate
  res.setHeader('X-Request-ID', reqId);

  res.on('finish', () => {
    const ms     = Date.now() - start;
    const status = res.statusCode;

    const entry = {
      ts:     new Date().toISOString(),
      reqId,
      method: req.method,
      path:   req.path,
      status,
      ms,
      ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
        || req.socket.remoteAddress
        || '-',
    };

    if (status >= 500) {
      console.error(JSON.stringify(entry));
    } else if (status >= 400) {
      console.warn(JSON.stringify(entry));
    } else {
      // Skip noisy health-check polling
      if (req.path !== '/health') {
        console.log(JSON.stringify(entry));
      }
    }
  });

  next();
}
