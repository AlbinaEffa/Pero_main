/**
 * ContradictionHighlightExtension — подчёркивает в тексте имена сущностей, у которых Перо
 * нашло возможную нестыковку. Это «вау» нативно: сигнал приходит прямо в рукопись (как
 * подчёркивание орфографии), а не прячется в панели.
 *
 * Декорация (не марка) — документ не меняется, автосейв/undo/выделение не затрагиваются.
 *
 * Применение из Editor.tsx:
 *   editor.view.dispatch(editor.view.state.tr.setMeta(contradictionHighlightKey, { terms: ['Весна', 'Амулет'] }));
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

interface PluginState { terms: string[]; decos: DecorationSet; }

export const contradictionHighlightKey = new PluginKey<PluginState>('contradictionHighlight');

function build(doc: PMNode, terms: string[]): DecorationSet {
  const lowers = terms.map(t => t.trim().toLowerCase()).filter(t => t.length >= 2);
  if (lowers.length === 0) return DecorationSet.empty;
  const decos: Decoration[] = [];
  try {
    doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return;
      const lower = node.text.toLowerCase();
      for (const term of lowers) {
        let i = lower.indexOf(term);
        while (i !== -1) {
          decos.push(Decoration.inline(pos + i, pos + i + term.length, { class: 'contradiction-mark' }));
          i = lower.indexOf(term, i + term.length);
        }
      }
    });
  } catch {
    return DecorationSet.empty;
  }
  return DecorationSet.create(doc, decos);
}

export const ContradictionHighlightExtension = Extension.create({
  name: 'contradictionHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key: contradictionHighlightKey,
        state: {
          init: () => ({ terms: [], decos: DecorationSet.empty }),
          apply(tr, value) {
            const meta = tr.getMeta(contradictionHighlightKey) as { terms: string[] } | undefined;
            if (meta && Array.isArray(meta.terms)) {
              return { terms: meta.terms, decos: build(tr.doc, meta.terms) };
            }
            if (tr.docChanged) {
              return { terms: value.terms, decos: value.decos.map(tr.mapping, tr.doc) };
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            return contradictionHighlightKey.getState(state)?.decos ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
