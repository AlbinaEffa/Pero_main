import { Link } from 'react-router-dom';
import {
  MoveRight, Check, Minus, Upload, BookOpen, Sparkles, Mic,
  ShieldCheck, Link2, Activity, Clock,
} from 'lucide-react';
import { PeroMark, PeroLogo } from '../components/Logo';

/**
 * Лендинг под позиционирование (PRD P0.7).
 * Один месседж: «Перо само ведёт Мир вашей истории».
 * CTA: «Загрузить рукопись бесплатно». Отстройка: русский язык,
 * библия+редактор+соавтор в одном, локальные цены, приватность.
 */

const CTA_TO = '/login';
// Загрузка рукописи ведёт в демо без регистрации (не в стену логина)
const DEMO_TO = '/demo';

// ── Сравнение с конкурентами (по публичным данным, июнь 2026) ────────────────
type Cell = 'yes' | 'no' | 'partial';
const COMPARE_ROWS: { label: string; pero: Cell; mythril: Cell; novelcrafter: Cell; campfire: Cell; note?: string }[] = [
  { label: 'Мир строится сам из готовой рукописи', pero: 'yes', mythril: 'yes', novelcrafter: 'no', campfire: 'no', note: 'NovelCrafter и Campfire — ручное заполнение' },
  { label: 'Понимает русский текст', pero: 'yes', mythril: 'partial', novelcrafter: 'partial', campfire: 'partial' },
  { label: 'Редактор и Мир в одном окне', pero: 'yes', mythril: 'no', novelcrafter: 'yes', campfire: 'partial', note: 'Mythril — «второй экран» к чужому редактору' },
  { label: 'Соавтор-ИИ, знающий вашу книгу', pero: 'yes', mythril: 'no', novelcrafter: 'partial', campfire: 'no' },
  { label: 'Связи и таймлайны персонажей', pero: 'yes', mythril: 'yes', novelcrafter: 'no', campfire: 'partial' },
  { label: 'Диктовка с расстановкой знаков', pero: 'yes', mythril: 'no', novelcrafter: 'no', campfire: 'no' },
  { label: 'Импорт fb2 и epub', pero: 'yes', mythril: 'no', novelcrafter: 'partial', campfire: 'no' },
  { label: 'Цены в рублях, оплата картой РФ', pero: 'yes', mythril: 'no', novelcrafter: 'no', campfire: 'no' },
  { label: 'Не обучает модели на ваших текстах', pero: 'yes', mythril: 'yes', novelcrafter: 'partial', campfire: 'partial' },
];

function CellIcon({ v }: { v: Cell }) {
  if (v === 'yes') return <Check size={16} className="text-[#4D6B4D] mx-auto" strokeWidth={2.5} />;
  if (v === 'partial') return <span className="text-[11px] text-ink/60 font-medium">частично</span>;
  return <Minus size={14} className="text-ink/25 mx-auto" />;
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)] flex flex-col font-sans">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-6 lg:px-12 py-5 border-b border-ink/8 sticky top-0 bg-[var(--color-paper)]/90 backdrop-blur-md z-40">
        <span className="text-ink"><PeroLogo size={24} /></span>
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium">
          <a href="#how" className="hover:text-[var(--color-accent)] transition-colors">Как работает</a>
          <a href="#compare" className="hover:text-[var(--color-accent)] transition-colors">Сравнение</a>
          <a href="#pricing" className="hover:text-[var(--color-accent)] transition-colors">Цены</a>
          <Link to={CTA_TO} className="hover:text-[var(--color-accent)] transition-colors">Войти</Link>
        </nav>
        <Link to={DEMO_TO} className="bg-ink text-[#f5f0e8] px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-ink/85 transition-colors">
          Загрузить рукопись
        </Link>
      </header>

      <main className="flex-1">

        {/* ── Hero ── */}
        <section className="max-w-6xl mx-auto px-6 pt-20 lg:pt-28 pb-16 grid lg:grid-cols-[1.1fr_0.9fr] gap-14 items-center">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#E7EAE3] text-[var(--color-accent)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
                Закрытая бета
              </span>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent)]">
                Для авторов романов и серий · Author.Today · Litnet
              </p>
            </div>
            <h1 className="font-serif text-5xl md:text-6xl lg:text-[64px] font-semibold leading-[1.05] mb-7">
              Перо само ведёт Мир вашей&nbsp;истории
            </h1>
            <p className="text-lg text-ink/65 leading-relaxed max-w-xl mb-9">
              Какого цвета были глаза героини в первой книге? Не листайте тридцать глав.
              Загрузите рукопись — Перо прочитает её и само построит мир: персонажи, локации,
              связи, таймлайны. Вы пишете дальше — Перо помнит и ловит противоречия.
            </p>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-4">
              <Link to={DEMO_TO} className="flex items-center gap-2.5 bg-ink text-[#f5f0e8] px-8 py-4 rounded-2xl text-lg font-medium hover:bg-ink/85 transition-colors shadow-sm">
                Загрузить рукопись бесплатно
                <MoveRight size={20} />
              </Link>
              <a href="#how" className="flex items-center gap-2 px-6 py-4 text-lg font-medium text-ink/70 hover:text-ink transition-colors">
                Как это работает
              </a>
            </div>
            <p className="text-[13px] text-ink/60">
              Без карты · docx, fb2, epub, pdf, txt · Тексты не используются для обучения моделей
            </p>
          </div>

          {/* Витрина: живая карточка библии */}
          <div className="relative select-none" aria-hidden="true">
            <div className="bg-white rounded-3xl border border-ink/8 shadow-[0_20px_60px_rgba(30,45,31,0.10)] p-7 rotate-[1.2deg]">
              <div className="flex items-center gap-1.5 mb-4">
                <span className="text-[9px] font-bold tracking-widest px-2 py-0.5 rounded-md bg-[#F1DFDA] text-[#9E4338]">ПЕРСОНАЖ</span>
                <span className="text-[9px] font-semibold px-2 py-0.5 rounded-md bg-[#EBE4EE] text-[#71597F]">Ключевой</span>
              </div>
              <h3 className="font-serif text-3xl font-semibold mb-1">Весна</h3>
              <p className="text-[11px] text-ink/55 mb-4">Впервые: Глава 1 · Пыль дорог</p>
              <div className="space-y-2.5 text-[13px]">
                <div className="flex gap-3"><span className="text-ink/55 w-20 shrink-0 font-semibold text-[11px] pt-0.5">Речь</span><span className="text-ink/75">короткие фразы, степные присловья</span></div>
                <div className="flex gap-3"><span className="text-ink/55 w-20 shrink-0 font-semibold text-[11px] pt-0.5">Секрет</span><span className="text-ink/75">варит отвар забвения — последний дар бабки</span></div>
                <div className="flex gap-3"><span className="text-ink/55 w-20 shrink-0 font-semibold text-[11px] pt-0.5">Связи</span><span className="text-ink/75">Корней — <span className="text-ink/60">вынужденный союзник</span> · Степь — <span className="text-ink/60">дом</span></span></div>
              </div>
              <div className="mt-5 pt-4 border-t border-ink/6">
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink/55 mb-2.5">Таймлайн</p>
                <div className="space-y-2 text-[12px] text-ink/70">
                  <p><span className="inline-block w-2 h-2 rounded-full bg-[#4D6B4D] mr-2" />Приезд всадника — гл. 2</p>
                  <p><span className="inline-block w-2 h-2 rounded-full bg-[#91682E] mr-2" />Степной суд — гл. 4</p>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-12 -left-4 lg:-left-10 bg-white rounded-2xl border border-[#9E4338]/70 shadow-lg px-5 py-3.5 -rotate-[1.5deg] max-w-[300px]">
              <p className="text-[13px] leading-snug"><b className="text-[#9E4338]">Противоречие.</b> <span className="text-ink/65">В гл. 3 глаза Весны зелёные, в гл. 12 — серые.</span></p>
            </div>
          </div>
        </section>

        {/* ── Боли ── */}
        <section className="border-y border-ink/8 bg-white/50">
          <div className="max-w-5xl mx-auto px-6 py-16">
            <h2 className="font-serif text-3xl md:text-4xl font-semibold mb-10">Знакомо?</h2>
            <div className="grid md:grid-cols-3 gap-x-10 gap-y-8">
              <blockquote className="border-l-2 border-ink/15 pl-5">
                <p className="font-serif italic text-lg text-ink/75 leading-relaxed mb-2">«Как звали трактирщика из седьмой главы?..»</p>
                <p className="text-[13px] text-ink/55">Полчаса листаете собственную книгу вместо того, чтобы писать.</p>
              </blockquote>
              <blockquote className="border-l-2 border-ink/15 pl-5">
                <p className="font-serif italic text-lg text-ink/75 leading-relaxed mb-2">«Автор, у вас герой погиб в пятой главе, а в седьмой он разговаривает»</p>
                <p className="text-[13px] text-ink/55">Читатели в комментариях находят противоречия раньше вас.</p>
              </blockquote>
              <blockquote className="border-l-2 border-ink/15 pl-5">
                <p className="font-serif italic text-lg text-ink/75 leading-relaxed mb-2">«Заведу вики по миру… потом»</p>
                <p className="text-[13px] text-ink/55">Таблица персонажей заброшена на третьей неделе — её надо вести руками.</p>
              </blockquote>
            </div>
          </div>
        </section>

        {/* ── Как работает ── */}
        <section id="how" className="max-w-5xl mx-auto px-6 py-20">
          <h2 className="font-serif text-3xl md:text-4xl font-semibold mb-3">Две минуты — и у книги есть карта мира</h2>
          <p className="text-ink/55 mb-12 max-w-2xl">Ничего не нужно заполнять руками. Перо читает то, что вы уже написали.</p>
          <ol className="grid md:grid-cols-4 gap-8">
            {[
              { n: '1', icon: Upload, t: 'Загрузите рукопись', d: 'docx, fb2, epub, pdf или txt — хоть одну главу, хоть всю серию.' },
              { n: '2', icon: BookOpen, t: 'Перо читает книгу', d: 'Глава за главой — у вас на глазах появляются персонажи, локации, предметы, правила мира.' },
              { n: '3', icon: Check, t: 'Вы одобряете факты', d: 'ИИ предлагает — решаете вы. Ни одна строчка не попадёт в Мир без вашего «да».' },
              { n: '4', icon: Sparkles, t: 'Пишете дальше', d: 'Перо следит за новыми главами, дополняет профили и подсвечивает противоречия.' },
            ].map(s => (
              <li key={s.n}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="font-serif text-4xl font-semibold text-[var(--color-accent)]">{s.n}</span>
                  <s.icon size={18} className="text-ink/55" />
                </div>
                <h3 className="font-semibold text-[15px] mb-1.5">{s.t}</h3>
                <p className="text-[13.5px] text-ink/55 leading-relaxed">{s.d}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Возможности (редакционно, без иконок-в-кружочках) ── */}
        <section className="border-y border-ink/8 bg-white/50">
          <div className="max-w-5xl mx-auto px-6 py-20 space-y-14">
            <div className="grid md:grid-cols-[1fr_1.2fr] gap-8 items-baseline">
              <h3 className="font-serif text-2xl md:text-3xl font-semibold">Профили глубже, чем у редактора в издательстве</h3>
              <p className="text-ink/60 leading-relaxed">Не только внешность и роль: предыстория, мотивация, манера речи, секреты. <span className="inline-flex items-center gap-1 text-ink/60"><Link2 size={13} />связи</span> между героями и <span className="inline-flex items-center gap-1 text-ink/60"><Activity size={13} />таймлайн</span> арки каждого персонажа по главам — кто с кем, что и когда случилось.</p>
            </div>
            <div className="grid md:grid-cols-[1fr_1.2fr] gap-8 items-baseline">
              <h3 className="font-serif text-2xl md:text-3xl font-semibold">Перо — соавтор, который читал вашу книгу</h3>
              <p className="text-ink/60 leading-relaxed">ИИ-чат и правки текста с полным знанием вашего Мира: он не перепутает имена, не забудет, что было в пятой главе, и говорит репликами ваших героев — потому что знает их манеру речи. Перо не пишет за вас — оно помнит за вас.</p>
            </div>
            <div className="grid md:grid-cols-[1fr_1.2fr] gap-8 items-baseline">
              <h3 className="font-serif text-2xl md:text-3xl font-semibold">Редактор для длинной прозы — в том же окне</h3>
              <p className="text-ink/60 leading-relaxed">Главы, сцены, цели по словам, автосохранение, ревизии. <span className="inline-flex items-center gap-1 text-ink/60"><Mic size={13} />Диктовка</span> по-русски с расстановкой знаков и подстановкой имён из вашей истории. Экспорт в docx и markdown, когда пора отправлять текст.</p>
            </div>
          </div>
        </section>

        {/* ── Не генератор ── */}
        <section className="max-w-5xl mx-auto px-6 py-16">
          <div className="bg-white rounded-3xl border border-ink/8 shadow-sm px-8 py-10 md:px-12 text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink/55 mb-4">
              Чтобы не было путаницы
            </p>
            <p className="font-serif text-2xl md:text-[32px] font-semibold leading-snug max-w-3xl mx-auto mb-4">
              Это не генератор историй. Перо не напишет за вас ни строчки —
              оно помнит каждую, что написали вы.
            </p>
            <p className="text-ink/60 leading-relaxed max-w-2xl mx-auto">
              Sudowrite, Novely и подобные пишут текст вместо автора. Перо устроено наоборот:
              вы пишете — оно читает, помнит ваш мир и охраняет ваш стиль и права.
              Серьёзному автору нужен не соавтор-замена, а память.
            </p>
          </div>
        </section>

        {/* ── Сравнение ── */}
        <section id="compare" className="max-w-5xl mx-auto px-6 py-20">
          <h2 className="font-serif text-3xl md:text-4xl font-semibold mb-3">Честное сравнение</h2>
          <p className="text-ink/55 mb-10 max-w-2xl">Инструменты для писателей есть. Для русскоязычного автора с готовой рукописью — выбор короткий.</p>
          <div className="overflow-x-auto -mx-6 px-6" style={{ scrollbarWidth: 'none' }}>
            <table className="w-full min-w-[640px] text-sm border-separate" style={{ borderSpacing: 0 }}>
              <thead>
                <tr className="text-left">
                  <th className="pb-4 pr-4 font-medium text-ink/60 text-[13px] w-[34%]"></th>
                  <th className="pb-4 px-3 text-center">
                    <span className="inline-flex items-center gap-1.5 font-serif text-lg font-semibold"><PeroMark size={16} />Перо</span>
                  </th>
                  <th className="pb-4 px-3 text-center font-medium text-ink/55">Mythril</th>
                  <th className="pb-4 px-3 text-center font-medium text-ink/55">NovelCrafter</th>
                  <th className="pb-4 px-3 text-center font-medium text-ink/55">Campfire</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((r, i) => (
                  <tr key={r.label} className={i % 2 === 0 ? 'bg-white/70' : ''}>
                    <td className="py-3 pr-4 pl-3 text-ink/75 rounded-l-xl" title={r.note}>{r.label}</td>
                    <td className="py-3 px-3 text-center bg-[#E7EAE3]/60">{<CellIcon v={r.pero} />}</td>
                    <td className="py-3 px-3 text-center"><CellIcon v={r.mythril} /></td>
                    <td className="py-3 px-3 text-center"><CellIcon v={r.novelcrafter} /></td>
                    <td className="py-3 px-3 text-center rounded-r-xl"><CellIcon v={r.campfire} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11.5px] text-ink/55 mt-4">По публичным данным продуктов, июнь 2026. «Частично» — функция есть, но ограничена или требует ручной работы.</p>
        </section>

        {/* ── От автора / бета ── */}
        <section className="max-w-3xl mx-auto px-6 py-16 text-center">
          <PeroMark size={28} className="text-[var(--color-accent)] mx-auto mb-5" />
          <p className="font-serif text-2xl md:text-3xl font-semibold leading-snug mb-4">
            Перо делает автор — для авторов, которые устали терять собственный мир
          </p>
          <p className="text-ink/65 leading-relaxed max-w-xl mx-auto">
            Сейчас идёт закрытая бета: небольшая группа авторов с Author.Today и Litnet
            проверяет Перо на своих рукописях, а я правлю продукт по их фидбеку.
            Без громких обещаний — только то, что уже работает на вашей книге.
          </p>
        </section>

        {/* ── Цены ── */}
        <section id="pricing" className="border-y border-ink/8 bg-white/50">
          <div className="max-w-4xl mx-auto px-6 py-20">
            <h2 className="font-serif text-3xl md:text-4xl font-semibold mb-3 text-center">Начните бесплатно — на своей рукописи</h2>
            <p className="text-ink/55 mb-12 text-center">Полный цикл «импорт → Мир → проверка» доступен без оплаты.</p>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-white rounded-3xl border border-ink/8 p-8 shadow-sm">
                <h3 className="font-serif text-2xl font-semibold mb-1">Бесплатный</h3>
                <p className="font-serif text-4xl font-semibold mb-6">0 ₽</p>
                <ul className="space-y-2.5 text-[14px] text-ink/70 mb-8">
                  {['1 активный проект', 'Авто-Мир до 30 глав', '20 ИИ-действий в день', 'Импорт docx, fb2, epub, pdf, txt', 'Экспорт txt и markdown'].map(f => (
                    <li key={f} className="flex gap-2.5"><Check size={16} className="text-[#4D6B4D] shrink-0 mt-0.5" />{f}</li>
                  ))}
                </ul>
                <Link to={DEMO_TO} className="block text-center border border-ink/15 rounded-xl py-3 font-medium hover:bg-[#E8E2D5]/50 transition-colors">
                  Загрузить рукопись
                </Link>
              </div>
              <div className="bg-ink text-[#f5f0e8] rounded-3xl p-8 shadow-lg relative overflow-hidden">
                <h3 className="font-serif text-2xl font-semibold mb-1">Pro</h3>
                <p className="font-serif text-4xl font-semibold mb-6">599 ₽<span className="text-base font-normal opacity-60"> /мес</span></p>
                <ul className="space-y-2.5 text-[14px] text-[#f5f0e8]/85 mb-3">
                  {['Проекты и главы без лимитов', '300 ИИ-действий в день', 'Отчёт противоречий по всей книге', 'Диктовка с ИИ-обработкой', 'Экспорт в docx и zip-бэкап'].map(f => (
                    <li key={f} className="flex gap-2.5"><Check size={16} className="text-[#4D6B4D] shrink-0 mt-0.5" />{f}</li>
                  ))}
                  <li className="flex gap-2.5 text-[#f5f0e8]/55"><Clock size={16} className="shrink-0 mt-0.5 opacity-70" />Публичная страница Мира по ссылке — скоро</li>
                </ul>
                <Link to={CTA_TO} className="block text-center bg-[#f5f0e8] text-ink rounded-xl py-3 font-semibold hover:bg-white transition-colors">
                  Попробовать Pro
                </Link>
                <p className="text-[11.5px] opacity-50 mt-3 text-center">Оплата картой РФ через ЮKassa · без автопродления</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Частые сомнения (снятие возражений) ── */}
        <section className="max-w-3xl mx-auto px-6 py-20">
          <h2 className="font-serif text-3xl md:text-4xl font-semibold mb-10">Частые сомнения</h2>
          <div className="divide-y divide-ink/8">
            {[
              {
                q: 'ИИ испортит или украдёт мой стиль?',
                a: 'Перо не пишет за вас — оно читает то, что написали вы, и помнит. Стиль остаётся вашим: Перо помогает не забыть детали мира, а не сочиняет вместо автора.',
              },
              {
                q: 'А мои тексты не уйдут на обучение моделей?',
                a: 'Нет. Рукописи не используются для обучения. Все права у автора, удаление проекта — безвозвратное.',
              },
              {
                q: 'Снова заводить базу персонажей руками?',
                a: 'Ничего не нужно вводить руками. Вы загружаете рукопись — Мир собирается сам. Вам остаётся только одобрять или править найденное.',
              },
              {
                q: 'У меня уже 100 тысяч слов в Word — поздно?',
                a: 'Наоборот, это лучший момент. Импорт docx/fb2/epub за пару минут превратит готовый текст в Мир со связями и таймлайнами.',
              },
              {
                q: 'Дорого — и я не плачу в долларах.',
                a: '599 ₽ в месяц, оплата российской картой, с чеком. А полный цикл «импорт → Мир → проверка» на одном проекте доступен бесплатно — попробуйте до оплаты.',
              },
            ].map(item => (
              <div key={item.q} className="py-5">
                <h3 className="font-serif text-xl font-semibold mb-2">{item.q}</h3>
                <p className="text-ink/65 leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Приватность ── */}
        <section className="max-w-5xl mx-auto px-6 py-16">
          <div className="bg-ink text-[#f5f0e8] rounded-3xl px-8 py-10 md:px-12 flex flex-col md:flex-row items-start md:items-center gap-6">
            <ShieldCheck size={36} className="text-[#9DB5A1] shrink-0" />
            <div>
              <h3 className="font-serif text-2xl font-semibold mb-1.5">Ваши тексты — ваши</h3>
              <p className="text-[#f5f0e8]/70 leading-relaxed text-[15px]">
                Рукописи не используются для обучения моделей. Все права остаются у автора.
                Удалили проект — он удалён безвозвратно.{' '}
                <Link to="/privacy" className="underline underline-offset-2 text-[#f5f0e8]/90 hover:text-white transition-colors">
                  Подробнее о приватности
                </Link>
              </p>
            </div>
          </div>
        </section>

        {/* ── Финальный CTA ── */}
        <section className="max-w-3xl mx-auto px-6 pt-8 pb-24 text-center">
          <PeroMark size={36} className="text-[var(--color-accent)] mx-auto mb-6" />
          <h2 className="font-serif text-4xl md:text-5xl font-semibold leading-tight mb-5">
            Загрузите рукопись — через две минуты увидите карту своего мира
          </h2>
          <p className="text-ink/55 mb-9">Бесплатно, без карты. Перо помнит — автор пишет.</p>
          <Link to={DEMO_TO} className="inline-flex items-center gap-2.5 bg-ink text-[#f5f0e8] px-9 py-4 rounded-2xl text-lg font-medium hover:bg-ink/85 transition-colors shadow-sm">
            Загрузить рукопись бесплатно
            <MoveRight size={20} />
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
