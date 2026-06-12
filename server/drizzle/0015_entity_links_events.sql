-- 0015_entity_links_events.sql
-- Глубокие профили персонажей (PRD P1.1/P1.4, бенчмарк Mythril):
--   entity_links  — связи между сущностями («мать», «соперник», «живёт в»), извлекаются AI
--   entity_events — события арки сущности по главам (таймлайн персонажа)

CREATE TABLE IF NOT EXISTS entity_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_entity_id uuid NOT NULL REFERENCES story_entities(id) ON DELETE CASCADE,
  target_entity_id uuid NOT NULL REFERENCES story_entities(id) ON DELETE CASCADE,
  -- Короткий тип связи от лица source → target: «мать», «наставник», «владеет»
  relation         text NOT NULL,
  chapter_id       uuid REFERENCES chapters(id) ON DELETE SET NULL,
  created_at       timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entity_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_id     uuid NOT NULL REFERENCES story_entities(id) ON DELETE CASCADE,
  chapter_id    uuid REFERENCES chapters(id) ON DELETE SET NULL,
  chapter_title text,
  title         text NOT NULL,
  description   text,
  -- 'conflict' | 'relationship' | 'status' | 'revelation' | 'other'
  event_type    text,
  created_at    timestamp NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_entity_links_project_id ON entity_links (project_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_entity_links_source ON entity_links (source_entity_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_entity_links_target ON entity_links (target_entity_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_entity_events_project_id ON entity_events (project_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_entity_events_entity_id ON entity_events (entity_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;
