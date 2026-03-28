type EditorFontName = 'cormorant' | 'literata' | 'source-serif';
import { Link, useNavigate } from 'react-router-dom';
import {
  ChevronLeft, BookOpen, Sparkles, Plus,
  FileText, FileCheck, AlertCircle,
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
  wordCount: number;
  showWordCount: boolean;
  onShowWordCountChange: (value: boolean) => void;
  isSaving: boolean;
  lastSavedAt?: Date | null;
  saveError?: boolean;
  editorFont: EditorFontName;
}

function getChapterSubtitle(title: string, index: number): string | null {
  const trimmed = title.trim();
  if (!trimmed) return null;

  const exactDefault = `Глава ${index + 1}`;
  if (trimmed === exactDefault) return null;

  const prefixedMatch = trimmed.match(/^Глава\s+\d+[\s.:—-]+(.+)$/i);
  if (prefixedMatch?.[1]?.trim()) {
    return prefixedMatch[1].trim();
  }

  return trimmed;
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
  wordCount,
  showWordCount,
  onShowWordCountChange,
  isSaving,
  lastSavedAt,
  saveError,
  editorFont,
}: Props) {
  const navigate = useNavigate();
  const editorFontClass = {
    cormorant: 'editor-font-cormorant',
    literata: 'editor-font-literata',
    'source-serif': 'editor-font-source-serif',
  }[editorFont];


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
          const subtitle = getChapterSubtitle(chapter.title, index);

          return (
            <div
              key={chapter.id}
              className={`group relative flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${
                isActive ? 'bg-white/8' : 'hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-2 mt-0.5 pl-1.5">
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

              <button
                onClick={() => navigate(`/editor/${projectId}/${chapter.id}`)}
                className={`flex-1 flex flex-col min-w-0 text-left transition-colors ${
                  isActive ? 'text-white' : 'text-white/60 hover:text-white/80'
                } ${editorFontClass}`}
              >
                <span className={`text-[14px] font-semibold leading-tight ${isActive ? 'text-white' : 'text-white/82'}`}>
                  Глава {index + 1}
                </span>
                {subtitle && (
                  <span className={`text-[12px] truncate leading-tight mt-0.5 ${isActive ? 'text-white/72' : 'text-white/45'}`}>
                    {subtitle}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Bottom panel: tools + status */}
      <div className="p-3 border-t border-white/10 space-y-1">
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

        {/* Word count + save status */}
        <div className="flex flex-col gap-2 px-3 pt-2">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/4 px-3 py-2">
              <div className="min-w-0">
                <div className="text-white/40 text-[10px] uppercase tracking-widest font-bold">Слова</div>
                <div className="text-white/78 font-semibold text-sm mt-0.5">
                  {showWordCount ? `${wordCount.toLocaleString('ru-RU')}` : 'Скрыто'}
                </div>
              </div>
              <button
                onClick={() => onShowWordCountChange(!showWordCount)}
                title={showWordCount ? 'Скрыть счётчик слов' : 'Показать счётчик слов'}
                className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
                  showWordCount ? 'bg-white/80' : 'bg-white/18'
                }`}
              >
                <span
                  className={`w-3.5 h-3.5 rounded-full absolute top-[3px] transition-transform ${
                    showWordCount ? 'left-[19px] bg-[#1e2d1f]' : 'left-[3px] bg-white'
                  }`}
                />
              </button>
            </div>
            {isSaving ? (
              <div className="flex items-center gap-1.5 text-white/50 text-[11px] font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-white/30 inline-block animate-pulse" />
                Сохранение...
              </div>
            ) : saveError ? (
              <div className="flex items-center gap-1.5 text-red-400/80 text-[11px] font-medium" title="Нажмите Cmd+S / Ctrl+S чтобы повторить">
                <AlertCircle size={11} /> Не сохранено
              </div>
            ) : lastSavedAt ? (
              <div className="flex items-center gap-1.5 text-white/40 text-[11px] font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70 inline-block" />
                Сохранено
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-white/20 text-[11px] font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-white/20 inline-block" />
                Ожидание...
              </div>
            )}
        </div>
      </div>
    </aside>
  );
}
