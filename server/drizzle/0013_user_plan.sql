-- 0013_user_plan.sql
-- Тарифные планы пользователей (free | pro) — фундамент для квот AI и биллинга.
-- Плюс индекс на cost_logs для быстрого подсчёта дневного использования.

ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

-- Когда план истекает (для Pro-подписки); NULL = бессрочно/free
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMP;

-- Быстрый подсчёт «AI-действий за сегодня» по пользователю
CREATE INDEX IF NOT EXISTS idx_cost_logs_user_created
  ON cost_logs (user_id, created_at DESC);
