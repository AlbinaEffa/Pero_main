import { useMemo } from 'react';
import { BookOpen, ArrowUpRight } from 'lucide-react';
import { EmptyLensState } from './EmptyLensState';

export interface BookFootnote {
  id: string;
  content: string;
  chapterId: string;
  chapterTitle: string;
  chapterOrder: number;
  number: number;
}

/**
 * Линза «Сноски» — обзор всех сносок книги списком, сгруппированным по главам, со сквозной
 * нумерацией. Клик по сноске → переход в нужную главу к её маркеру. Данные приходят готовыми
 * (распарсены из контента глав в Editor.tsx).
 */
export function FootnotesLens({ footnotes, onJump }: {
  footnotes: BookFootnote[];
  onJump: (chapterId: string, footnoteId: string) => void;
}) {
  const groups = useMemo(() => {
    const byChapter = new Map<string, { title: string; order: number; items: BookFootnote[] }>();
    for (const fn of footnotes) {
      if (!byChapter.has(fn.chapterId)) byChapter.set(fn.chapterId, { title: fn.chapterTitle, order: fn.chapterOrder, items: [] });
      byChapter.get(fn.chapterId)!.items.push(fn);
    }
    return [...byChapter.entries()].map(([chapterId, g]) => ({ chapterId, ...g })).sort((a, b) => a.order - b.order);
  }, [footnotes]);

  if (footnotes.length === 0) {
    return (
      <EmptyLensState
        icon={BookOpen}
        title="Сносок пока нет"
        hint="Поставьте курсор в текст и нажмите «¹» в панели форматирования (или «/сноска») — сноски книги соберутся здесь со сквозной нумерацией."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-[12.5px] text-[#1e2d1f]/55">
        Всего сносок: <span className="font-semibold text-[#1e2d1f]/75">{footnotes.length}</span> · нумерация сквозная по книге
      </div>
      {groups.map(g => (
        <div key={g.chapterId}>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#1e2d1f]/40 mb-2">{g.title}</div>
          <div className="flex flex-col gap-1.5">
            {g.items.map(fn => (
              <button
                key={fn.id}
                onClick={() => onJump(fn.chapterId, fn.id)}
                className="group flex items-start gap-2.5 text-left rounded-xl border border-[#1e2d1f]/8 bg-white/70 hover:bg-white hover:border-[#1e2d1f]/15 transition-all p-3"
              >
                <span className="text-[12px] font-bold text-[#71597F] shrink-0 mt-0.5 w-7 text-right">[{fn.number}]</span>
                <span className="flex-1 min-w-0 text-[13.5px] text-[#1e2d1f]/80 leading-snug">
                  {fn.content || <span className="text-[#1e2d1f]/35 italic">пустая сноска</span>}
                </span>
                <ArrowUpRight size={15} className="shrink-0 mt-0.5 text-[#1e2d1f]/25 group-hover:text-[#71597F] transition-colors" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
