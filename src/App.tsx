/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Editor from './pages/Editor';
import StoryBible from './pages/StoryBible';
import Settings from './pages/Settings';
import AppLayout from './layouts/AppLayout';

function RoutePersister() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // При первой загрузке приложения (mount), если мы на главной, 
    // проверяем, был ли сохранен предыдущий путь в sessionStorage
    if (location.pathname === '/') {
      const savedPath = sessionStorage.getItem('lastVisitedRoute');
      if (savedPath && savedPath !== '/') {
        navigate(savedPath, { replace: true });
      }
    }
  }, []); // Выполняется только один раз при монтировании

  useEffect(() => {
    // Сохраняем текущий путь при каждом его изменении
    sessionStorage.setItem('lastVisitedRoute', location.pathname + location.search + location.hash);
  }, [location]);

  return null;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <RoutePersister />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          
          {/* Dashboard is standalone now */}
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          
          <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route path="/settings" element={<Settings />} />
          </Route>
          
          {/* Editor and Bible have their own specific layouts */}
          <Route path="/editor/:id" element={<ProtectedRoute><Editor /></ProtectedRoute>} />
          <Route path="/bible/:id" element={<ProtectedRoute><StoryBible /></ProtectedRoute>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
