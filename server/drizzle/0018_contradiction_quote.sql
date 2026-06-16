-- 0018_contradiction_quote.sql
-- Точная фраза из текста главы, которая противоречит Библии — для подсветки нестыковки
-- прямо в рукописи (не только имени сущности).
ALTER TABLE contradiction_issues ADD COLUMN IF NOT EXISTS quote text;
