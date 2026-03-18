import { Link } from 'react-router-dom';
import { PenTool, BookOpen, Sparkles, MoveRight } from 'lucide-react';

export default function Landing() {
  return (
    <div className="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)] flex flex-col font-sans">
      {/* Header */}
      <header className="flex items-center justify-between p-6 lg:px-12 border-b border-black/10">
        <div className="flex items-center gap-2">
          <PenTool size={24} className="text-[var(--color-accent)]" />
          <span className="text-3xl font-serif font-bold italic tracking-tighter">перо</span>
        </div>
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium">
          <a href="#features" className="hover:text-[var(--color-accent)] transition-colors">Возможности</a>
          <a href="#pricing" className="hover:text-[var(--color-accent)] transition-colors">Цены</a>
          <Link to="/login" className="hover:text-[var(--color-accent)] transition-colors">Войти</Link>
          <Link to="/login" className="bg-black text-white px-5 py-2.5 rounded-full hover:bg-black/80 transition-colors">
            Начать писать
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 py-24 lg:py-32">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-black/10 bg-white/50 text-xs font-semibold uppercase tracking-widest mb-8">
          <Sparkles size={14} className="text-[var(--color-accent)]" />
          <span>Современная студия писателя</span>
        </div>
        
        <h1 className="text-6xl md:text-8xl font-serif font-medium leading-[0.9] tracking-tighter max-w-4xl mb-8">
          Напишите свой шедевр <br className="hidden md:block" />
          <span className="italic text-[var(--color-accent)]">без отвлекающих факторов.</span>
        </h1>
        
        <p className="text-lg md:text-xl text-black/60 max-w-2xl mb-12 font-medium">
          Прекрасно созданная среда для авторов, романистов и рассказчиков. 
          Организуйте свой лор, создавайте миры и сосредоточьтесь на словах.
        </p>
        
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <Link to="/login" className="flex items-center gap-2 bg-black text-white px-8 py-4 rounded-full text-lg font-medium hover:bg-black/80 transition-transform hover:scale-105">
            Начать писать бесплатно
            <MoveRight size={20} />
          </Link>
          <a href="#features" className="flex items-center gap-2 px-8 py-4 rounded-full text-lg font-medium border border-black/20 hover:bg-black/5 transition-colors">
            Изучить возможности
          </a>
        </div>

        {/* Feature Grid */}
        <div id="features" className="grid md:grid-cols-3 gap-8 mt-32 max-w-6xl w-full text-left">
          <div className="p-8 rounded-3xl bg-white border border-black/5 shadow-sm">
            <div className="w-12 h-12 bg-[var(--color-paper-dark)] rounded-2xl flex items-center justify-center mb-6">
              <BookOpen size={24} className="text-[var(--color-accent)]" />
            </div>
            <h3 className="text-2xl font-serif font-medium mb-3">Библия истории</h3>
            <p className="text-black/60 leading-relaxed">Следите за персонажами, локациями и лором в специальной базе данных с поиском прямо рядом с вашей рукописью.</p>
          </div>
          <div className="p-8 rounded-3xl bg-white border border-black/5 shadow-sm">
            <div className="w-12 h-12 bg-[var(--color-paper-dark)] rounded-2xl flex items-center justify-center mb-6">
              <PenTool size={24} className="text-[var(--color-accent)]" />
            </div>
            <h3 className="text-2xl font-serif font-medium mb-3">Режим фокусировки</h3>
            <p className="text-black/60 leading-relaxed">Скройте интерфейс и погрузитесь в историю. Только вы, чистый лист и ваше воображение.</p>
          </div>
          <div className="p-8 rounded-3xl bg-white border border-black/5 shadow-sm">
            <div className="w-12 h-12 bg-[var(--color-paper-dark)] rounded-2xl flex items-center justify-center mb-6">
              <Sparkles size={24} className="text-[var(--color-accent)]" />
            </div>
            <h3 className="text-2xl font-serif font-medium mb-3">Умная организация</h3>
            <p className="text-black/60 leading-relaxed">Перетаскивайте главы, устанавливайте цели по количеству слов и легко отслеживайте свой ежедневный прогресс.</p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-8 text-center text-sm text-black/40 border-t border-black/10">
        &copy; {new Date().getFullYear()} перо Studio. Все права защищены.
      </footer>
    </div>
  );
}
