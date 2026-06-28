# TECHDEBT — Перо

Единый реестр технического долга. Собрано 27.06.2026 после серии чисток.
Формат: 🔴 критично · 🟠 заметно · 🟡 средне · 🟢 мелочь/осознанно. Размер: S день / M неск. дней / L крупно.

> Кодбаза: ~37 600 строк (`src` + `server/src`), 44 миграции.

---

## 🟠 Тесты — сетка поднята, нужно расширять (был главный долг)
- **Было:** 1 тест-файл, 0 unit на ~37k строк → вся верификация ручная.
- **Стало (27.06):** vitest-харнессы с ОБЕИХ сторон + **~110 тестов** (85 server + 25 client):
  - server unit: `extraction.test.ts` (40) + `html.test.ts` (11) — без БД.
  - server интеграция: `api.test.ts` (auth/ownership/bible) + `planLimits.integration.test.ts` (3: пейволл проекта/импорта) — реальная БД.
  - client: `editorUtils.test.tsx` (16) + `storyBibleDedup.test.ts` (9). vitest+jsdom подняты.
  - **Сразу окупилось:** полный прогон вскрыл латентную регрессию (Free-лимит ронял api.test.ts) — починено.
- **✅ CI поднят (27.06):** `.github/workflows/ci.yml` на push/PR в develop/main — typecheck (client+server)
  + Postgres pgvector + миграции с нуля + **все тесты** (server **101** unit+интеграция, client 25), зелёный.
  Регрессии больше не утекают молча.
- **✅ Расширено (27.06):** `incrementalRecheck.test.ts` (13: split/hash/решение инкремента — экономия токенов)
  + лимит глав библии в `planLimits.integration.test.ts` (3: граница ранга 30/31 + эндпоинт 402 до AI).
- **Осталось по тестам:** quota (DB-мок/интеграция), компоненты-хуки; **Playwright e2e** на петлю
  «импорт→чтение→нестыковка».

## ✅ Миграции реплеятся с нуля — ПОЧИНЕНО (27.06, был прод-блокер бутстрапа)
- **Был симптом:** свежая БД через `runMigrations` (= сервер при старте, прод-бутстрап, CI) не строила
  схему — прод-деплой на пустую БД упал бы. Корень — дрейф `drizzle-kit push` (часть схемы создавалась
  напрямую из schema.ts, МИМО трекаемых *.sql) + невалидный индекс + ордеринг.
- **Что починено** (всё идемпотентно, no-op на dev/прод): `0006a` восстанавливает таблицу `story_entities`
  (создавалась push'ем); `0006b` — колонки `users.password_hash`, `projects.status/color/genre` (push-дрейф);
  `0005` — `DATE(timestamptz)`-индекс (не IMMUTABLE) → обычный `(user_id, created_at)`; `0001_memory_tables`
  — guard `ADD COLUMN IF NOT EXISTS chapter_id` перед индексом.
- **Проверка:** чистая БД → `runMigrations` → схема **колонка-в-колонку идентична dev**; все 85 серверных
  тестов (вкл. api/planLimits) зелёные на свежей БД. CLI `npm run migrate` (`src/scripts/migrate.ts`).
- **Правило на будущее:** новые миграции — replay-safe (`IF NOT EXISTS`), не пушить схему мимо *.sql.

## 🟠 Крупные файлы (дробление)
| Файл | Строк | Статус |
|---|---|---|
| `src/pages/Editor.tsx` | 2349 | ◐ −350 (3 хука вынесены); дальше убывающая отдача |
| `server/src/routes/bible.ts` | 1471 | ◐ −209: вынесены `incrementalRecheck` + `recheckPrompts` (чистые); остаток — роут-бог (извлечение+нестыковки+дедуп+merge+RAG) |
| `src/components/editor/EditorCanvas.tsx` | 1660 | ⬜ тулбар+холст+сноски — кандидат на под-компоненты |
| `src/pages/Dashboard.tsx` | 1351 | ◐ цвет→токены; инлайн-стили→Tailwind остаётся |
| `server/src/lib/extraction.ts` | 649 | ◐ −557: промпты «Сюжета» → `plotPrompts.ts`, промпты извлечения/нестыковок/жанра → `extractionPrompts.ts`; остаток — утилы+дедуп+резолвер `processExtractionResults` |
| `src/components/editor/StoryBiblePanel.tsx` | 1162 | ⬜ каталог+линзы+дедуп |
- **Подход:** оппортунистически — выносить кластер, когда правишь область. Не самоцель (P3), но bible.ts/extraction.ts стоит разнести по доменам. **Priority:** P3 (фон).

## 🟡 Типобезопасность (`: any`)
- **39 `: any`** (без `catch`, без тестов) — после чистки 27.06 (было 45). Что осталось — почти всё
  **граница доверия / внешнее** (там `any` защитим, как `catch`):
  - LLM-JSON парсинг с рантайм-гардами: `plot.ts` (14), `bible.ts` (3), `series.ts` (1).
  - XML/EPUB/FB2 парсинг: `import.ts` (6, вкл. catch).
  - SDK/внешние API: `aiProvider.ts` (6), `yookassa.ts` (2), jwt-callback `auth.ts` (2).
  - Скрипты/фреймворк: `testLocal.ts`, `backfillPov.ts`, `worker.ts payload`, `app.ts err-handler`.
- **✅ Сделано 27.06:** `export.ts` (5→0) — билдеры markdown/docx/bible принимали DB-строки как `any[]`,
  теперь узкие view-типы `ExportProject/Chapter/Entity` (ловят опечатки полей; экспорт покрыт тестами);
  `getCircuitStates()` аннотирован → `app.ts` health-check без `any`.
- **7 `as any`** — внешние/неизбежные (SDK Gemini ×3, `pdf-parse` CJS-интероп, Sentry-глобал, guarded jsonb в SelectionBar ×2). Документированы, оставлены.
- **Priority:** P3. Самое ценное (DB-строки в билдерах) закрыто; остальное — защитимый идиом, не трогаем
  без нужды (рефактор LLM-парсинга рискован — нельзя верифицировать без токенов на AI).

## 🟢 Мелочи / осознанное
- **19 `console.log`** в app-коде (не scripts/tests) — стоит свести к структурному логгеру или убрать шум. S.
- **10 `eslint-disable react-hooks/exhaustive-deps`** — НЕ долг: намеренные (эффекты с рефами/одноразовый маунт).
- **0** TODO/FIXME/HACK, **0** @ts-ignore, **0** мёртвого кода (вычищено).

---

## Архитектурные / прод-долги (не grep-абельны, из CLAUDE.md)
- 🔴 **Эмбеддинги завязаны на localhost Ollama** (`bge-m3`) — в проде такого нет. Нужен Ollama в compose ИЛИ облачный embedding-API. Блокирует RAG/дедуп/семантику на проде. **Priority:** P1 к бете.
- 🔴 **Прод-хостинг не поднят** (сервер+Postgres+pgvector+домен+HTTPS+вебхук ЮKassa+бэкапы). Блокирует бету и платежи. **Priority:** P1.
- 🟠 **Качество сверки упирается в модель** — Kimi/локалки слабы (ложные нестыковки, CJK-утечки). Промпт-классификатор готов, но нужен frontier-ключ для шага сверки. **Priority:** P0b (нужен ключ + ОК по токенам).
- 🟡 **Worker в процессе API** — для беты (20–30 авторов) ок; вынос в отдельный процесс «по сигналу очередь >2 мин». Graceful shutdown уже есть. **Priority:** P2.
- 🟡 **Биллинг ЮKassa** — код готов, нужны ключи + вебхук + тестовый платёж. **Priority:** P3 (внешнее).
- 🟢 **Дедуп эмбеддит сущности на каждый клик без кэша** (частично закэшировано на `story_entities.embedding`) — медленно на больших книгах. **Priority:** P3.

---

## ✅ Закрыто этой серией (27.06)
- `req: any` в роутах: ~127 → **0** (типизированный `AuthedRequest` + аугментация).
- `as any`: 24 → **7**; `@ts-ignore`: 1 → **0** (устаревший passwordHash-ignore).
- Мёртвый код: `ContradictionPopover`, `diffParagraphs` — убраны.
- `Editor.tsx`: 2699 → 2349 (3 хука/модуля: `editorUtils`, `useContradictions`, `useChapterComments`).
- Дизайн-токены: Dashboard полностью на `ink()`/`PALETTE` (0 сырых ink-литералов).
- a11y: вторичный текст `ink/50 → /60`.
- Смелл: автосейв снят с `window` на модульную переменную.
- **Тест-сетка поднята:** vitest+jsdom (фронт) + 56 юнит-тестов на горячее ядро (было 0 unit).
