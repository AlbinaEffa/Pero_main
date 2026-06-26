/**
 * ContradictionsLens — флагманский отчёт нестыковок по всей книге (PRD P1.2).
 * Собирает уже извлечённые issues (contradiction_issues) в единый экран: группировка
 * по герою, severity, цитата + прыжок в текст, отклонить ложное, открыть героя в Мире.
 * Сам ничего не сканирует — данные и команды приходят пропсами из Editor.
 */
import { useState } from 'react';
import { Loader2, RefreshCw, X, ArrowRight, Check, FileText, Wrench } from 'lucide-react';

export interface ContradictionIssue {
  id: string;
  chapterId: string | null;
  entityName: string | null;
  issue: string;
  quote: string | null;
  severity: string;       // low | medium | high
  status: string;
}

const SEVERITY: Record<string, { label: string; color: string }> = {
  high:   { label: 'высокая', color: '#9E4338' },
  medium: { label: 'средняя', color: '#91682E' },
  low:    { label: 'низкая',  color: '#54627F' },
};
const sev = (s: string) => SEVERITY[s] ?? SEVERITY.medium;
const SEV_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

const ENTITY_PIGMENT: Record<string, string> = { character: '#A14F44', location: '#4A5D4E', item: '#91682E', rule: '#54627F' };

interface Props {
  issues: ContradictionIssue[];
  chapters: { id: string; title: string; order: number }[];
  entities: { id: string; name: string; type: string }[];
  scanState: { status: 'running' | 'done' | 'failed'; scanned: number; total: number; found: number } | null;
  onScan: () => void;
  /** Прыжок к цитате в тексте (подсветка фразы). */
  onJump: (chapterId: string, quote: string) => void;
  /** Открыть героя в Мире (по имени). */
  onOpenEntity: (name: string) => void;
  /** Отклонить ложную нестыковку по id. */
  onDismiss: (issueId: string) => void;
}

export function ContradictionsLens({ issues, chapters, entities, scanState, onScan, onJump, onOpenEntity, onDismiss }: Props) {
  const [sevFilter, setSevFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [groupBy, setGroupBy] = useState<'entity' | 'chapter'>('entity');

  const chapterLabel = (id: string | null) => {
    const c = chapters.find(ch => ch.id === id);
    return c ? (c.title?.trim() || `Глава ${c.order + 1}`) : 'Глава';
  };
  const entityType = (name: string | null) => entities.find(e => e.name.trim().toLowerCase() === (name ?? '').trim().toLowerCase())?.type;

  const filtered = sevFilter === 'all' ? issues : issues.filter(i => i.severity === sevFilter);

  // Группировка по герою ИЛИ по главе; сортировка групп по самой острой нестыковке.
  const groups = new Map<string, ContradictionIssue[]>();
  for (const i of filtered) {
    const key = groupBy === 'entity'
      ? (i.entityName || 'Без привязки')
      : (i.chapterId || '∅');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  }
  const sortedGroups = [...groups.entries()]
    .map(([key, list]) => ({ key, list: [...list].sort((a, b) => (SEV_RANK[a.severity] ?? 1) - (SEV_RANK[b.severity] ?? 1)) }))
    .sort((a, b) => (SEV_RANK[a.list[0].severity] ?? 1) - (SEV_RANK[b.list[0].severity] ?? 1));

  const sevCount = (s: string) => issues.filter(i => i.severity === s).length;
  const running = scanState?.status === 'running';

  return (
    <div className="flex flex-col h-full">
      {/* Шапка-скан */}
      <div className="flex items-center gap-3 px-1 pb-3 mb-2 border-b border-[#1e2d1f]/8 flex-shrink-0">
        <div className="flex-1 min-w-0">
          {running ? (
            <>
              <div className="text-[13px] font-semibold text-[#1e2d1f] flex items-center gap-1.5"><Loader2 size={13} className="animate-spin text-[#71597F]" /> Перо проверяет книгу…</div>
              <div className="text-[11px] text-[#1e2d1f]/50">{scanState!.total ? `${scanState!.scanned} из ${scanState!.total} глав` : 'запуск…'} · найдено: {scanState!.found}</div>
            </>
          ) : (
            <>
              <div className="text-[13px] font-semibold text-[#1e2d1f]">{issues.length ? `${issues.length} ${plural(issues.length)}` : 'Нестыковок не найдено'}</div>
              <div className="text-[11px] text-[#1e2d1f]/50">{scanState?.status === 'failed' ? 'проверка прервалась — запусти заново' : 'отчёт по всей книге'}</div>
            </>
          )}
        </div>
        <button
          onClick={onScan}
          disabled={running}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-[#1e2d1f] rounded-lg px-3 py-2 disabled:opacity-50 hover:bg-[#2a3f2b] transition-colors flex-shrink-0"
        ><RefreshCw size={13} className={running ? 'animate-spin' : ''} /> {issues.length || running ? 'Проверить заново' : 'Проверить книгу'}</button>
      </div>

      {/* Фильтр по severity + переключатель группировки */}
      {issues.length > 0 && (
        <div className="flex items-center gap-1.5 mb-3 flex-shrink-0 flex-wrap">
          {([['all', 'Все', issues.length] as const, ['high', 'Высокие', sevCount('high')] as const, ['medium', 'Средние', sevCount('medium')] as const, ['low', 'Низкие', sevCount('low')] as const]).map(([id, label, n]) => (
            <button
              key={id}
              onClick={() => setSevFilter(id)}
              className={`text-[11px] rounded-lg px-2 py-1 border transition-colors ${sevFilter === id ? 'bg-[#1e2d1f] text-white border-[#1e2d1f]' : 'bg-transparent text-[#1e2d1f]/55 border-[#1e2d1f]/12 hover:text-[#1e2d1f]'}`}
            >{label}{id !== 'all' && n > 0 ? ` · ${n}` : ''}</button>
          ))}
          <div className="ml-auto inline-flex rounded-md bg-[#1e2d1f]/[0.06] p-0.5">
            {([['entity', 'По герою'] as const, ['chapter', 'По главе'] as const]).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setGroupBy(id)}
                className={`text-[10.5px] rounded px-2 py-0.5 transition-colors ${groupBy === id ? 'bg-white text-[#1e2d1f] shadow-sm' : 'text-[#1e2d1f]/45 hover:text-[#1e2d1f]/70'}`}
              >{label}</button>
            ))}
          </div>
        </div>
      )}

      {/* Список */}
      <div className="flex-1 overflow-y-auto -mx-1 px-1">
        {issues.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-[#4A5D4E]/8 flex items-center justify-center mb-4"><Check size={26} className="text-[#4A5D4E]" /></div>
            <p className="text-[14px] text-[#1e2d1f]/60 max-w-[260px] leading-relaxed">{running ? 'Перо читает книгу…' : 'Перо не нашёл противоречий с Миром. Запусти проверку после правок.'}</p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-[13px] text-[#1e2d1f]/45 text-center py-10">Нет нестыковок этой важности.</p>
        ) : (
          <div className="space-y-5 pb-4">
            {sortedGroups.map(({ key, list }) => {
              const byEntity = groupBy === 'entity';
              const pigment = ENTITY_PIGMENT[entityType(byEntity ? key : list[0].entityName) ?? ''] ?? '#54627F';
              return (
                <div key={key}>
                  <div className="flex items-center gap-2 mb-2.5">
                    {byEntity ? (
                      <>
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: pigment }} />
                        <button onClick={() => onOpenEntity(key)} className="text-[14px] font-semibold text-[#1e2d1f] hover:underline">{key}</button>
                      </>
                    ) : (
                      <>
                        <FileText size={13} className="text-[#1e2d1f]/40 flex-shrink-0" />
                        <button onClick={() => onJump(key, list[0].quote || '')} className="text-[14px] font-semibold text-[#1e2d1f] hover:underline truncate">{chapterLabel(key)}</button>
                      </>
                    )}
                    <span className="text-[11px] text-[#1e2d1f]/45 flex-shrink-0">{list.length} {plural(list.length)}</span>
                  </div>
                  <div className="space-y-3">
                    {list.map(issue => {
                      const s = sev(issue.severity);
                      return (
                        <div key={issue.id}>
                          <div className="flex items-start gap-2 mb-1.5">
                            <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 mt-0.5 flex-shrink-0" style={{ color: s.color, background: `${s.color}1f` }}>{s.label}</span>
                            <span className="text-[13px] text-[#1e2d1f] leading-snug">
                              {!byEntity && issue.entityName && <><button onClick={() => onOpenEntity(issue.entityName!)} className="font-semibold hover:underline">{issue.entityName}:</button>{' '}</>}
                              {issue.issue}
                            </span>
                          </div>
                          {issue.quote && (
                            <button
                              onClick={() => issue.chapterId && onJump(issue.chapterId, issue.quote!)}
                              className="w-full text-left font-serif text-[13px] italic text-[#1e2d1f] rounded-r-md pl-2.5 pr-2 py-1.5 mb-1.5 hover:bg-black/[0.02] transition-colors"
                              style={{ borderLeft: `2px solid ${s.color}`, background: `${s.color}0d` }}
                            >…{issue.quote}…</button>
                          )}
                          <div className="flex items-center gap-1 text-[11px]">
                            {issue.chapterId && (
                              <button onClick={() => onJump(issue.chapterId!, issue.quote || (issue.entityName ?? ''))} className="inline-flex items-center gap-1 text-[#4A5D4E] font-medium hover:underline">
                                <ArrowRight size={12} /> {chapterLabel(issue.chapterId)} · перейти к фразе
                              </button>
                            )}
                            <div className="ml-auto flex items-center gap-0.5">
                              {issue.entityName && (
                                <button onClick={() => onOpenEntity(issue.entityName!)} title="Открыть героя в Мире и поправить канон" className="inline-flex items-center gap-1 text-[#1e2d1f]/45 hover:text-[#4A5D4E] px-2 py-1 rounded-md hover:bg-[#1e2d1f]/5 transition-colors"><Wrench size={11} /> Исправить в Мире</button>
                              )}
                              <button onClick={() => onDismiss(issue.id)} title="Ложная нестыковка" className="inline-flex items-center gap-1 text-[#1e2d1f]/45 hover:text-[#9E4338] px-2 py-1 rounded-md hover:bg-[#1e2d1f]/5 transition-colors"><X size={11} /> Отклонить</button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function plural(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'нестыковка';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'нестыковки';
  return 'нестыковок';
}
