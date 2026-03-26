import { useState, useRef, useEffect, useCallback } from 'react';
import { Editor } from '@tiptap/react';
import { api } from '../services/api';

export function useAutosave(chapterId: string | undefined) {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState(false);
  const chapterIdRef = useRef(chapterId);

  useEffect(() => {
    chapterIdRef.current = chapterId;
    // Reset error indicator when switching chapters
    setSaveError(false);
  }, [chapterId]);

  const onUpdate = useCallback(({ editor }: { editor: Editor }) => {
    const content = editor.getHTML();
    // Capture the chapter ID NOW (closure), not at timeout execution time.
    // Without this, rapid chapter switching would save chapter A's content into chapter B.
    const capturedId = chapterIdRef.current;

    setIsSaving(true);
    if ((window as any)._saveTimeout) clearTimeout((window as any)._saveTimeout);

    (window as any)._saveTimeout = setTimeout(async () => {
      try {
        if (!capturedId) return;
        await api.put(`/chapters/${capturedId}`, { content });
        setLastSavedAt(new Date());
        setSaveError(false);
      } catch (error) {
        console.error('Failed to save chapter:', error);
        setSaveError(true);
      } finally {
        setIsSaving(false);
      }
    }, 1000);
  }, []);

  /**
   * Immediately save content, bypassing the debounce.
   * Call when navigating away from a chapter or on Cmd+S.
   */
  const forceSave = useCallback(async (content: string) => {
    const id = chapterIdRef.current;
    if (!id) return;

    // Cancel any pending debounced save
    if ((window as any)._saveTimeout) {
      clearTimeout((window as any)._saveTimeout);
      delete (window as any)._saveTimeout;
    }

    setIsSaving(true);
    setSaveError(false);
    try {
      await api.put(`/chapters/${id}`, { content });
      setLastSavedAt(new Date());
    } catch (error) {
      console.error('Failed to force-save chapter:', error);
      setSaveError(true);
    } finally {
      setIsSaving(false);
    }
  }, []);

  return { isSaving, lastSavedAt, saveError, onUpdate, forceSave };
}
