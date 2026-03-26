import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ChevronLeft, BookOpen, Sparkles, Plus,
  FileText, ChevronUp, ChevronDown, Check, Edit3,
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
  onRenameChapter: (id: string, title: string) => Promise<void>;
  onToggleChapterStatus: (id: string, currentStatus: 'draft' | 'done') => Promise<void>;
  onReorderChapters: (ids: string[]) => Promise<void>;
}

export function ChapterSidebar({
  projectId,
  chapterId,
  chapters,
  isLoadingChapters,
  isCoauthoring,
  onToggleCoauthor,
  onCreateChapter,
  onRenameChapter,
  onToggleChapterStatus,
  onReorderChapters,
}: Props) {
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (chapter: Chapter) => {
    setEditingId(chapter.id);
    setEditingTitle(chapter.title);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitEdit = async () => {
    if (!editingId) return;
    const trimmed = editingTitle.trim();
    if (trimmed) await onRenameChapter(editingId, trimmed);
    setEditingId(null);
  };

  const moveChapter = (index: number, direction: -1 | 1) => {
    const newChapters = [...chapters];
    const target = index + direction;
    if (target < 0 || target >= newChapters.length) return;
    [newChapters[index], newChapters[target]] = [newChapters[target], newChapters[index]];
    onReorderChapters(newChapters.map(c => c.id));
  };

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
              {/* Status dot */}
              <button
                onClick={() => onToggleChapterStatus(chapter.id, chapter.status)}
                title={isDone ? 'Готово — нажмите для сброса' : 'Черновик — нажмите для завершения'}
                className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded-full transition-colors"
                style={{
                  background: isDone ? 'rgba(134,239,172,0.25)' : 'rgba(255,255,255,0.06)',
                  border: `1.5px solid ${isDone ? 'rgba(134,239,172,0.6)' : 'rgba(255,255,255,0.15)'}`,
                }}
              >
                {isDone && <Check size={9} className="text-green-300" strokeWidth={3} />}
              </button>

              {/* Title or inline edit */}
              {editingId === chapter.id ? (
                <input
                  ref={inputRef}
                  value={editingTitle}
                  onChange={e => setEditingTitle(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitEdit();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="flex-1 min-w-0 bg-white/10 text-white text-sm rounded px-1.5 py-0.5 outline-none border border-white/30 font-medium"
                  autoFocus
                />
              ) : (
                <button
                  onClick={() => navigate(`/editor/${projectId}/${chapter.id}`)}
                  onDoubleClick={() => startEdit(chapter)}
                  title="Нажмите для открытия, двойной клик — переименовать"
                  className={`flex-1 min-w-0 text-left text-sm truncate transition-colors ${
                    isActive ? 'text-white font-medium' : 'text-white/60 hover:text-white/80'
                  }`}
                >
                  {chapter.title}
                </button>
              )}

              {/* Hover controls */}
              {editingId !== chapter.id && (
                <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => startEdit(chapter)}
                    title="Переименовать"
                    className="p-0.5 rounded hover:bg-white/15 text-white/40 hover:text-white/80 transition-colors"
                  >
                    <Edit3 size={11} />
                  </button>
                  <button
                    onClick={() => moveChapter(index, -1)}
                    disabled={index === 0}
                    title="Переместить вверх"
                    className="p-0.5 rounded hover:bg-white/15 text-white/40 hover:text-white/80 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                  >
                    <ChevronUp size={11} />
                  </button>
                  <button
                    onClick={() => moveChapter(index, 1)}
                    disabled={index === chapters.length - 1}
                    title="Переместить вниз"
                    className="p-0.5 rounded hover:bg-white/15 text-white/40 hover:text-white/80 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                  >
                    <ChevronDown size={11} />
                  </button>
                </div>
              )}
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
