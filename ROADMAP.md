# Перо — Roadmap

Рабочий план движения к продакшену. Статусы: `[ ]` не начато · `[~]` в процессе · `[x]` готово

---

## 🧹 Технический долг и подготовка репо

- [x] Обновить `.gitignore` (agents-tools, firestore.rules, *.xlsx)
- [x] Удалить stray-файлы руками: `Cian_Salary_Calculator.xlsx`, `build_salary_model.py`, `firestore.rules`, `agents-tools/`
- [x] Написать нормальный README.md (что за продукт, как запустить, как задеплоить)

---

## 🚀 Деплой

- [ ] Выбрать платформу (Railway / Fly.io / VPS)
- [ ] Настроить внешний PostgreSQL (Supabase / Neon / Railway Postgres)
- [ ] Настроить переменные окружения в проде
- [ ] Первый деплой через `docker-compose.prod.yml`
- [ ] Настроить домен

---

## 🔁 CI/CD

- [ ] GitHub Actions: запуск TypeScript typecheck (`npm run typecheck`)
- [ ] GitHub Actions: запуск Vitest (unit-тесты сервера)
- [ ] GitHub Actions: запуск security smoke tests
- [ ] GitHub Actions: автодеплой при пуше в `main`

---

## 📊 Мониторинг

- [ ] Подключить Sentry (фронт + бэк) — DSN уже в `.env.example`
- [ ] Подключить PostHog — ключ уже в `.env.example`
- [ ] Убедиться что aiGuard (circuit breaker) подключён ко всем AI-роутам

---

## 📖 Story Bible — улучшения (по мотивам анализа Mythril)

### Приоритет 1 — Быстро и высокоценно
- [x] Добавить `significance: 'major' | 'moderate' | 'minor'` на `storyEntities`
- [x] Добавить `attributes: jsonb` на `storyEntities`
  - Структурированные поля: aliases, appearance, personality (персонажи), mood, physicalDetails (локации) и т.д.
  - AI заполняет при экстракции, автор видит в карточке

### Приоритет 2 — Ключевая фича
- [ ] Новая таблица `entity_timeline` — таймлайн событий на каждую сущность
  - Поля: `entityId`, `chapterId`, `eventText`, `order`
  - AI извлекает события при обработке каждой главы
  - UI: вкладка "Timeline" в карточке персонажа/локации/предмета
- [ ] Новая таблица `entity_connections` — связи между сущностями
  - Поля: `fromEntityId`, `toEntityId`, `relationshipType`, `description`
  - UI: правый сайдбар в карточке показывает связанных персонажей и локации

### Приоритет 3 — Расширение Bible
- [ ] Plot & Structure как раздел Bible
  - AI анализирует каждую главу: narrative summary, conflicts & stakes (external/internal/tension)
  - Хранится в отдельной таблице `chapter_analysis`
- [ ] Настройки проекта: жанр, поджанры, аудитория, уровень контента
  - Добавить поле `settings: jsonb` на `projects`
  - Страница настроек проекта в UI
  - Эти данные передаются в контекст AI-запросов

### Приоритет 4 — Приятное дополнение
- [ ] Снэпшоты Bible (version history для компендиума)
- [ ] Asset Library — изображения для сущностей
- [ ] Статистика на Dashboard (количество персонажей, локаций, событий)

---

## 📝 Заметки

- Конкурент для изучения: **Mythril** — самый близкий по концепции английский аналог
- Схема данных сейчас: `storyEntities` = flat (name + description + type). Нужно обогащать через jsonb `attributes`, не пересоздавая таблицу
- pgvector уже есть — семантический поиск работает, это преимущество перед Mythril
