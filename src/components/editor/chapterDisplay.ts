import { Chapter, ChapterType } from './types';

/**
 * Единый реестр типов разделов — ОДИН источник правды для меню создания, переключателя
 * в заголовке, импорт-детекта и подписей. `service: true` — служебный раздел (не сюжет):
 * не анализируется ИИ (благодарности/посвящение/пред-/послесловие).
 */
export const CHAPTER_TYPES: { type: ChapterType; label: string; service: boolean }[] = [
  { type: 'chapter',         label: 'Глава',        service: false },
  { type: 'prologue',        label: 'Пролог',       service: false },
  { type: 'epilogue',        label: 'Эпилог',       service: false },
  { type: 'part',            label: 'Часть',        service: false },
  { type: 'interlude',       label: 'Интермедия',   service: false },
  { type: 'acknowledgments', label: 'Благодарности',service: true  },
  { type: 'dedication',      label: 'Посвящение',   service: true  },
  { type: 'foreword',        label: 'Предисловие',  service: true  },
  { type: 'afterword',       label: 'Послесловие',  service: true  },
];

/** Слово-тип по ключу (для не-«chapter»). Для chapter — пусто (подпись «Глава N»). */
export const CHAPTER_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  CHAPTER_TYPES.map(t => [t.type, t.type === 'chapter' ? '' : t.label]),
);

const SERVICE_TYPES = new Set(CHAPTER_TYPES.filter(t => t.service).map(t => t.type));

/** Служебный раздел (не сюжет) — исключается из ИИ-анализа. */
export function isServiceChapterType(type: string | null | undefined): boolean {
  return SERVICE_TYPES.has((type ?? 'chapter') as ChapterType);
}

export function getChapterDisplayLabel(
  chapter: Chapter,
  index: number,
): { primary: string; secondary: string | null } {
  const type = chapter.chapterType ?? 'chapter';
  const trimmed = chapter.title.trim();

  if (type !== 'chapter') {
    const typeLabel = CHAPTER_TYPE_LABELS[type] ?? type;
    // Снимаем ведущее слово-тип из подзаголовка, чтобы не было «Пролог · Пролог».
    const stripped = trimmed.replace(new RegExp(`^${typeLabel}[\\s.:—–-]*`, 'i'), '').trim();
    if (!stripped || stripped.toLowerCase() === typeLabel.toLowerCase()) {
      return { primary: typeLabel, secondary: null };
    }
    return { primary: typeLabel, secondary: stripped };
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
