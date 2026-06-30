-- GIN-индекс под лексический (русский FTS) слой гибридного ретрива: чат (retrieveSemanticChunks)
-- и кросс-главная сверка (retrieveCrossChapterPassages). Выражение индекса ТОЧНО совпадает с
-- запросами `to_tsvector('russian', chunk_text)` — иначе планировщик его не использует.
-- Двухаргументный to_tsvector с константным конфигом IMMUTABLE → функциональный индекс допустим.
-- Replay-safe. БЕЗ CONCURRENTLY (миграции идут в транзакции; на текущем объёме блокировка мгновенна).
CREATE INDEX IF NOT EXISTS idx_semantic_memory_fts_ru
  ON semantic_memory USING gin (to_tsvector('russian', chunk_text));
