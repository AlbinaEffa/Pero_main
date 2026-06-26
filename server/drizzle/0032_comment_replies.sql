-- Тред ответов на комментарий (режим рецензирования, как в Word).
ALTER TABLE comments ADD COLUMN IF NOT EXISTS replies jsonb NOT NULL DEFAULT '[]'::jsonb;
