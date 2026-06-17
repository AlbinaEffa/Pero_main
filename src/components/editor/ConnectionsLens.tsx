import { useMemo, useState, useRef, useEffect } from 'react';
import { Maximize } from 'lucide-react';
import { Entity, EntityLink } from './types';
import { MargWeb } from './Marginalia';

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
 * Смысловые группы связей для эго-вида: вместо колеса однотипных спиц раскладываем
 * соседей по секторам — сразу видно «кто герою союзник / враг / где он бывает».
 * Места и предметы определяются по типу соседа (атрибут, а не отношение); персонажи —
 * по ключевым словам отношения, по приоритету конфликт → союз → власть → прочее.
 */
const REL_CATEGORIES = [
  { key: 'ally',     label: 'Союзники и семья', color: '#4A5D4E' },
  { key: 'power',    label: 'Власть и роль',    color: '#54627F' },
  { key: 'conflict', label: 'Конфликт',         color: '#A14F44' },
  { key: 'place',    label: 'Места',            color: '#4A5D4E' },
  { key: 'item',     label: 'Предметы',         color: '#91682E' },
  { key: 'other',    label: 'Прочее',           color: '#1e2d1f' },
] as const;
type RelCat = typeof REL_CATEGORIES[number]['key'];
const CAT_RANK: Record<RelCat, number> = { conflict: 0, ally: 1, power: 2, place: 3, item: 4, other: 5 };

function relationCategory(relation: string | null | undefined, neighborType: string | undefined): RelCat {
  if (neighborType === 'location') return 'place';
  if (neighborType === 'item') return 'item';
  const r = (relation ?? '').toLowerCase();
  if (/против|враг|конфликт|сопер|пойма|сраж|\bбор|\bуби|преда|охот|пресл|похит|плен|месть|мстит/.test(r)) return 'conflict';
  if (/союзник|друг|партн|помога|спаса|защищ|довер|любов|роман|\bжен|\bмуж|брат|сестр|мать|отец|\bотц|\bсын|доч|семь|\bрод|наставн|спутник|связан|отношен|вместе|союз/.test(r)) return 'ally';
  if (/команд|подчин|руковод|владел|правит|служ|вассал|корол|госпож|хозя|лидер|\bглав|приказ|подвласт/.test(r)) return 'power';
  return 'other';
}

/**
 * Линза «Связи» — граф сущностей, построенный сам из `entity_links`. Не плоский список:
 * видно, кто с кем и как связан. Узлы по пигментам типа, размер по значимости, рёбра
 * подписаны отношением + главой. Клик по узлу → в текст. Свёрнуто показываем эго-граф
 * самого связного героя (полный граф душить в узкой панели бессмысленно), развёрнуто —
 * весь проект концентрическими кольцами по значимости.
 */
export function ConnectionsLens({ entities, links, contradictions, expanded, onJumpToChapter }: Props) {
  const [showMinor, setShowMinor] = useState(false);
  // Эго-вид (фокус на одном герое и его соседях) vs весь граф. По умолчанию ВСЕГДА
  // эго — даже развёрнуто: 145 узлов кольцами это клубок, читать его нельзя.
  const [graphMode, setGraphMode] = useState<'focus' | 'full'>('focus');
  // Кого держим в центре эго-вида. null → самый связный. Клик по соседу «перешагивает» сюда.
  const [focusOverride, setFocusOverride] = useState<string | null>(null);

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

  // Свёрнутый вид всегда эго; развёрнутый — по выбранному режиму.
  const effectiveMode: 'focus' | 'full' = expanded ? graphMode : 'focus';

  // Самая связная сущность — дефолтный центр эго-вида.
  const mostConnected = useMemo(
    () => (nodes0.length ? [...nodes0].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))[0]?.id ?? null : null),
    [nodes0, degree],
  );
  const focusId = effectiveMode === 'focus'
    ? (focusOverride && nodeIdSet.has(focusOverride) ? focusOverride : mostConnected)
    : null;

  const shownNodes = useMemo(() => {
    if (!focusId) return nodes0;
    const keep = new Set([focusId]);
    edges.forEach(e => {
      if (e.sourceEntityId === focusId) keep.add(e.targetEntityId);
      if (e.targetEntityId === focusId) keep.add(e.sourceEntityId);
    });
    return nodes0.filter(n => keep.has(n.id));
  }, [focusId, nodes0, edges]);

  const shownIdSet = useMemo(() => new Set(shownNodes.map(n => n.id)), [shownNodes]);
  const shownEdges = useMemo(() => {
    // Эго-вид = чистая «звезда»: только спицы фокус↔сосед. Связи между соседями
    // не рисуем (это снова клубок) — до них дойдёшь, шагнув на соседа. Весь граф — все рёбра.
    if (focusId) return edges.filter(e => e.sourceEntityId === focusId || e.targetEntityId === focusId);
    return edges.filter(e => shownIdSet.has(e.sourceEntityId) && shownIdSet.has(e.targetEntityId));
  }, [edges, shownIdSet, focusId]);

  // Категория каждого соседа относительно фокуса (по сильнейшей из связей с ним).
  const catOf = useMemo(() => {
    const m = new Map<string, RelCat>();
    if (!focusId) return m;
    shownEdges.forEach(e => {
      const otherId = e.sourceEntityId === focusId ? e.targetEntityId : e.sourceEntityId;
      const cat = relationCategory(e.relation, byId.get(otherId)?.type);
      const prev = m.get(otherId);
      if (prev === undefined || CAT_RANK[cat] < CAT_RANK[prev]) m.set(otherId, cat);
    });
    return m;
  }, [shownEdges, focusId, byId]);

  // viewBox под режим: развёрнуто шире (полный граф), свёрнуто компактнее (эго).
  const W = expanded ? 680 : 460;
  const H = expanded ? 480 : 360;

  const layout = useMemo(() => {
    const p = new Map<string, { x: number; y: number }>();
    const headings: { key: RelCat; label: string; color: string; x: number; y: number }[] = [];
    const cx = W / 2, cy = H / 2;
    const minDim = Math.min(W, H);
    if (focusId) {
      p.set(focusId, { x: cx, y: cy });
      const others = shownNodes.filter(n => n.id !== focusId);
      const R = minDim / 2 - 64;
      // Группируем соседей по смысловым категориям в фиксированном порядке.
      const groups = REL_CATEGORIES
        .map(c => ({ ...c, ids: others.filter(n => (catOf.get(n.id) ?? 'other') === c.key).map(n => n.id) }))
        .filter(g => g.ids.length > 0);
      const N = Math.max(1, others.length);
      const GAP = 0.2;                                   // зазор между секторами (рад)
      const totalSpan = 2 * Math.PI - GAP * groups.length;
      let a0 = -Math.PI / 2 + GAP / 2;                   // старт сверху
      groups.forEach(g => {
        const span = (g.ids.length / N) * totalSpan;
        g.ids.forEach((id, i) => {
          const a = a0 + span * ((i + 0.5) / g.ids.length);
          p.set(id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
        });
        const mid = a0 + span / 2;
        const HR = R + 30;                               // заголовок сектора снаружи кольца
        headings.push({ key: g.key, label: g.label, color: g.color, x: cx + HR * Math.cos(mid), y: cy + HR * Math.sin(mid) });
        a0 += span + GAP;
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
    return { pos: p, headings };
  }, [shownNodes, focusId, catOf, W, H]);
  const pos = layout.pos;

  // ── Зум/пан ────────────────────────────────────────────────────────────────
  const [t, setT] = useState({ k: 1, x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 });
  const moved = useRef(false);

  // Сброс вида при смене раскладки (режим/фокус).
  useEffect(() => { setT({ k: 1, x: 0, y: 0 }); }, [expanded, focusId, showMinor]);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setT(prev => {
      const k2 = clamp(prev.k * factor, 0.5, 4);
      const cx = W / 2, cy = H / 2;
      return { k: k2, x: prev.x + (prev.k - k2) * cx, y: prev.y + (prev.k - k2) * cy };
    });
  };
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { active: true, sx: e.clientX, sy: e.clientY, ox: t.x, oy: t.y };
    moved.current = false;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    const vbPerPx = W / (svgRef.current?.clientWidth || W);
    const dx = (e.clientX - drag.current.sx) * vbPerPx;
    const dy = (e.clientY - drag.current.sy) * vbPerPx;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved.current = true;
    setT(p => ({ ...p, x: drag.current.ox + dx, y: drag.current.oy + dy }));
  };
  const onPointerUp = () => { drag.current.active = false; };

  if (nodes0.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center px-6 py-12 text-[#1e2d1f]/45">
        <MargWeb size={56} className="mb-3 text-[#1e2d1f]/30" />
        <p className="text-sm leading-relaxed">Связи появятся, когда Перо прочитает главы и найдёт отношения между сущностями.</p>
      </div>
    );
  }

  const unlinked = nodes0.filter(n => !(degree.get(n.id) ?? 0));

  return (
    <div className="text-[12px]">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[11px] text-[#1e2d1f]/45 leading-snug min-w-0 truncate">
          {focusId
            ? <>Связи: <span className="font-medium text-[#1e2d1f]/70">«{byId.get(focusId)?.name ?? ''}»</span> · клик по соседу — шагнуть, по центру — в текст</>
            : 'Весь граф связей. Клик — в текст · колесо/перетаскивание — масштаб.'}
        </p>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Эго/весь граф — только когда есть место (развёрнуто) */}
          {expanded && (
            <div className="flex rounded-md bg-[#1e2d1f]/[0.06] p-0.5">
              {(['focus', 'full'] as const).map(m => (
                <button key={m} onClick={() => setGraphMode(m)}
                  className={`text-[10.5px] px-2 py-0.5 rounded transition-colors ${
                    graphMode === m ? 'bg-[#1e2d1f] text-[#f5f0e8]' : 'text-[#1e2d1f]/55 hover:text-[#1e2d1f]'
                  }`}>
                  {m === 'focus' ? 'Эго-вид' : 'Весь граф'}
                </button>
              ))}
            </div>
          )}
          {focusId && focusOverride && focusOverride !== mostConnected && (
            <button onClick={() => setFocusOverride(null)}
              className="text-[10.5px] px-2 py-0.5 rounded-md text-[#1e2d1f]/50 hover:bg-[#1e2d1f]/[0.06]"
              title="Вернуться к самому связному">↺ центр</button>
          )}
          <button
            onClick={() => setShowMinor(v => !v)}
            className={`text-[10.5px] px-2 py-0.5 rounded-md transition-colors ${
              showMinor ? 'bg-[#1e2d1f] text-[#f5f0e8]' : 'text-[#1e2d1f]/50 hover:bg-[#1e2d1f]/[0.06]'
            }`}
            title="Показывать эпизодические сущности"
          >
            + эпизодические
          </button>
        </div>
      </div>

      <div className="relative rounded-xl bg-white/40 border border-[#1e2d1f]/5 overflow-hidden">
        {(t.k !== 1 || t.x !== 0 || t.y !== 0) && (
          <button
            onClick={() => setT({ k: 1, x: 0, y: 0 })}
            className="absolute top-2 right-2 z-10 flex items-center gap-1 text-[10.5px] px-2 py-1 rounded-md bg-white/80 hover:bg-white text-[#1e2d1f]/60 shadow-sm border border-[#1e2d1f]/10"
            title="Сбросить масштаб"
          >
            <Maximize size={11} /> сброс
          </button>
        )}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full select-none"
          style={{ display: 'block', height: expanded ? 'min(62vh, 540px)' : 300, cursor: drag.current.active ? 'grabbing' : 'grab', touchAction: 'none' }}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <g transform={`translate(${t.x} ${t.y}) scale(${t.k})`}>
          {shownEdges.map(e => {
            const a = pos.get(e.sourceEntityId), b = pos.get(e.targetEntityId);
            if (!a || !b) return null;
            // Подпись ближе к источнику (не в центре) — так подписи разных рёбер из одного
            // узла расходятся и меньше наезжают.
            const lx = a.x + (b.x - a.x) * 0.42, ly = a.y + (b.y - a.y) * 0.42;
            // В эго-виде красим спицу по категории соседа (подсказка) и НЕ пишем подпись —
            // смысл несёт сектор. Подписи только в полном графе.
            const neighborId = focusId ? (e.sourceEntityId === focusId ? e.targetEntityId : e.sourceEntityId) : null;
            const cat = neighborId ? catOf.get(neighborId) : undefined;
            const stroke = cat ? (REL_CATEGORIES.find(c => c.key === cat)?.color ?? '#1e2d1f') : '#1e2d1f';
            return (
              <g key={e.id}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeOpacity={focusId ? 0.3 : 0.16} strokeWidth={1.5}>
                  <title>{e.relation}</title>
                </line>
                {!focusId && expanded && (
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
            const canWalk = !!focusId && n.id !== focusId;
            // Отношения этого соседа к фокусу — в подсказку (подписи спиц убрали).
            const rels = canWalk
              ? shownEdges
                  .filter(e => (e.sourceEntityId === focusId && e.targetEntityId === n.id) || (e.targetEntityId === focusId && e.sourceEntityId === n.id))
                  .map(e => e.relation).filter(Boolean)
              : [];
            return (
              <g key={n.id} style={{ cursor: (canWalk || n.chapterId) ? 'pointer' : 'default' }}
                 onClick={() => {
                   if (moved.current) return;
                   if (canWalk) { setFocusOverride(n.id); return; }   // шагнуть к соседу
                   if (n.chapterId) onJumpToChapter(n.chapterId, n.name); // центр/полный граф → в текст
                 }}>
                {conflict && <circle cx={p.x} cy={p.y} r={r + 3} fill="none" stroke="#A14F44" strokeWidth={2} />}
                <circle cx={p.x} cy={p.y} r={r} fill={pigment} stroke="#f5f0e8" strokeWidth={isFocus ? 3 : 1.5} />
                <text x={p.x} y={p.y + r + 11} textAnchor="middle" fontSize={10.5} fill="#1e2d1f" fontFamily="Golos Text, system-ui"
                      stroke="#f5f0e8" strokeWidth={2.5} paintOrder="stroke"
                      style={{ fontWeight: isFocus ? 600 : 500, pointerEvents: 'none' }}>
                  {n.name.length > 16 ? n.name.slice(0, 15) + '…' : n.name}
                </text>
                <title>{rels.length ? `${n.name} — ${rels.join(', ')}` : n.name}{canWalk ? ' · клик: открыть его связи' : (n.chapterId ? ' · клик: в текст' : '')}</title>
              </g>
            );
          })}
          {/* Заголовки смысловых секторов (только эго-вид) */}
          {focusId && layout.headings.map(h => (
            <text key={h.key} x={h.x} y={h.y} textAnchor="middle" fontSize={10} fill={h.color}
                  fontFamily="Golos Text, system-ui" fontWeight={700}
                  stroke="#f5f0e8" strokeWidth={3.5} paintOrder="stroke"
                  style={{ pointerEvents: 'none' }}>
              {h.label}
            </text>
          ))}
          </g>
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
