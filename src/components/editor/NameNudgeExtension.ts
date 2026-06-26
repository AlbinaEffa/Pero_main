/**
 * NameNudgeExtension — проактивная подсветка РАЗНОПИСИ ИМЕНИ прямо в момент письма.
 *
 * Пока автор пишет, Перо подчёркивает слова, которые ПОХОЖИ на уже известное имя (edit-distance ≤ 1),
 * но написаны иначе — частый случай опечатки/варианта («Ласан» при существующем «Ласен»). Сигнал
 * приходит в рукопись пунктиром (как проверка орфографии), а не прячется в панели и не ждёт кнопки.
 *
 * Это НЕ авто-исправление: текст не трогаем (решает автор), декорация документ не меняет —
 * автосейв/undo/выделение не затрагиваются. Точные норм-варианты (е/э/ё, й, ъ) считаются тем же
 * именем и НЕ подсвечиваются (их тихо сливает бэкенд-резолвер).
 *
 * Применение из Editor.tsx (дебаунсом после набора):
 *   editor.view.dispatch(editor.view.state.tr.setMeta(nameNudgeKey, { names: ['Ласен', 'Кассиан', ...] }));
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

interface PluginState { names: string[]; decos: DecorationSet; }

export const nameNudgeKey = new PluginKey<PluginState>('nameNudge');

// Та же нормализация, что и на бэкенде (normalizeNameRu): варианты е/э/ё, й, ъ — одно имя.
function norm(s: string): string {
  return s.trim().toLowerCase()
    .replace(/[ёэ]/g, 'е')
    .replace(/й/g, 'и')
    .replace(/ъ/g, 'ь');
}

/**
 * Позиция ЕДИНСТВЕННОЙ правки между a и b, или -1 если расстояние ≠ 1.
 * Нужна, чтобы отличить ОПЕЧАТКУ (правка в основе слова) от СКЛОНЕНИЯ (правка в последнем символе):
 * в русском тексте имя в косвенном падеже («Юриане», «Юриана») отстоит от именительного («Юриан»)
 * ровно на 1 символ В КОНЦЕ — это НЕ разнопись. Опечатки же («Ласан» при «Ласен») сидят в основе.
 */
function singleEditPos(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 1) return -1;
  let i = 0;
  while (i < m && i < n && a[i] === b[i]) i++;       // общий префикс
  if (i === m && i === n) return -1;                  // равны
  if (m === n) {                                      // замена в позиции i
    let k = i + 1;
    while (k < m && a[k] === b[k]) k++;
    return k === m ? i : -1;
  }
  // вставка/удаление: длинная строка имеет лишний символ в позиции i
  const lng = m > n ? a : b, srt = m > n ? b : a;
  let li = i + 1, si = i;
  while (li < lng.length && si < srt.length && lng[li] === srt[si]) { li++; si++; }
  return (li === lng.length && si === srt.length) ? i : -1;
}

function build(doc: PMNode, names: string[]): DecorationSet {
  const pairs = names.map(n => ({ n: norm(n), orig: n.trim() })).filter(p => p.n.length >= 4);
  if (pairs.length === 0) return DecorationSet.empty;
  const knownSet = new Set(pairs.map(p => p.n));
  const cache = new Map<string, string | null>(); // нормализованное слово → имя-цель или null
  // Заглавное кириллическое слово целиком ≥ 4 символов (потенциальное имя собственное).
  const WORD = /[А-ЯЁ][а-яё]{3,}/g;
  const decos: Decoration[] = [];
  try {
    doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return;
      const text = node.text;
      WORD.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = WORD.exec(text)) !== null) {
        const word = m[0];
        const nw = norm(word);
        if (nw.length < 4 || knownSet.has(nw)) continue; // короткое или это реальное имя
        let target: string | null;
        if (cache.has(nw)) {
          target = cache.get(nw)!;
        } else {
          // подсказываем, только если: правка в ОСНОВЕ (не склонение в последнем символе)
          // и кандидат-имя РОВНО один (как findLikelyDuplicate на бэке).
          let found: string | null = null, count = 0;
          for (const p of pairs) {
            const ep = singleEditPos(nw, p.n);
            if (ep < 0) continue;
            const maxLen = Math.max(nw.length, p.n.length);
            if (ep >= maxLen - 1) continue; // правка в последнем символе → падежное окончание, не разнопись
            count++; if (count > 1) { found = null; break; } found = p.orig;
          }
          target = count === 1 ? found : null;
          cache.set(nw, target);
        }
        if (target) {
          const from = pos + m.index;
          decos.push(Decoration.inline(from, from + word.length, {
            class: 'name-nudge',
            title: `≈ Похоже на «${target}» — то же имя?`,
          }));
        }
      }
    });
  } catch {
    return DecorationSet.empty;
  }
  return DecorationSet.create(doc, decos);
}

export const NameNudgeExtension = Extension.create({
  name: 'nameNudge',

  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key: nameNudgeKey,
        state: {
          init: () => ({ names: [], decos: DecorationSet.empty }),
          apply(tr, value) {
            const meta = tr.getMeta(nameNudgeKey) as { names: string[] } | undefined;
            if (meta && Array.isArray(meta.names)) {
              return { names: meta.names, decos: build(tr.doc, meta.names) };
            }
            if (tr.docChanged) {
              return { names: value.names, decos: value.decos.map(tr.mapping, tr.doc) };
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            return nameNudgeKey.getState(state)?.decos ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
