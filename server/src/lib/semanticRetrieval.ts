/**
 * Семантический ретрив для сверки фактов: близкие по смыслу фрагменты из ДРУГИХ глав
 * (cosine по эмбеддингам в semantic_memory, исключая текущую главу). Эмбеддинг запроса —
 * локальный (Ollama) → без API-токенов. Деградирует молча (пусто), если эмбеддингов нет.
 * Общий для пер-главного скана (routes/bible) и полного скана книги (jobs/worker).
 */
import { pool } from '../db/client.js';
import { getEmbeddingProvider } from './aiProvider.js';

export interface BookPassage {
  chunkText: string;
  chapterId: string;
  chapterTitle: string | null;
  order: number | null;
  similarity: number;   // косинусная близость 0..1
}

/**
 * Семантический поиск по всей книге (линза «Эхо»): эмбеддит запрос (Ollama, без токенов),
 * косинус по semantic_memory в пределах проекта, возвращает топ-фрагменты с главой и
 * близостью. В отличие от retrieveCrossChapterPassages — НЕ исключает текущую главу и
 * отдаёт метаданные для UI. Деградирует молча (пусто), если эмбеддера/векторов нет.
 */
export async function searchBookPassages(
  projectId: string,
  query: string,
  topK = 12,
): Promise<BookPassage[]> {
  const embedder = getEmbeddingProvider();
  if (!embedder || !query.trim()) return [];
  const vec = await embedder.embed(query.slice(0, 2000), 'query');
  if (!vec) return [];
  try {
    const { rows } = await pool.query<{
      chunk_text: string; chapter_id: string; title: string | null; order: number | null; sim: number;
    }>(
      `SELECT sm.chunk_text, sm.chapter_id, c.title, c."order",
              1 - (sm.embedding <=> $2::vector) AS sim
         FROM semantic_memory sm
         LEFT JOIN chapters c ON c.id = sm.chapter_id
        WHERE sm.project_id = $1 AND sm.embedding IS NOT NULL AND sm.chapter_id IS NOT NULL
        ORDER BY sm.embedding <=> $2::vector
        LIMIT $3`,
      [projectId, `[${vec.join(',')}]`, topK],
    );
    return rows.map(r => ({
      chunkText: r.chunk_text,
      chapterId: r.chapter_id,
      chapterTitle: r.title,
      order: r.order,
      similarity: Math.round(Number(r.sim) * 1000) / 1000,
    }));
  } catch (e: any) {
    if (!['42P01', '42703', '42883'].includes(e?.code)) console.warn('book search failed:', e?.message ?? e);
    return [];
  }
}

export interface SeriesPassage extends BookPassage {
  projectId: string;
  bookTitle: string | null;
  bookOrder: number | null;
}

/**
 * Эхо · Вся серия (Этап E, scope-уровень выше книги): семантический поиск по ВСЕМ книгам серии.
 * Тот же локальный эмбеддер (без токенов). Отдаёт книгу+главу для перехода. Деградирует молча.
 */
export async function searchSeriesPassages(seriesId: string, query: string, topK = 12): Promise<SeriesPassage[]> {
  const embedder = getEmbeddingProvider();
  if (!embedder || !query.trim()) return [];
  const vec = await embedder.embed(query.slice(0, 2000), 'query');
  if (!vec) return [];
  try {
    const { rows } = await pool.query<{
      chunk_text: string; chapter_id: string; project_id: string; chapter_title: string | null;
      order: number | null; book_title: string | null; book_order: number | null; sim: number;
    }>(
      `SELECT sm.chunk_text, sm.chapter_id, sm.project_id, c.title AS chapter_title, c."order",
              p.title AS book_title, p.series_order AS book_order,
              1 - (sm.embedding <=> $2::vector) AS sim
         FROM semantic_memory sm
         JOIN projects p ON p.id = sm.project_id
         LEFT JOIN chapters c ON c.id = sm.chapter_id
        WHERE p.series_id = $1 AND sm.embedding IS NOT NULL AND sm.chapter_id IS NOT NULL
        ORDER BY sm.embedding <=> $2::vector
        LIMIT $3`,
      [seriesId, `[${vec.join(',')}]`, topK],
    );
    return rows.map(r => ({
      chunkText: r.chunk_text, chapterId: r.chapter_id, projectId: r.project_id,
      chapterTitle: r.chapter_title, order: r.order, bookTitle: r.book_title, bookOrder: r.book_order,
      similarity: Math.round(Number(r.sim) * 1000) / 1000,
    }));
  } catch (e: any) {
    if (!['42P01', '42703', '42883'].includes(e?.code)) console.warn('series search failed:', e?.message ?? e);
    return [];
  }
}

export interface CrossBookPassage { chunkText: string; bookTitle: string | null; }

/**
 * Cross-book ретрив (Этап E3): близкие по смыслу фрагменты из ДРУГИХ книг серии (обычно —
 * предыдущих, чтобы новая книга не противоречила канону). Косинус по semantic_memory в наборе
 * проектов. Эмбеддинг запроса локальный (Ollama) → без API-токенов. Деградирует молча (пусто).
 */
export async function retrieveCrossBookPassages(
  projectIds: string[],
  queryText: string,
  topK = 4,
): Promise<CrossBookPassage[]> {
  const embedder = getEmbeddingProvider();
  if (!embedder || !queryText.trim() || projectIds.length === 0) return [];
  const vec = await embedder.embed(queryText.slice(0, 2000), 'query');
  if (!vec) return [];
  try {
    const { rows } = await pool.query<{ chunk_text: string; title: string | null }>(
      `SELECT sm.chunk_text, p.title
         FROM semantic_memory sm
         JOIN projects p ON p.id = sm.project_id
        WHERE sm.project_id = ANY($1::uuid[]) AND sm.embedding IS NOT NULL
        ORDER BY sm.embedding <=> $2::vector
        LIMIT $3`,
      [projectIds, `[${vec.join(',')}]`, topK],
    );
    return rows.map(r => ({ chunkText: r.chunk_text, bookTitle: r.title }));
  } catch (e: any) {
    if (!['42P01', '42703', '42883'].includes(e?.code)) console.warn('cross-book retrieval failed:', e?.message ?? e);
    return [];
  }
}

export async function retrieveCrossChapterPassages(
  projectId: string,
  chapterId: string,
  queryText: string,
  topK = 6,
  lexicalTerms?: string[],
): Promise<string[]> {
  const embedder = getEmbeddingProvider();
  if (!embedder || !queryText.trim()) return [];
  const vec = await embedder.embed(queryText.slice(0, 2000), 'query');
  if (!vec) return [];
  const POOL = topK * 3;
  // POV-aware (Фаза 4): фрагмент из главы с ДРУГИМ рассказчиком помечаем «(глава от лица X)» —
  // чтобы модель не считала «я разных рассказчиков» противоречием.
  const tag = (text: string, pov: string | null) => {
    const p = (pov ?? '').trim();
    return p && p !== 'Автор' ? `(глава от лица «${p}») ${text}` : text;
  };
  try {
    const vecRes = await pool.query<{ chunk_text: string; pov_character: string | null; dist: number }>(
      `SELECT sm.chunk_text, c.pov_character, (sm.embedding <=> $3::vector) AS dist
         FROM semantic_memory sm
         LEFT JOIN chapters c ON c.id = sm.chapter_id
        WHERE sm.project_id = $1 AND sm.chapter_id <> $2 AND sm.embedding IS NOT NULL
        ORDER BY sm.embedding <=> $3::vector
        LIMIT $4`,
      [projectId, chapterId, `[${vec.join(',')}]`, POOL],
    );

    // Гибрид (Фаза 4): лексика по ИМЕНАМ present-сущностей — фрагменты из ДРУГИХ глав про тех
    // же героев, которые косинус мог не поднять. best-effort (нет 'russian' FTS → только вектор).
    let lexRes: { chunk_text: string; pov_character: string | null; lr: number }[] = [];
    const terms = [...new Set((lexicalTerms ?? [])
      .flatMap(n => n.toLowerCase().split(/[^а-яёa-z0-9]+/i))
      .filter(t => t.length >= 3))];
    if (terms.length) {
      try {
        const r = await pool.query<{ chunk_text: string; pov_character: string | null; lr: number }>(
          `SELECT sm.chunk_text, c.pov_character,
                  ts_rank(to_tsvector('russian', sm.chunk_text), to_tsquery('russian', $3)) AS lr
             FROM semantic_memory sm
             LEFT JOIN chapters c ON c.id = sm.chapter_id
            WHERE sm.project_id = $1 AND sm.chapter_id <> $2
              AND to_tsvector('russian', sm.chunk_text) @@ to_tsquery('russian', $3)
            ORDER BY lr DESC
            LIMIT $4`,
          [projectId, chapterId, terms.join(' | '), POOL],
        );
        lexRes = r.rows;
      } catch (le: any) {
        if (!['42P01', '42703', '42883', '42704', '0A000'].includes(le?.code)) console.warn('cross-chapter lexical failed:', le?.message ?? le);
      }
    }

    // Слияние fuse_score (как в чате): оба сигнала → 0.4·вектор + 0.6·лексика; один → свой.
    const maxLex = lexRes.reduce((m, r) => Math.max(m, Number(r.lr)), 0);
    const merged = new Map<string, { pov: string | null; v?: number; l?: number }>();
    for (const r of vecRes.rows) merged.set(r.chunk_text, { pov: r.pov_character, ...merged.get(r.chunk_text), v: Number(r.dist) });
    for (const r of lexRes)      merged.set(r.chunk_text, { pov: r.pov_character, ...merged.get(r.chunk_text), l: Number(r.lr) });
    const scored = [...merged.entries()].map(([text, s]) => {
      const vSim = s.v != null ? 1 / (1 + s.v) : 0;
      const lSim = s.l != null && maxLex > 0 ? s.l / maxLex : 0;
      const fused = s.v != null && s.l != null ? 0.4 * vSim + 0.6 * lSim : Math.max(vSim, lSim);
      return { text, pov: s.pov, fused };
    });
    scored.sort((a, b) => b.fused - a.fused);
    return scored.slice(0, topK).map(s => tag(s.text, s.pov));
  } catch (e: any) {
    if (!['42P01', '42703', '42883'].includes(e?.code)) console.warn('cross-chapter retrieval failed:', e?.message ?? e);
    return [];
  }
}
