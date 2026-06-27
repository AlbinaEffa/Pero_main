/**
 * Чистые утилиты редактора, вынесенные из Editor.tsx (дробление мегафайла).
 * Без состояния компонента: текст-матчинг, парс заголовков глав, поиск/прыжок в Tiptap,
 * мелкий компонент EntityCard. Импортируются обратно в Editor.tsx.
 */
import { type Editor as TiptapEditor } from '@tiptap/react';
import { Users, MapPin, Box, Scale, AlertTriangle } from 'lucide-react';
import { CHAPTER_TYPE_LABELS } from './chapterDisplay';
import { searchHighlightKey } from './searchHighlightExtension';
import { Entity } from './types';

/**
 * Stem-based matching for Russian morphology.
 * Drops the last character of the entity name (covers most single-letter case endings)
 * and checks whether any word in the text starts with that stem.
 * For short names (≤4 chars) the full name is used as the stem.
 */
export function russianStemMatch(entityName: string, text: string): boolean {
  const name = entityName.toLowerCase().trim();
  if (!name || name.length < 2) return false;
  const stemLen = name.length <= 4 ? name.length : name.length - 1;
  const stem = name.slice(0, stemLen);
  const words = text.toLowerCase().split(/[^а-яёa-z0-9'-]+/i).filter(w => w.length > 0);
  return words.some(w => w.startsWith(stem));
}

/**
 * Совпадение сущности с текстом главы ЗА ОДИН проход: принимает заранее токенизированный текст
 * (слова с offset) и возвращает СРАЗУ и «упомянута», и индекс ПЕРВОГО появления — чтобы не
 * сканировать текст дважды (для присутствия и для порядка). Многословное имя («Король Сонного
 * королевства») требует ВСЕ значимые токены (иначе любое «корол…» ложно притягивает); однословное —
 * по одному. firstAt = самое раннее слово среди токенов.
 */
export function entityMatch(name: string, words: { w: string; at: number }[], fullText: string): { mentioned: boolean; firstAt: number } {
  const tokens = name.toLowerCase().split(/[^а-яёa-z0-9'-]+/i).filter(t => t.length >= 3);
  if (tokens.length === 0) return { mentioned: russianStemMatch(name, fullText), firstAt: Infinity };
  const stems = tokens.map(t => (t.length <= 4 ? t : t.slice(0, t.length - 1)));
  const earliest = stems.map(() => Infinity);
  for (const { w, at } of words) {
    for (let i = 0; i < stems.length; i++) {
      if (earliest[i] === Infinity && w.startsWith(stems[i])) earliest[i] = at;
    }
  }
  const finite = earliest.filter(f => f !== Infinity);
  const mentioned = stems.length >= 2 ? finite.length === stems.length : finite.length > 0;
  return { mentioned, firstAt: mentioned ? Math.min(...finite) : Infinity };
}

export function splitChapterTitle(title: string, fallbackOrder?: number, chapterType?: string): { prefix: string; suffix: string } {
  const trimmed = title.trim();

  // Не-«глава» (Пролог/Эпилог/Часть/Благодарности…) — префикс это слово-тип, а не «Глава N».
  if (chapterType && chapterType !== 'chapter' && CHAPTER_TYPE_LABELS[chapterType]) {
    const label = CHAPTER_TYPE_LABELS[chapterType];
    const suffix = trimmed.replace(new RegExp(`^${label}[\\s.:—–-]*`, 'i'), '').trim();
    return { prefix: label, suffix: suffix.toLowerCase() === label.toLowerCase() ? '' : suffix };
  }

  const match = trimmed.match(/^(Глава\s+\d+)(?:[\s.:—-]+(.+))?$/i);
  if (match) {
    return {
      prefix: match[1].trim(),
      suffix: match[2]?.trim() ?? '',
    };
  }

  const fallbackPrefix = fallbackOrder != null ? `Глава ${fallbackOrder + 1}` : 'Глава';
  return {
    prefix: fallbackPrefix,
    suffix: trimmed,
  };
}

export function composeChapterTitle(prefix: string, suffix: string): string {
  return suffix.trim() ? `${prefix} ${suffix.trim()}` : prefix;
}

export function sanitizeChapterContent(html: string): string {
  const trimmed = html
    .replace(/<(h1|div)[^>]*data-node-type=["']chapter-title["'][^>]*>[\s\S]*?<\/\1>/gi, '')
    .trim();

  return trimmed || '<p></p>';
}

export function fallbackNormalizeDictation(rawText: string): string {
  const normalized = rawText.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export const ENTITY_SECTIONS = [
  { type: 'character', label: 'Персонажи',    icon: Users  },
  { type: 'location',  label: 'Локации',      icon: MapPin },
  { type: 'item',      label: 'Предметы',     icon: Box    },
  { type: 'rule',      label: 'Правила мира', icon: Scale  },
] as const;

export function EntityCard({ entity, hasConflict }: { entity: Entity; hasConflict: boolean }) {
  return (
    <div className={`rounded-xl p-3 border transition-colors cursor-default ${
      hasConflict
        ? 'bg-[#F2E9D8]/80 border-[#91682E]/60 hover:bg-[#F2E9D8]'
        : 'bg-white/60 border-[#1e2d1f]/5 hover:bg-white'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-bold text-[16px] text-[#1e2d1f] truncate leading-snug">{entity.name}</h4>
        {hasConflict && (
          <span title="Возможное противоречие с другой версией этого объекта">
            <AlertTriangle size={13} className="text-[#91682E] flex-shrink-0 mt-0.5" />
          </span>
        )}
      </div>
      {entity.description && (
        <p className="text-sm text-[#1e2d1f]/55 line-clamp-2 mt-0.5 leading-snug">{entity.description}</p>
      )}
    </div>
  );
}

// ─── Jump-to-match ────────────────────────────────────────────────────────────
/**
 * Find the first occurrence of `query` in the TipTap editor using a two-pass
 * strategy:
 *
 * Pass 1 — fingerprint-guided (precise): search for the longer `fingerprint`
 *   text (e.g. "…15 chars before + query + 15 chars after…" returned by the
 *   backend). If found in a text node, locate `query` within that window and
 *   select it. This handles cases where the same query word appears multiple
 *   times and we need the specific occurrence the user searched for.
 *
 * Pass 2 — fallback: if the fingerprint isn't found (e.g. it spans a paragraph
 *   boundary so it crosses multiple text nodes), fall back to a plain search
 *   for `query` directly.
 *
 * Selects the matched range, scrolls it into view, and returns { from, to }.
 * Returns null if nothing is found (no error thrown).
 */
export function jumpToMatch(
  editor: TiptapEditor,
  fingerprint: string,
  query: string,
): { from: number; to: number } | null {
  if (!fingerprint || editor.isDestroyed) return null;
  const fpLower = fingerprint.toLowerCase();
  const qLower  = query.toLowerCase();
  const { doc }  = editor.state;
  let result: { from: number; to: number } | null = null;

  // Pass 1: fingerprint search
  doc.descendants((node, pos) => {
    if (result || !node.isText || !node.text) return;
    const text   = node.text.toLowerCase();
    const fpIdx  = text.indexOf(fpLower);
    if (fpIdx === -1 || fpIdx + fingerprint.length > node.text.length) return;

    // Within the fingerprint window, locate the query for a precise selection.
    const window = text.slice(fpIdx, fpIdx + fingerprint.length);
    const qIdx   = window.indexOf(qLower);
    if (qIdx !== -1 && qIdx + query.length <= window.length) {
      result = { from: pos + fpIdx + qIdx, to: pos + fpIdx + qIdx + query.length };
    } else {
      // Fingerprint found but query not isolated inside it — select the fingerprint range.
      result = { from: pos + fpIdx, to: pos + fpIdx + fingerprint.length };
    }
    editor.commands.setTextSelection(result.from); // курсор схлопнут → подсветка декорацией, без выделения (бар не триггерится)
    editor.commands.scrollIntoView();
  });

  if (result) return result;

  // Pass 2: fallback — plain query search
  doc.descendants((node, pos) => {
    if (result || !node.isText || !node.text) return;
    const idx = node.text.toLowerCase().indexOf(qLower);
    if (idx === -1 || idx + query.length > node.text.length) return;
    result = { from: pos + idx, to: pos + idx + query.length };
    editor.commands.setTextSelection(result.from); // курсор схлопнут → подсветка декорацией, без выделения (бар не триггерится)
    editor.commands.scrollIntoView();
  });

  return result;
}

/**
 * Collect ALL occurrences of `query` in the editor document.
 * Iterates text nodes in document order; works within individual nodes
 * (same constraint as jumpToMatch — cross-node matches are not found).
 * Non-overlapping — advances by query.length after each hit.
 */
export function findAllMatches(
  editor: TiptapEditor,
  query: string,
): { from: number; to: number }[] {
  if (!query || editor.isDestroyed) return [];
  const needle = query.toLowerCase();
  const { doc } = editor.state;
  const matches: { from: number; to: number }[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLowerCase();
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const idx = text.indexOf(needle, searchFrom);
      if (idx === -1 || idx + query.length > node.text.length) break;
      matches.push({ from: pos + idx, to: pos + idx + query.length });
      searchFrom = idx + Math.max(1, query.length); // non-overlapping advance
    }
  });

  return matches;
}

/** Apply a persistent inline decoration over the matched range. */
export function applySearchHighlight(editor: TiptapEditor, from: number, to: number): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.view.state.tr.setMeta(searchHighlightKey, { from, to }));
}

/** Remove the persistent search highlight decoration. */
export function clearSearchHighlight(editor: TiptapEditor): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.view.state.tr.setMeta(searchHighlightKey, 'clear'));
}
