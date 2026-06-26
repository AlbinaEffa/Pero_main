-- Тип главы: 'chapter' (по умолчанию) | 'prologue' | 'epilogue' | 'interlude'.
-- Нужен, чтобы прологи/эпилоги/интерлюдии подписывались своим словом, а не «Глава N».
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS chapter_type text NOT NULL DEFAULT 'chapter';
