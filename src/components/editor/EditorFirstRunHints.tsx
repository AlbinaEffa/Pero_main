/**
 * EditorFirstRunHints — a floating card shown only on the first editor session.
 *
 * Cycles through tips about key features. Hints that describe a specific toolbar
 * button (Диктовка, Перо) anchor their tail to that button — the card is measured
 * against the live button position (`[data-hint="…"]`) and clamped to the viewport,
 * while the tail offsets to keep pointing at the button. Hints without a button
 * (text selection, slash-commands) are shown centred above the toolbar WITHOUT a
 * tail — the copy itself explains them, so there is nothing to point at.
 *
 * Dismissed on "Понятно" / close; persisted in localStorage so it shows once.
 */

import { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Mic, Feather, Eye, AlertTriangle } from 'lucide-react';

export const HINTS_DONE_KEY = 'pero_editor_hints_done';

/** `target` — `data-hint` of the toolbar button this tip points at (if any). */
type Hint = {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  body: string;
  target?: 'dictation' | 'coauthor';
};

const HINTS: Hint[] = [
  {
    icon: Mic,
    title: 'Просто пишите',
    body: 'Пишите или диктуйте главу. Перо не сочиняет за вас — оно читает написанное и помогает помнить вашу историю.',
    target: 'dictation',
  },
  {
    icon: Eye,
    title: 'Перо читает за вас',
    body: 'Нажмите «Прочитать» — Перо вытащит персонажей, локации, предметы и связи в «Мир». Вы подтверждаете находки одним кликом.',
  },
  {
    icon: Feather,
    title: 'Перо — спутник рядом',
    body: 'Кнопка «Перо» снизу открывает спутника справа: кто в этой сцене и их факты, находки, и чат — спросите про историю, не уходя из текста.',
    target: 'coauthor',
  },
  {
    icon: AlertTriangle,
    title: 'Нестыковки — прямо в тексте',
    body: 'Если факт противоречит написанному раньше (глаза были зелёные, стали серые) — имя подчёркивается волной. Клик — посмотреть расхождение.',
  },
];

interface Props {
  /** Optional: only show if the editor chapter is new/empty */
  isNewChapter?: boolean;
}

interface Layout {
  left: number;
  bottom: number;
  width: number;
  /** Tail x within the card; null → no tail (centred info card). */
  tailLeft: number | null;
}

const CARD_MAX = 360;
const VIEWPORT_MARGIN = 16;

export function EditorFirstRunHints({ isNewChapter }: Props) {
  void isNewChapter;
  const [visible, setVisible] = useState(false);
  const [idx, setIdx]         = useState(0);
  const [closing, setClosing] = useState(false);
  const [layout, setLayout]   = useState<Layout>({ left: 0, bottom: 96, width: CARD_MAX, tailLeft: null });

  useEffect(() => {
    // Show only once, slight delay so the editor + toolbar finish loading
    if (localStorage.getItem(HINTS_DONE_KEY)) return;
    const timer = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  // Position the card relative to the live target button (or centre it if none).
  const recompute = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(CARD_MAX, vw - 2 * VIEWPORT_MARGIN);

    const centredNoTail = (): Layout => ({
      left: Math.round((vw - width) / 2),
      bottom: 96,
      width,
      tailLeft: null,
    });

    const target = HINTS[idx].target;
    if (!target) return setLayout(centredNoTail());

    const el = document.querySelector<HTMLElement>(`[data-hint="${target}"]`);
    if (!el) return setLayout(centredNoTail()); // button not rendered (e.g. dictation unsupported)

    const r = el.getBoundingClientRect();
    const targetX = r.left + r.width / 2;

    // Centre the card on the button, then clamp so it stays on-screen…
    let left = Math.round(targetX - width / 2);
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - width - VIEWPORT_MARGIN));

    // …and offset the tail back onto the button (kept inside the card's rounded corners).
    let tailLeft = Math.round(targetX - left);
    tailLeft = Math.max(18, Math.min(tailLeft, width - 18));

    // Card sits just above the button.
    const bottom = Math.round(vh - r.top + 10);

    setLayout({ left, bottom, width, tailLeft });
  }, [idx]);

  useLayoutEffect(() => {
    if (!visible) return;
    recompute();
    window.addEventListener('resize', recompute);
    // The toolbar slides when side panels open/close; recompute on any scroll/layout shift.
    window.addEventListener('scroll', recompute, true);
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [visible, recompute]);

  if (!visible) return null;

  const hint    = HINTS[idx];
  const isFirst = idx === 0;
  const isLast  = idx === HINTS.length - 1;

  const dismiss = () => {
    setClosing(true);
    setTimeout(() => {
      localStorage.setItem(HINTS_DONE_KEY, 'true');
      setVisible(false);
    }, 220);
  };

  const next = () => {
    if (isLast) { dismiss(); return; }
    setIdx(i => i + 1);
  };

  const prev = () => {
    if (!isFirst) setIdx(i => i - 1);
  };

  return (
    <div
      className={`pointer-events-auto transition-[opacity,transform] duration-200 ${closing ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'}`}
      style={{
        position: 'fixed',
        bottom: `${layout.bottom}px`,
        left: `${layout.left}px`,
        width: `${layout.width}px`,
        zIndex: 9000,
      }}
    >
      {/* font-sans принудительно: карточка живёт внутри обёртки шрифта рукописи,
          но это UI-хром — ему положен Golos (DESIGN.md) */}
      <div className="bg-[#1e2d1f] text-white rounded-2xl shadow-2xl overflow-hidden font-sans">
        {/* Progress bar */}
        <div className="h-0.5 bg-white/10">
          <div
            className="h-full bg-white/50 transition-all duration-300"
            style={{ width: `${((idx + 1) / HINTS.length) * 100}%` }}
          />
        </div>

        <div className="p-5">
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                <hint.icon size={15} className="text-[#9DB5A1]" />
              </span>
              <h3 className="font-bold text-[16px] text-white leading-tight">{hint.title}</h3>
            </div>
            <button
              onClick={dismiss}
              className="p-1 rounded-lg hover:bg-white/10 text-white/60 hover:text-white/70 transition-colors flex-shrink-0 ml-2"
            >
              <X size={15} />
            </button>
          </div>

          {/* Body */}
          <p className="text-[13px] text-white/70 leading-relaxed mb-4">
            {hint.body}
          </p>

          {/* Navigation */}
          <div className="flex items-center justify-between">
            {/* Step dots */}
            <div className="flex items-center gap-1.5">
              {HINTS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIdx(i)}
                  className={`rounded-full transition-all ${
                    i === idx
                      ? 'w-4 h-1.5 bg-white'
                      : 'w-1.5 h-1.5 bg-white/25 hover:bg-white/40'
                  }`}
                />
              ))}
            </div>

            {/* Prev / Next */}
            <div className="flex items-center gap-1.5">
              {!isFirst && (
                <button
                  onClick={prev}
                  className="p-1.5 rounded-xl hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
              )}
              <button
                onClick={next}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[13px] font-semibold transition-colors ${
                  isLast
                    ? 'bg-white text-[#1e2d1f] hover:bg-white/90'
                    : 'bg-white/15 text-white hover:bg-white/25'
                }`}
              >
                {isLast ? 'Понятно' : 'Далее'}
                {!isLast && <ChevronRight size={14} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tail — only for hints anchored to a toolbar button; points at the button. */}
      {layout.tailLeft != null && (
        <div
          className="absolute w-3 h-3 bg-[#1e2d1f] rotate-45 rounded-sm"
          style={{ left: `${layout.tailLeft - 6}px`, bottom: '-4px' }}
        />
      )}
    </div>
  );
}
