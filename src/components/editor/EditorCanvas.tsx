import { useState, useRef, useEffect } from 'react';
import { Editor as TiptapEditor } from '@tiptap/react';
import { EditorContent } from '@tiptap/react';
import {
  Bold, Italic, Underline, Strikethrough, List,
  Undo2, Redo2, User, Download, Settings2, Search
} from 'lucide-react';

interface Props {
  editor: TiptapEditor | null;
  isSaving: boolean;
  lastSavedAt?: Date | null;
  saveError?: boolean;
  isLoadingContent?: boolean;
  chapterTitle?: string;
  showWordCount: boolean;
  onShowWordCountChange: (v: boolean) => void;
  indentParagraphs: boolean;
  onIndentParagraphsChange: (v: boolean) => void;
  isDictating: boolean;
  interimTranscript: string;
  onOpenSettings: () => void;
  onOpenSearch?: () => void;
  onOpenExport?: () => void;
}

export function EditorCanvas({
  editor,
  isSaving,
  lastSavedAt,
  saveError,
  isLoadingContent,
  chapterTitle,
  showWordCount,
  onShowWordCountChange,
  indentParagraphs,
  onIndentParagraphsChange,
  isDictating,
  interimTranscript,
  onOpenSettings,
  onOpenSearch,
  onOpenExport,
}: Props) {
  const [isFormatMenuOpen, setIsFormatMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isFormatMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsFormatMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isFormatMenuOpen]);

  const [textWidth, setTextWidth] = useState<'narrow' | 'medium' | 'wide'>(() => {
    return (localStorage.getItem('pero_textWidth') as 'narrow' | 'medium' | 'wide') || 'medium';
  });
  const wordCount = editor?.storage.characterCount.words() || 0;

  const handleWidthChange = (w: 'narrow' | 'medium' | 'wide') => {
    setTextWidth(w);
    localStorage.setItem('pero_textWidth', w);
  };

  const widthClass = {
    narrow: 'max-w-xl',
    medium: 'max-w-2xl',
    wide: 'max-w-4xl',
  }[textWidth];

  return (
    <main className="flex-1 flex flex-col relative bg-transparent shadow-[-10px_0_20px_rgba(0,0,0,0.02)] z-10 transition-all duration-300">
      {/* Top Formatting Toolbar */}
      <div className="h-14 border-b border-[#1e2d1f]/10 bg-[#f5f0e8]/90 backdrop-blur-md flex items-center justify-between px-6 sticky top-0 z-30 shrink-0">
        <div className="w-8" />
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => editor?.chain().focus().undo().run()}
              disabled={!editor?.can().undo()}
              title="Отменить (Cmd+Z)"
              className={`transition-colors ${editor?.can().undo() ? 'text-[#1e2d1f] hover:text-[#1e2d1f]/70' : 'text-[#a1a1aa] cursor-not-allowed'}`}
            >
              <Undo2 size={20} strokeWidth={2.5} />
            </button>
            <button
              onClick={() => editor?.chain().focus().redo().run()}
              disabled={!editor?.can().redo()}
              title="Повторить (Cmd+Shift+Z)"
              className={`transition-colors ${editor?.can().redo() ? 'text-[#1e2d1f] hover:text-[#1e2d1f]/70' : 'text-[#a1a1aa] cursor-not-allowed'}`}
            >
              <Redo2 size={20} strokeWidth={2.5} />
            </button>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => editor?.chain().focus().toggleBold().run()}
              title="Жирный (Cmd+B)"
              className={`transition-colors ${editor?.isActive('bold') ? 'text-[#1e2d1f]' : 'text-[#a1a1aa] hover:text-[#1e2d1f]'}`}
            >
              <Bold size={20} strokeWidth={2.5} />
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              title="Курсив (Cmd+I)"
              className={`transition-colors ${editor?.isActive('italic') ? 'text-[#1e2d1f]' : 'text-[#a1a1aa] hover:text-[#1e2d1f]'}`}
            >
              <Italic size={20} strokeWidth={2.5} />
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleUnderline().run()}
              title="Подчёркнутый (Cmd+U)"
              className={`transition-colors ${editor?.isActive('underline') ? 'text-[#1e2d1f]' : 'text-[#a1a1aa] hover:text-[#1e2d1f]'}`}
            >
              <Underline size={20} strokeWidth={2.5} />
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleStrike().run()}
              title="Зачёркнутый"
              className={`transition-colors ${editor?.isActive('strike') ? 'text-[#1e2d1f]' : 'text-[#a1a1aa] hover:text-[#1e2d1f]'}`}
            >
              <Strikethrough size={20} strokeWidth={2.5} />
            </button>
          </div>

          <div className="flex items-center">
            <button
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
              title="Список"
              className={`transition-colors ${editor?.isActive('bulletList') ? 'text-[#1e2d1f]' : 'text-[#a1a1aa] hover:text-[#1e2d1f]'}`}
            >
              <List size={22} strokeWidth={2.5} />
            </button>
          </div>

          <div ref={menuRef} className="flex items-center gap-2 relative">
            <button
              onClick={() => setIsFormatMenuOpen(!isFormatMenuOpen)}
              className={`p-2 rounded-lg transition-colors flex items-center justify-center ${isFormatMenuOpen ? 'bg-[#1e2d1f] text-white' : 'bg-[#f4f4f5] text-[#1e2d1f]'}`}
              title="Настройки редактора"
            >
              <Settings2 size={18} />
            </button>

            {isFormatMenuOpen && (
              <div className="absolute top-full mt-2 left-0 w-60 bg-[#f5f0e8] rounded-2xl shadow-xl border border-[#1e2d1f]/10 p-4 z-[101] flex flex-col gap-4">

                {/* Display toggles */}
                <div className="flex flex-col gap-3">
                  <p className="text-[#1e2d1f]/40 text-[10px] font-bold uppercase tracking-widest">Отображение</p>

                  <div className="flex items-center justify-between cursor-pointer" onClick={() => onShowWordCountChange(!showWordCount)}>
                    <span className="text-[#1e2d1f] text-[14px] font-medium">Счётчик слов</span>
                    <button className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${showWordCount ? 'bg-[#1e2d1f]' : 'bg-[#1e2d1f]/20'}`}>
                      <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${showWordCount ? 'left-5' : 'left-1'}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between cursor-pointer" onClick={() => onIndentParagraphsChange(!indentParagraphs)}>
                    <span className="text-[#1e2d1f] text-[14px] font-medium">Отступ абзацев</span>
                    <button className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${indentParagraphs ? 'bg-[#1e2d1f]' : 'bg-[#1e2d1f]/20'}`}>
                      <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${indentParagraphs ? 'left-5' : 'left-1'}`} />
                    </button>
                  </div>
                </div>

                {/* Text width */}
                <div className="flex flex-col gap-2">
                  <p className="text-[#1e2d1f]/40 text-[10px] font-bold uppercase tracking-widest">Ширина страницы</p>
                  <div className="flex bg-[#1e2d1f]/8 p-1 rounded-xl">
                    {(['narrow', 'medium', 'wide'] as const).map((w, _, arr) => (
                      <button
                        key={w}
                        onClick={() => handleWidthChange(w)}
                        className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${textWidth === w ? 'bg-[#1e2d1f] text-white shadow-sm' : 'text-[#1e2d1f]/50 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/10'}`}
                      >
                        {w === 'narrow' ? 'Узкая' : w === 'medium' ? 'Средняя' : 'Широкая'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Keyboard shortcuts */}
                <div className="border-t border-[#1e2d1f]/10 pt-3">
                  <p className="text-[#1e2d1f]/40 text-[10px] font-bold uppercase tracking-widest mb-2">Горячие клавиши</p>
                  <div className="flex flex-col gap-1.5 text-[12px]">
                    <div className="flex justify-between text-[#1e2d1f]/60">
                      <span>Сохранить</span>
                      <kbd className="font-mono bg-[#1e2d1f]/8 px-1.5 py-0.5 rounded text-[10px]">⌘S</kbd>
                    </div>
                    <div className="flex justify-between text-[#1e2d1f]/60">
                      <span>Найти</span>
                      <kbd className="font-mono bg-[#1e2d1f]/8 px-1.5 py-0.5 rounded text-[10px]">⌘F</kbd>
                    </div>
                    <div className="flex justify-between text-[#1e2d1f]/60">
                      <span>Закрыть панель</span>
                      <kbd className="font-mono bg-[#1e2d1f]/8 px-1.5 py-0.5 rounded text-[10px]">Esc</kbd>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
              className={`px-1.5 py-1 transition-colors flex items-baseline gap-[1px] ${editor?.isActive('heading', { level: 1 }) ? 'text-[#1e2d1f]' : 'text-black/30 hover:text-[#1e2d1f]'}`}
            >
              <span className="font-serif text-[18px]">H</span>
              <span className="font-serif text-[12px] opacity-70 border-b border-transparent">1</span>
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
              className={`px-1.5 py-1 transition-colors flex items-baseline gap-[1px] ${editor?.isActive('heading', { level: 2 }) ? 'text-[#1e2d1f]' : 'text-black/30 hover:text-[#1e2d1f]'}`}
            >
              <span className="font-serif text-[16px]">H</span>
              <span className="font-serif text-[11px] opacity-70">2</span>
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
              className={`px-1.5 py-1 transition-colors flex items-baseline gap-[1px] ${editor?.isActive('heading', { level: 3 }) ? 'text-[#1e2d1f]' : 'text-black/30 hover:text-[#1e2d1f]'}`}
            >
              <span className="font-serif text-[14px]">H</span>
              <span className="font-serif text-[10px] opacity-70">3</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onOpenSearch && (
            <button
              onClick={onOpenSearch}
              title="Поиск по тексту (Cmd+F)"
              className="w-8 h-8 rounded-full bg-black/5 hover:bg-black/10 border-none cursor-pointer flex items-center justify-center text-black/50 hover:text-black/80 transition-colors flex-shrink-0"
            >
              <Search size={15} />
            </button>
          )}
          {onOpenExport && (
            <button
              onClick={onOpenExport}
              title="Экспорт и резервная копия"
              className="w-8 h-8 rounded-full bg-black/5 hover:bg-black/10 border-none cursor-pointer flex items-center justify-center text-black/50 hover:text-black/80 transition-colors flex-shrink-0"
            >
              <Download size={15} />
            </button>
          )}
          <button
            onClick={onOpenSettings}
            title="Настройки профиля"
            className="w-8 h-8 rounded-full bg-black/5 hover:bg-black/10 border-none cursor-pointer flex items-center justify-center text-black/50 hover:text-black/80 transition-colors flex-shrink-0"
          >
            <User size={16} />
          </button>
        </div>
      </div>

      {/* Scrollable Writing Area */}
      <div className="absolute inset-0 pt-28 px-8 md:px-16 overflow-y-auto hide-scrollbar scroll-smooth">
        <div className={`${widthClass} mx-auto relative h-full transition-all duration-500`}>
          {chapterTitle && (
            <h1 className="font-serif italic font-normal text-[2.6rem] leading-tight text-[#1e2d1f]/90 mb-10 mt-4 tracking-tight">
              {chapterTitle}
            </h1>
          )}
          <div className={indentParagraphs ? 'tiptap-indent' : ''}>
            <EditorContent editor={editor} />
            {(isDictating || interimTranscript) && (
              <div className="text-[#1e2d1f]/50 italic text-lg leading-[1.8] font-serif mt-2 border-l-2 border-[#1e2d1f]/20 pl-4 py-1">
                {interimTranscript || 'Слушаю вас...'}{' '}
                <span className="animate-pulse inline-block w-1.5 h-4 bg-[#1e2d1f]/50 ml-1 translate-y-[2px]" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content loading overlay — prevents flash of empty editor while chapter content is fetched */}
      {isLoadingContent && (
        <div className="absolute inset-0 top-14 bg-white/80 backdrop-blur-[2px] z-20 flex items-start justify-center pt-32 pointer-events-none">
          <div className="flex flex-col items-center gap-3 opacity-60">
            <div className="flex gap-1.5">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full bg-[#1e2d1f]/30"
                  style={{ animation: `bounce 0.8s ease-in-out ${i * 0.15}s infinite alternate` }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes bounce {
          from { transform: translateY(0); opacity: 0.4; }
          to   { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </main>
  );
}
