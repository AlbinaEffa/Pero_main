/**
 * BeatsLens — «Канва»: бит-лист (Романс-бит / Save the Cat / Три акта).
 * ДВА слоя у каждого бита:
 *  • план (авторский замысел) — заполняется как анкета, ДАЖЕ до первой строки текста;
 *  • рентген (ИИ-детект) — какая глава отыгрывает бит + дрейф позиции.
 * Перо не пишет план за автора — оно сверяет задуманное с написанным.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Sparkle, Plus, X, Trash2 } from 'lucide-react';
import { api } from '../../services/api';
import { Chapter } from './types';

interface Beat { key: string; label: string; pct: number; plan?: string | null; chapterId: string | null; chapterTitle: string | null; note?: string }
interface BeatDef { key: string; label: string; pct: number }
interface Template { id: string; name: string; beats: BeatDef[]; custom: boolean; rowId: string | null }

const wordCount = (html: string | null) => {
  if (!html) return 0;
  return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').split(/\s+/).filter(Boolean).length;
};

interface Props {
  projectId: string;
  chapters: Chapter[];
  onJump: (chapterId: string) => void;
}

export function BeatsLens({ projectId, chapters, onJump }: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [template, setTemplate] = useState('romancing_the_beat');
  const [beats, setBeats] = useState<Beat[] | null>(null);
  const [definition, setDefinition] = useState<BeatDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  // Конструктор своего шаблона (бит-архитектор).
  const [building, setBuilding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBeats, setNewBeats] = useState<{ label: string; pct: number }[]>([{ label: '', pct: 10 }, { label: '', pct: 50 }, { label: '', pct: 90 }]);

  const loadTemplates = () => {
    api.get<{ templates: Template[] }>(`/plot/${projectId}/templates`)
      .then(d => setTemplates(d.templates ?? [])).catch(() => {});
  };
  useEffect(loadTemplates, [projectId]);

  const createTemplate = async () => {
    const beatsClean = newBeats.filter(b => b.label.trim());
    if (!newName.trim() || beatsClean.length === 0) return;
    try {
      const t = await api.post<Template>(`/plot/${projectId}/templates`, { name: newName.trim(), beats: beatsClean });
      setTemplates(prev => [...prev, t]);
      setTemplate(t.id);
      setBuilding(false); setNewName(''); setNewBeats([{ label: '', pct: 10 }, { label: '', pct: 50 }, { label: '', pct: 90 }]);
    } catch { /* тихо */ }
  };

  const deleteTemplate = async (t: Template) => {
    if (!t.rowId) return;
    try {
      await api.delete(`/plot/${projectId}/templates/${t.rowId}`);
      setTemplates(prev => prev.filter(x => x.id !== t.id));
      if (template === t.id) setTemplate('romancing_the_beat');
    } catch { /* тихо */ }
  };

  const hasText = useMemo(() => chapters.some(c => wordCount(c.content) > 0), [chapters]);

  // Позиция каждой главы в книге по объёму (центр главы, % от общего объёма).
  const chapterPct = useMemo(() => {
    const ordered = [...chapters].sort((a, b) => a.order - b.order);
    const words = ordered.map(c => wordCount(c.content));
    const total = Math.max(words.reduce((s, w) => s + w, 0), 1);
    const m = new Map<string, number>();
    let acc = 0;
    ordered.forEach((c, i) => { m.set(c.id, ((acc + words[i] / 2) / total) * 100); acc += words[i]; });
    return m;
  }, [chapters]);

  useEffect(() => {
    setLoading(true);
    api.get<{ beats: Beat[] | null; definition: BeatDef[] }>(`/plot/${projectId}/beats?template=${template}`)
      .then(d => { setBeats(d.beats); setDefinition(d.definition ?? []); })
      .catch(() => { setBeats(null); })
      .finally(() => setLoading(false));
  }, [projectId, template]);

  const scan = async () => {
    setScanning(true);
    try {
      const d = await api.post<{ beats: Beat[] }>(`/plot/${projectId}/beats/scan`, { template });
      setBeats(d.beats);
    } catch { /* квота/ошибка — тихо */ }
    finally { setScanning(false); }
  };

  // Сохранить авторский план одного бита (по blur, если изменился).
  const savePlan = async (key: string, text: string) => {
    setSavingKey(key);
    try {
      const d = await api.put<{ beats: Beat[] }>(`/plot/${projectId}/beats`, { template, plans: { [key]: text } });
      setBeats(d.beats);
    } catch { /* тихо */ }
    finally { setSavingKey(null); }
  };

  // Что показываем: сохранённая карта (beats) или пустой шаблон-анкета (definition).
  const rows: Beat[] = beats ?? definition.map(b => ({ ...b, plan: null, chapterId: null, chapterTitle: null }));
  const planByKey = new Map(rows.map(b => [b.key, b.plan ?? '']));
  const scanned = !!beats?.some(b => b.chapterId); // была ли сверка с текстом

  const drift = (b: Beat) => {
    if (!b.chapterId) return null;
    const actual = chapterPct.get(b.chapterId);
    if (actual == null) return null;
    const diff = actual - b.pct;
    if (diff < -12) return { label: 'рано', color: '#91682E' };
    if (diff > 12)  return { label: 'поздно', color: '#54627F' };
    return { label: 'в темпе', color: '#4A5D4E' };
  };

  return (
    <div className="flex flex-col h-full">
      {/* Шаблон + скан */}
      <div className="flex items-center gap-2 pb-3 mb-3 border-b border-[#1e2d1f]/8 flex-shrink-0 flex-wrap">
        <div className="inline-flex flex-wrap items-center rounded-lg bg-[#1e2d1f]/[0.06] p-0.5 gap-0.5">
          {templates.map(t => (
            <span key={t.id} className={`inline-flex items-center rounded-md transition-colors ${template === t.id ? 'bg-white shadow-sm' : 'hover:bg-white/40'}`}>
              <button onClick={() => setTemplate(t.id)}
                className={`text-[11.5px] px-2.5 py-1 ${template === t.id ? 'text-[#1e2d1f] font-medium' : 'text-[#1e2d1f]/60'}`}>
                {t.name}
              </button>
              {t.custom && (
                <button onClick={() => deleteTemplate(t)} title="Удалить свой шаблон" className="pr-1.5 pl-0.5 text-[#1e2d1f]/30 hover:text-[#9E4338]"><Trash2 size={11} /></button>
              )}
            </span>
          ))}
          <button onClick={() => setBuilding(v => !v)} title="Свой шаблон" className="inline-flex items-center gap-0.5 text-[11.5px] text-[#71597F] px-2 py-1 rounded-md hover:bg-white/40 transition-colors">
            <Plus size={12} /> Свой
          </button>
        </div>
        {hasText && (
          <button onClick={scan} disabled={scanning} title="Перо сверит задуманное с написанным" className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#1e2d1f] bg-[#1e2d1f]/[0.06] rounded-lg px-3 py-1.5 disabled:opacity-50 hover:bg-[#1e2d1f]/10 transition-colors flex-shrink-0">
            <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} /> Сверить с текстом
          </button>
        )}
      </div>

      {/* Конструктор своего шаблона */}
      {building && (
        <div className="mb-3 p-3 rounded-xl border border-[#71597F]/20 bg-[#71597F]/[0.04] flex-shrink-0">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Название схемы (напр. «Моя 4-актная»)"
            className="w-full text-[13px] font-medium bg-white/60 rounded-md px-2.5 py-1.5 mb-2 outline-none border border-transparent focus:border-[#71597F]/40" />
          <div className="space-y-1.5 mb-2">
            {newBeats.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={b.label} onChange={e => setNewBeats(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                  placeholder="Название бита" className="flex-1 text-[12px] bg-white/60 rounded-md px-2 py-1 outline-none border border-transparent focus:border-[#71597F]/40" />
                <input type="number" min={0} max={100} value={b.pct} onChange={e => setNewBeats(prev => prev.map((x, j) => j === i ? { ...x, pct: Number(e.target.value) } : x))}
                  className="w-14 text-[12px] bg-white/60 rounded-md px-2 py-1 outline-none border border-transparent focus:border-[#71597F]/40 tabular-nums" />
                <span className="text-[11px] text-[#1e2d1f]/40">%</span>
                <button onClick={() => setNewBeats(prev => prev.filter((_, j) => j !== i))} className="text-[#1e2d1f]/30 hover:text-[#9E4338]"><X size={13} /></button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setNewBeats(prev => [...prev, { label: '', pct: 50 }])} className="inline-flex items-center gap-1 text-[11.5px] text-[#71597F] hover:underline"><Plus size={12} /> бит</button>
            <button onClick={createTemplate} disabled={!newName.trim() || !newBeats.some(b => b.label.trim())} className="ml-auto text-[12px] font-semibold text-white bg-[#1e2d1f] rounded-lg px-3 py-1.5 disabled:opacity-40 hover:bg-[#2a3f2b] transition-colors">Создать схему</button>
            <button onClick={() => setBuilding(false)} className="text-[12px] text-[#1e2d1f]/60 hover:text-[#1e2d1f]">Отмена</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-[#1e2d1f]/40"><Loader2 size={18} className="animate-spin" /></div>
      ) : (
        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          <p className="text-[12px] text-[#1e2d1f]/45 mb-4">
            Заполни замысел каждого бита — это твой план, можно прямо сейчас, даже до первой строки.
            {hasText && ' Кнопкой «Сверить с текстом» Перо покажет, в какой главе бит уже отыгран.'}
          </p>
          <div className="relative pl-1">
            {rows.map((b, i) => {
              const d = drift(b);
              const planned = !!(planByKey.get(b.key) || '').trim();
              return (
                <div key={b.key} className="flex items-start gap-3 pb-5 relative">
                  {/* рельс */}
                  {i < rows.length - 1 && <span className="absolute left-[27px] top-6 bottom-0 w-px bg-[#1e2d1f]/10" />}
                  <div className="w-12 flex-shrink-0 text-right pt-px">
                    <span className="text-[11px] font-semibold text-[#1e2d1f]/55 tabular-nums">{b.pct}%</span>
                  </div>
                  {/* Статус-точка: написано (детект) / задумано (план) / пусто */}
                  <span
                    className={`mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 ${b.chapterId ? '' : planned ? '' : 'border border-dashed border-[#1e2d1f]/30'}`}
                    title={b.chapterId ? 'написано' : planned ? 'задумано' : 'пусто'}
                    style={b.chapterId ? { background: d?.color ?? '#4A5D4E' } : planned ? { background: '#71597F88' } : undefined}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-semibold text-[#1e2d1f]">{b.label}</span>
                      {d && <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5" style={{ color: d.color, background: `${d.color}1f` }}>{d.label}</span>}
                      {savingKey === b.key && <Loader2 size={11} className="animate-spin text-[#1e2d1f]/30" />}
                    </div>
                    {/* Авторский план — редактируемая анкета */}
                    <textarea
                      key={`${template}-${b.key}`}
                      defaultValue={planByKey.get(b.key) || ''}
                      placeholder="Что здесь происходит? (твой замысел)"
                      rows={1}
                      onBlur={(e) => { const v = e.target.value; if (v.trim() !== (planByKey.get(b.key) || '').trim()) savePlan(b.key, v); }}
                      className="w-full mt-1 text-[12.5px] text-[#1e2d1f]/85 leading-snug bg-transparent rounded-md px-2 py-1 -ml-2 resize-none border border-transparent hover:border-[#1e2d1f]/10 focus:border-[#71597F]/40 focus:bg-white/50 outline-none transition-colors placeholder:text-[#1e2d1f]/30 field-sizing-content"
                    />
                    {/* Рентген: где бит лёг в тексте */}
                    {b.chapterId ? (
                      <button onClick={() => onJump(b.chapterId!)} className="inline-flex items-center gap-1 text-[11px] text-[#4A5D4E] font-medium hover:underline mt-1">
                        <Sparkle size={10} /> в тексте: {b.chapterTitle?.trim() || 'глава'}
                      </button>
                    ) : scanned ? (
                      <div className="text-[11px] text-[#1e2d1f]/30 mt-1">в тексте ещё не отыгран</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
