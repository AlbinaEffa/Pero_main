import {
  Mic, MicOff, Sparkles, BookOpen, Bookmark, X,
  GitBranch, Activity, Maximize2, Minimize2, BarChart2,
} from 'lucide-react';
import { BIBLE_MENU_ITEMS } from './constants';

interface Props {
  isDictating: boolean;
  isDictationProcessing: boolean;
  isDictationSupported: boolean;
  onToggleDictation: () => void;
  isCoauthoring: boolean;
  onToggleCoauthor: () => void;
  isBibleOpen: boolean;
  isBibleMenuOpen: boolean;
  onSetBibleMenuOpen: (open: boolean) => void;
  onBibleMenuClick: (tabId: string) => void;
  isReferenceOpen: boolean;
  onToggleReference: () => void;
  isRevisionOpen: boolean;
  onToggleRevision: () => void;
  isSyncOpen: boolean;
  onToggleSync: () => void;
  isStatsOpen: boolean;
  onToggleStats: () => void;
  isFocusMode: boolean;
  onToggleFocusMode: () => void;
  /** Badge count for the sync panel button (stale + unknown chapters) */
  syncBadgeCount: number;
  onOpenSearch: () => void;
}

/** Склонение «глава» для бейджа синхронизации. */
function pluralChapters(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'глава';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'главы';
  return 'глав';
}

export function BottomToolbar({
  isDictating,
  isDictationProcessing,
  isDictationSupported,
  onToggleDictation,
  isCoauthoring,
  onToggleCoauthor,
  isBibleOpen,
  isBibleMenuOpen,
  onSetBibleMenuOpen,
  onBibleMenuClick,
  isReferenceOpen,
  onToggleReference,
  isRevisionOpen,
  onToggleRevision,
  isSyncOpen,
  onToggleSync,
  isStatsOpen,
  onToggleStats,
  isFocusMode,
  onToggleFocusMode,
  syncBadgeCount,
  onOpenSearch,
}: Props) {
  // На < xl правые панели становятся оверлеем шириной 320px — сдвигаем тулбар
  // влево, чтобы он центрировался в оставшемся пространстве, а не прятался под панель.
  const isSidePanelOpen = isBibleOpen || isCoauthoring || isReferenceOpen
    || isRevisionOpen || isSyncOpen || isStatsOpen;

  return (
    <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-stretch gap-3 z-40 transition-[left] duration-300 ease-in-out ${
      isSidePanelOpen ? 'max-xl:left-[calc(50%-160px)]' : ''
    }`}>
      {/* Main Toolbar */}
      <div className="relative">
        {isBibleMenuOpen && (
          <div className="absolute bottom-full mb-2 right-0 w-48 bg-white rounded-xl shadow-xl border border-[#1e2d1f]/10 py-2 z-50">
            <div className="px-4 py-2 text-[10px] font-bold text-ink/55 uppercase tracking-widest mb-1">
              Библия истории
            </div>
            {BIBLE_MENU_ITEMS.map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onBibleMenuClick(item.id);
                    onSetBibleMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-[#f5f0e8] transition-colors"
                >
                  <Icon size={16} className="text-[#1e2d1f]/55" />
                  <span className="font-medium text-[#1e2d1f]">{item.label}</span>
                </button>
              );
            })}
            {isBibleOpen && (
              <>
                <div className="h-px bg-ink/5 my-1 mx-2" />
                <button
                  onClick={() => onSetBibleMenuOpen(false)}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-red-50 text-red-600 transition-colors"
                >
                  <X size={16} className="text-red-500/70" />
                  <span className="font-medium">Закрыть панель</span>
                </button>
              </>
            )}
          </div>
        )}

        <div className={`bg-white/95 backdrop-blur-md shadow-[0_4px_25px_rgba(30,45,31,0.06)] border border-[#1e2d1f]/5 rounded-2xl px-2 py-2 flex items-center gap-1 overflow-x-auto hide-scrollbar max-w-[calc(100vw-2rem)] ${
          isSidePanelOpen ? 'max-xl:max-w-[calc(100vw-320px-2rem)]' : ''
        }`}>
          {isDictationSupported ? (
            <button
              onClick={onToggleDictation}
              title={isDictating ? 'Остановить диктовку' : 'Начать диктовку'}
              className={`relative flex items-center justify-center w-auto h-[36px] whitespace-nowrap gap-2 px-3 sm:px-4 py-2 text-sm font-medium rounded-lg shrink-0 transition-all outline-none focus:outline-none focus:ring-0 ${
                isDictating
                  ? 'bg-red-500 text-white shadow-lg shadow-red-200'
                  : isDictationProcessing
                  ? 'bg-amber-50 text-amber-600 border border-amber-200'
                  : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
              }`}
            >
              {/* Pulsing ring when listening */}
              {isDictating && (
                <span className="absolute inset-0 rounded-lg animate-ping bg-red-400 opacity-30 pointer-events-none" />
              )}
              {isDictating
                ? <MicOff size={16} className="flex-shrink-0" />
                : <Mic size={16} className="flex-shrink-0" />
              }
              <span className="hidden sm:inline">
                {isDictating ? 'Стоп' : isDictationProcessing ? 'Обработка…' : 'Диктовка'}
              </span>
            </button>
          ) : (
            <div
              className="flex items-center justify-center h-[36px] whitespace-nowrap gap-2 px-3 sm:px-4 py-2 text-sm font-medium rounded-lg shrink-0 text-[#9ca3af] cursor-not-allowed select-none"
              title="Диктовка недоступна в этом браузере. Используйте Chrome или Safari."
            >
              <Mic size={16} />
              <span className="hidden sm:inline">Диктовка</span>
              <span className="hidden sm:inline text-[10px] font-semibold uppercase tracking-wide text-[#9ca3af]/70 bg-[#f3f4f6] rounded px-1 py-0.5 leading-none">—</span>
            </div>
          )}

          <button
            onClick={onToggleCoauthor}
            className={`flex items-center justify-center w-auto sm:w-[130px] h-[36px] whitespace-nowrap gap-2 px-3 sm:px-4 py-2 transition-colors text-sm font-medium rounded-lg outline-none focus:outline-none focus:ring-0 shrink-0 ${
              isCoauthoring
                ? 'bg-[#1e2d1f] text-white'
                : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
            }`}
          >
            <Sparkles size={16} /> Перо
          </button>

          <div className="w-px h-6 bg-[#1e2d1f]/10 mx-1 shrink-0" />


          <button
            onClick={() => onSetBibleMenuOpen(!isBibleMenuOpen)}
            className={`p-2 transition-colors rounded-lg outline-none focus:outline-none focus:ring-0 flex items-center justify-center shrink-0 ${
              isBibleOpen || isBibleMenuOpen
                ? 'bg-[#1e2d1f] text-white'
                : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
            }`}
            title="Библия истории" aria-label="Библия истории"
          >
            <BookOpen size={18} />
          </button>

          <button
            onClick={onToggleReference}
            className={`p-2 transition-colors rounded-lg outline-none focus:outline-none focus:ring-0 flex items-center justify-center shrink-0 ${
              isReferenceOpen
                ? 'bg-[#1e2d1f] text-white'
                : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
            }`}
            title="Справочник главы" aria-label="Справочник главы"
          >
            <Bookmark size={18} />
          </button>

          <button
            onClick={onToggleRevision}
            className={`p-2 transition-colors rounded-lg outline-none focus:outline-none focus:ring-0 flex items-center justify-center shrink-0 ${
              isRevisionOpen
                ? 'bg-emerald-700 text-white'
                : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
            }`}
            title="Ревизия" aria-label="Ревизия"
          >
            <GitBranch size={18} />
          </button>

          <button
            onClick={onToggleSync}
            className={`relative p-2 transition-colors rounded-lg outline-none focus:outline-none focus:ring-0 flex items-center justify-center shrink-0 ${
              isSyncOpen
                ? 'bg-blue-600 text-white'
                : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
            }`}
            title={syncBadgeCount > 0
              ? `Синхронизация: ${syncBadgeCount} ${pluralChapters(syncBadgeCount)} изменились после анализа — обновить библию`
              : 'Синхронизация проекта с библией'}
            aria-label={syncBadgeCount > 0
              ? `Синхронизация, ${syncBadgeCount} ${pluralChapters(syncBadgeCount)} ждут обновления библии`
              : 'Синхронизация проекта с библией'}
          >
            <Activity size={18} />
            {syncBadgeCount > 0 && !isSyncOpen && (
              <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center bg-amber-400 text-white text-[8px] font-bold rounded-full leading-none px-0.5">
                {syncBadgeCount > 9 ? '9+' : syncBadgeCount}
              </span>
            )}
          </button>

          <button
            onClick={onToggleStats}
            className={`p-2 transition-colors rounded-lg outline-none focus:outline-none focus:ring-0 flex items-center justify-center shrink-0 ${
              isStatsOpen
                ? 'bg-emerald-600 text-white'
                : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
            }`}
            title="Статистика написанного" aria-label="Статистика написанного"
          >
            <BarChart2 size={18} />
          </button>

          <button
            onClick={onToggleFocusMode}
            className={`p-2 transition-colors rounded-lg outline-none focus:outline-none focus:ring-0 flex items-center justify-center shrink-0 ${
              isFocusMode
                ? 'bg-[#1e2d1f] text-white'
                : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
            }`}
            title={isFocusMode ? 'Выйти из режима фокусировки' : 'Режим фокусировки'}
            aria-label={isFocusMode ? 'Выйти из режима фокусировки' : 'Режим фокусировки'}
          >
            {isFocusMode ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
