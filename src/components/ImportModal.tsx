/**
 * ImportModal — multi-step manuscript import flow.
 *
 * Steps:
 *  upload   → user drops / selects a file
 *  parsing  → file sent to /api/import/parse, spinner shown
 *  preview  → detected chapters shown, user edits title / genre / color
 *  creating → /api/import/create called, background extraction noted
 */

import React, { useState, useRef, useCallback } from 'react';
import { X, Upload, FileText, CheckCircle, ChevronDown, ChevronUp, AlertCircle, AlertTriangle } from 'lucide-react';
import { getApiBaseUrl } from '../services/api';

const API = getApiBaseUrl();

const PRESET_COLORS = ['#3A4F41', '#C66B49', '#2C3E50', '#806B8A', '#2B7A6B', '#8B6B32', '#6B2B2B', '#2B4A8B'];
const GENRE_PRESETS = ['Фэнтези', 'Фантастика', 'Детектив', 'Роман', 'Ужасы', 'Приключения', 'Другое'];
const ACCEPTED_EXTS = ['.txt', '.docx', '.pdf', '.epub', '.fb2'];

export interface ParsedChapter {
  index: number;
  title: string;
  content: string;
  wordCount: number;
  preview: string;
}

interface ParseResult {
  title: string;
  totalWords: number;
  chapters: ParsedChapter[];
}

type Step = 'upload' | 'parsing' | 'preview' | 'creating';

interface ImportModalProps {
  onClose: () => void;
  onSuccess: (projectId: string, firstChapterId: string) => void;
}

function formatWords(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}К`;
  return String(n);
}

export default function ImportModal({ onClose, onSuccess }: ImportModalProps) {
  const [step, setStep] = useState<Step>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [createError, setCreateError] = useState('');
  const [processingWarning, setProcessingWarning] = useState('');

  const [parsed, setParsed] = useState<ParseResult | null>(null);

  // Editable fields (preview step)
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [color, setColor] = useState('#3A4F41');
  const [showAllChapters, setShowAllChapters] = useState(false);
  const [customGenres, setCustomGenres] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('pero_custom_genres') || '[]'); } catch { return []; }
  });

  const saveCustomGenre = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || GENRE_PRESETS.includes(trimmed) || customGenres.includes(trimmed)) return;
    const updated = [...customGenres, trimmed];
    setCustomGenres(updated);
    localStorage.setItem('pero_custom_genres', JSON.stringify(updated));
  };

  const removeCustomGenre = (value: string) => {
    const updated = customGenres.filter(g => g !== value);
    setCustomGenres(updated);
    localStorage.setItem('pero_custom_genres', JSON.stringify(updated));
    if (genre === value) setGenre('');
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File handling ──────────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
    if (!ACCEPTED_EXTS.includes(ext)) {
      setParseError(`Формат ${ext} не поддерживается. Допустимы: ${ACCEPTED_EXTS.join(', ')}`);
      return;
    }

    setFileName(file.name);
    setParseError('');
    setStep('parsing');

    const token = localStorage.getItem('pero_token');
    if (!token) { setParseError('Не авторизован'); setStep('upload'); return; }

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API}/import/parse`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setParseError(data.error ?? 'Ошибка при анализе файла');
        setStep('upload');
        return;
      }

      setParsed(data as ParseResult);
      setTitle(data.title ?? '');
      setStep('preview');
    } catch {
      setParseError('Не удалось подключиться к серверу');
      setStep('upload');
    }
  }, []);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // ── Create project ─────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!parsed || !title.trim()) return;
    const token = localStorage.getItem('pero_token');
    if (!token) return;

    setCreateError('');
    setStep('creating');

    try {
      const res = await fetch(`${API}/import/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: title.trim(),
          genre: genre || null,
          color,
          chapters: parsed.chapters.map(c => ({ title: c.title, content: c.content })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error ?? 'Ошибка при создании проекта');
        setStep('preview');
        return;
      }

      if (data.processingStarted === false && data.processingWarning) {
        setProcessingWarning(data.processingWarning);
        // Give the user a moment to see the warning before navigating away
        await new Promise(r => setTimeout(r, 2500));
      }

      onSuccess(data.project.id, data.firstChapterId);
    } catch {
      setCreateError('Не удалось подключиться к серверу');
      setStep('preview');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const visibleChapters = showAllChapters ? (parsed?.chapters ?? []) : (parsed?.chapters ?? []).slice(0, 5);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(4px)', zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px', animation: 'fadeIn 0.15s ease',
      }}
      onClick={step === 'parsing' || step === 'creating' ? undefined : onClose}
    >
      <div
        style={{
          background: '#F4F1E9', borderRadius: '24px', width: '100%',
          maxWidth: step === 'preview' ? '560px' : '480px',
          maxHeight: '90vh',
          boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          animation: 'slideUp 0.2s cubic-bezier(0.34,1.56,0.64,1)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{ background: '#fff', padding: '20px 24px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '22px', fontWeight: 700, margin: 0 }}>
              {step === 'upload'   && 'Импорт рукописи'}
              {step === 'parsing'  && 'Анализ файла'}
              {step === 'preview'  && 'Подтвердите импорт'}
              {step === 'creating' && 'Создаём проект'}
            </h2>
            {step === 'upload' && (
              <p style={{ fontSize: '12px', color: 'rgba(0,0,0,0.4)', margin: '2px 0 0' }}>
                TXT · DOCX · PDF · EPUB · FB2 · до 20 МБ
              </p>
            )}
            {step === 'preview' && parsed && (
              <p style={{ fontSize: '12px', color: 'rgba(0,0,0,0.4)', margin: '2px 0 0' }}>
                {parsed.chapters.length} {parsed.chapters.length === 1 ? 'глава' : parsed.chapters.length < 5 ? 'главы' : 'глав'} · {formatWords(parsed.totalWords)} слов
              </p>
            )}
          </div>
          {step !== 'parsing' && step !== 'creating' && (
            <button onClick={onClose} style={{ background: 'rgba(0,0,0,0.05)', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(0,0,0,0.5)' }}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* ── Body ── */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>

          {/* STEP: upload */}
          {step === 'upload' && (
            <>
              <div
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${isDragging ? '#3A4F41' : 'rgba(0,0,0,0.14)'}`,
                  borderRadius: '18px',
                  padding: '40px 24px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: isDragging ? 'rgba(58,79,65,0.04)' : '#fff',
                  transition: 'all 0.2s',
                }}
              >
                <input ref={fileInputRef} type="file" accept={ACCEPTED_EXTS.join(',')} style={{ display: 'none' }} onChange={onFileInput} />
                <Upload size={36} style={{ color: isDragging ? '#3A4F41' : 'rgba(0,0,0,0.2)', marginBottom: '12px', transition: 'color 0.2s' }} />
                <p style={{ fontSize: '15px', fontWeight: 600, color: 'rgba(0,0,0,0.65)', margin: '0 0 6px' }}>
                  Перетащите файл сюда
                </p>
                <p style={{ fontSize: '13px', color: 'rgba(0,0,0,0.4)', margin: 0 }}>
                  или нажмите, чтобы выбрать
                </p>
              </div>

              {parseError && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '14px', padding: '12px 14px', background: 'rgba(220,38,38,0.06)', borderRadius: '12px', color: '#dc2626' }}>
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                  <span style={{ fontSize: '13px' }}>{parseError}</span>
                </div>
              )}
            </>
          )}

          {/* STEP: parsing */}
          {step === 'parsing' && (
            <div style={{ textAlign: 'center', padding: '20px 0 10px' }}>
              <div style={{ width: '48px', height: '48px', border: '4px solid rgba(0,0,0,0.08)', borderTopColor: '#3A4F41', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 20px' }} />
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'rgba(0,0,0,0.7)', marginBottom: '6px' }}>
                Анализируем рукопись…
              </p>
              <p style={{ fontSize: '13px', color: 'rgba(0,0,0,0.4)', margin: 0 }}>
                {fileName}
              </p>
              <p style={{ fontSize: '12px', color: 'rgba(0,0,0,0.3)', margin: '10px 0 0' }}>
                Определяем структуру глав
              </p>
            </div>
          )}

          {/* STEP: preview */}
          {step === 'preview' && parsed && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {/* Title */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', marginBottom: '6px' }}>
                  Название
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1.5px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', transition: 'border-color 0.15s' }}
                  onFocus={e => (e.target.style.borderColor = '#3A4F41')}
                  onBlur={e => (e.target.style.borderColor = 'rgba(0,0,0,0.1)')}
                />
              </div>

              {/* Genre */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', marginBottom: '6px' }}>
                  Жанр
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {GENRE_PRESETS.map(g => (
                    <button
                      key={g}
                      onClick={() => {
                        if (g === 'Другое') {
                          setGenre(genre === 'Другое' || !GENRE_PRESETS.includes(genre) ? '' : 'Другое');
                        } else {
                          setGenre(genre === g ? '' : g);
                        }
                      }}
                      style={{
                        padding: '5px 12px', borderRadius: '50px', fontSize: '12px',
                        border: `1.5px solid ${(g === 'Другое' ? (!GENRE_PRESETS.slice(0,-1).includes(genre) && genre !== '') || genre === 'Другое' : genre === g) ? '#3A4F41' : 'rgba(0,0,0,0.1)'}`,
                        background: (g === 'Другое' ? (!GENRE_PRESETS.slice(0,-1).includes(genre) && genre !== '') || genre === 'Другое' : genre === g) ? 'rgba(58,79,65,0.08)' : 'transparent',
                        color: (g === 'Другое' ? (!GENRE_PRESETS.slice(0,-1).includes(genre) && genre !== '') || genre === 'Другое' : genre === g) ? '#3A4F41' : 'rgba(0,0,0,0.5)',
                        cursor: 'pointer', fontWeight: 400, transition: 'all 0.15s',
                      }}
                    >
                      {g}
                    </button>
                  ))}
                  {/* Saved custom genre chips */}
                  {customGenres.map(g => (
                    <span key={g} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '5px 10px 5px 12px', borderRadius: '50px', fontSize: '12px', border: `1.5px solid ${genre === g ? '#3A4F41' : 'rgba(0,0,0,0.1)'}`, background: genre === g ? 'rgba(58,79,65,0.08)' : 'transparent', color: genre === g ? '#3A4F41' : 'rgba(0,0,0,0.5)' }}>
                      <span style={{ cursor: 'pointer' }} onClick={() => setGenre(genre === g ? '' : g)}>{g}</span>
                      <button onClick={() => removeCustomGenre(g)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: 'inherit', opacity: 0.5, fontSize: '13px' }}>×</button>
                    </span>
                  ))}
                </div>
                {/* Custom genre input — shown when "Другое" is active */}
                {(!GENRE_PRESETS.slice(0, -1).includes(genre) && !customGenres.includes(genre)) && (
                  <input
                    autoFocus
                    type="text"
                    placeholder="Введите жанр и нажмите Enter..."
                    value={genre === 'Другое' ? '' : genre}
                    onChange={e => setGenre(e.target.value || 'Другое')}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value.trim();
                        if (val) { saveCustomGenre(val); setGenre(val); }
                      }
                    }}
                    style={{
                      marginTop: '10px', width: '100%', padding: '8px 12px',
                      borderRadius: '10px', border: '1.5px solid #3A4F41',
                      background: '#fff', fontSize: '13px', outline: 'none',
                      boxSizing: 'border-box', fontFamily: 'inherit', color: '#1a1a1a',
                    }}
                    onBlur={e => {
                      const val = e.target.value.trim();
                      if (val && val !== 'Другое') { saveCustomGenre(val); setGenre(val); }
                      else if (!val) setGenre('');
                    }}
                  />
                )}
              </div>

              {/* Color */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', marginBottom: '8px' }}>
                  Цвет обложки
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      style={{
                        width: '26px', height: '26px', borderRadius: '8px', background: c,
                        border: `2.5px solid ${color === c ? '#1a1a1a' : 'transparent'}`,
                        cursor: 'pointer', transition: 'transform 0.15s',
                        transform: color === c ? 'scale(1.15)' : 'scale(1)',
                      }}
                    />
                  ))}
                  <input type="color" value={color} onChange={e => setColor(e.target.value)}
                    style={{ width: '26px', height: '26px', borderRadius: '8px', border: '1.5px solid rgba(0,0,0,0.1)', cursor: 'pointer', padding: '2px' }}
                  />
                </div>
              </div>

              {/* Preview mini-book */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', background: 'rgba(0,0,0,0.03)', borderRadius: '12px' }}>
                <div style={{
                  width: '28px', height: '44px', background: color, borderRadius: '2px 4px 4px 2px',
                  boxShadow: '-1px 0 0 rgba(0,0,0,0.2), 1px 1px 4px rgba(0,0,0,0.2)',
                  flexShrink: 0,
                }} />
                <div>
                  <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, fontFamily: '"Cormorant Garamond", serif', color: '#1a1a1a' }}>
                    {title || 'Название книги'}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'rgba(0,0,0,0.4)' }}>
                    {genre || 'Жанр'} · {formatWords(parsed.totalWords)} слов
                  </p>
                </div>
              </div>

              {/* Chapter list */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', marginBottom: '8px' }}>
                  Главы ({parsed.chapters.length})
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {visibleChapters.map((chapter, i) => (
                    <div key={i} style={{ background: '#fff', borderRadius: '12px', padding: '10px 14px', border: '1px solid rgba(0,0,0,0.06)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', marginBottom: chapter.preview ? '4px' : 0 }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {chapter.title}
                        </span>
                        <span style={{ fontSize: '11px', color: 'rgba(0,0,0,0.35)', flexShrink: 0 }}>
                          {formatWords(chapter.wordCount)} сл.
                        </span>
                      </div>
                      {chapter.preview && (
                        <p style={{ fontSize: '12px', color: 'rgba(0,0,0,0.45)', margin: 0, lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } as React.CSSProperties}>
                          {chapter.preview}
                        </p>
                      )}
                    </div>
                  ))}

                  {parsed.chapters.length > 5 && (
                    <button
                      onClick={() => setShowAllChapters(!showAllChapters)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px', background: 'transparent', border: '1.5px dashed rgba(0,0,0,0.12)', borderRadius: '12px', cursor: 'pointer', fontSize: '12px', color: 'rgba(0,0,0,0.45)', transition: 'all 0.15s' }}
                    >
                      {showAllChapters ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      {showAllChapters ? 'Скрыть' : `Показать ещё ${parsed.chapters.length - 5}`}
                    </button>
                  )}
                </div>
              </div>

              {createError && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '12px 14px', background: 'rgba(220,38,38,0.06)', borderRadius: '12px', color: '#dc2626' }}>
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                  <span style={{ fontSize: '13px' }}>{createError}</span>
                </div>
              )}
            </div>
          )}

          {/* STEP: creating */}
          {step === 'creating' && (
            <div style={{ textAlign: 'center', padding: '20px 0 10px' }}>
              {!processingWarning && (
                <div style={{ width: '48px', height: '48px', border: '4px solid rgba(0,0,0,0.08)', borderTopColor: '#3A4F41', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 20px' }} />
              )}
              {processingWarning ? (
                <CheckCircle size={40} style={{ color: '#3A4F41', margin: '0 auto 16px', display: 'block' }} />
              ) : null}
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'rgba(0,0,0,0.7)', marginBottom: '6px' }}>
                {processingWarning ? 'Проект создан' : 'Создаём проект…'}
              </p>
              <p style={{ fontSize: '13px', color: 'rgba(0,0,0,0.4)', margin: '0 0 12px' }}>
                «{title}»
              </p>
              {processingWarning ? (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '12px 14px', background: 'rgba(217,119,6,0.08)', borderRadius: '12px', color: '#b45309', textAlign: 'left' }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
                  <span style={{ fontSize: '12px', lineHeight: 1.5 }}>{processingWarning}</span>
                </div>
              ) : (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 14px', background: 'rgba(58,79,65,0.06)', borderRadius: '50px', fontSize: '11px', color: 'rgba(58,79,65,0.8)' }}>
                  <CheckCircle size={13} /> После создания ИИ проанализирует персонажей и места
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        {(step === 'preview') && (
          <div style={{ background: '#fff', padding: '14px 24px', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', gap: '10px', justifyContent: 'flex-end', flexShrink: 0 }}>
            <button onClick={onClose} style={{ padding: '10px 18px', borderRadius: '12px', border: 'none', background: 'transparent', fontSize: '14px', cursor: 'pointer', color: 'rgba(0,0,0,0.5)', fontWeight: 500 }}>
              Отмена
            </button>
            <button
              onClick={handleCreate}
              disabled={!title.trim()}
              style={{
                padding: '10px 22px', borderRadius: '12px', border: 'none',
                background: title.trim() ? '#3A4F41' : 'rgba(0,0,0,0.08)',
                color: title.trim() ? '#fff' : 'rgba(0,0,0,0.3)',
                fontSize: '14px', fontWeight: 600,
                cursor: title.trim() ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s',
              }}
            >
              Импортировать {parsed ? `(${parsed.chapters.length} ${parsed.chapters.length === 1 ? 'глава' : parsed.chapters.length < 5 ? 'главы' : 'глав'})` : ''}
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px) scale(0.97) } to { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  );
}
