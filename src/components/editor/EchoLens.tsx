import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowUpRight, Sparkles, Loader2 } from 'lucide-react';
import { api } from '../../services/api';

interface EchoResult {
  chunkText: string;
  chapterId: string;
  chapterTitle: string | null;
  order: number | null;
  similarity: number;
  projectId?: string;       // серия-поиск: из какой книги фрагмент
  bookTitle?: string | null;
}

/**
 * Линза «Эхо» — семантический поиск по всей книге. Запрос эмбеддится локально (Ollama,
 * без API-токенов), косинус по чанкам рукописи → фрагменты, БЛИЗКИЕ ПО СМЫСЛУ (не по словам).
 * Клик по результату → переход в главу с подсветкой. Линза сама ходит на бэкенд
 * (POST /bible/:projectId/semantic-search), как NotesBoard.
 */
export function EchoLens({ projectId, onJump, initialQuery, seriesId }: {
  projectId: string;
  onJump: (chapterId: string, highlight: string) => void;
  initialQuery?: string | null;
  seriesId?: string | null;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EchoResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState(false);
  const [scope, setScope] = useState<'book' | 'series'>('book');
  const reqId = useRef(0);

  async function run(override?: string, scopeOverride?: 'book' | 'series') {
    const q = (override ?? query).trim();
    if (!q || loading) return;
    const useScope = scopeOverride ?? scope;
    const my = ++reqId.current;
    setLoading(true); setError(false);
    try {
      const { results: r } = await api.post<{ results: EchoResult[] }>(
        `/bible/${projectId}/semantic-search`, { query: q, scope: useScope },
      );
      if (my !== reqId.current) return; // устаревший ответ
      setResults(r ?? []);
      setSearched(true);
    } catch {
      if (my === reqId.current) { setError(true); setSearched(true); setResults([]); }
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  }

  // Клик по результату: фрагмент из ДРУГОЙ книги серии → переход в её редактор; из текущей → onJump.
  const openResult = (r: EchoResult) => {
    if (r.projectId && r.projectId !== projectId) navigate(`/editor/${r.projectId}/${r.chapterId}`);
    else onJump(r.chapterId, leadFor(r.chunkText));
  };

  // «Найти похожее» по выделению: подставить запрос и сразу искать.
  useEffect(() => {
    const q = initialQuery?.trim();
    if (!q) return;
    setQuery(q);
    run(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  // Короткий ведущий фрагмент для подсветки в тексте (длинный чанк целиком не матчится).
  const leadFor = (t: string) => t.replace(/\s+/g, ' ').trim().split(' ').slice(0, 7).join(' ');

  return (
    <div className="flex flex-col gap-4">
      <div className="text-[12.5px] text-[#1e2d1f]/55 leading-relaxed">
        Поиск <span className="font-semibold text-[#1e2d1f]/75">по смыслу</span>, а не по словам — опиши,
        что ищешь («тайная влюблённость», «предательство у Котла»), и Перо найдёт места{seriesId ? '' : ' по всей книге'}.
      </div>

      {/* scope «Книга · Серия» — только если книга в серии (Эхо · Вся серия) */}
      {seriesId && (
        <div className="flex items-center gap-1 self-start rounded-lg bg-[#1e2d1f]/[0.05] p-0.5 text-[11.5px]">
          {(['book', 'series'] as const).map(s => (
            <button
              key={s}
              onClick={() => { setScope(s); if (query.trim()) run(undefined, s); }}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${scope === s ? 'bg-white text-[#1e2d1f] shadow-sm' : 'text-[#1e2d1f]/60 hover:text-[#1e2d1f]/75'}`}
            >
              {s === 'book' ? 'Эта книга' : 'Вся серия'}
            </button>
          ))}
        </div>
      )}

      {/* строка поиска */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 rounded-xl border border-[#1e2d1f]/12 bg-white/70 focus-within:border-[#A14F44]/50 px-3 py-2 transition-colors">
          <Search size={15} className="shrink-0 text-[#1e2d1f]/35" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') run(); }}
            placeholder="Опиши, что ищешь по смыслу…"
            className="flex-1 min-w-0 bg-transparent text-[13.5px] text-[#1e2d1f]/85 placeholder:text-[#1e2d1f]/35 outline-none"
          />
        </div>
        <button
          onClick={() => run()}
          disabled={!query.trim() || loading}
          className="shrink-0 flex items-center gap-1.5 rounded-xl bg-[#A14F44] text-[#f5f0e8] text-[12.5px] font-medium px-3.5 py-2 disabled:opacity-40 hover:bg-[#8f4339] transition-colors"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Найти
        </button>
      </div>

      {/* результаты */}
      {loading && (
        <div className="text-[12.5px] text-[#1e2d1f]/45 py-6 text-center">Перо ищет по смыслу…</div>
      )}

      {!loading && searched && error && (
        <div className="text-[12.5px] text-[#9E4338] py-6 text-center">Поиск не удался — попробуй ещё раз.</div>
      )}

      {!loading && searched && !error && results.length === 0 && (
        <div className="flex flex-col items-center justify-center text-center py-12 text-[#1e2d1f]/45">
          <Search size={26} className="mb-3 text-[#1e2d1f]/25" />
          <p className="text-[13.5px] font-medium text-[#1e2d1f]/60">Ничего близкого не нашлось</p>
          <p className="text-[12px] mt-1 max-w-[280px] leading-relaxed">
            Книга должна быть проэмбеддена (это идёт в фоне после чтения глав). Попробуй переформулировать запрос.
          </p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="flex flex-col gap-2">
          {results.map((r, i) => (
            <button
              key={`${r.chapterId}-${i}`}
              onClick={() => openResult(r)}
              className="group text-left rounded-xl border border-[#1e2d1f]/8 bg-white/70 hover:bg-white hover:border-[#A14F44]/30 transition-all p-3"
            >
              <div className="flex items-center gap-2 mb-1.5">
                {r.bookTitle && (
                  <span className="text-[10px] font-semibold text-[#54627F] bg-[#54627F]/10 rounded px-1.5 py-0.5 shrink-0 truncate max-w-[120px]" title={r.bookTitle}>
                    {r.bookTitle}
                  </span>
                )}
                <span className="text-[11px] font-semibold text-[#A14F44] truncate">
                  {r.chapterTitle || 'Без названия'}
                </span>
                <span className="text-[10px] text-[#1e2d1f]/35 shrink-0 ml-auto tabular-nums">
                  {Math.round(r.similarity * 100)}%
                </span>
                <ArrowUpRight size={14} className="shrink-0 text-[#1e2d1f]/25 group-hover:text-[#A14F44] transition-colors" />
              </div>
              <p className="text-[13px] text-[#1e2d1f]/75 leading-snug line-clamp-3">
                {r.chunkText.replace(/\s+/g, ' ').trim().slice(0, 240)}…
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
