/**
 * ThreadsLens — «Линии»: сквозные сюжетные линии + «ружья Чехова».
 * Перо читает синопсисы глав и показывает линии книги: где введены, докуда тянутся,
 * выстрелило ли «ружьё». Открытые (resolved=false) — на виду: это незакрытые обещания.
 */
import { useState } from 'react';
import { Loader2, RefreshCw, X, ArrowRight, Target, CheckCircle2, RotateCcw, Plus } from 'lucide-react';

export interface PlotThread {
  id: string;
  title: string;
  summary: string | null;
  kind: string;
  resolved: boolean;
  introChapterId: string | null;
  introChapterTitle: string | null;
  lastChapterId: string | null;
  lastChapterTitle: string | null;
  chapterIds: string[];
  characterNames?: string[];
  entityIds?: string[];
  origin?: string;   // 'ai' | 'author'
}

const KIND: Record<string, { label: string; color: string }> = {
  main:         { label: 'основная',   color: '#A14F44' },
  subplot:      { label: 'подсюжет',   color: '#4A5D4E' },
  mystery:      { label: 'тайна',      color: '#71597F' },
  promise:      { label: 'обещание',   color: '#91682E' },
  relationship: { label: 'отношения',  color: '#54627F' },
};
const kindOf = (k: string) => KIND[k] ?? KIND.subplot;

interface Props {
  threads: PlotThread[];
  orderedChapterIds: string[];   // для шкалы охвата
  scanning: boolean;
  onScan: () => void;
  onJump: (chapterId: string) => void;
  onDismiss: (threadId: string) => void;
  onToggleResolved: (threadId: string, resolved: boolean) => void;
  onOpenEntity?: (name: string) => void;
  entityNames?: Set<string>;   // имена, существующие в Мире (для кликабельности)
  onAddThread?: (data: { title: string; kind: string; summary: string }) => void;
  onEditThread?: (threadId: string, data: { title?: string; summary?: string; kind?: string }) => void;
}

const KIND_OPTIONS = Object.entries(KIND).map(([id, v]) => ({ id, label: v.label }));

export function ThreadsLens({ threads, orderedChapterIds, scanning, onScan, onJump, onDismiss, onToggleResolved, onOpenEntity, entityNames, onAddThread, onEditThread }: Props) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: '', kind: 'subplot', summary: '' });
  const total = Math.max(orderedChapterIds.length, 1);
  const indexOf = (id: string | null) => (id ? orderedChapterIds.indexOf(id) : -1);

  const open = threads.filter(t => !t.resolved);
  const resolved = threads.filter(t => t.resolved);

  const renderThread = (t: PlotThread) => {
    const k = kindOf(t.kind);
    const introIdx = indexOf(t.introChapterId);
    const lastIdx = Math.max(indexOf(t.lastChapterId), introIdx);
    const left = introIdx >= 0 ? (introIdx / total) * 100 : 0;
    const width = introIdx >= 0 ? ((lastIdx - introIdx + 1) / total) * 100 : 0;
    return (
      <div key={t.id} className={`rounded-xl border p-3 ${t.origin === 'author' ? 'border-[#71597F]/25 bg-[#71597F]/[0.04]' : 'border-[#1e2d1f]/8 bg-white/40'}`}>
        <div className="flex items-start gap-2">
          <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 mt-0.5 flex-shrink-0" style={{ color: k.color, background: `${k.color}1f` }}>{k.label}</span>
          <div className="flex-1 min-w-0">
            {t.origin === 'author' && onEditThread ? (
              <>
                <input defaultValue={t.title} placeholder="Название линии"
                  onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== t.title) onEditThread(t.id, { title: e.target.value.trim() }); }}
                  className="w-full text-[13.5px] font-semibold text-[#1e2d1f] bg-transparent rounded px-1 -ml-1 outline-none border border-transparent hover:border-[#1e2d1f]/10 focus:border-[#71597F]/40 focus:bg-white/50 transition-colors" />
                <textarea defaultValue={t.summary || ''} placeholder="В чём линия? (замысел)" rows={1}
                  onBlur={(e) => { if ((e.target.value.trim() || null) !== (t.summary || null)) onEditThread(t.id, { summary: e.target.value }); }}
                  className="w-full text-[13px] text-[#1e2d1f]/65 leading-snug bg-transparent rounded px-1 -ml-1 mt-0.5 resize-none outline-none border border-transparent hover:border-[#1e2d1f]/10 focus:border-[#71597F]/40 focus:bg-white/50 transition-colors placeholder:text-[#1e2d1f]/30 field-sizing-content" />
              </>
            ) : (
              <>
                <div className="text-[14px] font-semibold text-[#1e2d1f] leading-snug">{t.title}</div>
                {t.summary && <div className="text-[13px] text-[#1e2d1f]/55 leading-snug mt-0.5">{t.summary}</div>}
              </>
            )}
          </div>
          {t.origin === 'author' && <span title="Авторская план-линия" className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 mt-0.5 flex-shrink-0 text-[#71597F] bg-[#71597F]/12">план</span>}
          {!t.resolved
            ? <span title="Линия не закрыта — ружьё ещё не выстрелило" className="flex items-center gap-1 text-[10px] text-[#91682E] flex-shrink-0"><Target size={12} /> открыта</span>
            : <span title="Линия разрешена" className="flex items-center gap-1 text-[10px] text-[#4A5D4E] flex-shrink-0"><CheckCircle2 size={12} /> закрыта</span>}
        </div>

        {/* Герои линии → Мир */}
        {t.characterNames && t.characterNames.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 mt-2">
            {t.characterNames.map(name => {
              const known = onOpenEntity && (!entityNames || entityNames.has(name.trim().toLowerCase()));
              return known
                ? <button key={name} onClick={() => onOpenEntity!(name)} title="Открыть в Мире" className="text-[10.5px] text-[#A14F44] bg-[#A14F44]/10 rounded-full px-2 py-0.5 hover:bg-[#A14F44]/20 transition-colors">{name}</button>
                : <span key={name} className="text-[10.5px] text-[#1e2d1f]/45 bg-[#1e2d1f]/[0.05] rounded-full px-2 py-0.5">{name}</span>;
            })}
          </div>
        )}

        {/* Шкала охвата по книге */}
        {introIdx >= 0 && (
          <div className="mt-2 h-1.5 w-full rounded-full bg-[#1e2d1f]/8 overflow-hidden">
            <div className="h-full rounded-full" style={{ marginLeft: `${left}%`, width: `${Math.max(width, 2)}%`, background: k.color, opacity: t.resolved ? 0.45 : 0.85 }} />
          </div>
        )}

        <div className="flex items-center gap-1 mt-2 text-[11px]">
          {t.introChapterId && (
            <button onClick={() => onJump(t.introChapterId!)} className="inline-flex items-center gap-1 text-[#4A5D4E] font-medium hover:underline">
              <ArrowRight size={12} /> {introIdx >= 0 ? `гл.${introIdx + 1}` : 'начало'}{lastIdx > introIdx ? ` → гл.${lastIdx + 1}` : ''}
            </button>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            <button onClick={() => onToggleResolved(t.id, !t.resolved)} className="inline-flex items-center gap-1 text-[#1e2d1f]/45 hover:text-[#4A5D4E] px-2 py-1 rounded-md hover:bg-[#1e2d1f]/5 transition-colors">
              {t.resolved ? <><RotateCcw size={11} /> Открыть</> : <><CheckCircle2 size={11} /> Закрыта</>}
            </button>
            <button onClick={() => onDismiss(t.id)} title="Не линия / ложное" className="inline-flex items-center gap-1 text-[#1e2d1f]/45 hover:text-[#9E4338] px-2 py-1 rounded-md hover:bg-[#1e2d1f]/5 transition-colors"><X size={11} /></button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Шапка-скан */}
      <div className="flex items-center gap-3 pb-3 mb-2 border-b border-[#1e2d1f]/8 flex-shrink-0">
        <div className="flex-1 min-w-0">
          {scanning ? (
            <div className="text-[13px] font-semibold text-[#1e2d1f] flex items-center gap-1.5"><Loader2 size={13} className="animate-spin text-[#71597F]" /> Перо читает синопсисы…</div>
          ) : (
            <>
              <div className="text-[13px] font-semibold text-[#1e2d1f]">{threads.length ? `${open.length} открытых · ${resolved.length} закрытых` : 'Линии ещё не найдены'}</div>
              <div className="text-[11px] text-[#1e2d1f]/50">сквозные линии по синопсисам глав</div>
            </>
          )}
        </div>
        {onAddThread && (
          <button onClick={() => setAdding(v => !v)} title="Запланировать линию вручную" className="inline-flex items-center gap-1 text-[12px] font-medium text-[#71597F] bg-[#71597F]/10 rounded-lg px-2.5 py-2 hover:bg-[#71597F]/20 transition-colors flex-shrink-0">
            <Plus size={13} /> Линия
          </button>
        )}
        <button onClick={onScan} disabled={scanning} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-[#1e2d1f] rounded-lg px-3 py-2 disabled:opacity-50 hover:bg-[#2a3f2b] transition-colors flex-shrink-0">
          <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} /> {threads.length ? 'Обновить' : 'Найти линии'}
        </button>
      </div>

      {/* Форма добавления план-линии */}
      {adding && onAddThread && (
        <div className="mb-3 p-3 rounded-xl border border-[#71597F]/20 bg-[#71597F]/[0.04] flex-shrink-0">
          <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Название линии (напр. «Тайна крыльев Ризанда»)"
            className="w-full text-[13px] font-medium bg-white/60 rounded-md px-2.5 py-1.5 mb-2 outline-none border border-transparent focus:border-[#71597F]/40" />
          <textarea value={draft.summary} onChange={e => setDraft({ ...draft, summary: e.target.value })} placeholder="В чём линия? (замысел)" rows={2}
            className="w-full text-[12px] bg-white/60 rounded-md px-2.5 py-1.5 mb-2 outline-none border border-transparent focus:border-[#71597F]/40 resize-none" />
          <div className="flex items-center gap-2 flex-wrap">
            <select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value })} className="text-[12px] bg-white/60 rounded-md px-2 py-1.5 outline-none border border-transparent focus:border-[#71597F]/40">
              {KIND_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <button
              onClick={() => { if (draft.title.trim()) { onAddThread({ title: draft.title.trim(), kind: draft.kind, summary: draft.summary.trim() }); setDraft({ title: '', kind: 'subplot', summary: '' }); setAdding(false); } }}
              disabled={!draft.title.trim()}
              className="ml-auto text-[12px] font-semibold text-white bg-[#1e2d1f] rounded-lg px-3 py-1.5 disabled:opacity-40 hover:bg-[#2a3f2b] transition-colors">Добавить</button>
            <button onClick={() => setAdding(false)} className="text-[12px] text-[#1e2d1f]/50 hover:text-[#1e2d1f]">Отмена</button>
          </div>
        </div>
      )}

      {/* Список */}
      <div className="flex-1 overflow-y-auto -mx-1 px-1">
        {threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-[#71597F]/8 flex items-center justify-center mb-4"><Target size={24} className="text-[#71597F]" /></div>
            <p className="text-[14px] text-[#1e2d1f]/60 max-w-[280px] leading-relaxed">{scanning ? 'Перо собирает сюжетные линии…' : 'Перо найдёт сквозные линии и незакрытые «ружья Чехова» по синопсисам глав.'}</p>
          </div>
        ) : (
          <div className="space-y-4 pb-4">
            {open.length > 0 && (
              <div>
                <div className="text-[10.5px] uppercase tracking-wider text-[#91682E] font-semibold mb-2">Открытые · {open.length}</div>
                <div className="space-y-2.5">{open.map(renderThread)}</div>
              </div>
            )}
            {resolved.length > 0 && (
              <div>
                <div className="text-[10.5px] uppercase tracking-wider text-[#4A5D4E] font-semibold mb-2">Закрытые · {resolved.length}</div>
                <div className="space-y-2.5">{resolved.map(renderThread)}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
