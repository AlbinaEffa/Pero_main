-- Сюжетные линии / «ружья Чехова» (столб «Сюжет», линза «Линии»).
CREATE TABLE IF NOT EXISTS plot_threads (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title               text NOT NULL,
  summary             text,
  kind                text NOT NULL DEFAULT 'subplot',
  resolved            boolean NOT NULL DEFAULT false,
  intro_chapter_id    uuid REFERENCES chapters(id) ON DELETE SET NULL,
  intro_chapter_title text,
  last_chapter_id     uuid REFERENCES chapters(id) ON DELETE SET NULL,
  last_chapter_title  text,
  chapter_ids         jsonb NOT NULL DEFAULT '[]'::jsonb,
  user_status         text NOT NULL DEFAULT 'active',
  created_at          timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plot_threads_project_idx ON plot_threads(project_id);
