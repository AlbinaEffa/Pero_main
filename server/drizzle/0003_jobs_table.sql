-- Job queue — persistent background task tracking
-- Supports: extract_entities, embed_chapter
-- Worker uses SELECT ... FOR UPDATE SKIP LOCKED for safe concurrent pickup

CREATE TABLE IF NOT EXISTS jobs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type          TEXT        NOT NULL,                  -- 'extract_entities' | 'embed_chapter'
  payload       JSONB       NOT NULL DEFAULT '{}',
  status        TEXT        NOT NULL DEFAULT 'queued', -- queued | running | succeeded | failed
  attempts      INTEGER     NOT NULL DEFAULT 0,
  max_attempts  INTEGER     NOT NULL DEFAULT 3,
  error         TEXT,
  project_id    UUID        REFERENCES projects(id)    ON DELETE CASCADE,
  user_id       UUID        REFERENCES users(id)       ON DELETE CASCADE,
  run_after     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast pickup: only look at queued jobs that are ready to run
CREATE INDEX IF NOT EXISTS idx_jobs_pickup
  ON jobs (status, run_after)
  WHERE status = 'queued';

-- Dashboard polling: jobs for a project
CREATE INDEX IF NOT EXISTS idx_jobs_project
  ON jobs (project_id, status, created_at DESC);
