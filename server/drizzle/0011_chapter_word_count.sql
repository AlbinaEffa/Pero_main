-- 0011_chapter_word_count.sql
-- Add cached word_count to chapters to avoid per-request regex scans.
-- Backfill computes a naive word count from stored content.

ALTER TABLE chapters ADD COLUMN IF NOT EXISTS word_count INTEGER NOT NULL DEFAULT 0;

-- Backfill: strip basic HTML tags and count whitespace-separated words
UPDATE chapters
SET word_count = (
  SELECT COALESCE(
    array_length(
      regexp_split_to_array(
        trim(regexp_replace(COALESCE(content, ''), '<[^>]*>', ' ', 'g')),
        '[[:space:]]+'
      ), 1
    ), 0
  )
)
WHERE content IS NOT NULL AND content != '';
