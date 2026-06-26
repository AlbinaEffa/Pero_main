/**
 * BookPremise — «Замысел книги» как КОРЕНЬ структуры (Этап C, дыра USM #6).
 *
 * Логлайн (одна фраза) + премис/синопсис (абзац) висят над всем «Сюжетом»: это то, ради чего
 * книга, с чем сверяются скелет/линии/арки. Самодостаточный блок — сам грузит и сохраняет проект
 * (PATCH /projects/:id), Editor трогать не нужно. Сохраняем по потере фокуса, только если менялось.
 */
import { useState, useEffect, useRef } from 'react';
import { Lightbulb, ChevronDown } from 'lucide-react';
import { api } from '../../services/api';

export function BookPremise({ projectId }: { projectId: string }) {
  const [logline, setLogline] = useState('');
  const [premise, setPremise] = useState('');
  const [expanded, setExpanded] = useState(false);
  const saved = useRef({ logline: '', premise: '' }); // последнее сохранённое — чтобы не слать пустые PATCH

  useEffect(() => {
    let alive = true;
    api.get<{ project: { logline?: string | null; premise?: string | null } }>(`/projects/${projectId}`)
      .then(({ project }) => {
        if (!alive) return;
        const lg = project.logline ?? '', pr = project.premise ?? '';
        setLogline(lg); setPremise(pr); saved.current = { logline: lg, premise: pr };
        if (pr) setExpanded(true); // есть премис — сразу показать
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [projectId]);

  const save = (field: 'logline' | 'premise', value: string) => {
    const v = value.trim();
    if (saved.current[field] === v) return;           // не менялось — не дёргаем сервер
    saved.current[field] = v;
    api.patch(`/projects/${projectId}`, { [field]: v }).catch(() => {});
  };

  return (
    <div className="px-5 py-3 border-b border-[#1e2d1f]/5 bg-[#A14F44]/[0.04] flex-shrink-0">
      <div className="flex items-center gap-2">
        <Lightbulb size={14} className="text-[#A14F44]/70 flex-shrink-0" />
        <input
          value={logline}
          onChange={e => setLogline(e.target.value)}
          onBlur={() => save('logline', logline)}
          placeholder="Логлайн — суть книги одной фразой"
          className="flex-1 min-w-0 bg-transparent text-[13px] italic text-[#1e2d1f] placeholder:text-[#1e2d1f]/35 placeholder:not-italic outline-none"
        />
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex-shrink-0 flex items-center gap-1 text-[11px] font-medium text-[#1e2d1f]/45 hover:text-[#1e2d1f]/70 transition-colors"
          title="Премис / синопсис книги"
        >
          Премис <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {expanded && (
        <textarea
          value={premise}
          onChange={e => setPremise(e.target.value)}
          onBlur={() => save('premise', premise)}
          placeholder="Премис / синопсис книги — о чём она и ради чего. С этим сверяется вся структура ниже."
          rows={3}
          className="mt-2 w-full bg-white/50 rounded-lg px-3 py-2 text-[12.5px] leading-relaxed text-[#1e2d1f]/80 placeholder:text-[#1e2d1f]/35 outline-none resize-none border border-[#1e2d1f]/5 focus:border-[#A14F44]/30"
        />
      )}
    </div>
  );
}
