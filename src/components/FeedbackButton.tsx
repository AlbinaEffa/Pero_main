/**
 * FeedbackButton — floating "Отзыв" button, always visible in the bottom-right corner.
 * Opens a compact modal for submitting beta feedback.
 *
 * Usage: drop <FeedbackButton /> anywhere in a page (Dashboard, Editor, etc.)
 * It manages its own open/close state; the button is always rendered.
 */

import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '../services/api';
import { track } from '../services/analytics';
import { useLocation } from 'react-router-dom';

type FeedbackType = 'bug' | 'idea' | 'praise';

const TYPES: { id: FeedbackType; label: string; emoji: string }[] = [
  { id: 'bug',   label: 'Что-то сломалось', emoji: '🐛' },
  { id: 'idea',  label: 'Идея',             emoji: '💡' },
  { id: 'praise', label: 'Всё нравится!',   emoji: '❤️' },
];

// Prevent spam: one submission per 5 minutes (localStorage timestamp)
const COOLDOWN_MS = 5 * 60 * 1000;
const COOLDOWN_KEY = 'pero_feedback_last';

function isCooledDown(): boolean {
  const last = localStorage.getItem(COOLDOWN_KEY);
  if (!last) return true;
  return Date.now() - parseInt(last) > COOLDOWN_MS;
}

export function FeedbackButton() {
  const [isOpen, setIsOpen]       = useState(false);
  const [type, setType]           = useState<FeedbackType>('idea');
  const [message, setMessage]     = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent]           = useState(false);
  const [error, setError]         = useState('');
  const textareaRef               = useRef<HTMLTextAreaElement>(null);
  const location = useLocation();

  // Focus textarea when panel opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 80);
    }
  }, [isOpen]);

  const handleOpen = () => {
    setIsOpen(true);
    setSent(false);
    setError('');
    setMessage('');
    track('feedback_panel_opened', { page: location.pathname });
  };

  const handleClose = () => {
    setIsOpen(false);
    setSent(false);
    setError('');
    setMessage('');
  };

  const handleSubmit = async () => {
    if (!message.trim() || isSending) return;
    if (!isCooledDown()) {
      setError('Подождите несколько минут перед следующим отзывом');
      return;
    }

    setIsSending(true);
    setError('');

    try {
      await api.post('/feedback', {
        type,
        message: message.trim(),
        page: location.pathname,
        metadata: {
          userAgent: navigator.userAgent,
          screen: `${window.innerWidth}×${window.innerHeight}`,
        },
      });
      localStorage.setItem(COOLDOWN_KEY, String(Date.now()));
      setSent(true);
      track('feedback_submitted', { type, messageLength: message.length });
      // Auto-close after 2s
      setTimeout(handleClose, 2000);
    } catch (e: any) {
      setError('Не удалось отправить. Попробуйте позже.');
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit();
    }
  };

  return (
    <>
      {/* ── Floating trigger button ─────────────────────────────────── */}
      {!isOpen && (
        <button
          onClick={handleOpen}
          title="Оставить отзыв"
          style={{
            position: 'fixed', bottom: '28px', right: '24px',
            background: '#3A4F41', color: '#fff',
            border: 'none', borderRadius: '50px',
            padding: '10px 16px',
            display: 'flex', alignItems: 'center', gap: '7px',
            fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(58,79,65,0.35)',
            zIndex: 7000,
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(58,79,65,0.45)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(58,79,65,0.35)';
          }}
        >
          <MessageCircle size={15} />
          Отзыв
        </button>
      )}

      {/* ── Feedback panel ──────────────────────────────────────────── */}
      {isOpen && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px',
          background: '#FDFBF7', borderRadius: '20px',
          width: '320px',
          boxShadow: '0 16px 48px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06)',
          zIndex: 7000,
          animation: 'slideUp 0.2s ease',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 18px 12px',
            borderBottom: '1px solid rgba(0,0,0,0.06)',
          }}>
            <span style={{
              fontFamily: '"Cormorant Garamond", serif',
              fontSize: '17px', fontWeight: 700, fontStyle: 'italic',
              color: '#1a1a1a',
            }}>
              Ваш отзыв
            </span>
            <button
              onClick={handleClose}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'rgba(0,0,0,0.35)', padding: '2px',
                display: 'flex', borderRadius: '6px',
              }}
            >
              <X size={16} />
            </button>
          </div>

          <div style={{ padding: '16px 18px 18px' }}>
            {sent ? (
              /* Success state */
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: '10px', padding: '16px 0',
              }}>
                <CheckCircle2 size={36} color="#3A4F41" />
                <p style={{
                  fontSize: '14px', fontWeight: 600, color: '#1a1a1a', margin: 0,
                }}>
                  Спасибо!
                </p>
                <p style={{ fontSize: '12px', color: 'rgba(0,0,0,0.45)', margin: 0, textAlign: 'center' }}>
                  Ваш отзыв получен. Мы читаем каждое сообщение.
                </p>
              </div>
            ) : (
              <>
                {/* Type selector */}
                <div style={{
                  display: 'flex', gap: '6px', marginBottom: '14px',
                }}>
                  {TYPES.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setType(t.id)}
                      style={{
                        flex: 1, padding: '7px 4px',
                        borderRadius: '10px',
                        border: `1.5px solid ${type === t.id ? '#3A4F41' : 'rgba(0,0,0,0.1)'}`,
                        background: type === t.id ? '#f0f4f1' : 'transparent',
                        cursor: 'pointer', fontSize: '11px',
                        color: type === t.id ? '#2a3d2e' : 'rgba(0,0,0,0.55)',
                        fontWeight: 500, transition: 'all 0.15s',
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', gap: '3px',
                      }}
                    >
                      <span style={{ fontSize: '16px' }}>{t.emoji}</span>
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>

                {/* Message */}
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Расскажите подробнее..."
                  rows={4}
                  maxLength={2000}
                  style={{
                    width: '100%', resize: 'none',
                    border: '1.5px solid rgba(0,0,0,0.1)',
                    borderRadius: '12px', padding: '10px 12px',
                    fontSize: '13px', lineHeight: 1.6,
                    color: '#1a1a1a', background: 'rgba(0,0,0,0.02)',
                    outline: 'none', boxSizing: 'border-box',
                    fontFamily: 'inherit',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'rgba(58,79,65,0.4)'; }}
                  onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(0,0,0,0.1)'; }}
                />

                {/* Char count + hint */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  marginTop: '6px', marginBottom: '14px',
                }}>
                  <span style={{ fontSize: '11px', color: 'rgba(0,0,0,0.3)' }}>
                    ⌘↵ отправить
                  </span>
                  <span style={{ fontSize: '11px', color: 'rgba(0,0,0,0.3)' }}>
                    {message.length}/2000
                  </span>
                </div>

                {error && (
                  <p style={{ fontSize: '12px', color: '#dc2626', margin: '0 0 10px' }}>
                    {error}
                  </p>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={!message.trim() || isSending}
                  style={{
                    width: '100%', padding: '11px',
                    background: message.trim() ? '#3A4F41' : 'rgba(0,0,0,0.1)',
                    color: message.trim() ? '#fff' : 'rgba(0,0,0,0.35)',
                    border: 'none', borderRadius: '12px',
                    fontSize: '13px', fontWeight: 600,
                    cursor: message.trim() ? 'pointer' : 'not-allowed',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    transition: 'all 0.15s',
                  }}
                >
                  {isSending
                    ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Отправляем...</>
                    : <><Send size={14} /> Отправить</>
                  }
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
