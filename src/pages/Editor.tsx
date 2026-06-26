import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useEditor, type Editor as TiptapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import UnderlineExtension from '@tiptap/extension-underline';
import CharacterCount from '@tiptap/extension-character-count';
import Link from '@tiptap/extension-link';
import { TaskList, TaskItem } from '@tiptap/extension-list';

import { api } from '../services/api';
import { track } from '../services/analytics';
import { useDictation } from '../hooks/useDictation';
import { useAutosave } from '../hooks/useAutosave';
import { useWritingStats } from '../hooks/useWritingStats';
import { useAiChat } from '../hooks/useAiChat';
import { useBibleExtraction } from '../hooks/useBibleExtraction';
import { useRevision } from '../hooks/useRevision';

import { ChapterSidebar } from '../components/editor/ChapterSidebar';
import { EditorCanvas } from '../components/editor/EditorCanvas';
import { BottomToolbar } from '../components/editor/BottomToolbar';
import { WorldCompanion } from '../components/editor/WorldCompanion';
import { EntityDetailPanel } from '../components/editor/EntityDetailPanel';
import { CHAPTER_TYPE_LABELS, isServiceChapterType } from '../components/editor/chapterDisplay';
import type { BookFootnote } from '../components/editor/FootnotesLens';
import { CommandPalette, Command } from '../components/editor/CommandPalette';
import { SelectionBar } from '../components/editor/SelectionBar';
import { NotesBoard, Note } from '../components/NotesBoard';
import { ContradictionPopover } from '../components/editor/ContradictionPopover';
import { StoryBiblePanel } from '../components/editor/StoryBiblePanel';
import { PlotPanel } from '../components/editor/PlotPanel';
import type { PlotThread } from '../components/editor/ThreadsLens';
import { CoauthorPanel } from '../components/editor/CoauthorPanel';
import { RevisionPanel } from '../components/editor/RevisionPanel';
import { ProjectSyncPanel } from '../components/editor/ProjectSyncPanel';
import { WritingStatsPanel } from '../components/editor/WritingStatsPanel';
import { FindReplacePopup } from '../components/FindReplacePopup';
import { SearchPanel } from '../components/editor/SearchPanel';
import { SearchHighlightExtension, searchHighlightKey } from '../components/editor/searchHighlightExtension';
import { ContradictionHighlightExtension, contradictionHighlightKey } from '../components/editor/contradictionHighlightExtension';
import { NameNudgeExtension, nameNudgeKey } from '../components/editor/NameNudgeExtension';
import { DictationGhostExtension, dictationGhostKey } from '../components/editor/DictationGhostExtension';
import { ToolbarSelectionExtension } from '../components/editor/toolbarSelectionExtension';
import { TextAlignExtension } from '../components/editor/TextAlignExtension';
import { SuperscriptExtension } from '../components/editor/SuperscriptExtension';
import { SubscriptExtension } from '../components/editor/SubscriptExtension';
import { HighlightMarkExtension } from '../components/editor/HighlightMarkExtension';
import { SceneBreakExtension } from '../components/editor/SceneBreakExtension';
import { FootnoteExtension } from '../components/editor/FootnoteExtension';
import { CommentMarkExtension } from '../components/editor/CommentMarkExtension';
import { CommentPopover, type CommentData } from '../components/editor/CommentPopover';
import { CommentsGutter, type GutterItem } from '../components/editor/CommentsGutter';
import { ExportPanel } from '../components/ExportPanel';
import Settings from './Settings';

import { Chapter, Entity, EntityLink, EntityEvent } from '../components/editor/types';
import { AhaCelebration } from '../components/AhaCelebration';
import { Users, MapPin, Box, Scale, Bookmark, X, AlertTriangle, ChevronUp, ChevronDown,
  Eye, Bell, BookOpen, Feather, Telescope, BarChart2, Search, FolderSearch, Download, Maximize2, Minimize2, Settings as SettingsIcon,
  StickyNote } from 'lucide-react';

type EditorFontName = 'cormorant' | 'literata' | 'source-serif';

/**
 * Stem-based matching for Russian morphology.
 * Drops the last character of the entity name (covers most single-letter case endings)
 * and checks whether any word in the text starts with that stem.
 * For short names (≤4 chars) the full name is used as the stem.
 */
function russianStemMatch(entityName: string, text: string): boolean {
  const name = entityName.toLowerCase().trim();
  if (!name || name.length < 2) return false;
  const stemLen = name.length <= 4 ? name.length : name.length - 1;
  const stem = name.slice(0, stemLen);
  const words = text.toLowerCase().split(/[^а-яёa-z0-9'-]+/i).filter(w => w.length > 0);
  return words.some(w => w.startsWith(stem));
}

/**
 * Совпадение сущности с текстом главы ЗА ОДИН проход: принимает заранее токенизированный текст
 * (слова с offset) и возвращает СРАЗУ и «упомянута», и индекс ПЕРВОГО появления — чтобы не
 * сканировать текст дважды (для присутствия и для порядка). Многословное имя («Король Сонного
 * королевства») требует ВСЕ значимые токены (иначе любое «корол…» ложно притягивает); однословное —
 * по одному. firstAt = самое раннее слово среди токенов.
 */
function entityMatch(name: string, words: { w: string; at: number }[], fullText: string): { mentioned: boolean; firstAt: number } {
  const tokens = name.toLowerCase().split(/[^а-яёa-z0-9'-]+/i).filter(t => t.length >= 3);
  if (tokens.length === 0) return { mentioned: russianStemMatch(name, fullText), firstAt: Infinity };
  const stems = tokens.map(t => (t.length <= 4 ? t : t.slice(0, t.length - 1)));
  const earliest = stems.map(() => Infinity);
  for (const { w, at } of words) {
    for (let i = 0; i < stems.length; i++) {
      if (earliest[i] === Infinity && w.startsWith(stems[i])) earliest[i] = at;
    }
  }
  const finite = earliest.filter(f => f !== Infinity);
  const mentioned = stems.length >= 2 ? finite.length === stems.length : finite.length > 0;
  return { mentioned, firstAt: mentioned ? Math.min(...finite) : Infinity };
}

function splitChapterTitle(title: string, fallbackOrder?: number, chapterType?: string): { prefix: string; suffix: string } {
  const trimmed = title.trim();

  // Не-«глава» (Пролог/Эпилог/Часть/Благодарности…) — префикс это слово-тип, а не «Глава N».
  if (chapterType && chapterType !== 'chapter' && CHAPTER_TYPE_LABELS[chapterType]) {
    const label = CHAPTER_TYPE_LABELS[chapterType];
    const suffix = trimmed.replace(new RegExp(`^${label}[\\s.:—–-]*`, 'i'), '').trim();
    return { prefix: label, suffix: suffix.toLowerCase() === label.toLowerCase() ? '' : suffix };
  }

  const match = trimmed.match(/^(Глава\s+\d+)(?:[\s.:—-]+(.+))?$/i);
  if (match) {
    return {
      prefix: match[1].trim(),
      suffix: match[2]?.trim() ?? '',
    };
  }

  const fallbackPrefix = fallbackOrder != null ? `Глава ${fallbackOrder + 1}` : 'Глава';
  return {
    prefix: fallbackPrefix,
    suffix: trimmed,
  };
}

function composeChapterTitle(prefix: string, suffix: string): string {
  return suffix.trim() ? `${prefix} ${suffix.trim()}` : prefix;
}

function sanitizeChapterContent(html: string): string {
  const trimmed = html
    .replace(/<(h1|div)[^>]*data-node-type=["']chapter-title["'][^>]*>[\s\S]*?<\/\1>/gi, '')
    .trim();

  return trimmed || '<p></p>';
}

function fallbackNormalizeDictation(rawText: string): string {
  const normalized = rawText.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

const ENTITY_SECTIONS = [
  { type: 'character', label: 'Персонажи',    icon: Users  },
  { type: 'location',  label: 'Локации',      icon: MapPin },
  { type: 'item',      label: 'Предметы',     icon: Box    },
  { type: 'rule',      label: 'Правила мира', icon: Scale  },
] as const;

function EntityCard({ entity, hasConflict }: { entity: Entity; hasConflict: boolean }) {
  return (
    <div className={`rounded-xl p-3 border transition-colors cursor-default ${
      hasConflict
        ? 'bg-[#F2E9D8]/80 border-[#91682E]/60 hover:bg-[#F2E9D8]'
        : 'bg-white/60 border-[#1e2d1f]/5 hover:bg-white'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-bold text-[16px] text-[#1e2d1f] truncate leading-snug">{entity.name}</h4>
        {hasConflict && (
          <span title="Возможное противоречие с другой версией этого объекта">
            <AlertTriangle size={13} className="text-[#91682E] flex-shrink-0 mt-0.5" />
          </span>
        )}
      </div>
      {entity.description && (
        <p className="text-sm text-[#1e2d1f]/55 line-clamp-2 mt-0.5 leading-snug">{entity.description}</p>
      )}
    </div>
  );
}

// ─── Jump-to-match ────────────────────────────────────────────────────────────
/**
 * Find the first occurrence of `query` in the TipTap editor using a two-pass
 * strategy:
 *
 * Pass 1 — fingerprint-guided (precise): search for the longer `fingerprint`
 *   text (e.g. "…15 chars before + query + 15 chars after…" returned by the
 *   backend). If found in a text node, locate `query` within that window and
 *   select it. This handles cases where the same query word appears multiple
 *   times and we need the specific occurrence the user searched for.
 *
 * Pass 2 — fallback: if the fingerprint isn't found (e.g. it spans a paragraph
 *   boundary so it crosses multiple text nodes), fall back to a plain search
 *   for `query` directly.
 *
 * Selects the matched range, scrolls it into view, and returns { from, to }.
 * Returns null if nothing is found (no error thrown).
 */
function jumpToMatch(
  editor: TiptapEditor,
  fingerprint: string,
  query: string,
): { from: number; to: number } | null {
  if (!fingerprint || editor.isDestroyed) return null;
  const fpLower = fingerprint.toLowerCase();
  const qLower  = query.toLowerCase();
  const { doc }  = editor.state;
  let result: { from: number; to: number } | null = null;

  // Pass 1: fingerprint search
  doc.descendants((node, pos) => {
    if (result || !node.isText || !node.text) return;
    const text   = node.text.toLowerCase();
    const fpIdx  = text.indexOf(fpLower);
    if (fpIdx === -1 || fpIdx + fingerprint.length > node.text.length) return;

    // Within the fingerprint window, locate the query for a precise selection.
    const window = text.slice(fpIdx, fpIdx + fingerprint.length);
    const qIdx   = window.indexOf(qLower);
    if (qIdx !== -1 && qIdx + query.length <= window.length) {
      result = { from: pos + fpIdx + qIdx, to: pos + fpIdx + qIdx + query.length };
    } else {
      // Fingerprint found but query not isolated inside it — select the fingerprint range.
      result = { from: pos + fpIdx, to: pos + fpIdx + fingerprint.length };
    }
    editor.commands.setTextSelection(result.from); // курсор схлопнут → подсветка декорацией, без выделения (бар не триггерится)
    editor.commands.scrollIntoView();
  });

  if (result) return result;

  // Pass 2: fallback — plain query search
  doc.descendants((node, pos) => {
    if (result || !node.isText || !node.text) return;
    const idx = node.text.toLowerCase().indexOf(qLower);
    if (idx === -1 || idx + query.length > node.text.length) return;
    result = { from: pos + idx, to: pos + idx + query.length };
    editor.commands.setTextSelection(result.from); // курсор схлопнут → подсветка декорацией, без выделения (бар не триггерится)
    editor.commands.scrollIntoView();
  });

  return result;
}

/**
 * Collect ALL occurrences of `query` in the editor document.
 * Iterates text nodes in document order; works within individual nodes
 * (same constraint as jumpToMatch — cross-node matches are not found).
 * Non-overlapping — advances by query.length after each hit.
 */
function findAllMatches(
  editor: TiptapEditor,
  query: string,
): { from: number; to: number }[] {
  if (!query || editor.isDestroyed) return [];
  const needle = query.toLowerCase();
  const { doc } = editor.state;
  const matches: { from: number; to: number }[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLowerCase();
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const idx = text.indexOf(needle, searchFrom);
      if (idx === -1 || idx + query.length > node.text.length) break;
      matches.push({ from: pos + idx, to: pos + idx + query.length });
      searchFrom = idx + Math.max(1, query.length); // non-overlapping advance
    }
  });

  return matches;
}

/** Apply a persistent inline decoration over the matched range. */
function applySearchHighlight(editor: TiptapEditor, from: number, to: number): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.view.state.tr.setMeta(searchHighlightKey, { from, to }));
}

/** Remove the persistent search highlight decoration. */
function clearSearchHighlight(editor: TiptapEditor): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.view.state.tr.setMeta(searchHighlightKey, 'clear'));
}

export default function Editor() {
  const { projectId, chapterId } = useParams<{ projectId: string; chapterId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const _locState      = location.state as { searchHighlight?: string; searchQuery?: string } | null;
  const routeHighlight = _locState?.searchHighlight;   // matchText fingerprint from backend
  const routeSearchQuery = _locState?.searchQuery;     // raw user query (for selection + highlight)

  const [isDictationProcessing, setIsDictationProcessing] = useState(false);
  const dictationQueueRef = useRef<string[]>([]);
  const isProcessingDictationRef = useRef(false);
  const editorRef = useRef<TiptapEditor | null>(null);

  const insertDictationText = useCallback((text: string) => {
    const targetEditor = editorRef.current;
    const normalized = text.trim();
    if (!targetEditor || targetEditor.isDestroyed || !normalized) return;
    targetEditor.chain().focus().insertContent(`${normalized} `).run();
  }, []);

  const normalizeDictationChunk = useCallback(async (rawText: string) => {
    const cleaned = rawText.trim();
    if (!cleaned) return '';

    try {
      const data = await api.post<{ text: string }>('/ai/dictation/normalize', {
        rawText: cleaned,
        chapterContent: editorRef.current?.getText() ?? '',
        projectId,
        chapterId,
      });
      return (data.text ?? '').trim() || fallbackNormalizeDictation(cleaned);
    } catch {
      return fallbackNormalizeDictation(cleaned);
    }
  }, [projectId, chapterId]);

  const processDictationQueue = useCallback(async () => {
    if (isProcessingDictationRef.current) return;

    isProcessingDictationRef.current = true;
    setIsDictationProcessing(true);

    try {
      while (dictationQueueRef.current.length > 0) {
        const nextChunk = dictationQueueRef.current.shift();
        if (!nextChunk?.trim()) continue;
        const normalized = await normalizeDictationChunk(nextChunk);
        insertDictationText(normalized);
      }
    } finally {
      isProcessingDictationRef.current = false;
      setIsDictationProcessing(false);
    }
  }, [insertDictationText, normalizeDictationChunk]);

  // Призрак диктовки в позиции курсора: показывает interim-текст там, где пишешь.
  const setDictationGhost = useCallback((text: string) => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    ed.view.dispatch(ed.view.state.tr.setMeta(dictationGhostKey, { text }));
  }, []);

  const { isListening, isSupported, interimTranscript, toggleListening } = useDictation({
    language: 'ru-RU',
    onResult: (text: string, isFinal: boolean) => {
      if (isFinal) {
        setDictationGhost('');               // финал уходит в очередь — призрак гаснет
        dictationQueueRef.current.push(text);
        void processDictationQueue();
      } else {
        setDictationGhost(text);             // живые слова — прямо у курсора
      }
    },
  });
  const isDictating = isListening;

  // Когда диктовка выключена — гарантированно гасим призрак.
  useEffect(() => {
    if (!isListening) setDictationGhost('');
  }, [isListening, setDictationGhost]);

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [isLoadingChapters, setIsLoadingChapters] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [projectSeriesId, setProjectSeriesId] = useState<string | null>(null);
  // Хэндофф серии: данные серии (нити + книги) для контекста новой книги в редакторе.
  const [seriesInfo, setSeriesInfo] = useState<{ title: string; premise: string | null; franchiseThreads: { id: string; title: string; opensBook?: string; closesBook?: string }[]; books: { id: string; order: number | null }[] } | null>(null);
  useEffect(() => {
    if (!projectSeriesId) { setSeriesInfo(null); return; }
    let alive = true;
    api.get<{ series: { title?: string; premise?: string | null; franchiseThreads?: { id: string; title: string; opensBook?: string; closesBook?: string }[] }; books: { id: string; order: number | null }[] }>(`/series/${projectSeriesId}`)
      .then(d => { if (alive) setSeriesInfo({ title: d.series?.title ?? 'Серия', premise: d.series?.premise ?? null, franchiseThreads: d.series?.franchiseThreads ?? [], books: d.books ?? [] }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [projectSeriesId]);
  // Открытые нити франшизы для ЭТОЙ книги (книга >1) — чек-лист «не забудь двигать».
  const seriesHandoff = useMemo(() => {
    if (!projectSeriesId || !seriesInfo) return null;
    const thisOrder = seriesInfo.books.find(b => b.id === projectId)?.order ?? null;
    if (thisOrder == null || thisOrder <= 1) return null; // книга 1 — наследовать нечего
    const openThreads = (seriesInfo.franchiseThreads ?? [])
      .filter(t => t.title?.trim())
      .filter(t => !t.opensBook || Number(t.opensBook) <= thisOrder)
      .filter(t => !t.closesBook || Number(t.closesBook) >= thisOrder)
      .map(t => ({ title: t.title.trim(), closesHere: !!t.closesBook && Number(t.closesBook) === thisOrder }));
    return { bookOrder: thisOrder, openThreads };
  }, [projectSeriesId, seriesInfo, projectId]);
  const [bibleEntities, setBibleEntities] = useState<Entity[]>([]);
  const [entityLinks, setEntityLinks] = useState<EntityLink[]>([]);
  const [entityEvents, setEntityEvents] = useState<EntityEvent[]>([]);
  // Сущность, чей профиль открыт в общем слоте оверлеев (тот же `<aside>`, что «Мир»). null — закрыт.
  const [detailEntity, setDetailEntity] = useState<Entity | null>(null);
  const [referenceScope, setReferenceScope] = useState<'project' | 'chapter'>('project');

  const [isBibleOpen, setIsBibleOpen] = useState(false);
  // Deep-link «Мира» на нужную линзу (из «Сводки» / «Найти похожее»).
  const [worldInitialLens, setWorldInitialLens] = useState<string | null>(null);
  const [worldLensNonce, setWorldLensNonce] = useState(0);
  const [echoQuery, setEchoQuery] = useState<string | null>(null);
  /** Шторка списка глав на узких экранах (< lg); на широких сайдбар всегда в потоке. */
  const [isChaptersDrawerOpen, setIsChaptersDrawerOpen] = useState(false);
  /** Свёрнут ли сайдбар глав на десктопе (≥ lg). */
  const [isChaptersCollapsed, setIsChaptersCollapsed] = useState(false);
  const [isReferenceOpen, setIsReferenceOpen] = useState(false);
  const [isBibleMenuOpen, setIsBibleMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [isPlotOpen, setIsPlotOpen] = useState(false);
  const [plotInitialLens, setPlotInitialLens] = useState<'skeleton' | 'threads' | 'beats' | 'arcs'>('skeleton');
  // Заметки текущей главы — для маргиналий в «В кадре». notesVersion дёргает рефетч
  // при любом изменении заметок (захват из бара, правки в линзе).
  const [notesVersion, setNotesVersion] = useState(0);
  const [chapterNotes, setChapterNotes] = useState<Note[]>([]);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isCoauthoring, setIsCoauthoring] = useState(false);
  const [isRevisionOpen, setIsRevisionOpen] = useState(false);
  const [isSyncOpen, setIsSyncOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [isInspectorExpanded, setIsInspectorExpanded] = useState(false);
  // На узких экранах спутник по умолчанию свёрнут (он полноэкранный) — сначала видно письмо.
  const [isCompanionCollapsed, setIsCompanionCollapsed] = useState(() => {
    try { return window.matchMedia('(max-width: 767px)').matches; } catch { return false; }
  });
  const [companionMode, setCompanionMode] = useState<'scene' | 'sverka' | 'chat'>('scene');
  // Scope «Мира» (Эта глава / Вся книга) поднят в Editor, чтобы кнопка «Мир» в нижнем
  // тулбаре могла открывать сразу мир ТЕКУЩЕЙ главы.
  const [bibleScope, setBibleScope] = useState<'project' | 'chapter' | 'series'>('project');
  const [contradictionPopover, setContradictionPopover] = useState<{ name: string; x: number; y: number; issue?: string; issueChapterId?: string | null } | null>(null);
  // Превью нестыковки по наведению (как у проверки орфографии): peek без клика.
  const [contradictionHover, setContradictionHover] = useState<{ issue?: string; name: string; x: number; y: number } | null>(null);
  // Комментарии главы (авторские пометки, привязанные к диапазону текста).
  const [comments, setComments] = useState<CommentData[]>([]);
  const [commentPopover, setCommentPopover] = useState<{ comment: CommentData; x: number; y: number; startEditing?: boolean } | null>(null);
  // Активная карточка на полях (режим рецензирования). gutterHasRoom — хватает ли поля справа;
  // если нет (узкий экран/открыт спутник) — падаем на поповер по клику.
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  // Достаточно ли широкий экран для полей-гаттера (иначе — поповер). matchMedia надёжнее
  // window.innerWidth (последний бывает 0 в фоновых/headless-вкладках).
  const [isWideForGutter, setIsWideForGutter] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const check = () => setIsWideForGutter(window.matchMedia('(min-width: 1024px)').matches);
    check();
    const mq = window.matchMedia('(min-width: 1024px)');
    mq.addEventListener('change', check);
    // resize тоже: mq 'change' не срабатывает, если ширина не ПЕРЕСЕКает 1024 (а viewport может
    // прийти 0 на маунте и расшириться без пересечения границы — флаг бы завис). + отложенные
    // перепроверки на случай, когда размеры устаканиваются уже после первого кадра.
    window.addEventListener('resize', check);
    const t1 = setTimeout(check, 200);
    const t2 = setTimeout(check, 700);
    return () => { mq.removeEventListener('change', check); window.removeEventListener('resize', check); clearTimeout(t1); clearTimeout(t2); };
  }, []);
  const [totalProjectWords, setTotalProjectWords] = useState(0);
  const [isRecheckingAll, setIsRecheckingAll] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  // Match navigation: active when user arrives via a text_match search result.
  const [matchNav, setMatchNav] = useState<{
    query:      string;
    matches:    { from: number; to: number }[];
    currentIdx: number;
  } | null>(null);
  const [activeBibleTab, setActiveBibleTab] = useState('inbox');
  const [showWordCount, setShowWordCount] = useState<boolean>(() => {
    const stored = localStorage.getItem('pero_showWordCount');
    return stored !== null ? stored === 'true' : true;
  });
  const [indentParagraphs, setIndentParagraphs] = useState<boolean>(() => {
    const stored = localStorage.getItem('pero_indentParagraphs');
    return stored !== null ? stored === 'true' : false;
  });
  const [editorFont, setEditorFont] = useState<EditorFontName>(() => {
    // Дефолт — Literata (DESIGN.md): спроектирована для длинного чтения.
    // Сохранённый выбор автора всегда в приоритете.
    return (localStorage.getItem('pero_editorFont') as EditorFontName) || 'literata';
  });
  const [chapterTitleDraft, setChapterTitleDraft] = useState('');
  const [chapterTitleDraftChapterId, setChapterTitleDraftChapterId] = useState<string | null>(null);

  const { isSaving, lastSavedAt, saveError, onUpdate: autosaveUpdate, forceSave } = useAutosave(chapterId);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  // Переэмбеддинг теперь — следствие сохранения на бэкенде (chapters.ts → scheduleChapterEmbed):
  // durable-гарантия свежести вектора, переживает закрытие вкладки. Фронтовый таймер убран.
  const [selectedText, setSelectedText] = useState('');
  // Фрагмент, закреплённый как контекст чата «Спросить» (бар → «Спросить Перо» / чип «Выделение»).
  // Живёт отдельно от selectedText: выделение в тексте схлопывается при клике в поле ввода чата,
  // а закреплённый контекст должен сохраняться, пока автор сам его не снимет.
  const [pinnedSelection, setPinnedSelection] = useState('');
  const pinnedSelectionRef = useRef('');
  pinnedSelectionRef.current = pinnedSelection;
  // Ширина контекста чата: 'chapter' (только глава) ↔ 'book' (глава + весь Мир).
  // Глава учитывается всегда; тумблер решает, добавлять ли знания всей книги.
  const [chatScope, setChatScope] = useState<'chapter' | 'book' | 'series'>('book');
  const chatScopeRef = useRef<'chapter' | 'book' | 'series'>('book');
  chatScopeRef.current = chatScope;
  const currentChapterRef = useRef<Chapter | null>(null);
  currentChapterRef.current = chapters.find(ch => ch.id === chapterId) ?? null;
  // Живой ref на текущую главу — нужен в замыканиях редактора (onSelectionUpdate),
  // которые создаются один раз и не видят обновлённый chapterId из пропсов.
  const chapterIdRef = useRef<string | undefined>(chapterId);
  chapterIdRef.current = chapterId;
  const chapterTitleSaveTimerRef = useRef<number | null>(null);

  const writingStats = useWritingStats(projectId);

  // Combined update handler: autosave (1s debounce) + background embedding (45s debounce)
  // + writing stats tracking (records word count delta on every update)
  const onUpdate = useCallback(
    ({ editor }: { editor: import('@tiptap/react').Editor }) => {
      autosaveUpdate({ editor });
      // B1: перескан нуджа разнописи через 900мс после остановки набора (не на горячем пути клавиш).
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
      nudgeTimerRef.current = setTimeout(() => {
        try { editor.view.dispatch(editor.view.state.tr.setMeta(nameNudgeKey, { names: nudgeNamesRef.current })); } catch { /* закрыт */ }
      }, 900);
      // Эмбеддинг ставит бэкенд при сохранении (см. scheduleChapterEmbed) — здесь не нужен.
      // Any content edit makes existing match positions stale — dismiss the nav bar.
      // setMatchNav is a stable React setter, so it doesn't need to be in deps.
      setMatchNav(null);
      // Record word count delta for writing statistics (localStorage, very fast)
      if (chapterId) {
        const words = editor.storage.characterCount?.words?.() ?? 0;
        writingStats.recordChapterWords(chapterId, words);
      }
    },
    [autosaveUpdate, chapterId, writingStats.recordChapterWords]
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      SceneBreakExtension,
      UnderlineExtension,
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      TextAlignExtension,
      SuperscriptExtension,
      SubscriptExtension,
      FootnoteExtension,
      CommentMarkExtension,
      HighlightMarkExtension,
      CharacterCount,
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === 'heading') {
            const level = Number(node.attrs.level ?? 1);
            if (level === 1) return 'Heading 1';
            if (level === 2) return 'Heading 2';
            if (level === 3) return 'Heading 3';
          }
          if (node.type.name === 'blockquote') {
            return 'Quote';
          }
          return "Введите / для вызова команд";
        },
        emptyNodeClass: 'is-empty',
        showOnlyCurrent: true,
      }),
      SearchHighlightExtension,
      ContradictionHighlightExtension,
      NameNudgeExtension,
      DictationGhostExtension,
      ToolbarSelectionExtension,
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'editor-body focus:outline-none min-h-[500px] pb-32',
      },
    },
    onUpdate,
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to } = ed.state.selection;
      setSelectedText(from === to ? '' : ed.state.doc.textBetween(from, to, ' '));
      // Запоминаем позицию курсора, чтобы вернуть автора туда же при следующем входе.
      const cid = chapterIdRef.current;
      if (cid && !ed.isDestroyed) {
        try { localStorage.setItem(`pero_cursor_${cid}`, String(from)); } catch { /* quota */ }
      }
    },
  });

  useEffect(() => {
    editorRef.current = editor ?? null;
  }, [editor]);

  useEffect(() => {
    dictationQueueRef.current = [];
    isProcessingDictationRef.current = false;
    setIsDictationProcessing(false);
  }, [chapterId]);

  const getContent = useCallback(() => editor?.getText() || '', [editor]);

  const handleInsertText = useCallback((text: string) => {
    if (!editor || editor.isDestroyed) return;
    editor.chain().focus().insertContent(text).run();
  }, [editor]);

  const {
    chatMessages,
    isHistoryLoaded,
    chatInput,
    setChatInput,
    isAiLoading,
    isCheckingConsistency,
    chatEndRef,
    handleSendMessage,
    handleSendPrompt,
    handleCheckConsistency,
  } = useAiChat({ projectId, chapterId, getContent, getSelection: () => pinnedSelectionRef.current, getScope: () => chatScopeRef.current });

  const {
    isExtracting, suggestions, approvedEntities,
    updateSuggestions,
    handleExtract: rawHandleExtract,
    recheckChapter: rawRecheckChapter,
    recheckBatch,
    approveSuggestion, rejectSuggestion, mergeSuggestionInto,
    loadUpdateSuggestions,
    acceptUpdate, rejectUpdate, dismissUpdate,
    bulkDismissChapter, bulkRejectChapter,
  } = useBibleExtraction(projectId, chapterId, getContent);

  // Load approved entities + links + timeline events for the bible/reference panels.
  // Re-fetched after every extract/recheck — extraction adds links/events server-side.
  const loadBibleData = useCallback(() => {
    if (!projectId) return;
    api.get<{ entities: Entity[]; links?: EntityLink[]; events?: EntityEvent[] }>(`/bible/${projectId}`)
      .then(data => {
        setBibleEntities((data.entities ?? []).filter(e => e.status === 'approved'));
        setEntityLinks(data.links ?? []);
        setEntityEvents(data.events ?? []);
      })
      .catch(e => console.error('Failed to load bible entities:', e));
  }, [projectId]);

  // Отчёт о противоречиях (полный скан P1.2) — для подсветки конкретных фраз в тексте (B2).
  type ScanIssue = { id: string; chapterId: string | null; entityName: string | null; issue: string; quote: string | null; severity: string; status: string };
  const [contradictionIssues, setContradictionIssues] = useState<ScanIssue[]>([]);
  // Счётчик «провисают» для Сводки: значимые сущности с 0–1 связью (как в линзе «Связи»).
  const danglingCount = useMemo(() => {
    const deg = new Map<string, number>();
    entityLinks.forEach(l => {
      if (l.sourceEntityId === l.targetEntityId) return;
      deg.set(l.sourceEntityId, (deg.get(l.sourceEntityId) ?? 0) + 1);
      deg.set(l.targetEntityId, (deg.get(l.targetEntityId) ?? 0) + 1);
    });
    return bibleEntities.filter(e => (e.significance ?? 'minor') !== 'minor' && (deg.get(e.id) ?? 0) <= 1).length;
  }, [bibleEntities, entityLinks]);
  const loadContradictions = useCallback(() => {
    if (!projectId) return;
    api.get<{ issues: ScanIssue[] }>(`/bible/${projectId}/contradictions`)
      .then(d => setContradictionIssues((d.issues ?? []).filter(i => i.status === 'open')))
      .catch(() => { /* отчёта ещё нет — подсвечиваем по именам (эвристика) */ });
  }, [projectId]);
  useEffect(() => { loadContradictions(); }, [loadContradictions]);

  // Комментарии текущей главы — грузим при смене главы.
  const loadComments = useCallback(() => {
    if (!projectId || !chapterId) { setComments([]); return; }
    api.get<{ comments: any[] }>(`/comments/${projectId}?chapterId=${chapterId}`)
      .then(d => setComments((d.comments ?? []).filter(c => !c.resolved).map(c => ({
        id: c.id, body: c.body ?? '', quote: c.quote ?? '', source: c.source === 'pero' ? 'pero' : 'author', resolved: !!c.resolved,
        replies: Array.isArray(c.replies) ? c.replies : [],
      }))))
      .catch(() => setComments([]));
  }, [projectId, chapterId]);
  useEffect(() => { loadComments(); }, [loadComments]);

  // Режим рецензирования: при ПЕРВОМ появлении комментариев в главе (на широком экране) —
  // сворачиваем спутник, освобождая правое поле под гаттер. Делаем это ОДИН раз на главу
  // (ref по chapterId): если автор потом сам откроет спутник, не навязываемся повторно при
  // добавлении новых комментариев. На смене главы — снова можем войти в режим.
  const hasGutterItems = comments.length > 0 || contradictionIssues.some(i => i.chapterId === chapterId && i.quote);
  // Спутник «Перо» и поле комментариев НЕ конфликтуют: спутником управляет автор (открыл/свернул),
  // а комментарии подстраиваются — гаттер на полях, когда спутник свёрнут; иначе инлайн-поповер.
  // Никакого авто-сворачивания «под комментарий» (раньше это дралось со спутником).
  const wideNow = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
  const companionCollapsed = isCompanionCollapsed;
  const companionCollapsedRef = useRef(companionCollapsed);
  companionCollapsedRef.current = companionCollapsed;
  const toggleCompanion = useCallback(() => { setIsCompanionCollapsed(v => !v); }, []);

  // ── Действия с комментариями ─────────────────────────────────────────────────
  // Создать комментарий из выделения: навесить марку + строку в БД + открыть карточку.
  const handleCreateComment = useCallback(async (text: string) => {
    if (!editorRef.current || !projectId || !chapterId) return;
    const ed = editorRef.current;
    const { from, to } = ed.state.selection;
    if (from === to) return;
    const id = crypto.randomUUID();
    const quote = text.slice(0, 2000);
    ed.chain().focus().setTextSelection({ from, to }).setComment(id, 'author').run();
    let x = window.innerWidth / 2, y = 200;
    try { const c = ed.view.coordsAtPos(to); x = c.left; y = c.bottom; } catch { /* keep defaults */ }
    const fresh: CommentData = { id, body: '', quote, source: 'author', resolved: false };
    setComments(prev => [...prev, fresh]);
    // Спутник свёрнут на широком экране → карточка на полях (гаттер). Иначе (спутник открыт или
    // узкий экран) → инлайн-поповер у текста — НЕ трогаем спутник, не конфликтуем с ним.
    if (window.matchMedia('(min-width: 1024px)').matches && companionCollapsedRef.current) {
      setActiveCommentId(id);
    } else setCommentPopover({ comment: fresh, x, y, startEditing: true });
    try {
      await api.post(`/comments/${projectId}`, { id, chapterId, quote, source: 'author' });
      await forceSave(ed.getHTML()); // зафиксировать марку в контенте сразу
    } catch {
      // POST не прошёл → откатываем марку, чтобы не осталось «мёртвой» подсветки без строки в БД.
      ed.commands.removeCommentById(id);
      forceSave(ed.getHTML()).catch(() => {});
      setComments(prev => prev.filter(c => c.id !== id));
      setActiveCommentId(prev => (prev === id ? null : prev));
      setCommentPopover(prev => (prev?.comment.id === id ? null : prev));
    }
  }, [projectId, chapterId, forceSave]);

  const handleSaveComment = useCallback(async (id: string, body: string) => {
    setComments(prev => prev.map(c => c.id === id ? { ...c, body } : c));
    try { await api.patch(`/comments/item/${id}`, { body }); }
    catch { loadComments(); } // ресинк с сервером, чтобы локально не разъехалось молча
  }, [loadComments]);

  // resolve / delete / to-note — общий хвост: снять марку из текста + убрать из списка + закрыть.
  const dropCommentMark = useCallback((id: string) => {
    const ed = editorRef.current;
    if (ed) { ed.commands.removeCommentById(id); forceSave(ed.getHTML()).catch(() => {}); }
    setComments(prev => prev.filter(c => c.id !== id));
    setCommentPopover(null);
    setActiveCommentId(prev => (prev === id ? null : prev));
  }, [forceSave]);

  // Терминальные действия — сначала сервер, потом снимаем марку. Ошибка → ничего не меняем
  // (не остаётся «решённого/удалённого» без записи в БД и наоборот).
  const handleResolveComment = useCallback(async (id: string) => {
    try { await api.patch(`/comments/item/${id}`, { resolved: true }); dropCommentMark(id); } catch { /* оставляем как есть */ }
  }, [dropCommentMark]);

  const handleDeleteComment = useCallback(async (id: string) => {
    try { await api.delete(`/comments/item/${id}`); dropCommentMark(id); } catch { /* оставляем как есть */ }
  }, [dropCommentMark]);

  const handleCommentToNote = useCallback(async (id: string) => {
    try { await api.post(`/comments/item/${id}/to-note`, {}); dropCommentMark(id); setNotesVersion(v => v + 1); } catch { /* оставляем как есть */ }
  }, [dropCommentMark]);

  // Ответить в тред комментария (как в Word). Оптимистично добавляем, сервер вернёт канон.
  const handleReplyComment = useCallback(async (id: string, body: string) => {
    const optimistic = { id: crypto.randomUUID(), body, author: 'author' as const, createdAt: new Date().toISOString() };
    setComments(prev => prev.map(c => c.id === id ? { ...c, replies: [...(c.replies ?? []), optimistic] } : c));
    try {
      const row = await api.post<{ replies?: any[] }>(`/comments/item/${id}/reply`, { body });
      if (row?.replies) setComments(prev => prev.map(c => c.id === id ? { ...c, replies: row.replies } : c));
    } catch { loadComments(); }
  }, [loadComments]);

  // Единый слой полей (Фаза 3): твои комментарии (author) + нестыковки Перо текущей главы (pero).
  const gutterItems = useMemo<GutterItem[]>(() => {
    const mine: GutterItem[] = comments.map(c => ({ id: c.id, source: 'author', body: c.body, quote: c.quote, resolved: c.resolved, replies: c.replies ?? [] }));
    const pero: GutterItem[] = contradictionIssues
      .filter(i => i.chapterId === chapterId && i.quote)
      .map(i => ({ id: i.id, source: 'pero', body: i.issue, quote: i.quote!, entityName: i.entityName, severity: i.severity }));
    return [...mine, ...pero];
  }, [comments, contradictionIssues, chapterId]);

  // Отклонить одну нестыковку по id (ложное срабатывание) — для линзы «Нестыковки».
  const dismissContradictionIssue = useCallback(async (issueId: string) => {
    setContradictionIssues(prev => prev.filter(i => i.id !== issueId));
    try { await api.post(`/bible/contradictions/${issueId}/dismiss`, {}); } catch { loadContradictions(); }
  }, [loadContradictions]);

  // Сюжетные линии (столб «Сюжет» → «Линии»).
  const [plotThreads, setPlotThreads] = useState<PlotThread[]>([]);
  const [scanningThreads, setScanningThreads] = useState(false);
  const loadThreads = useCallback(() => {
    if (!projectId) return;
    api.get<{ threads: PlotThread[] }>(`/plot/${projectId}/threads`)
      .then(d => setPlotThreads(d.threads ?? [])).catch(() => {});
  }, [projectId]);
  const scanThreads = useCallback(async () => {
    if (!projectId) return;
    setScanningThreads(true);
    try { await api.post(`/plot/${projectId}/threads/scan`, {}); loadThreads(); }
    catch { /* квота/ошибка — тихо */ }
    finally { setScanningThreads(false); }
  }, [projectId, loadThreads]);
  const dismissThread = useCallback(async (id: string) => {
    setPlotThreads(prev => prev.filter(t => t.id !== id));
    try { await api.patch(`/plot/threads/${id}`, { userStatus: 'dismissed' }); } catch { loadThreads(); }
  }, [loadThreads]);
  const toggleThreadResolved = useCallback(async (id: string, resolved: boolean) => {
    setPlotThreads(prev => prev.map(t => t.id === id ? { ...t, resolved } : t));
    try { await api.patch(`/plot/threads/${id}`, { resolved }); } catch { loadThreads(); }
  }, [loadThreads]);
  const addThread = useCallback(async (data: { title: string; kind: string; summary: string }) => {
    if (!projectId) return;
    try { await api.post(`/plot/${projectId}/threads`, data); loadThreads(); } catch { /* тихо */ }
  }, [projectId, loadThreads]);
  const editThread = useCallback(async (id: string, data: { title?: string; summary?: string; kind?: string }) => {
    setPlotThreads(prev => prev.map(t => t.id === id ? { ...t, ...data } : t));
    try { await api.patch(`/plot/threads/${id}`, data); } catch { loadThreads(); }
  }, [loadThreads]);
  // Режим архитектора в «Скелете»: план главы + запланировать пустую главу (без ухода).
  const saveChapterPlan = useCallback(async (id: string, plan: string) => {
    setChapters(prev => prev.map(c => c.id === id ? { ...c, plan: plan.trim() || null } : c));
    try { await api.patch(`/chapters/${id}`, { plan }); } catch { /* тихо */ }
  }, []);
  const addPlannedChapter = useCallback(async () => {
    if (!projectId) return;
    const count = chapters.filter(c => (c.chapterType ?? 'chapter') === 'chapter').length;
    try {
      const data = await api.post<{ chapter: Chapter }>(`/projects/${projectId}/chapters`, { title: `Глава ${count + 1}`, chapterType: 'chapter' });
      setChapters(prev => [...prev, data.chapter]);
    } catch { /* тихо */ }
  }, [projectId, chapters]);
  // Линии нужны и карточке героя («Сюжетные линии») — грузим при входе в проект.
  useEffect(() => { loadThreads(); }, [loadThreads]);

  // Проактивно: после «Прочитать» тихо проверяем эту главу и обновляем отчёт нестыковок.
  const scanChapterContradictions = useCallback((chId?: string | null) => {
    const id = chId ?? chapterId;
    if (!projectId || !id) return;
    api.post(`/bible/${projectId}/contradictions/scan-chapter`, { chapterId: id })
      .then(() => loadContradictions())
      .catch(() => { /* квота/ошибка — тихо, отчёт остаётся прежним */ });
  }, [projectId, chapterId, loadContradictions]);

  // Пересчёт значимости по присутствию (без ИИ) + перезагрузка Мира со свежими тирами.
  const recomputeSignificance = useCallback(() => {
    if (!projectId) { loadBibleData(); return; }
    api.post(`/bible/${projectId}/recompute-significance`, {})
      .catch(() => { /* тихо */ })
      .finally(() => loadBibleData());
  }, [projectId, loadBibleData]);

  // Живой статус скана (№1 — обратная связь ИИ): прогресс по главам + результат.
  const [scanState, setScanState] = useState<{ status: 'running' | 'done' | 'failed'; scanned: number; total: number; found: number } | null>(null);
  const scanPollRef = useRef<number | null>(null);

  /** Запустить полный скан книги на нестыковки (worker) с поллингом прогресса. */
  const runContradictionScan = useCallback(async () => {
    if (!projectId) return;
    if (scanPollRef.current) window.clearTimeout(scanPollRef.current);
    try {
      await api.post(`/bible/${projectId}/contradictions/scan`, {});
      setScanState({ status: 'running', scanned: 0, total: 0, found: 0 });
      let tries = 0;
      const poll = async () => {
        tries++;
        try {
          const d = await api.get<{ report: { status: string; totalChapters: number; scannedChapters: number } | null; issues: ScanIssue[] }>(`/bible/${projectId}/contradictions`);
          const open = (d.issues ?? []).filter(i => i.status === 'open');
          setContradictionIssues(open);
          const rep = d.report;
          if (rep && rep.status === 'running' && tries < 40) {
            setScanState({ status: 'running', scanned: rep.scannedChapters ?? 0, total: rep.totalChapters ?? 0, found: open.length });
            scanPollRef.current = window.setTimeout(poll, 3000);
          } else {
            setScanState({ status: rep?.status === 'failed' ? 'failed' : 'done', scanned: rep?.scannedChapters ?? 0, total: rep?.totalChapters ?? 0, found: open.length });
            window.setTimeout(() => setScanState(null), 5000);
          }
        } catch { setScanState(null); }
      };
      scanPollRef.current = window.setTimeout(poll, 2500);
    } catch { setScanState(null); /* квота/ошибка */ }
  }, [projectId]);

  // Wrap rawHandleExtract to also optimistically mark the chapter as freshly extracted.
  const handleExtract = useCallback(async () => {
    const { chapterSummary } = await rawHandleExtract();
    if (chapterId) {
      setChapters(prev => prev.map(c => {
        if (c.id !== chapterId) return c;
        let title = c.title;
        if (chapterSummary && /^Глава \d+$/.test(title.trim())) {
          title = chapterSummary.substring(0, 100);
        }
        return { ...c, title, lastExtractedAt: new Date().toISOString() };
      }));
    }
    recomputeSignificance();
    scanChapterContradictions(chapterId);
  }, [rawHandleExtract, chapterId, recomputeSignificance, scanChapterContradictions]);

  // Server-side recheck wrapper — updates local freshness after the API responds.
  const handleRecheckChapter = useCallback(async () => {
    const { chapterSummary } = await rawRecheckChapter();
    if (chapterId) {
      setChapters(prev => prev.map(c => {
        if (c.id !== chapterId) return c;
        let title = c.title;
        if (chapterSummary && /^Глава \d+$/.test(title.trim())) {
          title = chapterSummary.substring(0, 100);
        }
        return { ...c, title, lastExtractedAt: new Date().toISOString() };
      }));
    }
    recomputeSignificance();
    scanChapterContradictions(chapterId);
  }, [rawRecheckChapter, chapterId, recomputeSignificance, scanChapterContradictions]);

  // Load pending update suggestions when Bible or Sync panel is opened.
  // Sync panel needs the count for the "updates" tile; Bible panel needs full list.
  useEffect(() => {
    if ((isBibleOpen || isSyncOpen) && projectId) {
      loadUpdateSuggestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBibleOpen, isSyncOpen, projectId]);

  // Navigate to the source location of a bible update suggestion.
  // Uses the existing jump-to-match pipeline (searchHighlight = sourceExcerpt fingerprint,
  // searchQuery = entity name that gets selected in the editor).
  const handleOpenInEditor = useCallback((
    targetChapterId: string,
    searchHighlight: string,
    searchQuery: string,
  ) => {
    if (!projectId) return;
    navigate(
      `/editor/${projectId}/${targetChapterId}`,
      { state: { searchHighlight, searchQuery } },
    );
  }, [navigate, projectId]);

  const {
    searchQuery, setSearchQuery,
    traceResults, isTracing, traceDone, traceSemantic, handleTrace,
    arcText, isArcLoading, handleArc,
    bibleSuggestions, isBibleLoading, bibleDone, handleBibleUpdate, dismissBibleSuggestion,
  } = useRevision(projectId, chapterId, getContent);

  useEffect(() => {
    if (!projectId) return;
    setIsLoadingChapters(true);
    // Fetch project info (for title) alongside chapters
    api.get<{ project: any }>(`/projects/${projectId}`)
      .then(data => { if (data.project?.title) setProjectTitle(data.project.title); setProjectSeriesId(data.project?.seriesId ?? null); })
      .catch(() => {});
    api.get<{ chapters: Chapter[] }>(`/projects/${projectId}/chapters`)
      .then(data => {
        const loaded = data.chapters || [];
        setChapters(loaded);
        if (loaded.length > 0) {
          const validIds = loaded.map(c => c.id);
          if (!chapterId || !validIds.includes(chapterId)) {
            // «Открыть там, где бросил»: последняя открытая глава проекта, если она жива.
            const lastId = localStorage.getItem(`pero_last_chapter_${projectId}`);
            const target = (lastId && validIds.includes(lastId)) ? lastId : loaded[0].id;
            navigate(`/editor/${projectId}/${target}${location.search}`, { replace: true });
          }
        }
      })
      .catch(e => console.error('Failed to load chapters:', e))
      .finally(() => setIsLoadingChapters(false));
  }, [projectId]);

  // Guard: if chapterId is not in the loaded chapter list, redirect to first valid chapter
  useEffect(() => {
    if (!chapterId || chapters.length === 0) return;
    if (!chapters.some(c => c.id === chapterId)) {
      navigate(`/editor/${projectId}/${chapters[0].id}${location.search}`, { replace: true });
    }
  }, [chapterId, chapters]);

  // Открыть «Мир» сразу, если пришли с ?view=world (нав «Мир» вне редактора / онбординг).
  const worldOpenedRef = useRef(false);
  useEffect(() => {
    if (worldOpenedRef.current || !chapterId) return;
    const view = new URLSearchParams(location.search).get('view');
    if (view === 'world') {
      worldOpenedRef.current = true;
      handleBibleMenuClick('characters');
      navigate(location.pathname, { replace: true }); // убрать query, чтобы не повторялось
    } else if (view === 'plot') {
      worldOpenedRef.current = true;
      handleOpenPlot();
      navigate(location.pathname, { replace: true });
    }
  }, [chapterId, location.search]);

  // Keep a ref to the previous chapterId so we can force-save before switching
  const prevChapterIdRef = useRef<string | undefined>(undefined);

  // Pending search highlight: written during render (safe for refs) so effects can read it
  // before and after async chapter load. Stores both the matchText fingerprint (for locating the
  // exact occurrence) and the raw query (for selection range + highlight decoration).
  const pendingHighlightRef  = useRef<{ fingerprint: string; query: string } | null>(null);
  // Synchronous loading flag — avoids stale isLoadingContent state in same-chapter jump effect.
  const isLoadingContentRef  = useRef(false);
  // Capture incoming highlight immediately (render runs before effects).
  if (routeHighlight) {
    pendingHighlightRef.current = {
      fingerprint: routeHighlight,
      query: routeSearchQuery || routeHighlight,
    };
  }

  useEffect(() => {
    if (!chapterId || !editor) return;

    // Force-save the previous chapter's content before loading the new one
    if (prevChapterIdRef.current && prevChapterIdRef.current !== chapterId) {
      const currentContent = editor.getHTML();
      // forceSave uses chapterIdRef internally — we need to save with the OLD id.
      // We call the API directly here to avoid any ref timing issues.
      api.put(`/chapters/${prevChapterIdRef.current}`, { content: currentContent })
        .catch(() => {}); // silent — main autosave will retry
    }
    prevChapterIdRef.current = chapterId;

    // Reset any match navigation from the previous chapter immediately (before async load).
    setMatchNav(null);
    if (!editor.isDestroyed) clearSearchHighlight(editor);

    track('chapter_opened', { projectId, chapterId });
    // Запоминаем, на какой главе автор работает — чтобы вернуть его сюда при входе в проект.
    try { localStorage.setItem(`pero_last_chapter_${projectId}`, chapterId); } catch { /* quota */ }
    isLoadingContentRef.current = true; // synchronous gate for same-chapter jump effect
    setIsLoadingContent(true);
    api.get<{ chapter: Chapter }>(`/chapters/${chapterId}`)
      .then(data => {
        let rawContent = data.chapter?.content || '';
        if (rawContent) {
          // If content lacks standard block tags and relies on newlines (raw text import)
          if (!rawContent.includes('<p>') && !rawContent.includes('<h')) {
            rawContent = rawContent
              .split(/\n+/)
              .map(p => p.trim())
              .filter(Boolean)
              .map(p => `<p>${p}</p>`)
              .join('');
          }
          // If content is one giant paragraph with soft breaks (e.g. pasted from PDF)
          else if ((rawContent.match(/<p>/gi)?.length === 1) && rawContent.includes('<br')) {
            rawContent = rawContent.replace(/<\/?p>/gi, '').replace(/<br\s*\/?>/gi, '\n');
            rawContent = rawContent
              .split(/\n+/)
              .map(p => p.trim())
              .filter(Boolean)
              .map(p => `<p>${p}</p>`)
              .join('');
          }
        }
        rawContent = sanitizeChapterContent(rawContent);
        editor.commands.setContent(rawContent);
        // Apply pending search highlight after content is in the editor.
        // rAF gives ProseMirror one paint cycle to update the DOM before we scroll.
        const hl = pendingHighlightRef.current;
        if (hl) {
          pendingHighlightRef.current = null;
          requestAnimationFrame(() => {
            if (editor.isDestroyed) return;
            const match = jumpToMatch(editor, hl.fingerprint, hl.query);
            if (match) {
              applySearchHighlight(editor, match.from, match.to);
              // Навигатор «N из M» — только когда есть что навигировать (>1). Одно место = тихая подсветка.
              const allMatches = findAllMatches(editor, hl.query);
              const idx = allMatches.findIndex(m => m.from === match.from);
              setMatchNav(allMatches.length > 1
                ? { query: hl.query, matches: allMatches, currentIdx: idx >= 0 ? idx : 0 }
                : null);
            }
          });
        } else {
          // «Вернись туда, где бросил»: восстанавливаем позицию курсора этой главы.
          const savedPos = Number(localStorage.getItem(`pero_cursor_${chapterId}`));
          if (savedPos > 0) {
            requestAnimationFrame(() => {
              if (editor.isDestroyed) return;
              const max = editor.state.doc.content.size;
              const pos = Math.min(savedPos, Math.max(1, max - 1));
              try {
                editor.commands.setTextSelection(pos);
                editor.commands.scrollIntoView();
              } catch { /* позиция устарела — игнорируем */ }
            });
          }
        }
      })
      .catch(e => console.error('Failed to fetch chapter:', e))
      .finally(() => { isLoadingContentRef.current = false; setIsLoadingContent(false); });
  }, [chapterId, editor]);

  // Same-chapter search jump: fires when a highlight arrives but the chapter is already loaded.
  // isLoadingContentRef is a synchronous ref (not state) to avoid stale-closure timing issues:
  // the content load effect sets it to true before the state update is batched.
  useEffect(() => {
    if (!routeHighlight || !editor || isLoadingContentRef.current) return;
    pendingHighlightRef.current = null;
    const fingerprint = routeHighlight;
    const query       = routeSearchQuery || routeHighlight;
    requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      const match = jumpToMatch(editor, fingerprint, query);
      if (match) {
        applySearchHighlight(editor, match.from, match.to);
        // Навигатор «N из M» — только когда есть что навигировать (>1). Одно место = тихая подсветка.
        const allMatches = findAllMatches(editor, query);
        const idx = allMatches.findIndex(m => m.from === match.from);
        setMatchNav(allMatches.length > 1
          ? { query, matches: allMatches, currentIdx: idx >= 0 ? idx : 0 }
          : null);
      }
    });
  }, [routeHighlight, routeSearchQuery, editor]);

  // Clear the navigation state after consuming the highlight (prevents replay on back/forward nav).
  useEffect(() => {
    if (!routeHighlight) return;
    navigate(location.pathname, { replace: true, state: {} });
  }, [routeHighlight, navigate, location.pathname]);

  // ── Match navigation ──────────────────────────────────────────────────────

  /** Move to the next (+1) or previous (−1) match and update highlight. */
  const handleMatchNavGo = useCallback((delta: 1 | -1) => {
    if (!matchNav || !editor || editor.isDestroyed) return;
    const total   = matchNav.matches.length;
    const nextIdx = (matchNav.currentIdx + delta + total) % total;
    const match   = matchNav.matches[nextIdx];
    editor.commands.setTextSelection(match);
    editor.commands.scrollIntoView();
    applySearchHighlight(editor, match.from, match.to);
    setMatchNav(prev => prev ? { ...prev, currentIdx: nextIdx } : null);
  }, [matchNav, editor]);

  /** Dismiss match navigation bar and clear the highlight decoration. */
  const handleMatchNavClose = useCallback(() => {
    if (editor && !editor.isDestroyed) clearSearchHighlight(editor);
    setMatchNav(null);
  }, [editor]);

  // F3 / Shift+F3 — next / previous match while navigation bar is open.
  // Escape also closes the bar (fires after the main Escape handler, which is a no-op
  // when no modal is open, so there is no conflict).
  useEffect(() => {
    if (!matchNav) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault();
        handleMatchNavGo(e.shiftKey ? -1 : 1);
      }
      if (e.key === 'Escape') {
        handleMatchNavClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [matchNav, handleMatchNavGo, handleMatchNavClose]);

  useEffect(() => { loadBibleData(); }, [loadBibleData]);

  // Заметки текущей главы (маргиналии в «В кадре»). Рефетч при смене главы / правках заметок.
  useEffect(() => {
    if (!projectId || !chapterId) { setChapterNotes([]); return; }
    api.get<{ notes: Note[] }>(`/notes/${projectId}`)
      .then(d => setChapterNotes((d.notes ?? []).filter(n => n.chapterId === chapterId && n.status !== 'archived')))
      .catch(() => setChapterNotes([]));
  }, [projectId, chapterId, notesVersion]);

  // Закрыть шторку глав после перехода к другой главе (узкие экраны)
  useEffect(() => { setIsChaptersDrawerOpen(false); }, [chapterId]);

  const isAnySidePanelOpen = isBibleOpen || isCoauthoring || isReferenceOpen
    || isRevisionOpen || isSyncOpen || isStatsOpen || !!detailEntity || isSettingsOpen || isNotesOpen || isPlotOpen;

  /** Закрыть все правые панели (тап по затемнению на телефонах). */
  const closeAllSidePanels = useCallback(() => {
    setIsBibleOpen(false);
    setIsCoauthoring(false);
    setIsReferenceOpen(false);
    setIsRevisionOpen(false);
    setIsSyncOpen(false);
    setIsStatsOpen(false);
    setIsNotesOpen(false);
    setIsPlotOpen(false);
    setIsSettingsOpen(false);
    setDetailEntity(null);
    setIsInspectorExpanded(false);
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const isMac = /mac/i.test(navigator.platform);
    const handler = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;

      // Escape — close topmost open panel (in priority order)
      if (e.key === 'Escape') {
        if (isCommandOpen)   { setIsCommandOpen(false);   return; }
        if (isGlobalSearchOpen) { setIsGlobalSearchOpen(false); return; }
        if (isExportOpen)    { setIsExportOpen(false);    return; }
        if (isSettingsOpen)  { setIsSettingsOpen(false);  return; }
        if (isCoauthoring)   { setIsCoauthoring(false);   return; }
        if (isBibleOpen)     { setIsBibleOpen(false);     return; }
        if (isRevisionOpen)  { setIsRevisionOpen(false);  return; }
        if (isReferenceOpen) { setIsReferenceOpen(false); return; }
        if (isStatsOpen)     { setIsStatsOpen(false);     return; }
        if (isSearchOpen)    { setIsSearchOpen(false);    return; }
        if (isBibleMenuOpen) { setIsBibleMenuOpen(false); return; }
      }

      // Cmd/Ctrl+S — force-save immediately
      if (mod && e.key === 's') {
        e.preventDefault();
        if (editor) forceSave(editor.getHTML());
      }

      // Cmd/Ctrl+K — open command palette («вызов намерением словом»)
      if (mod && e.key === 'k') {
        e.preventDefault();
        setIsCommandOpen(v => !v);
      }

      // Cmd/Ctrl+J — вызвать/скрыть спутника «Перо»
      if (mod && e.key === 'j') {
        e.preventDefault();
        toggleCompanion();
      }

      // Cmd/Ctrl+F — open find/replace
      if (mod && e.key === 'f') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    isCommandOpen, isGlobalSearchOpen,
    isExportOpen, isSettingsOpen, isCoauthoring, isBibleOpen,
    isRevisionOpen, isReferenceOpen, isStatsOpen, isSearchOpen, isBibleMenuOpen,
    editor, forceSave,
  ]);

  // ── beforeunload guard — warn if a save is in-flight ─────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isSaving) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isSaving]);

  // ── Bible freshness for the current chapter ──────────────────────────────
  // 'fresh'   — lastExtractedAt is present and >= updatedAt
  // 'stale'   — chapter was edited after the last extraction
  // 'unknown' — this chapter has never been extracted (chapter-level datum only)
  const currentChapterFreshness = useMemo((): 'fresh' | 'stale' | 'unknown' => {
    if (!chapterId) return 'unknown';
    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter) return 'unknown';
    // Нет таймстампа извлечения, но синопсис уже есть → глава фактически прочитана
    // (бэкфилл-скрипты могли записать summary, не проставив lastExtractedAt). Не врём «не прочитана».
    if (!chapter.lastExtractedAt) return chapter.summary ? 'fresh' : 'unknown';
    const editedAt    = new Date(chapter.updatedAt).getTime();
    const extractedAt = new Date(chapter.lastExtractedAt).getTime();
    return editedAt > extractedAt ? 'stale' : 'fresh';
  }, [chapterId, chapters]);

  // Merge API-loaded entities with in-session approvals from the extraction hook
  const allApprovedEntities = useMemo(() => {
    const ids = new Set(bibleEntities.map(e => e.id));
    const sessionNew = approvedEntities.filter(e => !ids.has(e.id));
    return [...bibleEntities, ...sessionNew];
  }, [bibleEntities, approvedEntities]);

  // Chapter scope tier 1: entities explicitly extracted FROM this chapter
  const chapterLinkedEntities = useMemo(() => {
    if (!chapterId) return [];
    return allApprovedEntities.filter(e => e.chapterId === chapterId);
  }, [allApprovedEntities, chapterId]);

  // Chapter scope tier 2 + порядок появления — ЗА ОДИН проход: токенизируем текст главы один раз,
  // на каждую сущность один entityMatch → сразу и «упомянута» (tier 2), и индекс первого появления.
  // Из этого выводим И список упомянутых, И отсортированный по появлению список для спутника.
  const { chapterMentionedEntities, chapterEntitiesByAppearance } = useMemo(() => {
    const text = (editor?.getText() ?? '').toLowerCase();
    const words: { w: string; at: number }[] = [];
    const re = /[а-яёa-z0-9'-]+/gi; let m: RegExpExecArray | null;
    while ((m = re.exec(text))) words.push({ w: m[0], at: m.index });

    const linkedIds = new Set(chapterLinkedEntities.map(e => e.id));
    const mentioned: Entity[] = [];
    const ordered: { e: Entity; at: number }[] = [];
    // tier 1 (linked по chapter_id) — в порядок по их первому появлению (если имя встречается)
    for (const e of chapterLinkedEntities) ordered.push({ e, at: entityMatch(e.name, words, text).firstAt });
    // tier 2 (упомянуты по имени, не linked)
    for (const e of allApprovedEntities) {
      if (linkedIds.has(e.id)) continue;
      const r = entityMatch(e.name, words, text);
      if (r.mentioned) { mentioned.push(e); ordered.push({ e, at: r.firstAt }); }
    }
    ordered.sort((a, b) => a.at - b.at);
    return { chapterMentionedEntities: mentioned, chapterEntitiesByAppearance: ordered.map(x => x.e) };
  }, [allApprovedEntities, chapterLinkedEntities, editor]);

  // Contradiction detection: same name (case-insensitive) with differing descriptions
  // Нестыковки, помеченные автором как «не нестыковка» — больше не флагаем (B1).
  const [dismissedContradictions, setDismissedContradictions] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(`pero_dismissed_contradictions_${projectId}`);
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch { return new Set<string>(); }
  });
  const dismissContradiction = useCallback((name: string) => {
    const key = name.trim().toLowerCase();
    setDismissedContradictions(prev => {
      const next = new Set(prev); next.add(key);
      try { localStorage.setItem(`pero_dismissed_contradictions_${projectId}`, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, [projectId]);

  const contradictions = useMemo(() => {
    const nameGroups = new Map<string, Entity[]>();
    allApprovedEntities.forEach(e => {
      const key = e.name.toLowerCase().trim();
      if (!nameGroups.has(key)) nameGroups.set(key, []);
      nameGroups.get(key)!.push(e);
    });
    const flagged = new Set<string>();
    nameGroups.forEach((group, key) => {
      if (group.length < 2) return;
      if (dismissedContradictions.has(key)) return; // автор пометил «не нестыковка»
      const uniqueDescs = new Set(
        group.map(e => e.description?.trim().toLowerCase()).filter(Boolean)
      );
      if (uniqueDescs.size > 1) group.forEach(e => flagged.add(e.id));
    });
    return flagged;
  }, [allApprovedEntities, dismissedContradictions]);

  // Подсветка нестыковок прямо в тексте: имена сущностей с возможным противоречием
  // подчёркиваются в рукописи (сигнал приходит к автору, а не прячется в панели).
  useEffect(() => {
    if (!editor) return;
    const names = allApprovedEntities.filter(e => contradictions.has(e.id)).map(e => e.name);
    // B2: точные конфликтные фразы из отчёта по текущей главе — подсвечиваем их, а не только имена.
    const quotes = contradictionIssues.filter(i => i.chapterId === chapterId && i.quote).map(i => i.quote!);
    try {
      editor.view.dispatch(editor.view.state.tr.setMeta(contradictionHighlightKey, { terms: [...quotes, ...names] }));
    } catch { /* редактор ещё не готов — без подсветки */ }
  }, [editor, contradictions, allApprovedEntities, chapterId, isLoadingContent, contradictionIssues]);

  // B1: проактивный нудж разнописи имени. Список известных имён (+ алиасы) для сверки при письме.
  const nudgeNames = useMemo(() => {
    const out: string[] = [];
    for (const e of allApprovedEntities) {
      if (e.name) out.push(e.name);
      const al = (e.attributes as { aliases?: string[] } | undefined)?.aliases;
      if (Array.isArray(al)) out.push(...al);
    }
    return out;
  }, [allApprovedEntities]);
  const nudgeNamesRef = useRef<string[]>([]);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    nudgeNamesRef.current = nudgeNames;
    if (!editor || isLoadingContent) return;
    try {
      editor.view.dispatch(editor.view.state.tr.setMeta(nameNudgeKey, { names: nudgeNames }));
    } catch { /* редактор ещё не готов */ }
  }, [editor, nudgeNames, chapterId, isLoadingContent]);

  const isCreatingChapterRef = useRef(false);

  const handleCreateChapter = async (type: import('../components/editor/types').ChapterType = 'chapter') => {
    if (!projectId || isCreatingChapterRef.current) return;
    isCreatingChapterRef.current = true;
    try {
      const chapterCount = chapters.filter(c => (c.chapterType ?? 'chapter') === 'chapter').length;
      const titleMap: Record<string, string> = {
        chapter: `Глава ${chapterCount + 1}`,
        prologue: 'Пролог',
        epilogue: 'Эпилог',
        interlude: 'Интермедия',
      };
      const data = await api.post<{ chapter: Chapter }>(
        `/projects/${projectId}/chapters`,
        { title: titleMap[type], chapterType: type }
      );
      setChapters(prev => [...prev, data.chapter]);
      navigate(`/editor/${projectId}/${data.chapter.id}`);
    } catch (e) {
      console.error('Failed to create chapter:', e);
    } finally {
      isCreatingChapterRef.current = false;
    }
  };

  const handleDeleteChapter = async (id: string) => {
    await api.delete(`/chapters/${id}`);
    setChapters(prev => prev.filter(c => c.id !== id));
    if (chapterId === id) {
      const remaining = chapters.filter(c => c.id !== id);
      if (remaining.length > 0) {
        navigate(`/editor/${projectId}/${remaining[0].id}`);
      } else {
        navigate(`/dashboard`);
      }
    }
  };

  const handleRenameChapter = async (id: string, title: string) => {
    await api.patch(`/chapters/${id}`, { title });
    setChapters(prev => prev.map(c => c.id === id ? { ...c, title } : c));
  };

  const handleChapterTitleSuffixChange = useCallback((suffix: string) => {
    const chapter = currentChapterRef.current;
    if (!chapter) return;

    setChapterTitleDraft(suffix);
    setChapterTitleDraftChapterId(chapter.id);

    const { prefix } = splitChapterTitle(chapter.title, chapter.order, chapter.chapterType);
    const nextTitle = composeChapterTitle(prefix, suffix);

    setChapters(prev => prev.map(c => (
      c.id === chapter.id ? { ...c, title: nextTitle } : c
    )));

    if (chapterTitleSaveTimerRef.current) {
      window.clearTimeout(chapterTitleSaveTimerRef.current);
    }

    chapterTitleSaveTimerRef.current = window.setTimeout(() => {
      handleRenameChapter(chapter.id, nextTitle).catch(error => {
        console.error('Failed to rename chapter:', error);
      });
    }, 400);
  }, []);

  const handleToggleChapterStatus = async (id: string, currentStatus: 'draft' | 'done') => {
    const newStatus = currentStatus === 'draft' ? 'done' : 'draft';
    await api.patch(`/chapters/${id}`, { status: newStatus });
    setChapters(prev => prev.map(c => c.id === id ? { ...c, status: newStatus } : c));
  };

  const handleReorderChapters = async (ids: string[]) => {
    await api.put(`/projects/${projectId}/chapters/order`, { ids });
    setChapters(prev => {
      const map = Object.fromEntries(prev.map(c => [c.id, c]));
      return ids.map((id, i) => ({ ...map[id], order: i }));
    });
  };

  const handleToggleCoauthor = () => {
    // Чат теперь живёт в правом спутнике — открываем его на вкладке «Спросить».
    setIsCompanionCollapsed(false);
    setCompanionMode('chat');
  };

  // Мост «выделение → чат»: бар «Спросить Перо» закрепляет фрагмент как контекст и
  // открывает спутник на вкладке «Спросить» (текст остаётся домом, разговор уходит вправо).
  const handleAskPero = (text: string) => {
    setPinnedSelection(text);
    setIsCompanionCollapsed(false);
    setCompanionMode('chat');
  };

  // Кнопка «Перо»: открыть спутник на «Спросить». Toggle: открыт на «Спросить» — свернуть;
  // открыт на «В кадре» — переключить на «Спросить» (не закрывать).
  const handlePeroButton = () => {
    if (!companionCollapsed && companionMode === 'chat') { setIsCompanionCollapsed(true); return; }
    setIsCompanionCollapsed(false);
    setCompanionMode('chat');
  };

  // Кнопка «Мир» в нижнем тулбаре: toggle. Открыта — закрыть; иначе открыть в scope главы.
  const handleOpenWorldChapter = () => {
    if (isBibleOpen) { setIsBibleOpen(false); return; }
    if (chapterId) setBibleScope('chapter');
    handleBibleMenuClick('characters');
  };

  // Открыть «Мир» сразу на нужной линзе/инбоксе (deep-link из «Сводки»). target:
  // 'inbox' → находки; иначе LensMode ('contradictions' | 'links' | 'echo' | …).
  const openWorldAtLens = (target: string, echoQ?: string) => {
    setBibleScope('project');                 // сводка/поиск — про всю книгу
    if (target === 'inbox') { setActiveBibleTab('inbox'); setWorldInitialLens('catalog'); }
    else { setActiveBibleTab('characters'); setWorldInitialLens(target); }
    if (echoQ !== undefined) setEchoQuery(echoQ);
    setWorldLensNonce(n => n + 1);
    setIsBibleOpen(true);
    setIsCoauthoring(false); setIsReferenceOpen(false); setIsRevisionOpen(false);
    setIsSyncOpen(false); setIsStatsOpen(false); setIsNotesOpen(false); setIsPlotOpen(false);
  };
  // A3: «Найти похожее» по выделению → открыть Эхо с этим текстом.
  const handleFindSimilar = (text: string) => openWorldAtLens('echo', text);

  // Кнопка «В кадре»: спутник на вкладке памяти сцены. Toggle: если уже открыт на «В кадре» —
  // свернуть; если открыт на «Спросить» — переключить на «В кадре» (не закрывать).
  const handleOpenInFrame = () => {
    if (!companionCollapsed && companionMode === 'scene') { setIsCompanionCollapsed(true); return; }
    setIsCompanionCollapsed(false);
    setCompanionMode('scene');
  };

  const handleToggleRevision = () => {
    const next = !isRevisionOpen;
    setIsRevisionOpen(next);
    if (next) { setIsBibleOpen(false); setIsCoauthoring(false); setIsReferenceOpen(false); setIsSyncOpen(false); setIsStatsOpen(false); }
  };

  const handleToggleSync = () => {
    const next = !isSyncOpen;
    setIsSyncOpen(next);
    if (next) { setIsBibleOpen(false); setIsCoauthoring(false); setIsReferenceOpen(false); setIsRevisionOpen(false); setIsStatsOpen(false); }
  };

  const handleToggleStats = () => {
    const next = !isStatsOpen;
    setIsStatsOpen(next);
    if (next) {
      setIsBibleOpen(false);
      setIsCoauthoring(false);
      setIsReferenceOpen(false);
      setIsRevisionOpen(false);
      setIsSyncOpen(false);
      writingStats.refresh();
      // Fetch current project word count from the server
      if (projectId) {
        api.get<{ project: { wordCount?: number } }>(`/projects/${projectId}`)
          .then(data => { setTotalProjectWords(data.project?.wordCount ?? 0); })
          .catch(() => {});
      }
    }
  };

  /**
   * Batch-recheck all stale chapters in one (or a few) API calls instead of N sequential calls.
   * Chapters whose content hasn't changed since last extraction are skipped server-side for free.
   */
  const handleRecheckAllStale = async () => {
    if (isRecheckingAll) return;
    setIsRecheckingAll(true);
    try {
      const stale = chapters.filter(ch => {
        if (!ch.lastExtractedAt) return false; // never extracted — not "stale", let user trigger manually
        return new Date(ch.updatedAt).getTime() > new Date(ch.lastExtractedAt).getTime();
      });
      if (stale.length === 0) return;

      await recheckBatch(stale.map(ch => ch.id));

      // Mark all stale chapters as freshly extracted optimistically
      const staleIds = new Set(stale.map(ch => ch.id));
      setChapters(prev => prev.map(c =>
        staleIds.has(c.id) ? { ...c, lastExtractedAt: new Date().toISOString() } : c
      ));
    } catch (e) {
      console.error('Batch recheck failed:', e);
    } finally {
      setIsRecheckingAll(false);
    }
  };

  const handleBibleMenuClick = (tabId: string) => {
    setActiveBibleTab(tabId);
    setIsBibleOpen(true);
    setIsCoauthoring(false);
    setIsReferenceOpen(false);
    setIsRevisionOpen(false);
    setIsSyncOpen(false);
    setIsStatsOpen(false);
    setIsNotesOpen(false);
    setIsPlotOpen(false);
    if (isDictating) toggleListening();
    setIsReading(false);
  };

  // Линза «Заметки» в редакторе (оверлей в общем aside, как «Мир»). Закрывает остальные.
  const handleOpenNotes = () => {
    const next = !isNotesOpen;
    setIsNotesOpen(next);
    if (next) {
      setIsBibleOpen(false); setIsCoauthoring(false); setIsReferenceOpen(false);
      setIsRevisionOpen(false); setIsSyncOpen(false); setIsStatsOpen(false);
      setDetailEntity(null); setIsSettingsOpen(false); setIsPlotOpen(false);
    }
  };

  // Столб «Сюжет» (оверлей в общем aside, как «Мир»). Закрывает остальные.
  // lens — на какую линзу открыть (для прыжков из карточки героя в «Линии»).
  const handleOpenPlot = (lens: 'skeleton' | 'threads' | 'beats' | 'arcs' = 'skeleton') => {
    const next = lens !== 'skeleton' ? true : !isPlotOpen; // прыжок на конкретную линзу всегда открывает
    setPlotInitialLens(lens);
    setIsPlotOpen(next);
    if (next) {
      setIsBibleOpen(false); setIsCoauthoring(false); setIsReferenceOpen(false);
      setIsRevisionOpen(false); setIsSyncOpen(false); setIsStatsOpen(false);
      setDetailEntity(null); setIsSettingsOpen(false); setIsNotesOpen(false);
      loadThreads();
    }
  };

  const handleToggleReading = () => {
    const next = !isReading;
    setIsReading(next);
    if (next) { if (isDictating) toggleListening(); setIsCoauthoring(false); }
  };

  const handleToggleReference = () => {
    const next = !isReferenceOpen;
    setIsReferenceOpen(next);
    if (next) {
      setIsBibleOpen(false);
      setIsCoauthoring(false);
      setIsRevisionOpen(false);
      setIsSyncOpen(false);
      setIsStatsOpen(false);
      if (isDictating) toggleListening();
      setIsReading(false);
    }
  };

  const handleToggleFocusMode = () => {
    const next = !isFocusMode;
    setIsFocusMode(next);

    if (next) {
      setIsBibleOpen(false);
      setIsReferenceOpen(false);
      setIsBibleMenuOpen(false);
      setIsCoauthoring(false);
      setIsRevisionOpen(false);
      setIsSyncOpen(false);
      setIsStatsOpen(false);
      setIsSettingsOpen(false);
      setIsExportOpen(false);
      setIsSearchOpen(false);
      setIsGlobalSearchOpen(false);
      setIsInspectorExpanded(false);
    }
  };

  useEffect(() => {
    return () => {
      if (chapterTitleSaveTimerRef.current) {
        window.clearTimeout(chapterTitleSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const chapter = currentChapterRef.current;
    if (!chapter || chapter.id === chapterTitleDraftChapterId) return;
    setChapterTitleDraft(splitChapterTitle(chapter.title, chapter.order, chapter.chapterType).suffix);
    setChapterTitleDraftChapterId(chapter.id);
  }, [chapterId, chapters, chapterTitleDraftChapterId]);

  const currentChapterPrefix = (() => {
    const chapter = currentChapterRef.current;
    if (!chapter) return 'Глава';
    return splitChapterTitle(chapter.title, chapter.order, chapter.chapterType).prefix;
  })();
  const currentChapterTitleSuffix = (() => {
    const chapter = currentChapterRef.current;
    if (!chapter) return '';
    if (chapter.id === chapterTitleDraftChapterId) {
      return chapterTitleDraft;
    }
    return splitChapterTitle(chapter.title, chapter.order, chapter.chapterType).suffix;
  })();
  const currentChapterType = chapters.find(c => c.id === chapterId)?.chapterType ?? 'chapter';

  // Сменить тип текущей главы (переключатель в заголовке). Авто-заголовок «Глава N» при смене
  // на не-главу заменяем словом-типом; обратно на главу — чистим, чтобы показалась «Глава N».
  const handleChapterTypeChange = useCallback(async (type: string) => {
    if (!chapterId) return;
    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter || chapter.chapterType === type) return;
    const trimmed = (chapter.title ?? '').trim();
    const typeLabels = Object.values(CHAPTER_TYPE_LABELS).filter(Boolean);
    // «Авто»-заголовок = пусто / «Глава N» / ровно слово-тип (Эпилог и т.п.) — такой можно заменять.
    const isAutoTitle = !trimmed || /^Глава\s+\d+$/i.test(trimmed) || typeLabels.includes(trimmed);
    let nextTitle = chapter.title;
    if (type !== 'chapter' && isAutoTitle) nextTitle = CHAPTER_TYPE_LABELS[type] || chapter.title;
    else if (type === 'chapter' && typeLabels.includes(trimmed)) nextTitle = `Глава ${chapter.order + 1}`;

    const body: { chapterType: string; title?: string } = { chapterType: type };
    if (nextTitle !== chapter.title) body.title = nextTitle;
    try {
      await api.patch(`/chapters/${chapterId}`, body);
      setChapters(prev => prev.map(c => c.id === chapterId ? { ...c, chapterType: type as Chapter['chapterType'], title: nextTitle } : c));
      setChapterTitleDraftChapterId(null); // сбросить черновик суффикса — пересчитается из нового типа
    } catch { /* тихо */ }
  }, [chapterId, chapters]);

  // Сквозная нумерация сносок: offset = число сносок во всех главах ДО текущей (по order).
  useEffect(() => {
    if (!editor) return;
    const current = chapters.find(c => c.id === chapterId);
    if (!current) return;
    const offset = chapters
      .filter(c => c.order < current.order)
      .reduce((sum, c) => sum + ((c.content || '').match(/data-footnote-id/g)?.length ?? 0), 0);
    try { editor.commands.setFootnoteOffset(offset); } catch { /* view ещё не смонтирован */ }
  }, [editor, chapterId, chapters]);

  // Все сноски книги (для линзы «Сноски» в «Мире») — парсим контент глав по порядку, сквозная нумерация.
  const bookFootnotes = useMemo<BookFootnote[]>(() => {
    const items: BookFootnote[] = [];
    let n = 0;
    for (const ch of [...chapters].sort((a, b) => a.order - b.order)) {
      const html = ch.content || '';
      if (!html.includes('data-footnote-id')) continue;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('[data-footnote-id]').forEach((el) => {
        n += 1;
        items.push({
          id: el.getAttribute('data-footnote-id') || '',
          content: el.getAttribute('data-content') || '',
          chapterId: ch.id, chapterTitle: ch.title, chapterOrder: ch.order, number: n,
        });
      });
    }
    return items;
  }, [chapters]);

  // Переход к сноске из линзы: закрыть «Мир», открыть её главу, проскроллить к маркеру.
  const [pendingFootnoteScroll, setPendingFootnoteScroll] = useState<{ chapterId: string; footnoteId: string } | null>(null);
  const handleJumpToFootnote = useCallback((targetChapterId: string, footnoteId: string) => {
    setIsBibleOpen(false);
    if (targetChapterId !== chapterIdRef.current) navigate(`/editor/${projectId}/${targetChapterId}`);
    setPendingFootnoteScroll({ chapterId: targetChapterId, footnoteId });
  }, [projectId, navigate]);

  useEffect(() => {
    if (!pendingFootnoteScroll || !editor) return;
    if (chapterId !== pendingFootnoteScroll.chapterId || isLoadingContent) return;
    const t = setTimeout(() => {
      try {
        const el = editor.view.dom.querySelector(`.footnote-ref[data-footnote-id="${pendingFootnoteScroll.footnoteId}"]`) as HTMLElement | null;
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch { /* view не готов */ }
      setPendingFootnoteScroll(null);
    }, 150);
    return () => clearTimeout(t);
  }, [pendingFootnoteScroll, chapterId, isLoadingContent, editor]);

  const handleEditorFontChange = useCallback((font: EditorFontName) => {
    setEditorFont(font);
    localStorage.setItem('pero_editorFont', font);
  }, []);

  // ── Команды для ⌘K-палитры («вызов намерением словом») ────────────────────
  const commands: Command[] = useMemo(() => [
    { id: 'read', label: 'Прочитать главу Пером', hint: currentChapterFreshness === 'fresh' ? 'прочитано' : '', icon: Eye, keywords: 'извлечь анализ читать',
      run: () => (currentChapterFreshness === 'stale' ? handleRecheckChapter() : handleExtract()) },
    { id: 'read-all', label: 'Прочитать все изменённые главы', icon: Eye, keywords: 'синхронизация обновить все устаревшие перечитать',
      run: () => handleRecheckAllStale() },
    { id: 'inbox', label: 'Новое — находки на одобрение', icon: Bell, keywords: 'находки инбокс одобрить сущности',
      run: () => handleBibleMenuClick('inbox') },
    { id: 'world', label: 'Мир — каталог, линзы', icon: BookOpen, keywords: 'библия персонажи локации присутствие связи линза',
      run: () => handleBibleMenuClick('characters') },
    { id: 'notes', label: 'Заметки — идеи по книге', icon: StickyNote, keywords: 'идеи заметки записать набросок',
      run: () => { if (!isNotesOpen) handleOpenNotes(); } },
    { id: 'ask', label: 'Перо — спросить про историю', icon: Feather, keywords: 'чат вопрос аналитик суммируй',
      run: () => { if (!isCoauthoring) handleToggleCoauthor(); } },
    { id: 'scan', label: 'Проверить всю книгу на нестыковки', icon: AlertTriangle, keywords: 'скан проверка противоречия нестыковки вся книга',
      run: () => { runContradictionScan(); } },
    { id: 'reference', label: 'Справочник / Нестыковки этой главы', icon: Bookmark, keywords: 'справка нестыковки противоречия глава',
      run: () => { if (!isReferenceOpen) handleToggleReference(); } },
    { id: 'revision', label: 'Поиск по миру — где встречается, арка', icon: Telescope, keywords: 'ревизия трейс арка найти',
      run: () => { if (!isRevisionOpen) handleToggleRevision(); } },
    { id: 'stats', label: 'Статистика написанного', icon: BarChart2, keywords: 'прогресс слова статистика',
      run: () => { if (!isStatsOpen) handleToggleStats(); } },
    { id: 'find', label: 'Поиск в тексте главы', hint: '⌘F', icon: Search, keywords: 'найти заменить поиск',
      run: () => setIsSearchOpen(true) },
    { id: 'projsearch', label: 'Поиск по всему проекту', icon: FolderSearch, keywords: 'глобальный поиск проект главы',
      run: () => setIsGlobalSearchOpen(true) },
    { id: 'export', label: 'Экспорт рукописи', icon: Download, keywords: 'скачать docx экспорт сохранить',
      run: () => setIsExportOpen(true) },
    { id: 'focus', label: isFocusMode ? 'Выйти из фокуса' : 'Режим фокуса', icon: Maximize2, keywords: 'фокус чистый письмо',
      run: () => handleToggleFocusMode() },
    { id: 'settings', label: 'Настройки', icon: SettingsIcon, keywords: 'настройки аккаунт профиль',
      run: () => setIsSettingsOpen(true) },
  ], [currentChapterFreshness, isCoauthoring, isReferenceOpen, isRevisionOpen, isStatsOpen, isFocusMode, isNotesOpen,
      handleRecheckChapter, handleExtract, handleRecheckAllStale, handleToggleCoauthor, handleToggleReference, handleToggleRevision, handleToggleStats, handleToggleFocusMode, runContradictionScan]);

  return (
    <>
      <style>{`
        @keyframes waveform { 0% { height: 4px; } 100% { height: 16px; } }
        .animate-waveform { animation: waveform 0.4s ease-in-out infinite alternate; }

        /* Temporary search-jump highlight — applied via ProseMirror Decoration,
           does NOT modify document content so autosave is unaffected. */
        .search-highlight {
          background: rgba(250, 204, 21, 0.42);
          border-radius: 2px;
          box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.28);
        }
        /* Нестыковка — волнистое подчёркивание прямо в тексте (как у проверки орфографии) */
        .contradiction-mark {
          text-decoration: underline wavy #A14F44;
          text-decoration-skip-ink: none;
          text-underline-offset: 3px;
        }
        /* Разнопись имени (B1) — мягкий охра-пунктир: «похоже на известное имя», не ошибка.
           Тише красной волны нестыковки; сигнал-подсказка, решает автор (title-тултип). */
        .name-nudge {
          text-decoration: underline dotted #B8862B;
          text-decoration-skip-ink: none;
          text-underline-offset: 3px;
          cursor: help;
        }
        /* Комментарий — приклеенная к фразе авторская пометка. Мягкая охра-подложка +
           тонкое подчёркивание (отлично от красной волны нестыковки). author / pero. */
        .comment-mark {
          background: rgba(145, 104, 46, 0.12);
          border-bottom: 1.5px solid rgba(145, 104, 46, 0.5);
          border-radius: 2px 2px 0 0;
          cursor: pointer;
          transition: background 0.12s ease;
        }
        .comment-mark:hover { background: rgba(145, 104, 46, 0.2); }
        .comment-mark[data-comment-source="pero"] {
          background: rgba(161, 79, 68, 0.1);
          border-bottom-color: rgba(161, 79, 68, 0.5);
        }
        .comment-mark[data-comment-source="pero"]:hover { background: rgba(161, 79, 68, 0.18); }
        /* Живая диктовка — призрачный текст прямо у курсора (DictationGhostExtension).
           Наследует шрифт/размер абзаца, поэтому льётся в строку как настоящий текст. */
        .dictation-ghost {
          color: rgba(161, 79, 68, 0.6);
          font-style: italic;
          pointer-events: none;
          white-space: pre-wrap;
        }
        .dictation-ghost-caret {
          display: inline-block;
          width: 2px;
          height: 1em;
          margin-left: 1px;
          vertical-align: text-bottom;
          background: rgba(161, 79, 68, 0.75);
          border-radius: 1px;
          animation: dictation-caret-blink 1s step-end infinite;
        }
        @keyframes dictation-caret-blink {
          50% { opacity: 0; }
        }
      `}</style>

      <div className="relative flex h-screen w-full bg-[#f5f0e8] overflow-hidden font-sans text-[#1e2d1f]">
        <AhaCelebration />
        {/* Backdrop шторки глав (только < lg) */}
        {!isFocusMode && isChaptersDrawerOpen && (
          <div
            className="fixed inset-0 bg-ink/30 z-40 lg:hidden"
            onClick={() => setIsChaptersDrawerOpen(false)}
          />
        )}
        {!isFocusMode && (
          <div className={`shrink-0 overflow-hidden max-lg:overflow-visible max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:transition-transform lg:transition-[width] duration-300 ease-in-out ${
            isChaptersDrawerOpen ? 'max-lg:translate-x-0 max-lg:shadow-2xl' : 'max-lg:-translate-x-full'
          } ${isChaptersCollapsed ? 'lg:w-0' : 'lg:w-[220px]'}`}>
          {/* Внутренний блок фиксированной ширины — содержимое не переверстывается во время
              анимации ширины внешней обёртки (как у правого спутника). */}
          <div className="flex h-full w-[220px]">
          <ChapterSidebar
            projectId={projectId!}
            chapterId={chapterId}
            chapters={chapters}
            isLoadingChapters={isLoadingChapters}
            onCreateChapter={handleCreateChapter}
            onDeleteChapter={handleDeleteChapter}
            onReorderChapters={handleReorderChapters}
            onToggleChapterStatus={handleToggleChapterStatus}
            wordCount={editor?.storage.characterCount.words() ?? 0}
            showWordCount={showWordCount}
            onShowWordCountChange={setShowWordCount}
            isSaving={isSaving}
            lastSavedAt={lastSavedAt}
            saveError={saveError}
            editorFont={editorFont}
            onOpenBible={() => handleBibleMenuClick('characters')}
            onOpenPlot={() => handleOpenPlot()}
            bibleBadge={
              suggestions.length
              + updateSuggestions.filter(u => u.status === 'pending').length
              + contradictions.size
            }
            onCollapse={() => setIsChaptersCollapsed(true)}
            onOpenSettings={() => { setIsSettingsOpen(true); setIsChaptersDrawerOpen(false); }}
          />
          </div>
          </div>
        )}

        <div
          className="flex-1 min-w-0 flex flex-col relative"
          onClick={(e) => {
            // Клик по подсветке комментария → активировать карточку на полях (или поповер, если поля нет).
            const cm = (e.target as HTMLElement).closest('.comment-mark') as HTMLElement | null;
            if (cm) {
              const id = cm.getAttribute('data-comment-id');
              const found = id ? comments.find(c => c.id === id) : null;
              if (found) {
                setContradictionPopover(null);
                // спутник свёрнут + широкий → карточка на полях; иначе поповер (спутник не трогаем)
                if (window.matchMedia('(min-width: 1024px)').matches && companionCollapsedRef.current) {
                  setActiveCommentId(found.id);
                } else { const r = cm.getBoundingClientRect(); setCommentPopover({ comment: found, x: r.left + r.width / 2, y: r.bottom }); }
                return;
              }
              // Марка-сирота (строки комментария в БД нет — напр. удалён извне): самолечение —
              // снимаем мёртвую подсветку, чтобы не оставалась «висячая» без карточки.
              if (id && editorRef.current) {
                editorRef.current.commands.removeCommentById(id);
                forceSave(editorRef.current.getHTML()).catch(() => {});
                return;
              }
            }
            // Клик вне подсветки — свернуть активную карточку на полях.
            if (activeCommentId) setActiveCommentId(null);
            const mark = (e.target as HTMLElement).closest('.contradiction-mark');
            if (mark && editor) {
              // Клик по нестыковке = ТИХАЯ подсветка фразы. Ноль плашек поверх текста; находка живёт в правом рельсе.
              try {
                const from = editor.view.posAtDOM(mark, 0);
                const to = from + (mark.textContent?.length ?? 0);
                if (from >= 0 && to > from) applySearchHighlight(editor, from, to);
              } catch { /* позиция не нашлась — игнорируем */ }
            }
          }}
        >
          {/* Ось ЗУМА как сегмент-контрол: уровни двигают грань панелей (Глава·Книга·Серия),
              активный = залитая пилюля. Рядом — имя активного уровня (тихий ориентир, без хлебных стрелок). */}
          {(() => {
            const applyZoom = (z: 'scene' | 'book' | 'series') => {
              if (z === 'scene') { setBibleScope('chapter'); setChatScope('chapter'); }
              else if (z === 'series') { setBibleScope('series'); setChatScope('series'); }
              else { setBibleScope('project'); setChatScope('book'); }
            };
            const segCls = (active: boolean) =>
              `rounded-md px-2.5 py-1 text-[12px] cursor-pointer transition-all ${active
                ? 'bg-white text-[#A14F44] font-semibold shadow-sm'
                : 'text-[#1e2d1f]/55 hover:text-[#1e2d1f] hover:bg-white/50'}`;
            const ch = chapters.find(c => c.id === chapterId);
            const chapterLabel = ch ? splitChapterTitle(ch.title, ch.order, ch.chapterType).prefix : 'Глава';
            const activeName = bibleScope === 'series'
              ? (seriesInfo?.title ?? 'Серия')
              : bibleScope === 'project' ? (projectTitle || 'Книга') : chapterLabel;
            return (
              <nav className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-[#1e2d1f]/5 overflow-x-auto whitespace-nowrap">
                <span className="flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-wider text-[#1e2d1f]/35 flex-shrink-0">
                  <Maximize2 size={11} /> масштаб
                </span>
                <div className="inline-flex items-center gap-0.5 rounded-lg bg-[#1e2d1f]/[0.05] p-0.5 flex-shrink-0">
                  <button onClick={() => applyZoom('scene')} className={segCls(bibleScope === 'chapter')} title="Панели по этой главе">Глава</button>
                  <button onClick={() => applyZoom('book')} className={segCls(bibleScope === 'project')} title="Панели по всей книге">Книга</button>
                  {projectSeriesId && (
                    <button onClick={() => applyZoom('series')} className={segCls(bibleScope === 'series')} title="Панели по всей серии">Серия</button>
                  )}
                </div>
                <span className="min-w-0 truncate text-[12px] text-[#1e2d1f]/40" title={activeName}>{activeName}</span>
              </nav>
            );
          })()}

          {/* №1 — живой статус скана нестыковок */}
          {scanState && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#1e2d1f] text-[#f5f0e8] text-[12.5px] shadow-lg">
              {scanState.status === 'running' ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-[#f5f0e8]/30 border-t-[#f5f0e8] rounded-full animate-spin" />
                  Перо проверяет книгу{scanState.total ? `… ${scanState.scanned}/${scanState.total}` : '…'}
                </>
              ) : scanState.status === 'failed' ? (
                <><AlertTriangle size={14} className="text-[#D8B27A]" /> Проверка прервалась — попробуйте ещё раз</>
              ) : scanState.found > 0 ? (
                <><AlertTriangle size={14} className="text-[#e0a89e]" /> Перо нашло нестыковок: {scanState.found}</>
              ) : (
                <><Eye size={14} className="text-[#8AAE86]" /> Нестыковок не найдено</>
              )}
            </div>
          )}
          <EditorCanvas
            editor={editor}
            isSaving={isSaving}
            lastSavedAt={lastSavedAt}
            saveError={saveError}
            isLoadingContent={isLoadingContent}
            chapterPrefix={currentChapterPrefix}
            chapterTitleSuffix={currentChapterTitleSuffix}
            onChapterTitleSuffixChange={handleChapterTitleSuffixChange}
            chapterType={currentChapterType}
            onChapterTypeChange={handleChapterTypeChange}
            indentParagraphs={indentParagraphs}
            onIndentParagraphsChange={setIndentParagraphs}
            editorFont={editorFont}
            onEditorFontChange={handleEditorFontChange}
            isFocusMode={isFocusMode}
            reserveCommentGutter={gutterItems.length > 0 && companionCollapsed && wideNow}
            isDictating={isDictating || isDictationProcessing}
            interimTranscript={
              isDictationProcessing ? 'Обрабатываю диктовку…'
              : (isDictating && !interimTranscript ? 'Слушаю…' : '')
            }
            onOpenSettings={() => { setIsSettingsOpen(true); setIsChaptersDrawerOpen(false); }}
            onOpenSearch={() => setIsSearchOpen(true)}
            onOpenExport={() => setIsExportOpen(true)}
            onOpenChapters={() => {
              // На десктопе (≥ lg) разворачиваем свёрнутый сайдбар; на узких — шторку
              if (window.matchMedia('(min-width: 1024px)').matches) setIsChaptersCollapsed(false);
              else setIsChaptersDrawerOpen(true);
            }}
            isChaptersCollapsed={isChaptersCollapsed}
            isCompanionOpen={!companionCollapsed}
            onToggleCompanion={() => toggleCompanion()}
            projectId={projectId}
          />

          {isBibleMenuOpen && (
            <div className="fixed inset-0 z-30" onClick={() => setIsBibleMenuOpen(false)} />
          )}

          <BottomToolbar
            isDictating={isDictating}
            isDictationProcessing={isDictationProcessing}
            isDictationSupported={isSupported}
            onToggleDictation={toggleListening}
            isFocusMode={isFocusMode}
            onToggleFocusMode={handleToggleFocusMode}
            isCompanionOpen={!companionCollapsed}
            companionMode={companionMode}
            onToggleCompanion={handlePeroButton}
            companionCount={
              suggestions.filter(s => s.chapterId === chapterId).length
              + [...chapterLinkedEntities, ...chapterMentionedEntities].filter(e => contradictions.has(e.id)).length
            }
            onOpenWorld={handleOpenWorldChapter}
            isWorldOpen={isBibleOpen}
            worldCount={suggestions.filter(s => s.chapterId === chapterId).length}
            onOpenInFrame={handleOpenInFrame}
            onOpenNotes={handleOpenNotes}
            isNotesOpen={isNotesOpen}
          />

          {/* ── Match navigation bar ── */}
          {matchNav && matchNav.matches.length > 0 && (
            <div
              style={{
                position: 'fixed',
                bottom: '80px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 60,
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                background: '#fff',
                border: '1px solid rgba(30,45,31,0.12)',
                borderRadius: '24px',
                padding: '5px 6px 5px 14px',
                boxShadow: '0 4px 24px rgba(30,45,31,0.14)',
                fontSize: '13px',
                color: '#1e2d1f',
                userSelect: 'none',
                whiteSpace: 'nowrap',
                pointerEvents: 'auto',
              }}
            >
              {/* Query label */}
              <span style={{ color: 'rgba(30,45,31,0.45)', marginRight: '4px', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                «{matchNav.query}»
              </span>

              {/* Counter */}
              <span style={{ fontWeight: 600, marginRight: '4px' }}>
                {matchNav.currentIdx + 1} из {matchNav.matches.length}
              </span>

              {/* Prev */}
              <button
                onClick={() => handleMatchNavGo(-1)}
                disabled={matchNav.matches.length <= 1}
                title="Предыдущее (Shift+F3)"
                style={{
                  background: 'none', border: 'none', cursor: matchNav.matches.length > 1 ? 'pointer' : 'default',
                  padding: '4px', borderRadius: '8px', display: 'flex', alignItems: 'center',
                  color: matchNav.matches.length > 1 ? '#1e2d1f' : 'rgba(30,45,31,0.25)',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => { if (matchNav.matches.length > 1) (e.currentTarget as HTMLElement).style.background = 'rgba(30,45,31,0.06)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
              >
                <ChevronUp size={15} />
              </button>

              {/* Next */}
              <button
                onClick={() => handleMatchNavGo(1)}
                disabled={matchNav.matches.length <= 1}
                title="Следующее (F3)"
                style={{
                  background: 'none', border: 'none', cursor: matchNav.matches.length > 1 ? 'pointer' : 'default',
                  padding: '4px', borderRadius: '8px', display: 'flex', alignItems: 'center',
                  color: matchNav.matches.length > 1 ? '#1e2d1f' : 'rgba(30,45,31,0.25)',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => { if (matchNav.matches.length > 1) (e.currentTarget as HTMLElement).style.background = 'rgba(30,45,31,0.06)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
              >
                <ChevronDown size={15} />
              </button>

              {/* Close */}
              <button
                onClick={handleMatchNavClose}
                title="Закрыть (Esc)"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '4px', borderRadius: '8px', display: 'flex', alignItems: 'center',
                  color: 'rgba(30,45,31,0.6)', marginLeft: '2px',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(30,45,31,0.06)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Затемнение под панелью на телефонах: панель занимает почти весь экран,
            тап по остатку закрывает её. На md+ затемнения нет — текст читаем. */}
        {!isFocusMode && isAnySidePanelOpen && (
          <div
            className="absolute inset-0 bg-ink/30 z-40 md:hidden"
            onClick={closeAllSidePanels}
          />
        )}
        {/* Инспектор = оверлей справа (слева от пульс-рельса), не раздвигает письмо.
            «Развернуть» — центрированный блок до левого меню (не на весь экран, с отступами).
            Закрытие — Esc / крестик / тап по затемнению (на узких). */}
        <aside
          className={`bg-[#f5f0e8] border-[#1e2d1f]/10 transition-all duration-300 ease-in-out overflow-hidden absolute shadow-2xl ${
            !(!isFocusMode && isAnySidePanelOpen)
              ? 'top-14 bottom-0 right-12 w-[min(92vw,360px)] border-l opacity-0 translate-x-full pointer-events-none z-40'
              : (isBibleOpen || detailEntity || isSettingsOpen || isNotesOpen || isPlotOpen)
              ? `z-40 top-16 bottom-24 max-md:top-12 max-md:bottom-24 ${isChaptersCollapsed ? 'left-3' : 'left-3 lg:left-[232px]'} ${companionCollapsed ? "right-4" : "right-4 lg:right-[300px]"} rounded-2xl border opacity-100 translate-x-0 pointer-events-auto`
              : isInspectorExpanded
              ? `z-40 top-16 bottom-6 max-md:top-12 max-md:bottom-3 right-[68px] max-md:right-3 left-6 max-md:left-3 ${isChaptersCollapsed ? '' : 'lg:left-[244px]'} rounded-2xl border opacity-100 translate-x-0 pointer-events-auto`
              : 'z-40 top-14 bottom-0 right-12 max-md:right-0 max-md:top-0 w-[min(92vw,360px)] border-l border-t max-md:border-t-0 opacity-100 translate-x-0 pointer-events-auto'
          }`}
        >
          {/* Развернуть / свернуть — рядом с крестиком (для узких панелей; «Мир» и так на весь экран) */}
          {(!isFocusMode && isAnySidePanelOpen && !isBibleOpen && !detailEntity && !isSettingsOpen && !isNotesOpen && !isPlotOpen) && (
            <button
              onClick={() => setIsInspectorExpanded(v => !v)}
              className="absolute top-3.5 right-[54px] z-50 p-1.5 rounded-md text-[#1e2d1f]/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/5 transition-colors"
              title={isInspectorExpanded ? 'Свернуть панель' : 'Развернуть'}
              aria-label={isInspectorExpanded ? 'Свернуть панель' : 'Развернуть панель'}
            >
              {isInspectorExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          )}
          <div className="w-full h-full flex flex-col absolute top-0 left-0">
          {isBibleOpen && (
            <StoryBiblePanel
              projectId={projectId ?? ''}
              initialLens={worldInitialLens as never}
              initialLensNonce={worldLensNonce}
              echoInitialQuery={echoQuery}
              activeBibleTab={activeBibleTab}
              onTabChange={setActiveBibleTab}
              isExtracting={isExtracting}
              suggestions={suggestions}
              approvedEntities={allApprovedEntities}
              updateSuggestions={updateSuggestions}
              entityLinks={entityLinks}
              entityEvents={entityEvents}
              chapters={chapters.map(c => ({ id: c.id, title: c.title, order: c.order, povCharacter: c.povCharacter }))}
              onExtract={handleExtract}
              chapterFreshnessStatus={currentChapterFreshness}
              onRecheck={handleRecheckChapter}
              onApproveSuggestion={approveSuggestion}
              onRejectSuggestion={rejectSuggestion}
              onMergeSuggestionInto={(suggestionId, targetId) => { mergeSuggestionInto(suggestionId, targetId); loadBibleData(); }}
              onAcceptUpdate={acceptUpdate}
              onRejectUpdate={rejectUpdate}
              onDismissUpdate={dismissUpdate}
              onBulkDismissChapter={bulkDismissChapter}
              onBulkRejectChapter={bulkRejectChapter}
              onFindSemanticDuplicates={async () => {
                if (!projectId) return [];
                const r = await api.post<{ pairs: import('../components/editor/StoryBiblePanel').SemanticPair[] }>(`/bible/${projectId}/semantic-duplicates`, {});
                return r.pairs ?? [];
              }}
              onMergeDuplicates={async (ids, survivorId) => {
                if (!projectId || ids.length < 2) return;
                try {
                  await api.post(`/bible/${projectId}/merge`, { ids, survivorId });
                  const data = await api.get<{ entities: Entity[]; links?: EntityLink[]; events?: EntityEvent[] }>(`/bible/${projectId}`);
                  setBibleEntities((data.entities ?? []).filter(e => e.status === 'approved'));
                  setEntityLinks(data.links ?? []);
                  setEntityEvents(data.events ?? []);
                } catch { /* ошибка слияния — тихо */ }
              }}
              onMergeAll={async (groups) => {
                if (!projectId) return;
                try {
                  for (const ids of groups) {
                    if (ids.length >= 2) await api.post(`/bible/${projectId}/merge`, { ids });
                  }
                  const data = await api.get<{ entities: Entity[]; links?: EntityLink[]; events?: EntityEvent[] }>(`/bible/${projectId}`);
                  setBibleEntities((data.entities ?? []).filter(e => e.status === 'approved'));
                  setEntityLinks(data.links ?? []);
                  setEntityEvents(data.events ?? []);
                } catch { /* ошибка слияния — тихо */ }
              }}
              onLinksChanged={loadBibleData}
              onOpenInEditor={handleOpenInEditor}
              contradictions={contradictions}
              footnotes={bookFootnotes}
              onJumpToFootnote={handleJumpToFootnote}
              currentChapterId={chapterId}
              seriesId={projectSeriesId}
              scope={bibleScope}
              onScopeChange={setBibleScope}
              seriesPremise={seriesInfo?.premise ?? null}
              seriesThreads={seriesInfo?.franchiseThreads ?? []}
              onOpenSeriesCanvas={() => projectSeriesId && navigate(`/series/${projectSeriesId}`)}
              chapterEntityIds={new Set([...chapterLinkedEntities, ...chapterMentionedEntities].map(e => e.id))}
              contradictionIssues={contradictionIssues}
              scanState={scanState}
              onScanContradictions={runContradictionScan}
              onDismissContradiction={dismissContradictionIssue}
              onOpenEntityDetail={(name) => {
                const e = allApprovedEntities.find(x => (x.name ?? '').trim().toLowerCase() === name.trim().toLowerCase());
                if (e) { setIsBibleOpen(false); setDetailEntity(e); }
              }}
              isExpanded={isInspectorExpanded || isBibleOpen}
              onClose={() => setIsBibleOpen(false)}
            />
          )}

          {isRevisionOpen && (
            <RevisionPanel
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              traceResults={traceResults}
              isTracing={isTracing}
              traceDone={traceDone}
              traceSemantic={traceSemantic}
              onTrace={handleTrace}
              arcText={arcText}
              isArcLoading={isArcLoading}
              onArc={handleArc}
              bibleSuggestions={bibleSuggestions}
              isBibleLoading={isBibleLoading}
              bibleDone={bibleDone}
              onBibleUpdate={handleBibleUpdate}
              onDismissBibleSuggestion={dismissBibleSuggestion}
              onClose={() => setIsRevisionOpen(false)}
            />
          )}

          {isSyncOpen && (
            <ProjectSyncPanel
              chapters={chapters}
              currentChapterId={chapterId}
              pendingUpdatesCount={updateSuggestions.filter(u => u.status === 'pending').length}
              isRecheckingAll={isRecheckingAll}
              onNavigateToChapter={(id) => navigate(`/editor/${projectId}/${id}`)}
              onRecheckAllStale={handleRecheckAllStale}
              onOpenBibleUpdates={() => { handleBibleMenuClick('updates'); }}
              onCreateBible={() => { handleBibleMenuClick('characters'); setIsSyncOpen(false); }}
              onClose={() => setIsSyncOpen(false)}
            />
          )}

          {isStatsOpen && (
            <WritingStatsPanel
              {...writingStats}
              totalProjectWords={totalProjectWords}
              chapterWords={editor?.storage.characterCount?.words?.() ?? 0}
              onClose={() => setIsStatsOpen(false)}
            />
          )}

          {detailEntity && (
            <EntityDetailPanel
              entity={detailEntity}
              links={entityLinks}
              events={entityEvents}
              allEntities={allApprovedEntities}
              chaptersRef={chapters.map(c => ({ id: c.id, title: c.title, order: c.order }))}
              onClose={() => setDetailEntity(null)}
              onSelectEntity={setDetailEntity}
              onOpenInWorld={() => { setDetailEntity(null); handleBibleMenuClick('characters'); }}
              threads={plotThreads}
              onOpenThreads={() => handleOpenPlot('threads')}
            />
          )}

          {isSettingsOpen && (
            <Settings
              onClose={() => setIsSettingsOpen(false)}
              showWordCount={showWordCount}
              setShowWordCount={setShowWordCount}
              indentParagraphs={indentParagraphs}
              setIndentParagraphs={setIndentParagraphs}
              editorFont={editorFont}
              setEditorFont={handleEditorFontChange}
            />
          )}

          {isNotesOpen && (
            <div className="flex flex-col h-full w-full">
              <div className="px-5 py-4 border-b border-[#1e2d1f]/5 flex justify-between items-center bg-white/40 flex-shrink-0">
                <div>
                  <h2 className="font-sans text-base font-semibold text-[#1e2d1f]">Заметки</h2>
                  <p className="text-[11px] text-[#1e2d1f]/45 leading-tight">идеи и заметки по книге; новые привязываются к этой главе</p>
                </div>
                <button onClick={() => setIsNotesOpen(false)} className="p-1.5 rounded-md hover:bg-[#1e2d1f]/5 text-[#1e2d1f]/50 transition-colors">
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                {projectId && (
                  <NotesBoard
                    projectId={projectId}
                    chapterId={chapterId}
                    onEntityCreated={loadBibleData}
                    onNotesChanged={() => setNotesVersion(v => v + 1)}
                    onOpenEntity={(id) => { const e = allApprovedEntities.find(x => x.id === id); if (e) { setIsNotesOpen(false); setDetailEntity(e); } }}
                    onJumpToChapter={(id) => { setIsNotesOpen(false); if (id !== chapterId) navigate(`/editor/${projectId}/${id}`); }}
                    onChapterCreated={(id) => {
                      api.get<{ chapters: Chapter[] }>(`/projects/${projectId}/chapters`).then(d => setChapters(d.chapters || [])).catch(() => {});
                      setIsNotesOpen(false);
                      navigate(`/editor/${projectId}/${id}`);
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {isPlotOpen && (
            <PlotPanel
              projectId={projectId!}
              initialLens={plotInitialLens}
              chapters={chapters}
              entities={allApprovedEntities}
              events={entityEvents}
              links={entityLinks}
              threads={plotThreads}
              scanningThreads={scanningThreads}
              onScanThreads={scanThreads}
              onDismissThread={dismissThread}
              onToggleThreadResolved={toggleThreadResolved}
              onAddThread={addThread}
              onEditThread={editThread}
              onSaveChapterPlan={saveChapterPlan}
              onAddChapter={addPlannedChapter}
              onClose={() => setIsPlotOpen(false)}
              onJumpToChapter={(id) => { setIsPlotOpen(false); if (id !== chapterId) navigate(`/editor/${projectId}/${id}`); }}
              onOpenEntity={(name) => {
                const e = allApprovedEntities.find(x => (x.name ?? '').trim().toLowerCase() === name.trim().toLowerCase());
                if (e) { setIsPlotOpen(false); setDetailEntity(e); }
              }}
            />
          )}

          {isReferenceOpen && (
            <div className="flex flex-col h-full w-full">
              {/* Header */}
              <div className="p-5 border-b border-[#1e2d1f]/5 flex justify-between items-center bg-white/40">
                <div className="flex items-center gap-2">
                  <Bookmark size={18} className="text-[#1e2d1f]" />
                  <h2 className="font-serif font-bold text-lg text-[#1e2d1f] uppercase tracking-wider">Справочник</h2>
                </div>
                <button onClick={() => setIsReferenceOpen(false)} className="p-1.5 rounded-md hover:bg-[#1e2d1f]/5 text-[#1e2d1f]/50 transition-colors">
                  <X size={18} />
                </button>
              </div>

              {/* Scope toggle */}
              <div className="px-4 py-3 border-b border-[#1e2d1f]/5 bg-white/20">
                <div className="flex rounded-lg overflow-hidden border border-[#1e2d1f]/10 text-[13px] font-medium">
                  <button
                    onClick={() => setReferenceScope('project')}
                    className={`flex-1 py-1.5 transition-colors ${
                      referenceScope === 'project'
                        ? 'bg-[#1e2d1f] text-white'
                        : 'text-[#1e2d1f]/60 hover:bg-[#1e2d1f]/5'
                    }`}
                  >
                    Проект
                  </button>
                  <button
                    onClick={() => setReferenceScope('chapter')}
                    className={`flex-1 py-1.5 transition-colors ${
                      referenceScope === 'chapter'
                        ? 'bg-[#1e2d1f] text-white'
                        : 'text-[#1e2d1f]/60 hover:bg-[#1e2d1f]/5'
                    }`}
                  >
                    Эта глава
                  </button>
                </div>
              </div>

              {/* Entity sections */}
              <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {referenceScope === 'chapter' ? (
                  chapterLinkedEntities.length === 0 && chapterMentionedEntities.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-[#1e2d1f]/55 text-center">
                      <Bookmark size={32} className="mb-3 opacity-40" />
                      <p className="text-sm font-medium leading-relaxed">
                        Нет привязанных объектов.<br />
                        Попробуйте ИИ-извлечение или напишите больше текста.
                      </p>
                    </div>
                  ) : (
                    <>
                      {chapterLinkedEntities.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1.5 text-[#1e2d1f]/55 font-bold text-[10px] uppercase tracking-widest mb-2.5">
                            <span>Из этой главы</span>
                            <span className="bg-[#1e2d1f]/8 rounded-full px-1.5 py-0.5 text-[10px]">{chapterLinkedEntities.length}</span>
                          </div>
                          <div className="space-y-2">
                            {chapterLinkedEntities.map(entity => (
                              <EntityCard key={entity.id} entity={entity} hasConflict={contradictions.has(entity.id)} />
                            ))}
                          </div>
                        </div>
                      )}
                      {chapterMentionedEntities.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1.5 text-[#1e2d1f]/55 font-bold text-[10px] uppercase tracking-widest mb-2.5">
                            <span>В тексте</span>
                            <span className="bg-[#1e2d1f]/8 rounded-full px-1.5 py-0.5 text-[10px]">{chapterMentionedEntities.length}</span>
                          </div>
                          <div className="space-y-2">
                            {chapterMentionedEntities.map(entity => (
                              <EntityCard key={entity.id} entity={entity} hasConflict={contradictions.has(entity.id)} />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )
                ) : (
                  allApprovedEntities.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-[#1e2d1f]/55 text-center">
                      <Bookmark size={32} className="mb-3 opacity-40" />
                      <p className="text-sm font-medium">
                        Мир пуст — используйте ИИ-извлечение в нижней панели
                      </p>
                    </div>
                  ) : (
                    <>
                      {contradictions.size > 0 && (
                        <div className="flex items-center gap-2 bg-[#F2E9D8] border border-[#91682E]/80 rounded-xl px-3 py-2.5">
                          <AlertTriangle size={14} className="text-[#91682E] flex-shrink-0" />
                          <p className="text-[12px] text-[#91682E] leading-snug">
                            {contradictions.size === 1
                              ? '1 объект с возможным противоречием'
                              : `${contradictions.size} объекта с возможными противоречиями`}
                          </p>
                        </div>
                      )}
                      {ENTITY_SECTIONS.map(({ type, label, icon: Icon }) => {
                        const items = allApprovedEntities.filter(e => e.type === type);
                        if (items.length === 0) return null;
                        return (
                          <div key={type}>
                            <div className="flex items-center gap-2 text-[#1e2d1f]/50 font-bold text-[10px] uppercase tracking-widest mb-2">
                              <Icon size={13} />
                              <span>{label}</span>
                              <span className="bg-[#1e2d1f]/8 rounded-full px-1.5 py-0.5 text-[10px]">{items.length}</span>
                            </div>
                            <div className="space-y-2">
                              {items.map(entity => (
                                <EntityCard key={entity.id} entity={entity} hasConflict={contradictions.has(entity.id)} />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )
                )}
              </div>
            </div>
          )}
          </div>
        </aside>

        {/* Правый спутник «Перо» — память сцены + находки/нестыковки + чат (скрыт в фокусе) */}
        {!isFocusMode && (
          <WorldCompanion
            collapsed={companionCollapsed}
            onToggleCollapse={() => toggleCompanion()}
            scenePlan={chapters.find(c => c.id === chapterId)?.plan ?? null}
            onOpenPlan={() => handleOpenPlot('skeleton')}
            seriesHandoff={seriesHandoff}
            onOpenSeriesWorld={() => projectSeriesId && navigate(`/series/${projectSeriesId}/world`)}
            summaryFindings={suggestions.length}
            summaryContradictions={contradictionIssues.filter(i => i.status !== 'dismissed').length}
            summaryDangling={danglingCount}
            onOpenSummaryLens={openWorldAtLens}
            projectId={projectId}
            chapterId={chapterId}
            sverkaScope={bibleScope}
            onJumpToQuote={(cid, quote) => handleOpenInEditor(cid, quote, quote)}
            onOpenThreads={() => handleOpenPlot('threads')}
            onSverkaChanged={loadBibleData}
            chapterNotes={chapterNotes}
            onOpenNotes={handleOpenNotes}
            freshness={currentChapterFreshness}
            isExtracting={isExtracting}
            onRead={currentChapterFreshness === 'stale' ? handleRecheckChapter : handleExtract}
            sceneEntities={chapterEntitiesByAppearance}
            isServiceChapter={isServiceChapterType(currentChapterType)}
            povCharacter={chapters.find(c => c.id === chapterId)?.povCharacter ?? null}
            chapterSynopsis={chapters.find(c => c.id === chapterId)?.summary ?? null}
            povOptions={[...new Set(allApprovedEntities.filter(e => e.type === 'character').map(e => e.name.trim()))].sort((a, b) => a.localeCompare(b, 'ru'))}
            onSetPov={async (value) => {
              if (!chapterId) return;
              try {
                await api.patch(`/chapters/${chapterId}`, { povCharacter: value });
                setChapters(prev => prev.map(c => c.id === chapterId ? { ...c, povCharacter: value } : c));
              } catch { /* тихо */ }
            }}
            findingsHere={suggestions.filter(s => s.chapterId === chapterId)}
            onApproveFinding={approveSuggestion}
            onRejectFinding={rejectSuggestion}
            contradictionIds={contradictions}
            onOpenEntity={setDetailEntity}
            onOpenWorld={() => { handleBibleMenuClick('characters'); setIsCompanionCollapsed(true); }}
            mode={companionMode}
            onModeChange={setCompanionMode}
            chat={
              <CoauthorPanel
                chatMessages={chatMessages}
                isHistoryLoaded={isHistoryLoaded}
                chatInput={chatInput}
                onChatInputChange={setChatInput}
                isAiLoading={isAiLoading}
                isCheckingConsistency={isCheckingConsistency}
                isExtracting={isExtracting}
                chatEndRef={chatEndRef}
                selectedText={selectedText}
                pinnedSelection={pinnedSelection}
                onPinSelection={() => setPinnedSelection(selectedText.trim())}
                onClearPinnedSelection={() => setPinnedSelection('')}
                onSendMessage={handleSendMessage}
                onSendPrompt={handleSendPrompt}
                onCheckConsistency={handleCheckConsistency}
                onExtractBible={async () => {
                  // Не жжём агента, если глава не менялась с последнего чтения:
                  // fresh → просто открываем мир главы; stale → перечитываем; unknown → первое чтение.
                  if (currentChapterFreshness === 'fresh') {
                    if (chapterId) setBibleScope('chapter');
                    handleBibleMenuClick('characters');
                    return;
                  }
                  if (currentChapterFreshness === 'stale') await handleRecheckChapter();
                  else await handleExtract();
                  setIsBibleOpen(true);
                  setActiveBibleTab('inbox');
                }}
                chapterCount={chapters.length}
                entityCount={allApprovedEntities.length}
                extractFreshness={currentChapterFreshness}
                scope={chatScope}
                onScopeChange={setChatScope}
                inSeries={!!projectSeriesId}
                entities={allApprovedEntities}
                onOpenEntity={setDetailEntity}
                onJumpToChapter={(n) => {
                  const byTitle = chapters.find(c => new RegExp(`(^|\\s)глава\\s*${n}(\\b|\\D|$)`, 'i').test(c.title || ''));
                  const nonService = chapters.filter(c => !isServiceChapterType(c.chapterType));
                  const target = byTitle ?? nonService[n - 1] ?? chapters[n - 1];
                  if (target && target.id !== chapterId) navigate(`/editor/${projectId}/${target.id}`);
                }}
                onClose={() => setCompanionMode('scene')}
              />
            }
          />
        )}
      </div>

      <CommandPalette
        open={isCommandOpen}
        onClose={() => setIsCommandOpen(false)}
        commands={commands}
      />

      {editor && (
        <SelectionBar
          editor={editor}
          projectId={projectId}
          entities={allApprovedEntities}
          onShowInWorld={(entity) => setDetailEntity(entity)}
          onWhereUsed={(entity) => {
            if (!isRevisionOpen) handleToggleRevision();
            handleTrace(entity.name);
          }}
          onEntityCreated={() => loadBibleData()}
          onAskPero={handleAskPero}
          onFindSimilar={projectId ? handleFindSimilar : undefined}
          onComment={projectId ? handleCreateComment : undefined}
        />
      )}

      {/* Превью нестыковки по наведению — peek без клика (как тултип проверки орфографии).
          Не перехватывает мышь; клик по подчёркиванию открывает полный поповер с действиями. */}
      {/* Плашки нестыковки поверх текста убраны (ховер-подсказка + поповер). Маркер = подчёркивание; находка = правый рельс. */}

      {editor && gutterItems.length > 0 && (
        <CommentsGutter
          editor={editor}
          items={gutterItems}
          activeId={activeCommentId}
          onActivate={setActiveCommentId}
          onSave={handleSaveComment}
          onResolve={handleResolveComment}
          onDelete={handleDeleteComment}
          onToNote={handleCommentToNote}
          onReply={handleReplyComment}
          onDismissPero={dismissContradictionIssue}
          onOpenEntity={(name) => {
            const e = allApprovedEntities.find(x => x.name.trim().toLowerCase() === name.trim().toLowerCase());
            if (e) { setIsBibleOpen(false); setDetailEntity(e); }
          }}
        />
      )}

      {commentPopover && (
        <CommentPopover
          comment={commentPopover.comment}
          x={commentPopover.x}
          y={commentPopover.y}
          startEditing={commentPopover.startEditing}
          onSave={(body) => handleSaveComment(commentPopover.comment.id, body)}
          onResolve={() => handleResolveComment(commentPopover.comment.id)}
          onDelete={() => handleDeleteComment(commentPopover.comment.id)}
          onToNote={() => handleCommentToNote(commentPopover.comment.id)}
          onClose={() => setCommentPopover(null)}
        />
      )}

      <FindReplacePopup
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        editor={editor}
      />

      {isGlobalSearchOpen && projectId && (
        <SearchPanel
          projectId={projectId}
          onClose={() => setIsGlobalSearchOpen(false)}
        />
      )}

      {isExportOpen && projectId && (
        <ExportPanel
          projectId={projectId}
          projectTitle={projectTitle || 'Проект'}
          onClose={() => setIsExportOpen(false)}
        />
      )}

    </>
  );
}
