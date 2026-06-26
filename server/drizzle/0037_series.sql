-- Слой серии (Этап E1, вариант A): серия — контейнер над книгами. Сущности остаются в книгах,
-- серия лишь группирует и упорядочивает их. Книга может быть вне серии (series_id = null).
CREATE TABLE IF NOT EXISTS series (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  title       text NOT NULL,
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES series(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS series_order integer;

CREATE INDEX IF NOT EXISTS projects_series_idx ON projects (series_id);
