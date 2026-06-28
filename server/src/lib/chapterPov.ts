/**
 * POV-инвариант: у КАЖДОЙ главы есть рассказчик (см. «Принцип POV»). Служебные главы
 * (благодарности/посвящение/предисловие/послесловие) — это голос АВТОРА, не сюжет, поэтому
 * их POV детерминирован = «Автор» (без ИИ). Сюжетные главы резолвятся отдельно (фазы 2–3).
 *
 * Единый источник типов глав для сервера (раньше списки дублировались в нескольких роутах).
 */

/** Служебные типы глав — голос автора, не сюжетное повествование. */
export const SERVICE_CHAPTER_TYPES = ['acknowledgments', 'dedication', 'foreword', 'afterword'] as const;

/** Сюжетные/структурные типы (повествование). */
export const NARRATIVE_CHAPTER_TYPES = ['chapter', 'prologue', 'epilogue', 'part', 'interlude'] as const;

/** Полный список допустимых типов глав — единый источник для allowed-проверок. */
export const ALLOWED_CHAPTER_TYPES: readonly string[] = [...NARRATIVE_CHAPTER_TYPES, ...SERVICE_CHAPTER_TYPES];

/** POV служебных глав — голос автора. */
export const AUTHOR_POV = 'Автор';

export const isServiceChapter = (chapterType: string | null | undefined): boolean =>
  SERVICE_CHAPTER_TYPES.includes((chapterType ?? '') as typeof SERVICE_CHAPTER_TYPES[number]);

/**
 * Детерминированный POV по типу главы (без ИИ): служебная → «Автор», иначе null
 * (сюжетную резолвим моделью/кросс-главным проходом). Применяется на импорте и при смене типа.
 */
export const deterministicPov = (chapterType: string | null | undefined): string | null =>
  isServiceChapter(chapterType) ? AUTHOR_POV : null;
