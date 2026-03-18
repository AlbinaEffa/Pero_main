import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { BookOpen, Settings, Library, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function AppLayout() {
  const { logout, user } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <div className="flex h-screen w-full bg-[var(--color-paper)]">
      {/* Sidebar */}
      <aside className="w-64 border-r border-black/10 flex flex-col bg-[var(--color-paper-dark)]">
        <div className="p-6 border-b border-black/10">
          <h1 className="text-3xl font-serif font-bold italic tracking-tighter">перо</h1>
          <p className="text-xs uppercase tracking-widest text-black/50 mt-1 font-sans font-semibold">Студия Писателя</p>
        </div>
        
        <nav className="flex-1 p-4 space-y-1">
          <NavLink 
            to="/dashboard" 
            className={({ isActive }) => 
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive ? 'bg-black text-white' : 'text-black/70 hover:bg-black/5 hover:text-black'
              }`
            }
          >
            <Library size={18} />
            Проекты
          </NavLink>
          <NavLink 
            to="/settings" 
            className={({ isActive }) => 
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive ? 'bg-black text-white' : 'text-black/70 hover:bg-black/5 hover:text-black'
              }`
            }
          >
            <Settings size={18} />
            Настройки
          </NavLink>
        </nav>
        
        <div className="p-4 border-t border-black/10">
          {user && (
            <div className="mb-4 px-3 flex items-center gap-3">
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || 'User'} className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-black/10 flex items-center justify-center text-xs font-bold">
                  {user.email?.[0].toUpperCase()}
                </div>
              )}
              <div className="overflow-hidden">
                <p className="text-sm font-medium truncate">{user.displayName || 'Пользователь'}</p>
                <p className="text-xs text-black/50 truncate">{user.email}</p>
              </div>
            </div>
          )}
          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 w-full rounded-lg text-sm font-medium text-black/70 hover:bg-black/5 hover:text-black transition-colors"
          >
            <LogOut size={18} />
            Выйти
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        <Outlet />
      </main>
    </div>
  );
}
