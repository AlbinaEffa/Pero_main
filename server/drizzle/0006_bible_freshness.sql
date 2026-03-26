-- Track when each chapter was last analyzed for Story Bible extraction.
-- A chapter is "stale" when its updated_at > last_extracted_at (or last_extracted_at IS NULL
-- and the project has approved Story Bible entities).
-- Used to show freshness badges / re-check prompts in the editor.
ALTER TABLE "chapters" ADD COLUMN IF NOT EXISTS "last_extracted_at" TIMESTAMPTZ;
