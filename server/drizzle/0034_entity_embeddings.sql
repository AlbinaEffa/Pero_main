-- Кэш семантических эмбеддингов карточек сущностей (имя + описание).
-- embedding_text = текст, по которому считали вектор (для определения устаревания).
-- Размерность 1024 (bge-m3), как у semantic_memory. ANN-индекс не нужен: сравнение
-- идёт внутри проекта (десятки–сотни сущностей), фильтр по project_id уже индексирован.
ALTER TABLE story_entities
  ADD COLUMN IF NOT EXISTS embedding vector(1024),
  ADD COLUMN IF NOT EXISTS embedding_text text;
