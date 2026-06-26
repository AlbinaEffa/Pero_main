/**
 * Кэш семантических эмбеддингов карточек сущностей (имя + описание) на story_entities.
 * Пересчитываем ТОЛЬКО изменившиеся (по сравнению с embedding_text) — дедуп по смыслу
 * и линзы получают мгновенные векторы без переэмбеддинга всего Мира на каждый запрос.
 * Эмбеддинг локальный (Ollama) → без API-токенов.
 */
import { and, eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { db } from '../db/client.js';
import { getEmbeddingProvider } from './aiProvider.js';

export interface EntityVec {
  id: string;
  name: string;
  type: string;
  embedding: number[];
}

/** Канонический текст для эмбеддинга карточки сущности. */
export function entityEmbedText(name: string, description: string | null | undefined): string {
  return `${name}. ${(description ?? '').slice(0, 800)}`.trim();
}

/**
 * Актуальные эмбеддинги ОДОБРЕННЫХ сущностей проекта. Пересчитывает только те, у кого
 * вектор пуст или текст «имя. описание» изменился; результат кэширует в БД. При первом
 * вызове прогревает кэш (эмбеддит всё), дальше — мгновенно. Возвращает [] если эмбеддер
 * не настроен.
 */
export async function refreshEntityEmbeddings(projectId: string): Promise<EntityVec[]> {
  const embedder = getEmbeddingProvider();
  if (!embedder) return [];

  const rows = await db
    .select({
      id: schema.storyEntities.id,
      name: schema.storyEntities.name,
      description: schema.storyEntities.description,
      type: schema.storyEntities.type,
      embedding: schema.storyEntities.embedding,
      embeddingText: schema.storyEntities.embeddingText,
    })
    .from(schema.storyEntities)
    .where(and(
      eq(schema.storyEntities.projectId, projectId),
      eq(schema.storyEntities.status, 'approved'),
    ));

  const out: EntityVec[] = [];
  for (const e of rows) {
    const text = entityEmbedText(e.name, e.description);
    let vec = e.embedding as number[] | null;
    if (!vec || e.embeddingText !== text) {
      const fresh = await embedder.embed(text, 'document');
      if (!fresh) continue; // эмбеддер недоступен — пропускаем, добьём в следующий раз
      vec = fresh;
      await db
        .update(schema.storyEntities)
        .set({ embedding: fresh, embeddingText: text })
        .where(eq(schema.storyEntities.id, e.id));
    }
    out.push({ id: e.id, name: e.name, type: e.type, embedding: vec });
  }
  return out;
}
