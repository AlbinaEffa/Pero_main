import { useState, useEffect } from 'react';
import { track } from '../services/analytics';
import { PeroMark } from './Logo';

/**
 * Празднование aha-момента: пятое одобренное предложение библии — событие,
 * по которому меряется успех онбординга (метрика №1 PRD). Празднуем ровно то,
 * что измеряем: секундный «снегопад» перьев + строка о том, что библия ожила.
 */

const AHA_EVENT = 'pero:aha';
const AHA_THRESHOLD = 5;

/**
 * Зарегистрировать одобрение сущности. Считает по проекту в localStorage,
 * шлёт события воронки и на пятом одобрении запускает праздник.
 */
export function registerApproval(projectId: string | undefined): void {
  if (!projectId) return;
  const key = `pero_approvals_${projectId}`;
  let count = 0;
  try {
    count = (parseInt(localStorage.getItem(key) ?? '0', 10) || 0) + 1;
    localStorage.setItem(key, String(count));
  } catch { return; }

  if (count === 1) track('first_entity_approved', { projectId });
  if (count === AHA_THRESHOLD) {
    track('aha_5_approved', { projectId });
    window.dispatchEvent(new CustomEvent(AHA_EVENT));
  }
}

interface FeatherSpec {
  id: number;
  left: number;     // %
  delay: number;    // s
  duration: number; // s
  size: number;     // px
  drift: number;    // px горизонтального сноса
}

/** Оверлей праздника. Смонтируйте один раз на страницах, где одобряют сущности. */
export function AhaCelebration() {
  const [feathers, setFeathers] = useState<FeatherSpec[] | null>(null);

  useEffect(() => {
    const onAha = () => {
      setFeathers(Array.from({ length: 14 }, (_, i) => ({
        id: i,
        left: 6 + Math.random() * 88,
        delay: Math.random() * 0.6,
        duration: 1.6 + Math.random() * 1.2,
        size: 16 + Math.random() * 14,
        drift: (Math.random() - 0.5) * 120,
      })));
      // Убрать оверлей после самого долгого пера
      setTimeout(() => setFeathers(null), 3600);
    };
    window.addEventListener(AHA_EVENT, onAha);
    return () => window.removeEventListener(AHA_EVENT, onAha);
  }, []);

  if (!feathers) return null;

  return (
    <div className="fixed inset-0 z-[200] pointer-events-none overflow-hidden">
      {feathers.map(f => (
        <span
          key={f.id}
          className="absolute top-[-40px] text-[#4A5D4E]"
          style={{
            left: `${f.left}%`,
            animation: `featherFall ${f.duration}s ease-in ${f.delay}s forwards`,
            ['--drift' as string]: `${f.drift}px`,
          }}
        >
          <PeroMark size={f.size} />
        </span>
      ))}
      <div className="absolute left-1/2 top-[20%] -translate-x-1/2 animate-[ahaToast_3s_ease_forwards]">
        <div className="bg-[#1e2d1f] text-[#f5f0e8] rounded-2xl px-6 py-3.5 shadow-xl text-center">
          <p className="font-serif text-lg font-semibold">Ваш Мир задышал</p>
          <p className="text-xs text-[#f5f0e8]/70 mt-0.5">Перо теперь следит за миром само</p>
        </div>
      </div>
      <style>{`
        @keyframes featherFall {
          0%   { transform: translateY(0) translateX(0) rotate(0deg); opacity: 0; }
          10%  { opacity: 1; }
          100% { transform: translateY(105vh) translateX(var(--drift)) rotate(300deg); opacity: 0.7; }
        }
        @keyframes ahaToast {
          0%   { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.96); }
          12%  { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
          80%  { opacity: 1; }
          100% { opacity: 0; transform: translateX(-50%) translateY(-6px); }
        }
      `}</style>
    </div>
  );
}
