import { useState } from 'react';
import { Editor as TiptapEditor } from '@tiptap/react';
import { EditorContent } from '@tiptap/react';
import { createPortal } from 'react-dom';
import {
  Bold, Italic, Underline, Strikethrough, List,
  Undo2, Redo2, Sparkles, User, Download, AlertCircle, Settings2
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
  onOpenExport,
}: Props) {
  const [isFormatMenuOpen, setIsFormatMenuOpen] = useState(false);
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
    wide: 'max-w-4xl'
  }[textWidth];

  // Decide what to show in the save indicator
  const saveStatusEl = isSaving ? (
    <div className="flex items-center gap-1.5 text-[#1e2d1f]/40 font-medium text-xs">
      <Sparkles size={12} className="animate-pulse" /> Сохранение...
    </div>
  ) : saveError ? (
    <div className="flex items-center gap-1.5 text-xs font-medium text-red-500/80" title="Нажмите Cmd+S / Ctrl+S чтобы попробовать снова">
      <AlertCircle size={12} /> Не сохранено
    </div>
  ) : lastSavedAt ? (
    <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600/70">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
      Сохранено
    </div>
  ) : null;

  // Show badge when word count is on, OR when there's an error (always surface errors)
  const showBadge = showWordCount || saveError;

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

          <div className="flex items-center gap-2 relative">
            <button
              onClick={() => setIsFormatMenuOpen(!isFormatMenuOpen)}
              className={`p-2 rounded-lg transition-colors flex items-center justify-center ${isFormatMenuOpen ? 'bg-[#1e2d1f] text-white' : 'bg-[#f4f4f5] text-[#1e2d1f]'}`}
              title="Настройки отображения"
            >
              <Settings2 size={18} />
            </button>

            {isFormatMenuOpen && (
              <>
                {createPortal(
                  <div className="fixed inset-0 z-[100]" onClick={(e) => { e.stopPropagation(); setIsFormatMenuOpen(false); }} />,
                  document.body
                )}
                <div className="absolute top-full mt-2 left-0 w-64 bg-[#2d3748] rounded-xl shadow-xl border border-white/10 p-5 z-[101] flex flex-col gap-5">
                  <div
                    className="flex items-center gap-4 cursor-pointer"
                    onClick={() => onShowWordCountChange(!showWordCount)}
                  >
                    <button
                      className={`w-[52px] h-7 rounded-full transition-colors relative shrink-0 ${showWordCount ? 'bg-[#bca4ff]' : 'bg-[#4b5563] ring-2 ring-[#6b21a8]'}`}
                    >
                      <div className={`w-6 h-6 rounded-full bg-white absolute top-0.5 transition-transform ${showWordCount ? 'translate-x-[26px] left-0' : 'translate-x-0.5 left-0'}`} />
                    </button>
                    <span className="text-white text-[15px] font-medium tracking-wide">Количество слов</span>
                  </div>

                  <div
                    className="flex items-center gap-4 cursor-pointer"
                    onClick={() => onIndentParagraphsChange(!indentParagraphs)}
                  >
                    <button
                      className={`w-[52px] h-7 rounded-full transition-colors relative shrink-0 ${indentParagraphs ? 'bg-[#bca4ff]' : 'bg-[#4b5563] ring-2 ring-[#6b21a8]'}`}
                    >
                      <div className={`w-6 h-6 rounded-full bg-white absolute top-0.5 transition-transform ${indentParagraphs ? 'translate-x-[26px] left-0' : 'translate-x-0.5 left-0'}`} />
                    </button>
                    <span className="text-white text-[15px] font-medium tracking-wide">Отступ абзацев</span>
                  </div>

                  {/* Text Width Toggle */}
                  <div className="flex flex-col gap-2 mt-2">
                    <span className="text-white/60 text-[13px] font-medium tracking-wide">Ширина страницы</span>
                    <div className="flex bg-white/5 p-1 rounded-xl">
                      <button
                        onClick={() => handleWidthChange('narrow')}
                        className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${textWidth === 'narrow' ? 'bg-white/20 text-white shadow-sm' : 'text-white/40 hover:text-white/80 hover:bg-white/10'}`}
                      >
                        Узкая
                      </button>
                      <button
                        onClick={() => handleWidthChange('medium')}
                        className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${textWidth === 'medium' ? 'bg-white/20 text-white shadow-sm' : 'text-white/40 hover:text-white/80 hover:bg-white/10'}`}
                      >
                        Средняя
                      </button>
                      <button
                        onClick={() => handleWidthChange('wide')}
                        className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${textWidth === 'wide' ? 'bg-white/20 text-white shadow-sm' : 'text-white/40 hover:text-white/80 hover:bg-white/10'}`}
                      >
                        Широкая
                      </button>
                    </div>
                  </div>

                  {/* Keyboard shortcuts hint */}
                  <div className="border-t border-white/10 pt-4 mt-2">
                    <p className="text-white/30 text-[11px] font-semibold uppercase tracking-widest mb-3">Горячие клавиши</p>
                    <div className="flex flex-col gap-2 text-[12px] text-white/50">
                      <div className="flex justify-between"><span>Сохранить</span><kbd className="font-mono bg-white/10 px-1.5 py-0.5 rounded text-[10px]">⌘S</kbd></div>
                      <div className="flex justify-between"><span>Найти</span><kbd className="font-mono bg-white/10 px-1.5 py-0.5 rounded text-[10px]">⌘F</kbd></div>
                      <div className="flex justify-between"><span>Закрыть панель</span><kbd className="font-mono bg-white/10 px-1.5 py-0.5 rounded text-[10px]">Esc</kbd></div>
                    </div>
                  </div>
                </div>
              </>
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

      {/* Save status + word count badge */}
      {showBadge && (
        <div className="absolute bottom-6 right-6 bg-white/90 backdrop-blur-md shadow-sm border border-[#1e2d1f]/5 rounded-xl px-4 py-2 flex items-center gap-3 z-30">
          {saveStatusEl}
          {showWordCount && saveStatusEl && (
            <div className="w-px h-3 bg-[#1e2d1f]/10 shrink-0" />
          )}
          {showWordCount && (
            <div className="flex items-center gap-2">
              <span className="text-[#1e2d1f]/60 font-medium text-sm">Слов:</span>
              <span className="text-[#1e2d1f] font-bold text-sm">{wordCount}</span>
            </div>
          )}
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
