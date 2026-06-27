/**
 * Биллинг Pro-подписки через ЮKassa.
 *
 * Флоу:
 *   1. POST /api/billing/checkout — создаём платёж 599 ₽, сохраняем pending-запись,
 *      отдаём confirmationUrl → фронтенд редиректит пользователя на оплату.
 *   2. ЮKassa после оплаты шлёт вебхук POST /api/billing/webhook (event payment.succeeded).
 *      Мы НЕ доверяем телу вебхука: перепроверяем платёж напрямую в API ЮKassa,
 *      и только после подтверждения апгрейдим план. Идемпотентно.
 *   3. Пользователь возвращается на return_url; фронтенд опрашивает
 *      GET /api/billing/status до появления plan='pro'.
 *
 * v1 — без автопродления: разовый платёж на 30 дней. Продление — повторная оплата
 * (срок прибавляется к остатку). Даунгрейд по истечении делает quota.ts на лету.
 *
 * Env: YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY, PRO_PRICE_RUB (default 599),
 *      FRONTEND_URL (для return_url; fallback — первый из ALLOWED_ORIGINS).
 */

import express from 'express';
import { eq, and, desc } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { db, pool } from '../db/client.js';
import { authenticateToken, type AuthedRequest } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimiter.js';
import { createPayment, getPayment, isYooKassaConfigured } from '../lib/yookassa.js';

const router = express.Router();

const PRO_PERIOD_DAYS = 30;

function proPriceRub(): number {
  const n = parseFloat(process.env.PRO_PRICE_RUB ?? '599');
  return Number.isFinite(n) && n > 0 ? n : 599;
}

function frontendUrl(): string {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL.replace(/\/+$/, '');
  const firstOrigin = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
    .split(',')[0]?.trim().replace(/\/+$/, '');
  return firstOrigin || 'http://localhost:3000';
}

// ─── POST /api/billing/checkout ───────────────────────────────────────────────
// Создаёт платёж и возвращает { confirmationUrl } для редиректа на оплату.
// ──────────────────────────────────────────────────────────────────────────────
router.post('/checkout',
  authenticateToken,
  rateLimit('billing:checkout', 10, 60 * 60 * 1000),
  async (req: AuthedRequest, res) => {
    try {
      if (!isYooKassaConfigured()) {
        return res.status(503).json({ error: 'Оплата временно недоступна (платёжный провайдер не настроен)' });
      }

      const userRows = await db
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, req.user.userId));
      if (userRows.length === 0) return res.status(404).json({ error: 'User not found' });

      const amountRub = proPriceRub();

      const payment = await createPayment({
        amountRub,
        description: `Перо Pro — подписка на ${PRO_PERIOD_DAYS} дней`,
        returnUrl: `${frontendUrl()}/settings?payment=pending`,
        metadata: { userId: req.user.userId },
        customerEmail: userRows[0].email,
      });

      await db.insert(schema.payments).values({
        userId: req.user.userId,
        provider: 'yookassa',
        providerPaymentId: payment.id,
        amountRub: amountRub.toFixed(2),
        status: 'pending',
        plan: 'pro',
        periodDays: PRO_PERIOD_DAYS,
      });

      const confirmationUrl = payment.confirmation?.confirmation_url;
      if (!confirmationUrl) {
        return res.status(502).json({ error: 'Платёжный провайдер не вернул ссылку на оплату' });
      }

      res.json({ confirmationUrl, paymentId: payment.id });
    } catch (error) {
      console.error('Error in POST /billing/checkout:', error);
      res.status(500).json({ error: 'Не удалось создать платёж. Попробуйте ещё раз.' });
    }
  }
);

// ─── Общая логика подтверждения платежа ──────────────────────────────────────
// Перепроверяет платёж в API ЮKassa и, если succeeded, апгрейдит план.
// Идемпотентно: повторный вызов для уже обработанного платежа ничего не ломает.
// ──────────────────────────────────────────────────────────────────────────────
async function confirmPayment(providerPaymentId: string): Promise<{ ok: boolean; reason?: string }> {
  // 1. Источник истины — API ЮKassa, не тело вебхука
  const remote = await getPayment(providerPaymentId);
  if (remote.status !== 'succeeded' || !remote.paid) {
    // canceled → пометим локально и выйдем
    if (remote.status === 'canceled') {
      await db.update(schema.payments)
        .set({ status: 'canceled', updatedAt: new Date() })
        .where(eq(schema.payments.providerPaymentId, providerPaymentId));
    }
    return { ok: false, reason: `payment status: ${remote.status}` };
  }

  // 2. Находим локальную запись
  const rows = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.providerPaymentId, providerPaymentId));
  const local = rows[0];
  if (!local) return { ok: false, reason: 'local payment record not found' };
  if (local.status === 'succeeded') return { ok: true }; // уже обработан — идемпотентность

  // Доп. защита: userId из metadata должен совпадать с локальной записью
  if (remote.metadata?.userId && remote.metadata.userId !== local.userId) {
    return { ok: false, reason: 'metadata userId mismatch' };
  }

  // 3. Атомарно: платёж → succeeded, план → pro, срок = max(сейчас, текущий) + 30 дней
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE payments SET status = 'succeeded', updated_at = NOW()
        WHERE provider_payment_id = $1 AND status != 'succeeded'`,
      [providerPaymentId]
    );
    await client.query(
      `UPDATE users
          SET plan = 'pro',
              plan_expires_at = GREATEST(COALESCE(plan_expires_at, NOW()), NOW())
                                + ($2 || ' days')::interval
        WHERE id = $1`,
      [local.userId, String(local.periodDays)]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  console.log(`[billing] ✓ user ${local.userId} upgraded to pro (+${local.periodDays}d, payment ${providerPaymentId})`);
  return { ok: true };
}

// ─── POST /api/billing/webhook ────────────────────────────────────────────────
// Уведомления ЮKassa. Без auth (внешний сервис). Безопасность: статус платежа
// перепроверяется в API ЮKassa, тело уведомления используется только как сигнал.
// Всегда отвечаем 200, чтобы ЮKassa не зациклила ретраи на наших ошибках логики.
// ──────────────────────────────────────────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  try {
    if (!isYooKassaConfigured()) return res.status(200).end();

    const event = req.body?.event as string | undefined;
    const paymentId = req.body?.object?.id as string | undefined;
    if (!paymentId || typeof paymentId !== 'string') return res.status(200).end();

    if (event === 'payment.succeeded' || event === 'payment.canceled') {
      const result = await confirmPayment(paymentId);
      if (!result.ok) console.warn(`[billing] webhook ${event} for ${paymentId}: ${result.reason}`);
    }

    res.status(200).end();
  } catch (error) {
    console.error('Error in POST /billing/webhook:', error);
    // 500 → ЮKassa повторит уведомление позже (это желаемое поведение при сбое БД/API)
    res.status(500).end();
  }
});

// ─── GET /api/billing/status ──────────────────────────────────────────────────
// Текущий план + последний платёж. Если есть pending-платёж — проверяем его
// статус в ЮKassa на лету (подстраховка, если вебхук не дошёл).
// ──────────────────────────────────────────────────────────────────────────────
router.get('/status', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    // Подстраховка: довести «зависшие» pending-платежи без вебхука
    if (isYooKassaConfigured()) {
      const pending = await db
        .select({ providerPaymentId: schema.payments.providerPaymentId })
        .from(schema.payments)
        .where(and(
          eq(schema.payments.userId, req.user.userId),
          eq(schema.payments.status, 'pending'),
        ))
        .orderBy(desc(schema.payments.createdAt))
        .limit(3);
      for (const p of pending) {
        if (p.providerPaymentId) {
          await confirmPayment(p.providerPaymentId).catch(() => {});
        }
      }
    }

    const userRows = await db
      .select({ plan: schema.users.plan, planExpiresAt: schema.users.planExpiresAt })
      .from(schema.users)
      .where(eq(schema.users.id, req.user.userId));
    if (userRows.length === 0) return res.status(404).json({ error: 'User not found' });

    const { plan, planExpiresAt } = userRows[0];
    const isActive = plan === 'pro' && (!planExpiresAt || planExpiresAt.getTime() > Date.now());

    const lastPayments = await db
      .select({
        amountRub: schema.payments.amountRub,
        status: schema.payments.status,
        createdAt: schema.payments.createdAt,
      })
      .from(schema.payments)
      .where(eq(schema.payments.userId, req.user.userId))
      .orderBy(desc(schema.payments.createdAt))
      .limit(5);

    res.json({
      plan: isActive ? 'pro' : 'free',
      planExpiresAt,
      priceRub: proPriceRub(),
      periodDays: PRO_PERIOD_DAYS,
      payments: lastPayments,
    });
  } catch (error) {
    console.error('Error in GET /billing/status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
