-- Add order and status columns to chapters table
ALTER TABLE "chapters" ADD COLUMN IF NOT EXISTS "order" integer NOT NULL DEFAULT 0;
ALTER TABLE "chapters" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'draft';

-- Back-fill order based on creation time within each project
-- so existing chapters get a stable, correct sequence
UPDATE "chapters" c
SET "order" = sub.rn - 1
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at) AS rn
  FROM "chapters"
) sub
WHERE c.id = sub.id;
