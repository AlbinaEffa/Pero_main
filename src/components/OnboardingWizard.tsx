/**
 * OnboardingWizard — shown to new users (0 projects) on first Dashboard visit.
 * Dismissal is persisted in localStorage so it only appears once.
 *
 * Steps:
 *   1. "Добро пожаловать" — writer type selection
 *   2. "С чего начнём?" — upload / demo / blank choice
 *   3. "Перо изучает ваш текст" — shown after demo/import completes
 */

import React, { useState, useEffect } from 'react';
import { Upload, BookOpen, Pen, ArrowRight, Loader2, CheckCircle2, X, PenLine, FolderOpen, Compass, Sparkles, Search, Brain } from 'lucide-react';
import { PeroMark } from './Logo';
import { api } from '../services/api';
import { track } from '../services/analytics';

export const ONBOARDING_KEY = 'pero_onboarding_done';

type Step = 'welcome' | 'start' | 'loading' | 'ready';

type WriterType = 'novel' | 'short' | 'nonfiction' | 'exploring';

const WRITER_TYPES: { id: WriterType; label: string; icon: typeof BookOpen }[] = [
  { id: 'novel',       label: 'Роман или повесть',      icon: BookOpen },
  { id: 'short',       label: 'Рассказы и короткая проза', icon: PenLine },
  { id: 'nonfiction',  label: 'Нон-фикшн, мемуары',     icon: FolderOpen },
  { id: 'exploring',   label: 'Просто пробую',           icon: Compass },
];

interface Props {
  onComplete: (projectId: string, firstChapterId: string) => void;
  onSkip: () => void;
  onImport: () => void; // opens the ImportModal externally
}

export function OnboardingWizard({ onComplete, onSkip, onImport }: Props) {
  const [step, setStep]           = useState<Step>('welcome');
  const [writerType, setWriterType] = useState<WriterType>('novel');
  const [isLoadingDemo, setIsLoadingDemo] = useState(false);
  const [demoError, setDemoError] = useState('');
  const [readyProject, setReadyProject] = useState<{
    projectId: string; firstChapterId: string;
  } | null>(null);
  // Which loading items are visibly checked (animated reveal)
  const [checkedItems, setCheckedItems] = useState<number[]>([]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleWelcomeContinue = () => {
    track('onboarding_step_1_complete', { writerType });
    setStep('start');
  };

  // Animate loading items as they "complete"
  useEffect(() => {
    if (step !== 'loading') return;
    setCheckedItems([]);
    const timers = [800, 1800, 3000].map((delay, i) =>
      setTimeout(() => setCheckedItems(prev => [...prev, i]), delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [step]);

  const handleLoadDemo = async () => {
    setIsLoadingDemo(true);
    setDemoError('');
    setStep('loading');
    track('demo_manuscript_loading');
    try {
      const data = await api.post<{
        project: { id: string };
        firstChapterId: string;
      }>('/demo/create', {});
      setReadyProject({ projectId: data.project.id, firstChapterId: data.firstChapterId });
      // Wait at least 3.2s so all animated items have appeared
      await new Promise(res => setTimeout(res, 3200));
      setStep('ready');
      track('demo_manuscript_loaded', { projectId: data.project.id });
    } catch (e: any) {
      setDemoError('Не удалось загрузить демо. Попробуйте ещё раз.');
      setStep('start');
      console.error('[demo]', e);
    } finally {
      setIsLoadingDemo(false);
    }
  };

  const handleImport = () => {
    track('onboarding_chose_import');
    // Close wizard and open ImportModal — parent handles this
    localStorage.setItem(ONBOARDING_KEY, 'true');
    onImport();
  };

  const handleBlank = () => {
    track('onboarding_chose_blank');
    localStorage.setItem(ONBOARDING_KEY, 'true');
    onSkip();
  };

  const handleGoWrite = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    track('onboarding_completed', { writerType });
    if (readyProject) {
      onComplete(readyProject.projectId, readyProject.firstChapterId);
    }
  };

  const handleDismiss = () => {
    track('onboarding_skipped', { step });
    localStorage.setItem(ONBOARDING_KEY, 'true');
    onSkip();
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(20,20,20,0.55)',
      backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 8000, padding: '24px',
      animation: 'fadeIn 0.25s ease',
    }}>
      <div style={{
        background: '#F5F0E8',
        borderRadius: '28px',
        maxWidth: '500px', width: '100%',
        padding: '40px',
        boxShadow: '0 24px 80px rgba(30,45,31,0.25)',
        position: 'relative',
        animation: 'slideUp 0.3s ease',
      }}>
        {/* Dismiss button */}
        <button
          onClick={handleDismiss}
          style={{
            position: 'absolute', top: '16px', right: '16px',
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(30,45,31,0.55)', padding: '4px',
            borderRadius: '50%', display: 'flex',
          }}
        >
          <X size={18} />
        </button>

        {/* ── Step 1: Welcome ─────────────────────────────────────────── */}
        {step === 'welcome' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <div style={{ marginBottom: '12px', color: '#4A5D4E', display: 'flex', justifyContent: 'center' }}><PeroMark size={40} /></div>
              <h2 style={{
                fontFamily: '"Cormorant Garamond", serif',
                fontSize: '28px', fontWeight: 700, fontStyle: 'italic',
                color: '#1E2D1F', margin: '0 0 8px',
              }}>
                Добро пожаловать в Перо
              </h2>
              <p style={{ fontSize: '14px', color: 'rgba(30,45,31,0.5)', margin: 0, lineHeight: 1.6 }}>
                Студия для тех, кто пишет серьёзно. Расскажите немного о себе.
              </p>
            </div>

            <p style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(30,45,31,0.6)', marginBottom: '12px' }}>
              Что вы пишете?
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '28px' }}>
              {WRITER_TYPES.map(wt => (
                <button
                  key={wt.id}
                  onClick={() => setWriterType(wt.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '12px 16px', borderRadius: '14px',
                    border: `2px solid ${writerType === wt.id ? '#3A4F41' : 'rgba(30,45,31,0.08)'}`,
                    background: writerType === wt.id ? '#f0f4f1' : 'transparent',
                    cursor: 'pointer', textAlign: 'left',
                    transition: 'all 0.15s',
                  }}
                >
                  <wt.icon size={20} style={{ color: '#4A5D4E', flexShrink: 0 }} />
                  <span style={{
                    fontSize: '14px', fontWeight: 500,
                    color: writerType === wt.id ? '#2a3d2e' : 'rgba(30,45,31,0.7)',
                  }}>
                    {wt.label}
                  </span>
                </button>
              ))}
            </div>

            <button
              onClick={handleWelcomeContinue}
              style={{
                width: '100%', padding: '13px',
                background: '#3A4F41', color: '#fff',
                border: 'none', borderRadius: '14px',
                fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                transition: 'all 0.2s',
              }}
            >
              Продолжить <ArrowRight size={16} />
            </button>
          </>
        )}

        {/* ── Step 2: Start ────────────────────────────────────────────── */}
        {step === 'start' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: '28px' }}>
              <h2 style={{
                fontFamily: '"Cormorant Garamond", serif',
                fontSize: '26px', fontWeight: 700, fontStyle: 'italic',
                color: '#1E2D1F', margin: '0 0 8px',
              }}>
                С чего начнём?
              </h2>
              <p style={{ fontSize: '13px', color: 'rgba(30,45,31,0.45)', margin: 0 }}>
                Выберите, как хотите попробовать Перо
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
              {/* Option 1: Upload manuscript */}
              <button
                onClick={handleImport}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '14px',
                  padding: '16px 18px', borderRadius: '16px',
                  border: '2px solid rgba(30,45,31,0.08)',
                  background: 'transparent', cursor: 'pointer', textAlign: 'left',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.border = '2px solid rgba(58,79,65,0.3)';
                  e.currentTarget.style.background = '#f8fbf9';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.border = '2px solid rgba(30,45,31,0.08)';
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <div style={{
                  width: '40px', height: '40px', flexShrink: 0,
                  background: 'rgba(58,79,65,0.1)', borderRadius: '12px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Upload size={18} color="#3A4F41" />
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#1E2D1F', marginBottom: '2px' }}>
                    Загрузить мою рукопись
                  </div>
                  <div style={{ fontSize: '12px', color: 'rgba(30,45,31,0.45)', lineHeight: 1.5 }}>
                    TXT, DOCX, PDF, EPUB, FB2 — Перо разобьёт на главы автоматически
                  </div>
                </div>
              </button>

              {/* Option 2: Demo */}
              <button
                onClick={handleLoadDemo}
                disabled={isLoadingDemo}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '14px',
                  padding: '16px 18px', borderRadius: '16px',
                  border: '2px solid rgba(30,45,31,0.08)',
                  background: 'transparent', cursor: isLoadingDemo ? 'not-allowed' : 'pointer',
                  textAlign: 'left', transition: 'all 0.15s',
                  opacity: isLoadingDemo ? 0.7 : 1,
                }}
                onMouseEnter={e => {
                  if (!isLoadingDemo) {
                    e.currentTarget.style.border = '2px solid rgba(58,79,65,0.3)';
                    e.currentTarget.style.background = '#f8fbf9';
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.border = '2px solid rgba(30,45,31,0.08)';
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <div style={{
                  width: '40px', height: '40px', flexShrink: 0,
                  background: 'rgba(58,79,65,0.1)', borderRadius: '12px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isLoadingDemo
                    ? <Loader2 size={18} color="#3A4F41" style={{ animation: 'spin 1s linear infinite' }} />
                    : <BookOpen size={18} color="#3A4F41" />
                  }
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#1E2D1F', marginBottom: '2px' }}>
                    Попробовать на демо-тексте
                  </div>
                  <div style={{ fontSize: '12px', color: 'rgba(30,45,31,0.45)', lineHeight: 1.5 }}>
                    Загрузим готовую историю — сразу увидите, как работает Мир и соавтор
                  </div>
                </div>
              </button>

              {/* Option 3: Blank */}
              <button
                onClick={handleBlank}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '14px',
                  padding: '16px 18px', borderRadius: '16px',
                  border: '2px solid rgba(30,45,31,0.08)',
                  background: 'transparent', cursor: 'pointer', textAlign: 'left',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.border = '2px solid rgba(30,45,31,0.15)';
                  e.currentTarget.style.background = 'rgba(30,45,31,0.02)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.border = '2px solid rgba(30,45,31,0.08)';
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <div style={{
                  width: '40px', height: '40px', flexShrink: 0,
                  background: 'rgba(30,45,31,0.05)', borderRadius: '12px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Pen size={18} color="rgba(30,45,31,0.5)" />
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#1E2D1F', marginBottom: '2px' }}>
                    Начну с нуля
                  </div>
                  <div style={{ fontSize: '12px', color: 'rgba(30,45,31,0.45)', lineHeight: 1.5 }}>
                    Создать пустой проект и начать писать прямо сейчас
                  </div>
                </div>
              </button>
            </div>

            {demoError && (
              <p style={{ fontSize: '12px', color: '#dc2626', textAlign: 'center', margin: '0 0 12px' }}>
                {demoError}
              </p>
            )}
          </>
        )}

        {/* ── Step: Loading (demo being created) ──────────────────────── */}
        {step === 'loading' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: '28px' }}>
              <div style={{ marginBottom: '12px', color: '#4A5D4E', display: 'flex', justifyContent: 'center' }}><Sparkles size={34} /></div>
              <h2 style={{
                fontFamily: '"Cormorant Garamond", serif',
                fontSize: '26px', fontWeight: 700, fontStyle: 'italic',
                color: '#1E2D1F', margin: '0 0 8px',
              }}>
                Перо изучает историю
              </h2>
              <p style={{ fontSize: '13px', color: 'rgba(30,45,31,0.5)', margin: 0, lineHeight: 1.6 }}>
                Загружаем демо-рукопись и запускаем фоновые процессы…
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}>
              {[
                { icon: Search, label: 'Загружаем главы рукописи' },
                { icon: BookOpen, label: 'Извлекаем персонажей, места и предметы' },
                { icon: Brain, label: 'Формируем семантическую память соавтора' },
              ].map((item, i) => {
                const done = checkedItems.includes(i);
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '12px 16px', borderRadius: '14px',
                    background: done ? 'rgba(58,79,65,0.08)' : 'rgba(30,45,31,0.03)',
                    transition: 'background 0.4s ease',
                  }}>
                    <item.icon size={18} style={{ color: '#4A5D4E', flexShrink: 0 }} />
                    <span style={{
                      fontSize: '13px', flex: 1,
                      color: done ? 'rgba(30,45,31,0.75)' : 'rgba(30,45,31,0.6)',
                      transition: 'color 0.3s',
                    }}>
                      {item.label}
                    </span>
                    {done
                      ? <CheckCircle2 size={16} color="#3A4F41" />
                      : (
                        <Loader2
                          size={16}
                          color="rgba(30,45,31,0.25)"
                          style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}
                        />
                      )
                    }
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── Step 3: Ready ────────────────────────────────────────────── */}
        {step === 'ready' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: '28px' }}>
              <div style={{ marginBottom: '12px', color: '#4A5D4E', display: 'flex', justifyContent: 'center' }}><Sparkles size={34} /></div>
              <h2 style={{
                fontFamily: '"Cormorant Garamond", serif',
                fontSize: '26px', fontWeight: 700, fontStyle: 'italic',
                color: '#1E2D1F', margin: '0 0 8px',
              }}>
                Перо изучает вашу историю
              </h2>
              <p style={{ fontSize: '13px', color: 'rgba(30,45,31,0.5)', margin: 0, lineHeight: 1.6 }}>
                В фоне запущены три процесса. Они займут меньше минуты.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '28px' }}>
              {[
                { icon: Search, label: 'Извлекаем персонажей, места и предметы' },
                { icon: BookOpen, label: 'Строим Мир' },
                { icon: Brain, label: 'Формируем семантическую память соавтора' },
              ].map((item, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '12px 16px', borderRadius: '14px',
                  background: 'rgba(58,79,65,0.06)',
                }}>
                  <item.icon size={18} style={{ color: '#4A5D4E', flexShrink: 0 }} />
                  <span style={{ fontSize: '13px', color: 'rgba(30,45,31,0.7)', flex: 1 }}>
                    {item.label}
                  </span>
                  <CheckCircle2 size={16} color="#3A4F41" style={{ opacity: 0.6 }} />
                </div>
              ))}
            </div>

            <p style={{
              fontSize: '12px', color: 'rgba(30,45,31,0.6)',
              textAlign: 'center', margin: '0 0 20px', lineHeight: 1.6,
            }}>
              Перо уже готово отвечать на вопросы — даже пока идёт обработка.
            </p>

            <button
              onClick={handleGoWrite}
              style={{
                width: '100%', padding: '13px',
                background: '#3A4F41', color: '#fff',
                border: 'none', borderRadius: '14px',
                fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                transition: 'all 0.2s',
              }}
            >
              Начать писать <ArrowRight size={16} />
            </button>
          </>
        )}

        {/* Step progress dots */}
        {step !== 'ready' && (
          <div style={{
            display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '20px',
          }}>
            {(['welcome', 'start', 'loading'] as Step[]).map(s => (
              <div key={s} style={{
                width: s === step ? '16px' : '6px',
                height: '6px', borderRadius: '99px',
                background: s === step ? '#3A4F41' : 'rgba(30,45,31,0.15)',
                transition: 'all 0.25s',
              }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
