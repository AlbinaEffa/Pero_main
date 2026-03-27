import { Mark, mergeAttributes } from '@tiptap/core';

export type HighlightColor =
  | '#dce8c8'
  | '#d9e8f2'
  | '#f2dcdd'
  | '#e8def3'
  | '#f3e8b8';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textHighlight: {
      setTextHighlight: (color: HighlightColor) => ReturnType;
      toggleTextHighlight: (color: HighlightColor) => ReturnType;
      unsetTextHighlight: () => ReturnType;
    };
  }
}

export const HighlightMarkExtension = Mark.create({
  name: 'textHighlight',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  inclusive: false,

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: element => element.getAttribute('data-highlight-color'),
        renderHTML: attributes => {
          if (!attributes.color) return {};
          return {
            'data-highlight-color': attributes.color,
            style: `background-color: ${attributes.color}; border-radius: 0.2em; padding: 0.02em 0.08em;`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'mark[data-highlight-color]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setTextHighlight:
        color =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),

      toggleTextHighlight:
        color =>
        ({ commands }) =>
          commands.toggleMark(this.name, { color }),

      unsetTextHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
