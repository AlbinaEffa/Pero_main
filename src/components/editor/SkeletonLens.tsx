/**
 * SkeletonLens — «Скелет»: обратный план книги (reverse-outline).
 * Сетка всех глав по порядку с тем, что Перо УЖЕ извлёк: POV, кто в кадре, место,
 * синопсис, объём, статус. Ничего не генерит — это рентген написанного, чтобы увидеть
 * темп, баланс POV и провисания «с высоты». Источник присутствия — те же entities/
 * events/links, что и в линзе «Присутствие».
 */
import { useMemo } from 'react';
import { GitBranch, LayoutTemplate, Plus } from 'lucide-react';
import { Entity, EntityLink, EntityEvent, Chapter } from './types';
import { entityMatch } from './editorUtils';
import type { PlotThread } from './ThreadsLens';

export interface ChapterBeat { key: string; label: string; pct: number; chapterId: string | null; chapterTitle: string | null }

interface Props {
  chapters: Chapter[];
  entities: Entity[];
  events: EntityEvent[];
  links: EntityLink[];
  threads?: PlotThread[];
  chapterBeats?: ChapterBeat[];
  onJumpToChapter: (chapterId: string, entityName: string) => void;
  onOpenEntity?: (name: string) => void;
  onOpenThreads?: () => void;
  onOpenBeats?: () => void;
  onSavePlan?: (chapterId: string, plan: string) => void;
  onAddChapter?: () => void;
}

// Палитра для POV-имён (цикл по «Пигментам»).
const POV_PALETTE = ['#A14F44', '#4A5D4E', '#71597F', '#54627F', '#91682E'];
const wordCount = (html: string | null) => {
  if (!html) return 0;
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ');
  return text.split(/\s+/).filter(Boolean).length;
};
const CHAPTER_TYPE_LABEL: Record<string, string> = {
  prologue: 'Пролог', epilogue: 'Эпилог', part: 'Часть', interlude: 'Интерлюдия',
  foreword: 'Предисловие', afterword: 'Послесловие', acknowledgments: 'Благодарности', dedication: 'Посвящение',
};

export function SkeletonLens({ chapters, entities, events, links, threads = [], chapterBeats = [], onJumpToChapter, onOpenEntity, onOpenThreads, onOpenBeats, onSavePlan, onAddChapter }: Props) {
  // chapterId → число проходящих сюжетных линий.
  const threadsByChapter = useMemo(() => {
    const m = new Map<string, number>();
    threads.forEach(t => (t.chapterIds ?? []).forEach(cid => m.set(cid, (m.get(cid) ?? 0) + 1)));
    return m;
  }, [threads]);
  // chapterId → метка бита (если на главе сидит бит).
  const beatByChapter = useMemo(() => {
    const m = new Map<string, string>();
    chapterBeats.forEach(b => { if (b.chapterId) m.set(b.chapterId, b.label); });
    return m;
  }, [chapterBeats]);

  // chapterId → Set<entityId>. Присутствие = структурно (entities/events/links.chapterId) +
  // ЛЕКСИЧЕСКИ (имя сущности встречается в тексте главы) — тот же entityMatch, что «в кадре» в
  // редакторе. Так колонка «В кадре» заполнена и для ещё-не-прочитанных глав, а не молчит прочерком.
  const presenceByChapter = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (cid: string | null | undefined, eid: string) => {
      if (!cid) return;
      if (!map.has(cid)) map.set(cid, new Set());
      map.get(cid)!.add(eid);
    };
    entities.forEach(e => add(e.chapterId, e.id));
    events.forEach(ev => add(ev.chapterId, ev.entityId));
    links.forEach(l => { add(l.chapterId, l.sourceEntityId); add(l.chapterId, l.targetEntityId); });
    for (const c of chapters) {
      if (!c.content) continue;
      const text = c.content.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').toLowerCase();
      const words: { w: string; at: number }[] = [];
      const re = /[а-яёa-z0-9'-]+/gi; let m: RegExpExecArray | null;
      while ((m = re.exec(text))) words.push({ w: m[0], at: m.index });
      for (const e of entities) if (entityMatch(e.name, words, text).mentioned) add(c.id, e.id);
    }
    return map;
  }, [entities, events, links, chapters]);

  const entityById = useMemo(() => new Map(entities.map(e => [e.id, e])), [entities]);
  const entityNames = useMemo(() => new Set(entities.map(e => (e.name ?? '').trim().toLowerCase())), [entities]);

  // Стабильный цвет для каждого POV-имени.
  const povColor = useMemo(() => {
    const names = [...new Set(chapters.map(c => c.povCharacter).filter(Boolean) as string[])];
    const m = new Map<string, string>();
    names.forEach((n, i) => m.set(n, POV_PALETTE[i % POV_PALETTE.length]));
    return m;
  }, [chapters]);

  const narrative = useMemo(
    () => [...chapters].sort((a, b) => a.order - b.order),
    [chapters],
  );

  // Итоги: всего слов, баланс POV.
  const totals = useMemo(() => {
    let words = 0;
    const povWords = new Map<string, number>();
    narrative.forEach(c => {
      const w = wordCount(c.content);
      words += w;
      if (c.povCharacter) povWords.set(c.povCharacter, (povWords.get(c.povCharacter) ?? 0) + w);
    });
    const pov = [...povWords.entries()].sort((a, b) => b[1] - a[1]);
    return { words, pov, povTotal: pov.reduce((s, [, w]) => s + w, 0) };
  }, [narrative]);

  if (narrative.length === 0) {
    return <p className="text-[13px] text-[#1e2d1f]/45 text-center py-12">Пока нет глав — начни писать, и скелет соберётся сам.</p>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Итоги + баланс POV */}
      <div className="flex items-center gap-3 pb-3 mb-2 border-b border-[#1e2d1f]/8 flex-shrink-0 flex-wrap">
        <div className="text-[13px] text-[#1e2d1f]">
          <span className="font-semibold">{narrative.length}</span> глав · <span className="font-semibold">{totals.words.toLocaleString('ru')}</span> слов
        </div>
        {totals.pov.length > 0 && totals.povTotal > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[11px] text-[#1e2d1f]/45">баланс POV:</span>
            <div className="flex h-2.5 w-40 rounded-full overflow-hidden bg-[#1e2d1f]/8">
              {totals.pov.map(([name, w]) => (
                <div key={name} title={`${name} · ${Math.round((w / totals.povTotal) * 100)}%`} style={{ width: `${(w / totals.povTotal) * 100}%`, background: povColor.get(name) }} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Сетка глав */}
      <div className="flex-1 overflow-y-auto -mx-1 px-1">
        <table className="w-full table-fixed border-collapse text-[13px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wider text-[#1e2d1f]/40 text-left">
              <th className="font-medium py-1.5 pr-2 w-7">№</th>
              <th className="font-medium py-1.5 pr-3">Глава</th>
              <th className="font-medium py-1.5 pr-3 whitespace-nowrap hidden sm:table-cell w-24">POV</th>
              <th className="font-medium py-1.5 pr-3 hidden md:table-cell w-40">В кадре</th>
              <th className="font-medium py-1.5 pr-2 text-right whitespace-nowrap w-14">Слова</th>
            </tr>
          </thead>
          <tbody>
            {narrative.map((c, i) => {
              const ids = presenceByChapter.get(c.id) ?? new Set<string>();
              const present = [...ids].map(id => entityById.get(id)).filter(Boolean) as Entity[];
              const cast = present.filter(e => e.type === 'character');
              const places = present.filter(e => e.type === 'location');
              const typeLabel = c.chapterType && c.chapterType !== 'chapter' ? CHAPTER_TYPE_LABEL[c.chapterType] : null;
              return (
                <tr
                  key={c.id}
                  onClick={() => onJumpToChapter(c.id, '')}
                  className="group border-t border-[#1e2d1f]/6 hover:bg-[#1e2d1f]/[0.03] cursor-pointer align-top"
                >
                  <td className="py-2 pr-2 text-[#1e2d1f]/40 tabular-nums">{i + 1}</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {typeLabel && <span className="text-[9px] uppercase tracking-wide text-[#71597F] bg-[#71597F]/10 rounded px-1 py-0.5 flex-shrink-0">{typeLabel}</span>}
                      <span className="text-[14px] font-medium text-[#1e2d1f] truncate">{c.title?.trim() || `Глава ${i + 1}`}</span>
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.status === 'done' ? 'bg-[#4A5D4E]' : 'bg-[#91682E]/50'}`} title={c.status === 'done' ? 'готова' : 'черновик'} />
                    </div>
                    {c.summary && <div className="text-[13px] text-[#1e2d1f]/55 leading-relaxed mt-0.5 line-clamp-2">{c.summary}</div>}
                    {places.length > 0 && <div className="text-[10.5px] text-[#4A5D4E]/70 mt-0.5 truncate">📍 {places.map(p => p.name).join(', ')}</div>}
                    {/* Связь с другими линзами «Сюжета»: линии и бит на этой главе */}
                    {(threadsByChapter.get(c.id) || beatByChapter.get(c.id)) && (
                      <div className="flex items-center gap-1.5 mt-1">
                        {threadsByChapter.get(c.id) ? (
                          <button onClick={(e) => { e.stopPropagation(); onOpenThreads?.(); }} title="Сюжетные линии на этой главе → Линии" className="inline-flex items-center gap-1 text-[10px] text-[#4A5D4E] bg-[#4A5D4E]/10 rounded px-1.5 py-0.5 hover:bg-[#4A5D4E]/20 transition-colors">
                            <GitBranch size={9} /> {threadsByChapter.get(c.id)}
                          </button>
                        ) : null}
                        {beatByChapter.get(c.id) ? (
                          <button onClick={(e) => { e.stopPropagation(); onOpenBeats?.(); }} title="Бит на этой главе → Канва" className="inline-flex items-center gap-1 text-[10px] text-[#71597F] bg-[#71597F]/10 rounded px-1.5 py-0.5 hover:bg-[#71597F]/20 transition-colors">
                            <LayoutTemplate size={9} /> {beatByChapter.get(c.id)}
                          </button>
                        ) : null}
                      </div>
                    )}
                    {/* Авторский план главы (режим архитектора) — виден при ховере или если заполнен */}
                    {onSavePlan && (
                      <textarea
                        key={`plan-${c.id}`}
                        defaultValue={c.plan || ''}
                        placeholder="✎ план главы (замысел)"
                        rows={1}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => { if ((e.target.value.trim() || '') !== (c.plan || '')) onSavePlan(c.id, e.target.value); }}
                        className={`w-full mt-1 text-[11px] text-[#71597F] leading-snug bg-transparent rounded px-1.5 py-0.5 -ml-1 resize-none outline-none border border-transparent hover:border-[#71597F]/15 focus:border-[#71597F]/40 focus:bg-white/50 transition-colors placeholder:text-[#71597F]/35 field-sizing-content ${c.plan ? 'block' : 'hidden group-hover:block focus:block'}`}
                      />
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap hidden sm:table-cell">
                    {c.povCharacter
                      ? (onOpenEntity && entityNames.has(c.povCharacter.trim().toLowerCase())
                          ? <button onClick={(e) => { e.stopPropagation(); onOpenEntity(c.povCharacter!); }} title="Открыть в Мире" className="inline-block text-[11px] rounded-full px-2 py-0.5 text-white hover:opacity-85 transition-opacity" style={{ background: povColor.get(c.povCharacter) ?? '#54627F' }}>{c.povCharacter}</button>
                          : <span className="inline-block text-[11px] rounded-full px-2 py-0.5 text-white" style={{ background: povColor.get(c.povCharacter) ?? '#54627F' }}>{c.povCharacter}</span>)
                      : <span className="text-[#1e2d1f]/30">—</span>}
                  </td>
                  <td className="py-2 pr-3 hidden md:table-cell">
                    {cast.length > 0
                      ? <span className="text-[#1e2d1f]/65">{cast.slice(0, 3).map((e, idx) => (
                          <span key={e.id}>{idx > 0 ? ', ' : ''}<button onClick={(ev) => { ev.stopPropagation(); onOpenEntity?.(e.name); }} className="hover:text-[#A14F44] hover:underline transition-colors">{e.name}</button></span>
                        ))}{cast.length > 3 ? ` +${cast.length - 3}` : ''}</span>
                      : <span className="text-[#1e2d1f]/25">—</span>}
                  </td>
                  <td className="py-2 pr-2 text-right text-[#1e2d1f]/45 tabular-nums whitespace-nowrap">{wordCount(c.content).toLocaleString('ru')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {onAddChapter && (
          <button onClick={onAddChapter} className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-[#71597F] rounded-lg px-2.5 py-1.5 hover:bg-[#71597F]/10 transition-colors">
            <Plus size={13} /> Запланировать главу
          </button>
        )}
      </div>
    </div>
  );
}
