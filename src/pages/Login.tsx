import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { PenTool, ArrowRight } from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from '../firebase';

export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleGoogleLogin = async () => {
    if (isLoading) return;
    try {
      setIsLoading(true);
      setError('');
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      
      // Check if user exists in Firestore, if not create them
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || '',
          photoURL: user.photoURL || '',
          createdAt: new Date()
        });
      }
      
      navigate('/dashboard');
    } catch (err: any) {
      console.error('Error signing in with Google', err);
      if (err.code === 'auth/popup-blocked') {
        setError('Окно авторизации заблокировано браузером. Пожалуйста, разрешите всплывающие окна для этого сайта в настройках браузера.');
      } else if (err.code === 'auth/cancelled-popup-request' || err.code === 'auth/popup-closed-by-user') {
        setError('Авторизация отменена. Пожалуйста, попробуйте снова.');
      } else {
        setError('Не удалось войти через Google. Попробуйте еще раз.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Simulate email login for now or show error
    setError('Пожалуйста, используйте вход через Google.');
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

        <button 
          onClick={handleGoogleLogin}
          disabled={isLoading}
          type="button"
          className={`w-full flex items-center justify-center gap-3 bg-white border border-black/10 text-black py-3.5 rounded-xl font-medium transition-colors mb-6 shadow-sm ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-black/5'}`}
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin"></div>
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
          )}
          {isLoading ? 'Вход...' : 'Войти через Google'}
        </button>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-black/10"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white text-black/40">Или по email</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {!isLogin && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-black/60 mb-2">Имя</label>
              <input 
                type="text" 
                className="w-full px-4 py-3 rounded-xl border border-black/10 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-[var(--color-paper-dark)] focus:bg-white"
                placeholder="Имя автора"
              />
            </div>
          )}
          
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-black/60 mb-2">Email</label>
            <input 
              type="email" 
              className="w-full px-4 py-3 rounded-xl border border-black/10 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-[var(--color-paper-dark)] focus:bg-white"
              placeholder="author@example.com"
            />
          </div>
          
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold uppercase tracking-widest text-black/60">Пароль</label>
              {isLogin && (
                <a href="#" className="text-xs text-[var(--color-accent)] hover:underline">Забыли пароль?</a>
              )}
            </div>
            <input 
              type="password" 
              className="w-full px-4 py-3 rounded-xl border border-black/10 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-[var(--color-paper-dark)] focus:bg-white"
              placeholder="••••••••"
            />
          </div>

          <button 
            type="submit" 
            className="w-full flex items-center justify-center gap-2 bg-black text-white py-4 rounded-xl font-medium hover:bg-black/90 transition-colors mt-8"
          >
            {isLogin ? 'Войти' : 'Создать аккаунт'}
            <ArrowRight size={18} />
          </button>
        </form>

        <div className="mt-8 text-center text-sm text-black/60">
          {isLogin ? "Нет аккаунта? " : "Уже есть аккаунт? "}
          <button 
            onClick={() => setIsLogin(!isLogin)} 
            className="text-black font-semibold hover:underline"
          >
            {isLogin ? 'Зарегистрироваться' : 'Войти'}
          </button>
        </div>
      </div>
    </div>
  );
}
