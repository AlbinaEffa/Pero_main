import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { PenTool, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
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
      navigate('/dashboard');

    } catch (err: any) {
      console.error('Auth error:', err);
      setError(err.message || 'Произошла ошибка. Попробуйте еще раз.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-paper)] p-6 font-sans">
      <div className="w-full max-w-md bg-white p-10 rounded-3xl shadow-xl shadow-black/5 border border-black/5">
        <div className="flex justify-center mb-8">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <PenTool size={32} className="text-[var(--color-accent)]" />
            <span className="text-4xl font-serif font-bold italic tracking-tighter">перо</span>
          </Link>
        </div>

        <div className="text-center mb-10">
          <h2 className="text-3xl font-serif font-medium mb-2">
            {isLogin ? 'С возвращением' : 'Создать аккаунт'}
          </h2>
          <p className="text-black/50 text-sm">
            {isLogin ? 'Введите свои данные для доступа к студии.' : 'Начните свой писательский путь сегодня.'}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-50 text-red-600 text-sm rounded-xl border border-red-100 text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {!isLogin && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-black/60 mb-2">Имя</label>
              <input 
                type="text" 
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-black/10 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-[var(--color-paper-dark)] focus:bg-white"
                placeholder="Имя автора"
              />
            </div>
          )}
          
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-black/60 mb-2">Email</label>
            <input 
              type="email" 
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-xl border border-black/10 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-[var(--color-paper-dark)] focus:bg-white"
              placeholder="author@example.com"
            />
          </div>
          
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold uppercase tracking-widest text-black/60">Пароль</label>
            </div>
            <input 
              type="password" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-xl border border-black/10 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-[var(--color-paper-dark)] focus:bg-white"
              placeholder="••••••••"
            />
          </div>

          <button 
            type="submit" 
            disabled={isLoading}
            className={`w-full flex items-center justify-center gap-2 bg-black text-white py-4 rounded-xl font-medium transition-colors mt-8 ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-black/90'}`}
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

        <div className="mt-8 text-center text-sm text-black/60">
          {isLogin ? "Нет аккаунта? " : "Уже есть аккаунт? "}
          <button 
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
            }} 
            type="button"
            className="text-black font-semibold hover:underline"
          >
            {isLogin ? 'Зарегистрироваться' : 'Войти'}
          </button>
        </div>
      </div>
    </div>
  );
}
