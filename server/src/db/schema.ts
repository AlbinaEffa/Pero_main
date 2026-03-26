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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  /** Set to NOW() every time /bible/extract successfully analyzes this chapter. */
  lastExtractedAt: timestamp('last_extracted_at'),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
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
