import { useState, useEffect, useMemo } from 'react';
import { Users, MapPin, Box, Globe, AlertTriangle, RefreshCw, ArrowRight } from 'lucide-react';
import { PeroMark } from '../Logo';
import { Entity } from '../editor/types';
import { WorldBuildState } from './useWorldBuild';

/** Пигменты «Мира» (DESIGN.md) — те же, что в линзах и спутнике. */
const TALLY: { type: string; label: string; icon: typeof Users; pigment: string }[] = [
  { type: 'character', label: 'персонажи', icon: Users,  pigment: '#A14F44' },
  { type: 'location',  label: 'локации',   icon: MapPin, pigment: '#4A5D4E' },
  { type: 'item',      label: 'предметы',  icon: Box,    pigment: '#91682E' },
  { type: 'rule',      label: 'правила',   icon: Globe,  pigment: '#54627F' },
];

/**
 * ReadingStep — «Перо читает вашу книгу».
 * Живая лента: прогресс по главам + цитаты из рукописи + карточки находок,
 * появляющиеся по мере чтения.
 */

const TYPE_META: Record<string, { icon: typeof Users; label: string; cls: string }> = {
  character: { icon: Users,  label: 'персонаж', cls: 'bg-[#F1DFDA] text-[#9E4338]' },
  location:  { icon: MapPin, label: 'локация',  cls: 'bg-[#E7EAE3] text-[#4A5D4E]' },
  item:      { icon: Box,    label: 'предмет',  cls: 'bg-[#F2E9D8] text-[#91682E]' },
  rule:      { icon: Globe,  label: 'правило',  cls: 'bg-[#E6E8EC] text-[#54627F]' },
};

interface Props {
  world: WorldBuildState;
  quotes: string[];
  onComplete: () => void;
}

export function ReadingStep({ world, quotes, onComplete }: Props) {
  const { counts, currentChapterTitle, isDone, isPartial, entities, retryFailed } = world;
  const [quoteIdx, setQuoteIdx] = useState(0);
  const [retrying, setRetrying] = useState(false);

  // Ротация цитат каждые 5 секунд
  useEffect(() => {
    if (quotes.length < 2) return;
    const id = setInterval(() => setQuoteIdx(i => (i + 1) % quotes.length), 5000);
    return () => clearInterval(id);
  }, [quotes.length]);

  // Чтение закончилось без потерь — короткая пауза и вперёд, к Карте мира
  useEffect(() => {
    if (isDone && !isPartial) {
      const t = setTimeout(onComplete, 1800);
      return () => clearTimeout(t);
    }
  }, [isDone, isPartial, onComplete]);

  const doneChapters = counts ? counts.succeeded + counts.failed : 0;
  const total = counts?.total ?? 0;
  const progress = total > 0 ? Math.round((doneChapters / total) * 100) : 0;
  const recent = entities.slice(-6).reverse();

  // Живой счёт мира по типам — главный «вау»: мир набирается на глазах.
  const byType = useMemo(() => {
    const m: Record<string, number> = { character: 0, location: 0, item: 0, rule: 0 };
    entities.forEach(e => { if (e.type in m) m[e.type] += 1; });
    return m;
  }, [entities]);

  return (
    <div className="flex flex-col items-center text-center px-6 pt-16 pb-10 min-h-screen">
      {/* Перо «пишет» */}
      <div className="relative mb-6">
        <div className="w-16 h-16 rounded-full bg-white shadow-sm flex items-center justify-center">
          <PeroMark size={30} className="text-[#4A5D4E] animate-[quill_1.6s_ease-in-out_infinite]" />
        </div>
        <style>{`@keyframes quill { 0%,100% { transform: rotate(-6deg) translateY(0); } 50% { transform: rotate(4deg) translateY(-3px); } }`}</style>
      </div>

      <h1 className="font-serif text-3xl md:text-4xl font-semibold text-[#1e2d1f] mb-2">
        {isDone ? (isPartial ? 'Прочитано — почти всё' : 'Книга прочитана') : 'Перо читает вашу книгу'}
      </h1>
      <p className="text-sm text-[#1e2d1f]/55 mb-6 h-5">
        {!isDone && total > 0 && (
          <>Глава {Math.min(doneChapters + 1, total)} из {total}
            {currentChapterTitle ? <> · <span className="italic">«{currentChapterTitle}»</span></> : null}
          </>
        )}
        {isDone && !isPartial && 'Собираю карту вашего мира…'}
      </p>

      {/* Прогресс */}
      {total > 0 && (
        <div className="w-full max-w-md h-1.5 bg-[#1e2d1f]/8 rounded-full overflow-hidden mb-10">
          <div
            className="h-full bg-[#4A5D4E] rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* PARTIAL: честная плашка вместо имитации успеха */}
      {isPartial && counts && (
        <div className="w-full max-w-md bg-[#F2E9D8] border border-[#91682E] rounded-2xl p-4 mb-8 text-left">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-[#91682E] flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#91682E]">
                Прочитано {counts.succeeded} из {counts.total} глав
              </p>
              <p className="text-xs text-[#91682E] mt-0.5">
                {counts.failed} {counts.failed === 1 ? 'глава не прочиталась' : 'глав не прочитались'} — можно повторить сейчас или позже из панели обработки.
              </p>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={async () => { setRetrying(true); try { await retryFailed(); } finally { setRetrying(false); } }}
              disabled={retrying}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-[#F2E9D8] hover:bg-[#F2E9D8] text-[#91682E] text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={retrying ? 'animate-spin' : ''} />
              Повторить
            </button>
            <button
              onClick={onComplete}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-[#1e2d1f] text-[#f5f0e8] text-xs font-semibold hover:bg-[#2a3f2b] transition-colors"
            >
              К карте мира
              <ArrowRight size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Цитата из рукописи автора — вместо скучного спиннера */}
      {!isDone && quotes.length > 0 && (
        <blockquote
          key={quoteIdx}
          className="max-w-lg font-serif italic text-lg text-[#1e2d1f]/65 leading-relaxed mb-10 animate-[fadeIn_0.8s_ease]"
        >
          «{quotes[quoteIdx]}»
          <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }`}</style>
        </blockquote>
      )}

      {/* Живой счёт мира — мир набирается на глазах */}
      {entities.length > 0 && (
        <div className="w-full max-w-md grid grid-cols-4 gap-2 mb-6">
          {TALLY.map(({ type, label, icon: Icon, pigment }) => {
            const n = byType[type] ?? 0;
            return (
              <div
                key={type}
                className="flex flex-col items-center rounded-2xl bg-white border border-[#1e2d1f]/5 shadow-sm py-3"
                style={{ opacity: n === 0 ? 0.45 : 1 }}
              >
                <Icon size={15} style={{ color: pigment }} className="mb-1" />
                <span
                  key={n}
                  className="font-serif text-2xl font-semibold leading-none animate-[tallyPop_0.4s_ease]"
                  style={{ color: pigment }}
                >
                  {n}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-[#1e2d1f]/45 mt-1">{label}</span>
              </div>
            );
          })}
          <style>{`@keyframes tallyPop { 0% { transform: scale(1.5); opacity: 0; } 60% { transform: scale(0.92); } 100% { transform: scale(1); opacity: 1; } }`}</style>
        </div>
      )}

      {/* Лента находок */}
      <div className="w-full max-w-md space-y-2 text-left">
        {entities.length > 0 && (
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#1e2d1f]/55 ml-1 mb-2">
            Найдено в тексте · {entities.length}
          </p>
        )}
        {recent.map(e => <FindingCard key={e.id} entity={e} isFresh={world.freshIds.includes(e.id)} />)}
        {!isDone && entities.length === 0 && doneChapters >= 2 && (
          <p className="text-xs text-[#1e2d1f]/55 text-center">
            Пока тихо — так бывает на прологах. Перо продолжает читать.
          </p>
        )}
        {isDone && entities.length === 0 && (
          <div className="text-center py-6">
            <p className="text-sm text-[#1e2d1f]/60 mb-1">Мир пока пуст</p>
            <p className="text-xs text-[#1e2d1f]/55">
              В тексте не нашлось именованных персонажей или мест. Перо будет искать их по мере того, как вы пишете.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function FindingCard({ entity, isFresh }: { entity: Entity; isFresh: boolean }) {
  const meta = TYPE_META[entity.type] ?? TYPE_META.character;
  const Icon = meta.icon;
  return (
    <div
      className={`flex items-center gap-3 bg-white rounded-xl px-4 py-2.5 border border-[#1e2d1f]/5 shadow-sm ${
        isFresh ? 'animate-[slideIn_0.5s_ease]' : ''
      }`}
    >
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${meta.cls}`}>
        <Icon size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-[#1e2d1f] truncate">{entity.name}</p>
        <p className="text-[10px] uppercase tracking-wider text-[#1e2d1f]/55 font-bold">{meta.label}</p>
      </div>
      <style>{`@keyframes slideIn { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
}
