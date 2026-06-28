/**
 * Промпты и хелперы извлечения «Мира» — чистые функции/константы, извлечены из
 * lib/extraction.ts. Базовый промпт извлечения сущностей, проверка нестыковок,
 * сборка контекста Мира для чата, классификация жанра/настроения. Без БД/AI/IO.
 *
 * Зависимость только одна (cleanJsonResponse) — направлена В extraction.ts (one-way,
 * без цикла: extraction.ts эти символы НЕ использует).
 */
import * as schema from '../db/schema.js'; // только типы $inferSelect в buildStoryBibleContext
import { cleanJsonResponse } from './extraction.js';

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


// Промпты столба «Сюжет» (Линии/Канва/Арки/Поставка) + франшиз-рентген → ../lib/plotPrompts.ts

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

// ── JSON-схема ответа извлечения (парная к BASE_EXTRACTION_PROMPT) ───────────────

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
