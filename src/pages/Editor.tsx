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
  SkipForward,
  Send,
  MessageSquare,
  Undo2,
  Redo2,
  Underline,
  Strikethrough,
  Pencil,
  List,
  AlertTriangle,
  Castle,
  Mountain,
  Quote,
  Scale,
  Clock,
  Globe2,
  Bookmark,
  BarChart2,
  ChevronUp,
  User
} from 'lucide-react';

import { FindReplacePopup } from '../components/FindReplacePopup';
import Settings from './Settings';

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
    image: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=400&q=80',
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
    image: 'https://images.unsplash.com/photo-1506748686214-e9df14d4d9d0?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: '3',
    name: 'Серые Утесы',
    type: 'COASTAL ROCKS',
    icon: 'mountain',
    color: 'bg-[#85B8A6]',
    x: 70,
    y: 70,
    image: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=400&q=80',
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
  const [isReferenceOpen, setIsReferenceOpen] = useState(false);
  const [isBibleMenuOpen, setIsBibleMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFormatMenuOpen, setIsFormatMenuOpen] = useState(false);
  const [showWordCount, setShowWordCount] = useState(true);
  const [indentParagraphs, setIndentParagraphs] = useState(false);

  const toggleChapter = (chapterId: string) => {
    setExpandedChapterId(prev => prev === chapterId ? null : chapterId);
  };
  const [activeBibleTab, setActiveBibleTab] = useState('inbox');
  const [isExtracting, setIsExtracting] = useState(false);
  const [suggestions, setSuggestions] = useState<{id: number, type: string, colorClass: string, title: string, description: string, quote: string}[]>([]);
  const [isDictating, setIsDictating] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isCoauthoring, setIsCoauthoring] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [selectedLocId, setSelectedLocId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [paragraphs, setParagraphs] = useState(INITIAL_PARAGRAPHS);
  
  const wordCount = paragraphs.join(' ').split(/\s+/).filter(word => word.length > 0).length;
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'ai', text: string}[]>([
    { role: 'ai', text: 'Привет! Я твой ИИ-соавтор. Чем могу помочь с этой главой?' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parentChapter = MOCK_CHAPTERS.find(c => c.scenes.some(s => s.id === activeSceneId));
    if (parentChapter) {
      setExpandedChapterId(parentChapter.id);
    }
  }, [activeSceneId]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isCoauthoring]);

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
    setIsCoauthoring(false);
    setIsReferenceOpen(false);
    setIsDictating(false);
    setIsReading(false);
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
          <Link 
            to={`/bible/${id}`}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-white/10`}
          >
            <BookOpen size={16} className="text-white/50" />
            Библия истории
          </Link>
          <button 
            onClick={() => {
              const nextState = !isCoauthoring;
              setIsCoauthoring(nextState);
              if (nextState) {
                setIsBibleOpen(false);
                setIsReferenceOpen(false);
              }
            }}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${isCoauthoring ? 'bg-white/15 text-white' : 'hover:bg-white/10'}`}
          >
            <Sparkles size={16} className={isCoauthoring ? 'text-purple-300' : 'text-white/50'} />
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
                className={`w-full flex items-start gap-2 px-2 py-2 rounded-lg text-sm transition-colors text-left ${
                  isChapterActive 
                    ? 'bg-[rgba(255,255,255,0.08)]' 
                    : 'bg-transparent hover:bg-white/5'
                }`}
              >
                <div 
                  className="mt-1 text-[#f5f0e8]/40 transition-colors cursor-pointer hover:text-white p-0.5 -m-0.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Prevent collapsing the active chapter if that's what "remain expanded" implies,
                    // but allow accordion behavior to collapse it if another chapter is expanded.
                    if (isChapterActive && expandedChapterId === chapter.id) return;
                    toggleChapter(chapter.id);
                  }}
                >
                  {expandedChapterId === chapter.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </div>
                <div 
                  className="flex flex-1 gap-2 cursor-pointer overflow-hidden"
                  onClick={() => {
                    setActiveSceneId(chapter.scenes.length > 0 ? chapter.scenes[0].id : chapter.id);
                    setExpandedChapterId(chapter.id);
                  }}
                >
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

        <div className="p-4 border-t border-white/10 bg-[#1e2d1f]">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between border-2 border-[#1a56db] rounded-md px-3 py-2.5 text-white bg-[#1e2d1f]">
              <div className="flex items-center gap-2.5">
                <BarChart2 size={18} strokeWidth={2} />
                <span className="font-semibold text-[15px] tracking-wide">Statistics</span>
              </div>
              <ChevronUp size={16} className="text-white/60" strokeWidth={2} />
            </div>
            
            <div className="flex flex-col gap-3.5 px-1">
              <div className="flex items-center justify-between">
                <span className="text-white/60 font-medium text-[13px] tracking-wide">Total Words</span>
                <span className="text-white font-bold text-[13px] tracking-wide">7,460</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/60 font-medium text-[13px] tracking-wide">Avg. Session</span>
                <span className="text-white font-bold text-[13px] tracking-wide">45 min</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/60 font-medium text-[13px] tracking-wide">Streak</span>
                <span className="text-white font-bold text-[13px] tracking-wide">12 days</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Center Editor */}
      <main className="flex-1 flex flex-col relative bg-white shadow-[-10px_0_20px_rgba(0,0,0,0.02)] z-10 transition-all duration-300">
        
        {/* Top Formatting Toolbar */}
        <div className="h-14 border-b border-[#1e2d1f]/5 bg-white flex items-center justify-between px-6 sticky top-0 z-30 shrink-0">
          <div className="w-8" /> {/* Spacer for balance */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <button className="text-[#a1a1aa] hover:text-[#1e2d1f] transition-colors">
                <Undo2 size={20} strokeWidth={2.5} />
              </button>
              <button className="text-[#a1a1aa] hover:text-[#1e2d1f] transition-colors">
                <Redo2 size={20} strokeWidth={2.5} />
              </button>
            </div>
            
            <div className="flex items-center gap-4">
              <button className="text-[#a1a1aa] hover:text-[#1e2d1f] transition-colors">
                <Bold size={20} strokeWidth={2.5} />
              </button>
              <button className="text-[#a1a1aa] hover:text-[#1e2d1f] transition-colors">
                <Italic size={20} strokeWidth={2.5} />
              </button>
              <button className="text-[#a1a1aa] hover:text-[#1e2d1f] transition-colors">
                <Underline size={20} strokeWidth={2.5} />
              </button>
              <button className="text-[#a1a1aa] hover:text-[#1e2d1f] transition-colors">
                <Strikethrough size={20} strokeWidth={2.5} />
              </button>
              <button className="text-[#a1a1aa] hover:text-[#1e2d1f] transition-colors">
                <Pencil size={18} strokeWidth={2.5} />
              </button>
            </div>
            
            <div className="flex items-center">
              <button className="text-[#a1a1aa] hover:text-[#1e2d1f] transition-colors">
                <List size={22} strokeWidth={2.5} />
              </button>
            </div>
            
            <div className="flex items-center gap-2 relative">
              <button 
                onClick={() => setIsFormatMenuOpen(!isFormatMenuOpen)}
                className={`px-3 py-1.5 font-serif font-bold rounded-lg transition-colors text-[16px] ${isFormatMenuOpen ? 'bg-[#1e2d1f] text-white' : 'bg-[#f4f4f5] text-[#1e2d1f]'}`}
              >
                Aa
              </button>
              
              {isFormatMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsFormatMenuOpen(false)} />
                  <div className="absolute top-full mt-2 left-0 w-64 bg-[#2d3748] rounded-xl shadow-xl border border-white/10 p-5 z-50 flex flex-col gap-5">
                    {/* Show word count */}
                    <div className="flex items-center gap-4 cursor-pointer" onClick={() => setShowWordCount(!showWordCount)}>
                      <button 
                        className={`w-[52px] h-7 rounded-full transition-colors relative shrink-0 ${showWordCount ? 'bg-[#bca4ff]' : 'bg-[#4b5563] ring-2 ring-[#6b21a8]'}`}
                      >
                        <div className={`w-6 h-6 rounded-full bg-white absolute top-0.5 transition-transform ${showWordCount ? 'translate-x-[26px] left-0' : 'translate-x-0.5 left-0'}`} />
                      </button>
                      <span className="text-white text-[15px] font-medium tracking-wide">Количество слов</span>
                    </div>
                    
                    {/* Indent paragraphs */}
                    <div className="flex items-center gap-4 cursor-pointer" onClick={() => setIndentParagraphs(!indentParagraphs)}>
                      <button 
                        className={`w-[52px] h-7 rounded-full transition-colors relative shrink-0 ${indentParagraphs ? 'bg-[#bca4ff]' : 'bg-[#4b5563] ring-2 ring-[#6b21a8]'}`}
                      >
                        <div className={`w-6 h-6 rounded-full bg-white absolute top-0.5 transition-transform ${indentParagraphs ? 'translate-x-[26px] left-0' : 'translate-x-0.5 left-0'}`} />
                      </button>
                      <span className="text-white text-[15px] font-medium tracking-wide">Отступ абзацев</span>
                    </div>
                  </div>
                </>
              )}

              <button className="px-2 py-1.5 text-[#a1a1aa] hover:text-[#1e2d1f] font-serif font-bold transition-colors text-[16px]">
                H1
              </button>
              <button className="px-2 py-1.5 text-[#a1a1aa] hover:text-[#1e2d1f] font-serif font-bold transition-colors text-[16px]">
                H2
              </button>
              <button className="px-2 py-1.5 text-[#a1a1aa] hover:text-[#1e2d1f] font-serif font-bold transition-colors text-[16px]">
                H3
              </button>
            </div>
          </div>
          
          <button 
            onClick={() => setIsSettingsOpen(true)} 
            className="w-8 h-8 rounded-full bg-black/5 hover:bg-black/10 border-none cursor-pointer flex items-center justify-center text-black/50 hover:text-black/80 transition-colors flex-shrink-0"
          >
            <User size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto flex justify-center pt-12 pb-40 px-12">
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
                <p key={i} className={`mb-6 ${indentParagraphs ? 'indent-8' : ''}`}>
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

        {showWordCount && (
          <div className="absolute bottom-6 right-6 bg-white/90 backdrop-blur-md shadow-sm border border-[#1e2d1f]/5 rounded-xl px-4 py-2 flex items-center gap-2 z-30">
            <span className="text-[#1e2d1f]/60 font-medium text-sm">Слов:</span>
            <span className="text-[#1e2d1f] font-bold text-sm">{wordCount}</span>
          </div>
        )}

        {isBibleMenuOpen && (
          <div 
            className="fixed inset-0 z-30"
            onClick={() => setIsBibleMenuOpen(false)}
          />
        )}

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
          <div className="relative">
            {isBibleMenuOpen && (
              <div className="absolute bottom-full mb-2 right-0 w-48 bg-white rounded-xl shadow-xl border border-[#1e2d1f]/10 py-2 z-50">
                  <div className="px-4 py-2 text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">
                    Библия истории
                  </div>
                  {BIBLE_MENU_ITEMS.map(item => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          handleBibleMenuClick(item.id);
                          setIsBibleMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-[#f5f0e8] transition-colors"
                      >
                        <Icon size={16} className="text-[#1e2d1f]/40" />
                        <span className="font-medium text-[#1e2d1f]">{item.label}</span>
                      </button>
                    );
                  })}
                  {isBibleOpen && (
                    <>
                      <div className="h-px bg-black/5 my-1 mx-2" />
                      <button
                        onClick={() => {
                          setIsBibleOpen(false);
                          setIsBibleMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-red-50 text-red-600 transition-colors"
                      >
                        <X size={16} className="text-red-500/70" />
                        <span className="font-medium">Закрыть панель</span>
                      </button>
                    </>
                  )}
                </div>
            )}
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
                    setIsBibleOpen(false);
                    setIsReferenceOpen(false);
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
              <button 
                onClick={() => setIsBibleMenuOpen(!isBibleMenuOpen)}
                className={`p-2 transition-colors rounded-lg outline-none focus:outline-none focus:ring-0 flex items-center justify-center shrink-0 ${
                  isBibleOpen || isBibleMenuOpen
                    ? 'bg-[#1e2d1f] text-white' 
                    : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
                }`}
                title="Библия истории"
              >
                <BookOpen size={18} />
              </button>
              <button 
                onClick={() => {
                  const nextState = !isReferenceOpen;
                  setIsReferenceOpen(nextState);
                  if (nextState) {
                    setIsBibleOpen(false);
                    setIsCoauthoring(false);
                    setIsDictating(false);
                    setIsReading(false);
                  }
                }}
                className={`p-2 transition-colors rounded-lg outline-none focus:outline-none focus:ring-0 flex items-center justify-center shrink-0 ${
                  isReferenceOpen
                    ? 'bg-[#1e2d1f] text-white' 
                    : 'bg-transparent text-[#6b7280] hover:bg-[#f5f0e8] hover:text-[#1e2d1f]'
                }`}
                title="Справочник главы"
              >
                <Bookmark size={18} />
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Right Panel: Story Bible, AI Co-author, or Reference (320px) */}
      <aside 
        className={`bg-[#f5f0e8] border-l border-[#1e2d1f]/10 flex flex-col flex-shrink-0 transition-all duration-300 ease-in-out z-20 ${
          (isBibleOpen || isCoauthoring || isReferenceOpen) ? 'w-[320px] translate-x-0' : 'w-0 translate-x-full border-none'
        }`}
      >
        {isBibleOpen && (
          <div className="flex flex-col h-full w-[320px]">
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
              
              {activeBibleTab === 'characters' && (
                <div className="flex flex-col">
                  {selectedCharId ? (() => {
                    const selectedChar = MOCK_CHARACTERS.find(c => c.id === selectedCharId);
                    if (!selectedChar) return null;
                    return (
                      <div className="flex flex-col">
                        <button 
                          onClick={() => setSelectedCharId(null)} 
                          className="flex items-center gap-2 text-xs text-[#1e2d1f]/60 hover:text-[#1e2d1f] mb-6 transition-colors"
                        >
                          <ChevronLeft size={14} /> Назад к списку
                        </button>
                        
                        <div className="flex flex-col items-center text-center mb-6">
                          <div className="w-24 h-24 rounded-full p-1 bg-white shadow-md mb-4 relative">
                            <div className="w-full h-full rounded-full overflow-hidden bg-[#f3d3c1]">
                              <img 
                                src={selectedChar.image} 
                                alt={selectedChar.name} 
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            </div>
                          </div>
                          <h2 className="text-xl font-bold text-[#1a1a1a] mb-1">{selectedChar.name}</h2>
                          <p className="text-[11px] font-bold text-[#4A90E2] uppercase tracking-wider mb-3">
                            {selectedChar.role}
                          </p>
                          
                          {selectedChar.incomplete && (
                            <div className="inline-flex items-center gap-1.5 bg-[#FFF4E5] text-[#B86B11] px-2.5 py-1 rounded-full text-[9px] font-bold tracking-wider uppercase border border-[#FFE0B2]">
                              <AlertTriangle size={12} />
                              Incomplete Bio
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col gap-5">
                          {selectedChar.appearance && (
                            <div>
                              <h4 className="text-[10px] font-bold text-black/40 uppercase tracking-wider mb-2 ml-1">
                                Внешность
                              </h4>
                              <div className="bg-white p-4 rounded-xl border border-black/5 shadow-sm text-[13px] leading-relaxed text-black/80">
                                {selectedChar.appearance}
                              </div>
                            </div>
                          )}

                          {selectedChar.motivation && (
                            <div>
                              <h4 className="text-[10px] font-bold text-black/40 uppercase tracking-wider mb-2 ml-1">
                                Мотивация
                              </h4>
                              <div className="bg-white p-4 rounded-xl border border-black/5 shadow-sm text-[13px] leading-relaxed text-black/80 italic">
                                {selectedChar.motivation}
                              </div>
                            </div>
                          )}

                          <div className="mt-2 flex flex-col gap-3">
                            <button className="w-full bg-[#2C3E2D] hover:bg-[#1e2b1f] text-white py-3 rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition-colors shadow-sm">
                              <Sparkles size={14} />
                              Спросить AI
                            </button>
                            <button className="text-[11px] text-black/40 hover:text-black/60 underline underline-offset-4 transition-colors text-center">
                              Редактировать
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })() : (
                    <div className="grid grid-cols-2 gap-3">
                      {MOCK_CHARACTERS.map(char => (
                        <div 
                          key={char.id}
                          onClick={() => setSelectedCharId(char.id)}
                          className="group cursor-pointer rounded-xl p-2 transition-all border border-transparent hover:bg-white hover:shadow-sm"
                        >
                          <div className="relative aspect-square rounded-lg overflow-hidden mb-3 bg-black/5">
                            <img 
                              src={char.image} 
                              alt={char.name} 
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                          <div className="px-1 text-center">
                            <h3 className="font-bold text-[14px] text-[#1a1a1a] mb-0.5 truncate">{char.name}</h3>
                            <p className="text-[9px] font-bold text-black/40 uppercase tracking-wider truncate">
                              {char.role}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeBibleTab === 'locations' && (
                <div className="flex flex-col">
                  {selectedLocId ? (() => {
                    const selectedLoc = MOCK_LOCATIONS.find(l => l.id === selectedLocId);
                    if (!selectedLoc) return null;
                    return (
                      <div className="flex flex-col">
                        <button 
                          onClick={() => setSelectedLocId(null)} 
                          className="flex items-center gap-2 text-xs text-[#1e2d1f]/60 hover:text-[#1e2d1f] mb-6 transition-colors"
                        >
                          <ChevronLeft size={14} /> Назад к списку
                        </button>
                        
                        <div className="flex flex-col items-center text-center mb-6">
                          <div className={`w-24 h-24 rounded-full p-1 bg-white shadow-md mb-4 relative`}>
                            <div className={`w-full h-full rounded-full flex items-center justify-center text-white ${selectedLoc.color}`}>
                              {selectedLoc.icon === 'castle' ? <Castle size={36} /> : <Mountain size={36} />}
                            </div>
                          </div>
                          <h2 className="text-xl font-bold text-[#1a1a1a] mb-1">{selectedLoc.name}</h2>
                          <p className="text-[11px] font-bold text-[#4A90E2] uppercase tracking-wider mb-3">
                            {selectedLoc.type}
                          </p>
                        </div>

                        <div className="flex flex-col gap-5">
                          {selectedLoc.description && (
                            <div>
                              <h4 className="text-[10px] font-bold text-black/40 uppercase tracking-wider mb-2 ml-1">
                                Описание
                              </h4>
                              <div className="bg-white p-4 rounded-xl border border-black/5 shadow-sm text-[13px] leading-relaxed text-black/80">
                                {selectedLoc.description}
                              </div>
                            </div>
                          )}

                          {selectedLoc.history && (
                            <div>
                              <h4 className="text-[10px] font-bold text-black/40 uppercase tracking-wider mb-2 ml-1">
                                История
                              </h4>
                              <div className="bg-white p-4 rounded-xl border border-black/5 shadow-sm text-[13px] leading-relaxed text-black/80 italic relative">
                                <Quote size={16} className="absolute -top-2 -left-1 text-black/10 rotate-180" />
                                {selectedLoc.history}
                              </div>
                            </div>
                          )}

                          <div className="mt-2 flex flex-col gap-3">
                            <button className="w-full bg-[#2C3E2D] hover:bg-[#1e2b1f] text-white py-3 rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition-colors shadow-sm">
                              <Sparkles size={14} />
                              Спросить AI
                            </button>
                            <button className="text-[11px] text-black/40 hover:text-black/60 underline underline-offset-4 transition-colors text-center">
                              Редактировать
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })() : (
                    <div className="grid grid-cols-2 gap-3">
                      {MOCK_LOCATIONS.map(loc => (
                        <div 
                          key={loc.id}
                          onClick={() => setSelectedLocId(loc.id)}
                          className="group cursor-pointer rounded-xl p-2 transition-all border border-transparent hover:bg-white hover:shadow-sm flex flex-col items-center text-center"
                        >
                          <div className={`w-16 h-16 rounded-full flex items-center justify-center text-white shadow-sm mb-3 ${loc.color}`}>
                            {loc.icon === 'castle' ? <Castle size={24} /> : <Mountain size={24} />}
                          </div>
                          <h3 className="font-bold text-[14px] text-[#1a1a1a] mb-0.5 truncate w-full">{loc.name}</h3>
                          <p className="text-[9px] font-bold text-black/40 uppercase tracking-wider truncate w-full">
                            {loc.type}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeBibleTab === 'items' && (
                <div className="flex flex-col">
                  {selectedItemId ? (() => {
                    const selectedItem = MOCK_ITEMS.find(i => i.id === selectedItemId);
                    if (!selectedItem) return null;
                    return (
                      <div className="flex flex-col">
                        <button 
                          onClick={() => setSelectedItemId(null)} 
                          className="flex items-center gap-2 text-xs text-[#1e2d1f]/60 hover:text-[#1e2d1f] mb-6 transition-colors"
                        >
                          <ChevronLeft size={14} /> Назад к списку
                        </button>
                        
                        <div className="flex flex-col items-center text-center mb-6">
                          <div className="w-24 h-24 rounded-full p-1 bg-white shadow-md mb-4 relative">
                            <div className="w-full h-full rounded-full overflow-hidden bg-[#f3d3c1]">
                              <img 
                                src={selectedItem.image} 
                                alt={selectedItem.name} 
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            </div>
                          </div>
                          <h2 className="text-xl font-bold text-[#1a1a1a] mb-1">{selectedItem.name}</h2>
                          <p className="text-[11px] font-bold text-[#4A90E2] uppercase tracking-wider mb-3">
                            {selectedItem.type}
                          </p>
                          
                          {selectedItem.incomplete && (
                            <div className="inline-flex items-center gap-1.5 bg-[#FFF4E5] text-[#B86B11] px-2.5 py-1 rounded-full text-[9px] font-bold tracking-wider uppercase border border-[#FFE0B2]">
                              <AlertTriangle size={12} />
                              Incomplete Data
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col gap-5">
                          {selectedItem.description && (
                            <div>
                              <h4 className="text-[10px] font-bold text-black/40 uppercase tracking-wider mb-2 ml-1">
                                Описание
                              </h4>
                              <div className="bg-white p-4 rounded-xl border border-black/5 shadow-sm text-[13px] leading-relaxed text-black/80">
                                {selectedItem.description}
                              </div>
                            </div>
                          )}

                          {selectedItem.history && (
                            <div>
                              <h4 className="text-[10px] font-bold text-black/40 uppercase tracking-wider mb-2 ml-1">
                                История
                              </h4>
                              <div className="bg-white p-4 rounded-xl border border-black/5 shadow-sm text-[13px] leading-relaxed text-black/80 italic relative">
                                <Quote size={16} className="absolute -top-2 -left-1 text-black/10 rotate-180" />
                                {selectedItem.history}
                              </div>
                            </div>
                          )}

                          <div className="mt-2 flex flex-col gap-3">
                            <button className="w-full bg-[#2C3E2D] hover:bg-[#1e2b1f] text-white py-3 rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition-colors shadow-sm">
                              <Sparkles size={14} />
                              Спросить AI
                            </button>
                            <button className="text-[11px] text-black/40 hover:text-black/60 underline underline-offset-4 transition-colors text-center">
                              Редактировать
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })() : (
                    <div className="grid grid-cols-2 gap-3">
                      {MOCK_ITEMS.map(item => (
                        <div 
                          key={item.id}
                          onClick={() => setSelectedItemId(item.id)}
                          className="group cursor-pointer rounded-xl p-2 transition-all border border-transparent hover:bg-white hover:shadow-sm"
                        >
                          <div className="relative aspect-square rounded-lg overflow-hidden mb-3 bg-black/5">
                            <img 
                              src={item.image} 
                              alt={item.name} 
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                          <div className="px-1 text-center">
                            <h3 className="font-bold text-[14px] text-[#1a1a1a] mb-0.5 truncate">{item.name}</h3>
                            <p className="text-[9px] font-bold text-black/40 uppercase tracking-wider truncate">
                              {item.type}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeBibleTab === 'rules' && (
                <div className="flex flex-col">
                  {selectedRuleId ? (() => {
                    const selectedRule = MOCK_RULES.find(r => r.id === selectedRuleId);
                    if (!selectedRule) return null;
                    
                    let Icon = Sparkles;
                    if (selectedRule.icon === 'scale') Icon = Scale;
                    if (selectedRule.icon === 'clock') Icon = Clock;
                    if (selectedRule.icon === 'globe') Icon = Globe2;

                    return (
                      <div className="flex flex-col">
                        <button 
                          onClick={() => setSelectedRuleId(null)} 
                          className="flex items-center gap-2 text-xs text-[#1e2d1f]/60 hover:text-[#1e2d1f] mb-6 transition-colors"
                        >
                          <ChevronLeft size={14} /> Назад к списку
                        </button>
                        
                        <div className="flex flex-col items-center text-center mb-6">
                          <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-4 ${selectedRule.color} ${selectedRule.iconColor} border border-black/5 shadow-sm`}>
                            <Icon size={32} />
                          </div>
                          <h2 className="text-xl font-bold text-[#1a1a1a] mb-1">{selectedRule.name}</h2>
                          <p className={`text-[11px] font-bold uppercase tracking-wider mb-3 ${
                            selectedRule.type === 'ФУНДАМЕНТАЛЬНОЕ' ? 'text-[#D35400]' : 'text-black/40'
                          }`}>
                            {selectedRule.type}
                          </p>
                          {selectedRule.shortDescription && (
                            <p className="text-[12px] text-black/60 leading-relaxed max-w-[240px]">
                              {selectedRule.shortDescription}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-col gap-5">
                          {selectedRule.description && (
                            <div>
                              <div className="flex items-center gap-2 mb-3">
                                <div className="w-1.5 h-1.5 rounded-full bg-[#D35400]" />
                                <h4 className="text-[10px] font-bold text-black/40 uppercase tracking-widest">
                                  ОПИСАНИЕ
                                </h4>
                              </div>
                              <div className="text-[13px] leading-relaxed text-black/80 italic font-serif bg-white p-4 rounded-xl border border-black/5 shadow-sm">
                                {selectedRule.description}
                              </div>
                            </div>
                          )}

                          {selectedRule.history && (
                            <div>
                              <div className="flex items-center gap-2 mb-3">
                                <div className="w-1.5 h-1.5 rounded-full bg-black/20" />
                                <h4 className="text-[10px] font-bold text-black/40 uppercase tracking-widest">
                                  ИСТОРИЯ
                                </h4>
                              </div>
                              <div className="text-[13px] leading-relaxed text-black/70 font-serif bg-white p-4 rounded-xl border border-black/5 shadow-sm">
                                {selectedRule.history}
                              </div>
                            </div>
                          )}

                          <div className="mt-2 flex flex-col gap-3">
                            <button className="w-full bg-[#2C3E2D] hover:bg-[#1e2b1f] text-white py-3 rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition-colors shadow-sm">
                              <Sparkles size={14} />
                              Спросить AI
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })() : (
                    <div className="flex flex-col gap-3">
                      {MOCK_RULES.map(rule => {
                        let Icon = Sparkles;
                        if (rule.icon === 'scale') Icon = Scale;
                        if (rule.icon === 'clock') Icon = Clock;
                        if (rule.icon === 'globe') Icon = Globe2;

                        return (
                          <div 
                            key={rule.id}
                            onClick={() => setSelectedRuleId(rule.id)}
                            className="group cursor-pointer rounded-xl p-4 transition-all bg-white border border-transparent hover:border-black/10 hover:shadow-sm flex items-center gap-4"
                          >
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${rule.color} ${rule.iconColor}`}>
                              <Icon size={20} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-bold text-[14px] text-[#1a1a1a] mb-0.5 truncate">{rule.name}</h3>
                              <p className={`text-[9px] font-bold uppercase tracking-wider truncate ${
                                rule.type === 'ФУНДАМЕНТАЛЬНОЕ' ? 'text-[#D35400]' : 'text-black/40'
                              }`}>
                                {rule.type}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {isCoauthoring && (
          <div className="flex flex-col h-full w-[320px]">
            <div className="p-5 border-b border-[#1e2d1f]/5 flex justify-between items-center bg-white/40">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-purple-500" />
                <h2 className="font-serif font-bold text-lg text-[#1e2d1f]">ИИ-Соавтор</h2>
              </div>
              <button onClick={() => setIsCoauthoring(false)} className="p-1.5 rounded-md hover:bg-[#1e2d1f]/5 text-[#1e2d1f]/50 transition-colors">
                <X size={18} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {chatMessages.map((msg, idx) => (
                <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                    msg.role === 'user' 
                      ? 'bg-[#1e2d1f] text-white rounded-br-sm' 
                      : 'bg-white border border-[#1e2d1f]/10 text-[#1e2d1f] rounded-bl-sm shadow-sm'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="p-4 bg-white/40 border-t border-[#1e2d1f]/5">
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && chatInput.trim()) {
                      setChatMessages(prev => [...prev, { role: 'user', text: chatInput.trim() }]);
                      setChatInput('');
                      setTimeout(() => {
                        setChatMessages(prev => [...prev, { role: 'ai', text: 'Отличная идея! Давайте добавим больше деталей к этой сцене.' }]);
                      }, 1000);
                    }
                  }}
                  placeholder="Спросите соавтора..."
                  className="w-full bg-white border border-[#1e2d1f]/10 rounded-full pl-4 pr-10 py-2.5 text-sm outline-none focus:border-[#1e2d1f]/30 transition-colors shadow-sm"
                />
                <button 
                  onClick={() => {
                    if (chatInput.trim()) {
                      setChatMessages(prev => [...prev, { role: 'user', text: chatInput.trim() }]);
                      setChatInput('');
                      setTimeout(() => {
                        setChatMessages(prev => [...prev, { role: 'ai', text: 'Отличная идея! Давайте добавим больше деталей к этой сцене.' }]);
                      }, 1000);
                    }
                  }}
                  className="absolute right-1.5 p-1.5 bg-[#1e2d1f] text-white rounded-full hover:bg-[#2a3f2b] transition-colors"
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          </div>
        )}

        {isReferenceOpen && (
          <div className="flex flex-col h-full w-[320px]">
            <div className="p-5 border-b border-[#1e2d1f]/5 flex justify-between items-center bg-white/40">
              <div className="flex items-center gap-2">
                <Bookmark size={18} className="text-[#1e2d1f]" />
                <h2 className="font-serif font-bold text-lg text-[#1e2d1f] uppercase tracking-wider">Справочник</h2>
              </div>
              <button onClick={() => setIsReferenceOpen(false)} className="p-1.5 rounded-md hover:bg-[#1e2d1f]/5 text-[#1e2d1f]/50 transition-colors">
                <X size={18} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* Characters Section */}
              <div>
                <div className="flex items-center gap-2 text-[#1e2d1f]/60 font-medium text-base mb-3">
                  <Users size={18} />
                  <span>Упомянутые персонажи (1)</span>
                </div>
                <div className="space-y-2">
                  {MOCK_CHARACTERS.slice(0, 1).map(char => (
                    <div key={char.id} className="bg-white/60 rounded-xl p-3 shadow-sm border border-[#1e2d1f]/5 hover:bg-white transition-colors cursor-pointer flex gap-3">
                      <div className="w-12 h-12 rounded-full overflow-hidden shrink-0 bg-[#1e2d1f]/5">
                        <img src={char.image} alt={char.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <h4 className="font-bold text-base text-[#1e2d1f] truncate">{char.name}</h4>
                        <p className="text-sm text-[#1e2d1f]/60 line-clamp-2 mt-0.5">{char.appearance || char.role}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Locations Section */}
              <div>
                <div className="flex items-center gap-2 text-[#1e2d1f]/60 font-medium text-base mb-3">
                  <MapPin size={18} />
                  <span>Локации (1)</span>
                </div>
                <div className="space-y-2">
                  {MOCK_LOCATIONS.slice(0, 1).map(loc => (
                    <div key={loc.id} className="bg-white/60 rounded-xl p-3 shadow-sm border border-[#1e2d1f]/5 hover:bg-white transition-colors cursor-pointer">
                      <h4 className="font-bold text-base text-[#1e2d1f] mb-2">{loc.name}</h4>
                      <div className="h-32 rounded-lg overflow-hidden mb-2 bg-black/5">
                        <img src={loc.image} alt={loc.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      </div>
                      <p className="text-sm text-[#1e2d1f]/60 line-clamp-2">{loc.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Items Section */}
              <div>
                <div className="flex items-center gap-2 text-[#1e2d1f]/60 font-medium text-base mb-3">
                  <Box size={18} />
                  <span>Ключевые предметы (1)</span>
                </div>
                <div className="space-y-2">
                  {MOCK_ITEMS.slice(0, 1).map(item => (
                    <div key={item.id} className="bg-white/60 rounded-xl p-3 shadow-sm border border-[#1e2d1f]/5 hover:bg-white transition-colors cursor-pointer">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-yellow-600"><Box size={16} /></span>
                        <h4 className="font-bold text-base text-[#1e2d1f] truncate">{item.name}</h4>
                      </div>
                      <p className="text-sm text-[#1e2d1f]/60 line-clamp-2">{item.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Rules Section */}
              <div>
                <div className="flex items-center gap-2 text-[#1e2d1f]/60 font-medium text-base mb-3">
                  <Scale size={18} />
                  <span>Правила мира (1)</span>
                </div>
                <div className="space-y-2">
                  {MOCK_RULES.slice(0, 1).map(rule => (
                    <div key={rule.id} className="bg-white/60 rounded-xl p-3 shadow-sm border border-[#1e2d1f]/5 hover:bg-white transition-colors cursor-pointer">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={rule.iconColor || "text-[#1e2d1f]/60"}><Scale size={16} /></span>
                        <h4 className="font-bold text-base text-[#1e2d1f] truncate">{rule.name}</h4>
                      </div>
                      <p className="text-sm text-[#1e2d1f]/60 line-clamp-2">{rule.shortDescription || rule.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>

    <FindReplacePopup 
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
            setIsReferenceOpen(false);
            setIsCoauthoring(false);
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
          setIsReferenceOpen(false);
          setIsCoauthoring(false);
          setActiveBibleTab('characters');
        }
      }}
    />

    {isSettingsOpen && (
      <div className="fixed inset-0 z-[100] bg-[#1e2d1f]/20 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8">
        <div className="bg-[#f8f9fa] rounded-3xl shadow-2xl w-full max-w-5xl max-h-full overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
          <Settings 
            onClose={() => setIsSettingsOpen(false)} 
            showWordCount={showWordCount}
            setShowWordCount={setShowWordCount}
            indentParagraphs={indentParagraphs}
            setIndentParagraphs={setIndentParagraphs}
          />
        </div>
      </div>
    )}
    </>
  );
}
