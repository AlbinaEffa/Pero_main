/**
 * SharedBible — публичная read-only страница «библии» книги (Этап D).
 * Открывается по ссылке /share/:token БЕЗ входа. Показывает замысел (логлайн/премис) и каталог
 * Мира (сущности по типам). Никакой рукописи/связей/правок — только просмотр.
 */
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Feather, Users, MapPin, Box, Globe, Lock } from 'lucide-react';
import { getApiBaseUrl } from '../services/api';

interface ShareEntity {
  id: string; type: string; name: string; description: string;
  significance?: string | null; aliases?: string[];
}
interface SharePayload {
  project: { title: string; genre?: string | null; logline?: string | null; premise?: string | null };
  entities: ShareEntity[];
}

const TYPE_META: Record<string, { label: string; icon: typeof Users; pigment: string }> = {
  character: { label: 'Персонажи', icon: Users,  pigment: '#A14F44' },
  location:  { label: 'Локации',   icon: MapPin, pigment: '#4D6B4D' },
  item:      { label: 'Предметы',  icon: Box,    pigment: '#91682E' },
  rule:      { label: 'Правила',   icon: Globe,  pigment: '#54627F' },
};
const TYPE_ORDER = ['character', 'location', 'item', 'rule'];
const SIG_LABEL: Record<string, string> = { major: 'главный', moderate: 'второстепенный' };

export default function SharedBible() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<SharePayload | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'notfound' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    fetch(`${getApiBaseUrl()}/share/public/${token}`)
      .then(async r => {
        if (!alive) return;
        if (r.status === 404) { setState('notfound'); return; }
        if (!r.ok) { setState('error'); return; }
        setData(await r.json()); setState('ok');
      })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [token]);

  if (state === 'loading') {
    return <Centered><div className="w-8 h-8 border-2 border-[#1e2d1f]/20 border-t-[#1e2d1f] rounded-full animate-spin" /></Centered>;
  }
  if (state === 'notfound') {
    return <Centered>
      <Lock size={32} className="text-[#1e2d1f]/25 mb-3" />
      <h1 className="font-serif text-xl text-[#1e2d1f] mb-1">Ссылка недоступна</h1>
      <p className="text-sm text-[#1e2d1f]/55">Автор закрыл доступ или ссылка неверна.</p>
    </Centered>;
  }
  if (state === 'error' || !data) {
    return <Centered><p className="text-sm text-[#1e2d1f]/55">Не удалось загрузить. Попробуйте позже.</p></Centered>;
  }

  const { project, entities } = data;
  const grouped = TYPE_ORDER
    .map(t => [t, entities.filter(e => e.type === t)] as const)
    .filter(([, list]) => list.length > 0);
  const sigRank = (e: ShareEntity) => (e.significance === 'major' ? 0 : e.significance === 'moderate' ? 1 : 2);

  return (
    <div className="min-h-screen bg-[#f5f0e8] text-[#1e2d1f]">
      <div className="max-w-3xl mx-auto px-5 py-10">
        {/* Шапка — замысел книги */}
        <header className="mb-8 pb-6 border-b border-[#1e2d1f]/10">
          <div className="flex items-center gap-1.5 text-[#A14F44] mb-3 text-[12px] font-medium">
            <Feather size={14} /> Перо · библия книги
          </div>
          <h1 className="font-serif text-3xl leading-tight mb-2">{project.title}</h1>
          {project.genre && <div className="text-[12px] uppercase tracking-wider text-[#1e2d1f]/40 mb-3">{project.genre}</div>}
          {project.logline && <p className="text-[15px] italic text-[#1e2d1f]/80 mb-3">{project.logline}</p>}
          {project.premise && <p className="text-[13.5px] leading-relaxed text-[#1e2d1f]/65 whitespace-pre-wrap">{project.premise}</p>}
        </header>

        {grouped.length === 0 && (
          <p className="text-sm text-[#1e2d1f]/50">В этой библии пока нет записей.</p>
        )}

        {grouped.map(([type, list]) => {
          const meta = TYPE_META[type] ?? { label: type, icon: Box, pigment: '#54627F' };
          const Icon = meta.icon;
          const sorted = [...list].sort((a, b) => sigRank(a) - sigRank(b) || a.name.localeCompare(b.name, 'ru'));
          return (
            <section key={type} className="mb-9">
              <div className="flex items-center gap-2 mb-3">
                <Icon size={16} style={{ color: meta.pigment }} />
                <h2 className="font-sans text-sm font-semibold uppercase tracking-wider text-[#1e2d1f]/70">{meta.label}</h2>
                <span className="text-[11px] text-[#1e2d1f]/35">{sorted.length}</span>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {sorted.map(e => (
                  <div key={e.id} className="bg-white rounded-xl p-3.5 border border-[#1e2d1f]/5">
                    <div className="flex items-baseline gap-2 mb-1">
                      <h3 className="font-medium text-[14px] min-w-0 flex-1">{e.name}</h3>
                      {SIG_LABEL[e.significance ?? ''] && (
                        <span className="text-[9px] font-semibold uppercase tracking-wide text-[#1e2d1f]/35 flex-shrink-0">{SIG_LABEL[e.significance!]}</span>
                      )}
                    </div>
                    {e.aliases && e.aliases.length > 0 && (
                      <div className="text-[11px] text-[#1e2d1f]/40 mb-1">также: {e.aliases.join(', ')}</div>
                    )}
                    {e.description && <p className="text-[12.5px] leading-relaxed text-[#1e2d1f]/70">{e.description}</p>}
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        <footer className="mt-10 pt-5 border-t border-[#1e2d1f]/10 text-center text-[11px] text-[#1e2d1f]/40">
          Создано в <span className="text-[#A14F44]">Перо</span> — студии письма для авторов
        </footer>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f0e8] flex flex-col items-center justify-center text-center px-6">
      {children}
    </div>
  );
}
