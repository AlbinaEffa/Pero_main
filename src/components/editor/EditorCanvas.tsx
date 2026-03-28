import { useState, useRef, useEffect } from 'react';
import { Editor as TiptapEditor } from '@tiptap/react';
import { EditorContent } from '@tiptap/react';
import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, ListTodo,
  Undo2, Redo2, User, Download, Search, ChevronDown,
  Link2, AlignLeft, AlignCenter, AlignRight, AlignJustify, Code, ListIndentIncrease,
  CornerDownLeft, ExternalLink, Trash2, Highlighter, CircleOff, Quote
} from 'lucide-react';
import type { HighlightColor } from './HighlightMarkExtension';
import { toolbarSelectionKey } from './toolbarSelectionExtension';

interface Props {
  editor: TiptapEditor | null;
  isSaving: boolean;
  lastSavedAt?: Date | null;
  saveError?: boolean;
  isLoadingContent?: boolean;
  chapterPrefix?: string;
  chapterTitleSuffix?: string;
  onChapterTitleSuffixChange?: (value: string) => void;
  indentParagraphs: boolean;
  onIndentParagraphsChange: (v: boolean) => void;
  editorFont: EditorFontName;
  onEditorFontChange: (font: EditorFontName) => void;
  isFocusMode?: boolean;
  isDictating: boolean;
  interimTranscript: string;
  onOpenSettings: () => void;
  onOpenSearch?: () => void;
  onOpenExport?: () => void;
}

type InlineMarkName = 'bold' | 'italic' | 'underline' | 'strike' | 'code';
type EditorFontName = 'cormorant' | 'literata' | 'source-serif';
type BlockStyle = 'paragraph' | 'h1' | 'h2' | 'h3';
type ListStyle = 'bulletList' | 'orderedList' | 'taskList';
type SlashCommandId = 'chapterTitle' | 'sceneBreak' | 'h1' | 'h2' | 'h3' | 'blockquote';
type SlashMenuState = {
  query: string;
  range: { from: number; to: number };
  blockRange: { from: number; to: number };
  blockType: string;
  top: number;
  left: number;
};

const HIGHLIGHT_COLORS: { color: HighlightColor; label: string }[] = [
  { color: '#dce8c8', label: 'Sage' },
  { color: '#d9e8f2', label: 'Mist' },
  { color: '#f2dcdd', label: 'Blush' },
  { color: '#e8def3', label: 'Lavender' },
  { color: '#f3e8b8', label: 'Butter' },
];

const SLASH_COMMANDS: {
  id: SlashCommandId;
  label: string;
  hint: string;
  search: string[];
}[] = [
  { id: 'chapterTitle', label: 'Название главы', hint: 'Связано с оглавлением', search: ['chapter', 'title', 'глава', 'название'] },
  { id: 'sceneBreak', label: 'Разделитель сцены', hint: 'Вставить разрыв сцены', search: ['scene', 'break', 'divider', 'сцена', 'разделитель'] },
  { id: 'h1', label: 'Heading 1', hint: 'Крупный заголовок внутри текста', search: ['h1', 'heading', 'заголовок'] },
  { id: 'h2', label: 'Heading 2', hint: 'Средний заголовок внутри текста', search: ['h2', 'heading', 'подзаголовок'] },
  { id: 'h3', label: 'Heading 3', hint: 'Небольшой заголовок внутри текста', search: ['h3', 'heading'] },
  { id: 'blockquote', label: 'Цитата', hint: 'Цитата или эпиграф', search: ['quote', 'blockquote', 'цитата', 'эпиграф'] },
];

function isWordChar(char: string | undefined): boolean {
  return !!char && /[\p{L}\p{N}_'-]/u.test(char);
}

function getWordRangeAtCursor(editor: TiptapEditor): { from: number; to: number; cursorPos: number } | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;

  const { $from } = selection;
  const text = $from.parent.textContent ?? '';
  const offset = $from.parentOffset;

  const charBefore = text[offset - 1];
  const charAfter = text[offset];

  // Only expand to a word if the caret is inside or touching one.
  if (!isWordChar(charBefore) && !isWordChar(charAfter)) return null;

  let startOffset = offset;
  let endOffset = offset;

  while (startOffset > 0 && isWordChar(text[startOffset - 1])) startOffset--;
  while (endOffset < text.length && isWordChar(text[endOffset])) endOffset++;

  if (startOffset === endOffset) return null;

  return {
    from: $from.start() + startOffset,
    to: $from.start() + endOffset,
    cursorPos: selection.from,
  };
}

function getCurrentListStyle(editor: TiptapEditor | null): ListStyle | null {
  if (!editor) return null;
  if (editor.isActive('taskList')) return 'taskList';
  if (editor.isActive('orderedList')) return 'orderedList';
  if (editor.isActive('bulletList')) return 'bulletList';
  return null;
}

function applyInlineMark(editor: TiptapEditor | null, mark: InlineMarkName): void {
  if (!editor) return;

  const runToggle = (chain: ReturnType<TiptapEditor['chain']>) => {
    switch (mark) {
      case 'bold':
        return chain.toggleBold();
      case 'italic':
        return chain.toggleItalic();
      case 'underline':
        return chain.toggleUnderline();
      case 'strike':
        return chain.toggleStrike();
      case 'code':
        return chain.toggleCode();
    }
  };

  const wordRange = getWordRangeAtCursor(editor);
  if (!wordRange) {
    runToggle(editor.chain().focus()).run();
    return;
  }

  runToggle(
    editor.chain()
      .focus()
      .setTextSelection({ from: wordRange.from, to: wordRange.to })
  ).run();

  // Restore a caret inside the same word so the editor doesn't feel "stuck" on a selection.
  editor.chain().focus().setTextSelection(wordRange.cursorPos).run();
}

function applyScriptMark(editor: TiptapEditor | null, kind: 'superscript' | 'subscript'): void {
  if (!editor) return;

  const runToggle = (chain: ReturnType<TiptapEditor['chain']>) => {
    return kind === 'superscript' ? chain.toggleSuperscript() : chain.toggleSubscript();
  };

  const wordRange = getWordRangeAtCursor(editor);
  if (!wordRange) {
    runToggle(editor.chain().focus()).run();
    return;
  }

  runToggle(
    editor.chain()
      .focus()
      .setTextSelection({ from: wordRange.from, to: wordRange.to })
  ).run();

  editor.chain().focus().setTextSelection(wordRange.cursorPos).run();
}

function applyTextHighlight(editor: TiptapEditor | null, color: HighlightColor | null): void {
  if (!editor) return;

  const wordRange = getWordRangeAtCursor(editor);
  const chain = editor.chain().focus();

  if (wordRange) {
    chain.setTextSelection({ from: wordRange.from, to: wordRange.to });
  }

  if (color) {
    chain.setTextHighlight(color).run();
  } else {
    chain.unsetTextHighlight().run();
  }

  if (wordRange) {
    editor.chain().focus().setTextSelection(wordRange.cursorPos).run();
  }
}

function showToolbarSelectionPreview(editor: TiptapEditor | null): void {
  if (!editor || editor.isDestroyed) return;
  const { from, to } = editor.state.selection;
  if (from === to) return;
  editor.view.dispatch(editor.view.state.tr.setMeta(toolbarSelectionKey, { from, to }));
}

function clearToolbarSelectionPreview(editor: TiptapEditor | null): void {
  if (!editor || editor.isDestroyed) return;
  editor.view.dispatch(editor.view.state.tr.setMeta(toolbarSelectionKey, 'clear'));
}

function getSlashMenuState(editor: TiptapEditor | null): SlashMenuState | null {
  if (!editor || editor.isDestroyed) return null;
  const { selection } = editor.state;
  if (!selection.empty) return null;

  const { $from } = selection;
  const parent = $from.parent;
  if (!parent.isTextblock) return null;

  const supportedBlockTypes = new Set(['paragraph', 'heading', 'blockquote']);
  if (!supportedBlockTypes.has(parent.type.name)) return null;

  const text = parent.textContent ?? '';
  if (!text.startsWith('/')) return null;
  if (text.length > 40 || /\s{2,}/.test(text)) return null;

  const coords = editor.view.coordsAtPos(selection.from);
  return {
    query: text.slice(1).trim().toLowerCase(),
    range: { from: $from.start(), to: $from.start() + text.length },
    blockRange: { from: $from.before(), to: $from.after() },
    blockType: parent.type.name,
    top: coords.bottom + 10,
    left: coords.left,
  };
}

export function EditorCanvas({
  editor,
  isSaving,
  lastSavedAt,
  saveError,
  isLoadingContent,
  chapterPrefix = 'Глава',
  chapterTitleSuffix = '',
  onChapterTitleSuffixChange,
  indentParagraphs,
  onIndentParagraphsChange,
  editorFont,
  onEditorFontChange,
  isFocusMode = false,
  isDictating,
  interimTranscript,
  onOpenSettings,
  onOpenSearch,
  onOpenExport,
}: Props) {
  const [isBlockMenuOpen, setIsBlockMenuOpen] = useState(false);
  const [isListMenuOpen, setIsListMenuOpen] = useState(false);
  const [isFontMenuOpen, setIsFontMenuOpen] = useState(false);
  const [isLinkMenuOpen, setIsLinkMenuOpen] = useState(false);
  const [isHighlightMenuOpen, setIsHighlightMenuOpen] = useState(false);
  const [activeHighlightColor, setActiveHighlightColor] = useState<HighlightColor | null>(null);
  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [linkValue, setLinkValue] = useState('https://');
  const menuRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const chapterTitleInputRef = useRef<HTMLInputElement>(null);
  const linkSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const isApplyingHighlightRef = useRef(false);

  useEffect(() => {
    if (!isBlockMenuOpen && !isListMenuOpen && !isFontMenuOpen && !isLinkMenuOpen && !isHighlightMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsBlockMenuOpen(false);
        setIsListMenuOpen(false);
        setIsFontMenuOpen(false);
        setIsLinkMenuOpen(false);
        setIsHighlightMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isBlockMenuOpen, isListMenuOpen, isFontMenuOpen, isLinkMenuOpen, isHighlightMenuOpen]);

  useEffect(() => {
    if (!isLinkMenuOpen) return;
    const id = window.requestAnimationFrame(() => {
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [isLinkMenuOpen]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    if (isLinkMenuOpen && linkSelectionRef.current) {
      showToolbarSelectionPreview(editor);
      editor.view.dispatch(
        editor.view.state.tr.setMeta(toolbarSelectionKey, {
          from: linkSelectionRef.current.from,
          to: linkSelectionRef.current.to,
        })
      );
      return;
    }

    clearToolbarSelectionPreview(editor);
  }, [editor, isLinkMenuOpen]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const handleSelectionUpdate = ({ editor: ed }: { editor: TiptapEditor }) => {
      if (!activeHighlightColor || isApplyingHighlightRef.current) return;
      const { from, to, anchor, head } = ed.state.selection;
      if (from === to) return;
      const isReverseSelection = head < anchor;

      isApplyingHighlightRef.current = true;
      if (isReverseSelection) {
        ed.chain().focus().unsetTextHighlight().run();
      } else {
        ed.chain().focus().setTextHighlight(activeHighlightColor).run();
      }
      window.setTimeout(() => {
        isApplyingHighlightRef.current = false;
      }, 0);
    };

    editor.on('selectionUpdate', handleSelectionUpdate);
    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate);
    };
  }, [editor, activeHighlightColor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const syncSlashMenu = ({ editor: ed }: { editor: TiptapEditor }) => {
      if (isLinkMenuOpen) {
        setSlashMenu(null);
        return;
      }
      setSlashMenu(getSlashMenuState(ed));
    };

    syncSlashMenu({ editor });
    editor.on('selectionUpdate', syncSlashMenu);
    editor.on('update', syncSlashMenu);

    return () => {
      editor.off('selectionUpdate', syncSlashMenu);
      editor.off('update', syncSlashMenu);
    };
  }, [editor, isLinkMenuOpen]);

  useEffect(() => {
    setSlashIndex(0);
  }, [slashMenu?.query]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dom.classList.toggle('highlight-mode', !!activeHighlightColor);
    if (activeHighlightColor) {
      editor.view.dom.style.setProperty('--highlight-selection-color', activeHighlightColor);
    } else {
      editor.view.dom.style.removeProperty('--highlight-selection-color');
    }
    return () => {
      if (!editor.isDestroyed) {
        editor.view.dom.classList.remove('highlight-mode');
        editor.view.dom.style.removeProperty('--highlight-selection-color');
      }
    };
  }, [editor, activeHighlightColor]);

  useEffect(() => {
    if (!activeHighlightColor) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveHighlightColor(null);
        setIsHighlightMenuOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeHighlightColor]);

  const [textWidth, setTextWidth] = useState<'narrow' | 'medium' | 'wide'>(() => {
    return (localStorage.getItem('pero_textWidth') as 'narrow' | 'medium' | 'wide') || 'medium';
  });
  const handleWidthChange = (w: 'narrow' | 'medium' | 'wide') => {
    setTextWidth(w);
    localStorage.setItem('pero_textWidth', w);
  };

  const widthClass = {
    narrow: 'max-w-[44rem]',
    medium: 'max-w-[56rem]',
    wide: 'max-w-[68rem]',
  }[textWidth];

  const editorFontClass = {
    cormorant: 'editor-font-cormorant',
    literata: 'editor-font-literata',
    'source-serif': 'editor-font-source-serif',
  }[editorFont];

  const currentBlockStyle: BlockStyle = editor?.isActive('heading', { level: 1 })
    ? 'h1'
    : editor?.isActive('heading', { level: 2 })
      ? 'h2'
      : editor?.isActive('heading', { level: 3 })
        ? 'h3'
        : 'paragraph';

  const currentBlockLabel = {
    paragraph: 'Текст',
    h1: 'H1',
    h2: 'H2',
    h3: 'H3',
  }[currentBlockStyle];

  const currentFontLabel = {
    cormorant: 'Cormorant',
    literata: 'Literata',
    'source-serif': 'Source Serif',
  }[editorFont];

  const currentListStyle = getCurrentListStyle(editor);

  const applyBlockStyle = (style: BlockStyle) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (style === 'paragraph') chain.setParagraph().run();
    if (style === 'h1') chain.toggleHeading({ level: 1 }).run();
    if (style === 'h2') chain.toggleHeading({ level: 2 }).run();
    if (style === 'h3') chain.toggleHeading({ level: 3 }).run();
    setIsBlockMenuOpen(false);
  };

  const filteredSlashCommands = slashMenu
    ? SLASH_COMMANDS.filter(command => {
        if (!slashMenu.query) return true;
        return command.search.some(term => term.includes(slashMenu.query));
      })
    : [];

  const runSlashCommand = (commandId: SlashCommandId) => {
    if (!editor || !slashMenu) return;
    const chain = editor.chain().focus().deleteRange(slashMenu.range);

    if (commandId === 'chapterTitle') {
      chain.setParagraph().run();
      requestAnimationFrame(() => chapterTitleInputRef.current?.focus());
      setSlashMenu(null);
      return;
    }
    if (commandId === 'sceneBreak') {
      editor
        .chain()
        .focus()
        .deleteRange(slashMenu.blockRange)
        .insertContent([{ type: 'sceneBreak' }, { type: 'paragraph' }])
        .run();
      setSlashMenu(null);
      return;
    }
    if (commandId === 'h1') chain.setHeading({ level: 1 }).run();
    if (commandId === 'h2') chain.setHeading({ level: 2 }).run();
    if (commandId === 'h3') chain.setHeading({ level: 3 }).run();
    if (commandId === 'blockquote') {
      if (slashMenu.blockType !== 'blockquote') {
        chain.setParagraph().toggleBlockquote().run();
      } else {
        chain.run();
      }
    }

    setSlashMenu(null);
  };

  useEffect(() => {
    if (!slashMenu || filteredSlashCommands.length === 0) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashIndex(prev => (prev + 1) % filteredSlashCommands.length);
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashIndex(prev => (prev - 1 + filteredSlashCommands.length) % filteredSlashCommands.length);
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        runSlashCommand(filteredSlashCommands[slashIndex]?.id ?? filteredSlashCommands[0].id);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setSlashMenu(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [slashMenu, filteredSlashCommands, slashIndex]);

  const applyListStyle = (style: ListStyle) => {
    if (!editor) return;

    const currentStyle = getCurrentListStyle(editor);

    const toggleCurrentOff = () => {
      if (currentStyle === 'bulletList') editor.chain().focus().toggleBulletList().run();
      if (currentStyle === 'orderedList') editor.chain().focus().toggleOrderedList().run();
      if (currentStyle === 'taskList') editor.chain().focus().toggleTaskList().run();
    };

    const toggleTargetOn = () => {
      if (style === 'bulletList') editor.chain().focus().toggleBulletList().run();
      if (style === 'orderedList') editor.chain().focus().toggleOrderedList().run();
      if (style === 'taskList') editor.chain().focus().toggleTaskList().run();
    };

    if (currentStyle === style) {
      toggleCurrentOff();
      setIsListMenuOpen(false);
      return;
    }

    if (currentStyle) {
      toggleCurrentOff();
    }

    toggleTargetOn();
    setIsListMenuOpen(false);
  };

  const handleLinkAction = () => {
    if (!editor) return;
    const selection = editor.state.selection;
    let range: { from: number; to: number } | null = null;

    if (editor.isActive('link')) {
      editor.chain().focus().extendMarkRange('link').run();
      range = {
        from: editor.state.selection.from,
        to: editor.state.selection.to,
      };
    } else if (!selection.empty) {
      range = { from: selection.from, to: selection.to };
    } else {
      const wordRange = getWordRangeAtCursor(editor);
      if (wordRange) {
        range = { from: wordRange.from, to: wordRange.to };
      }
    }

    if (!range) return;

    linkSelectionRef.current = range;
    editor.view.dispatch(
      editor.view.state.tr.setMeta(toolbarSelectionKey, {
        from: range.from,
        to: range.to,
      })
    );
    setLinkValue(editor.getAttributes('link').href ?? 'https://');
    setIsLinkMenuOpen(true);
    setIsBlockMenuOpen(false);
    setIsListMenuOpen(false);
    setIsFontMenuOpen(false);
  };

  const applyLink = () => {
    if (!editor || !linkSelectionRef.current) return;
    const value = linkValue.trim();
    if (!value) return;

    const href = /^(https?:\/\/|mailto:|tel:)/i.test(value) ? value : `https://${value}`;
    editor.chain()
      .focus()
      .setTextSelection(linkSelectionRef.current)
      .extendMarkRange('link')
      .setLink({ href })
      .run();

    setIsLinkMenuOpen(false);
    linkSelectionRef.current = null;
  };

  const removeLink = () => {
    if (!editor || !linkSelectionRef.current) return;
    editor.chain()
      .focus()
      .setTextSelection(linkSelectionRef.current)
      .extendMarkRange('link')
      .unsetLink()
      .run();
    setIsLinkMenuOpen(false);
    linkSelectionRef.current = null;
  };

  const openLinkInNewTab = () => {
    const value = linkValue.trim();
    if (!value) return;
    const href = /^(https?:\/\/|mailto:|tel:)/i.test(value) ? value : `https://${value}`;
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  const armHighlightMode = (color: HighlightColor) => {
    if (!editor) return;
    setActiveHighlightColor(color);

    const { from, to } = editor.state.selection;
    if (from !== to) {
      applyTextHighlight(editor, color);
    }
  };

  const clearHighlightMode = () => {
    setActiveHighlightColor(null);
    setIsHighlightMenuOpen(false);
  };

  return (
    <main className="flex-1 flex flex-col relative bg-transparent shadow-[-10px_0_20px_rgba(0,0,0,0.02)] z-10 transition-all duration-300">
      {!isFocusMode && (
      <>
      {/* Top Formatting Toolbar */}
      <div
        className="h-14 border-b border-[#1e2d1f]/10 bg-[#f5f0e8]/90 backdrop-blur-md flex items-center justify-between px-6 sticky top-0 z-30 shrink-0"
        onMouseEnter={() => {
          if (isLinkMenuOpen && linkSelectionRef.current && editor && !editor.isDestroyed) {
            editor.view.dispatch(
              editor.view.state.tr.setMeta(toolbarSelectionKey, {
                from: linkSelectionRef.current.from,
                to: linkSelectionRef.current.to,
              })
            );
            return;
          }
          showToolbarSelectionPreview(editor);
        }}
        onMouseLeave={() => {
          if (isLinkMenuOpen) return;
          clearToolbarSelectionPreview(editor);
        }}
      >
        <div className="w-8" />
        <div className="flex items-center gap-4">
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

          <div className="w-px h-6 bg-[#1e2d1f]/10" />

          <div ref={menuRef} className="flex items-center gap-3 relative">
            <div className="relative">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setIsBlockMenuOpen(v => !v);
                  setIsListMenuOpen(false);
                  setIsFontMenuOpen(false);
                  setIsHighlightMenuOpen(false);
                }}
                className={`px-2 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
                  isBlockMenuOpen || currentBlockStyle !== 'paragraph'
                    ? 'text-[#1e2d1f] bg-[#1e2d1f]/6'
                    : 'text-black/55 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'
                }`}
                title="Тип текста"
              >
                <span className="font-serif text-[18px] leading-none tracking-tight">{currentBlockLabel}</span>
                <ChevronDown size={14} className="opacity-55" />
              </button>
              {isBlockMenuOpen && (
                <div className="absolute top-full mt-2 left-0 min-w-32 bg-[#f5f0e8] rounded-xl shadow-lg border border-[#1e2d1f]/10 p-1.5 z-[101]">
                  {([
                    { key: 'paragraph', label: 'Текст' },
                    { key: 'h1', label: 'H1' },
                    { key: 'h2', label: 'H2' },
                    { key: 'h3', label: 'H3' },
                  ] as const).map((item) => (
                    <button
                      key={item.key}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applyBlockStyle(item.key)}
                      className={`w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                        currentBlockStyle === item.key
                          ? 'bg-[#1e2d1f] text-white'
                          : 'text-[#1e2d1f]/75 hover:bg-[#1e2d1f]/6'
                      }`}
                    >
                      <span className="font-serif tracking-tight">{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setIsListMenuOpen(v => !v);
                  setIsBlockMenuOpen(false);
                  setIsFontMenuOpen(false);
                  setIsHighlightMenuOpen(false);
                }}
                className={`px-2 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
                  isListMenuOpen || currentListStyle
                    ? 'text-[#1e2d1f] bg-[#1e2d1f]/6'
                    : 'text-black/55 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'
                }`}
                title="Списки"
              >
                <List size={18} strokeWidth={2.2} />
                <ChevronDown size={14} className="opacity-55" />
              </button>
              {isListMenuOpen && (
                <div className="absolute top-full mt-2 left-0 min-w-40 bg-[#f5f0e8] rounded-xl shadow-lg border border-[#1e2d1f]/10 p-1.5 z-[101]">
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyListStyle('bulletList')}
                    className={`w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors flex items-center gap-2 ${
                      currentListStyle === 'bulletList'
                        ? 'bg-[#1e2d1f] text-white'
                        : 'text-[#1e2d1f]/75 hover:bg-[#1e2d1f]/6'
                    }`}
                  >
                    <List size={15} />
                    <span>Маркированный список</span>
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyListStyle('orderedList')}
                    className={`w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors flex items-center gap-2 ${
                      currentListStyle === 'orderedList'
                        ? 'bg-[#1e2d1f] text-white'
                        : 'text-[#1e2d1f]/75 hover:bg-[#1e2d1f]/6'
                    }`}
                  >
                    <ListOrdered size={15} />
                    <span>Нумерованный список</span>
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyListStyle('taskList')}
                    className={`w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors flex items-center gap-2 ${
                      currentListStyle === 'taskList'
                        ? 'bg-[#1e2d1f] text-white'
                        : 'text-[#1e2d1f]/75 hover:bg-[#1e2d1f]/6'
                    }`}
                  >
                    <ListTodo size={15} />
                    <span>Список задач</span>
                  </button>
                </div>
              )}
            </div>

            <div className="w-px h-6 bg-[#1e2d1f]/10" />

            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              title="Цитата"
              className={`p-1 rounded-md transition-colors ${
                editor?.isActive('blockquote')
                  ? 'text-[#1e2d1f] bg-[#1e2d1f]/6'
                  : 'text-[#a1a1aa] hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'
              }`}
            >
              <Quote size={19} strokeWidth={2.2} />
            </button>

            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyInlineMark(editor, 'bold')}
              title="Жирный (Cmd+B)"
              className={`p-1 rounded-md transition-colors ${editor?.isActive('bold') ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-[#a1a1aa] hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'}`}
            >
              <Bold size={20} strokeWidth={2.5} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyInlineMark(editor, 'italic')}
              title="Курсив (Cmd+I)"
              className={`p-1 rounded-md transition-colors ${editor?.isActive('italic') ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-[#a1a1aa] hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'}`}
            >
              <Italic size={20} strokeWidth={2.5} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyInlineMark(editor, 'strike')}
              title="Зачёркнутый"
              className={`p-1 rounded-md transition-colors ${editor?.isActive('strike') ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-[#a1a1aa] hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'}`}
            >
              <Strikethrough size={20} strokeWidth={2.5} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyInlineMark(editor, 'code')}
              title="Код (Cmd+E)"
              className={`p-1 rounded-md transition-colors ${editor?.isActive('code') ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-[#a1a1aa] hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'}`}
            >
              <Code size={19} strokeWidth={2.3} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyInlineMark(editor, 'underline')}
              title="Подчёркнутый (Cmd+U)"
              className={`p-1 rounded-md transition-colors ${editor?.isActive('underline') ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-[#a1a1aa] hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'}`}
            >
              <Underline size={20} strokeWidth={2.5} />
            </button>
            <div className="relative">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (activeHighlightColor) {
                    clearHighlightMode();
                    return;
                  }
                  setIsHighlightMenuOpen(v => !v);
                  setIsBlockMenuOpen(false);
                  setIsListMenuOpen(false);
                  setIsFontMenuOpen(false);
                  setIsLinkMenuOpen(false);
                }}
                title="Выделение маркером"
                className={`p-1 rounded-md transition-colors ${
                  activeHighlightColor || editor?.isActive('textHighlight') || isHighlightMenuOpen
                    ? 'text-[#7d6adf] bg-[#7d6adf]/10'
                    : 'text-[#a1a1aa] hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'
                }`}
              >
                <Highlighter size={19} strokeWidth={2.2} />
              </button>
              {isHighlightMenuOpen && (
                <div className="absolute top-full mt-3 left-1/2 -translate-x-1/2 bg-[#f5f0e8] rounded-[28px] shadow-[0_18px_50px_rgba(30,45,31,0.12)] border border-[#1e2d1f]/8 px-4 py-3 z-[110]">
                  <div className="flex items-center gap-3">
                    {HIGHLIGHT_COLORS.map((item) => (
                      <button
                        key={item.color}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          armHighlightMode(item.color);
                          setIsHighlightMenuOpen(false);
                        }}
                        title={item.label}
                        className={`w-10 h-10 rounded-full border-2 transition-transform hover:scale-105 ${
                          activeHighlightColor === item.color || editor?.isActive('textHighlight', { color: item.color })
                            ? 'border-[#1e2d1f]/35'
                            : 'border-transparent'
                        }`}
                        style={{ backgroundColor: item.color }}
                      />
                    ))}
                    <div className="w-px h-8 bg-[#1e2d1f]/10 mx-1" />
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        applyTextHighlight(editor, null);
                        clearHighlightMode();
                      }}
                      title="Убрать выделение"
                      className="w-10 h-10 rounded-full border border-[#1e2d1f]/12 text-[#6b7280] flex items-center justify-center hover:bg-[#1e2d1f]/4 transition-colors"
                    >
                      <CircleOff size={20} strokeWidth={2.1} />
                    </button>
                  </div>
                  <div className="mt-2 text-[11px] leading-none text-[#1e2d1f]/45 flex items-center justify-center gap-10">
                    <span>→ выделить</span>
                    <span>← стереть</span>
                  </div>
                </div>
              )}
            </div>
            <div className="relative">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (isLinkMenuOpen) {
                    linkSelectionRef.current = null;
                    setIsLinkMenuOpen(false);
                    return;
                  }
                  handleLinkAction();
                }}
                title={editor?.isActive('link') ? 'Изменить ссылку' : 'Добавить ссылку'}
                className={`p-1 rounded-md transition-colors ${editor?.isActive('link') || isLinkMenuOpen ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-[#a1a1aa] hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'}`}
              >
                <Link2 size={20} strokeWidth={2.3} />
              </button>

              {isLinkMenuOpen && (
                <div className="absolute top-full mt-3 left-1/2 -translate-x-1/2 min-w-[320px] bg-[#f5f0e8] rounded-[26px] shadow-[0_18px_50px_rgba(30,45,31,0.12)] border border-[#1e2d1f]/8 px-3 py-2.5 z-[110] flex items-center gap-2">
                  <input
                    ref={linkInputRef}
                    type="text"
                    value={linkValue}
                    onChange={(e) => setLinkValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        applyLink();
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        linkSelectionRef.current = null;
                        setIsLinkMenuOpen(false);
                      }
                    }}
                    placeholder="Вставьте ссылку..."
                    className="flex-1 bg-transparent outline-none text-[15px] text-[#1e2d1f] placeholder:text-[#1e2d1f]/35 px-2"
                  />
                  <div className="w-px self-stretch bg-[#1e2d1f]/10" />
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={applyLink}
                    title="Применить ссылку"
                    className="p-2 rounded-xl text-[#8e8e97] hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4 transition-colors"
                  >
                    <CornerDownLeft size={18} strokeWidth={2.1} />
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={openLinkInNewTab}
                    title="Открыть ссылку"
                    className="p-2 rounded-xl text-[#8e8e97] hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4 transition-colors"
                  >
                    <ExternalLink size={18} strokeWidth={2.1} />
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={removeLink}
                    title="Удалить ссылку"
                    className="p-2 rounded-xl text-[#8e8e97] hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4 transition-colors"
                  >
                    <Trash2 size={18} strokeWidth={2.1} />
                  </button>
                </div>
              )}
            </div>

            <div className="w-px h-6 bg-[#1e2d1f]/10" />

            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyScriptMark(editor, 'superscript')}
              title="Верхний индекс"
              className={`px-1 py-1 rounded-md transition-colors text-[20px] leading-none ${
                editor?.isActive('superscript') ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-[#a1a1aa] hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'
              }`}
            >
              x²
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyScriptMark(editor, 'subscript')}
              title="Нижний индекс"
              className={`px-1 py-1 rounded-md transition-colors text-[20px] leading-none ${
                editor?.isActive('subscript') ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-[#a1a1aa] hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'
              }`}
            >
              x₂
            </button>

            <div className="w-px h-6 bg-[#1e2d1f]/10" />

            <div className="flex items-center gap-3">
              {([
                { key: 'left', icon: AlignLeft, title: 'По левому краю' },
                { key: 'center', icon: AlignCenter, title: 'По центру' },
                { key: 'right', icon: AlignRight, title: 'По правому краю' },
                { key: 'justify', icon: AlignJustify, title: 'По ширине' },
              ] as const).map((item) => {
                const Icon = item.icon;
                const isActive = item.key === 'left'
                  ? !editor?.isActive({ textAlign: 'center' }) && !editor?.isActive({ textAlign: 'right' }) && !editor?.isActive({ textAlign: 'justify' })
                  : !!editor?.isActive({ textAlign: item.key });

                return (
                  <button
                    key={item.key}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => item.key === 'left'
                      ? editor?.chain().focus().unsetTextAlign().run()
                      : editor?.chain().focus().setTextAlign(item.key).run()}
                    title={item.title}
                    className={`p-1 rounded-md transition-colors ${isActive ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-[#a1a1aa] hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'}`}
                  >
                    <Icon size={20} strokeWidth={2.2} />
                  </button>
                );
              })}
            </div>

            <div className="w-px h-6 bg-[#1e2d1f]/10" />

            <div className="relative">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setIsFontMenuOpen(v => !v);
                  setIsBlockMenuOpen(false);
                  setIsListMenuOpen(false);
                }}
                className={`px-2 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
                  isFontMenuOpen ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-black/55 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'
                } ${editorFontClass}`}
                title="Шрифт рукописи"
              >
                <span className="text-[18px] leading-none tracking-tight">{currentFontLabel}</span>
                <ChevronDown size={14} className="opacity-55" />
              </button>
              {isFontMenuOpen && (
                <div className="absolute top-full mt-2 left-0 min-w-44 bg-[#f5f0e8] rounded-xl shadow-lg border border-[#1e2d1f]/10 p-1.5 z-[101]">
                  {([
                    { key: 'cormorant', label: 'Cormorant' },
                    { key: 'literata', label: 'Literata' },
                    { key: 'source-serif', label: 'Source Serif' },
                  ] as const).map((font) => (
                    <button
                      key={font.key}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onEditorFontChange(font.key);
                        setIsFontMenuOpen(false);
                      }}
                      className={`w-full rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                        editorFont === font.key
                          ? 'bg-[#1e2d1f] text-white'
                          : 'text-[#1e2d1f]/75 hover:bg-[#1e2d1f]/6'
                      }`}
                    >
                      <div className={`text-[15px] leading-none ${font.key === 'cormorant' ? 'font-serif' : font.key === 'literata' ? 'editor-font-literata' : 'editor-font-source-serif'}`}>
                        {font.label}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-[#1e2d1f]/8 bg-[#f8f4ec]/92 px-2 py-1">
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onIndentParagraphsChange(!indentParagraphs)}
              title="Красная строка"
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                indentParagraphs
                  ? 'text-[#1e2d1f] bg-[#1e2d1f]/8'
                  : 'text-[#a1a1aa] hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'
              }`}
            >
              <ListIndentIncrease size={18} strokeWidth={2.2} />
            </button>

            <div className="w-px h-5 bg-[#1e2d1f]/10" />

            <div className="flex items-center rounded-full border border-[#1e2d1f]/8 bg-[#f8f4ec] p-1 gap-1">
              {([
                { key: 'narrow', title: 'Узкая', label: 'S' },
                { key: 'medium', title: 'Средняя', label: 'M' },
                { key: 'wide', title: 'Широкая', label: 'L' },
              ] as const).map((item) => (
                <button
                  key={item.key}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleWidthChange(item.key)}
                  title={`Ширина страницы: ${item.title}`}
                  className={`min-w-9 h-8 px-2 rounded-full flex items-center justify-center transition-colors text-[12px] font-medium tracking-[0.08em] ${
                    textWidth === item.key
                      ? 'bg-[#1e2d1f] text-white shadow-sm'
                      : 'text-[#1e2d1f]/50 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/5'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="w-px h-6 bg-[#1e2d1f]/10" />

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
      </>
      )}

      {slashMenu && filteredSlashCommands.length > 0 && (
        <div
          className="fixed z-[120] w-[320px] rounded-2xl border border-[#1e2d1f]/8 bg-[#f5f0e8]/96 backdrop-blur-md shadow-[0_18px_50px_rgba(30,45,31,0.12)] p-2"
          style={{ top: slashMenu.top, left: Math.max(20, slashMenu.left - 32) }}
        >
          <div className="px-2.5 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1e2d1f]/38">
            Вставить блок
          </div>
          <div className="space-y-1">
            {filteredSlashCommands.map((command, index) => (
              <button
                key={command.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runSlashCommand(command.id)}
                className={`w-full rounded-xl px-3 py-2 text-left transition-colors ${
                  slashIndex === index
                    ? 'bg-[#1e2d1f] text-white'
                    : 'hover:bg-[#1e2d1f]/5 text-[#1e2d1f]'
                }`}
              >
                <div className="text-[14px] leading-none font-medium">{command.label}</div>
                <div className={`mt-1 text-[12px] leading-snug ${
                  slashIndex === index ? 'text-white/72' : 'text-[#1e2d1f]/48'
                }`}>
                  {command.hint}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Scrollable Writing Area */}
      <div className={`absolute inset-0 px-8 md:px-16 overflow-y-auto hide-scrollbar scroll-smooth ${isFocusMode ? 'pt-8' : 'pt-28'}`}>
        <div className={`${widthClass} mx-auto relative h-full transition-all duration-500`}>
          <div className={`${editorFontClass} mb-10 ${isFocusMode ? 'mt-2' : 'mt-4'} flex items-baseline gap-4 text-[#1e2d1f]/90`}>
            <span className="text-[2.35rem] leading-tight tracking-[-0.02em] shrink-0 font-medium">
              {chapterPrefix}
            </span>
            <span className="text-[2rem] leading-none text-[#1e2d1f]/16 shrink-0 translate-y-[-0.04em]">|</span>
            <input
              ref={chapterTitleInputRef}
              value={chapterTitleSuffix}
              onChange={(e) => onChapterTitleSuffixChange?.(e.target.value)}
              placeholder="Введите название главы"
              className="min-w-[18rem] flex-1 bg-transparent border-none outline-none text-[2.35rem] leading-tight tracking-[-0.02em] font-medium placeholder:text-[#1e2d1f]/25"
              style={{ fontFamily: 'inherit' }}
            />
          </div>
          <div className={`${indentParagraphs ? 'tiptap-indent' : ''} ${editorFontClass}`}>
            <EditorContent editor={editor} />
            {(isDictating || interimTranscript) && (
              <div className={`${editorFontClass} text-[#1e2d1f]/50 italic text-lg leading-[1.8] mt-2 border-l-2 border-[#1e2d1f]/20 pl-4 py-1`}>
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
