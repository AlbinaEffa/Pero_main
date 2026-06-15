import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: typeof Search;
  keywords?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

/**
 * Командная палитра (⌘K) — «вызов намерением словом». Печатаешь «связи», «прочитать»,
 * «нестыковки» — получаешь действие, вместо охоты за иконкой. Это половина нативного
 * управления (вторая — пульс-рельс, где состояние само на виду).
 */
export function CommandPalette({ open, onClose, commands }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // focus after mount
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(c =>
      (c.label + ' ' + (c.keywords ?? '') + ' ' + (c.hint ?? '')).toLowerCase().includes(q),
    );
  }, [query, commands]);

  useEffect(() => { setActive(0); }, [query]);

  if (!open) return null;

  const run = (cmd?: Command) => {
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(a => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(filtered[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center pt-[18vh] bg-ink/20 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] mx-4 bg-white rounded-2xl shadow-2xl border border-[#1e2d1f]/10 overflow-hidden"
        onClick={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1e2d1f]/5">
          <Search size={17} className="text-[#1e2d1f]/40 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Что сделать? — связи, прочитать, нестыковки…"
            className="flex-1 bg-transparent outline-none text-[15px] text-[#1e2d1f] placeholder:text-[#1e2d1f]/35"
          />
          <kbd className="text-[10px] font-mono text-[#1e2d1f]/35 border border-[#1e2d1f]/10 rounded px-1.5 py-0.5">esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[#1e2d1f]/40">Ничего не найдено</div>
          ) : filtered.map((c, i) => {
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(c)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === active ? 'bg-[#f5f0e8]' : 'hover:bg-[#f5f0e8]/60'
                }`}
              >
                <Icon size={16} className="text-[#1e2d1f]/55 flex-shrink-0" />
                <span className="flex-1 text-sm text-[#1e2d1f]">{c.label}</span>
                {c.hint && <span className="text-[11px] text-[#1e2d1f]/40">{c.hint}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
