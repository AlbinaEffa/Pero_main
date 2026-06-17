import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { PeroMark } from '../components/Logo';
import { useAuth } from '../contexts/AuthContext';
import { api, getApiBaseUrl } from '../services/api';
import { takePendingManuscript } from '../services/demoCarry';
import { track, identifyUser } from '../services/analytics';

export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    
    if (!email || !password) {
      setError('Пожалуйста, заполните email и пароль.');
      return;
    }

    try {
      setIsLoading(true);
      setError('');
      
      const path = isLogin ? '/auth/login' : '/auth/register';

      const payload: any = { email, password };
      if (!isLogin && displayName) {
        payload.displayName = displayName;
      }

      const data = await api.post<{ token: string; user: any }>(path, payload);
      login(data.token, data.user);
      // Analytics: identify user + track registration/login
      identifyUser(data.user.id, { email: data.user.email, name: data.user.displayName });
      if (!isLogin) {
        track('user_registered', { email: data.user.email });
      } else {
        track('user_logged_in');
      }

      // Перенос рукописи из демо без регистрации: достроить библию всей книги
      const pending = takePendingManuscript();
      if (pending && await importPendingManuscript(pending.file, pending.genres, data.token)) {
        return; // навигация на онбординг произошла внутри
      }
      navigate('/dashboard');

    } catch (err: any) {
      console.error('Auth error:', err);
      setError(err.message || 'Произошла ошибка. Попробуйте еще раз.');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Достраивает библию из рукописи, загруженной в демо без регистрации.
   * Парсит файл и создаёт проект под новым аккаунтом, затем ведёт в онбординг.
   * Любая ошибка → false (вызывающий уведёт на дашборд).
   */
  const importPendingManuscript = async (file: File, genres: string[], token: string): Promise<boolean> => {
    const base = getApiBaseUrl();
    try {
      const fd = new FormData();
      fd.append('file', file);
      const pr = await fetch(`${base}/import/parse`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!pr.ok) return false;
      const parsed = await pr.json();
      if (!parsed?.chapters?.length) return false;

      const cr = await fetch(`${base}/import/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: parsed.title?.trim() || 'Моя рукопись',
          genre: genres.length > 0 ? genres.join(', ') : null,
          color: '#3A4F41',
          chapters: parsed.chapters.map((c: any) => ({ title: c.title, content: c.content })),
        }),
      });
      if (!cr.ok) return false;
      const created = await cr.json();
      if (!created?.project?.id) return false;

      track('demo_manuscript_imported', { chapters: parsed.chapters.length });
      navigate(`/onboarding/${created.project.id}`);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-paper)] p-6 font-sans">
      <div className="w-full max-w-md bg-white p-10 rounded-3xl shadow-xl shadow-black/5 border border-ink/5">
        <div className="flex justify-center mb-8">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <PeroMark size={34} className="text-[var(--color-accent)]" />
            <span className="text-4xl font-serif font-semibold tracking-wide">Перо</span>
          </Link>
        </div>

        <div className="text-center mb-10">
          <h2 className="text-3xl font-serif font-medium mb-2">
            {isLogin ? 'С возвращением' : 'Создать аккаунт'}
          </h2>
          <p className="text-ink/50 text-sm">
            {isLogin ? 'Введите свои данные для доступа к студии.' : 'Начните свой писательский путь сегодня.'}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-[#F1DFDA] text-[#9E4338] text-sm rounded-xl border border-[#9E4338] text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {!isLogin && (
            <div>
              <label htmlFor="name" className="block text-xs font-bold uppercase tracking-widest text-ink/60 mb-2">Имя</label>
              <input 
                id="name"
                name="name"
                type="text" 
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                autoComplete="name"
                className="w-full px-4 py-3 rounded-xl border border-ink/10 focus:border-ink focus:ring-1 focus:ring-ink outline-none transition-all bg-[var(--color-paper-dark)] focus:bg-white"
                placeholder="Имя автора"
              />
            </div>
          )}
          
          <div>
            <label htmlFor="email" className="block text-xs font-bold uppercase tracking-widest text-ink/60 mb-2">Email</label>
            <input 
              id="email"
              name="email"
              type="email" 
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full px-4 py-3 rounded-xl border border-ink/10 focus:border-ink focus:ring-1 focus:ring-ink outline-none transition-all bg-[var(--color-paper-dark)] focus:bg-white"
              placeholder="author@example.com"
            />
          </div>
          
          <div>
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="password" className="block text-xs font-bold uppercase tracking-widest text-ink/60">Пароль</label>
            </div>
            <input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete={isLogin ? "current-password" : "new-password"}
              className="w-full px-4 py-3 rounded-xl border border-ink/10 focus:border-ink focus:ring-1 focus:ring-ink outline-none transition-all bg-[var(--color-paper-dark)] focus:bg-white"
              placeholder="••••••••"
            />
            {!isLogin && (
              <p className="mt-1.5 text-xs text-ink/55">
                Минимум 8 символов, латинские буквы и цифры
              </p>
            )}
          </div>

          <button 
            type="submit" 
            disabled={isLoading}
            className={`w-full flex items-center justify-center gap-2 bg-ink text-white py-4 rounded-xl font-medium transition-colors mt-8 ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-ink/90'}`}
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
            ) : (
              <>
                {isLogin ? 'Войти' : 'Создать аккаунт'}
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 text-center text-sm text-ink/60">
          {isLogin ? "Нет аккаунта? " : "Уже есть аккаунт? "}
          <button 
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
            }} 
            type="button"
            className="text-ink font-semibold hover:underline"
          >
            {isLogin ? 'Зарегистрироваться' : 'Войти'}
          </button>
        </div>
      </div>
    </div>
  );
}
