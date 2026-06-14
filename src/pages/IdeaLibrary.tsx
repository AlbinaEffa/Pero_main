import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Lightbulb } from 'lucide-react';

export default function IdeaLibrary() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#F5F0E8] font-sans">
      <div className="max-w-[900px] mx-auto px-6 py-10">

        {/* Navigation back */}
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-1.5 text-[13px] font-medium text-ink/50 hover:text-ink/80 transition-colors mb-6"
        >
          <ChevronLeft size={16} /> Назад к проектам
        </button>

        {/* Header */}
        <header className="mb-8">
          <h1 className="font-serif text-4xl md:text-5xl font-bold text-[#1E2D1F] mb-2 leading-tight">
            Библиотека Идей
          </h1>
          <p className="text-[15px] text-ink/50 m-0">
            Цифровой сад для ваших идей и исследований.
          </p>
        </header>

        {/* Empty state */}
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-20 h-20 rounded-2xl bg-ink/4 flex items-center justify-center mb-6">
            <Lightbulb size={36} className="text-ink/20" />
          </div>
          <h2 className="font-serif text-3xl font-semibold text-[#1E2D1F] mb-3">
            Скоро здесь появятся идеи
          </h2>
          <p className="text-[15px] text-ink/50 max-w-sm leading-relaxed mb-8">
            Библиотека идей — место для набросков, вдохновения и исследований. Функция в разработке.
          </p>
          <button
            onClick={() => navigate('/dashboard')}
            className="bg-[#1E2D1F] hover:bg-[#333] text-white rounded-full px-8 py-3 text-[14px] font-medium transition-colors"
          >
            Вернуться к проектам
          </button>
        </div>

      </div>
    </div>
  );
}
