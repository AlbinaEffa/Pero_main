/**
 * Инкрементальный recheck главы — детект изменений на уровне абзацев ради экономии
 * токенов. Чистые функции (без БД/AI/IO), извлечены из routes/bible.ts.
 */
import { createHash } from 'crypto';

/**
 * Короткий SHA-256 текста. 16 hex = 64 бита — с запасом для детекта изменений.
 * Хранится в chapters.lastExtractedContentHash.
 */
export function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Текст → значимые абзацы: режем по пустым строкам, схлопываем пробелы, выкидываем
 * пустые и совсем короткие (≤30 симв.) строки.
 */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}|\r\n{2,}/)
    .map(p => p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 30);
}

/** Хеши значимых абзацев — базлайн для инкрементального recheck. */
export function paragraphHashes(text: string): string[] {
  return splitParagraphs(text).map(contentHash);
}

export interface IncrementalDecision {
  /** Что слать модели: только изменённые абзацы (инкремент) либо весь текст. */
  aiText: string;
  isIncremental: boolean;
}

/**
 * Решение об инкрементальном recheck: если есть базлайн хешей абзацев и изменилось
 * МЕНЬШИНСТВО (≤50% при ≥3 абзацах), шлём модели ТОЛЬКО изменённые абзацы — экономия
 * токенов на правке пары мест. Иначе (нет базлайна / мало абзацев / изменилось много /
 * ничего не изменилось) — полный текст главы.
 */
export function computeIncrementalText(plainText: string, storedParaHashes: string[]): IncrementalDecision {
  const curParas = splitParagraphs(plainText);
  if (storedParaHashes.length > 0 && curParas.length >= 3) {
    const storedSet = new Set(storedParaHashes);
    const changed = curParas.filter(p => !storedSet.has(contentHash(p)));
    if (changed.length > 0 && changed.length / curParas.length <= 0.5) {
      return { aiText: changed.join('\n\n'), isIncremental: true };
    }
  }
  return { aiText: plainText, isIncremental: false };
}
