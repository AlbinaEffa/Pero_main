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
): Promise<string[]> {
  const embedder = getEmbeddingProvider();
  if (!embedder || !queryText.trim()) return [];
  const vec = await embedder.embed(queryText.slice(0, 2000), 'query');
  if (!vec) return [];
  try {
    const { rows } = await pool.query<{ chunk_text: string }>(
      `SELECT chunk_text FROM semantic_memory
        WHERE project_id = $1 AND chapter_id <> $2 AND embedding IS NOT NULL
        ORDER BY embedding <=> $3::vector
        LIMIT $4`,
      [projectId, chapterId, `[${vec.join(',')}]`, topK],
    );
    return rows.map(r => r.chunk_text);
  } catch (e: any) {
    if (!['42P01', '42703', '42883'].includes(e?.code)) console.warn('cross-chapter retrieval failed:', e?.message ?? e);
    return [];
  }
}
