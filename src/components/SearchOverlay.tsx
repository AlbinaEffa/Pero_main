import React, { useState, useEffect, useRef } from 'react';
import { Search, X, ChevronRight, ChevronDown, Replace, ArrowRight, Check } from 'lucide-react';

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  editorText: string;
  onReplace: (newText: string) => void;
  onNavigate: (type: string, id: string) => void;
}

export const SearchOverlay: React.FC<SearchOverlayProps> = ({
  isOpen,
  onClose,
  editorText,
  onReplace,
  onNavigate
}) => {
  const [query, setQuery] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setReplaceWith('');
      setShowReplace(false);
      setActiveMatchIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Simple morphological matching for demo:
  // We match the exact substring case-insensitively, 
  // but if the query is e.g. "бежал", we can optionally match "беж"
  // Let's just do a simple case-insensitive search for the exact query for now,
  // or a basic root extraction if length > 4.
  const getSearchRegex = (q: string) => {
    if (!q.trim()) return null;
    let root = q.trim().toLowerCase();
    // Very basic Russian stemming for the requested example "бежал" -> "беж"
    if (root === 'бежал' || root === 'бежит' || root === 'убежать' || root === 'побежал') {
      root = 'беж';
    } else if (root.length > 4) {
      // Just strip common endings for a mock morphological feel
      const stripped = root.replace(/(ал|ла|ло|ли|ет|ут|ют|ат|ят|ешь|ишь|те|сь|ся|ая|яя|ое|ее|ие|ые|ой|ей|ий|ый|ом|ем|ам|ям|ах|ях|ов|ев|у|ю|а|я|о|е|и|ы|ь)$/g, '');
      if (stripped.length >= 2) root = stripped;
    }
    // Escape regex chars
    root = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!root) return null;
    return new RegExp(`(${root}[а-яА-Яa-zA-Z]*)`, 'gi');
  };

  const regex = getSearchRegex(query);
  
  // Find matches in editor text
  const textMatches: { index: number, text: string, before: string, match: string, after: string }[] = [];
  if (regex) {
    let match;
    let i = 0;
    while ((match = regex.exec(editorText)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex++;
        continue;
      }
      const start = Math.max(0, match.index - 40);
      const end = Math.min(editorText.length, match.index + match[0].length + 40);
      textMatches.push({
        index: i++,
        text: editorText.substring(start, end),
        before: editorText.substring(start, match.index),
        match: match[0],
        after: editorText.substring(match.index + match[0].length, end)
      });
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        setActiveMatchIndex(prev => (prev > 0 ? prev - 1 : Math.max(0, textMatches.length - 1)));
      } else {
        setActiveMatchIndex(prev => (prev < textMatches.length - 1 ? prev + 1 : 0));
      }
    }
  };

  const handleReplace = () => {
    if (!regex || textMatches.length === 0) return;
    
    // Replace only the active match
    let currentMatchIdx = 0;
    const newText = editorText.replace(regex, (match) => {
      if (currentMatchIdx === activeMatchIndex) {
        currentMatchIdx++;
        return replaceWith;
      }
      currentMatchIdx++;
      return match;
    });
    
    onReplace(newText);
    
    // Adjust active index if needed
    if (activeMatchIndex >= textMatches.length - 1) {
      setActiveMatchIndex(Math.max(0, textMatches.length - 2));
    }
  };

  const handleReplaceAll = () => {
    if (!regex) return;
    const newText = editorText.replace(regex, replaceWith);
    onReplace(newText);
    setActiveMatchIndex(0);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-[#1e2d1f]/20 backdrop-blur-sm">
      <div 
        className="w-full max-w-2xl bg-[#fdfbf7] rounded-2xl shadow-2xl border border-[#1e2d1f]/10 overflow-hidden flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header / Search Input */}
        <div className="p-4 border-b border-[#1e2d1f]/10 bg-white">
          <div className="flex items-center gap-3 bg-[#f5f0e8] rounded-xl px-4 py-3">
            <Search size={18} className="text-[#1e2d1f]/40" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Поиск по тексту книги..."
              className="flex-1 bg-transparent border-none outline-none text-[#1e2d1f] placeholder:text-[#1e2d1f]/40 text-base"
            />
            {query && (
              <span className="text-xs font-medium text-[#1e2d1f]/40 mr-2">
                {textMatches.length} совпадения
              </span>
            )}
            <button 
              onClick={() => setShowReplace(!showReplace)}
              className={`p-1.5 rounded-md transition-colors ${showReplace ? 'bg-[#1e2d1f]/10 text-[#1e2d1f]' : 'text-[#1e2d1f]/40 hover:bg-[#1e2d1f]/5 hover:text-[#1e2d1f]'}`}
              title="Заменить"
            >
              <Replace size={16} />
            </button>
            <button 
              onClick={onClose}
              className="p-1.5 rounded-md text-[#1e2d1f]/40 hover:bg-[#1e2d1f]/5 hover:text-[#1e2d1f] transition-colors ml-1"
            >
              <X size={16} />
            </button>
          </div>

          {/* Replace Input */}
          {showReplace && (
            <div className="flex items-center gap-3 mt-3 pl-11 pr-4">
              <input
                ref={replaceInputRef}
                type="text"
                value={replaceWith}
                onChange={e => setReplaceWith(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Заменить на..."
                className="flex-1 bg-[#f5f0e8] rounded-xl px-4 py-2.5 border-none outline-none text-[#1e2d1f] placeholder:text-[#1e2d1f]/40 text-sm"
              />
              <div className="flex items-center gap-2">
                <button 
                  onClick={handleReplace}
                  disabled={!query || textMatches.length === 0}
                  className="px-4 py-2.5 bg-[#1e2d1f]/5 hover:bg-[#1e2d1f]/10 text-[#1e2d1f] text-sm font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Заменить
                </button>
                <button 
                  onClick={handleReplaceAll}
                  disabled={!query || textMatches.length === 0}
                  className="px-4 py-2.5 bg-[#1e2d1f] hover:bg-[#1e2d1f]/90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Заменить все
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Results Area */}
        <div className="flex-1 overflow-y-auto p-2 bg-[#fdfbf7]">
          {!query ? (
            <div className="py-12 text-center text-[#1e2d1f]/40 text-sm">
              Введите текст для поиска по текущей книге.<br/>
              Поиск поддерживает морфологию (например, "бежал" найдет "бежит").
            </div>
          ) : textMatches.length === 0 ? (
            <div className="py-12 text-center text-[#1e2d1f]/40 text-sm">
              Ничего не найдено
            </div>
          ) : (
            <div className="space-y-6 p-2">
              {/* Главы и сцены */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-[#1e2d1f]/40 mb-3 px-2">
                  Главы и сцены
                </h3>
                <div className="space-y-1">
                  {textMatches.map((match, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setActiveMatchIndex(idx);
                        onNavigate('scene', '12-2'); // Mock navigation
                      }}
                      className={`w-full text-left p-3 rounded-xl transition-colors ${
                        activeMatchIndex === idx 
                          ? 'bg-[#1e2d1f]/5 ring-1 ring-[#1e2d1f]/10' 
                          : 'hover:bg-[#1e2d1f]/5'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-[#1e2d1f]">Глава 12. Тени прошлого</span>
                        <span className="text-[10px] text-[#1e2d1f]/40">Рукопись</span>
                      </div>
                      <div className="text-sm text-[#1e2d1f]/60 leading-relaxed font-serif">
                        ...{match.before}
                        <span className="bg-amber-200/60 text-[#1e2d1f] font-medium px-0.5 rounded">
                          {match.match}
                        </span>
                        {match.after}...
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Mock Lore Results if query matches */}
              {(query.toLowerCase().includes('воронц') || query.toLowerCase().includes('анн')) && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#1e2d1f]/40 mb-3 px-2">
                    Персонажи
                  </h3>
                  <div className="space-y-1">
                    <button
                      onClick={() => onNavigate('lore', '1')}
                      className="w-full text-left p-3 rounded-xl hover:bg-[#1e2d1f]/5 transition-colors flex items-start gap-3"
                    >
                      <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-rose-800 font-serif font-medium text-sm">В</span>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-[#1e2d1f] mb-0.5">Граф Воронцов</div>
                        <div className="text-xs text-[#1e2d1f]/50">
                          Упоминается в Главе 12. Имеет старый шрам на левой щеке.
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Footer */}
        {showReplace && textMatches.length > 0 && (
          <div className="p-3 border-t border-[#1e2d1f]/10 bg-[#f5f0e8]/50 text-xs text-[#1e2d1f]/50 flex items-center justify-center gap-4">
            <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-white rounded border border-[#1e2d1f]/10 shadow-sm">Enter</kbd> след. совпадение</span>
            <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-white rounded border border-[#1e2d1f]/10 shadow-sm">Shift</kbd> + <kbd className="px-1.5 py-0.5 bg-white rounded border border-[#1e2d1f]/10 shadow-sm">Enter</kbd> пред. совпадение</span>
          </div>
        )}
      </div>
    </div>
  );
};
