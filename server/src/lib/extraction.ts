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

/**
 * JSON Schema извлечения сущностей — для структурированного вывода ЛОКАЛЬНЫХ моделей
 * (Ollama). Передаётся в generate({ responseSchema }); слабые модели без неё уходят в
 * прозу/пустышку, а со схемой обязаны заполнить структуру. Облачные провайдеры (Kimi)
 * схему игнорируют (см. OpenAICompatProvider.isLocal). Форма совпадает с BASE_EXTRACTION_PROMPT.
 */
export const EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['character', 'location', 'item', 'rule'] },
          name: { type: 'string', description: 'Имя/название ТОЛЬКО на русском языке кириллицей, как в тексте (например «Риз», а не «Riz»). Никакой латиницы и транслитерации.' },
          description: { type: 'string', description: 'Описание на русском языке.' },
          significance: { type: 'string', enum: ['major', 'moderate', 'minor'] },
          attributes: {
            type: 'object',
            properties: {
              aliases: { type: 'array', items: { type: 'string' } },
              appearance: { type: 'string' }, personality: { type: 'string' },
              role: { type: 'string' }, background: { type: 'string' },
              motivations: { type: 'string' }, speech: { type: 'string' },
              secrets: { type: 'string' }, plotRelevance: { type: 'string' },
              region: { type: 'string' }, physicalDetails: { type: 'string' }, mood: { type: 'string' },
              properties: { type: 'string' }, origin: { type: 'string' }, owner: { type: 'string' },
              scope: { type: 'string' }, exceptions: { type: 'string' },
            },
          },
          events: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                eventType: { type: 'string', enum: ['conflict', 'relationship', 'status', 'revelation', 'other'] },
                timeLabel: { type: 'string' },
                timeHint: { type: 'string', enum: ['present', 'flashback', 'past', 'future'] },
              },
              required: ['title', 'description', 'eventType'],
            },
          },
        },
        required: ['type', 'name', 'description'],
      },
    },
    relations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' }, to: { type: 'string' }, relation: { type: 'string' },
        },
        required: ['from', 'to', 'relation'],
      },
    },
    pov: { type: 'string' },
    synopsis: { type: 'string' },
    chapterSummary: { type: 'string' },
  },
  required: ['entities'],
};

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
  return `Ты — литературный редактор. По фрагменту определи жанр и общую тональность произведения.
ЯЗЫК: только русский.

1) genres — 1–3 жанра ТОЛЬКО из списка (точные формулировки, без своих вариантов):
${GENRE_TAXONOMY.join(', ')}
Если жанр определить нельзя — самый общий подходящий из списка.

2) mood — ОДНО слово тональности ТОЛЬКО из списка (для подбора цвета обложки):
${Object.keys(MOOD_COLORS).join(', ')}

Верни строго JSON без markdown, например: {"genres":["Фэнтези","ЛитРПГ"],"mood":"эпическое"}

=== ФРАГМЕНТ ===
${sampleText.trim()}`;
}

/**
 * Тональность рукописи → пигмент обложки (из палитры импорта). Подбор «Пером» при импорте.
 * Ключи = enum для mood в промпте; значения — те же цвета, что PRESET_COLORS на фронте.
 */
export const MOOD_COLORS: Record<string, string> = {
  'спокойное':     '#3A4F41', // сосновый
  'тёплое':        '#C66B49', // терракота — романтика, тепло
  'мрачное':       '#2C3E50', // тёмно-синий — нуар, тьма
  'мистическое':   '#806B8A', // плам — магия, тайна
  'природное':     '#2B7A6B', // изумруд — приключение, природа
  'историческое':  '#8B6B32', // охра — золото, эпоха
  'трагическое':   '#6B2B2B', // винный — драма, кровь
  'эпическое':     '#2B4A8B', // синий — героика, масштаб
};

/** mood из ответа модели → цвет палитры (null, если не распознан). */
export function coerceMoodColor(mood: unknown): string | null {
  const key = String(mood ?? '').trim().toLowerCase();
  return MOOD_COLORS[key] ?? null;
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
    ? `=== МИР (установленные факты — то, что Перо уже знает о книге) ===\n${parts.join('\n\n')}`
    : '';
}

// ── Contradiction scan (PRD P1.2, full-book) ──────────────────────────────────

export interface RawContradiction {
  entity: string;
  issue: string;
  severity: string;
  /** Поток: 'contradiction' = твёрдый конфликт (алярм) | 'development' = развитие/раскрытие (не ошибка). */
  kind?: 'contradiction' | 'development';
  /** Точная фраза из текста главы, которая противоречит Миру (для подсветки в тексте). */
  quote?: string;
  /** Конкретный установленный факт (из Мира/др. глав), которому фраза противоречит — двойная цитата. */
  canon?: string;
}

/**
 * Промпт проверки одной главы на противоречия с Миром.
 * Тот же критерий, что и в интерактивной /ai/consistency — только факты,
 * не стиль и не сюжет. Используется фоновой джобой scan_contradictions.
 */
export function buildContradictionPrompt(storyBible: string, chapterTitle: string, plainText: string, relatedPassages: string[] = []): string {
  const relatedBlock = relatedPassages.length
    ? `\n=== РЕЛЕВАНТНЫЕ МЕСТА ИЗ ДРУГИХ ГЛАВ (семантически близкие — сверь факты по всей книге;
фрагменты с пометкой «[Из книги «…»]» — канон ПРЕДЫДУЩИХ книг серии: новый текст не должен им противоречить) ===
${relatedPassages.map((p, i) => `[${i + 1}] ${p}`).join('\n\n')}
`
    : '';
  return `Ты — редактор, проверяющий консистентность текста.
ЯЗЫК: отвечай ИСКЛЮЧИТЕЛЬНО на русском языке (все строковые значения в JSON по-русски).

${storyBible}
${relatedBlock}
=== ТЕКСТ ГЛАВЫ: «${chapterTitle}» ===
<chapter_content>
${plainText.trim()}
</chapter_content>

=== ДВА ПОТОКА: НЕСТЫКОВКА и РАЗВИТИЕ ===
Когда текст ЭТОЙ главы говорит о сущности НЕ ТО, что в Мире, реши, к какому потоку это относится,
и поставь поле "kind". Не всё расхождение — ошибка.

kind:"contradiction" — ТВЁРДЫЙ КОНФЛИКТ с неизменным фактом (из Мира выше ИЛИ из мест других глав/книг).
Твёрдый факт — то, что НЕ меняется по сюжету:
• неизменные приметы (цвет глаз/волос, рост, шрамы, раса/вид);
• родство и установленные связи (мать/брат/…);
• статус жив/мёртв — ТОЛЬКО если в тексте НЕТ причины смены (воскрешение, инсценировка и т.п.);
• правила мира; имена.
Это «contradiction», ТОЛЬКО если можешь назвать ОБА: фразу этой главы И КОНКРЕТНЫЙ
противоречащий установленный факт ("canon"). Не можешь указать факт — это НЕ contradiction.

kind:"development" — РАЗВИТИЕ или РАСКРЫТИЕ, а не ошибка. Сюда относи всё, что меняет/дополняет образ
ПО СЮЖЕТУ, не ломая твёрдый факт:
• новая деталь о герое, которой не было в Мире (дополнение — норма);
• смена роли/стороны/морали; «казался врагом — оказался союзником» (двойной агент); рост, перемена характера;
• раскрытие тайны/прошлого. canon тут не обязателен.
Это спокойный поток: автору полезно видеть, что Перо заметило развитие, но это НЕ тревога.

=== ЧТО НЕ СООБЩАТЬ ВОВСЕ (ни в один поток) ===
• Перемещения: герой в разных местах в РАЗНОЕ время — норма, он передвигается.
• Нереальные рамки: сон, видение, ложь, гипотеза, флешбэк, мысли, метафора, ненадёжный рассказчик —
  сказанное ВНУТРИ них НЕ становится фактом. «Приснилось, что он умер» → он НЕ мёртв.
• Догадки и интерпретации («может подразумевать», «вероятно», «возможно»).
Точность важнее полноты: сомневаешься в contradiction — поставь development; сомневаешься вообще —
НЕ сообщай. Пустой массив [] — нормальный, частый ответ.
В тексте называй хранилище фактов только «Мир», НЕ «библия истории».

Верни ТОЛЬКО валидный JSON-массив без markdown-обёртки:
[
  { "entity": "Имя сущности из Мира", "kind": "contradiction|development",
    "issue": "В чём именно расхождение (кратко)", "severity": "low|medium|high",
    "quote": "точная фраза ИЗ ЭТОЙ ГЛАВЫ (дословно) — для подсветки",
    "canon": "для contradiction — конкретный факт, которому фраза противоречит; для development можно пропустить" }
]`;
}

/**
 * Промпт извлечения сюжетных линий (столб «Сюжет» → «Линии»).
 * Работает по СИНОПСИСАМ глав (не по полному тексту) — линии это макро-уровень,
 * этого достаточно и дёшево. Возвращает линии с номерами глав (1-based по порядку).
 */
export function buildThreadsPrompt(chapterDigest: string): string {
  return `Ты — редактор по структуре. Перед тобой синопсисы глав книги по порядку.
ЯЗЫК: отвечай ИСКЛЮЧИТЕЛЬНО на русском (все строки в JSON по-русски).

=== СИНОПСИСЫ ГЛАВ (по порядку) ===
${chapterDigest}

=== ЗАДАЧА ===
Выдели СКВОЗНЫЕ сюжетные линии книги — то, что тянется через несколько глав.
Дай НЕ БОЛЬШЕ 12 линий, по убыванию важности. КЛЕЙ родственные эпизоды в ОДНУ линию
(одна цель/конфликт/тайна = одна линия, а не отдельная линия на каждую главу).
Бери только линии на уровне ≥3 глав. Исключение — явное «обещание»/«ружьё Чехова»,
введённое в одной главе, но требующее развязки. Разовые эпизоды игнорируй.

ВИД линии (kind) выбирай строго по смыслу:
- "main" — ТОЛЬКО 1–2 ЦЕНТРАЛЬНЫЕ линии всей книги (главный сквозной конфликт/квест, который
  движет сюжетом от начала до конца). Если сомневаешься — это НЕ main.
- "relationship" — романтическая или ключевая межличностная линия (влюблённость, вражда, союз).
- "mystery" — тайна/загадка, которую предстоит разгадать.
- "promise" — обещание читателю / незакрытое «ружьё Чехова» (намёк, который должен выстрелить).
- "subplot" — всё остальное: второстепенные линии, цели второстепенных героев.
По умолчанию ставь "subplot". "main" — большая редкость (максимум 2 на всю книгу).

Для каждой линии: где ВВЕДЕНА, в каких главах развивается, РАЗРЕШЕНА ли к концу доступных глав
(выстрелило ли «ружьё»). Незакрытая линия — норма, если книга не дописана, но отметь её.

Верни ТОЛЬКО валидный JSON-массив без markdown, по убыванию важности:
[
  {
    "title": "Краткое имя линии",
    "summary": "1–2 предложения: в чём линия",
    "kind": "main|subplot|mystery|promise|relationship",
    "resolved": true|false,
    "introChapter": <номер главы, где введена>,
    "lastChapter": <номер последней главы, где упоминается>,
    "chapters": [<номера глав, где фигурирует>],
    "characters": [<имена ключевых героев этой линии>]
  }
]

ВСЕ строковые значения (title, summary) — строго на русском языке. Без китайских иероглифов, корейского хангыля и латиницы.`;
}

// ── Бит-шаблоны (линза «Канва») ─────────────────────────────────────────────
// pct = целевая позиция бита в книге (% объёма). Russian labels.
export type BeatDef = { key: string; label: string; pct: number };
export const BEAT_TEMPLATES: Record<string, { name: string; beats: BeatDef[] }> = {
  romancing_the_beat: {
    name: 'Романс-бит',
    beats: [
      { key: 'meet',         label: 'Встреча',                  pct: 5 },
      { key: 'no_way',       label: '«Ни за что»',              pct: 12 },
      { key: 'adhesion',     label: 'Сцепление (близость)',     pct: 20 },
      { key: 'maybe',        label: '«А вдруг получится»',      pct: 35 },
      { key: 'midpoint',     label: 'Пик влюблённости',         pct: 50 },
      { key: 'doubt',        label: 'Сомнение · щиты вверх',    pct: 62 },
      { key: 'breakup',      label: 'Разрыв',                   pct: 75 },
      { key: 'dark_night',   label: 'Тёмная ночь души',         pct: 82 },
      { key: 'grand_gesture',label: 'Большой жест',             pct: 92 },
      { key: 'hea',          label: 'Счастливый финал (HEA)',   pct: 99 },
    ],
  },
  save_the_cat: {
    name: 'Save the Cat',
    beats: [
      { key: 'opening',     label: 'Открывающий образ',     pct: 1 },
      { key: 'theme',       label: 'Заявка темы',           pct: 5 },
      { key: 'setup',       label: 'Завязка',               pct: 10 },
      { key: 'catalyst',    label: 'Катализатор',           pct: 12 },
      { key: 'debate',      label: 'Спор',                  pct: 18 },
      { key: 'break_two',   label: 'Переход во 2 акт',      pct: 20 },
      { key: 'b_story',     label: 'Линия B',               pct: 22 },
      { key: 'fun_games',   label: 'Игры и забавы',         pct: 35 },
      { key: 'midpoint',    label: 'Мидпоинт',              pct: 50 },
      { key: 'bad_close',   label: 'Враги наступают',       pct: 62 },
      { key: 'all_lost',    label: 'Всё пропало',           pct: 75 },
      { key: 'dark_night',  label: 'Тёмная ночь души',      pct: 78 },
      { key: 'break_three', label: 'Переход в 3 акт',       pct: 80 },
      { key: 'finale',      label: 'Финал',                 pct: 90 },
      { key: 'final_image', label: 'Финальный образ',       pct: 99 },
    ],
  },
  three_act: {
    name: 'Три акта',
    beats: [
      { key: 'opening',   label: 'Открытие',             pct: 1 },
      { key: 'plot1',     label: 'Завязка (конец 1 акта)', pct: 25 },
      { key: 'midpoint',  label: 'Мидпоинт',             pct: 50 },
      { key: 'plot2',     label: 'Кризис (конец 2 акта)', pct: 75 },
      { key: 'climax',    label: 'Кульминация',          pct: 90 },
      { key: 'ending',    label: 'Развязка',             pct: 99 },
    ],
  },
};

/**
 * Промпт реверс-детекта битов: по синопсисам глав ИИ сопоставляет каждый бит
 * шаблона с номером главы, которая его отыгрывает (или null, если ещё не написан).
 */
export function buildBeatmapPrompt(beats: BeatDef[], chapterDigest: string): string {
  const list = beats.map(b => `- ${b.key}: «${b.label}» (≈${b.pct}% книги)`).join('\n');
  return `Ты — редактор по структуре. По синопсисам глав определи, какая глава отыгрывает каждый
структурный бит из шаблона. ЯЗЫК: русский (все строки в JSON по-русски).

=== БИТЫ ШАБЛОНА ===
${list}

=== СИНОПСИСЫ ГЛАВ (по порядку) ===
${chapterDigest}

=== ЗАДАЧА ===
Для КАЖДОГО бита укажи номер главы, которая лучше всего его отыгрывает по СМЫСЛУ события.
Правила:
- Биты идут по порядку структуры. Номера глав должны в целом ВОЗРАСТАТЬ вниз по списку:
  бит, который по структуре позже, НЕ может лежать в главе раньше предыдущего бита.
- Одна глава отыгрывает максимум ОДИН бит (не вешай несколько битов на одну главу).
- Лучше chapter: null, чем натянутая привязка. Если события бита в книге ещё нет — null.
- note: коротко (до 8 слов), какое именно событие отыгрывает бит.
Не выдумывай — опирайся только на синопсисы.

Верни ТОЛЬКО валидный JSON-массив без markdown, в порядке битов шаблона:
[ { "key": "<ключ бита>", "chapter": <номер главы или null>, "note": "коротко, почему" } ]

Все строки note — строго на русском языке. Без китайских иероглифов, корейского хангыля и латиницы.`;
}

/**
 * Промпт извлечения арок персонажей (линза «Арки»): Want/Need/Ghost/Lie/Truth.
 * По именам+описаниям главных героев и синопсисам глав ИИ выводит внутреннюю арку.
 */
export function buildArcsPrompt(characters: string, chapterDigest: string): string {
  return `Ты — редактор по аркам персонажей. Выведи внутреннюю арку для каждого героя.
ЯЗЫК: русский (все строки в JSON по-русски).

=== ГЛАВНЫЕ ГЕРОИ ===
${characters}

=== СИНОПСИСЫ ГЛАВ (по порядку) ===
${chapterDigest}

=== ЗАДАЧА ===
Для каждого героя определи классические грани арки:
- want: внешняя ЦЕЛЬ (чего герой осознанно добивается).
- need: внутренняя ПОТРЕБНОСТЬ (что ему на самом деле нужно для роста).
- ghost: ТРАВМА прошлого, которая его сформировала.
- lie: ЛОЖНОЕ убеждение о себе/мире, в которое он верит.
- truth: ИСТИНА, которую он принимает к кульминации (если ещё не принял — null).
Правила:
- КОНКРЕТНО по событиям из синопсисов, с именами и деталями этого героя — НЕ общими словами
  («найти своё место», «принять себя» без привязки — плохо; «простить сестру за предательство» — хорошо).
- Если грань не выводится из синопсисов — ставь null, НЕ выдумывай.
- want и need должны РАЗЛИЧАТЬСЯ (внешнее vs внутреннее). Кратко, 1 фразой на грань.

Верни ТОЛЬКО валидный JSON-массив без markdown:
[ { "name": "<имя героя как в списке>", "want": "…", "need": "…", "ghost": "…", "lie": "…", "truth": "…|null" } ]

ВСЕ строковые значения — строго на русском языке. Без китайских иероглифов, корейского хангыля и латиницы.`;
}

/**
 * «Доставил задуманное?» (P2) — сверка АВТОРСКОГО плана с тем, что реально в прозе.
 * Каждый план-элемент (нить/арка/бит) судится по синопсисам: отыгран / частично / провисает.
 * Дёшево — 1 ИИ-вызов по синопсисам, не по полному тексту.
 */
export function buildDeliveryPrompt(planItems: string, chapterDigest: string): string {
  return `Ты — редактор-аналитик. Автор заранее ЗАПЛАНИРОВАЛ элементы истории (сюжетные линии, арки героев, биты).
Твоя задача — по СИНОПСИСАМ глав честно оценить, отыгран ли каждый замысел в УЖЕ НАПИСАННОМ тексте.
ЯЗЫК: русский (все строки в JSON по-русски).

=== ЗАПЛАНИРОВАННЫЕ ЭЛЕМЕНТЫ (каждый со своим ref) ===
${planItems}

=== СИНОПСИСЫ НАПИСАННЫХ ГЛАВ (по порядку) ===
${chapterDigest}

=== ЗАДАЧА ===
Для КАЖДОГО элемента по его ref определи статус доставки в прозе:
- "delivered" — замысел явно отыгран в синопсисах (есть события/сцены, реализующие его).
- "partial" — намечен, но не доведён (есть начало/упоминание, но не раскрыт/не закрыт).
- "missing" — в написанных главах не видно (ещё не отыгран или забыт).
Правила:
- Суди ТОЛЬКО по синопсисам. Чего нет в синопсисах — того в прозе нет (статус "partial"/"missing").
- reason — 1 короткая фраза с КОНКРЕТИКОЙ (что именно отыграно/чего не хватает), со ссылкой на события.
- chapter — номер главы (из списка синопсисов), где элемент сильнее всего проявлен; если нет — null.
- НЕ выдумывай отыгрыш, которого нет в синопсисах. Сомневаешься между delivered/partial — ставь "partial".

Верни ТОЛЬКО валидный JSON-массив без markdown:
[ { "ref": "<ref как в списке>", "status": "delivered|partial|missing", "reason": "…", "chapter": <номер|null> } ]

ВСЕ строковые значения — строго на русском языке. Без китайских иероглифов, корейского хангыля и латиницы.`;
}

/**
 * Рентген нитей франшизы (P1, серия) — статус каждой сквозной нити по НАПИСАННЫМ книгам.
 * Перо читает синопсисы книг серии и судит: провисает / в работе / отыграна. 1 ИИ-вызов.
 */
export function buildFranchiseXrayPrompt(threadList: string, booksDigest: string): string {
  return `Ты — редактор серии книг. Автор задумал сквозные нити франшизы (линии, тянущиеся через книги).
Твоя задача — по СИНОПСИСАМ написанных книг честно оценить статус каждой нити в реальном тексте.
ЯЗЫК: русский (все строки в JSON по-русски).

=== НИТИ ФРАНШИЗЫ (каждая со своим ref; «откр.» — книга-завязка, «закр.» — книга-развязка по плану) ===
${threadList}

=== СИНОПСИСЫ НАПИСАННЫХ КНИГ СЕРИИ (по порядку) ===
${booksDigest}

=== ЗАДАЧА ===
Для КАЖДОЙ нити по её ref определи статус по написанному:
- "resolved" — нить заведена И разрешена в книгах (особенно если книга-развязка достигнута и линия закрыта).
- "active" — нить заведена и развивается, но ещё не закрыта (в работе).
- "dangling" — нить запланирована, но в синопсисах книг следа нет (провисает / забыта / ещё не введена).
Правила:
- Суди ТОЛЬКО по синопсисам книг. Чего нет в синопсисах — того в прозе нет ("dangling").
- note — 1 короткая фраза с КОНКРЕТИКОЙ (где заведена/как развивается/чего не хватает для развязки).
- lastBook — номер книги, где нить проявлена сильнее всего; если следа нет — null.
- Сомневаешься между resolved/active — ставь "active". Не выдумывай отыгрыш, которого нет в синопсисах.

Верни ТОЛЬКО валидный JSON-массив без markdown:
[ { "ref": "<ref как в списке>", "status": "resolved|active|dangling", "note": "…", "lastBook": <номер|null> } ]

ВСЕ строковые значения — строго на русском языке. Без китайских иероглифов, корейского хангыля и латиницы.`;
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
ЯЗЫК: ВСЕ строковые значения в JSON (имена, описания, pov, chapterSummary, synopsis, relation, события) — ИСКЛЮЧИТЕЛЬНО на русском языке, даже если в тексте встречаются иноязычные слова. Никогда не используй китайский или английский в значениях.

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

synopsis — краткая аннотация главы: 1–2 нейтральных предложения от третьего лица, прошедшее
  время, ЧТО ПРОИЗОШЛО ПО СЮЖЕТУ (события и сдвиги), без оценок и без спойлерных трактовок.
  По-русски. Если в главе нет сюжета (титул/оглавление) — synopsis: null.

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
  "synopsis": "Кейлен сбегает из крепости через подземный ход и принимает командование гарнизоном.",
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
