/**
 * NotesBoard — доска «пре-продакшена» автора: собрать идеи/заметки → позже построить Мир.
 * Единая модель: kind (idea|note|question|todo). Карточку можно «повысить» в Мир (сущность)
 * или в главу, и связать (@) с сущностью/главой. Переиспользуется на странице «Идеи» и как
 * линза в редакторе.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Plus, Pin, Check, Trash2, BookOpen, Archive, RotateCcw, Link2, FileText, Search } from 'lucide-react';
import { api } from '../services/api';
import { useClickOutside } from '../hooks/useClickOutside';

export interface Note {
  id: string;
  kind: 'idea' | 'note' | 'question' | 'todo';
  body: string;
  status: 'open' | 'done' | 'archived';
  pinned: boolean;
  chapterId: string | null;
  entityId: string | null;
  createdAt: string;
  updatedAt: string;
}

const KINDS: { id: Note['kind']; label: string; color: string }[] = [
  { id: 'idea',     label: 'Идея',    color: '#71597F' },
  { id: 'note',     label: 'Заметка', color: '#4A5D4E' },
  { id: 'question', label: 'Вопрос',  color: '#54627F' },
  { id: 'todo',     label: 'Задача',  color: '#A14F44' },
];
const kindOf = (k: string) => KINDS.find(x => x.id === k) ?? KINDS[0];

const ENTITY_TYPES: { type: string; label: string; color: string }[] = [
  { type: 'character', label: 'Персонаж',     color: '#A14F44' },
  { type: 'location',  label: 'Локация',      color: '#4A5D4E' },
  { type: 'item',      label: 'Предмет',      color: '#91682E' },
  { type: 'rule',      label: 'Правило мира', color: '#54627F' },
];
const ENTITY_PIGMENT: Record<string, string> = { character: '#A14F44', location: '#4A5D4E', item: '#91682E', rule: '#54627F' };

interface MiniEntity { id: string; name: string; type: string }
interface MiniChapter { id: string; title: string; order: number }

interface Props {
  projectId: string;
  /** Новые заметки привязываются к этой главе (контекст редактора). */
  chapterId?: string;
  /** Создана сущность из заметки — дать Editor-у перезагрузить Мир. */
  onEntityCreated?: () => void;
  /** Создана глава из заметки — обновить список глав / перейти. */
  onChapterCreated?: (chapterId: string) => void;
  /** Клик по чипу-связи: открыть сущность / перейти к главе. */
  onOpenEntity?: (entityId: string) => void;
  onJumpToChapter?: (chapterId: string) => void;
  /** Заметки изменились (для счётчиков/маргиналий снаружи). */
  onNotesChanged?: () => void;
}

export function NotesBoard({ projectId, chapterId, onEntityCreated, onChapterCreated, onOpenEntity, onJumpToChapter, onNotesChanged }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [entities, setEntities] = useState<MiniEntity[]>([]);
  const [chapters, setChapters] = useState<MiniChapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [draftKind, setDraftKind] = useState<Note['kind']>('idea');
  const [filter, setFilter] = useState<Note['kind'] | 'all'>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [promoteFor, setPromoteFor] = useState<string | null>(null);
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [linkSearch, setLinkSearch] = useState('');
  // @-упоминание в захвате (как в чате Перо): null — закрыт, строка — запрос после «@».
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const captureRef = useRef<HTMLTextAreaElement | null>(null);

  // Авто-закрытие поповеров по клику вне (общий хук). Один открыт за раз.
  const linkMenuRef = useClickOutside<HTMLDivElement>(linkFor !== null, () => setLinkFor(null));
  const promoteMenuRef = useClickOutside<HTMLDivElement>(promoteFor !== null, () => setPromoteFor(null));
  const mentionRef = useClickOutside<HTMLDivElement>(mentionQuery !== null, () => setMentionQuery(null));

  const load = useCallback(() => {
    setLoading(true);
    api.get<{ notes: Note[] }>(`/notes/${projectId}`)
      .then(d => setNotes(d.notes ?? []))
      .catch(() => setNotes([]))
      .finally(() => setLoading(false));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  // Сущности + главы для @-связи (один раз).
  useEffect(() => {
    api.get<{ entities: MiniEntity[] }>(`/bible/${projectId}`).then(d => setEntities((d.entities ?? []).filter(e => e.name))).catch(() => {});
    api.get<{ chapters: MiniChapter[] }>(`/projects/${projectId}/chapters`).then(d => setChapters(d.chapters ?? [])).catch(() => {});
  }, [projectId]);

  const changed = () => onNotesChanged?.();

  const create = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    try {
      const note = await api.post<Note>(`/notes/${projectId}`, { kind: draftKind, body, chapterId });
      setNotes(prev => [note, ...prev]); changed();
    } catch { load(); }
  };

  const patch = async (id: string, p: Partial<Note>) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...p } : n));
    try { await api.patch<Note>(`/notes/${id}`, p); changed(); } catch { load(); }
  };

  const remove = async (id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id));
    try { await api.delete(`/notes/${id}`); changed(); } catch { load(); }
  };

  const promote = async (id: string, type: string) => {
    setPromoteFor(null);
    try { await api.post(`/notes/${id}/promote`, { type }); onEntityCreated?.(); load(); changed(); } catch { load(); }
  };

  const promoteToChapter = async (id: string) => {
    setPromoteFor(null);
    try {
      const { chapter } = await api.post<{ chapter: MiniChapter }>(`/notes/${id}/to-chapter`, {});
      onChapterCreated?.(chapter.id); load(); changed();
    } catch { load(); }
  };

  const link = async (id: string, kind: 'entity' | 'chapter', targetId: string | null) => {
    setLinkFor(null);
    await patch(id, kind === 'entity' ? { entityId: targetId, chapterId: null } : { chapterId: targetId, entityId: null });
  };

  const entityById = (id: string) => entities.find(e => e.id === id);
  const chapterById = (id: string) => chapters.find(c => c.id === id);

  // Сущности по типам (порядок ENTITY_TYPES) + алфавит внутри — для упорядоченного пикера.
  const entitiesByType = useMemo(() => {
    const m = new Map<string, MiniEntity[]>();
    for (const t of ENTITY_TYPES) m.set(t.type, []);
    for (const e of entities) (m.get(e.type) ?? m.set(e.type, []).get(e.type)!).push(e);
    for (const arr of m.values()) arr.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'ru'));
    return m;
  }, [entities]);
  const sortedChapters = useMemo(() => [...chapters].sort((a, b) => a.order - b.order), [chapters]);

  // ── @-упоминание в захвате ──────────────────────────────────────────────────
  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return entities.filter(e => e.name?.toLowerCase().includes(q)).slice(0, 8);
  }, [mentionQuery, entities]);

  const onCaptureChange = (value: string) => {
    setDraft(value);
    const caret = captureRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const m = before.match(/(?:^|\s)@([\p{L}\d_-]*)$/u);
    setMentionQuery(m ? m[1] : null);
  };
  const selectMention = (e: MiniEntity) => {
    const ta = captureRef.current;
    const caret = ta?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret).replace(/@([\p{L}\d_-]*)$/u, `@${e.name} `);
    const next = before + draft.slice(caret);
    setDraft(next);
    setMentionQuery(null);
    requestAnimationFrame(() => { ta?.focus(); const pos = before.length; ta?.setSelectionRange(pos, pos); });
  };

  const visible = notes
    .filter(n => showArchived ? true : n.status !== 'archived')
    .filter(n => filter === 'all' ? true : n.kind === filter);

  return (
    <div className="w-full">
      {/* Быстрый захват */}
      <div className="relative bg-white border border-[#1e2d1f]/10 rounded-2xl p-3 mb-5">
        <textarea
          ref={captureRef}
          value={draft}
          onChange={e => onCaptureChange(e.target.value)}
          onKeyDown={e => {
            if (mentionQuery !== null && mentionMatches.length) {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); selectMention(mentionMatches[0]); return; }
              if (e.key === 'Escape') { e.preventDefault(); setMentionQuery(null); return; }
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); create(); }
          }}
          placeholder="Запиши идею или заметку…  «@» — упомянуть · ⌘/Ctrl+Enter — сохранить"
          rows={2}
          className="w-full resize-none outline-none text-[15px] text-[#1e2d1f] placeholder:text-[#1e2d1f]/35 leading-relaxed bg-transparent"
        />
        {/* Автокомплит @-упоминания */}
        {mentionQuery !== null && mentionMatches.length > 0 && (
          <div ref={mentionRef} className="absolute z-20 left-3 top-[58px] bg-[#1e2d1f] rounded-xl shadow-2xl p-1.5 w-[240px] max-h-[240px] overflow-y-auto">
            {mentionMatches.map(e => (
              <button key={e.id} onMouseDown={ev => { ev.preventDefault(); selectMention(e); }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-white/85 hover:bg-white/10 hover:text-white transition-colors">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: ENTITY_PIGMENT[e.type] ?? '#54627F' }} /><span className="truncate">{e.name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5 mt-1.5">
          {KINDS.map(k => (
            <button
              key={k.id}
              onClick={() => setDraftKind(k.id)}
              className="text-[11px] font-medium rounded-md px-2 py-1 border transition-colors"
              style={draftKind === k.id
                ? { color: '#fff', background: k.color, borderColor: k.color }
                : { color: k.color, background: `${k.color}14`, borderColor: 'transparent' }}
            >{k.label}</button>
          ))}
          <button
            onClick={create}
            disabled={!draft.trim()}
            className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-lg px-3 py-1.5 bg-[#1e2d1f] text-white disabled:opacity-40 hover:bg-[#2a3f2b] transition-colors"
          ><Plus size={14} /> Записать</button>
        </div>
      </div>

      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {([['all', 'Все'] as const, ...KINDS.map(k => [k.id, k.label] as const)]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFilter(id as Note['kind'] | 'all')}
            className={`text-[12px] rounded-lg px-2.5 py-1 border transition-colors ${
              filter === id ? 'bg-[#1e2d1f] text-white border-[#1e2d1f]' : 'bg-transparent text-[#1e2d1f]/55 border-[#1e2d1f]/12 hover:text-[#1e2d1f]'
            }`}
          >{label}</button>
        ))}
        <button
          onClick={() => setShowArchived(v => !v)}
          className={`ml-auto text-[12px] rounded-lg px-2.5 py-1 transition-colors ${showArchived ? 'text-[#1e2d1f]/70 bg-[#1e2d1f]/5' : 'text-[#1e2d1f]/40 hover:text-[#1e2d1f]/60'}`}
        ><Archive size={12} className="inline -mt-0.5 mr-1" />{showArchived ? 'Скрыть архив' : 'Архив'}</button>
      </div>

      {/* Карточки */}
      {loading ? (
        <p className="text-[14px] text-[#1e2d1f]/40 py-10 text-center">Загрузка…</p>
      ) : visible.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-[15px] text-[#1e2d1f]/55">Пока пусто. Запиши первую идею выше —<br />позже превратишь её в персонажа, локацию или главу.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {visible.map(note => {
            const k = kindOf(note.kind);
            const done = note.status === 'done';
            const linkedEntity = note.entityId ? entityById(note.entityId) : null;
            const linkedChapter = note.chapterId ? chapterById(note.chapterId) : null;
            return (
              <div
                key={note.id}
                className={`relative bg-white border rounded-2xl p-3.5 transition-colors ${done ? 'border-[#1e2d1f]/8 opacity-60' : 'border-[#1e2d1f]/10'}`}
                style={{ borderLeft: `3px solid ${k.color}` }}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: k.color }}>{k.label}</span>
                  {note.pinned && <Pin size={11} className="text-[#71597F]" fill="#71597F" />}
                  <div className="ml-auto flex items-center gap-0.5">
                    <button onClick={() => patch(note.id, { pinned: !note.pinned })} title={note.pinned ? 'Открепить' : 'Закрепить'} className="p-1 rounded-md text-[#1e2d1f]/35 hover:text-[#71597F] hover:bg-[#1e2d1f]/5 transition-colors"><Pin size={13} /></button>
                    <button onMouseDown={e => e.stopPropagation()} onClick={() => { setLinkFor(linkFor === note.id ? null : note.id); setLinkSearch(''); setPromoteFor(null); }} title="Связать с сущностью или главой" className="p-1 rounded-md text-[#1e2d1f]/35 hover:text-[#54627F] hover:bg-[#1e2d1f]/5 transition-colors"><Link2 size={13} /></button>
                    <button onMouseDown={e => e.stopPropagation()} onClick={() => { setPromoteFor(promoteFor === note.id ? null : note.id); setLinkFor(null); }} title="Повысить — в Мир или в главу" className="p-1 rounded-md text-[#1e2d1f]/35 hover:text-[#4A5D4E] hover:bg-[#1e2d1f]/5 transition-colors"><BookOpen size={13} /></button>
                    <button onClick={() => patch(note.id, { status: done ? 'open' : 'done' })} title={done ? 'Вернуть в работу' : 'Готово'} className="p-1 rounded-md text-[#1e2d1f]/35 hover:text-[#4A5D4E] hover:bg-[#1e2d1f]/5 transition-colors">{done ? <RotateCcw size={13} /> : <Check size={13} />}</button>
                    <button onClick={() => patch(note.id, { status: note.status === 'archived' ? 'open' : 'archived' })} title={note.status === 'archived' ? 'Из архива' : 'В архив'} className="p-1 rounded-md text-[#1e2d1f]/35 hover:text-[#91682E] hover:bg-[#1e2d1f]/5 transition-colors"><Archive size={13} /></button>
                    <button onClick={() => remove(note.id)} title="Удалить" className="p-1 rounded-md text-[#1e2d1f]/35 hover:text-[#9E4338] hover:bg-[#1e2d1f]/5 transition-colors"><Trash2 size={13} /></button>
                  </div>
                </div>
                <textarea
                  defaultValue={note.body}
                  onBlur={e => { const v = e.target.value.trim(); if (v && v !== note.body) patch(note.id, { body: v }); }}
                  rows={Math.min(6, Math.max(2, note.body.split('\n').length))}
                  className={`w-full resize-none outline-none bg-transparent text-[13.5px] leading-relaxed text-[#1e2d1f] ${done ? 'line-through' : ''}`}
                />
                {/* Чип-связь */}
                {(linkedEntity || linkedChapter) && (
                  <button
                    onClick={() => linkedEntity ? onOpenEntity?.(linkedEntity.id) : (linkedChapter && onJumpToChapter?.(linkedChapter.id))}
                    className="mt-1 inline-flex items-center gap-1.5 text-[10.5px] font-medium rounded-md px-1.5 py-0.5 transition-colors"
                    style={linkedEntity
                      ? { color: ENTITY_PIGMENT[linkedEntity.type] ?? '#54627F', background: `${ENTITY_PIGMENT[linkedEntity.type] ?? '#54627F'}14` }
                      : { color: '#1e2d1f', background: 'rgba(30,45,31,0.06)' }}
                  >
                    {linkedEntity
                      ? <><span className="w-1.5 h-1.5 rounded-full" style={{ background: ENTITY_PIGMENT[linkedEntity.type] ?? '#54627F' }} />{linkedEntity.name}</>
                      : <><FileText size={10} /> {linkedChapter?.title}</>}
                  </button>
                )}

                {/* Промоут — выбор цели */}
                {promoteFor === note.id && (
                  <div ref={promoteMenuRef} className="absolute z-10 right-3 top-10 bg-[#1e2d1f] rounded-xl shadow-2xl p-1.5 min-w-[180px]">
                    <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white/40">Повысить в Мир как</div>
                    {ENTITY_TYPES.map(t => (
                      <button key={t.type} onClick={() => promote(note.id, t.type)} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] text-white/80 hover:bg-white/10 hover:text-white transition-colors">
                        <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />{t.label}
                      </button>
                    ))}
                    <div className="h-px bg-white/10 my-1" />
                    <button onClick={() => promoteToChapter(note.id)} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] text-white/80 hover:bg-white/10 hover:text-white transition-colors">
                      <FileText size={13} className="text-white/50" /> Создать главу
                    </button>
                  </div>
                )}

                {/* Связь — выбор сущности/главы: поиск + группы по типам + Главы */}
                {linkFor === note.id && (() => {
                  const q = linkSearch.trim().toLowerCase();
                  const groups = ENTITY_TYPES
                    .map(t => ({ ...t, items: (entitiesByType.get(t.type) ?? []).filter(e => !q || e.name.toLowerCase().includes(q)) }))
                    .filter(g => g.items.length > 0);
                  const chaps = sortedChapters.filter(c => !q || (c.title ?? '').toLowerCase().includes(q));
                  const empty = groups.length === 0 && chaps.length === 0;
                  return (
                  <div ref={linkMenuRef} className="absolute z-10 right-3 top-10 bg-[#1e2d1f] rounded-xl shadow-2xl p-1.5 w-[240px] flex flex-col max-h-[300px]">
                    <div className="flex items-center gap-1.5 px-2 py-1 mb-1 rounded-lg bg-white/5 flex-shrink-0">
                      <Search size={12} className="text-white/40 flex-shrink-0" />
                      <input autoFocus value={linkSearch} onChange={e => setLinkSearch(e.target.value)} placeholder="Поиск…"
                        className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] text-white placeholder:text-white/35" />
                    </div>
                    <div className="overflow-y-auto -mx-0.5 px-0.5">
                      {(linkedEntity || linkedChapter) && (
                        <button onClick={() => link(note.id, linkedEntity ? 'entity' : 'chapter', null)} className="w-full text-left px-2.5 py-1.5 rounded-lg text-[12px] text-white/55 hover:bg-white/10">— Убрать связь</button>
                      )}
                      {groups.map(g => (
                        <div key={g.type}>
                          <div className="px-2.5 py-1 mt-0.5 text-[10px] font-bold uppercase tracking-wider text-white/40">{g.label}</div>
                          {g.items.map(e => (
                            <button key={e.id} onClick={() => link(note.id, 'entity', e.id)} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-white/80 hover:bg-white/10 hover:text-white transition-colors">
                              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: ENTITY_PIGMENT[e.type] ?? '#54627F' }} /><span className="truncate">{e.name}</span>
                            </button>
                          ))}
                        </div>
                      ))}
                      {chaps.length > 0 && <div className="px-2.5 py-1 mt-0.5 text-[10px] font-bold uppercase tracking-wider text-white/40">Главы</div>}
                      {chaps.map(c => (
                        <button key={c.id} onClick={() => link(note.id, 'chapter', c.id)} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-white/80 hover:bg-white/10 hover:text-white transition-colors">
                          <FileText size={12} className="text-white/40 flex-shrink-0" /><span className="truncate">{c.title}</span>
                        </button>
                      ))}
                      {empty && <div className="px-2.5 py-3 text-[12px] text-white/40 text-center">Ничего не найдено</div>}
                    </div>
                  </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
