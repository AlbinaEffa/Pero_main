import { useState, useMemo } from 'react';
import { Search, Check, Plus } from 'lucide-react';
import { GENRE_GROUPS, ALL_GENRES } from '../data/genres';

/**
 * Общий пикер жанров: сгруппированная таксономия AT/Litnet, поиск, свой жанр,
 * мультивыбор и подсветка предложений Пера. Используется в импорте и «Новой книге».
 */

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** Жанры, предложенные Пером (подсвечиваются как «предложено»). */
  suggested?: string[];
  /** Перо определяет жанр прямо сейчас. */
  loading?: boolean;
}

const CUSTOM_KEY = 'pero_custom_genres';

export default function GenrePicker({ value, onChange, suggested = [], loading = false }: Props) {
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); } catch { return []; }
  });

  const selected = new Set(value);
  const suggestSet = new Set(suggested.filter(s => !selected.has(s)));

  const toggle = (g: string) => {
    onChange(selected.has(g) ? value.filter(x => x !== g) : [...value, g]);
  };

  const addCustom = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    if (!ALL_GENRES.includes(v) && !custom.includes(v)) {
      const next = [...custom, v];
      setCustom(next);
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
    }
    if (!selected.has(v)) onChange([...value, v]);
    setQuery('');
  };

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return null;
    return [...new Set([...ALL_GENRES, ...custom])].filter(g => g.toLowerCase().includes(q));
  }, [q, custom]);
  const exactExists = !!q && [...ALL_GENRES, ...custom].some(g => g.toLowerCase() === q);

  const Chip = ({ g }: { g: string }) => {
    const on = selected.has(g);
    const sug = suggestSet.has(g);
    return (
      <button
        type="button"
        onClick={() => toggle(g)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] border transition-colors ${
          on
            ? 'bg-[#E7EAE3] border-[var(--color-accent)] text-[var(--color-accent)] font-medium'
            : sug
            ? 'bg-white border-dashed border-[var(--color-accent)]/45 text-ink/70 hover:border-[var(--color-accent)]'
            : 'bg-white border-ink/10 text-ink/65 hover:border-ink/25'
        }`}
      >
        {on && <Check size={13} className="flex-shrink-0" />}
        {g}
        {sug && (
          <span className="text-[9px] uppercase tracking-wide text-[var(--color-accent)] font-bold">Перо</span>
        )}
      </button>
    );
  };

  return (
    <div>
      {loading && <p className="text-[12px] text-ink/55 mb-2">Перо определяет жанр…</p>}
      {!loading && suggestSet.size > 0 && (
        <p className="text-[12px] text-ink/60 mb-2">Перо предлагает жанр — нажмите, чтобы подтвердить или снять.</p>
      )}

      <div className="relative mb-2">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/45" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(query); } }}
          placeholder="Найти жанр или вписать свой…"
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-ink/10 bg-white text-[13px] outline-none focus:border-[var(--color-accent)] transition-colors"
        />
      </div>
      <p className="text-[11px] text-ink/55 mb-3">
        Своего жанра нет в списке? Впишите его выше и нажмите Enter.
      </p>

      <div className="max-h-56 overflow-y-auto pr-1 space-y-3">
        {filtered ? (
          <div className="flex flex-wrap gap-1.5">
            {filtered.map(g => <Chip key={g} g={g} />)}
            {q && !exactExists && (
              <button
                type="button"
                onClick={() => addCustom(query)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] border border-dashed border-[var(--color-accent)]/55 text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors"
              >
                <Plus size={13} /> Добавить «{query.trim()}»
              </button>
            )}
          </div>
        ) : (
          <>
            {custom.length > 0 && (
              <Group label="Свои">{custom.map(g => <Chip key={g} g={g} />)}</Group>
            )}
            {GENRE_GROUPS.map(grp => (
              <Group key={grp.label} label={grp.label}>
                {grp.genres.map(g => <Chip key={g} g={g} />)}
              </Group>
            ))}
          </>
        )}
      </div>

      {value.length > 0 && (
        <p className="text-[11px] text-ink/55 mt-2 leading-relaxed">Выбрано: {value.join(', ')}</p>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-ink/55 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
