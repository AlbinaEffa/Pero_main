/**
 * ExportPanel — download project in various formats.
 * Supports export mode (all / drafts / done chapters) and optional Bible appendix.
 */

import { useState } from 'react';
import {
  X, FileText, File, Download, Archive, Shield, Loader2,
  BookOpen, Check,
} from 'lucide-react';
import { getApiBaseUrl } from '../services/api';

const API = getApiBaseUrl();

interface Props {
  projectId: string;
  projectTitle: string;
  onClose: () => void;
}

type ExportFilter = 'all' | 'draft' | 'done';

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
    label: 'Текст',
    ext: '.txt',
    description: 'Чистый текст без форматирования',
    icon: <File size={18} />,
    endpoint: 'txt',
  },
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
    id: 'backup',
    label: 'Полный архив',
    ext: '.zip',
    description: 'Рукопись + Библия + главы + метаданные',
    icon: <Archive size={18} />,
    endpoint: 'backup',
  },
];

const FILTER_OPTIONS: { id: ExportFilter; label: string; hint: string }[] = [
  { id: 'all',   label: 'Все главы',     hint: 'Черновики и готовые'    },
  { id: 'done',  label: 'Готовые',       hint: 'Только отмеченные «✓»' },
  { id: 'draft', label: 'Черновики',     hint: 'Только незавершённые'  },
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
  const [loading, setLoading]             = useState<string | null>(null);
  const [error, setError]                 = useState<string | null>(null);
  const [filter, setFilter]               = useState<ExportFilter>('all');
  const [includeBible, setIncludeBible]   = useState(false);

  const buildUrl = (endpoint: string) => {
    const params = new URLSearchParams({ filter });
    if (includeBible) params.set('bible', '1');
    return `${API}/export/${projectId}/${endpoint}?${params}`;
  };

  const handleDownload = async (fmt: Format) => {
    const token = localStorage.getItem('pero_token');
    if (!token) { setError('Требуется авторизация'); return; }
    setLoading(fmt.id);
    setError(null);
    try {
      const date  = new Date().toISOString().slice(0, 10);
      const safe  = projectTitle.replace(/[^\w\s\u0400-\u04FF-]/g, '').trim();
      const filename = `${safe}-${date}${fmt.ext}`;
      await downloadFile(buildUrl(fmt.endpoint), filename, token);
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
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px', animation: 'fadeIn 0.15s ease',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#F4F1E9', borderRadius: '20px',
          width: '100%', maxWidth: '460px',
          overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.28)',
          animation: 'slideUp 0.2s cubic-bezier(0.34,1.56,0.64,1)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{
          background: '#fff', padding: '18px 22px',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', fontWeight: 700, margin: '0 0 2px' }}>
              Экспорт рукописи
            </h2>
            <p style={{ fontSize: '12px', color: 'rgba(0,0,0,0.4)', margin: 0 }}>{projectTitle}</p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(0,0,0,0.05)', border: 'none', borderRadius: '50%',
              width: '30px', height: '30px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(0,0,0,0.5)',
            }}
          >
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* ── Export mode ── */}
          <div>
            <p style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
              Что экспортировать
            </p>
            <div style={{ display: 'flex', gap: '6px' }}>
              {FILTER_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setFilter(opt.id)}
                  title={opt.hint}
                  style={{
                    flex: 1, padding: '8px 4px', borderRadius: '10px', border: '1.5px solid',
                    borderColor: filter === opt.id ? '#1e2d1f' : 'rgba(0,0,0,0.1)',
                    background: filter === opt.id ? '#1e2d1f' : '#fff',
                    color: filter === opt.id ? '#fff' : 'rgba(0,0,0,0.6)',
                    fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Bible appendix toggle ── */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none' }}>
            <div
              onClick={() => setIncludeBible(v => !v)}
              style={{
                width: '18px', height: '18px', borderRadius: '5px', border: '1.5px solid',
                borderColor: includeBible ? '#1e2d1f' : 'rgba(0,0,0,0.2)',
                background: includeBible ? '#1e2d1f' : '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s', flexShrink: 0,
              }}
            >
              {includeBible && <Check size={11} color="#fff" strokeWidth={3} />}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <BookOpen size={14} style={{ color: 'rgba(0,0,0,0.4)' }} />
              <span style={{ fontSize: '13px', color: 'rgba(0,0,0,0.7)', fontWeight: 500 }}>
                Добавить Библию истории как приложение
              </span>
            </div>
          </label>

          {/* ── Format list ── */}
          <div>
            <p style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
              Формат
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {FORMATS.map(fmt => {
                const bibleNote = includeBible && !fmt.supportsBible;
                return (
                  <button
                    key={fmt.id}
                    onClick={() => handleDownload(fmt)}
                    disabled={loading !== null}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '11px 14px', borderRadius: '13px',
                      border: '1.5px solid rgba(0,0,0,0.08)',
                      background: '#fff', cursor: loading !== null ? 'not-allowed' : 'pointer',
                      textAlign: 'left', transition: 'all 0.15s',
                      opacity: loading !== null && loading !== fmt.id ? 0.5 : 1,
                    }}
                    onMouseEnter={e => { if (!loading) e.currentTarget.style.borderColor = '#3A4F41'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,0,0,0.08)'; }}
                  >
                    <div style={{
                      width: '34px', height: '34px', borderRadius: '9px',
                      background: 'rgba(58,79,65,0.08)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#3A4F41', flexShrink: 0,
                    }}>
                      {loading === fmt.id
                        ? <Loader2 size={17} style={{ animation: 'spin 0.8s linear infinite' }} />
                        : fmt.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '1px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{fmt.label}</span>
                        <span style={{
                          fontSize: '10px', fontFamily: 'monospace',
                          color: 'rgba(0,0,0,0.35)', background: 'rgba(0,0,0,0.04)',
                          padding: '1px 5px', borderRadius: '3px',
                        }}>{fmt.ext}</span>
                        {bibleNote && (
                          <span style={{ fontSize: '10px', color: 'rgba(0,0,0,0.3)', fontStyle: 'italic' }}>без Библии</span>
                        )}
                      </div>
                      <p style={{ fontSize: '11px', color: 'rgba(0,0,0,0.42)', margin: 0, lineHeight: 1.4 }}>
                        {fmt.description}
                      </p>
                    </div>
                    {loading !== fmt.id && (
                      <Download size={14} style={{ color: 'rgba(0,0,0,0.22)', flexShrink: 0 }} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Trust ── */}
          <div style={{
            padding: '9px 12px',
            background: 'rgba(58,79,65,0.07)',
            borderRadius: '11px',
            display: 'flex', alignItems: 'flex-start', gap: '9px',
          }}>
            <Shield size={14} style={{ color: '#3A4F41', marginTop: '1px', flexShrink: 0 }} />
            <p style={{ fontSize: '11px', color: 'rgba(0,0,0,0.55)', margin: 0, lineHeight: 1.5 }}>
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
          borderTop: '1px solid rgba(0,0,0,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <button
            onClick={handleDownloadAll}
            disabled={loading !== null}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              fontSize: '12px', color: 'rgba(0,0,0,0.42)',
              background: 'none', border: 'none', cursor: loading !== null ? 'not-allowed' : 'pointer',
              fontWeight: 500, transition: 'color 0.15s', padding: 0,
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.color = '#1a1a1a'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(0,0,0,0.42)'; }}
          >
            {loading === 'all'
              ? <Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} />
              : <Archive size={13} />}
            Скачать все проекты
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '8px 18px', borderRadius: '10px', border: 'none',
              background: 'rgba(0,0,0,0.06)', fontSize: '13px',
              cursor: 'pointer', color: 'rgba(0,0,0,0.6)', fontWeight: 500,
            }}
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
