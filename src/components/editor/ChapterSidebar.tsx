import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ChevronLeft, BookOpen, Sparkles, Plus,
  FileText, FileCheck, ChevronUp, ChevronDown, Check, Edit3,
} from 'lucide-react';
import { Chapter } from './types';

interface Props {
  projectId: string;
  chapterId: string | undefined;
  chapters: Chapter[];
  isLoadingChapters: boolean;
  isCoauthoring: boolean;
  onToggleCoauthor: () => void;
  onCreateChapter: () => void;
  onToggleChapterStatus: (id: string, currentStatus: 'draft' | 'done') => Promise<void>;
}

export function ChapterSidebar({
  projectId,
  chapterId,
  chapters,
  isLoadingChapters,
  isCoauthoring,
  onToggleCoauthor,
  onCreateChapter,
  onToggleChapterStatus,
}: Props) {
  const navigate = useNavigate();


  return (
    <aside className="w-[220px] bg-[#1e2d1f] text-white/80 flex flex-col flex-shrink-0 shadow-xl z-20">
      {/* Top nav */}
      <div className="p-4 flex items-center gap-3 border-b border-white/10">
        <Link
          to="/dashboard"
          className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white/60 hover:text-white"
        >
          <ChevronLeft size={18} />
        </Link>
        <span className="font-serif font-medium text-white tracking-wide">Перо</span>
      </div>

      {/* Project tools */}
      <div className="p-3 space-y-1 border-b border-white/10">
        <Link
          to={`/bible/${projectId}`}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-white/10"
        >
          <BookOpen size={16} className="text-white/50" />
          Библия истории
        </Link>
        <button
          onClick={onToggleCoauthor}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
            isCoauthoring ? 'bg-white/15 text-white' : 'hover:bg-white/10'
          }`}
        >
          <Sparkles size={16} className={isCoauthoring ? 'text-purple-300' : 'text-white/50'} />
          ИИ-Соавтор
        </button>
      </div>

      {/* Chapter list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
        <div className="flex items-center justify-between px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1 mt-2">
          <span>Главы</span>
          <button className="hover:text-white transition-colors" onClick={onCreateChapter}>
            <Plus size={14} />
          </button>
        </div>

        {isLoadingChapters && (
          <div className="px-3 py-2 text-xs text-white/30">Загрузка...</div>
        )}
        {!isLoadingChapters && chapters.length === 0 && (
          <button
            onClick={onCreateChapter}
            className="w-full px-3 py-3 text-xs text-white/30 hover:text-white/60 text-center border border-dashed border-white/10 rounded-lg transition-colors"
          >
            + Создать первую главу
          </button>
        )}

        {chapters.map((chapter, index) => {
          const isActive = chapter.id === chapterId;
          const isDone = chapter.status === 'done';

          return (
            <div
              key={chapter.id}
              className={`group relative flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${
                isActive ? 'bg-white/8' : 'hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-2 mt-0.5 pl-1.5">
                {/* Document Status Icon */}
                <button
                  onClick={() => onToggleChapterStatus(chapter.id, chapter.status)}
                  title={isDone ? 'Готово — нажмите для сброса' : 'Черновик — нажмите для завершения'}
                  className={`flex-shrink-0 flex items-center justify-center transition-all hover:scale-105 active:scale-95 ${
                    isDone ? 'text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.3)]' : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  {isDone ? <FileCheck size={16} strokeWidth={1.75} /> : <FileText size={16} strokeWidth={1.75} />}
                </button>
              </div>

              {/* Title Block */}
              <button
                onClick={() => navigate(`/editor/${projectId}/${chapter.id}`)}
                className={`flex-1 flex flex-col min-w-0 text-left transition-colors ${
                  isActive ? 'text-white' : 'text-white/60 hover:text-white/80'
                }`}
              >
                <span className={`text-[13px] font-semibold tracking-wide ${isActive ? 'text-white' : 'text-white/80'}`}>
                  Глава {index + 1}
                </span>
                {!/^Глава \d+$/.test(chapter.title.trim()) && (
                  <span className={`text-[11px] truncate leading-tight mt-0.5 ${isActive ? 'text-white/70' : 'text-white/40'}`}>
                    {chapter.title}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Stats block (real stats placeholder, static for now) */}
      <div className="p-4 border-t border-white/10">
        <div className="flex flex-col gap-3 px-1">
          <div className="flex items-center justify-between">
            <span className="text-white/40 text-[11px] uppercase tracking-widest font-bold">Глав</span>
            <span className="text-white/70 font-semibold text-sm">{chapters.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/40 text-[11px] uppercase tracking-widest font-bold">Готово</span>
            <span className="text-white/70 font-semibold text-sm">
              {chapters.filter(c => c.status === 'done').length} / {chapters.length}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
