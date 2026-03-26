import { useState, useEffect, RefObject } from 'react';
import {
  X, Sparkles, Send, ShieldCheck, FileText, TrendingUp, BookOpen,
  Minimize2, MessageSquare, Zap, Scissors, Copy, CornerDownLeft,
  MousePointer2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ChatMessage } from './types';

// ── Quick action definitions ──────────────────────────────────────────────────

type QuickActionId =
  | 'summarize' | 'consistency' | 'changes' | 'bible'
  | 'denser' | 'dialogue' | 'conflict' | 'shorten';

interface QuickAction {
  id: QuickActionId;
  label: string;
  icon: React.ElementType;
  /** Whether this action is selection-aware (appends selected text to prompt) */
  selectionAware?: boolean;
  /** Special handler — if set, the action does not generate a prompt but calls this handler */
  special?: 'consistency';
}

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'summarize',   label: 'Суммируй',       icon: FileText,      selectionAware: true  },
  { id: 'consistency', label: 'Противоречия',   icon: ShieldCheck,   special: 'consistency' },
  { id: 'changes',     label: 'Что изменилось', icon: TrendingUp,    selectionAware: false  },
  { id: 'bible',       label: 'Факты для Библии', icon: BookOpen,    selectionAware: true  },
  { id: 'denser',      label: 'Плотнее',         icon: Minimize2,    selectionAware: true  },
  { id: 'dialogue',    label: 'Диалог живее',    icon: MessageSquare, selectionAware: true  },
  { id: 'conflict',    label: 'Усиль конфликт',  icon: Zap,          selectionAware: true  },
  { id: 'shorten',     label: 'Сократи',         icon: Scissors,     selectionAware: true  },
];

function buildPrompt(actionId: QuickActionId, selectedText: string): string {
  const sel = selectedText.trim();
  switch (actionId) {
    case 'summarize':
      return sel
        ? `Суммируй следующий фрагмент кратко:\n\n${sel}`
        : 'Сделай краткое резюме текущей главы: ключевые события, развитие персонажей, важные детали.';
    case 'changes':
      return 'Что произошло с ключевыми персонажами в этой главе? Как они изменились и развились?';
    case 'bible':
      return sel
        ? `Какие факты о персонажах, локациях или мире содержит этот фрагмент? Что добавить в Библию истории?\n\n${sel}`
        : 'Какие новые факты о персонажах, локациях или правилах мира есть в этой главе? Что добавить в Библию истории?';
    case 'denser':
      return sel
        ? `Сделай этот фрагмент более плотным и насыщенным, убери лишние слова:\n\n${sel}`
        : 'Какой фрагмент главы можно сделать плотнее? Предложи конкретную редактуру.';
    case 'dialogue':
      return sel
        ? `Сделай этот диалог живее и естественнее:\n\n${sel}`
        : 'Найди диалог в главе, который звучит неестественно, и предложи, как его улучшить.';
    case 'conflict':
      return sel
        ? `Усиль конфликт в этом фрагменте, предложи конкретные правки:\n\n${sel}`
        : 'Как можно усилить конфликт в этой главе? Что работает слабо?';
    case 'shorten':
      return sel
        ? `Сократи этот фрагмент, сохранив смысл:\n\n${sel}`
        : 'Какие части главы можно сократить без потери смысла?';
    default:
      return '';
  }
}

/** Strip the most common Markdown to plain text for pasting into the editor. */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')      // **bold**
    .replace(/\*([^*]+)\*/g, '$1')           // *italic*
    .replace(/^#{1,6}\s+/gm, '')             // # headings
    .replace(/^[-*+]\s+/gm, '• ')           // list items
    .replace(/`([^`]+)`/g, '$1')             // `code`
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [link](url)
    .trim();
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  chatMessages: ChatMessage[];
  isHistoryLoaded: boolean;
  chatInput: string;
  onChatInputChange: (v: string) => void;
  isAiLoading: boolean;
  isCheckingConsistency: boolean;
  chatEndRef: RefObject<HTMLDivElement>;
  selectedText: string;
  onSendMessage: () => void;
  onSendPrompt: (prompt: string) => void;
  onCheckConsistency: () => void;
  /** Insert text at the editor cursor position */
  onInsertText: (text: string) => void;
  onClose: () => void;
}

export function CoauthorPanel({
  chatMessages,
  isHistoryLoaded,
  chatInput,
  onChatInputChange,
  isAiLoading,
  isCheckingConsistency,
  chatEndRef,
  selectedText,
  onSendMessage,
  onSendPrompt,
  onCheckConsistency,
  onInsertText,
  onClose,
}: Props) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const hasSelection = selectedText.trim().length > 0;

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  const handleQuickAction = (action: QuickAction) => {
    if (isAiLoading) return;
    if (action.special === 'consistency') {
      onCheckConsistency();
      return;
    }
    const prompt = buildPrompt(action.id, selectedText);
    if (prompt) onSendPrompt(prompt);
  };

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(stripMarkdown(text)).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1800);
    });
  };

  const trimmedSelection = hasSelection && selectedText.length > 60
    ? selectedText.slice(0, 60).trimEnd() + '…'
    : selectedText;

  return (
    <div className="flex flex-col h-full w-[320px]">
      {/* ── Header ── */}
      <div className="p-5 border-b border-[#1e2d1f]/5 flex justify-between items-center bg-white/40 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-purple-500" />
          <h2 className="font-serif font-bold text-lg text-[#1e2d1f]">ИИ-Соавтор</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-[#1e2d1f]/5 text-[#1e2d1f]/50 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {/* ── Selection indicator ── */}
      {hasSelection && (
        <div className="px-3 pt-2 flex-shrink-0">
          <div className="flex items-center gap-1.5 bg-purple-50 border border-purple-100 rounded-lg px-2.5 py-1.5">
            <MousePointer2 size={10} className="text-purple-400 flex-shrink-0" />
            <span className="text-[10px] text-purple-600 font-medium truncate flex-1">
              {trimmedSelection}
            </span>
            <span className="text-[9px] text-purple-400 flex-shrink-0">выделено</span>
          </div>
        </div>
      )}

      {/* ── Quick actions grid ── */}
      <div className="px-3 pt-2 pb-2.5 border-b border-[#1e2d1f]/5 flex-shrink-0">
        <div className="grid grid-cols-2 gap-1.5">
          {QUICK_ACTIONS.map(action => {
            const Icon = action.icon;
            const willUseSelection = hasSelection && action.selectionAware;
            return (
              <button
                key={action.id}
                onClick={() => handleQuickAction(action)}
                disabled={isAiLoading}
                title={willUseSelection ? 'По выделению' : undefined}
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-[11px] font-medium text-left transition-all
                  disabled:opacity-40 disabled:cursor-not-allowed
                  ${willUseSelection
                    ? 'bg-purple-50 border border-purple-100 text-purple-700 hover:bg-purple-100 hover:border-purple-200'
                    : 'bg-white/70 border border-[#1e2d1f]/8 text-[#1e2d1f]/70 hover:bg-white hover:border-[#1e2d1f]/20 hover:text-[#1e2d1f]'
                  }`}
              >
                <Icon size={12} className="flex-shrink-0" />
                <span className="truncate">{action.label}</span>
                {willUseSelection && (
                  <span className="ml-auto text-[8px] text-purple-400 flex-shrink-0">↑</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* History loading skeleton */}
        {!isHistoryLoaded && (
          <div className="flex flex-col items-start gap-2 animate-pulse">
            <div className="h-8 w-3/4 rounded-2xl bg-[#1e2d1f]/8" />
            <div className="h-8 w-1/2 rounded-2xl bg-[#1e2d1f]/5" />
          </div>
        )}

        {isHistoryLoaded && chatMessages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                msg.role === 'user'
                  ? 'bg-[#1e2d1f] text-white rounded-br-sm'
                  : 'bg-white border border-[#1e2d1f]/10 text-[#1e2d1f] rounded-bl-sm shadow-sm ' +
                    'prose prose-sm prose-p:my-1 prose-strong:text-[#1e2d1f] max-w-none'
              }`}
            >
              {msg.role === 'user' ? msg.text : <ReactMarkdown>{msg.text}</ReactMarkdown>}
            </div>

            {/* Response actions for AI messages */}
            {msg.role === 'ai' && (
              <div className="flex items-center gap-0.5 mt-1 ml-1">
                <button
                  onClick={() => handleCopy(msg.text, idx)}
                  className="flex items-center gap-1 text-[10px] text-[#1e2d1f]/35 hover:text-[#1e2d1f]/65 px-1.5 py-0.5 rounded-md hover:bg-[#1e2d1f]/5 transition-colors"
                  title="Скопировать"
                >
                  <Copy size={10} />
                  {copiedIdx === idx ? 'Скопировано' : 'Копировать'}
                </button>
                <button
                  onClick={() => onInsertText(stripMarkdown(msg.text))}
                  className="flex items-center gap-1 text-[10px] text-[#1e2d1f]/35 hover:text-[#1e2d1f]/65 px-1.5 py-0.5 rounded-md hover:bg-[#1e2d1f]/5 transition-colors"
                  title="Вставить в текст на позиции курсора"
                >
                  <CornerDownLeft size={10} />
                  Вставить
                </button>
              </div>
            )}
          </div>
        ))}

        {/* AI typing indicator */}
        {isAiLoading && (
          <div className="flex flex-col items-start">
            <div className="max-w-[85%] rounded-2xl px-4 py-2.5 bg-white border border-[#1e2d1f]/10 rounded-bl-sm shadow-sm flex items-center gap-1.5 h-[40px]">
              <div className="w-1.5 h-1.5 rounded-full bg-[#1e2d1f]/30 animate-bounce [animation-delay:0ms]" />
              <div className="w-1.5 h-1.5 rounded-full bg-[#1e2d1f]/30 animate-bounce [animation-delay:150ms]" />
              <div className="w-1.5 h-1.5 rounded-full bg-[#1e2d1f]/30 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* ── Input area ── */}
      <div className="p-4 bg-white/40 border-t border-[#1e2d1f]/5 flex-shrink-0">
        {/* Context pills */}
        <div className="flex items-center gap-1.5 mb-2.5">
          <span className="text-[9px] text-[#1e2d1f]/30 font-medium uppercase tracking-widest">Контекст:</span>
          <span className="text-[9px] text-[#1e2d1f]/45 bg-[#1e2d1f]/5 rounded px-1.5 py-0.5">📖 Библия</span>
          <span className="text-[9px] text-[#1e2d1f]/45 bg-[#1e2d1f]/5 rounded px-1.5 py-0.5">📄 Глава</span>
          {chatMessages.length > 2 && (
            <span className="text-[9px] text-[#1e2d1f]/45 bg-[#1e2d1f]/5 rounded px-1.5 py-0.5">💬 История</span>
          )}
        </div>

        <div className="relative flex items-center">
          <input
            type="text"
            value={chatInput}
            onChange={e => onChatInputChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSendMessage(); }}
            placeholder="Спросите соавтора..."
            disabled={isAiLoading}
            className="w-full bg-white border border-[#1e2d1f]/10 rounded-full pl-4 pr-10 py-2.5 text-sm outline-none focus:border-[#1e2d1f]/30 transition-colors shadow-sm disabled:opacity-50"
          />
          <button
            onClick={onSendMessage}
            disabled={isAiLoading || !chatInput.trim()}
            className="absolute right-1.5 p-1.5 bg-[#1e2d1f] text-white rounded-full hover:bg-[#2a3f2b] transition-colors disabled:opacity-50"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
