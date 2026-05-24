-- Story Bible enrichment: significance tier + structured attributes
-- significance: 'major' | 'moderate' | 'minor' (null = not yet classified)
-- attributes:   jsonb — per-type structured fields populated by AI

ALTER TABLE story_entities
  ADD COLUMN IF NOT EXISTS significance text,
  ADD COLUMN IF NOT EXISTS attributes   jsonb;
