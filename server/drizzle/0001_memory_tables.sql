-- Migration: Persistent chat history + semantic memory scaffold
-- Run manually: psql $DATABASE_URL -f server/drizzle/0001_memory_tables.sql
-- Or via drizzle-kit: npm run db:migrate (from /server)

-- ─────────────────────────────────────────────────────────
-- chat_history: episodic memory — every AI conversation turn
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  UUID        REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id  UUID        REFERENCES chapters(id) ON DELETE SET NULL,
  role        TEXT        NOT NULL CHECK (role IN ('user', 'model')),
  content     TEXT        NOT NULL,
  timestamp   TIMESTAMP   NOT NULL DEFAULT NOW()
);

-- Fast lookup by user+project+chapter in chronological order
CREATE INDEX IF NOT EXISTS idx_chat_history_lookup
  ON chat_history (user_id, project_id, chapter_id, timestamp ASC);

-- ─────────────────────────────────────────────────────────
-- semantic_memory: future vector search (requires pgvector)
-- Scaffold only — embedding column added after pgvector install
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS semantic_memory (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chunk_text  TEXT        NOT NULL,
  -- embedding  vector(768), -- uncomment after: CREATE EXTENSION IF NOT EXISTS vector;
  metadata    JSONB,
  created_at  TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_semantic_memory_project
  ON semantic_memory (user_id, project_id);
