-- 0017_event_chronology.sql
-- Сюжетная хронология событий: маркер времени из текста + грубая подсказка «когда».
-- Линза «Таймлайн/Арки» использует их, чтобы показывать флешбеки и реальный порядок,
-- а не только порядок глав.

ALTER TABLE entity_events ADD COLUMN IF NOT EXISTS time_label text;
ALTER TABLE entity_events ADD COLUMN IF NOT EXISTS time_hint  text;
