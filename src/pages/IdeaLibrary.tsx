import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, MoreVertical, Calendar, Tag, ChevronLeft } from 'lucide-react';

interface Idea {
  id: string;
  title: string;
  description: string;
  tags: string[];
  date: string;
}

const MOCK_IDEAS: Idea[] = [
  {
    id: '1',
    title: 'Парящие острова',
    description: 'Мир, где острова парят в море облаков, удерживаемые древними кристаллами.',
    tags: ['WORLDBUILDING', 'FANTASY'],
    date: '10.05.2024'
  }
];

export default function IdeaLibrary() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

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

          <button className="bg-[#1a1a1a] hover:bg-[#333] text-white rounded-full px-6 py-3 text-[15px] font-medium flex items-center gap-2 transition-colors whitespace-nowrap">
            <Plus size={18} /> Записать Идею
          </button>
        </header>

        {/* Search and Filter */}
        <div className="flex gap-4 mb-10">
          <div className="flex-1 flex items-center gap-3 bg-white rounded-full px-6 py-3.5 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
            <Search size={20} className="text-black/30" />
            <input
              type="text"
              placeholder="Поиск идей, тегов или исследований..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="border-none bg-transparent outline-none text-[16px] w-full text-[#1a1a1a] placeholder:text-black/30"
            />
          </div>
          <button className="bg-white hover:bg-[#fafafa] text-[#1a1a1a] rounded-full px-8 text-[15px] font-medium flex items-center justify-center shadow-[0_2px_10px_rgba(0,0,0,0.02)] transition-colors">
            Фильтр
          </button>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {MOCK_IDEAS.map(idea => (
            <div key={idea.id} className="bg-white rounded-[24px] p-8 shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col relative">
              <div className="flex justify-between items-start mb-5">
                <h3 className="font-serif text-2xl font-semibold text-[#1a1a1a] m-0 leading-tight">
                  {idea.title}
                </h3>
                <button className="text-black/30 hover:text-black/50 transition-colors p-1 -mt-1 -mr-1">
                  <MoreVertical size={20} />
                </button>
              </div>
              
              <p className="text-[15px] text-black/60 leading-relaxed mb-8 flex-1">
                {idea.description}
              </p>

              <div className="border-t border-black/5 pt-6">
                <div className="flex gap-2 flex-wrap mb-6">
                  {idea.tags.map(tag => (
                    <span key={tag} className="bg-black/5 text-black/50 px-3 py-1.5 rounded-full text-[11px] font-bold tracking-wider flex items-center gap-1.5">
                      <Tag size={12} />
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2 text-black/40 text-[13px] font-medium">
                    <Calendar size={16} />
                    {idea.date}
                  </div>
                  <button className="text-[#C66B49] hover:text-[#a85a3d] text-[13px] font-semibold transition-colors">
                    Редактировать
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* New Idea Card */}
          <button className="bg-transparent border-2 border-dashed border-black/10 hover:border-black/20 rounded-[24px] min-h-[320px] flex flex-col items-center justify-center gap-4 cursor-pointer transition-colors text-black/30 hover:text-black/50 group">
            <Plus size={36} strokeWidth={1.5} className="transition-transform group-hover:scale-110" />
            <span className="font-serif text-2xl font-medium">Новая Идея</span>
          </button>
        </div>

      </div>
    </div>
  );
}
