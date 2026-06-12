-- Store a short hash of the plain-text content at the time of the last Bible
-- extraction. Used to skip unchanged chapters (zero API cost) and to compute a
-- paragraph-level diff for incremental re-extraction.
ALTER TABLE "chapters"
  ADD COLUMN IF NOT EXISTS "last_extracted_content_hash" TEXT;
