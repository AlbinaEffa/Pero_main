import { Link } from 'react-router-dom';
import {
  ChevronLeft, BookOpen, Sparkles, Lightbulb, PanelLeftClose,
  FileText, Library, Settings as SettingsIcon,
} from 'lucide-react';
import { PeroLogo } from './Logo';

/**
 * Единый левый сайдбар приложения — общий для ВСЕХ страниц.
 *
 * Структура (сверху вниз):
 *   • Шапка: логотип (→ к проектам) + кнопка сворачивания.
 *   • Середина (слот `children`): контекст проекта — список глав. На глобальных
 *     страницах (Проекты / Настройки / Идеи) слот пуст, его место занимает распорка.
 *   • Навигация проекта (только если задан `projectId`): Библия истории / Перо.
 *   • Глобальная навигация (всегда): Проекты / Идеи / Настройки.
 *   • `bottomExtra`: доп. блок (например, строка статуса сохранения в редакторе).
 *
 * Один и тот же компонент рисует меню на каждой странице — это и есть «общее меню».
 */

type ActivePage = 'dashboard' | 'editor' | 'bible' | 'ideas' | 'settings';

interface AppSidebarProps {
  /** Если задан — показывается навигация проекта (Библия / Перо) и ведёт на этот проект. */
  projectId?: string;
  active: ActivePage;
  /** Куда ведёт пункт «Перо» (открыть книгу в редакторе). Нужен в режиме проекта без тоггла. */
  editorPath?: string;
  /** Если задан — показывается кнопка сворачивания панели. */
  onCollapse?: () => void;
  /** Редактор: «Перо» — переключатель соавтора, а не ссылка. */
  coauthorActive?: boolean;
  onToggleCoauthor?: () => void;
  /** Середина: список глав (режим проекта). На глобальных страницах не передаётся. */
  children?: React.ReactNode;
  /** Доп. блок внизу под навигацией (например, строка статуса сохранения). */
  bottomExtra?: React.ReactNode;
}

const navIdle = 'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold text-white/90 transition-colors hover:bg-white/10';
const navActive = 'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold bg-white/15 text-white';

export function AppSidebar({
  projectId, active, editorPath, onCollapse, coauthorActive, onToggleCoauthor, children, bottomExtra,
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
        <Link to="/dashboard" className="text-[#f5f0e8] flex-1 min-w-0 hover:opacity-90 transition-opacity">
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
        {/* Контекст проекта */}
        {projectId && (
          <>
            <Link to={`/bible/${projectId}`} className={active === 'bible' ? navActive : navIdle}>
              <BookOpen size={16} className="text-white/55" />
              Библия истории
            </Link>

            {onToggleCoauthor ? (
              <button
                onClick={onToggleCoauthor}
                className={coauthorActive ? navActive : navIdle}
              >
                <Sparkles size={16} className={coauthorActive ? 'text-purple-300' : 'text-white/55'} />
                Перо
              </button>
            ) : (
              <Link to={editorPath ?? `/editor/${projectId}`} className={active === 'editor' ? navActive : navIdle}>
                <Sparkles size={16} className="text-white/55" />
                Перо
              </Link>
            )}

            <div className="h-px bg-white/10 my-2" />
          </>
        )}

        {/* Глобальная навигация — одинаковая на всех страницах */}
        <Link to="/dashboard" className={active === 'dashboard' ? navActive : navIdle}>
          <Library size={16} className="text-white/55" />
          Проекты
        </Link>
        <Link to="/ideas" className={active === 'ideas' ? navActive : navIdle}>
          <Lightbulb size={16} className="text-white/55" />
          Идеи
        </Link>
        <Link to="/settings" className={active === 'settings' ? navActive : navIdle}>
          <SettingsIcon size={16} className="text-white/55" />
          Настройки
        </Link>

        {bottomExtra}
      </div>
    </aside>
  );
}

/**
 * Простой список глав-ссылок для Библии и Идей (в редакторе — своя версия с управлением).
 */
export function SidebarChapterLinks({
  projectId, chapters, isLoading,
}: {
  projectId: string;
  chapters: { id: string; title: string }[];
  isLoading?: boolean;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-0.5">
      <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1 mt-2">
        Главы
      </div>
      {isLoading && <p className="px-3 text-xs text-white/40">Загрузка…</p>}
      {!isLoading && chapters.length === 0 && <p className="px-3 text-xs text-white/40">Нет глав</p>}
      {chapters.map(chapter => (
        <Link
          key={chapter.id}
          to={`/editor/${projectId}/${chapter.id}`}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-white/10 text-[#f5f0e8]/60 hover:text-white"
        >
          <FileText size={14} className="text-[#f5f0e8]/40 flex-shrink-0" />
          <span className="truncate">{chapter.title}</span>
        </Link>
      ))}
    </div>
  );
}
