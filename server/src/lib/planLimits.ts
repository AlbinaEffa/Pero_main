/**
 * Лимиты бесплатного тарифа (P0.5) — мягкий пейволл к бете.
 *
 * Free:
 *   • до 1 активного проекта (FREE_MAX_PROJECTS) — archived не считаются, можно освободить слот;
 *   • Мир (библия) анализирует только первые 30 глав (FREE_BIBLE_CHAPTERS) — «Прочитать» главы
 *     с номером > 30 на free отдаёт 402.
 * Pro: без лимитов.
 *
 * Гейты возвращают 402 с machine-кодом ДО любого AI-вызова — токены не жжём.
 * При ошибке БД деградируют к «разрешено» (resolveUserPlan уже даёт 'free' молча) —
 * лимиты не должны ронять продукт.
 *
 * Настраивается через env: FREE_MAX_PROJECTS, FREE_BIBLE_CHAPTERS.
 */
import { pool } from '../db/client.js';
import { resolveUserPlan, type Plan } from './quota.js';

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const FREE_MAX_PROJECTS = intFromEnv('FREE_MAX_PROJECTS', 1);
export const FREE_BIBLE_CHAPTERS = intFromEnv('FREE_BIBLE_CHAPTERS', 30);

export type PlanLimitCode = 'PLAN_LIMIT_PROJECTS' | 'PLAN_LIMIT_BIBLE_CHAPTERS';

export interface PlanLimitDenial {
  code: PlanLimitCode;
  /** Человеко-читаемое сообщение (на русском) для тоста/модалки. */
  error: string;
  /** Достигнутый предел — для фронта (например «1 проект», «30 глав»). */
  limit: number;
  plan: Plan;
}

/** Сколько активных проектов у пользователя сейчас. */
async function countActiveProjects(userId: string): Promise<number> {
  const { rows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM projects WHERE user_id = $1 AND status = 'active'`,
    [userId],
  );
  return parseInt(rows[0]?.cnt ?? '0', 10) || 0;
}

/**
 * Можно ли создать ещё один проект? null = можно; иначе — отказ для 402.
 * @param extra — сколько проектов создаётся в этом запросе (импорт = 1).
 */
export async function checkProjectCreateLimit(userId: string, extra = 1): Promise<PlanLimitDenial | null> {
  const plan = await resolveUserPlan(userId);
  if (plan === 'pro') return null;
  let count = 0;
  try {
    count = await countActiveProjects(userId);
  } catch (e: any) {
    if (e?.code !== '42P01' && e?.code !== '42703') console.warn('[planLimits] project count failed:', e?.message);
    return null; // БД-сбой не должен блокировать создание
  }
  if (count + extra <= FREE_MAX_PROJECTS) return null;
  return {
    code: 'PLAN_LIMIT_PROJECTS',
    error: FREE_MAX_PROJECTS === 1
      ? 'На бесплатном тарифе доступен один активный проект. Перо Pro снимает лимит.'
      : `На бесплатном тарифе доступно проектов: ${FREE_MAX_PROJECTS}. Перо Pro снимает лимит.`,
    limit: FREE_MAX_PROJECTS,
    plan,
  };
}

/**
 * Можно ли «прочитать» (анализировать в Мир) эту главу? null = можно.
 * Free ограничен первыми FREE_BIBLE_CHAPTERS главами проекта (ранг по `order`).
 * Ранг = число глав проекта с order ≤ order этой главы (1-based, устойчиво к разрывам order).
 */
export async function checkBibleChapterLimit(
  userId: string,
  projectId: string,
  chapterId: string,
): Promise<PlanLimitDenial | null> {
  const plan = await resolveUserPlan(userId);
  if (plan === 'pro') return null;
  let rank = 0;
  try {
    const { rows } = await pool.query<{ rank: string }>(
      `SELECT COUNT(*)::text AS rank
         FROM chapters c
         JOIN chapters self ON self.id = $1
        WHERE c.project_id = $2 AND c."order" <= self."order"`,
      [chapterId, projectId],
    );
    rank = parseInt(rows[0]?.rank ?? '0', 10) || 0;
  } catch (e: any) {
    if (e?.code !== '42P01' && e?.code !== '42703') console.warn('[planLimits] chapter rank failed:', e?.message);
    return null;
  }
  if (rank === 0 || rank <= FREE_BIBLE_CHAPTERS) return null; // rank 0 = главу не нашли → не блокируем
  return {
    code: 'PLAN_LIMIT_BIBLE_CHAPTERS',
    error: `На бесплатном тарифе Мир анализирует первые ${FREE_BIBLE_CHAPTERS} глав. Перо Pro снимает лимит.`,
    limit: FREE_BIBLE_CHAPTERS,
    plan,
  };
}
