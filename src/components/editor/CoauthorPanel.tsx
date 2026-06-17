import { useState, useEffect, useRef, RefObject } from 'react';
import {
  X, Sparkles, Send, ShieldCheck, FileText, TrendingUp, BookOpen, MessageCircle,
  Copy, CornerDownLeft, MousePointer2, Users,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ChatMessage } from './types';
import { useAiQuota } from '../../hooks/useAiQuota';

// ── Quick action definitions ──────────────────────────────────────────────────

// Перо — аналитик, а не генератор: только «прочитать и ответить / сверить / извлечь
// в библию». Трансформации текста (Плотнее/Диалог/Усиль/Сократи) убраны (REORG_PLAN шаг 5).
type QuickActionId = 'summarize' | 'consistency' | 'changes' | 'bible' | 'whohere';

interface QuickAction {
  id: QuickActionId;
  label: string;
  icon: React.ElementType;
  selectionAware?: boolean;
  special?: 'consistency' | 'bible';
}

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'whohere',     label: 'Кто в сцене?',     icon: Users,         selectionAware: false  },
  { id: 'consistency', label: 'Сверь сцену',      icon: ShieldCheck,   special: 'consistency' },
  { id: 'summarize',   label: 'Суммируй',         icon: FileText,      selectionAware: true  },
  { id: 'changes',     label: 'Что изменилось',   icon: TrendingUp,    selectionAware: false  },
  { id: 'bible',       label: 'Извлечь в Мир',    icon: BookOpen,      special: 'bible'       },
];

// ── Empty state suggestions (вопросы к Перу — оно отвечает по рукописи) ──────────

const SUGGESTIONS = [
  'Сделай краткое резюме этой главы',
  'Что происходит с главным героем?',
  'Нет ли противоречий в этой главе?',
  'Что я уже рассказал про этот мир?',
  'Какие детали сцены я мог упустить?',
];

function buildPrompt(actionId: QuickActionId, selectedText: string): string {
  const sel = selectedText.trim();
  switch (actionId) {
    case 'summarize':
      return sel
        ? `Суммируй следующий фрагмент кратко:\n\n${sel}`
        : 'Сделай краткое резюме текущей главы: ключевые события, развитие персонажей, важные детали.';
    case 'whohere':
      return 'Кто и что из мира встречается в этой главе? Перечисли персонажей, локации и предметы и кратко напомни ключевые факты о каждом.';
    case 'changes':
      return 'Что произошло с ключевыми персонажами в этой главе? Как они изменились и развились?';
    case 'bible':
      return sel
        ? `Какие факты о персонажах, локациях или мире содержит этот фрагмент? Что добавить в Мир?\n\n${sel}`
        : 'Какие новые факты о персонажах, локациях или правилах мира есть в этой главе? Что добавить в Мир?';
    default:
      return '';
  }
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

// ── Streaming cursor ──────────────────────────────────────────────────────────

function StreamingCursor() {
  return (
    <span className="inline-block w-[2px] h-[13px] bg-[#1e2d1f]/50 ml-0.5 align-middle animate-pulse" />
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  chatMessages: ChatMessage[];
  isHistoryLoaded: boolean;
  chatInput: string;
  onChatInputChange: (v: string) => void;
  isAiLoading: boolean;
  isCheckingConsistency: boolean;
  isExtracting?: boolean;
  chatEndRef: RefObject<HTMLDivElement>;
  selectedText: string;
  onSendMessage: () => void;
  onSendPrompt: (prompt: string) => void;
  onCheckConsistency: () => void;
  onExtractBible: () => void;
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
  isExtracting,
  chatEndRef,
  selectedText,
  onSendMessage,
  onSendPrompt,
  onCheckConsistency,
  onExtractBible,
  onInsertText,
  onClose,
}: Props) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasSelection = selectedText.trim().length > 0;
  // Перезапрашиваем квоту после каждого AI-вызова (isAiLoading: true → false)
  const { quota } = useAiQuota(isAiLoading);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [chatInput]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  const handleQuickAction = (action: QuickAction) => {
    if (isAiLoading) return;
    if (action.special === 'consistency') { onCheckConsistency(); return; }
    if (action.special === 'bible')       { onExtractBible();     return; }
    const prompt = buildPrompt(action.id, selectedText);
    if (prompt) onSendPrompt(prompt);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
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

  // The last AI message is still streaming if isAiLoading and its text is growing
  const isStreaming = isAiLoading && !isCheckingConsistency;
  const lastMsg     = chatMessages[chatMessages.length - 1];
  const lastIsAi    = lastMsg?.role === 'ai';

  // Show empty state when only the greeting is present
  const isEmptyState = isHistoryLoaded &&
    chatMessages.length === 1 &&
    chatMessages[0].text === 'Привет! Я твой ИИ-соавтор. Чем могу помочь с этой главой?';

  return (
    <div className="flex flex-col h-full w-full">
      {/* ── Header ── */}
      <div className="p-5 border-b border-[#1e2d1f]/5 flex justify-between items-center bg-white/40 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-purple-500" />
          <div>
            <h2 className="font-serif font-bold text-lg text-[#1e2d1f] leading-tight">ИИ-Соавтор</h2>
            {quota && (
              <p
                className={`text-[11px] leading-tight ${
                  quota.remaining === 0
                    ? 'text-[#9E4338]'
                    : quota.remaining <= Math.ceil(quota.limit * 0.15)
                      ? 'text-[#91682E]'
                      : 'text-[#1e2d1f]/55'
                }`}
                title={`Тариф: ${quota.plan === 'pro' ? 'Pro' : 'Бесплатный'}. Лимит обновится в полночь по UTC.`}
              >
                {quota.remaining === 0
                  ? 'Дневной лимит AI исчерпан'
                  : `AI-действий сегодня: ${quota.remaining} из ${quota.limit}`}
              </p>
            )}
          </div>
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
            const isBibleAction    = action.special === 'bible';
            const isBibleLoading   = isBibleAction && isExtracting;
            const isDisabled       = isBibleAction ? (isAiLoading || isExtracting) : isAiLoading;
            return (
              <button
                key={action.id}
                onClick={() => handleQuickAction(action)}
                disabled={isDisabled}
                title={
                  willUseSelection ? 'По выделению' :
                  isBibleAction ? 'Извлечь персонажей, локации и правила мира' : undefined
                }
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-[11px] font-medium text-left transition-all
                  disabled:opacity-40 disabled:cursor-not-allowed
                  ${isBibleAction
                    ? 'bg-[#E5EBE0] border border-[#4D6B4D] text-[#4D6B4D] hover:bg-[#E5EBE0] hover:border-[#4D6B4D]'
                    : willUseSelection
                    ? 'bg-purple-50 border border-purple-100 text-purple-700 hover:bg-purple-100 hover:border-purple-200'
                    : 'bg-white/70 border border-[#1e2d1f]/8 text-[#1e2d1f]/70 hover:bg-white hover:border-[#1e2d1f]/20 hover:text-[#1e2d1f]'
                  }`}
              >
                {isBibleLoading
                  ? <div className="w-3 h-3 border border-[#4D6B4D] border-t-emerald-700 rounded-full animate-spin flex-shrink-0" />
                  : <Icon size={12} className="flex-shrink-0" />
                }
                <span className="truncate">{isBibleLoading ? 'Извлекаю...' : action.label}</span>
                {willUseSelection && !isBibleAction && (
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

        {isHistoryLoaded && chatMessages.map((msg, idx) => {
          const isLastAiStreaming = isStreaming && lastIsAi && idx === chatMessages.length - 1 && msg.role === 'ai';
          return (
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
                {msg.role === 'user'
                  ? msg.text
                  : (
                    <>
                      <ReactMarkdown>{msg.text}</ReactMarkdown>
                      {isLastAiStreaming && msg.text === '' && (
                        <span className="flex items-center gap-1 h-5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#1e2d1f]/30 animate-bounce [animation-delay:0ms]" />
                          <span className="w-1.5 h-1.5 rounded-full bg-[#1e2d1f]/30 animate-bounce [animation-delay:150ms]" />
                          <span className="w-1.5 h-1.5 rounded-full bg-[#1e2d1f]/30 animate-bounce [animation-delay:300ms]" />
                        </span>
                      )}
                      {isLastAiStreaming && msg.text !== '' && <StreamingCursor />}
                    </>
                  )
                }
              </div>

              {/* Response actions — only for completed AI messages */}
              {msg.role === 'ai' && !isLastAiStreaming && msg.text && (
                <div className="flex items-center gap-0.5 mt-1 ml-1">
                  <button
                    onClick={() => handleCopy(msg.text, idx)}
                    className="flex items-center gap-1 text-[10px] text-[#1e2d1f]/55 hover:text-[#1e2d1f]/65 px-1.5 py-0.5 rounded-md hover:bg-[#1e2d1f]/5 transition-colors"
                    title="Скопировать"
                  >
                    <Copy size={10} />
                    {copiedIdx === idx ? 'Скопировано' : 'Копировать'}
                  </button>
                  <button
                    onClick={() => onInsertText(stripMarkdown(msg.text))}
                    className="flex items-center gap-1 text-[10px] text-[#1e2d1f]/55 hover:text-[#1e2d1f]/65 px-1.5 py-0.5 rounded-md hover:bg-[#1e2d1f]/5 transition-colors"
                    title="Вставить в текст на позиции курсора"
                  >
                    <CornerDownLeft size={10} />
                    Вставить
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Empty state: suggested questions */}
        {isEmptyState && !isAiLoading && (
          <div className="space-y-2 pt-1">
            <p className="text-[10px] text-[#1e2d1f]/55 font-medium uppercase tracking-widest px-1">
              С чего начать
            </p>
            {SUGGESTIONS.map((s, i) => (
              <button
                key={i}
                onClick={() => onSendPrompt(s)}
                className="w-full text-left text-[12px] text-[#1e2d1f]/65 bg-white/60 hover:bg-white border border-[#1e2d1f]/7 hover:border-[#1e2d1f]/15 rounded-xl px-3 py-2 transition-all leading-snug"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* ── Input area ── */}
      <div className="p-4 bg-white/40 border-t border-[#1e2d1f]/5 flex-shrink-0">
        {/* Context pills */}
        <div className="flex items-center gap-1.5 mb-2.5">
          <span className="text-[9px] text-[#1e2d1f]/55 font-medium uppercase tracking-widest">Контекст:</span>
          <span className="text-[9px] text-[#1e2d1f]/60 bg-[#1e2d1f]/5 rounded px-1.5 py-0.5" style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}><BookOpen size={9} /> Мир</span>
          <span className="text-[9px] text-[#1e2d1f]/60 bg-[#1e2d1f]/5 rounded px-1.5 py-0.5" style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}><FileText size={9} /> Глава</span>
          {chatMessages.length > 2 && (
            <span className="text-[9px] text-[#1e2d1f]/60 bg-[#1e2d1f]/5 rounded px-1.5 py-0.5" style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}><MessageCircle size={9} /> История</span>
          )}
        </div>

        <div className="relative flex items-end">
          <textarea
            ref={textareaRef}
            rows={1}
            value={chatInput}
            onChange={e => onChatInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Спросите соавтора… (Enter — отправить)"
            disabled={isAiLoading}
            className="w-full bg-white border border-[#1e2d1f]/10 rounded-2xl pl-4 pr-10 py-2.5 text-sm outline-none focus:border-[#1e2d1f]/30 transition-colors shadow-sm disabled:opacity-50 resize-none overflow-hidden leading-relaxed"
            style={{ minHeight: '42px' }}
          />
          <button
            onClick={onSendMessage}
            disabled={isAiLoading || !chatInput.trim()}
            className="absolute right-1.5 bottom-1.5 p-1.5 bg-[#1e2d1f] text-white rounded-full hover:bg-[#2a3f2b] transition-colors disabled:opacity-50"
          >
            <Send size={14} />
          </button>
        </div>
        <p className="text-[9px] text-[#1e2d1f]/25 mt-1.5 px-1">
          Enter — отправить · Shift+Enter — новая строка
        </p>
      </div>
    </div>
  );
}
