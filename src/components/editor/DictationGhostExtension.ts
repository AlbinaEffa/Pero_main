/**
 * DictationGhostExtension — показывает «живую» расшифровку диктовки призрачным
 * текстом ПРЯМО в позиции курсора, пока автор говорит. Слова появляются там, где
 * пишешь, а не блоком внизу главы — это и есть нативная диктовка: голос льётся в
 * текст в ту же точку, что и клавиатура.
 *
 * Промежуточный (interim) результат — это widget-декорация (не вставка в документ):
 * автосейв/undo/выделение не затрагиваются, финальный нормализованный текст потом
 * вставляется обычным insertContent в ту же позицию.
 *
 * Применение из Editor.tsx:
 *   editor.view.dispatch(editor.view.state.tr.setMeta(dictationGhostKey, { text: 'привет мир' }));
 *   editor.view.dispatch(editor.view.state.tr.setMeta(dictationGhostKey, { text: '' })); // спрятать
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

interface PluginState { text: string; }

export const dictationGhostKey = new PluginKey<PluginState>('dictationGhost');

function buildWidget(text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'dictation-ghost';
  // Ведущий пробел, чтобы призрак не слипался с последним словом перед курсором.
  span.textContent = (text.startsWith(' ') ? '' : ' ') + text;
  // Мигающая каретка в конце призрака — видно, что идёт запись.
  const caret = document.createElement('span');
  caret.className = 'dictation-ghost-caret';
  span.appendChild(caret);
  return span;
}

export const DictationGhostExtension = Extension.create({
  name: 'dictationGhost',

  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key: dictationGhostKey,
        state: {
          init: () => ({ text: '' }),
          apply(tr, value) {
            const meta = tr.getMeta(dictationGhostKey) as { text: string } | undefined;
            if (meta && typeof meta.text === 'string') {
              return { text: meta.text };
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            const { text } = dictationGhostKey.getState(state) ?? { text: '' };
            if (!text) return DecorationSet.empty;
            const pos = state.selection.head;
            // side: 1 — призрак рисуется ПОСЛЕ курсора, не сдвигая каретку.
            const deco = Decoration.widget(pos, () => buildWidget(text), { side: 1 });
            return DecorationSet.create(state.doc, [deco]);
          },
        },
      }),
    ];
  },
});
