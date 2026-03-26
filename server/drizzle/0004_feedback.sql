-- Beta feedback table: in-app "Отзыв" button submissions
CREATE TABLE IF NOT EXISTS feedback (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  type       TEXT        NOT NULL DEFAULT 'general', -- bug | idea | praise | general
  message    TEXT        NOT NULL,
  page       TEXT,        -- route/page where feedback was submitted
  metadata   JSONB,       -- { userAgent, projectId, platform, ... }
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_user    ON feedback (user_id);
