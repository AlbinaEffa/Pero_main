-- 0010_indexes.sql
-- Performance indexes for foreign keys and hot query paths.
-- Uses DO blocks so each index is created independently — a missing table
-- (e.g. optional cost_logs) does not abort the whole migration.

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects (user_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_chapters_project_id ON chapters (project_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_chapters_project_order ON chapters (project_id, "order");
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_chat_history_user_project ON chat_history (user_id, project_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_story_entities_project_id ON story_entities (project_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_story_entities_project_status ON story_entities (project_id, status);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_semantic_memory_project_user ON semantic_memory (project_id, user_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_jobs_status_run_after ON jobs (status, run_after) WHERE status = 'queued';
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_bible_suggestions_project_status ON bible_update_suggestions (project_id, status);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_cost_logs_user_id ON cost_logs (user_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;
