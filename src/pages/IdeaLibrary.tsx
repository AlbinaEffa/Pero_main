import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../services/api';
import { AppSidebar, SidebarChapterLinks } from '../components/AppSidebar';
import { Chapter } from '../components/editor/types';
import { NotesBoard } from '../components/NotesBoard';

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
          <div className="max-w-[820px] mx-auto px-6 py-10">
            {/* Header */}
            <header className="mb-7">
              <h1 className="font-serif text-4xl md:text-5xl font-bold text-[#1E2D1F] mb-2 leading-tight">
                Идеи
              </h1>
              <p className="text-[15px] text-ink/55 m-0">
                Собери замыслы и заметки до того, как строить Мир и писать. Любую карточку
                можно потом «повысить» в Мир — создать персонажа, локацию или предмет.
              </p>
            </header>

            {projectId && (
              <NotesBoard
                projectId={projectId}
                onJumpToChapter={(id) => navigate(`/editor/${projectId}/${id}`)}
                onChapterCreated={(id) => navigate(`/editor/${projectId}/${id}`)}
                onOpenEntity={() => navigate(`/editor/${projectId}?view=world`)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
