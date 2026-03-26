/**
 * Shared authentication middleware.
 * Verifies the JWT token from Authorization: Bearer <token>
 * and sets req.user = { userId: string } on success.
 */
import pkg from 'jsonwebtoken';
const { verify } = pkg;

const JWT_SECRET = process.env.JWT_SECRET || 'pero_super_secret_key_change_me_in_prod';

export const authenticateToken = (req: any, res: any, next: any) => {
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
