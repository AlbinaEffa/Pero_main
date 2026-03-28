import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    chapterTitle: {
      setChapterTitle: (prefix?: string) => ReturnType;
    };
  }
}

export const ChapterTitleExtension = Node.create({
  name: 'chapterTitle',
  priority: 1000,

  group: 'block',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-node-type="chapter-title"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-node-type': 'chapter-title',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setChapterTitle:
        prefix =>
        ({ commands }) =>
          commands.setNode(this.name, prefix ? { prefix } : {}),
    };
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement('div');
      const prefix = document.createElement('span');
      const separator = document.createElement('span');
      const content = document.createElement('span');

      Object.entries(
        mergeAttributes(HTMLAttributes, {
          'data-node-type': 'chapter-title',
          class: 'chapter-title-node',
        }),
      ).forEach(([key, value]) => {
        if (value != null) dom.setAttribute(key, String(value));
      });

      prefix.className = 'chapter-title-prefix';
      prefix.contentEditable = 'false';

      separator.className = 'chapter-title-separator';
      separator.contentEditable = 'false';
      separator.textContent = '|';

      content.className = 'chapter-title-content';

      const sync = (currentNode = node) => {
        const currentPrefix = currentNode.attrs.prefix || 'Глава';
        prefix.textContent = currentPrefix;
        dom.setAttribute('data-chapter-prefix', currentPrefix);
        dom.setAttribute('data-empty', currentNode.textContent.trim() ? 'false' : 'true');
      };

      sync(node);

      dom.append(prefix, separator, content);

      return {
        dom,
        contentDOM: content,
        update: updatedNode => {
          if (updatedNode.type.name !== this.name) return false;
          sync(updatedNode);
          return true;
        },
      };
    };
  },

  addAttributes() {
    return {
      prefix: {
        default: null,
        parseHTML: element => element.getAttribute('data-chapter-prefix'),
        renderHTML: attributes => {
          if (!attributes.prefix) return {};
          return {
            'data-chapter-prefix': attributes.prefix,
          };
        },
      },
    };
  },
});
