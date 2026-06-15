import { Link } from 'react-router-dom';
import {
  ChevronLeft, BookOpen, Lightbulb, PanelLeftClose,
  FileText, FileCheck, Settings as SettingsIcon,
} from 'lucide-react';
import { PeroLogo } from './Logo';
import { Chapter } from './editor/types';
import { getChapterDisplayLabel } from './editor/chapterDisplay';

/**
 * Единый левый сайдбар рабочего пространства проекта — общий для Редактора,
 * Библии истории и Идей. Один и тот же компонент рисует одинаковое меню на всех
 * страницах проекта, поэтому сайдбар не «прыгает» при переходах между ними.
 *
 * Структура (сверху вниз):
 *   • Шапка: логотип «Перо» (бренд, → к проектам) + кнопка сворачивания.
 *   • Середина (слот `children`): список глав — в Редакторе с управлением,
 *     на Библии/Идеях read-only, но визуально одинаковый (см. SidebarChapterLinks).
 *   • Навигация проекта (если задан `projectId`): Мир / Идеи.
 *   • Глобальная навигация (всегда): Проекты / Настройки.
 *   • `bottomExtra`: доп. блок (например, строка статуса сохранения в редакторе).
 *
 * Соавтор «Перо» здесь НЕ пункт меню — он живёт в нижнем тулбаре редактора,
 * чтобы слово «Перо» в сайдбаре было только брендом на логотипе (без дубля).
 */

type ActivePage = 'dashboard' | 'editor' | 'bible' | 'ideas' | 'settings';

interface AppSidebarProps {
  /** Если задан — показывается навигация проекта (Библия / Идеи). */
  projectId?: string;
  active: ActivePage;
  /** Если задан — «Мир» открывает инспектор прямо в редакторе
      (а не уводит на отдельную страницу /bible). REORG_PLAN шаг 3. */
  onOpenBible?: () => void;
  /** Если задан — показывается кнопка сворачивания панели. */
  onCollapse?: () => void;
  /** Середина: список глав (режим проекта). На глобальных страницах не передаётся. */
  children?: React.ReactNode;
  /** Доп. блок внизу под навигацией (например, строка статуса сохранения). */
  bottomExtra?: React.ReactNode;
}

// DESIGN.md §Typography (control scale): пункт навигации 14px — неактивный 500, активный 600.
const navIdle = 'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-white/90 transition-colors hover:bg-white/10';
const navActive = 'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold bg-white/15 text-white';

export function AppSidebar({
  projectId, active, onOpenBible, onCollapse, children, bottomExtra,
}: AppSidebarProps) {
  return (
    <aside className="w-[220px] bg-[#1e2d1f] text-white/80 flex flex-col flex-shrink-0 shadow-xl z-20">
      {/* Шапка */}
      <div className="p-4 flex items-center gap-2 border-b border-white/10">
        <Link
          to="/dashboard"
          title="К проектам"
          className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white/60 hover:text-white shrink-0"
        >
          <ChevronLeft size={18} />
        </Link>
        {/* Логотип-бренд «Перо». Соавтора в меню нет — он в нижнем тулбаре редактора,
            поэтому слово «Перо» здесь не двоится. */}
        <Link
          to="/dashboard"
          title="К проектам"
          className="text-[#f5f0e8] flex-1 min-w-0 hover:opacity-90 transition-opacity"
        >
          <PeroLogo size={20} withWordmark />
        </Link>
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Скрыть панель"
            aria-label="Скрыть панель"
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white/60 hover:text-white shrink-0"
          >
            <PanelLeftClose size={18} />
          </button>
        )}
      </div>

      {/* Середина — список глав (слот) или распорка на глобальных страницах */}
      {children ?? <div className="flex-1 min-h-0" />}

      {/* Навигация */}
      <div className="flex-shrink-0 p-3 border-t border-white/10 space-y-1">
        {/* Контекст проекта — одинаковый на Редакторе / Библии / Идеях */}
        {projectId && (
          <>
            {onOpenBible ? (
              <button onClick={onOpenBible} className={active === 'bible' ? navActive : navIdle}>
                <BookOpen size={16} className="text-white/55" />
                Мир
              </button>
            ) : (
              <Link to={`/bible/${projectId}`} className={active === 'bible' ? navActive : navIdle}>
                <BookOpen size={16} className="text-white/55" />
                Мир
              </Link>
            )}

            <Link to={`/ideas/${projectId}`} className={active === 'ideas' ? navActive : navIdle}>
              <Lightbulb size={16} className="text-white/55" />
              Идеи
            </Link>

            <div className="h-px bg-white/10 my-2" />
          </>
        )}

        {/* Глобальная навигация. «Проекты» убраны — дублировали стрелку «‹ К проектам»
            в шапке (REORG_PLAN шаг 1). */}
        <Link to="/settings" className={active === 'settings' ? navActive : navIdle}>
          <SettingsIcon size={16} className="text-white/55" />
          Настройки
        </Link>

        {/* Резервируем высоту строки статуса (есть только в редакторе), чтобы меню
            стояло на одном месте на всех страницах проекта и не «прыгало». */}
        <div className="min-h-[1.75rem]">{bottomExtra}</div>
      </div>
    </aside>
  );
}

/**
 * Read-only список глав для Библии и Идей. Визуально совпадает со строками главы
 * в редакторе «в покое» (иконка-статус + двухстрочная подпись), но без управления
 * (drag / удаление / добавление) — чтобы сайдбар не менялся между страницами.
 */
export function SidebarChapterLinks({
  projectId, chapters, isLoading,
}: {
  projectId: string;
  chapters: Chapter[];
  isLoading?: boolean;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-0.5">
      <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1 mt-2">
        Главы
      </div>
      {isLoading && <p className="px-3 text-xs text-white/40">Загрузка…</p>}
      {!isLoading && chapters.length === 0 && <p className="px-3 text-xs text-white/40">Нет глав</p>}
      {chapters.map((chapter, index) => {
        const isDone = chapter.status === 'done';
        const { primary, secondary } = getChapterDisplayLabel(chapter, index);
        return (
          <Link
            key={chapter.id}
            to={`/editor/${projectId}/${chapter.id}`}
            className="group flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors hover:bg-white/5 border-y-2 border-transparent"
          >
            {/* Невидимая распорка под drag-ручку редактора (size 14, -ml-1): держит
                иконку и название на той же позиции, что и в редакторе — сайдбар не «прыгает». */}
            <span className="flex-shrink-0 -ml-1 w-3.5" aria-hidden="true" />
            <span className={`flex-shrink-0 flex items-center justify-center ${isDone ? 'text-green-400' : 'text-white/60'}`}>
              {isDone ? <FileCheck size={16} strokeWidth={1.75} /> : <FileText size={16} strokeWidth={1.75} />}
            </span>
            <span className="flex-1 flex flex-col min-w-0 text-left">
              <span className="text-[14px] font-semibold leading-tight text-white/82 group-hover:text-white truncate">
                {primary}
              </span>
              {secondary && (
                <span className="text-[12px] truncate leading-tight mt-0.5 text-white/60">
                  {secondary}
                </span>
              )}
            </span>
            {/* Невидимая распорка под кнопку удаления редактора (Trash2 size 13 + p-1 ≈ 21px):
                держит высоту строки и ширину обрезки названия такими же, как в редакторе. */}
            <span className="flex-shrink-0 w-[21px] h-[21px]" aria-hidden="true" />
          </Link>
        );
      })}
    </div>
  );
}
