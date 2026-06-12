/**
 * useWritingStats
 *
 * Tracks writing progress entirely client-side via localStorage.
 * No backend changes required — just fast key-value storage.
 *
 * Keys used (all prefixed with "pero_"):
 *   pero_ch_wc_{chapterId}          — last-known word count for that chapter
 *   pero_daily_{projectId}_{date}   — words added today for a project
 *   pero_streak_{projectId}         — { lastDate: 'YYYY-MM-DD', count: number }
 *   pero_goal_{projectId}           — target word count (number, default 80 000)
 */

import { useState, useCallback, useEffect } from 'react';

// ── helpers ───────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function today(): string {
  return toDateStr(new Date());
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDateStr(d);
}

interface StreakData {
  lastDate: string;
  count: number;
}

function readStreak(projectId: string): StreakData {
  try {
    const raw = localStorage.getItem(`pero_streak_${projectId}`);
    if (!raw) return { lastDate: '', count: 0 };
    return JSON.parse(raw) as StreakData;
  } catch {
    return { lastDate: '', count: 0 };
  }
}

function writeStreak(projectId: string, data: StreakData) {
  localStorage.setItem(`pero_streak_${projectId}`, JSON.stringify(data));
}

function touchStreak(projectId: string) {
  const todayStr = today();
  const yesterdayStr = yesterday();
  const stored = readStreak(projectId);

  if (stored.lastDate === todayStr) {
    // Already wrote today — nothing to update
    return;
  }
  if (stored.lastDate === yesterdayStr) {
    // Consecutive day — extend streak
    writeStreak(projectId, { lastDate: todayStr, count: stored.count + 1 });
  } else {
    // Streak broken (or first time)
    writeStreak(projectId, { lastDate: todayStr, count: 1 });
  }
}

// ── hook ──────────────────────────────────────────────────────────────────────

export interface WritingStats {
  /** Words added to this project today (current session + previous sessions today). */
  todayWords: number;
  /** Consecutive days where the user wrote at least one word. */
  streak: number;
  /** User-configurable target word count for the whole project. */
  wordGoal: number;
  /** Update the word goal and persist it. */
  setWordGoal: (n: number) => void;
  /**
   * Call this whenever the chapter's word count changes (e.g. on editor update).
   * It diffs the new count against the previous snapshot and accumulates the delta
   * into today's total if positive.
   */
  recordChapterWords: (chapterId: string, currentWordCount: number) => void;
  /** Force a re-read of localStorage stats (useful when opening the panel). */
  refresh: () => void;
}

export function useWritingStats(projectId: string | undefined): WritingStats {
  const [todayWords, setTodayWords] = useState(0);
  const [streak, setStreak] = useState(0);
  const [wordGoal, setWordGoalState] = useState(80000);

  // Read everything from localStorage for the current project
  const readAll = useCallback(() => {
    if (!projectId) return;
    const todayKey = `pero_daily_${projectId}_${today()}`;
    setTodayWords(parseInt(localStorage.getItem(todayKey) ?? '0', 10));
    setStreak(readStreak(projectId).count);
    setWordGoal(parseInt(localStorage.getItem(`pero_goal_${projectId}`) ?? '80000', 10));
  }, [projectId]);

  // Initial read + re-read when projectId changes
  useEffect(() => {
    readAll();
  }, [readAll]);

  const setWordGoal = useCallback((n: number) => {
    if (!projectId) return;
    const clamped = Math.max(1, Math.min(10_000_000, n));
    localStorage.setItem(`pero_goal_${projectId}`, String(clamped));
    setWordGoalState(clamped);
  }, [projectId]);

  const recordChapterWords = useCallback((chapterId: string, currentWordCount: number) => {
    if (!projectId) return;

    const snapshotKey = `pero_ch_wc_${chapterId}`;
    const prevCount = parseInt(localStorage.getItem(snapshotKey) ?? '-1', 10);

    // First time we see this chapter — just store the baseline without counting as "new"
    if (prevCount === -1) {
      localStorage.setItem(snapshotKey, String(currentWordCount));
      return;
    }

    const delta = currentWordCount - prevCount;

    if (delta > 0) {
      // Accumulate into today's counter
      const todayKey = `pero_daily_${projectId}_${today()}`;
      const existing = parseInt(localStorage.getItem(todayKey) ?? '0', 10);
      const next = existing + delta;
      localStorage.setItem(todayKey, String(next));
      setTodayWords(next);

      // Touch the streak
      touchStreak(projectId);
      setStreak(readStreak(projectId).count);
    }

    // Always refresh the snapshot (even on decrease/no-change — e.g. user deleted text)
    localStorage.setItem(snapshotKey, String(currentWordCount));
  }, [projectId]);

  return {
    todayWords,
    streak,
    wordGoal,
    setWordGoal,
    recordChapterWords,
    refresh: readAll,
  };
}
