import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Save, Pencil, Moon, Volume2, Sparkles, Lock, Shield, LogOut, ChevronRight, ChevronLeft, Type, AlignLeft, Download, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getApiBaseUrl } from '../services/api';

const API = getApiBaseUrl();

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
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.displayName || '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);

  const [localShowWordCount, setLocalShowWordCount] = useState<boolean>(() => {
    const stored = localStorage.getItem('pero_showWordCount');
    return stored !== null ? stored === 'true' : true;
  });
  const [localIndentParagraphs, setLocalIndentParagraphs] = useState<boolean>(() => {
    const stored = localStorage.getItem('pero_indentParagraphs');
    return stored !== null ? stored === 'true' : false;
  });

  const showWordCount = externalShowWordCount !== undefined ? externalShowWordCount : localShowWordCount;
  const setShowWordCount = (val: boolean) => {
    localStorage.setItem('pero_showWordCount', String(val));
    if (externalSetShowWordCount) externalSetShowWordCount(val);
    else setLocalShowWordCount(val);
  };

  const indentParagraphs = externalIndentParagraphs !== undefined ? externalIndentParagraphs : localIndentParagraphs;
  const setIndentParagraphs = (val: boolean) => {
    localStorage.setItem('pero_indentParagraphs', String(val));
    if (externalSetIndentParagraphs) externalSetIndentParagraphs(val);
    else setLocalIndentParagraphs(val);
  };

  const handleSave = async () => {
    const token = localStorage.getItem('pero_token');
    if (!token) return;
    setIsSaving(true);
    setSaveError('');
    try {
      const res = await fetch(`${API}/auth/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ displayName: name }),
      });
      if (!res.ok) throw new Error('Ошибка сохранения');
      const data = await res.json();
      updateUser({ displayName: data.user.displayName });
    } catch {
      setSaveError('Не удалось сохранить. Попробуйте ещё раз.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--color-paper)] p-8 md:p-12 overflow-y-auto w-full text-left">
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
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 bg-[#2d3748] hover:bg-[#1a202c] disabled:opacity-50 text-white px-5 py-2.5 rounded-xl font-medium transition-colors shadow-sm"
            >
              <Save size={18} />
              {isSaving ? 'Сохраняем...' : 'Сохранить'}
            </button>
            {saveError && <p className="text-xs text-red-500">{saveError}</p>}
          </div>
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
              
              <div className="opacity-50 pointer-events-none">
                <label className="block text-sm font-medium text-[#1a1f2c] mb-2">
                  Биография <span className="text-[10px] font-normal text-[#9ca3af] ml-1">— в разработке</span>
                </label>
                <textarea
                  disabled
                  rows={4}
                  placeholder="Будет доступно в следующей версии"
                  className="w-full px-4 py-3 rounded-xl bg-[#f1f5f9] border-transparent outline-none transition-all text-[#1a1f2c] resize-none"
                />
              </div>

              <div className="opacity-50 pointer-events-none">
                <label className="block text-sm font-medium text-[#1a1f2c] mb-2">
                  Литературный стиль <span className="text-[10px] font-normal text-[#9ca3af] ml-1">— в разработке</span>
                </label>
                <input
                  disabled
                  type="text"
                  placeholder="Будет доступно в следующей версии"
                  className="w-full px-4 py-3 rounded-xl bg-[#f1f5f9] border-transparent outline-none transition-all text-[#1a1f2c]"
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
                {/* Dark Theme — coming soon */}
                <div className="flex items-center justify-between opacity-40 pointer-events-none">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#f8f9fa] flex items-center justify-center text-[#6b7280]">
                      <Moon size={20} />
                    </div>
                    <div>
                      <h4 className="text-[15px] font-medium text-[#1a1f2c]">Темная тема</h4>
                      <p className="text-sm text-[#9ca3af]">В разработке</p>
                    </div>
                  </div>
                  <div className="w-12 h-6 rounded-full bg-[#e2e8f0] relative">
                    <div className="w-5 h-5 rounded-full bg-white absolute top-0.5 left-0.5" />
                  </div>
                </div>

                {/* Background Sounds — coming soon */}
                <div className="flex items-center justify-between opacity-40 pointer-events-none">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#f8f9fa] flex items-center justify-center text-[#6b7280]">
                      <Volume2 size={20} />
                    </div>
                    <div>
                      <h4 className="text-[15px] font-medium text-[#1a1f2c]">Фоновые звуки</h4>
                      <p className="text-sm text-[#9ca3af]">В разработке</p>
                    </div>
                  </div>
                  <div className="w-12 h-6 rounded-full bg-[#e2e8f0] relative">
                    <div className="w-5 h-5 rounded-full bg-white absolute top-0.5 left-0.5" />
                  </div>
                </div>

                {/* Smart Hints — coming soon */}
                <div className="flex items-center justify-between opacity-40 pointer-events-none">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#f8f9fa] flex items-center justify-center text-[#6b7280]">
                      <Sparkles size={20} />
                    </div>
                    <div>
                      <h4 className="text-[15px] font-medium text-[#1a1f2c]">Умные подсказки</h4>
                      <p className="text-sm text-[#9ca3af]">В разработке</p>
                    </div>
                  </div>
                  <div className="w-12 h-6 rounded-full bg-[#e2e8f0] relative">
                    <div className="w-5 h-5 rounded-full bg-white absolute top-0.5 left-0.5" />
                  </div>
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

        {/* Data & Export section */}
        <div className="mb-12">
          <h2 className="text-xl font-bold text-[#1a1f2c] mb-4">Ваши данные</h2>
          <div className="bg-white rounded-3xl p-8 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-gray-100">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
                <Shield size={20} />
              </div>
              <div>
                <h4 className="text-[15px] font-semibold text-[#1a1f2c] mb-1">Безопасное хранение</h4>
                <p className="text-sm text-[#6b7280] leading-relaxed">
                  Все ваши тексты хранятся в защищённой базе данных. Вы можете в любой момент скачать полную копию своих произведений — в Markdown, Word или в виде архива со всеми данными.
                </p>
              </div>
            </div>

            <button
              onClick={async () => {
                const token = localStorage.getItem('pero_token');
                if (!token) return;
                setIsDownloadingAll(true);
                try {
                  const res = await fetch(`${API}/export/all`, {
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  if (!res.ok) throw new Error('Ошибка загрузки');
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  const date = new Date().toISOString().slice(0, 10);
                  a.download = `pero-backup-${date}.zip`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                } catch {
                  // silent — user will see the network error in devtools
                } finally {
                  setIsDownloadingAll(false);
                }
              }}
              disabled={isDownloadingAll}
              className="flex items-center gap-2.5 px-5 py-3 bg-[#f1f5f9] hover:bg-[#e2e8f0] disabled:opacity-50 rounded-xl font-medium text-[#1a1f2c] text-sm transition-colors"
            >
              {isDownloadingAll
                ? <Loader2 size={16} className="animate-spin" />
                : <Download size={16} />}
              Скачать все проекты (.zip)
            </button>
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
