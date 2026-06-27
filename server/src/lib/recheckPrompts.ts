/**
 * Промпты перепроверки (recheck) Мира — чистые строковые билдеры, извлечены из
 * routes/bible.ts. Полная (buildRecheckPrompt) и пакетная (buildBatchRecheckPrompt)
 * перепроверка глав против уже одобренных сущностей. Без БД/AI/IO.
 */
import { BASE_EXTRACTION_PROMPT } from './extraction.js';

export interface ApprovedEntity { name: string; type: string; description: string | null }

/**
 * Recheck prompt — tells the AI about already-approved entities.
 * Key difference from old version: explicitly asks AI to SKIP entities with no new info,
 * which avoids noisy "same description" update suggestions.
 */
export function buildRecheckPrompt(approvedEntities: ApprovedEntity[]): string {
  if (approvedEntities.length === 0) return BASE_EXTRACTION_PROMPT;

  const list = approvedEntities
    .map(e => `• ${e.name} (${e.type}): ${e.description ?? '—'}`)
    .join('\n');

  return `Ты — литературный редактор, обновляющий справочник произведения.

Уже одобренные сущности проекта:
${list}

ЗАДАЧА — проанализировать текст главы:

1. Для ИЗВЕСТНЫХ сущностей (из списка выше):
   • Если глава раскрывает НОВЫЙ факт, уточнение или противоречие → верни сущность с обновлённым описанием.
   • Если новых деталей нет → НЕ включай эту сущность в ответ вообще.
   • Не предлагай обновление ради косметических изменений формулировки.

2. Для НОВЫХ сущностей (которых нет в списке):
   • Добавь по общим правилам (только именованные, только с конкретными деталями).

ТРЕБОВАНИЯ:
• Описание — строго из текста. Никаких домыслов.
• Используй каноническое имя из списка при совпадении (не новую форму).
• Если ничего нового нет — верни пустой массив entities.
• Для каждой сущности добавь significance ("major"/"moderate"/"minor") и attributes (только подтверждённые текстом поля).
  Для character доступны также: background (предыстория), motivations (мотивация),
  speech (манера речи), secrets (тайны), plotRelevance (зачем сюжету).
• Для character добавь events: 0–3 сюжетно значимых события персонажа В ЭТОЙ главе
  ({ "title": "2–4 слова", "description": "одно предложение", "eventType": "conflict"|"relationship"|"status"|"revelation"|"other",
     "timeLabel": "маркер времени из текста, если есть («за год до», «той же ночью»), иначе опусти",
     "timeHint": "'present' | 'flashback' | 'past' | 'future' (по умолчанию 'present')" }).
• Добавь relations: связи между сущностями (из списка или новыми), ЯВНО подтверждённые текстом:
  [{ "from": "Имя", "to": "Имя", "relation": "краткий тип («мать», «наставник», «живёт в»)" }].
  Для ЛОКАЦИЙ добавляй вложенность: relation «находится в»/«часть» (меньшее место → большее).

Ответ — строго JSON, без markdown. Имена и описания бери ТОЛЬКО из текста
(не подставляй слова «Имя», «Название», «Описание» как значения).
Структура (пример на вымышленных данных, не копируй):
{
  "entities": [
    {
      "type": "character",
      "name": "Кейлен",
      "description": "Капитан стражи. В этой главе раскрывает свой план побега.",
      "significance": "major",
      "attributes": { "appearance": "светловолосый", "role": "капитан стражи" },
      "events": [{ "title": "Раскрытие плана", "description": "Делится планом побега с сестрой.", "eventType": "conflict" }]
    }
  ],
  "relations": [{ "from": "Кейлен", "to": "Мира", "relation": "союзник" }],
  "chapterSummary": "Рабочее название главы (2–4 слова)"
}`;
}

/**
 * Batch recheck prompt — analyze multiple chapters in a single API call.
 * Reduces N API calls to ceil(N / BATCH_SIZE) calls.
 */
export function buildBatchRecheckPrompt(
  approvedEntities: ApprovedEntity[],
  chapters: { chapterId: string; title: string; plainText: string }[]
): string {
  const list = approvedEntities.length > 0
    ? approvedEntities.map(e => `• ${e.name} (${e.type}): ${e.description ?? '—'}`).join('\n')
    : '(нет одобренных сущностей)';

  const chapterBlocks = chapters.map(ch =>
    `=== ГЛАВА: «${ch.title}» | id: ${ch.chapterId} ===\n${ch.plainText}`
  ).join('\n\n');

  return `Ты — литературный редактор, обновляющий справочник произведения.

Уже одобренные сущности проекта:
${list}

Проанализируй следующие главы. Для каждой главы:
1. Найди НОВЫЕ факты об известных сущностях → предложи обновление описания.
2. Найди новые именованные сущности с деталями → добавь.
3. Если нет ничего нового — верни пустой массив entities для этой главы.

Критерии качества:
• Описание — только из текста. Никаких домыслов.
• Не предлагай косметические переформулировки.
• Для известных сущностей: включай ТОЛЬКО если есть новая информация.
• Для каждой сущности добавь significance ("major"/"moderate"/"minor") и attributes (только подтверждённые текстом поля).
  Для character доступны также: background, motivations, speech, secrets, plotRelevance.
• Для character добавь events: 0–3 сюжетно значимых события персонажа в данной главе
  ({ "title": "2–4 слова", "description": "одно предложение", "eventType": "conflict"|"relationship"|"status"|"revelation"|"other",
     "timeLabel": "маркер времени из текста, если есть, иначе опусти", "timeHint": "'present'|'flashback'|'past'|'future'" }).
• Для каждой главы добавь relations: связи между сущностями, ЯВНО подтверждённые текстом
  ([{ "from": "Имя", "to": "Имя", "relation": "краткий тип" }]). Для локаций — вложенность «находится в»/«часть».

${chapterBlocks}

Ответ — строго JSON, без markdown. Имена/описания — ТОЛЬКО из текста глав
(слова «Имя», «Название», «Описание» как значения не подставляй).
Структура (пример на вымышленных данных, не копируй):
{
  "chapters": [
    {
      "chapterId": "uuid-главы",
      "entities": [
        {
          "type": "character",
          "name": "Кейлен",
          "description": "Капитан стражи. Принимает командование гарнизоном.",
          "significance": "major",
          "attributes": { "appearance": "светловолосый", "role": "капитан стражи" },
          "events": [{ "title": "Побег из крепости", "description": "Сбегает через подземный ход.", "eventType": "status" }]
        }
      ],
      "relations": [{ "from": "Кейлен", "to": "Мира", "relation": "сестра" }],
      "chapterSummary": "2–4 слова или null"
    }
  ]
}`;
}
