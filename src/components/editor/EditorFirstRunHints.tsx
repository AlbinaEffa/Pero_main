/**
 * EditorFirstRunHints — a floating card shown only on the first editor session.
 *
 * Appears above the bottom toolbar, cycles through 4 tips about key features.
 * Dismissed on "Понятно" or after viewing all hints.
 * Persisted in localStorage so it only shows once.
 */

import { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Mic, WandSparkles, MessageSquareText, SquareSlash } from 'lucide-react';

export const HINTS_DONE_KEY = 'pero_editor_hints_done';

const HINTS = [
  {
    icon: Mic,
    title: 'Диктуйте голосом',
    body: 'Нажмите «Диктовка» в панели снизу — говорите, AI расставит знаки препинания и подставит имена из вашей истории.',
  },
  {
    icon: WandSparkles,
    title: 'Выделите текст — появится AI-меню',
    body: 'Выделите любой фрагмент — над ним всплывёт панель: Сократи, Плотнее, Диалог живее, Конфликт и другие.',
  },
  {
    icon: MessageSquareText,
    title: 'Перо знает вашу историю',
    body: 'Кнопка «Перо» открывает чат с вашим соавтором. Перо прочитало рукопись и Библию истории — спрашивайте про сюжет, персонажей, стиль.',
  },
  {
    icon: SquareSlash,
    title: 'Слэш-команды',
    body: 'Начните строку с / — откроется меню блоков: заголовки, цитаты, списки, разрыв сцены, AI-вставки.',
  },
] as const;

interface Props {
  /** Optional: only show if the editor chapter is new/empty */
  isNewChapter?: boolean;
}

export function EditorFirstRunHints({ isNewChapter }: Props) {
  const [visible, setVisible] = useState(false);
  const [idx, setIdx]         = useState(0);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    // Show only once, slight delay so the editor finishes loading
    if (localStorage.getItem(HINTS_DONE_KEY)) return;
    const timer = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(timer);
  }, []);

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
      className={`pointer-events-auto transition-all duration-200 ${closing ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'}`}
      style={{
        position: 'fixed',
        bottom: '96px',       // above the bottom toolbar (~80px high)
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9000,
        width: 'min(360px, calc(100vw - 2rem))',
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
              <h3 className="font-bold text-[15px] text-white leading-tight">{hint.title}</h3>
            </div>
            <button
              onClick={dismiss}
              className="p-1 rounded-lg hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors flex-shrink-0 ml-2"
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

      {/* Tail pointing down toward toolbar */}
      <div
        className="w-3 h-3 bg-[#1e2d1f] rotate-45 mx-auto -mt-1.5 rounded-sm"
        style={{ marginTop: '-6px' }}
      />
    </div>
  );
}
