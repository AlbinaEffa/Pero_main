import { Editor as TiptapEditor } from '@tiptap/react';
import { Trash2 } from 'lucide-react';

interface FootnotesAreaProps {
  footnotes: { id: string; content: string; number: number }[];
  editor: TiptapEditor | null;
  /** Прыжок к маркеру сноски в тексте (по клику на номер). */
  onScrollToMarker: (id: string) => void;
}

/**
 * Презентационная область сносок внизу главы (Word-style): номер + редактируемый текст.
 * Чистый компонент — состояние/синхронизация/фокус живут в EditorCanvas; сюда приходят
 * готовые сноски и колбэк прыжка, правки идут командами Tiptap (update/removeFootnote).
 */
export function FootnotesArea({ footnotes, editor, onScrollToMarker }: FootnotesAreaProps) {
  if (footnotes.length === 0) return null;
  return (
    <div className="mt-12 pt-5 border-t border-[#1e2d1f]/12 pb-32" style={{ fontFamily: '"Golos Text", system-ui, sans-serif' }}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#1e2d1f]/40 mb-3">Сноски</div>
      <div className="flex flex-col gap-1.5">
        {footnotes.map((fn) => (
          <div key={fn.id} data-fn-item={fn.id} className="flex items-start gap-2.5 group rounded-lg -mx-2 px-2 py-0.5 hover:bg-[#1e2d1f]/[0.02] transition-colors">
            <button
              onClick={() => onScrollToMarker(fn.id)}
              title="К месту в тексте"
              className="text-[12px] font-semibold text-[#71597F] hover:underline pt-2 w-5 text-right shrink-0"
            >
              {fn.number}.
            </button>
            <textarea
              value={fn.content}
              onChange={(e) => editor?.commands.updateFootnote(fn.id, e.target.value)}
              placeholder="Текст сноски…"
              rows={2}
              className="flex-1 resize-none bg-transparent border border-transparent rounded-md outline-none text-[13px] text-[#1e2d1f]/80 leading-snug px-2 py-1.5 placeholder:text-[#1e2d1f]/30 focus:bg-white focus:border-[#1e2d1f]/10 transition-colors"
            />
            <button
              onClick={() => editor?.commands.removeFootnote(fn.id)}
              title="Удалить сноску"
              className="p-1 mt-1.5 rounded-md text-[#1e2d1f]/30 hover:text-[#9E4338] hover:bg-[#F1DFDA] transition-colors opacity-0 group-hover:opacity-100 shrink-0"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
