-- Cost tracking for AI calls — lets us monitor spend per user/project
CREATE TABLE IF NOT EXISTS cost_logs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        REFERENCES users(id) ON DELETE CASCADE,
  project_id          UUID        REFERENCES projects(id) ON DELETE SET NULL,
  model               TEXT        NOT NULL,
  route               TEXT        NOT NULL,         -- e.g. 'ai:chat', 'bible:extract'
  input_tokens        INTEGER     NOT NULL DEFAULT 0,
  output_tokens       INTEGER     NOT NULL DEFAULT 0,
  estimated_cost_usd  NUMERIC(12,8) NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast aggregation: total cost per user, per day
CREATE INDEX IF NOT EXISTS idx_cost_logs_user_day
  ON cost_logs (user_id, DATE(created_at) DESC);

CREATE INDEX IF NOT EXISTS idx_cost_logs_project
  ON cost_logs (project_id, created_at DESC);
