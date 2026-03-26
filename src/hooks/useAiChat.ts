import { useState, useRef, useEffect } from 'react';
import { api } from '../services/api';
import { track } from '../services/analytics';
import { ChatMessage } from '../components/editor/types';

interface UseAiChatArgs {
  projectId: string | undefined;
  chapterId: string | undefined;
  getContent: () => string;
}

interface ConsistencyIssue {
  entity: string;
  issue: string;
  severity: 'low' | 'medium' | 'high';
}

const GREETING: ChatMessage = {
  role: 'ai',
  text: 'Привет! Я твой ИИ-соавтор. Чем могу помочь с этой главой?',
};

export function useAiChat({ projectId, chapterId, getContent }: UseAiChatArgs) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([GREETING]);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isCheckingConsistency, setIsCheckingConsistency] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Load persisted history whenever project or chapter changes ──────────────
  useEffect(() => {
    if (!projectId) {
      setChatMessages([GREETING]);
      setIsHistoryLoaded(true);
      return;
    }

    setIsHistoryLoaded(false);

    const params = new URLSearchParams({ projectId });
    if (chapterId) params.set('chapterId', chapterId);

    api
      .get<{ messages: { id: string; role: string; text: string; timestamp: string }[] }>(
        `/ai/history?${params}`
      )
      .then(data => {
        const loaded = (data.messages ?? []).map(m => ({
          role: (m.role === 'user' ? 'user' : 'ai') as 'user' | 'ai',
          text: m.text,
        }));
        setChatMessages(loaded.length > 0 ? loaded : [GREETING]);
      })
      .catch(() => {
        // DB table not yet created or network error — fall back to greeting
        setChatMessages([GREETING]);
      })
      .finally(() => setIsHistoryLoaded(true));
  }, [projectId, chapterId]);

  // ── Core: send any message (prompt) to the AI ───────────────────────────────
  const sendMessage = async (text: string, eventName = 'chat_message_sent') => {
    if (!text.trim() || isAiLoading || isCheckingConsistency) return;
    setChatMessages(prev => [...prev, { role: 'user', text }]);
    setIsAiLoading(true);
    try {
      const data = await api.post<{ text: string }>('/ai/chat', {
        message: text,
        chapterContent: getContent(),
        projectId,
        chapterId,
      });
      track(eventName, { projectId, chapterId, messageLength: text.length });
      setChatMessages(prev => [...prev, { role: 'ai', text: data.text }]);
    } catch {
      setChatMessages(prev => [
        ...prev,
        { role: 'ai', text: 'Не удалось подключиться к серверу ИИ.' },
      ]);
    } finally {
      setIsAiLoading(false);
    }
  };

  // ── Send a chat message (from the input field) ──────────────────────────────
  const handleSendMessage = async () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput('');
    await sendMessage(text, 'chat_message_sent');
  };

  // ── Send a pre-built prompt (from quick actions) ─────────────────────────────
  const handleSendPrompt = async (prompt: string) => {
    await sendMessage(prompt, 'quick_action_sent');
  };

  // ── Consistency check ───────────────────────────────────────────────────────
  const handleCheckConsistency = async () => {
    if (!projectId || isAiLoading || isCheckingConsistency) return;

    setIsCheckingConsistency(true);
    // Optimistic status message
    setChatMessages(prev => [
      ...prev,
      { role: 'ai', text: '🔍 Проверяю главу на противоречия с Библией истории...' },
    ]);

    try {
      const data = await api.post<{
        issues: ConsistencyIssue[];
        note?: string;
      }>('/ai/consistency', {
        projectId,
        chapterContent: getContent(),
      });

      let resultText: string;

      if (data.note) {
        resultText = data.note;
      } else if (!data.issues || data.issues.length === 0) {
        resultText = '✅ Противоречий не найдено. Глава консистентна с Библией истории.';
      } else {
        const lines = data.issues.map(issue => {
          const icon =
            issue.severity === 'high'   ? '🔴' :
            issue.severity === 'medium' ? '🟡' : '🟢';
          return `${icon} **${issue.entity}**: ${issue.issue}`;
        });
        resultText = `Обнаружены потенциальные противоречия:\n\n${lines.join('\n')}`;
      }

      track('consistency_checked', { projectId, issueCount: data.issues?.length ?? 0 });
      // Replace the "checking..." status with the real result
      setChatMessages(prev => [...prev.slice(0, -1), { role: 'ai', text: resultText }]);
    } catch {
      setChatMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'ai', text: 'Не удалось выполнить проверку. Попробуйте позже.' },
      ]);
    } finally {
      setIsCheckingConsistency(false);
    }
  };

  return {
    chatMessages,
    isHistoryLoaded,
    chatInput,
    setChatInput,
    /** True when either a chat message or consistency check is in-flight */
    isAiLoading: isAiLoading || isCheckingConsistency,
    isCheckingConsistency,
    chatEndRef,
    handleSendMessage,
    handleSendPrompt,
    handleCheckConsistency,
  };
}
