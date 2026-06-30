/**
 * Релевантный срез Мира + токен-бюджет (manager-обязанность «что входит в контекст»).
 * Проблема: сверка нестыковок одной главы слала ВЕСЬ Мир (растёт с книгой). Здесь — выбрать
 * только релевантное к этой главе, ограничив объём, чтобы контекст рос со СЦЕНОЙ, не с книгой.
 *
 * reserved (никогда не дропаем — корректность):
 *   • POV-герой главы (в 1-м лице он зовётся «я» и лексикой не ловится — добавляем явно),
 *   • major-сущности (канон-костяк),
 *   • присутствующие в ЭТОЙ главе (лексика, как «В кадре»).
 * ranked (добор по бюджету): остальные по significance, пока влезает; иначе drop (НЕ truncate).
 * «Факты из других глав» и связанные сущности добирает RAG-ретрив отдельно — здесь только
 * канон Мира, релевантный сцене. (1-hop по графу намеренно НЕ берём: на плотно-связном Мире
 * он раздувает срез почти до целого Мира — замер показал 177→110; RAG это и так покрывает.)
 *
 * Без БД/AI/IO. Срез делается на call-site сверки, сигнатура buildStoryBibleContext не меняется.
 */
import { aliasesOf, normalizeNameRu } from './extraction.js';
import { entitiesPresentInChapter } from './entityPresence.js';

export interface SliceEntity {
  id: string; name: string; type: string;
  description: string | null; significance: string | null; attributes: unknown;
}
export interface SliceLink { sourceEntityId: string; targetEntityId: string; relation: string }

export interface WorldSliceStats {
  total: number;       // всего approved-сущностей в Мире
  present: number;     // присутствуют в этой главе (лексика)
  major: number;       // major-костяк
  povIncluded: boolean;// POV-герой главы добавлен явно (если задан и найден)
  included: number;    // итог в срезе
  dropped: number;     // не вошло (срезано)
  budgetChars: number;
  usedChars: number;   // оценка размера среза
  presentNames: string[]; // имена present-сущностей (лексический сигнал для кросс-главного RAG)
}

const SIG_RANK: Record<string, number> = { major: 0, moderate: 1, minor: 2 };
const DEFAULT_BUDGET_CHARS = 8000; // ~канон-блок; per-атрибут уже капнут 160 в buildStoryBibleContext

/** Грубая оценка размера сущности в промпте (имя + описание + до 3 капнутых атрибутов). */
function estimateChars(e: SliceEntity): number {
  let n = e.name.length + (e.description?.length ?? 0) + 8;
  const a = e.attributes && typeof e.attributes === 'object' ? (e.attributes as Record<string, unknown>) : null;
  if (a) for (const k of ['speech', 'motivations', 'secrets']) {
    const v = a[k];
    if (typeof v === 'string') n += Math.min(v.length, 160) + 12;
  }
  return n;
}

/**
 * Выбрать релевантный к главе срез Мира под бюджет. Возвращает подмножества entities/links
 * (готовы к buildStoryBibleContext) + статистику для замера/трейса.
 */
export function selectWorldSlice<E extends SliceEntity, L extends SliceLink>(opts: {
  entities: E[];
  links: L[];
  chapterText: string;
  pov?: string | null;
  budgetChars?: number;
}): { entities: E[]; links: L[]; stats: WorldSliceStats } {
  const { entities, links } = opts;
  const budgetChars = opts.budgetChars ?? DEFAULT_BUDGET_CHARS;

  // 1. Присутствие в главе (лексика + алиасы) — как «В кадре».
  const cands = entities.map(e => ({ ref: e, name: e.name, aliases: aliasesOf(e.attributes) }));
  const present = new Set<E>([...entitiesPresentInChapter(opts.chapterText, cands)].map(c => c.ref));

  // 2. reserved = present ∪ major.
  const reserved = new Set<E>(present);
  let majorCount = 0;
  for (const e of entities) if (e.significance === 'major') { reserved.add(e); majorCount++; }

  // 3. POV-герой главы — явно (в 1-м лице зовётся «я», лексикой не ловится). Матч по имени И
  //    алиасам (POV может быть «Риз», а сущность — «Ризанд»; нормализованное имя не совпадёт).
  let povIncluded = false;
  const povNorm = opts.pov && opts.pov !== 'Автор' ? normalizeNameRu(opts.pov) : '';
  const isPov = (e: E) => povNorm !== '' && e.type === 'character' &&
    (normalizeNameRu(e.name) === povNorm || aliasesOf(e.attributes).some(a => normalizeNameRu(a) === povNorm));
  if (povNorm) {
    const povEnt = entities.find(isPov);
    if (povEnt) { reserved.add(povEnt); povIncluded = true; }
  }

  // 4. included = reserved (present ∪ major ∪ POV). Ranked-добора off-scene сущностей НЕТ:
  //    для «проверь эту главу» они шум, а связанное/«из других глав» добирает RAG отдельно.
  //    budgetChars — жёсткий потолок: если сцена огромна, режем present-minor (НЕ major, НЕ POV).
  const included = new Set<E>(reserved);
  let usedChars = [...included].reduce((sum, e) => sum + estimateChars(e), 0);
  if (usedChars > budgetChars) {
    const trimmable = [...included]
      .filter(e => e.significance !== 'major' && !isPov(e))
      .sort((a, b) => (SIG_RANK[b.significance ?? 'minor'] ?? 3) - (SIG_RANK[a.significance ?? 'minor'] ?? 3)); // minor первыми
    for (const e of trimmable) {
      if (usedChars <= budgetChars) break;
      included.delete(e);
      usedChars -= estimateChars(e);
    }
  }

  const inclIds = new Set([...included].map(e => e.id));
  return {
    entities: entities.filter(e => included.has(e)),
    links: links.filter(l => inclIds.has(l.sourceEntityId) && inclIds.has(l.targetEntityId)),
    stats: {
      total: entities.length, present: present.size, major: majorCount, povIncluded,
      included: included.size, dropped: entities.length - included.size,
      budgetChars, usedChars,
      presentNames: [...present].map(e => e.name),
    },
  };
}
