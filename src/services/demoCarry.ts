/**
 * Перенос рукописи из демо (без регистрации) в аккаунт после входа.
 *
 * Файл рукописи держим В ПАМЯТИ (а не в sessionStorage) — рукопись может весить
 * мегабайты, что не влезает в storage-квоту. SPA не перезагружается при переходе
 * на /login, поэтому модульная переменная переживает навигацию. При жёстком
 * обновлении страницы перенос теряется — тогда пользователь просто импортирует
 * рукопись заново из дашборда (graceful fallback).
 *
 * Вместе с файлом несём жанры, которые Перо определило в демо (бесплатно), —
 * чтобы созданный после регистрации проект сразу получил жанр.
 */

let pendingFile: File | null = null;
let pendingGenres: string[] = [];

export function setPendingManuscript(file: File | null, genres: string[] = []): void {
  pendingFile = file;
  pendingGenres = genres;
}

/** Забирает и очищает отложенную рукопись (одноразово). */
export function takePendingManuscript(): { file: File; genres: string[] } | null {
  if (!pendingFile) return null;
  const result = { file: pendingFile, genres: pendingGenres };
  pendingFile = null;
  pendingGenres = [];
  return result;
}

export function hasPendingManuscript(): boolean {
  return pendingFile !== null;
}
