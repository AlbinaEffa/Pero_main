CREATE TABLE IF NOT EXISTS "bible_update_suggestions" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"           UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "entity_id"            UUID NOT NULL REFERENCES "story_entities"("id") ON DELETE CASCADE,
  "chapter_id"           UUID REFERENCES "chapters"("id") ON DELETE SET NULL,
  "chapter_title"        TEXT,
  "previous_description" TEXT,
  "proposed_description" TEXT NOT NULL,
  "reason"               TEXT,
  "status"               TEXT NOT NULL DEFAULT 'pending',
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "bible_update_suggestions_project_status"
  ON "bible_update_suggestions" ("project_id", "status");
