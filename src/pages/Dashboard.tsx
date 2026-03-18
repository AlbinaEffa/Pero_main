import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Search, Bell, Plus, User, Settings, HelpCircle,
  FileText, Upload, X, BookOpen, TrendingUp, Clock,
  MoreHorizontal, Trash2, Edit3, Eye
} from 'lucide-react';

interface Project {
  id: string;
  title: string;
  color: string;
  height: number;
  genre: string;
  wordCount: number;
  lastEdited: string;
  status: 'active' | 'archive';
  progress: number;
}

const MOCK_PROJECTS: Project[] = [
  { id: '1', title: 'Хроники Мха', color: '#3A4F41', height: 220, genre: 'Фэнтези', wordCount: 42800, lastEdited: '2 ч. назад', status: 'active', progress: 54 },
  { id: '2', title: 'Глиняные тропы', color: '#C66B49', height: 180, genre: 'Магический реализм', wordCount: 18200, lastEdited: 'вчера', status: 'active', progress: 23 },
  { id: '3', title: 'Тёмные небеса', color: '#2C3E50', height: 250, genre: 'Научная фантастика', wordCount: 61000, lastEdited: '3 дня назад', status: 'active', progress: 76 },
  { id: '4', title: 'Тихая проза', color: '#806B8A', height: 165, genre: 'Литература', wordCount: 9400, lastEdited: 'неделю назад', status: 'active', progress: 12 },
  { id: '5', title: 'Бирюзовые воды', color: '#2B7A6B', height: 205, genre: 'Приключения', wordCount: 33600, lastEdited: '5 дней назад', status: 'active', progress: 42 },
  { id: '6', title: 'Старые воспоминания', color: '#8A8A8A', height: 175, genre: 'Мемуары', wordCount: 22000, lastEdited: '2 мес. назад', status: 'archive', progress: 100 },
  { id: '7', title: 'Забытые сказки', color: '#A0A0A0', height: 155, genre: 'Детская литература', wordCount: 15500, lastEdited: '3 мес. назад', status: 'archive', progress: 100 },
];

function formatWords(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}К`;
  return n.toString();
}

function BookContextMenu({ project, onClose, onEdit, onDelete }: {
  project: Project;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden min-w-[160px]"
      onClick={e => e.stopPropagation()}
    >
      <button onClick={onEdit} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors">
        <Edit3 size={14} /> Переименовать
      </button>
      <button onClick={() => { onClose(); }} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors">
        <Eye size={14} /> Открыть
      </button>
      <div className="h-px bg-white/10 mx-3" />
      <button onClick={onDelete} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors">
        <Trash2 size={14} /> Удалить
      </button>
    </div>
  );
}

interface TooltipPortalProps {
  project: Project;
  anchorRef: React.RefObject<HTMLDivElement>;
}

function TooltipPortal({ project, anchorRef }: TooltipPortalProps) {
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const tipWidth = 172;
    let x = cx - tipWidth / 2;
    // clamp to viewport
    x = Math.max(8, Math.min(x, window.innerWidth - tipWidth - 8));
    setPos({ x, y: rect.top - 8 });
  }, [anchorRef]);

  return createPortal(
    <div style={{
      position: 'fixed',
      left: `${pos.x}px`,
      top: `${pos.y}px`,
      transform: 'translateY(-100%)',
      background: '#1a1a1a',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '12px',
      padding: '12px 14px',
      width: '172px',
      pointerEvents: 'none',
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      zIndex: 9999,
      animation: 'fadeInUp 0.15s ease',
    }}>
      <p style={{
        color: '#fff', fontSize: '13px', fontWeight: 600,
        marginBottom: '3px', fontFamily: '"Cormorant Garamond", serif',
        lineHeight: 1.3,
      }}>
        {project.title}
      </p>
      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '11px', marginBottom: '10px', lineHeight: 1 }}>
        {project.genre}
      </p>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '10px' }}>
        <span style={{ color: 'rgba(255,255,255,0.5)' }}>{formatWords(project.wordCount)} слов</span>
        <span style={{ color: 'rgba(255,255,255,0.35)' }}>{project.lastEdited}</span>
      </div>
      <div style={{ height: '3px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${project.progress}%`,
          background: project.color,
          filter: 'brightness(1.5)',
          borderRadius: '2px',
        }} />
      </div>
      <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '10px', marginTop: '5px' }}>
        {project.progress}% готово
      </p>
    </div>,
    document.body
  );
}

function Book({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const bookRef = useRef<HTMLDivElement>(null);

  return (
    <div style={{ position: 'relative', flexShrink: 0, alignSelf: 'flex-end' }}>
      {menuOpen && (
        <BookContextMenu
          project={project}
          onClose={() => setMenuOpen(false)}
          onEdit={() => setMenuOpen(false)}
          onDelete={() => setMenuOpen(false)}
        />
      )}

      {hovered && <TooltipPortal project={project} anchorRef={bookRef} />}

      <div
        ref={bookRef}
        className="cursor-pointer select-none"
        style={{
          height: `${project.height}px`,
          width: '56px',
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
        onMouseLeave={() => { setHovered(false); setMenuOpen(false); }}
        onClick={() => onOpen(project.id)}
        onContextMenu={e => { e.preventDefault(); setMenuOpen(!menuOpen); }}
      >
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
          fontSize: '12px',
          fontWeight: 500,
          letterSpacing: '0.08em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxHeight: `${project.height - 32}px`,
          padding: '0 4px',
        }}>
          {project.title}
        </span>
      </div>
    </div>
  );
}

function Shelf({ projects, label, onOpen, emptyLabel }: {
  projects: Project[];
  label: string;
  onOpen: (id: string) => void;
  emptyLabel?: string;
}) {
  return (
    <div className="mb-10">
      <div className="flex items-center gap-4 mb-0 px-1">
        <span style={{
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.18em',
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
                  <Book project={p} onOpen={onOpen} />
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'main' | 'uploading' | 'uploaded'>('main');
  const [fileName, setFileName] = useState('');
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [color, setColor] = useState('#3A4F41');

  const PRESET_COLORS = ['#3A4F41', '#C66B49', '#2C3E50', '#806B8A', '#2B7A6B', '#8B6B32', '#6B2B2B', '#2B4A8B'];
  const GENRE_PRESETS = ['Фэнтези', 'Фантастика', 'Детектив', 'Роман', 'Ужасы', 'Приключения', 'Другое'];

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setStep('uploading');
    setTimeout(() => {
      setStep('uploaded');
      if (!title) setTitle(file.name.replace(/\.[^/.]+$/, ''));
    }, 1200);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      setFileName(file.name);
      setStep('uploading');
      setTimeout(() => { setStep('uploaded'); if (!title) setTitle(file.name.replace(/\.[^/.]+$/, '')); }, 1200);
    }
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
              Загрузите рукопись или начните с нуля
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(0,0,0,0.05)', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(0,0,0,0.5)' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Upload zone */}
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: '2px dashed rgba(0,0,0,0.12)', borderRadius: '16px',
              padding: '24px', textAlign: 'center', cursor: 'pointer',
              background: step === 'uploaded' ? 'rgba(58,79,65,0.05)' : '#fff',
              transition: 'all 0.2s',
            }}
          >
            <input ref={fileInputRef} type="file" accept=".pdf,.docx,.epub,.txt,.fb2" className="hidden" onChange={handleFileSelect} />
            {step === 'main' && (
              <>
                <Upload size={28} style={{ color: 'rgba(0,0,0,0.2)', marginBottom: '8px' }} />
                <p style={{ fontSize: '14px', fontWeight: 500, color: 'rgba(0,0,0,0.6)', margin: '0 0 4px' }}>
                  Загрузить рукопись
                </p>
                <p style={{ fontSize: '12px', color: 'rgba(0,0,0,0.35)', margin: 0 }}>
                  PDF, DOCX, EPUB, TXT, FB2
                </p>
              </>
            )}
            {step === 'uploading' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '28px', height: '28px', border: '3px solid rgba(0,0,0,0.1)', borderTopColor: '#3A4F41', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <p style={{ fontSize: '13px', color: 'rgba(0,0,0,0.5)', margin: 0 }}>Анализ файла...</p>
              </div>
            )}
            {step === 'uploaded' && (
              <>
                <FileText size={28} style={{ color: '#3A4F41', marginBottom: '8px' }} />
                <p style={{ fontSize: '13px', fontWeight: 500, color: '#3A4F41', margin: '0 0 2px' }}>{fileName}</p>
                <p style={{ fontSize: '11px', color: 'rgba(58,79,65,0.7)', margin: 0 }}>Готово к импорту</p>
              </>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ flex: 1, height: '1px', background: 'rgba(0,0,0,0.08)' }} />
            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)' }}>или вручную</span>
            <div style={{ flex: 1, height: '1px', background: 'rgba(0,0,0,0.08)' }} />
          </div>

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
                  onClick={() => setGenre(g)}
                  style={{
                    padding: '5px 12px', borderRadius: '50px', fontSize: '12px',
                    border: `1.5px solid ${genre === g ? '#3A4F41' : 'rgba(0,0,0,0.1)'}`,
                    background: genre === g ? 'rgba(58,79,65,0.08)' : 'transparent',
                    color: genre === g ? '#3A4F41' : 'rgba(0,0,0,0.5)',
                    cursor: 'pointer', fontWeight: genre === g ? 600 : 400,
                    transition: 'all 0.15s',
                  }}
                >
                  {g}
                </button>
              ))}
            </div>
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
            onClick={() => { if (title || step === 'uploaded') { onCreate(title, genre, color); onClose(); } }}
            disabled={!title && step !== 'uploaded'}
            style={{
              padding: '10px 22px', borderRadius: '12px', border: 'none',
              background: (title || step === 'uploaded') ? '#3A4F41' : 'rgba(0,0,0,0.08)',
              color: (title || step === 'uploaded') ? '#fff' : 'rgba(0,0,0,0.3)',
              fontSize: '14px', fontWeight: 600, cursor: (title || step === 'uploaded') ? 'pointer' : 'not-allowed',
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

export default function Dashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>(MOCK_PROJECTS);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  const activeProjects = projects.filter(p => p.status === 'active' &&
    (searchQuery === '' || p.title.toLowerCase().includes(searchQuery.toLowerCase())));
  const archivedProjects = projects.filter(p => p.status === 'archive' &&
    (searchQuery === '' || p.title.toLowerCase().includes(searchQuery.toLowerCase())));

  const totalWords = projects.filter(p => p.status === 'active').reduce((sum, p) => sum + p.wordCount, 0);

  const handleCreate = (title: string, genre: string, color: string) => {
    const newProject: Project = {
      id: Date.now().toString(),
      title: title || 'Без названия',
      color,
      height: 180 + Math.random() * 80,
      genre: genre || 'Без жанра',
      wordCount: 0,
      lastEdited: 'только что',
      status: 'active',
      progress: 0,
    };
    setProjects(prev => [newProject, ...prev]);
    setTimeout(() => navigate(`/editor/${newProject.id}`), 100);
  };

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
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '40px 24px' }}>

          {/* Header */}
          <header className="dash-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '40px', gap: '16px' }}>
            <div>
              <h1 style={{
                fontFamily: '"Cormorant Garamond", serif',
                fontSize: 'clamp(32px, 5vw, 48px)',
                fontWeight: 700, fontStyle: 'italic',
                color: 'rgba(0,0,0,0.8)', margin: '0 0 4px',
                lineHeight: 1.1,
              }}>
                Ваши проекты
              </h1>
              <p style={{ fontSize: '13px', color: 'rgba(0,0,0,0.4)', margin: 0 }}>
                {activeProjects.length + archivedProjects.length} книг · {(totalWords / 1000).toFixed(0)}К слов всего
              </p>
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
            <div className="dash-stats" style={{
              display: 'flex', gap: '12px', marginBottom: '36px',
              flexWrap: 'wrap',
            }}>
              {[
                { icon: <TrendingUp size={14} />, label: 'За неделю', value: '12 402 слова' },
                { icon: <Clock size={14} />, label: 'Последний сеанс', value: '2 ч. назад' },
                { icon: <BookOpen size={14} />, label: 'Активных книг', value: `${projects.filter(p => p.status === 'active').length}` },
              ].map((stat, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px 14px', background: 'rgba(255,255,255,0.6)',
                  borderRadius: '50px', border: '1px solid rgba(0,0,0,0.06)',
                  fontSize: '12px',
                }}>
                  <span style={{ color: 'rgba(0,0,0,0.35)' }}>{stat.icon}</span>
                  <span style={{ color: 'rgba(0,0,0,0.4)' }}>{stat.label}:</span>
                  <span style={{ color: 'rgba(0,0,0,0.7)', fontWeight: 600 }}>{stat.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Empty state (no projects at all) */}
          {projects.length === 0 ? (
            <EmptyState onNew={() => setIsModalOpen(true)} />
          ) : (
            <>
              <Shelf
                projects={activeProjects}
                label="Текущие"
                onOpen={id => navigate(`/editor/${id}`)}
                emptyLabel="Нет активных проектов. Создайте первый!"
              />
              <Shelf
                projects={archivedProjects}
                label="Архив"
                onOpen={id => navigate(`/editor/${id}`)}
                emptyLabel="Архив пуст"
              />
            </>
          )}

          {/* Footer */}
          <footer style={{
            marginTop: '48px', paddingTop: '20px',
            borderTop: '1px solid rgba(0,0,0,0.06)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            flexWrap: 'wrap', gap: '12px',
          }}>
            <p style={{ fontSize: '12px', color: 'rgba(0,0,0,0.35)', margin: 0 }}>
              перо · студия писателя
            </p>
            <div style={{ display: 'flex', gap: '16px' }}>
              <button onClick={() => navigate('/settings')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center' }}>
                <Settings size={16} />
              </button>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center' }}>
                <HelpCircle size={16} />
              </button>
            </div>
          </footer>
        </div>
      </div>

      {isModalOpen && (
        <NewProjectModal onClose={() => setIsModalOpen(false)} onCreate={handleCreate} />
      )}
    </>
  );
}
