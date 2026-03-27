import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useEditor, type Editor as TiptapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import UnderlineExtension from '@tiptap/extension-underline';
import CharacterCount from '@tiptap/extension-character-count';

import { api } from '../services/api';
import { track } from '../services/analytics';
import { useDictation } from '../hooks/useDictation';
import { useAutosave } from '../hooks/useAutosave';
import { useEmbedding } from '../hooks/useEmbedding';
import { useAiChat } from '../hooks/useAiChat';
import { useBibleExtraction } from '../hooks/useBibleExtraction';
import { useRevision } from '../hooks/useRevision';

import { ChapterSidebar } from '../components/editor/ChapterSidebar';
import { EditorCanvas } from '../components/editor/EditorCanvas';
import { BottomToolbar } from '../components/editor/BottomToolbar';
import { StoryBiblePanel } from '../components/editor/StoryBiblePanel';
import { CoauthorPanel } from '../components/editor/CoauthorPanel';
import { RevisionPanel } from '../components/editor/RevisionPanel';
import { ProjectSyncPanel } from '../components/editor/ProjectSyncPanel';
import { FindReplacePopup } from '../components/FindReplacePopup';
import { SearchPanel } from '../components/editor/SearchPanel';
import { SearchHighlightExtension, searchHighlightKey } from '../components/editor/searchHighlightExtension';
import { ExportPanel } from '../components/ExportPanel';
import Settings from './Settings';

import { Chapter, Entity } from '../components/editor/types';
import { Users, MapPin, Box, Scale, Bookmark, X, AlertTriangle, ChevronUp, ChevronDown } from 'lucide-react';

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

const ENTITY_SECTIONS = [
  { type: 'character', label: 'Персонажи',    icon: Users  },
  { type: 'location',  label: 'Локации',      icon: MapPin },
  { type: 'item',      label: 'Предметы',     icon: Box    },
  { type: 'rule',      label: 'Правила мира', icon: Scale  },
] as const;

function EntityCard({ entity, hasConflict }: { entity: Entity; hasConflict: boolean }) {
  return (
    <div className={`rounded-xl p-3 shadow-sm border transition-colors cursor-default ${
      hasConflict
        ? 'bg-amber-50/80 border-amber-200/60 hover:bg-amber-50'
        : 'bg-white/60 border-[#1e2d1f]/5 hover:bg-white'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-bold text-[15px] text-[#1e2d1f] truncate leading-snug">{entity.name}</h4>
        {hasConflict && (
          <span title="Возможное противоречие с другой версией этого объекта">
            <AlertTriangle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
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

  const { isListening, isSupported, interimTranscript, toggleListening } = useDictation({
    language: 'ru-RU',
    onResult: (text: string, isFinal: boolean) => {
      if (isFinal && editor) {
        editor.chain().focus().insertContent(text + ' ').run();
      }
    },
  });
  const isDictating = isListening;

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [isLoadingChapters, setIsLoadingChapters] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [bibleEntities, setBibleEntities] = useState<Entity[]>([]);
  const [referenceScope, setReferenceScope] = useState<'project' | 'chapter'>('project');

  const [isBibleOpen, setIsBibleOpen] = useState(false);
  const [isReferenceOpen, setIsReferenceOpen] = useState(false);
  const [isBibleMenuOpen, setIsBibleMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isCoauthoring, setIsCoauthoring] = useState(false);
  const [isRevisionOpen, setIsRevisionOpen] = useState(false);
  const [isSyncOpen, setIsSyncOpen] = useState(false);
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

  const { isSaving, lastSavedAt, saveError, onUpdate: autosaveUpdate, forceSave } = useAutosave(chapterId);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const { scheduleEmbed } = useEmbedding(projectId, chapterId);
  const [selectedText, setSelectedText] = useState('');

  // Combined update handler: autosave (1s debounce) + background embedding (45s debounce)
  const onUpdate = useCallback(
    ({ editor }: { editor: import('@tiptap/react').Editor }) => {
      autosaveUpdate({ editor });
      scheduleEmbed(editor.getHTML());
      // Any content edit makes existing match positions stale — dismiss the nav bar.
      // setMatchNav is a stable React setter, so it doesn't need to be in deps.
      setMatchNav(null);
    },
    [autosaveUpdate, scheduleEmbed]
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      UnderlineExtension,
      CharacterCount,
      Placeholder.configure({ placeholder: 'Напишите свою историю...' }),
      SearchHighlightExtension,
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
    },
  });

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
    approveSuggestion, rejectSuggestion,
    loadUpdateSuggestions,
    acceptUpdate, rejectUpdate, dismissUpdate,
    bulkDismissChapter, bulkRejectChapter,
  } = useBibleExtraction(projectId, chapterId, getContent);

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
  }, [rawHandleExtract, chapterId]);

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
  }, [rawRecheckChapter, chapterId]);

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
            navigate(`/editor/${projectId}/${loaded[0].id}`, { replace: true });
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
      navigate(`/editor/${projectId}/${chapters[0].id}`, { replace: true });
    }
  }, [chapterId, chapters]);

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

  // Load approved entities for the reference panel
  useEffect(() => {
    if (!projectId) return;
    api.get<{ entities: Entity[] }>(`/bible/${projectId}`)
      .then(data => {
        setBibleEntities((data.entities ?? []).filter(e => e.status === 'approved'));
      })
      .catch(e => console.error('Failed to load bible entities:', e));
  }, [projectId]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const isMac = /mac/i.test(navigator.platform);
    const handler = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;

      // Escape — close topmost open panel (in priority order)
      if (e.key === 'Escape') {
        if (isGlobalSearchOpen) { setIsGlobalSearchOpen(false); return; }
        if (isExportOpen)    { setIsExportOpen(false);    return; }
        if (isSettingsOpen)  { setIsSettingsOpen(false);  return; }
        if (isCoauthoring)   { setIsCoauthoring(false);   return; }
        if (isBibleOpen)     { setIsBibleOpen(false);     return; }
        if (isRevisionOpen)  { setIsRevisionOpen(false);  return; }
        if (isReferenceOpen) { setIsReferenceOpen(false); return; }
        if (isSearchOpen)    { setIsSearchOpen(false);    return; }
        if (isBibleMenuOpen) { setIsBibleMenuOpen(false); return; }
      }

      // Cmd/Ctrl+S — force-save immediately
      if (mod && e.key === 's') {
        e.preventDefault();
        if (editor) forceSave(editor.getHTML());
      }

      // Cmd/Ctrl+K — open global project search
      if (mod && e.key === 'k') {
        e.preventDefault();
        setIsGlobalSearchOpen(true);
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
    isGlobalSearchOpen,
    isExportOpen, isSettingsOpen, isCoauthoring, isBibleOpen,
    isRevisionOpen, isReferenceOpen, isSearchOpen, isBibleMenuOpen,
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
    return allApprovedEntities.filter(e => !linkedIds.has(e.id) && russianStemMatch(e.name, text));
  }, [allApprovedEntities, chapterLinkedEntities, editor]);

  // Contradiction detection: same name (case-insensitive) with differing descriptions
  const contradictions = useMemo(() => {
    const nameGroups = new Map<string, Entity[]>();
    allApprovedEntities.forEach(e => {
      const key = e.name.toLowerCase().trim();
      if (!nameGroups.has(key)) nameGroups.set(key, []);
      nameGroups.get(key)!.push(e);
    });
    const flagged = new Set<string>();
    nameGroups.forEach(group => {
      if (group.length < 2) return;
      const uniqueDescs = new Set(
        group.map(e => e.description?.trim().toLowerCase()).filter(Boolean)
      );
      if (uniqueDescs.size > 1) group.forEach(e => flagged.add(e.id));
    });
    return flagged;
  }, [allApprovedEntities]);

  const handleCreateChapter = async () => {
    if (!projectId) return;
    try {
      const data = await api.post<{ chapter: Chapter }>(
        `/projects/${projectId}/chapters`,
        { title: `Глава ${chapters.length + 1}` }
      );
      setChapters(prev => [...prev, data.chapter]);
      navigate(`/editor/${projectId}/${data.chapter.id}`);
    } catch (e) {
      console.error('Failed to create chapter:', e);
    }
  };

  const handleRenameChapter = async (id: string, title: string) => {
    await api.patch(`/chapters/${id}`, { title });
    setChapters(prev => prev.map(c => c.id === id ? { ...c, title } : c));
  };

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
    const next = !isCoauthoring;
    setIsCoauthoring(next);
    if (next) { setIsBibleOpen(false); setIsReferenceOpen(false); setIsRevisionOpen(false); setIsSyncOpen(false); }
  };

  const handleToggleRevision = () => {
    const next = !isRevisionOpen;
    setIsRevisionOpen(next);
    if (next) { setIsBibleOpen(false); setIsCoauthoring(false); setIsReferenceOpen(false); setIsSyncOpen(false); }
  };

  const handleToggleSync = () => {
    const next = !isSyncOpen;
    setIsSyncOpen(next);
    if (next) { setIsBibleOpen(false); setIsCoauthoring(false); setIsReferenceOpen(false); setIsRevisionOpen(false); }
  };

  /** Sequentially recheck every stale chapter via the bible/recheck API. */
  const handleRecheckAllStale = async () => {
    if (isRecheckingAll) return;
    setIsRecheckingAll(true);
    const stale = chapters.filter(ch => {
      if (!ch.lastExtractedAt) return false; // unknown, not stale
      return new Date(ch.updatedAt).getTime() > new Date(ch.lastExtractedAt).getTime();
    });
    for (const ch of stale) {
      try {
        await api.post(`/bible/recheck/chapter/${ch.id}`, {});
        setChapters(prev => prev.map(c =>
          c.id === ch.id ? { ...c, lastExtractedAt: new Date().toISOString() } : c
        ));
      } catch (e) {
        console.error(`Recheck failed for chapter ${ch.id}:`, e);
      }
    }
    setIsRecheckingAll(false);
  };

  const handleBibleMenuClick = (tabId: string) => {
    setActiveBibleTab(tabId);
    setIsBibleOpen(true);
    setIsCoauthoring(false);
    setIsReferenceOpen(false);
    setIsRevisionOpen(false);
    setIsSyncOpen(false);
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
      if (isDictating) toggleListening();
      setIsReading(false);
    }
  };

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
      `}</style>

      <div className="flex h-screen w-full bg-[#f5f0e8] overflow-hidden font-sans text-[#1e2d1f]">
        <ChapterSidebar
          projectId={projectId!}
          chapterId={chapterId}
          chapters={chapters}
          isLoadingChapters={isLoadingChapters}
          isCoauthoring={isCoauthoring}
          onToggleCoauthor={handleToggleCoauthor}
          onCreateChapter={handleCreateChapter}
          onToggleChapterStatus={handleToggleChapterStatus}
        />

        <div className="flex-1 flex flex-col relative">
          <EditorCanvas
            editor={editor}
            isSaving={isSaving}
            lastSavedAt={lastSavedAt}
            saveError={saveError}
            isLoadingContent={isLoadingContent}
            chapterTitle={chapters.find(c => c.id === chapterId)?.title}
            showWordCount={showWordCount}
            onShowWordCountChange={setShowWordCount}
            indentParagraphs={indentParagraphs}
            onIndentParagraphsChange={setIndentParagraphs}
            isDictating={isDictating}
            interimTranscript={interimTranscript}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenExport={() => setIsExportOpen(true)}
          />

          {isBibleMenuOpen && (
            <div className="fixed inset-0 z-30" onClick={() => setIsBibleMenuOpen(false)} />
          )}

          <BottomToolbar
            isDictating={isDictating}
            isSupported={isSupported}
            toggleListening={toggleListening}
            isCoauthoring={isCoauthoring}
            onToggleCoauthor={handleToggleCoauthor}
            isReading={isReading}
            onToggleReading={handleToggleReading}
            isBibleOpen={isBibleOpen}
            isBibleMenuOpen={isBibleMenuOpen}
            onSetBibleMenuOpen={setIsBibleMenuOpen}
            onBibleMenuClick={handleBibleMenuClick}
            isReferenceOpen={isReferenceOpen}
            onToggleReference={handleToggleReference}
            isRevisionOpen={isRevisionOpen}
            onToggleRevision={handleToggleRevision}
            isSyncOpen={isSyncOpen}
            onToggleSync={handleToggleSync}
            syncBadgeCount={chapters.reduce((acc, ch) => {
              if (!ch.lastExtractedAt) return acc + 1;
              return new Date(ch.updatedAt).getTime() > new Date(ch.lastExtractedAt).getTime() ? acc + 1 : acc;
            }, 0)}
            onOpenSearch={() => setIsSearchOpen(true)}
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
                boxShadow: '0 4px 24px rgba(0,0,0,0.14)',
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
                  color: 'rgba(30,45,31,0.4)', marginLeft: '2px',
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

        <aside
          className={`bg-[#f5f0e8] border-[#1e2d1f]/10 flex-shrink-0 transition-all duration-300 ease-in-out z-20 overflow-hidden relative ${
            (isBibleOpen || isCoauthoring || isReferenceOpen || isRevisionOpen || isSyncOpen)
              ? 'w-[320px] border-l opacity-100'
              : 'w-0 border-l-0 opacity-0'
          }`}
        >
          <div className="w-[320px] h-full flex flex-col absolute top-0 left-0">
          {isBibleOpen && (
            <StoryBiblePanel
              activeBibleTab={activeBibleTab}
              onTabChange={setActiveBibleTab}
              isExtracting={isExtracting}
              suggestions={suggestions}
              approvedEntities={approvedEntities}
              updateSuggestions={updateSuggestions}
              chapters={chapters.map(c => ({ id: c.id, title: c.title, order: c.order }))}
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
              onOpenInEditor={handleOpenInEditor}
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
              onClose={() => setIsSyncOpen(false)}
            />
          )}

          {isCoauthoring && (
            <CoauthorPanel
              chatMessages={chatMessages}
              isHistoryLoaded={isHistoryLoaded}
              chatInput={chatInput}
              onChatInputChange={setChatInput}
              isAiLoading={isAiLoading}
              isCheckingConsistency={isCheckingConsistency}
              chatEndRef={chatEndRef}
              selectedText={selectedText}
              onSendMessage={handleSendMessage}
              onSendPrompt={handleSendPrompt}
              onCheckConsistency={handleCheckConsistency}
              onInsertText={handleInsertText}
              onClose={() => setIsCoauthoring(false)}
            />
          )}

          {isReferenceOpen && (
            <div className="flex flex-col h-full w-[320px]">
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
                    <div className="flex flex-col items-center justify-center py-16 text-[#1e2d1f]/30 text-center">
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
                          <div className="flex items-center gap-1.5 text-[#1e2d1f]/40 font-bold text-[10px] uppercase tracking-widest mb-2.5">
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
                          <div className="flex items-center gap-1.5 text-[#1e2d1f]/40 font-bold text-[10px] uppercase tracking-widest mb-2.5">
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
                    <div className="flex flex-col items-center justify-center py-16 text-[#1e2d1f]/30 text-center">
                      <Bookmark size={32} className="mb-3 opacity-40" />
                      <p className="text-sm font-medium">
                        Библия пуста — используйте ИИ-извлечение в нижней панели
                      </p>
                    </div>
                  ) : (
                    <>
                      {contradictions.size > 0 && (
                        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200/80 rounded-xl px-3 py-2.5">
                          <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
                          <p className="text-[12px] text-amber-700 leading-snug">
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
      </div>

      <FindReplacePopup
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        editorText={editor?.getText() || ''}
        onReplace={newText => {
          editor?.commands.setContent(`<p>${newText.split(/\n\n+/).join('</p><p>')}</p>`);
          setIsBibleOpen(true);
          setIsReferenceOpen(false);
          setIsCoauthoring(false);
          setActiveBibleTab('inbox');
          handleExtract();
        }}
        onNavigate={(type, _id) => {
          setIsSearchOpen(false);
          if (type === 'lore') {
            setIsBibleOpen(true);
            setIsReferenceOpen(false);
            setIsCoauthoring(false);
            setActiveBibleTab('characters');
          }
        }}
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
        <div className="fixed inset-0 z-[100] bg-[#1e2d1f]/20 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8">
          <div className="bg-[#f8f9fa] rounded-3xl shadow-2xl w-full max-w-5xl max-h-full overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
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
