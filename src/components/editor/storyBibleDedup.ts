/**
 * Детектор вероятных дублей сущностей «Мира» — чистая логика (без React/JSX), извлечена
 * из StoryBiblePanel.tsx. Консервативная подсказка к слиянию: алиасы, нормализация
 * русских вариантов (е/э, и/й), префикс-склонения, edit-distance, уникальный префикс.
 * Покрыто storyBibleDedup.test.ts. Без БД/AI/IO.
 */
import type { Entity } from './types';

export const SIG_RANK: Record<string, number> = { major: 0, moderate: 1, minor: 2 };

/** Алиасы сущности (для детектора дублей и слияния). */
function entityAliases(e: Entity): string[] {
  const a = e.attributes as Record<string, unknown> | null | undefined;
  return Array.isArray(a?.aliases) ? (a!.aliases as string[]).filter(x => typeof x === 'string') : [];
}

/**
 * Похоже ли, что два имени — один герой: алиас, имя-префикс («Риз»⊂«Ризанд») или
 * общий корень-склонение («Фейра»/«Фейре»). Консервативно — это лишь ПОДСКАЗКА к слиянию.
 */
// Нормализация русских вариантов написания: е/э/ё, и/й, ъ/ь — для дедупа «Ласен»≈«Ласэн».
function normalizeRu(s: string): string {
  return s.trim().toLowerCase()
    .replace(/[ёэ]/g, 'е')
    .replace(/й/g, 'и')
    .replace(/ъ/g, 'ь');
}
// Расстояние Левенштейна (для одиночных опечаток/вариантов на нормализованных именах).
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

function namesLikelySame(a: string, b: string, aliasA: string[], aliasB: string[]): boolean {
  const x = a.trim().toLowerCase(), y = b.trim().toLowerCase();
  if (!x || !y || x === y) return false;
  if (aliasA.some(al => al.trim().toLowerCase() === y) || aliasB.some(al => al.trim().toLowerCase() === x)) return true;

  const nx = normalizeRu(x), ny = normalizeRu(y);
  if (nx === ny) return true;                                   // «Ласен» ≈ «Ласэн» (е/э, и/й)
  // NB: «короткое имя = начало длинного» (Король ⊆ Король Сонного…) разбирается отдельным
  // проходом в findDuplicateGroups (с проверкой уникальности — иначе «Кольцо» слило бы все кольца).
  if (x.includes(' ') || y.includes(' ')) return false;        // прочие многословные не схлопываем
  const [s, l] = nx.length <= ny.length ? [nx, ny] : [ny, nx];
  if (s.length >= 3 && l.startsWith(s) && l.length - s.length <= 4) return true; // префикс-вариант (склонение)
  if (Math.min(nx.length, ny.length) >= 5 && editDistance(nx, ny) <= 1) return true; // одиночная опечатка/вариант
  let i = 0; while (i < s.length && s[i] === l[i]) i++;                          // общий корень
  return i >= 4 && i >= s.length * 0.7;
}

/** Группы вероятных дублей (один тип) методом объединения-поиска. Возвращает только группы ≥2. */
export function findDuplicateGroups(entities: Entity[]): Entity[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  entities.forEach(e => parent.set(e.id, e.id));
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i], b = entities[j];
      if (a.type !== b.type) continue;
      if (namesLikelySame(a.name, b.name, entityAliases(a), entityAliases(b))) {
        parent.set(find(a.id), find(b.id));
      }
    }
  }
  // Уникальный префикс: однословное имя = начало РОВНО ОДНОГО многословного того же типа
  // → вероятно сокращение («Король» → «Король Сонного королевства»). Если многословных с этим
  // префиксом несколько — это категория («Кольцо», «Дворец», «Лагерь»), НЕ сливаем.
  const norm = (s: string) => normalizeRu(s);
  for (const short of entities) {
    const sn = norm(short.name);
    if (sn.includes(' ') || sn.length < 4) continue;            // только однословные значимые
    const matches = entities.filter(e => e.type === short.type && e.id !== short.id && norm(e.name).startsWith(sn + ' '));
    if (matches.length === 1) parent.set(find(short.id), find(matches[0].id));
  }
  const groups = new Map<string, Entity[]>();
  entities.forEach(e => { const r = find(e.id); (groups.get(r) ?? groups.set(r, []).get(r)!).push(e); });
  return [...groups.values()]
    .filter(g => g.length >= 2)
    .sort((a, b) => (SIG_RANK[a[0].significance ?? 'minor'] ?? 2) - (SIG_RANK[b[0].significance ?? 'minor'] ?? 2));
}
