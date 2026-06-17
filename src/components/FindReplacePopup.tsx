import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, X, Search, Replace } from 'lucide-react';
import { Editor as TiptapEditor } from '@tiptap/react';
import { searchHighlightKey } from './editor/searchHighlightExtension';

interface FindReplacePopupProps {
  isOpen: boolean;
  onClose: () => void;
  editor: TiptapEditor | null;
}

interface MatchRange {
  from: number;
  to: number;
}

/** Find all occurrences of `query` in the ProseMirror document. */
function findMatches(editor: TiptapEditor, query: string): MatchRange[] {
  if (!query || !editor || editor.isDestroyed) return [];
  const q = query.toLowerCase();
  const matches: MatchRange[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLowerCase();
    let idx = 0;
    while ((idx = text.indexOf(q, idx)) !== -1) {
      matches.push({ from: pos + idx, to: pos + idx + q.length });
      idx += q.length;
    }
  });
  return matches;
}

export function FindReplacePopup({ isOpen, onClose, editor }: FindReplacePopupProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');

  const [matches, setMatches] = useState<MatchRange[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const findInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => findInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Clear highlights when closed
  useEffect(() => {
    if (!isOpen && editor && !editor.isDestroyed) {
      editor.view.dispatch(
        editor.view.state.tr.setMeta(searchHighlightKey, 'clear')
      );
    }
  }, [isOpen, editor]);

  // Recompute matches whenever findText or doc changes
  const updateMatches = useCallback((query: string) => {
    if (!editor || editor.isDestroyed) return;
    const found = findMatches(editor, query);
    setMatches(found);
    const idx = found.length > 0 ? 0 : -1;
    setCurrentIndex(idx >= 0 ? 0 : 0);
    // Highlight first match
    if (found.length > 0) {
      highlightMatch(found[0]);
    } else {
      editor.view.dispatch(
        editor.view.state.tr.setMeta(searchHighlightKey, 'clear')
      );
    }
  }, [editor]);

  const highlightMatch = useCallback((match: MatchRange) => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(
      editor.view.state.tr.setMeta(searchHighlightKey, { from: match.from, to: match.to })
    );
    // Scroll match into view
    try {
      const coords = editor.view.coordsAtPos(match.from);
      const el = editor.view.dom.closest('.overflow-y-auto, .overflow-auto');
      if (el) {
        const elRect = el.getBoundingClientRect();
        const scrollTop = el.scrollTop + (coords.top - elRect.top) - elRect.height / 2;
        el.scrollTo({ top: scrollTop, behavior: 'smooth' });
      }
    } catch {
      // ignore scroll errors
    }
  }, [editor]);

  const handleFindChange = (q: string) => {
    setFindText(q);
    updateMatches(q);
  };

  const navigate = useCallback((dir: 'next' | 'prev') => {
    if (matches.length === 0) return;
    const next = dir === 'next'
      ? (currentIndex + 1) % matches.length
      : (currentIndex - 1 + matches.length) % matches.length;
    setCurrentIndex(next);
    highlightMatch(matches[next]);
  }, [matches, currentIndex, highlightMatch]);

  const handleReplace = () => {
    if (matches.length === 0 || !editor) return;
    const match = matches[currentIndex];
    editor.chain()
      .focus()
      .setTextSelection({ from: match.from, to: match.to })
      .insertContent(replaceText)
      .run();
    // Re-search after replace
    setTimeout(() => updateMatches(findText), 0);
  };

  const handleReplaceAll = () => {
    if (matches.length === 0 || !editor) return;
    // Replace in reverse order to preserve positions
    const sorted = [...matches].sort((a, b) => b.from - a.from);
    editor.chain().focus().run();
    for (const match of sorted) {
      editor.chain()
        .setTextSelection({ from: match.from, to: match.to })
        .insertContent(replaceText)
        .run();
    }
    setTimeout(() => updateMatches(findText), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) navigate('prev');
      else navigate('next');
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  const matchCount = matches.length;
  const displayIndex = matchCount > 0 ? currentIndex + 1 : 0;

  return (
    <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-white rounded-xl shadow-[0_8px_30px_rgba(30,45,31,0.12)] border border-[#1e2d1f]/10 p-2 w-[380px] z-50 flex flex-col gap-2 font-sans animate-in fade-in slide-in-from-bottom-4 duration-200">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1.5 hover:bg-[#f5f0e8] rounded-md text-[#1e2d1f]/60 hover:text-[#1e2d1f] transition-colors"
          title="Показать замену"
        >
          {isExpanded ? <ChevronDown size={16} strokeWidth={2.5} /> : <ChevronRight size={16} strokeWidth={2.5} />}
        </button>

        <div className="flex-1 flex items-center bg-[#f5f0e8]/50 border border-[#1e2d1f]/10 rounded-lg focus-within:border-[#1e2d1f]/30 focus-within:bg-white transition-all px-2 py-1">
          <Search size={14} className="text-[#1e2d1f]/55 mr-1.5 flex-shrink-0" />
          <input
            ref={findInputRef}
            type="text"
            placeholder="Найти..."
            value={findText}
            onChange={e => handleFindChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-[#1e2d1f]/55 text-[#1e2d1f]"
          />
          <span className={`text-[11px] font-medium px-2 flex-shrink-0 ${matchCount === 0 && findText ? 'text-[#9E4338]' : 'text-[#1e2d1f]/55'}`}>
            {findText ? `${displayIndex}/${matchCount}` : ''}
          </span>
        </div>

        <div className="flex items-center gap-0.5 text-[#1e2d1f]/60">
          <button
            onClick={() => navigate('prev')}
            disabled={matchCount === 0}
            className="p-1.5 hover:bg-[#f5f0e8] hover:text-[#1e2d1f] rounded-md transition-colors disabled:opacity-30"
            title="Предыдущий (Shift+Enter)"
          >
            <ArrowUp size={16} strokeWidth={2} />
          </button>
          <button
            onClick={() => navigate('next')}
            disabled={matchCount === 0}
            className="p-1.5 hover:bg-[#f5f0e8] hover:text-[#1e2d1f] rounded-md transition-colors disabled:opacity-30"
            title="Следующий (Enter)"
          >
            <ArrowDown size={16} strokeWidth={2} />
          </button>
          <div className="w-px h-4 bg-[#1e2d1f]/10 mx-1" />
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[#f5f0e8] hover:text-[#1e2d1f] rounded-md transition-colors"
            title="Закрыть"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      </div>

      {isExpanded && (
        <>
          <div className="flex items-center gap-2 pl-8 pr-[104px]">
            <div className="flex-1 flex items-center bg-[#f5f0e8]/50 border border-[#1e2d1f]/10 rounded-lg focus-within:border-[#1e2d1f]/30 focus-within:bg-white transition-all px-2 py-1">
              <Replace size={14} className="text-[#1e2d1f]/55 mr-1.5 flex-shrink-0" />
              <input
                type="text"
                placeholder="Заменить на..."
                value={replaceText}
                onChange={e => setReplaceText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleReplace(); if (e.key === 'Escape') onClose(); }}
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-[#1e2d1f]/55 text-[#1e2d1f]"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-1 pl-8 pr-1">
            <button
              onClick={handleReplace}
              disabled={matchCount === 0}
              className="px-3 py-1.5 text-[12px] text-[#1e2d1f]/80 hover:text-[#1e2d1f] hover:bg-[#f5f0e8] rounded-md font-medium transition-colors disabled:opacity-30"
            >
              Заменить
            </button>
            <button
              onClick={handleReplaceAll}
              disabled={matchCount === 0}
              className="px-3 py-1.5 text-[12px] text-[#1e2d1f]/80 hover:text-[#1e2d1f] hover:bg-[#f5f0e8] rounded-md font-medium transition-colors disabled:opacity-30"
            >
              Всё ({matchCount})
            </button>
          </div>
        </>
      )}
    </div>
  );
}
