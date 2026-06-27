-- Пер-абзацные хеши для инкрементального recheck: слать модели только изменённые
-- абзацы (экономия токенов на перепроверке больших глав). NULL = базлайна ещё нет.
ALTER TABLE chapters
  ADD COLUMN IF NOT EXISTS last_extracted_paragraph_hashes jsonb;
