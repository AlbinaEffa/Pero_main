/**
 * SearchHighlightExtension — temporary inline highlight for jump-to-match.
 *
 * Uses a ProseMirror Decoration (not a mark) so the document content is never
 * modified: autosave, undo history, and selection are completely unaffected.
 *
 * Usage from Editor.tsx:
 *   // Apply:
 *   editor.view.dispatch(
 *     editor.view.state.tr.setMeta(searchHighlightKey, { from, to })
 *   );
 *   // Clear:
 *   editor.view.dispatch(
 *     editor.view.state.tr.setMeta(searchHighlightKey, 'clear')
 *   );
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

type HighlightMeta = { from: number; to: number } | 'clear';

export const searchHighlightKey = new PluginKey<DecorationSet>('searchHighlight');

export const SearchHighlightExtension = Extension.create({
  name: 'searchHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: searchHighlightKey,

        state: {
          init: () => DecorationSet.empty,

          apply(tr, oldDecos) {
            const meta = tr.getMeta(searchHighlightKey) as HighlightMeta | undefined;

            if (meta === 'clear') return DecorationSet.empty;

            if (meta && typeof meta === 'object') {
              const { from, to } = meta;
              return DecorationSet.create(tr.doc, [
                Decoration.inline(from, to, { class: 'search-highlight' }),
              ]);
            }

            // No meta — map existing decorations through any document changes
            // (e.g. user types: the highlight follows the text or shrinks/disappears naturally).
            return oldDecos.map(tr.mapping, tr.doc);
          },
        },

        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
