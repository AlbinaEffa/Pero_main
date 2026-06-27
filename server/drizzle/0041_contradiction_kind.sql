-- Классификатор нестыковок: два потока вместо «молчаливого фильтра».
-- 'contradiction' = твёрдый конфликт (алярм) | 'development' = развитие/раскрытие (спокойный поток).
-- Старые строки = contradiction (как и было).
ALTER TABLE contradiction_issues
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'contradiction';
