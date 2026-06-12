import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../services/api';
import { Entity, EntityLink, EntityEvent } from '../editor/types';

/**
 * useWorldBuild — пульс онбординга «Перо читает книгу».
 *
 * Поллит два уже существующих API (новых серверных ручек не требуется):
 *   GET /jobs?projectId   — прогресс джоб extract_entities по главам
 *   GET /bible/:projectId — сущности появляются «живьём» по мере чтения
 *
 * Состояние выводится из БД, а не хранится во фронте: закрытие вкладки
 * безопасно, при возврате лента продолжается с места.
 */

const POLL_MS = 2_500;

interface ExtractCounts {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
}

interface JobRow {
  id: string;
  type: string;
  status: string;
  chapterTitle: string | null;
  chapterOrder: number | null;
}

export interface WorldBuildState {
  /** Счётчики джоб извлечения; null — ещё не загружено. */
  counts: ExtractCounts | null;
  /** Заголовок главы, которую Перо «читает» прямо сейчас. */
  currentChapterTitle: string | null;
  /** Извлечение закончено (успешно или частично). */
  isDone: boolean;
  /** Закончено, но часть глав не прочиталась. */
  isPartial: boolean;
  /** Все найденные сущности (pending + approved). */
  entities: Entity[];
  links: EntityLink[];
  events: EntityEvent[];
  /** id сущностей, появившихся в последнем поллинге, — для анимации ленты. */
  freshIds: string[];
  /** Повторить упавшие главы. */
  retryFailed: () => Promise<void>;
}

export function useWorldBuild(projectId: string | undefined): WorldBuildState {
  const [counts, setCounts] = useState<ExtractCounts | null>(null);
  const [currentChapterTitle, setCurrentChapterTitle] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);
  const [isPartial, setIsPartial] = useState(false);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [links, setLinks] = useState<EntityLink[]>([]);
  const [events, setEvents] = useState<EntityEvent[]>([]);
  const [freshIds, setFreshIds] = useState<string[]>([]);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const doneRef = useRef(false);

  const poll = useCallback(async () => {
    if (!projectId) return;
    try {
      const [jobs, bible] = await Promise.all([
        api.get<{ byType: { extract_entities: ExtractCounts }; jobs: JobRow[] }>(`/jobs?projectId=${projectId}`),
        api.get<{ entities: Entity[]; links?: EntityLink[]; events?: EntityEvent[] }>(`/bible/${projectId}`),
      ]);

      const ex = jobs.byType?.extract_entities ?? { total: 0, queued: 0, running: 0, succeeded: 0, failed: 0 };
      setCounts(ex);

      const running = (jobs.jobs ?? []).find(j => j.type === 'extract_entities' && j.status === 'running');
      setCurrentChapterTitle(running?.chapterTitle ?? null);

      const done = ex.total === 0 || (ex.queued === 0 && ex.running === 0);
      setIsDone(done);
      setIsPartial(done && ex.failed > 0);
      if (done) doneRef.current = true;

      const all = bible.entities ?? [];
      const fresh = all.filter(e => !knownIdsRef.current.has(e.id)).map(e => e.id);
      // Первый поллинг не «свежий» — иначе при возврате в онбординг вся лента мигнёт разом
      if (knownIdsRef.current.size > 0 && fresh.length > 0) setFreshIds(fresh);
      all.forEach(e => knownIdsRef.current.add(e.id));
      setEntities(all.filter(e => e.status !== 'rejected'));
      setLinks(bible.links ?? []);
      setEvents(bible.events ?? []);
    } catch (e) {
      // Сеть моргнула — лента просто замрёт до следующего поллинга
      console.warn('[worldBuild] poll failed:', e);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    doneRef.current = false;
    knownIdsRef.current = new Set();
    void poll();
    const id = setInterval(() => {
      if (doneRef.current) { clearInterval(id); return; }
      void poll();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [projectId, poll]);

  const retryFailed = useCallback(async () => {
    if (!projectId) return;
    await api.post('/jobs/retry-failed', { projectId });
    doneRef.current = false;
    setIsDone(false);
    setIsPartial(false);
    // Перезапустить поллинг
    const id = setInterval(() => {
      if (doneRef.current) { clearInterval(id); return; }
      void poll();
    }, POLL_MS);
    void poll();
  }, [projectId, poll]);

  return { counts, currentChapterTitle, isDone, isPartial, entities, links, events, freshIds, retryFailed };
}

/**
 * Вытащить «атмосферные» цитаты из текста глав — показываются, пока Перо читает.
 * Чисто клиентская обработка, ноль AI-затрат.
 */
export function extractQuotes(chapterContents: string[], max = 24): string[] {
  const quotes: string[] = [];
  for (const html of chapterContents) {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const sentences = text.split(/(?<=[.!?…»])\s+/);
    for (const s of sentences) {
      const t = s.trim();
      if (t.length >= 60 && t.length <= 160 && !/^[-–—•\d]/.test(t)) quotes.push(t);
    }
  }
  // Перемешать один раз (Fisher–Yates), чтобы цитаты шли не подряд из одной главы
  for (let i = quotes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [quotes[i], quotes[j]] = [quotes[j], quotes[i]];
  }
  return quotes.slice(0, max);
}
