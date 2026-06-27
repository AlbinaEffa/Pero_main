/**
 * Глобальная аугментация Express.Request — `req.user` после authenticateToken.
 * Опционально (middleware могут читать до/без auth); хендлеры за authenticateToken
 * используют `AuthedRequest` (middleware/auth.ts) с НЕпустым user — без `!`.
 */
export {};

declare global {
  namespace Express {
    interface Request {
      user?: { userId: string };
      /** Корреляционный id запроса (ставит requestLogger, читает обработчик ошибок). */
      reqId?: string;
    }
  }
}
