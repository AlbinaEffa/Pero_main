/**
 * useJobStatus — poll /api/jobs and expose retry helpers.
 *
 * Polls every POLL_INTERVAL_MS while any project has active jobs.
 * Drops to a slow heartbeat (IDLE_INTERVAL_MS) once everything is done.
 *
 * Returns:
 *   getProjectStatus(id)  — lightweight summary for spinner badge
 *   fetchProjectDetail(id) — full per-chapter breakdown for the panel (on demand)
 *   retryJob(jobId)       — retry a single failed job
 *   retryAllFailed(id)    — retry all failed jobs for a project
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';

const POLL_INTERVAL_MS = 4_000;
const IDLE_INTERVAL_MS = 15_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProcessingState = 'idle' | 'processing' | 'done' | 'partial' | 'failed';

export interface TypeCounts {
  total:     number;
  queued:    number;
  running:   number;
  succeeded: number;
  failed:    number;
}

export interface JobDetail {
  id:           string;
  type:         'extract_entities' | 'embed_chapter';
  status:       'queued' | 'running' | 'succeeded' | 'failed';
  attempts:     number;
  maxAttempts:  number;
  error:        string | null;
  createdAt:    string;
  chapterId:    string | null;
  chapterTitle: string | null;
  chapterOrder: number | null;
}

export interface ProjectJobDetail {
  isProcessing: boolean;
  summary:      TypeCounts;
  byType: {
    extract_entities: TypeCounts;
    embed_chapter:    TypeCounts;
  };
  bibleState:  ProcessingState;
  memoryState: ProcessingState;
  jobs:        JobDetail[];
}

export interface ProjectJobStatus {
  isProcessing: boolean;
  queued:       number;
  running:      number;
  succeeded:    number;
  failed:       number;
  total:        number;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useJobStatus(projectIds: string[]) {
  const [statusMap, setStatusMap] = useState<Record<string, ProjectJobStatus>>({});
  // Detailed data cache — populated on-demand by fetchProjectDetail
  const [detailMap, setDetailMap] = useState<Record<string, ProjectJobDetail>>({});
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted  = useRef(true);

  // ── Lightweight batch poll (summary only) ───────────────────────────────────
  const fetchAll = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;

    const results = await Promise.allSettled(
      ids.map(id =>
        api.get<{ isProcessing: boolean; summary: TypeCounts }>(`/jobs?projectId=${id}`)
      )
    );

    if (!isMounted.current) return;

    setStatusMap(prev => {
      const next = { ...prev };
      ids.forEach((id, i) => {
        const r = results[i];
        if (r.status === 'fulfilled') {
          next[id] = { isProcessing: r.value.isProcessing, ...r.value.summary };
        }
      });
      return next;
    });
  }, []);

  // ── Detailed fetch for a single project (panel use) ─────────────────────────
  const fetchProjectDetail = useCallback(async (projectId: string): Promise<ProjectJobDetail> => {
    const data = await api.get<ProjectJobDetail>(`/jobs?projectId=${projectId}`);
    if (isMounted.current) {
      setDetailMap(prev => ({ ...prev, [projectId]: data }));
      setStatusMap(prev => ({
        ...prev,
        [projectId]: { isProcessing: data.isProcessing, ...data.summary },
      }));
    }
    return data;
  }, []);

  // ── Retry a single failed job ────────────────────────────────────────────────
  const retryJob = useCallback(async (jobId: string, projectId: string): Promise<void> => {
    await api.post(`/jobs/${jobId}/retry`, {});
    // Immediately refresh the panel data
    if (isMounted.current) await fetchProjectDetail(projectId);
  }, [fetchProjectDetail]);

  // ── Retry all failed jobs for a project ─────────────────────────────────────
  const retryAllFailed = useCallback(async (projectId: string): Promise<number> => {
    const data = await api.post<{ retried: number }>('/jobs/retry-failed', { projectId });
    if (isMounted.current) await fetchProjectDetail(projectId);
    return data.retried;
  }, [fetchProjectDetail]);

  // ── Polling loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    isMounted.current = true;
    if (projectIds.length === 0) return;

    fetchAll(projectIds);

    let cancelled = false;

    const schedule = () => {
      if (cancelled || !isMounted.current) return;
      const anyProcessing = projectIds.some(id => statusMap[id]?.isProcessing);
      const delay = anyProcessing ? POLL_INTERVAL_MS : IDLE_INTERVAL_MS;
      timerRef.current = setTimeout(() => {
        fetchAll(projectIds).finally(() => schedule());
      }, delay);
    };

    schedule();

    return () => {
      cancelled = true;
      isMounted.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIds.join(',')]);

  // ── Accessors ────────────────────────────────────────────────────────────────
  const getProjectStatus = useCallback(
    (projectId: string): ProjectJobStatus =>
      statusMap[projectId] ?? {
        isProcessing: false,
        queued: 0, running: 0, succeeded: 0, failed: 0, total: 0,
      },
    [statusMap]
  );

  const anyProcessing = Object.values(statusMap).some(s => s.isProcessing);

  return {
    statusMap,
    detailMap,
    getProjectStatus,
    fetchProjectDetail,
    retryJob,
    retryAllFailed,
    anyProcessing,
  };
}
