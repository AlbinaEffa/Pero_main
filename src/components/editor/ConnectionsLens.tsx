import { useMemo, useState } from 'react';
import { Share2 } from 'lucide-react';
import { Entity, EntityLink } from './types';

interface Props {
  entities: Entity[];
  links: EntityLink[];
  contradictions: Set<string>;
  /** Развёрнутый инспектор → полный граф; свёрнутый → эго-вид самой связной сущности. */
  expanded: boolean;
  onJumpToChapter: (chapterId: string, entityName: string) => void;
}

const TYPE_PIGMENT: Record<string, string> = {
  character: '#A14F44', location: '#4A5D4E', item: '#91682E', rule: '#54627F',
};
const SIG_RADIUS: Record<string, number> = { major: 25, moderate: 19, minor: 14 };

/**
 * Линза «Связи» — граф сущностей, построенный сам из `entity_links`. Не плоский список:
 * видно, кто с кем и как связан. Узлы по пигментам типа, размер по значимости, рёбра
 * подписаны отношением + главой. Клик по узлу → в текст. Свёрнуто показываем эго-граф
 * самого связного героя (полный граф душить в узкой панели бессмысленно), развёрнуто —
 * весь проект концентрическими кольцами по значимости.
 */
export function ConnectionsLens({ entities, links, contradictions, expanded, onJumpToChapter }: Props) {
  const [showMinor, setShowMinor] = useState(false);

  const byId = useMemo(() => new Map(entities.map(e => [e.id, e])), [entities]);

  const nodes0 = useMemo(
    () => entities.filter(e => showMinor || (e.significance ?? 'minor') !== 'minor'),
    [entities, showMinor],
  );
  const nodeIdSet = useMemo(() => new Set(nodes0.map(n => n.id)), [nodes0]);

  const edges = useMemo(
    () => links.filter(l =>
      l.sourceEntityId !== l.targetEntityId
      && nodeIdSet.has(l.sourceEntityId) && nodeIdSet.has(l.targetEntityId)),
    [links, nodeIdSet],
  );

  const degree = useMemo(() => {
    const d = new Map<string, number>();
    edges.forEach(e => {
      d.set(e.sourceEntityId, (d.get(e.sourceEntityId) ?? 0) + 1);
      d.set(e.targetEntityId, (d.get(e.targetEntityId) ?? 0) + 1);
    });
    return d;
  }, [edges]);

  // Эго-фокус для свёрнутого вида = самая связная сущность.
  const focusId = useMemo(() => {
    if (expanded || nodes0.length === 0) return null;
    return [...nodes0].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))[0]?.id ?? null;
  }, [expanded, nodes0, degree]);

  const shownNodes = useMemo(() => {
    if (expanded || !focusId) return nodes0;
    const keep = new Set([focusId]);
    edges.forEach(e => {
      if (e.sourceEntityId === focusId) keep.add(e.targetEntityId);
      if (e.targetEntityId === focusId) keep.add(e.sourceEntityId);
    });
    return nodes0.filter(n => keep.has(n.id));
  }, [expanded, focusId, nodes0, edges]);

  const shownIdSet = useMemo(() => new Set(shownNodes.map(n => n.id)), [shownNodes]);
  const shownEdges = useMemo(
    () => edges.filter(e => shownIdSet.has(e.sourceEntityId) && shownIdSet.has(e.targetEntityId)),
    [edges, shownIdSet],
  );

  // viewBox под режим: развёрнуто шире (полный граф), свёрнуто компактнее (эго).
  const W = expanded ? 680 : 360;
  const H = expanded ? 460 : 320;

  const pos = useMemo(() => {
    const p = new Map<string, { x: number; y: number }>();
    const cx = W / 2, cy = H / 2;
    const minDim = Math.min(W, H);
    if (!expanded && focusId) {
      p.set(focusId, { x: cx, y: cy });
      const others = shownNodes.filter(n => n.id !== focusId);
      const R = minDim / 2 - 56;
      others.forEach((n, i) => {
        const a = (i / Math.max(1, others.length)) * 2 * Math.PI - Math.PI / 2;
        p.set(n.id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
      });
    } else {
      const ringR: Record<string, number> = {
        major: minDim * 0.14, moderate: minDim * 0.28, minor: minDim * 0.40,
      };
      (['major', 'moderate', 'minor'] as const).forEach(tier => {
        const ns = shownNodes.filter(n => (n.significance ?? 'minor') === tier);
        ns.forEach((n, i) => {
          const a = (i / Math.max(1, ns.length)) * 2 * Math.PI - Math.PI / 2 + (tier === 'moderate' ? 0.4 : 0);
          const R = ringR[tier];
          p.set(n.id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
        });
      });
    }
    return p;
  }, [shownNodes, expanded, focusId, H]);

  if (nodes0.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center px-6 py-12 text-[#1e2d1f]/45">
        <Share2 size={26} className="mb-3 text-[#1e2d1f]/25" />
        <p className="text-sm leading-relaxed">Связи появятся, когда Перо прочитает главы и найдёт отношения между сущностями.</p>
      </div>
    );
  }

  const unlinked = nodes0.filter(n => !(degree.get(n.id) ?? 0));

  return (
    <div className="text-[12px]">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] text-[#1e2d1f]/45 leading-snug">
          {expanded ? 'Граф связей. Клик по узлу — в текст.' : `Связи «${byId.get(focusId ?? '')?.name ?? ''}». Разверни панель для полного графа.`}
        </p>
        <button
          onClick={() => setShowMinor(v => !v)}
          className={`flex-shrink-0 text-[10.5px] px-2 py-0.5 rounded-md transition-colors ${
            showMinor ? 'bg-[#1e2d1f] text-[#f5f0e8]' : 'text-[#1e2d1f]/50 hover:bg-[#1e2d1f]/[0.06]'
          }`}
          title="Показывать эпизодические сущности"
        >
          + эпизодические
        </button>
      </div>

      <div className="rounded-xl bg-white/40 border border-[#1e2d1f]/5 overflow-hidden">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full"
          style={{ display: 'block', height: expanded ? 'min(62vh, 540px)' : 300 }}
        >
          {shownEdges.map(e => {
            const a = pos.get(e.sourceEntityId), b = pos.get(e.targetEntityId);
            if (!a || !b) return null;
            // Подпись ближе к источнику (не в центре) — так подписи разных рёбер из одного
            // узла расходятся и меньше наезжают.
            const lx = a.x + (b.x - a.x) * 0.42, ly = a.y + (b.y - a.y) * 0.42;
            return (
              <g key={e.id}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#1e2d1f" strokeOpacity={0.16} strokeWidth={1.5}>
                  <title>{e.relation}</title>
                </line>
                {expanded && (
                  <text x={lx} y={ly} textAnchor="middle" fontSize={8.5} fill="#1e2d1f" fillOpacity={0.55}
                        fontFamily="JetBrains Mono, monospace"
                        stroke="#f5f0e8" strokeWidth={3} paintOrder="stroke"
                        style={{ pointerEvents: 'none' }}>
                    {e.relation.length > 18 ? e.relation.slice(0, 17) + '…' : e.relation}
                  </text>
                )}
              </g>
            );
          })}
          {shownNodes.map(n => {
            const p = pos.get(n.id);
            if (!p) return null;
            const r = SIG_RADIUS[n.significance ?? 'minor'] ?? 14;
            const pigment = TYPE_PIGMENT[n.type] ?? '#54627F';
            const conflict = contradictions.has(n.id);
            const isFocus = n.id === focusId;
            return (
              <g key={n.id} style={{ cursor: n.chapterId ? 'pointer' : 'default' }}
                 onClick={() => { if (n.chapterId) onJumpToChapter(n.chapterId, n.name); }}>
                {conflict && <circle cx={p.x} cy={p.y} r={r + 3} fill="none" stroke="#A14F44" strokeWidth={2} />}
                <circle cx={p.x} cy={p.y} r={r} fill={pigment} stroke="#f5f0e8" strokeWidth={isFocus ? 3 : 1.5} />
                <text x={p.x} y={p.y + r + 11} textAnchor="middle" fontSize={10.5} fill="#1e2d1f" fontFamily="Golos Text, system-ui"
                      stroke="#f5f0e8" strokeWidth={2.5} paintOrder="stroke"
                      style={{ fontWeight: isFocus ? 600 : 500, pointerEvents: 'none' }}>
                  {n.name.length > 16 ? n.name.slice(0, 15) + '…' : n.name}
                </text>
                <title>{n.name}{n.chapterId ? ' — клик: в текст' : ''}</title>
              </g>
            );
          })}
        </svg>
      </div>

      {expanded && unlinked.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[#1e2d1f]/5">
          <p className="text-[10px] uppercase tracking-wider text-[#1e2d1f]/40 mb-1.5">Без связей</p>
          <div className="flex flex-wrap gap-1.5">
            {unlinked.map(n => (
              <button key={n.id} onClick={() => { if (n.chapterId) onJumpToChapter(n.chapterId, n.name); }}
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-white/60 hover:bg-white transition-colors">
                <span className="w-2 h-2 rounded-full" style={{ background: TYPE_PIGMENT[n.type] ?? '#54627F' }} />
                {n.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-4 pt-3 border-t border-[#1e2d1f]/5 text-[10px] text-[#1e2d1f]/50">
        {[['character', 'Персонажи'], ['location', 'Локации'], ['item', 'Предметы'], ['rule', 'Правила']].map(([t, label]) => (
          <span key={t} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: TYPE_PIGMENT[t] }} />{label}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full border-2 border-[#A14F44]" />нестыковка
        </span>
      </div>
    </div>
  );
}
