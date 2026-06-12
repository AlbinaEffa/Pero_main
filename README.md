# Перо

Текстовый редактор для писателей, которые работают над длинной прозой — романами, фэнтези, LitRPG. Не для профессионалов с издателями, а для тех, кто пишет по вечерам и знает: открыть документ на главе 34 и не помнить, какого цвета глаза у персонажа из главы 7.

**Главная идея:** AI читает то, что уже написано, и сам строит из текста структурированную картину мира — персонажей, локации, предметы, правила вселенной. Автор ничего не вводит вручную.

---

## Возможности

- **Story Bible** — AI автоматически извлекает сущности из текста (персонажи, локации, предметы, правила мира). Автор только одобряет или отклоняет предложения.
- **Справочник** — контекстный срез текущей главы: кто присутствует, какие предметы, какая локация.
- **Соавтор** — AI-чат с контекстом текущей главы и всей Story Bible.
- **Диктовка** — текст появляется прямо в редакторе.
- **Семантический поиск** — pgvector, находит по смыслу, а не по точному совпадению.
- **Экспорт** — PDF, DOCX, Markdown.

---

## Стек

| Слой | Технологии |
|---|---|
| Frontend | React + Vite + TypeScript + Tiptap + Tailwind |
| Backend | Node.js + Express + TypeScript |
| База данных | PostgreSQL + Drizzle ORM + pgvector |
| AI | Переключаемый провайдер: Gemini (default) / OpenAI-совместимые (OpenAI, OpenRouter, DeepSeek, локальные) / Anthropic Claude — см. `server/src/lib/aiProvider.ts` |
| Деплой | Docker + docker-compose |

---

## Запуск локально

### Требования

- Node.js 20+
- PostgreSQL 15+ с расширением `pgvector`
- Docker (опционально)

### 1. Установить зависимости

```bash
npm install
cd server && npm install && cd ..
```

### 2. Создать `.env` файлы

```bash
cp .env.example .env
cp server/.env.example server/.env
```

Заполнить обязательные поля:

```
# .env
VITE_API_BASE_URL=http://localhost:3001/api

# server/.env
DATABASE_URL=postgresql://user:password@localhost:5432/pero
JWT_SECRET=your-secret-here

# AI-провайдер: gemini (default) | openai | anthropic
AI_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-key
# Или, например, OpenRouter:
# AI_PROVIDER=openai
# AI_BASE_URL=https://openrouter.ai/api/v1
# AI_API_KEY=sk-or-...
# AI_MODEL=anthropic/claude-haiku-4.5
```

Полный список AI-настроек (модель, эмбеддинги) — в `server/.env.example`.
Эмбеддинги для семантического поиска фиксированы на 768 измерений (pgvector):
Gemini `text-embedding-004` или OpenAI `text-embedding-3-small` (с `dimensions=768`).
Anthropic эмбеддинги не предоставляет — при `AI_PROVIDER=anthropic` дополнительно
задайте `GEMINI_API_KEY` или `OPENAI_API_KEY`, иначе семантический поиск отключится.

### 3. Запустить миграции

```bash
cd server && npm run migrate && cd ..
```

### 4. Запустить

```bash
# Два терминала:
npm run dev          # frontend на :3000
cd server && npm run dev  # backend на :3001
```

---

## Деплой в продакшене

Используется `docker-compose.prod.yml`. Нужна внешняя база данных (Supabase, Neon, Railway Postgres).

```bash
cp .env.example .env.prod
# Заполнить .env.prod реальными значениями

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Сервисы:
- `frontend` — Nginx, порт 80
- `server` — Express API, порт 3001

---

## Структура проекта

```
pero/
├── src/              # React frontend
│   ├── pages/        # Dashboard, Editor
│   ├── components/   # UI-компоненты
│   └── services/     # API-клиент
├── server/
│   └── src/
│       ├── routes/   # auth, projects, chapters, bible, ai, export...
│       ├── db/       # Drizzle schema + migrations
│       ├── jobs/     # Фоновые задачи (AI-экстракция)
│       └── lib/      # AI, embeddings, circuit breaker
├── docker-compose.prod.yml
└── .env.example
```

---

## Команды

```bash
npm run dev          # Запустить frontend
npm run build        # Собрать frontend
npm run typecheck    # TypeScript check (frontend + backend)
npm run test:e2e     # Playwright e2e тесты

cd server
npm run dev          # Запустить backend
npm run migrate      # Применить миграции
npm run build        # Собрать backend
```
