/**
 * SeriesBible — единый Мир серии (Этап E2). Каталог сущностей через ВСЕ книги серии: одноимённые
 * слиты, видно, в каких книгах встречается герой/локация. Канон-описание — самое полное.
 * Авторская (с входом) страница /series/:seriesId.
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Users, MapPin, Box, Globe, Library, BookOpen } from 'lucide-react';
import { api } from '../services/api';

interface BookRef { projectId: string; title: string | null; order: number | null; entityId: string }
interface SBEntity { type: string; name: string; description: string; significance?: string | null; books: BookRef[] }
interface SBBook { id: string; title: string; order: number | null; snapshotAt?: string | null; snapshotCount?: number }
interface Payload {
  series: { id: string; title: string };
  books: SBBook[];
  entities: SBEntity[];
}

const TYPE_META: Record<string, { label: string; icon: typeof Users; pigment: string }> = {
  character: { label: 'Персонажи', icon: Users,  pigment: '#A14F44' },
  location:  { label: 'Локации',   icon: MapPin, pigment: '#4D6B4D' },
  item:      { label: 'Предметы',  icon: Box,    pigment: '#91682E' },
  rule:      { label: 'Правила',   icon: Globe,  pigment: '#54627F' },
};
const TYPE_ORDER = ['character', 'location', 'item', 'rule'];
const SIG_LABEL: Record<string, string> = { major: 'главный', moderate: 'второстепенный' };
const sigRank = (s?: string | null) => (s === 'major' ? 0 : s === 'moderate' ? 1 : 2);

export default function SeriesBible() {
  const { seriesId } = useParams<{ seriesId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [freezing, setFreezing] = useState<string | null>(null);

  const load = () => api.get<Payload>(`/series/${seriesId}/bible`).then(d => { setData(d); setState('ok'); });
  useEffect(() => {
    let alive = true;
    api.get<Payload>(`/series/${seriesId}/bible`)
      .then(d => { if (alive) { setData(d); setState('ok'); } })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [seriesId]);

  const freeze = async (bookId: string) => {
    setFreezing(bookId);
    try { await api.post(`/series/${seriesId}/books/${bookId}/snapshot`, {}); await load(); }
    finally { setFreezing(null); }
  };

  if (state === 'loading') return <Center><div className="w-8 h-8 border-2 border-[#1e2d1f]/20 border-t-[#1e2d1f] rounded-full animate-spin" /></Center>;
  if (state === 'error' || !data) return <Center><p className="text-sm text-[#1e2d1f]/55">Не удалось загрузить серию.</p></Center>;

  const { series, books, entities } = data;
  const grouped = TYPE_ORDER
    .map(t => [t, entities.filter(e => e.type === t)] as const)
    .filter(([, list]) => list.length > 0);

  return (
    <div className="min-h-screen bg-[#f5f0e8] text-[#1e2d1f]">
      <div className="max-w-3xl mx-auto px-5 py-8">
        <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1 text-[13px] text-[#1e2d1f]/55 hover:text-[#1e2d1f] mb-5">
          <ChevronLeft size={15} /> К полкам
        </button>

        <header className="mb-7 pb-5 border-b border-[#1e2d1f]/10">
          <div className="flex items-center gap-1.5 text-[#A14F44] mb-2 text-[12px] font-medium">
            <Library size={14} /> Серия · единый Мир
          </div>
          <h1 className="font-serif text-3xl leading-tight mb-3">{series.title}</h1>
          <div className="flex flex-col gap-1.5">
            {books.map(b => (
              <div key={b.id} className="flex items-center gap-2 bg-white rounded-lg px-3 py-1.5 border border-[#1e2d1f]/5">
                <BookOpen size={12} className="text-[#1e2d1f]/40 flex-shrink-0" />
                <span className="text-[12.5px] flex-1 min-w-0 truncate">{b.order != null ? `${b.order}. ` : ''}{b.title}</span>
                {b.snapshotAt && (
                  <span className="text-[10.5px] text-[#4D6B4D] flex-shrink-0" title={`Снимок мира: ${new Date(b.snapshotAt).toLocaleString('ru')}`}>
                    ✓ снимок · {b.snapshotCount}
                  </span>
                )}
                <button
                  onClick={() => freeze(b.id)} disabled={freezing === b.id}
                  title="Заморозить состояние мира на конец этой книги — канон для следующей"
                  className="text-[10.5px] font-medium text-[#A14F44]/80 hover:text-[#A14F44] flex-shrink-0 disabled:opacity-50"
                >
                  {freezing === b.id ? 'Фиксирую…' : b.snapshotAt ? 'Обновить' : 'Зафиксировать состояние'}
                </button>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[#1e2d1f]/45 mt-2">Снимок замораживает значимых героев и их финальный статус — следующая книга серии сверяется с ним.</p>
        </header>

        {grouped.length === 0 && <p className="text-sm text-[#1e2d1f]/60">В книгах серии пока нет сущностей.</p>}

        {grouped.map(([type, list]) => {
          const meta = TYPE_META[type] ?? { label: type, icon: Box, pigment: '#54627F' };
          const Icon = meta.icon;
          const sorted = [...list].sort((a, b) => sigRank(a.significance) - sigRank(b.significance) || a.name.localeCompare(b.name, 'ru'));
          return (
            <section key={type} className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <Icon size={16} style={{ color: meta.pigment }} />
                <h2 className="font-sans text-sm font-semibold uppercase tracking-wider text-[#1e2d1f]/70">{meta.label}</h2>
                <span className="text-[11px] text-[#1e2d1f]/35">{sorted.length}</span>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {sorted.map(e => (
                  <div key={`${e.type}-${e.name}`} className="bg-white rounded-xl p-3.5 border border-[#1e2d1f]/5">
                    <div className="flex items-baseline gap-2 mb-1">
                      <h3 className="font-medium text-[14px] min-w-0 flex-1">{e.name}</h3>
                      {SIG_LABEL[e.significance ?? ''] && (
                        <span className="text-[9px] font-semibold uppercase tracking-wide text-[#1e2d1f]/35 flex-shrink-0">{SIG_LABEL[e.significance!]}</span>
                      )}
                    </div>
                    {e.description && <p className="text-[12.5px] leading-relaxed text-[#1e2d1f]/70 mb-1.5">{e.description}</p>}
                    <div className="flex flex-wrap gap-1">
                      {e.books.map(b => (
                        <span key={b.entityId} className="text-[10px] text-[#A14F44]/80 bg-[#A14F44]/8 rounded px-1.5 py-0.5">
                          {b.order != null ? `кн. ${b.order}` : b.title}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#f5f0e8] flex items-center justify-center px-6 text-center">{children}</div>;
}
