import { useEffect, useRef } from 'react';

/**
 * Закрывает всплывающее меню по клику/тапу вне него (и по Escape).
 * Общий паттерн для ЛЮБОГО поповера (пикеры, дропдауны, контекст-меню) — кроме главных
 * сайдбаров, у которых есть свои кнопки сворачивания.
 *
 * Использование:
 *   const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
 *   {open && <div ref={ref}>…</div>}
 *
 * Вешает слушатель только когда `active` (меню открыто), чтобы не держать глобальные
 * хэндлеры зря. Использует mousedown (срабатывает раньше click — закрытие не «съедает»
 * клик по другой кнопке) + touchstart + Escape.
 */
export function useClickOutside<T extends HTMLElement = HTMLElement>(
  active: boolean,
  onOutside: () => void,
) {
  const ref = useRef<T | null>(null);
  // Держим колбэк в ref, чтобы не переподписываться при каждом ререндере.
  const cb = useRef(onOutside);
  cb.current = onOutside;

  useEffect(() => {
    if (!active) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) cb.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cb.current(); };
    // setTimeout — чтобы тот же клик, что ОТКРЫЛ меню, не закрыл его сразу.
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onPointer);
      document.addEventListener('touchstart', onPointer);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [active]);

  return ref;
}
