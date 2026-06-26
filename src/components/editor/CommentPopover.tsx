/**
 * CommentPopover — карточка комментария у привязанной фразы.
 * Открывается кликом по подсветке (или сразу после создания, в режиме ввода).
 * Тело редактируется на месте; сохраняется по «Готово» / клику вне / Escape-сохранение.
 * Действия: решить (resolved), удалить, перенести в Заметки.
 *
 * Источник (source) задаёт акцент: author — охра (твоя пометка), pero — терракота
 * (находка Перо; задел под единый слой полей).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Trash2, StickyNote, X, Sparkles } from 'lucide-react';
import { useClickOutside } from '../../hooks/useClickOutside';

export interface CommentReply {
  id: string;
  body: string;
  author: 'author' | 'pero';
  createdAt: string;
}

export interface CommentData {
  id: string;
  body: string;
  quote: string;
  source: 'author' | 'pero';
  resolved: boolean;
  replies?: CommentReply[];
}

interface Props {
  comment: CommentData;
  x: number;
  y: number;
  /** Открыть сразу в режиме ввода (новый комментарий). */
  startEditing?: boolean;
  onSave: (body: string) => void;
  onResolve: () => void;
  onDelete: () => void;
  onToNote: () => void;
  onClose: () => void;
}

const ACCENT = { author: '#91682E', pero: '#A14F44' } as const;

export function CommentPopover({ comment, x, y, startEditing, onSave, onResolve, onDelete, onToNote, onClose }: Props) {
  const [body, setBody] = useState(comment.body);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const accent = ACCENT[comment.source] ?? ACCENT.author;

  // Сохранить (если изменилось) и закрыть — общий выход.
  const saveAndClose = () => {
    if (body.trim() !== comment.body.trim()) onSave(body.trim());
    onClose();
  };
  const saveRef = useRef(saveAndClose);
  saveRef.current = saveAndClose;

  const ref = useClickOutside<HTMLDivElement>(true, () => saveRef.current());

  useEffect(() => {
    if (startEditing) {
      const t = setTimeout(() => taRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [startEditing]);

  // Держим карточку в окне (ширина ≈300).
  const HALF = 150;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const left = Math.min(Math.max(x, HALF + 8), vw - HALF - 8);

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', top: Math.min(y + 8, window.innerHeight - 220), left, transform: 'translateX(-50%)', zIndex: 9999 }}
      className="w-[300px] bg-white border border-[#1e2d1f]/12 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 px-3.5 pt-3 pb-2">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: accent }}>
          {comment.source === 'pero' ? <Sparkles size={11} /> : <StickyNote size={11} />}
          {comment.source === 'pero' ? 'Перо' : 'Комментарий'}
        </span>
        <button onMouseDown={(e) => { e.preventDefault(); saveAndClose(); }} className="ml-auto p-1 rounded-md hover:bg-[#1e2d1f]/6 text-[#1e2d1f]/40"><X size={13} /></button>
      </div>

      {comment.quote && (
        <div className="px-3.5 pb-2">
          <div className="font-serif text-[12.5px] italic text-[#1e2d1f]/70 rounded-r-md pl-2.5 py-1" style={{ borderLeft: `2px solid ${accent}66` }}>
            «{comment.quote.length > 90 ? comment.quote.slice(0, 90) + '…' : comment.quote}»
          </div>
        </div>
      )}

      <div className="px-3.5 pb-2.5">
        <textarea
          ref={taRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveAndClose(); }
          }}
          rows={3}
          placeholder="Заметка к этому месту…"
          className="w-full resize-none text-[13px] leading-relaxed text-[#1e2d1f] bg-[#1e2d1f]/[0.03] rounded-lg px-2.5 py-2 outline-none focus:bg-[#1e2d1f]/[0.05] placeholder:text-[#1e2d1f]/30"
        />
      </div>

      <div className="flex items-center gap-0.5 px-2.5 pb-2.5 pt-0.5 border-t border-[#1e2d1f]/6">
        <button
          onMouseDown={(e) => { e.preventDefault(); onResolve(); }}
          title="Решено — снять пометку"
          className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#4A5D4E] hover:bg-[#4A5D4E]/10 px-2 py-1.5 rounded-lg transition-colors"
        ><Check size={13} /> Решено</button>
        <button
          onMouseDown={(e) => { e.preventDefault(); onToNote(); }}
          title="Перенести в Заметки"
          className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#1e2d1f]/55 hover:text-[#91682E] hover:bg-[#91682E]/10 px-2 py-1.5 rounded-lg transition-colors"
        ><StickyNote size={13} /> В заметки</button>
        <button
          onMouseDown={(e) => { e.preventDefault(); onDelete(); }}
          title="Удалить комментарий"
          className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-[#1e2d1f]/45 hover:text-[#9E4338] hover:bg-[#9E4338]/10 px-2 py-1.5 rounded-lg transition-colors"
        ><Trash2 size={13} /></button>
      </div>
    </div>,
    document.body,
  );
}
