import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Search, Plus, User, Settings, HelpCircle,
  FileText, Upload, X, BookOpen, TrendingUp,
  Trash2, Edit3, Eye, Archive, ArchiveRestore, Download, MoreVertical, Copy, Library, ChevronUp, ChevronDown
} from 'lucide-react';
import { MargOpenBook } from '../components/editor/Marginalia';
import ImportModal from '../components/ImportModal';
import { ProcessingStatusPanel } from '../components/ProcessingStatusPanel';
import { OnboardingWizard, ONBOARDING_KEY } from '../components/OnboardingWizard';
import { FeedbackButton } from '../components/FeedbackButton';
import { PeroLogo } from '../components/Logo';
import { ExportPanel } from '../components/ExportPanel';
import GenrePicker from '../components/GenrePicker';
import { splitGenres } from '../data/genres';

import { api, PlanLimitError } from '../services/api';
import { useJobStatus } from '../hooks/useJobStatus';
import { track } from '../services/analytics';
import { ink, PALETTE } from '../theme/tokens';

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
  seriesId: string | null;     // серия книги (Этап E) или null = вне серии
  seriesOrder: number | null;  // порядок книги в серии
}

// Stable "random" height seeded by project id (consistent across renders)
function heightFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffffffff;
  return 260 + Math.abs(hash % 130); // 260-390px — полка как главный объект
}

/**
 * Переплётная палитра корешков — тёплые «книжные» тона в духе пигментов DESIGN.md.
 * Применяется, когда автор не выбирал цвет сам: полка выглядит как настоящая,
 * а не как тираж одной книги.
 */
const SPINE_COLORS = [PALETTE.pine, '#7A4438', PALETTE.ochre, '#54627F', '#5E4A69', '#2B5248', '#6B3D2E', '#3E4F6B'];
const DEFAULT_PROJECT_COLOR = PALETTE.pine;

function spineColorFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 33 + id.charCodeAt(i)) & 0xffffffff;
  return SPINE_COLORS[Math.abs(hash) % SPINE_COLORS.length];
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
    // Дефолтный цвет считается «не выбранным» — корешок получает стабильный
    // тон из переплётной палитры; выбранный автором цвет всегда в приоритете.
    color:           (p.color && p.color !== DEFAULT_PROJECT_COLOR) ? p.color : spineColorFromId(p.id),
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
    seriesId:        p.seriesId ?? null,
    seriesOrder:     p.seriesOrder ?? null,
  };
}


function formatWords(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}К`;
  return n.toString();
}

const PRESET_COLORS = [PALETTE.pineDeep, PALETTE.clay, PALETTE.navy, PALETTE.plum, PALETTE.emerald, PALETTE.ochre, PALETTE.wine, PALETTE.blue];

function BookContextMenu({ project, position, onClose, onEdit, onOpen, onBible, onExport, onArchive, onDelete, onDuplicate, onChangeColor, onContinue }: {
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
  onContinue: () => void;
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
        className="absolute bg-[#1E2D1F] border border-white/10 rounded-xl shadow-2xl overflow-hidden min-w-[180px]"
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

        <button onClick={onContinue} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors">
          <Library size={14} /> Написать продолжение
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
                boxShadow: project.color === c ? '0 0 0 1px #1E2D1F inset' : 'none'
              }}
              title="Изменить цвет обложки"
            />
          ))}
        </div>

        <div className="h-px bg-white/10 mx-3 my-1" />
        
        <button onClick={onDelete} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-[#9E4338] hover:bg-[#9E4338]/10 transition-colors">
          <Trash2 size={14} /> Удалить
        </button>
      </div>
    </div>,
    document.body
  );
}


function Book({ project, onOpen, onDelete, onEdit, onBible, onExport, onArchive, onDuplicate, onChangeColor, onContinue, isProcessing, onProcessingClick }: { project: Project; onOpen: (id: string) => void; onDelete: (id: string) => void; onEdit: (id: string) => void; onBible: (id: string) => void; onExport: (id: string) => void; onArchive: (id: string) => void; onDuplicate: (id: string) => void; onChangeColor: (id: string, color: string) => void; onContinue: (id: string) => void; isProcessing?: boolean; onProcessingClick?: (id: string) => void }) {
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
          onContinue={() => { onContinue(project.id); setMenuPos(null); }}
        />
      )}

      <div
        className="group cursor-pointer select-none"
        style={{
          height: `${project.height}px`,
          width: '76px',
          backgroundColor: project.color,
          borderRadius: '3px 6px 6px 3px',
          boxShadow: hovered
            ? `4px 4px 20px ${project.color}55, -2px 0 0 ${ink(0.2)}`
            : `-2px 0 0 ${ink(0.15)}, 2px 2px 8px ${ink(0.2)}`,
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
          className={`absolute top-2 right-1.5 p-1 rounded-full text-white/80 hover:bg-ink/20 transition-opacity ${(hovered || menuPos) ? 'opacity-100' : 'opacity-0'} z-10`}
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

/**
 * «Призрачный корешок» — место на полке под новую книгу.
 * Создание и импорт живут здесь, а не в шапке: действие там же, где результат.
 */
function ShelfSlot({ icon: Icon, label, height, onClick }: {
  icon: typeof Plus; label: string; height: number; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: `${height}px`, width: '74px', flexShrink: 0, alignSelf: 'flex-end',
        background: hovered ? 'rgba(255,255,255,0.75)' : ink(0.025),
        border: `2px dashed ${hovered ? ink(0.58) : ink(0.15)}`,
        borderRadius: '3px 6px 6px 3px', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingTop: '14px', gap: '10px',
        transform: hovered ? 'translateY(-8px)' : 'none',
        transition: 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
      title={label}
    >
      <Icon size={16} style={{ color: hovered ? ink(0.7) : ink(0.58), transition: 'color 0.2s' }} />
      <span style={{
        writingMode: 'vertical-rl', transform: 'rotate(180deg)',
        fontFamily: '"Cormorant Garamond", serif', fontSize: '13px', fontWeight: 600,
        letterSpacing: '0.08em', whiteSpace: 'nowrap',
        color: hovered ? ink(0.75) : ink(0.6), transition: 'color 0.2s',
      }}>
        {label}
      </span>
    </button>
  );
}

function Shelf({ projects, label, onLabelClick, onOpen, onDelete, onEdit, onBible, onExport, onArchive, onDuplicate, onChangeColor, onContinue, emptyLabel, getProcessing, onProcessingClick, trailing }: {
  projects: Project[];
  label: string;
  onLabelClick?: () => void;
  onContinue: (id: string) => void;
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
  /** Элементы в конце полки: слоты создания/импорта, блокнот идей. */
  trailing?: React.ReactNode;
}) {
  return (
    <div className="mb-14">
      <div className="flex items-center gap-4 mb-0 px-1">
        <span
          onClick={onLabelClick}
          title={onLabelClick ? 'Открыть единый Мир серии' : undefined}
          style={{
            fontSize: '11px', fontWeight: 700, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: onLabelClick ? PALETTE.terracotta : ink(0.55),
            fontFamily: "'Golos Text', sans-serif",
            cursor: onLabelClick ? 'pointer' : 'default',
          }}>
          {label}{onLabelClick ? ' ›' : ''}
        </span>
        <div style={{ flex: 1, height: '1px', background: ink(0.08) }} />
        <span style={{ fontSize: '11px', color: ink(0.25) }}>
          {projects.length} {projects.length === 1 ? 'книга' : projects.length < 5 ? 'книги' : 'книг'}
        </span>
      </div>

      {/* Books container + physical shelf */}
      <div style={{ position: 'relative' }}>
        <div
          className="overflow-x-auto hide-scrollbar"
          style={{ paddingBottom: 0 }}
        >
          {projects.length === 0 && !trailing ? (
            <div style={{
              height: '120px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `2px dashed ${ink(0.08)}`, borderRadius: '12px',
              margin: '16px 0 0',
              color: ink(0.55), fontSize: '13px', gap: '8px',
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
                  <Book project={p} onOpen={onOpen} onDelete={onDelete} onEdit={onEdit} onBible={onBible} onExport={onExport} onArchive={onArchive} onDuplicate={onDuplicate} onChangeColor={onChangeColor} onContinue={onContinue} isProcessing={getProcessing?.(p.id)} onProcessingClick={onProcessingClick} />
                </div>
              ))}
              {trailing}
            </div>
          )}
        </div>

        {/* Wooden shelf board */}
        {(projects.length > 0 || trailing) && (
          <>
            <div style={{
              height: '14px',
              background: 'linear-gradient(to bottom, #9B7A3A 0%, #7A5E28 100%)',
              borderRadius: '0 0 3px 3px',
              boxShadow: `0 3px 8px ${ink(0.25)}, inset 0 1px 0 rgba(255,255,255,0.15)`,
              position: 'relative',
            }}>
              {/* Wood grain lines */}
              <div style={{ position: 'absolute', top: '4px', left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
              <div style={{ position: 'absolute', top: '8px', left: 0, right: 0, height: '1px', background: ink(0.1) }} />
            </div>
            <div style={{
              height: '6px',
              background: '#5C4220',
              borderRadius: '0 0 4px 4px',
              boxShadow: `0 4px 12px ${ink(0.55)}`,
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
      <div style={{ color: ink(0.3), marginBottom: '20px' }}>
        <MargOpenBook size={72} />
      </div>
      <h2 style={{
        fontFamily: '"Cormorant Garamond", serif',
        fontSize: '28px', fontWeight: 600, color: ink(0.7),
        marginBottom: '10px',
      }}>
        Ваша полка пуста
      </h2>
      <p style={{ color: ink(0.6), fontSize: '16px', maxWidth: '320px', lineHeight: 1.6, marginBottom: '28px' }}>
        Каждая великая история начинается с первого слова. Создайте свой первый проект.
      </p>
      <button
        onClick={onNew}
        style={{
          background: PALETTE.pine, color: '#fff',
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

function NewProjectModal({ onClose, onCreate, onImport }: { onClose: () => void; onCreate: (title: string, genre: string, color: string) => void; onImport?: (file?: File) => void }) {
  const [title, setTitle] = useState('');
  const [genres, setGenres] = useState<string[]>([]);
  const [color, setColor] = useState(PALETTE.pine);
  const importInputRef = useRef<HTMLInputElement>(null);

  const PRESET_COLORS = [PALETTE.pineDeep, PALETTE.clay, PALETTE.navy, PALETTE.plum, PALETTE.emerald, PALETTE.ochre, PALETTE.wine, PALETTE.blue];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: ink(0.5),
        backdropFilter: 'blur(4px)', zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px', animation: 'fadeIn 0.15s ease',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: PALETTE.parchment, borderRadius: '24px', width: '100%',
          maxWidth: '480px', boxShadow: `0 24px 60px ${ink(0.55)}`,
          overflow: 'hidden', animation: 'slideUp 0.2s cubic-bezier(0.34,1.56,0.64,1)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ background: '#fff', padding: '20px 24px', borderBottom: `1px solid ${ink(0.06)}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '22px', fontWeight: 700, margin: 0 }}>
              Новая книга
            </h2>
            <p style={{ fontSize: '12px', color: ink(0.6), margin: '2px 0 0' }}>
              Начните с чистого листа или принесите готовую рукопись
            </p>
          </div>
          <button onClick={onClose} style={{ background: ink(0.05), border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ink(0.5) }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Импорт готовой рукописи — главный сценарий Перо живёт прямо в «Новой книге» */}
          {onImport && (
            <>
            <input
              ref={importInputRef}
              type="file"
              accept=".txt,.docx,.pdf,.epub,.fb2"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }}
            />
            <button
              onClick={() => importInputRef.current?.click()}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'left',
                padding: '13px 16px', borderRadius: '14px', cursor: 'pointer',
                background: 'rgba(74,93,78,0.07)', border: '1.5px dashed rgba(74,93,78,0.4)',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(74,93,78,0.13)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(74,93,78,0.07)'; }}
            >
              <Upload size={18} style={{ color: PALETTE.sage, flexShrink: 0 }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: PALETTE.ink }}>
                  У меня уже есть рукопись
                </span>
                <span style={{ display: 'block', fontSize: '12px', color: ink(0.5), marginTop: '1px' }}>
                  Импорт docx, fb2, epub, pdf или txt — Перо прочитает и построит Мир
                </span>
              </span>
            </button>
            </>
          )}

          {/* Title */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: ink(0.6), marginBottom: '6px' }}>
              Название
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Название вашей книги"
              style={{
                width: '100%', padding: '10px 14px', borderRadius: '12px',
                border: `1.5px solid ${ink(0.1)}`, background: '#fff',
                fontSize: '14px', outline: 'none', boxSizing: 'border-box',
                fontFamily: 'inherit', transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.target.style.borderColor = PALETTE.pine)}
              onBlur={e => (e.target.style.borderColor = ink(0.1))}
            />
          </div>

          {/* Genre */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: ink(0.6), marginBottom: '6px' }}>
              Жанр <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(можно выбрать несколько)</span>
            </label>
            <GenrePicker value={genres} onChange={setGenres} />
          </div>

          {/* Color */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: ink(0.6), marginBottom: '8px' }}>
              Цвет обложки
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: '28px', height: '28px', borderRadius: '8px',
                    background: c, border: `2.5px solid ${color === c ? PALETTE.ink : 'transparent'}`,
                    cursor: 'pointer', transition: 'transform 0.15s, border-color 0.15s',
                    transform: color === c ? 'scale(1.15)' : 'scale(1)',
                  }}
                />
              ))}
              <input type="color" value={color} onChange={e => setColor(e.target.value)}
                style={{ width: '28px', height: '28px', borderRadius: '8px', border: `1.5px solid ${ink(0.1)}`, cursor: 'pointer', padding: '2px' }}
              />
            </div>
          </div>

          {/* Preview mini-book */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', background: ink(0.03), borderRadius: '12px' }}>
            <div style={{
              width: '28px', height: '44px', background: color, borderRadius: '2px 4px 4px 2px',
              boxShadow: `-1px 0 0 ${ink(0.2)}, 1px 1px 4px ${ink(0.2)}`,
              flexShrink: 0,
            }} />
            <div>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, fontFamily: '"Cormorant Garamond", serif', color: PALETTE.ink }}>
                {title || 'Название книги'}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: '11px', color: ink(0.6) }}>
                {genres.join(', ') || 'Жанр'} · 0 слов
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ background: '#fff', padding: '16px 24px', borderTop: `1px solid ${ink(0.06)}`, display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 18px', borderRadius: '12px', border: 'none', background: 'transparent', fontSize: '14px', cursor: 'pointer', color: ink(0.5), fontWeight: 500 }}>
            Отмена
          </button>
          <button
            onClick={() => { if (title) { onCreate(title, genres.join(', '), color); onClose(); } }}
            disabled={!title}
            style={{
              padding: '10px 22px', borderRadius: '12px', border: 'none',
              background: title ? PALETTE.pine : ink(0.08),
              color: title ? '#fff' : ink(0.55),
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
      style={{ position: 'fixed', inset: 0, background: ink(0.5), backdropFilter: 'blur(4px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', animation: 'fadeIn 0.15s ease' }}
      onClick={onClose}
    >
      <div
        style={{ background: PALETTE.parchment, borderRadius: '20px', width: '100%', maxWidth: '380px', overflow: 'hidden', boxShadow: `0 24px 60px ${ink(0.55)}`, animation: 'slideUp 0.2s cubic-bezier(0.34,1.56,0.64,1)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ background: '#fff', padding: '18px 22px', borderBottom: `1px solid ${ink(0.06)}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', fontWeight: 700, margin: 0 }}>
            Переименовать
          </h2>
          <button onClick={onClose} style={{ background: ink(0.05), border: 'none', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ink(0.5) }}>
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
            style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: `1.5px solid ${ink(0.1)}`, background: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', transition: 'border-color 0.15s' }}
            onFocus={e => (e.target.style.borderColor = PALETTE.pine)}
            onBlur={e => (e.target.style.borderColor = ink(0.1))}
          />
        </div>
        <div style={{ background: '#fff', padding: '14px 22px', borderTop: `1px solid ${ink(0.06)}`, display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: '12px', border: 'none', background: 'transparent', fontSize: '13px', cursor: 'pointer', color: ink(0.5), fontWeight: 500 }}>
            Отмена
          </button>
          <button
            onClick={confirm}
            disabled={!title.trim()}
            style={{ padding: '9px 20px', borderRadius: '12px', border: 'none', background: title.trim() ? PALETTE.pine : ink(0.08), color: title.trim() ? '#fff' : ink(0.55), fontSize: '13px', fontWeight: 600, cursor: title.trim() ? 'pointer' : 'not-allowed', transition: 'all 0.2s' }}
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
        background: ink(0.45), backdropFilter: 'blur(4px)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px', animation: 'fadeIn 0.15s ease'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: PALETTE.parchment, borderRadius: '20px', width: '100%', maxWidth: '400px',
          overflow: 'hidden', boxShadow: `0 24px 60px ${ink(0.28)}`,
          animation: 'slideUp 0.2s cubic-bezier(0.34,1.56,0.64,1)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          background: '#fff', padding: '16px 22px', borderBottom: `1px solid ${ink(0.06)}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', fontWeight: 700, margin: 0, color: PALETTE.ink }}>
            Удалить проект?
          </h2>
          <button
            onClick={onClose}
            style={{
              background: ink(0.05), border: 'none', borderRadius: '50%',
              width: '30px', height: '30px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: ink(0.5)
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px 22px' }}>
          <p style={{ fontSize: '14px', color: ink(0.6), margin: 0, lineHeight: 1.5 }}>
            Проект <strong>«{title}»</strong> будет удалён безвозвратно вместе со всеми написанными главами, материалами и статистикой.<br/><br/>
            Это действие нельзя отменить.
          </p>
        </div>

        {/* Footer */}
        <div style={{
          background: '#fff', padding: '14px 22px', borderTop: `1px solid ${ink(0.06)}`,
          display: 'flex', gap: '10px', justifyContent: 'flex-end', alignItems: 'center'
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '9px 16px', borderRadius: '12px', border: 'none',
              background: 'transparent', fontSize: '13px', cursor: 'pointer',
              color: ink(0.5), fontWeight: 500
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
  const [series, setSeries] = useState<{ id: string; title: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  /** Файл, выбранный сразу в «У меня уже есть рукопись» — импорт стартует с разбора, без дропзоны. */
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
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

  // Перезагрузить проекты (+ серии) — после изменений серий на дашборде.
  const reloadProjects = () =>
    api.get<{ projects: any[] }>('/projects').then(data => setProjects((data.projects || []).map(fromApiProject)));
  const reloadSeries = () =>
    api.get<{ series: { id: string; title: string }[] }>('/series').then(data => setSeries(data.series || [])).catch(() => {});

  // Load projects from API — trigger onboarding if this is a brand-new user
  useEffect(() => {
    reloadSeries();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    navigate(`/editor/${projectId}?view=world`);
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

  // «Написать продолжение»: завести серию из книги (если её нет) + новая книга → в её редактор.
  const handleContinue = async (projectId: string) => {
    try {
      const { project } = await api.post<{ seriesId: string; project: { id: string } }>(`/series/continue/${projectId}`, {});
      navigate(`/editor/${project.id}`);
    } catch (e) { console.error('continue series failed', e); }
  };

  // «Новая серия» (слот на дашборде) → создать пустую серию и сразу в её рабочее пространство.
  const handleNewSeries = async () => {
    try {
      const { series: s } = await api.post<{ series: { id: string } }>('/series', { title: 'Новая серия' });
      navigate(`/series/${s.id}`);
    } catch (e) { console.error('new series failed', e); }
  };

  // Derived genre list from active projects (мультижанр: разбиваем CSV на токены)
  const availableGenres = [...new Set(
    projects
      .filter(p => p.status === 'active')
      .flatMap(p => splitGenres(p.genre))
      .filter(g => g && g !== 'Без жанра')
  )].sort((a, b) => a.localeCompare(b, 'ru'));

  function applyFiltersAndSort(list: Project[]): Project[] {
    let result = list;
    if (searchQuery)    result = result.filter(p => p.title.toLowerCase().includes(searchQuery.toLowerCase()));
    if (selectedGenre)  result = result.filter(p => splitGenres(p.genre).includes(selectedGenre));
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
      // PlanLimitError уже показал пейволл (services/api) — это не сбой, не шумим в консоль
      if (!(err instanceof PlanLimitError)) console.error('Failed to create project:', err);
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

      <div style={{ minHeight: '100vh', background: PALETTE.parchment, fontFamily: "'Golos Text', sans-serif" }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '56px 40px' }}>

          {/* Header */}
          <header className="dash-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '40px', gap: '16px' }}>
            <div>
              <div style={{ color: PALETTE.sage, marginBottom: '10px' }}>
                <PeroLogo size={20} />
              </div>
              <h1 style={{
                fontFamily: '"Cormorant Garamond", serif',
                fontSize: 'clamp(40px, 5vw, 60px)',
                fontWeight: 700, fontStyle: 'italic',
                color: ink(0.8), margin: '0 0 6px',
                lineHeight: 1.1,
              }}>
                Ваши проекты
              </h1>
            </div>

            <div className="dash-header-right" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
              {/* Search */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                background: searchFocused ? '#fff' : ink(0.05),
                borderRadius: '50px', padding: '8px 14px',
                border: `1.5px solid ${searchFocused ? ink(0.15) : 'transparent'}`,
                transition: 'all 0.2s',
              }}>
                <Search size={15} style={{ color: ink(0.58), flexShrink: 0 }} />
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
                    transition: 'width 0.3s ease', color: ink(0.8),
                  }}
                />
              </div>

              {/* Профиль/настройки — на странице проектов нет сайдбара */}
              <button
                onClick={() => navigate('/settings')}
                style={{ width: '36px', height: '36px', borderRadius: '50%', background: ink(0.06), border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ink(0.5), flexShrink: 0 }}
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
                  borderRadius: '50px', border: `1px solid ${ink(0.06)}`,
                  fontSize: '13px',
                }}>
                  <span style={{ color: ink(0.58) }}>{stat.icon}</span>
                  <span style={{ color: ink(0.6) }}>{stat.label}:</span>
                  <span style={{ color: ink(0.75), fontWeight: 600 }}>{stat.value}</span>
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
                      border: `1.5px solid ${selectedGenre === null ? PALETTE.pine : ink(0.1)}`,
                      background: selectedGenre === null ? 'rgba(58,79,65,0.08)' : 'transparent',
                      color: selectedGenre === null ? PALETTE.pine : ink(0.45),
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
                        border: `1.5px solid ${selectedGenre === g ? PALETTE.pine : ink(0.1)}`,
                        background: selectedGenre === g ? 'rgba(58,79,65,0.08)' : 'transparent',
                        color: selectedGenre === g ? PALETTE.pine : ink(0.45),
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >
                      {g}
                    </button>
                  ))}
                  <div style={{ width: '1px', height: '18px', background: ink(0.1), margin: '0 2px' }} />
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
                    border: `1.5px solid ${ink(0.1)}`, background: 'transparent',
                    color: ink(0.5), cursor: 'pointer', outline: 'none',
                    fontFamily: 'inherit',
                  }}
                >
                  <option value="updatedAt">По дате</option>
                  <option value="wordCount">По словам</option>
                  <option value="title">По названию</option>
                </select>
                <svg
                  width="12" height="12" viewBox="0 0 12 12" fill="none"
                  style={{ position: 'absolute', right: '12px', pointerEvents: 'none', color: ink(0.6) }}
                >
                  <path d="M2 4.5L6 8.5L10 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
          )}

          {isLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
              <div style={{ width: '28px', height: '28px', border: `3px solid ${ink(0.1)}`, borderTopColor: PALETTE.pine, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            </div>
          ) : projects.length === 0 ? (
            <EmptyState onNew={() => setIsModalOpen(true)} />
          ) : (
            <>
              {/* Серии (Этап E) — каждая серия отдельной полкой по порядку книг */}
              {series
                .map(s => ({ s, books: activeProjects.filter(p => p.seriesId === s.id).sort((a, b) => (a.seriesOrder ?? 0) - (b.seriesOrder ?? 0)) }))
                .filter(x => x.books.length > 0)
                .map(({ s, books }) => (
                  <Shelf
                    key={s.id}
                    projects={books}
                    label={s.title}
                    onLabelClick={() => navigate(`/series/${s.id}`)}
                    onOpen={handleOpen}
                    onDelete={id => setDeletingProjectId(id)}
                    onEdit={id => setRenamingProjectId(id)}
                    onBible={handleBible}
                    onExport={id => setExportingProjectId(id)}
                    onArchive={handleArchive}
                    onDuplicate={handleDuplicate}
                    onChangeColor={handleChangeColor}
                onContinue={handleContinue}
                    getProcessing={getProcessing}
                    onProcessingClick={id => { const p = projects.find(pr => pr.id === id); if (p) setProcessingPanel({ id, title: p.title }); }}
                  />
                ))}

              <Shelf
                projects={activeProjects.filter(p => !p.seriesId)}
                label="Текущие"
                trailing={
                  <>
                    <ShelfSlot icon={Plus} label="Новая книга" height={300} onClick={() => setIsModalOpen(true)} />
                    <ShelfSlot icon={Library} label="Новая серия" height={300} onClick={handleNewSeries} />
                  </>
                }
                onOpen={handleOpen}
                onDelete={id => setDeletingProjectId(id)}
                onEdit={id => setRenamingProjectId(id)}
                onBible={handleBible}
                onExport={id => setExportingProjectId(id)}
                onArchive={handleArchive}
                onDuplicate={handleDuplicate}
                onChangeColor={handleChangeColor}
                onContinue={handleContinue}
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
                onContinue={handleContinue}
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
        <NewProjectModal
          onClose={() => setIsModalOpen(false)}
          onCreate={handleCreate}
          onImport={(file) => { setIsModalOpen(false); setPendingImportFile(file ?? null); setIsImportOpen(true); }}
        />
      )}
      {isImportOpen && (
        <ImportModal
          initialFile={pendingImportFile}
          onClose={() => { setIsImportOpen(false); setPendingImportFile(null); }}
          onSuccess={(projectId, firstChapterId) => {
            setIsImportOpen(false);
            track('project_created', { imported: true });
            // 10x-онбординг «Перо читает книгу» (PRD P0.4); флаг — аварийный выключатель
            const onboardingEnabled = import.meta.env?.VITE_ONBOARDING_ENABLED !== 'false';
            if (onboardingEnabled) {
              track('onboarding_import_started', { projectId });
              navigate(`/onboarding/${projectId}`);
            } else {
              navigate(`/editor/${projectId}/${firstChapterId}`);
            }
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
          background: PALETTE.ink, color: '#fff', borderRadius: '50px',
          padding: '10px 22px', fontSize: '13px', fontWeight: 500,
          boxShadow: `0 4px 20px ${ink(0.58)}`, zIndex: 9999,
          animation: 'fadeInUp 0.2s ease', whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>
          {toast}
        </div>
      )}
    </>
  );
}
