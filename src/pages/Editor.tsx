import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { 
  ChevronLeft, 
  BookOpen, 
  Sparkles, 
  Mic, 
  Headphones, 
  Search, 
  FileText,
  X,
  Check,
  Inbox,
  Users,
  MapPin,
  Box,
  Plus,
  ChevronDown,
  ChevronRight,
  Bell,
  Globe,
  Bold,
  Italic,
  MoreHorizontal,
  Square,
  SkipBack,
  Pause,
  SkipForward
} from 'lucide-react';

import { SearchOverlay } from '../components/SearchOverlay';

const MOCK_CHAPTERS = [
  { 
    id: '1', title: 'Глава 1', subtitle: 'Пробуждение',
    scenes: [{ id: '1-1', title: 'Сцена 1: Темная комната' }, { id: '1-2', title: 'Сцена 2: Побег' }]
  },
  { 
    id: '2', title: 'Глава 2', subtitle: 'Медный город',
    scenes: [{ id: '2-1', title: 'Сцена 1: Врата' }]
  },
  { 
    id: '11', title: 'Глава 11', subtitle: 'Письмо',
    scenes: [{ id: '11-1', title: 'Сцена 1: Утро' }, { id: '11-2', title: 'Сцена 2: Почтальон' }]
  },
  { 
    id: '12', title: 'Глава 12', subtitle: 'Тени прошлого',
    scenes: [{ id: '12-1', title: 'Сцена 1: Дорога к усадьбе' }, { id: '12-2', title: 'Сцена 2: Встреча с Воронцовым' }]
  },
  { 
    id: '13', title: 'Глава 13', subtitle: 'Встреча',
    scenes: []
  },
];

const INITIAL_SUGGESTIONS = [
  {
    id: 1,
    type: 'ПЕРСОНАЖ',
    colorClass: 'bg-rose-100 text-rose-800',
    title: 'Граф Воронцов',
    description: 'Новый персонаж. Упоминается шрам на левой щеке.',
    quote: '«Воронцов усмехнулся, и старый шрам на его левой щеке побелел в лунном свете...»'
  },
  {
    id: 2,
    type: 'ЛОКАЦИЯ',
    colorClass: 'bg-[#e3e8e3] text-[#4a5d4e]',
    title: 'Усадьба Черных Сосен',
    description: 'Новая локация. Заброшенное поместье на окраине.',
    quote: '«Дорога к Усадьбе Черных Сосен давно заросла чертополохом...»'
  },
  {
    id: 3,
    type: 'ПРЕДМЕТ',
    colorClass: 'bg-amber-100 text-amber-800',
    title: 'Серебряный портсигар',
    description: 'Важная деталь. Принадлежал убитому.',
    quote: '«Он достал из внутреннего кармана тяжелый серебряный портсигар с вензелем "А.К."...»'
  }
];

const INITIAL_PARAGRAPHS = [
  "Дорога к Усадьбе Черных Сосен давно заросла чертополохом. Экипаж трясло на каждом ухабе, и Анна невольно вцепилась в кожаный ремешок у окна. Вечерний туман уже начал ползти от реки, окутывая низины густым молочным саваном.",
  "— Мы почти на месте, сударыня, — глухо донесся голос кучера сквозь шум колес.",
  "Она кивнула, хотя он не мог этого видеть. В сумочке на коленях лежал тот самый предмет, ради которого она проделала этот долгий путь. Она нащупала его сквозь тонкую ткань — холодный металл. Он достал из внутреннего кармана тяжелый серебряный портсигар с вензелем \"А.К.\"... Нет, это было воспоминание. Воспоминание о той ночи.",
  "Внезапно лошади всхрапнули и резко остановились. Дверца кареты распахнулась, впуская сырой осенний воздух. На пороге стоял высокий человек в темном пальто. Воронцов усмехнулся, и старый шрам на его левой щеке побелел в лунном свете.",
  "— Вы все-таки приехали, Анна Николаевна, — произнес он мягко, но в этом тоне слышалась скрытая угроза."
];

export default function Editor() {
  const { id } = useParams();
  const [activeSceneId, setActiveSceneId] = useState('12-2');
  const [expandedChapterId, setExpandedChapterId] = useState<string | null>('12');
  const [isBibleOpen, setIsBibleOpen] = useState(false);

  const toggleChapter = (chapterId: string) => {
    setExpandedChapterId(prev => prev === chapterId ? null : chapterId);
  };
  const [activeBibleTab, setActiveBibleTab] = useState('inbox');
  const [isExtracting, setIsExtracting] = useState(false);
  const [suggestions, setSuggestions] = useState<{id: number, type: string, colorClass: string, title: string, description: string, quote: string}[]>([]);
  const [wordCount, setWordCount] = useState(2847);
  const [isBibleDropdownOpen, setIsBibleDropdownOpen] = useState(false);
  const [isDictating, setIsDictating] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isCoauthoring, setIsCoauthoring] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [paragraphs, setParagraphs] = useState(INITIAL_PARAGRAPHS);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsBibleDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const BIBLE_MENU_ITEMS = [
    { id: 'inbox', label: 'Новое', icon: Bell },
    { id: 'characters', label: 'Персонажи', icon: Users },
    { id: 'locations', label: 'Локации', icon: MapPin },
    { id: 'items', label: 'Предметы', icon: Box },
    { id: 'rules', label: 'Правила мира', icon: Globe },
  ];

  const handleBibleMenuClick = (tabId: string) => {
    setActiveBibleTab(tabId);
    setIsBibleOpen(true);
    setIsBibleDropdownOpen(false);
  };

  const handleExtract = () => {
    setIsExtracting(true);
    setTimeout(() => {
      setSuggestions(INITIAL_SUGGESTIONS);
      setIsExtracting(false);
    }, 1500);
  };

  const dismissSuggestion = (id: number) => {
    setSuggestions(prev => prev.filter(s => s.id !== id));
  };

  return (
    <>
      <style>{`
        @keyframes waveform {
          0% { height: 4px; }
          100% { height: 16px; }
        }
        .animate-waveform {
          animation: waveform 0.4s ease-in-out infinite alternate;
        }
      `}</style>
      <div className="flex h-screen w-full bg-[#f5f0e8] overflow-hidden font-sans text-[#1e2d1f]">
      
      {/* Left Sidebar (220px) */}
      <aside className="w-[220px] bg-[#1e2d1f] text-white/80 flex flex-col flex-shrink-0 shadow-xl z-20">
        <div className="p-4 flex items-center gap-3 border-b border-white/10">
          <Link to="/dashboard" className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white/60 hover:text-white">
            <ChevronLeft size={18} />
          </Link>
          <span className="font-serif font-medium text-white tracking-wide">Перо</span>
        </div>

        <div className="p-3 space-y-1 border-b border-white/10">
          <button 
            onClick={() => setIsBibleOpen(!isBibleOpen)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${isBibleOpen ? 'bg-white/15 text-white' : 'hover:bg-white/10'}`}
          >
            <BookOpen size={16} className={isBibleOpen ? 'text-amber-200' : 'text-white/50'} />
            Библия истории
          </button>
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-white/10">
            <Sparkles size={16} className="text-purple-300" />
            ИИ-Соавтор
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
          <div className="flex items-center justify-between px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1 mt-2">
            <span>Главы</span>
            <button className="hover:text-white transition-colors"><Plus size={14} /></button>
          </div>
          {MOCK_CHAPTERS.map(chapter => {
            const isChapterActive = chapter.scenes.some(s => s.id === activeSceneId) || activeSceneId === chapter.id;
            return (
            <div key={chapter.id} className="mb-0.5">
              <div
                onClick={() => toggleChapter(chapter.id)}
                className={`w-full flex items-start gap-2 px-2 py-2 rounded-lg text-sm transition-colors text-left cursor-pointer ${
                  isChapterActive 
                    ? 'bg-[rgba(255,255,255,0.08)]' 
                    : 'bg-transparent hover:bg-white/5'
                }`}
              >
                <div className="mt-1 text-[#f5f0e8]/40 transition-colors">
                  {expandedChapterId === chapter.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </div>
                <div className="mt-1 flex-shrink-0 relative">
                  <FileText size={14} className="text-[#f5f0e8]/50" />
                </div>
                <div className="flex flex-col overflow-hidden">
                  <span className={`truncate ${isChapterActive ? 'text-white font-medium' : 'text-[#f5f0e8]/60'}`}>
                    {chapter.title}
                  </span>
                  <span className={`text-[11px] truncate mt-0.5 ${isChapterActive ? 'text-white font-medium' : 'text-[#f5f0e8]/40'}`}>
                    {chapter.subtitle}
                  </span>
                </div>
              </div>
              
              {expandedChapterId === chapter.id && chapter.scenes.length > 0 && (
                <div className="ml-5 pl-3 border-l border-white/10 mt-1 mb-2 space-y-0.5">
                  {chapter.scenes.map(scene => {
                    const isSceneActive = activeSceneId === scene.id;
                    return (
                    <button
                      key={scene.id}
                      onClick={() => setActiveSceneId(scene.id)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors text-left ${
                        isSceneActive 
                          ? 'bg-[rgba(255,255,255,0.08)] text-white font-medium' 
                          : 'bg-transparent text-[#f5f0e8]/60 hover:bg-white/5'
                      }`}
                    >
                      <span className="truncate">{scene.title}</span>
                    </button>
                  )})}
                </div>
              )}
            </div>
          )})}
        </div>

        <div className="p-4 border-t border-white/10 bg-white/5">
          <div className="flex items-center justify-between text-[11px] font-medium text-white/50 mb-2">
            <span>Прогресс</span>
            <span>45 000 / 80 000 слов</span>
          </div>
          <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-white/40 w-[56%] rounded-full" />
          </div>
        </div>
      </aside>

      {/* Center Editor */}
      <main className="flex-1 flex flex-col relative bg-white shadow-[-10px_0_20px_rgba(0,0,0,0.02)] z-10 transition-all duration-300">
        
        <div className="flex-1 overflow-y-auto flex justify-center pt-20 pb-40 px-12">
          <div className="w-full max-w-2xl">
            <h1 className="text-3xl font-serif italic text-[#1e2d1f]/80 mb-10 text-center outline-none" contentEditable suppressContentEditableWarning>
              Глава 12. Тени прошлого
            </h1>
            
            <div 
              className="outline-none text-lg leading-[1.8] font-serif text-[#1e2d1f]/90 min-h-[50vh] text-justify"
              contentEditable
              suppressContentEditableWarning
            >
              {paragraphs.map((p, i) => (
                <p key={i} className="mb-6 indent-8">
                  {p}
                  {i === paragraphs.length - 1 && isDictating && (
                    <span className="text-[#1e2d1f]/50 italic ml-2">
                      Я знал, что вы не сможете остаться в стороне...<span className="animate-pulse">|</span>
                    </span>
                  )}
                </p>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Floating Toolbar */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-stretch gap-3 z-40">
          {/* Read Aloud Bar */}
          {isReading && (
            <div className="bg-[#1e2d1f] rounded-[16px] px-4 py-3 flex items-center justify-between shadow-lg animate-in slide-in-from-bottom-2 fade-in duration-200 relative overflow-hidden">
              <div className="absolute bottom-0 left-0 w-full h-1 bg-[#f5f0e8]/10">
                <div className="h-full bg-[#f5f0e8]/50 w-[45%]" />
              </div>
              
              <div className="flex-1 flex justify-center">
                <span className="text-[#f5f0e8] text-sm italic font-medium mx-6">
                  Она нащупала его сквозь тонкую ткань — холодный металл.
                </span>
              </div>
              
              <div className="flex items-center gap-3 text-white/80 relative z-10">
                <button className="hover:text-white transition-colors">
                  <SkipBack size={16} fill="currentColor" />
                </button>
                <button className="hover:text-white transition-colors">
                  <Pause size={16} fill="currentColor" />
                </button>
                <button className="hover:text-white transition-colors">
                  <SkipForward size={16} fill="currentColor" />
                </button>
                <div className="w-px h-4 bg-white/20 mx-1" />
                <button 
                  onClick={() => setIsReading(false)}
                  className="hover:text-white transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          )}

          {/* Main Toolbar */}
          <div className="bg-white/90 backdrop-blur-md shadow-[0_8px_30px_rgba(0,0,0,0.08)] border border-[#1e2d1f]/5 rounded-2xl px-2 py-2 flex items-center gap-1 max-w-[calc(100vw-2rem)] overflow-x-auto hide-scrollbar">
            <button 
              onClick={() => {
                const nextState = !isDictating;
                setIsDictating(nextState);
                if (nextState) {
                  setIsReading(false);
                  setIsCoauthoring(false);
                }
              }}
              className={`flex items-center justify-center w-auto sm:w-[130px] h-[36px] whitespace-nowrap gap-2 px-3 sm:px-4 py-2 transition-colors text-sm font-medium rounded-lg outline-none focus:outline-none focus:ring-0 shrink-0 ${
                isDictating 
                  ? 'bg-[#1e2d1f] text-white' 
                  : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
              }`}
            >
              <Mic size={16} /> <span className="hidden sm:inline">Диктовка</span><span className="sm:hidden">Дикт.</span>
            </button>

            <button 
              onClick={() => {
                const nextState = !isCoauthoring;
                setIsCoauthoring(nextState);
                if (nextState) {
                  setIsDictating(false);
                  setIsReading(false);
                }
              }}
              className={`flex items-center justify-center w-auto sm:w-[130px] h-[36px] whitespace-nowrap gap-2 px-3 sm:px-4 py-2 transition-colors text-sm font-medium rounded-lg outline-none focus:outline-none focus:ring-0 shrink-0 ${
                isCoauthoring 
                  ? 'bg-[#1e2d1f] text-white' 
                  : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
              }`}
            >
              <Sparkles size={16} /> Соавтор
            </button>
            <button 
              onClick={() => {
                const nextState = !isReading;
                setIsReading(nextState);
                if (nextState) {
                  setIsDictating(false);
                  setIsCoauthoring(false);
                }
              }}
              className={`flex items-center justify-center w-auto sm:w-[130px] h-[36px] whitespace-nowrap gap-2 px-3 sm:px-4 py-2 transition-colors text-sm font-medium rounded-lg outline-none focus:outline-none focus:ring-0 shrink-0 ${
                isReading 
                  ? 'bg-[#1e2d1f] text-white' 
                  : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
              }`}
            >
              <Headphones size={16} /> Слушать
            </button>
            <div className="w-px h-6 bg-[#1e2d1f]/10 mx-1 shrink-0" />
            <button 
              onClick={() => setIsSearchOpen(true)}
              className="p-2 rounded-lg outline-none focus:outline-none focus:ring-0 bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f] transition-colors shrink-0"
            >
              <Search size={18} />
            </button>
            <div className="relative shrink-0" ref={dropdownRef}>
              <button 
                onClick={() => setIsBibleDropdownOpen(!isBibleDropdownOpen)}
                className={`p-2 transition-colors rounded-lg outline-none focus:outline-none focus:ring-0 flex items-center justify-center ${
                  isBibleOpen || isBibleDropdownOpen 
                    ? 'bg-[#1e2d1f] text-white' 
                    : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
                }`}
              >
                <BookOpen size={18} />
              </button>

              {isBibleDropdownOpen && (
                <div className="absolute bottom-full right-0 mb-2 w-48 bg-white rounded-xl shadow-[0_4px_20px_rgba(30,45,31,0.1)] border border-[#1e2d1f]/5 py-1.5 z-50 overflow-hidden">
                  {BIBLE_MENU_ITEMS.map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleBibleMenuClick(item.id)}
                      className="w-full flex items-center gap-3 px-4 h-10 text-sm text-[#1e2d1f]/80 hover:text-[#1e2d1f] hover:bg-[#f5f0e8] transition-colors text-left"
                    >
                      <item.icon size={16} className="text-[#1e2d1f]/50" />
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Right Panel: Story Bible (320px) */}
      <aside 
        className={`bg-[#f5f0e8] border-l border-[#1e2d1f]/10 flex flex-col flex-shrink-0 transition-all duration-300 ease-in-out z-20 ${
          isBibleOpen ? 'w-[320px] translate-x-0' : 'w-0 translate-x-full border-none'
        }`}
      >
        <div className="p-5 border-b border-[#1e2d1f]/5 flex justify-between items-center bg-white/40">
          <h2 className="font-serif font-bold text-lg text-[#1e2d1f]">Библия истории</h2>
          <button onClick={() => setIsBibleOpen(false)} className="p-1.5 rounded-md hover:bg-[#1e2d1f]/5 text-[#1e2d1f]/50 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-2 pt-2 border-b border-[#1e2d1f]/5 bg-white/40 overflow-x-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {BIBLE_MENU_ITEMS.map(item => (
            <button 
              key={item.id}
              onClick={() => setActiveBibleTab(item.id)}
              className={`flex-shrink-0 px-3 pb-2.5 pt-1.5 text-xs font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors ${activeBibleTab === item.id ? 'border-[#1e2d1f] text-[#1e2d1f]' : 'border-transparent text-[#1e2d1f]/50 hover:text-[#1e2d1f]/80'}`}
            >
              <item.icon size={14} />
              {item.label}
              {item.id === 'inbox' && suggestions.length > 0 && (
                <span className="bg-rose-500 text-white text-[9px] px-1.5 py-0.5 rounded-full ml-0.5 leading-none">{suggestions.length}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activeBibleTab === 'inbox' && (
            <div className="flex flex-col h-full">
              {suggestions.length === 0 && !isExtracting ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
                  <div className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center mb-4 text-[#1e2d1f]/20">
                    <Sparkles size={24} />
                  </div>
                  <h3 className="font-medium text-[#1e2d1f]/80 mb-2">Нет новых фактов</h3>
                  <p className="text-xs text-[#1e2d1f]/50 mb-6 leading-relaxed">
                    Нажмите кнопку ниже, чтобы ИИ проанализировал текущую главу и нашел новые детали для Библии.
                  </p>
                  <button 
                    onClick={handleExtract}
                    className="bg-[#1e2d1f] text-[#f5f0e8] px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-[#2a3f2b] transition-colors shadow-sm flex items-center gap-2"
                  >
                    <Sparkles size={16} />
                    Извлечь факты
                  </button>
                </div>
              ) : isExtracting ? (
                <div className="flex-1 flex flex-col items-center justify-center">
                  <div className="w-8 h-8 border-2 border-[#1e2d1f]/20 border-t-[#1e2d1f] rounded-full animate-spin mb-4"></div>
                  <span className="text-sm font-medium text-[#1e2d1f]/70">Анализ текста...</span>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold uppercase tracking-widest text-[#1e2d1f]/40">Найдено в тексте</span>
                    <button className="text-xs font-medium text-[#1e2d1f]/60 hover:text-[#1e2d1f]">Одобрить все</button>
                  </div>
                  
                  {suggestions.map(suggestion => (
                    <div key={suggestion.id} className="bg-white rounded-2xl p-4 shadow-sm border border-[#1e2d1f]/5 relative group">
                      <button 
                        onClick={() => dismissSuggestion(suggestion.id)}
                        className="absolute top-3 right-3 p-1 rounded-md text-[#1e2d1f]/30 hover:bg-[#f5f0e8] hover:text-[#1e2d1f] transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <X size={14} />
                      </button>
                      
                      <div className={`inline-block px-2 py-0.5 rounded text-[9px] font-bold tracking-widest mb-2 ${suggestion.colorClass}`}>
                        {suggestion.type}
                      </div>
                      
                      <h4 className="font-serif font-bold text-[#1e2d1f] mb-1">{suggestion.title}</h4>
                      <p className="text-xs text-[#1e2d1f]/70 mb-3">{suggestion.description}</p>
                      
                      <div className="bg-[#f5f0e8] rounded-lg p-3 mb-4">
                        <p className="text-xs font-serif italic text-[#1e2d1f]/80 leading-relaxed">
                          {suggestion.quote}
                        </p>
                      </div>
                      
                      <button 
                        onClick={() => dismissSuggestion(suggestion.id)}
                        className="w-full py-2 rounded-xl bg-[#f5f0e8] hover:bg-[#e8e2d5] text-[#1e2d1f] text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Check size={14} />
                        Одобрить
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {activeBibleTab !== 'inbox' && (
            <div className="flex-1 flex items-center justify-center text-sm text-[#1e2d1f]/40">
              Раздел в разработке
            </div>
          )}
        </div>
      </aside>
    </div>

    <SearchOverlay 
      isOpen={isSearchOpen} 
      onClose={() => setIsSearchOpen(false)} 
      editorText={paragraphs.join('\n\n')}
      onReplace={(newText) => {
        setParagraphs(newText.split('\n\n'));
        // Mock lore extraction on replace
        if (!isExtracting && suggestions.length === 0) {
          setIsExtracting(true);
          setTimeout(() => {
            setIsExtracting(false);
            setSuggestions(INITIAL_SUGGESTIONS);
            setIsBibleOpen(true);
            setActiveBibleTab('inbox');
          }, 1500);
        }
      }}
      onNavigate={(type, id) => {
        setIsSearchOpen(false);
        if (type === 'scene') {
          setActiveSceneId(id);
        } else if (type === 'lore') {
          setIsBibleOpen(true);
          setActiveBibleTab('characters');
        }
      }}
    />
    </>
  );
}
