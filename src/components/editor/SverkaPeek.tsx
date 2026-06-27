/**
 * SverkaPeek — канал «Сверка» в правом рельсе (push, не pull). Находки приходят к автору,
 * а НЕ живут вкладками в справочнике «Мир». По грани зума: на «Глава» — находки этой главы
 * (после «Прочитать»); на «Книга/Серия» — по всей книге. Содержит: нестыковки (прыжок к фразе),
 * «ружья Чехова» (незакрытые линии), возможные дубли (с «Объединить»). Данные уже посчитаны (без ИИ).
 * Самодостаточный: фетчит сам. Откат = убрать проп + строку монтирования.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Crosshair, ArrowRight, Sparkles, Copy, ChevronRight, ChevronDown } from 'lucide-react';
import { api } from '../../services/api';
import { Entity } from './types';
import { findDuplicateGroups } from './StoryBiblePanel';

interface Issue { id: string; chapterId: string | null; issue: string; quote: string | null; severity: string; status: string; kind?: string }
interface Thread { id: string; title: string; resolved: boolean; chapterIds: string[] }

export function SverkaPeek({ projectId, chapterId, scope, onJumpToQuote, onOpenThreads, onChanged }: {
  projectId: string;
  chapterId: string | null;
  scope: 'chapter' | 'project' | 'series';
  onJumpToQuote: (chapterId: string, quote: string) => void;
  onOpenThreads: () => void;
  onChanged?: () => void;
}) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [merging, setMerging] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [dupsOpen, setDupsOpen] = useState(false); // дубли свёрнуты по умолчанию — рельс не стена
  const [devsOpen, setDevsOpen] = useState(false); // «развитие» свёрнуто — спокойный поток, не алярм

  const reload = () => {
    Promise.all([
      api.get<{ issues: Issue[] }>(`/bible/${projectId}/contradictions`).then(d => d.issues ?? []).catch(() => []),
      api.get<{ threads: Thread[] }>(`/plot/${projectId}/threads`).then(d => d.threads ?? []).catch(() => []),
      api.get<{ entities: Entity[] }>(`/bible/${projectId}`).then(d => d.entities ?? []).catch(() => []),
    ]).then(([is, th, en]) => { setIssues(is); setThreads(th); setEntities(en.filter(e => e.status === 'approved')); });
  };
  useEffect(() => { if (projectId) reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId, chapterId, scope]);

  const chapterMode = scope === 'chapter';
  // Два потока классификатора: нестыковки (алярм, красный) vs «развитие» (спокойный, серо-синий).
  const open = issues.filter(i => i.status === 'open' && i.kind !== 'development');
  const here = (chapterMode ? open.filter(i => i.chapterId === chapterId) : open).slice(0, chapterMode ? 3 : 8);
  const devs = issues
    .filter(i => i.status === 'open' && i.kind === 'development' && (chapterMode ? i.chapterId === chapterId : true))
    .slice(0, chapterMode ? 3 : 6);
  const guns = threads.filter(t => !t.resolved && (chapterMode ? (chapterId && (t.chapterIds ?? []).includes(chapterId)) : true)).slice(0, chapterMode ? 2 : 6);
  // Дубли — находка book-уровня: показываем на грани «Книга/Серия», не в главе.
  const dups = chapterMode ? [] : findDuplicateGroups(entities).filter(g => !dismissed.has(g.map(e => e.id).sort().join('|')));
  const total = here.length + guns.length + dups.length + devs.length;
  if (!chapterId && chapterMode) return null;
  if (total === 0) return null;

  const mergeAll = async () => {
    setMerging(true);
    try { for (const g of dups) await api.post(`/bible/${projectId}/merge`, { ids: g.map(e => e.id) }); onChanged?.(); reload(); }
    finally { setMerging(false); }
  };

  // «Не нестыковка» — отклонить ложное срабатывание (оптимистично + на бэк).
  const dismissIssue = async (id: string) => {
    setIssues(p => p.filter(x => x.id !== id));
    try { await api.post(`/bible/contradictions/${id}/dismiss`, {}); onChanged?.(); } catch { reload(); }
  };

  return (
    <div className="rounded-xl bg-[#A14F44]/[0.06] border border-[#A14F44]/15 p-2.5">
      <div className="flex items-center gap-1.5 mb-2 text-[#A14F44] font-semibold text-[12px]">
        <Sparkles size={14} /> Перо заметило {chapterMode ? 'в этой главе' : 'по книге'}
      </div>
      <div className="flex flex-col gap-1.5">
        {here.map(i => (
          <div key={i.id} className="bg-white rounded-lg px-2.5 py-1.5 flex items-start gap-2">
            <AlertTriangle size={13} className="text-[#A14F44] flex-shrink-0 mt-0.5" />
            <button
              onClick={() => i.quote && i.chapterId && onJumpToQuote(i.chapterId, i.quote)}
              className="min-w-0 flex-1 text-left text-[12px] text-[#1e2d1f]/80 leading-snug hover:text-[#A14F44] transition-colors"
              title={i.quote ? 'Показать в тексте' : undefined}
            >
              {i.issue}
            </button>
            <button
              onClick={() => dismissIssue(i.id)}
              title="Не нестыковка — убрать находку"
              className="flex-shrink-0 text-[11px] font-medium text-[#1e2d1f]/45 hover:text-[#A14F44] hover:bg-[#A14F44]/10 rounded px-1.5 py-0.5 transition-colors mt-px"
            >
              Отклонить
            </button>
          </div>
        ))}
        {guns.map(t => (
          <button
            key={t.id}
            onClick={onOpenThreads}
            className="group text-left bg-white rounded-lg px-2.5 py-1.5 flex items-start gap-2 hover:bg-[#54627F]/[0.05] transition-colors"
          >
            <Crosshair size={13} className="text-[#54627F] flex-shrink-0 mt-0.5" />
            <span className="min-w-0 flex-1 text-[12px] text-[#1e2d1f]/80 leading-snug">
              Ружьё не выстрелило: <span className="font-medium">{t.title}</span>
            </span>
            <ArrowRight size={12} className="text-[#54627F]/50 flex-shrink-0 mt-0.5 group-hover:text-[#54627F]" />
          </button>
        ))}
        {dups.length > 0 && (
          <div className="bg-white rounded-lg px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <Copy size={13} className="text-[#71597F] flex-shrink-0" />
              <button onClick={() => setDupsOpen(v => !v)} className="flex items-center gap-1 flex-1 min-w-0 text-left text-[12px] text-[#1e2d1f]/80 hover:text-[#71597F]">
                {dupsOpen ? <ChevronDown size={12} className="flex-shrink-0" /> : <ChevronRight size={12} className="flex-shrink-0" />}
                Возможные дубли · {dups.length}
              </button>
              <button onClick={mergeAll} disabled={merging} className="flex-shrink-0 text-[11.5px] font-medium text-[#71597F] hover:bg-[#71597F]/10 rounded px-2 py-0.5 disabled:opacity-50">
                {merging ? 'Объединяю…' : 'Объединить'}
              </button>
            </div>
            <div className={`flex-col gap-1 mt-1.5 ${dupsOpen ? 'flex' : 'hidden'}`}>
              {dups.slice(0, 8).map(g => {
                const key = g.map(e => e.id).sort().join('|');
                return (
                  <div key={key} className="flex items-center gap-1.5 text-[11.5px] text-[#1e2d1f]/65">
                    <span className="w-1 h-1 rounded-full bg-[#71597F] flex-shrink-0" />
                    <span className="truncate flex-1">{g.map(e => e.name).join(' · ')}</span>
                    <button onClick={() => setDismissed(p => new Set(p).add(key))} title="Это разные объекты — убрать" className="flex-shrink-0 text-[10.5px] font-medium text-[#1e2d1f]/45 hover:text-[#71597F] hover:bg-[#71597F]/10 rounded px-1.5 py-0.5 transition-colors">Отклонить</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {devs.length > 0 && (
          <div className="bg-white rounded-lg px-2.5 py-2">
            <button onClick={() => setDevsOpen(v => !v)} className="flex items-center gap-1.5 w-full text-left text-[12px] text-[#54627F] font-medium hover:text-[#3f4c63]">
              {devsOpen ? <ChevronDown size={12} className="flex-shrink-0" /> : <ChevronRight size={12} className="flex-shrink-0" />}
              Развитие · {devs.length}
              <span className="ml-auto text-[10px] font-normal text-[#1e2d1f]/35">не ошибка</span>
            </button>
            <div className={`flex-col gap-1.5 mt-1.5 ${devsOpen ? 'flex' : 'hidden'}`}>
              {devs.map(d => (
                <div key={d.id} className="flex items-start gap-2 rounded-md bg-[#54627F]/[0.05] px-2 py-1.5">
                  <button
                    onClick={() => d.quote && d.chapterId && onJumpToQuote(d.chapterId, d.quote)}
                    className="min-w-0 flex-1 text-left text-[11.5px] text-[#1e2d1f]/75 leading-snug hover:text-[#54627F] transition-colors"
                    title={d.quote ? 'Показать в тексте' : undefined}
                  >
                    {d.issue}
                  </button>
                  <button onClick={() => dismissIssue(d.id)} title="Убрать из развития" className="flex-shrink-0 text-[10.5px] font-medium text-[#1e2d1f]/45 hover:text-[#54627F] hover:bg-[#54627F]/10 rounded px-1.5 py-0.5 transition-colors mt-px">Скрыть</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
