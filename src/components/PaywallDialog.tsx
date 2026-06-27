/**
 * PaywallDialog — мягкий пейволл лимитов Free-тарифа (P0.5).
 * Смонтирован один раз в App; подхватывает denial из стора usePaywall, который
 * наполняется при 402 PLAN_LIMIT_* (см. services/api). Не блокирует работу:
 * объясняет лимит и ведёт на оформление Перо Pro.
 */
import { useNavigate } from 'react-router-dom';
import { Sparkles, Lock, X } from 'lucide-react';
import { usePaywallDenial, paywall } from '../store/paywall';

const TITLE_BY_CODE: Record<string, string> = {
  PLAN_LIMIT_PROJECTS: 'Достигнут лимит проектов',
  PLAN_LIMIT_BIBLE_CHAPTERS: 'Мир читает первые 30 глав',
};

const PRO_PERKS = [
  'Неограниченные проекты и книги',
  'Мир анализирует всю рукопись целиком',
  'Больше AI-действий в день',
];

export function PaywallDialog() {
  const navigate = useNavigate();
  const denial = usePaywallDenial();
  const hide = paywall.hide;

  if (!denial) return null;

  const title = TITLE_BY_CODE[denial.code] ?? 'Перо Pro снимает лимит';

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-[#1e2d1f]/40 backdrop-blur-[2px]"
      onClick={hide}
    >
      <div
        className="relative w-full max-w-[400px] bg-[#f5f0e8] rounded-2xl shadow-2xl border border-[#1e2d1f]/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={hide}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-[#1e2d1f]/40 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/5 transition-colors"
          aria-label="Закрыть"
        >
          <X size={16} />
        </button>

        <div className="px-6 pt-6 pb-5">
          <div className="w-11 h-11 rounded-xl bg-[#A14F44]/12 flex items-center justify-center mb-3">
            <Lock size={20} className="text-[#A14F44]" />
          </div>
          <h2 className="font-serif text-[19px] font-semibold text-[#1e2d1f] leading-tight">{title}</h2>
          <p className="mt-1.5 text-[13.5px] text-[#1e2d1f]/70 leading-relaxed">{denial.error}</p>

          <div className="mt-4 rounded-xl bg-white/60 border border-[#1e2d1f]/8 p-3">
            <div className="flex items-center gap-1.5 text-[#A14F44] font-semibold text-[12px] mb-2">
              <Sparkles size={13} /> Перо Pro
            </div>
            <ul className="flex flex-col gap-1.5">
              {PRO_PERKS.map((perk) => (
                <li key={perk} className="flex items-start gap-2 text-[12.5px] text-[#1e2d1f]/75 leading-snug">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full bg-[#A14F44] flex-shrink-0" />
                  {perk}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-5 flex items-center gap-2">
            <button
              onClick={() => { hide(); navigate('/settings'); }}
              className="flex-1 flex items-center justify-center gap-1.5 font-semibold text-[#f5f0e8] bg-[#A14F44] hover:bg-[#8e4339] rounded-xl py-2.5 text-[13.5px] transition-colors"
            >
              <Sparkles size={15} /> Оформить Перо Pro
            </button>
            <button
              onClick={hide}
              className="px-4 py-2.5 text-[13px] font-medium text-[#1e2d1f]/55 hover:text-[#1e2d1f] hover:bg-[#1e2d1f]/5 rounded-xl transition-colors"
            >
              Позже
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
