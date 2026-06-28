/** Компактный формат числа слов: 1000+ → «NК» (тысячи), иначе как есть. */
export function formatWords(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}К`;
  return String(n);
}
