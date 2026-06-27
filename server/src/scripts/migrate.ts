/**
 * CLI-обёртка над runMigrations — применяет server/drizzle/*.sql к DATABASE_URL.
 * Используется в CI (до тестов) и вручную. Тот же путь, что сервер при старте (index.ts).
 *
 *   DATABASE_URL=postgres://… tsx src/scripts/migrate.ts
 */
import dotenv from 'dotenv';
dotenv.config(); // локально берёт DATABASE_URL из server/.env; в CI — из env job'а (файла нет)

import { runMigrations } from '../db/migrate.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[migrate] DATABASE_URL не задан');
  process.exit(1);
}

runMigrations(url)
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[migrate] fatal:', e);
    process.exit(1);
  });
