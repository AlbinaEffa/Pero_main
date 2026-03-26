import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, User, Lightbulb } from 'lucide-react';

export default function IdeaLibrary() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#F4F1E9] font-sans">
      <div className="max-w-[900px] mx-auto px-6 py-10">
        
        {/* Navigation back */}
        <button 
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-1.5 text-[13px] font-medium text-black/50 hover:text-black/80 transition-colors mb-6"
        >
          <ChevronLeft size={16} /> Назад к проектам
        </button>

        {/* Header */}
        <header className="flex justify-between items-start mb-8 gap-4 flex-wrap">
          <div>
            <h1 className="font-serif text-4xl md:text-5xl font-bold text-[#1a1a1a] mb-2 leading-tight">
              Библиотека Идей
            </h1>
            <p className="text-[15px] text-black/50 m-0">
              Цифровой сад для ваших идей и исследований.
            </p>
          </div>

          <button
            onClick={() => navigate('/settings')}
            className="w-12 h-12 rounded-full bg-black/5 hover:bg-black/10 border-none cursor-pointer flex items-center justify-center text-black/50 hover:text-black/80 transition-colors flex-shrink-0"
          >
            <User size={20} />
          </button>
        </header>

        {/* Empty state */}
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-20 h-20 rounded-2xl bg-black/4 flex items-center justify-center mb-6">
            <Lightbulb size={36} className="text-black/20" />
          </div>
          <h2 className="font-serif text-3xl font-semibold text-[#1a1a1a] mb-3">
            Скоро здесь появятся идеи
          </h2>
          <p className="text-[15px] text-black/50 max-w-sm leading-relaxed mb-8">
            Библиотека идей — место для набросков, вдохновения и исследований. Функция в разработке.
          </p>
          <button
            onClick={() => navigate('/dashboard')}
            className="bg-[#1a1a1a] hover:bg-[#333] text-white rounded-full px-8 py-3 text-[14px] font-medium transition-colors"
          >
            Вернуться к проектам
          </button>
        </div>

      </div>
    </div>
  );
}
