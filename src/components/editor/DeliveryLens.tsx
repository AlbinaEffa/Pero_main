/**
 * DeliveryLens — «Доставил задуманное?» (P2). Сверяет АВТОРСКИЙ план (нити/арки/биты)
 * с тем, что реально в прозе, по синопсисам (1 ИИ-вызов). Замыкает петлю план→письмо→сверка:
 * показывает, что отыграно, что провисает, что ещё не начато. Перо ЧИТАЕТ, не генерит.
 */
import { useState } from 'react';
import { Loader2, ScanLine, ArrowRight, CircleCheck, CircleDashed, CircleAlert } from 'lucide-react';
import { api } from '../../services/api';

type Status = 'delivered' | 'partial' | 'missing';
interface DeliveryItem {
  ref: string;
  type: 'thread' | 'arc' | 'beat';
  label: string;
  detail: string;
  status: Status;
  reason: string;
  chapterId: string | null;
  chapterTitle: string | null;
}

const STATUS_META: Record<Status, { label: string; color: string; bg: string; Icon: typeof CircleCheck }> = {
  missing:   { label: 'Провисает',  color: '#9E4338', bg: 'rgba(158,67,56,0.08)',  Icon: CircleAlert },
  partial:   { label: 'Частично',   color: '#91682E', bg: 'rgba(145,104,46,0.08)', Icon: CircleDashed },
  delivered: { label: 'Отыграно',   color: '#4D6A4D', bg: 'rgba(77,106,77,0.08)',  Icon: CircleCheck },
};
const TYPE_LABEL: Record<DeliveryItem['type'], string> = { thread: 'линия', arc: 'арка', beat: 'бит' };
const ORDER: Status[] = ['missing', 'partial', 'delivered'];

export function DeliveryLens({ projectId, onJump }: { projectId: string; onJump: (chapterId: string) => void }) {
  const [items, setItems] = useState<DeliveryItem[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  const scan = async () => {
    setScanning(true); setReason(null);
    try {
      const d = await api.post<{ items: DeliveryItem[]; reason?: string }>(`/plot/${projectId}/delivery/scan`, {});
      setItems(d.items ?? []);
      setReason(d.reason ?? null);
    } catch {
      setReason('Не удалось свериться. Попробуй ещё раз.');
    } finally { setScanning(false); }
  };

  const counts = items ? ORDER.map(s => ({ s, n: items.filter(i => i.status === s).length })) : [];

  return (
    <div className="flex flex-col gap-3">
      {/* Шапка-скан */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-[#1e2d1f]/55 leading-snug">
          Перо сверяет твой план (нити · арки · биты) с тем, что уже написано.
        </p>
        <button
          onClick={scan} disabled={scanning}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1e2d1f] text-[#f5f0e8] text-[12px] font-medium hover:bg-[#2a3f2b] disabled:opacity-50"
        >
          {scanning ? <Loader2 size={13} className="animate-spin" /> : <ScanLine size={13} />}
          {items ? 'Сверить заново' : 'Сверить с прозой'}
        </button>
      </div>

      {/* Сводка по статусам */}
      {items && items.length > 0 && (
        <div className="flex gap-2">
          {counts.map(({ s, n }) => {
            const m = STATUS_META[s];
            return (
              <div key={s} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-medium" style={{ background: m.bg, color: m.color }}>
                <m.Icon size={12} /> {m.label} · {n}
              </div>
            );
          })}
        </div>
      )}

      {reason && <p className="text-[12px] text-[#1e2d1f]/50 bg-[#1e2d1f]/[0.03] rounded-lg px-3 py-2.5">{reason}</p>}

      {!items && !reason && !scanning && (
        <p className="text-[12.5px] text-[#1e2d1f]/40 text-center py-8 leading-relaxed">
          Нажми «Сверить с прозой» — Перо прочитает синопсисы и покажет,<br />что из задуманного отыграно, а что провисает.
        </p>
      )}

      {/* Список по статусам: сперва провисает/частично (на что смотреть), потом отыграно */}
      {items && items.length > 0 && ORDER.map(status => {
        const group = items.filter(i => i.status === status);
        if (group.length === 0) return null;
        const m = STATUS_META[status];
        return (
          <div key={status} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider mt-1" style={{ color: m.color }}>
              <m.Icon size={12} /> {m.label} · {group.length}
            </div>
            {group.map(it => (
              <div key={it.ref} className="rounded-lg px-3 py-2.5" style={{ background: m.bg }}>
                <div className="flex items-start gap-2">
                  <span className="text-[9.5px] uppercase tracking-wide px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0" style={{ background: 'rgba(30,45,31,0.06)', color: '#1e2d1f99' }}>{TYPE_LABEL[it.type]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-[#1e2d1f] leading-snug">{it.label}</div>
                    {it.reason && <p className="text-[12px] text-[#1e2d1f]/65 leading-relaxed mt-0.5">{it.reason}</p>}
                    {it.chapterId && it.chapterTitle && (
                      <button onClick={() => onJump(it.chapterId!)} className="inline-flex items-center gap-1 text-[11.5px] mt-1 hover:underline" style={{ color: m.color }}>
                        {it.chapterTitle} <ArrowRight size={11} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
