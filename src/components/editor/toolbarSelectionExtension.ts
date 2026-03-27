import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

type ToolbarSelectionMeta = { from: number; to: number } | 'clear';

export const toolbarSelectionKey = new PluginKey<DecorationSet>('toolbarSelectionPreview');

export const ToolbarSelectionExtension = Extension.create({
  name: 'toolbarSelectionPreview',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: toolbarSelectionKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(toolbarSelectionKey) as ToolbarSelectionMeta | undefined;

            if (meta === 'clear') {
              return DecorationSet.empty;
            }

            if (meta && typeof meta === 'object') {
              const { from, to } = meta;
              if (from >= to) return DecorationSet.empty;
              return DecorationSet.create(tr.doc, [
                Decoration.inline(from, to, { class: 'toolbar-selection-preview' }),
              ]);
            }

            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return toolbarSelectionKey.getState(state) || DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
