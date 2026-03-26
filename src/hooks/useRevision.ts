import { useState } from 'react';
import { api } from '../services/api';
import { track } from '../services/analytics';

export interface TraceChapter {
  id: string;
  title: string;
  order: number;
  snippets: string[];
}

export interface BibleUpdateSuggestion {
  action: 'update' | 'add';
  entityName: string;
  currentDescription?: string;
  suggestedDescription: string;
  reason: string;
}

export function useRevision(
  projectId: string | undefined,
  chapterId: string | undefined,
  getContent: () => string
) {
  // ── Entity search (shared query for trace + arc) ──
  const [searchQuery, setSearchQuery]     = useState('');

  // ── Entity trace ──
  const [traceResults, setTraceResults]   = useState<TraceChapter[]>([]);
  const [isTracing, setIsTracing]         = useState(false);
  const [traceDone, setTraceDone]         = useState(false);
  const [traceSemantic, setTraceSemantic] = useState(false);

  // ── Entity arc ──
  const [arcText, setArcText]             = useState('');
  const [isArcLoading, setIsArcLoading]   = useState(false);

  // ── Bible update ──
  const [bibleSuggestions, setBibleSuggestions] = useState<BibleUpdateSuggestion[]>([]);
  const [isBibleLoading, setIsBibleLoading]     = useState(false);
  const [bibleDone, setBibleDone]               = useState(false);

  const handleTrace = async () => {
    if (!projectId || !searchQuery.trim()) return;
    setIsTracing(true);
    setTraceDone(false);
    setTraceResults([]);
    setArcText('');
    try {
      const data = await api.post<{ chapters: TraceChapter[]; semantic: boolean }>(
        '/revision/entity-trace',
        { projectId, entityName: searchQuery.trim() }
      );
      const chapters = data.chapters || [];
      setTraceResults(chapters);
      setTraceSemantic(data.semantic ?? false);
      track('revision_trace_run', { projectId, chapterCount: chapters.length, semantic: data.semantic });
    } catch (e) {
      console.error('entity-trace failed:', e);
    } finally {
      setIsTracing(false);
      setTraceDone(true);
    }
  };

  const handleArc = async () => {
    if (!projectId || !searchQuery.trim()) return;
    setIsArcLoading(true);
    setArcText('');
    try {
      const data = await api.post<{ arc: string; mentions: number }>(
        '/revision/entity-arc',
        { projectId, entityName: searchQuery.trim() }
      );
      setArcText(data.arc || '');
      track('revision_arc_run', { projectId, mentions: data.mentions });
    } catch (e) {
      console.error('entity-arc failed:', e);
      setArcText('Не удалось построить арку. Попробуйте позже.');
    } finally {
      setIsArcLoading(false);
    }
  };

  const handleBibleUpdate = async () => {
    if (!projectId || !chapterId) return;
    setIsBibleLoading(true);
    setBibleDone(false);
    setBibleSuggestions([]);
    try {
      const data = await api.post<{ suggestions: BibleUpdateSuggestion[] }>(
        '/revision/bible-update',
        { projectId, chapterId, chapterContent: getContent() }
      );
      const suggestions = data.suggestions || [];
      setBibleSuggestions(suggestions);
      track('bible_update_checked', { projectId, suggestionCount: suggestions.length });
    } catch (e) {
      console.error('bible-update failed:', e);
    } finally {
      setIsBibleLoading(false);
      setBibleDone(true);
    }
  };

  const dismissBibleSuggestion = (index: number) => {
    setBibleSuggestions(prev => prev.filter((_, i) => i !== index));
  };

  return {
    searchQuery, setSearchQuery,
    // trace
    traceResults, isTracing, traceDone, traceSemantic,
    handleTrace,
    // arc
    arcText, isArcLoading,
    handleArc,
    // bible update
    bibleSuggestions, isBibleLoading, bibleDone,
    handleBibleUpdate,
    dismissBibleSuggestion,
  };
}
