import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * CommentMarkExtension — инлайн-марка «комментарий», якорь авторской пометки к диапазону текста.
 *
 * Принцип: комментарий приклеен к МЕСТУ (а не «выделил → скопировал в заметки»). Марка едет
 * вместе с текстом при правках (ProseMirror сам пересчитывает позиции), перекрытия стекаются.
 * Тело комментария живёт в БД (таблица comments), здесь в документе — только ссылка (commentId)
 * + подсветка. Источник (author|pero) задаёт цвет — задел под единый «слой полей».
 *
 * НЕ часть экспорта: при экспорте span убирается, остаётся только текст (см. server export).
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      /** Навесить марку комментария на текущее выделение. */
      setComment: (commentId: string, source?: 'author' | 'pero') => ReturnType;
      /** Снять марку конкретного комментария по всему документу (resolve/delete). */
      removeCommentById: (commentId: string) => ReturnType;
    };
  }
}

export const CommentMarkExtension = Mark.create({
  name: 'comment',

  // Не «прилипает» — текст, набранный сразу после марки, в неё не попадает.
  inclusive: false,
  // Несколько комментариев на один диапазон допустимы (марки разных id сосуществуют).
  excludes: '',

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: el => el.getAttribute('data-comment-id'),
        renderHTML: attrs => (attrs.commentId ? { 'data-comment-id': attrs.commentId } : {}),
      },
      source: {
        default: 'author',
        parseHTML: el => el.getAttribute('data-comment-source') || 'author',
        renderHTML: attrs => ({ 'data-comment-source': attrs.source || 'author' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { class: 'comment-mark' }),
      0,
    ];
  },

  addCommands() {
    return {
      setComment:
        (commentId, source = 'author') =>
        ({ commands }) =>
          commands.setMark(this.name, { commentId, source }),

      removeCommentById:
        commentId =>
        ({ state, dispatch }) => {
          const { tr, doc, schema } = state;
          const markType = schema.marks[this.name];
          if (!markType) return false;
          let changed = false;
          doc.descendants((node, pos) => {
            if (!node.isText) return;
            node.marks.forEach(m => {
              if (m.type === markType && m.attrs.commentId === commentId) {
                tr.removeMark(pos, pos + node.nodeSize, markType);
                changed = true;
              }
            });
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
    };
  },
});
