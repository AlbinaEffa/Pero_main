import { Zap, Heart, Flag, Eye, Circle, BookOpen, Trash2 } from 'lucide-react';
import { Entity, EntityAttributes, EntitySignificance, EntityLink, EntityEvent } from './types';

/** Масштаб блоков: 'sm' — компактный (каталог/панель, по умолчанию), 'md' — крупнее (слой-профиль). */
export type BlockSize = 'sm' | 'md';

// ── Significance ──────────────────────────────────────────────────────────────

export function significanceLabel(s: EntitySignificance | null | undefined): string {
  if (s === 'major')    return 'Ключевой';
  if (s === 'moderate') return 'Важный';
  if (s === 'minor')    return 'Эпизодический';
  return '';
}

export function significanceColor(s: EntitySignificance | null | undefined): string {
  if (s === 'major')    return 'bg-[#EBE4EE] text-[#71597F]';
  if (s === 'moderate') return 'bg-[#E6E8EC] text-[#54627F]';
  if (s === 'minor')    return 'bg-stone-100 text-stone-500';
  return '';
}

/** Group order for character lists: главные → второстепенные → эпизодические → без категории. */
export const SIGNIFICANCE_GROUPS: { key: EntitySignificance | 'none'; title: string }[] = [
  { key: 'major',    title: 'Главные' },
  { key: 'moderate', title: 'Второстепенные' },
  { key: 'minor',    title: 'Эпизодические' },
  { key: 'none',     title: 'Без категории' },
];

export function groupBySignificance<T extends Entity>(entities: T[]): { key: string; title: string; items: T[] }[] {
  return SIGNIFICANCE_GROUPS
    .map(g => ({
      key: g.key,
      title: g.title,
      items: entities.filter(e => (e.significance ?? 'none') === g.key),
    }))
    .filter(g => g.items.length > 0);
}

// ── Attributes ────────────────────────────────────────────────────────────────

export const ATTRIBUTE_LABELS: Record<string, string> = {
  aliases:        'Псевдонимы',
  appearance:     'Внешность',
  personality:    'Характер',
  role:           'Роль',
  background:     'Предыстория',
  motivations:    'Мотивация',
  speech:         'Речь',
  secrets:        'Секреты',
  plotRelevance:  'Роль в сюжете',
  region:         'Регион',
  physicalDetails:'Описание',
  mood:           'Атмосфера',
  properties:     'Свойства',
  origin:         'Происхождение',
  owner:          'Владелец',
  scope:          'Область',
  exceptions:     'Исключения',
};

/** Display order: ключевые писательские поля сверху. */
const ATTRIBUTE_ORDER = Object.keys(ATTRIBUTE_LABELS);

/** Flatten attributes object into displayable key-value pairs. */
export function attributeEntries(attrs: EntityAttributes | null | undefined): { label: string; value: string }[] {
  if (!attrs) return [];
  return Object.entries(attrs)
    .filter(([, v]) => v && (typeof v === 'string' ? v.trim() : (v as string[]).length > 0))
    .sort(([a], [b]) => {
      const ia = ATTRIBUTE_ORDER.indexOf(a);
      const ib = ATTRIBUTE_ORDER.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    })
    .map(([k, v]) => ({
      label: ATTRIBUTE_LABELS[k] ?? k,
      value: Array.isArray(v) ? v.join(', ') : String(v),
    }));
}

export function EntityAttributesBlock({ attributes, size = 'sm' }: { attributes?: EntityAttributes | null; size?: BlockSize }) {
  const entries = attributeEntries(attributes);
  if (entries.length === 0) return null;
  const md = size === 'md';
  return (
    <div>
      <h4 className={`${md ? 'text-[11px]' : 'text-[10px]'} font-bold text-ink/55 uppercase tracking-wider mb-2 ml-1`}>Детали</h4>
      <div className="bg-white rounded-xl border border-ink/5 overflow-hidden">
        {entries.map(({ label, value }, i) => (
          <div
            key={label}
            className={`flex gap-3 ${md ? 'px-4 py-3' : 'px-4 py-2.5'} ${i < entries.length - 1 ? 'border-b border-ink/5' : ''}`}
          >
            <span className={`${md ? 'text-[13px] w-28' : 'text-[11px] w-24'} font-semibold text-ink/55 flex-shrink-0 pt-0.5`}>{label}</span>
            <span className={`${md ? 'text-[14px]' : 'text-[12px]'} text-ink/75 leading-relaxed`}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── First appearance ──────────────────────────────────────────────────────────

interface ChapterRef {
  id: string;
  title: string;
  order: number;
}

export function FirstAppearanceLine({ entity, chapters, size = 'sm' }: { entity: Entity; chapters: ChapterRef[]; size?: BlockSize }) {
  if (!entity.chapterId) return null;
  const chapter = chapters.find(c => c.id === entity.chapterId);
  if (!chapter) return null;
  const md = size === 'md';
  return (
    <div className={`flex items-center gap-1.5 ${md ? 'text-[12.5px]' : 'text-[11px]'} text-ink/60`}>
      <BookOpen size={md ? 13 : 11} className="flex-shrink-0" />
      <span>Впервые: {chapter.title}</span>
    </div>
  );
}

// ── Connections ───────────────────────────────────────────────────────────────

interface ConnectionRow {
  link: EntityLink;
  /** Сущность на другом конце связи. */
  other: Entity;
  /** Подпись связи с точки зрения выбранной сущности. */
  label: string;
}

/** Collect connections of `entity`, resolving the other side against `entities`. */
export function connectionsFor(entity: Entity, links: EntityLink[], entities: Entity[]): ConnectionRow[] {
  const byId = new Map(entities.map(e => [e.id, e]));
  const rows: ConnectionRow[] = [];
  for (const link of links) {
    if (link.sourceEntityId === entity.id) {
      const other = byId.get(link.targetEntityId);
      if (other && other.status === 'approved') rows.push({ link, other, label: link.relation });
    } else if (link.targetEntityId === entity.id) {
      const other = byId.get(link.sourceEntityId);
      // Обратное направление: показываем стрелку, чтобы не врать о направлении связи
      if (other && other.status === 'approved') rows.push({ link, other, label: `← ${link.relation}` });
    }
  }
  return rows;
}

interface ConnectionsBlockProps {
  entity: Entity;
  links: EntityLink[];
  entities: Entity[];
  onSelectEntity?: (entity: Entity) => void;
  onDeleteLink?: (linkId: string) => void;
  size?: BlockSize;
}

export function EntityConnectionsBlock({ entity, links, entities, onSelectEntity, onDeleteLink, size = 'sm' }: ConnectionsBlockProps) {
  const rows = connectionsFor(entity, links, entities);
  if (rows.length === 0) return null;
  const md = size === 'md';
  return (
    <div>
      <h4 className={`${md ? 'text-[11px]' : 'text-[10px]'} font-bold text-ink/55 uppercase tracking-wider mb-2 ml-1`}>Связи</h4>
      <div className="bg-white rounded-xl border border-ink/5 overflow-hidden">
        {rows.map(({ link, other, label }, i) => (
          <div
            key={link.id}
            className={`flex items-center gap-2 ${md ? 'px-4 py-3' : 'px-4 py-2.5'} group ${i < rows.length - 1 ? 'border-b border-ink/5' : ''}`}
          >
            <button
              onClick={onSelectEntity ? () => onSelectEntity(other) : undefined}
              className={`flex-1 min-w-0 text-left ${onSelectEntity ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span className={`${md ? 'text-[13.5px]' : 'text-[12px]'} font-semibold text-ink/80 hover:text-ink transition-colors`}>{other.name}</span>
              <span className={`${md ? 'text-[12px]' : 'text-[11px]'} text-ink/60 ml-2`}>{label}</span>
            </button>
            {onDeleteLink && (
              <button
                onClick={() => onDeleteLink(link.id)}
                className="p-1 rounded text-ink/20 hover:text-[#9E4338] hover:bg-[#F1DFDA] transition-colors opacity-0 group-hover:opacity-100"
                title="Удалить связь"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────

const EVENT_TYPE_META: Record<string, { icon: typeof Zap; color: string; label: string }> = {
  conflict:     { icon: Zap,    color: 'bg-[#F2E9D8] text-[#91682E]',     label: 'Конфликт' },
  relationship: { icon: Heart,  color: 'bg-[#F1DFDA] text-[#9E4338]',       label: 'Отношения' },
  status:       { icon: Flag,   color: 'bg-[#E5EBE0] text-[#4D6B4D]', label: 'Перемена' },
  revelation:   { icon: Eye,    color: 'bg-[#EBE4EE] text-[#71597F]',   label: 'Открытие' },
  other:        { icon: Circle, color: 'bg-stone-100 text-stone-500',     label: 'Событие' },
};

/** Sort events by chapter order (по сюжету), falling back to insertion order. */
export function sortEventsByChapter(events: EntityEvent[], chapters: ChapterRef[]): EntityEvent[] {
  const orderById = new Map(chapters.map(c => [c.id, c.order]));
  return [...events].sort((a, b) => {
    const oa = a.chapterId ? (orderById.get(a.chapterId) ?? 9999) : 9999;
    const ob = b.chapterId ? (orderById.get(b.chapterId) ?? 9999) : 9999;
    return oa - ob;
  });
}

interface TimelineBlockProps {
  entity: Entity;
  events: EntityEvent[];
  chapters: ChapterRef[];
  onDeleteEvent?: (eventId: string) => void;
  size?: BlockSize;
}

export function EntityTimelineBlock({ entity, events, chapters, onDeleteEvent, size = 'sm' }: TimelineBlockProps) {
  const own = sortEventsByChapter(events.filter(ev => ev.entityId === entity.id), chapters);
  if (own.length === 0) return null;
  const md = size === 'md';
  const chapterById = new Map(chapters.map(c => [c.id, c]));
  return (
    <div>
      <h4 className={`${md ? 'text-[11px]' : 'text-[10px]'} font-bold text-ink/55 uppercase tracking-wider mb-2 ml-1`}>Таймлайн</h4>
      <div className="bg-white rounded-xl border border-ink/5 px-4 py-3">
        <div className="relative">
          {own.map((ev, i) => {
            const meta = EVENT_TYPE_META[ev.eventType ?? 'other'] ?? EVENT_TYPE_META.other;
            const Icon = meta.icon;
            const chapterTitle = (ev.chapterId && chapterById.get(ev.chapterId)?.title) || ev.chapterTitle;
            return (
              <div key={ev.id} className="flex gap-3 group relative pb-4 last:pb-0">
                {/* Vertical connector */}
                {i < own.length - 1 && (
                  <div className={`absolute ${md ? 'left-[15px] top-8' : 'left-[13px] top-7'} bottom-0 w-px bg-ink/8`} />
                )}
                <div className={`${md ? 'w-8 h-8' : 'w-7 h-7'} rounded-full flex items-center justify-center flex-shrink-0 ${meta.color}`} title={meta.label}>
                  <Icon size={md ? 15 : 13} />
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`${md ? 'text-[13.5px]' : 'text-[12px]'} font-semibold text-ink/80 leading-snug`}>{ev.title}</p>
                    {onDeleteEvent && (
                      <button
                        onClick={() => onDeleteEvent(ev.id)}
                        className="p-0.5 rounded text-ink/20 hover:text-[#9E4338] hover:bg-[#F1DFDA] transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                        title="Удалить событие"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                  {ev.description && (
                    <p className={`${md ? 'text-[12.5px]' : 'text-[11px]'} text-ink/55 leading-relaxed mt-0.5`}>{ev.description}</p>
                  )}
                  {chapterTitle && (
                    <p className={`${md ? 'text-[11px]' : 'text-[10px]'} text-ink/55 mt-1`}>{chapterTitle}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
