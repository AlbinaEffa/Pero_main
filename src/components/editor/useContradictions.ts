/**
 * useContradictions — кластер логики нестыковок, вынесенный из Editor.tsx (дробление мегафайла).
 * Загрузка отчёта, классификатор-поток «развитие» (realContradictions), отклонение,
 * проактивный пер-главный скан и полный скан книги с поллингом прогресса.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../../services/api';

export type ScanIssue = {
  id: string;
  chapterId: string | null;
  entityName: string | null;
  issue: string;
  quote: string | null;
  severity: string;
  status: string;
  kind?: string;
};

export type ScanState = { status: 'running' | 'done' | 'failed'; scanned: number; total: number; found: number } | null;

export function useContradictions(projectId: string | undefined, chapterId: string | undefined) {
  const [contradictionIssues, setContradictionIssues] = useState<ScanIssue[]>([]);
  // Два потока классификатора: алярм (нестыковки) vs спокойное «развитие». Развитие НЕ тревожит
  // (не красит героя конфликтным, не идёт в гаттер/бейдж/подсветку); видно отдельным потоком в линзе.
  const realContradictions = useMemo(() => contradictionIssues.filter(i => i.kind !== 'development'), [contradictionIssues]);

  const loadContradictions = useCallback(() => {
    if (!projectId) return;
    api.get<{ issues: ScanIssue[] }>(`/bible/${projectId}/contradictions`)
      .then(d => setContradictionIssues((d.issues ?? []).filter(i => i.status === 'open')))
      .catch(() => { /* отчёта ещё нет — подсвечиваем по именам (эвристика) */ });
  }, [projectId]);
  useEffect(() => { loadContradictions(); }, [loadContradictions]);

  // Отклонить одну нестыковку по id (ложное срабатывание) — для линзы «Нестыковки».
  const dismissContradictionIssue = useCallback(async (issueId: string) => {
    setContradictionIssues(prev => prev.filter(i => i.id !== issueId));
    try { await api.post(`/bible/contradictions/${issueId}/dismiss`, {}); } catch { loadContradictions(); }
  }, [loadContradictions]);

  // Проактивно: после «Прочитать» тихо проверяем эту главу и обновляем отчёт нестыковок.
  const scanChapterContradictions = useCallback((chId?: string | null) => {
    const id = chId ?? chapterId;
    if (!projectId || !id) return;
    api.post(`/bible/${projectId}/contradictions/scan-chapter`, { chapterId: id })
      .then(() => loadContradictions())
      .catch(() => { /* квота/ошибка — тихо, отчёт остаётся прежним */ });
  }, [projectId, chapterId, loadContradictions]);

  // Живой статус скана (№1 — обратная связь ИИ): прогресс по главам + результат.
  const [scanState, setScanState] = useState<ScanState>(null);
  const scanPollRef = useRef<number | null>(null);

  /** Запустить полный скан книги на нестыковки (worker) с поллингом прогресса. */
  const runContradictionScan = useCallback(async () => {
    if (!projectId) return;
    if (scanPollRef.current) window.clearTimeout(scanPollRef.current);
    try {
      await api.post(`/bible/${projectId}/contradictions/scan`, {});
      setScanState({ status: 'running', scanned: 0, total: 0, found: 0 });
      let tries = 0;
      const poll = async () => {
        tries++;
        try {
          const d = await api.get<{ report: { status: string; totalChapters: number; scannedChapters: number } | null; issues: ScanIssue[] }>(`/bible/${projectId}/contradictions`);
          const open = (d.issues ?? []).filter(i => i.status === 'open');
          setContradictionIssues(open);
          const rep = d.report;
          if (rep && rep.status === 'running' && tries < 40) {
            setScanState({ status: 'running', scanned: rep.scannedChapters ?? 0, total: rep.totalChapters ?? 0, found: open.length });
            scanPollRef.current = window.setTimeout(poll, 3000);
          } else {
            setScanState({ status: rep?.status === 'failed' ? 'failed' : 'done', scanned: rep?.scannedChapters ?? 0, total: rep?.totalChapters ?? 0, found: open.length });
            window.setTimeout(() => setScanState(null), 5000);
          }
        } catch { setScanState(null); }
      };
      scanPollRef.current = window.setTimeout(poll, 2500);
    } catch { setScanState(null); /* квота/ошибка */ }
  }, [projectId]);

  return {
    contradictionIssues,
    realContradictions,
    dismissContradictionIssue,
    scanChapterContradictions,
    scanState,
    runContradictionScan,
  };
}
