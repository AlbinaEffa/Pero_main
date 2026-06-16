import { useMemo } from 'react';
import { Map as MapIcon, MapPin, ChevronRight } from 'lucide-react';
import { Entity, EntityLink } from './types';

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
        <MapIcon size={26} className="mb-3 text-[#1e2d1f]/25" />
        <p className="text-sm leading-relaxed">Карта появится, когда Перо найдёт локации и их вложенность в тексте.</p>
      </div>
    );
  }

  const renderNode = (id: string, depth: number, visited: Set<string>) => {
    if (visited.has(id)) return null;
    visited.add(id);
    const loc = byId.get(id);
    if (!loc) return null;
    const kids = childrenOf.get(id) ?? [];
    return (
      <div key={id} style={{ marginLeft: depth ? 14 : 0 }}>
        <button
          onClick={() => { if (loc.chapterId) onJumpToChapter(loc.chapterId, loc.name); }}
          className="w-full flex items-center gap-1.5 text-left py-1.5 px-2 rounded-lg hover:bg-white/70 transition-colors group"
          title={loc.chapterId ? `${loc.name} — клик: в текст` : loc.name}
        >
          {kids.length > 0
            ? <ChevronRight size={13} className="text-[#1e2d1f]/30 flex-shrink-0" />
            : <span className="w-[13px] flex-shrink-0" />}
          <MapPin size={13} className="flex-shrink-0" style={{ color: SAGE }} />
          <span className="text-[12.5px] text-[#1e2d1f] truncate">{loc.name}</span>
          {loc.description && <span className="text-[10.5px] text-[#1e2d1f]/40 truncate hidden group-hover:inline">· {loc.description}</span>}
        </button>
        {kids.length > 0 && (
          <div className="border-l border-[#1e2d1f]/8 ml-[6px] pl-1">
            {kids.map(k => renderNode(k, depth + 1, visited))}
          </div>
        )}
      </div>
    );
  };

  const visited = new Set<string>();
  const hasNesting = [...childrenOf.values()].some(a => a.length > 0);

  return (
    <div className="text-[12px]">
      <p className="text-[11px] text-[#1e2d1f]/45 mb-3 leading-snug">
        Вложенность мест (регион → город → место). Клик — перейти в главу.
        {!hasNesting && ' Перо пока не нашло связей «место в месте» — показаны как список.'}
      </p>
      <div className="rounded-xl bg-white/40 border border-[#1e2d1f]/5 p-2">
        {roots.map(r => renderNode(r.id, 0, visited))}
      </div>
    </div>
  );
}
