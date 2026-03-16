import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, X, Folder, FileText, BookOpen, Search, Replace } from 'lucide-react';

interface FindReplacePopupProps {
  isOpen: boolean;
  onClose: () => void;
  editorText?: string;
  onReplace?: (newText: string) => void;
  onNavigate?: (type: string, id: string) => void;
}

export function FindReplacePopup({ isOpen, onClose, editorText, onReplace, onNavigate }: FindReplacePopupProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [findIn, setFindIn] = useState('Document');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="absolute top-4 right-4 bg-white rounded-xl shadow-[0_8px_30px_rgba(30,45,31,0.12)] border border-[#1e2d1f]/10 p-2 w-[380px] z-50 flex flex-col gap-2 font-sans animate-in fade-in slide-in-from-top-4 duration-200">
      <div className="flex items-center gap-2">
        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1.5 hover:bg-[#f5f0e8] rounded-md text-[#1e2d1f]/60 hover:text-[#1e2d1f] transition-colors"
          title="Toggle Replace"
        >
          {isExpanded ? <ChevronDown size={16} strokeWidth={2.5} /> : <ChevronRight size={16} strokeWidth={2.5} />}
        </button>
        
        <div className="flex-1 flex items-center bg-[#f5f0e8]/50 border border-[#1e2d1f]/10 rounded-lg focus-within:border-[#1e2d1f]/30 focus-within:bg-white transition-all px-2 py-1">
          <Search size={14} className="text-[#1e2d1f]/40 mr-1.5" />
          <input 
            type="text" 
            placeholder="Найти..." 
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-[#1e2d1f]/40 text-[#1e2d1f]"
            autoFocus
          />
          <span className="text-[11px] text-[#1e2d1f]/30 font-medium px-2">0/0</span>
        </div>
        
        <div className="flex items-center gap-0.5 text-[#1e2d1f]/60">
          <button className="p-1.5 hover:bg-[#f5f0e8] hover:text-[#1e2d1f] rounded-md transition-colors" title="Previous Match"><ArrowUp size={16} strokeWidth={2} /></button>
          <button className="p-1.5 hover:bg-[#f5f0e8] hover:text-[#1e2d1f] rounded-md transition-colors" title="Next Match"><ArrowDown size={16} strokeWidth={2} /></button>
          <div className="w-px h-4 bg-[#1e2d1f]/10 mx-1" />
          <button onClick={onClose} className="p-1.5 hover:bg-[#f5f0e8] hover:text-[#1e2d1f] rounded-md transition-colors" title="Close"><X size={16} strokeWidth={2} /></button>
        </div>
      </div>

      {isExpanded && (
        <div className="flex items-center gap-2 pl-8 pr-[104px]">
          <div className="flex-1 flex items-center bg-[#f5f0e8]/50 border border-[#1e2d1f]/10 rounded-lg focus-within:border-[#1e2d1f]/30 focus-within:bg-white transition-all px-2 py-1">
            <Replace size={14} className="text-[#1e2d1f]/40 mr-1.5" />
            <input 
              type="text" 
              placeholder="Заменить на..." 
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-[#1e2d1f]/40 text-[#1e2d1f]"
            />
          </div>
        </div>
      )}

      {isExpanded && (
        <div className="flex items-center justify-between pl-8 pr-1 mt-1">
          <div className="relative" ref={dropdownRef}>
            <button 
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-1.5 text-[12px] text-[#1e2d1f]/60 hover:text-[#1e2d1f] transition-colors font-medium px-2 py-1 rounded-md hover:bg-[#f5f0e8]"
            >
              Везде: <span className="text-[#1e2d1f]">{findIn}</span> <ChevronDown size={14} className="text-[#1e2d1f]/60" />
            </button>
            
            {isDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-xl shadow-[0_4px_20px_rgba(30,45,31,0.15)] border border-[#1e2d1f]/10 py-1.5 z-50">
                <button 
                  onClick={() => { setFindIn('Проект'); setIsDropdownOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-2 text-[13px] hover:bg-[#f5f0e8] text-[#1e2d1f] transition-colors"
                >
                  <Folder size={16} className="text-[#1e2d1f]/50" /> Весь проект
                </button>
                <button 
                  onClick={() => { setFindIn('Документ'); setIsDropdownOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-2 text-[13px] hover:bg-[#f5f0e8] text-[#1e2d1f] transition-colors"
                >
                  <FileText size={16} className="text-[#1e2d1f]/50" /> Текущий документ
                </button>
                <button 
                  onClick={() => { setFindIn('Библия'); setIsDropdownOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-2 text-[13px] hover:bg-[#f5f0e8] text-[#1e2d1f] transition-colors"
                >
                  <BookOpen size={16} className="text-[#1e2d1f]/50" /> Библия истории
                </button>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-1">
            <button className="px-3 py-1.5 text-[12px] text-[#1e2d1f]/80 hover:text-[#1e2d1f] hover:bg-[#f5f0e8] rounded-md font-medium transition-colors">Заменить</button>
            <button className="px-3 py-1.5 text-[12px] text-[#1e2d1f]/80 hover:text-[#1e2d1f] hover:bg-[#f5f0e8] rounded-md font-medium transition-colors">Всё</button>
          </div>
        </div>
      )}
    </div>
  );
}
