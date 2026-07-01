import { useState, useRef, useEffect, useCallback } from 'react';
import { Editor as TiptapEditor } from '@tiptap/react';
import { EditorContent } from '@tiptap/react';
import { EditorFirstRunHints } from './EditorFirstRunHints';
import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, ListTodo,
  Undo2, Redo2, Download, Search, ChevronDown, PanelLeft, PanelRight,
  Link2, AlignLeft, AlignCenter, AlignRight, AlignJustify, Code, ListIndentIncrease,
  CornerDownLeft, ExternalLink, Trash2, Highlighter, CircleOff, Quote, StretchHorizontal, Check,
  MoreHorizontal, Mic
} from 'lucide-react';

import type { HighlightColor } from './HighlightMarkExtension';
import { toolbarSelectionKey } from './toolbarSelectionExtension';
import { CHAPTER_TYPES } from './chapterDisplay';
import { newFootnoteId, footnoteNumberKey } from './FootnoteExtension';
import {
  type ListStyle, type SlashMenuState,
  getWordRangeAtCursor, getCurrentListStyle, applyInlineMark, applyScriptMark,
  applyTextHighlight, showToolbarSelectionPreview, clearToolbarSelectionPreview, getSlashMenuState,
} from './editorCommands';
import { FootnotesArea } from './FootnotesArea';

interface Props {
  editor: TiptapEditor | null;
  isSaving: boolean;
  lastSavedAt?: Date | null;
  saveError?: boolean;
  isLoadingContent?: boolean;
  chapterPrefix?: string;
  chapterTitleSuffix?: string;
  onChapterTitleSuffixChange?: (value: string) => void;
  /** Тип текущей главы и его смена (переключатель в заголовке). */
  chapterType?: string;
  onChapterTypeChange?: (type: string) => void;
  indentParagraphs: boolean;
  onIndentParagraphsChange: (v: boolean) => void;
  editorFont: EditorFontName;
  onEditorFontChange: (font: EditorFontName) => void;
  isFocusMode?: boolean;
  /** Зарезервировать правое поле под гаттер комментариев (режим рецензирования, ≥lg). */
  reserveCommentGutter?: boolean;
  isDictating: boolean;
  interimTranscript: string;
  /** Запустить диктовку из приглашения в пустой главе (#6). */
  onStartDictation?: () => void;
  /** Поддерживается ли диктовка в этом браузере (иначе приглашение без микрофона). */
  isDictationSupported?: boolean;
  onOpenSettings: () => void;
  onOpenSearch?: () => void;
  onOpenExport?: () => void;
  /** Открыть шторку глав на узких экранах (< lg); кнопка-гамбургер видна только там. */
  onOpenChapters?: () => void;
  /** Свёрнут ли сайдбар глав на десктопе — тогда кнопка «показать» видна и на ≥ lg. */
  isChaptersCollapsed?: boolean;
  /** Открыт ли правый спутник «Перо». Когда свёрнут — в тулбаре показываем кнопку раскрытия. */
  isCompanionOpen?: boolean;
  onToggleCompanion?: () => void;
  projectId?: string;
}

type EditorFontName = 'cormorant' | 'literata' | 'source-serif';
type BlockStyle = 'paragraph' | 'h1' | 'h2' | 'h3';
type SlashCommandId =
  | 'chapterTitle' | 'paragraph' | 'h1' | 'h2' | 'h3'
  | 'bulletList' | 'orderedList' | 'taskList'
  | 'blockquote' | 'codeBlock' | 'sceneBreak' | 'footnote';
// ListStyle, SlashMenuState + чистые команды редактора → ./editorCommands

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
  { id: 'chapterTitle', label: 'Название главы',        hint: 'Связано с оглавлением',          search: ['chapter', 'title', 'глава', 'название'] },
  { id: 'paragraph',    label: 'Текст',                 hint: 'Обычный абзац',                   search: ['text', 'paragraph', 'текст', 'абзац'] },
  { id: 'h1',           label: 'Заголовок 1',           hint: 'Крупный заголовок внутри текста', search: ['h1', 'heading', 'заголовок'] },
  { id: 'h2',           label: 'Заголовок 2',           hint: 'Средний заголовок внутри текста', search: ['h2', 'heading', 'подзаголовок', 'заголовок'] },
  { id: 'h3',           label: 'Заголовок 3',           hint: 'Небольшой заголовок внутри текста', search: ['h3', 'heading', 'заголовок'] },
  { id: 'bulletList',   label: 'Маркированный список',  hint: 'Список с точками',                search: ['bullet', 'list', 'ul', 'список', 'маркированный'] },
  { id: 'orderedList',  label: 'Нумерованный список',   hint: 'Список по порядку',               search: ['ordered', 'number', 'list', 'ol', 'нумерованный', 'список'] },
  { id: 'taskList',     label: 'Список задач',          hint: 'Чек-лист с галочками',            search: ['task', 'todo', 'check', 'задача', 'чеклист', 'список'] },
  { id: 'blockquote',   label: 'Цитата',                hint: 'Цитата или эпиграф',              search: ['quote', 'blockquote', 'цитата', 'эпиграф'] },
  { id: 'codeBlock',    label: 'Блок кода',             hint: 'Моноширинный блок',               search: ['code', 'код', 'блок', 'моноширинный'] },
  { id: 'sceneBreak',   label: 'Разделитель сцены',     hint: 'Вставить разрыв сцены',           search: ['scene', 'break', 'divider', 'сцена', 'разделитель'] },
  { id: 'footnote',     label: 'Сноска',                hint: 'Надстрочный маркер с примечанием', search: ['footnote', 'note', 'сноска', 'примечание', 'ref'] },
];


export function EditorCanvas({
  editor,
  isSaving,
  lastSavedAt,
  saveError,
  isLoadingContent,
  chapterPrefix = 'Глава',
  chapterTitleSuffix = '',
  onChapterTitleSuffixChange,
  chapterType = 'chapter',
  onChapterTypeChange,
  indentParagraphs,
  onIndentParagraphsChange,
  editorFont,
  onEditorFontChange,
  isFocusMode = false,
  reserveCommentGutter = false,
  isDictating,
  interimTranscript,
  onStartDictation,
  isDictationSupported,
  onOpenSettings,
  onOpenSearch,
  onOpenExport,
  onOpenChapters,
  isChaptersCollapsed,
  isCompanionOpen,
  onToggleCompanion,
  projectId,
}: Props) {
  const [isBlockMenuOpen, setIsBlockMenuOpen] = useState(false);
  const [isListMenuOpen, setIsListMenuOpen] = useState(false);
  const [isFontMenuOpen, setIsFontMenuOpen] = useState(false);
  const [isLinkMenuOpen, setIsLinkMenuOpen] = useState(false);
  const [isHighlightMenuOpen, setIsHighlightMenuOpen] = useState(false);
  const [isColumnMenuOpen, setIsColumnMenuOpen] = useState(false);
  const [isChapterTypeMenuOpen, setIsChapterTypeMenuOpen] = useState(false);
  // «⋯ Ещё» — переполнение тулбара: контролы, не влезающие в узкую колонку (открыт спутник /
  // узкий ноут), уезжают в это меню. Что прячется — решают container-queries (@container/tb),
  // меню лишь зеркалит спрятанное. Подробности у разметки тулбара ниже.
  const [isOverflowMenuOpen, setIsOverflowMenuOpen] = useState(false);
  // Пустая ли глава — для приглашения писать/диктовать (#6). Реактивно: editor.isEmpty
  // меняется на первом вводе и при загрузке новой главы (setContent эмитит 'update').
  const [isEmptyChapter, setIsEmptyChapter] = useState(true);
  useEffect(() => {
    if (!editor) return;
    const sync = () => setIsEmptyChapter(editor.isEmpty);
    sync();
    editor.on('update', sync);
    editor.on('create', sync);
    return () => { editor.off('update', sync); editor.off('create', sync); };
  }, [editor]);
  // Сноски главы (как в Word): маркер в тексте, текст редактируется в области внизу.
  // Список = отражение узлов-маркеров (id/текст + сквозной номер); пересчёт на каждую транзакцию.
  const [footnotes, setFootnotes] = useState<{ id: string; content: string; number: number }[]>([]);
  const [pendingFocusFootnoteId, setPendingFocusFootnoteId] = useState<string | null>(null);

  useEffect(() => {
    if (!editor) return;
    const recompute = () => {
      const offset = (footnoteNumberKey.getState(editor.state) as { offset: number } | undefined)?.offset ?? 0;
      const list: { id: string; content: string }[] = [];
      editor.state.doc.descendants((n) => { if (n.type.name === 'footnote') list.push({ id: n.attrs.id, content: n.attrs.content ?? '' }); });
      setFootnotes(list.map((f, i) => ({ ...f, number: offset + i + 1 })));
    };
    recompute();
    editor.on('transaction', recompute);
    return () => { editor.off('transaction', recompute); };
  }, [editor]);

  const scrollToFootnoteItem = useCallback((id: string) => {
    const el = document.querySelector(`[data-fn-item="${id}"]`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (el?.querySelector('textarea') as HTMLTextAreaElement | null)?.focus();
  }, []);

  const scrollToFootnoteMarker = useCallback((id: string) => {
    if (!editor) return;
    let dom: Element | null = null;
    try { dom = editor.view.dom.querySelector(`.footnote-ref[data-footnote-id="${id}"]`); } catch { dom = null; }
    (dom as HTMLElement | null)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [editor]);

  const insertFootnote = useCallback(() => {
    if (!editor) return;
    const id = newFootnoteId();
    editor.chain().focus().insertFootnote({ id }).run();
    setPendingFocusFootnoteId(id); // курсор уходит вниз к новой сноске (Word-style)
  }, [editor]);

  // Новая сноска появилась в списке → прокрутить вниз к её полю и сфокусировать.
  useEffect(() => {
    if (!pendingFocusFootnoteId) return;
    if (footnotes.some(f => f.id === pendingFocusFootnoteId)) {
      scrollToFootnoteItem(pendingFocusFootnoteId);
      setPendingFocusFootnoteId(null);
    }
  }, [pendingFocusFootnoteId, footnotes, scrollToFootnoteItem]);

  // Клик по маркеру сноски в тексте → прыжок к её тексту внизу.
  useEffect(() => {
    if (!editor) return;
    const onClick = (e: MouseEvent) => {
      const ref = (e.target as HTMLElement)?.closest?.('.footnote-ref') as HTMLElement | null;
      const id = ref?.getAttribute('data-footnote-id');
      if (id) { e.preventDefault(); scrollToFootnoteItem(id); }
    };
    let dom: HTMLElement | null = null;
    const attach = () => {
      try { dom = editor.view.dom as HTMLElement; } catch { dom = null; }
      if (dom) dom.addEventListener('click', onClick);
    };
    attach();
    editor.on('create', attach);
    return () => {
      editor.off('create', attach);
      if (dom) dom.removeEventListener('click', onClick);
    };
  }, [editor, scrollToFootnoteItem]);
  const [activeHighlightColor, setActiveHighlightColor] = useState<HighlightColor | null>(null);
  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [linkValue, setLinkValue] = useState('https://');
  const menuRef = useRef<HTMLDivElement>(null);
  const columnMenuRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const chapterTitleInputRef = useRef<HTMLInputElement>(null);
  const linkSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const isApplyingHighlightRef = useRef(false);

  useEffect(() => {
    if (!isBlockMenuOpen && !isListMenuOpen && !isFontMenuOpen && !isLinkMenuOpen && !isHighlightMenuOpen && !isColumnMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const inCenter = menuRef.current?.contains(target);
      const inColumn = columnMenuRef.current?.contains(target);
      if (!inCenter && !inColumn) {
        setIsBlockMenuOpen(false);
        setIsListMenuOpen(false);
        setIsFontMenuOpen(false);
        setIsLinkMenuOpen(false);
        setIsHighlightMenuOpen(false);
        setIsColumnMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isBlockMenuOpen, isListMenuOpen, isFontMenuOpen, isLinkMenuOpen, isHighlightMenuOpen, isColumnMenuOpen]);

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
  // Настройки могут менять ширину колонки — слушаем и подхватываем живьём.
  useEffect(() => {
    const onWidth = () => setTextWidth((localStorage.getItem('pero_textWidth') as 'narrow' | 'medium' | 'wide') || 'medium');
    window.addEventListener('pero:textwidth', onWidth);
    return () => window.removeEventListener('pero:textwidth', onWidth);
  }, []);

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
    if (commandId === 'footnote') {
      const id = newFootnoteId();
      editor.chain().focus().deleteRange(slashMenu.blockRange).insertFootnote({ id }).run();
      setSlashMenu(null);
      setPendingFocusFootnoteId(id); // курсор уходит вниз к новой сноске
      return;
    }
    if (commandId === 'paragraph') chain.setParagraph().run();
    if (commandId === 'h1') chain.setHeading({ level: 1 }).run();
    if (commandId === 'h2') chain.setHeading({ level: 2 }).run();
    if (commandId === 'h3') chain.setHeading({ level: 3 }).run();
    if (commandId === 'bulletList') chain.toggleBulletList().run();
    if (commandId === 'orderedList') chain.toggleOrderedList().run();
    if (commandId === 'taskList') chain.toggleTaskList().run();
    if (commandId === 'codeBlock') chain.toggleCodeBlock().run();
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
    <main className="flex-1 min-w-0 flex flex-col relative bg-transparent shadow-[-10px_0_20px_rgba(30,45,31,0.02)] z-10 transition-all duration-300">
      {!isFocusMode && (
      <>
      {/* Top Formatting Toolbar — @container/tb: контролы прячутся в «⋯ Ещё» по ШИРИНЕ КОЛОНКИ
          (а не вьюпорта), поэтому реагирует и на открытие спутника, и на узкий ноут. */}
      <div className="@container/tb sticky top-0 z-30 shrink-0">
      <div
        className="relative min-h-14 border-b border-[#1e2d1f]/10 bg-[#f5f0e8]/90 backdrop-blur-md flex items-center justify-between px-6 max-md:px-3 max-md:flex-wrap max-md:justify-center max-md:gap-y-1 max-md:py-2 max-md:pl-12 md:overflow-x-clip"
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
        <div className="w-8 flex items-center max-md:absolute max-md:left-3 max-md:top-1/2 max-md:-translate-y-1/2 max-md:w-auto">
          {onOpenChapters && (
            <button
              onClick={onOpenChapters}
              title={isChaptersCollapsed ? 'Показать главы' : 'Главы'}
              aria-label={isChaptersCollapsed ? 'Показать панель глав' : 'Главы'}
              className={`p-1.5 rounded-md text-[#1e2d1f]/60 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/5 transition-colors ${
                isChaptersCollapsed ? '' : 'lg:hidden'
              }`}
            >
              <PanelLeft size={20} strokeWidth={2.2} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-4 max-md:flex-wrap max-md:justify-center max-md:gap-y-1">
          <div className="flex items-center gap-3">
            <button
              onClick={() => editor?.chain().focus().undo().run()}
              disabled={!editor?.can().undo()}
              title="Отменить (Cmd+Z)"
              className={`transition-colors ${editor?.can().undo() ? 'text-[#1e2d1f] hover:text-[#1e2d1f]/70' : 'text-ink/45 cursor-not-allowed'}`}
            >
              <Undo2 size={20} strokeWidth={2.5} />
            </button>
            <button
              onClick={() => editor?.chain().focus().redo().run()}
              disabled={!editor?.can().redo()}
              title="Повторить (Cmd+Shift+Z)"
              className={`transition-colors ${editor?.can().redo() ? 'text-[#1e2d1f] hover:text-[#1e2d1f]/70' : 'text-ink/45 cursor-not-allowed'}`}
            >
              <Redo2 size={20} strokeWidth={2.5} />
            </button>
          </div>

          <div className="w-px h-6 bg-[#1e2d1f]/10 max-md:hidden" />

          <div ref={menuRef} className="flex items-center gap-3 relative max-md:flex-wrap max-md:justify-center max-md:gap-y-1">
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
                    : 'text-ink/55 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'
                }`}
                title="Тип текста"
              >
                <span className="text-sm font-medium leading-none">{currentBlockLabel}</span>
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
                      <span className="font-medium">{item.label}</span>
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
                    : 'text-ink/55 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'
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

            <div className="w-px h-6 bg-[#1e2d1f]/10 max-md:hidden" />

            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              title="Цитата"
              className={`max-md:hidden p-1 rounded-md transition-colors ${
                editor?.isActive('blockquote')
                  ? 'text-[#1e2d1f] bg-[#1e2d1f]/6'
                  : 'text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'
              }`}
            >
              <Quote size={19} strokeWidth={2.2} />
            </button>

            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor?.chain().focus().insertSceneBreak().run()}
              title="Разделитель сцены"
              aria-label="Разделитель сцены"
              className="max-md:hidden px-1.5 py-1 rounded-md transition-colors text-[16px] leading-none tracking-[0.12em] font-semibold text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4"
            >
              ***
            </button>

            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyInlineMark(editor, 'bold')}
              title="Жирный (Cmd+B)"
              className={`p-1 rounded-md transition-colors ${editor?.isActive('bold') ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'}`}
            >
              <Bold size={20} strokeWidth={2.5} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyInlineMark(editor, 'italic')}
              title="Курсив (Cmd+I)"
              className={`p-1 rounded-md transition-colors ${editor?.isActive('italic') ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'}`}
            >
              <Italic size={20} strokeWidth={2.5} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyInlineMark(editor, 'strike')}
              title="Зачёркнутый"
              className={`max-md:hidden p-1 rounded-md transition-colors ${editor?.isActive('strike') ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'}`}
            >
              <Strikethrough size={20} strokeWidth={2.5} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyInlineMark(editor, 'code')}
              title="Код (Cmd+E)"
              className={`max-md:hidden p-1 rounded-md transition-colors ${editor?.isActive('code') ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'}`}
            >
              <Code size={19} strokeWidth={2.3} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyInlineMark(editor, 'underline')}
              title="Подчёркнутый (Cmd+U)"
              className={`max-md:hidden p-1 rounded-md transition-colors ${editor?.isActive('underline') ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'}`}
            >
              <Underline size={20} strokeWidth={2.5} />
            </button>
            <div className="relative max-md:hidden">
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
                    : 'text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'
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
                  <div className="mt-2 text-[11px] leading-none text-[#1e2d1f]/60 flex items-center justify-center gap-10">
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
                className={`p-1 rounded-md transition-colors ${editor?.isActive('link') || isLinkMenuOpen ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'}`}
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
                    className="flex-1 bg-transparent outline-none text-[16px] text-[#1e2d1f] placeholder:text-[#1e2d1f]/55 px-2"
                  />
                  <div className="w-px self-stretch bg-[#1e2d1f]/10" />
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={applyLink}
                    title="Применить ссылку"
                    className="p-2 rounded-xl text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4 transition-colors"
                  >
                    <CornerDownLeft size={18} strokeWidth={2.1} />
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={openLinkInNewTab}
                    title="Открыть ссылку"
                    className="p-2 rounded-xl text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4 transition-colors"
                  >
                    <ExternalLink size={18} strokeWidth={2.1} />
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={removeLink}
                    title="Удалить ссылку"
                    className="p-2 rounded-xl text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4 transition-colors"
                  >
                    <Trash2 size={18} strokeWidth={2.1} />
                  </button>
                </div>
              )}
            </div>

            {/* S2 — второй сегмент переполнения: индексы · сноска · выравнивание · отступ · шрифт.
                Прячется в «⋯ Ещё» когда колонка ≤1120px (display:contents → раскладка не ломается). */}
            <div className="contents md:@max-[1120px]/tb:hidden">
            <div className="w-px h-6 bg-[#1e2d1f]/10 max-md:hidden" />

            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyScriptMark(editor, 'superscript')}
              title="Верхний индекс"
              className={`max-md:hidden px-1 py-1 rounded-md transition-colors text-[20px] leading-none ${
                editor?.isActive('superscript') ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'
              }`}
            >
              x²
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyScriptMark(editor, 'subscript')}
              title="Нижний индекс"
              className={`max-md:hidden px-1 py-1 rounded-md transition-colors text-[20px] leading-none ${
                editor?.isActive('subscript') ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'
              }`}
            >
              x₂
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertFootnote()}
              title="Вставить сноску"
              aria-label="Вставить сноску"
              className="max-md:hidden px-1.5 py-1 rounded-md transition-colors text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4 inline-flex items-start leading-none"
            >
              <span className="text-[15px] font-medium">аб</span>
              <span className="text-[9px] font-bold text-[#71597F] ml-px">1</span>
            </button>

            <div className="w-px h-6 bg-[#1e2d1f]/10 max-md:hidden" />

            <div className="flex items-center gap-3 max-md:hidden">
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
                    className={`p-1 rounded-md transition-colors ${isActive ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'}`}
                  >
                    <Icon size={20} strokeWidth={2.2} />
                  </button>
                );
              })}
            </div>

            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onIndentParagraphsChange(!indentParagraphs)}
              title="Красная строка (абзацный отступ)"
              aria-label="Красная строка"
              className={`p-1 rounded-md transition-colors ${
                indentParagraphs
                  ? 'text-[#1e2d1f] bg-[#1e2d1f]/6'
                  : 'text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'
              }`}
            >
              <ListIndentIncrease size={20} strokeWidth={2.2} />
            </button>

            <div className="w-px h-6 bg-[#1e2d1f]/10 max-md:hidden" />

            <div className="relative max-md:hidden">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setIsFontMenuOpen(v => !v);
                  setIsBlockMenuOpen(false);
                  setIsListMenuOpen(false);
                }}
                className={`px-2 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
                  isFontMenuOpen ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-ink/55 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'
                } ${editorFontClass}`}
                title="Шрифт рукописи"
              >
                <span className="text-[16px] leading-none tracking-tight">{currentFontLabel}</span>
                <ChevronDown size={14} className="opacity-55" />
              </button>
              {isFontMenuOpen && (
                <div className="absolute top-full mt-2 left-0 min-w-44 bg-[#f5f0e8] rounded-xl shadow-lg border border-[#1e2d1f]/10 p-1.5 z-[101]">
                  <div className="px-2.5 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#1e2d1f]/55">
                    Шрифт всего текста
                  </div>
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
                      <div className={`text-[16px] leading-none ${font.key === 'cormorant' ? 'font-serif' : font.key === 'literata' ? 'editor-font-literata' : 'editor-font-source-serif'}`}>
                        {font.label}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            </div>

          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* S1 — первый сегмент переполнения (правый кластер): ширина колонки · поиск · экспорт.
              Прячется в «⋯ Ещё» когда колонка < 1200px (display:contents → не ломает раскладку). */}
          <div className="contents md:@max-[1200px]/tb:hidden">
          {/* Ширина колонки — выпадающее меню (нативный паттерн Tiptap, как заголовок/списки) */}
          <div ref={columnMenuRef} className="relative max-md:hidden">
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setIsColumnMenuOpen(v => !v);
                setIsBlockMenuOpen(false);
                setIsListMenuOpen(false);
                setIsFontMenuOpen(false);
                setIsHighlightMenuOpen(false);
              }}
              title="Ширина колонки"
              aria-label="Ширина колонки"
              className={`px-2 py-1.5 rounded-md transition-colors flex items-center gap-1 ${
                isColumnMenuOpen ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'
              }`}
            >
              <StretchHorizontal size={18} strokeWidth={2.1} />
              <ChevronDown size={14} className="opacity-55" />
            </button>
            {isColumnMenuOpen && (
              <div className="absolute top-full mt-2 right-0 min-w-44 bg-[#f5f0e8] rounded-xl shadow-lg border border-[#1e2d1f]/10 p-1.5 z-[101]">
                <div className="px-2.5 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#1e2d1f]/55">
                  Ширина колонки
                </div>
                {([
                  { key: 'narrow', label: 'Узкая',   hint: 'S' },
                  { key: 'medium', label: 'Средняя', hint: 'M' },
                  { key: 'wide',   label: 'Широкая', hint: 'L' },
                ] as const).map((item) => (
                  <button
                    key={item.key}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { handleWidthChange(item.key); setIsColumnMenuOpen(false); }}
                    className={`w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors flex items-center justify-between gap-3 ${
                      textWidth === item.key
                        ? 'bg-[#1e2d1f] text-white'
                        : 'text-[#1e2d1f]/75 hover:bg-[#1e2d1f]/6'
                    }`}
                  >
                    <span className="font-medium">{item.label}</span>
                    <span className={`text-[11px] ${textWidth === item.key ? 'text-white/60' : 'text-[#1e2d1f]/55'}`}>{item.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="w-px h-6 bg-[#1e2d1f]/10 max-md:hidden" />

          {onOpenSearch && (
            <button
              onClick={onOpenSearch}
              title="Поиск по тексту (Cmd+F)"
              className="p-1.5 rounded-md text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4 transition-colors flex items-center justify-center"
            >
              <Search size={18} />
            </button>
          )}
          {onOpenExport && (
            <button
              onClick={onOpenExport}
              title="Экспорт и резервная копия"
              className="p-1.5 rounded-md text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4 transition-colors flex items-center justify-center"
            >
              <Download size={18} />
            </button>
          )}
          </div>
          {/* «⋯ Ещё» — появляется только на десктопе, когда контролы не влезают (колонка ≤1200px).
              Зеркалит спрятанные контролы: S1 (всегда при открытом меню) + S2 (когда колонка ≤1120px). */}
          <div className="relative hidden md:@max-[1200px]/tb:block">
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setIsOverflowMenuOpen(v => !v)}
              title="Ещё"
              aria-label="Ещё инструменты"
              className={`p-1.5 rounded-md transition-colors flex items-center justify-center ${
                isOverflowMenuOpen ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'
              }`}
            >
              <MoreHorizontal size={20} strokeWidth={2.2} />
            </button>
            {isOverflowMenuOpen && (
              <>
                <div className="fixed inset-0 z-[100]" onClick={() => setIsOverflowMenuOpen(false)} />
                <div className="absolute top-full mt-2 right-0 w-56 bg-[#f5f0e8] rounded-xl shadow-lg border border-[#1e2d1f]/10 p-1.5 z-[101]">
                  {/* ── S2 (формат) — видно в меню только когда S2 спрятан из бара (колонка ≤1120px) ── */}
                  <div className="hidden @max-[1120px]/tb:block">
                    <div className="px-2.5 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#1e2d1f]/55">
                      Выравнивание
                    </div>
                    <div className="flex items-center gap-1 px-1.5 pb-1.5">
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
                            className={`flex-1 p-1.5 rounded-md flex items-center justify-center transition-colors ${isActive ? 'text-[#1e2d1f] bg-[#1e2d1f]/6' : 'text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4'}`}
                          >
                            <Icon size={18} strokeWidth={2.2} />
                          </button>
                        );
                      })}
                    </div>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onIndentParagraphsChange(!indentParagraphs)}
                      className={`w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors flex items-center gap-2 ${
                        indentParagraphs ? 'bg-[#1e2d1f] text-white' : 'text-[#1e2d1f]/75 hover:bg-[#1e2d1f]/6'
                      }`}
                    >
                      <ListIndentIncrease size={16} strokeWidth={2.1} />
                      <span className="font-medium">Красная строка</span>
                    </button>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applyScriptMark(editor, 'superscript')}
                      className={`w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors flex items-center gap-2 ${
                        editor?.isActive('superscript') ? 'bg-[#1e2d1f] text-white' : 'text-[#1e2d1f]/75 hover:bg-[#1e2d1f]/6'
                      }`}
                    >
                      <span className="text-[15px] leading-none w-4 text-center">x²</span>
                      <span className="font-medium">Верхний индекс</span>
                    </button>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applyScriptMark(editor, 'subscript')}
                      className={`w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors flex items-center gap-2 ${
                        editor?.isActive('subscript') ? 'bg-[#1e2d1f] text-white' : 'text-[#1e2d1f]/75 hover:bg-[#1e2d1f]/6'
                      }`}
                    >
                      <span className="text-[15px] leading-none w-4 text-center">x₂</span>
                      <span className="font-medium">Нижний индекс</span>
                    </button>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { insertFootnote(); setIsOverflowMenuOpen(false); }}
                      className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors flex items-center gap-2 text-[#1e2d1f]/75 hover:bg-[#1e2d1f]/6"
                    >
                      <span className="text-[14px] leading-none w-4 text-center font-medium">аб<span className="text-[9px] text-[#71597F]">1</span></span>
                      <span className="font-medium">Сноска</span>
                    </button>
                    <div className="px-2.5 pt-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#1e2d1f]/55 border-t border-[#1e2d1f]/8 mt-1">
                      Шрифт всего текста
                    </div>
                    {([
                      { key: 'cormorant', label: 'Cormorant' },
                      { key: 'literata', label: 'Literata' },
                      { key: 'source-serif', label: 'Source Serif' },
                    ] as const).map((font) => (
                      <button
                        key={font.key}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { onEditorFontChange(font.key); setIsOverflowMenuOpen(false); }}
                        className={`w-full rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                          editorFont === font.key ? 'bg-[#1e2d1f] text-white' : 'text-[#1e2d1f]/75 hover:bg-[#1e2d1f]/6'
                        }`}
                      >
                        <span className={`text-[15px] leading-none ${font.key === 'cormorant' ? 'font-serif' : font.key === 'literata' ? 'editor-font-literata' : 'editor-font-source-serif'}`}>
                          {font.label}
                        </span>
                      </button>
                    ))}
                    <div className="border-t border-[#1e2d1f]/8 mt-1 mb-1" />
                  </div>

                  {/* ── S1 (правый кластер) — всегда в меню, пока оно открыто ── */}
                  <div className="px-2.5 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#1e2d1f]/55">
                    Ширина колонки
                  </div>
                  {([
                    { key: 'narrow', label: 'Узкая',   hint: 'S' },
                    { key: 'medium', label: 'Средняя', hint: 'M' },
                    { key: 'wide',   label: 'Широкая', hint: 'L' },
                  ] as const).map((item) => (
                    <button
                      key={item.key}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { handleWidthChange(item.key); }}
                      className={`w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors flex items-center justify-between gap-3 ${
                        textWidth === item.key ? 'bg-[#1e2d1f] text-white' : 'text-[#1e2d1f]/75 hover:bg-[#1e2d1f]/6'
                      }`}
                    >
                      <span className="font-medium">{item.label}</span>
                      <span className={`text-[11px] ${textWidth === item.key ? 'text-white/60' : 'text-[#1e2d1f]/55'}`}>{item.hint}</span>
                    </button>
                  ))}
                  <div className="border-t border-[#1e2d1f]/8 mt-1 mb-1" />
                  {onOpenSearch && (
                    <button
                      onClick={() => { onOpenSearch(); setIsOverflowMenuOpen(false); }}
                      className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors flex items-center gap-2 text-[#1e2d1f]/75 hover:bg-[#1e2d1f]/6"
                    >
                      <Search size={16} />
                      <span className="font-medium">Поиск по тексту</span>
                    </button>
                  )}
                  {onOpenExport && (
                    <button
                      onClick={() => { onOpenExport(); setIsOverflowMenuOpen(false); }}
                      className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors flex items-center gap-2 text-[#1e2d1f]/75 hover:bg-[#1e2d1f]/6"
                    >
                      <Download size={16} />
                      <span className="font-medium">Экспорт</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          {onToggleCompanion && !isCompanionOpen && (
            <button
              onClick={onToggleCompanion}
              title="Показать спутник «Перо»"
              aria-label="Показать спутник «Перо»"
              className="p-1.5 rounded-md text-ink/45 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/4 transition-colors flex items-center justify-center max-md:hidden"
            >
              <PanelRight size={18} />
            </button>
          )}
        </div>
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
      <div
        className={`absolute inset-0 px-8 md:px-16 overflow-y-auto hide-scrollbar scroll-smooth transition-[padding] duration-300 ${isFocusMode ? 'pt-8' : 'pt-28'}`}
        style={reserveCommentGutter ? { paddingRight: 372 } : undefined}
      >
        <div className={`${widthClass} mx-auto relative h-full transition-all duration-500 @container/title`}>
          <div className={`${editorFontClass} mb-10 ${isFocusMode ? 'mt-2' : 'mt-4'} flex items-baseline gap-4 min-w-0 text-[#1e2d1f]/90`}>
            <div className="relative shrink-0">
              <button
                onClick={() => setIsChapterTypeMenuOpen(o => !o)}
                title="Тип главы"
                className="group inline-flex items-baseline gap-1.5 text-[2.35rem] @max-[600px]/title:text-[1.5rem] leading-tight tracking-[-0.02em] font-medium rounded-lg px-1.5 -mx-1.5 hover:bg-[#1e2d1f]/[0.04] transition-colors"
              >
                {chapterPrefix}
                <ChevronDown size={20} className="self-center text-[#1e2d1f]/25 group-hover:text-[#1e2d1f]/60 transition-colors" />
              </button>
              {isChapterTypeMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsChapterTypeMenuOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 z-50 w-52 rounded-xl border border-[#1e2d1f]/8 bg-[#f5f0e8] shadow-[0_18px_50px_rgba(30,45,31,0.14)] p-1 max-h-[60vh] overflow-y-auto"
                    style={{ fontFamily: '"Golos Text", system-ui, sans-serif' }}>
                    {CHAPTER_TYPES.map((opt, i) => {
                      const active = (chapterType ?? 'chapter') === opt.type;
                      const firstService = opt.service && !CHAPTER_TYPES[i - 1]?.service;
                      return (
                        <div key={opt.type}>
                          {firstService && (
                            <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#1e2d1f]/35 border-t border-[#1e2d1f]/8 mt-1">Служебное · не анализируется</div>
                          )}
                          <button
                            onClick={() => { onChapterTypeChange?.(opt.type); setIsChapterTypeMenuOpen(false); }}
                            className={`flex items-center justify-between w-full text-left text-[14px] rounded-lg px-3 py-2 transition-colors ${
                              active ? 'bg-[#1e2d1f]/[0.06] text-[#1e2d1f] font-semibold' : 'text-[#1e2d1f]/70 hover:bg-[#1e2d1f]/[0.04]'
                            }`}
                          >
                            {opt.label}
                            {active && <Check size={15} className="text-[#4D6B4D]" />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            <span className="text-[2rem] @max-[600px]/title:text-[1.25rem] leading-none text-[#1e2d1f]/16 shrink-0 translate-y-[-0.04em]">|</span>
            <input
              ref={chapterTitleInputRef}
              value={chapterTitleSuffix}
              onChange={(e) => onChapterTitleSuffixChange?.(e.target.value)}
              placeholder="Введите название главы"
              className="min-w-0 flex-1 bg-transparent border-none outline-none text-[2.35rem] @max-[600px]/title:text-[1.5rem] leading-tight tracking-[-0.02em] font-medium placeholder:text-[#1e2d1f]/25"
              style={{ fontFamily: 'inherit' }}
            />
          </div>
          <div className={`${indentParagraphs ? 'tiptap-indent' : ''} ${editorFontClass}`}>
            {/* ИИ-меню по выделению убрано (REORG_PLAN шаг 5): Перо — аналитик, не генератор.
                Форматирование выделенного — в верхнем тулбаре. */}
            <EditorFirstRunHints />
            <EditorContent editor={editor} />
            {/* #6: пустая глава — не голый холст. Мягкое приглашение писать/диктовать.
                Прячем при загрузке контента и во время самой диктовки (там свой статус). */}
            {isEmptyChapter && !isLoadingContent && !isDictating && (
              <div className="mt-8 flex flex-col items-start gap-3 select-none animate-[fadeIn_240ms_ease-out]">
                <p className="text-[15px] text-[#1e2d1f]/40 leading-relaxed font-sans">
                  Чистый лист. Начните печатать — Перо прочитает написанное и запомнит вашу историю.
                </p>
                {isDictationSupported && onStartDictation && (
                  <button
                    onClick={onStartDictation}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#A14F44]/8 hover:bg-[#A14F44]/14 text-[#A14F44] text-[13px] font-medium font-sans transition-colors"
                  >
                    <Mic size={15} strokeWidth={2} />
                    …или продиктуйте — Перо запишет за вами
                  </button>
                )}
              </div>
            )}
            {/* Живые слова диктовки появляются призраком у курсора (DictationGhostExtension).
                Здесь — только тихий статус «слушаю / обрабатываю». */}
            {interimTranscript && (
              <div className="mt-3 inline-flex items-center gap-2 text-[13px] text-[#1e2d1f]/45 select-none">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#A14F44]/40" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#A14F44]/70" />
                </span>
                {interimTranscript}
              </div>
            )}
          </div>

          {/* Сноски главы — область внизу (как в Word): номер + редактируемый текст. */}
          <FootnotesArea footnotes={footnotes} editor={editor} onScrollToMarker={scrollToFootnoteMarker} />
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
