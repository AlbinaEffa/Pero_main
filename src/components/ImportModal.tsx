/**
 * ImportModal — multi-step manuscript import flow.
 *
 * Steps:
 *  upload   → user drops / selects a file
 *  parsing  → file sent to /api/import/parse, spinner shown
 *  preview  → detected chapters shown, user edits title / genre / color
 *  creating → /api/import/create called, background extraction noted
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Upload, FileText, CheckCircle, ChevronDown, ChevronUp, AlertCircle, AlertTriangle } from 'lucide-react';
import { getApiBaseUrl } from '../services/api';
import { paywall } from '../store/paywall';
import GenrePicker from './GenrePicker';

const API = getApiBaseUrl();

const PRESET_COLORS = ['#3A4F41', '#C66B49', '#2C3E50', '#806B8A', '#2B7A6B', '#8B6B32', '#6B2B2B', '#2B4A8B'];
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
  /** Файл, выбранный заранее (например, в «У меня уже есть рукопись») — разбор стартует сразу. */
  initialFile?: File | null;
}

function formatWords(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}К`;
  return String(n);
}

export default function ImportModal({ onClose, onSuccess, initialFile }: ImportModalProps) {
  const [step, setStep] = useState<Step>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [createError, setCreateError] = useState('');
  const [processingWarning, setProcessingWarning] = useState('');

  const [parsed, setParsed] = useState<ParseResult | null>(null);

  // Editable fields (preview step)
  const [title, setTitle] = useState('');
  const [genres, setGenres] = useState<string[]>([]);
  const [suggestedGenres, setSuggestedGenres] = useState<string[]>([]);
  const [genreLoading, setGenreLoading] = useState(false);
  const [color, setColor] = useState('#3A4F41');
  const [suggestedColor, setSuggestedColor] = useState<string | null>(null); // цвет, подобранный Пером
  const colorTouched = useRef(false); // автор сам выбрал цвет — не перетираем
  const [showAllChapters, setShowAllChapters] = useState(false);

  const pickColor = (c: string) => { colorTouched.current = true; setColor(c); };

  /** Перо определяет жанр И тональность→цвет обложки по первой главе (один дешёвый AI-вызов). */
  const classifyGenre = async (sample: string, token: string) => {
    if (!sample.trim()) return;
    setGenreLoading(true);
    try {
      const res = await fetch(`${API}/import/classify-genre`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sample: sample.slice(0, 4000) }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const g: string[] = Array.isArray(data.genres) ? data.genres : [];
      if (g.length) {
        setSuggestedGenres(g);
        setGenres(prev => [...new Set([...prev, ...g])]);
      }
      // Цвет обложки по тону — только если автор ещё не выбрал вручную
      if (typeof data.color === 'string' && PRESET_COLORS.includes(data.color)) {
        setSuggestedColor(data.color);
        if (!colorTouched.current) setColor(data.color);
      }
    } catch { /* жанр/цвет необязательны */ } finally {
      setGenreLoading(false);
    }
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
      setTitle('');
      setSuggestedGenres([]);
      setGenres([]);
      setSuggestedColor(null);
      colorTouched.current = false;
      setStep('preview');
      void classifyGenre(data.chapters?.[0]?.content ?? '', token);
    } catch {
      setParseError('Не удалось подключиться к серверу');
      setStep('upload');
    }
  }, []);

  // Файл, выбранный заранее на дашборде («У меня уже есть рукопись»), — сразу в разбор,
  // минуя дропзону. Ref-страховка от повторного запроса (StrictMode дважды вызывает эффекты).
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (initialFile && !autoStartedRef.current) {
      autoStartedRef.current = true;
      handleFile(initialFile);
    }
  }, [initialFile, handleFile]);

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
          genre: genres.length > 0 ? genres.join(', ') : null,
          color,
          chapters: parsed.chapters.map(c => ({ title: c.title, content: c.content })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        // Лимит Free-тарифа → мягкий пейволл вместо инлайн-ошибки
        if (res.status === 402 && typeof data?.code === 'string' && data.code.startsWith('PLAN_LIMIT')) {
          paywall.show(data);
          setStep('preview');
          return;
        }
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
        position: 'fixed', inset: 0, background: 'rgba(30,45,31,0.55)',
        backdropFilter: 'blur(4px)', zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px', animation: 'fadeIn 0.15s ease',
      }}
      onClick={step === 'parsing' || step === 'creating' ? undefined : onClose}
    >
      <div
        style={{
          background: '#F5F0E8', borderRadius: '24px', width: '100%',
          maxWidth: step === 'preview' ? '560px' : '480px',
          maxHeight: '90vh',
          boxShadow: '0 24px 60px rgba(30,45,31,0.55)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          animation: 'slideUp 0.2s cubic-bezier(0.34,1.56,0.64,1)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{ background: '#fff', padding: '20px 24px', borderBottom: '1px solid rgba(30,45,31,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '22px', fontWeight: 700, margin: 0 }}>
              {step === 'upload'   && 'Импорт рукописи'}
              {step === 'parsing'  && 'Анализ файла'}
              {step === 'preview'  && 'Подтвердите импорт'}
              {step === 'creating' && 'Создаём проект'}
            </h2>
            {step === 'upload' && (
              <p style={{ fontSize: '12px', color: 'rgba(30,45,31,0.6)', margin: '2px 0 0' }}>
                TXT · DOCX · PDF · EPUB · FB2 · до 20 МБ
              </p>
            )}
            {step === 'preview' && parsed && (
              <p style={{ fontSize: '12px', color: 'rgba(30,45,31,0.6)', margin: '2px 0 0' }}>
                {parsed.chapters.length} {parsed.chapters.length === 1 ? 'глава' : parsed.chapters.length < 5 ? 'главы' : 'глав'} · {formatWords(parsed.totalWords)} слов
              </p>
            )}
          </div>
          {step !== 'parsing' && step !== 'creating' && (
            <button onClick={onClose} style={{ background: 'rgba(30,45,31,0.05)', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(30,45,31,0.5)' }}>
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
                  border: `2px dashed ${isDragging ? '#3A4F41' : 'rgba(30,45,31,0.14)'}`,
                  borderRadius: '18px',
                  padding: '40px 24px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: isDragging ? 'rgba(58,79,65,0.04)' : '#fff',
                  transition: 'all 0.2s',
                }}
              >
                <input ref={fileInputRef} type="file" accept={ACCEPTED_EXTS.join(',')} style={{ display: 'none' }} onChange={onFileInput} />
                <Upload size={36} style={{ color: isDragging ? '#3A4F41' : 'rgba(30,45,31,0.2)', marginBottom: '12px', transition: 'color 0.2s' }} />
                <p style={{ fontSize: '15px', fontWeight: 600, color: 'rgba(30,45,31,0.65)', margin: '0 0 6px' }}>
                  Перетащите файл сюда
                </p>
                <p style={{ fontSize: '13px', color: 'rgba(30,45,31,0.6)', margin: 0 }}>
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
              <div style={{ width: '48px', height: '48px', border: '4px solid rgba(30,45,31,0.08)', borderTopColor: '#3A4F41', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 20px' }} />
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'rgba(30,45,31,0.7)', marginBottom: '6px' }}>
                Анализируем рукопись…
              </p>
              <p style={{ fontSize: '13px', color: 'rgba(30,45,31,0.6)', margin: 0 }}>
                {fileName}
              </p>
              <p style={{ fontSize: '12px', color: 'rgba(30,45,31,0.55)', margin: '10px 0 0' }}>
                Определяем структуру глав
              </p>
            </div>
          )}

          {/* STEP: preview */}
          {step === 'preview' && parsed && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {/* Title */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(30,45,31,0.6)', marginBottom: '6px' }}>
                  Название
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1.5px solid rgba(30,45,31,0.1)', background: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', transition: 'border-color 0.15s' }}
                  onFocus={e => (e.target.style.borderColor = '#3A4F41')}
                  onBlur={e => (e.target.style.borderColor = 'rgba(30,45,31,0.1)')}
                />
              </div>

              {/* Genre */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(30,45,31,0.6)', marginBottom: '6px' }}>
                  Жанр <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(можно выбрать несколько)</span>
                </label>
                <GenrePicker value={genres} onChange={setGenres} suggested={suggestedGenres} loading={genreLoading} />
              </div>

              {/* Color */}
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(30,45,31,0.6)', marginBottom: '8px' }}>
                  Цвет обложки
                  {suggestedColor && color === suggestedColor && !colorTouched.current && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '9.5px', fontWeight: 600, letterSpacing: 0, textTransform: 'none', color: '#A14F44', background: 'rgba(161,79,68,0.1)', borderRadius: '5px', padding: '1px 6px' }}>✦ подобрал Перо</span>
                  )}
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => pickColor(c)}
                      title={c === suggestedColor ? 'Перо подобрало этот цвет по тону рукописи' : undefined}
                      style={{
                        width: '26px', height: '26px', borderRadius: '8px', background: c,
                        border: `2.5px solid ${color === c ? '#1E2D1F' : c === suggestedColor ? 'rgba(161,79,68,0.5)' : 'transparent'}`,
                        cursor: 'pointer', transition: 'transform 0.15s',
                        transform: color === c ? 'scale(1.15)' : 'scale(1)',
                      }}
                    />
                  ))}
                  <input type="color" value={color} onChange={e => pickColor(e.target.value)}
                    style={{ width: '26px', height: '26px', borderRadius: '8px', border: '1.5px solid rgba(30,45,31,0.1)', cursor: 'pointer', padding: '2px' }}
                  />
                </div>
              </div>

              {/* Preview mini-book */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', background: 'rgba(30,45,31,0.03)', borderRadius: '12px' }}>
                <div style={{
                  width: '28px', height: '44px', background: color, borderRadius: '2px 4px 4px 2px',
                  boxShadow: '-1px 0 0 rgba(30,45,31,0.2), 1px 1px 4px rgba(30,45,31,0.2)',
                  flexShrink: 0,
                }} />
                <div>
                  <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, fontFamily: '"Cormorant Garamond", serif', color: '#1E2D1F' }}>
                    {title || 'Название книги'}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'rgba(30,45,31,0.6)' }}>
                    {genres.length > 0 ? genres.join(', ') : 'Жанр'} · {formatWords(parsed.totalWords)} слов
                  </p>
                </div>
              </div>

              {/* Chapter list */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(30,45,31,0.6)', marginBottom: '8px' }}>
                  Главы ({parsed.chapters.length})
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {visibleChapters.map((chapter, i) => (
                    <div key={i} style={{ background: '#fff', borderRadius: '12px', padding: '10px 14px', border: '1px solid rgba(30,45,31,0.06)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', marginBottom: chapter.preview ? '4px' : 0 }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#1E2D1F', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {chapter.title}
                        </span>
                        <span style={{ fontSize: '11px', color: 'rgba(30,45,31,0.58)', flexShrink: 0 }}>
                          {formatWords(chapter.wordCount)} сл.
                        </span>
                      </div>
                      {chapter.preview && (
                        <p style={{ fontSize: '12px', color: 'rgba(30,45,31,0.45)', margin: 0, lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } as React.CSSProperties}>
                          {chapter.preview}
                        </p>
                      )}
                    </div>
                  ))}

                  {parsed.chapters.length > 5 && (
                    <button
                      onClick={() => setShowAllChapters(!showAllChapters)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px', background: 'transparent', border: '1.5px dashed rgba(30,45,31,0.12)', borderRadius: '12px', cursor: 'pointer', fontSize: '12px', color: 'rgba(30,45,31,0.45)', transition: 'all 0.15s' }}
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
                <div style={{ width: '48px', height: '48px', border: '4px solid rgba(30,45,31,0.08)', borderTopColor: '#3A4F41', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 20px' }} />
              )}
              {processingWarning ? (
                <CheckCircle size={40} style={{ color: '#3A4F41', margin: '0 auto 16px', display: 'block' }} />
              ) : null}
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'rgba(30,45,31,0.7)', marginBottom: '6px' }}>
                {processingWarning ? 'Проект создан' : 'Создаём проект…'}
              </p>
              <p style={{ fontSize: '13px', color: 'rgba(30,45,31,0.6)', margin: '0 0 12px' }}>
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
          <div style={{ background: '#fff', padding: '14px 24px', borderTop: '1px solid rgba(30,45,31,0.06)', display: 'flex', gap: '10px', justifyContent: 'flex-end', flexShrink: 0 }}>
            <button onClick={onClose} style={{ padding: '10px 18px', borderRadius: '12px', border: 'none', background: 'transparent', fontSize: '14px', cursor: 'pointer', color: 'rgba(30,45,31,0.5)', fontWeight: 500 }}>
              Отмена
            </button>
            <button
              onClick={handleCreate}
              disabled={!title.trim()}
              style={{
                padding: '10px 22px', borderRadius: '12px', border: 'none',
                background: title.trim() ? '#3A4F41' : 'rgba(30,45,31,0.08)',
                color: title.trim() ? '#fff' : 'rgba(30,45,31,0.55)',
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
