import { useEffect } from 'react';
import { AlertTriangle, ArrowRight, X } from 'lucide-react';
import { Entity } from './types';

interface ChapterSummary { id: string; title: string; order: number; }

interface Props {
  name: string;
  /** Конфликтующие сущности с этим именем (разные описания). */
  group: Entity[];
  chapters: ChapterSummary[];
  x: number;
  y: number;
  onClose: () => void;
  onJump: (chapterId: string, name: string) => void;
  onOpenWorld: () => void;
  /** Пометить «не нестыковка» — больше не подсвечивать. */
  onDismiss: () => void;
  /** Слить дубли одного имени в одну сущность (если их несколько). */
  onMerge?: () => void;
  /** Текст конкретной нестыковки из скана (B2), если кликнули по фразе. */
  issueText?: string;
  issueChapterId?: string | null;
}

/**
 * Инлайн-поповер нестыковки — всплывает по клику на подчёркнутом в тексте имени.
 * Показывает расходящиеся описания по главам и даёт перейти к ним. «Вау» нативно:
 * автор видит конфликт прямо там, где пишет, и сразу прыгает разбираться.
 */
export function ContradictionPopover({ name, group, chapters, x, y, onClose, onJump, onOpenWorld, onDismiss, onMerge, issueText }: Props) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const chapterTitle = (id?: string | null) => {
    const c = chapters.find(ch => ch.id === id);
    return c ? (c.title || `Глава ${c.order + 1}`) : null;
  };

  return (
    <>
      <div className="fixed inset-0 z-[69]" onClick={onClose} />
      <div
        style={{ position: 'fixed', left: Math.min(x, window.innerWidth - 320), top: y + 12, zIndex: 70, width: 300 }}
        className="bg-white rounded-2xl shadow-2xl border border-[#A14F44]/20 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3.5 py-2.5 bg-[#A14F44]/[0.07] border-b border-[#A14F44]/10">
          <AlertTriangle size={15} className="text-[#A14F44]" />
          <span className="text-[12.5px] font-semibold text-[#A14F44] flex-1">Возможная нестыковка</span>
          <button onClick={onClose} className="p-0.5 rounded text-[#1e2d1f]/40 hover:text-[#1e2d1f]"><X size={14} /></button>
        </div>
        <div className="p-3">
          <div className="text-[13px] font-medium text-[#1e2d1f] mb-2">{name}</div>
          {issueText && (
            <div className="text-[12px] text-[#A14F44] leading-snug mb-2.5 bg-[#A14F44]/[0.06] rounded-lg px-2.5 py-2">{issueText}</div>
          )}
          <div className="flex flex-col gap-2">
            {group.map(e => {
              const ch = chapterTitle(e.chapterId);
              return (
                <button
                  key={e.id}
                  onClick={() => { if (e.chapterId) onJump(e.chapterId, name); }}
                  className="text-left rounded-lg bg-[#f5f0e8]/70 hover:bg-[#f5f0e8] border border-transparent hover:border-[#1e2d1f]/10 transition-all p-2.5"
                >
                  {ch && <span className="block text-[10px] font-semibold uppercase tracking-wide text-[#1e2d1f]/45 mb-0.5">{ch}</span>}
                  <span className="block text-[12px] text-[#1e2d1f]/80 leading-snug">{e.description || '—'}</span>
                </button>
              );
            })}
          </div>
          <div className="flex gap-2 mt-2.5">
            <button onClick={onOpenWorld} className="flex-1 flex items-center justify-center gap-1.5 text-[11.5px] font-medium text-[#1e2d1f]/70 hover:text-[#1e2d1f] border border-[#1e2d1f]/10 hover:border-[#1e2d1f]/20 rounded-lg py-1.5 transition-colors">
              Исправить в Мире <ArrowRight size={12} />
            </button>
            <button onClick={onDismiss} className="flex items-center justify-center gap-1 text-[11.5px] font-medium text-[#1e2d1f]/45 hover:text-[#1e2d1f]/70 px-3 rounded-lg transition-colors" title="Это не нестыковка — больше не подсвечивать">
              Не нестыковка
            </button>
          </div>
          {onMerge && group.length >= 2 && (
            <button onClick={onMerge} className="mt-2 w-full text-[11.5px] font-medium text-[#71597F] hover:bg-[#71597F]/[0.08] rounded-lg py-1.5 transition-colors" title="Это один объект, записанный дважды — слить в одну запись">
              Это один объект — объединить записи
            </button>
          )}
        </div>
      </div>
    </>
  );
}
