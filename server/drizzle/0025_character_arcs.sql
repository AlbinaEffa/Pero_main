-- Арки персонажей (столб «Сюжет», линза «Арки»): Want/Need/Ghost/Lie/Truth.
CREATE TABLE IF NOT EXISTS character_arcs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_id   uuid REFERENCES story_entities(id) ON DELETE SET NULL,
  entity_name text NOT NULL,
  want        text,
  need        text,
  ghost       text,
  lie         text,
  truth       text,
  user_status text NOT NULL DEFAULT 'active',
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS character_arcs_project_idx ON character_arcs(project_id);
