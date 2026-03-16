import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronLeft, Search, Plus, Users, Map, BookOpen, MoreVertical } from 'lucide-react';

const MOCK_ENTRIES = [
  { id: '1', type: 'character', name: 'Элиас Торн', description: 'Уставший следователь со склонностью к неприятностям.', tags: ['Протагонист', 'Оукхейвен'] },
  { id: '2', type: 'location', name: 'Оукхейвен', description: 'Раскинувшаяся, задыхающаяся от смога столица.', tags: ['Город', 'Сеттинг'] },
  { id: '3', type: 'lore', name: 'Медный Синдикат', description: 'Могущественная преступная организация, контролирующая доки.', tags: ['Фракция', 'Антагонист'] },
];

export default function StoryBible() {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState('all');

  return (
    <div className="flex h-screen w-full bg-[var(--color-paper)] overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r border-black/10 bg-[var(--color-paper-dark)] flex flex-col">
        <div className="p-4 border-b border-black/10 flex items-center gap-3">
          <Link to={`/editor/${id}`} className="p-2 rounded-lg hover:bg-black/5 text-black/60 hover:text-black transition-colors">
            <ChevronLeft size={20} />
          </Link>
          <h2 className="text-xl font-serif font-bold truncate">Библия истории</h2>
        </div>
        
        <nav className="flex-1 p-4 space-y-1">
          <button 
            onClick={() => setActiveTab('all')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
              activeTab === 'all' ? 'bg-black text-white' : 'text-black/70 hover:bg-black/5 hover:text-black'
            }`}
          >
            <BookOpen size={18} />
            Все записи
          </button>
          <button 
            onClick={() => setActiveTab('characters')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
              activeTab === 'characters' ? 'bg-black text-white' : 'text-black/70 hover:bg-black/5 hover:text-black'
            }`}
          >
            <Users size={18} />
            Персонажи
          </button>
          <button 
            onClick={() => setActiveTab('locations')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
              activeTab === 'locations' ? 'bg-black text-white' : 'text-black/70 hover:bg-black/5 hover:text-black'
            }`}
          >
            <Map size={18} />
            Локации
          </button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col bg-white overflow-hidden">
        <header className="p-8 border-b border-black/5 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-serif font-bold mb-2">
              {activeTab === 'all' ? 'Все записи' : activeTab === 'characters' ? 'Персонажи' : activeTab === 'locations' ? 'Локации' : 'Лор'}
            </h1>
            <p className="text-black/50 text-sm font-medium">Управляйте деталями вашего мира.</p>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40" />
              <input 
                type="text" 
                placeholder="Поиск по библии..." 
                className="pl-10 pr-4 py-2 rounded-full bg-[var(--color-paper-dark)] border border-black/5 focus:border-black/20 focus:ring-1 focus:ring-black/20 outline-none transition-all text-sm w-64"
              />
            </div>
            <button className="flex items-center gap-2 bg-black text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-black/80 transition-colors shadow-sm">
              <Plus size={16} />
              Новая запись
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {MOCK_ENTRIES.filter(e => activeTab === 'all' || e.type === activeTab.slice(0, -1)).map(entry => (
              <div key={entry.id} className="p-6 rounded-2xl border border-black/10 hover:border-black/30 transition-colors bg-[var(--color-paper)] group cursor-pointer">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white border border-black/5 flex items-center justify-center text-[var(--color-accent)] shadow-sm">
                      {entry.type === 'character' && <Users size={20} />}
                      {entry.type === 'location' && <Map size={20} />}
                      {entry.type === 'lore' && <BookOpen size={20} />}
                    </div>
                    <div>
                      <h3 className="text-xl font-serif font-bold group-hover:text-[var(--color-accent)] transition-colors">{entry.name}</h3>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-black/40">{entry.type === 'character' ? 'Персонаж' : entry.type === 'location' ? 'Локация' : 'Лор'}</span>
                    </div>
                  </div>
                  <button className="p-1.5 text-black/30 hover:text-black hover:bg-black/5 rounded-lg transition-colors">
                    <MoreVertical size={18} />
                  </button>
                </div>
                
                <p className="text-black/70 text-sm leading-relaxed mb-4 line-clamp-2">
                  {entry.description}
                </p>
                
                <div className="flex flex-wrap gap-2">
                  {entry.tags.map(tag => (
                    <span key={tag} className="px-2.5 py-1 rounded-md bg-white border border-black/5 text-xs font-medium text-black/60 shadow-sm">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
