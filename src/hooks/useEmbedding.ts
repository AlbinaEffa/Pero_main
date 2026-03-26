import { useRef, useCallback } from 'react';
import { api } from '../services/api';

const EMBED_DEBOUNCE_MS = 45_000; // 45 seconds — embeddings are expensive, fire infrequently

/**
 * Returns a `scheduleEmbed(content)` function.
 * Calling it resets a 45-second debounce timer; when it fires it POSTs
 * the plain-text content to /api/embed/chapter. Fire-and-forget — never throws.
 */
export function useEmbedding(projectId: string | undefined, chapterId: string | undefined) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleEmbed = useCallback(
    (content: string) => {
      if (!projectId || !chapterId) return;

      if (timerRef.current) clearTimeout(timerRef.current);

      timerRef.current = setTimeout(() => {
        // Fire and forget — never block the editor
        api
          .post('/embed/chapter', { projectId, chapterId, content })
          .catch((e: unknown) => console.warn('Background embedding failed:', e));
      }, EMBED_DEBOUNCE_MS);
    },
    [projectId, chapterId]
  );

  return { scheduleEmbed };
}
