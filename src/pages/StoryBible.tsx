import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { 
  ArrowLeft, BookOpen, Edit3, Map, Box, Settings, User, 
  Plus, Check, AlertTriangle, Sparkles, Castle, Mountain, Minus, Crosshair, Quote,
  Scale, Clock, Globe2, Sparkles as SparklesIcon
} from 'lucide-react';

const MOCK_CHARACTERS = [
  {
    id: '1',
    name: 'Maia',
    role: 'PROTAGONIST',
    image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
    appearance: 'Высокая девушка с серебристыми волосами и пронзительными изумрудными глазами. Всегда носит кулон в форме полумесяца.',
    motivation: '"Я найду правду о падении цитадели, чего бы мне это ни стоило."',
    incomplete: true,
  },
  {
    id: '2',
    name: 'Kael',
    role: 'MENTOR',
    image: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: '3',
    name: 'Elowen',
    role: 'ALLY',
    image: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: '4',
    name: 'Thorne',
    role: 'ANTAGONIST',
    image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80',
  }
];

const MOCK_LOCATIONS = [
  {
    id: '1',
    name: 'Цитадель',
    type: 'ГЛАВНАЯ КРЕПОСТЬ',
    icon: 'castle',
    color: 'bg-[#93B5E9]',
    x: 50,
    y: 50,
    description: 'Центральный оплот человечества, возвышающийся над облаками. Стены из древнего камня хранят секреты забытой магии. Окружен защитными барьерами, питаемыми кристаллами эфира.',
    history: '"Она стояла тысячи лет и простоит еще столько же, пока последний защитник не падет."',
  },
  {
    id: '2',
    name: 'Мертвая равнина',
    type: 'WASTELAND',
    icon: 'mountain',
    color: 'bg-[#A3A8A4]',
    x: 20,
    y: 30,
  },
  {
    id: '3',
    name: 'Серые Утесы',
    type: 'COASTAL ROCKS',
    icon: 'mountain',
    color: 'bg-[#85B8A6]',
    x: 70,
    y: 70,
  }
];

const MOCK_ITEMS = [
  {
    id: '1',
    name: 'Кулон Полумесяца',
    type: 'АРТЕФАКТ',
    image: 'https://images.unsplash.com/photo-1602173574767-37ac01994b2a?auto=format&fit=crop&w=400&q=80',
    description: 'Древний серебряный амулет, принадлежавший матери Майи. Светится слабым голубым светом в присутствии магии.',
    history: 'Передается из поколения в поколение в роду Хранителей.',
    incomplete: false,
  },
  {
    id: '2',
    name: 'Клинок Рассвета',
    type: 'ОРУЖИЕ',
    image: 'https://images.unsplash.com/photo-1595590424283-b8f17842773f?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: '3',
    name: 'Эфирный кристалл',
    type: 'МАТЕРИАЛ',
    image: 'https://images.unsplash.com/photo-1515083049182-3e288283a311?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: '4',
    name: 'Карта Пустошей',
    type: 'КВЕСТОВЫЙ ПРЕДМЕТ',
    image: 'https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&w=400&q=80',
  }
];

const MOCK_RULES = [
  {
    id: '1',
    name: 'Закон Магии',
    type: 'ФУНДАМЕНТАЛЬНОЕ',
    icon: 'sparkles',
    color: 'bg-[#E8EAE6]',
    iconColor: 'text-[#2C3E2D]',
    shortDescription: 'Основной принцип распределения эфира в пространстве и времени.',
    description: '"Магия в этом мире не бесконечна. Каждый глоток силы требует отдачи. Эфир — это не топливо, это дыхание самой планеты, которое нельзя задерживать слишком долго."',
    history: 'Был сформулирован первым советом магов после Великого Раскола. До этого времени использование силы было хаотичным, что привело к истощению целых континентов и превращению их в мертвые пустоши.',
  },
  {
    id: '2',
    name: 'Кодекс Чести',
    type: 'СОЦИАЛЬНОЕ',
    icon: 'scale',
    color: 'bg-[#F0F4F8]',
    iconColor: 'text-[#4A90E2]',
  },
  {
    id: '3',
    name: 'Циклы Времени',
    type: 'ФИЗИЧЕСКОЕ',
    icon: 'clock',
    color: 'bg-[#F8F9FA]',
    iconColor: 'text-[#8C92AC]',
  },
  {
    id: '4',
    name: 'Дрейф Континентов',
    type: 'ГЕОГРАФИЧЕСКОЕ',
    icon: 'globe',
    color: 'bg-[#F0F7F4]',
    iconColor: 'text-[#5C8D89]',
  }
];

const TABS = ['Персонажи', 'Локации', 'Предметы', 'Правила мира'];

export default function StoryBible() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState('Предметы');
  const [selectedCharId, setSelectedCharId] = useState('1');
  const [selectedLocId, setSelectedLocId] = useState('1');
  const [selectedItemId, setSelectedItemId] = useState('1');
  const [itemFilter, setItemFilter] = useState('Все');
  const [selectedRuleId, setSelectedRuleId] = useState('1');

  const selectedChar = MOCK_CHARACTERS.find(c => c.id === selectedCharId);
  const selectedLoc = MOCK_LOCATIONS.find(l => l.id === selectedLocId);
  const selectedItem = MOCK_ITEMS.find(i => i.id === selectedItemId);
  const selectedRule = MOCK_RULES.find(r => r.id === selectedRuleId);

  const itemTypes = ['Все', ...Array.from(new Set(MOCK_ITEMS.map(item => item.type)))];
  const filteredItems = itemFilter === 'Все' 
    ? MOCK_ITEMS 
    : MOCK_ITEMS.filter(item => item.type === itemFilter);

  return (
    <div className="flex h-screen w-full bg-[#F9FAFB] font-sans overflow-hidden text-[#1a1a1a]">
      
      {/* Thin Sidebar */}
      <aside className="w-16 bg-white border-r border-black/5 flex flex-col items-center py-4 gap-6 z-10 flex-shrink-0">
        <button 
          onClick={() => navigate('/dashboard')}
          className="w-10 h-10 bg-[#2C3E2D] rounded-xl flex items-center justify-center text-white hover:bg-[#1e2b1f] transition-colors shadow-sm"
        >
          <BookOpen size={20} />
        </button>
        <nav className="flex flex-col gap-4 text-black/40">
          <button onClick={() => navigate(`/editor/${id || '1'}`)} className="p-2 hover:text-black hover:bg-black/5 rounded-lg transition-colors">
            <Edit3 size={20} />
          </button>
          <button className="p-2 text-black bg-black/5 rounded-lg transition-colors">
            <Map size={20} />
          </button>
          <button className="p-2 hover:text-black hover:bg-black/5 rounded-lg transition-colors">
            <Box size={20} />
          </button>
          <div className="w-6 h-[1px] bg-black/10 my-2 mx-auto" />
          <button className="p-2 hover:text-black hover:bg-black/5 rounded-lg transition-colors">
            <Settings size={20} />
          </button>
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Top Bar */}
        <header className="h-16 bg-white flex items-center justify-between px-6 border-b border-black/5 flex-shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate(-1)} className="text-black/60 hover:text-black transition-colors">
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-[17px] font-semibold text-[#1a1a1a]">Story Bible — {activeTab}</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-[#E5D5C5] flex items-center justify-center text-[#8C6B4A] border border-black/5 cursor-pointer">
              <User size={16} />
            </div>
          </div>
        </header>

        {/* Tabs */}
        <div className="px-8 pt-6 border-b border-black/5 bg-white flex-shrink-0">
          <div className="flex gap-8">
            {TABS.map(tab => (
              <button 
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-4 text-[15px] font-medium border-b-2 transition-colors ${
                  activeTab === tab 
                    ? 'border-black text-black' 
                    : 'border-transparent text-black/50 hover:text-black/80'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Split View */}
        {activeTab === 'Персонажи' && (
          <div className="flex-1 flex overflow-hidden">
            
            {/* Left Column - Library */}
            <div className="flex-1 overflow-y-auto p-8 border-r border-black/5 bg-white">
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-[13px] font-bold text-black/40 uppercase tracking-wider">
                  Библиотека персонажей
                </h2>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {MOCK_CHARACTERS.map(char => {
                  const isSelected = char.id === selectedCharId;
                  return (
                    <div 
                      key={char.id}
                      onClick={() => setSelectedCharId(char.id)}
                      className={`group cursor-pointer rounded-2xl p-3 transition-all ${
                        isSelected 
                          ? 'border-2 border-[#1a1a1a] bg-white shadow-sm' 
                          : 'border-2 border-transparent hover:bg-black/5'
                      }`}
                    >
                      <div className="relative aspect-square rounded-xl overflow-hidden mb-4 bg-black/5">
                        <img 
                          src={char.image} 
                          alt={char.name} 
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                        {isSelected && (
                          <div className="absolute top-2 right-2 w-6 h-6 bg-[#2C3E2D] rounded-full flex items-center justify-center text-white shadow-md border-2 border-white">
                            <Check size={14} strokeWidth={3} />
                          </div>
                        )}
                      </div>
                      <div className="px-1">
                        <h3 className="font-bold text-[16px] text-[#1a1a1a] mb-0.5">{char.name}</h3>
                        <p className="text-[11px] font-bold text-black/40 uppercase tracking-wider">
                          {char.role}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column - Details */}
            {selectedChar && (
              <div className="w-[420px] overflow-y-auto bg-[#F9FAFB] flex-shrink-0 flex flex-col">
                <div className="p-10 flex flex-col items-center text-center border-b border-black/5 bg-white">
                  <div className="w-32 h-32 rounded-full p-1 bg-white shadow-lg mb-6 relative">
                    <div className="w-full h-full rounded-full overflow-hidden bg-[#f3d3c1]">
                      <img 
                        src={selectedChar.image} 
                        alt={selectedChar.name} 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  </div>
                  <h2 className="text-3xl font-bold text-[#1a1a1a] mb-2">{selectedChar.name}</h2>
                  <p className="text-[15px] text-black/60 mb-4">Role: {selectedChar.role.charAt(0) + selectedChar.role.slice(1).toLowerCase()}</p>
                  
                  {selectedChar.incomplete && (
                    <div className="inline-flex items-center gap-1.5 bg-[#FFF4E5] text-[#B86B11] px-3 py-1.5 rounded-full text-[11px] font-bold tracking-wider uppercase border border-[#FFE0B2]">
                      <AlertTriangle size={14} />
                      Incomplete Bio
                    </div>
                  )}
                </div>

                <div className="p-8 flex-1 flex flex-col gap-8">
                  {selectedChar.appearance && (
                    <div>
                      <h4 className="text-[12px] font-bold text-black/40 uppercase tracking-wider mb-3 ml-1">
                        Внешность
                      </h4>
                      <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm text-[14px] leading-relaxed text-black/80">
                        {selectedChar.appearance}
                      </div>
                    </div>
                  )}

                  {selectedChar.motivation && (
                    <div>
                      <h4 className="text-[12px] font-bold text-black/40 uppercase tracking-wider mb-3 ml-1">
                        Мотивация
                      </h4>
                      <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm text-[14px] leading-relaxed text-black/80 italic">
                        {selectedChar.motivation}
                      </div>
                    </div>
                  )}

                  <div className="mt-auto pt-8 flex flex-col gap-4">
                    <button className="w-full bg-[#2C3E2D] hover:bg-[#1e2b1f] text-white py-3.5 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors shadow-sm">
                      <Sparkles size={18} />
                      Спросить AI о персонаже
                    </button>
                    <button className="text-[13px] text-black/40 hover:text-black/60 underline underline-offset-4 transition-colors text-center">
                      Редактировать полные поля
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Locations View */}
        {activeTab === 'Локации' && (
          <div className="flex-1 flex overflow-hidden">
            {/* Map View (Left) */}
            <div className="flex-1 relative bg-[#EBE5D9] overflow-hidden border-r border-black/5">
              {/* Zoom Controls */}
              <div className="absolute top-6 left-6 bg-white rounded-lg shadow-sm border border-black/5 flex items-center p-1 z-10">
                <button className="p-1.5 hover:bg-black/5 rounded text-black/60 hover:text-black transition-colors"><Plus size={16} /></button>
                <button className="p-1.5 hover:bg-black/5 rounded text-black/60 hover:text-black transition-colors"><Minus size={16} /></button>
                <div className="w-[1px] h-4 bg-black/10 mx-1" />
                <button className="p-1.5 hover:bg-black/5 rounded text-black/60 hover:text-black transition-colors"><Crosshair size={16} /></button>
              </div>

              {/* Map Markers */}
              {MOCK_LOCATIONS.map(loc => {
                const isSelected = loc.id === selectedLocId;
                return (
                  <div 
                    key={loc.id}
                    className="absolute flex flex-col items-center gap-2 cursor-pointer transform -translate-x-1/2 -translate-y-1/2 transition-transform hover:scale-105"
                    style={{ left: `${loc.x}%`, top: `${loc.y}%` }}
                    onClick={() => setSelectedLocId(loc.id)}
                  >
                    <div className={`relative w-16 h-16 rounded-full flex items-center justify-center text-white shadow-md transition-all ${isSelected ? 'ring-4 ring-blue-400/30' : ''} ${loc.color}`}>
                      {loc.icon === 'castle' ? <Castle size={28} /> : <Mountain size={28} />}
                      {isSelected && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 bg-[#4A90E2] rounded-full flex items-center justify-center text-white shadow-sm border-2 border-white">
                          <Check size={12} strokeWidth={3} />
                        </div>
                      )}
                    </div>
                    <div className={`bg-white px-3 py-1.5 rounded-lg shadow-sm border transition-colors ${isSelected ? 'border-blue-200' : 'border-black/5'} flex flex-col items-center`}>
                      <span className="text-[13px] font-bold text-[#1a1a1a]">{loc.name}</span>
                      <span className="text-[9px] font-bold text-black/40 uppercase tracking-wider">{loc.type}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Details Sidebar (Right) */}
            {selectedLoc && (
              <div className="w-[420px] overflow-y-auto bg-[#F9FAFB] flex-shrink-0 flex flex-col">
                <div className="p-10 flex flex-col items-center text-center border-b border-black/5 bg-white">
                  <div className={`w-32 h-32 rounded-full p-1 bg-white shadow-lg mb-6 relative`}>
                    <div className={`w-full h-full rounded-full flex items-center justify-center text-white ${selectedLoc.color}`}>
                      {selectedLoc.icon === 'castle' ? <Castle size={48} /> : <Mountain size={48} />}
                    </div>
                  </div>
                  <h2 className="text-3xl font-bold text-[#1a1a1a] mb-2">{selectedLoc.name}</h2>
                  <p className="text-[13px] font-bold text-[#4A90E2] uppercase tracking-wider mb-4">{selectedLoc.type}</p>
                </div>

                <div className="p-8 flex-1 flex flex-col gap-8">
                  {selectedLoc.description && (
                    <div>
                      <h4 className="text-[12px] font-bold text-black/40 uppercase tracking-wider mb-3 ml-1">
                        Описание
                      </h4>
                      <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm text-[14px] leading-relaxed text-black/80">
                        {selectedLoc.description}
                      </div>
                    </div>
                  )}

                  {selectedLoc.history && (
                    <div>
                      <h4 className="text-[12px] font-bold text-black/40 uppercase tracking-wider mb-3 ml-1">
                        История
                      </h4>
                      <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm text-[14px] leading-relaxed text-black/80 italic relative">
                        <Quote size={24} className="absolute -top-3 -left-2 text-black/10 rotate-180" />
                        {selectedLoc.history}
                      </div>
                    </div>
                  )}

                  <div className="mt-auto pt-8 flex flex-col gap-4">
                    <button className="w-full bg-[#2C3E2D] hover:bg-[#1e2b1f] text-white py-3.5 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors shadow-sm">
                      <Sparkles size={18} />
                      Спросить AI о локации
                    </button>
                    <button className="text-[13px] text-black/40 hover:text-black/60 underline underline-offset-4 transition-colors text-center">
                      Редактировать полные поля
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Items View */}
        {activeTab === 'Предметы' && (
          <div className="flex-1 flex overflow-hidden">
            
            {/* Left Column - Library */}
            <div className="flex-1 overflow-y-auto p-8 border-r border-black/5 bg-white">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-[13px] font-bold text-black/40 uppercase tracking-wider">
                  Библиотека предметов
                </h2>
              </div>

              {/* Filter UI */}
              <div className="flex flex-wrap gap-2 mb-8">
                {itemTypes.map(type => (
                  <button
                    key={type}
                    onClick={() => setItemFilter(type)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-bold tracking-wider uppercase transition-colors ${
                      itemFilter === type 
                        ? 'bg-[#2C3E2D] text-white' 
                        : 'bg-black/5 text-black/60 hover:bg-black/10'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {filteredItems.map(item => {
                  const isSelected = item.id === selectedItemId;
                  return (
                    <div 
                      key={item.id}
                      onClick={() => setSelectedItemId(item.id)}
                      className={`group cursor-pointer rounded-2xl p-3 transition-all ${
                        isSelected 
                          ? 'border-2 border-[#1a1a1a] bg-white shadow-sm' 
                          : 'border-2 border-transparent hover:bg-black/5'
                      }`}
                    >
                      <div className="relative aspect-square rounded-xl overflow-hidden mb-4 bg-black/5">
                        <img 
                          src={item.image} 
                          alt={item.name} 
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                        {isSelected && (
                          <div className="absolute top-2 right-2 w-6 h-6 bg-[#2C3E2D] rounded-full flex items-center justify-center text-white shadow-md border-2 border-white">
                            <Check size={14} strokeWidth={3} />
                          </div>
                        )}
                      </div>
                      <div className="px-1">
                        <h3 className="font-bold text-[16px] text-[#1a1a1a] mb-0.5">{item.name}</h3>
                        <p className="text-[11px] font-bold text-black/40 uppercase tracking-wider">
                          {item.type}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column - Details */}
            {selectedItem && (
              <div className="w-[420px] overflow-y-auto bg-[#F9FAFB] flex-shrink-0 flex flex-col">
                <div className="p-10 flex flex-col items-center text-center border-b border-black/5 bg-white">
                  <div className="w-32 h-32 rounded-full p-1 bg-white shadow-lg mb-6 relative">
                    <div className="w-full h-full rounded-full overflow-hidden bg-[#f3d3c1]">
                      <img 
                        src={selectedItem.image} 
                        alt={selectedItem.name} 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  </div>
                  <h2 className="text-3xl font-bold text-[#1a1a1a] mb-2">{selectedItem.name}</h2>
                  <p className="text-[13px] font-bold text-[#4A90E2] uppercase tracking-wider mb-4">{selectedItem.type}</p>
                  
                  {selectedItem.incomplete && (
                    <div className="inline-flex items-center gap-1.5 bg-[#FFF4E5] text-[#B86B11] px-3 py-1.5 rounded-full text-[11px] font-bold tracking-wider uppercase border border-[#FFE0B2]">
                      <AlertTriangle size={14} />
                      Incomplete Data
                    </div>
                  )}
                </div>

                <div className="p-8 flex-1 flex flex-col gap-8">
                  {selectedItem.description && (
                    <div>
                      <h4 className="text-[12px] font-bold text-black/40 uppercase tracking-wider mb-3 ml-1">
                        Описание
                      </h4>
                      <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm text-[14px] leading-relaxed text-black/80">
                        {selectedItem.description}
                      </div>
                    </div>
                  )}

                  {selectedItem.history && (
                    <div>
                      <h4 className="text-[12px] font-bold text-black/40 uppercase tracking-wider mb-3 ml-1">
                        История
                      </h4>
                      <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm text-[14px] leading-relaxed text-black/80 italic relative">
                        <Quote size={24} className="absolute -top-3 -left-2 text-black/10 rotate-180" />
                        {selectedItem.history}
                      </div>
                    </div>
                  )}

                  <div className="mt-auto pt-8 flex flex-col gap-4">
                    <button className="w-full bg-[#2C3E2D] hover:bg-[#1e2b1f] text-white py-3.5 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors shadow-sm">
                      <Sparkles size={18} />
                      Спросить AI о предмете
                    </button>
                    <button className="text-[13px] text-black/40 hover:text-black/60 underline underline-offset-4 transition-colors text-center">
                      Редактировать полные поля
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Rules View */}
        {activeTab === 'Правила мира' && (
          <div className="flex-1 flex overflow-hidden bg-[#F4F2EC]">
            
            {/* Left Column - Library */}
            <div className="flex-1 overflow-y-auto p-10">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h2 className="text-[11px] font-bold text-black/40 uppercase tracking-widest mb-1">
                    БИБЛИОТЕКА ПРАВИЛ МИРА
                  </h2>
                  <h1 className="text-3xl font-bold text-[#1a1a1a]">Основы мироздания</h1>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {MOCK_RULES.map(rule => {
                  const isSelected = rule.id === selectedRuleId;
                  
                  let Icon = SparklesIcon;
                  if (rule.icon === 'scale') Icon = Scale;
                  if (rule.icon === 'clock') Icon = Clock;
                  if (rule.icon === 'globe') Icon = Globe2;

                  return (
                    <div 
                      key={rule.id}
                      onClick={() => setSelectedRuleId(rule.id)}
                      className={`group cursor-pointer rounded-2xl p-6 transition-all bg-white border-2 ${
                        isSelected 
                          ? 'border-[#1a1a1a] shadow-md' 
                          : 'border-transparent shadow-sm hover:border-black/10'
                      }`}
                    >
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-6 ${rule.color} ${rule.iconColor}`}>
                        <Icon size={24} />
                      </div>
                      <div>
                        <h3 className="font-bold text-[18px] text-[#1a1a1a] mb-2">{rule.name}</h3>
                        <p className={`text-[10px] font-bold uppercase tracking-wider ${
                          rule.type === 'ФУНДАМЕНТАЛЬНОЕ' ? 'text-[#D35400]' : 'text-black/40'
                        }`}>
                          {rule.type}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column - Details */}
            {selectedRule && (
              <div className="w-[420px] overflow-y-auto bg-[#F9FAFB] flex-shrink-0 flex flex-col border-l border-black/5">
                <div className="p-10 flex flex-col items-center text-center border-b border-black/5 bg-white">
                  <div className={`w-24 h-24 rounded-2xl flex items-center justify-center mb-6 ${selectedRule.color} ${selectedRule.iconColor} border border-black/5 shadow-sm`}>
                    {selectedRule.icon === 'sparkles' && <SparklesIcon size={40} />}
                    {selectedRule.icon === 'scale' && <Scale size={40} />}
                    {selectedRule.icon === 'clock' && <Clock size={40} />}
                    {selectedRule.icon === 'globe' && <Globe2 size={40} />}
                  </div>
                  <h2 className="text-3xl font-bold text-[#1a1a1a] mb-4">{selectedRule.name}</h2>
                  {selectedRule.shortDescription && (
                    <p className="text-[14px] text-black/60 leading-relaxed max-w-[280px]">
                      {selectedRule.shortDescription}
                    </p>
                  )}
                </div>

                <div className="p-8 flex-1 flex flex-col gap-8">
                  {selectedRule.description && (
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#D35400]" />
                        <h4 className="text-[11px] font-bold text-black/40 uppercase tracking-widest">
                          ОПИСАНИЕ
                        </h4>
                      </div>
                      <div className="text-[15px] leading-relaxed text-black/80 italic font-serif">
                        {selectedRule.description}
                      </div>
                    </div>
                  )}

                  {selectedRule.history && (
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-1.5 h-1.5 rounded-full bg-black/20" />
                        <h4 className="text-[11px] font-bold text-black/40 uppercase tracking-widest">
                          ИСТОРИЯ
                        </h4>
                      </div>
                      <div className="text-[14px] leading-relaxed text-black/70 font-serif">
                        {selectedRule.history}
                      </div>
                    </div>
                  )}

                  <div className="mt-auto pt-8 flex flex-col gap-4">
                    <button className="w-full bg-[#2C3E2D] hover:bg-[#1e2b1f] text-white py-3.5 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors shadow-sm">
                      <Sparkles size={18} />
                      Спросить AI о правиле
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
