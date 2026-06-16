import { useState, useMemo } from 'react';
import {
  X, Check, Sparkles, ChevronLeft, Users, MapPin, Box, Globe,
  ChevronRight, RotateCcw, ExternalLink,
  BookOpen, LayoutGrid, Share2,
} from 'lucide-react';
import { BIBLE_MENU_ITEMS } from './constants';
import { PresenceLens } from './PresenceLens';

type LensMode = 'catalog' | 'presence';
const LENSES: { id: LensMode | 'links'; label: string; icon: typeof BookOpen; soon?: boolean }[] = [
  { id: 'catalog',  label: 'Каталог',     icon: BookOpen },
  { id: 'presence', label: 'Присутствие', icon: LayoutGrid },
  { id: 'links',    label: 'Связи',       icon: Share2, soon: true },
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
  onClose: () => void;
}

/** Map entity type → панельная вкладка, used when following a connection link. */
const TYPE_TO_TAB: Record<string, string> = {
  character: 'characters',
  location:  'locations',
  item:      'items',
  rule:      'rules',
};

function entityTypeLabel(type: string) {
  if (type === 'character') return 'ПЕРСОНАЖ';
  if (type === 'location')  return 'ЛОКАЦИЯ';
  if (type === 'item')      return 'ПРЕДМЕТ';
  return 'ПРАВИЛО';
}

function entityTypeColor(type: string) {
  if (type === 'character') return 'bg-rose-100 text-rose-800';
  if (type === 'location')  return 'bg-[#e3e8e3] text-[#4a5d4e]';
  if (type === 'item')      return 'bg-amber-100 text-amber-800';
  return 'bg-blue-100 text-blue-800';
}

export function StoryBiblePanel({
  activeBibleTab, onTabChange, isExtracting,
  suggestions, approvedEntities, updateSuggestions,
  entityLinks, entityEvents, chapters,
  onExtract, chapterFreshnessStatus, onRecheck,
  onApproveSuggestion, onRejectSuggestion,
  onAcceptUpdate, onRejectUpdate, onDismissUpdate,
  onBulkDismissChapter, onBulkRejectChapter,
  onOpenInEditor, contradictions, onClose,
}: Props) {
  const [lensMode, setLensMode] = useState<LensMode>('catalog');
  const [selectedCharId, setSelectedCharId]   = useState<string | null>(null);
  const [selectedLocId,  setSelectedLocId]    = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId]   = useState<string | null>(null);
  const [selectedRuleId, setSelectedRuleId]   = useState<string | null>(null);

  /** Follow a connection: switch tab and select the entity on the other end. */
  function openEntity(entity: Entity) {
    const tab = TYPE_TO_TAB[entity.type];
    if (!tab) return;
    if (entity.type === 'character') setSelectedCharId(entity.id);
    if (entity.type === 'location')  setSelectedLocId(entity.id);
    if (entity.type === 'item')      setSelectedItemId(entity.id);
    if (entity.type === 'rule')      setSelectedRuleId(entity.id);
    onTabChange(tab);
  }

  const pendingUpdates = updateSuggestions.filter(u => u.status === 'pending');

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

        {/* Статус чтения — всегда виден: это и есть цикл «Перо читает рукопись».
            Полуавто: при изменении/новой главе показываем «Прочитать» (один клик). */}
        <div className="mt-2.5 flex items-center gap-2 text-[12px] leading-snug">
          {isExtracting ? (
            <span className="flex items-center gap-1.5 text-[#1e2d1f]/55">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1e2d1f]/40 inline-block animate-pulse" />
              Перо читает главу…
            </span>
          ) : chapterFreshnessStatus === 'stale' ? (
            <>
              <span className="text-amber-800">Глава изменилась после анализа</span>
              <button
                onClick={onRecheck}
                className="ml-auto flex-shrink-0 font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg px-2.5 py-1 transition-colors"
              >
                Прочитать
              </button>
            </>
          ) : chapterFreshnessStatus === 'unknown' ? (
            <>
              <span className="text-[#1e2d1f]/55">Глава ещё не прочитана Пером</span>
              <button
                onClick={onExtract}
                className="ml-auto flex-shrink-0 font-semibold text-[#f5f0e8] bg-[#1e2d1f] hover:bg-[#2a3f2b] rounded-lg px-2.5 py-1 transition-colors"
              >
                Прочитать
              </button>
            </>
          ) : (
            <span className="flex items-center gap-1.5 text-[#4D6B4D]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4D6B4D] inline-block" />
              Перо прочитало эту главу
            </span>
          )}
        </div>
      </div>

      {/* Переключатель линз: Каталог · Присутствие · Связи(скоро) */}
      <div className="flex gap-1.5 px-3 py-2 border-b border-[#1e2d1f]/5 bg-white/20">
        {LENSES.map(l => (
          <button
            key={l.id}
            onClick={() => { if (!l.soon) setLensMode(l.id as LensMode); }}
            disabled={l.soon}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
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
      </div>

      {/* Tabs (только для линзы «Каталог») */}
      {lensMode === 'catalog' && (
      <div
        className="flex px-2 pt-2 border-b border-[#1e2d1f]/5 bg-white/40 overflow-x-auto"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {BIBLE_MENU_ITEMS.map(item => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={`flex-shrink-0 px-3 pb-2.5 pt-1.5 text-xs font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
              activeBibleTab === item.id
                ? 'border-[#1e2d1f] text-[#1e2d1f]'
                : 'border-transparent text-[#1e2d1f]/50 hover:text-[#1e2d1f]/80'
            }`}
          >
            <item.icon size={14} />
            {item.label}
            {item.id === 'inbox' && suggestions.length > 0 && (
              <span className="bg-rose-500 text-white text-[9px] px-1.5 py-0.5 rounded-full ml-0.5 leading-none">
                {suggestions.length}
              </span>
            )}
            {item.id === 'updates' && pendingUpdates.length > 0 && (
              <span className="bg-amber-500 text-white text-[9px] px-1.5 py-0.5 rounded-full ml-0.5 leading-none">
                {pendingUpdates.length}
              </span>
            )}
          </button>
        ))}
      </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {lensMode === 'presence' ? (
          <PresenceLens
            entities={approvedEntities}
            events={entityEvents}
            links={entityLinks}
            chapters={chapters}
            contradictions={contradictions}
            onJumpToChapter={(chapterId, name) => onOpenInEditor(chapterId, name, name)}
          />
        ) : (<>

        {/* ── INBOX TAB ── */}
        {activeBibleTab === 'inbox' && (
          <div className="flex flex-col h-full">
            {/* Статус чтения главы вынесен в шапку панели (всегда виден) — здесь дубль убран. */}
            {suggestions.length === 0 && !isExtracting ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
                <div className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center mb-4 text-[#1e2d1f]/20">
                  <Sparkles size={24} />
                </div>
                <h3 className="font-medium text-[#1e2d1f]/80 mb-2">Нет новых фактов</h3>
                <p className="text-xs text-[#1e2d1f]/50 mb-6 leading-relaxed">
                  Нажмите кнопку ниже, чтобы Перо прочитало текущую главу и нашло новые детали для Мира.
                </p>
                <button
                  onClick={onExtract}
                  className="bg-[#1e2d1f] text-[#f5f0e8] px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-[#2a3f2b] transition-colors shadow-sm flex items-center gap-2"
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
                  <div key={suggestion.id} className="bg-white rounded-2xl p-4 shadow-sm border border-[#1e2d1f]/5 relative group">
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
                <div className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center mb-4 text-[#1e2d1f]/20">
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

        {/* ── CHARACTERS TAB ── */}
        {activeBibleTab === 'characters' && (() => {
          const chars = approvedEntities.filter(e => e.type === 'character');
          const selected = chars.find(c => c.id === selectedCharId);
          if (selected) return (
            <div className="flex flex-col gap-4">
              <button onClick={() => setSelectedCharId(null)} className="flex items-center gap-2 text-xs text-[#1e2d1f]/60 hover:text-[#1e2d1f] mb-2 transition-colors">
                <ChevronLeft size={14} /> Назад к списку
              </button>
              <div className="flex flex-col items-center text-center">
                <div className="w-20 h-20 rounded-full bg-rose-100 flex items-center justify-center mb-4">
                  <Users size={32} className="text-rose-500" />
                </div>
                <h2 className="text-xl font-bold text-[#1E2D1F] mb-1">{selected.name}</h2>
                <div className="flex items-center justify-center gap-1.5 flex-wrap mb-2">
                  <span className="text-[9px] font-bold text-rose-500 uppercase tracking-wider">ПЕРСОНАЖ</span>
                  {selected.significance && (
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${significanceColor(selected.significance)}`}>
                      {significanceLabel(selected.significance)}
                    </span>
                  )}
                </div>
                <FirstAppearanceLine entity={selected} chapters={chapters} />
              </div>
              <div>
                <h4 className="text-[10px] font-bold text-ink/55 uppercase tracking-wider mb-2 ml-1">Описание</h4>
                <div className="bg-white p-4 rounded-xl border border-ink/5 shadow-sm text-[13px] leading-relaxed text-ink/80">
                  {selected.description}
                </div>
              </div>
              <EntityAttributesBlock attributes={selected.attributes} />
              <EntityConnectionsBlock
                entity={selected}
                links={entityLinks}
                entities={approvedEntities}
                onSelectEntity={openEntity}
              />
              <EntityTimelineBlock entity={selected} events={entityEvents} chapters={chapters} />
            </div>
          );
          if (chars.length === 0) return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users size={32} className="text-[#1e2d1f]/20 mb-4" />
              <p className="text-sm text-[#1e2d1f]/50">Персонажи появятся здесь после одобрения во вкладке «Новое»</p>
            </div>
          );
          return (
            <div className="space-y-5">
              {groupBySignificance(chars).map(group => (
                <div key={group.key}>
                  <div className="flex items-center gap-1.5 mb-2 ml-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#1e2d1f]/55">{group.title}</span>
                    <span className="text-[10px] text-[#1e2d1f]/55 font-medium">· {group.items.length}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {group.items.map(char => (
                      <div key={char.id} onClick={() => setSelectedCharId(char.id)}
                        className="cursor-pointer rounded-xl p-3 transition-all bg-white border border-transparent hover:border-ink/10 hover:shadow-sm flex flex-col items-center text-center">
                        <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mb-3">
                          <Users size={20} className="text-rose-500" />
                        </div>
                        <h3 className="font-bold text-[13px] text-[#1E2D1F] truncate w-full">{char.name}</h3>
                        <p className="text-[9px] font-bold text-rose-400 uppercase tracking-wider">ПЕРСОНАЖ</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* ── LOCATIONS TAB ── */}
        {activeBibleTab === 'locations' && (() => {
          const locs = approvedEntities.filter(e => e.type === 'location');
          const selected = locs.find(l => l.id === selectedLocId);
          if (selected) return (
            <div className="flex flex-col">
              <button onClick={() => setSelectedLocId(null)} className="flex items-center gap-2 text-xs text-[#1e2d1f]/60 hover:text-[#1e2d1f] mb-6 transition-colors">
                <ChevronLeft size={14} /> Назад к списку
              </button>
              <div className="flex flex-col items-center text-center mb-6">
                <div className="w-20 h-20 rounded-full bg-[#e3e8e3] flex items-center justify-center mb-4">
                  <MapPin size={32} className="text-[#4a5d4e]" />
                </div>
                <h2 className="text-xl font-bold text-[#1E2D1F] mb-1">{selected.name}</h2>
                <div className="flex items-center justify-center gap-1.5 flex-wrap">
                  <span className="text-[9px] font-bold text-[#4a5d4e] uppercase tracking-wider">ЛОКАЦИЯ</span>
                  {selected.significance && (
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${significanceColor(selected.significance)}`}>
                      {significanceLabel(selected.significance)}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex justify-center">
                  <FirstAppearanceLine entity={selected} chapters={chapters} />
                </div>
              </div>
              <h4 className="text-[10px] font-bold text-ink/55 uppercase tracking-wider mb-2 ml-1">Описание</h4>
              <div className="bg-white p-4 rounded-xl border border-ink/5 shadow-sm text-[13px] leading-relaxed text-ink/80 mb-4">
                {selected.description}
              </div>
              <div className="space-y-4">
                <EntityAttributesBlock attributes={selected.attributes} />
                <EntityConnectionsBlock entity={selected} links={entityLinks} entities={approvedEntities} onSelectEntity={openEntity} />
              </div>
            </div>
          );
          if (locs.length === 0) return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <MapPin size={32} className="text-[#1e2d1f]/20 mb-4" />
              <p className="text-sm text-[#1e2d1f]/50">Локации появятся здесь после одобрения во вкладке «Новое»</p>
            </div>
          );
          return (
            <div className="grid grid-cols-2 gap-3">
              {locs.map(loc => (
                <div key={loc.id} onClick={() => setSelectedLocId(loc.id)}
                  className="cursor-pointer rounded-xl p-3 transition-all bg-white border border-transparent hover:border-ink/10 hover:shadow-sm flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-[#e3e8e3] flex items-center justify-center mb-3">
                    <MapPin size={20} className="text-[#4a5d4e]" />
                  </div>
                  <h3 className="font-bold text-[13px] text-[#1E2D1F] truncate w-full">{loc.name}</h3>
                  <p className="text-[9px] font-bold text-[#4a5d4e] uppercase tracking-wider">ЛОКАЦИЯ</p>
                </div>
              ))}
            </div>
          );
        })()}

        {/* ── ITEMS TAB ── */}
        {activeBibleTab === 'items' && (() => {
          const items = approvedEntities.filter(e => e.type === 'item');
          const selected = items.find(i => i.id === selectedItemId);
          if (selected) return (
            <div className="flex flex-col">
              <button onClick={() => setSelectedItemId(null)} className="flex items-center gap-2 text-xs text-[#1e2d1f]/60 hover:text-[#1e2d1f] mb-6 transition-colors">
                <ChevronLeft size={14} /> Назад к списку
              </button>
              <div className="flex flex-col items-center text-center mb-6">
                <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mb-4">
                  <Box size={32} className="text-amber-600" />
                </div>
                <h2 className="text-xl font-bold text-[#1E2D1F] mb-1">{selected.name}</h2>
                <div className="flex items-center justify-center gap-1.5 flex-wrap">
                  <span className="text-[9px] font-bold text-amber-500 uppercase tracking-wider">ПРЕДМЕТ</span>
                  {selected.significance && (
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${significanceColor(selected.significance)}`}>
                      {significanceLabel(selected.significance)}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex justify-center">
                  <FirstAppearanceLine entity={selected} chapters={chapters} />
                </div>
              </div>
              <h4 className="text-[10px] font-bold text-ink/55 uppercase tracking-wider mb-2 ml-1">Описание</h4>
              <div className="bg-white p-4 rounded-xl border border-ink/5 shadow-sm text-[13px] leading-relaxed text-ink/80 mb-4">
                {selected.description}
              </div>
              <div className="space-y-4">
                <EntityAttributesBlock attributes={selected.attributes} />
                <EntityConnectionsBlock entity={selected} links={entityLinks} entities={approvedEntities} onSelectEntity={openEntity} />
              </div>
            </div>
          );
          if (items.length === 0) return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Box size={32} className="text-[#1e2d1f]/20 mb-4" />
              <p className="text-sm text-[#1e2d1f]/50">Предметы появятся здесь после одобрения во вкладке «Новое»</p>
            </div>
          );
          return (
            <div className="grid grid-cols-2 gap-3">
              {items.map(item => (
                <div key={item.id} onClick={() => setSelectedItemId(item.id)}
                  className="cursor-pointer rounded-xl p-3 transition-all bg-white border border-transparent hover:border-ink/10 hover:shadow-sm flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mb-3">
                    <Box size={20} className="text-amber-600" />
                  </div>
                  <h3 className="font-bold text-[13px] text-[#1E2D1F] truncate w-full">{item.name}</h3>
                  <p className="text-[9px] font-bold text-amber-500 uppercase tracking-wider">ПРЕДМЕТ</p>
                </div>
              ))}
            </div>
          );
        })()}

        {/* ── RULES TAB ── */}
        {activeBibleTab === 'rules' && (() => {
          const rules = approvedEntities.filter(e => e.type === 'rule');
          const selected = rules.find(r => r.id === selectedRuleId);
          if (selected) return (
            <div className="flex flex-col">
              <button onClick={() => setSelectedRuleId(null)} className="flex items-center gap-2 text-xs text-[#1e2d1f]/60 hover:text-[#1e2d1f] mb-6 transition-colors">
                <ChevronLeft size={14} /> Назад к списку
              </button>
              <div className="flex flex-col items-center text-center mb-6">
                <div className="w-20 h-20 rounded-2xl bg-blue-100 flex items-center justify-center mb-4">
                  <Globe size={32} className="text-blue-500" />
                </div>
                <h2 className="text-xl font-bold text-[#1E2D1F] mb-1">{selected.name}</h2>
                <div className="flex items-center justify-center gap-1.5 flex-wrap">
                  <span className="text-[9px] font-bold text-blue-500 uppercase tracking-wider">ПРАВИЛО МИРА</span>
                  {selected.significance && (
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${significanceColor(selected.significance)}`}>
                      {significanceLabel(selected.significance)}
                    </span>
                  )}
                </div>
              </div>
              <h4 className="text-[10px] font-bold text-ink/55 uppercase tracking-wider mb-2 ml-1">Описание</h4>
              <div className="bg-white p-4 rounded-xl border border-ink/5 shadow-sm text-[13px] leading-relaxed text-ink/80 italic font-serif mb-4">
                {selected.description}
              </div>
              <div className="space-y-4">
                <EntityAttributesBlock attributes={selected.attributes} />
                <EntityConnectionsBlock entity={selected} links={entityLinks} entities={approvedEntities} onSelectEntity={openEntity} />
              </div>
            </div>
          );
          if (rules.length === 0) return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Globe size={32} className="text-[#1e2d1f]/20 mb-4" />
              <p className="text-sm text-[#1e2d1f]/50">Правила мира появятся здесь после одобрения во вкладке «Новое»</p>
            </div>
          );
          return (
            <div className="flex flex-col gap-3">
              {rules.map(rule => (
                <div key={rule.id} onClick={() => setSelectedRuleId(rule.id)}
                  className="cursor-pointer rounded-xl p-4 transition-all bg-white border border-transparent hover:border-ink/10 hover:shadow-sm flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                    <Globe size={20} className="text-blue-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-[14px] text-[#1E2D1F] mb-0.5 truncate">{rule.name}</h3>
                    <p className="text-[9px] font-bold text-blue-400 uppercase tracking-wider">ПРАВИЛО</p>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
        </>)}
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
                className="text-[10px] text-red-400/70 hover:text-red-600 font-medium px-2 py-0.5 rounded hover:bg-red-50 transition-colors"
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
          <span key={i} className={side === 'prev' ? 'text-red-800/70' : 'text-emerald-900/75'}>
            {tok.text}
          </span>
        );
      }
      if (tok.kind === 'removed') {
        return (
          <span key={i} className="bg-red-100 text-red-700 line-through rounded-sm px-0.5">
            {tok.text}
          </span>
        );
      }
      // added
      return (
        <span key={i} className="bg-emerald-100 text-emerald-800 rounded-sm px-0.5">
          {tok.text}
        </span>
      );
    });
  }

  return (
    <div className="space-y-1.5 mt-2">
      {prev && (
        <div className="bg-red-50/50 border border-red-100 rounded-lg p-2">
          <p className="text-[9px] font-bold text-red-400 uppercase tracking-widest mb-1">Было</p>
          <p
            className="text-[11px] leading-relaxed break-words"
            style={!expanded && longContent ? { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : undefined}
          >
            {renderTokens(prevTokens, 'prev')}
          </p>
        </div>
      )}
      <div className="bg-emerald-50/50 border border-emerald-100 rounded-lg p-2">
        <p className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest mb-1">Стало</p>
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
    <div className="bg-white rounded-2xl shadow-sm border border-[#1e2d1f]/5 overflow-hidden">
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
          className="flex-1 py-2 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50/60 transition-colors flex items-center justify-center gap-1"
          title="Обновить описание в Библии"
        >
          <Check size={10} />
          Обновить
        </button>
      </div>
    </div>
  );
}
