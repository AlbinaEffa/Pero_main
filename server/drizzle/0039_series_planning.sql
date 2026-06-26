-- Холст планирования серии (фронт-дверь): вёдра замысла (всё опционально) + слоты будущих книг
-- + серия-уровневый чат-брейншторм. Слоты книг — jsonb на серии (книга без проекта, пока план).
ALTER TABLE series ADD COLUMN IF NOT EXISTS premise text;        -- о чём серия (логлайн/синопсис)
ALTER TABLE series ADD COLUMN IF NOT EXISTS lore text;           -- мир/лор (свободные заметки)
ALTER TABLE series ADD COLUMN IF NOT EXISTS cast_notes text;     -- герои (свободные заметки)
ALTER TABLE series ADD COLUMN IF NOT EXISTS planned_books jsonb DEFAULT '[]'::jsonb NOT NULL; -- слоты-план [{id,title,about,introduces}]

-- Серия-уровневый чат (книги может ещё не быть) — отдельная ветка истории по серии.
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES series(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS chat_history_series_idx ON chat_history (series_id);
