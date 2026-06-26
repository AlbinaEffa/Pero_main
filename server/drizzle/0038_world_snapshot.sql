-- Снимок мира на конец книги (Этап E4): замороженный канон (значимые сущности + финальный статус),
-- старт-канон для следующей книги серии. Выводится из Мира детерминированно (без AI).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS world_snapshot jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS world_snapshot_at timestamp;
