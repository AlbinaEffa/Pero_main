import { Mic, MicOff, Maximize2, Minimize2, Feather, BookOpen, Eye, StickyNote } from 'lucide-react';

interface Props {
  isDictating: boolean;
  isDictationProcessing: boolean;
  isDictationSupported: boolean;
  onToggleDictation: () => void;
  isFocusMode: boolean;
  onToggleFocusMode: () => void;
  /** Спутник «Перо» вызывается отсюда (правого рельса нет). */
  isCompanionOpen: boolean;
  /** Активная вкладка спутника — чтобы подсвечивать «В кадре» ИЛИ «Перо», а не одну на всё. */
  companionMode?: 'scene' | 'sverka' | 'chat';
  onToggleCompanion: () => void;
  /** Счётчик «требует внимания»: находки + нестыковки в этой главе. */
  companionCount?: number;
  /** «Мир» главы (Каталог/линзы) вызывается отсюда же. */
  onOpenWorld?: () => void;
  /** Открыт ли «Мир» — чтобы подсвечивать кнопку и делать её toggle. */
  isWorldOpen?: boolean;
  /** Счётчик «новое в Мире»: непросмотренные находки по главе. */
  worldCount?: number;
  /** «В кадре» — боковой спутник на вкладке памяти сцены (синопсис + кто/что в главе). */
  onOpenInFrame?: () => void;
  /** «Заметки» — линза идей/заметок (оверлей как «Мир»). */
  onOpenNotes?: () => void;
  isNotesOpen?: boolean;
}

/**
 * Нижняя панель — действие письма (Диктовка), вызов спутника «Перо» и Фокус.
 * Отдельного правого рельса нет: спутник призывается отсюда.
 */
export function BottomToolbar({
  isDictating,
  isDictationProcessing,
  isDictationSupported,
  onToggleDictation,
  isFocusMode,
  onToggleFocusMode,
  isCompanionOpen,
  companionMode = 'scene',
  onToggleCompanion,
  companionCount = 0,
  onOpenWorld,
  isWorldOpen = false,
  worldCount = 0,
  onOpenInFrame,
  onOpenNotes,
  isNotesOpen = false,
}: Props) {
  // Подсвечиваем именно ту вкладку спутника, что открыта (а не «Перо» на всё подряд).
  const frameActive = isCompanionOpen && companionMode === 'scene';
  const chatActive  = isCompanionOpen && companionMode === 'chat';
  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40">
      <div className="bg-white/95 backdrop-blur-md shadow-[0_4px_25px_rgba(30,45,31,0.06)] border border-[#1e2d1f]/5 rounded-2xl px-2 py-2 flex items-center gap-1">
        {isDictationSupported ? (
          <button
            data-hint="dictation"
            onClick={onToggleDictation}
            title={isDictating ? 'Остановить диктовку' : 'Начать диктовку'}
            className={`relative flex items-center justify-center h-[36px] whitespace-nowrap gap-2 px-3 sm:px-4 py-2 text-sm font-medium rounded-lg shrink-0 transition-all outline-none focus:outline-none focus:ring-0 ${
              isDictating
                ? 'bg-[#9E4338] text-white shadow-lg shadow-[#9E4338]/20'
                : isDictationProcessing
                ? 'bg-[#F2E9D8] text-[#91682E] border border-[#91682E]'
                : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
            }`}
          >
            {isDictating && (
              <span className="absolute inset-0 rounded-lg animate-ping bg-[#9E4338] opacity-30 pointer-events-none" />
            )}
            {isDictating
              ? <MicOff size={16} className="flex-shrink-0" />
              : <Mic size={16} className="flex-shrink-0" />}
            <span className="hidden sm:inline">
              {isDictating ? 'Стоп' : isDictationProcessing ? 'Обработка…' : 'Диктовка'}
            </span>
          </button>
        ) : (
          <div
            data-hint="dictation"
            className="flex items-center justify-center h-[36px] whitespace-nowrap gap-2 px-3 sm:px-4 py-2 text-sm font-medium rounded-lg shrink-0 text-[#9ca3af] cursor-not-allowed select-none"
            title="Диктовка недоступна в этом браузере. Используйте Chrome или Safari."
          >
            <Mic size={16} />
            <span className="hidden sm:inline">Диктовка</span>
            <span className="hidden sm:inline text-[10px] font-semibold uppercase tracking-wide text-[#9ca3af]/70 bg-[#f3f4f6] rounded px-1 py-0.5 leading-none">—</span>
          </div>
        )}

        <div className="w-px h-6 bg-[#1e2d1f]/10 mx-1 shrink-0" />

        {onOpenWorld && (
          <button
            data-hint="world"
            onClick={onOpenWorld}
            title={isWorldOpen ? 'Скрыть Мир' : 'Мир этой главы — кто и что в ней (Каталог, линзы)'}
            aria-label="Мир главы"
            className={`relative flex items-center justify-center h-[36px] whitespace-nowrap gap-2 px-3 sm:px-4 py-2 text-sm font-medium rounded-lg shrink-0 transition-colors outline-none focus:outline-none focus:ring-0 ${
              isWorldOpen ? 'bg-[#1e2d1f] text-white' : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
            }`}
          >
            <BookOpen size={16} className="flex-shrink-0" />
            <span className="hidden sm:inline">Мир</span>
            {worldCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] flex items-center justify-center bg-[#71597F] text-white text-[9px] font-bold rounded-full leading-none px-1">
                {worldCount > 9 ? '9+' : worldCount}
              </span>
            )}
          </button>
        )}

        {onOpenNotes && (
          <button
            data-hint="notes"
            onClick={onOpenNotes}
            title={isNotesOpen ? 'Скрыть Заметки' : 'Заметки — идеи по книге (записать набросок)'}
            aria-label="Заметки"
            className={`relative flex items-center justify-center h-[36px] whitespace-nowrap gap-2 px-3 sm:px-4 py-2 text-sm font-medium rounded-lg shrink-0 transition-colors outline-none focus:outline-none focus:ring-0 ${
              isNotesOpen ? 'bg-[#1e2d1f] text-white' : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
            }`}
          >
            <StickyNote size={16} className="flex-shrink-0" />
            <span className="hidden sm:inline">Заметки</span>
          </button>
        )}

        {onOpenInFrame && (
          <button
            data-hint="inframe"
            onClick={onOpenInFrame}
            title={frameActive ? 'Скрыть «В кадре»' : 'В кадре — синопсис и кто/что в этой сцене (боковой спутник)'}
            aria-label="В кадре"
            className={`relative flex items-center justify-center h-[36px] whitespace-nowrap gap-2 px-3 sm:px-4 py-2 text-sm font-medium rounded-lg shrink-0 transition-colors outline-none focus:outline-none focus:ring-0 ${
              frameActive ? 'bg-[#1e2d1f] text-white' : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
            }`}
          >
            <Eye size={16} className="flex-shrink-0" />
            <span className="hidden sm:inline">В кадре</span>
          </button>
        )}

        <button
          data-hint="coauthor"
          onClick={onToggleCompanion}
          title={chatActive ? 'Скрыть Перо' : 'Спросить Перо — чат по книге'}
          aria-label="Перо"
          className={`relative flex items-center justify-center h-[36px] whitespace-nowrap gap-2 px-3 sm:px-4 py-2 text-sm font-medium rounded-lg shrink-0 transition-colors outline-none focus:outline-none focus:ring-0 ${
            chatActive
              ? 'bg-[#1e2d1f] text-white'
              : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
          }`}
        >
          <Feather size={16} className="flex-shrink-0" />
          <span className="hidden sm:inline">Перо</span>
          {companionCount > 0 && !isCompanionOpen && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] flex items-center justify-center bg-[#71597F] text-white text-[9px] font-bold rounded-full leading-none px-1">
              {companionCount > 9 ? '9+' : companionCount}
            </span>
          )}
        </button>

        <div className="w-px h-6 bg-[#1e2d1f]/10 mx-1 shrink-0" />

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
  );
}
