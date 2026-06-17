import { useMemo, useState } from 'react';
import { Telescope, AlertTriangle, MoonStar } from 'lucide-react';
import { Entity, EntityLink, EntityEvent } from './types';

interface ChapterSummary {
  id: string;
  title: string;
  order: number;
}

interface Props {
  entities: Entity[];
  events: EntityEvent[];
  links: EntityLink[];
  chapters: ChapterSummary[];
  /** Entity ids flagged as having a possible contradiction. */
  contradictions: Set<string>;
  /** Jump the editor to a chapter where this entity appears. */
  onJumpToChapter: (chapterId: string, entityName: string) => void;
}

/** Пигмент по типу сущности (DESIGN.md). */
const TYPE_PIGMENT: Record<string, string> = {
  character: '#A14F44',
  location:  '#4A5D4E',
  item:      '#91682E',
  rule:      '#54627F',
};

const SIGNIFICANCE_RANK: Record<string, number> = { major: 0, moderate: 1, minor: 2 };

const TYPE_CHIPS: { key: string; label: string }[] = [
  { key: 'all',       label: 'Все' },
  { key: 'character', label: 'Персонажи' },
  { key: 'location',  label: 'Локации' },
  { key: 'item',      label: 'Предметы' },
  { key: 'rule',      label: 'Правила' },
];

interface RowMetrics {
  e: Entity;
  cells: Set<string>;
  firstIdx: number;
  lastIdx: number;
  maxGap: number;
  gapFromIdx: number;   // первая пропущенная глава самого длинного провисания
  gapToIdx: number;     // последняя пропущенная глава того же провисания
  disappearsEarly: boolean;
}

/**
 * Линза «Присутствие» — флагман «Мира». Срез «кто/что в какой главе», построенный сам из
 * того, что Перо зарегистрировало (первое появление, события арки, связи по главам). Это
 * НЕ плоский список: рукопись показана осью «сущность × глава», и линза САМА говорит, что
 * увидела — кто надолго пропадает, кого ввели и забыли. Клик по клетке/находке → прыжок в
 * главу. Нестыковки подсвечены прямо на виде.
 */
export function PresenceLens({ entities, events, links, chapters, contradictions, onJumpToChapter }: Props) {
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const sortedChapters = useMemo(
    () => [...chapters].sort((a, b) => a.order - b.order),
    [chapters],
  );

  // presence: entityId → Set<chapterId>; firstChapter: entityId → chapterId первого появления.
  const { presence, firstChapter } = useMemo(() => {
    const presence = new Map<string, Set<string>>();
    const firstChapter = new Map<string, string>();
    const add = (eid?: string | null, cid?: string | null) => {
      if (!eid || !cid) return;
      if (!presence.has(eid)) presence.set(eid, new Set());
      presence.get(eid)!.add(cid);
    };
    entities.forEach(e => {
      add(e.id, e.chapterId);
      if (e.chapterId) firstChapter.set(e.id, e.chapterId);
    });
    events.forEach(ev => add(ev.entityId, ev.chapterId));
    links.forEach(l => { add(l.sourceEntityId, l.chapterId); add(l.targetEntityId, l.chapterId); });
    return { presence, firstChapter };
  }, [entities, events, links]);

  // Метрики присутствия по каждой сущности: провисания и «исчезновение».
  const allRows = useMemo<RowMetrics[]>(() => {
    const total = sortedChapters.length;
    return entities
      .filter(e => presence.get(e.id)?.size)
      .map(e => {
        const cells = presence.get(e.id)!;
        const presentIdx = sortedChapters.map((c, i) => (cells.has(c.id) ? i : -1)).filter(i => i >= 0);
        const firstIdx = presentIdx[0];
        const lastIdx = presentIdx[presentIdx.length - 1];
        let maxGap = 0, cur = 0, gapStart = -1, gapFromIdx = -1, gapToIdx = -1;
        for (let i = firstIdx; i <= lastIdx; i++) {
          if (cells.has(sortedChapters[i].id)) {
            if (cur > maxGap) { maxGap = cur; gapFromIdx = gapStart; gapToIdx = i - 1; }
            cur = 0;
          } else {
            if (cur === 0) gapStart = i;
            cur++;
          }
        }
        // Исчезает рано: последнее появление за 3+ глав до конца книги (≥5 глав).
        const disappearsEarly = total >= 5 && lastIdx <= total - 1 - 3;
        return { e, cells, firstIdx, lastIdx, maxGap, gapFromIdx, gapToIdx, disappearsEarly };
      })
      .sort((a, b) =>
        (SIGNIFICANCE_RANK[a.e.significance ?? 'minor'] ?? 2) - (SIGNIFICANCE_RANK[b.e.significance ?? 'minor'] ?? 2)
        || a.e.name.localeCompare(b.e.name, 'ru'),
      );
  }, [entities, presence, sortedChapters]);

  const typeCounts = useMemo(() => {
    const m: Record<string, number> = { all: allRows.length };
    allRows.forEach(r => { m[r.e.type] = (m[r.e.type] ?? 0) + 1; });
    return m;
  }, [allRows]);

  const rows = useMemo(
    () => (typeFilter === 'all' ? allRows : allRows.filter(r => r.e.type === typeFilter)),
    [allRows, typeFilter],
  );

  const chapterIndex = useMemo(
    () => new Map(sortedChapters.map((c, i) => [c.id, i + 1])),
    [sortedChapters],
  );

  // Находки линзы: что Перо увидело в ритме присутствия (по текущему фильтру).
  const insights = useMemo(() => {
    const disappear = rows
      .filter(r => r.disappearsEarly)
      .map(r => ({ r, kind: 'disappear' as const }));
    const gaps = rows
      .filter(r => r.maxGap >= 3 && !r.disappearsEarly)
      .map(r => ({ r, kind: 'gap' as const }));
    return { disappear, gaps };
  }, [rows]);

  if (sortedChapters.length === 0 || allRows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center px-6 py-12 text-[#1e2d1f]/45">
        <Telescope size={26} className="mb-3 text-[#1e2d1f]/25" />
        <p className="text-sm leading-relaxed">
          Присутствие появится, когда Перо прочитает главы и в мире наберутся сущности.
        </p>
      </div>
    );
  }

  const chapterLabel = (idx: number) => sortedChapters[idx]?.title || `гл. ${idx + 1}`;

  return (
    <div className="text-[12px]">
      {/* Фильтр по типу — фокус на персонажах/локациях/… */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {TYPE_CHIPS.map(chip => {
          const count = typeCounts[chip.key] ?? 0;
          if (chip.key !== 'all' && count === 0) return null;
          const active = typeFilter === chip.key;
          const pigment = TYPE_PIGMENT[chip.key];
          return (
            <button
              key={chip.key}
              onClick={() => setTypeFilter(chip.key)}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                active ? 'bg-[#1e2d1f] text-[#f5f0e8]' : 'bg-[#1e2d1f]/5 text-[#1e2d1f]/65 hover:bg-[#1e2d1f]/10'
              }`}
            >
              {pigment && <span className="w-2 h-2 rounded-[2px]" style={{ background: pigment }} />}
              {chip.label}
              <span className={active ? 'text-[#f5f0e8]/55' : 'text-[#1e2d1f]/40'}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Находки линзы — линза сама говорит, что увидела в ритме присутствия */}
      {(insights.disappear.length > 0 || insights.gaps.length > 0) && (
        <div className="flex flex-col gap-2 mb-4">
          {insights.disappear.length > 0 && (
            <div className="rounded-xl bg-[#A14F44]/[0.07] p-2.5">
              <div className="flex items-center gap-1.5 mb-1.5 text-[#A14F44] font-semibold text-[10.5px] uppercase tracking-wider">
                <MoonStar size={12} /> Исчезают и не возвращаются
              </div>
              <div className="flex flex-wrap gap-1.5">
                {insights.disappear.map(({ r }) => (
                  <button
                    key={r.e.id}
                    onClick={() => onJumpToChapter(sortedChapters[r.lastIdx].id, r.e.name)}
                    title={`Последнее появление: ${chapterLabel(r.lastIdx)} — перейти`}
                    className="flex items-center gap-1 rounded-lg bg-white/70 hover:bg-white px-2 py-1 text-[11px] text-[#1e2d1f] transition-colors"
                  >
                    <span className="font-medium">{r.e.name}</span>
                    <span className="text-[#1e2d1f]/45">после гл. {r.lastIdx + 1}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {insights.gaps.length > 0 && (
            <div className="rounded-xl bg-[#1e2d1f]/[0.04] p-2.5">
              <div className="flex items-center gap-1.5 mb-1.5 text-[#1e2d1f]/60 font-semibold text-[10.5px] uppercase tracking-wider">
                <AlertTriangle size={12} /> Пропадают надолго
              </div>
              <div className="flex flex-wrap gap-1.5">
                {insights.gaps.map(({ r }) => (
                  <button
                    key={r.e.id}
                    onClick={() => onJumpToChapter(sortedChapters[Math.max(0, r.gapFromIdx - 1)].id, r.e.name)}
                    title={`Пропадает ${chapterLabel(r.gapFromIdx)}–${chapterLabel(r.gapToIdx)} — перейти к последней сцене до пропажи`}
                    className="flex items-center gap-1 rounded-lg bg-white/70 hover:bg-white px-2 py-1 text-[11px] text-[#1e2d1f] transition-colors"
                  >
                    <span className="font-medium">{r.e.name}</span>
                    <span className="text-[#1e2d1f]/45">гл. {r.gapFromIdx + 1}–{r.gapToIdx + 1}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-[#1e2d1f]/45 mb-3 leading-snug">
        Кто и что в какой главе. Клик по клетке — перейти в главу.
      </p>

      <div className="overflow-x-auto hide-scrollbar">
        <div className="inline-block min-w-full">
          {/* Шапка: номера глав */}
          <div className="flex items-end mb-1.5 sticky top-0">
            <div className="w-[96px] flex-shrink-0" />
            {sortedChapters.map(c => (
              <div
                key={c.id}
                title={c.title || `Глава ${chapterIndex.get(c.id)}`}
                className="w-[18px] flex-shrink-0 text-center text-[9px] font-mono text-[#1e2d1f]/40"
              >
                {chapterIndex.get(c.id)}
              </div>
            ))}
          </div>

          {/* Строки сущностей */}
          {rows.map(({ e, cells, firstIdx, lastIdx, maxGap }) => {
            const pigment = TYPE_PIGMENT[e.type] ?? '#54627F';
            const hasConflict = contradictions.has(e.id);
            const hasLongGap = maxGap >= 3;
            return (
              <div key={e.id} className="flex items-center h-[22px] group rounded-md hover:bg-[#1e2d1f]/[0.03]">
                <div
                  className="w-[96px] flex-shrink-0 pr-2 truncate flex items-center gap-1"
                  title={e.name}
                >
                  {hasConflict && (
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: '#A14F44' }}
                      title="Возможная нестыковка"
                    />
                  )}
                  <span className={`truncate ${hasConflict ? 'text-[#A14F44] font-medium' : 'text-[#1e2d1f]/80'}`}>
                    {e.name}
                  </span>
                  {hasLongGap && (
                    <span className="flex-shrink-0 text-[9px] text-[#A14F44]/70 font-mono" title={`Пропадает на ${maxGap} глав подряд`}>⋯{maxGap}</span>
                  )}
                </div>
                {sortedChapters.map((c, i) => {
                  const present = cells.has(c.id);
                  const isFirst = firstChapter.get(e.id) === c.id;
                  if (!present) {
                    const inGap = i > firstIdx && i < lastIdx;
                    return (
                      <div key={c.id} className="w-[18px] flex-shrink-0 flex justify-center">
                        {inGap
                          ? <span className="w-3 h-[2px] rounded-full" style={{ background: hasLongGap ? 'rgba(161,79,68,0.35)' : 'rgba(30,45,31,0.10)' }} title={hasLongGap ? `Провисание: ${maxGap} глав` : undefined} />
                          : <span className="w-1 h-1 rounded-full bg-[#1e2d1f]/[0.07]" />}
                      </div>
                    );
                  }
                  return (
                    <div key={c.id} className="w-[18px] flex-shrink-0 flex justify-center">
                      <button
                        onClick={() => onJumpToChapter(c.id, e.name)}
                        title={`${e.name} — ${c.title || 'глава ' + chapterIndex.get(c.id)}${isFirst ? ' · впервые' : ''}`}
                        aria-label={`${e.name} в главе ${chapterIndex.get(c.id)}`}
                        className="w-[13px] h-[13px] rounded-[3px] transition-transform hover:scale-125"
                        style={{
                          background: pigment,
                          boxShadow: isFirst ? `0 0 0 1.5px #f5f0e8, 0 0 0 2.5px ${pigment}` : 'none',
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Легенда */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-4 pt-3 border-t border-[#1e2d1f]/5 text-[10px] text-[#1e2d1f]/50">
        {[['character', 'Персонажи'], ['location', 'Локации'], ['item', 'Предметы'], ['rule', 'Правила']].map(([t, label]) => (
          <span key={t} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-[2px]" style={{ background: TYPE_PIGMENT[t] }} />
            {label}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-[2px] bg-[#A14F44] ring-1 ring-offset-1 ring-[#A14F44]" />
          впервые
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-[2px] rounded-full" style={{ background: 'rgba(161,79,68,0.35)' }} />
          провисание (пропал на 3+ главы)
        </span>
      </div>
    </div>
  );
}
