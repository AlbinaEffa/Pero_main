-- Бит-карта (столб «Сюжет», линза «Канва»).
CREATE TABLE IF NOT EXISTS plot_beatmaps (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template   text NOT NULL,
  beats      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plot_beatmaps_project_idx ON plot_beatmaps(project_id);
