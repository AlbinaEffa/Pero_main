/**
 * CommentsGutter — единый «слой полей» (режим рецензирования). Показывает в правом поле,
 * выровненными по строке-якорю, ДВА источника аннотаций (Фаза 3):
 *   • author — твои комментарии (охра), якорь = марка `.comment-mark[data-comment-id]`;
 *   • pero   — находки Перо / нестыковки (терракота), якорь = подсветка `.contradiction-mark`
 *              (сопоставление по цитате).
 * Сверху — фильтр «Все / Мои / Перо». Карточки при перекрытии расталкиваются вниз; пересчёт
 * на scroll/resize/правку + ResizeObserver (ловит сворачивание спутника / резерв поля).
 *
 * Активная карточка раскрыта: author — редактор тела + Решено/В заметки/удалить;
 * pero — текст нестыковки + Открыть героя / Отклонить (находку Перо не «редактируют» — на неё
 * реагируют).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Trash2, StickyNote, Sparkles, ArrowRight, X, CornerDownLeft } from 'lucide-react';
import type { Editor as TiptapEditor } from '@tiptap/react';

export interface GutterReply { id: string; body: string; author: 'author' | 'pero'; createdAt: string; }
export interface GutterItem {
  id: string;
  source: 'author' | 'pero';
  body: string;            // тело комментария | текст нестыковки
  quote: string;           // текст-якорь
  resolved?: boolean;
  replies?: GutterReply[];    // author: тред ответов (как в Word)
  entityName?: string | null; // pero
  severity?: string;          // pero: high|medium|low
}

const ACCENT = { author: '#91682E', pero: '#A14F44' } as const;
const SEV_COLOR: Record<string, string> = { high: '#9E4338', medium: '#91682E', low: '#54627F' };
const SEV_LABEL: Record<string, string> = { high: 'высокая', medium: 'средняя', low: 'низкая' };
const GAP_X = 28;
const CARD_W = 300;
const MIN_ROOM = 248;
const PAD_TOP = 92;
const GAP_Y = 10;
const H_ACTIVE = 200, H_FOLDED = 78;
const BOTTOM_RESERVE = 96;

type Filter = 'all' | 'author' | 'pero';

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
function plural(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'ответ';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'ответа';
  return 'ответов';
}

interface Props {
  editor: TiptapEditor;
  items: GutterItem[];
  activeId: string | null;
  onActivate: (id: string | null) => void;
  // author
  onSave: (id: string, body: string) => void;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  onToNote: (id: string) => void;
  onReply: (id: string, body: string) => void;
  // pero
  onDismissPero: (id: string) => void;
  onOpenEntity: (name: string) => void;
}

export function CommentsGutter({ editor, items, activeId, onActivate, onSave, onResolve, onDelete, onToNote, onReply, onDismissPero, onOpenEntity }: Props) {
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  const [tops, setTops] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const raf = useRef(0);

  const authorN = items.filter(i => i.source === 'author').length;
  const peroN = items.filter(i => i.source === 'pero').length;
  const visible = useMemo(
    () => items.filter(i => filter === 'all' || i.source === filter),
    [items, filter],
  );

  const measure = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    const dom = editor.view.dom as HTMLElement;
    const main = dom.closest('main') as HTMLElement | null;
    if (!main) return;
    const col = dom.getBoundingClientRect();
    const mainR = main.getBoundingClientRect();
    // Защита от мусорной геометрии (layout ещё не устаканился / фон-вкладка): не трогаем box,
    // ждём следующего пересчёта — иначе карточки уезжают в (0,0).
    if (window.innerWidth < 500 || col.width < 120 || mainR.width < 200 || col.right < 120) return;
    const avail = mainR.right - col.right - GAP_X - 12;
    if (avail < MIN_ROOM) { setBox(null); return; }

    const width = Math.min(CARD_W, avail);
    const left = col.right + GAP_X;

    // Якоря: первая марка-комментарий по id; первая подсветка-нестыковка по тексту цитаты.
    const commentTopById = new Map<string, number>();
    dom.querySelectorAll('.comment-mark[data-comment-id]').forEach(el => {
      const cid = el.getAttribute('data-comment-id');
      if (cid && !commentTopById.has(cid)) commentTopById.set(cid, el.getBoundingClientRect().top);
    });
    const contradictionTopByText = new Map<string, number>();
    dom.querySelectorAll('.contradiction-mark').forEach(el => {
      const key = norm(el.textContent || '');
      if (key && !contradictionTopByText.has(key)) contradictionTopByText.set(key, el.getBoundingClientRect().top);
    });
    const peroAnchor = (quote: string): number | undefined => {
      const q = norm(quote);
      if (!q) return undefined;
      if (contradictionTopByText.has(q)) return contradictionTopByText.get(q);
      // запасное сопоставление: подсветка входит в цитату или наоборот
      for (const [text, top] of contradictionTopByText) {
        if (q.includes(text) || text.includes(q)) return top;
      }
      return undefined;
    };

    const measured: { id: string; anchor: number; replies: number }[] = [];
    for (const it of visible) {
      const anchor = it.source === 'author' ? commentTopById.get(it.id) : peroAnchor(it.quote);
      if (anchor == null) continue;
      measured.push({ id: it.id, anchor, replies: it.replies?.length ?? 0 });
    }
    measured.sort((a, b) => a.anchor - b.anchor);

    const vh = window.innerHeight;
    const next: Record<string, number> = {};
    let last = PAD_TOP - GAP_Y;
    for (const it of measured) {
      const h = it.id === activeId ? H_ACTIVE + it.replies * 46 : H_FOLDED;
      let t = Math.max(it.anchor, last + GAP_Y);
      t = Math.min(t, vh - BOTTOM_RESERVE - h);
      t = Math.max(t, PAD_TOP);
      next[it.id] = t;
      last = t + h;
    }
    setBox({ left, width });
    setTops(next);
  }, [editor, visible, activeId]);

  useEffect(() => {
    measure();
    const tick = () => { cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(measure); };
    const dom = editor?.view?.dom as HTMLElement | undefined;
    const scroller = dom?.closest('.overflow-y-auto');
    const main = dom?.closest('main');
    scroller?.addEventListener('scroll', tick, { passive: true });
    window.addEventListener('resize', tick);
    editor?.on('update', tick);
    const ro = new ResizeObserver(tick);
    if (dom) ro.observe(dom);
    if (main) ro.observe(main);
    // Отложенные пересчёты — layout/резерв поля устаканиваются уже после первого кадра.
    const timers = [100, 400, 1000].map(ms => setTimeout(measure, ms));
    return () => {
      scroller?.removeEventListener('scroll', tick);
      window.removeEventListener('resize', tick);
      editor?.off('update', tick);
      ro.disconnect();
      cancelAnimationFrame(raf.current);
      timers.forEach(clearTimeout);
    };
  }, [measure, editor]);

  if (!box) return null;

  const byId = new Map(items.map(i => [i.id, i]));

  return createPortal(
    <div className="fixed inset-0 pointer-events-none z-[45]">
      {/* Фильтр источников — только если есть оба типа */}
      {authorN > 0 && peroN > 0 && (
        <div
          style={{ position: 'fixed', left: box.left, top: PAD_TOP - 38, width: box.width }}
          className="pointer-events-auto flex items-center gap-1 rounded-lg bg-white/90 backdrop-blur-sm border border-[#1e2d1f]/10 shadow-sm p-0.5 w-fit"
        >
          {([['all', `Все · ${authorN + peroN}`], ['author', `Мои · ${authorN}`], ['pero', `Перо · ${peroN}`]] as const).map(([f, label]) => (
            <button
              key={f}
              onMouseDown={(e) => { e.preventDefault(); setFilter(f); }}
              className={`text-[11px] rounded-md px-2 py-1 transition-colors ${filter === f ? 'bg-[#1e2d1f] text-white' : 'text-[#1e2d1f]/55 hover:text-[#1e2d1f]'}`}
            >{label}</button>
          ))}
        </div>
      )}

      {Object.entries(tops).map(([id, top]) => {
        const item = byId.get(id);
        if (!item) return null;
        const common = { item, active: id === activeId, left: box!.left, top, width: box!.width, editor, onActivate };
        return item.source === 'pero'
          ? <PeroCard key={id} {...common} onDismiss={onDismissPero} onOpenEntity={onOpenEntity} />
          : <AuthorCard key={id} {...common} onSave={onSave} onResolve={onResolve} onDelete={onDelete} onToNote={onToNote} onReply={onReply} />;
      })}
    </div>,
    document.body,
  );
}

// ── Общий каркас позиционирования + скролл-к-якорю при активации ────────────────
function useAnchorScroll(active: boolean, editor: TiptapEditor, item: GutterItem) {
  useEffect(() => {
    if (!active) return;
    const dom = editor.view.dom;
    const el = item.source === 'author'
      ? dom.querySelector(`.comment-mark[data-comment-id="${item.id}"]`)
      : [...dom.querySelectorAll('.contradiction-mark')].find(n => norm(n.textContent || '') === norm(item.quote))
        || [...dom.querySelectorAll('.contradiction-mark')].find(n => norm(item.quote).includes(norm(n.textContent || '')));
    (el as HTMLElement | undefined)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active, editor, item]);
}

// ── Авторская карточка ──────────────────────────────────────────────────────────
function AuthorCard({ item, active, left, top, width, editor, onActivate, onSave, onResolve, onDelete, onToNote, onReply }: {
  item: GutterItem; active: boolean; left: number; top: number; width: number; editor: TiptapEditor;
  onActivate: (id: string | null) => void;
  onSave: (id: string, body: string) => void; onResolve: (id: string) => void; onDelete: (id: string) => void; onToNote: (id: string) => void;
  onReply: (id: string, body: string) => void;
}) {
  const accent = ACCENT.author;
  const [body, setBody] = useState(item.body);
  const [reply, setReply] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const replies = item.replies ?? [];
  useEffect(() => { if (!active) setBody(item.body); }, [item.body, active]);
  useAnchorScroll(active, editor, item);
  useEffect(() => { if (active) { const t = setTimeout(() => taRef.current?.focus(), 60); return () => clearTimeout(t); } }, [active]);
  const commit = () => { if (body.trim() !== item.body.trim()) onSave(item.id, body.trim()); };
  const sendReply = () => { const b = reply.trim(); if (!b) return; onReply(item.id, b); setReply(''); };

  if (!active) {
    return (
      <button onMouseDown={(e) => { e.preventDefault(); onActivate(item.id); }} style={{ position: 'fixed', left, top, width }}
        className="pointer-events-auto text-left bg-white border border-[#1e2d1f]/10 rounded-xl shadow-[0_4px_16px_rgba(30,45,31,0.06)] px-3 py-2.5 hover:shadow-[0_6px_20px_rgba(30,45,31,0.1)] hover:border-[#1e2d1f]/18 transition-all">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: accent }} />
          <span className="text-[9.5px] font-bold uppercase tracking-wider" style={{ color: accent }}>Комментарий</span>
          {replies.length > 0 && <span className="ml-auto text-[10px] text-[#1e2d1f]/40">{replies.length} {plural(replies.length)}</span>}
        </div>
        {item.body
          ? <div className="text-[12.5px] leading-snug text-[#1e2d1f]/85 line-clamp-3">{item.body}</div>
          : <div className="font-serif text-[12px] italic text-[#1e2d1f]/45 line-clamp-2">«{item.quote}»</div>}
      </button>
    );
  }
  return (
    <div style={{ position: 'fixed', left, top, width }} onMouseDown={(e) => e.stopPropagation()}
      className="pointer-events-auto bg-white border rounded-xl shadow-[0_10px_30px_rgba(30,45,31,0.14)] overflow-hidden">
      <div className="h-[3px]" style={{ background: accent }} />
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5">
        <span className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wider" style={{ color: accent }}><StickyNote size={11} /> Комментарий</span>
      </div>
      {item.quote && (
        <div className="px-3 pb-1.5">
          <div className="font-serif text-[12px] italic text-[#1e2d1f]/60 rounded-r-md pl-2 py-0.5" style={{ borderLeft: `2px solid ${accent}66` }}>
            «{item.quote.length > 80 ? item.quote.slice(0, 80) + '…' : item.quote}»
          </div>
        </div>
      )}
      <div className="px-3 pb-2">
        <textarea ref={taRef} value={body} onChange={(e) => setBody(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); onActivate(null); } }}
          rows={3} placeholder="Заметка к этому месту…"
          className="w-full resize-none text-[13px] leading-relaxed text-[#1e2d1f] bg-[#1e2d1f]/[0.03] rounded-lg px-2.5 py-2 outline-none focus:bg-[#1e2d1f]/[0.05] placeholder:text-[#1e2d1f]/30" />
      </div>

      {/* Тред ответов (как в Word) */}
      {replies.length > 0 && (
        <div className="px-3 pb-1.5 space-y-2">
          {replies.map(r => (
            <div key={r.id} className="pl-2.5 border-l-2" style={{ borderColor: `${ACCENT[r.author] ?? accent}40` }}>
              <div className="text-[9px] font-bold uppercase tracking-wider mb-0.5" style={{ color: ACCENT[r.author] ?? accent }}>
                {r.author === 'pero' ? 'Перо' : 'Ответ'}
              </div>
              <div className="text-[12.5px] leading-snug text-[#1e2d1f]/85 whitespace-pre-wrap">{r.body}</div>
            </div>
          ))}
        </div>
      )}

      {/* Поле ответа */}
      <div className="px-3 pb-2 flex items-end gap-1.5">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
          rows={1} placeholder="Ответить…"
          className="flex-1 resize-none text-[12.5px] leading-snug text-[#1e2d1f] bg-[#1e2d1f]/[0.03] rounded-lg px-2.5 py-1.5 outline-none focus:bg-[#1e2d1f]/[0.05] placeholder:text-[#1e2d1f]/30"
        />
        <button onMouseDown={(e) => { e.preventDefault(); sendReply(); }} disabled={!reply.trim()}
          title="Ответить (Enter)"
          className="flex-shrink-0 p-1.5 rounded-lg text-white disabled:opacity-30 transition-opacity" style={{ background: accent }}><CornerDownLeft size={13} /></button>
      </div>

      <div className="flex items-center gap-0.5 px-2 pb-2 pt-0.5 border-t border-[#1e2d1f]/6">
        <button onMouseDown={(e) => { e.preventDefault(); onResolve(item.id); }} className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4A5D4E] hover:bg-[#4A5D4E]/10 px-2 py-1.5 rounded-lg transition-colors"><Check size={12} /> Решено</button>
        <button onMouseDown={(e) => { e.preventDefault(); onToNote(item.id); }} className="inline-flex items-center gap-1 text-[11px] font-medium text-[#1e2d1f]/55 hover:text-[#91682E] hover:bg-[#91682E]/10 px-2 py-1.5 rounded-lg transition-colors"><StickyNote size={12} /> В заметки</button>
        <button onMouseDown={(e) => { e.preventDefault(); onDelete(item.id); }} className="ml-auto inline-flex items-center text-[#1e2d1f]/45 hover:text-[#9E4338] hover:bg-[#9E4338]/10 px-2 py-1.5 rounded-lg transition-colors"><Trash2 size={12} /></button>
      </div>
    </div>
  );
}

// ── Карточка Перо (нестыковка) ──────────────────────────────────────────────────
function PeroCard({ item, active, left, top, width, editor, onActivate, onDismiss, onOpenEntity }: {
  item: GutterItem; active: boolean; left: number; top: number; width: number; editor: TiptapEditor;
  onActivate: (id: string | null) => void; onDismiss: (id: string) => void; onOpenEntity: (name: string) => void;
}) {
  const accent = ACCENT.pero;
  const sevColor = SEV_COLOR[item.severity || 'medium'] ?? accent;
  useAnchorScroll(active, editor, item);

  if (!active) {
    return (
      <button onMouseDown={(e) => { e.preventDefault(); onActivate(item.id); }} style={{ position: 'fixed', left, top, width }}
        className="pointer-events-auto text-left bg-white border border-[#1e2d1f]/10 rounded-xl shadow-[0_4px_16px_rgba(30,45,31,0.06)] px-3 py-2.5 hover:shadow-[0_6px_20px_rgba(30,45,31,0.1)] hover:border-[#1e2d1f]/18 transition-all">
        <div className="flex items-center gap-1.5 mb-1">
          <Sparkles size={11} style={{ color: accent }} className="flex-shrink-0" />
          <span className="text-[9.5px] font-bold uppercase tracking-wider" style={{ color: accent }}>Перо · нестыковка</span>
        </div>
        <div className="text-[12.5px] leading-snug text-[#1e2d1f]/85 line-clamp-3">
          {item.entityName ? <span className="font-semibold">{item.entityName}: </span> : null}{item.body}
        </div>
      </button>
    );
  }
  return (
    <div style={{ position: 'fixed', left, top, width }} onMouseDown={(e) => e.stopPropagation()}
      className="pointer-events-auto bg-white border rounded-xl shadow-[0_10px_30px_rgba(30,45,31,0.14)] overflow-hidden">
      <div className="h-[3px]" style={{ background: accent }} />
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5">
        <span className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wider" style={{ color: accent }}><Sparkles size={11} /> Перо · нестыковка</span>
        {item.severity && <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 ml-auto" style={{ color: sevColor, background: `${sevColor}1f` }}>{SEV_LABEL[item.severity] ?? ''}</span>}
      </div>
      <div className="px-3 pb-2 text-[13px] leading-relaxed text-[#1e2d1f]">
        {item.entityName ? <button onMouseDown={(e) => { e.preventDefault(); onOpenEntity(item.entityName!); }} className="font-semibold hover:underline">{item.entityName}: </button> : null}
        {item.body}
      </div>
      {item.quote && (
        <div className="px-3 pb-1.5">
          <div className="font-serif text-[12px] italic text-[#1e2d1f]/60 rounded-r-md pl-2 py-0.5" style={{ borderLeft: `2px solid ${accent}66` }}>
            «{item.quote.length > 80 ? item.quote.slice(0, 80) + '…' : item.quote}»
          </div>
        </div>
      )}
      <div className="flex items-center gap-0.5 px-2 pb-2 pt-0.5 border-t border-[#1e2d1f]/6">
        {item.entityName && (
          <button onMouseDown={(e) => { e.preventDefault(); onOpenEntity(item.entityName!); }} className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4A5D4E] hover:bg-[#4A5D4E]/10 px-2 py-1.5 rounded-lg transition-colors"><ArrowRight size={12} /> Открыть в Мире</button>
        )}
        <button onMouseDown={(e) => { e.preventDefault(); onDismiss(item.id); }} className="ml-auto inline-flex items-center gap-1 text-[11px] text-[#1e2d1f]/45 hover:text-[#9E4338] hover:bg-[#9E4338]/10 px-2 py-1.5 rounded-lg transition-colors"><X size={12} /> Отклонить</button>
      </div>
    </div>
  );
}
