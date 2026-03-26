import { useMemo } from 'react';
import {
  X, Activity, CheckCircle2, AlertTriangle, HelpCircle, RefreshCw,
  ChevronRight, GitCompare, ArrowRight,
} from 'lucide-react';
import { Chapter } from './types';

type FreshnessStatus = 'fresh' | 'stale' | 'unknown';

function getChapterFreshness(chapter: Chapter): FreshnessStatus {
  if (!chapter.lastExtractedAt) return 'unknown';
  const editedAt    = new Date(chapter.updatedAt).getTime();
  const extractedAt = new Date(chapter.lastExtractedAt).getTime();
  return editedAt > extractedAt ? 'stale' : 'fresh';
}

const FRESHNESS_META: Record<FreshnessStatus, { label: string; dot: string; textColor: string; bgColor: string; Icon: React.ElementType }> = {
  fresh:   { label: 'Актуальна',    dot: 'bg-emerald-400', textColor: 'text-emerald-700', bgColor: 'bg-emerald-50',  Icon: CheckCircle2  },
  stale:   { label: 'Устарела',     dot: 'bg-amber-400',   textColor: 'text-amber-700',   bgColor: 'bg-amber-50',    Icon: AlertTriangle },
  unknown: { label: 'Не проверена', dot: 'bg-[#1e2d1f]/20', textColor: 'text-[#1e2d1f]/50', bgColor: 'bg-[#1e2d1f]/4', Icon: HelpCircle  },
};

interface Props {
  chapters: Chapter[];
  currentChapterId: string | undefined;
  pendingUpdatesCount: number;
  isRecheckingAll: boolean;
  onNavigateToChapter: (chapterId: string) => void;
  onRecheckAllStale: () => void;
  onOpenBibleUpdates: () => void;
  onClose: () => void;
}

export function ProjectSyncPanel({
  chapters,
  currentChapterId,
  pendingUpdatesCount,
  isRecheckingAll,
  onNavigateToChapter,
  onRecheckAllStale,
  onOpenBibleUpdates,
  onClose,
}: Props) {
  const statusCounts = useMemo(() => {
    const counts = { fresh: 0, stale: 0, unknown: 0 };
    for (const ch of chapters) {
      counts[getChapterFreshness(ch)]++;
    }
    return counts;
  }, [chapters]);

  const staleCount = statusCounts.stale;
  const sortedChapters = useMemo(
    () => [...chapters].sort((a, b) => a.order - b.order),
    [chapters],
  );

  return (
    <div className="flex flex-col h-full w-[320px]">
      {/* ── Header ── */}
      <div className="p-5 border-b border-[#1e2d1f]/5 flex justify-between items-center bg-white/40 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-blue-500" />
          <h2 className="font-serif font-bold text-lg text-[#1e2d1f]">Синхронизация</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-[#1e2d1f]/5 text-[#1e2d1f]/50 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">

        {/* ── Summary tiles ── */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#1e2d1f]/35 mb-2">
            Обзор проекта
          </p>
          <div className="grid grid-cols-2 gap-2">
            <SummaryTile
              count={statusCounts.fresh}
              label="Актуальных"
              colorClass="text-emerald-600"
              bgClass="bg-emerald-50 border-emerald-100"
            />
            <SummaryTile
              count={statusCounts.stale}
              label="Устаревших"
              colorClass="text-amber-600"
              bgClass="bg-amber-50 border-amber-100"
            />
            <SummaryTile
              count={statusCounts.unknown}
              label="Непроверенных"
              colorClass="text-[#1e2d1f]/50"
              bgClass="bg-[#1e2d1f]/4 border-[#1e2d1f]/8"
            />
            <SummaryTile
              count={pendingUpdatesCount}
              label="Обновлений"
              colorClass="text-purple-600"
              bgClass="bg-purple-50 border-purple-100"
              onClick={pendingUpdatesCount > 0 ? onOpenBibleUpdates : undefined}
            />
          </div>
        </div>

        {/* ── CTA: recheck all stale ── */}
        {staleCount > 0 && (
          <button
            onClick={onRecheckAllStale}
            disabled={isRecheckingAll}
            className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-amber-50 border border-amber-200/80 rounded-xl text-sm font-medium text-amber-800 hover:bg-amber-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-2">
              {isRecheckingAll
                ? <div className="w-4 h-4 border-2 border-amber-400 border-t-amber-700 rounded-full animate-spin" />
                : <RefreshCw size={15} />
              }
              <span>{isRecheckingAll ? 'Проверяю...' : `Проверить все устаревшие (${staleCount})`}</span>
            </div>
            {!isRecheckingAll && <ArrowRight size={14} className="flex-shrink-0 text-amber-500" />}
          </button>
        )}

        {/* ── CTA: pending Bible updates ── */}
        {pendingUpdatesCount > 0 && (
          <button
            onClick={onOpenBibleUpdates}
            className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-purple-50 border border-purple-100 rounded-xl text-sm font-medium text-purple-800 hover:bg-purple-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <GitCompare size={15} />
              <span>Обновления Библии истории ({pendingUpdatesCount})</span>
            </div>
            <ChevronRight size={14} className="flex-shrink-0 text-purple-400" />
          </button>
        )}

        {/* ── Chapter list ── */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#1e2d1f]/35 mb-2">
            Главы
          </p>
          <div className="space-y-1">
            {sortedChapters.map(chapter => {
              const freshness = getChapterFreshness(chapter);
              const meta      = FRESHNESS_META[freshness];
              const isCurrent = chapter.id === currentChapterId;
              return (
                <button
                  key={chapter.id}
                  onClick={() => onNavigateToChapter(chapter.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                    isCurrent
                      ? 'bg-[#1e2d1f]/8 ring-1 ring-[#1e2d1f]/10'
                      : 'hover:bg-[#1e2d1f]/5'
                  }`}
                >
                  {/* Freshness dot */}
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`}
                    title={meta.label}
                  />

                  {/* Title */}
                  <span className="flex-1 min-w-0 text-sm text-[#1e2d1f]/80 font-medium truncate">
                    {chapter.title}
                  </span>

                  {/* Status label */}
                  <span className={`text-[10px] font-medium flex-shrink-0 ${meta.textColor}`}>
                    {meta.label}
                  </span>

                  <ChevronRight size={12} className="flex-shrink-0 text-[#1e2d1f]/20" />
                </button>
              );
            })}

            {chapters.length === 0 && (
              <p className="text-sm text-[#1e2d1f]/40 text-center py-8">
                Нет глав
              </p>
            )}
          </div>
        </div>

        {/* ── Legend ── */}
        <div className="bg-white/60 border border-[#1e2d1f]/6 rounded-xl p-3 space-y-1.5">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#1e2d1f]/30 mb-2">Что означают статусы</p>
          <LegendRow dot="bg-emerald-400" label="Актуальна" desc="Библия синхронизирована с текстом" />
          <LegendRow dot="bg-amber-400"   label="Устарела"  desc="Текст изменился после последнего анализа" />
          <LegendRow dot="bg-[#1e2d1f]/20" label="Не проверена" desc="Глава ещё не анализировалась" />
        </div>
      </div>
    </div>
  );
}

// ── Helper sub-components ──────────────────────────────────────────────────────

function SummaryTile({
  count, label, colorClass, bgClass, onClick,
}: {
  count: number;
  label: string;
  colorClass: string;
  bgClass: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-colors ${bgClass} ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
    >
      <span className={`text-2xl font-bold ${colorClass}`}>{count}</span>
      <span className="text-[10px] text-[#1e2d1f]/50 font-medium mt-0.5 leading-tight">{label}</span>
    </Tag>
  );
}

function LegendRow({ dot, label, desc }: { dot: string; label: string; desc: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${dot}`} />
      <div>
        <span className="text-[11px] font-semibold text-[#1e2d1f]/70">{label}</span>
        <span className="text-[11px] text-[#1e2d1f]/40"> — {desc}</span>
      </div>
    </div>
  );
}
