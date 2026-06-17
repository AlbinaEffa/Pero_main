import { useMemo, useState } from 'react';
import { Clock, Swords, Heart, Activity, Lightbulb, Circle, X, Rewind, ChevronDown, ChevronRight } from 'lucide-react';
import { Entity, EntityEvent } from './types';

const SIGNIFICANCE_RANK: Record<string, number> = { major: 0, moderate: 1, minor: 2 };

interface ChapterSummary { id: string; title: string; order: number; }

interface Props {
  entities: Entity[];
  events: EntityEvent[];
  chapters: ChapterSummary[];
  /** Если задан — таймлайн фильтруется на одну сущность = арка героя. */
  focusEntityId: string | null;
  onSetFocus: (id: string | null) => void;
  onJumpToChapter: (chapterId: string, entityName: string) => void;
}

const TYPE_PIGMENT: Record<string, string> = {
  character: '#A14F44', location: '#4A5D4E', item: '#91682E', rule: '#54627F',
};

const EVENT_META: Record<string, { label: string; icon: typeof Circle; color: string }> = {
  conflict:     { label: 'Конфликт', icon: Swords,    color: '#A14F44' },
  relationship: { label: 'Отношения', icon: Heart,    color: '#71597F' },
  status:       { label: 'Перемена', icon: Activity,  color: '#91682E' },
  revelation:   { label: 'Открытие', icon: Lightbulb, color: '#4A5D4E' },
  other:        { label: 'Событие',  icon: Circle,    color: '#54627F' },
};

/**
 * Линза «Таймлайн/Арки» — события (`entity_events`) по оси глав. Один движок, два охвата:
 * без фильтра = весь таймлайн истории; фильтр на сущность = её арка. Ось — порядок глав;
 * если AI извлёк сюжетный маркер времени (флешбек / «за год до»), он подсвечивается. Клик
 * по событию → в главу.
 */
export function TimelineLens({ entities, events, chapters, focusEntityId, onSetFocus, onJumpToChapter }: Props) {
  const byId = useMemo(() => new Map(entities.map(e => [e.id, e])), [entities]);
  const chapterOrder = useMemo(() => new Map(chapters.map(c => [c.id, c.order])), [chapters]);
  const chapterTitle = useMemo(() => new Map(chapters.map(c => [c.id, c.title])), [chapters]);

  const [showAllArcs, setShowAllArcs] = useState(false);
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('all');

  // Сущности с событиями = доступные арки. Сортируем по значимости → числу событий,
  // чтобы важные герои были первыми чипами, а не тонули в алфавите эпизодических.
  const arcEntities = useMemo(() => {
    const cnt = new Map<string, number>();
    events.forEach(e => cnt.set(e.entityId, (cnt.get(e.entityId) ?? 0) + 1));
    const ids = new Set(events.map(e => e.entityId));
    return entities
      .filter(e => ids.has(e.id))
      .map(e => ({ e, n: cnt.get(e.id) ?? 0 }))
      .sort((a, b) =>
        (SIGNIFICANCE_RANK[a.e.significance ?? 'minor'] - SIGNIFICANCE_RANK[b.e.significance ?? 'minor'])
        || (b.n - a.n) || a.e.name.localeCompare(b.e.name, 'ru'));
  }, [entities, events]);
  const ARC_CAP = 12;
  const shownArcs = showAllArcs ? arcEntities : arcEntities.slice(0, ARC_CAP);

  // Фокус на арке → события героя; иначе вся история. Тип-фильтр сужает дальше.
  const base = useMemo(
    () => (focusEntityId ? events.filter(e => e.entityId === focusEntityId) : events),
    [events, focusEntityId],
  );
  const eventTypeCounts = useMemo(() => {
    const m: Record<string, number> = { all: base.length };
    base.forEach(e => { const k = e.eventType ?? 'other'; m[k] = (m[k] ?? 0) + 1; });
    return m;
  }, [base]);
  const scoped = useMemo(
    () => (eventTypeFilter === 'all' ? base : base.filter(e => (e.eventType ?? 'other') === eventTypeFilter)),
    [base, eventTypeFilter],
  );

  // Группировка по главам в порядке глав; внутри — по timeLabel-наличию (флешбеки помечены, не двигаем).
  const groups = useMemo(() => {
    const m = new Map<string, EntityEvent[]>();
    scoped.forEach(ev => {
      const key = ev.chapterId ?? '__none__';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(ev);
    });
    return [...m.entries()]
      .sort((a, b) => (chapterOrder.get(a[0]) ?? 9999) - (chapterOrder.get(b[0]) ?? 9999))
      .map(([chapterId, evs], i) => ({ chapterId, index: i + 1, events: evs }));
  }, [scoped, chapterOrder]);

  if (scoped.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center px-6 py-12 text-[#1e2d1f]/45">
        <Clock size={26} className="mb-3 text-[#1e2d1f]/25" />
        <p className="text-sm leading-relaxed">
          {focusEntityId ? 'У этой сущности пока нет событий.' : 'События появятся, когда Перо прочитает главы.'}
        </p>
      </div>
    );
  }

  return (
    <div className="text-[12px]">
      {/* Арки: вся история / герой. Показываем значимых, остальных — за «+N арок». */}
      <div className="flex flex-wrap gap-1.5 mb-2 items-center">
        <button
          onClick={() => onSetFocus(null)}
          className={`text-[11px] px-2.5 py-0.5 rounded-full transition-colors ${
            !focusEntityId ? 'bg-[#1e2d1f] text-[#f5f0e8]' : 'bg-white/60 text-[#1e2d1f]/60 hover:bg-white'
          }`}
        >
          Вся история
        </button>
        {/* Если выбранная арка — за пределами показанных, держим её чип видимым. */}
        {(focusEntityId && !shownArcs.some(a => a.e.id === focusEntityId)
          ? [...shownArcs, ...arcEntities.filter(a => a.e.id === focusEntityId)]
          : shownArcs
        ).map(({ e }) => (
          <button
            key={e.id}
            onClick={() => onSetFocus(focusEntityId === e.id ? null : e.id)}
            className={`flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full transition-colors ${
              focusEntityId === e.id ? 'bg-[#1e2d1f] text-[#f5f0e8]' : 'bg-white/60 text-[#1e2d1f]/70 hover:bg-white'
            }`}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: TYPE_PIGMENT[e.type] ?? '#54627F' }} />
            {e.name}
            {focusEntityId === e.id && <X size={11} />}
          </button>
        ))}
        {arcEntities.length > ARC_CAP && (
          <button
            onClick={() => setShowAllArcs(v => !v)}
            className="flex items-center gap-0.5 text-[11px] px-2 py-0.5 rounded-full text-[#1e2d1f]/50 hover:bg-[#1e2d1f]/[0.06] transition-colors"
          >
            {showAllArcs ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {showAllArcs ? 'свернуть' : `+${arcEntities.length - ARC_CAP} арок`}
          </button>
        )}
      </div>

      {/* Тип события — сужает длинную ленту (Конфликт / Отношения / …) */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {([['all', 'Все'], ...Object.keys(EVENT_META).map(k => [k, EVENT_META[k].label])] as [string, string][])
          .filter(([k]) => k === 'all' || (eventTypeCounts[k] ?? 0) > 0)
          .map(([key, label]) => {
            const active = eventTypeFilter === key;
            const color = key === 'all' ? '#1e2d1f' : EVENT_META[key].color;
            return (
              <button
                key={key}
                onClick={() => setEventTypeFilter(key)}
                className={`flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-md transition-colors ${
                  active ? 'text-[#f5f0e8]' : 'text-[#1e2d1f]/55 hover:bg-[#1e2d1f]/[0.06]'
                }`}
                style={active ? { background: color } : undefined}
              >
                {label}
                <span className={active ? 'text-[#f5f0e8]/60' : 'text-[#1e2d1f]/35'}>{eventTypeCounts[key] ?? 0}</span>
              </button>
            );
          })}
      </div>

      {focusEntityId && (
        <p className="text-[11px] text-[#1e2d1f]/45 mb-3">Арка: «{byId.get(focusEntityId)?.name}» — её события по ходу книги.</p>
      )}

      <div className="relative pl-4">
        {/* вертикальная ось */}
        <div className="absolute left-[5px] top-1 bottom-1 w-px bg-[#1e2d1f]/10" />
        {groups.map(group => (
          <div key={group.chapterId} className="mb-4">
            <div className="flex items-center gap-2 mb-2 -ml-4">
              <span className="w-[11px] h-[11px] rounded-full bg-[#1e2d1f]/15 border-2 border-[#f5f0e8] flex-shrink-0" />
              <span className="text-[11px] font-semibold text-[#1e2d1f]/70 truncate">
                {chapterTitle.get(group.chapterId ?? '') || `Глава ${group.index}`}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {group.events.map(ev => {
                const meta = EVENT_META[ev.eventType ?? 'other'] ?? EVENT_META.other;
                const Icon = meta.icon;
                const ent = byId.get(ev.entityId);
                const flashback = ev.timeHint === 'flashback' || ev.timeHint === 'past';
                return (
                  <button
                    key={ev.id}
                    onClick={() => { if (ev.chapterId) onJumpToChapter(ev.chapterId, ent?.name ?? ev.title); }}
                    className="text-left rounded-xl bg-white/60 hover:bg-white border border-transparent hover:border-[#1e2d1f]/10 transition-all p-2.5 flex gap-2.5"
                  >
                    <span className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: meta.color + '1a', color: meta.color }}>
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-[#1e2d1f] text-[12.5px]">{ev.title}</span>
                        {flashback && (
                          <span className="flex items-center gap-0.5 text-[9px] uppercase tracking-wide text-[#71597F] bg-[#71597F]/10 rounded px-1 py-0.5">
                            <Rewind size={9} /> {ev.timeLabel || 'флешбек'}
                          </span>
                        )}
                        {!flashback && ev.timeLabel && (
                          <span className="text-[9px] text-[#1e2d1f]/45 bg-[#1e2d1f]/[0.05] rounded px-1 py-0.5">{ev.timeLabel}</span>
                        )}
                      </span>
                      {!focusEntityId && ent && (
                        <span className="flex items-center gap-1 mt-0.5 text-[10.5px] text-[#1e2d1f]/55">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: TYPE_PIGMENT[ent.type] ?? '#54627F' }} />
                          {ent.name} · {meta.label}
                        </span>
                      )}
                      {ev.description && <span className="block mt-0.5 text-[11px] text-[#1e2d1f]/60 leading-snug">{ev.description}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
