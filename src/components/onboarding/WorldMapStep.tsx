import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, MapPin, Box, Globe, BookOpen, PenLine, Download,
  Link2, Activity, Sparkles,
} from 'lucide-react';
import { PeroMark } from '../Logo';
import { api } from '../../services/api';
import { track } from '../../services/analytics';
import { Entity } from '../editor/types';
import { significanceLabel, significanceColor } from '../editor/entityDisplay';
import { WorldBuildState } from './useWorldBuild';
import { downloadWorldCard } from './worldCard';

/**
 * WorldMapStep — финал онбординга: «Карта вашего мира».
 * Письмо от Пера, счётчики-пигменты, главные герои, тизер вопросов, CTA.
 */

interface Props {
  projectId: string;
  projectTitle: string;
  firstChapterId: string | null;
  world: WorldBuildState;
}

export function WorldMapStep({ projectId, projectTitle, firstChapterId, world }: Props) {
  const navigate = useNavigate();
  const { entities, links, events } = world;
  const [letter, setLetter] = useState<string | null>(null);
  const [updatesCount, setUpdatesCount] = useState(0);

  const counts = useMemo(() => ({
    characters: entities.filter(e => e.type === 'character').length,
    locations:  entities.filter(e => e.type === 'location').length,
    items:      entities.filter(e => e.type === 'item').length,
    rules:      entities.filter(e => e.type === 'rule').length,
  }), [entities]);

  const majors = useMemo(
    () => entities.filter(e => e.type === 'character' && e.significance === 'major').slice(0, 4),
    [entities],
  );

  useEffect(() => {
    track('onboarding_worldmap_viewed', {
      projectId,
      entities: entities.length,
      links: links.length,
      events: events.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Тизер «N мест, где мир уточнился» — питается update suggestions (решение CEO-ревью 2B)
  useEffect(() => {
    api.get<{ updates: unknown[] }>(`/bible/${projectId}/updates`)
      .then(d => setUpdatesCount((d.updates ?? []).length))
      .catch(() => {});
  }, [projectId]);

  // Письмо от Пера: один дешёвый AI-вызов, кешируется на сессию
  useEffect(() => {
    if (entities.length === 0) return;
    const cacheKey = `pero_letter_${projectId}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) { setLetter(cached); return; }
    api.post<{ letter: string | null }>(`/bible/${projectId}/letter`, {})
      .then(d => {
        if (d.letter) {
          sessionStorage.setItem(cacheKey, d.letter);
          setLetter(d.letter);
        }
      })
      .catch(() => {}); // письмо — украшение; без него карта полноценна
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, entities.length > 0]);

  const stat = (n: number, label: string, Icon: typeof Users, cls: string) => (
    <div className="bg-white rounded-2xl border border-[#1e2d1f]/5 shadow-sm px-5 py-4 flex flex-col items-center">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center mb-2 ${cls}`}>
        <Icon size={16} />
      </div>
      <span className="font-serif text-3xl font-semibold text-[#1e2d1f] leading-none">{n}</span>
      <span className="text-[10px] uppercase tracking-widest text-[#1e2d1f]/55 font-bold mt-1.5">{label}</span>
    </div>
  );

  return (
    <div className="flex flex-col items-center px-6 pt-14 pb-16 min-h-screen">
      <PeroMark size={30} className="text-[#4A5D4E] mb-4" />
      <h1 className="font-serif text-3xl md:text-5xl font-semibold text-[#1e2d1f] mb-1 text-center">
        Карта вашего мира
      </h1>
      <p className="font-serif italic text-lg text-[#1e2d1f]/55 mb-10 text-center">{projectTitle}</p>

      {/* Письмо от Пера */}
      {letter && (
        <div className="w-full max-w-xl bg-white rounded-2xl border border-[#1e2d1f]/8 shadow-sm px-7 py-6 mb-10 relative">
          <div className="absolute -top-3 left-7 bg-[#E7EAE3] text-[#4A5D4E] text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md">
            Письмо от Пера
          </div>
          <p className="font-serif text-[16px] leading-relaxed text-[#1e2d1f]/85 whitespace-pre-line">{letter}</p>
        </div>
      )}

      {/* Счётчики */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full max-w-xl mb-4">
        {stat(counts.characters, 'Персонажи', Users,  'bg-[#F1DFDA] text-[#9E4338]')}
        {stat(counts.locations,  'Локации',   MapPin, 'bg-[#E7EAE3] text-[#4A5D4E]')}
        {stat(counts.items,      'Предметы',  Box,    'bg-[#F2E9D8] text-[#91682E]')}
        {stat(counts.rules,      'Правила',   Globe,  'bg-[#E6E8EC] text-[#54627F]')}
      </div>

      {(links.length > 0 || events.length > 0) && (
        <p className="flex items-center gap-4 text-xs text-[#1e2d1f]/50 mb-10">
          {links.length > 0 && <span className="flex items-center gap-1.5"><Link2 size={12} />{links.length} связей</span>}
          {events.length > 0 && <span className="flex items-center gap-1.5"><Activity size={12} />{events.length} событий на таймлайнах</span>}
        </p>
      )}

      {/* Главные герои */}
      {majors.length > 0 && (
        <div className="w-full max-w-xl mb-10">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#1e2d1f]/55 mb-3 ml-1">В сердце истории</p>
          <div className="grid grid-cols-2 gap-3">
            {majors.map(c => <MajorCard key={c.id} entity={c} />)}
          </div>
        </div>
      )}

      {/* Тизер вопросов к миру */}
      {updatesCount > 0 && (
        <button
          onClick={() => navigate(`/editor/${projectId}?view=world`)}
          className="w-full max-w-xl bg-[#EBE4EE] border border-[#71597F] rounded-2xl px-6 py-4 mb-10 flex items-center gap-3 text-left hover:bg-[#EBE4EE]/60 transition-colors"
        >
          <Sparkles size={18} className="text-[#71597F] flex-shrink-0" />
          <span className="text-sm text-[#1e2d1f]/75">
            Перо заметило <b className="text-[#71597F]">{updatesCount}</b> {pluralPlaces(updatesCount)}, где мир уточняется по ходу текста — взгляните.
          </span>
        </button>
      )}

      {/* CTA */}
      <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xl">
        <button
          onClick={() => navigate(`/editor/${projectId}?view=world`)}
          className="flex-1 flex items-center justify-center gap-2 bg-[#1e2d1f] text-[#f5f0e8] py-3.5 rounded-xl text-sm font-medium hover:bg-[#2a3f2b] transition-colors shadow-sm"
        >
          <BookOpen size={16} />
          Открыть Мир
        </button>
        {firstChapterId && (
          <button
            onClick={() => navigate(`/editor/${projectId}/${firstChapterId}`)}
            className="flex-1 flex items-center justify-center gap-2 bg-white border border-[#1e2d1f]/10 text-[#1e2d1f] py-3.5 rounded-xl text-sm font-medium hover:bg-[#E8E2D5]/60 transition-colors"
          >
            <PenLine size={16} />
            В редактор
          </button>
        )}
      </div>
      <button
        onClick={() => {
          track('onboarding_worldcard_downloaded', { projectId });
          void downloadWorldCard({
            title: projectTitle,
            ...counts,
            events: events.length,
            majorNames: majors.map(m => m.name),
          });
        }}
        className="mt-3 flex items-center gap-1.5 text-xs text-[#1e2d1f]/50 hover:text-[#1e2d1f]/80 transition-colors py-2"
      >
        <Download size={12} />
        Скачать карточку мира — поделиться в писательском чате
      </button>
    </div>
  );
}

function MajorCard({ entity }: { entity: Entity }) {
  const attrs = (entity.attributes ?? {}) as Record<string, unknown>;
  const role = typeof attrs.role === 'string' ? attrs.role : null;
  return (
    <div className="bg-white rounded-2xl border border-[#1e2d1f]/5 shadow-sm px-5 py-4">
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="font-serif text-lg font-semibold text-[#1e2d1f]">{entity.name}</span>
        {entity.significance && (
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${significanceColor(entity.significance)}`}>
            {significanceLabel(entity.significance)}
          </span>
        )}
      </div>
      <p className="text-xs text-[#1e2d1f]/60 leading-relaxed line-clamp-2">
        {role ?? entity.description}
      </p>
    </div>
  );
}

function pluralPlaces(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'место';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'места';
  return 'мест';
}
