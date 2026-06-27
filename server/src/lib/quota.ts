/**
 * Квоты AI-действий per-user — фундамент тарифов Free/Pro.
 *
 * Принцип: каждый успешный интерактивный AI-вызов уже логируется в cost_logs
 * (см. aiGuard.ts). Квота = количество таких записей за текущие сутки (UTC).
 * Отдельная таблица счётчиков не нужна.
 *
 * Что СЧИТАЕТСЯ: интерактивные действия пользователя — чат, трансформации,
 * диктовка, проверка консистентности, извлечение/перепроверка библии, ревизии.
 *
 * Что НЕ считается:
 *   • фоновые джобы (route LIKE 'worker:%') — извлечение и эмбеддинги при импорте
 *     рукописи: это aha-момент онбординга, его нельзя душить квотой;
 *   • эмбеддинги (route LIKE '%embed%') — инфраструктурные вызовы, копеечные.
 *
 * Лимиты настраиваются через env:
 *   QUOTA_FREE_AI_PER_DAY (default 20)
 *   QUOTA_PRO_AI_PER_DAY  (default 300)
 */

import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';

export type Plan = 'free' | 'pro';

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getPlanLimits(): Record<Plan, { aiPerDay: number }> {
  return {
    free: { aiPerDay: intFromEnv('QUOTA_FREE_AI_PER_DAY', 20) },
    pro:  { aiPerDay: intFromEnv('QUOTA_PRO_AI_PER_DAY', 300) },
  };
}

export interface QuotaStatus {
  plan: Plan;
  used: number;
  limit: number;
  remaining: number;
  /** ISO-время сброса квоты (начало следующих суток UTC) */
  resetsAt: string;
}

/** Начало следующих суток UTC */
function nextUtcMidnight(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

/**
 * Текущий статус квоты пользователя.
 * Деградация: при любой ошибке БД (например, миграция ещё не применена)
 * возвращает «всё разрешено», чтобы квоты никогда не роняли продукт.
 */
/**
 * Тариф пользователя на текущий момент. Просроченный pro трактуется как free
 * (подстраховка на случай, если даунгрейд биллинга не успел примениться).
 * Деградирует к 'free' при любой ошибке БД — лимиты не должны ронять продукт.
 * Общий источник для квот AI И лимитов тарифа (см. planLimits.ts).
 */
export async function resolveUserPlan(userId: string): Promise<Plan> {
  try {
    const { rows } = await pool.query<{ plan: string; plan_expires_at: Date | null }>(
      `SELECT plan, plan_expires_at FROM users WHERE id = $1`,
      [userId]
    );
    const raw = rows[0]?.plan === 'pro' ? 'pro' : 'free';
    const expires = rows[0]?.plan_expires_at;
    return raw === 'pro' && expires && expires.getTime() < Date.now() ? 'free' : raw;
  } catch (e: any) {
    if (e?.code !== '42703') console.warn('[quota] failed to read user plan:', e?.message);
    return 'free';
  }
}

export async function getQuotaStatus(userId: string): Promise<QuotaStatus> {
  const limits = getPlanLimits();

  const plan: Plan = await resolveUserPlan(userId);

  let used = 0;
  try {
    const { rows } = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
         FROM cost_logs
        WHERE user_id = $1
          AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'utc')
          AND route NOT LIKE 'worker:%'
          AND route NOT LIKE '%embed%'`,
      [userId]
    );
    used = parseInt(rows[0]?.cnt ?? '0', 10) || 0;
  } catch (e: any) {
    // 42P01 = cost_logs ещё не создана — квоту не применяем
    if (e?.code !== '42P01') console.warn('[quota] failed to count usage:', e?.message);
  }

  const limit = limits[plan].aiPerDay;
  return {
    plan,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetsAt: nextUtcMidnight(),
  };
}

/**
 * Express-middleware: блокирует AI-маршрут с 429, если дневная квота исчерпана.
 * Ставить ПОСЛЕ authenticateToken и rateLimit.
 *
 *   router.post('/chat', authenticateToken, rateLimit(...), aiQuota, handler)
 */
export async function aiQuota(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) { next(); return; } // нет auth — пусть разбирается auth middleware

  let status: QuotaStatus;
  try {
    status = await getQuotaStatus(userId);
  } catch {
    next(); // квота никогда не должна ронять запрос
    return;
  }

  res.setHeader('X-AI-Quota-Limit', String(status.limit));
  res.setHeader('X-AI-Quota-Remaining', String(status.remaining));

  if (status.used >= status.limit) {
    res.status(429).json({
      error: status.plan === 'free'
        ? `Дневной лимит AI-действий исчерпан (${status.limit} в день на бесплатном тарифе). Лимит обновится в полночь по UTC.`
        : `Дневной лимит AI-действий исчерпан (${status.limit} в день). Лимит обновится в полночь по UTC.`,
      code: 'AI_QUOTA_EXCEEDED',
      quota: status,
    });
    return;
  }

  next();
}
