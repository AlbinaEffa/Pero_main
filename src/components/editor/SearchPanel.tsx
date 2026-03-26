/**
 * SearchPanel — global project search overlay.
 *
 * Opens with Cmd/Ctrl+K from the Editor.
 * Searches chapters (by title and text content) and Story Bible entities.
 * Click or Enter on a result navigates to /editor/:projectId/:chapterId.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Search, FileText, AlignLeft, Users, MapPin, Box, Scale, Loader2,
} from 'lucide-react';
import { searchProject, SearchResult, SearchResultType } from '../../services/api';

// ─── Type meta ────────────────────────────────────────────────────────────────

const TYPE_META: Record<SearchResultType, { label: string; icon: React.ReactNode }> = {
  chapter:    { label: 'Глава',     icon: <FileText  size={13} /> },
  text_match: { label: 'Фрагмент', icon: <AlignLeft size={13} /> },
  character:  { label: 'Персонаж', icon: <Users     size={13} /> },
  location:   { label: 'Локация',  icon: <MapPin    size={13} /> },
  item:       { label: 'Предмет',  icon: <Box       size={13} /> },
  rule:       { label: 'Правило',  icon: <Scale     size={13} /> },
};

const GROUP_DEFS: { key: string; label: string; types: SearchResultType[] }[] = [
  { key: 'chapters',  label: 'Главы',      types: ['chapter'] },
  { key: 'text',      label: 'Фрагменты',  types: ['text_match'] },
  { key: 'entities',  label: 'Сущности',   types: ['character', 'location', 'item', 'rule'] },
];

// ─── Highlight helper ─────────────────────────────────────────────────────────

function highlight(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? (
        <mark
          key={i}
          style={{
            background: 'rgba(58,79,65,0.15)',
            borderRadius: '2px',
            padding: '0 2px',
            fontWeight: 600,
            color: '#1e2d1f',
          }}
        >
          {part}
        </mark>
      )
      : part
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
  onClose: () => void;
}

export function SearchPanel({ projectId, onClose }: Props) {
  const navigate = useNavigate();

  const [query, setQuery]               = useState('');
  const [results, setResults]           = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading]       = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const inputRef      = useRef<HTMLInputElement>(null);
  const listRef       = useRef<HTMLDivElement>(null);
  const debounceRef   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Monotonically-increasing counter: each new search increments it; stale responses are ignored.
  const requestIdRef  = useRef(0);

  // Auto-focus input on open
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ── Search logic ─────────────────────────────────────────────────────────
  const doSearch = useCallback(async (q: string) => {
    if (!projectId || q.trim().length < 2) {
      setResults([]);
      setIsLoading(false);
      return;
    }
    // Stamp this request; if a newer one arrives while we await, discard our result.
    const id = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const res = await searchProject(projectId, q.trim());
      if (id !== requestIdRef.current) return; // stale — a newer request is in-flight
      setResults(res);
    } catch {
      if (id !== requestIdRef.current) return;
      setResults([]);
    } finally {
      if (id === requestIdRef.current) setIsLoading(false);
    }
  }, [projectId]);

  const handleQueryChange = (q: string) => {
    setQuery(q);
    setSelectedIndex(-1);
    clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      // Bump counter so any in-flight request is discarded when it resolves.
      requestIdRef.current++;
      setResults([]);
      setIsLoading(false); // clear any spinner left from a previous longer query
      return;
    }
    setIsLoading(true); // optimistic — show spinner while debouncing
    debounceRef.current = setTimeout(() => doSearch(q), 300);
  };

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  // ── Group results ─────────────────────────────────────────────────────────
  const groups = useMemo(() => {
    return GROUP_DEFS
      .map(g => ({ ...g, items: results.filter(r => (g.types as string[]).includes(r.type)) }))
      .filter(g => g.items.length > 0);
  }, [results]);

  const flatResults = useMemo(() => groups.flatMap(g => g.items), [groups]);

  // Stable index map: result.id → flat position across all groups.
  // Avoids a mutable counter variable in render (unsafe with Concurrent React).
  const flatIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    flatResults.forEach((item, i) => map.set(item.id, i));
    return map;
  }, [flatResults]);

  // ── Navigation ────────────────────────────────────────────────────────────
  const navigateTo = useCallback((r: SearchResult) => {
    if (!r.chapterId) return;
    // For text_match results, pass the matchText fingerprint (±15 chars around the match) so the
    // Editor can locate the exact position. The raw query is passed alongside as a fallback for
    // highlighting if the fingerprint spans multiple ProseMirror text nodes.
    const navOptions = r.type === 'text_match'
      ? { state: { searchHighlight: r.matchText ?? query.trim(), searchQuery: query.trim() } }
      : undefined;
    navigate(`/editor/${projectId}/${r.chapterId}`, navOptions);
    onClose();
  }, [navigate, projectId, onClose, query]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // ── Keyboard handler ──────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (flatResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = selectedIndex >= 0 ? flatResults[selectedIndex] : flatResults[0];
      if (target) navigateTo(target);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,20,15,0.55)',
        backdropFilter: 'blur(6px)',
        zIndex: 300,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '72px 16px 16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#F4F1E9',
          borderRadius: '20px',
          width: '100%',
          maxWidth: '560px',
          boxShadow: '0 32px 80px rgba(0,0,0,0.35)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'calc(100vh - 100px)',
          animation: 'slideDown 0.18s cubic-bezier(0.34,1.56,0.64,1)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Input row ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '14px 18px',
          background: '#fff',
          borderBottom: '1px solid rgba(0,0,0,0.07)',
        }}>
          <Search size={18} style={{ color: 'rgba(0,0,0,0.3)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Поиск по проекту..."
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              fontSize: '15px',
              fontFamily: 'inherit',
              background: 'transparent',
              color: '#1a1a1a',
            }}
          />
          {isLoading
            ? <Loader2 size={16} style={{ color: 'rgba(0,0,0,0.3)', flexShrink: 0, animation: 'spin 0.8s linear infinite' }} />
            : query
              ? (
                <button
                  onClick={() => { requestIdRef.current++; setQuery(''); setResults([]); setIsLoading(false); inputRef.current?.focus(); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'rgba(0,0,0,0.3)', flexShrink: 0 }}
                >
                  <X size={16} />
                </button>
              )
              : (
                <kbd style={{
                  fontSize: '11px', color: 'rgba(0,0,0,0.3)',
                  background: 'rgba(0,0,0,0.05)', borderRadius: '4px',
                  padding: '2px 6px', fontFamily: 'monospace', flexShrink: 0,
                }}>
                  Esc
                </kbd>
              )
          }
        </div>

        {/* ── Results ── */}
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
          {query.trim().length >= 2 && !isLoading && results.length === 0 && (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: 'rgba(0,0,0,0.35)', fontSize: '14px' }}>
              Ничего не найдено по&nbsp;«{query}»
            </div>
          )}

          {query.trim().length < 2 && (
            <div style={{ padding: '20px 20px 24px', color: 'rgba(0,0,0,0.3)', fontSize: '13px', textAlign: 'center' }}>
              Введите минимум 2 символа — ищем по главам и Библии
            </div>
          )}

          {groups.map(group => (
            <div key={group.key}>
              {/* Group label */}
              <div style={{
                padding: '10px 18px 4px',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'rgba(0,0,0,0.35)',
              }}>
                {group.label}
              </div>

              {/* Group items */}
              {group.items.map(result => {
                const idx = flatIndexMap.get(result.id) ?? 0;
                const isSelected = selectedIndex === idx;
                const meta = TYPE_META[result.type];
                const isNavigable = result.chapterId !== null;

                return (
                  <div
                    key={result.id}
                    data-index={idx}
                    onClick={() => navigateTo(result)}
                    onMouseEnter={() => isNavigable && setSelectedIndex(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '12px',
                      padding: '10px 18px',
                      cursor: isNavigable ? 'pointer' : 'default',
                      opacity: isNavigable ? 1 : 0.45,
                      background: isSelected ? 'rgba(58,79,65,0.08)' : 'transparent',
                      transition: 'background 0.1s',
                      borderLeft: isSelected ? '3px solid #3A4F41' : '3px solid transparent',
                    }}
                  >
                    {/* Type icon */}
                    <div style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '8px',
                      background: isSelected ? 'rgba(58,79,65,0.14)' : 'rgba(0,0,0,0.05)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isSelected ? '#3A4F41' : 'rgba(0,0,0,0.4)',
                      flexShrink: 0,
                      marginTop: '1px',
                    }}>
                      {meta.icon}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: result.snippet ? '2px' : 0 }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {highlight(result.title, query)}
                        </span>
                        <span style={{
                          fontSize: '10px',
                          background: 'rgba(0,0,0,0.06)',
                          borderRadius: '4px',
                          padding: '1px 5px',
                          color: 'rgba(0,0,0,0.4)',
                          flexShrink: 0,
                          fontWeight: 500,
                        }}>
                          {meta.label}
                        </span>
                      </div>

                      {result.snippet && (
                        <p style={{
                          fontSize: '12px',
                          color: 'rgba(0,0,0,0.5)',
                          margin: 0,
                          lineHeight: 1.5,
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        } as React.CSSProperties}>
                          {highlight(result.snippet, query)}
                        </p>
                      )}

                      {result.type !== 'chapter' && result.chapterTitle && (
                        <p style={{ fontSize: '11px', color: 'rgba(0,0,0,0.3)', margin: '2px 0 0', fontStyle: 'italic' }}>
                          {result.chapterTitle}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* ── Footer hint ── */}
        {flatResults.length > 0 && (
          <div style={{
            padding: '8px 18px',
            borderTop: '1px solid rgba(0,0,0,0.06)',
            display: 'flex',
            gap: '14px',
            fontSize: '11px',
            color: 'rgba(0,0,0,0.3)',
            background: '#fff',
          }}>
            <span><kbd style={{ fontFamily: 'monospace', background: 'rgba(0,0,0,0.06)', borderRadius: '3px', padding: '1px 4px' }}>↑↓</kbd> навигация</span>
            <span><kbd style={{ fontFamily: 'monospace', background: 'rgba(0,0,0,0.06)', borderRadius: '3px', padding: '1px 4px' }}>Enter</kbd> открыть</span>
            <span><kbd style={{ fontFamily: 'monospace', background: 'rgba(0,0,0,0.06)', borderRadius: '3px', padding: '1px 4px' }}>Esc</kbd> закрыть</span>
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-12px) scale(0.98) }
          to   { opacity: 1; transform: translateY(0)    scale(1)    }
        }
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  );
}
