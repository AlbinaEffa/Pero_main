import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Save, Pencil, Moon, Volume2, Sparkles, Lock, Shield, LogOut, ChevronRight, ChevronLeft, Type, AlignLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Settings({ 
  onClose,
  showWordCount: externalShowWordCount,
  setShowWordCount: externalSetShowWordCount,
  indentParagraphs: externalIndentParagraphs,
  setIndentParagraphs: externalSetIndentParagraphs
}: { 
  onClose?: () => void;
  showWordCount?: boolean;
  setShowWordCount?: (val: boolean) => void;
  indentParagraphs?: boolean;
  setIndentParagraphs?: (val: boolean) => void;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  
  const [name, setName] = useState(user?.displayName || 'Александра Смирнова');
  const [bio, setBio] = useState('Писатель-фантаст, мечтающий создать идеальный мир с помощью слов. Люблю кофе и долгие прогулки под дождем.');
  const [style, setStyle] = useState('Научная фантастика');
  
  const [darkTheme, setDarkTheme] = useState(false);
  const [bgSounds, setBgSounds] = useState(true);
  const [smartHints, setSmartHints] = useState(true);
  
  const [localShowWordCount, setLocalShowWordCount] = useState(true);
  const [localIndentParagraphs, setLocalIndentParagraphs] = useState(false);

  const showWordCount = externalShowWordCount !== undefined ? externalShowWordCount : localShowWordCount;
  const setShowWordCount = externalSetShowWordCount || setLocalShowWordCount;

  const indentParagraphs = externalIndentParagraphs !== undefined ? externalIndentParagraphs : localIndentParagraphs;
  const setIndentParagraphs = externalSetIndentParagraphs || setLocalIndentParagraphs;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f8f9fa] p-8 md:p-12 overflow-y-auto">
      <div className="max-w-5xl mx-auto w-full">
        {/* Navigation back */}
        <button 
          onClick={() => onClose ? onClose() : navigate('/dashboard')}
          className="flex items-center gap-1.5 text-[13px] font-medium text-[#6b7280] hover:text-[#1a1f2c] transition-colors mb-8"
        >
          <ChevronLeft size={16} /> {onClose ? 'Назад к редактору' : 'Назад к проектам'}
        </button>

        {/* Header */}
        <header className="flex justify-between items-start mb-12">
          <div>
            <h1 className="text-3xl font-bold text-[#1a1f2c] mb-2">Настройки профиля</h1>
            <p className="text-[#6b7280] text-sm">Управляйте своим творческим пространством</p>
          </div>
          <button className="flex items-center gap-2 bg-[#2d3748] hover:bg-[#1a202c] text-white px-5 py-2.5 rounded-xl font-medium transition-colors shadow-sm">
            <Save size={18} />
            Сохранить
          </button>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-24 mb-16">
          {/* Left Column - Profile Info */}
          <div className="space-y-8">
            {/* Profile Photo */}
            <div className="flex items-center gap-6">
              <div className="relative">
                <div className="w-24 h-24 rounded-full overflow-hidden bg-gray-200 border-4 border-white shadow-sm">
                  <img 
                    src={user?.photoURL || "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80"} 
                    alt="Profile" 
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <button className="absolute bottom-0 right-0 bg-white p-2 rounded-full shadow-md border border-gray-100 text-gray-600 hover:text-gray-900 transition-colors">
                  <Pencil size={14} />
                </button>
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#1a1f2c] mb-1">Фото профиля</h3>
                <p className="text-sm text-[#9ca3af]">PNG или JPG до 5MB</p>
              </div>
            </div>

            {/* Form Fields */}
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-[#1a1f2c] mb-2">Имя автора</label>
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-[#f1f5f9] border-transparent focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-200 outline-none transition-all text-[#1a1f2c]"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-[#1a1f2c] mb-2">Биография</label>
                <textarea 
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-3 rounded-xl bg-[#f1f5f9] border-transparent focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-200 outline-none transition-all text-[#1a1f2c] resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#1a1f2c] mb-2">Литературный стиль</label>
                <input 
                  type="text" 
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-[#f1f5f9] border-transparent focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-200 outline-none transition-all text-[#1a1f2c]"
                />
              </div>
            </div>
          </div>

          {/* Right Column - Settings Cards */}
          <div className="space-y-8">
            {/* Studio Settings */}
            <div className="bg-white rounded-3xl p-8 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-gray-100">
              <h2 className="text-xl font-bold text-[#1a1f2c] mb-6">Настройки студии</h2>
              
              <div className="space-y-6">
                {/* Dark Theme */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#f8f9fa] flex items-center justify-center text-[#6b7280]">
                      <Moon size={20} />
                    </div>
                    <div>
                      <h4 className="text-[15px] font-medium text-[#1a1f2c]">Темная тема</h4>
                      <p className="text-sm text-[#9ca3af]">Снижает нагрузку на глаза ночью</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setDarkTheme(!darkTheme)}
                    className={`w-12 h-6 rounded-full transition-colors relative ${darkTheme ? 'bg-[#2d3748]' : 'bg-[#e2e8f0]'}`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${darkTheme ? 'translate-x-6.5 left-0' : 'translate-x-0.5 left-0'}`} />
                  </button>
                </div>

                {/* Background Sounds */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#f8f9fa] flex items-center justify-center text-[#6b7280]">
                      <Volume2 size={20} />
                    </div>
                    <div>
                      <h4 className="text-[15px] font-medium text-[#1a1f2c]">Фоновые звуки</h4>
                      <p className="text-sm text-[#9ca3af]">Эффект дождя или библиотеки</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setBgSounds(!bgSounds)}
                    className={`w-12 h-6 rounded-full transition-colors relative ${bgSounds ? 'bg-[#2d3748]' : 'bg-[#e2e8f0]'}`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${bgSounds ? 'translate-x-6.5 left-0' : 'translate-x-0.5 left-0'}`} />
                  </button>
                </div>

                {/* Smart Hints */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#f8f9fa] flex items-center justify-center text-[#6b7280]">
                      <Sparkles size={20} />
                    </div>
                    <div>
                      <h4 className="text-[15px] font-medium text-[#1a1f2c]">Умные подсказки</h4>
                      <p className="text-sm text-[#9ca3af]">AI помогает продолжить мысль</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setSmartHints(!smartHints)}
                    className={`w-12 h-6 rounded-full transition-colors relative ${smartHints ? 'bg-[#2d3748]' : 'bg-[#e2e8f0]'}`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${smartHints ? 'translate-x-6.5 left-0' : 'translate-x-0.5 left-0'}`} />
                  </button>
                </div>

                {/* Show Word Count */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#f8f9fa] flex items-center justify-center text-[#6b7280]">
                      <Type size={20} />
                    </div>
                    <div>
                      <h4 className="text-[15px] font-medium text-[#1a1f2c]">Показывать количество слов</h4>
                      <p className="text-sm text-[#9ca3af]">Отображать счетчик слов в редакторе</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setShowWordCount(!showWordCount)}
                    className={`w-12 h-6 rounded-full transition-colors relative ${showWordCount ? 'bg-[#2d3748]' : 'bg-[#e2e8f0]'}`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${showWordCount ? 'translate-x-6.5 left-0' : 'translate-x-0.5 left-0'}`} />
                  </button>
                </div>

                {/* Indent Paragraphs */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#f8f9fa] flex items-center justify-center text-[#6b7280]">
                      <AlignLeft size={20} />
                    </div>
                    <div>
                      <h4 className="text-[15px] font-medium text-[#1a1f2c]">Отступ абзацев</h4>
                      <p className="text-sm text-[#9ca3af]">Добавлять красную строку для новых абзацев</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setIndentParagraphs(!indentParagraphs)}
                    className={`w-12 h-6 rounded-full transition-colors relative ${indentParagraphs ? 'bg-[#2d3748]' : 'bg-[#e2e8f0]'}`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${indentParagraphs ? 'translate-x-6.5 left-0' : 'translate-x-0.5 left-0'}`} />
                  </button>
                </div>
              </div>
            </div>

            {/* Security */}
            <div className="bg-white rounded-3xl p-8 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-gray-100">
              <h2 className="text-xl font-bold text-[#1a1f2c] mb-6">Безопасность</h2>
              
              <div className="space-y-4">
                <button className="w-full flex items-center justify-between p-2 hover:bg-gray-50 rounded-xl transition-colors group">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl border border-gray-100 flex items-center justify-center text-[#1a1f2c] group-hover:border-gray-200 transition-colors">
                      <Lock size={18} />
                    </div>
                    <span className="text-[15px] font-medium text-[#1a1f2c]">Смена пароля</span>
                  </div>
                  <ChevronRight size={18} className="text-gray-400" />
                </button>

                <button className="w-full flex items-center justify-between p-2 hover:bg-gray-50 rounded-xl transition-colors group">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl border border-gray-100 flex items-center justify-center text-[#1a1f2c] group-hover:border-gray-200 transition-colors">
                      <Shield size={18} />
                    </div>
                    <span className="text-[15px] font-medium text-[#1a1f2c]">Двухфакторная аутентификация</span>
                  </div>
                  <ChevronRight size={18} className="text-gray-400" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-8 border-t border-gray-200 flex items-center justify-between">
          <button 
            onClick={() => logout()}
            className="flex items-center gap-2 text-[#6b7280] hover:text-[#1a1f2c] font-medium transition-colors"
          >
            <LogOut size={18} />
            Выйти из аккаунта
          </button>
          
          <button className="text-[#9ca3af] hover:text-red-500 text-sm font-medium transition-colors">
            Удалить данные и аккаунт
          </button>
        </div>
      </div>
    </div>
  );
}
