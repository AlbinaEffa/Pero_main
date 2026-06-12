/**
 * ExportPanel — download project in various formats.
 * Supports export mode (all / drafts / done chapters) and optional Bible appendix.
 */

import { useState } from 'react';
import {
  X, FileText, File, Download, Archive, Shield, Loader2, BookOpen,
} from 'lucide-react';
import { getApiBaseUrl } from '../services/api';

const API = getApiBaseUrl();

interface Props {
  projectId: string;
  projectTitle: string;
  onClose: () => void;
}

type Filter = 'all' | 'draft' | 'done';

interface Format {
  id: string;
  label: string;
  ext: string;
  description: string;
  icon: React.ReactNode;
  endpoint: string;
  supportsBible?: boolean;
}

const FORMATS: Format[] = [
  {
    id: 'docx',
    label: 'Word (.docx)',
    ext: '.docx',
    description: 'Для Microsoft Word и Google Docs',
    icon: <FileText size={18} />,
    endpoint: 'docx',
    supportsBible: true,
  },
  {
    id: 'markdown',
    label: 'Markdown',
    ext: '.md',
    description: 'Для Notion, Obsidian и других редакторов',
    icon: <FileText size={18} />,
    endpoint: 'markdown',
    supportsBible: true,
  },
  {
    id: 'txt',
    label: 'Чистый текст',
    ext: '.txt',
    description: 'Без форматирования',
    icon: <File size={18} />,
    endpoint: 'txt',
  },
  {
    id: 'backup',
    label: 'Полный архив',
    ext: '.zip',
    description: 'Рукопись + Библия + метаданные',
    icon: <Archive size={18} />,
    endpoint: 'backup',
  },
];

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all',   label: 'Все главы' },
  { id: 'draft', label: 'В работе' },
  { id: 'done',  label: 'Готовые' },
];

async function downloadFile(url: string, filename: string, token: string): Promise<void> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

export function ExportPanel({ projectId, projectTitle, onClose }: Props) {
  const [loading, setLoading]         = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [filter, setFilter]           = useState<Filter>('all');
  const [includeBible, setIncludeBible] = useState(false);
  const [justDownloaded, setJustDownloaded] = useState<string | null>(null);

  const buildUrl = (endpoint: string) => {
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('filter', filter);
    if (includeBible) params.set('bible', '1');
    const qs = params.toString();
    return `${API}/export/${projectId}/${endpoint}${qs ? '?' + qs : ''}`;
  };

  const handleDownload = async (fmt: Format) => {
    const token = localStorage.getItem('pero_token');
    if (!token) { setError('Требуется авторизация'); return; }
    setLoading(fmt.id);
    setError(null);
    try {
      const date     = new Date().toISOString().slice(0, 10);
      const safe     = projectTitle.replace(/[^\w\s\u0400-\u04FF-]/g, '').trim();
      const filename = `${safe}-${date}${fmt.ext}`;
      await downloadFile(buildUrl(fmt.endpoint), filename, token);
      setJustDownloaded(fmt.id);
      setTimeout(() => setJustDownloaded(null), 2500);
    } catch {
      setError(`Не удалось скачать ${fmt.label}. Попробуйте ещё раз.`);
    } finally {
      setLoading(null);
    }
  };

  const handleDownloadAll = async () => {
    const token = localStorage.getItem('pero_token');
    if (!token) { setError('Требуется авторизация'); return; }
    setLoading('all');
    setError(null);
    try {
      const date = new Date().toISOString().slice(0, 10);
      await downloadFile(`${API}/export/all`, `pero-все-проекты-${date}.zip`, token);
      setJustDownloaded('all');
      setTimeout(() => setJustDownloaded(null), 2500);
    } catch {
      setError('Не удалось скачать. Попробуйте ещё раз.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(30,45,31,0.45)', backdropFilter: 'blur(4px)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px', animation: 'fadeIn 0.15s ease',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#F5F0E8', borderRadius: '20px',
          width: '100%', maxWidth: '460px',
          overflow: 'hidden', boxShadow: '0 24px 60px rgba(30,45,31,0.28)',
          animation: 'slideUp 0.2s cubic-bezier(0.34,1.56,0.64,1)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{
          background: '#fff', padding: '18px 22px',
          borderBottom: '1px solid rgba(30,45,31,0.06)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <h2 style={{
              fontFamily: '"Cormorant Garamond", serif',
              fontSize: '20px', fontWeight: 700, margin: '0 0 2px',
            }}>
              Экспорт рукописи
            </h2>
            <p style={{ fontSize: '12px', color: 'rgba(30,45,31,0.4)', margin: 0 }}>{projectTitle}</p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(30,45,31,0.05)', border: 'none', borderRadius: '50%',
              width: '30px', height: '30px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(30,45,31,0.5)',
            }}
          >
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* ── Chapter filter ── */}
          <div>
            <p style={{
              fontSize: '11px', fontWeight: 700, color: 'rgba(30,45,31,0.35)',
              textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px',
            }}>
              Главы
            </p>
            <div style={{
              display: 'flex', gap: '6px',
              background: 'rgba(30,45,31,0.04)', borderRadius: '11px', padding: '3px',
            }}>
              {FILTERS.map(f => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  style={{
                    flex: 1, padding: '6px 0', borderRadius: '8px', border: 'none',
                    fontSize: '12px', fontWeight: 500, cursor: 'pointer',
                    background: filter === f.id ? '#fff' : 'transparent',
                    color: filter === f.id ? '#1E2D1F' : 'rgba(30,45,31,0.45)',
                    boxShadow: filter === f.id ? '0 1px 4px rgba(30,45,31,0.08)' : 'none',
                    transition: 'all 0.15s',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Include Bible toggle ── */}
          <label style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderRadius: '12px',
            background: includeBible ? 'rgba(58,79,65,0.08)' : 'rgba(30,45,31,0.03)',
            border: `1.5px solid ${includeBible ? 'rgba(58,79,65,0.2)' : 'transparent'}`,
            cursor: 'pointer', transition: 'all 0.15s',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <BookOpen size={15} color={includeBible ? '#3A4F41' : 'rgba(30,45,31,0.35)'} />
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#1E2D1F' }}>
                  Приложить Библию истории
                </div>
                <div style={{ fontSize: '11px', color: 'rgba(30,45,31,0.4)', lineHeight: 1.4 }}>
                  Добавить персонажей, локации и правила мира
                </div>
              </div>
            </div>
            <div
              style={{
                width: '36px', height: '20px', borderRadius: '10px',
                background: includeBible ? '#3A4F41' : 'rgba(30,45,31,0.15)',
                position: 'relative', flexShrink: 0, transition: 'background 0.2s',
              }}
            >
              <div style={{
                position: 'absolute', top: '2px',
                left: includeBible ? '18px' : '2px',
                width: '16px', height: '16px', borderRadius: '50%',
                background: '#fff', transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(30,45,31,0.2)',
              }} />
            </div>
            <input
              type="checkbox"
              checked={includeBible}
              onChange={e => setIncludeBible(e.target.checked)}
              style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
            />
          </label>

          {/* ── Format list ── */}
          <div>
            <p style={{
              fontSize: '11px', fontWeight: 700, color: 'rgba(30,45,31,0.35)',
              textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px',
            }}>
              Формат
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {FORMATS.map(fmt => {
                const isLoading  = loading === fmt.id;
                const isDone     = justDownloaded === fmt.id;
                const isDisabled = loading !== null;
                const bibleNote  = includeBible && !fmt.supportsBible;
                return (
                  <button
                    key={fmt.id}
                    onClick={() => handleDownload(fmt)}
                    disabled={isDisabled}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '11px 14px', borderRadius: '13px',
                      border: `1.5px solid ${isDone ? 'rgba(58,79,65,0.3)' : 'rgba(30,45,31,0.08)'}`,
                      background: isDone ? 'rgba(58,79,65,0.06)' : '#fff',
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                      textAlign: 'left', transition: 'all 0.15s',
                      opacity: isDisabled && !isLoading ? 0.5 : 1,
                    }}
                    onMouseEnter={e => {
                      if (!isDisabled && !isDone)
                        e.currentTarget.style.borderColor = '#3A4F41';
                    }}
                    onMouseLeave={e => {
                      if (!isDone)
                        e.currentTarget.style.borderColor = 'rgba(30,45,31,0.08)';
                    }}
                  >
                    <div style={{
                      width: '34px', height: '34px', borderRadius: '9px',
                      background: isDone ? 'rgba(58,79,65,0.12)' : 'rgba(58,79,65,0.08)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#3A4F41', flexShrink: 0,
                    }}>
                      {isLoading
                        ? <Loader2 size={17} style={{ animation: 'spin 0.8s linear infinite' }} />
                        : fmt.icon
                      }
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '1px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#1E2D1F' }}>
                          {fmt.label}
                        </span>
                        <span style={{
                          fontSize: '10px', fontFamily: 'monospace',
                          color: 'rgba(30,45,31,0.35)', background: 'rgba(30,45,31,0.04)',
                          padding: '1px 5px', borderRadius: '3px',
                        }}>
                          {fmt.ext}
                        </span>
                        {bibleNote && (
                          <span style={{
                            fontSize: '10px', color: 'rgba(30,45,31,0.3)',
                            fontStyle: 'italic',
                          }}>
                            (без Библии)
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: '11px', color: 'rgba(30,45,31,0.42)', margin: 0, lineHeight: 1.4 }}>
                        {fmt.description}
                      </p>
                    </div>
                    <div style={{ flexShrink: 0, color: isDone ? '#3A4F41' : 'rgba(30,45,31,0.22)' }}>
                      {!isLoading && (isDone
                        ? <span style={{ fontSize: '11px', fontWeight: 600, color: '#3A4F41' }}>✓</span>
                        : <Download size={14} />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Trust note ── */}
          <div style={{
            padding: '9px 12px',
            background: 'rgba(58,79,65,0.07)', borderRadius: '11px',
            display: 'flex', alignItems: 'flex-start', gap: '9px',
          }}>
            <Shield size={14} style={{ color: '#3A4F41', marginTop: '1px', flexShrink: 0 }} />
            <p style={{ fontSize: '11px', color: 'rgba(30,45,31,0.55)', margin: 0, lineHeight: 1.5 }}>
              Ваши тексты хранятся в защищённой базе данных. Эти файлы — ваша локальная копия.
            </p>
          </div>

          {error && (
            <p style={{ fontSize: '12px', color: '#dc2626', margin: 0 }}>{error}</p>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{
          background: '#fff', padding: '13px 22px',
          borderTop: '1px solid rgba(30,45,31,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <button
            onClick={handleDownloadAll}
            disabled={loading !== null}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              fontSize: '12px',
              color: justDownloaded === 'all' ? '#3A4F41' : 'rgba(30,45,31,0.42)',
              background: 'none', border: 'none',
              cursor: loading !== null ? 'not-allowed' : 'pointer',
              fontWeight: 500, transition: 'color 0.15s', padding: 0,
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.color = '#1E2D1F'; }}
            onMouseLeave={e => {
              e.currentTarget.style.color = justDownloaded === 'all' ? '#3A4F41' : 'rgba(30,45,31,0.42)';
            }}
          >
            {loading === 'all'
              ? <Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} />
              : <Archive size={13} />
            }
            {justDownloaded === 'all' ? '✓ Скачано' : 'Скачать все проекты'}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '8px 18px', borderRadius: '10px', border: 'none',
              background: 'rgba(30,45,31,0.06)', fontSize: '13px',
              cursor: 'pointer', color: 'rgba(30,45,31,0.6)', fontWeight: 500,
            }}
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
