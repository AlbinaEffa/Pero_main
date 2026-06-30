import { pgTable, text, timestamp, uuid, jsonb, integer, numeric, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// We need to make sure the vector extension exists
// This will be handled in migrations or manually, but we define the custom type here
import { customType } from 'drizzle-orm/pg-core';

const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM) || 1024;

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    // Размерность из env EMBEDDING_DIM (bge-m3 → 1024, nomic → 768).
    // Должна совпадать с миграцией колонки и EMBEDDING_DIM в aiProvider.
    return `vector(${EMBEDDING_DIM})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    // pgvector returns a string like "[1.2, 3.4, ...]"
    return JSON.parse(value);
  },
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  /** Тарифный план: 'free' | 'pro'. Определяет дневные квоты AI (см. lib/quota.ts). */
  plan: text('plan').default('free').notNull(),
  /** Когда истекает оплаченный план; NULL = бессрочно (free) */
  planExpiresAt: timestamp('plan_expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const series = pgTable('series', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  title: text('title').notNull(),
  // Холст планирования серии (всё опционально — автор заполняет или пропускает).
  premise: text('premise'),                       // о чём серия (логлайн/синопсис)
  lore: text('lore'),                             // мир/лор (свободные заметки)
  castNotes: text('cast_notes'),                  // герои (свободные заметки)
  plannedBooks: jsonb('planned_books').$type<{ id: string; title: string; about?: string; introduces?: string }[]>().default([]).notNull(),
  franchiseThreads: jsonb('franchise_threads').$type<{ id: string; title: string; opensBook?: string; closesBook?: string; summary?: string }[]>().default([]).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  title: text('title').notNull(),
  genre: text('genre'),
  seriesId: uuid('series_id').references(() => series.id, { onDelete: 'set null' }), // null = вне серии
  seriesOrder: integer('series_order'), // порядок книги в серии
  logline: text('logline'),   // одна фраза — суть книги (замысел как корень)
  premise: text('premise'),   // премис/синопсис книги — абзац
  shareToken: text('share_token'), // read-only публичная ссылка на библию (null = не расшарено)
  worldSnapshot: jsonb('world_snapshot'),                 // снимок мира на конец книги (Этап E4)
  worldSnapshotAt: timestamp('world_snapshot_at'),
  color: text('color').default('#3A4F41'),
  status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});


export const chapters = pgTable('chapters', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id).notNull(),
  title: text('title').notNull(),
  content: text('content'),
  order: integer('order').default(0).notNull(),
  status: text('status').default('draft').notNull(), // 'draft' | 'done'
  /** Тип главы: 'chapter' | 'prologue' | 'epilogue' | 'interlude'. Подписывается своим словом. */
  chapterType: text('chapter_type').default('chapter').notNull(),
  /** Cached word count — updated on every content save, avoids per-request regex scans. */
  wordCount: integer('word_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  /** Set to NOW() every time /bible/extract successfully analyzes this chapter. */
  lastExtractedAt: timestamp('last_extracted_at'),
  /**
   * Short SHA-256 prefix of the plain-text content at the time of the last extraction.
   * Used to skip recheck when nothing has changed (zero AI cost) and to compute a
   * paragraph-level diff for incremental re-extraction.
   */
  lastExtractedContentHash: text('last_extracted_content_hash'),
  /**
   * Хеши абзацев на момент последнего извлечения (jsonb-массив строк). Позволяет
   * инкрементальный recheck: слать модели ТОЛЬКО изменённые абзацы (экономия токенов).
   */
  lastExtractedParagraphHashes: jsonb('last_extracted_paragraph_hashes'),
  /**
   * Имя персонажа, от лица которого ведётся повествование в главе (POV). Определяется
   * при извлечении. null — третье лицо или POV не определён. Первое лицо «я» в главе
   * относится к этому персонажу; местоимения сущностями НЕ становятся.
   */
  povCharacter: text('pov_character'),
  /** Краткая аннотация главы (1–2 предложения «что произошло»), извлекается ИИ. */
  summary: text('summary'),
  /** Авторский план главы (что задумано) — заполняется ДО текста, режим архитектора. */
  plan: text('plan'),
});

// Permanent Memory Tables

// Episodic Memory: Chat history with the agent
export const chatHistory = pgTable('chat_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  projectId: uuid('project_id').references(() => projects.id),
  chapterId: uuid('chapter_id').references(() => chapters.id), // Optional: scoped to a specific chapter
  seriesId: uuid('series_id').references(() => series.id, { onDelete: 'cascade' }), // серия-уровневый чат-брейншторм (книги может не быть)
  role: text('role').notNull(), // 'user' or 'model'
  content: text('content').notNull(),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
});

// Semantic Memory: Vector embeddings of lore, characters, story beats
export const semanticMemory = pgTable('semantic_memory', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  projectId: uuid('project_id').references(() => projects.id).notNull(),
  chapterId: uuid('chapter_id').references(() => chapters.id), // source chapter
  chunkText: text('chunk_text').notNull(),
  embedding: vector('embedding'),
  metadata: jsonb('metadata'), // e.g., { chunkIndex: 0 }
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Story Bible: entities extracted by AI from the text
export const storyEntities = pgTable('story_entities', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id).notNull(),
  chapterId: uuid('chapter_id').references(() => chapters.id), // which chapter it was extracted from
  type: text('type').notNull(), // 'character' | 'location' | 'item' | 'rule'
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
  /** Importance tier assigned by AI: 'major' | 'moderate' | 'minor'. Null if not yet classified. */
  significance: text('significance'),
  /**
   * Structured per-type attributes populated by AI during extraction.
   * character: { aliases?, appearance?, personality?, role? }
   * location:  { mood?, physicalDetails?, region? }
   * item:      { properties?, origin?, owner? }
   * rule:      { scope?, exceptions? }
   */
  attributes: jsonb('attributes'),
  /**
   * Кэш семантического эмбеддинга карточки (имя + описание). embeddingText хранит
   * текст, по которому считали — если текущий «имя. описание» отличается (или embedding
   * пуст), вектор пересчитывается. Используется дедупом по смыслу и семантическими линзами.
   * Размерность = EMBEDDING_DIM (vector(1024) для bge-m3).
   */
  embedding: vector('embedding'),
  embeddingText: text('embedding_text'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Entity Links — связи между сущностями («мать», «соперник», «живёт в»)
// Извлекаются AI вместе с сущностями; relation читается от source → target.
export const entityLinks = pgTable('entity_links', {
  id:             uuid('id').primaryKey().defaultRandom(),
  projectId:      uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  sourceEntityId: uuid('source_entity_id').references(() => storyEntities.id, { onDelete: 'cascade' }).notNull(),
  targetEntityId: uuid('target_entity_id').references(() => storyEntities.id, { onDelete: 'cascade' }).notNull(),
  relation:       text('relation').notNull(),
  chapterId:      uuid('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
});

// Entity Events — события арки сущности по главам (таймлайн персонажа)
// event_type: 'conflict' | 'relationship' | 'status' | 'revelation' | 'other'
export const entityEvents = pgTable('entity_events', {
  id:           uuid('id').primaryKey().defaultRandom(),
  projectId:    uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  entityId:     uuid('entity_id').references(() => storyEntities.id, { onDelete: 'cascade' }).notNull(),
  chapterId:    uuid('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  chapterTitle: text('chapter_title'),
  title:        text('title').notNull(),
  description:  text('description'),
  eventType:    text('event_type'),
  // Сюжетная хронология (PRD: видеть флешбеки и реальный порядок событий)
  timeLabel:    text('time_label'),   // маркер времени из текста: «за год до», «той же ночью»
  timeHint:     text('time_hint'),    // 'past' | 'present' | 'future' | 'flashback'
  createdAt:    timestamp('created_at').defaultNow().notNull(),
});

// Contradiction Reports — отчёт противоречий по всей книге (PRD P1.2).
// Одна строка на прогон сканирования; статус и прогресс для поллинга с фронта.
export const contradictionReports = pgTable('contradiction_reports', {
  id:              uuid('id').primaryKey().defaultRandom(),
  projectId:       uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  status:          text('status').notNull().default('running'), // running | done | failed
  totalChapters:   integer('total_chapters').notNull().default(0),
  scannedChapters: integer('scanned_chapters').notNull().default(0),
  error:           text('error'),
  createdAt:       timestamp('created_at').defaultNow().notNull(),
  updatedAt:       timestamp('updated_at').defaultNow().notNull(),
});

// Найденные противоречия — отдельными строками; автор может отклонить ложное (status).
export const contradictionIssues = pgTable('contradiction_issues', {
  id:           uuid('id').primaryKey().defaultRandom(),
  reportId:     uuid('report_id').references(() => contradictionReports.id, { onDelete: 'cascade' }).notNull(),
  projectId:    uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  chapterId:    uuid('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  chapterTitle: text('chapter_title'),
  entityName:   text('entity_name'),
  issue:        text('issue').notNull(),
  quote:        text('quote'),   // точная конфликтная фраза из текста главы (для подсветки)
  severity:     text('severity').notNull().default('medium'), // low | medium | high
  // Поток: 'contradiction' = твёрдый конфликт (алярм, красный) | 'development' = развитие/раскрытие
  // (спокойный поток, не ошибка). Классификатор даёт модели «карман» вместо ложной тревоги.
  kind:         text('kind').notNull().default('contradiction'),
  status:       text('status').notNull().default('open'),     // open | dismissed
  createdAt:    timestamp('created_at').defaultNow().notNull(),
});

// Plot threads / «ружья Чехова» (столб «Сюжет», линза «Линии»).
// ИИ читает синопсисы глав и выделяет сюжетные линии: где введена, где развивается,
// закрыта ли. Незакрытые к концу книги = «ружья Чехова».
export const plotThreads = pgTable('plot_threads', {
  id:                uuid('id').primaryKey().defaultRandom(),
  projectId:         uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  title:             text('title').notNull(),                      // «Тайна крыльев Ризанда»
  summary:           text('summary'),                              // 1–2 предложения о линии
  kind:              text('kind').notNull().default('subplot'),    // main|subplot|mystery|promise|relationship
  resolved:          boolean('resolved').notNull().default(false), // выстрелило ли ружьё
  introChapterId:    uuid('intro_chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  introChapterTitle: text('intro_chapter_title'),
  lastChapterId:     uuid('last_chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  lastChapterTitle:  text('last_chapter_title'),
  chapterIds:        jsonb('chapter_ids').$type<string[]>().default([]).notNull(), // где упоминается
  characterNames:    jsonb('character_names').$type<string[]>().default([]).notNull(), // герои линии (как извлечены)
  entityIds:         jsonb('entity_ids').$type<string[]>().default([]).notNull(),      // те же, резолвнутые в Мир
  origin:            text('origin').notNull().default('ai'),         // ai | author (ручная план-нить)
  userStatus:        text('user_status').notNull().default('active'), // active | dismissed
  createdAt:         timestamp('created_at').defaultNow().notNull(),
});

// Бит-карта (столб «Сюжет», линза «Канва»). Один ряд на (проект, шаблон).
// ИИ реверс-детектит, какая глава отыгрывает каждый бит шаблона (Романс-бит / Save the Cat / 3 акта).
export const plotBeatmaps = pgTable('plot_beatmaps', {
  id:         uuid('id').primaryKey().defaultRandom(),
  projectId:  uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  template:   text('template').notNull(), // romancing_the_beat | save_the_cat | three_act
  // [{ key, label, pct, plan?, chapterId|null, chapterTitle|null, note? }]
  // plan — авторский замысел бита (заполняется ДО текста); chapterId/note — детект ИИ (рентген).
  beats:      jsonb('beats').$type<Array<{ key: string; label: string; pct: number; plan?: string | null; chapterId: string | null; chapterTitle: string | null; note?: string }>>().default([]).notNull(),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
});

// Кастомные бит-шаблоны (бит-архитектор): автор задаёт свою схему битов.
export const beatTemplates = pgTable('beat_templates', {
  id:        uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  key:       text('key').notNull(),   // 'custom:<uuid-ish>' — стабильный id шаблона
  name:      text('name').notNull(),
  beats:     jsonb('beats').$type<Array<{ key: string; label: string; pct: number }>>().default([]).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Арки персонажей (столб «Сюжет», линза «Арки»): Want/Need/Ghost/Lie/Truth.
// ИИ выводит внутреннюю арку героя из рукописи. Один ряд на персонажа.
export const characterArcs = pgTable('character_arcs', {
  id:         uuid('id').primaryKey().defaultRandom(),
  projectId:  uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  entityId:   uuid('entity_id').references(() => storyEntities.id, { onDelete: 'set null' }),
  entityName: text('entity_name').notNull(),
  want:       text('want'),   // внешняя цель
  need:       text('need'),   // внутренняя потребность / рост
  ghost:      text('ghost'),  // травма прошлого
  lie:        text('lie'),    // ложное убеждение
  truth:      text('truth'),  // истина, принятая в кульминации
  userEdited: boolean('user_edited').notNull().default(false), // правил ли автор (переживает рентген)
  userStatus: text('user_status').notNull().default('active'),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
});

// Background Job Queue
// Persisted in Postgres — survives server restarts. Worker polls every 5s.
// Supported types: 'extract_entities' | 'embed_chapter'
export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull().default({}),
  status: text('status').notNull().default('queued'), // queued | running | succeeded | failed
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  error: text('error'),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  runAfter: timestamp('run_after').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// AI cost logging — every Gemini call writes an entry here
export const costLogs = pgTable('cost_logs', {
  id:               uuid('id').primaryKey().defaultRandom(),
  userId:           uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  projectId:        uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  model:            text('model').notNull(),
  route:            text('route').notNull(),
  inputTokens:      integer('input_tokens').notNull().default(0),
  outputTokens:     integer('output_tokens').notNull().default(0),
  estimatedCostUsd: numeric('estimated_cost_usd', { precision: 12, scale: 8 }).notNull().default('0'),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
});

// Extraction traces — телеметрия прогонов извлечения (НЕ подаётся в промпт). Снимок:
// что вернула модель (raw_response, обрезанный), какой POV подан, и решения промоут-гейта
// (outcome). Для отладки качества ИИ (китайский/JSON/over-classify) и метрики здоровья
// извлечения. Пишется fire-and-forget на 3 call-site'ах извлечения.
export const extractionTraces = pgTable('extraction_traces', {
  id:           uuid('id').primaryKey().defaultRandom(),
  projectId:    uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  chapterId:    uuid('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  jobId:        uuid('job_id'),                 // связь с jobs (worker-путь), без FK-каскада
  route:        text('route').notNull(),        // worker:extract | bible:extract | bible:recheck
  model:        text('model'),
  povUsed:      text('pov_used'),               // какой POV подан в промпт (Фаза 2/3)
  rawResponse:  text('raw_response'),            // ответ модели, обрезанный
  outcome:      jsonb('outcome').notNull().default({}), // ExtractionTraceStats
  inputTokens:  integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
});

// Bible Update Suggestions — proposed description changes for already-approved entities
// Created by /extract and /recheck when AI returns a known entity with new information.
export const bibleUpdateSuggestions = pgTable('bible_update_suggestions', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  projectId:           uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  entityId:            uuid('entity_id').references(() => storyEntities.id, { onDelete: 'cascade' }).notNull(),
  chapterId:           uuid('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  chapterTitle:        text('chapter_title'),
  previousDescription: text('previous_description'),
  proposedDescription: text('proposed_description').notNull(),
  /** Raw-text excerpt from the chapter surrounding the entity name (≈60 chars each side). */
  sourceExcerpt:       text('source_excerpt'),
  reason:              text('reason'),
  // 'pending' | 'accepted' | 'rejected' | 'dismissed'
  status:              text('status').notNull().default('pending'),
  createdAt:           timestamp('created_at').defaultNow().notNull(),
  updatedAt:           timestamp('updated_at').defaultNow().notNull(),
});

// Платежи ЮKassa — история оплат Pro-подписки
export const payments = pgTable('payments', {
  id:                uuid('id').primaryKey().defaultRandom(),
  userId:            uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  provider:          text('provider').default('yookassa').notNull(),
  providerPaymentId: text('provider_payment_id').unique(),
  amountRub:         numeric('amount_rub', { precision: 10, scale: 2 }).notNull(),
  status:            text('status').default('pending').notNull(), // pending | succeeded | canceled
  plan:              text('plan').default('pro').notNull(),
  periodDays:        integer('period_days').default(30).notNull(),
  createdAt:         timestamp('created_at').defaultNow().notNull(),
  updatedAt:         timestamp('updated_at').defaultNow().notNull(),
});

// Beta feedback — submitted via the in-app floating "Отзыв" button
export const feedback = pgTable('feedback', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  type:      text('type').notNull().default('general'), // bug | idea | praise | general
  message:   text('message').notNull(),
  page:      text('page'),
  metadata:  jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Заметки/идеи — «пре-продакшен» автора (доска карточек). Единая модель: kind = тип,
// опц. привязка к главе/сущности. См. миграцию 0022_notes.sql.
export const notes = pgTable('notes', {
  id:        uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  userId:    uuid('user_id').references(() => users.id).notNull(),
  kind:      text('kind').notNull().default('idea'),   // idea | note | question | todo
  body:      text('body').notNull().default(''),
  status:    text('status').notNull().default('open'), // open | done | archived
  pinned:    boolean('pinned').notNull().default(false),
  chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  entityId:  uuid('entity_id').references(() => storyEntities.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Комментарии — авторские пометки, ПРИВЯЗАННЫЕ к диапазону текста главы (якорь = марка
// comment в документе, её commentId === comments.id). В отличие от notes (доска идей, без
// привязки к месту) комментарий живёт «на полях» и решается. source: author — твоя пометка,
// pero — задел под единый слой (находки Перо). Не идёт в экспорт.
export const comments = pgTable('comments', {
  id:        uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'cascade' }).notNull(),
  userId:    uuid('user_id').references(() => users.id).notNull(),
  body:      text('body').notNull().default(''),
  quote:     text('quote').notNull().default(''),     // снимок выделенного текста (контекст/восстановление)
  source:    text('source').notNull().default('author'), // author | pero
  resolved:  boolean('resolved').notNull().default(false),
  // Тред ответов (режим рецензирования, как в Word): [{ id, body, author, createdAt }].
  replies:   jsonb('replies').$type<Array<{ id: string; body: string; author: 'author' | 'pero'; createdAt: string }>>().default([]).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
