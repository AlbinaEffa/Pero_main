/**
 * Shared authentication middleware.
 * Verifies the JWT token from Authorization: Bearer <token>
 * and sets req.user = { userId: string } on success.
 */
import pkg from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
const { verify } = pkg;

/**
 * Запрос за `authenticateToken` — `req.user` гарантированно установлен.
 * Используй в типизации хендлеров: `async (req: AuthedRequest, res) => …`.
 */
export interface AuthedRequest extends Request {
  user: { userId: string };
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // index.ts already calls process.exit(1) before this module loads in production,
  // but guard here too so tests / standalone scripts also fail loudly.
  throw new Error('[auth] JWT_SECRET env var is not set — refusing to continue');
}

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  verify(token, JWT_SECRET, (err: any, payload: any) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = payload; // { userId: string, iat, exp }
    next();
  });
};
