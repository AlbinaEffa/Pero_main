import { useState, useEffect, useRef, RefObject } from 'react';
import {
  X, Send, ShieldCheck, FileText, TrendingUp, BookOpen, MessageCircle,
  Copy, MousePointer2, Plus, Library,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ChatMessage, Entity } from './types';
import { useAiQuota } from '../../hooks/useAiQuota';
import { PeroMark } from '../Logo';

// Пигменты типов сущностей (как в EntityDetailPanel) — для чипов-ссылок под ответами.
const TYPE_PIGMENT: Record<string, string> = {
  character: '#A14F44', location: '#4A5D4E', item: '#91682E', rule: '#54627F',
};

// ── Ссылки в ответе Перо (наш ров: ответ кликабелен обратно в текст/Мир) ──────────
// Находим в ответе упомянутые сущности (имя + короткое склонение) и «Глава N».
function refRegex(name: string): RegExp {
  const esc = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}])${esc}\\p{L}{0,2}(?![\\p{L}])`, 'iu');
}

function findReferences(text: string, entities: Entity[]): { entities: Entity[]; chapters: number[] } {
  const ents: Entity[] = [];
  const seen = new Set<string>();
  for (const e of entities) {
    if (seen.has(e.id) || !e.name?.trim() || e.name.trim().length < 3) continue;
    try {
      if (refRegex(e.name).test(text)) { ents.push(e); seen.add(e.id); }
    } catch { /* имя с экзотикой — пропускаем */ }
  }
  const chapters = [...new Set(
    [...text.matchAll(/глав[аеуыой]*\s+(\d{1,3})/giu)].map(m => parseInt(m[1], 10)),
  )];
  return { entities: ents.slice(0, 6), chapters: chapters.slice(0, 4) };
}

// ── Quick action definitions ──────────────────────────────────────────────────

// Перо — аналитик, а не генератор: только «прочитать и ответить / сверить / извлечь
// в библию». Трансформации текста (Плотнее/Диалог/Усиль/Сократи) убраны (REORG_PLAN шаг 5).
type QuickActionId = 'summarize' | 'consistency' | 'changes' | 'bible';

interface QuickAction {
  id: QuickActionId;
  label: string;
  icon: React.ElementType;
  selectionAware?: boolean;
  special?: 'consistency' | 'bible';
}

// Единый адаптивный набор действий (раньше дублировался с отдельным списком «С чего начать»).
// Лейбл summarize меняется по контексту: есть фрагмент → «О чём фрагмент?», иначе → «Резюме главы».
// «Кто в главе?» убрана — это видно в соседней вкладке «В кадре» (кто/что в сцене).
const QUICK_ACTIONS: QuickAction[] = [
  { id: 'consistency', label: 'Сверь главу',      icon: ShieldCheck,   special: 'consistency' },
  { id: 'summarize',   label: 'Резюме главы',     icon: FileText,      selectionAware: true  },
  { id: 'changes',     label: 'Что изменилось?',  icon: TrendingUp,    selectionAware: false  },
  { id: 'bible',       label: 'Извлечь в Мир',    icon: BookOpen,      special: 'bible'       },
];

function quickActionLabel(action: QuickAction, hasContext: boolean, freshness?: 'fresh' | 'stale' | 'unknown'): string {
  if (action.id === 'summarize' && hasContext) return 'О чём фрагмент?';
  if (action.id === 'bible') {
    if (freshness === 'fresh') return 'Глава в Мире';   // не зовём агента — просто откроем
    if (freshness === 'stale') return 'Перечитать главу'; // изменилась → перечитать
    return 'Извлечь в Мир';
  }
  return action.label;
}

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
  /** Закреплённый фрагмент-контекст: уходит в промпт чата, виден чипом «Выделение». */
  pinnedSelection?: string;
  onPinSelection?: () => void;
  onClearPinnedSelection?: () => void;
  onSendMessage: () => void;
  onSendPrompt: (prompt: string) => void;
  onCheckConsistency: () => void;
  onExtractBible: () => void;
  onInsertText?: (text: string) => void;
  onClose: () => void;
  /** Для живого пустого стейта: сколько глав прочитано и сколько сущностей в Мире. */
  chapterCount?: number;
  entityCount?: number;
  /** P1: ответы со ссылками — сущности для распознавания + переходы в Мир/главу. */
  entities?: Entity[];
  onOpenEntity?: (e: Entity) => void;
  onJumpToChapter?: (chapterNumber: number) => void;
  /** Ширина контекста: 'chapter' (только эта глава) ↔ 'book' (глава + весь Мир). */
  scope?: 'chapter' | 'book' | 'series';
  onScopeChange?: (s: 'chapter' | 'book' | 'series') => void;
  inSeries?: boolean;
  /** Свежесть главы — кнопка «Извлечь в Мир» не зовёт агента, если глава не менялась. */
  extractFreshness?: 'fresh' | 'stale' | 'unknown';
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
  pinnedSelection = '',
  onPinSelection,
  onClearPinnedSelection,
  onSendMessage,
  onSendPrompt,
  onCheckConsistency,
  onExtractBible,
  onClose,
  chapterCount,
  entityCount,
  entities = [],
  onOpenEntity,
  onJumpToChapter,
  scope = 'book',
  onScopeChange,
  inSeries = false,
  extractFreshness = 'unknown',
}: Props) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  // P2: автокомплит @-упоминаний. null — закрыт; строка — текущий запрос после «@».
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // «Контекст» для адаптивных действий = живое выделение ИЛИ закреплённый фрагмент.
  const contextText = (pinnedSelection.trim() || selectedText.trim());
  const hasSelection = selectedText.trim().length > 0;
  const hasContext = contextText.length > 0;
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
    const prompt = buildPrompt(action.id, contextText);
    if (prompt) onSendPrompt(prompt);
  };

  // P2: кандидаты @-упоминания по текущему запросу (имя содержит запрос).
  const mentionMatches = mentionQuery !== null
    ? entities
        .filter(e => e.name?.trim() && e.name.toLowerCase().includes(mentionQuery.toLowerCase()))
        .slice(0, 6)
    : [];

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    onChatInputChange(val);
    const caret = e.target.selectionStart ?? val.length;
    const before = val.slice(0, caret);
    const m = before.match(/(?:^|\s)@([\p{L}\d_-]*)$/u);
    setMentionQuery(m ? m[1] : null);
  };

  const selectMention = (entity: Entity) => {
    const ta = textareaRef.current;
    const caret = ta?.selectionStart ?? chatInput.length;
    const before = chatInput.slice(0, caret).replace(/@([\p{L}\d_-]*)$/u, `@${entity.name} `);
    const next = before + chatInput.slice(caret);
    onChatInputChange(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = before.length; }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Если открыт автокомплит @ — Enter выбирает первого, Esc закрывает.
    if (mentionQuery !== null && mentionMatches.length) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); selectMention(mentionMatches[0]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMentionQuery(null); return; }
    }
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

  // Show empty state when only the greeting is present (текст-маркер синхронизирован с GREETING в useAiChat)
  const GREETING_TEXT = 'Я Перо — помню всю твою книгу. Спроси о персонажах, событиях, локациях или нестыковках.';
  const isEmptyState = isHistoryLoaded &&
    chatMessages.length === 1 &&
    chatMessages[0].text === GREETING_TEXT;

  return (
    <div className="flex flex-col h-full w-full">
      {/* ── Header ── */}
      <div className="p-5 border-b border-[#1e2d1f]/5 flex justify-between items-center bg-white/40 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <PeroMark size={26} className="text-[#71597F] flex-shrink-0" />
          <div>
            <h2 className="font-serif font-semibold text-[22px] text-[#1e2d1f] leading-none tracking-wide">Перо</h2>
            {quota ? (
              <p
                className={`text-[11px] leading-tight mt-1 flex items-center gap-1.5 ${
                  quota.remaining === 0
                    ? 'text-[#9E4338]'
                    : quota.remaining <= Math.ceil(quota.limit * 0.15)
                      ? 'text-[#91682E]'
                      : 'text-[#1e2d1f]/50'
                }`}
                title={`Тариф: ${quota.plan === 'pro' ? 'Pro' : 'Бесплатный'}. Лимит обновится в полночь по UTC.`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${
                  quota.remaining === 0 ? 'bg-[#9E4338]' : quota.remaining <= Math.ceil(quota.limit * 0.15) ? 'bg-[#91682E]' : 'bg-[#4A5D4E]'
                }`} />
                {quota.remaining === 0
                  ? 'Лимит на сегодня исчерпан'
                  : `Сегодня осталось ${quota.remaining} из ${quota.limit}`}
              </p>
            ) : (
              <p className="text-[11px] leading-tight mt-1 text-[#1e2d1f]/50">читает твою книгу</p>
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

      {/* Индикатор выделения объединён с контекст-чипом «Выделение» внизу (у поля ввода). */}

      {/* ── Quick actions grid ── */}
      <div className="px-3 pt-2 pb-2.5 border-b border-[#1e2d1f]/5 flex-shrink-0">
        <div className="grid grid-cols-2 gap-1.5">
          {QUICK_ACTIONS.map(action => {
            const Icon = action.icon;
            const willUseSelection = hasContext && action.selectionAware;
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
                  isBibleAction
                    ? (extractFreshness === 'fresh' ? 'Глава уже прочитана — открыть её в Мире'
                       : extractFreshness === 'stale' ? 'Глава изменилась — перечитать и обновить Мир'
                       : 'Извлечь персонажей, локации и правила мира')
                    : undefined
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
                <span className="truncate">{isBibleLoading ? 'Извлекаю...' : quickActionLabel(action, hasContext, extractFreshness)}</span>
                {willUseSelection && !isBibleAction && (
                  <span className="ml-auto text-[9px] text-purple-400 flex-shrink-0">↑</span>
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
          // В пустом стейте вместо пузыря-приветствия рисуется живой экран ниже.
          if (isEmptyState && idx === 0) return null;
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
                    : 'bg-white border border-[#1e2d1f]/10 text-[#1e2d1f] rounded-bl-sm ' +
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

              {/* P1: ссылки из ответа — кликабельно обратно в Мир/текст */}
              {msg.role === 'ai' && !isLastAiStreaming && msg.text && (() => {
                const refs = findReferences(msg.text, entities);
                if (!refs.entities.length && !refs.chapters.length) return null;
                return (
                  <div className="flex flex-wrap items-center gap-1 mt-1.5 ml-1 max-w-[90%]">
                    {refs.entities.map(e => (
                      <button
                        key={e.id}
                        onClick={() => onOpenEntity?.(e)}
                        title={`Открыть «${e.name}» в Мире`}
                        className="inline-flex items-center gap-1 text-[10.5px] font-medium rounded-md px-1.5 py-0.5 transition-colors"
                        style={{ color: TYPE_PIGMENT[e.type] ?? '#54627F', background: `${TYPE_PIGMENT[e.type] ?? '#54627F'}14` }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: TYPE_PIGMENT[e.type] ?? '#54627F' }} />
                        {e.name}
                      </button>
                    ))}
                    {refs.chapters.map(n => (
                      <button
                        key={`ch-${n}`}
                        onClick={() => onJumpToChapter?.(n)}
                        title={`Перейти к главе ${n}`}
                        className="inline-flex items-center gap-1 text-[10.5px] font-medium text-[#1e2d1f]/65 bg-[#1e2d1f]/6 hover:bg-[#1e2d1f]/10 rounded-md px-1.5 py-0.5 transition-colors"
                      >
                        → Глава {n}
                      </button>
                    ))}
                  </div>
                );
              })()}

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
                </div>
              )}
            </div>
          );
        })}

        {/* Живой пустой стейт: что Перо уже знает + одна контекстная подсказка.
            Список «С чего начать» убран — действия теперь единый набор сверху. */}
        {isEmptyState && !isAiLoading && (
          <div className="flex flex-col items-start gap-2 pt-1">
            <div className="flex items-center gap-2 text-[#71597F]">
              <BookOpen size={15} />
              <span className="text-[12px] font-semibold">Перо помнит всю твою книгу</span>
            </div>
            <p className="text-[12.5px] text-[#1e2d1f]/65 leading-relaxed">
              {(chapterCount || entityCount)
                ? <>Прочитано глав: <b className="text-[#1e2d1f]/80">{chapterCount ?? 0}</b>, в Мире сущностей: <b className="text-[#1e2d1f]/80">{entityCount ?? 0}</b>. Спроси о персонажах, событиях или нестыковках — отвечу по рукописи.</>
                : <>Спроси о персонажах, событиях, локациях или нестыковках — отвечу по тому, что написано в рукописи.</>}
            </p>
            <button
              onClick={() => onSendPrompt(hasContext
                ? `О чём этот фрагмент и что в нём важно для сюжета?\n\n${contextText}`
                : 'Сделай краткое резюме текущей главы: ключевые события, развитие персонажей, важные детали.')}
              className="mt-0.5 text-left text-[12px] text-[#1e2d1f]/70 bg-white/60 hover:bg-white border border-[#1e2d1f]/7 hover:border-[#1e2d1f]/15 rounded-xl px-3 py-2 transition-all leading-snug"
            >
              {hasContext ? 'О чём выделенный фрагмент?' : 'С чего начать — резюме этой главы'}
            </button>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* ── Input area ── */}
      <div className="p-4 bg-white/40 border-t border-[#1e2d1f]/5 flex-shrink-0">
        {/* Context pills */}
        <div className="flex items-center gap-1.5 mb-2.5">
          <span className="text-[9px] text-[#1e2d1f]/55 font-medium uppercase tracking-widest">Перо смотрит:</span>
          {/* Ширина контекста — сегмент-переключатель (как «Эта глава / Вся книга» в Мире).
              Глава учитывается всегда; тумблер добавляет ли весь Мир + поиск по рукописи. */}
          <div className="inline-flex rounded-md bg-[#1e2d1f]/[0.06] p-0.5">
            {([['chapter', 'Эта глава', FileText], ['book', 'Вся книга', BookOpen], ...(inSeries ? [['series', 'Вся серия', Library] as const] : [])] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => onScopeChange?.(id)}
                aria-pressed={scope === id}
                title={id === 'chapter' ? 'Перо отвечает только по текущей главе' : id === 'book' ? 'Перо учитывает весь Мир и всю рукопись' : 'Перо учитывает все книги серии'}
                className={`text-[10px] rounded px-2 py-0.5 transition-colors ${
                  scope === id ? 'bg-white text-[#1e2d1f] shadow-sm' : 'text-[#1e2d1f]/45 hover:text-[#1e2d1f]/70'
                }`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              ><Icon size={10} /> {label}</button>
            ))}
          </div>
          {chatMessages.length > 2 && (
            <span className="text-[9px] text-[#1e2d1f]/60 bg-[#1e2d1f]/5 rounded px-1.5 py-0.5" style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}><MessageCircle size={9} /> История</span>
          )}
          {/* Живой чип «Выделение»: закреплённый фрагмент-контекст (активен) либо предложение
              закрепить текущее выделение (доступно). Так чат явно показывает, что видит фрагмент. */}
          {pinnedSelection.trim() ? (
            <span className="text-[9px] text-[#5E4A6A] bg-[#EBE4EE] border border-[#DACDDF] rounded px-1.5 py-0.5 max-w-[160px]" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <MousePointer2 size={9} className="flex-shrink-0" />
              <span className="truncate">{pinnedSelection.trim()}</span>
              {onClearPinnedSelection && (
                <button onClick={onClearPinnedSelection} title="Убрать из контекста" className="flex-shrink-0 -mr-0.5 hover:text-[#3E3146]">
                  <X size={9} />
                </button>
              )}
            </span>
          ) : (hasSelection && onPinSelection) ? (
            <button
              onClick={onPinSelection}
              title="Прикрепить выделенный фрагмент как контекст вопроса"
              className="text-[9px] text-[#71597F]/80 bg-transparent border border-dashed border-[#71597F]/40 rounded px-1.5 py-0.5 max-w-[170px] hover:bg-[#EBE4EE]/60 hover:text-[#5E4A6A] transition-colors"
              style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
            >
              <Plus size={9} className="flex-shrink-0" />
              <span className="truncate">{trimmedSelection}</span>
            </button>
          ) : null}
        </div>

        <div className="relative flex items-end">
          {/* P2: автокомплит @-упоминаний — фокусирует Перо на конкретной сущности */}
          {mentionQuery !== null && mentionMatches.length > 0 && (
            <div className="absolute bottom-full left-0 mb-1.5 w-[260px] max-h-[220px] overflow-y-auto bg-white border border-[#1e2d1f]/12 rounded-xl shadow-2xl py-1 z-20">
              <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-[#1e2d1f]/40">Упомянуть из Мира</div>
              {mentionMatches.map(e => (
                <button
                  key={e.id}
                  onMouseDown={(ev) => { ev.preventDefault(); selectMention(e); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[#1e2d1f]/5 transition-colors"
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: TYPE_PIGMENT[e.type] ?? '#54627F' }} />
                  <span className="text-[13px] text-[#1e2d1f] truncate">{e.name}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            rows={1}
            value={chatInput}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Спросите Перо о книге… «@» — упомянуть"
            disabled={isAiLoading}
            className="w-full bg-white border border-[#1e2d1f]/10 rounded-2xl pl-4 pr-10 py-2.5 text-sm outline-none focus:border-[#1e2d1f]/30 transition-colors disabled:opacity-50 resize-none overflow-hidden leading-relaxed"
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
