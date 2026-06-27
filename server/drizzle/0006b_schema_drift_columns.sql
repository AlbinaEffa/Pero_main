-- Восстановление колонок, добавленных `drizzle-kit push` напрямую из schema.ts
-- МИМО трекаемых миграций (тот же дрейф, что у story_entities в 0006a). Без них
-- replay с нуля даёт неполную схему: регистрация падает (нет users.password_hash),
-- создание проекта — без status/color/genre.
--
-- IF NOT EXISTS → no-op на инкрементальных БД (dev/прод), где колонки уже есть.
-- На свежей БД users/projects пустые, поэтому NOT NULL-колонки добавляются без проблем.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash text NOT NULL;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS color  text DEFAULT '#3A4F41',
  ADD COLUMN IF NOT EXISTS genre  text;
