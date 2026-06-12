import { useState, useCallback } from 'react';
import { api } from '../services/api';
import { track } from '../services/analytics';
import { registerApproval } from '../components/AhaCelebration';
import { Entity, BibleUpdateSuggestion } from '../components/editor/types';

export function useBibleExtraction(
  projectId: string | undefined,
  chapterId: string | undefined,
  getContent: () => string
) {
  const [isExtracting, setIsExtracting] = useState(false);
  const [suggestions, setSuggestions] = useState<Entity[]>([]);
  const [approvedEntities, setApprovedEntities] = useState<Entity[]>([]);
  const [updateSuggestions, setUpdateSuggestions] = useState<BibleUpdateSuggestion[]>([]);

  /** Fetch pending update suggestions for the current project from the server. */
  const loadUpdateSuggestions = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await api.get<{ updates: BibleUpdateSuggestion[] }>(`/bible/${projectId}/updates`);
      setUpdateSuggestions(data.updates ?? []);
    } catch (e) {
      console.error('Failed to load bible updates:', e);
    }
  }, [projectId]);

  /** Merge freshly returned update suggestions (from extract/recheck) into state. */
  function mergeUpdateSuggestions(fresh: BibleUpdateSuggestion[]) {
    if (!fresh.length) return;
    setUpdateSuggestions(prev => {
      const ids = new Set(prev.map(u => u.id));
      return [...prev, ...fresh.filter(u => !ids.has(u.id))];
    });
  }

  /**
   * Batch recheck — sends up to N chapters to a single API call.
   * Returns summary of what was found. Called from handleRecheckAllStale.
   */
  const recheckBatch = useCallback(async (chapterIds: string[]): Promise<{
    processed: number;
    skipped: number;
    totalNew: number;
    summarizedChapters: { chapterId: string; chapterSummary?: string | null }[];
  }> => {
    if (!projectId || chapterIds.length === 0) {
      return { processed: 0, skipped: 0, totalNew: 0, summarizedChapters: [] };
    }
    try {
      const data = await api.post<{
        entities: Entity[];
        updates: BibleUpdateSuggestion[];
        total: number;
        processed: number;
        skipped: number;
      }>('/bible/recheck/batch', { projectId, chapterIds });

      const entities = data.entities ?? [];
      const updates = data.updates ?? [];

      setSuggestions(prev => {
        const existingIds = new Set(prev.map(e => e.id));
        return [...prev, ...entities.filter(e => !existingIds.has(e.id))];
      });
      mergeUpdateSuggestions(updates);

      track('bible_batch_recheck', {
        projectId,
        processed: data.processed,
        skipped: data.skipped,
        totalNew: data.total,
      });

      return {
        processed: data.processed ?? 0,
        skipped: data.skipped ?? 0,
        totalNew: data.total ?? 0,
        summarizedChapters: [],
      };
    } catch (e) {
      console.error('Batch recheck failed:', e);
      return { processed: 0, skipped: 0, totalNew: 0, summarizedChapters: [] };
    }
  }, [projectId]);

  const handleExtract = async () => {
    if (!projectId || !chapterId) return;
    setIsExtracting(true);
    try {
      const chapterContent = getContent();
      const data = await api.post<{ entities: Entity[]; updates: BibleUpdateSuggestion[]; chapterSummary?: string }>(
        '/bible/extract',
        { chapterContent, projectId, chapterId },
      );
      const entities = data.entities ?? [];
      setSuggestions(entities);
      mergeUpdateSuggestions(data.updates ?? []);
      track('entities_extracted', { projectId, chapterId, count: entities.length });
      return { chapterSummary: data.chapterSummary };
    } catch (e) {
      console.error('Extract failed:', e);
      return {};
    } finally {
      setIsExtracting(false);
    }
  };

  /**
   * Server-side re-extraction: reads saved chapter content from the DB.
   * Returns true if any new suggestions or update suggestions were produced.
   */
  const recheckChapter = async (): Promise<{ hasNew: boolean; chapterSummary?: string }> => {
    if (!chapterId) return { hasNew: false };
    setIsExtracting(true);
    try {
      const data = await api.post<{ entities: Entity[]; updates: BibleUpdateSuggestion[]; chapterSummary?: string }>(
        `/bible/recheck/chapter/${chapterId}`,
        {},
      );
      const entities = data.entities ?? [];
      const updates = data.updates ?? [];

      setSuggestions(prev => {
        const existingIds = new Set(prev.map(e => e.id));
        const fresh = entities.filter(e => !existingIds.has(e.id));
        return [...prev, ...fresh];
      });
      mergeUpdateSuggestions(updates);

      track('entities_extracted', {
        projectId,
        chapterId,
        count: entities.length + updates.length,
        source: 'recheck',
      });
      return { hasNew: entities.length > 0 || updates.length > 0, chapterSummary: data.chapterSummary };
    } catch (e) {
      console.error('Recheck failed:', e);
      return { hasNew: false };
    } finally {
      setIsExtracting(false);
    }
  };

  const approveSuggestion = async (entityId: string) => {
    try {
      const entity = suggestions.find(s => s.id === entityId);
      await api.patch(`/bible/${entityId}/approve`);
      if (entity) {
        setApprovedEntities(prev => [...prev, { ...entity, chapterId: chapterId ?? null }]);
        track('entity_approved', { projectId, type: entity.type });
        registerApproval(projectId);
      }
      setSuggestions(prev => prev.filter(s => s.id !== entityId));
    } catch (e) {
      console.error(e);
    }
  };

  const rejectSuggestion = async (entityId: string) => {
    try {
      await api.patch(`/bible/${entityId}/reject`);
      setSuggestions(prev => prev.filter(s => s.id !== entityId));
      track('entity_rejected', { projectId });
    } catch (e) {
      console.error(e);
    }
  };

  /** Accept a bible update suggestion: applies proposed description to the approved entity. */
  const acceptUpdate = async (updateId: string) => {
    try {
      const upd = updateSuggestions.find(u => u.id === updateId);
      await api.post(`/bible/updates/${updateId}/accept`, {});
      // Optimistically update the approved entity description in local state
      if (upd) {
        setApprovedEntities(prev =>
          prev.map(e => e.id === upd.entityId ? { ...e, description: upd.proposedDescription } : e)
        );
        track('bible_update_accepted', { projectId, entityName: upd.entityName });
      }
      setUpdateSuggestions(prev => prev.filter(u => u.id !== updateId));
    } catch (e) {
      console.error('Accept update failed:', e);
    }
  };

  /** Reject a bible update suggestion: AI was wrong, keep current description. */
  const rejectUpdate = async (updateId: string) => {
    try {
      await api.post(`/bible/updates/${updateId}/reject`, {});
      setUpdateSuggestions(prev => prev.filter(u => u.id !== updateId));
      track('bible_update_rejected', { projectId });
    } catch (e) {
      console.error('Reject update failed:', e);
    }
  };

  /** Dismiss a bible update suggestion: don't process now, don't show again this session. */
  const dismissUpdate = async (updateId: string) => {
    try {
      await api.post(`/bible/updates/${updateId}/dismiss`, {});
      setUpdateSuggestions(prev => prev.filter(u => u.id !== updateId));
    } catch (e) {
      console.error('Dismiss update failed:', e);
    }
  };

  /** Dismiss all pending update suggestions for a given chapter. */
  const bulkDismissChapter = async (chapterId: string) => {
    if (!projectId) return;
    try {
      await api.post<{ dismissed: number }>('/bible/updates/bulk-dismiss', { projectId, chapterId });
      // Optimistic: remove all pending updates from this chapter
      setUpdateSuggestions(prev => prev.filter(u => u.chapterId !== chapterId));
      track('bible_updates_bulk_dismissed', { projectId, chapterId });
    } catch (e) {
      console.error('Bulk dismiss failed:', e);
    }
  };

  /** Reject all pending update suggestions for a given chapter. */
  const bulkRejectChapter = async (chapterId: string) => {
    if (!projectId) return;
    try {
      await api.post<{ rejected: number }>('/bible/updates/bulk-reject', { projectId, chapterId });
      setUpdateSuggestions(prev => prev.filter(u => u.chapterId !== chapterId));
      track('bible_updates_bulk_rejected', { projectId, chapterId });
    } catch (e) {
      console.error('Bulk reject failed:', e);
    }
  };

  return {
    isExtracting,
    suggestions,
    approvedEntities,
    updateSuggestions,
    handleExtract,
    recheckChapter,
    recheckBatch,
    approveSuggestion,
    rejectSuggestion,
    loadUpdateSuggestions,
    acceptUpdate,
    rejectUpdate,
    dismissUpdate,
    bulkDismissChapter,
    bulkRejectChapter,
  };
}
