-- Замысел книги как корень (Этап C): логлайн (одна фраза) + премис/синопсис (абзац).
-- Висит над всей структурой «Сюжета», сшивает замысел↔план↔текст (дыра USM #6).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS logline text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS premise text;
