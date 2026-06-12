import { useState, useEffect } from 'react';
import { X, Flame, Target, BookOpen, TrendingUp, Edit3, Check } from 'lucide-react';
import type { WritingStats } from '../../hooks/useWritingStats';

interface Props extends WritingStats {
  /** Total word count across all chapters (fetched by Editor). */
  totalProjectWords: number;
  /** Current chapter word count from CharacterCount extension. */
  chapterWords: number;
  onClose: () => void;
}

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')} тыс`;
  return String(n);
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" className="rotate-[-90deg]">
      <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(30,45,31,0.07)" strokeWidth="5" />
      <circle
        cx="36" cy="36" r={r} fill="none"
        stroke={pct >= 100 ? '#16a34a' : '#4f7c56'}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
    </svg>
  );
}

export function WritingStatsPanel({
  todayWords,
  streak,
  wordGoal,
  setWordGoal,
  totalProjectWords,
  chapterWords,
  onClose,
}: Props) {
  const pct = wordGoal > 0 ? Math.round((totalProjectWords / wordGoal) * 100) : 0;

  // Inline goal editing
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState(String(wordGoal));

  // Sync draft when wordGoal changes from outside (e.g. initial load)
  useEffect(() => {
    if (!editingGoal) setGoalDraft(String(wordGoal));
  }, [wordGoal, editingGoal]);

  const commitGoal = () => {
    const n = parseInt(goalDraft.replace(/\s/g, ''), 10);
    if (!isNaN(n) && n > 0) setWordGoal(n);
    setEditingGoal(false);
  };

  const streakActive = streak > 0;

  return (
    <div className="flex flex-col h-full w-[320px]">
      {/* Header */}
      <div className="p-5 border-b border-[#1e2d1f]/5 flex justify-between items-center bg-white/40 flex-shrink-0">
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-emerald-600" />
          <h2 className="font-serif font-bold text-lg text-[#1e2d1f]">Статистика</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-[#1e2d1f]/5 text-[#1e2d1f]/50 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">

        {/* Today + Streak row */}
        <div className="grid grid-cols-2 gap-3">
          {/* Today's words */}
          <div className="bg-white rounded-2xl p-4 border border-[#1e2d1f]/8 shadow-sm flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[#1e2d1f]/40">Сегодня</span>
            <span className="text-3xl font-bold text-[#1e2d1f] leading-none">{todayWords.toLocaleString('ru-RU')}</span>
            <span className="text-[11px] text-[#1e2d1f]/40">слов</span>
          </div>

          {/* Streak */}
          <div className={`rounded-2xl p-4 border shadow-sm flex flex-col gap-1 ${
            streakActive
              ? 'bg-amber-50 border-amber-200/60'
              : 'bg-white border-[#1e2d1f]/8'
          }`}>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[#1e2d1f]/40">Стрик</span>
            <div className="flex items-baseline gap-1.5">
              <span className={`text-3xl font-bold leading-none ${streakActive ? 'text-amber-600' : 'text-[#1e2d1f]'}`}>
                {streak}
              </span>
              {streakActive && <Flame size={18} className="text-amber-500 mb-0.5" />}
            </div>
            <span className="text-[11px] text-[#1e2d1f]/40">{streak === 1 ? 'день' : streak >= 2 && streak <= 4 ? 'дня' : 'дней'}</span>
          </div>
        </div>

        {/* Current chapter */}
        <div className="bg-white rounded-2xl p-4 border border-[#1e2d1f]/8 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BookOpen size={16} className="text-[#1e2d1f]/40 flex-shrink-0" />
            <span className="text-sm text-[#1e2d1f]/70 font-medium">Текущая глава</span>
          </div>
          <span className="text-sm font-bold text-[#1e2d1f]">{chapterWords.toLocaleString('ru-RU')} сл.</span>
        </div>

        {/* Project total */}
        <div className="bg-white rounded-2xl p-4 border border-[#1e2d1f]/8 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <TrendingUp size={16} className="text-[#1e2d1f]/40 flex-shrink-0" />
            <span className="text-sm text-[#1e2d1f]/70 font-medium">Всего в проекте</span>
          </div>
          <span className="text-sm font-bold text-[#1e2d1f]">{totalProjectWords.toLocaleString('ru-RU')} сл.</span>
        </div>

        {/* Word goal card */}
        <div className="bg-white rounded-2xl p-4 border border-[#1e2d1f]/8 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Target size={16} className="text-emerald-600 flex-shrink-0" />
              <span className="text-sm font-semibold text-[#1e2d1f]">Цель проекта</span>
            </div>
            {!editingGoal && (
              <button
                onClick={() => setEditingGoal(true)}
                className="p-1 rounded-md hover:bg-[#f5f0e8] text-[#1e2d1f]/35 hover:text-[#1e2d1f]/60 transition-colors"
                title="Изменить цель"
              >
                <Edit3 size={13} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-4">
            {/* Ring */}
            <div className="relative flex-shrink-0">
              <ProgressRing pct={pct} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-[13px] font-bold ${pct >= 100 ? 'text-green-600' : 'text-[#1e2d1f]'}`}>
                  {pct}%
                </span>
              </div>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="text-[22px] font-bold text-[#1e2d1f] leading-none">
                {formatNumber(totalProjectWords)}
              </div>
              <div className="text-[11px] text-[#1e2d1f]/40 mt-0.5">
                из {' '}
                {editingGoal ? (
                  <span className="inline-flex items-center gap-1">
                    <input
                      autoFocus
                      type="number"
                      min={1}
                      value={goalDraft}
                      onChange={e => setGoalDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitGoal();
                        if (e.key === 'Escape') { setEditingGoal(false); setGoalDraft(String(wordGoal)); }
                      }}
                      onBlur={commitGoal}
                      className="w-20 border-b border-emerald-400 outline-none text-[11px] text-[#1e2d1f] bg-transparent font-semibold"
                    />
                    <button onClick={commitGoal} className="text-emerald-600 hover:text-emerald-700">
                      <Check size={11} />
                    </button>
                  </span>
                ) : (
                  <span
                    className="underline underline-offset-2 decoration-dotted cursor-pointer hover:text-[#1e2d1f]/60 transition-colors"
                    onClick={() => setEditingGoal(true)}
                  >
                    {formatNumber(wordGoal)} слов
                  </span>
                )}
              </div>

              {/* Linear progress bar */}
              <div className="mt-2 h-1.5 rounded-full bg-[#1e2d1f]/8 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${pct >= 100 ? 'bg-green-500' : 'bg-emerald-600'}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>

              {pct >= 100 && (
                <div className="mt-1.5 text-[10px] font-semibold text-green-600">
                  Цель достигнута!
                </div>
              )}
              {pct < 100 && wordGoal - totalProjectWords > 0 && (
                <div className="mt-1.5 text-[10px] text-[#1e2d1f]/35">
                  осталось {formatNumber(wordGoal - totalProjectWords)} слов
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Quick tip */}
        <div className="bg-[#f5f0e8]/60 rounded-xl px-3.5 py-2.5 border border-[#1e2d1f]/6">
          <p className="text-[10px] text-[#1e2d1f]/40 leading-relaxed">
            Стрик растёт, если вы пишете каждый день. Статистика хранится локально в браузере.
          </p>
        </div>
      </div>
    </div>
  );
}
