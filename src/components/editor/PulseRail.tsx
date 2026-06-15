import {
  Loader2, CheckCircle2, Eye, Bell, AlertTriangle, BookOpen, Feather,
} from 'lucide-react';

interface Props {
  /** Read-status of the current chapter (the core loop's heartbeat). */
  freshness: 'fresh' | 'stale' | 'unknown';
  isExtracting: boolean;
  /** Trigger a read of the current chapter (extract for 'unknown', recheck for 'stale'). */
  onRead: () => void;

  /** New entities + pending update suggestions waiting for approval. */
  findingsCount: number;
  onOpenFindings: () => void;

  /** Possible contradictions detected across the approved world. */
  contradictionsCount: number;
  onOpenContradictions: () => void;

  /** Lens launcher + analyst chat. */
  onOpenWorld: () => void;
  isWorldOpen: boolean;
  onOpenCoauthor: () => void;
  isCoauthorOpen: boolean;
}

/**
 * «Пульс мира» — тонкий всегда-видимый рельс справа. Показывает состояние, на которое
 * глянул (читал ли Перо главу, сколько находок, сколько нестыковок), и даёт вход в
 * «Мир» (линзы) и «Перо» (чат). Не кнопки-загадки, а живой пульс продукта.
 * Скрыт в режиме фокуса и на узких экранах (там работает нижняя панель).
 */
export function PulseRail({
  freshness, isExtracting, onRead,
  findingsCount, onOpenFindings,
  contradictionsCount, onOpenContradictions,
  onOpenWorld, isWorldOpen,
  onOpenCoauthor, isCoauthorOpen,
}: Props) {
  const cell =
    'relative flex items-center justify-center w-10 h-10 rounded-xl transition-colors outline-none focus:outline-none focus:ring-0';
  const idle = 'text-[#6b7280] hover:bg-[#1e2d1f]/[0.06] hover:text-[#1e2d1f]';

  return (
    <div
      className="hidden md:flex flex-col items-center gap-1.5 flex-shrink-0 w-12 py-3 z-30
                 bg-[#f5f0e8]/80 backdrop-blur-sm border-l border-[#1e2d1f]/10"
      role="toolbar"
      aria-label="Пульс мира"
    >
      {/* 1. Статус чтения главы — сердце цикла */}
      {isExtracting ? (
        <div
          className={`${cell} text-amber-600`}
          title="Перо читает главу…"
          aria-label="Перо читает главу"
        >
          <Loader2 size={19} className="animate-spin" />
        </div>
      ) : freshness === 'fresh' ? (
        <div
          className={`${cell} text-emerald-600`}
          title="Перо прочитало эту главу"
          aria-label="Перо прочитало эту главу"
        >
          <CheckCircle2 size={19} />
        </div>
      ) : (
        <button
          onClick={onRead}
          className={`${cell} text-amber-600 hover:bg-amber-50`}
          title={freshness === 'stale'
            ? 'Глава изменилась — Перо ещё не перечитало. Нажмите, чтобы прочитать'
            : 'Глава ещё не прочитана Пером. Нажмите, чтобы прочитать'}
          aria-label="Прочитать главу"
        >
          <Eye size={19} />
          <span className="absolute inset-0 rounded-xl animate-ping bg-amber-300/25 pointer-events-none" />
        </button>
      )}

      {/* 2. Находки — новое на одобрение */}
      <button
        onClick={onOpenFindings}
        className={`${cell} ${findingsCount > 0 ? 'text-[#71597F] hover:bg-[#71597F]/10' : idle}`}
        title={findingsCount > 0
          ? `${findingsCount} новых находок Пера — открыть «Новое»`
          : 'Находки Пера — пока пусто'}
        aria-label={findingsCount > 0 ? `Находки, ${findingsCount} ждут одобрения` : 'Находки'}
      >
        <Bell size={18} />
        {findingsCount > 0 && (
          <span aria-hidden="true" className="absolute top-1 right-1 min-w-[15px] h-[15px] flex items-center justify-center bg-[#71597F] text-white text-[9px] font-bold rounded-full leading-none px-0.5">
            {findingsCount > 9 ? '9+' : findingsCount}
          </span>
        )}
      </button>

      {/* 3. Нестыковки */}
      <button
        onClick={onOpenContradictions}
        className={`${cell} ${contradictionsCount > 0 ? 'text-[#A14F44] hover:bg-[#A14F44]/10' : idle}`}
        title={contradictionsCount > 0
          ? `${contradictionsCount} возможных нестыковок — открыть`
          : 'Нестыковки — пока не найдены'}
        aria-label={contradictionsCount > 0 ? `Нестыковки, ${contradictionsCount}` : 'Нестыковки'}
      >
        <AlertTriangle size={18} />
        {contradictionsCount > 0 && (
          <span aria-hidden="true" className="absolute top-1 right-1 min-w-[15px] h-[15px] flex items-center justify-center bg-[#A14F44] text-white text-[9px] font-bold rounded-full leading-none px-0.5">
            {contradictionsCount > 9 ? '9+' : contradictionsCount}
          </span>
        )}
      </button>

      <div className="w-5 h-px bg-[#1e2d1f]/10 my-1" />

      {/* 4. Мир — лончер линз */}
      <button
        onClick={onOpenWorld}
        className={`${cell} ${isWorldOpen ? 'bg-[#1e2d1f] text-white hover:bg-[#1e2d1f]' : idle}`}
        title="Мир — персонажи, локации, предметы, связи"
        aria-label="Открыть Мир"
      >
        <BookOpen size={18} />
      </button>

      {/* 5. Перо — спроси про мир */}
      <button
        onClick={onOpenCoauthor}
        className={`${cell} ${isCoauthorOpen ? 'bg-[#1e2d1f] text-white hover:bg-[#1e2d1f]' : idle}`}
        title="Перо — спросить про историю"
        aria-label="Открыть чат с Пером"
      >
        <Feather size={18} />
      </button>
    </div>
  );
}
