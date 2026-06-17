/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import React, { useEffect, Suspense } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';

// ── Eagerly loaded (small, always needed on any route) ────────────────────────
import Landing  from './pages/Landing';
import Login    from './pages/Login';

// ── Lazily loaded (heavy pages — split into separate chunks) ──────────────────
const Dashboard  = React.lazy(() => import('./pages/Dashboard'));
const Editor     = React.lazy(() => import('./pages/Editor'));
const Settings   = React.lazy(() => import('./pages/Settings'));
const IdeaLibrary = React.lazy(() => import('./pages/IdeaLibrary'));
const Onboarding = React.lazy(() => import('./pages/Onboarding'));
const Privacy    = React.lazy(() => import('./pages/Privacy'));
const Demo       = React.lazy(() => import('./pages/Demo'));

// ── Page loading fallback ─────────────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#F5F0E8]">
      <div className="flex gap-1.5">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-[#1e2d1f]/25"
            style={{ animation: `bounce 0.7s ease-in-out ${i * 0.15}s infinite alternate` }}
          />
        ))}
      </div>
      <style>{`
        @keyframes bounce {
          from { transform: translateY(0); opacity: 0.4; }
          to   { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function RoutePersister() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (location.pathname === '/') {
      const savedPath = sessionStorage.getItem('lastVisitedRoute');
      if (savedPath && savedPath !== '/') {
        navigate(savedPath, { replace: true });
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    sessionStorage.setItem('lastVisitedRoute', location.pathname + location.search + location.hash);
  }, [location]);

  return null;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
}

// Старая страница /bible убрана — «Мир» живёт в редакторе. Перенаправляем сюда же.
function BibleRedirect() {
  const { id } = useParams();
  return <Navigate to={`/editor/${id}?view=world`} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <RoutePersister />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/"        element={<Landing />} />
            <Route path="/login"   element={<Login />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/demo"    element={<Demo />} />

            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/settings"  element={<ProtectedRoute><Settings /></ProtectedRoute>} />

            <Route path="/editor/:projectId/:chapterId" element={<ProtectedRoute><Editor /></ProtectedRoute>} />
            <Route path="/editor/:projectId"            element={<ProtectedRoute><Editor /></ProtectedRoute>} />
            <Route path="/bible/:id"                    element={<ProtectedRoute><BibleRedirect /></ProtectedRoute>} />
            <Route path="/ideas/:projectId"             element={<ProtectedRoute><IdeaLibrary /></ProtectedRoute>} />
            <Route path="/onboarding/:projectId"        element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
