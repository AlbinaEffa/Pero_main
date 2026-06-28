/**
 * Книжный резолв POV (системное решение, Фаза 3) — чистые хелперы, без БД/AI/IO.
 *
 * Проблема: POV ставился только как побочный выход извлечения, и модель часто возвращала
 * null → у большинства глав нет рассказчика, а без него Фаза 2 не может спасти факты от
 * первого лица. Этот модуль — детерминированный классификатор: какой главе нужен AI-детект
 * рассказчика, а какой POV известен бесплатно (служебная → «Автор») или не нужен (структурный
 * разделитель / повествование от третьего лица → POV законно остаётся null).
 *
 * Так фокусный (и потому надёжный) AI-вызов «кто рассказчик?» тратится ТОЛЬКО на
 * narrative-главы от первого лица, а не на всю книгу подряд.
 */
import { isServiceChapter, AUTHOR_POV } from './chapterPov.js';

/** Местоимения первого лица — маркеры повествования от «я». */
const FIRST_PERSON = new Set([
  'я', 'меня', 'мне', 'мной', 'мною', 'мы', 'нас', 'нам', 'нами',
]);

/** Доля первого лица к числу слов. Кириллице нужен \p{L}-токенайзер (JS \b ненадёжен). */
export function firstPersonRatio(text: string): number {
  const words = (text.toLowerCase().match(/[\p{L}]+/gu) ?? []);
  if (words.length === 0) return 0;
  let fp = 0;
  for (const w of words) if (FIRST_PERSON.has(w)) fp++;
  return fp / words.length;
}

/** Порог «это повествование от первого лица» — откалиброван на фикстуре (first-person главы ≫ 0.012). */
export const FIRST_PERSON_THRESHOLD = 0.012;
/** Меньше слов — это разделитель/заглушка (титул части), а не глава с рассказчиком. */
export const MIN_NARRATIVE_WORDS = 200;

export type PovPlan = 'author' | 'none' | 'detect';

/**
 * Детерминированный план резолва POV для одной главы:
 *  • 'author' — служебная глава (благодарности и т.п.): голос автора, POV = «Автор», без AI;
 *  • 'none'   — структурный разделитель (мало слов) ИЛИ повествование от третьего лица:
 *               рассказчика-персонажа нет, POV законно остаётся null;
 *  • 'detect' — narrative-глава от первого лица: нужен фокусный AI-детект имени рассказчика.
 */
export function classifyChapterPov(opts: { chapterType?: string | null; text: string }): {
  plan: PovPlan;
  person: 'first' | 'third' | 'n/a';
  ratio: number;
  words: number;
} {
  const words = (opts.text.toLowerCase().match(/[\p{L}]+/gu) ?? []).length;
  if (isServiceChapter(opts.chapterType)) return { plan: 'author', person: 'n/a', ratio: 0, words };
  if (words < MIN_NARRATIVE_WORDS) return { plan: 'none', person: 'n/a', ratio: 0, words };
  const ratio = firstPersonRatio(opts.text);
  if (ratio <= FIRST_PERSON_THRESHOLD) return { plan: 'none', person: 'third', ratio, words };
  return { plan: 'detect', person: 'first', ratio, words };
}

/** Детерминированный POV без AI (служебная → «Автор», иначе null — нужен детект/третье лицо). */
export function deterministicBookPov(chapterType?: string | null): string | null {
  return isServiceChapter(chapterType) ? AUTHOR_POV : null;
}

/** Фокусный промпт «кто рассказчик?» — дёшево (только начало главы), отдельная задача, не извлечение. */
export function buildPovDetectPrompt(openingText: string): string {
  return `Ниже начало главы романа. Определи, ОТ ЧЬЕГО ЛИЦА ведётся повествование.
ЯЗЫК ответа: русский.
• Если повествование от первого лица («я») — назови КАНОНИЧЕСКОЕ имя рассказчика: как его
  зовут другие герои в этой или соседних сценах (по обращениям, репликам). НЕ местоимение.
• Если третье лицо, или имя рассказчика в тексте не названо — верни null.
Ответ СТРОГО JSON, без markdown: {"pov": "Имя"} или {"pov": null}

ТЕКСТ:
${openingText.slice(0, 1800)}`;
}
