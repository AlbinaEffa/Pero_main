import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * Сноска — инлайновый atom-узел: надстрочный маркер в тексте, содержимое хранится в самом
 * узле (attrs.content). Номер НЕ хранится — он считается по порядку плагином (decoration
 * `data-fn-number`) и рисуется в CSS `.footnote-ref::after`, поэтому всегда актуален при
 * вставке/удалении соседних сносок. Редактирование — всплывашка в EditorCanvas (DOM-клик).
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      /** Вставить сноску у курсора. Возвращает id через onInserted (см. EditorCanvas). */
      insertFootnote: (attrs?: { id?: string; content?: string }) => ReturnType;
      updateFootnote: (id: string, content: string) => ReturnType;
      removeFootnote: (id: string) => ReturnType;
      /** Сдвиг нумерации: сколько сносок в предыдущих главах (сквозная нумерация по книге). */
      setFootnoteOffset: (offset: number) => ReturnType;
    };
  }
}

/** Ключ плагина нумерации — хранит offset (число сносок в предыдущих главах). */
export const footnoteNumberKey = new PluginKey('footnoteNumbering');

export function newFootnoteId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `fn_${crypto.randomUUID()}`;
  } catch { /* fallthrough */ }
  return `fn_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

export const FootnoteExtension = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: el => (el as HTMLElement).getAttribute('data-footnote-id'),
        renderHTML: attrs => (attrs.id ? { 'data-footnote-id': attrs.id } : {}),
      },
      content: {
        default: '',
        parseHTML: el => (el as HTMLElement).getAttribute('data-content') ?? '',
        renderHTML: attrs => ({ 'data-content': attrs.content ?? '' }),
      },
    };
  },

  parseHTML() {
    // Рендерим как <span>, а не <sup>, чтобы не конфликтовать с маркой Superscript (она ловит
    // ЛЮБОЙ <sup> и съедала бы сноску при загрузке). Старый <sup>-вариант парсим для совместимости.
    return [
      { tag: 'span[data-footnote-id]', priority: 100 },
      { tag: 'sup[data-footnote-id]', priority: 100 },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // Надстрочность и номер — через CSS `.footnote-ref` / `::after` (decoration `data-fn-number`).
    return ['span', mergeAttributes(HTMLAttributes, { class: 'footnote-ref' })];
  },

  addCommands() {
    return {
      insertFootnote:
        (attrs = {}) =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs: { id: attrs.id ?? newFootnoteId(), content: attrs.content ?? '' } })
            .run(),

      updateFootnote:
        (id, content) =>
        ({ state, dispatch }) => {
          let tr = state.tr;
          let found = false;
          state.doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs.id === id) {
              tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, content });
              found = true;
            }
          });
          if (found && dispatch) dispatch(tr);
          return found;
        },

      removeFootnote:
        (id) =>
        ({ state, dispatch }) => {
          const ranges: { from: number; to: number }[] = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs.id === id) {
              ranges.push({ from: pos, to: pos + node.nodeSize });
            }
          });
          if (ranges.length === 0) return false;
          let tr = state.tr;
          // Удаляем с конца, чтобы не сбить позиции предыдущих.
          for (const r of ranges.reverse()) tr = tr.delete(r.from, r.to);
          if (dispatch) dispatch(tr);
          return true;
        },

      setFootnoteOffset:
        (offset) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(footnoteNumberKey, { offset: Math.max(0, offset | 0) }));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const typeName = this.name;
    return [
      new Plugin({
        key: footnoteNumberKey,
        // offset = сколько сносок в предыдущих главах; меняется командой setFootnoteOffset.
        state: {
          init: () => ({ offset: 0 }),
          apply: (tr, value: { offset: number }) => {
            const meta = tr.getMeta(footnoteNumberKey);
            return meta && typeof meta.offset === 'number' ? { offset: meta.offset } : value;
          },
        },
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            let i = (footnoteNumberKey.getState(state) as { offset: number } | undefined)?.offset ?? 0;
            state.doc.descendants((node, pos) => {
              if (node.type.name === typeName) {
                i += 1;
                // title — нативная подсказка при наведении (как в Word); data-fn-number → CSS ::after.
                decos.push(Decoration.node(pos, pos + node.nodeSize, {
                  'data-fn-number': String(i),
                  title: node.attrs.content || '',
                }));
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
