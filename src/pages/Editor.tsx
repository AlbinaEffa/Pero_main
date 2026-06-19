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
import { useEmbedding } from '../hooks/useEmbedding';
import { useWritingStats } from '../hooks/useWritingStats';
import { useAiChat } from '../hooks/useAiChat';
import { useBibleExtraction } from '../hooks/useBibleExtraction';
import { useRevision } from '../hooks/useRevision';

import { ChapterSidebar } from '../components/editor/ChapterSidebar';
import { EditorCanvas } from '../components/editor/EditorCanvas';
import { BottomToolbar } from '../components/editor/BottomToolbar';
import { WorldCompanion } from '../components/editor/WorldCompanion';
import { CommandPalette, Command } from '../components/editor/CommandPalette';
import { EntitySelectionMenu } from '../components/editor/EntitySelectionMenu';
import { ContradictionPopover } from '../components/editor/ContradictionPopover';
import { StoryBiblePanel } from '../components/editor/StoryBiblePanel';
import { CoauthorPanel } from '../components/editor/CoauthorPanel';
import { RevisionPanel } from '../components/editor/RevisionPanel';
import { ProjectSyncPanel } from '../components/editor/ProjectSyncPanel';
import { WritingStatsPanel } from '../components/editor/WritingStatsPanel';
import { FindReplacePopup } from '../components/FindReplacePopup';
import { SearchPanel } from '../components/editor/SearchPanel';
import { SearchHighlightExtension, searchHighlightKey } from '../components/editor/searchHighlightExtension';
import { ContradictionHighlightExtension, contradictionHighlightKey } from '../components/editor/contradictionHighlightExtension';
import { DictationGhostExtension, dictationGhostKey } from '../components/editor/DictationGhostExtension';
import { ToolbarSelectionExtension } from '../components/editor/toolbarSelectionExtension';
import { TextAlignExtension } from '../components/editor/TextAlignExtension';
import { SuperscriptExtension } from '../components/editor/SuperscriptExtension';
import { SubscriptExtension } from '../components/editor/SubscriptExtension';
import { HighlightMarkExtension } from '../components/editor/HighlightMarkExtension';
import { SceneBreakExtension } from '../components/editor/SceneBreakExtension';
import { ExportPanel } from '../components/ExportPanel';
import Settings from './Settings';

import { Chapter, Entity, EntityLink, EntityEvent } from '../components/editor/types';
import { AhaCelebration } from '../components/AhaCelebration';
import { Users, MapPin, Box, Scale, Bookmark, X, AlertTriangle, ChevronUp, ChevronDown,
  Eye, Bell, BookOpen, Feather, Telescope, BarChart2, Search, FolderSearch, Download, Maximize2, Minimize2, Settings as SettingsIcon,
  ChevronLeft, ChevronRight } from 'lucide-react';

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
 * Упоминание сущности в тексте с учётом многословных имён («Ашер Волков», «Тётя Вера»):
 * совпадение по любому значимому токену имени (≥ 3 букв, по стемме). Старый
 * russianStemMatch брал имя целиком и потому не ловил персонажей из двух слов.
 */
function entityMentionedInText(entityName: string, text: string): boolean {
  const tokens = entityName.toLowerCase().split(/[^а-яёa-z0-9'-]+/i).filter(t => t.length >= 3);
  if (tokens.length === 0) return russianStemMatch(entityName, text);
  const words = text.toLowerCase().split(/[^а-яёa-z0-9'-]+/i).filter(Boolean);
  return tokens.some(tok => {
    const stem = tok.length <= 4 ? tok : tok.slice(0, tok.length - 1);
    return words.some(w => w.startsWith(stem));
  });
}

/**
 * «Кадр» — текущая сцена вокруг курсора: окно из соседних абзацев, не пересекающее
 * разделители сцены (***). Нужен для памяти сцены в спутнике «Перо»: показать, кто
 * сейчас в кадре, а не во всей главе. Возвращает диапазон позиций ProseMirror.
 */
function computeSceneRange(editor: TiptapEditor, pos: number): { from: number; to: number } {
  const doc = editor.state.doc;
  const blocks: { start: number; end: number; isBreak: boolean }[] = [];
  doc.forEach((node, offset) => {
    blocks.push({ start: offset, end: offset + node.nodeSize, isBreak: node.type.name === 'sceneBreak' });
  });
  if (blocks.length === 0) return { from: 0, to: doc.content.size };
  let idx = blocks.findIndex(b => pos >= b.start && pos < b.end);
  if (idx === -1) idx = blocks.length - 1;
  const WINDOW = 4; // ± абзацев вокруг курсора
  let lo = idx, hi = idx;
  for (let i = idx - 1, c = 0; i >= 0 && c < WINDOW; i--, c++) {
    if (blocks[i].isBreak) break;
    lo = i;
  }
  for (let i = idx + 1, c = 0; i < blocks.length && c < WINDOW; i++, c++) {
    if (blocks[i].isBreak) break;
    hi = i;
  }
  return { from: blocks[lo].start, to: blocks[hi].end };
}

function splitChapterTitle(title: string, fallbackOrder?: number): { prefix: string; suffix: string } {
  const trimmed = title.trim();
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
    editor.commands.setTextSelection(result);
    editor.commands.scrollIntoView();
  });

  if (result) return result;

  // Pass 2: fallback — plain query search
  doc.descendants((node, pos) => {
    if (result || !node.isText || !node.text) return;
    const idx = node.text.toLowerCase().indexOf(qLower);
    if (idx === -1 || idx + query.length > node.text.length) return;
    result = { from: pos + idx, to: pos + idx + query.length };
    editor.commands.setTextSelection(result);
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
  const [bibleEntities, setBibleEntities] = useState<Entity[]>([]);
  const [entityLinks, setEntityLinks] = useState<EntityLink[]>([]);
  const [entityEvents, setEntityEvents] = useState<EntityEvent[]>([]);
  const [referenceScope, setReferenceScope] = useState<'project' | 'chapter'>('project');

  const [isBibleOpen, setIsBibleOpen] = useState(false);
  /** Шторка списка глав на узких экранах (< lg); на широких сайдбар всегда в потоке. */
  const [isChaptersDrawerOpen, setIsChaptersDrawerOpen] = useState(false);
  /** Свёрнут ли сайдбар глав на десктопе (≥ lg). */
  const [isChaptersCollapsed, setIsChaptersCollapsed] = useState(false);
  const [isReferenceOpen, setIsReferenceOpen] = useState(false);
  const [isBibleMenuOpen, setIsBibleMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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
  const [companionMode, setCompanionMode] = useState<'scene' | 'chat'>('scene');
  const [contradictionPopover, setContradictionPopover] = useState<{ name: string; x: number; y: number; issue?: string; issueChapterId?: string | null } | null>(null);
  // Превью нестыковки по наведению (как у проверки орфографии): peek без клика.
  const [contradictionHover, setContradictionHover] = useState<{ issue?: string; name: string; x: number; y: number } | null>(null);
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
  const { scheduleEmbed } = useEmbedding(projectId, chapterId);
  const [selectedText, setSelectedText] = useState('');
  // «Кадр» вокруг курсора — диапазон текущей сцены (память сцены в спутнике «Перо»).
  const [sceneRange, setSceneRange] = useState<{ from: number; to: number } | null>(null);
  const sceneRangeRef = useRef<{ from: number; to: number } | null>(null);
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
      scheduleEmbed(editor.getHTML());
      // Any content edit makes existing match positions stale — dismiss the nav bar.
      // setMatchNav is a stable React setter, so it doesn't need to be in deps.
      setMatchNav(null);
      // Record word count delta for writing statistics (localStorage, very fast)
      if (chapterId) {
        const words = editor.storage.characterCount?.words?.() ?? 0;
        writingStats.recordChapterWords(chapterId, words);
      }
    },
    [autosaveUpdate, scheduleEmbed, chapterId, writingStats.recordChapterWords]
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
      // Обновляем «кадр» (сцену вокруг курсора), но только когда он реально сменился —
      // чтобы не пересчитывать память сцены на каждое движение каретки внутри сцены.
      if (!ed.isDestroyed) {
        const next = computeSceneRange(ed, from);
        const prev = sceneRangeRef.current;
        if (!prev || prev.from !== next.from || prev.to !== next.to) {
          sceneRangeRef.current = next;
          setSceneRange(next);
        }
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
  } = useAiChat({ projectId, chapterId, getContent });

  const {
    isExtracting, suggestions, approvedEntities,
    updateSuggestions,
    handleExtract: rawHandleExtract,
    recheckChapter: rawRecheckChapter,
    recheckBatch,
    approveSuggestion, rejectSuggestion,
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
  const loadContradictions = useCallback(() => {
    if (!projectId) return;
    api.get<{ issues: ScanIssue[] }>(`/bible/${projectId}/contradictions`)
      .then(d => setContradictionIssues((d.issues ?? []).filter(i => i.status === 'open')))
      .catch(() => { /* отчёта ещё нет — подсвечиваем по именам (эвристика) */ });
  }, [projectId]);
  useEffect(() => { loadContradictions(); }, [loadContradictions]);

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
    loadBibleData();
  }, [rawHandleExtract, chapterId, loadBibleData]);

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
    loadBibleData();
  }, [rawRecheckChapter, chapterId, loadBibleData]);

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
      .then(data => { if (data.project?.title) setProjectTitle(data.project.title); })
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
    if (new URLSearchParams(location.search).get('view') === 'world') {
      worldOpenedRef.current = true;
      handleBibleMenuClick('characters');
      navigate(location.pathname, { replace: true }); // убрать query, чтобы не повторялось
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
              // Compute all occurrences and activate the navigation bar.
              const allMatches = findAllMatches(editor, hl.query);
              const idx = allMatches.findIndex(m => m.from === match.from);
              setMatchNav({
                query:      hl.query,
                matches:    allMatches,
                currentIdx: idx >= 0 ? idx : 0,
              });
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
        // Compute all occurrences and activate the navigation bar.
        const allMatches = findAllMatches(editor, query);
        const idx = allMatches.findIndex(m => m.from === match.from);
        setMatchNav({
          query,
          matches:    allMatches,
          currentIdx: idx >= 0 ? idx : 0,
        });
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

  // Закрыть шторку глав после перехода к другой главе (узкие экраны)
  useEffect(() => { setIsChaptersDrawerOpen(false); }, [chapterId]);

  const isAnySidePanelOpen = isBibleOpen || isCoauthoring || isReferenceOpen
    || isRevisionOpen || isSyncOpen || isStatsOpen;

  /** Закрыть все правые панели (тап по затемнению на телефонах). */
  const closeAllSidePanels = useCallback(() => {
    setIsBibleOpen(false);
    setIsCoauthoring(false);
    setIsReferenceOpen(false);
    setIsRevisionOpen(false);
    setIsSyncOpen(false);
    setIsStatsOpen(false);
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
        setIsCompanionCollapsed(v => !v);
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
    if (!chapter.lastExtractedAt) return 'unknown';
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

  // Chapter scope tier 2: entities matched in text by stem (not already in tier 1)
  const chapterMentionedEntities = useMemo(() => {
    const linkedIds = new Set(chapterLinkedEntities.map(e => e.id));
    const text = editor?.getText() ?? '';
    return allApprovedEntities.filter(e => !linkedIds.has(e.id) && entityMentionedInText(e.name, text));
  }, [allApprovedEntities, chapterLinkedEntities, editor]);

  // «В кадре»: сущности, упомянутые в текущей сцене вокруг курсора (память сцены).
  // Пересчитывается только при смене кадра — sceneRange меняется лишь между сценами.
  const inSceneIds = useMemo(() => {
    if (!editor || !sceneRange) return new Set<string>();
    const text = editor.state.doc.textBetween(sceneRange.from, sceneRange.to, ' ');
    const ids = new Set<string>();
    for (const e of allApprovedEntities) {
      if (entityMentionedInText(e.name, text)) ids.add(e.id);
    }
    return ids;
  }, [editor, sceneRange, allApprovedEntities]);

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

    const { prefix } = splitChapterTitle(chapter.title, chapter.order);
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
    if (isDictating) toggleListening();
    setIsReading(false);
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
    setChapterTitleDraft(splitChapterTitle(chapter.title, chapter.order).suffix);
    setChapterTitleDraftChapterId(chapter.id);
  }, [chapterId, chapters, chapterTitleDraftChapterId]);

  const currentChapterPrefix = (() => {
    const chapter = currentChapterRef.current;
    if (!chapter) return 'Глава';
    return splitChapterTitle(chapter.title, chapter.order).prefix;
  })();
  const currentChapterTitleSuffix = (() => {
    const chapter = currentChapterRef.current;
    if (!chapter) return '';
    if (chapter.id === chapterTitleDraftChapterId) {
      return chapterTitleDraft;
    }
    return splitChapterTitle(chapter.title, chapter.order).suffix;
  })();

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
  ], [currentChapterFreshness, isCoauthoring, isReferenceOpen, isRevisionOpen, isStatsOpen, isFocusMode,
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
          <div className={`flex h-full max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:transition-transform max-lg:duration-300 max-lg:ease-in-out ${
            isChaptersDrawerOpen ? 'max-lg:translate-x-0 max-lg:shadow-2xl' : 'max-lg:-translate-x-full'
          } ${isChaptersCollapsed ? 'lg:hidden' : ''}`}>
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
            bibleBadge={
              suggestions.length
              + updateSuggestions.filter(u => u.status === 'pending').length
              + contradictions.size
            }
            onCollapse={() => setIsChaptersCollapsed(true)}
          />
          </div>
        )}

        <div
          className="flex-1 min-w-0 flex flex-col relative"
          onClick={(e) => {
            const mark = (e.target as HTMLElement).closest('.contradiction-mark');
            if (mark) {
              const r = mark.getBoundingClientRect();
              const text = (mark.textContent || '').trim();
              const hit = contradictionIssues.find(i => i.quote && i.quote.trim().toLowerCase() === text.toLowerCase());
              setContradictionHover(null);
              setContradictionPopover({
                name: hit?.entityName || text,
                x: r.left, y: r.bottom,
                issue: hit?.issue,
                issueChapterId: hit?.chapterId ?? null,
              });
            }
          }}
          onMouseOver={(e) => {
            const mark = (e.target as HTMLElement).closest('.contradiction-mark');
            if (!mark || contradictionPopover) return;
            const r = mark.getBoundingClientRect();
            const text = (mark.textContent || '').trim();
            const hit = contradictionIssues.find(i => i.quote && i.quote.trim().toLowerCase() === text.toLowerCase());
            setContradictionHover({ issue: hit?.issue, name: hit?.entityName || text, x: r.left + r.width / 2, y: r.top });
          }}
          onMouseOut={(e) => {
            const mark = (e.target as HTMLElement).closest('.contradiction-mark');
            const to = (e.relatedTarget as HTMLElement | null)?.closest?.('.contradiction-mark');
            if (mark && !to) setContradictionHover(null);
          }}
        >
          {/* №3 — навигация по главам: пред/след без захода в список */}
          {!isFocusMode && (() => {
            const sorted = [...chapters].sort((a, b) => a.order - b.order);
            const idx = sorted.findIndex(c => c.id === chapterId);
            const prev = idx > 0 ? sorted[idx - 1] : null;
            const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;
            const go = (id: string) => navigate(`/editor/${projectId}/${id}`);
            return (
              <>
                {prev && (
                  <button onClick={() => go(prev.id)} title={`← ${prev.title}`} aria-label="Предыдущая глава"
                    className="absolute left-1 top-1/2 -translate-y-1/2 z-30 w-8 h-8 rounded-full flex items-center justify-center text-[#1e2d1f]/30 hover:text-[#1e2d1f] hover:bg-white/80 transition-colors">
                    <ChevronLeft size={20} />
                  </button>
                )}
                {next && (
                  <button onClick={() => go(next.id)} title={`${next.title} →`} aria-label="Следующая глава"
                    className="absolute right-1 top-1/2 -translate-y-1/2 z-30 w-8 h-8 rounded-full flex items-center justify-center text-[#1e2d1f]/30 hover:text-[#1e2d1f] hover:bg-white/80 transition-colors">
                    <ChevronRight size={20} />
                  </button>
                )}
              </>
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
            indentParagraphs={indentParagraphs}
            onIndentParagraphsChange={setIndentParagraphs}
            editorFont={editorFont}
            onEditorFontChange={handleEditorFontChange}
            isFocusMode={isFocusMode}
            isDictating={isDictating || isDictationProcessing}
            interimTranscript={
              isDictationProcessing ? 'Обрабатываю диктовку…'
              : (isDictating && !interimTranscript ? 'Слушаю…' : '')
            }
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenSearch={() => setIsSearchOpen(true)}
            onOpenExport={() => setIsExportOpen(true)}
            onOpenChapters={() => {
              // На десктопе (≥ lg) разворачиваем свёрнутый сайдбар; на узких — шторку
              if (window.matchMedia('(min-width: 1024px)').matches) setIsChaptersCollapsed(false);
              else setIsChaptersDrawerOpen(true);
            }}
            isChaptersCollapsed={isChaptersCollapsed}
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
            isCompanionOpen={!isCompanionCollapsed}
            onToggleCompanion={() => setIsCompanionCollapsed(v => !v)}
            companionCount={
              suggestions.filter(s => s.chapterId === chapterId).length
              + [...chapterLinkedEntities, ...chapterMentionedEntities].filter(e => contradictions.has(e.id)).length
            }
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
              : isBibleOpen
              ? `z-40 top-16 bottom-24 max-md:top-12 max-md:bottom-24 left-[232px] max-lg:left-3 ${isCompanionCollapsed ? 'right-4' : 'md:right-[300px] right-4'} rounded-2xl border opacity-100 translate-x-0 pointer-events-auto`
              : isInspectorExpanded
              ? `z-40 top-16 bottom-6 max-md:top-12 max-md:bottom-3 right-[68px] max-md:right-3 left-6 max-md:left-3 ${isChaptersCollapsed ? '' : 'lg:left-[244px]'} rounded-2xl border opacity-100 translate-x-0 pointer-events-auto`
              : 'z-40 top-14 bottom-0 right-12 max-md:right-0 max-md:top-0 w-[min(92vw,360px)] border-l border-t max-md:border-t-0 opacity-100 translate-x-0 pointer-events-auto'
          }`}
        >
          {/* Развернуть / свернуть — рядом с крестиком (для узких панелей; «Мир» и так на весь экран) */}
          {(!isFocusMode && isAnySidePanelOpen && !isBibleOpen) && (
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
              onAcceptUpdate={acceptUpdate}
              onRejectUpdate={rejectUpdate}
              onDismissUpdate={dismissUpdate}
              onBulkDismissChapter={bulkDismissChapter}
              onBulkRejectChapter={bulkRejectChapter}
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
              onOpenInEditor={handleOpenInEditor}
              contradictions={contradictions}
              currentChapterId={chapterId}
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
            collapsed={isCompanionCollapsed}
            onToggleCollapse={() => setIsCompanionCollapsed(v => !v)}
            freshness={currentChapterFreshness}
            isExtracting={isExtracting}
            onRead={currentChapterFreshness === 'stale' ? handleRecheckChapter : handleExtract}
            sceneEntities={[...chapterLinkedEntities, ...chapterMentionedEntities]}
            inSceneIds={inSceneIds}
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
            onOpenEntity={() => { handleBibleMenuClick('characters'); setIsCompanionCollapsed(true); }}
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
                onSendMessage={handleSendMessage}
                onSendPrompt={handleSendPrompt}
                onCheckConsistency={handleCheckConsistency}
                onExtractBible={async () => {
                  await handleExtract();
                  setIsBibleOpen(true);
                  setActiveBibleTab('inbox');
                }}
                onInsertText={handleInsertText}
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

      <EntitySelectionMenu
        editor={editor}
        entities={allApprovedEntities}
        onShowInWorld={(entity) => {
          const tab = { character: 'characters', location: 'locations', item: 'items', rule: 'rules' }[entity.type] ?? 'characters';
          handleBibleMenuClick(tab);
        }}
        onWhereUsed={(entity) => {
          if (!isRevisionOpen) handleToggleRevision();
          handleTrace(entity.name);
        }}
      />

      {/* Превью нестыковки по наведению — peek без клика (как тултип проверки орфографии).
          Не перехватывает мышь; клик по подчёркиванию открывает полный поповер с действиями. */}
      {contradictionHover && !contradictionPopover && (
        <div
          className="fixed z-[120] -translate-x-1/2 -translate-y-full pointer-events-none"
          style={{ left: contradictionHover.x, top: contradictionHover.y - 8 }}
        >
          <div className="max-w-[280px] rounded-xl bg-[#1e2d1f] text-[#f5f0e8] shadow-xl px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#e0a89e] mb-1">
              <AlertTriangle size={11} /> Возможная нестыковка
            </div>
            <div className="text-[12px] leading-snug">
              {contradictionHover.issue || `«${contradictionHover.name}» — Перо нашло расхождение.`}
            </div>
            <div className="text-[10.5px] text-[#f5f0e8]/55 mt-1.5">Нажмите, чтобы разрешить →</div>
          </div>
        </div>
      )}

      {contradictionPopover && (
        <ContradictionPopover
          name={contradictionPopover.name}
          group={allApprovedEntities.filter(e => e.name.trim().toLowerCase() === contradictionPopover.name.toLowerCase())}
          issueText={contradictionPopover.issue}
          issueChapterId={contradictionPopover.issueChapterId}
          chapters={chapters.map(c => ({ id: c.id, title: c.title, order: c.order }))}
          x={contradictionPopover.x}
          y={contradictionPopover.y}
          onClose={() => setContradictionPopover(null)}
          onJump={(chapterId, name) => { setContradictionPopover(null); handleOpenInEditor(chapterId, name, name); }}
          onOpenWorld={() => { setContradictionPopover(null); handleBibleMenuClick('characters'); }}
          onDismiss={() => { dismissContradiction(contradictionPopover.name); setContradictionPopover(null); }}
          onMerge={async () => {
            const name = contradictionPopover.name;
            setContradictionPopover(null);
            if (!projectId) return;
            try {
              await api.post(`/bible/${projectId}/merge`, { name });
              const data = await api.get<{ entities: Entity[]; links?: EntityLink[]; events?: EntityEvent[] }>(`/bible/${projectId}`);
              setBibleEntities((data.entities ?? []).filter(e => e.status === 'approved'));
              setEntityLinks(data.links ?? []);
              setEntityEvents(data.events ?? []);
            } catch { /* ошибка слияния — тихо */ }
          }}
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

      {isSettingsOpen && (
        <div 
          className="fixed inset-0 z-[100] bg-[#1e2d1f]/20 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
          onClick={() => setIsSettingsOpen(false)}
        >
          <div 
            className="bg-[#f5f0e8] rounded-3xl shadow-2xl w-full max-w-5xl max-h-full overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <Settings
              onClose={() => setIsSettingsOpen(false)}
              showWordCount={showWordCount}
              setShowWordCount={setShowWordCount}
              indentParagraphs={indentParagraphs}
              setIndentParagraphs={setIndentParagraphs}
            />
          </div>
        </div>
      )}
    </>
  );
}
