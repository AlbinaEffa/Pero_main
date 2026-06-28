/**
 * Чистые команды редактора над Tiptap-инстансом — без React/JSX/хуков. Извлечены из
 * EditorCanvas.tsx: разворот выделения до слова, тоггл марок, подсветка, превью выделения
 * в тулбаре, состояние slash-меню. Тестопригодно/переиспользуемо; проверяется одним tsc.
 */
import type { Editor as TiptapEditor } from '@tiptap/react';
import type { HighlightColor } from './HighlightMarkExtension';
import { toolbarSelectionKey } from './toolbarSelectionExtension';

type InlineMarkName = 'bold' | 'italic' | 'underline' | 'strike' | 'code';
export type ListStyle = 'bulletList' | 'orderedList' | 'taskList';
export type SlashMenuState = {
  query: string;
  range: { from: number; to: number };
  blockRange: { from: number; to: number };
  blockType: string;
  top: number;
  left: number;
};

function isWordChar(char: string | undefined): boolean {
  return !!char && /[\p{L}\p{N}_'-]/u.test(char);
}

export function getWordRangeAtCursor(editor: TiptapEditor): { from: number; to: number; cursorPos: number } | null {
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

export function getCurrentListStyle(editor: TiptapEditor | null): ListStyle | null {
  if (!editor) return null;
  if (editor.isActive('taskList')) return 'taskList';
  if (editor.isActive('orderedList')) return 'orderedList';
  if (editor.isActive('bulletList')) return 'bulletList';
  return null;
}

export function applyInlineMark(editor: TiptapEditor | null, mark: InlineMarkName): void {
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

export function applyScriptMark(editor: TiptapEditor | null, kind: 'superscript' | 'subscript'): void {
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

export function applyTextHighlight(editor: TiptapEditor | null, color: HighlightColor | null): void {
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

export function showToolbarSelectionPreview(editor: TiptapEditor | null): void {
  if (!editor || editor.isDestroyed) return;
  const { from, to } = editor.state.selection;
  if (from === to) return;
  editor.view.dispatch(editor.view.state.tr.setMeta(toolbarSelectionKey, { from, to }));
}

export function clearToolbarSelectionPreview(editor: TiptapEditor | null): void {
  if (!editor || editor.isDestroyed) return;
  editor.view.dispatch(editor.view.state.tr.setMeta(toolbarSelectionKey, 'clear'));
}

export function getSlashMenuState(editor: TiptapEditor | null): SlashMenuState | null {
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
