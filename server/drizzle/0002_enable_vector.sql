-- Migration: Enable pgvector, add embedding + chapter_id to semantic_memory
-- Run manually: psql $DATABASE_URL -f server/drizzle/0002_enable_vector.sql

-- Requires pgvector extension (preinstalled on Supabase, Neon, RDS with pg_vector)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column (768-dim for Google text-embedding-004)
ALTER TABLE semantic_memory ADD COLUMN IF NOT EXISTS embedding vector(768);

-- Add chapter_id for efficient per-chapter chunk deletion/re-embedding
ALTER TABLE semantic_memory
  ADD COLUMN IF NOT EXISTS chapter_id UUID REFERENCES chapters(id) ON DELETE SET NULL;

-- IVFFlat index for fast cosine similarity search
-- lists=100 is suitable for up to ~1M vectors; tune to sqrt(row_count) in production
CREATE INDEX IF NOT EXISTS idx_semantic_memory_embedding
  ON semantic_memory USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Index for per-chapter chunk lookup (used during re-embedding)
CREATE INDEX IF NOT EXISTS idx_semantic_memory_chapter
  ON semantic_memory (chapter_id) WHERE chapter_id IS NOT NULL;
