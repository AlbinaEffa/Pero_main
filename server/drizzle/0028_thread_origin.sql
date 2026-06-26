-- Авторские план-нити vs ИИ-извлечённые (режим архитектора для Линий).
ALTER TABLE plot_threads ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'ai';
