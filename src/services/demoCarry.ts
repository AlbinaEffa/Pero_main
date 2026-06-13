/**
 * Перенос рукописи из демо (без регистрации) в аккаунт после входа.
 *
 * Файл рукописи держим В ПАМЯТИ (а не в sessionStorage) — рукопись может весить
 * мегабайты, что не влезает в storage-квоту. SPA не перезагружается при переходе
 * на /login, поэтому модульная переменная переживает навигацию. При жёстком
 * обновлении страницы перенос теряется — тогда пользователь просто импортирует
 * рукопись заново из дашборда (graceful fallback).
 */

let pending: File | null = null;

export function setPendingManuscript(file: File | null): void {
  pending = file;
}

/** Забирает и очищает отложенную рукопись (одноразово). */
export function takePendingManuscript(): File | null {
  const f = pending;
  pending = null;
  return f;
}

export function hasPendingManuscript(): boolean {
  return pending !== null;
}
