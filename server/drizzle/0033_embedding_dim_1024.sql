-- Апгрейд эмбеддингов на bge-m3 (мультиязычная, сильная на русском): 768 → 1024.
-- Старые 768-векторы несовместимы по размерности → очищаем semantic_memory и
-- переэмбеддим все главы заново (локально через Ollama, без API-токенов).
-- pgvector не умеет менять размерность типизированной колонки при наличии данных,
-- поэтому: дроп ivfflat-индекса → очистка → ALTER TYPE → пересоздание индекса.

DROP INDEX IF EXISTS idx_semantic_memory_embedding;

DELETE FROM semantic_memory;

ALTER TABLE semantic_memory
  ALTER COLUMN embedding TYPE vector(1024);

-- ВАЖНО: ivfflat-индекс НЕ создаём.
-- Запросы ретрива всегда фильтруются по project_id (а это сотни чанков на книгу),
-- и есть btree idx_semantic_memory_project_user (project_id, user_id) — Postgres
-- сузит выборку до глав проекта и точно отсортирует по дистанции (exact KNN, 100%
-- recall, быстро на таком объёме). Глобальный ivfflat на vector(1024) при малых
-- данных раскидывает строки по ~100 кластерам, запрос попадает в пустой кластер и
-- получает 0 результатов (pgvector сам предупреждает «little data → low recall»).
-- Вернуть ANN-индекс (лучше HNSW) имеет смысл лишь когда на проект будут десятки
-- тысяч чанков.
DROP INDEX IF EXISTS idx_semantic_memory_embedding;
