/**
 * Общий конвейер AI-извлечения сущностей Мира (в UI «Мир»; в индустрии — «библия истории»).
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


// ── Meta-entity filter ─────────────────────────────────────────────────────────
// Модель иногда возвращает не реальную сущность, а служебную/шаблонную строку:
// эхо названий полей промпта («Каноническое имя», «Название», «Имя персонажа»)
// или дословный плейсхолдер описания («Описание внешности персонажа.»). Такие
// мета-строки нужно отсеять до записи в БД, иначе «Мир» засоряется фантомами.

/** Нормализация имени/описания для сравнения со служебным списком. */
function normalizeMeta(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[«»"'`<>\[\](){}]/g, ' ') // скобки/кавычки вокруг плейсхолдеров
    .replace(/[.…!?,:;]+$/g, '')        // завершающая пунктуация
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Нормализация русского написания имени для авто-дедупа на входе: е/э/ё→е, и/й→и, ъ→ь.
 * Консервативно (только варианты буквы, не склонения/опечатки) — потому что резолвер сливает
 * ТИХО, без ревью автора. Склонения и edit-distance оставлены детектору в UI (с подтверждением).
 */
export function normalizeNameRu(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
    .replace(/[ёэ]/g, 'е')
    .replace(/й/g, 'и')
    .replace(/ъ/g, 'ь')
    .replace(/\s+/g, ' ');
}

/** Расстояние Левенштейна (для фаззи-детекта вариантов/опечаток имён). */
function editDistanceRu(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0]; dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = tmp;
    }
  }
  return dp[m];
}

/**
 * Фаззи-поиск ОДНОЗНАЧНО похожего approved-имени (опечатка/склонение/вариант), которого
 * авто-резолвер НЕ сливает молча (он берёт только точное норм-совпадение е/э). Здесь — мягче:
 * нормализованный edit-distance ≤1 на достаточно длинных именах, тип совпадает, кандидат
 * РОВНО один (иначе неоднозначно — не подсказываем). Возвращает {id,name} или null.
 * Используется, чтобы пометить новую находку «похоже на „X“» для ревью автора (НЕ молчком).
 */
export function findLikelyDuplicate(
  name: string,
  type: string,
  approved: { id: string; name: string; type: string; attributes: unknown }[],
): { id: string; name: string } | null {
  const nn = normalizeNameRu(name);
  if (nn.length < 4) return null;
  let match: { id: string; name: string } | null = null;
  let count = 0;
  for (const e of approved) {
    if (e.type !== type) continue;
    let hit = false;
    for (const cand of [e.name, ...aliasesOf(e.attributes)]) {
      const nc = normalizeNameRu(cand);
      if (nc.length < 4) continue;
      if (nc === nn) return null;                          // точное норм-совпадение — это уже авто-резолвер
      if (Math.abs(nc.length - nn.length) <= 1 && editDistanceRu(nc, nn) <= 1) { hit = true; break; }
    }
    if (hit) { match = { id: e.id, name: e.name }; count++; }
  }
  return count === 1 ? match : null;                       // только однозначный кандидат
}

/** Имена, которые являются эхом названий полей промпта, а не настоящими именами. */
const META_ENTITY_NAMES = new Set([
  'каноническое имя',
  'каноническое имя персонажа',
  'имя персонажа',
  'имя из списка',
  'имя из списка или новое',
  'имя сущности',
  'имя сущности из библии',
  'имя сущности из мира',
  'имя',
  'название',
  'название локации',
  'название места',
  'название предмета',
  'название правила',
  'описание',
  'описание персонажа',
  'character name',
  'canonical name',
  'entity name',
  'name',
  'title',
]);

/**
 * Префиксы-плейсхолдеры: имя вида «Имя персонажа из текста» / «Название локации …».
 * Реальные имена сущностей со служебной фразы не начинаются, поэтому префикс безопасен.
 */
const META_NAME_PREFIXES = [
  'каноническое имя',
  'имя персонажа',
  'имя сущности',
  'имя из списка',
  'название локации',
  'название места',
  'название предмета',
  'название правила',
];

/** Описания, дословно повторяющие инструкцию/плейсхолдер поля. */
const META_ENTITY_DESCRIPTIONS = new Set([
  'описание внешности персонажа',
  'описание персонажа',
  'описание локации',
  'описание предмета',
  'описание правила',
  'ключевая черта из текста',
  'роль в этой главе',
  '...',
]);

/**
 * Местоимения — не имена. Рассказчик от первого лица («я») должен попадать в Мир под
 * настоящим именем (см. поле pov), а не как сущность «Я». Подвижное «я» (в POV-главах
 * разных героев) иначе слилось бы в одного франкенштейна.
 */
const PRONOUN_NAMES = new Set([
  'я', 'меня', 'мне', 'мной', 'мною',
  'мы', 'нас', 'нам', 'нами',
  'ты', 'тебя', 'тебе', 'тобой', 'тобою',
  'вы', 'вас', 'вам', 'вами',
  'он', 'она', 'оно', 'они', 'его', 'её', 'ее', 'их', 'ему', 'ей', 'им', 'ими',
  'i', 'me', 'we', 'us', 'you', 'he', 'she', 'they', 'it',
]);

/**
 * True, если извлечённая «сущность» — служебная мета-строка (эхо полей промпта) или
 * местоимение, а не реальный персонаж/локация/предмет/правило.
 */
export function isMetaEntity(entity: { name?: string | null; description?: string | null }): boolean {
  const name = normalizeMeta(entity.name);
  if (!name) return true;                       // пустое имя — мусор
  if (PRONOUN_NAMES.has(name)) return true;     // местоимение — не имя
  if (META_ENTITY_NAMES.has(name)) return true; // имя = название поля
  // Имя вида «<имя персонажа из текста>» (скобки уже срезаны normalizeMeta)
  if (META_NAME_PREFIXES.some(p => name === p || name.startsWith(p + ' '))) return true;
  if (META_ENTITY_DESCRIPTIONS.has(normalizeMeta(entity.description))) return true;
  return false;
}

/**
 * Чистит POV из ответа модели: имя рассказчика или null. Отбрасывает местоимения,
 * маркеры «третье лицо/неизвестно» и явные не-имена, чтобы в pov_character попадало
 * только настоящее имя персонажа (или ничего).
 */
export function sanitizePov(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v) return null;
  const low = normalizeMeta(v);
  if (PRONOUN_NAMES.has(low)) return null;
  if (/^(null|none|нет|неизвестн|не определ|третье лицо|от третьего|автор|рассказчик|narrator|unknown)/.test(low)) return null;
  if (v.length > 80) return null;             // не предложение, а имя
  return v;
}

/** Синопсис главы из ответа модели: 1–2 предложения или null. Отбрасывает мусор/слишком длинное. */
export function sanitizeSynopsis(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || v.length < 8) return null;
  const low = v.toLowerCase();
  if (/^(null|none|нет|неизвестн|не определ|n\/a)/.test(low)) return null;
  return v.length > 400 ? v.slice(0, 397).trimEnd() + '…' : v;
}

/**
 * «Низкоинформативное» название главы, которое стоит заменить ИИ-именем: пусто, голый
 * номер («Глава 5»), голое число, или склейка нескольких номеров («Глава 79 Глава 8…»).
 * «Глава 5: Битва» и «Часть первая…» — информативны, НЕ трогаем.
 */
export function isLowInfoChapterTitle(title: string | null | undefined): boolean {
  const s = (title ?? '').trim();
  if (!s) return true;
  if (/^глава\s+\d+\s*$/i.test(s)) return true;
  if (/^\d+\s*$/.test(s)) return true;
  if ((s.match(/глава\s+\d+/gi)?.length ?? 0) >= 2) return true;
  return false;
}

/** Подтверждённые алиасы сущности (из слияний) — для авто-дедупа при извлечении. */
export function aliasesOf(attrs: unknown): string[] {
  const a = (attrs ?? {}) as Record<string, unknown>;
  return Array.isArray(a.aliases) ? (a.aliases as unknown[]).filter((x): x is string => typeof x === 'string') : [];
}


// ── shared: process AI extraction results ────────────────────────────────────

export interface AiEvent {
  title?: string;
  description?: string;
  eventType?: string;
  timeLabel?: string;
  timeHint?: string;
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
const VALID_TIME_HINTS = new Set(['past', 'present', 'future', 'flashback']);
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
  // Отсеять служебные/шаблонные мета-строки (эхо названий полей промпта),
  // прежде чем они станут сущностями. Связи/события на них тоже отвалятся,
  // т.к. имена не попадут в nameToId.
  entities = (entities ?? []).filter(e => !isMetaEntity(e));

  // All non-rejected entities: approved drive the update-suggestion flow,
  // pending ones still resolve names for links/events.
  const existingEntities = await db
    .select({
      id:           schema.storyEntities.id,
      name:         schema.storyEntities.name,
      type:         schema.storyEntities.type,
      status:       schema.storyEntities.status,
      description:  schema.storyEntities.description,
      significance: schema.storyEntities.significance,
      attributes:   schema.storyEntities.attributes,
    })
    .from(schema.storyEntities)
    .where(and(eq(schema.storyEntities.projectId, projectId), ne(schema.storyEntities.status, 'rejected')));

  // Авто-дедуп: имена И подтверждённые автором алиасы (из слияний) ведут к одной записи,
  // чтобы извлечённый «Ризанд» резолвился в «Риз», а не плодил новый pending-дубль.
  const approvedMap = new Map<string, typeof existingEntities[number]>();
  /** Каноническое имя + алиасы (lowercase) → entity id, для резолва сущностей, связей и событий. */
  const nameToId = new Map<string, string>();
  // Проход 1 — канонические имена (приоритет над алиасами при коллизии).
  for (const e of existingEntities) {
    const k = e.name.trim().toLowerCase();
    if (!k) continue;
    if (!nameToId.has(k)) nameToId.set(k, e.id);
    if (e.status === 'approved' && !approvedMap.has(k)) approvedMap.set(k, e);
  }
  // Проход 2 — алиасы (только если имя ещё не занято каноническим именем другой сущности).
  for (const e of existingEntities) {
    for (const al of aliasesOf(e.attributes)) {
      const k = al.trim().toLowerCase();
      if (!k || nameToId.has(k)) continue;
      nameToId.set(k, e.id);
      if (e.status === 'approved' && !approvedMap.has(k)) approvedMap.set(k, e);
    }
  }
  // Нормализованная карта (по типу) для авто-дедупа вариантов написания: «Ласэн» → «Ласен».
  // Ключ `${type}|${normalizeNameRu}`. Только approved + их алиасы.
  const approvedNorm = new Map<string, typeof existingEntities[number]>();
  for (const e of existingEntities) {
    if (e.status !== 'approved') continue;
    for (const nm of [e.name, ...aliasesOf(e.attributes)]) {
      const nk = `${e.type}|${normalizeNameRu(nm)}`;
      if (normalizeNameRu(nm) && !approvedNorm.has(nk)) approvedNorm.set(nk, e);
    }
  }
  // Список approved для фаззи-подсказки «похоже на X» (опечатки/склонения, что резолвер не слил).
  const approvedList = existingEntities.filter(e => e.status === 'approved')
    .map(e => ({ id: e.id, name: e.name, type: e.type, attributes: e.attributes }));

  const newSuggestions: (typeof schema.storyEntities.$inferSelect)[] = [];
  const updateSuggestions: (typeof schema.bibleUpdateSuggestions.$inferSelect)[] = [];
  const safeChapterId = (chapterId && isValidUUID(chapterId)) ? chapterId : null;

  for (const entity of entities) {
    if (!entity.name?.trim()) continue;
    const key = entity.name.trim().toLowerCase();
    let existing = approvedMap.get(key);

    // Авто-дедуп вариантов написания (Ласэн→Ласен): если точного совпадения нет, но есть
    // approved-сущность с тем же нормализованным именем — это она. Записываем вариант алиасом.
    if (!existing) {
      const fuzzy = approvedNorm.get(`${entity.type || 'character'}|${normalizeNameRu(entity.name)}`);
      if (fuzzy && fuzzy.name.trim().toLowerCase() !== key) {
        existing = fuzzy;
        nameToId.set(key, fuzzy.id);                     // резолвить связи/события на выжившего
        const aliases = aliasesOf(fuzzy.attributes);
        if (!aliases.some(a => a.trim().toLowerCase() === key)) {
          const attrs = { ...((fuzzy.attributes as Record<string, unknown>) ?? {}), aliases: [...aliases, entity.name.trim()] };
          await db.update(schema.storyEntities).set({ attributes: attrs }).where(eq(schema.storyEntities.id, fuzzy.id));
          (fuzzy as { attributes: unknown }).attributes = attrs; // освежить in-memory для пути обогащения
        }
      }
    }

    if (!existing) {
      if (nameToId.has(key)) continue; // already pending from an earlier extraction — don't duplicate
      const validSignificance = ['major', 'moderate', 'minor'].includes(entity.significance ?? '')
        ? entity.significance!
        : null;
      // Похоже на существующего (опечатка/склонение)? Помечаем находку, чтобы автор в инбоксе
      // мог объединить одним кликом, а не плодить дубль. Молча НЕ сливаем — это неточный матч.
      const dupHint = findLikelyDuplicate(entity.name, entity.type || 'character', approvedList);
      const baseAttrs = (entity.attributes ?? null) as Record<string, unknown> | null;
      const attrsWithHint = dupHint
        ? { ...(baseAttrs ?? {}), _dupHint: { id: dupHint.id, name: dupHint.name } }
        : baseAttrs;
      const [inserted] = await db.insert(schema.storyEntities).values({
        projectId,
        chapterId: safeChapterId,
        type: entity.type || 'character',
        name: entity.name.trim(),
        description: entity.description || '',
        status: 'pending',
        significance: validSignificance,
        attributes: attrsWithHint,
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

        const timeHint = VALID_TIME_HINTS.has(ev?.timeHint ?? '') ? ev!.timeHint! : null;
        await db.insert(schema.entityEvents).values({
          projectId,
          entityId,
          chapterId: safeChapterId,
          chapterTitle,
          title,
          description: (ev?.description ?? '').trim().slice(0, 500) || null,
          eventType: VALID_EVENT_TYPES.has(ev?.eventType ?? '') ? ev!.eventType! : 'other',
          timeLabel: (ev?.timeLabel ?? '').trim().slice(0, 80) || null,
          timeHint,
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
