import {
  Mic, Sparkles, Headphones, Search, BookOpen, Bookmark,
  SkipBack, Pause, SkipForward, X, GitBranch, Activity,
} from 'lucide-react';
import { BIBLE_MENU_ITEMS } from './constants';

interface Props {
  isDictating: boolean;
  isSupported: boolean;
  toggleListening: () => void;
  isCoauthoring: boolean;
  onToggleCoauthor: () => void;
  isReading: boolean;
  onToggleReading: () => void;
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
  /** Badge count for the sync panel button (stale + unknown chapters) */
  syncBadgeCount: number;
  onOpenSearch: () => void;
}

export function BottomToolbar({
  isDictating,
  isSupported,
  toggleListening,
  isCoauthoring,
  onToggleCoauthor,
  isReading,
  onToggleReading,
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
  syncBadgeCount,
  onOpenSearch,
}: Props) {
  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-stretch gap-3 z-40">
      {/* Read Aloud Bar */}
      {isReading && (
        <div className="bg-[#1e2d1f] rounded-[16px] px-4 py-3 flex items-center justify-between shadow-lg animate-in slide-in-from-bottom-2 fade-in duration-200 relative overflow-hidden">
          <div className="absolute bottom-0 left-0 w-full h-1 bg-[#f5f0e8]/10">
            <div className="h-full bg-[#f5f0e8]/50 w-[45%]" />
          </div>
          <div className="flex-1 flex justify-center">
            <span className="text-[#f5f0e8] text-sm italic font-medium mx-6">
              Она нащупала его сквозь тонкую ткань — холодный металл.
            </span>
          </div>
          <div className="flex items-center gap-3 text-white/80 relative z-10">
            <button className="hover:text-white transition-colors">
              <SkipBack size={16} fill="currentColor" />
            </button>
            <button className="hover:text-white transition-colors">
              <Pause size={16} fill="currentColor" />
            </button>
            <button className="hover:text-white transition-colors">
              <SkipForward size={16} fill="currentColor" />
            </button>
            <div className="w-px h-4 bg-white/20 mx-1" />
            <button onClick={onToggleReading} className="hover:text-white transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Main Toolbar */}
      <div className="relative">
        {isBibleMenuOpen && (
          <div className="absolute bottom-full mb-2 right-0 w-48 bg-white rounded-xl shadow-xl border border-[#1e2d1f]/10 py-2 z-50">
            <div className="px-4 py-2 text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">
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
                  <Icon size={16} className="text-[#1e2d1f]/40" />
                  <span className="font-medium text-[#1e2d1f]">{item.label}</span>
                </button>
              );
            })}
            {isBibleOpen && (
              <>
                <div className="h-px bg-black/5 my-1 mx-2" />
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

        <div className="bg-white/95 backdrop-blur-md shadow-[0_4px_25px_rgba(0,0,0,0.06)] border border-[#1e2d1f]/5 rounded-2xl px-2 py-2 flex items-center gap-1 max-w-[calc(100vw-2rem)] overflow-x-auto hide-scrollbar">
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (!isSupported) {
                alert('Ваш браузер не поддерживает встроенное распознавание речи. Пожалуйста, используйте Google Chrome.');
                return;
              }
              toggleListening();
            }}
            className={`flex items-center justify-center w-auto sm:w-[130px] h-[36px] whitespace-nowrap gap-2 px-3 sm:px-4 py-2 transition-colors text-sm font-medium rounded-lg outline-none focus:outline-none focus:ring-0 shrink-0 ${
              isDictating
                ? 'bg-[#ef4444] text-white shadow-inner animate-[pulse_2s_ease-in-out_infinite]'
                : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
            }`}
          >
            <Mic size={16} />
            <span className="hidden sm:inline">{isDictating ? 'Слушаю...' : 'Диктовка'}</span>
            <span className="sm:hidden">Дикт.</span>
          </button>

          <button
            onClick={onToggleCoauthor}
            className={`flex items-center justify-center w-auto sm:w-[130px] h-[36px] whitespace-nowrap gap-2 px-3 sm:px-4 py-2 transition-colors text-sm font-medium rounded-lg outline-none focus:outline-none focus:ring-0 shrink-0 ${
              isCoauthoring
                ? 'bg-[#1e2d1f] text-white'
                : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
            }`}
          >
            <Sparkles size={16} /> Соавтор
          </button>

          <button
            onClick={onToggleReading}
            className={`flex items-center justify-center w-auto sm:w-[130px] h-[36px] whitespace-nowrap gap-2 px-3 sm:px-4 py-2 transition-colors text-sm font-medium rounded-lg outline-none focus:outline-none focus:ring-0 shrink-0 ${
              isReading
                ? 'bg-[#1e2d1f] text-white'
                : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
            }`}
          >
            <Headphones size={16} /> Слушать
          </button>

          <div className="w-px h-6 bg-[#1e2d1f]/10 mx-1 shrink-0" />

          <button
            onClick={onOpenSearch}
            className="p-2 rounded-lg outline-none focus:outline-none focus:ring-0 bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f] transition-colors shrink-0"
          >
            <Search size={18} />
          </button>

          <button
            onClick={() => onSetBibleMenuOpen(!isBibleMenuOpen)}
            className={`p-2 transition-colors rounded-lg outline-none focus:outline-none focus:ring-0 flex items-center justify-center shrink-0 ${
              isBibleOpen || isBibleMenuOpen
                ? 'bg-[#1e2d1f] text-white'
                : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
            }`}
            title="Библия истории"
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
            title="Справочник главы"
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
            title="Ревизия"
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
            title="Синхронизация проекта"
          >
            <Activity size={18} />
            {syncBadgeCount > 0 && !isSyncOpen && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center bg-amber-400 text-white text-[8px] font-bold rounded-full leading-none px-0.5">
                {syncBadgeCount > 9 ? '9+' : syncBadgeCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
