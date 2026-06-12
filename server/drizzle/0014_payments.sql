-- 0014_payments.sql
-- Платежи ЮKassa: история оплат Pro-подписки.
-- Апгрейд плана происходит по вебхуку payment.succeeded (см. routes/billing.ts).

CREATE TABLE IF NOT EXISTS payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL DEFAULT 'yookassa',
  -- id платежа на стороне ЮKassa; уникален → вебхук идемпотентен
  provider_payment_id TEXT UNIQUE,
  amount_rub          NUMERIC(10,2) NOT NULL,
  -- pending | succeeded | canceled
  status              TEXT NOT NULL DEFAULT 'pending',
  plan                TEXT NOT NULL DEFAULT 'pro',
  period_days         INTEGER NOT NULL DEFAULT 30,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON payments (user_id, created_at DESC);
