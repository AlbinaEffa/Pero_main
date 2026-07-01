/**
 * EmptyLensState — единый «house-rule» пустых состояний (#5).
 *
 * Одна интонация во всех линзах/панелях вместо разнобоя «прочерк / никого / нет данных»:
 * приглушённая иконка-плашка → тёплый заголовок (ЧТО пусто) → подсказка (ПОЧЕМУ и что сделать)
 * → опциональное действие. Позиционирование продукта: пусто ≠ поломка, а «Перо ещё не прочитало».
 *
 * tone: 'neutral' — ждём наполнения (сепия-ink); 'positive' — пусто и это ХОРОШО (нет нестыковок — шалфей).
 */
import type { LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  title: string;
  hint?: string;
  tone?: 'neutral' | 'positive';
  action?: { label: string; onClick: () => void };
}

export function EmptyLensState({ icon: Icon, title, hint, tone = 'neutral', action }: Props) {
  const positive = tone === 'positive';
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-4 select-none">
      <div
        className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4 ${
          positive ? 'bg-[#4A5D4E]/10' : 'bg-[#1e2d1f]/[0.06]'
        }`}
      >
        <Icon size={24} className={positive ? 'text-[#4A5D4E]' : 'text-[#1e2d1f]/35'} strokeWidth={1.75} />
      </div>
      <p className="text-[14px] font-medium text-[#1e2d1f]/70 max-w-[280px] leading-snug">{title}</p>
      {hint && (
        <p className="text-[12.5px] mt-1.5 text-[#1e2d1f]/50 max-w-[280px] leading-relaxed">{hint}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#1e2d1f] text-[#f5f0e8] text-[13px] font-semibold hover:bg-[#2a3f2b] transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
