import { useState } from 'react';
import {
  X, GitBranch, Search, Loader2, ChevronDown, ChevronRight,
  BookOpen, RefreshCw, CheckCircle2, PlusCircle, AlertCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { TraceChapter, BibleUpdateSuggestion } from '../../hooks/useRevision';

interface Props {
  // search / trace
  searchQuery: string;
  onSearchQueryChange: (v: string) => void;
  traceResults: TraceChapter[];
  isTracing: boolean;
  traceDone: boolean;
  traceSemantic: boolean;
  onTrace: () => void;
  // arc
  arcText: string;
  isArcLoading: boolean;
  onArc: () => void;
  // bible update
  bibleSuggestions: BibleUpdateSuggestion[];
  isBibleLoading: boolean;
  bibleDone: boolean;
  onBibleUpdate: () => void;
  onDismissBibleSuggestion: (index: number) => void;
  // panel
  onClose: () => void;
}

// Collapsible section header
function Section({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[#1e2d1f]/5 last:border-none">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-white/30 transition-colors"
      >
        <div className="flex items-center gap-2 text-[#1e2d1f]/70">
          <Icon size={14} />
          <span className="text-[11px] font-bold uppercase tracking-widest">{title}</span>
        </div>
        {open ? <ChevronDown size={14} className="text-[#1e2d1f]/30" /> : <ChevronRight size={14} className="text-[#1e2d1f]/30" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

export function RevisionPanel({
  searchQuery,
  onSearchQueryChange,
  traceResults,
  isTracing,
  traceDone,
  traceSemantic,
  onTrace,
  arcText,
  isArcLoading,
  onArc,
  bibleSuggestions,
  isBibleLoading,
  bibleDone,
  onBibleUpdate,
  onDismissBibleSuggestion,
  onClose,
}: Props) {
  return (
    <div className="flex flex-col h-full w-[320px]">
      {/* Header */}
      <div className="p-5 border-b border-[#1e2d1f]/5 flex justify-between items-center bg-white/40 flex-shrink-0">
        <div className="flex items-center gap-2">
          <GitBranch size={18} className="text-emerald-600" />
          <h2 className="font-serif font-bold text-lg text-[#1e2d1f]">Ревизия</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-[#1e2d1f]/5 text-[#1e2d1f]/50 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ── Section 1: Entity search (trace + arc) ── */}
        <Section title="Поиск по тексту" icon={Search}>
          <p className="text-[12px] text-[#1e2d1f]/45 mb-3 leading-relaxed">
            Найди все упоминания персонажа, места или предмета — или проследи его арку.
          </p>

          <div className="flex gap-2 mb-3">
            <input
              value={searchQuery}
              onChange={e => onSearchQueryChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && onTrace()}
              placeholder="Имя персонажа / объекта…"
              className="flex-1 text-sm px-3 py-2 rounded-lg border border-[#1e2d1f]/10 bg-white/70 text-[#1e2d1f] placeholder-[#1e2d1f]/30 focus:outline-none focus:border-emerald-400 transition-colors"
            />
            <button
              onClick={onTrace}
              disabled={!searchQuery.trim() || isTracing || isArcLoading}
              className="p-2 rounded-lg bg-[#1e2d1f] text-white hover:bg-[#2a3f2b] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              title="Найти в главах"
            >
              {isTracing ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            </button>
          </div>

          {/* Trace results */}
          {traceDone && (
            <div className="mb-3">
              {traceResults.length === 0 ? (
                <div className="flex items-center gap-2 text-[#1e2d1f]/40 text-[12px] py-2">
                  <AlertCircle size={13} />
                  <span>
                    {traceSemantic
                      ? 'Не найдено в проиндексированных главах'
                      : 'Нет упоминаний в Библии. Откройте главы в редакторе для индексации.'}
                  </span>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] text-[#1e2d1f]/40 font-medium">
                    {traceResults.length} {traceResults.length === 1 ? 'глава' : 'главы'}
                    {traceSemantic ? ' (семантический поиск)' : ' (по Библии)'}
                  </p>
                  {traceResults.map(ch => (
                    <div key={ch.id} className="rounded-xl bg-white/60 border border-[#1e2d1f]/5 p-3">
                      <p className="text-[13px] font-semibold text-[#1e2d1f] mb-1">{ch.title}</p>
                      {ch.snippets.map((s, i) => (
                        <p key={i} className="text-[11px] text-[#1e2d1f]/50 leading-relaxed line-clamp-3 mt-1">
                          «{s}»
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Arc button */}
          <button
            onClick={onArc}
            disabled={!searchQuery.trim() || isTracing || isArcLoading}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-[12px] font-medium
              border border-[#1e2d1f]/10 text-[#1e2d1f]/60 hover:bg-white hover:border-emerald-300
              hover:text-[#1e2d1f] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isArcLoading
              ? <><Loader2 size={13} className="animate-spin" /> Анализирую арку…</>
              : <><GitBranch size={13} /> Проследить арку персонажа</>}
          </button>

          {/* Arc result */}
          {arcText && (
            <div className="mt-3 rounded-xl bg-emerald-50/60 border border-emerald-200/50 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700/60 mb-2">Арка</p>
              <div className="text-[12px] text-[#1e2d1f]/70 leading-relaxed prose prose-sm max-w-none">
                <ReactMarkdown>{arcText}</ReactMarkdown>
              </div>
            </div>
          )}
        </Section>

        {/* ── Section 2: Bible sync ── */}
        <Section title="Обновить Библию" icon={BookOpen} defaultOpen={false}>
          <p className="text-[12px] text-[#1e2d1f]/45 mb-3 leading-relaxed">
            ИИ сравнит текущую главу с одобренными фактами и предложит обновления.
          </p>

          <button
            onClick={onBibleUpdate}
            disabled={isBibleLoading}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-[12px] font-medium
              bg-[#1e2d1f] text-white hover:bg-[#2a3f2b]
              disabled:opacity-40 disabled:cursor-not-allowed transition-all mb-3"
          >
            {isBibleLoading
              ? <><Loader2 size={13} className="animate-spin" /> Анализирую…</>
              : <><RefreshCw size={13} /> Проверить главу</>}
          </button>

          {bibleDone && bibleSuggestions.length === 0 && (
            <div className="flex items-center gap-2 text-emerald-600 text-[12px]">
              <CheckCircle2 size={14} />
              <span>Библия актуальна — изменений не требуется</span>
            </div>
          )}

          {bibleSuggestions.length > 0 && (
            <div className="space-y-2">
              {bibleSuggestions.map((s, i) => (
                <div
                  key={i}
                  className={`rounded-xl border p-3 ${
                    s.action === 'add'
                      ? 'bg-blue-50/60 border-blue-200/50'
                      : 'bg-amber-50/60 border-amber-200/50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      {s.action === 'add'
                        ? <PlusCircle size={12} className="text-blue-500" />
                        : <RefreshCw size={12} className="text-amber-500" />}
                      <span className="text-[12px] font-semibold text-[#1e2d1f]">{s.entityName}</span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                        s.action === 'add' ? 'bg-blue-100 text-blue-600' : 'bg-amber-100 text-amber-600'
                      }`}>
                        {s.action === 'add' ? 'добавить' : 'обновить'}
                      </span>
                    </div>
                    <button
                      onClick={() => onDismissBibleSuggestion(i)}
                      className="text-[#1e2d1f]/25 hover:text-[#1e2d1f]/50 transition-colors"
                    >
                      <X size={13} />
                    </button>
                  </div>

                  {s.action === 'update' && s.currentDescription && (
                    <p className="text-[11px] text-[#1e2d1f]/40 line-through mb-1 leading-relaxed">
                      {s.currentDescription}
                    </p>
                  )}
                  <p className="text-[12px] text-[#1e2d1f]/70 leading-relaxed">{s.suggestedDescription}</p>
                  <p className="text-[10px] text-[#1e2d1f]/35 mt-1.5 italic">{s.reason}</p>
                </div>
              ))}
            </div>
          )}
        </Section>

      </div>
    </div>
  );
}
