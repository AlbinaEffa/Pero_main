-- Кастомные бит-шаблоны (бит-архитектор).
CREATE TABLE IF NOT EXISTS beat_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key        text NOT NULL,
  name       text NOT NULL,
  beats      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS beat_templates_project_idx ON beat_templates(project_id);
