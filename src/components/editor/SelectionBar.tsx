/**
 * SelectionBar — единый контекстный бар над выделенным текстом.
 *
 * Сводит воедино три прежних разрозненных слоя:
 *   • формат (жирный/курсив/цитата/сноска) — раньше только в верхнем тулбаре;
 *   • аналитика Пера (создать сущность, проверить фрагмент) — раньше спал в InlineBubbleMenu;
 *   • контекст сущности (В Мире / Где встречается / профиль) — раньше отдельный EntitySelectionMenu.
 *
 * Принцип «текст — дом»: инструмент приходит к выделению, а не наоборот. ИИ здесь —
 * аналитик-библиотекарь (создать запись в Мире, точечно проверить на нестыковки),
 * НЕ генератор прозы (переписать/развернуть сознательно не включаем).
 *
 * Состояния (phase): bar → preview | checking/check | create/creating | error.
 * Пока phase ≠ 'bar', бар не реагирует на изменение выделения (заморожен), чтобы
 * клики по его кнопкам не схлопывали панель.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Editor as TiptapEditor } from '@tiptap/react';
import {
  Bold, Italic, Quote, Sparkles, AlertTriangle, BookOpen, Telescope,
  Loader2, X, Check, ChevronRight, MessageSquare, MessageSquarePlus,
} from 'lucide-react';
import { api } from '../../services/api';
import { Entity } from './types';

// ── Пигменты типов сущностей (как в EntityDetailPanel) ──────────────────────────
const TYPE_PIGMENT: Record<string, string> = {
  character: '#A14F44', location: '#4A5D4E', item: '#91682E', rule: '#54627F',
};
const TYPE_LABEL: Record<string, string> = {
  character: 'персонаж', location: 'локация', item: 'предмет', rule: 'правило мира',
};
const SIGNIFICANCE_LABEL: Record<string, string> = {
  major: 'главный', moderate: 'второстепенный', minor: 'эпизодический',
};
const CREATE_TYPES: { type: string; label: string }[] = [
  { type: 'character', label: 'Персонаж' },
  { type: 'location',  label: 'Локация' },
  { type: 'item',      label: 'Предмет' },
  { type: 'rule',      label: 'Правило мира' },
];

// ── Сопоставление выделения с сущностью (терпимо к склонениям/алиасам) ──────────

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-zа-яё0-9 -]/gi, '').trim();
}

/** Совпадают ли две строки как падежные формы одного слова (общий корень + короткое окончание). */
function caseFormMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length < 4) return false;
  const stem = s.slice(0, Math.max(4, s.length - 2));
  if (!l.startsWith(stem)) return false;
  return l.length - s.length <= 3; // окончание добавляет не больше 3 символов
}

function matchEntity(text: string, entities: Entity[]): Entity | null {
  const sel = norm(text);
  if (!sel || sel.length > 48) return null;
  const words = sel.split(/\s+/);
  if (words.length > 3) return null; // имя/термин — не предложение

  for (const e of entities) {
    const aliases = (e.attributes && 'aliases' in e.attributes && Array.isArray((e.attributes as any).aliases))
      ? (e.attributes as any).aliases as string[]
      : [];
    const candidates = [e.name, ...aliases].map(norm).filter(Boolean);
    for (const c of candidates) {
      if (caseFormMatch(sel, c)) return e;
      // выделение из нескольких слов: совпало хоть одно слово с кандидатом
      if (words.length > 1 && words.some(w => caseFormMatch(w, c))) return e;
    }
  }
  return null;
}

// ── Состояние ───────────────────────────────────────────────────────────────────

type Issue = { entity: string; issue: string; severity: string };
type Phase =
  | { kind: 'bar' }
  | { kind: 'preview' }
  | { kind: 'checking' }
  | { kind: 'check'; issues: Issue[]; note?: string }
  | { kind: 'create' }
  | { kind: 'creating' }
  | { kind: 'created'; entity: Entity }
  | { kind: 'error'; message: string };

interface Pos { top: number; left: number; }

interface Props {
  editor: TiptapEditor;
  projectId?: string;
  entities: Entity[];
  onShowInWorld: (e: Entity) => void;
  onWhereUsed: (e: Entity) => void;
  onEntityCreated?: (e: Entity) => void;
  /** Мост в чат: закрепить выделение как контекст и открыть «Спросить». */
  onAskPero?: (text: string) => void;
  /** «Найти похожее» — открыть линзу «Эхо» с выделением как запросом. */
  onFindSimilar?: (text: string) => void;
  /** Прокомментировать выделение: навесить марку + открыть карточку (логика — в Editor). */
  onComment?: (text: string) => void | Promise<void>;
}

export function SelectionBar({ editor, projectId, entities, onShowInWorld, onWhereUsed, onEntityCreated, onAskPero, onFindSimilar, onComment }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'bar' });
  const [pos, setPos] = useState<Pos | null>(null);
  const [matched, setMatched] = useState<Entity | null>(null);
  const selRef = useRef<{ from: number; to: number; text: string }>({ from: 0, to: 0, text: '' });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  // Идёт ли протяжка мышью — пока тянем, бар НЕ показываем (иначе он прыгает за курсором).
  // Показываем один раз, когда выделение закончено (mouseup), как в Medium/Notion/Word.
  const draggingRef = useRef(false);

  // ── Отслеживание выделения ──────────────────────────────────────────────────
  const update = useCallback(() => {
    if (editor.isDestroyed) return;
    if (phaseRef.current.kind !== 'bar') return; // заморожено пока открыта под-панель
    if (draggingRef.current) return;             // во время протяжки — не дёргаем бар
    const { from, to } = editor.state.selection;
    if (from === to) { setPos(null); setMatched(null); return; }
    const text = editor.state.doc.textBetween(from, to, ' ').trim();
    if (!text) { setPos(null); setMatched(null); return; }
    try {
      const a = editor.view.coordsAtPos(from);
      const b = editor.view.coordsAtPos(to);
      selRef.current = { from, to, text };
      setMatched(matchEntity(text, entities));
      setPos({ top: Math.min(a.top, b.top), left: (a.left + b.right) / 2 });
    } catch { setPos(null); }
  }, [editor, entities]);

  useEffect(() => {
    const onBlur = () => { if (phaseRef.current.kind === 'bar') { setPos(null); setMatched(null); } };
    // Старт протяжки: прячем бар и замораживаем обновления до отпускания.
    const onDown = () => {
      if (phaseRef.current.kind !== 'bar') return;
      draggingRef.current = true;
      setPos(null); setMatched(null);
    };
    // Конец протяжки: выделение готово — показываем бар один раз на финальной позиции.
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      requestAnimationFrame(update); // дать выделению устаканиться
    };
    // editor.view может быть недоступен во время размонтирования/HMR — не падаем.
    if (editor.isDestroyed) return;
    let dom: HTMLElement;
    try { dom = editor.view.dom as HTMLElement; } catch { return; }
    dom.addEventListener('mousedown', onDown);
    dom.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
    editor.on('selectionUpdate', update); // клавиатурное выделение (Shift+стрелки) — мгновенно
    editor.on('blur', onBlur);
    return () => {
      dom.removeEventListener('mousedown', onDown);
      dom.removeEventListener('touchstart', onDown);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchend', onUp);
      editor.off('selectionUpdate', update);
      editor.off('blur', onBlur);
    };
  }, [editor, update]);

  const close = useCallback(() => { setPhase({ kind: 'bar' }); setPos(null); setMatched(null); }, []);

  // ── Действия ─────────────────────────────────────────────────────────────────
  const fmt = (fn: () => void) => (e: React.MouseEvent) => { e.preventDefault(); fn(); };

  const insertFootnote = () => {
    const { to } = selRef.current;
    const id = crypto.randomUUID();
    editor.chain().focus().setTextSelection(to).insertFootnote({ id }).run();
    close();
  };

  const runCheck = useCallback(async () => {
    if (!projectId) return;
    setPhase({ kind: 'checking' });
    try {
      const data = await api.post<{ issues: Issue[]; note?: string }>('/ai/consistency', {
        projectId, chapterContent: selRef.current.text,
      });
      setPhase({ kind: 'check', issues: data.issues ?? [], note: data.note });
    } catch (err: any) {
      const message = err?.status === 429 && err?.message ? err.message
        : err?.status === 503 ? 'ИИ временно недоступен' : 'Не удалось проверить';
      setPhase({ kind: 'error', message });
      setTimeout(close, err?.status === 429 ? 5000 : 2500);
    }
  }, [projectId, close]);

  const createEntity = useCallback(async (type: string) => {
    if (!projectId) return;
    setPhase({ kind: 'creating' });
    const name = selRef.current.text.trim().slice(0, 80);
    try {
      const entity = await api.post<Entity>(`/bible/${projectId}/entities`, { type, name });
      onEntityCreated?.(entity);
      setPhase({ kind: 'created', entity });
      setTimeout(close, 1800);
    } catch (err: any) {
      const message = err?.status === 429 && err?.message ? err.message : 'Не удалось создать';
      setPhase({ kind: 'error', message });
      setTimeout(close, err?.status === 429 ? 5000 : 2500);
    }
  }, [projectId, onEntityCreated, close]);

  const addComment = useCallback(() => {
    if (!onComment) return;
    const text = selRef.current.text.trim();
    if (!text) return;
    onComment(text); // создание марки + карточка-композер — в Editor
    close();
  }, [onComment, close]);

  if (!pos) return null;

  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  // Держим всплывашку в пределах окна: у самого края выделения широкая карточка
  // (≈340px) иначе уезжает за край. translateX(-50%) → отступ от края ≥ полуширины.
  const HALF = 185;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const clampedLeft = Math.min(Math.max(pos.left, HALF + 8), vw - HALF - 8);

  // ── Рендер ─────────────────────────────────────────────────────────────────
  return createPortal(
    <div
      style={{
        position: 'fixed', top: Math.max(pos.top - 12, 56), left: clampedLeft,
        transform: 'translate(-50%, -100%)', zIndex: 9999, fontFamily: 'inherit',
      }}
      onMouseDown={keepFocus}
    >
      {phase.kind === 'bar' && (
        <div className="flex items-center gap-0.5 bg-[#1e2d1f] rounded-xl px-2 py-2 shadow-2xl animate-in fade-in slide-in-from-bottom-1 duration-150">
          {/* Формат */}
          <BarIconButton title="Жирный" onMouseDown={fmt(() => editor.chain().focus().toggleBold().run())}><Bold size={15} /></BarIconButton>
          <BarIconButton title="Курсив" onMouseDown={fmt(() => editor.chain().focus().toggleItalic().run())}><Italic size={15} /></BarIconButton>
          {!matched && (
            <>
              <BarIconButton title="Цитата" onMouseDown={fmt(() => editor.chain().focus().toggleBlockquote().run())}><Quote size={15} /></BarIconButton>
              <BarIconButton title="Сноска" onMouseDown={fmt(insertFootnote)}>
                <span className="text-[14px] leading-none">аб<span className="text-[9px] text-[#b9a9cc]">1</span></span>
              </BarIconButton>
            </>
          )}
          <span className="w-px h-4 bg-white/14 mx-1" />

          {matched ? (
            <>
              <BarTextButton onMouseDown={(e) => { e.preventDefault(); setPhase({ kind: 'preview' }); }} accent>
                <BookOpen size={14} /> Что знает Перо
              </BarTextButton>
              <BarTextButton onMouseDown={(e) => { e.preventDefault(); onWhereUsed(matched); close(); }}>
                <Telescope size={14} /> Где встречается
              </BarTextButton>
              <BarTextButton onMouseDown={(e) => { e.preventDefault(); runCheck(); }}>
                <AlertTriangle size={14} /> Проверить
              </BarTextButton>
              {onComment && (
                <BarTextButton onMouseDown={(e) => { e.preventDefault(); addComment(); }}>
                  <MessageSquarePlus size={14} /> Комментарий
                </BarTextButton>
              )}
            </>
          ) : (
            <>
              <BarTextButton onMouseDown={(e) => { e.preventDefault(); setPhase({ kind: 'create' }); }} accent>
                <Sparkles size={14} /> Создать сущность
              </BarTextButton>
              <BarTextButton onMouseDown={(e) => { e.preventDefault(); runCheck(); }}>
                <AlertTriangle size={14} /> Проверить
              </BarTextButton>
              {onComment && (
                <BarTextButton onMouseDown={(e) => { e.preventDefault(); addComment(); }}>
                  <MessageSquarePlus size={14} /> Комментарий
                </BarTextButton>
              )}
              {onFindSimilar && (
                <BarTextButton onMouseDown={(e) => { e.preventDefault(); onFindSimilar(selRef.current.text); close(); }}>
                  <Telescope size={14} /> Найти похожее
                </BarTextButton>
              )}
              {onAskPero && (
                <BarTextButton onMouseDown={(e) => { e.preventDefault(); onAskPero(selRef.current.text); close(); }}>
                  <MessageSquare size={14} /> Спросить Перо
                </BarTextButton>
              )}
            </>
          )}
        </div>
      )}

      {/* Мини-карточка сущности «Что знает Перо» */}
      {phase.kind === 'preview' && matched && (
        <div className="bg-white border border-[#1e2d1f]/12 rounded-2xl shadow-2xl overflow-hidden w-[330px] animate-in fade-in slide-in-from-bottom-1 duration-150">
          <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2.5">
            <span
              className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold text-white flex-shrink-0"
              style={{ background: TYPE_PIGMENT[matched.type] ?? '#54627F' }}
            >
              {matched.name.trim().charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-[#1e2d1f] leading-tight truncate">{matched.name}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider mt-0.5" style={{ color: TYPE_PIGMENT[matched.type] ?? '#54627F' }}>
                {TYPE_LABEL[matched.type] ?? 'мир'}{matched.significance ? ` · ${SIGNIFICANCE_LABEL[matched.significance] ?? ''}` : ''}
              </div>
            </div>
            <button onMouseDown={(e) => { e.preventDefault(); setPhase({ kind: 'bar' }); }} className="p-1 rounded-md hover:bg-[#1e2d1f]/6 text-[#1e2d1f]/45"><X size={13} /></button>
          </div>
          {matched.description && (
            <p className="px-4 pb-2.5 text-[12.5px] leading-relaxed text-[#1e2d1f]/85">{matched.description}</p>
          )}
          <div className="flex items-center gap-2 px-4 pb-3.5 pt-1 border-t border-[#1e2d1f]/6">
            <button
              onMouseDown={(e) => { e.preventDefault(); onShowInWorld(matched); close(); }}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-[#1e2d1f] text-white text-[12px] font-semibold rounded-xl hover:bg-[#2a3f2b] transition-colors"
            >
              Открыть в Мире
            </button>
            <button
              onMouseDown={(e) => { e.preventDefault(); onWhereUsed(matched); close(); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-[#1e2d1f]/6 text-[#1e2d1f]/70 text-[12px] font-medium rounded-xl hover:bg-[#1e2d1f]/10 transition-colors"
            >
              Где встречается
            </button>
          </div>
        </div>
      )}

      {/* Выбор типа для «Создать сущность» */}
      {phase.kind === 'create' && (
        <div className="bg-[#1e2d1f] rounded-xl shadow-2xl p-1.5 animate-in fade-in slide-in-from-bottom-1 duration-150 min-w-[180px]">
          <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/40">Создать в Мире как</div>
          {CREATE_TYPES.map(t => (
            <button
              key={t.type}
              onMouseDown={(e) => { e.preventDefault(); createEntity(t.type); }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] text-white/80 hover:bg-white/10 hover:text-white transition-colors"
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: TYPE_PIGMENT[t.type] }} />
              {t.label}
              <ChevronRight size={12} className="ml-auto text-white/30" />
            </button>
          ))}
        </div>
      )}

      {(phase.kind === 'checking' || phase.kind === 'creating') && (
        <div className="flex items-center gap-2 bg-[#1e2d1f] rounded-xl px-4 py-2.5 shadow-2xl">
          <Loader2 size={13} className="text-white/60 animate-spin" />
          <span className="text-[12px] text-white/75 font-medium">{phase.kind === 'checking' ? 'Проверяю фрагмент…' : 'Создаю…'}</span>
        </div>
      )}

      {phase.kind === 'created' && (
        <div className="flex items-center gap-2 bg-[#1e2d1f] rounded-xl px-4 py-2.5 shadow-2xl animate-in fade-in duration-150">
          <Check size={13} className="text-[#8AAE86]" />
          <span className="text-[12px] text-white/85 font-medium">«{phase.entity.name}» добавлен в Мир</span>
        </div>
      )}

      {/* Результат проверки фрагмента */}
      {phase.kind === 'check' && (
        <div className="bg-white border border-[#1e2d1f]/12 rounded-2xl shadow-2xl overflow-hidden w-[340px] animate-in fade-in slide-in-from-bottom-1 duration-150">
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-[#1e2d1f]/6">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#1e2d1f]/55">Проверка фрагмента</span>
            <button onMouseDown={(e) => { e.preventDefault(); close(); }} className="p-1 rounded-md hover:bg-[#1e2d1f]/6 text-[#1e2d1f]/45"><X size={13} /></button>
          </div>
          <div className="px-4 py-3 max-h-[240px] overflow-y-auto">
            {phase.issues.length === 0 ? (
              <div className="flex items-center gap-2 text-[13px] text-[#4A5D4E]">
                <Check size={15} /> {phase.note ?? 'Нестыковок с Миром не нашёл.'}
              </div>
            ) : (
              <ul className="space-y-2.5">
                {phase.issues.map((it, i) => (
                  <li key={i} className="flex gap-2">
                    <AlertTriangle size={14} className="flex-shrink-0 mt-0.5 text-[#9E4338]" />
                    <div>
                      <div className="text-[12px] font-semibold text-[#1e2d1f]">{it.entity}</div>
                      <div className="text-[12.5px] text-[#1e2d1f]/80 leading-snug">{it.issue}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="flex items-center gap-2 bg-[#9E4338] rounded-xl px-4 py-2.5 shadow-2xl animate-in fade-in duration-150">
          <X size={13} className="text-white/80" />
          <span className="text-[12px] text-white font-medium">{phase.message}</span>
        </div>
      )}
    </div>,
    document.body,
  );
}

// ── Кнопки бара ───────────────────────────────────────────────────────────────

function BarIconButton({ children, title, onMouseDown }: { children: React.ReactNode; title: string; onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <button
      title={title} aria-label={title} onMouseDown={onMouseDown}
      className="flex items-center justify-center w-8 h-8 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors select-none"
    >
      {children}
    </button>
  );
}

function BarTextButton({ children, onMouseDown, accent }: { children: React.ReactNode; onMouseDown: (e: React.MouseEvent) => void; accent?: boolean }) {
  return (
    <button
      onMouseDown={onMouseDown}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap select-none ${
        accent ? 'text-[#d98b7e] hover:text-[#e8a99e] hover:bg-white/10' : 'text-white/70 hover:text-white hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  );
}
