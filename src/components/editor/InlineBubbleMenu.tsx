/**
 * InlineBubbleMenu — AI quick-actions popup that appears above selected text.
 *
 * Implemented as a custom floating overlay (createPortal + coordsAtPos)
 * rather than Tiptap's BubbleMenu component, which is not a React element in v3.
 *
 * Flow:
 *   idle    → user selects text → bubble appears with action buttons
 *   loading → user clicks action → spinner replaces buttons
 *   result  → AI responds → result text + Replace / Cancel / Retry
 *   error   → fades away automatically after 2.5s
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Editor as TiptapEditor } from '@tiptap/react';
import {
  Minimize2, Scissors, MessageSquare, Zap, RefreshCw,
  ChevronsUpDown, Check, X, Loader2,
} from 'lucide-react';
import { api } from '../../services/api';

// ── Action definitions ────────────────────────────────────────────────────────

type ActionId = 'denser' | 'shorten' | 'dialogue' | 'conflict' | 'rewrite' | 'expand';

interface Action {
  id: ActionId;
  label: string;
  icon: React.ElementType;
}

const ACTIONS: Action[] = [
  { id: 'denser',   label: 'Плотнее',      icon: Minimize2      },
  { id: 'shorten',  label: 'Сократи',       icon: Scissors       },
  { id: 'dialogue', label: 'Диалог живее',  icon: MessageSquare  },
  { id: 'conflict', label: 'Конфликт',       icon: Zap            },
  { id: 'rewrite',  label: 'Переписать',    icon: RefreshCw      },
  { id: 'expand',   label: 'Развернуть',    icon: ChevronsUpDown },
];

// ── State ─────────────────────────────────────────────────────────────────────

type PanelState =
  | { phase: 'idle' }
  | { phase: 'loading'; actionId: ActionId }
  | { phase: 'result'; actionId: ActionId; result: string; selFrom: number; selTo: number }
  | { phase: 'error'; message: string };

interface BubblePos {
  top: number;   // px from viewport top
  left: number;  // px from viewport left (centered on selection)
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  editor: TiptapEditor;
  projectId?: string;
}

export function InlineBubbleMenu({ editor, projectId }: Props) {
  const [panel, setPanel] = useState<PanelState>({ phase: 'idle' });
  const [pos, setPos] = useState<BubblePos | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef(panel);
  panelRef.current = panel;

  // ── Position tracking ───────────────────────────────────────────────────────

  const updatePosition = useCallback(() => {
    if (editor.isDestroyed) return;
    const { from, to } = editor.state.selection;

    // Hide for empty selections
    if (from === to) {
      setPos(null);
      return;
    }

    const selectedText = editor.state.doc.textBetween(from, to, ' ').trim();
    if (!selectedText) {
      setPos(null);
      return;
    }

    try {
      // Get coordinates of selection start and end
      const startCoords = editor.view.coordsAtPos(from);
      const endCoords   = editor.view.coordsAtPos(to);

      // Center horizontally over the selection, anchor just above the top line
      const midX = (startCoords.left + endCoords.right) / 2;
      const topY  = Math.min(startCoords.top, endCoords.top);

      setPos({ top: topY, left: midX });
    } catch {
      setPos(null);
    }
  }, [editor]);

  useEffect(() => {
    editor.on('selectionUpdate', updatePosition);
    editor.on('blur', () => {
      // Don't hide while the result panel is visible (user clicks Accept/Cancel)
      if (panelRef.current.phase === 'idle') setPos(null);
    });
    return () => {
      editor.off('selectionUpdate', updatePosition);
    };
  }, [editor, updatePosition]);

  // When selection is cleared externally (e.g. after replace), hide
  useEffect(() => {
    const { from, to } = editor.state.selection;
    if (from === to && panel.phase === 'idle') setPos(null);
  });

  // ── AI action ──────────────────────────────────────────────────────────────

  const handleAction = useCallback(async (action: Action) => {
    if (panelRef.current.phase === 'loading') return;

    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, ' ');
    if (!selectedText.trim()) return;

    setPanel({ phase: 'loading', actionId: action.id });

    try {
      const data = await api.post<{ result: string }>('/ai/transform', {
        text: selectedText,
        action: action.id,
        projectId,
      });

      setPanel({
        phase: 'result',
        actionId: action.id,
        result: data.result,
        selFrom: from,
        selTo: to,
      });
    } catch (err: any) {
      const message =
        err?.status === 429 && err?.message ? err.message :
        err?.status === 503 ? 'ИИ временно недоступен' :
        'Ошибка. Попробуйте ещё раз.';
      setPanel({ phase: 'error', message });
      setTimeout(() => setPanel({ phase: 'idle' }), err?.status === 429 ? 5000 : 2500);
    }
  }, [editor, projectId]);

  const handleReplace = useCallback(() => {
    if (panel.phase !== 'result') return;
    const { result, selFrom, selTo } = panel;
    editor.chain().focus().setTextSelection({ from: selFrom, to: selTo }).insertContent(result).run();
    setPanel({ phase: 'idle' });
    setPos(null);
  }, [editor, panel]);

  const handleCancel = useCallback(() => {
    if (panel.phase === 'result') {
      editor.commands.setTextSelection({ from: panel.selFrom, to: panel.selTo });
    }
    setPanel({ phase: 'idle' });
    setPos(null);
  }, [editor, panel]);

  // ── Render ─────────────────────────────────────────────────────────────────

  // Nothing to show
  if (!pos || panel.phase === 'idle' && pos === null) return null;

  // The bubble is hidden when selection is cleared AND we're not showing a result
  if (!pos && panel.phase !== 'result' && panel.phase !== 'loading') return null;

  const activeAction = (panel.phase === 'loading' || panel.phase === 'result')
    ? ACTIONS.find(a => a.id === panel.actionId)
    : null;

  // Render into document.body so it floats above everything
  return createPortal(
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        top: pos ? pos.top - 12 : 0,   // 12px above the selection top
        left: pos ? pos.left : 0,
        transform: 'translate(-50%, -100%)',
        zIndex: 9999,
        pointerEvents: 'auto',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* ── Idle: action buttons ── */}
      {panel.phase === 'idle' && pos && (
        <div className="flex items-center gap-0.5 bg-[#1e2d1f] rounded-xl px-1.5 py-1.5 shadow-2xl animate-in fade-in slide-in-from-bottom-1 duration-150">
          {ACTIONS.map(action => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                onMouseDown={e => { e.preventDefault(); handleAction(action); }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/70 hover:text-white hover:bg-white/10 transition-all whitespace-nowrap select-none"
                title={action.label}
              >
                <Icon size={12} className="flex-shrink-0" />
                <span>{action.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Loading ── */}
      {panel.phase === 'loading' && (
        <div className="flex items-center gap-2 bg-[#1e2d1f] rounded-xl px-4 py-2.5 shadow-2xl">
          <Loader2 size={13} className="text-white/60 animate-spin flex-shrink-0" />
          <span className="text-[12px] text-white/75 font-medium">{activeAction?.label}…</span>
        </div>
      )}

      {/* ── Error ── */}
      {panel.phase === 'error' && (
        <div className="flex items-center gap-2 bg-red-600 rounded-xl px-4 py-2.5 shadow-2xl animate-in fade-in duration-150">
          <X size={13} className="text-white/80 flex-shrink-0" />
          <span className="text-[12px] text-white font-medium">{panel.message}</span>
        </div>
      )}

      {/* ── Result ── */}
      {panel.phase === 'result' && (
        <div
          className="bg-white border border-[#1e2d1f]/12 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-150"
          style={{ width: '380px' }}
          onMouseDown={e => e.preventDefault()} // keep editor focus
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3.5 pt-3 pb-2 border-b border-[#1e2d1f]/6">
            <span className="text-[10px] font-bold text-[#1e2d1f]/40 uppercase tracking-widest">
              {activeAction?.label}
            </span>
            <button
              onMouseDown={e => { e.preventDefault(); handleCancel(); }}
              className="p-1 rounded-md hover:bg-[#1e2d1f]/6 text-[#1e2d1f]/30 hover:text-[#1e2d1f]/60 transition-colors"
            >
              <X size={13} />
            </button>
          </div>

          {/* Result text */}
          <div className="px-3.5 py-3 max-h-[220px] overflow-y-auto">
            <p className="text-[13px] text-[#1e2d1f] leading-relaxed whitespace-pre-wrap font-serif">
              {panel.result}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 px-3.5 pb-3 pt-1 border-t border-[#1e2d1f]/5">
            <button
              onMouseDown={e => { e.preventDefault(); handleReplace(); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#1e2d1f] text-white text-[12px] font-semibold rounded-xl hover:bg-[#2a3f2b] transition-colors"
            >
              <Check size={13} />
              Заменить
            </button>
            <button
              onMouseDown={e => {
                e.preventDefault();
                handleAction(ACTIONS.find(a => a.id === panel.actionId)!);
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-[#1e2d1f]/6 text-[#1e2d1f]/70 text-[12px] font-medium rounded-xl hover:bg-[#1e2d1f]/10 transition-colors"
              title="Сгенерировать другой вариант"
            >
              <RefreshCw size={11} />
              Ещё
            </button>
            <button
              onMouseDown={e => { e.preventDefault(); handleCancel(); }}
              className="ml-auto text-[11px] text-[#1e2d1f]/35 hover:text-[#1e2d1f]/60 transition-colors px-2 py-2"
            >
              Отменить
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
