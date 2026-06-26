-- Линии несут своих героев (связь линии↔персонажи).
ALTER TABLE plot_threads ADD COLUMN IF NOT EXISTS character_names jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE plot_threads ADD COLUMN IF NOT EXISTS entity_ids      jsonb NOT NULL DEFAULT '[]'::jsonb;
