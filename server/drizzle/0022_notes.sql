-- Заметки/идеи: «пре-продакшен» автора (собирает идеи → строит Мир → пишет книгу).
-- Единая доска карточек; kind = тип (idea/note/question/todo), опц. связь с главой/сущностью.
CREATE TABLE IF NOT EXISTS notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id),
  kind        text NOT NULL DEFAULT 'idea',   -- idea | note | question | todo
  body        text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'open',    -- open | done | archived
  pinned      boolean NOT NULL DEFAULT false,
  chapter_id  uuid REFERENCES chapters(id) ON DELETE SET NULL,        -- опц. привязка к главе
  entity_id   uuid REFERENCES story_entities(id) ON DELETE SET NULL,  -- опц. привязка к сущности
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notes_project_idx ON notes(project_id);
