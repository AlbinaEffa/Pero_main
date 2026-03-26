/**
 * ProcessingStatusPanel
 *
 * Slide-in panel (right side) that shows the author exactly what's happening
 * to their imported manuscript:
 *   • Extraction of characters, locations, items (extract_entities jobs)
 *   • Semantic memory index for co-author search (embed_chapter jobs)
 *
 * Per chapter: queued / running / done / failed states + individual retry.
 * "Retry all" button when there are failed jobs.
 * Auto-refreshes while processing, stops polling when done.
 */

import { useEffect, useState, useRef, type ReactElement } from 'react';
import { X, RefreshCw, CheckCircle, AlertCircle, Clock, Loader, BookOpen, Brain } from 'lucide-react';
import type { ProjectJobDetail, JobDetail, ProcessingState, TypeCounts } from '../hooks/useJobStatus';

interface Props {
  projectId:    string;
  projectTitle: string;
  /** Fetches /api/jobs?projectId — called on mount and after retries */
  fetchDetail:  (id: string) => Promise<ProjectJobDetail>;
  retryJob:     (jobId: string, projectId: string) => Promise<void>;
  retryAllFailed: (projectId: string) => Promise<number>;
  onClose: () => void;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StateLabel({ state }: { state: ProcessingState }) {
  const map: Record<ProcessingState, { label: string; color: string }> = {
    idle:       { label: 'Не запущено',  color: 'rgba(0,0,0,0.3)' },
    processing: { label: 'Выполняется…', color: '#5B7E5E' },
    done:       { label: 'Готово',       color: '#3A6B40' },
    partial:    { label: 'Частично',     color: '#8B6914' },
    failed:     { label: 'Ошибка',       color: '#C0392B' },
  };
  const { label, color } = map[state];
  return (
    <span style={{
      fontSize: '11px', fontWeight: 600, letterSpacing: '0.04em',
      color, background: color + '18', padding: '2px 8px',
      borderRadius: '50px',
    }}>
      {label}
    </span>
  );
}

function ProgressBar({ counts }: { counts: TypeCounts }) {
  if (counts.total === 0) return null;
  const pct = Math.round((counts.succeeded / counts.total) * 100);
  return (
    <div style={{ marginTop: '6px' }}>
      <div style={{
        height: '5px', background: 'rgba(0,0,0,0.07)', borderRadius: '9px',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: counts.failed > 0
            ? 'linear-gradient(90deg,#3A6B40,#8B6914)'
            : '#3A6B40',
          borderRadius: '9px',
          transition: 'width 0.4s ease',
        }} />
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        marginTop: '3px', fontSize: '11px', color: 'rgba(0,0,0,0.4)',
      }}>
        <span>{counts.succeeded} из {counts.total} глав</span>
        {counts.failed > 0 && (
          <span style={{ color: '#C0392B' }}>{counts.failed} ошибок</span>
        )}
      </div>
    </div>
  );
}

function ChapterRow({
  job, onRetry, retrying,
}: {
  job: JobDetail;
  onRetry: (id: string) => void;
  retrying: boolean;
}) {
  const icons: Record<string, ReactElement> = {
    succeeded: <CheckCircle size={13} color="#3A6B40" />,
    running:   <Loader size={13} color="#5B7E5E" style={{ animation: 'spin 1s linear infinite' }} />,
    queued:    <Clock size={13} color="rgba(0,0,0,0.3)" />,
    failed:    <AlertCircle size={13} color="#C0392B" />,
  };

  const title = job.chapterTitle
    ? `${job.chapterOrder != null ? `Гл. ${job.chapterOrder + 1}` : ''} ${job.chapterTitle}`.trim()
    : 'Глава';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '5px 0', borderBottom: '1px solid rgba(0,0,0,0.04)',
    }}>
      <span style={{ flexShrink: 0 }}>{icons[job.status] ?? icons.queued}</span>
      <span style={{
        flex: 1, fontSize: '12px',
        color: job.status === 'failed' ? '#C0392B' : 'rgba(0,0,0,0.65)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {title}
      </span>

      {job.status === 'failed' && (
        <button
          onClick={() => onRetry(job.id)}
          disabled={retrying}
          title={job.error ?? 'Повторить'}
          style={{
            display: 'flex', alignItems: 'center', gap: '3px',
            background: 'none', border: '1px solid #C0392B',
            borderRadius: '50px', padding: '2px 8px', cursor: 'pointer',
            fontSize: '11px', color: '#C0392B', opacity: retrying ? 0.5 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          <RefreshCw size={10} />
          Повторить
        </button>
      )}
    </div>
  );
}

function JobSection({
  icon, title, tooltip, counts, state, jobs, onRetry, retyringIds,
}: {
  icon: ReactElement;
  title: string;
  tooltip: string;
  counts: TypeCounts;
  state: ProcessingState;
  jobs: JobDetail[];
  onRetry: (id: string) => void;
  retyringIds: Set<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const showList = counts.total > 0;

  return (
    <div style={{
      background: '#fff',
      borderRadius: '14px',
      padding: '14px 16px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      marginBottom: '12px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{
          width: '32px', height: '32px', borderRadius: '10px',
          background: 'rgba(58,75,41,0.08)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e2d1f' }}>{title}</span>
            <StateLabel state={state} />
          </div>
          <p style={{
            margin: '2px 0 0', fontSize: '11px', color: 'rgba(0,0,0,0.4)',
            lineHeight: 1.4,
          }}>
            {tooltip}
          </p>
        </div>
      </div>

      {/* Progress */}
      {showList && <ProgressBar counts={counts} />}

      {/* Chapter list (collapsible) */}
      {showList && (
        <div style={{ marginTop: '8px' }}>
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontSize: '11px', color: 'rgba(0,0,0,0.4)',
              display: 'flex', alignItems: 'center', gap: '4px',
            }}
          >
            {expanded ? '▲' : '▼'}
            {expanded ? 'Скрыть главы' : 'Показать по главам'}
          </button>

          {expanded && (
            <div style={{
              marginTop: '6px',
              maxHeight: '200px',
              overflowY: 'auto',
              paddingRight: '4px',
            }}>
              {jobs.map(j => (
                <ChapterRow
                  key={j.id}
                  job={j}
                  onRetry={onRetry}
                  retrying={retyringIds.has(j.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Idle state hint */}
      {counts.total === 0 && (
        <p style={{ margin: '8px 0 0', fontSize: '12px', color: 'rgba(0,0,0,0.3)' }}>
          Задания ещё не созданы
        </p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProcessingStatusPanel({
  projectId, projectTitle, fetchDetail, retryJob, retryAllFailed, onClose,
}: Props) {
  const [detail, setDetail] = useState<ProjectJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retyringIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [retryingAll, setRetryingAll] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const load = async () => {
    try {
      const d = await fetchDetail(projectId);
      if (mounted.current) {
        setDetail(d);
        setError(null);
        setLoading(false);
      }
    } catch {
      if (mounted.current) {
        setError('Не удалось загрузить статус');
        setLoading(false);
      }
    }
  };

  // Load on mount + auto-refresh while processing
  useEffect(() => {
    mounted.current = true;
    load();

    const schedule = () => {
      if (!mounted.current) return;
      // Keep polling while processing
      pollRef.current = setTimeout(() => {
        load().finally(() => {
          if (mounted.current && detail?.isProcessing !== false) schedule();
        });
      }, 4_000);
    };
    schedule();

    return () => {
      mounted.current = false;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleRetryJob = async (jobId: string) => {
    setRetryingIds(s => new Set([...s, jobId]));
    try {
      await retryJob(jobId, projectId);
      await load();
    } finally {
      setRetryingIds(s => { const n = new Set(s); n.delete(jobId); return n; });
    }
  };

  const handleRetryAll = async () => {
    setRetryingAll(true);
    try {
      await retryAllFailed(projectId);
      await load();
    } finally {
      setRetryingAll(false);
    }
  };

  const totalFailed = detail?.summary.failed ?? 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)',
          backdropFilter: 'blur(2px)', zIndex: 500,
          animation: 'fadeIn 0.15s ease',
        }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: '380px', maxWidth: '100vw',
        background: '#f5f0e8',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.15)',
        zIndex: 501,
        display: 'flex', flexDirection: 'column',
        animation: 'slideInRight 0.2s cubic-bezier(0.25,0.46,0.45,0.94)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 20px 16px',
          borderBottom: '1px solid rgba(0,0,0,0.07)',
          background: '#fff',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                margin: 0, fontSize: '10px', fontWeight: 700,
                letterSpacing: '0.14em', textTransform: 'uppercase',
                color: 'rgba(0,0,0,0.35)',
              }}>
                Обработка рукописи
              </p>
              <h2 style={{
                margin: '2px 0 0', fontSize: '16px', fontWeight: 700,
                fontFamily: '"Cormorant Garamond", serif',
                color: '#1e2d1f',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {projectTitle}
              </h2>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'rgba(0,0,0,0.06)', border: 'none',
                borderRadius: '50%', width: '30px', height: '30px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              <X size={14} color="rgba(0,0,0,0.5)" />
            </button>
          </div>

          {/* Overall status line */}
          {detail && !loading && (
            <div style={{
              marginTop: '10px',
              padding: '8px 12px',
              background: detail.isProcessing
                ? 'rgba(91,126,94,0.08)'
                : detail.summary.failed > 0
                  ? 'rgba(192,57,43,0.07)'
                  : 'rgba(58,107,64,0.08)',
              borderRadius: '10px',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              {detail.isProcessing && (
                <Loader size={13} color="#5B7E5E"
                  style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
              )}
              {!detail.isProcessing && detail.summary.failed > 0 && (
                <AlertCircle size={13} color="#C0392B" style={{ flexShrink: 0 }} />
              )}
              {!detail.isProcessing && detail.summary.failed === 0 && (
                <CheckCircle size={13} color="#3A6B40" style={{ flexShrink: 0 }} />
              )}
              <span style={{ fontSize: '12px', color: '#1e2d1f', lineHeight: 1.4 }}>
                {detail.isProcessing
                  ? `Обрабатывается… ${detail.summary.succeeded} из ${detail.summary.total} задач выполнено`
                  : detail.summary.failed > 0
                    ? `${detail.summary.succeeded} выполнено, ${detail.summary.failed} завершились с ошибкой`
                    : detail.summary.total > 0
                      ? `Все ${detail.summary.total} задач выполнены успешно`
                      : 'Нет фоновых задач для этого проекта'}
              </span>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {loading && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '40px 0', gap: '10px', color: 'rgba(0,0,0,0.35)',
            }}>
              <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: '13px' }}>Загрузка…</span>
            </div>
          )}

          {error && (
            <div style={{
              background: 'rgba(192,57,43,0.07)', borderRadius: '12px',
              padding: '14px 16px', color: '#C0392B', fontSize: '13px',
            }}>
              {error}
            </div>
          )}

          {detail && !loading && (
            <>
              <JobSection
                icon={<BookOpen size={16} color="#3A4F41" />}
                title="Библия истории"
                tooltip="Извлечение персонажей, мест и предметов — коавтор узнает, кто населяет ваш мир"
                counts={detail.byType.extract_entities}
                state={detail.bibleState}
                jobs={detail.jobs.filter(j => j.type === 'extract_entities')}
                onRetry={handleRetryJob}
                retyringIds={retyringIds}
              />

              <JobSection
                icon={<Brain size={16} color="#3A4F41" />}
                title="Семантическая память"
                tooltip="Индекс текста рукописи — коавтор сможет находить релевантные фрагменты из любой главы"
                counts={detail.byType.embed_chapter}
                state={detail.memoryState}
                jobs={detail.jobs.filter(j => j.type === 'embed_chapter')}
                onRetry={handleRetryJob}
                retyringIds={retyringIds}
              />

              {/* What it means explanation */}
              <div style={{
                background: 'rgba(0,0,0,0.04)', borderRadius: '12px',
                padding: '12px 14px', fontSize: '11px', color: 'rgba(0,0,0,0.45)',
                lineHeight: 1.6,
              }}>
                <strong style={{ display: 'block', marginBottom: '4px', color: 'rgba(0,0,0,0.5)' }}>
                  Что это значит для вас?
                </strong>
                {detail.bibleState === 'done'
                  ? '✅ Библия готова — откройте Библию истории в меню книги, чтобы просмотреть и одобрить найденных персонажей.'
                  : detail.bibleState === 'processing'
                    ? '⏳ Персонажи и места извлекаются в фоне. Можно уже открывать редактор — данные появятся автоматически.'
                    : ''}
                {detail.bibleState !== 'idle' && detail.memoryState !== 'idle' && ' '}
                {detail.memoryState === 'done'
                  ? '✅ Память построена — коавтор умеет искать по всей рукописи.'
                  : detail.memoryState === 'processing'
                    ? '⏳ Индекс памяти строится. Коавтор уже может отвечать на вопросы, но ответы станут точнее после завершения.'
                    : ''}
              </div>
            </>
          )}
        </div>

        {/* Footer — retry all button */}
        {totalFailed > 0 && (
          <div style={{
            padding: '14px 16px',
            borderTop: '1px solid rgba(0,0,0,0.07)',
            background: '#fff',
            flexShrink: 0,
          }}>
            <button
              onClick={handleRetryAll}
              disabled={retryingAll}
              style={{
                width: '100%', padding: '10px',
                background: retryingAll ? 'rgba(192,57,43,0.15)' : 'rgba(192,57,43,0.1)',
                border: '1px solid rgba(192,57,43,0.3)',
                borderRadius: '10px', cursor: retryingAll ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                fontSize: '13px', fontWeight: 600, color: '#C0392B',
                transition: 'all 0.15s',
              }}
            >
              {retryingAll
                ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Перезапуск…</>
                : <><RefreshCw size={14} /> Повторить все ошибки ({totalFailed})</>
              }
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn    { from { opacity:0 } to { opacity:1 } }
        @keyframes slideInRight {
          from { transform: translateX(100%) }
          to   { transform: translateX(0)    }
        }
      `}</style>
    </>
  );
}
