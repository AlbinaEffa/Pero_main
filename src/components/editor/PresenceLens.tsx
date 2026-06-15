import { useMemo } from 'react';
import { Telescope } from 'lucide-react';
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

/**
 * Линза «Присутствие» — срез «кто/что в какой главе». Строится сама из того, что Перо
 * уже зарегистрировало: первое появление (`entity.chapterId`), события арки и связи по
 * главам. Это НЕ плоский список: одна и та же рукопись показана новой осью «сущность ×
 * глава» — видно темп ввода героев, провисания и где сущность исчезает. Клик по клетке →
 * прыжок в главу. Нестыковки подсвечены прямо на виде.
 */
export function PresenceLens({ entities, events, links, chapters, contradictions, onJumpToChapter }: Props) {
  const sortedChapters = useMemo(
    () => [...chapters].sort((a, b) => a.order - b.order),
    [chapters],
  );

  // presence: entityId → Set<chapterId> (где Перо «видело» сущность)
  // firstChapter: entityId → chapterId первого появления (для маркера)
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

  // Показываем только сущности, у которых есть хоть одно зарегистрированное появление,
  // отсортированные по значимости → имени.
  const rows = useMemo(() => {
    return entities
      .filter(e => presence.get(e.id)?.size)
      .sort((a, b) =>
        (SIGNIFICANCE_RANK[a.significance ?? 'minor'] ?? 2) - (SIGNIFICANCE_RANK[b.significance ?? 'minor'] ?? 2)
        || a.name.localeCompare(b.name, 'ru'),
      );
  }, [entities, presence]);

  if (sortedChapters.length === 0 || rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center px-6 py-12 text-[#1e2d1f]/45">
        <Telescope size={26} className="mb-3 text-[#1e2d1f]/25" />
        <p className="text-sm leading-relaxed">
          Присутствие появится, когда Перо прочитает главы и в мире наберутся сущности.
        </p>
      </div>
    );
  }

  const chapterIndex = new Map(sortedChapters.map((c, i) => [c.id, i + 1]));

  return (
    <div className="text-[12px]">
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
          {rows.map(e => {
            const cells = presence.get(e.id)!;
            const pigment = TYPE_PIGMENT[e.type] ?? '#54627F';
            const hasConflict = contradictions.has(e.id);
            return (
              <div key={e.id} className="flex items-center h-[22px] group">
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
                </div>
                {sortedChapters.map(c => {
                  const present = cells.has(c.id);
                  const isFirst = firstChapter.get(e.id) === c.id;
                  if (!present) {
                    return <div key={c.id} className="w-[18px] flex-shrink-0 flex justify-center"><span className="w-1 h-1 rounded-full bg-[#1e2d1f]/[0.07]" /></div>;
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
      </div>
    </div>
  );
}
