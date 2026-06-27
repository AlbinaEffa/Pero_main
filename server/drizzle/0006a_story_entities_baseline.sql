-- БАЗОВАЯ таблица story_entities — фундамент «Мира» (сущности рукописи).
--
-- Исторически создавалась `drizzle-kit push` напрямую из schema.ts, МИМО трекаемых
-- *.sql, поэтому в наборе миграций её не было → replay с нуля (CI, чистый прод-деплой)
-- падал на 0007 («relation story_entities does not exist»). Эта миграция восстанавливает
-- пробел. Только базовые колонки: significance/attributes доложит 0012, embedding/
-- embedding_text — 0034 (там `ADD COLUMN IF NOT EXISTS`, так что порядок безопасен).
--
-- IF NOT EXISTS → no-op на инкрементальных БД (dev/прод), где таблица уже есть.
CREATE TABLE IF NOT EXISTS story_entities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id),
  chapter_id  uuid REFERENCES chapters(id),
  type        text NOT NULL,
  name        text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'pending',
  created_at  timestamp without time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_story_entities_project_id
  ON story_entities (project_id);
CREATE INDEX IF NOT EXISTS idx_story_entities_project_status
  ON story_entities (project_id, status);
