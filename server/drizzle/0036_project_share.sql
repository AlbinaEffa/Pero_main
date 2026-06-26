-- Шеринг библии read-only ссылкой (Этап D). share_token = null → не расшарено.
-- Частичный уникальный индекс: токен уникален, но null'ов может быть много.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS share_token text;
CREATE UNIQUE INDEX IF NOT EXISTS projects_share_token_uniq ON projects (share_token) WHERE share_token IS NOT NULL;
