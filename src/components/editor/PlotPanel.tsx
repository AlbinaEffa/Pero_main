/**
 * PlotPanel — столб «Сюжет» (планирование/структура), сосед Мира в том же aside-оверлее.
 * Линзы: Скелет (обратный план) · Линии (нити + ружья Чехова) · Канва (бит-лист) ·
 * Арки (Want/Need/Lie). Философия та же, что у Мира: Перо ЧИТАЕТ рукопись и показывает
 * её структуру, а не генерит план за автора.
 */
import { useEffect, useState } from 'react';
import { X, ListTree, GitBranch, LayoutTemplate, Compass, PackageCheck, Clock } from 'lucide-react';
import { api } from '../../services/api';
import { Entity, EntityLink, EntityEvent, Chapter } from './types';
import { BookPremise } from './BookPremise';
import { SkeletonLens, type ChapterBeat } from './SkeletonLens';
import { ThreadsLens, type PlotThread } from './ThreadsLens';
import { BeatsLens } from './BeatsLens';
import { ArcsLens } from './ArcsLens';
import { DeliveryLens } from './DeliveryLens';
import { TimelineLens } from './TimelineLens';

const SUBTITLE: Record<string, string> = {
  skeleton: '— скелет твоей книги',
  threads:  '— сквозные линии и ружья Чехова',
  beats:    '— где ты на бит-карте',
  arcs:     '— внутренние арки героев',
  delivery: '— доставил ли задуманное',
  timeline: '— события по оси времени',
};

type PlotLens = 'skeleton' | 'threads' | 'beats' | 'arcs' | 'delivery' | 'timeline';
const LENSES: { id: PlotLens; label: string; icon: typeof ListTree; soon?: boolean }[] = [
  { id: 'skeleton', label: 'Скелет', icon: ListTree },
  { id: 'threads',  label: 'Линии',  icon: GitBranch },
  { id: 'beats',    label: 'Канва',  icon: LayoutTemplate },
  { id: 'arcs',     label: 'Арки',   icon: Compass },
  { id: 'timeline', label: 'Таймлайн', icon: Clock },
  { id: 'delivery', label: 'Доставка', icon: PackageCheck },
];

interface Props {
  projectId: string;
  initialLens?: PlotLens;
  chapters: Chapter[];
  entities: Entity[];
  events: EntityEvent[];
  links: EntityLink[];
  threads: PlotThread[];
  scanningThreads: boolean;
  onScanThreads: () => void;
  onDismissThread: (threadId: string) => void;
  onToggleThreadResolved: (threadId: string, resolved: boolean) => void;
  onAddThread: (data: { title: string; kind: string; summary: string }) => void;
  onEditThread: (threadId: string, data: { title?: string; summary?: string; kind?: string }) => void;
  onSaveChapterPlan: (chapterId: string, plan: string) => void;
  onAddChapter: () => void;
  onJumpToChapter: (chapterId: string, entityName: string) => void;
  onOpenEntity: (name: string) => void;
  onClose: () => void;
}

export function PlotPanel({ projectId, initialLens, chapters, entities, events, links, threads, scanningThreads, onScanThreads, onDismissThread, onToggleThreadResolved, onAddThread, onEditThread, onSaveChapterPlan, onAddChapter, onJumpToChapter, onOpenEntity, onClose }: Props) {
  const [lens, setLens] = useState<PlotLens>(initialLens ?? 'skeleton');
  const [tlFocus, setTlFocus] = useState<string | null>(null); // фокус таймлайна на одну сущность = арка

  // Бит-карта по умолчанию (Романс-бит) — для аннотаций битов в «Скелете».
  const [chapterBeats, setChapterBeats] = useState<ChapterBeat[]>([]);
  useEffect(() => {
    api.get<{ beats: ChapterBeat[] | null }>(`/plot/${projectId}/beats?template=romancing_the_beat`)
      .then(d => setChapterBeats((d.beats ?? []).filter(b => b.chapterId)))
      .catch(() => setChapterBeats([]));
  }, [projectId]);

  return (
    <div className="flex flex-col h-full w-full">
      {/* Шапка — единый стиль с «Миром» (sans, плашка, бордюр) */}
      <div className="px-5 py-4 border-b border-[#1e2d1f]/5 bg-white/40 flex-shrink-0">
        <div className="flex justify-between items-center">
          <div className="flex items-baseline gap-2 min-w-0">
            <h2 className="font-sans text-base font-semibold text-[#1e2d1f]">Сюжет</h2>
            <span className="text-[11px] text-[#1e2d1f]/40 truncate">{SUBTITLE[lens]}</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-[#1e2d1f]/5 text-[#1e2d1f]/50 transition-colors"><X size={18} /></button>
        </div>
      </div>

      {/* Замысел книги — корень структуры (логлайн + премис), над всеми линзами */}
      <BookPremise projectId={projectId} />

      {/* Переключатель линз — единый стиль с «Миром» */}
      <div className="flex items-center flex-wrap gap-1.5 px-3 py-2 border-b border-[#1e2d1f]/5 bg-white/20 flex-shrink-0">
        {LENSES.map(l => {
          const Icon = l.icon;
          const active = lens === l.id;
          return (
            <button
              key={l.id}
              onClick={() => !l.soon && setLens(l.id)}
              disabled={l.soon}
              title={l.soon ? 'Скоро' : l.label}
              className={`flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                l.soon ? 'text-[#1e2d1f]/30 cursor-default'
                : active ? 'bg-[#1e2d1f] text-[#f5f0e8]'
                : 'text-[#1e2d1f]/55 hover:bg-[#1e2d1f]/[0.06]'
              }`}
            >
              <Icon size={13} /> {l.label}{l.soon ? ' · скоро' : ''}
            </button>
          );
        })}
      </div>

      {/* Активная линза */}
      <div className="flex-1 min-h-0 px-5 py-4">
        {lens === 'skeleton' && (
          <SkeletonLens
            chapters={chapters} entities={entities} events={events} links={links}
            threads={threads} chapterBeats={chapterBeats}
            onJumpToChapter={onJumpToChapter}
            onOpenEntity={onOpenEntity}
            onOpenThreads={() => setLens('threads')}
            onOpenBeats={() => setLens('beats')}
            onSavePlan={onSaveChapterPlan}
            onAddChapter={onAddChapter}
          />
        )}
        {lens === 'threads' && (
          <ThreadsLens
            threads={threads}
            orderedChapterIds={[...chapters].sort((a, b) => a.order - b.order).map(c => c.id)}
            scanning={scanningThreads}
            onScan={onScanThreads}
            onJump={(id) => onJumpToChapter(id, '')}
            onDismiss={onDismissThread}
            onToggleResolved={onToggleThreadResolved}
            onOpenEntity={onOpenEntity}
            entityNames={new Set(entities.map(e => (e.name ?? '').trim().toLowerCase()))}
            onAddThread={onAddThread}
            onEditThread={onEditThread}
          />
        )}
        {lens === 'beats' && (
          <BeatsLens projectId={projectId} chapters={chapters} onJump={(id) => onJumpToChapter(id, '')} />
        )}
        {lens === 'arcs' && <ArcsLens projectId={projectId} onOpenEntity={onOpenEntity} />}
        {lens === 'timeline' && (
          <TimelineLens
            entities={entities}
            events={events}
            chapters={chapters}
            focusEntityId={tlFocus}
            onSetFocus={setTlFocus}
            onJumpToChapter={onJumpToChapter}
          />
        )}
        {lens === 'delivery' && <DeliveryLens projectId={projectId} onJump={(id) => onJumpToChapter(id, '')} />}
      </div>
    </div>
  );
}
