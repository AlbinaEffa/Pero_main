import { useMemo, useState } from 'react';
import { MapPin, ChevronRight, ChevronDown } from 'lucide-react';
import { Entity, EntityLink } from './types';
import { MargCompass } from './Marginalia';

interface Props {
  entities: Entity[];
  links: EntityLink[];
  onJumpToChapter: (chapterId: string, entityName: string) => void;
}

const SAGE = '#4A5D4E';

// «X внутри Y» — source ребёнок target.
const CHILD_OF = /(^|\s)(в|во|внутри|часть|районе?|округ|квартал|на территории|находится|располож|столица|внутри)/i;
// «X содержит Y» — source родитель target.
const CONTAINS = /(содерж|включ|состоит из|внутри неё|внутри него)/i;

/**
 * Линза «Карта» (v1 — вложенность мест, не гео). Дерево регион→город→комната строится
 * из связей между локациями (`entity_links` с отношениями вроде «находится в», «часть»).
 * Честно: настоящую географию из прозы не извлечь, а вложенность — да. Клик по месту → в текст.
 */
export function MapLens({ entities, links, onJumpToChapter }: Props) {
  const locations = useMemo(() => entities.filter(e => e.type === 'location'), [entities]);

  const { roots, childrenOf, byId } = useMemo(() => {
    const byId = new Map(locations.map(l => [l.id, l]));
    const locSet = new Set(locations.map(l => l.id));
    const parent = new Map<string, string>(); // child → parent

    for (const l of links) {
      if (!locSet.has(l.sourceEntityId) || !locSet.has(l.targetEntityId)) continue;
      if (l.sourceEntityId === l.targetEntityId) continue;
      const r = (l.relation ?? '').toLowerCase();
      if (CONTAINS.test(r)) {
        if (!parent.has(l.targetEntityId)) parent.set(l.targetEntityId, l.sourceEntityId);
      } else if (CHILD_OF.test(r)) {
        if (!parent.has(l.sourceEntityId)) parent.set(l.sourceEntityId, l.targetEntityId);
      }
    }

    const childrenOf = new Map<string, string[]>();
    for (const [child, par] of parent) {
      if (!childrenOf.has(par)) childrenOf.set(par, []);
      childrenOf.get(par)!.push(child);
    }
    childrenOf.forEach(arr => arr.sort((a, b) => (byId.get(a)?.name ?? '').localeCompare(byId.get(b)?.name ?? '', 'ru')));

    const roots = locations
      .filter(l => !parent.has(l.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return { roots, childrenOf, byId };
  }, [locations, links]);

  if (locations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center px-6 py-12 text-[#1e2d1f]/45">
        <MargCompass size={56} className="mb-3 text-[#1e2d1f]/30" />
        <p className="text-sm leading-relaxed">Карта появится, когда Перо найдёт локации и их вложенность в тексте.</p>
      </div>
    );
  }

  // Сворачивание веток: клик по шеврону прячет/раскрывает детей (имя — переход в текст).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  // Отдельные места (без вложенности) прячем за «+N» — в дереве важна сама иерархия.
  const [showFlat, setShowFlat] = useState(false);
  // Вид: «Карта» (пространственные вложенные боксы — контейнеры из вложенности) ↔ «Дерево» (список).
  const [mapView, setMapView] = useState<'boxes' | 'tree'>('boxes');

  // Пространственный рендер: место = бокс-контейнер, дети вложены ВНУТРЬ (читается как карта).
  const renderBox = (id: string, visited: Set<string>, depth = 0) => {
    if (visited.has(id)) return null;
    visited.add(id);
    const loc = byId.get(id);
    if (!loc) return null;
    const kids = childrenOf.get(id) ?? [];
    return (
      <div key={id} className="rounded-xl border min-w-0 flex-shrink"
        style={{ borderColor: `${SAGE}33`, background: `${SAGE}${depth % 2 === 0 ? '12' : '0a'}` }}>
        <button
          onClick={() => { if (loc.chapterId) onJumpToChapter(loc.chapterId, loc.name); }}
          className="w-full flex items-center gap-1.5 text-left px-2.5 py-1.5 rounded-t-xl hover:bg-white/60 transition-colors"
          title={loc.chapterId ? `${loc.name} — клик: в текст` : loc.name}
        >
          <MapPin size={12} className="flex-shrink-0" style={{ color: SAGE }} />
          <span className="text-[12px] font-medium text-[#1e2d1f] truncate">{loc.name}</span>
          {kids.length > 0 && <span className="text-[10px] text-[#1e2d1f]/35 flex-shrink-0">{kids.length}</span>}
        </button>
        {kids.length > 0 && (
          <div className="flex flex-wrap items-start gap-1.5 p-1.5 pt-0">
            {kids.map(k => renderBox(k, visited, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderNode = (id: string, depth: number, visited: Set<string>) => {
    if (visited.has(id)) return null;
    visited.add(id);
    const loc = byId.get(id);
    if (!loc) return null;
    const kids = childrenOf.get(id) ?? [];
    const isCollapsed = collapsed.has(id);
    return (
      <div key={id} style={{ marginLeft: depth ? 14 : 0 }}>
        <div className="flex items-center gap-0.5">
          {kids.length > 0 ? (
            <button onClick={() => toggle(id)} className="p-0.5 rounded hover:bg-[#1e2d1f]/[0.06] flex-shrink-0"
              title={isCollapsed ? 'Раскрыть' : 'Свернуть'} aria-label={isCollapsed ? 'Раскрыть' : 'Свернуть'}>
              {isCollapsed ? <ChevronRight size={13} className="text-[#1e2d1f]/40" /> : <ChevronDown size={13} className="text-[#1e2d1f]/40" />}
            </button>
          ) : <span className="w-[18px] flex-shrink-0" />}
          <button
            onClick={() => { if (loc.chapterId) onJumpToChapter(loc.chapterId, loc.name); }}
            className="flex-1 min-w-0 flex items-center gap-1.5 text-left py-1.5 px-1.5 rounded-lg hover:bg-white/70 transition-colors group"
            title={loc.chapterId ? `${loc.name} — клик: в текст` : loc.name}
          >
            <MapPin size={13} className="flex-shrink-0" style={{ color: SAGE }} />
            <span className="text-[12.5px] text-[#1e2d1f] truncate">{loc.name}</span>
            {kids.length > 0 && <span className="text-[10px] text-[#1e2d1f]/35 flex-shrink-0">{kids.length}</span>}
            {loc.description && <span className="text-[10.5px] text-[#1e2d1f]/40 truncate hidden group-hover:inline">· {loc.description}</span>}
          </button>
        </div>
        {kids.length > 0 && !isCollapsed && (
          <div className="border-l border-[#1e2d1f]/8 ml-[12px] pl-1">
            {kids.map(k => renderNode(k, depth + 1, visited))}
          </div>
        )}
      </div>
    );
  };

  const visited = new Set<string>();
  const hasNesting = [...childrenOf.values()].some(a => a.length > 0);
  // Корни с вложенностью = настоящее дерево; одиночные места = плоский «хвост».
  const nestedRoots = roots.filter(r => (childrenOf.get(r.id)?.length ?? 0) > 0);
  const flatRoots = roots.filter(r => (childrenOf.get(r.id)?.length ?? 0) === 0);

  const boxVisited = new Set<string>();

  return (
    <div className="text-[12px]">
      <div className="flex items-start gap-2 mb-3">
        <p className="flex-1 text-[11px] text-[#1e2d1f]/45 leading-snug">
          Вложенность мест (регион → город → место). Клик — перейти в главу.
          {!hasNesting && ' Перо пока не нашло связей «место в месте» — показаны как список.'}
        </p>
        <div className="inline-flex rounded-md bg-[#1e2d1f]/[0.06] p-0.5 flex-shrink-0">
          {([['boxes', 'Карта'] as const, ['tree', 'Дерево'] as const]).map(([id, label]) => (
            <button key={id} onClick={() => setMapView(id)}
              className={`text-[10.5px] rounded px-2 py-0.5 transition-colors ${mapView === id ? 'bg-white text-[#1e2d1f] shadow-sm' : 'text-[#1e2d1f]/45 hover:text-[#1e2d1f]/70'}`}
            >{label}</button>
          ))}
        </div>
      </div>
      {mapView === 'boxes' ? (
        <div className="flex flex-wrap items-start gap-2">
          {(hasNesting ? nestedRoots : roots).map(r => renderBox(r.id, boxVisited))}
          {hasNesting && flatRoots.map(r => renderBox(r.id, boxVisited))}
        </div>
      ) : (
      <div className="rounded-xl bg-white/40 border border-[#1e2d1f]/5 p-2">
        {(hasNesting ? nestedRoots : roots).map(r => renderNode(r.id, 0, visited))}

        {hasNesting && flatRoots.length > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-[#1e2d1f]/5">
            <button
              onClick={() => setShowFlat(v => !v)}
              className="flex items-center gap-1 px-1.5 py-1 text-[11px] font-medium text-[#1e2d1f]/60 hover:text-[#1e2d1f] transition-colors"
            >
              {showFlat ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {showFlat ? 'свернуть' : `показать ещё ${flatRoots.length} отдельных мест`}
              <span className="text-[#1e2d1f]/35">· без вложенности</span>
            </button>
            {showFlat && flatRoots.map(r => renderNode(r.id, 0, visited))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
