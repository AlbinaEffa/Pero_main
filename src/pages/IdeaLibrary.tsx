import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Lightbulb } from 'lucide-react';
import { api } from '../services/api';
import { AppSidebar, SidebarChapterLinks } from '../components/AppSidebar';
import { Chapter } from '../components/editor/types';

/**
 * Идеи — вкладка проекта рядом с Библией и Пером. Делит общий левый сайдбар
 * рабочего пространства (главы + меню), поэтому переход сюда из Редактора/Библии
 * не «прыгает».
 */
export default function IdeaLibrary() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    setIsLoading(true);
    api.get<{ chapters: Chapter[] }>(`/projects/${projectId}/chapters`)
      .then(data => setChapters(data.chapters ?? []))
      .catch(err => console.error('Failed to load chapters:', err))
      .finally(() => setIsLoading(false));
  }, [projectId]);

  const editorPath = projectId && chapters[0]
    ? `/editor/${projectId}/${chapters[0].id}`
    : projectId ? `/editor/${projectId}` : '/dashboard';

  return (
    <div className="flex h-screen w-full bg-[#F5F0E8] font-sans overflow-hidden text-[#1E2D1F]">
      {/* ── Left Sidebar (общий компонент) ─────────────────────────────────── */}
      {!isSidebarCollapsed && (
        <div className="hidden md:flex">
          <AppSidebar
            projectId={projectId}
            active="ideas"
            onCollapse={() => setIsSidebarCollapsed(true)}
          >
            <SidebarChapterLinks projectId={projectId!} chapters={chapters} isLoading={isLoading} />
          </AppSidebar>
        </div>
      )}

      {/* ── Main Content ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar — навигация назад (особенно для мобильных, где сайдбар скрыт) */}
        <header className="h-16 bg-[#F5F0E8] flex items-center gap-4 px-6 border-b border-ink/10 flex-shrink-0">
          <button onClick={() => navigate(editorPath)} className="text-ink/60 hover:text-ink transition-colors md:hidden">
            <ArrowLeft size={20} />
          </button>
          <h1 className="font-sans text-base font-semibold text-[#1E2D1F]">Идеи</h1>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[900px] mx-auto px-6 py-10">
            {/* Header */}
            <header className="mb-8">
              <h1 className="font-serif text-4xl md:text-5xl font-bold text-[#1E2D1F] mb-2 leading-tight">
                Библиотека Идей
              </h1>
              <p className="text-[16px] text-ink/60 m-0">
                Цифровой сад для ваших идей и исследований.
              </p>
            </header>

            {/* Empty state */}
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-20 h-20 rounded-2xl bg-ink/4 flex items-center justify-center mb-6">
                <Lightbulb size={36} className="text-ink/20" />
              </div>
              <h2 className="font-serif text-3xl font-semibold text-[#1E2D1F] mb-3">
                Скоро здесь появятся идеи
              </h2>
              <p className="text-[16px] text-ink/60 max-w-sm leading-relaxed mb-8">
                Библиотека идей — место для набросков, вдохновения и исследований. Функция в разработке.
              </p>
              <button
                onClick={() => navigate(editorPath)}
                className="bg-[#1E2D1F] hover:bg-[#333] text-white rounded-full px-8 py-3 text-[14px] font-medium transition-colors"
              >
                Вернуться к книге
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
