/**
 * ArcsLens — «Арки»: внутренняя арка героев (Want/Need/Ghost/Lie/Truth).
 * ДВА слоя: автор правит руками (режим архитектора) + Перо выводит из рукописи (рентген).
 * Правленые арки переживают рентген. Сама грузит данные.
 */
import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Compass, Plus } from 'lucide-react';
import { api } from '../../services/api';

interface Arc {
  id: string; entityName: string; userEdited?: boolean;
  want: string | null; need: string | null; ghost: string | null; lie: string | null; truth: string | null;
}
type ArcField = 'want' | 'need' | 'ghost' | 'lie' | 'truth';

const FIELDS: { key: ArcField; label: string; color: string; hint: string }[] = [
  { key: 'want',  label: 'Хочет',  color: '#A14F44', hint: 'внешняя цель' },
  { key: 'need',  label: 'Нужно',  color: '#4A5D4E', hint: 'внутренняя потребность' },
  { key: 'ghost', label: 'Травма', color: '#71597F', hint: 'рана прошлого' },
  { key: 'lie',   label: 'Ложь',   color: '#91682E', hint: 'ложное убеждение' },
  { key: 'truth', label: 'Истина', color: '#54627F', hint: 'что примет к финалу' },
];

export function ArcsLens({ projectId, onOpenEntity }: { projectId: string; onOpenEntity?: (name: string) => void }) {
  const [arcs, setArcs] = useState<Arc[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const load = () => {
    setLoading(true);
    api.get<{ arcs: Arc[] }>(`/plot/${projectId}/arcs`)
      .then(d => setArcs(d.arcs ?? [])).catch(() => setArcs([])).finally(() => setLoading(false));
  };
  useEffect(load, [projectId]);

  const scan = async () => {
    setScanning(true);
    try { await api.post(`/plot/${projectId}/arcs/scan`, {}); load(); }
    catch { /* квота/ошибка — тихо */ }
    finally { setScanning(false); }
  };

  const saveField = async (id: string, key: ArcField, value: string) => {
    setArcs(prev => prev.map(a => a.id === id ? { ...a, [key]: value.trim() || null, userEdited: true } : a));
    try { await api.put(`/plot/arcs/${id}`, { [key]: value }); } catch { load(); }
  };

  const addArc = async () => {
    if (!newName.trim()) return;
    try {
      const created = await api.post<Arc>(`/plot/${projectId}/arcs`, { entityName: newName.trim() });
      setArcs(prev => [...prev, created]);
      setNewName(''); setAdding(false);
    } catch { /* тихо */ }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 pb-3 mb-3 border-b border-[#1e2d1f]/8 flex-shrink-0 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-[#1e2d1f]">{arcs.length ? `${arcs.length} арок героев` : 'Арки ещё не выведены'}</div>
          <div className="text-[11px] text-[#1e2d1f]/60">Хочет · Нужно · Травма · Ложь · Истина — задумай или выведи по тексту</div>
        </div>
        <button onClick={() => setAdding(v => !v)} title="Добавить героя вручную" className="inline-flex items-center gap-1 text-[12px] font-medium text-[#71597F] bg-[#71597F]/10 rounded-lg px-2.5 py-2 hover:bg-[#71597F]/20 transition-colors flex-shrink-0">
          <Plus size={13} /> Герой
        </button>
        <button onClick={scan} disabled={scanning} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-[#1e2d1f] rounded-lg px-3 py-2 disabled:opacity-50 hover:bg-[#2a3f2b] transition-colors flex-shrink-0">
          <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} /> {arcs.length ? 'Обновить' : 'Вывести арки'}
        </button>
      </div>

      {adding && (
        <div className="mb-3 p-3 rounded-xl border border-[#71597F]/20 bg-[#71597F]/[0.04] flex-shrink-0 flex items-center gap-2">
          <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addArc(); }} placeholder="Имя героя"
            className="flex-1 text-[13px] bg-white/60 rounded-md px-2.5 py-1.5 outline-none border border-transparent focus:border-[#71597F]/40" />
          <button onClick={addArc} disabled={!newName.trim()} className="text-[12px] font-semibold text-white bg-[#1e2d1f] rounded-lg px-3 py-1.5 disabled:opacity-40 hover:bg-[#2a3f2b] transition-colors">Добавить</button>
          <button onClick={() => setAdding(false)} className="text-[12px] text-[#1e2d1f]/60 hover:text-[#1e2d1f]">Отмена</button>
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-[#1e2d1f]/40"><Loader2 size={18} className="animate-spin" /></div>
      ) : (
        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {arcs.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-[#54627F]/8 flex items-center justify-center mb-4"><Compass size={24} className="text-[#54627F]" /></div>
              <p className="text-[14px] text-[#1e2d1f]/60 max-w-[280px] leading-relaxed">{scanning ? 'Перо выводит арки героев…' : 'Задумай арку героя руками («+ Герой») или дай Перу вывести её из рукописи.'}</p>
            </div>
          ) : (
            <div className="space-y-3 pb-4">
              {arcs.map(a => (
                <div key={a.id} className="rounded-xl border border-[#1e2d1f]/8 bg-white/40 p-3.5">
                  <div className="flex items-center gap-2 mb-2.5">
                    {onOpenEntity
                      ? <button onClick={() => onOpenEntity(a.entityName)} title="Открыть в Мире" className="text-[14px] font-semibold text-[#1e2d1f] hover:underline">{a.entityName}</button>
                      : <div className="text-[14px] font-semibold text-[#1e2d1f]">{a.entityName}</div>}
                    {a.userEdited && <span title="Правлено автором" className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 text-[#71597F] bg-[#71597F]/12">правлено</span>}
                  </div>
                  <div className="space-y-1">
                    {FIELDS.map(f => (
                      <div key={f.key} className="flex items-start gap-2.5">
                        <span title={f.hint} className="text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 mt-1 flex-shrink-0 w-[58px] text-center" style={{ color: f.color, background: `${f.color}1a` }}>{f.label}</span>
                        <textarea
                          key={`${a.id}-${f.key}`}
                          defaultValue={a[f.key] || ''}
                          placeholder={f.hint}
                          rows={1}
                          onBlur={e => { if ((e.target.value.trim() || '') !== (a[f.key] || '')) saveField(a.id, f.key, e.target.value); }}
                          className="flex-1 text-[13px] text-[#1e2d1f]/85 leading-snug bg-transparent rounded px-1.5 py-0.5 -ml-1 resize-none outline-none border border-transparent hover:border-[#1e2d1f]/10 focus:border-[#71597F]/40 focus:bg-white/50 transition-colors placeholder:text-[#1e2d1f]/25 field-sizing-content"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
