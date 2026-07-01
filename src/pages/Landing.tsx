import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  MoveRight, Check, Minus, Upload, BookOpen, Sparkles, Mic,
  ShieldCheck, PlayCircle, AlertTriangle, Feather, ArrowDown,
} from 'lucide-react';
import { PeroMark, PeroLogo } from '../components/Logo';

/**
 * Лендинг — сторителлинг-скролл (сторителлинг сквозь весь верх, минимум марк-прозы).
 * Метафора: продукт ЧИТАЕТ истории → сам лендинг — история одной книги «Пыль дорог»,
 * которую Перо читает у посетителя на глазах. Мир проявляется сам → «Присутствие»
 * заполняется → Перо ловит нестыковку → вы пишете, Перо помнит → теперь ВАША книга.
 * Утилитарные секции (сравнение/цены/сомнения/приватность) сохранены, но ужаты под тон.
 */

const CTA_TO = '/login';
// Загрузка рукописи ведёт в демо без регистрации (не в стену логина)
const DEMO_TO = '/demo';

// ── Сравнение с конкурентами (по публичным данным, июнь 2026) ────────────────
type Cell = 'yes' | 'no' | 'partial';
const COMPARE_ROWS: { label: string; pero: Cell; sudowrite: Cell; mythril: Cell; novelcrafter: Cell; campfire: Cell; note?: string }[] = [
  { label: 'Мир строится сам из готовой рукописи', pero: 'yes', sudowrite: 'partial', mythril: 'yes', novelcrafter: 'no', campfire: 'no', note: 'Sudowrite Import — только 5–7 главных героев; NovelCrafter/Campfire — вручную' },
  { label: 'Понимает русский текст', pero: 'yes', sudowrite: 'partial', mythril: 'partial', novelcrafter: 'partial', campfire: 'partial', note: 'Sudowrite иногда сваливается в английский; русскую морфологию нативно не разбирает никто' },
  { label: 'Редактор и Мир в одном окне', pero: 'yes', sudowrite: 'yes', mythril: 'no', novelcrafter: 'yes', campfire: 'partial', note: 'Mythril — «второй экран» к чужому редактору' },
  { label: 'Соавтор-ИИ, знающий вашу книгу', pero: 'yes', sudowrite: 'yes', mythril: 'no', novelcrafter: 'partial', campfire: 'no' },
  { label: 'Связи и таймлайны персонажей', pero: 'yes', sudowrite: 'partial', mythril: 'yes', novelcrafter: 'no', campfire: 'partial', note: 'У Sudowrite есть таймлайн серии, но нет графа связей' },
  { label: 'Не пишет прозу за вас (аналитик, не генератор)', pero: 'yes', sudowrite: 'no', mythril: 'yes', novelcrafter: 'no', campfire: 'yes', note: 'Перо помнит и проверяет — прозу пишете вы' },
  { label: 'Диктовка с расстановкой знаков', pero: 'yes', sudowrite: 'no', mythril: 'no', novelcrafter: 'no', campfire: 'no' },
  { label: 'Импорт fb2 и epub', pero: 'yes', sudowrite: 'no', mythril: 'no', novelcrafter: 'partial', campfire: 'no' },
  { label: 'Цены в рублях, оплата картой РФ', pero: 'yes', sudowrite: 'no', mythril: 'no', novelcrafter: 'no', campfire: 'no', note: 'Sudowrite — кредитная оплата в долларах' },
  { label: 'Не обучает модели на ваших текстах', pero: 'yes', sudowrite: 'yes', mythril: 'yes', novelcrafter: 'partial', campfire: 'partial' },
];

function CellIcon({ v }: { v: Cell }) {
  if (v === 'yes') return <Check size={16} className="text-[#4D6B4D] mx-auto" strokeWidth={2.5} />;
  if (v === 'partial') return <span className="text-[11px] text-ink/60 font-medium">частично</span>;
  return <Minus size={14} className="text-ink/25 mx-auto" />;
}

// ── Страница рукописи: тёплый лист + serif-проза (левая колонка сторителлинг-битов) ──
function ProsePage({ chapter, children }: { chapter: string; children: React.ReactNode }) {
  return (
    <div data-fx="rise" className="relative bg-[#FBF7EF] rounded-2xl border border-ink/8 shadow-[0_10px_36px_rgba(30,45,31,0.06)] px-7 py-7 overflow-hidden">
      <span className="reading-beam" aria-hidden="true" />
      <p className="text-[10.5px] font-sans font-semibold uppercase tracking-[0.18em] text-ink/40 mb-4 relative">{chapter}</p>
      <div className="font-serif text-[20px] leading-[1.7] text-ink/80 space-y-3 relative">{children}</div>
      {/* курсор чтения Пера */}
      <span className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-sans text-[var(--color-accent)]">
        <Feather size={13} /> Перо читает<span className="inline-block w-[2px] h-[13px] bg-[var(--color-accent)] animate-pulse ml-0.5" />
      </span>
    </div>
  );
}

// Пигменты типов сущностей (как в приложении)
const PIG = { character: '#9E4338', location: '#4D6B4D', item: '#91682E', rule: '#54627F' };

export default function Landing() {
  // Визуальные эффекты по входу в кадр (надёжнее scroll-timeline): добавляем .fx-in.
  // Фолбэк — если IntersectionObserver недоступен, показываем всё сразу (без скрытых блоков).
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-fx]'));
    if (!els.length) return;
    if (!('IntersectionObserver' in window)) { els.forEach(el => el.classList.add('fx-in')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('fx-in'); io.unobserve(e.target); } });
    }, { threshold: 0.15 });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)] flex flex-col font-sans overflow-x-hidden">
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        /* Тренд 2026: scroll-driven reveal (CSS, без JS) — биты «проявляются», пока Перо читает.
           Прогрессивное улучшение: прячем-и-проявляем ТОЛЬКО там, где браузер умеет view-timeline;
           иначе контент просто виден (никаких скрытых блоков). */
        @keyframes revealUp { from { opacity: 0; transform: translateY(26px); } to { opacity: 1; transform: none; } }
        @keyframes growX { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @media (prefers-reduced-motion: no-preference) {
          @supports (animation-timeline: view()) {
            .reveal { animation: revealUp linear both; animation-timeline: view(); animation-range: entry; }
          }
          @supports (animation-timeline: scroll()) {
            .read-progress { transform-origin: left center; animation: growX linear both; animation-timeline: scroll(root block); }
          }
        }

        /* ── Визуальные эффекты (по входу в кадр через IntersectionObserver + бесконечные) ── */
        @media (prefers-reduced-motion: no-preference) {
          /* Перо «сканирует» страницу рукописи — мягкий луч слева направо (бесконечно) */
          .reading-beam { position: absolute; inset: 0; border-radius: 1rem; overflow: hidden; pointer-events: none; }
          .reading-beam::before {
            content: ''; position: absolute; top: -12%; bottom: -12%; width: 42%; left: -46%;
            background: linear-gradient(90deg, transparent, rgba(161,79,68,0.10), transparent);
            transform: skewX(-12deg); animation: beam 4.2s ease-in-out infinite;
          }
          @keyframes beam { 0% { left: -46%; } 58%, 100% { left: 118%; } }

          /* Всплытие карточек/страниц */
          [data-fx="rise"] { opacity: 0; transform: translateY(28px); transition: opacity .6s ease, transform .6s cubic-bezier(.2,.7,.2,1); }
          [data-fx="rise"].fx-in { opacity: 1; transform: none; }
          /* Пружинистый «поп» (нестыковка выскакивает) */
          [data-fx="pop"] { opacity: 0; transform: scale(.82); transition: opacity .45s ease, transform .5s cubic-bezier(.34,1.7,.5,1); }
          [data-fx="pop"].fx-in { opacity: 1; transform: none; }

          /* Сетка «Присутствие»: точки заполняются по очереди (мир строится сам) */
          .pdot { opacity: 0; transform: scale(0); transform-origin: center; }
          .fx-in .pdot { animation: pdotIn .5s cubic-bezier(.34,1.56,.64,1) forwards; animation-delay: calc(var(--i, 0) * 42ms); }
          @keyframes pdotIn { to { opacity: 1; transform: scale(1); } }

          /* Имя «извлекается»: пигмент-подчёркивание прорисовывается слева направо */
          .name-draw { background-image: linear-gradient(currentColor, currentColor); background-repeat: no-repeat; background-position: 0 100%; background-size: 0% 2px; padding-bottom: 1px; transition: background-size .6s ease .25s; }
          .fx-in .name-draw { background-size: 100% 2px; }
        }
      `}</style>

      {/* Тренд 2026: reading-progress вверху — «Перо читает» по мере скролла (CSS scroll-timeline) */}
      <div aria-hidden="true" className="read-progress fixed top-0 left-0 right-0 h-[2px] bg-[var(--color-accent)] z-50 origin-left scale-x-0" />

      {/* Тренд 2026: тактильная текстура «ручной бумаги» — тонкое зерно поверх пергамента */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.04] mix-blend-multiply"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")` }}
      />

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-6 lg:px-12 py-5 border-b border-ink/8 sticky top-0 bg-[var(--color-paper)]/90 backdrop-blur-md z-40">
        <span className="text-ink"><PeroLogo size={24} /></span>
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium">
          <a href="#story" className="hover:text-[var(--color-accent)] transition-colors">Как это работает</a>
          <a href="#compare" className="hover:text-[var(--color-accent)] transition-colors">Сравнение</a>
          <a href="#pricing" className="hover:text-[var(--color-accent)] transition-colors">Цены</a>
          <Link to={CTA_TO} className="hover:text-[var(--color-accent)] transition-colors">Войти</Link>
        </nav>
        <Link to={DEMO_TO} className="bg-ink text-[#f5f0e8] px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-ink/85 transition-colors">
          Загрузить рукопись
        </Link>
      </header>

      <main className="flex-1">

        {/* ══ ОТКРЫТИЕ — сразу раскрываем замысел: рукопись → Перо само собирает Мир → ловит нестыковки ══ */}
        <section className="max-w-6xl mx-auto px-6 pt-20 lg:pt-24 pb-24 grid lg:grid-cols-[1.05fr_0.95fr] gap-14 items-center">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#E7EAE3] text-[var(--color-accent)] mb-7">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
              Закрытая бета · для авторов романов и серий
            </span>
            <h1 className="font-serif text-[3.25rem] md:text-6xl lg:text-[70px] font-semibold leading-[1.02] tracking-[-0.02em] mb-6">
              Перо читает ваш роман — и само собирает его&nbsp;Мир
            </h1>
            <p className="text-lg text-ink/65 leading-relaxed max-w-lg mb-9">
              Персонажи, места, связи, таймлайны — Перо достаёт их прямо из вашей прозы,
              складывает в живой Мир и ловит противоречия. Прозу пишете вы.
            </p>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <Link to={DEMO_TO} className="flex items-center gap-2.5 bg-ink text-[#f5f0e8] px-8 py-4 rounded-2xl text-lg font-medium hover:bg-ink/85 transition-colors">
                Загрузить рукопись <MoveRight size={20} />
              </Link>
              <Link to="/demo/sample" className="flex items-center gap-2.5 px-7 py-4 rounded-2xl border border-ink/20 text-lg font-medium text-ink/80 hover:border-ink/40 hover:text-ink transition-colors">
                <PlayCircle size={20} /> Смотреть на примере
              </Link>
            </div>
            <p className="text-[13px] text-ink/55 mt-4">Без карты · docx, fb2, epub, pdf, txt · Тексты не идут на обучение моделей</p>
          </div>

          {/* Визуал-трансформация: рукопись → Перо читает → карточка Мира + нестыковка (замысел в одном взгляде) */}
          <div className="relative select-none" aria-hidden="true">
            {/* ВХОД — страница рукописи (Перо «сканирует» лучом, имена прорисовываются) */}
            <div data-fx="rise" className="relative bg-[#FBF7EF] rounded-2xl border border-ink/8 shadow-[0_10px_36px_rgba(30,45,31,0.06)] px-6 py-5 rotate-[-1.2deg] z-10 overflow-hidden">
              <span className="reading-beam" aria-hidden="true" />
              <p className="relative text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/40 mb-2.5">Ваша рукопись · глава 2</p>
              <p className="relative font-serif text-[17px] leading-[1.6] text-ink/80">
                Над костром булькал <span className="name-draw" style={{ color: PIG.item }}>отвар забвения</span>. <span className="name-draw" style={{ color: PIG.character }}>Весна</span> помешивала травы короткими движениями.
              </p>
            </div>

            {/* связка */}
            <div className="flex items-center justify-center gap-2 py-2 text-[13px] font-medium text-[var(--color-accent)]">
              <Feather size={14} /> Перо читает <ArrowDown size={14} />
            </div>

            {/* ВЫХОД — карточка Мира */}
            <div data-fx="rise" style={{ transitionDelay: '0.22s' }} className="relative bg-white rounded-2xl border border-ink/8 shadow-[0_18px_50px_rgba(30,45,31,0.12)] px-6 py-5 rotate-[0.8deg]">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[9px] font-bold tracking-widest px-2 py-0.5 rounded-md" style={{ background: '#F1DFDA', color: PIG.character }}>ПЕРСОНАЖ</span>
                <span className="text-[9px] font-semibold px-2 py-0.5 rounded-md bg-[#EBE4EE] text-[#71597F]">Ключевой</span>
              </div>
              <h3 className="font-serif text-2xl font-semibold mb-0.5">Весна</h3>
              <p className="text-[11px] text-ink/55 mb-3">Впервые: глава 1 · собрано Пером</p>
              <div className="space-y-1.5 text-[12.5px]">
                <div className="flex gap-3"><span className="text-ink/50 w-16 shrink-0 font-semibold text-[10.5px] pt-0.5 uppercase tracking-wider">Речь</span><span className="text-ink/75">короткие фразы, степные присловья</span></div>
                <div className="flex gap-3"><span className="text-ink/50 w-16 shrink-0 font-semibold text-[10.5px] pt-0.5 uppercase tracking-wider">Секрет</span><span className="text-ink/75">варит отвар забвения — дар бабки</span></div>
              </div>
              <div className="mt-3 pt-3 border-t border-ink/6 flex items-center gap-2.5">
                <span className="text-[9.5px] uppercase tracking-widest text-ink/45 shrink-0">В главах</span>
                <div className="flex gap-1">
                  {[1,1,1,1,1,1,1,1].map((_, i) => (
                    <span key={i} className="pdot w-2 h-2 rounded-full" style={{ background: PIG.character, ['--i' as string]: String(i + 4) }} />
                  ))}
                </div>
              </div>
            </div>

            {/* НЕСТЫКОВКА — «выскакивает» последней (обёртка держит наклон, чтобы pop не съел transform) */}
            <div className="absolute -bottom-6 -left-2 lg:-left-6 max-w-[250px] -rotate-[1.5deg]">
              <div data-fx="pop" style={{ transitionDelay: '0.55s' }} className="bg-white rounded-xl border border-[#9E4338]/60 shadow-[0_12px_36px_rgba(158,67,56,0.14)] px-4 py-3">
                <div className="flex items-center gap-1.5 mb-1 text-[#9E4338]">
                  <AlertTriangle size={13} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Противоречие</span>
                </div>
                <p className="text-[12.5px] text-ink/70 leading-snug">Гл. 3 глаза зелёные, гл. 12 — серые.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ══ БИТ 1 — Мир проявляется сам ══ */}
        <section id="story" className="border-y border-ink/8 bg-white/50">
          <div className="max-w-5xl mx-auto px-6 py-20">
            <h2 className="font-serif text-3xl md:text-[40px] font-semibold mb-3 leading-tight">Перо читает — и мир проявляется сам</h2>
            <p className="text-ink/55 mb-12 max-w-xl">Вы не заводите ни одной карточки. Перо вытаскивает героев, места и предметы прямо из вашей прозы.</p>

            <div className="grid lg:grid-cols-[1fr_1fr] gap-8 items-center">
              <ProsePage chapter="Глава 2 · У костра">
                <p>Над костром тихо булькал <span className="text-[#91682E]">отвар забвения</span> — последний дар бабки. <span className="text-[#9E4338]">Весна</span> помешивала травы короткими, злыми движениями.</p>
                <p>— Не пей, — сказал <span className="text-[#9E4338]">Корней</span>. Но она уже подносила ковш к губам.</p>
              </ProsePage>

              {/* Карточки, «извлечённые» Пером */}
              <div className="space-y-3">
                {[
                  { type: 'character', chip: 'Персонаж', name: 'Весна', line: 'Речь — короткие фразы. Секрет: варит отвар забвения.' },
                  { type: 'item', chip: 'Предмет', name: 'Отвар забвения', line: 'Последний дар бабки. Впервые: глава 2.' },
                  { type: 'character', chip: 'Персонаж', name: 'Корней', line: 'Вынужденный союзник Весны.' },
                ].map((c, i) => (
                  <div
                    key={c.name}
                    data-fx="rise"
                    style={{ transitionDelay: `${i * 0.13}s` }}
                    className="bg-white rounded-2xl border border-ink/8 shadow-[0_8px_28px_rgba(30,45,31,0.06)] px-5 py-4"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: PIG[c.type as keyof typeof PIG] }} />
                      <span className="text-[9.5px] font-bold uppercase tracking-widest" style={{ color: PIG[c.type as keyof typeof PIG] }}>{c.chip}</span>
                    </div>
                    <h3 className="font-serif text-xl font-semibold mb-0.5">{c.name}</h3>
                    <p className="text-[13px] text-ink/60 leading-snug">{c.line}</p>
                  </div>
                ))}
                <p className="text-[13px] text-ink/50 pt-1 flex items-center gap-2">
                  <Feather size={14} className="text-[var(--color-accent)]" /> Три карточки. Ноль ручной работы.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ══ БИТ 2 — Мир оживает: «Присутствие» ══ */}
        <section className="max-w-5xl mx-auto px-6 py-20 grid lg:grid-cols-[0.85fr_1.15fr] gap-12 items-center">
          <div>
            <h2 className="font-serif text-3xl md:text-[40px] font-semibold mb-4 leading-tight">Восьмая глава.<br />Перо помнит всех.</h2>
            <p className="text-ink/60 leading-relaxed mb-6">
              Мир — не список, а живые линзы над вашей прозой. «Присутствие» показывает, кто в какой главе —
              и делает видимым то, что легко упустить.
            </p>
            <ul className="space-y-3 text-[15px]">
              <li className="flex gap-2.5"><Check size={18} className="text-[#4D6B4D] shrink-0 mt-0.5" strokeWidth={2.5} /><span><b className="font-semibold">Ружьё Чехова.</b> <span className="text-ink/60">Отвар мелькнул в гл. 4 и выстрелил в гл. 7.</span></span></li>
              <li className="flex gap-2.5"><Check size={18} className="text-[#4D6B4D] shrink-0 mt-0.5" strokeWidth={2.5} /><span><b className="font-semibold">Провисание.</b> <span className="text-ink/60">Степь пропадает в гл. 6–7 — сразу заметно.</span></span></li>
              <li className="flex gap-2.5"><Check size={18} className="text-[#4D6B4D] shrink-0 mt-0.5" strokeWidth={2.5} /><span><b className="font-semibold">Клик — и вы в тексте.</b> <span className="text-ink/60">Строка ведёт прямо в сцену.</span></span></li>
            </ul>
          </div>

          {/* Мок линзы «Присутствие» — точки заполняются по очереди при входе в кадр */}
          <div data-fx="rise" className="bg-white rounded-3xl border border-ink/8 shadow-[0_16px_50px_rgba(30,45,31,0.09)] p-6 select-none" aria-hidden="true">
            <div className="flex items-center gap-2 mb-5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-ink/55">Линза «Присутствие»</span>
              <span className="text-[10px] text-ink/40">кто в какой главе</span>
            </div>
            {(() => {
              const CH = 8;
              const ROWS = [
                { name: 'Весна',          pig: PIG.character, cells: [1,1,1,1,1,1,1,1] },
                { name: 'Корней',         pig: PIG.character, cells: [0,1,1,1,0,0,1,1] },
                { name: 'Степь',          pig: PIG.location,  cells: [1,0,1,1,1,0,0,1] },
                { name: 'Отвар забвения', pig: PIG.item,      cells: [0,0,0,1,0,0,1,1] },
              ];
              return (
                <div className="grid gap-y-2.5" style={{ gridTemplateColumns: `120px repeat(${CH}, minmax(0,1fr))` }}>
                  <span />
                  {Array.from({ length: CH }, (_, i) => (
                    <span key={i} className="text-[10px] text-ink/40 text-center tabular-nums">{i + 1}</span>
                  ))}
                  {ROWS.map((r, ri) => (
                    <div key={r.name} className="contents">
                      <span className="flex items-center gap-1.5 text-[12.5px] text-ink/75 truncate pr-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.pig }} />
                        {r.name}
                      </span>
                      {r.cells.map((on, i) => (
                        <span key={i} className="flex justify-center">
                          <span
                            className="pdot w-2.5 h-2.5 rounded-full"
                            style={{ background: on ? r.pig : 'transparent', border: on ? 'none' : '1.5px solid rgba(30,45,31,0.12)', ['--i' as string]: String(ri * CH + i) }}
                          />
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </section>

        {/* ══ БИТ 3 — Перо ловит то, что пропустили вы (пик) ══ */}
        <section className="border-y border-ink/8 bg-white/50">
          <div className="max-w-5xl mx-auto px-6 py-20 grid lg:grid-cols-[1fr_1fr] gap-10 items-center">
            <div className="space-y-4">
              <ProsePage chapter="Глава 3">
                <p>Её <span className="underline decoration-[#4D6B4D]/50 decoration-2 underline-offset-4">зелёные</span> глаза сузились, поймав отблеск костра.</p>
              </ProsePage>
              <ProsePage chapter="Глава 12 · 40 000 слов спустя">
                <p><span className="underline decoration-wavy decoration-[#9E4338] decoration-2 underline-offset-4">Серые</span> глаза Весны потемнели от гнева.</p>
              </ProsePage>
            </div>

            <div>
              <div data-fx="pop" className="bg-white rounded-2xl border border-[#9E4338]/60 shadow-[0_12px_40px_rgba(158,67,56,0.12)] px-6 py-5 mb-6">
                <div className="flex items-center gap-2 mb-2 text-[#9E4338]">
                  <AlertTriangle size={17} />
                  <span className="text-[11px] font-bold uppercase tracking-widest">Противоречие</span>
                </div>
                <p className="text-[15px] text-ink/80 leading-relaxed">
                  В главе 3 глаза Весны <b>зелёные</b>, в главе 12 — <b>серые</b>.
                </p>
                <p className="text-[12.5px] text-ink/50 mt-2">Перо · с цитатой и номером главы</p>
              </div>
              <h2 className="font-serif text-3xl md:text-[38px] font-semibold leading-tight mb-3">
                Читатель нашёл бы это в комментариях.
              </h2>
              <p className="text-ink/60 leading-relaxed">
                Перо находит раньше — сверяет каждую новую главу со всем, что вы уже написали.
                Сорок тысяч слов между сценами для него не помеха.
              </p>
            </div>
          </div>
        </section>

        {/* ══ БИТ 4 — Вы пишете, Перо помнит (не генератор) ══ */}
        <section className="max-w-4xl mx-auto px-6 py-20 text-center">
          <Feather size={30} className="text-[var(--color-accent)] mx-auto mb-6" />
          <p className="font-serif text-3xl md:text-[40px] font-semibold leading-snug mb-5">
            Перо не пишет за вас ни строчки.<br />Оно помнит каждую, что написали вы.
          </p>
          <p className="text-ink/60 leading-relaxed max-w-xl mx-auto">
            Sudowrite и подобные генерируют текст вместо автора. Перо устроено наоборот:
            вы пишете — оно читает, помнит ваш мир и охраняет ваш стиль. Серьёзному автору
            нужна не замена, а память.
          </p>
        </section>

        {/* ══ ПОВОРОТ — теперь ваша книга ══ */}
        <section className="border-y border-ink/8 bg-ink text-[#f5f0e8]">
          <div className="max-w-4xl mx-auto px-6 py-20 text-center">
            <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#9DB5A1] mb-5">Это была чужая книга</p>
            <h2 className="font-serif text-4xl md:text-5xl font-semibold leading-tight mb-6">
              Вашу — Перо прочитает так&nbsp;же
            </h2>
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-[15px] text-[#f5f0e8]/70 mb-9">
              <span>2 минуты до карты мира</span>
              <span className="opacity-40">·</span>
              <span>романы от 100 000 слов</span>
              <span className="opacity-40">·</span>
              <span>docx · fb2 · epub · pdf · txt</span>
            </div>
            <Link to={DEMO_TO} className="inline-flex items-center gap-2.5 bg-[#f5f0e8] text-ink px-9 py-4 rounded-2xl text-lg font-semibold hover:bg-white transition-colors">
              Загрузить свою рукопись <MoveRight size={20} />
            </Link>
          </div>
        </section>

        {/* ── Как это работает (тонкая перестраховка после истории) ── */}
        <section className="max-w-5xl mx-auto px-6 py-16">
          <ol className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { n: '1', icon: Upload, t: 'Загрузите', d: 'docx, fb2, epub, pdf, txt — главу или всю серию.' },
              { n: '2', icon: BookOpen, t: 'Перо читает', d: 'Герои, места, предметы, связи — сами из текста.' },
              { n: '3', icon: Check, t: 'Одобряете', d: 'ИИ предлагает — решаете вы. Ничего без вашего «да».' },
              { n: '4', icon: Sparkles, t: 'Пишете дальше', d: 'Перо дополняет мир и ловит противоречия.' },
            ].map(s => (
              <li key={s.n}>
                <div className="flex items-center gap-2.5 mb-2.5">
                  <span className="font-serif text-3xl font-semibold text-[var(--color-accent)]">{s.n}</span>
                  <s.icon size={17} className="text-ink/55" />
                </div>
                <h3 className="font-semibold text-[15px] mb-1">{s.t}</h3>
                <p className="text-[13.5px] text-ink/55 leading-relaxed">{s.d}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Сравнение ── */}
        <section id="compare" className="border-y border-ink/8 bg-white/50">
          <div className="max-w-5xl mx-auto px-6 py-20">
            <h2 className="font-serif text-3xl md:text-4xl font-semibold mb-3">Честное сравнение</h2>
            <p className="text-ink/55 mb-10 max-w-2xl">Инструменты для писателей есть. Для русскоязычного автора с готовой рукописью — выбор короткий.</p>
            <div className="overflow-x-auto -mx-6 px-6" style={{ scrollbarWidth: 'none' }}>
              <table className="w-full min-w-[760px] text-sm border-separate" style={{ borderSpacing: 0 }}>
                <thead>
                  <tr className="text-left">
                    <th className="pb-4 pr-4 font-medium text-ink/60 text-[13px] w-[30%]"></th>
                    <th className="pb-4 px-3 text-center"><span className="inline-flex items-center gap-1.5 font-serif text-lg font-semibold"><PeroMark size={16} />Перо</span></th>
                    <th className="pb-4 px-3 text-center font-medium text-ink/55">Sudowrite</th>
                    <th className="pb-4 px-3 text-center font-medium text-ink/55">Mythril</th>
                    <th className="pb-4 px-3 text-center font-medium text-ink/55">NovelCrafter</th>
                    <th className="pb-4 px-3 text-center font-medium text-ink/55">Campfire</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map((r, i) => (
                    <tr key={r.label} className={i % 2 === 0 ? 'bg-white/70' : ''}>
                      <td className="py-3 pr-4 pl-3 text-ink/75 rounded-l-xl" title={r.note}>{r.label}</td>
                      <td className="py-3 px-3 text-center bg-[#E7EAE3]/60"><CellIcon v={r.pero} /></td>
                      <td className="py-3 px-3 text-center"><CellIcon v={r.sudowrite} /></td>
                      <td className="py-3 px-3 text-center"><CellIcon v={r.mythril} /></td>
                      <td className="py-3 px-3 text-center"><CellIcon v={r.novelcrafter} /></td>
                      <td className="py-3 px-3 text-center rounded-r-xl"><CellIcon v={r.campfire} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11.5px] text-ink/55 mt-4">По публичным данным продуктов, июнь 2026. «Частично» — функция есть, но ограничена или требует ручной работы.</p>
          </div>
        </section>

        {/* ── Цены ── */}
        <section id="pricing" className="max-w-4xl mx-auto px-6 py-20">
          <h2 className="font-serif text-3xl md:text-4xl font-semibold mb-3 text-center">Начните бесплатно — на своей рукописи</h2>
          <p className="text-ink/55 mb-12 text-center">Полный цикл «импорт → Мир → проверка» доступен без оплаты.</p>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white rounded-3xl border border-ink/8 p-8">
              <h3 className="font-serif text-2xl font-semibold mb-1">Бесплатный</h3>
              <p className="font-serif text-4xl font-semibold mb-6">0 ₽</p>
              <ul className="space-y-2.5 text-[14px] text-ink/70 mb-8">
                {['1 активный проект', 'Авто-Мир до 30 глав', '20 ИИ-действий в день', 'Импорт docx, fb2, epub, pdf, txt', 'Экспорт txt и markdown'].map(f => (
                  <li key={f} className="flex gap-2.5"><Check size={16} className="text-[#4D6B4D] shrink-0 mt-0.5" />{f}</li>
                ))}
              </ul>
              <Link to={DEMO_TO} className="block text-center border border-ink/15 rounded-xl py-3 font-medium hover:bg-[#E8E2D5]/50 transition-colors">Загрузить рукопись</Link>
            </div>
            <div className="bg-ink text-[#f5f0e8] rounded-3xl p-8 shadow-lg relative overflow-hidden">
              <h3 className="font-serif text-2xl font-semibold mb-1">Pro</h3>
              <p className="font-serif text-4xl font-semibold mb-6">599 ₽<span className="text-base font-normal opacity-60"> /мес</span></p>
              <ul className="space-y-2.5 text-[14px] text-[#f5f0e8]/85 mb-8">
                {['Проекты и главы без лимитов', '300 ИИ-действий в день', 'Отчёт противоречий по всей книге', 'Диктовка с ИИ-обработкой', 'Экспорт в docx и zip-бэкап'].map(f => (
                  <li key={f} className="flex gap-2.5"><Check size={16} className="text-[#4D6B4D] shrink-0 mt-0.5" />{f}</li>
                ))}
              </ul>
              <Link to={CTA_TO} className="block text-center bg-[#f5f0e8] text-ink rounded-xl py-3 font-semibold hover:bg-white transition-colors">Попробовать Pro</Link>
              <p className="text-[11.5px] opacity-50 mt-3 text-center">Оплата картой РФ через ЮKassa · без автопродления</p>
            </div>
          </div>
        </section>

        {/* ── Частые сомнения (ужато до 4) ── */}
        <section className="max-w-3xl mx-auto px-6 pb-4">
          <h2 className="font-serif text-3xl md:text-4xl font-semibold mb-8">Частые сомнения</h2>
          <div className="divide-y divide-ink/8">
            {[
              { q: 'ИИ украдёт мой стиль?', a: 'Перо не пишет за вас — оно читает написанное и помнит. Стиль остаётся вашим.' },
              { q: 'Тексты уйдут на обучение?', a: 'Нет. Рукописи не используются для обучения. Все права у автора, удаление — безвозвратное.' },
              { q: 'У меня уже 100 тысяч слов — поздно?', a: 'Наоборот, лучший момент. Импорт за пару минут превратит готовый текст в Мир со связями и таймлайнами.' },
              { q: 'Дорого, и я не плачу в долларах.', a: '599 ₽/мес, российская карта, с чеком. Полный цикл на одном проекте — бесплатно.' },
            ].map(item => (
              <div key={item.q} className="py-5">
                <h3 className="font-serif text-xl font-semibold mb-1.5">{item.q}</h3>
                <p className="text-ink/65 leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Приватность + от автора (ужато) ── */}
        <section className="max-w-5xl mx-auto px-6 py-16">
          <div className="bg-ink text-[#f5f0e8] rounded-3xl px-8 py-9 md:px-12 flex flex-col md:flex-row items-start md:items-center gap-6">
            <ShieldCheck size={34} className="text-[#9DB5A1] shrink-0" />
            <div>
              <h3 className="font-serif text-2xl font-semibold mb-1.5">Ваши тексты — ваши</h3>
              <p className="text-[#f5f0e8]/70 leading-relaxed">
                Рукописи не идут на обучение моделей. Права остаются у автора, удаление — безвозвратное. Перо делает автор — для авторов Author.Today и Litnet, в закрытой бете.{' '}
                <Link to="/privacy" className="underline underline-offset-2 text-[#f5f0e8]/90 hover:text-white transition-colors">Подробнее о приватности</Link>
              </p>
            </div>
          </div>
        </section>

        {/* ══ ФИНАЛ — закрытие истории ══ */}
        <section className="max-w-3xl mx-auto px-6 pt-8 pb-24 text-center">
          <PeroMark size={36} className="text-[var(--color-accent)] mx-auto mb-6" />
          <h2 className="font-serif text-4xl md:text-5xl font-semibold leading-tight mb-5">
            Ваш мир жив, пока о нём помнят.<br />Пусть помнит Перо.
          </h2>
          <p className="text-ink/55 mb-9">Бесплатно, без карты. Через две минуты увидите карту своего мира.</p>
          <Link to={DEMO_TO} className="inline-flex items-center gap-2.5 bg-ink text-[#f5f0e8] px-9 py-4 rounded-2xl text-lg font-medium hover:bg-ink/85 transition-colors">
            Загрузить рукопись <MoveRight size={20} />
          </Link>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-ink/8 py-8">
        <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-ink/55">
          <span className="text-ink/60"><PeroLogo size={16} /></span>
          <span>
            &copy; {new Date().getFullYear()} Перо ·{' '}
            <Link to="/privacy" className="hover:text-ink/70 underline underline-offset-2 transition-colors">Приватность и права на тексты</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
