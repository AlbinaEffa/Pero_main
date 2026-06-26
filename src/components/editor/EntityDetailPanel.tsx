import { useEffect } from 'react';
import { X, ArrowRight, GitBranch, Target, CheckCircle2 } from 'lucide-react';
import { Entity, EntityLink, EntityEvent } from './types';
import type { PlotThread } from './ThreadsLens';
import {
  EntityAttributesBlock, FirstAppearanceLine, EntityConnectionsBlock, EntityTimelineBlock,
} from './entityDisplay';

const TYPE_PIGMENT: Record<string, string> = {
  character: '#A14F44', location: '#4A5D4E', item: '#91682E', rule: '#54627F',
};
const TYPE_LABEL: Record<string, string> = {
  character: 'персонаж', location: 'локация', item: 'предмет', rule: 'правило',
};

type ChapterRefLite = { id: string; title: string; order: number };

/**
 * Профиль сущности — отдельный экран в общем слоте оверлеев редактора (тот же `<aside>`, что
 * «Мир»/«Справочник»/…), поэтому габарит и положение едины со всеми вызываемыми экранами.
 * Сам компонент рисует только содержимое (кадр даёт `<aside>`). Тело — в 2 колонки, чтобы
 * профиль читался без прокрутки. Закрытие — Esc или крестик. Правка — «Открыть в Мире».
 */
export function EntityDetailPanel({
  entity, onClose, links, events, allEntities, chaptersRef, onSelectEntity, onOpenInWorld,
  threads = [], onOpenThreads,
}: {
  entity: Entity; onClose: () => void;
  links: EntityLink[]; events: EntityEvent[]; allEntities: Entity[]; chaptersRef: ChapterRefLite[];
  onSelectEntity: (e: Entity) => void; onOpenInWorld: (e: Entity) => void;
  threads?: PlotThread[]; onOpenThreads?: () => void;
}) {
  // Линии этого героя: по entityId или по имени.
  const nameLc = (entity.name ?? '').trim().toLowerCase();
  const myThreads = threads.filter(t =>
    (t.entityIds ?? []).includes(entity.id) ||
    (t.characterNames ?? []).some(n => n.trim().toLowerCase() === nameLc),
  );
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="flex flex-col h-full w-full">
      {/* Шапка */}
      <div className="px-6 py-4 border-b border-[#1e2d1f]/5 flex items-start gap-3 bg-white/40">
        <span className="w-9 h-9 rounded-full flex-shrink-0 mt-0.5" style={{ background: (TYPE_PIGMENT[entity.type] ?? '#54627F') + '22' }} />
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-semibold text-[#1e2d1f] leading-tight">{entity.name}</div>
          <div className="text-[11px] uppercase tracking-wide mt-0.5" style={{ color: TYPE_PIGMENT[entity.type] ?? '#54627F' }}>{TYPE_LABEL[entity.type] ?? 'мир'}</div>
        </div>
        <button onClick={onClose} title="Закрыть" aria-label="Закрыть профиль"
          className="p-1.5 rounded-md text-[#1e2d1f]/45 hover:bg-[#1e2d1f]/5 hover:text-[#1e2d1f] transition-colors flex-shrink-0">
          <X size={18} />
        </button>
      </div>

      {/* Тело */}
      <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">
        {entity.description && <p className="text-[14px] text-[#1e2d1f]/70 leading-relaxed">{entity.description}</p>}
        {/* 2 колонки (multi-column), блоки не разрываются — высота падает ~вдвое, прокрутки обычно нет. */}
        <div className="sm:columns-2 gap-5 [&>*]:mb-5 [&>*]:break-inside-avoid">
          <EntityAttributesBlock attributes={entity.attributes} size="md" />
          <FirstAppearanceLine entity={entity} chapters={chaptersRef} size="md" />
          <EntityConnectionsBlock entity={entity} links={links} entities={allEntities} onSelectEntity={onSelectEntity} size="md" />
          <EntityTimelineBlock entity={entity} events={events} chapters={chaptersRef} size="md" />
        </div>
        {/* Сюжетные линии героя (связь с линзой «Линии») */}
        {myThreads.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[#1e2d1f]/40 font-medium mb-2">
              <GitBranch size={12} /> Сюжетные линии · {myThreads.length}
            </div>
            <div className="space-y-1.5">
              {myThreads.map(t => (
                <button key={t.id} onClick={onOpenThreads}
                  className="w-full text-left flex items-center gap-2 rounded-lg border border-[#1e2d1f]/8 bg-white/40 px-2.5 py-1.5 hover:bg-[#1e2d1f]/[0.03] transition-colors">
                  {t.resolved
                    ? <CheckCircle2 size={13} className="text-[#4A5D4E] flex-shrink-0" />
                    : <Target size={13} className="text-[#91682E] flex-shrink-0" />}
                  <span className="text-[12.5px] text-[#1e2d1f] truncate">{t.title}</span>
                  <span className="ml-auto text-[10px] text-[#1e2d1f]/40 flex-shrink-0">{t.resolved ? 'закрыта' : 'открыта'}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <button onClick={() => onOpenInWorld(entity)}
          className="self-start flex items-center gap-1 text-[12px] font-medium text-[#1e2d1f]/55 hover:text-[#1e2d1f] transition-colors">
          Открыть в Мире <ArrowRight size={13} />
        </button>
      </div>
    </div>
  );
}
