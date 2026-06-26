-- Комментарии: авторские пометки, привязанные к диапазону текста главы.
-- id === commentId марки в документе. source author|pero (задел под единый слой полей).
CREATE TABLE IF NOT EXISTS comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id),
  body       text NOT NULL DEFAULT '',
  quote      text NOT NULL DEFAULT '',
  source     text NOT NULL DEFAULT 'author',
  resolved   boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_chapter_idx ON comments(chapter_id);
CREATE INDEX IF NOT EXISTS comments_project_idx ON comments(project_id);
