type EditorFontName = 'cormorant' | 'literata' | 'source-serif';
import { useNavigate } from 'react-router-dom';
import { useState, useRef, useCallback } from 'react';
import {
  Plus, FileText, FileCheck, AlertCircle, Trash2, ChevronDown, GripVertical,
} from 'lucide-react';
import { Chapter, ChapterType } from './types';
import { getChapterDisplayLabel, CHAPTER_TYPES, isServiceChapterType } from './chapterDisplay';
import { AppSidebar } from '../AppSidebar';

// Здоровье главы = состояние чтения Пером (та же логика, что у пульса в редакторе).
//  • 'fresh'   — Перо прочитало текущую версию (зелёная точка)
//  • 'stale'   — глава изменилась после чтения, ждёт «Прочитать» (янтарная)
//  • 'unknown' — ещё ни разу не читалась (полая точка)
//  • null      — служебный раздел (не анализируется) — точки нет
type ReadingHealth = 'fresh' | 'stale' | 'unknown' | null;
function chapterReadingHealth(chapter: Chapter): ReadingHealth {
  if (isServiceChapterType(chapter.chapterType)) return null;
  if (!chapter.lastExtractedAt) return chapter.summary ? 'fresh' : 'unknown';
  const editedAt    = new Date(chapter.updatedAt).getTime();
  const extractedAt = new Date(chapter.lastExtractedAt).getTime();
  return editedAt > extractedAt ? 'stale' : 'fresh';
}
const HEALTH_META: Record<'fresh' | 'stale' | 'unknown', { cls: string; title: string }> = {
  fresh:   { cls: 'bg-[#8AAE86] shadow-[0_0_6px_rgba(138,174,134,0.5)]', title: 'Перо прочитало эту главу' },
  stale:   { cls: 'bg-[#D9A441]',                                        title: 'Глава изменилась — нажмите «Прочитать»' },
  unknown: { cls: 'bg-transparent border border-white/25',              title: 'Ещё не прочитана Пером' },
};

/** Быстрый счётчик слов из HTML-контента главы (для опционального показа в сайдбаре). */
function chapterWords(content: string | null | undefined): number {
  if (!content) return 0;
  const t = content.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').trim();
  return t ? t.split(/\s+/).length : 0;
}

interface Props {
  projectId: string;
  chapterId: string | undefined;
  chapters: Chapter[];
  isLoadingChapters: boolean;
  onCreateChapter: (type?: ChapterType) => void;
  onDeleteChapter: (id: string) => Promise<void>;
  onReorderChapters: (ids: string[]) => Promise<void>;
  onToggleChapterStatus: (id: string, currentStatus: 'draft' | 'done') => Promise<void>;
  wordCount: number;
  showWordCount: boolean;
  onShowWordCountChange: (value: boolean) => void;
  isSaving: boolean;
  lastSavedAt?: Date | null;
  saveError?: boolean;
  editorFont: EditorFontName;
  /** «Библия истории» открывает инспектор в редакторе (а не страницу /bible). */
  onOpenBible?: () => void;
  onOpenPlot?: () => void;
  /** Счётчик на «Мир»: находки + нестыковки по проекту. */
  bibleBadge?: number;
  /** Свернуть боковую панель (на десктопе). */
  onCollapse?: () => void;
  /** Открыть настройки модалкой поверх редактора. */
  onOpenSettings?: () => void;
}

export function ChapterSidebar({
  projectId,
  chapterId,
  chapters,
  isLoadingChapters,
  onCreateChapter,
  onDeleteChapter,
  onReorderChapters,
  onToggleChapterStatus,
  wordCount,
  showWordCount,
  onShowWordCountChange,
  isSaving,
  lastSavedAt,
  saveError,
  editorFont,
  onOpenBible,
  onOpenPlot,
  bibleBadge,
  onCollapse,
  onOpenSettings,
}: Props) {
  const navigate = useNavigate();
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Drag-and-drop state ──────────────────────────────────────────────────────
  const [draggedId, setDraggedId]     = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'before' | 'after'>('after');
  const dragCounterRef = useRef(0); // prevents flicker on dragenter/dragleave

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    setDraggedId(id);
    dragCounterRef.current = 0;
    e.dataTransfer.effectAllowed = 'move';
    // Transparent drag image so the item itself stays visible
    const ghost = document.createElement('div');
    ghost.style.position = 'absolute';
    ghost.style.top = '-1000px';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => document.body.removeChild(ghost), 0);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id === draggedId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDropTargetId(id);
    setDropPosition(pos);
  }, [draggedId]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent, id: string) => {
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDropTargetId(prev => prev === id ? null : prev);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    const fromId = draggedId;
    setDraggedId(null);
    setDropTargetId(null);

    if (!fromId || fromId === targetId) return;

    const ids = chapters.map(c => c.id);
    const fromIdx  = ids.indexOf(fromId);
    const targetIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || targetIdx === -1) return;

    // Build new order
    const newIds = [...ids];
    newIds.splice(fromIdx, 1);
    const insertAt = dropPosition === 'before' ? targetIdx : targetIdx + 1;
    const adjustedInsert = fromIdx < targetIdx ? insertAt - 1 : insertAt;
    newIds.splice(adjustedInsert < 0 ? 0 : adjustedInsert, 0, fromId);

    await onReorderChapters(newIds);
  }, [draggedId, dropPosition, chapters, onReorderChapters]);

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDropTargetId(null);
    dragCounterRef.current = 0;
  }, []);
  // ─────────────────────────────────────────────────────────────────────────────

  // Создавать «с нуля» можно сюжетные/структурные разделы; служебные (благодарности и т.п.)
  // обычно приходят из импорта или помечаются переключателем в заголовке.
  const ADD_TYPES = CHAPTER_TYPES.filter(t => !t.service).map(t => ({ type: t.type, label: t.label }));

  const handleDelete = async (id: string) => {
    if (!window.confirm('Удалить раздел? Это действие нельзя отменить.')) return;
    setDeletingId(id);
    try {
      await onDeleteChapter(id);
    } finally {
      setDeletingId(null);
    }
  };

  // Шрифт рукописи (editorFont) сюда сознательно НЕ применяется:
  // навигация — UI-хром, ей положен Golos (DESIGN.md, «Правило применения»).
  void editorFont;

  // Строка статуса сохранения — уходит в общий сайдбар слотом bottomExtra.
  const saveStatus = (
    <div className="flex items-center gap-1.5 px-3 pt-2.5 text-[11px] font-medium">
      {isSaving ? (
        <><span className="w-1.5 h-1.5 rounded-full bg-white/30 inline-block animate-pulse" /><span className="text-white/50">Сохранение…</span></>
      ) : saveError ? (
        <span className="flex items-center gap-1.5 text-[#D98C82]/90" title="Нажмите Cmd+S / Ctrl+S чтобы повторить">
          <AlertCircle size={11} /> Не сохранено
        </span>
      ) : lastSavedAt ? (
        <><span className="w-1.5 h-1.5 rounded-full bg-[#8AAE86]/80 inline-block" /><span className="text-white/60">Сохранено</span></>
      ) : (
        <><span className="w-1.5 h-1.5 rounded-full bg-white/20 inline-block" /><span className="text-white/30">Ожидание…</span></>
      )}
      {showWordCount && (
        <span className="text-white/30 ml-auto tabular-nums">{wordCount.toLocaleString('ru-RU')} сл.</span>
      )}
    </div>
  );

  return (
    <AppSidebar
      projectId={projectId}
      active="editor"
      onOpenBible={onOpenBible}
      onOpenPlot={onOpenPlot}
      bibleBadge={bibleBadge}
      onCollapse={onCollapse}
      onOpenSettings={onOpenSettings}
      bottomExtra={saveStatus}
    >
      {/* Chapter list */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-0.5">
        <div className="flex items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1 mt-2">
          <span>Главы</span>
          <div className="relative">
            <button
              className="hover:text-white transition-colors flex items-center gap-0.5"
              onClick={() => setIsAddMenuOpen(v => !v)}
              title="Добавить раздел"
            >
              <Plus size={14} />
              <ChevronDown size={10} />
            </button>
            {isAddMenuOpen && (
              <>
                {/* Ловец клика вне меню — закрывает по нажатию в любую точку снаружи. */}
                <div className="fixed inset-0 z-40" onClick={() => setIsAddMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-36 bg-[#2a3d2c] rounded-xl shadow-xl border border-white/10 py-1 z-50">
                {ADD_TYPES.map(({ type, label }) => (
                  <button
                    key={type}
                    onClick={() => { onCreateChapter(type); setIsAddMenuOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    {label}
                  </button>
                ))}
                </div>
              </>
            )}
          </div>
        </div>

        {isLoadingChapters && (
          <div className="px-3 py-2 text-xs text-white/30">Загрузка...</div>
        )}
        {!isLoadingChapters && chapters.length === 0 && (
          <button
            onClick={() => onCreateChapter('chapter')}
            className="w-full px-3 py-3 text-xs text-white/30 hover:text-white/60 text-center border border-dashed border-white/10 rounded-lg transition-colors"
          >
            + Создать первую главу
          </button>
        )}

        {chapters.map((chapter, index) => {
          const isActive   = chapter.id === chapterId;
          const isDone     = chapter.status === 'done';
          const isBeingDragged = draggedId === chapter.id;
          const isDropTarget   = dropTargetId === chapter.id && draggedId !== chapter.id;
          const { primary, secondary } = getChapterDisplayLabel(chapter, index);
          const isDeleting = deletingId === chapter.id;
          const health = chapterReadingHealth(chapter);
          const words = showWordCount ? chapterWords(chapter.content) : 0;

          return (
            <div
              key={chapter.id}
              draggable
              onDragStart={e => handleDragStart(e, chapter.id)}
              onDragOver={e => handleDragOver(e, chapter.id)}
              onDragEnter={handleDragEnter}
              onDragLeave={e => handleDragLeave(e, chapter.id)}
              onDrop={e => handleDrop(e, chapter.id)}
              onDragEnd={handleDragEnd}
              className={`group relative flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all select-none ${
                isBeingDragged
                  ? 'opacity-40'
                  : isActive
                  ? 'bg-white/8'
                  : 'hover:bg-white/5'
              } ${
                isDropTarget && dropPosition === 'before'
                  ? 'border-t-2 border-t-white/50'
                  : isDropTarget && dropPosition === 'after'
                  ? 'border-b-2 border-b-white/50'
                  : 'border-t-2 border-t-transparent border-b-2 border-b-transparent'
              }`}
            >
              {/* Drag handle — visible on hover */}
              <div
                className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-white/20 hover:text-white/50 cursor-grab active:cursor-grabbing transition-opacity -ml-1"
                title="Перетащить"
              >
                <GripVertical size={14} />
              </div>

              {/* Status icon */}
              <button
                onClick={() => onToggleChapterStatus(chapter.id, chapter.status)}
                title={isDone
                  ? 'Статус: Готово — нажмите, чтобы вернуть в черновик'
                  : 'Статус: Черновик — нажмите, чтобы отметить готовым'}
                className={`flex-shrink-0 flex items-center justify-center transition-all hover:scale-105 active:scale-95 ${
                  isDone ? 'text-[#8AAE86] drop-shadow-[0_0_8px_rgba(138,174,134,0.35)]' : 'text-white/60 hover:text-white/70'
                }`}
              >
                {isDone ? <FileCheck size={16} strokeWidth={1.75} /> : <FileText size={16} strokeWidth={1.75} />}
              </button>

              {/* Title */}
              <button
                onClick={() => navigate(`/editor/${projectId}/${chapter.id}`)}
                className={`flex-1 flex flex-col min-w-0 text-left transition-colors ${
                  isActive ? 'text-white' : 'text-white/60 hover:text-white/80'
                }`}
              >
                <span className={`text-[14px] font-semibold leading-tight ${isActive ? 'text-white' : 'text-white/82'}`}>
                  {primary}
                </span>
                {secondary && (
                  <span className={`text-[12px] truncate leading-tight mt-0.5 ${isActive ? 'text-white/72' : 'text-white/60'}`}>
                    {secondary}
                  </span>
                )}
              </button>

              {/* Опциональный счётчик слов (виден при включённом showWordCount) */}
              {showWordCount && words > 0 && (
                <span className="flex-shrink-0 text-[10px] tabular-nums text-white/30 group-hover:opacity-0 transition-opacity">
                  {words.toLocaleString('ru-RU')}
                </span>
              )}

              {/* Правый слот: точка «здоровья» (чтение Пером) ↔ удаление на ховере (без сдвига) */}
              <div className="relative flex-shrink-0 w-5 h-5 flex items-center justify-center">
                {health && (
                  <span
                    title={HEALTH_META[health].title}
                    className={`w-2 h-2 rounded-full transition-opacity group-hover:opacity-0 ${HEALTH_META[health].cls}`}
                  />
                )}
                <button
                  onClick={() => handleDelete(chapter.id)}
                  disabled={isDeleting}
                  title="Удалить раздел"
                  className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 rounded text-white/30 hover:text-[#9E4338] transition-all disabled:opacity-30"
                >
                  {isDeleting
                    ? <div className="w-3 h-3 border border-white/30 border-t-white/70 rounded-full animate-spin" />
                    : <Trash2 size={13} />
                  }
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </AppSidebar>
  );
}
