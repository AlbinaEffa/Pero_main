import { useState, useMemo } from 'react';
import {
  X, Check, Sparkles, ChevronLeft, Users, MapPin, Box, Globe,
  ChevronRight, ChevronDown, RotateCcw, ExternalLink,
  BookOpen, LayoutGrid, Share2,
} from 'lucide-react';
import { PresenceLens } from './PresenceLens';
import { ConnectionsLens } from './ConnectionsLens';
import { TimelineLens } from './TimelineLens';
import { MapLens } from './MapLens';
import { MargOpenBook } from './Marginalia';
import { Clock, Map as MapIcon } from 'lucide-react';

type LensMode = 'catalog' | 'presence' | 'links' | 'timeline' | 'map';
const LENSES: { id: LensMode; label: string; icon: typeof BookOpen; soon?: boolean }[] = [
  { id: 'catalog',  label: 'Каталог',     icon: BookOpen },
  { id: 'presence', label: 'Присутствие', icon: LayoutGrid },
  { id: 'links',    label: 'Связи',       icon: Share2 },
  { id: 'timeline', label: 'Таймлайн',    icon: Clock },
  { id: 'map',      label: 'Карта',       icon: MapIcon },
];
import { Entity, EntityLink, EntityEvent, BibleUpdateSuggestion } from './types';
import {
  significanceLabel, significanceColor, groupBySignificance,
  EntityAttributesBlock, EntityConnectionsBlock, EntityTimelineBlock, FirstAppearanceLine,
} from './entityDisplay';
import { wordDiff, DiffToken } from '../../lib/wordDiff';

interface ChapterSummary {
  id: string;
  title: string;
  order: number;
  povCharacter?: string | null;
}

interface Props {
  activeBibleTab: string;
  onTabChange: (tab: string) => void;
  isExtracting: boolean;
  suggestions: Entity[];
  approvedEntities: Entity[];
  updateSuggestions: BibleUpdateSuggestion[];
  entityLinks: EntityLink[];
  entityEvents: EntityEvent[];
  chapters: ChapterSummary[];
  onExtract: () => void;
  chapterFreshnessStatus: 'fresh' | 'stale' | 'unknown';
  onRecheck: () => void;
  onApproveSuggestion: (id: string) => void;
  onRejectSuggestion: (id: string) => void;
  onAcceptUpdate: (id: string) => void;
  onRejectUpdate: (id: string) => void;
  onDismissUpdate: (id: string) => void;
  onBulkDismissChapter: (chapterId: string) => void;
  onBulkRejectChapter: (chapterId: string) => void;
  /** Navigate the editor to the source location of this update. */
  onOpenInEditor: (chapterId: string, searchHighlight: string, searchQuery: string) => void;
  /** Entity ids flagged with a possible contradiction (highlighted on lenses). */
  contradictions: Set<string>;
  /** Current chapter — for the «эта глава / весь проект» scope toggle. */
  currentChapterId?: string | null;
  /** Inspector expanded to foreground — lenses render their rich layout. */
  isExpanded?: boolean;
  onClose: () => void;
  /** Слить вероятные дубли-варианты одного героя в одну запись по ids; survivorId — какое имя оставить каноном. */
  onMergeDuplicates?: (ids: string[], survivorId?: string) => void;
  /** Слить все показанные группы разом (авто-выбор выжившего) — один рефетч в конце. */
  onMergeAll?: (groups: string[][]) => void;
}

function entityTypeLabel(type: string) {
  if (type === 'character') return 'ПЕРСОНАЖ';
  if (type === 'location')  return 'ЛОКАЦИЯ';
  if (type === 'item')      return 'ПРЕДМЕТ';
  return 'ПРАВИЛО';
}

function entityTypeColor(type: string) {
  if (type === 'character') return 'bg-[#F1DFDA] text-[#9E4338]';
  if (type === 'location')  return 'bg-[#e3e8e3] text-[#4a5d4e]';
  if (type === 'item')      return 'bg-[#F2E9D8] text-[#91682E]';
  return 'bg-[#E6E8EC] text-[#54627F]';
}

/** Единый визуальный язык каталога: пигмент + иконка + ярлык — те же, что в линзах. */
const TYPE_META: Record<string, { Icon: typeof Users; pigment: string; label: string }> = {
  character: { Icon: Users,  pigment: '#A14F44', label: 'ПЕРСОНАЖ' },
  location:  { Icon: MapPin, pigment: '#4A5D4E', label: 'ЛОКАЦИЯ' },
  item:      { Icon: Box,    pigment: '#91682E', label: 'ПРЕДМЕТ' },
  rule:      { Icon: Globe,  pigment: '#54627F', label: 'ПРАВИЛО' },
};

const SIG_RANK: Record<string, number> = { major: 0, moderate: 1, minor: 2 };

/** Алиасы сущности (для детектора дублей и слияния). */
function entityAliases(e: Entity): string[] {
  const a = e.attributes as Record<string, unknown> | null | undefined;
  return Array.isArray(a?.aliases) ? (a!.aliases as string[]).filter(x => typeof x === 'string') : [];
}

/**
 * Похоже ли, что два имени — один герой: алиас, имя-префикс («Риз»⊂«Ризанд») или
 * общий корень-склонение («Фейра»/«Фейре»). Консервативно — это лишь ПОДСКАЗКА к слиянию.
 */
function namesLikelySame(a: string, b: string, aliasA: string[], aliasB: string[]): boolean {
  const x = a.trim().toLowerCase(), y = b.trim().toLowerCase();
  if (!x || !y || x === y) return false;
  if (aliasA.some(al => al.trim().toLowerCase() === y) || aliasB.some(al => al.trim().toLowerCase() === x)) return true;
  if (x.includes(' ') || y.includes(' ')) return false;        // многословные имена не схлопываем
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.length >= 3 && l.startsWith(s) && l.length - s.length <= 4) return true; // префикс-вариант
  let i = 0; while (i < s.length && s[i] === l[i]) i++;                          // общий корень
  return i >= 4 && i >= s.length * 0.7;
}

/** Группы вероятных дублей (один тип) методом объединения-поиска. Возвращает только группы ≥2. */
function findDuplicateGroups(entities: Entity[]): Entity[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  entities.forEach(e => parent.set(e.id, e.id));
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i], b = entities[j];
      if (a.type !== b.type) continue;
      if (namesLikelySame(a.name, b.name, entityAliases(a), entityAliases(b))) {
        parent.set(find(a.id), find(b.id));
      }
    }
  }
  const groups = new Map<string, Entity[]>();
  entities.forEach(e => { const r = find(e.id); (groups.get(r) ?? groups.set(r, []).get(r)!).push(e); });
  return [...groups.values()]
    .filter(g => g.length >= 2)
    .sort((a, b) => (SIG_RANK[a[0].significance ?? 'minor'] ?? 2) - (SIG_RANK[b[0].significance ?? 'minor'] ?? 2));
}

function entityFact(e: Entity): string {
  const a = e.attributes as Record<string, string> | null | undefined;
  const pick = a?.appearance || a?.role || a?.physicalDetails || a?.properties || a?.scope || '';
  const text = (pick || e.description || '').trim();
  return text.length > 64 ? text.slice(0, 63) + '…' : text;
}

/** Чистый список сущностей одного типа (как в спутнике) — без тяжёлых плиток. */
function EntityTile({ e, meta, onSelect }: {
  e: Entity; meta: { pigment: string; Icon: typeof ChevronRight }; onSelect: (id: string) => void;
}) {
  const fact = entityFact(e);
  const Icon = meta.Icon;
  return (
    <button onClick={() => onSelect(e.id)}
      className="flex items-center gap-3 text-left rounded-xl bg-white/70 hover:bg-white border border-transparent hover:border-[#1e2d1f]/10 transition-all px-3 py-2.5 w-full">
      <span className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: meta.pigment + '1a' }}>
        <Icon size={15} style={{ color: meta.pigment }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-[#1e2d1f] truncate">{e.name}</span>
          {e.significance === 'major' && <span className="text-[9px] font-semibold text-[#1e2d1f]/40 uppercase tracking-wide flex-shrink-0">главн.</span>}
        </span>
        {fact && <span className="block text-[11px] text-[#1e2d1f]/55 truncate">{fact}</span>}
      </span>
      <ChevronRight size={15} className="text-[#1e2d1f]/25 flex-shrink-0" />
    </button>
  );
}

function EntityTileGrid({ type, items, onSelect }: {
  type: string; items: Entity[]; onSelect: (id: string) => void;
}) {
  const meta = TYPE_META[type] ?? TYPE_META.rule;
  const [showEpisodic, setShowEpisodic] = useState(false);
  const sorted = [...items].sort((a, b) =>
    (SIG_RANK[a.significance ?? 'minor'] ?? 2) - (SIG_RANK[b.significance ?? 'minor'] ?? 2)
    || a.name.localeCompare(b.name, 'ru'));
  // Прогрессивное раскрытие, как в линзах: значимые сразу, эпизодических — за «+N».
  const primary = sorted.filter(e => (e.significance ?? 'minor') !== 'minor');
  const episodic = sorted.filter(e => (e.significance ?? 'minor') === 'minor');
  // Если значимых нет вовсе (бывает у предметов/правил) — показываем всё сразу.
  const shown = primary.length === 0 ? episodic : primary;
  const hiddenEpisodic = primary.length === 0 ? [] : episodic;
  return (
    <div className="flex flex-col gap-1.5">
      {shown.map(e => <EntityTile key={e.id} e={e} meta={meta} onSelect={onSelect} />)}
      {showEpisodic && hiddenEpisodic.map(e => <EntityTile key={e.id} e={e} meta={meta} onSelect={onSelect} />)}
      {hiddenEpisodic.length > 0 && (
        <button
          onClick={() => setShowEpisodic(v => !v)}
          className="flex items-center gap-1 self-start mt-0.5 text-[11px] font-medium text-[#1e2d1f]/50 hover:text-[#1e2d1f] transition-colors"
        >
          {showEpisodic ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {showEpisodic ? 'свернуть эпизодических' : `показать ещё ${hiddenEpisodic.length} эпизодических`}
        </button>
      )}
    </div>
  );
}

/** Единая карточка-деталь сущности (любой тип) — открывается из плитки или связи. */
function EntityDetailView({ entity, links, allEntities, events, chapters, onBack, onSelectEntity }: {
  entity: Entity; links: EntityLink[]; allEntities: Entity[]; events: EntityEvent[];
  chapters: ChapterSummary[]; onBack: () => void; onSelectEntity: (e: Entity) => void;
}) {
  const meta = TYPE_META[entity.type] ?? TYPE_META.rule;
  const Icon = meta.Icon;
  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="flex items-center gap-2 text-xs text-[#1e2d1f]/60 hover:text-[#1e2d1f] transition-colors self-start">
        <ChevronLeft size={14} /> Назад к Миру
      </button>
      <div className="flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4" style={{ background: meta.pigment + '1a' }}>
          <Icon size={32} style={{ color: meta.pigment }} />
        </div>
        <h2 className="text-xl font-bold text-[#1E2D1F] mb-1">{entity.name}</h2>
        <div className="flex items-center justify-center gap-1.5 flex-wrap mb-2">
          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: meta.pigment }}>{meta.label}</span>
          {entity.significance && (
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${significanceColor(entity.significance)}`}>
              {significanceLabel(entity.significance)}
            </span>
          )}
        </div>
        <FirstAppearanceLine entity={entity} chapters={chapters} />
      </div>
      <div>
        <h4 className="text-[10px] font-bold text-ink/55 uppercase tracking-wider mb-2 ml-1">Описание</h4>
        <div className={`bg-white p-4 rounded-xl border border-ink/5 text-[13px] leading-relaxed text-ink/80 ${entity.type === 'rule' ? 'italic font-serif' : ''}`}>
          {entity.description}
        </div>
      </div>
      <EntityAttributesBlock attributes={entity.attributes} />
      <EntityConnectionsBlock entity={entity} links={links} entities={allEntities} onSelectEntity={onSelectEntity} />
      <EntityTimelineBlock entity={entity} events={events} chapters={chapters} />
    </div>
  );
}

export function StoryBiblePanel({
  activeBibleTab, onTabChange, isExtracting,
  suggestions, approvedEntities, updateSuggestions,
  entityLinks, entityEvents, chapters,
  onExtract, chapterFreshnessStatus, onRecheck,
  onApproveSuggestion, onRejectSuggestion,
  onAcceptUpdate, onRejectUpdate, onDismissUpdate,
  onBulkDismissChapter, onBulkRejectChapter,
  onOpenInEditor, contradictions, currentChapterId, isExpanded, onClose, onMergeDuplicates, onMergeAll,
}: Props) {
  const [lensMode, setLensMode] = useState<LensMode>('catalog');
  const [scope, setScope] = useState<'project' | 'chapter'>('project');
  /** Линза «Таймлайн», отфильтрованная на одну сущность = арка героя. */
  const [focusEntityId, setFocusEntityId] = useState<string | null>(null);
  /** Выбранная сущность для карточки-детали (единая для всех типов). */
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  /** Follow a connection: open the entity card on the other end. */
  function openEntity(entity: Entity) {
    setSelectedEntityId(entity.id);
    if (activeBibleTab === 'inbox' || activeBibleTab === 'updates') onTabChange('characters');
  }

  const pendingUpdates = updateSuggestions.filter(u => u.status === 'pending');
  const pendingTotal = suggestions.length + pendingUpdates.length;

  // Scope «эта глава»: сущности, у которых есть появление/событие/связь в текущей главе.
  const chapterEntityIds = useMemo(() => {
    if (!currentChapterId) return new Set<string>();
    const ids = new Set<string>();
    approvedEntities.forEach(e => { if (e.chapterId === currentChapterId) ids.add(e.id); });
    entityEvents.forEach(ev => { if (ev.chapterId === currentChapterId) ids.add(ev.entityId); });
    entityLinks.forEach(l => {
      if (l.chapterId === currentChapterId) { ids.add(l.sourceEntityId); ids.add(l.targetEntityId); }
    });
    return ids;
  }, [currentChapterId, approvedEntities, entityEvents, entityLinks]);

  const visibleEntities = useMemo(
    () => (scope === 'project' ? approvedEntities : approvedEntities.filter(e => chapterEntityIds.has(e.id))),
    [scope, approvedEntities, chapterEntityIds],
  );

  // Вероятные дубли-варианты одного героя (Риз/Ризанд) — подсказка к слиянию (по всему миру).
  const dupGroups = useMemo(() => findDuplicateGroups(approvedEntities), [approvedEntities]);
  const [dismissedDups, setDismissedDups] = useState<Set<string>>(new Set());
  const dupKey = (g: Entity[]) => g.map(e => e.id).sort().join('|');

  // Сводка мира — «что это и сколько всего» при открытии.
  const worldStats = useMemo(() => {
    const byType: Record<string, number> = {};
    approvedEntities.forEach(e => { byType[e.type] = (byType[e.type] ?? 0) + 1; });
    return { byType, links: entityLinks.length, events: entityEvents.length, total: approvedEntities.length };
  }, [approvedEntities, entityLinks, entityEvents]);

  // Group pending updates by chapter, sorted by chapter order
  const chapterLookup = useMemo(
    () => new Map(chapters.map(c => [c.id, c])),
    [chapters],
  );

  const groupedUpdates = useMemo(() => {
    const groups = new Map<string, {
      chapterId: string | null;
      chapterTitle: string;
      order: number;
      updates: BibleUpdateSuggestion[];
    }>();

    for (const upd of pendingUpdates) {
      const key = upd.chapterId ?? '__unknown__';
      if (!groups.has(key)) {
        const chapter = upd.chapterId ? chapterLookup.get(upd.chapterId) : undefined;
        groups.set(key, {
          chapterId:    upd.chapterId,
          chapterTitle: chapter?.title ?? upd.chapterTitle ?? 'Неизвестная глава',
          order:        chapter?.order ?? 9999,
          updates:      [],
        });
      }
      groups.get(key)!.updates.push(upd);
    }

    return [...groups.values()]
      .sort((a, b) => a.order - b.order || a.chapterTitle.localeCompare(b.chapterTitle, 'ru'))
      .map(g => ({
        ...g,
        updates: g.updates.sort((a, b) => a.entityName.localeCompare(b.entityName, 'ru')),
      }));
  }, [pendingUpdates, chapterLookup]);

  return (
    <div className="flex flex-col h-full w-full">
      <div className="px-5 py-4 border-b border-[#1e2d1f]/5 bg-white/40">
        <div className="flex justify-between items-center">
          <h2 className="font-sans text-base font-semibold text-[#1e2d1f]">Мир</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-[#1e2d1f]/5 text-[#1e2d1f]/50 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

      </div>

      {/* Переключатель линз + scope — переносится, ничего не уезжает вбок */}
      <div className="flex items-center flex-wrap gap-1.5 px-3 py-2 border-b border-[#1e2d1f]/5 bg-white/20">
        {LENSES.map(l => (
          <button
            key={l.id}
            onClick={() => { if (!l.soon) setLensMode(l.id as LensMode); }}
            disabled={l.soon}
            className={`flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
              l.soon
                ? 'text-[#1e2d1f]/30 cursor-default'
                : lensMode === l.id
                ? 'bg-[#1e2d1f] text-[#f5f0e8]'
                : 'text-[#1e2d1f]/55 hover:bg-[#1e2d1f]/[0.06]'
            }`}
            title={l.soon ? 'Скоро' : l.label}
          >
            <l.icon size={13} />
            {l.label}{l.soon ? ' · скоро' : ''}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {pendingTotal > 0 && (
            <button
              onClick={() => onTabChange('inbox')}
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold bg-[#71597F]/12 text-[#71597F] hover:bg-[#71597F]/20 transition-colors"
              title="Новые находки на одобрение"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#71597F]" /> {pendingTotal}
            </button>
          )}
          {worldStats.total > 0 && (
            <div className="flex items-center rounded-lg bg-[#1e2d1f]/[0.06] p-0.5 text-[10.5px] font-medium">
              {(['chapter', 'project'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  disabled={s === 'chapter' && !currentChapterId}
                  className={`px-2 py-0.5 rounded-md transition-colors ${
                    scope === s ? 'bg-white text-[#1e2d1f]' : 'text-[#1e2d1f]/50 hover:text-[#1e2d1f]'
                  } ${s === 'chapter' && !currentChapterId ? 'opacity-40 cursor-default' : ''}`}
                  title={s === 'chapter' ? 'Показать только эту главу' : 'Показать всю книгу'}
                >
                  {s === 'chapter' ? 'Эта глава' : 'Вся книга'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className={isExpanded ? 'max-w-[940px] mx-auto' : ''}>
        {lensMode === 'presence' ? (
          <PresenceLens
            entities={visibleEntities}
            events={entityEvents}
            links={entityLinks}
            chapters={chapters}
            contradictions={contradictions}
            onJumpToChapter={(chapterId, name) => onOpenInEditor(chapterId, name, name)}
          />
        ) : lensMode === 'links' ? (
          <ConnectionsLens
            entities={visibleEntities}
            links={entityLinks}
            contradictions={contradictions}
            expanded={!!isExpanded}
            onJumpToChapter={(chapterId, name) => onOpenInEditor(chapterId, name, name)}
          />
        ) : lensMode === 'timeline' ? (
          <TimelineLens
            entities={visibleEntities}
            events={entityEvents}
            chapters={chapters}
            focusEntityId={focusEntityId}
            onSetFocus={setFocusEntityId}
            onJumpToChapter={(chapterId, name) => onOpenInEditor(chapterId, name, name)}
          />
        ) : lensMode === 'map' ? (
          <MapLens
            entities={visibleEntities}
            links={entityLinks}
            onJumpToChapter={(chapterId, name) => onOpenInEditor(chapterId, name, name)}
          />
        ) : (<>

        {/* Мини-навигация инбокса (Новое/Обновления) — только в режиме обзора находок */}
        {(activeBibleTab === 'inbox' || activeBibleTab === 'updates') && (
          <div className="flex items-center gap-2 mb-4">
            <button onClick={() => onTabChange('characters')} className="flex items-center gap-1 text-xs text-[#1e2d1f]/55 hover:text-[#1e2d1f] transition-colors mr-1">
              <ChevronLeft size={14} /> Мир
            </button>
            {([['inbox', 'Новое', suggestions.length], ['updates', 'Обновления', pendingUpdates.length]] as const).map(([id, label, n]) => (
              <button
                key={id}
                onClick={() => onTabChange(id)}
                className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors ${
                  activeBibleTab === id ? 'bg-[#1e2d1f] text-[#f5f0e8]' : 'text-[#1e2d1f]/55 hover:bg-[#1e2d1f]/[0.06]'
                }`}
              >
                {label}
                {n > 0 && <span className={`text-[9px] leading-none rounded-full px-1.5 py-0.5 ${activeBibleTab === id ? 'bg-white/25' : 'bg-[#71597F]/15 text-[#71597F]'}`}>{n}</span>}
              </button>
            ))}
          </div>
        )}

        {/* ── INBOX TAB ── */}
        {activeBibleTab === 'inbox' && (
          <div className="flex flex-col h-full">
            {/* Статус чтения главы вынесен в шапку панели (всегда виден) — здесь дубль убран. */}
            {suggestions.length === 0 && !isExtracting ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
                <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center mb-4 text-[#1e2d1f]/20">
                  <Sparkles size={24} />
                </div>
                <h3 className="font-medium text-[#1e2d1f]/80 mb-2">Нет новых фактов</h3>
                <p className="text-xs text-[#1e2d1f]/50 mb-6 leading-relaxed">
                  Нажмите кнопку ниже, чтобы Перо прочитало текущую главу и нашло новые детали для Мира.
                </p>
                <button
                  onClick={onExtract}
                  className="bg-[#1e2d1f] text-[#f5f0e8] px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-[#2a3f2b] transition-colors flex items-center gap-2"
                >
                  <Sparkles size={16} />
                  Извлечь факты
                </button>
              </div>
            ) : isExtracting ? (
              <div className="flex-1 flex flex-col items-center justify-center">
                <div className="w-8 h-8 border-2 border-[#1e2d1f]/20 border-t-[#1e2d1f] rounded-full animate-spin mb-4" />
                <span className="text-sm font-medium text-[#1e2d1f]/70">Анализ текста...</span>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-[#1e2d1f]/55">Найдено в тексте</span>
                  <button
                    onClick={() => suggestions.forEach(s => onApproveSuggestion(s.id))}
                    className="text-xs font-medium text-[#1e2d1f]/60 hover:text-[#1e2d1f]"
                  >
                    Одобрить все
                  </button>
                </div>
                {suggestions.map(suggestion => (
                  <div key={suggestion.id} className="bg-white rounded-2xl p-4 border border-[#1e2d1f]/5 relative group">
                    <button
                      onClick={() => onRejectSuggestion(suggestion.id)}
                      className="absolute top-3 right-3 p-1 rounded-md text-[#1e2d1f]/55 hover:bg-[#f5f0e8] hover:text-[#1e2d1f] transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <X size={14} />
                    </button>
                    <div className="flex items-center gap-1.5 flex-wrap mb-2">
                      <div className={`inline-block px-2 py-0.5 rounded text-[9px] font-bold tracking-widest ${entityTypeColor(suggestion.type)}`}>
                        {entityTypeLabel(suggestion.type)}
                      </div>
                      {suggestion.significance && (
                        <div className={`inline-block px-2 py-0.5 rounded text-[9px] font-semibold tracking-wide ${significanceColor(suggestion.significance)}`}>
                          {significanceLabel(suggestion.significance)}
                        </div>
                      )}
                    </div>
                    <h4 className="font-serif font-bold text-[#1e2d1f] mb-1">{suggestion.name}</h4>
                    <p className="text-xs text-[#1e2d1f]/70 mb-3">{suggestion.description}</p>
                    <button
                      onClick={() => onApproveSuggestion(suggestion.id)}
                      className="w-full py-2 rounded-xl bg-[#f5f0e8] hover:bg-[#e8e2d5] text-[#1e2d1f] text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Check size={14} />
                      Одобрить
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── UPDATES TAB ── */}
        {activeBibleTab === 'updates' && (
          <div className="flex flex-col h-full">
            {pendingUpdates.length === 0 && !isExtracting ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
                <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center mb-4 text-[#1e2d1f]/20">
                  <Check size={24} />
                </div>
                <h3 className="font-medium text-[#1e2d1f]/80 mb-2">Обновлений нет</h3>
                <p className="text-xs text-[#1e2d1f]/50 leading-relaxed">
                  Когда ИИ найдёт новые детали о уже известных сущностях, они появятся здесь.
                </p>
              </div>
            ) : isExtracting ? (
              <div className="flex-1 flex flex-col items-center justify-center">
                <div className="w-8 h-8 border-2 border-[#1e2d1f]/20 border-t-[#1e2d1f] rounded-full animate-spin mb-4" />
                <span className="text-sm font-medium text-[#1e2d1f]/70">Анализ текста...</span>
              </div>
            ) : (
              <div className="space-y-5">
                {groupedUpdates.map(group => (
                  <ChapterUpdateGroup
                    key={group.chapterId ?? '__unknown__'}
                    chapterId={group.chapterId}
                    chapterTitle={group.chapterTitle}
                    updates={group.updates}
                    onAcceptUpdate={onAcceptUpdate}
                    onRejectUpdate={onRejectUpdate}
                    onDismissUpdate={onDismissUpdate}
                    onBulkDismiss={group.chapterId ? () => onBulkDismissChapter(group.chapterId!) : undefined}
                    onBulkReject={group.chapterId ? () => onBulkRejectChapter(group.chapterId!) : undefined}
                    onOpenInEditor={onOpenInEditor}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── КАТАЛОГ: одна лента секций по типам / карточка-деталь ── */}
        {activeBibleTab !== 'inbox' && activeBibleTab !== 'updates' && (() => {
          const detail = selectedEntityId ? approvedEntities.find(e => e.id === selectedEntityId) : null;
          if (detail) return (
            <EntityDetailView
              entity={detail}
              links={entityLinks}
              allEntities={approvedEntities}
              events={entityEvents}
              chapters={chapters}
              onBack={() => setSelectedEntityId(null)}
              onSelectEntity={openEntity}
            />
          );
          if (visibleEntities.length === 0) return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <MargOpenBook size={60} className="text-[#1e2d1f]/30 mb-4" />
              <p className="text-sm text-[#1e2d1f]/50">
                {scope === 'chapter' ? 'В этой главе пока нет сущностей.' : 'Мир пуст. Нажмите «Прочитать» на главе — Перо извлечёт сущности.'}
              </p>
            </div>
          );
          const SECTIONS = [
            { type: 'character', label: 'Персонажи' },
            { type: 'location',  label: 'Локации' },
            { type: 'item',      label: 'Предметы' },
            { type: 'rule',      label: 'Правила мира' },
          ] as const;
          const shownDups = dupGroups.filter(g => !dismissedDups.has(dupKey(g)));
          return (
            <div className="flex flex-col gap-7">
              {/* Возможные дубли-варианты — подсказка к слиянию (Риз/Ризанд) */}
              {onMergeDuplicates && shownDups.length > 0 && (
                <div className="rounded-xl bg-[#71597F]/[0.07] p-3">
                  <div className="flex items-center gap-1.5 mb-2 text-[#71597F] font-semibold text-[10.5px] uppercase tracking-wider">
                    <Sparkles size={12} /> Возможно, это один объект
                    {onMergeAll && shownDups.length >= 2 && (
                      <button
                        onClick={() => onMergeAll(shownDups.map(g => g.map(e => e.id)))}
                        title="Объединить все показанные группы (Перо выберет каноном самое полное имя)"
                        className="ml-auto normal-case tracking-normal text-[11px] font-medium text-[#71597F] hover:bg-[#71597F]/12 rounded-md px-2 py-0.5 transition-colors"
                      >
                        Объединить всё · {shownDups.length}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {shownDups.map(g => (
                      <div key={dupKey(g)} className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-1.5">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: TYPE_META[g[0].type]?.pigment ?? '#54627F' }} />
                        <span className="text-[10px] text-[#1e2d1f]/40 flex-shrink-0 uppercase tracking-wide">оставить</span>
                        <span className="min-w-0 flex-1 flex flex-wrap gap-1">
                          {g.map(e => (
                            <button
                              key={e.id}
                              onClick={() => onMergeDuplicates(g.map(x => x.id), e.id)}
                              title={`Объединить в «${e.name}» — остальные станут алиасами`}
                              className="text-[12px] font-medium text-[#1e2d1f] hover:text-[#71597F] hover:bg-[#71597F]/10 rounded px-1.5 py-0.5 transition-colors"
                            >
                              {e.name}
                            </button>
                          ))}
                        </span>
                        <button
                          onClick={() => setDismissedDups(prev => new Set(prev).add(dupKey(g)))}
                          title="Это разные объекты" aria-label="Это разные объекты"
                          className="flex-shrink-0 p-1 rounded-md text-[#1e2d1f]/35 hover:bg-[#1e2d1f]/5 transition-colors"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {SECTIONS.map(s => {
                const list = visibleEntities.filter(e => e.type === s.type);
                if (list.length === 0) return null;
                return (
                  <div key={s.type} id={`world-section-${s.type}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: TYPE_META[s.type].pigment }} />
                      <span className="text-[12px] font-bold uppercase tracking-wider" style={{ color: TYPE_META[s.type].pigment }}>{s.label}</span>
                      <span className="text-[11px] text-[#1e2d1f]/45 font-medium">· {list.length}</span>
                    </div>
                    <EntityTileGrid type={s.type} items={list} onSelect={setSelectedEntityId} />
                  </div>
                );
              })}
            </div>
          );
        })()}
        </>)}
        </div>
      </div>
    </div>
  );
}

// ── ChapterUpdateGroup ────────────────────────────────────────────────────────

interface ChapterUpdateGroupProps {
  chapterId: string | null;
  chapterTitle: string;
  updates: BibleUpdateSuggestion[];
  onAcceptUpdate: (id: string) => void;
  onRejectUpdate: (id: string) => void;
  onDismissUpdate: (id: string) => void;
  onBulkDismiss?: () => void;
  onBulkReject?: () => void;
  onOpenInEditor: (chapterId: string, searchHighlight: string, searchQuery: string) => void;
}

function ChapterUpdateGroup({
  chapterId, chapterTitle, updates,
  onAcceptUpdate, onRejectUpdate, onDismissUpdate,
  onBulkDismiss, onBulkReject,
  onOpenInEditor,
}: ChapterUpdateGroupProps) {
  return (
    <div>
      {/* Chapter section header — sticky within the scroll container */}
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 mb-2.5 bg-[#f5f0e8]/95 backdrop-blur-sm border-b border-[#1e2d1f]/6 flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <BookOpen size={11} className="text-[#1e2d1f]/55 flex-shrink-0" />
          <span className="text-[11px] font-bold text-[#1e2d1f]/60 truncate max-w-[150px]">
            {chapterTitle}
          </span>
          <span className="text-[10px] text-[#1e2d1f]/55 font-medium flex-shrink-0">
            · {updates.length}
          </span>
        </div>
        {(onBulkDismiss || onBulkReject) && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {onBulkDismiss && (
              <button
                onClick={onBulkDismiss}
                className="text-[10px] text-[#1e2d1f]/55 hover:text-[#1e2d1f]/70 font-medium px-2 py-0.5 rounded hover:bg-[#1e2d1f]/5 transition-colors"
                title="Отложить все обновления по этой главе"
              >
                Отложить всё
              </button>
            )}
            {onBulkReject && (
              <button
                onClick={onBulkReject}
                className="text-[10px] text-[#9E4338]/70 hover:text-[#9E4338] font-medium px-2 py-0.5 rounded hover:bg-[#F1DFDA] transition-colors"
                title="Отклонить все обновления по этой главе"
              >
                Отклонить всё
              </button>
            )}
          </div>
        )}
      </div>

      {/* Update cards */}
      <div className="space-y-2.5">
        {updates.map(upd => (
          <UpdateCard
            key={upd.id}
            update={upd}
            onAccept={() => onAcceptUpdate(upd.id)}
            onReject={() => onRejectUpdate(upd.id)}
            onDismiss={() => onDismissUpdate(upd.id)}
            onOpenInEditor={
              upd.chapterId
                ? () => onOpenInEditor(
                    upd.chapterId!,
                    upd.sourceExcerpt ?? upd.entityName,
                    upd.entityName,
                  )
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

// ── DiffView ─────────────────────────────────────────────────────────────────

/** Threshold in chars above which expand/collapse is offered. */
const EXPAND_THRESHOLD = 180;

interface DiffViewProps {
  prev: string | null;
  next: string;
}

/**
 * Renders a word-level diff between `prev` and `next`.
 * - If prev is empty/null → only show the "Стало" box.
 * - Removed words: soft red background + strikethrough.
 * - Added words: soft green background.
 */
function DiffView({ prev, next }: DiffViewProps) {
  const [expanded, setExpanded] = useState(false);

  const longContent = Math.max((prev ?? '').length, next.length) > EXPAND_THRESHOLD;

  // Compute tokens lazily; memoize by inputs
  const tokens: DiffToken[] = useMemo(
    () => (prev ? wordDiff(prev, next) : next.split(/(\s+)/).filter(Boolean).map(t => ({ kind: 'added' as const, text: t }))),
    [prev, next],
  );

  const prevTokens = tokens.filter(t => t.kind !== 'added');
  const nextTokens = tokens.filter(t => t.kind !== 'removed');

  function renderTokens(toks: DiffToken[], side: 'prev' | 'next') {
    return toks.map((tok, i) => {
      if (/^\s+$/.test(tok.text)) return <span key={i}>{tok.text}</span>;
      if (tok.kind === 'equal') {
        return (
          <span key={i} className={side === 'prev' ? 'text-[#9E4338]/70' : 'text-[#4D6B4D]/75'}>
            {tok.text}
          </span>
        );
      }
      if (tok.kind === 'removed') {
        return (
          <span key={i} className="bg-[#F1DFDA] text-[#9E4338] line-through rounded-sm px-0.5">
            {tok.text}
          </span>
        );
      }
      // added
      return (
        <span key={i} className="bg-[#E5EBE0] text-[#4D6B4D] rounded-sm px-0.5">
          {tok.text}
        </span>
      );
    });
  }

  return (
    <div className="space-y-1.5 mt-2">
      {prev && (
        <div className="bg-[#F1DFDA]/50 border border-[#9E4338] rounded-lg p-2">
          <p className="text-[9px] font-bold text-[#9E4338] uppercase tracking-widest mb-1">Было</p>
          <p
            className="text-[11px] leading-relaxed break-words"
            style={!expanded && longContent ? { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : undefined}
          >
            {renderTokens(prevTokens, 'prev')}
          </p>
        </div>
      )}
      <div className="bg-[#E5EBE0]/50 border border-[#4D6B4D] rounded-lg p-2">
        <p className="text-[9px] font-bold text-[#4D6B4D] uppercase tracking-widest mb-1">Стало</p>
        <p
          className="text-[11px] leading-relaxed break-words"
          style={!expanded && longContent ? { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : undefined}
        >
          {renderTokens(nextTokens, 'next')}
        </p>
      </div>
      {longContent && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-[10px] text-[#1e2d1f]/50 font-medium flex items-center gap-0.5 hover:text-[#1e2d1f]/80 transition-colors mt-0.5"
        >
          {expanded ? 'Свернуть' : 'Показать полностью'}
          <ChevronRight size={10} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </button>
      )}
    </div>
  );
}

// ── UpdateCard ────────────────────────────────────────────────────────────────

interface UpdateCardProps {
  update: BibleUpdateSuggestion;
  onAccept: () => void;
  onReject: () => void;
  onDismiss: () => void;
  onOpenInEditor?: () => void;
}

function UpdateCard({ update, onAccept, onReject, onDismiss, onOpenInEditor }: UpdateCardProps) {
  return (
    <div className="bg-white rounded-2xl border border-[#1e2d1f]/5 overflow-hidden">
      {/* Header */}
      <div className="p-3.5 pb-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold tracking-widest mb-1 ${entityTypeColor(update.entityType)}`}>
              {entityTypeLabel(update.entityType)}
            </div>
            <h4 className="font-serif font-bold text-[#1e2d1f] leading-snug text-[13px]">{update.entityName}</h4>
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
            {onOpenInEditor && (
              <button
                onClick={onOpenInEditor}
                className="p-1 rounded-md text-[#1e2d1f]/55 hover:text-[#1e2d1f]/70 hover:bg-[#f5f0e8] transition-colors"
                title="Открыть в тексте"
              >
                <ExternalLink size={12} />
              </button>
            )}
            <button
              onClick={onDismiss}
              className="p-1 rounded-md text-[#1e2d1f]/25 hover:text-[#1e2d1f]/60 hover:bg-[#f5f0e8] transition-colors"
              title="Отложить"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        <DiffView prev={update.previousDescription} next={update.proposedDescription} />
      </div>

      {/* Action buttons */}
      <div className="flex border-t border-[#1e2d1f]/5">
        <button
          onClick={onReject}
          className="flex-1 py-2 text-[11px] font-medium text-[#1e2d1f]/50 hover:text-[#1e2d1f] hover:bg-[#f5f0e8]/60 transition-colors flex items-center justify-center gap-1 border-r border-[#1e2d1f]/5"
          title="Оставить текущее описание"
        >
          <RotateCcw size={10} />
          Оставить
        </button>
        <button
          onClick={onAccept}
          className="flex-1 py-2 text-[11px] font-semibold text-[#4D6B4D] hover:text-[#4D6B4D] hover:bg-[#E5EBE0]/60 transition-colors flex items-center justify-center gap-1"
          title="Обновить описание в Библии"
        >
          <Check size={10} />
          Обновить
        </button>
      </div>
    </div>
  );
}
