import { Link } from 'react-router-dom';
import { ShieldCheck, ArrowLeft } from 'lucide-react';
import { PeroLogo } from '../components/Logo';

/**
 * Публичная страница приватности и прав на тексты (PRD P0.6).
 * Доступна без логина. Обещания продукта: не обучаем модели,
 * права у автора, удаление безвозвратно.
 */
export default function Privacy() {
  return (
    <div className="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)] font-sans">
      <header className="flex items-center justify-between px-6 lg:px-12 py-5 border-b border-ink/8">
        <Link to="/" className="text-ink hover:opacity-80 transition-opacity"><PeroLogo size={22} /></Link>
        <Link to="/" className="flex items-center gap-1.5 text-sm text-ink/60 hover:text-ink transition-colors">
          <ArrowLeft size={15} /> На главную
        </Link>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-16">
        <ShieldCheck size={32} className="text-[var(--color-accent)] mb-5" />
        <h1 className="font-serif text-4xl md:text-5xl font-semibold leading-tight mb-3">
          Приватность и права на&nbsp;тексты
        </h1>
        <p className="text-ink/60 text-sm mb-12">Обновлено: 12 июня 2026</p>

        {/* Главное — коротко */}
        <div className="bg-white rounded-2xl border border-ink/8 shadow-sm p-7 mb-12">
          <p className="text-[10px] font-bold uppercase tracking-widest text-ink/55 mb-4">Главное — в трёх строчках</p>
          <ul className="space-y-3 text-[15px] leading-relaxed">
            <li className="flex gap-3"><span className="text-[var(--color-accent)] font-bold">1.</span><span>Ваши тексты <b>не используются для обучения</b> моделей искусственного интеллекта.</span></li>
            <li className="flex gap-3"><span className="text-[var(--color-accent)] font-bold">2.</span><span>Все права на рукописи и построенный Мир <b>остаются у вас</b>. Перо не претендует ни на что из написанного.</span></li>
            <li className="flex gap-3"><span className="text-[var(--color-accent)] font-bold">3.</span><span>Удалили проект — он <b>удалён безвозвратно</b>, вместе с Миром и историей работы над ним.</span></li>
          </ul>
        </div>

        <section className="space-y-10 text-[15px] leading-relaxed text-ink/75">
          <div>
            <h2 className="font-serif text-2xl font-semibold text-ink mb-3">Что мы храним</h2>
            <p>
              Только то, что нужно для работы студии: ваши рукописи и главы, построенную по ним
              Мир (персонажи, локации, связи, таймлайны), настройки проектов
              и данные аккаунта — электронную почту и имя автора, если вы его указали.
              Мы не запрашиваем и не храним паспортные данные, телефон или адрес.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl font-semibold text-ink mb-3">Как работает ИИ с вашим текстом</h2>
            <p className="mb-3">
              Когда Перо «читает» рукопись или отвечает в чате, фрагменты текста передаются
              провайдеру ИИ — исключительно для обработки вашего запроса. Мы работаем с
              провайдерами через коммерческие API, условия которых запрещают использование
              переданных данных для обучения их моделей.
            </p>
            <p>
              Перо не обучает собственные модели — ни на ваших текстах, ни на чьих-либо ещё.
              Результаты анализа (карточки персонажей, связи, события) принадлежат вашему
              проекту и видны только вам.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl font-semibold text-ink mb-3">Права на написанное</h2>
            <p>
              Всё, что вы написали, надиктовали или загрузили в Перо, — ваша интеллектуальная
              собственность. Это относится и к Миру, построенному инструментом по
              вашей рукописи: она производна от вашего текста и принадлежит вам.
              Экспортируйте свои данные в любой момент — docx, markdown, txt или полный zip-бэкап.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl font-semibold text-ink mb-3">Удаление</h2>
            <p>
              Удаление проекта удаляет рукопись, главы, Мир, связи, таймлайны и историю
              ревизий безвозвратно — восстановить их не сможем ни вы, ни мы. Удаление аккаунта
              удаляет все проекты и данные аккаунта.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl font-semibold text-ink mb-3">Аналитика</h2>
            <p>
              Чтобы понимать, что в продукте работает, мы собираем обезличенные события
              использования (например, «импорт завершён», «сущность одобрена») и отчёты об
              ошибках. В эти события не попадает содержимое ваших текстов.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl font-semibold text-ink mb-3">Вопросы</h2>
            <p>
              Напишите нам через кнопку «Отзыв» в приложении — её видно на любом экране
              студии. Отвечаем лично: команда Перо маленькая, и это пока к лучшему.
            </p>
          </div>
        </section>

        <div className="mt-14 pt-8 border-t border-ink/8">
          <Link to="/login" className="inline-flex items-center gap-2 bg-ink text-[#f5f0e8] px-6 py-3 rounded-xl font-medium hover:bg-ink/85 transition-colors">
            Загрузить рукопись бесплатно
          </Link>
        </div>
      </main>

      <footer className="border-t border-ink/8 py-8">
        <div className="max-w-2xl mx-auto px-6 flex items-center justify-between text-sm text-ink/55">
          <span className="text-ink/60"><PeroLogo size={16} /></span>
          <span>&copy; {new Date().getFullYear()} Перо</span>
        </div>
      </footer>
    </div>
  );
}
