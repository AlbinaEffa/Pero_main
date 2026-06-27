/**
 * Глобальный стор «мягкого пейволла» — лимиты Free-тарифа (P0.5).
 *
 * Бэкенд отдаёт 402 с machine-кодом (PLAN_LIMIT_*) и человеко-читаемым текстом.
 * `request()` (services/api) ловит такой ответ и зовёт `paywall.show(denial)` —
 * модалка `PaywallDialog` (смонтирована в App) подхватывает из стора. Точки
 * вызова не обязаны знать про пейволл: показ происходит ДО проброса ошибки.
 *
 * Реализация — крошечный внешний стор на useSyncExternalStore (без zustand:
 * его нет в зависимостях, а Context сюда не годится — `show` зовётся ИЗ api.ts,
 * вне дерева React).
 */
import { useSyncExternalStore } from 'react';

export interface PlanLimitDenial {
  code: 'PLAN_LIMIT_PROJECTS' | 'PLAN_LIMIT_BIBLE_CHAPTERS' | (string & {});
  /** Готовый текст для модалки (на русском). */
  error: string;
  limit: number;
  plan: 'free' | 'pro';
}

let current: PlanLimitDenial | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const paywall = {
  show(denial: PlanLimitDenial) { current = denial; emit(); },
  hide() { current = null; emit(); },
  get: () => current,
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};

/** Хук-подписка для PaywallDialog. */
export function usePaywallDenial(): PlanLimitDenial | null {
  return useSyncExternalStore(paywall.subscribe, paywall.get, () => null);
}

/** Лимиты Free для проактивных подсказок на фронте (совпадают с дефолтами planLimits.ts). */
export const FREE_LIMITS = { maxProjects: 1, bibleChapters: 30 } as const;
