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
| AI | Google Gemini (text-embedding-004 + генерация) |
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
GEMINI_API_KEY=your-gemini-key
```

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
