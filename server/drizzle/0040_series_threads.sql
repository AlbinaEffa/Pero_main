-- Нити франшизы (P1): сквозные ружья серии — открыта в книге X → закроется в книге Y.
-- Авторский слой (заполняет автор на холсте серии). jsonb на серии, как planned_books.
ALTER TABLE series ADD COLUMN IF NOT EXISTS franchise_threads jsonb DEFAULT '[]'::jsonb NOT NULL;
