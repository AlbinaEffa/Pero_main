/**
 * Общий конвейер AI-извлечения сущностей Библии истории.
 *
 * Используется ДВУМЯ потребителями:
 *   - server/src/routes/bible.ts  — интерактивное извлечение/перепроверка из редактора
 *   - server/src/jobs/worker.ts   — фоновое извлечение при импорте рукописи (онбординг)
 *
 * Благодаря этому главы, импортированные при онбординге, получают тот же «богатый»
 * результат, что и интерактивный анализ: significance, attributes, связи (entity_links)
 * и события таймлайна (entity_events) — «Карта мира» строится сразу после импорта.
 */
import { eq, and, ne, inArray } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { db } from '../db/client.js';

// ── helpers ──────────────────────────────────────────────────────────────────

export const isValidUUID = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Canonical normalisation for description dedupe. */
export function normalizeDesc(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** True if two descriptions carry different information. */
export function descriptionsDiffer(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeDesc(a) !== normalizeDesc(b);
}

/**
 * Extract a plain-text excerpt around the first occurrence of entityName.
 * No ellipsis — the fingerprint must be a verbatim substring for jumpToMatch.
 */
export function extractEntitySnippet(plainText: string, entityName: string, contextChars = 60): string {
  const idx = plainText.toLowerCase().indexOf(entityName.toLowerCase());
  if (idx === -1) return entityName;
  const start = Math.max(0, idx - contextChars);
  const end   = Math.min(plainText.length, idx + entityName.length + contextChars);
  return plainText.slice(start, end).trim();
}

export function cleanJsonResponse(raw: string): string {
  return raw
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();
}

// ── AI prompt ─────────────────────────────────────────────────────────────────

/**
 * High-quality extraction prompt.
 *
 * Key properties:
 * 1. Explicit importance threshold — prevents minor mentions from becoming entities.
 * 2. Evidence requirement — description must be grounded in actual text (reduces hallucinations).
 * 3. Per-category format guidance — consistent, useful descriptions.
 * 4. Explicit exclusion list — background characters, unnamed groups, etc.
 */
export const BASE_EXTRACTION_PROMPT = `Ты — литературный редактор, составляющий справочник к произведению.

Извлеки из текста главы ТОЛЬКО значимые именованные сущности четырёх категорий:

• character — персонаж с именем или устойчивым прозвищем (не «солдат», не «толпа»).
  Включай только если о нём есть хотя бы одна конкретная деталь: внешность, характер, роль.
  Описание: «[Кто он/она]. [Ключевая черта из текста]. [Роль в этой главе].»

• location — конкретное, описанное место действия (не «куда-то там», не «комната»).
  Описание: «[Что за место]. [Ключевой визуальный или атмосферный детали из текста].»

• item — предмет, важный для сюжета или магической системы.
  Описание: «[Что это]. [Физическое или магическое свойство из текста].»

• rule — закон мира, магическая система, политический строй, религия мира.
  Описание: «[В чём суть правила]. [Как оно работает согласно тексту].»

ТРЕБОВАНИЯ К КАЧЕСТВУ:
1. Не выдумывай ничего. Каждое слово описания должно быть подтверждено текстом.
2. Не добавляй сущности, упомянутые лишь вскользь (одно-два слова без деталей).
3. Используй каноническое имя (не прозвища, не «он»).
4. Не дублируй одну сущность под разными именами.
5. Если сущностей нет — верни пустой массив entities.

ПОЛЯ significance И attributes (обязательны для каждой сущности):

significance — важность сущности для всего произведения:
  "major"    — центральный персонаж/место/предмет, сюжет без него невозможен
  "moderate" — заметная роль, появляется в нескольких сценах
  "minor"    — упомянут с деталями, но роль эпизодическая

attributes — структурированные поля по типу:
  character: { "aliases": [...], "appearance": "...", "personality": "...", "role": "...",
               "background": "...", "motivations": "...", "speech": "...", "secrets": "...",
               "plotRelevance": "..." }
    background    — предыстория: факты биографии до текущих событий
    motivations   — что движет персонажем: цели, желания, страхи
    speech        — манера речи: лексика, тон, характерные обороты (для консистентности диалогов)
    secrets       — что персонаж скрывает от других
    plotRelevance — одно предложение: зачем персонаж сюжету
  location:  { "region": "...", "physicalDetails": "...", "mood": "..." }
  item:      { "properties": "...", "origin": "...", "owner": "..." }
  rule:      { "scope": "...", "exceptions": "..." }
  Включай только поля, подтверждённые текстом. Пустые поля не добавляй.

events — ТОЛЬКО для character: 0–3 сюжетно значимых события, произошедших с персонажем
  В ЭТОЙ главе. Не пересказ сцены, а перелом: конфликт, перемена статуса, важное решение,
  раскрытие тайны, сдвиг в отношениях.
  Каждое событие: { "title": "2–4 слова", "description": "одно предложение",
                    "eventType": "conflict" | "relationship" | "status" | "revelation" | "other" }

relations — связи между сущностями ответа, ЯВНО подтверждённые текстом:
  [{ "from": "Имя", "to": "Имя", "relation": "краткий тип" }]
  relation читается от from к to: «мать», «наставник», «соперник», «владеет», «живёт в».
  Не выдумывай связи и не включай неопределённые («знаком с»).

Ответ — строго JSON, без markdown-обёртки:
{
  "entities": [
    {
      "type": "character",
      "name": "Каноническое имя",
      "description": "...",
      "significance": "major",
      "attributes": { "appearance": "высокий, светловолосый", "role": "главный герой", "motivations": "вернуть младшую сестру" },
      "events": [
        { "title": "Побег из крепости", "description": "Сбегает из крепости через подземный ход.", "eventType": "status" }
      ]
    },
    {
      "type": "location",
      "name": "Название",
      "description": "...",
      "significance": "moderate",
      "attributes": { "physicalDetails": "каменные стены, низкие потолки", "mood": "мрачная" }
    }
  ],
  "relations": [
    { "from": "Каноническое имя", "to": "Название", "relation": "скрывается в" }
  ],
  "chapterSummary": "Рабочее название главы (2–4 слова)"
}`;

// ── shared: process AI extraction results ────────────────────────────────────

export interface AiEvent {
  title?: string;
  description?: string;
  eventType?: string;
}

export interface AiEntity {
  type: string;
  name: string;
  description: string;
  significance?: string;
  attributes?: Record<string, unknown>;
  events?: AiEvent[];
}

export interface AiRelation {
  from?: string;
  to?: string;
  relation?: string;
}

export interface ProcessResult {
  newSuggestions:    (typeof schema.storyEntities.$inferSelect)[];
  updateSuggestions: (typeof schema.bibleUpdateSuggestions.$inferSelect)[];
  newLinks:  number;
  newEvents: number;
}

const VALID_EVENT_TYPES = new Set(['conflict', 'relationship', 'status', 'revelation', 'other']);
const MAX_EVENTS_PER_ENTITY = 3;

/** True for null, '', whitespace-only strings and empty arrays. */
function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return !v.trim();
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * Additive attribute merge: fills ONLY missing/empty fields of the existing
 * attributes with AI-provided values. Author-visible values are never overwritten —
 * description changes go through the update-suggestion flow instead.
 * Returns the merged object, or null when nothing new was added.
 */
function mergeMissingAttributes(
  existing: Record<string, unknown> | null,
  incoming: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!incoming || typeof incoming !== 'object') return null;
  const merged: Record<string, unknown> = { ...(existing ?? {}) };
  let changed = false;
  for (const [key, value] of Object.entries(incoming)) {
    if (isEmptyValue(value)) continue;
    if (isEmptyValue(merged[key])) {
      merged[key] = value;
      changed = true;
    }
  }
  return changed ? merged : null;
}

/**
 * Persist AI-extracted entities for a chapter.
 * - New entities → pending storyEntities
 * - Known entities with updated descriptions → bibleUpdateSuggestions
 * - relations → entity_links (dedupe by source+target+relation)
 * - events → entity_events (dedupe by entity+title)
 *
 * Deduplication rules for update suggestions:
 *   already pending with same proposal  → skip (already queued)
 *   dismissed with same proposal        → reopen (surface again)
 *   rejected with same proposal         → skip (author said no)
 *   accepted with same proposal         → skip (already applied)
 */
export async function processExtractionResults(
  entities: AiEntity[],
  relations: AiRelation[],
  projectId: string,
  chapterId: string | null,
  chapterTitle: string | null,
  plainText: string | null,
): Promise<ProcessResult> {
  // All non-rejected entities: approved drive the update-suggestion flow,
  // pending ones still resolve names for links/events.
  const existingEntities = await db
    .select({
      id:           schema.storyEntities.id,
      name:         schema.storyEntities.name,
      status:       schema.storyEntities.status,
      description:  schema.storyEntities.description,
      significance: schema.storyEntities.significance,
      attributes:   schema.storyEntities.attributes,
    })
    .from(schema.storyEntities)
    .where(and(eq(schema.storyEntities.projectId, projectId), ne(schema.storyEntities.status, 'rejected')));

  const approvedMap = new Map(
    existingEntities.filter(e => e.status === 'approved').map(e => [e.name.toLowerCase(), e]),
  );
  /** Canonical name (lowercase) → entity id, for resolving relations and events. */
  const nameToId = new Map(existingEntities.map(e => [e.name.toLowerCase(), e.id]));
  const newSuggestions: (typeof schema.storyEntities.$inferSelect)[] = [];
  const updateSuggestions: (typeof schema.bibleUpdateSuggestions.$inferSelect)[] = [];
  const safeChapterId = (chapterId && isValidUUID(chapterId)) ? chapterId : null;

  for (const entity of entities) {
    if (!entity.name?.trim()) continue;
    const key = entity.name.trim().toLowerCase();
    const existing = approvedMap.get(key);

    if (!existing) {
      if (nameToId.has(key)) continue; // already pending from an earlier extraction — don't duplicate
      const validSignificance = ['major', 'moderate', 'minor'].includes(entity.significance ?? '')
        ? entity.significance!
        : null;
      const [inserted] = await db.insert(schema.storyEntities).values({
        projectId,
        chapterId: safeChapterId,
        type: entity.type || 'character',
        name: entity.name.trim(),
        description: entity.description || '',
        status: 'pending',
        significance: validSignificance,
        attributes: entity.attributes ?? null,
      }).returning();
      newSuggestions.push(inserted);
      nameToId.set(key, inserted.id);
      continue;
    }

    // Additive enrichment of approved entities: fill missing attributes and
    // significance silently (never overwrites what the author already sees).
    const enrichment: Record<string, unknown> = {};
    const mergedAttrs = mergeMissingAttributes(
      existing.attributes as Record<string, unknown> | null,
      entity.attributes,
    );
    if (mergedAttrs) enrichment.attributes = mergedAttrs;
    if (!existing.significance && ['major', 'moderate', 'minor'].includes(entity.significance ?? '')) {
      enrichment.significance = entity.significance;
    }
    if (Object.keys(enrichment).length > 0) {
      await db.update(schema.storyEntities).set(enrichment).where(eq(schema.storyEntities.id, existing.id));
    }

    if (!descriptionsDiffer(existing.description, entity.description)) continue;

    const normalizedProposal = normalizeDesc(entity.description);
    const priorSuggestions = await db
      .select({ id: schema.bibleUpdateSuggestions.id, status: schema.bibleUpdateSuggestions.status, proposedDescription: schema.bibleUpdateSuggestions.proposedDescription })
      .from(schema.bibleUpdateSuggestions)
      .where(eq(schema.bibleUpdateSuggestions.entityId, existing.id));

    const match = priorSuggestions.find(s => normalizeDesc(s.proposedDescription) === normalizedProposal);
    const sourceExcerpt = plainText ? extractEntitySnippet(plainText, entity.name) : null;

    if (!match) {
      const [inserted] = await db.insert(schema.bibleUpdateSuggestions).values({
        projectId,
        entityId:            existing.id,
        chapterId:           safeChapterId,
        chapterTitle,
        previousDescription: existing.description,
        proposedDescription: entity.description || '',
        sourceExcerpt,
        status: 'pending',
      }).returning();
      updateSuggestions.push(inserted);
    } else if (match.status === 'pending') {
      // Already queued — skip
    } else if (match.status === 'dismissed') {
      const [reopened] = await db
        .update(schema.bibleUpdateSuggestions)
        .set({ status: 'pending', chapterId: safeChapterId, chapterTitle, sourceExcerpt, updatedAt: new Date() })
        .where(eq(schema.bibleUpdateSuggestions.id, match.id))
        .returning();
      updateSuggestions.push(reopened);
    }
    // 'rejected' or 'accepted' → skip
  }

  // ── Timeline events (характерные события арки персонажа) ──────────────────
  let newEvents = 0;
  const entityIdsWithEvents = entities
    .filter(e => Array.isArray(e.events) && e.events.length > 0 && e.name?.trim())
    .map(e => nameToId.get(e.name.trim().toLowerCase()))
    .filter((id): id is string => Boolean(id));

  if (entityIdsWithEvents.length > 0) {
    const priorEvents = await db
      .select({ entityId: schema.entityEvents.entityId, title: schema.entityEvents.title })
      .from(schema.entityEvents)
      .where(inArray(schema.entityEvents.entityId, entityIdsWithEvents));
    const seenEvents = new Set(priorEvents.map(ev => `${ev.entityId}:${normalizeDesc(ev.title)}`));

    for (const entity of entities) {
      if (!Array.isArray(entity.events) || !entity.name?.trim()) continue;
      const entityId = nameToId.get(entity.name.trim().toLowerCase());
      if (!entityId) continue;

      for (const ev of entity.events.slice(0, MAX_EVENTS_PER_ENTITY)) {
        const title = (ev?.title ?? '').trim().slice(0, 120);
        if (!title) continue;
        const dedupeKey = `${entityId}:${normalizeDesc(title)}`;
        if (seenEvents.has(dedupeKey)) continue;
        seenEvents.add(dedupeKey);

        await db.insert(schema.entityEvents).values({
          projectId,
          entityId,
          chapterId: safeChapterId,
          chapterTitle,
          title,
          description: (ev?.description ?? '').trim().slice(0, 500) || null,
          eventType: VALID_EVENT_TYPES.has(ev?.eventType ?? '') ? ev!.eventType! : 'other',
        });
        newEvents++;
      }
    }
  }

  // ── Entity links (связи между сущностями) ─────────────────────────────────
  let newLinks = 0;
  const validRelations = (relations ?? []).filter(r => {
    const fromId = r.from?.trim() ? nameToId.get(r.from.trim().toLowerCase()) : undefined;
    const toId   = r.to?.trim()   ? nameToId.get(r.to.trim().toLowerCase())   : undefined;
    return fromId && toId && fromId !== toId && r.relation?.trim();
  });

  if (validRelations.length > 0) {
    const priorLinks = await db
      .select({
        sourceEntityId: schema.entityLinks.sourceEntityId,
        targetEntityId: schema.entityLinks.targetEntityId,
        relation:       schema.entityLinks.relation,
      })
      .from(schema.entityLinks)
      .where(eq(schema.entityLinks.projectId, projectId));
    const seenLinks = new Set(
      priorLinks.map(l => `${l.sourceEntityId}:${l.targetEntityId}:${normalizeDesc(l.relation)}`),
    );

    for (const rel of validRelations) {
      const sourceEntityId = nameToId.get(rel.from!.trim().toLowerCase())!;
      const targetEntityId = nameToId.get(rel.to!.trim().toLowerCase())!;
      const relation = rel.relation!.trim().slice(0, 80);
      const dedupeKey = `${sourceEntityId}:${targetEntityId}:${normalizeDesc(relation)}`;
      if (seenLinks.has(dedupeKey)) continue;
      seenLinks.add(dedupeKey);

      await db.insert(schema.entityLinks).values({
        projectId,
        sourceEntityId,
        targetEntityId,
        relation,
        chapterId: safeChapterId,
      });
      newLinks++;
    }
  }

  return { newSuggestions, updateSuggestions, newLinks, newEvents };
}
