import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Search, Plus, User, Settings, HelpCircle,
  FileText, Upload, X, BookOpen, TrendingUp,
  Trash2, Edit3, Eye, Archive, ArchiveRestore, Download, MoreVertical, Copy
} from 'lucide-react';
import ImportModal from '../components/ImportModal';
import { ProcessingStatusPanel } from '../components/ProcessingStatusPanel';
import { OnboardingWizard, ONBOARDING_KEY } from '../components/OnboardingWizard';
import { FeedbackButton } from '../components/FeedbackButton';
import { ExportPanel } from '../components/ExportPanel';

import { api } from '../services/api';
import { useJobStatus } from '../hooks/useJobStatus';
import { track } from '../services/analytics';

interface Project {
  id: string;
  title: string;
  color: string;
  height: number;           // stable visual height derived from id
  genre: string;
  wordCount: number;
  chapterCount: number;
  doneChapterCount: number;
  lastChapterId: string | null;
  lastEdited: string;       // human-readable "N дн. назад"
  updatedAtMs: number;      // raw ms for sorting
  status: 'active' | 'archive';
  progress: number;         // 0-100 based on done/total chapters
}

// Stable "random" height seeded by project id (consistent across renders)
function heightFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffffffff;
  return 200 + Math.abs(hash % 120); // 200-320px
}

function fromApiProject(p: any): Project {
  const updatedAtMs = new Date(p.updatedAt || p.createdAt).getTime();
  const elapsed = Date.now() - updatedAtMs;
  const mins  = Math.floor(elapsed / 60_000);
  const hours = Math.floor(mins  / 60);
  const days  = Math.floor(hours / 24);
  const lastEdited =
    days  > 0 ? `${days} дн. назад`  :
    hours > 0 ? `${hours} ч. назад`  :
    mins  > 0 ? `${mins} мин. назад` : 'только что';

  const chapterCount     = p.chapterCount     ?? 0;
  const doneChapterCount = p.doneChapterCount ?? 0;
  const progress = chapterCount > 0
    ? Math.round((doneChapterCount / chapterCount) * 100)
    : 0;

  return {
    id:              p.id,
    title:           p.title,
    color:           p.color || '#3A4F41',
    height:          heightFromId(p.id),
    genre:           p.genre || 'Без жанра',
    wordCount:       p.wordCount       ?? 0,
    chapterCount,
    doneChapterCount,
    lastChapterId:   p.lastChapterId   ?? null,
    lastEdited,
    updatedAtMs,
    status:          (p.status as 'active' | 'archive') || 'active',
    progress,
  };
}


function formatWords(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}К`;
  return n.toString();
}

const PRESET_COLORS = ['#3A4F41', '#C66B49', '#2C3E50', '#806B8A', '#2B7A6B', '#8B6B32', '#6B2B2B', '#2B4A8B'];

function BookContextMenu({ project, position, onClose, onEdit, onOpen, onBible, onExport, onArchive, onDelete, onDuplicate, onChangeColor }: {
  project: Project;
  position: { top: number, left: number };
  onClose: () => void;
  onEdit: () => void;
  onOpen: () => void;
  onBible: () => void;
  onExport: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onChangeColor: (color: string) => void;
}) {
  const isArchived = project.status === 'archive';
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState({ top: position.top, left: position.left, opacity: 0 });

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      let newTop = position.top;
      
      // If the menu goes off the bottom of the screen (with 20px padding)
      if (position.top + rect.height > window.innerHeight - 20) {
        // Shift it up so it fits exactly
        newTop = Math.max(20, window.innerHeight - rect.height - 20);
      }
      
      setAdjustedPos({ top: newTop, left: position.left, opacity: 1 });
    }
  }, [position]);

  return createPortal(
    <div className="fixed inset-0 z-[9999]" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose(); }}>
      <div
        ref={menuRef}
        style={{ 
          top: adjustedPos.top, 
          left: adjustedPos.left, 
          transform: 'translate(-50%, 0)',
          opacity: adjustedPos.opacity,
          transition: 'opacity 0.15s ease-out'
        }}
        className="absolute bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden min-w-[180px]"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onEdit} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors">
          <Edit3 size={14} /> Переименовать
        </button>
        <button onClick={onOpen} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors">
          <Eye size={14} /> Открыть
        </button>
        <button onClick={onExport} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors">
          <Download size={14} /> Экспорт
        </button>
        <button onClick={onDuplicate} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors">
          <Copy size={14} /> Создать копию
        </button>
        <button onClick={onArchive} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors">
          {isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          {isArchived ? 'Восстановить' : 'В архив'}
        </button>

        <div className="h-px bg-white/10 mx-3 my-1" />
        
        <div className="px-4 py-2 my-1 flex items-center justify-between">
          {PRESET_COLORS.map(c => (
            <button
              key={c}
              onClick={(e) => { e.stopPropagation(); onChangeColor(c); onClose(); }}
              className="w-4 h-4 rounded-full transition-transform hover:scale-110"
              style={{
                backgroundColor: c,
                border: project.color === c ? '2px solid white' : '1px solid rgba(255,255,255,0.2)',
                boxShadow: project.color === c ? '0 0 0 1px #1a1a1a inset' : 'none'
              }}
              title="Изменить цвет обложки"
            />
          ))}
        </div>

        <div className="h-px bg-white/10 mx-3 my-1" />
        
        <button onClick={onDelete} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors">
          <Trash2 size={14} /> Удалить
        </button>
      </div>
    </div>,
    document.body
  );
}


function Book({ project, onOpen, onDelete, onEdit, onBible, onExport, onArchive, onDuplicate, onChangeColor, isProcessing, onProcessingClick }: { project: Project; onOpen: (id: string) => void; onDelete: (id: string) => void; onEdit: (id: string) => void; onBible: (id: string) => void; onExport: (id: string) => void; onArchive: (id: string) => void; onDuplicate: (id: string) => void; onChangeColor: (id: string, color: string) => void; isProcessing?: boolean; onProcessingClick?: (id: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number, left: number } | null>(null);

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 8, left: rect.left + rect.width / 2 });
  };

  return (
    <div style={{ position: 'relative', flexShrink: 0, alignSelf: 'flex-end' }}>
      {menuPos && (
        <BookContextMenu
          project={project}
          position={menuPos}
          onClose={() => setMenuPos(null)}
          onEdit={() => { onEdit(project.id); setMenuPos(null); }}
          onOpen={() => { onOpen(project.id); setMenuPos(null); }}
          onBible={() => { onBible(project.id); setMenuPos(null); }}
          onExport={() => { onExport(project.id); setMenuPos(null); }}
          onArchive={() => { onArchive(project.id); setMenuPos(null); }}
          onDelete={() => { onDelete(project.id); setMenuPos(null); }}
          onDuplicate={() => { onDuplicate(project.id); setMenuPos(null); }}
          onChangeColor={(color) => onChangeColor(project.id, color)}
        />
      )}

      <div
        className="group cursor-pointer select-none"
        style={{
          height: `${project.height}px`,
          width: '72px',
          backgroundColor: project.color,
          borderRadius: '3px 6px 6px 3px',
          boxShadow: hovered
            ? `4px 4px 20px ${project.color}55, -2px 0 0 rgba(0,0,0,0.2)`
            : `-2px 0 0 rgba(0,0,0,0.15), 2px 2px 8px rgba(0,0,0,0.2)`,
          transform: hovered ? 'translateY(-12px) rotate(-1deg)' : 'translateY(0) rotate(0deg)',
          transition: 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => onOpen(project.id)}
        onContextMenu={openMenu}
      >
        {/* Three dots button */}
        <button
          className={`absolute top-2 right-1.5 p-1 rounded-full text-white/80 hover:bg-black/20 transition-opacity ${(hovered || menuPos) ? 'opacity-100' : 'opacity-0'} z-10`}
          onClick={openMenu}
        >
          <MoreVertical size={16} />
        </button>
        {/* Spine lines */}
        <div style={{ position: 'absolute', top: '12px', left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.12)' }} />
        <div style={{ position: 'absolute', top: '16px', left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.07)' }} />
        <div style={{ position: 'absolute', bottom: '12px', left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.12)' }} />
        <div style={{ position: 'absolute', bottom: '16px', left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.07)' }} />

        <span style={{
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          color: 'rgba(255,255,255,0.9)',
          fontFamily: '"Cormorant Garamond", serif',
          fontSize: '13px',
          fontWeight: 500,
          letterSpacing: '0.08em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxHeight: `${project.height - 32}px`,
          padding: '0 6px',
        }}>
          {project.title}
        </span>

        {isProcessing && (
          <button
            title="Рукопись обрабатывается — нажмите для подробностей"
            onClick={e => { e.stopPropagation(); onProcessingClick?.(project.id); }}
            style={{
              position: 'absolute', top: '6px', right: '5px',
              width: '12px', height: '12px', borderRadius: '50%',
              border: '1.5px solid rgba(255,255,255,0.85)', borderTopColor: 'transparent',
              animation: 'spin 0.9s linear infinite', background: 'none',
              cursor: 'pointer', padding: 0,
            }}
          />
        )}
      </div>
    </div>
  );
}

function Shelf({ projects, label, onOpen, onDelete, onEdit, onBible, onExport, onArchive, onDuplicate, onChangeColor, emptyLabel, getProcessing, onProcessingClick }: {
  projects: Project[];
  label: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  onBible: (id: string) => void;
  onExport: (id: string) => void;
  onArchive: (id: string) => void;
  onDuplicate: (id: string) => void;
  onChangeColor: (id: string, color: string) => void;
  emptyLabel?: string;
  getProcessing?: (id: string) => boolean;
  onProcessingClick?: (id: string) => void;
}) {
  return (
    <div className="mb-14">
      <div className="flex items-center gap-4 mb-0 px-1">
        <span style={{
          fontSize: '11px', fontWeight: 700, letterSpacing: '0.18em',
          textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)',
          fontFamily: 'Inter, sans-serif'
        }}>
          {label}
        </span>
        <div style={{ flex: 1, height: '1px', background: 'rgba(0,0,0,0.08)' }} />
        <span style={{ fontSize: '11px', color: 'rgba(0,0,0,0.25)' }}>
          {projects.length} {projects.length === 1 ? 'книга' : projects.length < 5 ? 'книги' : 'книг'}
        </span>
      </div>

      {/* Books container + physical shelf */}
      <div style={{ position: 'relative' }}>
        <div
          className="overflow-x-auto hide-scrollbar"
          style={{ paddingBottom: 0 }}
        >
          {projects.length === 0 ? (
            <div style={{
              height: '120px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px dashed rgba(0,0,0,0.08)', borderRadius: '12px',
              margin: '16px 0 0',
              color: 'rgba(0,0,0,0.3)', fontSize: '13px', gap: '8px',
            }}>
              <BookOpen size={16} style={{ opacity: 0.4 }} />
              {emptyLabel || 'Нет проектов'}
            </div>
          ) : (
            <div style={{
              display: 'flex', gap: '8px', alignItems: 'flex-end',
              padding: '20px 8px 0',
              minWidth: 'max-content',
            }}>
              {projects.map((p, i) => (
                <div key={p.id} style={{
                  animation: `bookReveal 0.4s ease forwards`,
                  animationDelay: `${i * 0.05}s`,
                  opacity: 0,
                }}>
                  <Book project={p} onOpen={onOpen} onDelete={onDelete} onEdit={onEdit} onBible={onBible} onExport={onExport} onArchive={onArchive} onDuplicate={onDuplicate} onChangeColor={onChangeColor} isProcessing={getProcessing?.(p.id)} onProcessingClick={onProcessingClick} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Wooden shelf board */}
        {projects.length > 0 && (
          <>
            <div style={{
              height: '14px',
              background: 'linear-gradient(to bottom, #9B7A3A 0%, #7A5E28 100%)',
              borderRadius: '0 0 3px 3px',
              boxShadow: '0 3px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.15)',
              position: 'relative',
            }}>
              {/* Wood grain lines */}
              <div style={{ position: 'absolute', top: '4px', left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
              <div style={{ position: 'absolute', top: '8px', left: 0, right: 0, height: '1px', background: 'rgba(0,0,0,0.1)' }} />
            </div>
            <div style={{
              height: '6px',
              background: '#5C4220',
              borderRadius: '0 0 4px 4px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }} />
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '60px 20px', textAlign: 'center',
    }}>
      <div style={{
        width: '80px', height: '80px', borderRadius: '20px',
        background: 'rgba(0,0,0,0.04)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', marginBottom: '24px',
      }}>
        <BookOpen size={36} style={{ color: 'rgba(0,0,0,0.2)' }} />
      </div>
      <h2 style={{
        fontFamily: '"Cormorant Garamond", serif',
        fontSize: '28px', fontWeight: 600, color: 'rgba(0,0,0,0.7)',
        marginBottom: '10px',
      }}>
        Ваша полка пуста
      </h2>
      <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: '15px', maxWidth: '320px', lineHeight: 1.6, marginBottom: '28px' }}>
        Каждая великая история начинается с первого слова. Создайте свой первый проект.
      </p>
      <button
        onClick={onNew}
        style={{
          background: '#3A4F41', color: '#fff',
          border: 'none', borderRadius: '50px',
          padding: '12px 28px', fontSize: '14px', fontWeight: 500,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
          boxShadow: '0 4px 16px rgba(58,79,65,0.35)',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)';
          (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 24px rgba(58,79,65,0.45)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
          (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 16px rgba(58,79,65,0.35)';
        }}
      >
        <Plus size={18} /> Начать писать
      </button>
    </div>
  );
}

function NewProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (title: string, genre: string, color: string) => void }) {
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [color, setColor] = useState('#3A4F41');
  const [customGenres, setCustomGenres] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('pero_custom_genres') || '[]'); } catch { return []; }
  });

  const PRESET_COLORS = ['#3A4F41', '#C66B49', '#2C3E50', '#806B8A', '#2B7A6B', '#8B6B32', '#6B2B2B', '#2B4A8B'];
  const GENRE_PRESETS = ['Фэнтези', 'Фантастика', 'Детектив', 'Роман', 'Ужасы', 'Приключения', 'Другое'];

  const saveCustomGenre = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || GENRE_PRESETS.includes(trimmed) || customGenres.includes(trimmed)) return;
    const updated = [...customGenres, trimmed];
    setCustomGenres(updated);
    localStorage.setItem('pero_custom_genres', JSON.stringify(updated));
  };

  const removeCustomGenre = (value: string) => {
    const updated = customGenres.filter(g => g !== value);
    setCustomGenres(updated);
    localStorage.setItem('pero_custom_genres', JSON.stringify(updated));
    if (genre === value) setGenre('');
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)', zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px', animation: 'fadeIn 0.15s ease',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#F4F1E9', borderRadius: '24px', width: '100%',
          maxWidth: '480px', boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
          overflow: 'hidden', animation: 'slideUp 0.2s cubic-bezier(0.34,1.56,0.64,1)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ background: '#fff', padding: '20px 24px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '22px', fontWeight: 700, margin: 0 }}>
              Новый проект
            </h2>
            <p style={{ fontSize: '12px', color: 'rgba(0,0,0,0.4)', margin: '2px 0 0' }}>
              Создайте новую книгу с нуля
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(0,0,0,0.05)', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(0,0,0,0.5)' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Title */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', marginBottom: '6px' }}>
              Название
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Название вашей книги"
              style={{
                width: '100%', padding: '10px 14px', borderRadius: '12px',
                border: '1.5px solid rgba(0,0,0,0.1)', background: '#fff',
                fontSize: '14px', outline: 'none', boxSizing: 'border-box',
                fontFamily: 'inherit', transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.target.style.borderColor = '#3A4F41')}
              onBlur={e => (e.target.style.borderColor = 'rgba(0,0,0,0.1)')}
            />
          </div>

          {/* Genre */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', marginBottom: '6px' }}>
              Жанр
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
              {GENRE_PRESETS.map(g => (
                <button
                  key={g}
                  onClick={() => {
                    if (g === 'Другое') {
                      setGenre(genre === 'Другое' || !GENRE_PRESETS.includes(genre) ? '' : 'Другое');
                    } else {
                      setGenre(genre === g ? '' : g);
                    }
                  }}
                  style={{
                    padding: '5px 12px', borderRadius: '50px', fontSize: '12px',
                    border: `1.5px solid ${(g === 'Другое' ? (!GENRE_PRESETS.slice(0,-1).includes(genre) && genre !== '') || genre === 'Другое' : genre === g) ? '#3A4F41' : 'rgba(0,0,0,0.1)'}`,
                    background: (g === 'Другое' ? (!GENRE_PRESETS.slice(0,-1).includes(genre) && genre !== '') || genre === 'Другое' : genre === g) ? 'rgba(58,79,65,0.08)' : 'transparent',
                    color: (g === 'Другое' ? (!GENRE_PRESETS.slice(0,-1).includes(genre) && genre !== '') || genre === 'Другое' : genre === g) ? '#3A4F41' : 'rgba(0,0,0,0.5)',
                    cursor: 'pointer', fontWeight: 400, transition: 'all 0.15s',
                  }}
                >
                  {g}
                </button>
              ))}
              {/* Saved custom genre chips */}
              {customGenres.map(g => (
                <span key={g} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '5px 10px 5px 12px', borderRadius: '50px', fontSize: '12px', border: `1.5px solid ${genre === g ? '#3A4F41' : 'rgba(0,0,0,0.1)'}`, background: genre === g ? 'rgba(58,79,65,0.08)' : 'transparent', color: genre === g ? '#3A4F41' : 'rgba(0,0,0,0.5)' }}>
                  <span style={{ cursor: 'pointer' }} onClick={() => setGenre(genre === g ? '' : g)}>{g}</span>
                  <button onClick={() => removeCustomGenre(g)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: 'inherit', opacity: 0.5, fontSize: '13px' }}>×</button>
                </span>
              ))}
            </div>
            {/* Custom genre input — shown when "Другое" is active */}
            {(!GENRE_PRESETS.slice(0, -1).includes(genre) && !customGenres.includes(genre)) && (
              <input
                autoFocus
                type="text"
                placeholder="Введите жанр и нажмите Enter..."
                value={genre === 'Другое' ? '' : genre}
                onChange={e => setGenre(e.target.value || 'Другое')}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val) { saveCustomGenre(val); setGenre(val); }
                  }
                }}
                style={{
                  width: '100%', padding: '8px 12px',
                  borderRadius: '10px', border: '1.5px solid #3A4F41',
                  background: '#fff', fontSize: '13px', outline: 'none',
                  boxSizing: 'border-box', fontFamily: 'inherit', color: '#1a1a1a',
                }}
                onBlur={e => {
                  const val = e.target.value.trim();
                  if (val && val !== 'Другое') { saveCustomGenre(val); setGenre(val); }
                  else if (!val) setGenre('');
                }}
              />
            )}
          </div>

          {/* Color */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', marginBottom: '8px' }}>
              Цвет обложки
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: '28px', height: '28px', borderRadius: '8px',
                    background: c, border: `2.5px solid ${color === c ? '#1a1a1a' : 'transparent'}`,
                    cursor: 'pointer', transition: 'transform 0.15s, border-color 0.15s',
                    transform: color === c ? 'scale(1.15)' : 'scale(1)',
                  }}
                />
              ))}
              <input type="color" value={color} onChange={e => setColor(e.target.value)}
                style={{ width: '28px', height: '28px', borderRadius: '8px', border: '1.5px solid rgba(0,0,0,0.1)', cursor: 'pointer', padding: '2px' }}
              />
            </div>
          </div>

          {/* Preview mini-book */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', background: 'rgba(0,0,0,0.03)', borderRadius: '12px' }}>
            <div style={{
              width: '28px', height: '44px', background: color, borderRadius: '2px 4px 4px 2px',
              boxShadow: '-1px 0 0 rgba(0,0,0,0.2), 1px 1px 4px rgba(0,0,0,0.2)',
              flexShrink: 0,
            }} />
            <div>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, fontFamily: '"Cormorant Garamond", serif', color: '#1a1a1a' }}>
                {title || 'Название книги'}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'rgba(0,0,0,0.4)' }}>
                {genre || 'Жанр'} · 0 слов
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ background: '#fff', padding: '16px 24px', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 18px', borderRadius: '12px', border: 'none', background: 'transparent', fontSize: '14px', cursor: 'pointer', color: 'rgba(0,0,0,0.5)', fontWeight: 500 }}>
            Отмена
          </button>
          <button
            onClick={() => { if (title) { onCreate(title, genre, color); onClose(); } }}
            disabled={!title}
            style={{
              padding: '10px 22px', borderRadius: '12px', border: 'none',
              background: title ? '#3A4F41' : 'rgba(0,0,0,0.08)',
              color: title ? '#fff' : 'rgba(0,0,0,0.3)',
              fontSize: '14px', fontWeight: 600, cursor: title ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
            }}
          >
            Создать проект
          </button>
        </div>
      </div>
    </div>
  );
}

function RenameModal({ project, onClose, onRename }: {
  project: Project;
  onClose: () => void;
  onRename: (id: string, title: string) => void;
}) {
  const [title, setTitle] = useState(project.title);

  const confirm = () => {
    if (title.trim()) { onRename(project.id, title.trim()); onClose(); }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', animation: 'fadeIn 0.15s ease' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#F4F1E9', borderRadius: '20px', width: '100%', maxWidth: '380px', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.3)', animation: 'slideUp 0.2s cubic-bezier(0.34,1.56,0.64,1)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ background: '#fff', padding: '18px 22px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', fontWeight: 700, margin: 0 }}>
            Переименовать
          </h2>
          <button onClick={onClose} style={{ background: 'rgba(0,0,0,0.05)', border: 'none', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(0,0,0,0.5)' }}>
            <X size={15} />
          </button>
        </div>
        <div style={{ padding: '18px 22px' }}>
          <input
            autoFocus
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') onClose(); }}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1.5px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', transition: 'border-color 0.15s' }}
            onFocus={e => (e.target.style.borderColor = '#3A4F41')}
            onBlur={e => (e.target.style.borderColor = 'rgba(0,0,0,0.1)')}
          />
        </div>
        <div style={{ background: '#fff', padding: '14px 22px', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: '12px', border: 'none', background: 'transparent', fontSize: '13px', cursor: 'pointer', color: 'rgba(0,0,0,0.5)', fontWeight: 500 }}>
            Отмена
          </button>
          <button
            onClick={confirm}
            disabled={!title.trim()}
            style={{ padding: '9px 20px', borderRadius: '12px', border: 'none', background: title.trim() ? '#3A4F41' : 'rgba(0,0,0,0.08)', color: title.trim() ? '#fff' : 'rgba(0,0,0,0.3)', fontSize: '13px', fontWeight: 600, cursor: title.trim() ? 'pointer' : 'not-allowed', transition: 'all 0.2s' }}
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteModal({ title, onClose, onConfirm }: {
  title: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px', animation: 'fadeIn 0.15s ease'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#F4F1E9', borderRadius: '20px', width: '100%', maxWidth: '400px',
          overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.28)',
          animation: 'slideUp 0.2s cubic-bezier(0.34,1.56,0.64,1)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          background: '#fff', padding: '16px 22px', borderBottom: '1px solid rgba(0,0,0,0.06)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', fontWeight: 700, margin: 0, color: '#1a1a1a' }}>
            Удалить проект?
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(0,0,0,0.05)', border: 'none', borderRadius: '50%',
              width: '30px', height: '30px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(0,0,0,0.5)'
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px 22px' }}>
          <p style={{ fontSize: '14px', color: 'rgba(0,0,0,0.6)', margin: 0, lineHeight: 1.5 }}>
            Проект <strong>«{title}»</strong> будет удалён безвозвратно вместе со всеми написанными главами, материалами и статистикой.<br/><br/>
            Это действие нельзя отменить.
          </p>
        </div>

        {/* Footer */}
        <div style={{
          background: '#fff', padding: '14px 22px', borderTop: '1px solid rgba(0,0,0,0.06)',
          display: 'flex', gap: '10px', justifyContent: 'flex-end', alignItems: 'center'
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '9px 16px', borderRadius: '12px', border: 'none',
              background: 'transparent', fontSize: '13px', cursor: 'pointer',
              color: 'rgba(0,0,0,0.5)', fontWeight: 500
            }}
          >
            Отмена
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '9px 20px', borderRadius: '12px', border: 'none',
              background: '#934b4b', color: '#fff', fontSize: '13px',
              fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s',
              display: 'flex', alignItems: 'center', gap: '6px'
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#814141'}
            onMouseLeave={e => e.currentTarget.style.background = '#934b4b'}
          >
            <Trash2 size={14} /> Удалить безвозвратно
          </button>
        </div>
      </div>
    </div>
  );
}

type SortKey = 'updatedAt' | 'wordCount' | 'title';

export default function Dashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [processingPanel, setProcessingPanel] = useState<{ id: string; title: string } | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [exportingProjectId, setExportingProjectId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Onboarding wizard — shown once to users with 0 projects after load completes
  const [showOnboarding, setShowOnboarding] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2800);
  };

  // Load projects from API — trigger onboarding if this is a brand-new user
  useEffect(() => {
    api.get<{ projects: any[] }>('/projects')
      .then(data => {
        const loaded = (data.projects || []).map(fromApiProject);
        setProjects(loaded);
        // Show wizard only once: new user (0 projects) AND not dismissed before
        if (loaded.length === 0 && !localStorage.getItem(ONBOARDING_KEY)) {
          setShowOnboarding(true);
          track('onboarding_started');
        }
      })
      .catch(err => console.error('Failed to load projects:', err))
      .finally(() => setIsLoading(false));
  }, []);

  // Job status polling for the processing badge
  const projectIds = projects.map(p => p.id);
  const {
    getProjectStatus,
    fetchProjectDetail,
    retryJob,
    retryAllFailed,
  } = useJobStatus(projectIds);
  const getProcessing = (id: string) => getProjectStatus(id).isProcessing;

  const handleBible = (projectId: string) => {
    navigate(`/bible/${projectId}`);
  };

  /** Navigate to the project's last-edited chapter; fall back to /editor/:id */
  const handleOpen = (projectId: string) => {
    const p = projects.find(pr => pr.id === projectId);
    if (p?.lastChapterId) {
      navigate(`/editor/${projectId}/${p.lastChapterId}`);
    } else {
      navigate(`/editor/${projectId}`);
    }
  };

  // Derived genre list from active projects (non-default only)
  const availableGenres = [...new Set(
    projects
      .filter(p => p.status === 'active' && p.genre !== 'Без жанра')
      .map(p => p.genre)
  )].sort();

  function applyFiltersAndSort(list: Project[]): Project[] {
    let result = list;
    if (searchQuery)    result = result.filter(p => p.title.toLowerCase().includes(searchQuery.toLowerCase()));
    if (selectedGenre)  result = result.filter(p => p.genre === selectedGenre);
    return [...result].sort((a, b) => {
      if (sortKey === 'updatedAt') return b.updatedAtMs - a.updatedAtMs;
      if (sortKey === 'wordCount') return b.wordCount - a.wordCount;
      return a.title.localeCompare(b.title, 'ru');
    });
  }

  const activeProjects   = applyFiltersAndSort(projects.filter(p => p.status === 'active'));
  const archivedProjects = applyFiltersAndSort(projects.filter(p => p.status === 'archive'));

  const activeOnly       = projects.filter(p => p.status === 'active');
  const totalWords       = activeOnly.reduce((s, p) => s + p.wordCount, 0);
  const totalChapters    = activeOnly.reduce((s, p) => s + p.chapterCount, 0);
  const doneChapters     = activeOnly.reduce((s, p) => s + p.doneChapterCount, 0);

  const handleCreate = async (title: string, genre: string, color: string) => {
    try {
      const data = await api.post<{ project: any; chapter: any }>('/projects', {
        title: title || 'Без названия', genre, color,
      });
      setProjects(prev => [fromApiProject(data.project), ...prev]);
      track('project_created', { genre, imported: false });
      navigate(`/editor/${data.project.id}/${data.chapter.id}`);
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  };

  const handleDelete = async (projectId: string) => {
    try {
      await api.delete(`/projects/${projectId}`);
      setProjects(prev => prev.filter(p => p.id !== projectId));
      showToast('Проект удалён');
    } catch (err) {
      console.error('Failed to delete project:', err);
      showToast('Ошибка при удалении');
    }
  };

  const handleArchive = async (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    const newStatus: 'active' | 'archive' = project.status === 'active' ? 'archive' : 'active';
    try {
      await api.patch(`/projects/${projectId}`, { status: newStatus });
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status: newStatus } : p));
      showToast(newStatus === 'archive' ? 'Проект архивирован' : 'Проект восстановлен');
    } catch (err) {
      console.error('Failed to archive project:', err);
      showToast('Ошибка при обновлении проекта');
    }
  };

  const handleDuplicate = async (projectId: string) => {
    try {
      const { project } = await api.post<{ project: any }>(`/projects/${projectId}/duplicate`, {});
      setProjects(prev => [fromApiProject(project), ...prev]);
      showToast('Копия проекта создана');
    } catch (err) {
      console.error('Failed to duplicate project:', err);
      showToast('Ошибка при копировании проекта');
    }
  };

  const handleChangeColor = async (id: string, color: string) => {
    try {
      setProjects(prev => prev.map(p => p.id === id ? { ...p, color } : p));
      await api.patch(`/projects/${id}`, { color });
      showToast('Цвет обложки изменён');
    } catch (err) {
      console.error('Failed to change color:', err);
      showToast('Ошибка при изменении цвета');
    }
  };

  const handleRename = async (projectId: string, newTitle: string) => {
    try {
      const data = await api.patch<{ project: any }>(`/projects/${projectId}`, { title: newTitle });
      setProjects(prev => prev.map(p =>
        p.id === projectId ? { ...p, title: data.project.title } : p
      ));
      showToast('Название обновлено');
    } catch (err) {
      console.error('Failed to rename project:', err);
      showToast('Ошибка при переименовании');
    }
  };

  const renamingProject = renamingProjectId
    ? projects.find(p => p.id === renamingProjectId) ?? null
    : null;


  return (
    <>
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px) scale(0.97) } to { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes bookReveal { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes spin { to { transform: rotate(360deg) } }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        @media (max-width: 640px) {
          .dash-header { flex-direction: column; gap: 12px; align-items: flex-start !important; }
          .dash-header-right { width: 100%; justify-content: space-between; }
          .dash-stats { flex-direction: column; gap: 8px; }
        }
      `}</style>

      <div style={{ minHeight: '100vh', background: '#F4F1E9', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '56px 40px' }}>

          {/* Header */}
          <header className="dash-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '40px', gap: '16px' }}>
            <div>
              <h1 style={{
                fontFamily: '"Cormorant Garamond", serif',
                fontSize: 'clamp(40px, 5vw, 60px)',
                fontWeight: 700, fontStyle: 'italic',
                color: 'rgba(0,0,0,0.8)', margin: '0 0 6px',
                lineHeight: 1.1,
              }}>
                Ваши проекты
              </h1>
            </div>

            <div className="dash-header-right" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
              {/* Search */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                background: searchFocused ? '#fff' : 'rgba(0,0,0,0.05)',
                borderRadius: '50px', padding: '8px 14px',
                border: `1.5px solid ${searchFocused ? 'rgba(0,0,0,0.15)' : 'transparent'}`,
                transition: 'all 0.2s',
              }}>
                <Search size={15} style={{ color: 'rgba(0,0,0,0.35)', flexShrink: 0 }} />
                <input
                  type="text"
                  placeholder="Найти книгу..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  style={{
                    border: 'none', background: 'transparent', outline: 'none',
                    fontSize: '13px', width: searchFocused ? '140px' : '80px',
                    transition: 'width 0.3s ease', color: 'rgba(0,0,0,0.8)',
                  }}
                />
              </div>

              <button
                onClick={() => navigate('/ideas')}
                style={{
                  background: 'rgba(0,0,0,0.05)', color: 'rgba(0,0,0,0.7)', border: 'none',
                  borderRadius: '50px', padding: '9px 18px', fontSize: '13px',
                  fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '6px',
                  transition: 'all 0.2s', whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(0,0,0,0.08)';
                  e.currentTarget.style.color = 'rgba(0,0,0,0.9)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(0,0,0,0.05)';
                  e.currentTarget.style.color = 'rgba(0,0,0,0.7)';
                }}
              >
                <BookOpen size={16} /> Идеи
              </button>

              <button
                onClick={() => setIsImportOpen(true)}
                style={{
                  background: 'rgba(0,0,0,0.05)', color: 'rgba(0,0,0,0.7)', border: 'none',
                  borderRadius: '50px', padding: '9px 18px', fontSize: '13px',
                  fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '6px',
                  transition: 'all 0.2s', whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.08)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.05)'; }}
              >
                <Upload size={16} /> Импорт
              </button>

              <button
                onClick={() => setIsModalOpen(true)}
                style={{
                  background: '#3A4F41', color: '#fff', border: 'none',
                  borderRadius: '50px', padding: '9px 18px', fontSize: '13px',
                  fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '6px',
                  boxShadow: '0 2px 8px rgba(58,79,65,0.3)',
                  transition: 'all 0.2s', whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 16px rgba(58,79,65,0.4)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 2px 8px rgba(58,79,65,0.3)';
                }}
              >
                <Plus size={16} /> Новый проект
              </button>

              <button 
                onClick={() => navigate('/settings')}
                style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(0,0,0,0.06)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(0,0,0,0.5)', flexShrink: 0 }}
              >
                <User size={17} />
              </button>
            </div>
          </header>

          {/* Stats bar */}
          {projects.length > 0 && (
            <div className="dash-stats" style={{ display: 'flex', gap: '12px', marginBottom: '28px', flexWrap: 'wrap' }}>
              {[
                {
                  icon: <TrendingUp size={15} />,
                  label: 'Слов написано',
                  value: totalWords >= 1000 ? `${(totalWords / 1000).toFixed(1)}К` : `${totalWords}`,
                },
                {
                  icon: <BookOpen size={15} />,
                  label: 'Активных книг',
                  value: `${activeOnly.length}`,
                },
                ...(totalChapters > 0 ? [] : []),
              ].map((stat, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '9px',
                  padding: '9px 18px', background: 'rgba(255,255,255,0.6)',
                  borderRadius: '50px', border: '1px solid rgba(0,0,0,0.06)',
                  fontSize: '13px',
                }}>
                  <span style={{ color: 'rgba(0,0,0,0.35)' }}>{stat.icon}</span>
                  <span style={{ color: 'rgba(0,0,0,0.4)' }}>{stat.label}:</span>
                  <span style={{ color: 'rgba(0,0,0,0.75)', fontWeight: 600 }}>{stat.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Filter + sort bar */}
          {projects.length > 0 && (availableGenres.length > 0 || true) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '36px', flexWrap: 'wrap' }}>
              {/* Genre chips */}
              {availableGenres.length > 0 && (
                <>
                  <button
                    onClick={() => setSelectedGenre(null)}
                    style={{
                      padding: '7px 16px', borderRadius: '50px', fontSize: '13px', fontWeight: 500,
                      border: `1.5px solid ${selectedGenre === null ? '#3A4F41' : 'rgba(0,0,0,0.1)'}`,
                      background: selectedGenre === null ? 'rgba(58,79,65,0.08)' : 'transparent',
                      color: selectedGenre === null ? '#3A4F41' : 'rgba(0,0,0,0.45)',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    Все жанры
                  </button>
                  {availableGenres.map(g => (
                    <button
                      key={g}
                      onClick={() => setSelectedGenre(selectedGenre === g ? null : g)}
                      style={{
                        padding: '7px 16px', borderRadius: '50px', fontSize: '13px', fontWeight: 500,
                        border: `1.5px solid ${selectedGenre === g ? '#3A4F41' : 'rgba(0,0,0,0.1)'}`,
                        background: selectedGenre === g ? 'rgba(58,79,65,0.08)' : 'transparent',
                        color: selectedGenre === g ? '#3A4F41' : 'rgba(0,0,0,0.45)',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >
                      {g}
                    </button>
                  ))}
                  <div style={{ width: '1px', height: '18px', background: 'rgba(0,0,0,0.1)', margin: '0 2px' }} />
                </>
              )}

              {/* Sort */}
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <select
                  value={sortKey}
                  onChange={e => setSortKey(e.target.value as SortKey)}
                  style={{
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    paddingLeft: '14px', paddingRight: '34px',
                    paddingTop: '7px', paddingBottom: '7px',
                    borderRadius: '50px', fontSize: '13px',
                    border: '1.5px solid rgba(0,0,0,0.1)', background: 'transparent',
                    color: 'rgba(0,0,0,0.5)', cursor: 'pointer', outline: 'none',
                    fontFamily: 'inherit',
                  }}
                >
                  <option value="updatedAt">По дате</option>
                  <option value="wordCount">По словам</option>
                  <option value="title">По названию</option>
                </select>
                <svg
                  width="12" height="12" viewBox="0 0 12 12" fill="none"
                  style={{ position: 'absolute', right: '12px', pointerEvents: 'none', color: 'rgba(0,0,0,0.4)' }}
                >
                  <path d="M2 4.5L6 8.5L10 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
          )}

          {isLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
              <div style={{ width: '28px', height: '28px', border: '3px solid rgba(0,0,0,0.1)', borderTopColor: '#3A4F41', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            </div>
          ) : projects.length === 0 ? (
            <EmptyState onNew={() => setIsModalOpen(true)} />
          ) : (
            <>
              <Shelf
                projects={activeProjects}
                label="Текущие"
                onOpen={handleOpen}
                onDelete={id => setDeletingProjectId(id)}
                onEdit={id => setRenamingProjectId(id)}
                onBible={handleBible}
                onExport={id => setExportingProjectId(id)}
                onArchive={handleArchive}
                onDuplicate={handleDuplicate}
                onChangeColor={handleChangeColor}
                emptyLabel="Нет проектов с такими фильтрами"
                getProcessing={getProcessing}
                onProcessingClick={id => {
                  const p = projects.find(pr => pr.id === id);
                  if (p) setProcessingPanel({ id, title: p.title });
                }}
              />
              <Shelf
                projects={archivedProjects}
                label="Архив"
                onOpen={handleOpen}
                onDelete={id => setDeletingProjectId(id)}
                onEdit={id => setRenamingProjectId(id)}
                onBible={handleBible}
                onExport={id => setExportingProjectId(id)}
                onArchive={handleArchive}
                onDuplicate={handleDuplicate}
                onChangeColor={handleChangeColor}
                emptyLabel="Архив пуст"
                getProcessing={getProcessing}
                onProcessingClick={id => {
                  const p = projects.find(pr => pr.id === id);
                  if (p) setProcessingPanel({ id, title: p.title });
                }}
              />
            </>
          )}

          {/* Footer */}

        </div>
      </div>

      {isModalOpen && (
        <NewProjectModal onClose={() => setIsModalOpen(false)} onCreate={handleCreate} />
      )}
      {isImportOpen && (
        <ImportModal
          onClose={() => setIsImportOpen(false)}
          onSuccess={(projectId, firstChapterId) => {
            setIsImportOpen(false);
            track('project_created', { imported: true });
            navigate(`/editor/${projectId}/${firstChapterId}`);
          }}
        />
      )}

      {showOnboarding && (
        <OnboardingWizard
          onComplete={(projectId, firstChapterId) => {
            setShowOnboarding(false);
            navigate(`/editor/${projectId}/${firstChapterId}`);
          }}
          onSkip={() => {
            setShowOnboarding(false);
            setIsModalOpen(true); // open "new project" modal for blank start
          }}
          onImport={() => {
            setShowOnboarding(false);
            setIsImportOpen(true);
          }}
        />
      )}

      <FeedbackButton />

      {processingPanel && (
        <ProcessingStatusPanel
          projectId={processingPanel.id}
          projectTitle={processingPanel.title}
          fetchDetail={fetchProjectDetail}
          retryJob={retryJob}
          retryAllFailed={retryAllFailed}
          onClose={() => setProcessingPanel(null)}
        />
      )}
      {exportingProjectId && (
        <ExportPanel
          projectId={exportingProjectId}
          projectTitle={projects.find(p => p.id === exportingProjectId)?.title ?? ''}
          onClose={() => setExportingProjectId(null)}
        />
      )}
      {renamingProject && (
        <RenameModal
          project={renamingProject}
          onClose={() => setRenamingProjectId(null)}
          onRename={handleRename}
        />
      )}
      {deletingProjectId && (
        <ConfirmDeleteModal
          title={projects.find(p => p.id === deletingProjectId)?.title ?? ''}
          onClose={() => setDeletingProjectId(null)}
          onConfirm={() => { handleDelete(deletingProjectId); setDeletingProjectId(null); }}
        />
      )}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '28px', left: '50%', transform: 'translateX(-50%)',
          background: '#1a1a1a', color: '#fff', borderRadius: '50px',
          padding: '10px 22px', fontSize: '13px', fontWeight: 500,
          boxShadow: '0 4px 20px rgba(0,0,0,0.35)', zIndex: 9999,
          animation: 'fadeInUp 0.2s ease', whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>
          {toast}
        </div>
      )}
    </>
  );
}
