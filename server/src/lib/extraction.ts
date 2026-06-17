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

/** Имена, которые являются эхом названий полей промпта, а не настоящими именами. */
const META_ENTITY_NAMES = new Set([
  'каноническое имя',
  'каноническое имя персонажа',
  'имя персонажа',
  'имя из списка',
  'имя из списка или новое',
  'имя сущности',
  'имя сущности из библии',
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

/** Подтверждённые алиасы сущности (из слияний) — для авто-дедупа при извлечении. */
export function aliasesOf(attrs: unknown): string[] {
  const a = (attrs ?? {}) as Record<string, unknown>;
  return Array.isArray(a.aliases) ? (a.aliases as unknown[]).filter((x): x is string => typeof x === 'string') : [];
}

// ── Genre taxonomy (mirror of client src/data/genres.ts — keep in sync) ────────

export const GENRE_TAXONOMY: string[] = [
  // Фэнтези
  'Фэнтези', 'Боевое фэнтези', 'Тёмное фэнтези', 'Городское фэнтези',
  'Романтическое фэнтези', 'Эпическое фэнтези', 'Историческое фэнтези',
  'ЛитРПГ', 'РеалРПГ', 'Бояръ-аниме', 'Попаданцы', 'Сказка',
  // Фантастика
  'Научная фантастика', 'Боевая фантастика', 'Космическая фантастика',
  'Киберпанк', 'Постапокалипсис', 'Антиутопия', 'Альтернативная история', 'Стимпанк',
  // Романтика
  'Любовный роман', 'Современный любовный роман', 'Исторический любовный роман',
  'Романтическая проза', 'Эротика', 'Young adult',
  // Детектив и саспенс
  'Детектив', 'Боевик', 'Триллер', 'Мистика', 'Ужасы',
  // Проза и другое
  'Современная проза', 'Историческая проза', 'Драма', 'Юмор',
  'Приключения', 'Подростковая проза', 'Фанфик',
];

/** Промпт классификации жанра по фрагменту текста (1–3 жанра строго из таксономии). */
export function buildGenreClassifyPrompt(sampleText: string): string {
  return `Ты — литературный редактор. Определи 1–3 наиболее подходящих жанра произведения по фрагменту.
Выбирай ТОЛЬКО из списка (точные формулировки, без своих вариантов):
${GENRE_TAXONOMY.join(', ')}

Верни строго JSON-массив строк без markdown, например: ["Фэнтези","ЛитРПГ"].
Если жанр определить нельзя — верни самый общий подходящий из списка.

=== ФРАГМЕНТ ===
${sampleText.trim()}`;
}

/** Приводит ответ модели (массив или JSON-строка) к каноническим жанрам таксономии. */
export function coerceGenres(value: unknown): string[] {
  let arr: unknown = value;
  if (typeof value === 'string') {
    try { arr = JSON.parse(cleanJsonResponse(value)); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  const canonByLower = new Map(GENRE_TAXONOMY.map(g => [g.toLowerCase(), g]));
  const out: string[] = [];
  for (const x of arr) {
    const canon = canonByLower.get(String(x).trim().toLowerCase());
    if (canon && !out.includes(canon)) out.push(canon);
  }
  return out.slice(0, 3);
}

// ── Story-bible context (shared: ai.ts chat/consistency + worker contradictions) ──

/** Key character attributes worth surfacing to the AI (token-capped). */
const CONTEXT_ATTRIBUTE_LABELS: Record<string, string> = {
  speech:      'Речь',
  motivations: 'Мотивация',
  secrets:     'Секреты',
};
const CONTEXT_ATTRIBUTE_MAX_CHARS = 160;

/** Build a compact story-bible block from approved entities (+ optional relations). */
export function buildStoryBibleContext(
  entities: (typeof schema.storyEntities.$inferSelect)[],
  links: (typeof schema.entityLinks.$inferSelect)[] = [],
): string {
  if (entities.length === 0) return '';

  const sections: Record<string, string[]> = {
    character: [],
    location: [],
    item: [],
    rule: [],
  };

  for (const e of entities) {
    let line = e.description ? `- ${e.name}: ${e.description}` : `- ${e.name}`;
    // Для персонажей добавляем поля, критичные для консистентности текста
    if (e.type === 'character' && e.attributes && typeof e.attributes === 'object') {
      const attrs = e.attributes as Record<string, unknown>;
      for (const [key, label] of Object.entries(CONTEXT_ATTRIBUTE_LABELS)) {
        const value = attrs[key];
        if (typeof value === 'string' && value.trim()) {
          line += `\n  · ${label}: ${value.trim().slice(0, CONTEXT_ATTRIBUTE_MAX_CHARS)}`;
        }
      }
    }
    if (sections[e.type]) sections[e.type].push(line);
  }

  const parts: string[] = [];
  if (sections.character.length) parts.push(`ПЕРСОНАЖИ:\n${sections.character.join('\n')}`);
  if (sections.location.length)  parts.push(`ЛОКАЦИИ:\n${sections.location.join('\n')}`);
  if (sections.item.length)      parts.push(`ПРЕДМЕТЫ:\n${sections.item.join('\n')}`);
  if (sections.rule.length)      parts.push(`ПРАВИЛА МИРА:\n${sections.rule.join('\n')}`);

  // Связи между сущностями («Имя → тип связи → Имя»)
  if (links.length > 0) {
    const nameById = new Map(entities.map(e => [e.id, e.name]));
    const relLines = links
      .map(l => {
        const from = nameById.get(l.sourceEntityId);
        const to   = nameById.get(l.targetEntityId);
        return from && to ? `- ${from} → ${l.relation} → ${to}` : null;
      })
      .filter((s): s is string => Boolean(s));
    if (relLines.length) parts.push(`СВЯЗИ:\n${relLines.join('\n')}`);
  }

  return parts.length
    ? `=== БИБЛИЯ ИСТОРИИ (установленные факты) ===\n${parts.join('\n\n')}`
    : '';
}

// ── Contradiction scan (PRD P1.2, full-book) ──────────────────────────────────

export interface RawContradiction {
  entity: string;
  issue: string;
  severity: string;
  /** Точная фраза из текста главы, которая противоречит Библии (для подсветки в тексте). */
  quote?: string;
}

/**
 * Промпт проверки одной главы на противоречия с библией.
 * Тот же критерий, что и в интерактивной /ai/consistency — только факты,
 * не стиль и не сюжет. Используется фоновой джобой scan_contradictions.
 */
export function buildContradictionPrompt(storyBible: string, chapterTitle: string, plainText: string): string {
  return `Ты — редактор, проверяющий консистентность текста.

${storyBible}

=== ТЕКСТ ГЛАВЫ: «${chapterTitle}» ===
<chapter_content>
${plainText.trim()}
</chapter_content>

=== ЗАДАЧА ===
Найди ТОЛЬКО фактические противоречия между текстом главы и Библией истории.
Ищи: несоответствия в описании персонажей, локаций, предметов; нарушение правил мира;
конфликты с уже установленными фактами и связями.
НЕ комментируй стиль, орфографию, сюжетные решения или то, чего нет в Библии.
Если противоречий нет — верни пустой массив.

Верни ТОЛЬКО валидный JSON-массив без markdown-обёртки:
[
  { "entity": "Имя сущности из Библии", "issue": "Краткое описание противоречия", "severity": "low|medium|high",
    "quote": "точная фраза из текста главы (дословно, как в тексте), которая противоречит Библии — для подсветки" }
]`;
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
6. НИКОГДА не создавай сущность с именем-местоимением («я», «он», «она», «мы», «ты»,
   «они»). Местоимение — не имя. Если повествование от первого лица, «я» — это
   POV-персонаж главы (см. поле pov), и его черты приписывай его настоящему имени.

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
                    "eventType": "conflict" | "relationship" | "status" | "revelation" | "other",
                    "timeLabel": "маркер времени из текста, если есть (напр. «за год до», «той же ночью», «в детстве»), иначе опусти",
                    "timeHint": "когда событие в истории: 'present' (сейчас по сюжету) | 'flashback' (воспоминание/ретроспектива) | 'past' | 'future'. По умолчанию 'present'." }

pov — имя персонажа, от лица которого ведётся повествование в ЭТОЙ главе (рассказчик).
  Если текст от первого лица («я»), pov — каноническое имя этого «я» (определи по тому,
  как его зовут другие в этой или соседних сценах). Если повествование от третьего лица
  или рассказчика не определить — pov: null. НЕ возвращай местоимение в pov.

relations — связи между сущностями ответа, ЯВНО подтверждённые текстом:
  [{ "from": "Имя", "to": "Имя", "relation": "краткий тип" }]
  relation читается от from к to: «мать», «наставник», «соперник», «владеет», «живёт в».
  Для ЛОКАЦИЙ обязательно добавляй связи вложенности, если текст их даёт:
  relation «находится в» / «часть» (меньшее место → большее), напр. { "from": "Таверна", "to": "Нижний город", "relation": "находится в" }.
  Не выдумывай связи и не включай неопределённые («знаком с»).

ВАЖНО: ниже — ОБРАЗЕЦ ФОРМАТА на вымышленном примере. Не копируй эти значения
в ответ и не используй слова «Каноническое имя», «Название», «Описание» как имена —
бери реальные имена и факты ТОЛЬКО из текста главы. Если сущностей нет — "entities": [].

Пример заполнения (иллюстрация структуры, НЕ образец для копирования):
{
  "entities": [
    {
      "type": "character",
      "name": "Кейлен",
      "description": "Молодой капитан стражи. Хладнокровен в бою. В этой главе принимает командование гарнизоном.",
      "significance": "major",
      "attributes": { "appearance": "высокий, светловолосый", "role": "капитан стражи", "motivations": "вернуть младшую сестру" },
      "events": [
        { "title": "Побег из крепости", "description": "Сбегает из крепости через подземный ход.", "eventType": "status" }
      ]
    },
    {
      "type": "location",
      "name": "Серая крепость",
      "description": "Приграничная крепость на скале. Каменные стены, низкие сырые потолки.",
      "significance": "moderate",
      "attributes": { "physicalDetails": "каменные стены, низкие потолки", "mood": "мрачная" }
    }
  ],
  "relations": [
    { "from": "Кейлен", "to": "Серая крепость", "relation": "скрывается в" }
  ],
  "pov": "Кейлен",
  "chapterSummary": "Рабочее название главы (2–4 слова)"
}`;

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
