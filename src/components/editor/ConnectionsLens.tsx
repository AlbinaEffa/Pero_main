import { useMemo, useState, useRef, useEffect } from 'react';
import { Maximize, Sparkles, Check, X, Loader2, Link2, ChevronDown } from 'lucide-react';
import { Entity, EntityLink } from './types';
import { MargWeb } from './Marginalia';
import { api } from '../../services/api';

interface ChapterLite { id: string; povCharacter?: string | null }

interface Props {
  entities: Entity[];
  links: EntityLink[];
  contradictions: Set<string>;
  /** Развёрнутый инспектор → полный граф; свёрнутый → эго-вид самой связной сущности. */
  expanded: boolean;
  onJumpToChapter: (chapterId: string, entityName: string) => void;
  /** Главы — для инсайта «центр тяжести» (частота POV). */
  chapters?: ChapterLite[];
  /** Открыть карточку героя в Мире (действие на выбранной вершине вместо ложного прыжка). */
  onOpenEntityDetail?: (name: string) => void;
  /** Для подсказок «вероятные связи по смыслу» (эмбеддинги) + создания связи. */
  projectId?: string;
  /** Дёрнуть после создания связи, чтобы родитель перезагрузил граф. */
  onLinksChanged?: () => void;
}

const TYPE_PIGMENT: Record<string, string> = {
  character: '#A14F44', location: '#4A5D4E', item: '#91682E', rule: '#54627F',
};
const SIG_RADIUS: Record<string, number> = { major: 22, moderate: 16, minor: 11 };
// Потолок узлов в графе: и рендер SVG-групп, и симуляция — O(n²). До ~140 держится 60fps;
// выше рисуем только топ по связности (книга может быть огромной; показывать 5000 в одном
// клубке бессмысленно и тормозно). Защита от деградации на больших книгах.
const MAX_GRAPH = 140;

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

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));


/**
 * Живая силовая симуляция (как в Obsidian): непрерывный rAF-цикл со скоростями и «остыванием»
 * (alpha). Узлы постоянно оседают; «подогрев» (reheat) оживляет граф при перетаскивании или
 * смене состава. Перетаскивание узла «пиннит» его позицию, остальные пружинят вокруг.
 * Без зависимостей — на 35–180 узлов SVG тянет 60fps. Когда alpha остыл — цикл крутится вхолостую
 * (без перерисовки), чтобы reheat мог мгновенно его оживить.
 */
function useLiveForce(
  nodeIds: string[],
  edges: { sourceEntityId: string; targetEntityId: string }[],
  W: number, H: number, active: boolean,
  radii: Map<string, number>,
) {
  const radiiRef = useRef(radii); radiiRef.current = radii; // радиусы для collision (без ре-подписки)
  const posRef = useRef(new Map<string, { x: number; y: number }>());
  const velRef = useRef(new Map<string, { x: number; y: number }>());
  const pinRef = useRef<string | null>(null);
  const alphaRef = useRef(1);
  const rafRef = useRef(0);
  const [, bump] = useState(0);
  const sig = nodeIds.join(',') + '|' + edges.length;

  // Инициализация/синхронизация набора узлов (новые сидируем по кругу, ушедшие удаляем).
  useEffect(() => {
    const pos = posRef.current, vel = velRef.current;
    const cx = W / 2, cy = H / 2, R0 = Math.min(W, H) / 2 - 50;
    nodeIds.forEach((id, i) => {
      if (!pos.has(id)) {
        const a = (i / Math.max(1, nodeIds.length)) * 2 * Math.PI;
        const rr = R0 * (0.4 + 0.6 * (((i * 73) % 97) / 97));
        pos.set(id, { x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) });
        vel.set(id, { x: 0, y: 0 });
      }
    });
    const keep = new Set(nodeIds);
    [...pos.keys()].forEach(id => { if (!keep.has(id)) { pos.delete(id); vel.delete(id); } });
    alphaRef.current = 1; // reheat на смену графа
  }, [sig, W, H]);

  useEffect(() => {
    if (!active) return;
    const ids = nodeIds;
    const idx = new Map(ids.map((id, i) => [id, i]));
    const E = edges
      .map(e => [idx.get(e.sourceEntityId), idx.get(e.targetEntityId)] as [number | undefined, number | undefined])
      .filter(([a, b]) => a !== undefined && b !== undefined) as [number, number][];
    const cx = W / 2, cy = H / 2;
    const step = () => {
      const pos = posRef.current, vel = velRef.current, n = ids.length;
      const R = ids.map(id => radiiRef.current.get(id) ?? 11);
      const alpha = alphaRef.current;
      let changed = false;
      // 1) Силовая интеграция — только пока граф «тёплый» (оседание/пружинит при драге).
      if (alpha > 0.015) {
        const fx = new Float64Array(n), fy = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          const A = pos.get(ids[i]); if (!A) continue;
          for (let j = i + 1; j < n; j++) {
            const B = pos.get(ids[j]); if (!B) continue;
            let dx = A.x - B.x, dy = A.y - B.y; let d2 = dx * dx + dy * dy; if (d2 < 1) d2 = 1;
            const d = Math.sqrt(d2), f = 3200 / d2;
            fx[i] += (dx / d) * f; fy[i] += (dy / d) * f;
            fx[j] -= (dx / d) * f; fy[j] -= (dy / d) * f;
          }
        }
        for (const [a, b] of E) {
          const A = pos.get(ids[a]), B = pos.get(ids[b]); if (!A || !B) continue;
          let dx = B.x - A.x, dy = B.y - A.y; const d = Math.sqrt(dx * dx + dy * dy) || 1, f = 0.045 * (d - 90);
          fx[a] += (dx / d) * f; fy[a] += (dy / d) * f;
          fx[b] -= (dx / d) * f; fy[b] -= (dy / d) * f;
        }
        for (let i = 0; i < n; i++) {
          const id = ids[i]; const p = pos.get(id), v = vel.get(id); if (!p || !v) continue;
          if (id === pinRef.current) { v.x = 0; v.y = 0; continue; }
          const ax = fx[i] + (cx - p.x) * 0.012, ay = fy[i] + (cy - p.y) * 0.012;
          v.x = (v.x + ax) * 0.55; v.y = (v.y + ay) * 0.55;
          p.x += clampN(v.x, -55, 55) * alpha; p.y += clampN(v.y, -55, 55) * alpha;
        }
        alphaRef.current = alpha * 0.985;
        changed = true;
      }
      // 2) Жёсткий разбор наложений — ВСЕГДА (не зависит от alpha): двигаем позиции напрямую,
      //    чтобы кружки не наезжали даже на устоявшемся графе (и чинит старую плотную раскладку).
      let relaxIter = 0;
      let overlapped = true;
      while (overlapped && relaxIter < 4) {
        overlapped = false; relaxIter++;
        for (let i = 0; i < n; i++) {
          const A = pos.get(ids[i]); if (!A) continue;
          for (let j = i + 1; j < n; j++) {
            const B = pos.get(ids[j]); if (!B) continue;
            let dx = B.x - A.x, dy = B.y - A.y; let d = Math.sqrt(dx * dx + dy * dy) || 0.01;
            const minD = R[i] + R[j] + 8;
            if (d < minD - 0.4) {
              const push = (minD - d) / 2, ux = dx / d, uy = dy / d;
              if (ids[i] !== pinRef.current) { A.x -= ux * push; A.y -= uy * push; }
              if (ids[j] !== pinRef.current) { B.x += ux * push; B.y += uy * push; }
              overlapped = true; changed = true;
            }
          }
        }
      }
      if (changed) bump(x => (x + 1) % 1e9);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [sig, W, H, active]);

  return {
    pos: posRef.current,
    reheat: () => { alphaRef.current = Math.max(alphaRef.current, 0.55); },
    pin: (id: string | null) => { pinRef.current = id; },
    moveTo: (id: string, x: number, y: number) => { const p = posRef.current.get(id); if (p) { p.x = x; p.y = y; } },
  };
}

/**
 * Линза «Связи» — диагностический граф, построенный сам из `entity_links`.
 * Развёрнуто по умолчанию — ВЕСЬ граф силовой раскладкой (кластеры-сообщества видны сразу).
 * Подписи по тирам (хабы всегда → больше на зуме → все при наведении/выборе), поэтому 145
 * имён не превращаются в кашу. Клик по вершине → её зависимости (остальное гаснет), действие
 * → карточка героя (а не ложный прыжок в одно из многих упоминаний). Диагностика поверх:
 * «провисают» (0–1 связь), «центр тяжести» (хаб vs POV), «намёки» (вероятные связи пунктиром).
 * Эго-вид — отдельный режим-кнопка.
 */
export function ConnectionsLens({ entities, links, contradictions, expanded, onJumpToChapter, chapters = [], onOpenEntityDetail, projectId, onLinksChanged }: Props) {
  const [showMinor, setShowMinor] = useState(false);
  // По умолчанию развёрнуто — ВЕСЬ граф (идея «один граф, тык по вершине»). Эго — по кнопке.
  // По умолчанию ЭГО-вид: «связи одного героя» — чисто и под задачу. «Весь граф» — обзор по кнопке.
  const [graphMode, setGraphMode] = useState<'focus' | 'full'>('focus');
  const [focusOverride, setFocusOverride] = useState<string | null>(null);
  const [focusHistory, setFocusHistory] = useState<string[]>([]); // стек центров — чтобы вернуться назад
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  // Выбранная вершина в полном графе → подсветить её зависимости, погасить остальное.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Диагностика «провисают» (0–1 связь).
  const [diagOrphans, setDiagOrphans] = useState(false);
  // Намёки (вероятные связи) пунктиром на графе.
  const [showHints, setShowHints] = useState(false);
  const [hints, setHints] = useState<{ a: string; b: string; similarity: number }[] | null>(null);
  const [hintsLoading, setHintsLoading] = useState(false);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);

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

  // Степень считаем по ВСЕМ связям (не только видимым) — иначе скрытие эпизодических
  // ложно делает узлы «оторванными».
  const degree = useMemo(() => {
    const d = new Map<string, number>();
    links.forEach(e => {
      if (e.sourceEntityId === e.targetEntityId) return;
      d.set(e.sourceEntityId, (d.get(e.sourceEntityId) ?? 0) + 1);
      d.set(e.targetEntityId, (d.get(e.targetEntityId) ?? 0) + 1);
    });
    return d;
  }, [links]);

  const effectiveMode: 'focus' | 'full' = expanded ? graphMode : 'focus';

  const mostConnected = useMemo(
    () => (nodes0.length ? [...nodes0].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))[0]?.id ?? null : null),
    [nodes0, degree],
  );
  const focusId = effectiveMode === 'focus'
    ? (focusOverride && nodeIdSet.has(focusOverride) ? focusOverride : mostConnected)
    : null;

  // Перейти в граф соседа, запомнив текущий центр (чтобы вернуться «← назад»). Остаёмся в графе.
  const goToFocus = (id: string) => {
    if (focusId && focusId !== id) setFocusHistory(h => [...h, focusId]);
    setFocusOverride(id);
    setSelectedId(null);
  };
  const goBack = () => {
    setFocusHistory(h => {
      const next = [...h];
      const prev = next.pop();
      setFocusOverride(prev ?? null); // пусто → дефолтный центр (самый связный)
      return next;
    });
  };

  const shownNodes = useMemo(() => {
    if (focusId) {
      const keep = new Set([focusId]);
      edges.forEach(e => {
        if (e.sourceEntityId === focusId) keep.add(e.targetEntityId);
        if (e.targetEntityId === focusId) keep.add(e.sourceEntityId);
      });
      return nodes0.filter(n => keep.has(n.id));
    }
    // Полный граф: при большой книге рисуем только топ-MAX_GRAPH по связности (защита от
    // тормозов). Чип «Провисают» добавляет оторванных, чтобы диагностика не пропала под капом.
    if (nodes0.length <= MAX_GRAPH) return nodes0;
    const top = [...nodes0].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)).slice(0, MAX_GRAPH);
    if (diagOrphans) {
      const set = new Set(top.map(n => n.id));
      nodes0.forEach(n => { if ((degree.get(n.id) ?? 0) <= 1) set.add(n.id); });
      return nodes0.filter(n => set.has(n.id));
    }
    return top;
  }, [focusId, nodes0, edges, degree, diagOrphans]);
  const graphCapped = !focusId && expanded && nodes0.length > MAX_GRAPH;

  const shownIdSet = useMemo(() => new Set(shownNodes.map(n => n.id)), [shownNodes]);
  const shownEdges = useMemo(() => {
    if (focusId) return edges.filter(e => e.sourceEntityId === focusId || e.targetEntityId === focusId);
    return edges.filter(e => shownIdSet.has(e.sourceEntityId) && shownIdSet.has(e.targetEntityId));
  }, [edges, shownIdSet, focusId]);

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

  // Соседи выбранной вершины (полный граф) — для подсветки её зависимостей.
  const selNeighbors = useMemo(() => {
    const s = new Set<string>();
    if (!selectedId || focusId) return s;
    s.add(selectedId);
    shownEdges.forEach(e => {
      if (e.sourceEntityId === selectedId) s.add(e.targetEntityId);
      if (e.targetEntityId === selectedId) s.add(e.sourceEntityId);
    });
    return s;
  }, [selectedId, shownEdges, focusId]);

  // Соседи узла под курсором (полный граф, без активного выбора) — для подсветки по наведению.
  const hoverNeighbors = useMemo(() => {
    const s = new Set<string>();
    if (!hoveredId || focusId || selectedId) return s;
    s.add(hoveredId);
    shownEdges.forEach(e => {
      if (e.sourceEntityId === hoveredId) s.add(e.targetEntityId);
      if (e.targetEntityId === hoveredId) s.add(e.sourceEntityId);
    });
    return s;
  }, [hoveredId, shownEdges, focusId, selectedId]);

  const W = expanded ? 680 : 460;
  const H = expanded ? 480 : 360;

  // Раскладка: эго — секторами (как раньше); полный граф — силовая.
  const layout = useMemo(() => {
    const headings: { key: RelCat; label: string; color: string; x: number; y: number }[] = [];
    const cx = W / 2, cy = H / 2;
    const minDim = Math.min(W, H);
    if (!focusId) {
      // Полный граф — живая симуляция (sim ниже). Здесь только эго раскладывается статично.
      return { pos: new Map<string, { x: number; y: number }>(), headings };
    }
    const p = new Map<string, { x: number; y: number }>();
    p.set(focusId, { x: cx, y: cy });
    const others = shownNodes.filter(n => n.id !== focusId);
    // Соседи по секторам (для группировки цветом/заголовком), внутри сектора — как есть.
    const groups = REL_CATEGORIES
      .map(c => ({ ...c, ids: others.filter(n => (catOf.get(n.id) ?? 'other') === c.key).map(n => n.id) }))
      .filter(g => g.ids.length > 0);
    const M = others.length;
    // Слоты: каждый сосед = 1 слот, между секторами — пустой зазор GAP_SLOTS, чтобы группы
    // ЧИТАЛИСЬ как кластеры (а не равномерная каша), и заголовок ясно стоял над своей группой.
    const GAP_SLOTS = 1.4;
    const totalSlots = Math.max(1, M + groups.length * GAP_SLOTS);
    const twoRing = M > 16;
    const R = minDim / 2 - 52;
    const step = (2 * Math.PI) / totalSlots;
    const start = -Math.PI / 2;
    let slot = 0;
    groups.forEach(g => {
      const groupStart = slot;
      g.ids.forEach((id, k) => {
        const a = start + slot * step;
        const rr = twoRing ? R - (k % 2) * 42 : R;   // 2 кольца внутри сектора при тесноте
        p.set(id, { x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) });
        slot += 1;
      });
      const midSlot = groupStart + (g.ids.length - 1) / 2;
      const a = start + midSlot * step;
      const HR = R + 28;
      headings.push({ key: g.key, label: g.label, color: g.color, x: cx + HR * Math.cos(a), y: cy + HR * Math.sin(a) });
      slot += GAP_SLOTS;                              // зазор перед следующим сектором
    });
    return { pos: p, headings };
  }, [shownNodes, focusId, catOf, W, H]);

  // Живая физика для полного графа (узлы = видимый/капнутый набор, рёбра — среди них).
  const fullIds = useMemo(() => shownNodes.map(n => n.id), [shownNodes]);
  const simRadii = useMemo(() => new Map(nodes0.map(n => [n.id, SIG_RADIUS[n.significance ?? 'minor'] ?? 11])), [nodes0]);
  const sim = useLiveForce(fullIds, shownEdges, W, H, !focusId && expanded, simRadii);
  const pos = focusId ? layout.pos : sim.pos;

  // ── Зум/пан ────────────────────────────────────────────────────────────────
  const [t, setT] = useState({ k: 1, x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 });
  const dragNode = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const moved = useRef(false);

  useEffect(() => { setT({ k: 1, x: 0, y: 0 }); }, [expanded, focusId, showMinor]);
  // Сброс выбора при смене раскладки.
  useEffect(() => { setSelectedId(null); }, [focusId, showMinor, graphMode]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setT(prev => {
      const k2 = clampN(prev.k * factor, 0.5, 6);
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
    const vbPerPx = W / (svgRef.current?.clientWidth || W);
    // Перетаскивание узла (полный граф): двигаем его в sim-координатах (делим на зум k).
    if (dragNode.current) {
      const d = dragNode.current;
      if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) moved.current = true;
      sim.moveTo(d.id, d.ox + (e.clientX - d.sx) * vbPerPx / t.k, d.oy + (e.clientY - d.sy) * vbPerPx / t.k);
      sim.reheat();
      return;
    }
    if (!drag.current.active) return;
    const dx = (e.clientX - drag.current.sx) * vbPerPx;
    const dy = (e.clientY - drag.current.sy) * vbPerPx;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved.current = true;
    setT(p => ({ ...p, x: drag.current.ox + dx, y: drag.current.oy + dy }));
  };
  const onPointerUp = () => {
    if (dragNode.current) { sim.pin(null); if (moved.current) sim.reheat(); dragNode.current = null; return; }
    drag.current.active = false;
  };

  // ── Центр тяжести: хаб по степени vs самый частый POV ───────────────────────
  const povTop = useMemo(() => {
    const c = new Map<string, number>();
    chapters.forEach(ch => { const p = ch.povCharacter?.trim(); if (p) c.set(p, (c.get(p) ?? 0) + 1); });
    let best: string | null = null, bn = 0;
    c.forEach((n, name) => { if (n > bn) { bn = n; best = name; } });
    return best ? { name: best, n: bn } : null;
  }, [chapters]);
  const hub = mostConnected ? byId.get(mostConnected) : null;
  const hubDeg = mostConnected ? (degree.get(mostConnected) ?? 0) : 0;

  // Список для пикера «В центре: герой» (поиск по всем сущностям книги).
  const pickerEntities = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return entities
      .filter(e => e.name && (!q || e.name.toLowerCase().includes(q)))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .slice(0, 60);
  }, [entities, pickerQuery]);

  // ── Намёки (вероятные связи) ────────────────────────────────────────────────
  async function loadHints() {
    if (!projectId || hintsLoading) return;
    setHintsLoading(true);
    try {
      const { pairs } = await api.post<{ pairs: { a: { id: string }; b: { id: string }; similarity: number }[] }>(
        `/bible/${projectId}/suggested-links`, {});
      setHints((pairs ?? []).map(p => ({ a: p.a.id, b: p.b.id, similarity: p.similarity })));
    } catch { setHints([]); } finally { setHintsLoading(false); }
  }
  function toggleHints() {
    const next = !showHints; setShowHints(next);
    if (next && hints === null) loadHints();
  }
  async function confirmHint(a: string, b: string) {
    if (!projectId) return;
    setLinkBusy(`${a}<${b}`);
    try {
      await api.post(`/bible/${projectId}/links`, { sourceEntityId: a, targetEntityId: b, relation: 'связан с' });
      setHints(prev => (prev ?? []).filter(h => !(h.a === a && h.b === b)));
      onLinksChanged?.();
    } catch { /* оставляем */ } finally { setLinkBusy(null); }
  }

  if (nodes0.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center px-6 py-12 text-[#1e2d1f]/45">
        <MargWeb size={56} className="mb-3 text-[#1e2d1f]/30" />
        <p className="text-sm leading-relaxed">Связи появятся, когда Перо прочитает главы и найдёт отношения между сущностями.</p>
      </div>
    );
  }

  const unlinked = nodes0.filter(n => !(degree.get(n.id) ?? 0));
  const orphanCount = nodes0.filter(n => (degree.get(n.id) ?? 0) <= 1).length;
  const isOrphan = (id: string) => (degree.get(id) ?? 0) <= 1;
  const selected = selectedId ? byId.get(selectedId) : null;

  // показывать подпись узла в полном графе?
  const labelThreshold = Math.max(2, Math.round(6 / t.k)); // зум вниз порога → больше подписей; в обзоре только хабы
  const showLabel = (n: Entity): boolean => {
    if (focusId) return true; // эго — все подписаны (их мало)
    if (hoveredId === n.id) return true;
    if (selectedId) return selNeighbors.has(n.id);
    if (diagOrphans) return isOrphan(n.id);
    return (n.significance === 'major') || (degree.get(n.id) ?? 0) >= labelThreshold;
  };
  const nodeOpacity = (n: Entity): number => {
    if (focusId) return 1;
    if (selectedId) return selNeighbors.has(n.id) ? 1 : 0.12;
    if (diagOrphans) return isOrphan(n.id) ? 1 : 0.12;
    if (hoverNeighbors.size) return hoverNeighbors.has(n.id) ? 1 : 0.2;
    return 1;
  };

  return (
    <div className="text-[12px]">
      {projectId && <SuggestedLinks projectId={projectId} onLinksChanged={onLinksChanged} />}

      {/* Инсайт «центр тяжести» (только полный граф, развёрнуто) */}
      {!focusId && expanded && hub && (
        <div className="mb-2 text-[11px] text-[#1e2d1f]/55 leading-snug">
          Центр графа — <span className="font-semibold text-[#1e2d1f]/75">{hub.name}</span> ({hubDeg} связ.)
          {povTop && povTop.name !== hub.name && <> · чаще POV — <span className="font-medium text-[#1e2d1f]/70">{povTop.name}</span></>}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[11px] text-[#1e2d1f]/45 leading-snug min-w-0 truncate">
          {focusId
            ? <>Связи: <span className="font-medium text-[#1e2d1f]/70">«{byId.get(focusId)?.name ?? ''}»</span> · клик по соседу — его граф · ← назад вернёт · наведи — отношение</>
            : selectedId
              ? <>Выбран: <span className="font-medium text-[#1e2d1f]/70">«{selected?.name ?? ''}»</span> — его зависимости подсвечены</>
              : graphCapped
                ? `Топ-${MAX_GRAPH} самых связных из ${nodes0.length}. Клик — зависимости · тащи узел · колесо — зум.`
                : 'Весь граф. Клик по вершине — её зависимости · тащи узел · колесо — зум.'}
        </p>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Пикер центра эго-графа — выбрать любого героя напрямую (поиск). */}
          {focusId && (
            <div className="relative">
              <button onClick={() => setPickerOpen(o => !o)}
                className="flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-md bg-[#1e2d1f]/[0.06] hover:bg-[#1e2d1f]/10 text-[#1e2d1f]/70 max-w-[150px]"
                title="Выбрать героя в центре">
                <span className="truncate">В центре: {byId.get(focusId)?.name ?? '—'}</span>
                <ChevronDown size={11} className="shrink-0" />
              </button>
              {pickerOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => { setPickerOpen(false); setPickerQuery(''); }} />
                  <div className="absolute right-0 mt-1 z-30 w-56 max-h-72 overflow-auto rounded-xl bg-white border border-[#1e2d1f]/12 shadow-lg p-1.5">
                    <input autoFocus value={pickerQuery} onChange={e => setPickerQuery(e.target.value)}
                      placeholder="Поиск героя…"
                      className="w-full mb-1 px-2 py-1 text-[12px] rounded-md bg-[#f5f0e8] outline-none placeholder:text-[#1e2d1f]/35" />
                    {pickerEntities.map(e => (
                      <button key={e.id}
                        onClick={() => { goToFocus(e.id); setPickerOpen(false); setPickerQuery(''); }}
                        className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-left text-[12px] hover:bg-[#1e2d1f]/[0.06] ${e.id === focusId ? 'bg-[#1e2d1f]/[0.06] font-medium' : 'text-[#1e2d1f]/80'}`}>
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TYPE_PIGMENT[e.type] ?? '#54627F' }} />
                        <span className="truncate">{e.name}</span>
                      </button>
                    ))}
                    {pickerEntities.length === 0 && <div className="px-2 py-2 text-[11px] text-[#1e2d1f]/40">Ничего не найдено</div>}
                  </div>
                </>
              )}
            </div>
          )}
          {focusId && focusHistory.length > 0 && (
            <button onClick={goBack}
              className="text-[10.5px] px-2 py-0.5 rounded-md text-[#1e2d1f]/65 hover:bg-[#1e2d1f]/[0.06]"
              title="Вернуться к предыдущему центру">← назад</button>
          )}
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
          <button
            onClick={() => setShowMinor(v => !v)}
            className={`text-[10.5px] px-2 py-0.5 rounded-md transition-colors ${
              showMinor ? 'bg-[#1e2d1f] text-[#f5f0e8]' : 'text-[#1e2d1f]/60 hover:bg-[#1e2d1f]/[0.06]'
            }`}
            title="Показывать эпизодические сущности"
          >
            + эпизодические
          </button>
        </div>
      </div>

      {/* Диагностические чипы (только полный граф, развёрнуто) */}
      {!focusId && expanded && (
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <button
            onClick={() => setDiagOrphans(v => !v)}
            className={`flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-md transition-colors ${
              diagOrphans ? 'bg-[#9E4338] text-[#f5f0e8]' : 'text-[#9E4338] bg-[#9E4338]/10 hover:bg-[#9E4338]/15'
            }`}
            title="Сущности с 0–1 связью — развить или вырезать"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current" /> Провисают · {orphanCount}
          </button>
          {projectId && (
            <button
              onClick={toggleHints}
              className={`flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-md transition-colors ${
                showHints ? 'bg-[#A14F44] text-[#f5f0e8]' : 'text-[#A14F44] bg-[#A14F44]/10 hover:bg-[#A14F44]/15'
              }`}
              title="Близкие по смыслу, но несвязанные пары — пунктиром на графе"
            >
              {hintsLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
              Намёки{hints ? ` · ${hints.length}` : ''}
            </button>
          )}
        </div>
      )}

      <div className="relative rounded-xl bg-white/40 border border-[#1e2d1f]/5 overflow-hidden">
        {(t.k !== 1 || t.x !== 0 || t.y !== 0 || selectedId) && (
          <button
            onClick={() => { setT({ k: 1, x: 0, y: 0 }); setSelectedId(null); }}
            className="absolute top-2 right-2 z-10 flex items-center gap-1 text-[10.5px] px-2 py-1 rounded-md bg-white/80 hover:bg-white text-[#1e2d1f]/60 border border-[#1e2d1f]/10"
            title="Сбросить масштаб и выбор"
          >
            <Maximize size={11} /> сброс
          </button>
        )}
        {/* Действия для выбранной вершины */}
        {selectedId && selected && (
          <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 rounded-lg bg-white/90 border border-[#1e2d1f]/10 px-2 py-1 shadow-sm">
            <span className="w-2 h-2 rounded-full" style={{ background: TYPE_PIGMENT[selected.type] ?? '#54627F' }} />
            <span className="text-[11px] font-medium text-[#1e2d1f]/80 max-w-[120px] truncate">{selected.name}</span>
            {onOpenEntityDetail && (
              <button onClick={() => onOpenEntityDetail(selected.name)}
                className="text-[10.5px] px-1.5 py-0.5 rounded bg-[#1e2d1f]/[0.06] hover:bg-[#1e2d1f]/10 text-[#1e2d1f]/70">
                Карточка
              </button>
            )}
            <button onClick={() => { setGraphMode('focus'); setFocusOverride(selectedId); }}
              className="text-[10.5px] px-1.5 py-0.5 rounded bg-[#1e2d1f]/[0.06] hover:bg-[#1e2d1f]/10 text-[#1e2d1f]/70">
              Эго-вид
            </button>
            <button onClick={() => setSelectedId(null)} className="text-[#1e2d1f]/40 hover:text-[#1e2d1f]/70"><X size={13} /></button>
          </div>
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
            const neighborId = focusId ? (e.sourceEntityId === focusId ? e.targetEntityId : e.sourceEntityId) : null;
            const cat = neighborId ? catOf.get(neighborId) : undefined;
            const stroke = cat ? (REL_CATEGORIES.find(c => c.key === cat)?.color ?? '#1e2d1f') : '#1e2d1f';
            // прозрачность ребра: фокус 0.3; выбор — только касающиеся выбранной; иначе база
            let op = focusId ? 0.42 : 0.14;
            if (!focusId && selectedId) op = (e.sourceEntityId === selectedId || e.targetEntityId === selectedId) ? 0.5 : 0.04;
            else if (!focusId && diagOrphans) op = 0.04;
            else if (!focusId && hoverNeighbors.size) op = (e.sourceEntityId === hoveredId || e.targetEntityId === hoveredId) ? 0.5 : 0.03;
            // В эго при наведении на соседа — толще его ветка + подпись отношения НА ВЕТКЕ.
            const hoveredEdge = !!focusId && hoveredId != null && neighborId === hoveredId;
            if (hoveredEdge) op = 0.85;
            const mx = a.x + (b.x - a.x) * 0.55, my = a.y + (b.y - a.y) * 0.55;
            return (
              <g key={e.id}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke}
                      strokeOpacity={op} strokeWidth={(hoveredEdge ? 2.2 : 1.5) / t.k}>
                  <title>{e.relation}</title>
                </line>
                {hoveredEdge && e.relation && (
                  <text x={mx} y={my} textAnchor="middle" fontSize={10 / t.k} fill={stroke}
                        fontFamily="Golos Text, system-ui" fontWeight={600}
                        stroke="#f5f0e8" strokeWidth={3.5 / t.k} paintOrder="stroke"
                        style={{ pointerEvents: 'none' }}>
                    {e.relation.length > 32 ? e.relation.slice(0, 31) + '…' : e.relation}
                  </text>
                )}
              </g>
            );
          })}

          {/* Намёки — пунктирные «призрачные» рёбра (вероятные связи) */}
          {!focusId && showHints && (hints ?? []).map(h => {
            const a = pos.get(h.a), b = pos.get(h.b);
            if (!a || !b) return null;
            const busy = linkBusy === `${h.a}<${h.b}`;
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            return (
              <g key={`hint-${h.a}-${h.b}`} style={{ cursor: 'pointer' }}
                 onClick={() => { if (!moved.current) confirmHint(h.a, h.b); }}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#A14F44" strokeOpacity={0.5}
                      strokeWidth={1.4 / t.k} strokeDasharray={`${4 / t.k} ${3 / t.k}`} />
                <circle cx={mx} cy={my} r={6 / t.k} fill="#f5f0e8" stroke="#A14F44" strokeOpacity={0.7} strokeWidth={1 / t.k} />
                {busy
                  ? <circle cx={mx} cy={my} r={2 / t.k} fill="#A14F44" />
                  : <text x={mx} y={my + 3 / t.k} textAnchor="middle" fontSize={9 / t.k} fill="#A14F44" style={{ pointerEvents: 'none' }}>＋</text>}
                <title>Вероятная связь {Math.round(h.similarity * 100)}% · клик — связать</title>
              </g>
            );
          })}

          {shownNodes.map(n => {
            const p = pos.get(n.id);
            if (!p) return null;
            // Радиус и подписи делим на зум → узлы держат постоянный экранный размер (камера,
            // как в Obsidian): приближение РАЗДВИГАЕТ узлы, а не раздувает их.
            const baseR = focusId ? (n.id === focusId ? 26 : 13) : (SIG_RADIUS[n.significance ?? 'minor'] ?? 11);
            const r = baseR / t.k;
            const pigment = TYPE_PIGMENT[n.type] ?? '#54627F';
            const initial = n.name.trim().charAt(0).toUpperCase(); // буквица-инициал внутри крупных узлов
            const conflict = contradictions.has(n.id);
            const isFocus = n.id === focusId;
            const isSelected = n.id === selectedId;
            const canWalk = !!focusId && n.id !== focusId;
            const op = nodeOpacity(n);
            const rels = canWalk
              ? shownEdges
                  .filter(e => (e.sourceEntityId === focusId && e.targetEntityId === n.id) || (e.targetEntityId === focusId && e.sourceEntityId === n.id))
                  .map(e => e.relation).filter(Boolean)
              : [];
            return (
              <g key={n.id} style={{ cursor: 'pointer' }}
                 opacity={op}
                 onMouseEnter={() => setHoveredId(n.id)}
                 onMouseLeave={() => setHoveredId(h => (h === n.id ? null : h))}
                 onPointerDown={(e) => {
                   if (focusId) return;                       // в полном графе узел можно тащить
                   const pp = pos.get(n.id); if (!pp) return;
                   e.stopPropagation();                        // не запускаем пан холста
                   dragNode.current = { id: n.id, sx: e.clientX, sy: e.clientY, ox: pp.x, oy: pp.y };
                   moved.current = false;
                   sim.pin(n.id); // НЕ reheat: клик-выбор не должен дёргать граф; reheat только при реальном перетаскивании
                   svgRef.current?.setPointerCapture?.(e.pointerId);
                 }}
                 onClick={() => {
                   if (moved.current) return;
                   if (canWalk) { goToFocus(n.id); return; } // ЛЮБОЙ сосед → его граф; остаёмся в графе (+ можно назад)
                   if (focusId) return;                       // клик по центру — ничего (уже в центре, из графа не уходим)
                   setSelectedId(prev => (prev === n.id ? null : n.id)); // полный граф → выбрать/снять
                 }}>
                {conflict && <circle cx={p.x} cy={p.y} r={r + 3 / t.k} fill="none" stroke="#A14F44" strokeWidth={2 / t.k} />}
                <circle cx={p.x} cy={p.y} r={r} fill={pigment} stroke={isSelected ? '#1e2d1f' : '#f5f0e8'} strokeWidth={(isFocus || isSelected ? 3 : 1.5) / t.k} />
                {baseR >= 13 && initial && (
                  <text x={p.x} y={p.y + (baseR * 0.34) / t.k} textAnchor="middle"
                        fontSize={(baseR * 1.05) / t.k} fill="#f5f0e8"
                        fontFamily="Cormorant Garamond, serif" fontWeight={600}
                        style={{ pointerEvents: 'none' }}>
                    {initial}
                  </text>
                )}
                {showLabel(n) && (
                  <text x={p.x} y={p.y + r + 11 / t.k} textAnchor="middle" fontSize={10.5 / t.k} fill="#1e2d1f" fontFamily="Golos Text, system-ui"
                        stroke="#f5f0e8" strokeWidth={2.5 / t.k} paintOrder="stroke"
                        style={{ fontWeight: (isFocus || isSelected) ? 600 : 500, pointerEvents: 'none' }}>
                    {n.name.length > 16 ? n.name.slice(0, 15) + '…' : n.name}
                  </text>
                )}
                <title>{rels.length ? `${n.name} — ${rels.join(', ')}` : n.name}{canWalk ? (n.type === 'character' ? ' · клик: его граф' : ' · клик: карточка') : (!focusId ? ' · клик: показать зависимости' : ' · клик: карточка')}</title>
              </g>
            );
          })}

          {focusId && layout.headings.map(h => (
            <text key={h.key} x={h.x} y={h.y} textAnchor="middle" fontSize={10 / t.k} fill={h.color}
                  fontFamily="Golos Text, system-ui" fontWeight={700}
                  stroke="#f5f0e8" strokeWidth={3.5 / t.k} paintOrder="stroke"
                  style={{ pointerEvents: 'none' }}>
              {h.label}
            </text>
          ))}
          </g>
        </svg>
      </div>

      {expanded && unlinked.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[#1e2d1f]/5">
          <p className="text-[10px] uppercase tracking-wider text-[#1e2d1f]/40 mb-1.5">Без связей · {unlinked.length}</p>
          <div className="flex flex-wrap gap-1.5">
            {unlinked.map(n => (
              <button key={n.id} onClick={() => (onOpenEntityDetail ? onOpenEntityDetail(n.name) : (n.chapterId && onJumpToChapter(n.chapterId, n.name)))}
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-white/60 hover:bg-white transition-colors"
                title="Открыть карточку">
                <span className="w-2 h-2 rounded-full" style={{ background: TYPE_PIGMENT[n.type] ?? '#54627F' }} />
                {n.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-4 pt-3 border-t border-[#1e2d1f]/5 text-[10px] text-[#1e2d1f]/60">
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

// ── Вероятные связи по смыслу ───────────────────────────────────────────────────
interface SuggPair {
  similarity: number;
  a: { id: string; name: string; type: string };
  b: { id: string; name: string; type: string };
}

function SuggestedLinks({ projectId, onLinksChanged }: { projectId: string; onLinksChanged?: () => void }) {
  const [pairs, setPairs] = useState<SuggPair[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const key = (p: SuggPair) => `${p.a.id}<${p.b.id}`;

  async function run() {
    setOpen(true);
    if (loading) return;
    setLoading(true);
    try {
      const { pairs: r } = await api.post<{ pairs: SuggPair[] }>(`/bible/${projectId}/suggested-links`, {});
      setPairs(r ?? []);
    } catch {
      setPairs([]);
    } finally {
      setLoading(false);
    }
  }

  async function link(p: SuggPair) {
    setBusy(key(p));
    try {
      await api.post(`/bible/${projectId}/links`, { sourceEntityId: p.a.id, targetEntityId: p.b.id, relation: 'связан с' });
      setPairs(prev => (prev ?? []).filter(x => key(x) !== key(p)));
      onLinksChanged?.();
    } catch { /* оставляем в списке */ } finally { setBusy(null); }
  }

  function hide(p: SuggPair) {
    setPairs(prev => (prev ?? []).filter(x => key(x) !== key(p)));
  }

  const dot = (t: string) => (
    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TYPE_PIGMENT[t] ?? '#1e2d1f' }} />
  );

  return (
    <div className="mb-3 rounded-xl border border-[#1e2d1f]/8 bg-[#A14F44]/[0.04] overflow-hidden">
      <button
        onClick={() => (open ? setOpen(false) : run())}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#A14F44]/[0.06] transition-colors"
      >
        <Sparkles size={13} className="text-[#A14F44] shrink-0" />
        <span className="text-[12px] font-medium text-[#1e2d1f]/75">Вероятные связи по смыслу</span>
        {pairs && <span className="text-[10px] text-[#1e2d1f]/40 ml-auto">{pairs.length}</span>}
        {loading && <Loader2 size={13} className="animate-spin text-[#1e2d1f]/40 ml-auto" />}
      </button>

      {open && !loading && (
        <div className="px-3 pb-2.5">
          {pairs && pairs.length === 0 ? (
            <p className="text-[11px] text-[#1e2d1f]/45 py-2 leading-snug">
              Близких по смыслу несвязанных пар не нашлось. Сущности должны быть проэмбеддены (идёт в фоне).
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <p className="text-[10.5px] text-[#1e2d1f]/45 leading-snug mb-0.5">
                Близки по смыслу, но связь не отмечена — возможно, между ними есть отношение.
              </p>
              {(pairs ?? []).map(p => (
                <div key={key(p)} className="flex items-center gap-2 rounded-lg border border-[#1e2d1f]/8 bg-white/70 px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {dot(p.a.type)}<span className="text-[12px] text-[#1e2d1f]/80 truncate">{p.a.name}</span>
                    <Link2 size={11} className="text-[#1e2d1f]/30 shrink-0" />
                    {dot(p.b.type)}<span className="text-[12px] text-[#1e2d1f]/80 truncate">{p.b.name}</span>
                  </div>
                  <span className="text-[10px] text-[#1e2d1f]/35 shrink-0 tabular-nums">{Math.round(p.similarity * 100)}%</span>
                  <button
                    onClick={() => link(p)}
                    disabled={busy === key(p)}
                    title="Создать связь"
                    className="shrink-0 flex items-center justify-center w-6 h-6 rounded-md bg-[#4A5D4E]/10 text-[#4A5D4E] hover:bg-[#4A5D4E]/20 disabled:opacity-40 transition-colors"
                  >
                    {busy === key(p) ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />}
                  </button>
                  <button
                    onClick={() => hide(p)}
                    title="Скрыть"
                    className="shrink-0 flex items-center justify-center w-6 h-6 rounded-md text-[#1e2d1f]/40 hover:bg-[#1e2d1f]/[0.06] transition-colors"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
