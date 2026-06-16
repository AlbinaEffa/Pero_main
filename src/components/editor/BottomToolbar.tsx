import { Mic, MicOff, Maximize2, Minimize2, Feather } from 'lucide-react';

interface Props {
  isDictating: boolean;
  isDictationProcessing: boolean;
  isDictationSupported: boolean;
  onToggleDictation: () => void;
  isFocusMode: boolean;
  onToggleFocusMode: () => void;
  /** Спутник «Перо» вызывается отсюда (правого рельса нет). */
  isCompanionOpen: boolean;
  onToggleCompanion: () => void;
  /** Подсветка кнопки «Перо», когда есть находки/нестыковки. */
  companionBadge?: boolean;
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
  onToggleCompanion,
  companionBadge,
}: Props) {
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
                ? 'bg-red-500 text-white shadow-lg shadow-red-200'
                : isDictationProcessing
                ? 'bg-amber-50 text-amber-600 border border-amber-200'
                : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
            }`}
          >
            {isDictating && (
              <span className="absolute inset-0 rounded-lg animate-ping bg-red-400 opacity-30 pointer-events-none" />
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

        <button
          data-hint="coauthor"
          onClick={onToggleCompanion}
          title={isCompanionOpen ? 'Скрыть Перо' : 'Перо — спутник: что в сцене, находки, спросить'}
          aria-label="Перо"
          className={`relative flex items-center justify-center h-[36px] whitespace-nowrap gap-2 px-3 sm:px-4 py-2 text-sm font-medium rounded-lg shrink-0 transition-colors outline-none focus:outline-none focus:ring-0 ${
            isCompanionOpen
              ? 'bg-[#1e2d1f] text-white'
              : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
          }`}
        >
          <Feather size={16} className="flex-shrink-0" />
          <span className="hidden sm:inline">Перо</span>
          {companionBadge && !isCompanionOpen && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#71597F]" />
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
