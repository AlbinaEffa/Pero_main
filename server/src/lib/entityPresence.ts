/**
 * Лексическое присутствие сущности в тексте главы — бэкенд-порт фронтового `entityMatch`
 * (src/components/editor/editorUtils.tsx). Цель: «срез Мира» для сверки нестыковок (worldSlice)
 * совпадал буква-в-букву с тем, кого автор видит в спутнике «В кадре». Без БД/AI/IO.
 *
 * Эвристика (как на фронте): имя токенизируется (токены ≥3 симв.), каждый токен стеммится
 * (отбрасываем последнюю букву, если длина >4 — покрывает падежные окончания). Многословное имя
 * («Король Сонного королевства») требует ВСЕ значимые токены (иначе «корол…» ложно притягивает);
 * однословное — хотя бы один. Без значимых токенов — стем-фолбэк по всему имени.
 */

const WORD_SPLIT = /[^а-яёa-z0-9'-]+/i;

/** Текст главы → массив слов в нижнем регистре (одна токенизация на главу). */
export function tokenize(text: string): string[] {
  return (text || '').toLowerCase().split(WORD_SPLIT).filter(w => w.length > 0);
}

/** Стем-фолбэк для коротких/однотокенных имён: какое-то слово начинается со стема имени. */
export function russianStemMatch(name: string, words: string[]): boolean {
  const n = name.toLowerCase().trim();
  if (!n || n.length < 2) return false;
  const stemLen = n.length <= 4 ? n.length : n.length - 1;
  const stem = n.slice(0, stemLen);
  return words.some(w => w.startsWith(stem));
}

/** True, если имя упомянуто в заранее токенизированном тексте (та же логика, что entityMatch). */
export function isMentioned(name: string, words: string[]): boolean {
  const tokens = name.toLowerCase().split(WORD_SPLIT).filter(t => t.length >= 3);
  if (tokens.length === 0) return russianStemMatch(name, words);
  const stems = tokens.map(t => (t.length <= 4 ? t : t.slice(0, t.length - 1)));
  const found = stems.map(() => false);
  for (const w of words) {
    for (let i = 0; i < stems.length; i++) {
      if (!found[i] && w.startsWith(stems[i])) found[i] = true;
    }
  }
  const hits = found.filter(Boolean).length;
  return stems.length >= 2 ? hits === stems.length : hits > 0;
}

export interface PresenceCandidate { name: string; aliases?: string[] }

/**
 * Подмножество сущностей, присутствующих в тексте главы (по имени ИЛИ любому алиасу).
 * Одна токенизация на главу, индекс возвращаемого Set — по ссылке на исходный объект.
 */
export function entitiesPresentInChapter<T extends PresenceCandidate>(
  chapterText: string,
  entities: T[],
): Set<T> {
  const words = tokenize(chapterText);
  const present = new Set<T>();
  for (const e of entities) {
    const names = [e.name, ...(e.aliases ?? [])];
    if (names.some(nm => nm && isMentioned(nm, words))) present.add(e);
  }
  return present;
}
