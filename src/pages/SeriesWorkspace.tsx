/**
 * SeriesWorkspace — рабочее пространство серии (фронт-дверь, Этап P1).
 * Холст планирования: вёдра замысла (о чём / лор / герои — всё опционально) + книги серии
 * (написанные + слоты-план) + «Написать» (создать реальную книгу) + «Создать первую книгу».
 * Главный вход: клик по полке серии на дашборде. Заменяет старый пассивный экран/менеджер.
 */
import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, BookOpen, Plus, PenLine, Library, Globe, X, ScanLine, Loader2, CircleAlert, CircleDashed, CircleCheck } from 'lucide-react';
import { api } from '../services/api';
import { SeriesChat } from '../components/SeriesChat';

interface Slot { id: string; title: string; about?: string }
interface Thread { id: string; title: string; opensBook?: string; closesBook?: string; summary?: string }
interface Book { id: string; title: string; order: number | null; status: string }
interface SeriesData {
  series: { id: string; title: string; premise?: string | null; lore?: string | null; castNotes?: string | null; plannedBooks: Slot[]; franchiseThreads?: Thread[] };
  books: Book[];
}

export default function SeriesWorkspace() {
  const { seriesId } = useParams<{ seriesId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<SeriesData | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const saved = useRef<Record<string, string>>({});

  const [roster, setRoster] = useState<{ name: string; books: number[] }[]>([]);
  const [standalone, setStandalone] = useState<{ id: string; title: string }[]>([]);
  const [xray, setXray] = useState<Record<string, { status: string; note: string; lastBook: number | null }>>({});
  const [xrayBusy, setXrayBusy] = useState(false);
  const [xrayReason, setXrayReason] = useState<string | null>(null);
  const load = () => api.get<SeriesData>(`/series/${seriesId}`).then(d => { setData(d); setState('ok'); });
  const loadStandalone = () => api.get<{ projects: { id: string; title: string; status: string; seriesId: string | null }[] }>(`/projects`)
    .then(d => setStandalone((d.projects ?? []).filter(p => p.status === 'active' && !p.seriesId).map(p => ({ id: p.id, title: p.title })))).catch(() => {});
  useEffect(() => {
    let alive = true;
    api.get<SeriesData>(`/series/${seriesId}`).then(d => { if (alive) { setData(d); setState('ok'); } })
      .catch(() => { if (alive) setState('error'); });
    loadStandalone();
    // Ростер: постоянный состав — персонажи, встречающиеся в ≥2 книгах (выводим из агрегата серии).
    api.get<{ entities: { type: string; name: string; books: { order: number | null }[] }[] }>(`/series/${seriesId}/bible`)
      .then(d => {
        if (!alive) return;
        const recurring = (d.entities ?? [])
          .filter(e => e.type === 'character' && (e.books?.length ?? 0) >= 2)
          .map(e => ({ name: e.name, books: e.books.map(b => b.order ?? 0).filter(Boolean).sort((a, b) => a - b) }))
          .sort((a, b) => b.books.length - a.books.length);
        setRoster(recurring);
      }).catch(() => {});
    return () => { alive = false; };
  }, [seriesId]);

  if (state === 'loading') return <Center><div className="w-8 h-8 border-2 border-[#1e2d1f]/20 border-t-[#1e2d1f] rounded-full animate-spin" /></Center>;
  if (state === 'error' || !data) return <Center><p className="text-sm text-[#1e2d1f]/55">Не удалось загрузить серию.</p></Center>;

  const { series, books } = data;
  const slots = series.plannedBooks ?? [];

  const patch = (field: 'premise' | 'lore' | 'castNotes' | 'title', value: string) => {
    if (saved.current[field] === value) return;
    saved.current[field] = value;
    api.patch(`/series/${seriesId}`, { [field]: value }).catch(() => {});
  };
  const savePlanned = (next: Slot[]) => { setData(d => d && { ...d, series: { ...d.series, plannedBooks: next } }); api.patch(`/series/${seriesId}`, { plannedBooks: next }).catch(() => {}); };
  const addSlot = () => savePlanned([...slots, { id: crypto.randomUUID(), title: '', about: '' }]);
  const editSlot = (id: string, p: Partial<Slot>) => savePlanned(slots.map(s => s.id === id ? { ...s, ...p } : s));
  const removeSlot = (id: string) => savePlanned(slots.filter(s => s.id !== id));

  const threads = series.franchiseThreads ?? [];
  const saveThreads = (next: Thread[]) => { setData(d => d && { ...d, series: { ...d.series, franchiseThreads: next } }); api.patch(`/series/${seriesId}`, { franchiseThreads: next }).catch(() => {}); };
  const addThread = () => saveThreads([...threads, { id: crypto.randomUUID(), title: '', opensBook: '', closesBook: '', summary: '' }]);
  const editThread = (id: string, p: Partial<Thread>) => saveThreads(threads.map(t => t.id === id ? { ...t, ...p } : t));
  const removeThread = (id: string) => saveThreads(threads.filter(t => t.id !== id));

  // Рентген нитей: Перо читает написанные книги и проставляет статус каждой нити (провисает/в работе/отыграна).
  const runXray = async () => {
    setXrayBusy(true); setXrayReason(null);
    try {
      const d = await api.post<{ statuses: { threadId: string; status: string; note: string; lastBook: number | null }[]; reason?: string }>(`/series/${seriesId}/threads/xray`, {});
      const map: Record<string, { status: string; note: string; lastBook: number | null }> = {};
      (d.statuses ?? []).forEach(s => { map[s.threadId] = { status: s.status, note: s.note, lastBook: s.lastBook }; });
      setXray(map);
      if (d.reason) setXrayReason(d.reason);
    } catch { setXrayReason('Не удалось свериться. Попробуй ещё раз.'); }
    finally { setXrayBusy(false); }
  };

  // «Написать»: создать реальную книгу (из слота или новую) и открыть редактор.
  const writeBook = async (slotId?: string) => {
    setBusy(true);
    try {
      const { project } = await api.post<{ project: { id: string } }>(`/series/${seriesId}/books/create`, slotId ? { slotId } : {});
      navigate(`/editor/${project.id}`);
    } finally { setBusy(false); }
  };

  // Добавить уже существующую (отдельную) книгу в серию — сценарий «сгруппировать готовые книги».
  const addExisting = async (projectId: string) => {
    if (!projectId) return;
    setBusy(true);
    try { await api.post(`/series/${seriesId}/books`, { projectId }); await load(); await loadStandalone(); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-[#f5f0e8] text-[#1e2d1f]">
      <div className="max-w-3xl mx-auto px-5 py-8">
        <div className="flex items-center justify-between mb-5">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1 text-[13px] text-[#1e2d1f]/55 hover:text-[#1e2d1f]"><ChevronLeft size={15} /> К полкам</button>
          <button onClick={() => navigate(`/series/${seriesId}/world`)} className="flex items-center gap-1.5 text-[12px] text-[#1e2d1f]/55 hover:text-[#A14F44]"><Globe size={13} /> Единый Мир серии</button>
        </div>

        <div className="flex items-center gap-1.5 text-[#A14F44] mb-2 text-[12px] font-medium"><Library size={14} /> Серия — замысел</div>
        <input
          defaultValue={series.title}
          onBlur={e => patch('title', e.target.value.trim() || series.title)}
          className="font-serif text-3xl leading-tight mb-1 bg-transparent outline-none w-full"
        />
        <p className="text-[12px] text-[#1e2d1f]/45 mb-7">Набросай, о чём серия — или просто начни писать, мир соберётся по ходу.</p>

        {/* Вёдра замысла */}
        <Bucket label="О чём серия">
          <textarea defaultValue={series.premise ?? ''} onBlur={e => patch('premise', e.target.value)} rows={2}
            placeholder="Одна-две фразы о всей серии…"
            className="w-full bg-transparent text-[14px] italic text-[#1e2d1f]/85 placeholder:text-[#1e2d1f]/30 placeholder:not-italic outline-none resize-none" />
        </Bucket>
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <Bucket label="Мир / лор">
            <textarea defaultValue={series.lore ?? ''} onBlur={e => patch('lore', e.target.value)} rows={5}
              placeholder="Правила, места, фракции, история… или оставь — Перо соберёт из текста."
              className="w-full bg-transparent text-[12.5px] leading-relaxed text-[#1e2d1f]/80 placeholder:text-[#1e2d1f]/30 outline-none resize-none" />
          </Bucket>
          <Bucket label="Герои">
            <textarea defaultValue={series.castNotes ?? ''} onBlur={e => patch('castNotes', e.target.value)} rows={5}
              placeholder="Кто главные герои, чего хотят, тайны… тоже необязательно."
              className="w-full bg-transparent text-[12.5px] leading-relaxed text-[#1e2d1f]/80 placeholder:text-[#1e2d1f]/30 outline-none resize-none" />
          </Bucket>
        </div>

        {/* Ростер — постоянный состав, выводится из написанных книг */}
        {roster.length > 0 && (
          <div className="mb-3">
            <div className="text-[10.5px] font-bold uppercase tracking-widest text-[#A14F44] mb-1.5">Постоянный состав <span className="text-[#1e2d1f]/40 font-normal normal-case tracking-normal">— из книг (≥2)</span></div>
            <div className="flex flex-wrap gap-1.5">
              {roster.map(r => (
                <span key={r.name} className="inline-flex items-center gap-1 text-[12px] bg-[#A14F44]/[0.08] rounded-full px-2.5 py-1">
                  {r.name}<span className="text-[10px] text-[#1e2d1f]/40">кн. {r.books.join(',')}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Книги серии */}
        <div className="flex items-center justify-between mt-6 mb-3">
          <span className="text-[11px] font-bold uppercase tracking-widest text-[#A14F44]">Книги серии</span>
          {books.length === 0 && slots.length === 0 && (
            <button onClick={() => writeBook()} disabled={busy} className="flex items-center gap-1.5 bg-[#1e2d1f] text-[#f5f0e8] text-[12.5px] font-medium px-3.5 py-2 rounded-xl hover:bg-[#2a3f2b] disabled:opacity-50">
              <PenLine size={14} /> Создать первую книгу
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {books.map(b => (
            <button key={b.id} onClick={() => navigate(`/editor/${b.id}`)}
              className="group flex items-center gap-3 bg-white rounded-xl px-4 py-3 border border-[#1e2d1f]/5 hover:border-[#A14F44]/30 text-left transition-colors">
              <span className="text-[12px] text-[#1e2d1f]/35 w-5 tabular-nums">{b.order ?? '·'}</span>
              <BookOpen size={15} className="text-[#1e2d1f]/40 flex-shrink-0" />
              <span className="flex-1 min-w-0 truncate text-[14px] font-medium">{b.title}</span>
              <span className="text-[11px] text-[#1e2d1f]/40 group-hover:text-[#A14F44]">написана · открыть →</span>
            </button>
          ))}

          {slots.map((s, i) => (
            <div key={s.id} className="bg-white rounded-xl px-4 py-3 border border-dashed border-[#A14F44]/30">
              <div className="flex items-center gap-3 mb-1.5">
                <span className="text-[12px] text-[#A14F44]/60 w-5 tabular-nums">{books.length + i + 1}</span>
                <input value={s.title} onChange={e => editSlot(s.id, { title: e.target.value })} placeholder="Название книги (можно позже)"
                  className="flex-1 min-w-0 bg-transparent text-[14px] font-medium outline-none placeholder:text-[#1e2d1f]/30" />
                <button onClick={() => writeBook(s.id)} disabled={busy} className="flex-shrink-0 flex items-center gap-1.5 bg-[#1e2d1f] text-[#f5f0e8] text-[11.5px] font-medium px-3 py-1.5 rounded-lg hover:bg-[#2a3f2b] disabled:opacity-50">
                  <PenLine size={12} /> Написать
                </button>
                <button onClick={() => removeSlot(s.id)} className="flex-shrink-0 p-1 text-[#1e2d1f]/35 hover:text-[#A14F44]"><X size={14} /></button>
              </div>
              <input value={s.about ?? ''} onChange={e => editSlot(s.id, { about: e.target.value })} placeholder="о чём эта книга — станет премисом при создании"
                className="w-full bg-transparent text-[12px] text-[#1e2d1f]/65 outline-none pl-8 placeholder:text-[#1e2d1f]/30" />
            </div>
          ))}

          {(books.length > 0 || slots.length > 0) && (
            <button onClick={addSlot} className="flex items-center gap-2 text-[12.5px] text-[#1e2d1f]/45 hover:text-[#A14F44] px-4 py-2">
              <Plus size={14} /> книга — запланировать «о чём она»
            </button>
          )}
          {standalone.length > 0 && (
            <select value="" disabled={busy} onChange={e => addExisting(e.target.value)}
              className="self-start ml-4 bg-[#f5f0e8] rounded-lg px-2.5 py-1.5 text-[12px] text-[#1e2d1f]/65 outline-none border border-[#1e2d1f]/5">
              <option value="">+ добавить уже написанную книгу…</option>
              {standalone.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          )}
        </div>

        {/* Нити франшизы — сквозные ружья серии (авторский слой) + рентген по написанным книгам */}
        <div className="mt-8 mb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-widest text-[#A14F44]">Нити франшизы</span>
          <span className="text-[11px] text-[#1e2d1f]/40">сквозные ружья: открыта → закроется по книгам</span>
          {threads.some(t => t.title?.trim()) && (
            <button onClick={runXray} disabled={xrayBusy}
              className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#1e2d1f] text-[#f5f0e8] text-[11.5px] font-medium hover:bg-[#2a3f2b] disabled:opacity-50">
              {xrayBusy ? <Loader2 size={12} className="animate-spin" /> : <ScanLine size={12} />}
              {Object.keys(xray).length ? 'Рентген заново' : 'Рентген нитей'}
            </button>
          )}
        </div>
        {xrayReason && <p className="text-[12px] text-[#1e2d1f]/50 bg-[#1e2d1f]/[0.03] rounded-lg px-3 py-2 mb-2">{xrayReason}</p>}
        <div className="flex flex-col gap-2">
          {threads.map(t => (
            <div key={t.id} className="bg-white rounded-xl px-4 py-3 border border-[#1e2d1f]/5">
              <div className="flex items-center gap-2 mb-1.5">
                <input value={t.title} onChange={e => editThread(t.id, { title: e.target.value })} placeholder="Название нити (тайна, обещание, ружьё…)"
                  className="flex-1 min-w-0 bg-transparent text-[14px] font-medium outline-none placeholder:text-[#1e2d1f]/30" />
                <span className="text-[11px] text-[#1e2d1f]/40 flex-shrink-0">кн.</span>
                <input value={t.opensBook ?? ''} onChange={e => editThread(t.id, { opensBook: e.target.value })} placeholder="1"
                  className="w-8 bg-[#f5f0e8] rounded text-center text-[12px] outline-none" />
                <span className="text-[11px] text-[#1e2d1f]/40 flex-shrink-0">→</span>
                <input value={t.closesBook ?? ''} onChange={e => editThread(t.id, { closesBook: e.target.value })} placeholder="?"
                  className="w-8 bg-[#f5f0e8] rounded text-center text-[12px] outline-none" />
                <button onClick={() => removeThread(t.id)} className="flex-shrink-0 p-1 text-[#1e2d1f]/35 hover:text-[#A14F44]"><X size={14} /></button>
              </div>
              <input value={t.summary ?? ''} onChange={e => editThread(t.id, { summary: e.target.value })} placeholder="о чём нить — что повесил и чем выстрелит"
                className="w-full bg-transparent text-[12px] text-[#1e2d1f]/65 outline-none placeholder:text-[#1e2d1f]/30" />
              {xray[t.id] && <ThreadStatus x={xray[t.id]} />}
            </div>
          ))}
          <button onClick={addThread} className="flex items-center gap-2 text-[12.5px] text-[#1e2d1f]/45 hover:text-[#A14F44] px-4 py-2">
            <Plus size={14} /> нить франшизы
          </button>
        </div>

        <div className="mt-8 mb-2 text-[11px] uppercase tracking-wider text-[#1e2d1f]/40 font-semibold">Брейншторм</div>
        <SeriesChat seriesId={seriesId!} />

        <p className="text-[11px] text-[#1e2d1f]/40 mt-6">«Написать» → создаётся реальная книга (премис из «о чём»), открывается в редакторе с миром серии под рукой. Нити — твой план франшизы; статусы «провисает/отыграна» Перо проставит, прочитав книги (позже).</p>
      </div>
    </div>
  );
}

function Bucket({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-[10.5px] font-bold uppercase tracking-widest text-[#A14F44] mb-1.5">{label}</div>
      <div className="bg-white rounded-xl px-3.5 py-3 border border-[#1e2d1f]/5">{children}</div>
    </div>
  );
}
// Статус-чип нити после рентгена: провисает / в работе / отыграна + заметка Перо.
const XRAY_META: Record<string, { label: string; color: string; bg: string; Icon: typeof CircleAlert }> = {
  dangling: { label: 'Провисает', color: '#9E4338', bg: 'rgba(158,67,56,0.08)',  Icon: CircleAlert },
  active:   { label: 'В работе',  color: '#91682E', bg: 'rgba(145,104,46,0.08)', Icon: CircleDashed },
  resolved: { label: 'Отыграна',  color: '#4D6A4D', bg: 'rgba(77,106,77,0.08)',  Icon: CircleCheck },
};
function ThreadStatus({ x }: { x: { status: string; note: string; lastBook: number | null } }) {
  const m = XRAY_META[x.status] ?? XRAY_META.dangling;
  return (
    <div className="mt-2 flex items-start gap-2 rounded-lg px-2.5 py-1.5" style={{ background: m.bg }}>
      <span className="flex items-center gap-1 text-[10.5px] font-semibold flex-shrink-0 mt-px" style={{ color: m.color }}>
        <m.Icon size={12} /> {m.label}{x.lastBook ? ` · кн.${x.lastBook}` : ''}
      </span>
      {x.note && <span className="text-[11.5px] text-[#1e2d1f]/65 leading-snug">{x.note}</span>}
    </div>
  );
}
function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#f5f0e8] flex items-center justify-center px-6 text-center">{children}</div>;
}
