/**
 * DemoReplay — публичное демо «посмотрите, как Перо читает книгу» БЕЗ регистрации и БЕЗ живых
 * AI-вызовов. Проигрывает записанный образец (src/data/demoSample.json — снимок реальной фикстуры):
 * timed-reveal ленты находок → Карта мира → пойманные нестыковки → мягкий CTA. Ноль токенов.
 * Отличие от /demo (Demo.tsx): тот извлекает живьём по загруженной рукописи (1 AI-вызов).
 */
import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Users, MapPin, Box, Globe, AlertTriangle, ArrowRight, BookOpen, Play } from 'lucide-react';
import { PeroLogo, PeroMark } from '../components/Logo';
import demo from '../data/demoSample.json';

type EntityType = 'character' | 'location' | 'item' | 'rule';
const TYPE_META: Record<EntityType, { icon: typeof Users; plural: string; cls: string; dot: string }> = {
  character: { icon: Users,  plural: 'Персонажи', cls: 'bg-[#F1DFDA] text-[#9E4338]', dot: '#9E4338' },
  location:  { icon: MapPin, plural: 'Локации',   cls: 'bg-[#E5EBE0] text-[#4D6B4D]', dot: '#4D6B4D' },
  item:      { icon: Box,    plural: 'Предметы',  cls: 'bg-[#F2E9D8] text-[#91682E]', dot: '#91682E' },
  rule:      { icon: Globe,  plural: 'Правила',   cls: 'bg-[#E6E8EC] text-[#54627F]', dot: '#54627F' },
};
const SEV: Record<string, { label: string; cls: string }> = {
  high:   { label: 'высокая',  cls: 'text-[#9E4338]' },
  medium: { label: 'средняя',  cls: 'text-[#91682E]' },
  low:    { label: 'низкая',   cls: 'text-[#54627F]' },
};

interface Reveal { type: string; name: string; description: string; significance: string | null; firstChapter: number | null }

export default function DemoReplay() {
  const [phase, setPhase] = useState<'intro' | 'reading' | 'map'>('intro');
  const [shown, setShown] = useState(0); // сколько находок ленты раскрыто
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reveal = demo.reveal as Reveal[];

  useEffect(() => {
    if (phase !== 'reading') return;
    timer.current = setInterval(() => {
      setShown(s => {
        if (s >= reveal.length) { if (timer.current) clearInterval(timer.current); setTimeout(() => setPhase('map'), 700); return s; }
        return s + 1;
      });
    }, 480);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [phase, reveal.length]);

  const lastChapter = shown > 0 ? reveal[Math.min(shown, reveal.length) - 1].firstChapter ?? 0 : 0;

  return (
    <div className="min-h-screen bg-[#f5f0e8] text-[#1e2d1f]">
      {/* Шапка */}
      <header className="border-b border-[#1e2d1f]/8">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/"><PeroLogo className="h-7" /></Link>
          <Link to="/login" className="text-sm font-medium text-[#1e2d1f]/70 hover:text-[#1e2d1f]">Войти</Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        {/* Интро */}
        {phase === 'intro' && (
          <div className="text-center max-w-2xl mx-auto pt-10">
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#A14F44] bg-[#E7EAE3] px-3 py-1.5 rounded-full mb-6">
              <PeroMark size={13} /> Демо · без регистрации
            </span>
            <h1 className="font-serif text-4xl md:text-5xl font-semibold leading-tight mb-5">
              Посмотрите, как Перо читает книгу
            </h1>
            <p className="text-[16px] text-[#1e2d1f]/65 leading-relaxed mb-2">
              На примере романа <b>«{demo.title}»</b> ({demo.stats.chapters} глав). Перо прочитает его
              главу за главой и само соберёт мир — персонажей, локации, правила — и поймает противоречия.
            </p>
            <p className="text-[13px] text-[#1e2d1f]/45 mb-8">Это запись на реальной книге. Вашу — Перо прочитает так же.</p>
            <button onClick={() => setPhase('reading')}
              className="inline-flex items-center gap-2.5 bg-[#1e2d1f] text-[#f5f0e8] px-8 py-4 rounded-2xl text-lg font-medium hover:bg-[#1e2d1f]/85 transition-colors">
              <Play size={18} /> Запустить чтение
            </button>
          </div>
        )}

        {/* Чтение — timed reveal */}
        {phase === 'reading' && (
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-7 h-7 border-2 border-[#A14F44]/30 border-t-[#A14F44] rounded-full animate-spin" />
              <div>
                <p className="font-serif text-xl">Перо читает «{demo.title}»…</p>
                <p className="text-[13px] text-[#1e2d1f]/50">Глава {lastChapter} из {demo.stats.chapters} · находок: {shown}</p>
              </div>
            </div>
            <div className="h-1 bg-[#1e2d1f]/8 rounded-full overflow-hidden mb-6">
              <div className="h-full bg-[#A14F44] transition-all duration-500" style={{ width: `${(shown / reveal.length) * 100}%` }} />
            </div>
            <div className="space-y-2.5">
              {reveal.slice(0, shown).map((e, i) => {
                const m = TYPE_META[e.type as EntityType] ?? TYPE_META.rule;
                return (
                  <div key={`${e.name}-${i}`} className="bg-white rounded-xl border border-[#1e2d1f]/6 p-3.5 flex items-start gap-3"
                    style={{ animation: 'demoIn 0.35s ease-out' }}>
                    <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded-md shrink-0 ${m.cls}`}>{e.type === 'character' ? 'Персонаж' : e.type === 'location' ? 'Локация' : e.type === 'item' ? 'Предмет' : 'Правило'}</span>
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <h3 className="font-medium text-[15px]">{e.name}</h3>
                        <span className="text-[10px] text-[#1e2d1f]/35">гл. {e.firstChapter}</span>
                      </div>
                      <p className="text-[12.5px] text-[#1e2d1f]/65 leading-snug">{e.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Карта мира + нестыковки */}
        {phase === 'map' && (
          <div className="animate-[demoIn_0.4s_ease-out]">
            <div className="text-center max-w-2xl mx-auto mb-9">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#4D6B4D] mb-3"><BookOpen size={14} /> Готово · мир собран</span>
              <h2 className="font-serif text-3xl md:text-4xl font-semibold mb-3">Мир книги «{demo.title}»</h2>
              <p className="text-[14px] text-[#1e2d1f]/55">Перо прочитало {demo.stats.chapters} глав и собрало это само — без ручного ввода.</p>
            </div>

            {/* Счётчики */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10 max-w-3xl mx-auto">
              {(['character', 'location', 'item', 'rule'] as EntityType[]).map(t => {
                const m = TYPE_META[t]; const Icon = m.icon;
                return (
                  <div key={t} className="bg-white rounded-2xl border border-[#1e2d1f]/6 p-4 text-center">
                    <Icon size={18} className="mx-auto mb-2" style={{ color: m.dot }} />
                    <div className="font-serif text-3xl font-semibold">{(demo.stats as Record<string, number>)[t]}</div>
                    <div className="text-[12px] text-[#1e2d1f]/50">{m.plural}</div>
                  </div>
                );
              })}
            </div>

            {/* Топ-сущности по типам */}
            {(['character', 'location', 'item', 'rule'] as EntityType[]).map(t => {
              const list = (demo.world as Record<string, Reveal[]>)[t === 'character' ? 'characters' : t === 'location' ? 'locations' : t === 'item' ? 'items' : 'rules'] ?? [];
              if (!list.length) return null;
              const m = TYPE_META[t]; const Icon = m.icon;
              return (
                <section key={t} className="mb-8 max-w-3xl mx-auto">
                  <div className="flex items-center gap-2 mb-3"><Icon size={15} style={{ color: m.dot }} /><h3 className="text-sm font-semibold uppercase tracking-wider text-[#1e2d1f]/70">{m.plural}</h3></div>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {list.slice(0, 6).map(e => (
                      <div key={e.name} className="bg-white rounded-xl border border-[#1e2d1f]/5 p-3.5">
                        <div className="flex items-baseline gap-2 mb-1">
                          <h4 className="font-medium text-[14px]">{e.name}</h4>
                          {e.significance === 'major' && <span className="text-[9px] font-semibold uppercase text-[#1e2d1f]/35">главный</span>}
                        </div>
                        <p className="text-[12.5px] text-[#1e2d1f]/65 leading-relaxed">{e.description}</p>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}

            {/* Пойманные нестыковки — ров */}
            <section className="max-w-3xl mx-auto mb-12">
              <div className="flex items-center gap-2 mb-3"><AlertTriangle size={15} className="text-[#9E4338]" /><h3 className="text-sm font-semibold uppercase tracking-wider text-[#1e2d1f]/70">Перо поймало противоречия</h3></div>
              <div className="space-y-2.5">
                {demo.contradictions.map((c, i) => (
                  <div key={i} className="bg-white rounded-xl border-l-2 border-[#9E4338]/70 border-y border-r border-[#1e2d1f]/5 p-4">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="font-semibold text-[14px] text-[#9E4338]">{c.entity}</span>
                      <span className={`text-[10px] uppercase font-semibold ${SEV[c.severity]?.cls ?? ''}`}>{SEV[c.severity]?.label}</span>
                    </div>
                    <p className="text-[13px] text-[#1e2d1f]/75 mb-1">{c.issue}</p>
                    <p className="text-[12px] text-[#1e2d1f]/45">Канон: {c.canon}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* CTA */}
            <div className="text-center bg-[#1e2d1f] text-[#f5f0e8] rounded-3xl p-10 max-w-3xl mx-auto">
              <h3 className="font-serif text-2xl md:text-3xl font-semibold mb-3">Так Перо прочитает и вашу книгу</h3>
              <p className="text-[#f5f0e8]/70 mb-7 max-w-md mx-auto">Загрузите рукопись — мир соберётся за пару минут. Бесплатно, без карты.</p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link to="/demo" className="inline-flex items-center gap-2 bg-[#f5f0e8] text-[#1e2d1f] px-7 py-3.5 rounded-2xl font-medium hover:bg-white transition-colors">
                  Загрузить свою рукопись <ArrowRight size={18} />
                </Link>
                <button onClick={() => { setShown(0); setPhase('intro'); }} className="text-[#f5f0e8]/70 hover:text-[#f5f0e8] text-sm font-medium px-4 py-3.5">
                  Посмотреть ещё раз
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <style>{`@keyframes demoIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
