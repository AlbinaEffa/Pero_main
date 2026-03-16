import { useState } from 'react';
import { Settings as SettingsIcon, User, Bell, Shield, Palette } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Settings() {
  const [activeTab, setActiveTab] = useState('account');
  const { user } = useAuth();

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--color-paper)] p-8 overflow-y-auto">
      <header className="mb-12">
        <h1 className="text-4xl font-serif font-bold mb-2">Настройки</h1>
        <p className="text-black/50 text-sm font-medium">Управляйте своим аккаунтом и предпочтениями.</p>
      </header>

      <div className="flex gap-12">
        {/* Sidebar */}
        <aside className="w-64 flex-shrink-0">
          <nav className="space-y-1">
            <button 
              onClick={() => setActiveTab('account')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors text-left ${
                activeTab === 'account' ? 'bg-black text-white shadow-md' : 'text-black/70 hover:bg-black/5 hover:text-black'
              }`}
            >
              <User size={18} />
              Аккаунт
            </button>
            <button 
              onClick={() => setActiveTab('appearance')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors text-left ${
                activeTab === 'appearance' ? 'bg-black text-white shadow-md' : 'text-black/70 hover:bg-black/5 hover:text-black'
              }`}
            >
              <Palette size={18} />
              Внешний вид
            </button>
            <button 
              onClick={() => setActiveTab('notifications')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors text-left ${
                activeTab === 'notifications' ? 'bg-black text-white shadow-md' : 'text-black/70 hover:bg-black/5 hover:text-black'
              }`}
            >
              <Bell size={18} />
              Уведомления
            </button>
            <button 
              onClick={() => setActiveTab('security')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors text-left ${
                activeTab === 'security' ? 'bg-black text-white shadow-md' : 'text-black/70 hover:bg-black/5 hover:text-black'
              }`}
            >
              <Shield size={18} />
              Безопасность
            </button>
          </nav>
        </aside>

        {/* Content */}
        <main className="flex-1 max-w-2xl">
          {activeTab === 'account' && (
            <div className="space-y-8">
              <section className="bg-white p-8 rounded-3xl border border-black/5 shadow-sm">
                <h2 className="text-2xl font-serif font-medium mb-6">Информация профиля</h2>
                <div className="space-y-6">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-black/60 mb-2">Имя</label>
                    <input 
                      type="text" 
                      defaultValue={user?.displayName || ''}
                      className="w-full px-4 py-3 rounded-xl border border-black/10 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-[var(--color-paper-dark)] focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-black/60 mb-2">Email</label>
                    <input 
                      type="email" 
                      defaultValue={user?.email || ''}
                      disabled
                      className="w-full px-4 py-3 rounded-xl border border-black/10 bg-black/5 text-black/60 outline-none cursor-not-allowed"
                    />
                    <p className="text-xs text-black/40 mt-2">Email привязан к вашему Google аккаунту и не может быть изменен здесь.</p>
                  </div>
                  <button className="bg-black text-white px-6 py-3 rounded-xl font-medium hover:bg-black/90 transition-colors shadow-sm">
                    Сохранить изменения
                  </button>
                </div>
              </section>
              
              <section className="bg-white p-8 rounded-3xl border border-red-500/20 shadow-sm">
                <h2 className="text-2xl font-serif font-medium mb-2 text-red-600">Опасная зона</h2>
                <p className="text-black/50 text-sm mb-6">Необратимые действия для вашего аккаунта.</p>
                <button className="bg-red-50 text-red-600 border border-red-200 px-6 py-3 rounded-xl font-medium hover:bg-red-100 transition-colors shadow-sm">
                  Удалить аккаунт
                </button>
              </section>
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="space-y-8">
              <section className="bg-white p-8 rounded-3xl border border-black/5 shadow-sm">
                <h2 className="text-2xl font-serif font-medium mb-6">Настройки темы</h2>
                <div className="space-y-6">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-black/60 mb-4">Цветовая тема</label>
                    <div className="flex gap-4">
                      <button className="w-24 h-24 rounded-2xl border-2 border-black bg-[var(--color-paper)] flex items-center justify-center shadow-sm">
                        <span className="text-sm font-medium">Бумага</span>
                      </button>
                      <button className="w-24 h-24 rounded-2xl border-2 border-transparent hover:border-black/20 bg-zinc-900 text-white flex items-center justify-center shadow-sm transition-colors">
                        <span className="text-sm font-medium">Темная</span>
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-black/60 mb-4">Типографика</label>
                    <div className="flex gap-4">
                      <button className="px-6 py-3 rounded-xl border-2 border-black bg-[var(--color-paper-dark)] font-serif shadow-sm">
                        С засечками
                      </button>
                      <button className="px-6 py-3 rounded-xl border-2 border-transparent hover:border-black/20 bg-[var(--color-paper-dark)] font-sans shadow-sm transition-colors">
                        Без засечек
                      </button>
                      <button className="px-6 py-3 rounded-xl border-2 border-transparent hover:border-black/20 bg-[var(--color-paper-dark)] font-mono shadow-sm transition-colors">
                        Моноширинный
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
