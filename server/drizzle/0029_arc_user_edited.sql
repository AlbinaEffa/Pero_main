-- Правленые автором арки переживают рентген (режим архитектора для Арок).
ALTER TABLE character_arcs ADD COLUMN IF NOT EXISTS user_edited boolean NOT NULL DEFAULT false;
