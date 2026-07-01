/**
 * EntityHighlightExtension — инлайн-подсветка имён сущностей «Мира» прямо в тексте рукописи
 * (паттерн NovelCrafter Codex / Campfire: тонкое подчёркивание имени → ховер-карточка → клик к
 * сущности). Использует ProseMirror Decoration (НЕ марку): документ не меняется — автосейв,
 * история, выделение не задеты.
 *
 * Данные приходят из Editor через meta:
 *   editor.view.dispatch(tr.setMeta(entityHighlightKey, { type: 'set', specs }))   // сменился список
 *   editor.view.dispatch(tr.setMeta(entityHighlightKey, { type: 'rescan' }))       // пере-скан текста (debounced)
 *   editor.view.dispatch(tr.setMeta(entityHighlightKey, 'clear'))
 *
 * Между meta декорации маппятся через изменения дока (подсветка едет за текстом). Скан —
 * только по meta (не на каждый keystroke), чтобы не лагало. v1: одно-словные имена/алиасы.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

/** Спецификация для матчинга одного имени (одно слово). */
export interface EntitySpec {
  id: string;
  type: string;     // character | location | item | rule
  name: string;     // нижний регистр, ОДНО слово
  stem: string;     // name без последней буквы (для длинных) или name целиком (для коротких)
  exact: boolean;   // короткое имя (≤4) — матч только точным словом
}

type Meta =
  | { type: 'set'; specs: EntitySpec[] }
  | { type: 'rescan' }
  | 'clear';

interface State { decos: DecorationSet; specs: EntitySpec[] }

export const entityHighlightKey = new PluginKey<State>('entityHighlight');

const WORD_RE = /[а-яёa-z0-9'-]+/gi;

/** Подходит ли слово под спецификацию имени. Длинные — стем + падежный хвост ≤3; короткие — точно. */
function wordMatches(word: string, s: EntitySpec): boolean {
  if (s.exact) return word === s.name;
  return word.startsWith(s.stem) && word.length <= s.name.length + 3;
}

/** Скан документа: для каждого текст-узла ищем совпадения имён и вешаем inline-декорации. */
function scan(doc: PMNode, specs: EntitySpec[]): DecorationSet {
  if (!specs.length) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const lower = node.text.toLowerCase();
    WORD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_RE.exec(lower))) {
      const word = m[0];
      // specs отсортированы по длине имени убыв. — берём самое длинное совпадение
      const spec = specs.find(s => wordMatches(word, s));
      if (spec) {
        const from = pos + m.index;
        decos.push(Decoration.inline(from, from + m[0].length, {
          class: 'entity-mention',
          'data-entity-id': spec.id,
          'data-entity-type': spec.type,
        }));
      }
    }
  });
  return DecorationSet.create(doc, decos);
}

export const EntityHighlightExtension = Extension.create({
  name: 'entityHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin<State>({
        key: entityHighlightKey,
        state: {
          init: () => ({ decos: DecorationSet.empty, specs: [] }),
          apply(tr, old): State {
            const meta = tr.getMeta(entityHighlightKey) as Meta | undefined;
            if (meta === 'clear') return { decos: DecorationSet.empty, specs: [] };
            if (meta && typeof meta === 'object') {
              if (meta.type === 'set') {
                const specs = [...meta.specs].sort((a, b) => b.name.length - a.name.length);
                return { decos: scan(tr.doc, specs), specs };
              }
              if (meta.type === 'rescan') {
                return { decos: scan(tr.doc, old.specs), specs: old.specs };
              }
            }
            // без meta — подсветка едет за текстом (новые слова подсветятся на следующем rescan)
            return tr.docChanged ? { decos: old.decos.map(tr.mapping, tr.doc), specs: old.specs } : old;
          },
        },
        props: {
          decorations(state) { return this.getState(state)?.decos; },
        },
      }),
    ];
  },
});

/** Собрать спеки из approved-сущностей: одно-словные имена + одно-словные алиасы. */
export function buildEntitySpecs(
  entities: { id: string; type: string; name: string; attributes?: unknown }[],
): EntitySpec[] {
  const specs: EntitySpec[] = [];
  const seen = new Set<string>(); // name(lower) → не дублировать
  const add = (id: string, type: string, raw: string) => {
    const name = (raw || '').trim().toLowerCase();
    if (!name || /\s/.test(name) || name.length < 3) return; // только одно слово, ≥3 симв.
    const key = `${type}|${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const exact = name.length <= 4;
    specs.push({ id, type, name, stem: exact ? name : name.slice(0, -1), exact });
  };
  for (const e of entities) {
    add(e.id, e.type, e.name);
    const attrs = e.attributes as { aliases?: unknown } | null;
    if (attrs && Array.isArray(attrs.aliases)) {
      for (const al of attrs.aliases) if (typeof al === 'string') add(e.id, e.type, al);
    }
  }
  return specs;
}
