import { Chapter } from './types';

/**
 * Единый формат подписи главы для сайдбара — общий для редактора (управление главами)
 * и для read-only списков (Библия, Идеи), чтобы строки выглядели одинаково и не «прыгали».
 */

export const CHAPTER_TYPE_LABELS: Record<string, string> = {
  prologue: 'Пролог',
  epilogue: 'Эпилог',
  interlude: 'Интермедия',
  chapter: '',
};

export function getChapterDisplayLabel(
  chapter: Chapter,
  index: number,
): { primary: string; secondary: string | null } {
  const type = chapter.chapterType ?? 'chapter';
  const trimmed = chapter.title.trim();

  if (type !== 'chapter') {
    const typeLabel = CHAPTER_TYPE_LABELS[type] ?? type;
    if (!trimmed || trimmed.toLowerCase() === typeLabel.toLowerCase()) {
      return { primary: typeLabel, secondary: null };
    }
    return { primary: typeLabel, secondary: trimmed };
  }

  const exactDefault = `Глава ${index + 1}`;
  if (!trimmed || trimmed === exactDefault) {
    return { primary: `Глава ${index + 1}`, secondary: null };
  }
  const prefixedMatch = trimmed.match(/^Глава\s+\d+[\s.:—-]+(.+)$/i);
  if (prefixedMatch?.[1]?.trim()) {
    return { primary: `Глава ${index + 1}`, secondary: prefixedMatch[1].trim() };
  }
  return { primary: `Глава ${index + 1}`, secondary: trimmed };
}
