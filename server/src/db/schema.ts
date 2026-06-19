import { pgTable, text, timestamp, uuid, jsonb, integer, numeric } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// We need to make sure the vector extension exists
// This will be handled in migrations or manually, but we define the custom type here
import { customType } from 'drizzle-orm/pg-core';

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(768)'; // 768 is the default dimension for Google's text-embedding-004
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

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  title: text('title').notNull(),
  genre: text('genre'),
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
   * Имя персонажа, от лица которого ведётся повествование в главе (POV). Определяется
   * при извлечении. null — третье лицо или POV не определён. Первое лицо «я» в главе
   * относится к этому персонажу; местоимения сущностями НЕ становятся.
   */
  povCharacter: text('pov_character'),
  /** Краткая аннотация главы (1–2 предложения «что произошло»), извлекается ИИ. */
  summary: text('summary'),
});

// Permanent Memory Tables

// Episodic Memory: Chat history with the agent
export const chatHistory = pgTable('chat_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  projectId: uuid('project_id').references(() => projects.id),
  chapterId: uuid('chapter_id').references(() => chapters.id), // Optional: scoped to a specific chapter
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
  status:       text('status').notNull().default('open'),     // open | dismissed
  createdAt:    timestamp('created_at').defaultNow().notNull(),
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
