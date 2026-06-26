import { useState, useRef, useEffect } from 'react';
import { api, getApiBaseUrl, ApiError } from '../services/api';
import { track } from '../services/analytics';
import { ChatMessage } from '../components/editor/types';

interface UseAiChatArgs {
  projectId: string | undefined;
  chapterId: string | undefined;
  getContent: () => string;
  /** Прикреплённый фрагмент-контекст (бар → «Спросить Перо» / чип «Выделение»). */
  getSelection?: () => string;
  /** Ширина контекста чата: глава / вся книга / вся серия (глава + Мир + RAG соответствующего уровня). */
  getScope?: () => 'chapter' | 'book' | 'series';
}

interface ConsistencyIssue {
  entity: string;
  issue: string;
  severity: 'low' | 'medium' | 'high';
}

// Текст служит маркером «пустого стейта» в CoauthorPanel (там же рисуется живой пустой
// экран). Если меняешь строку — синхронизируй GREETING_TEXT в CoauthorPanel.
const GREETING: ChatMessage = {
  role: 'ai',
  text: 'Я Перо — помню всю твою книгу. Спроси о персонажах, событиях, локациях или нестыковках.',
};

export function useAiChat({ projectId, chapterId, getContent, getSelection, getScope }: UseAiChatArgs) {
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
        setChatMessages([GREETING]);
      })
      .finally(() => setIsHistoryLoaded(true));
  }, [projectId, chapterId]);

  // ── Core: stream a message to the AI ────────────────────────────────────────
  const sendMessage = async (text: string, eventName = 'chat_message_sent', selection?: string) => {
    if (!text.trim() || isAiLoading || isCheckingConsistency) return;

    // Optimistically add user bubble + empty AI bubble
    setChatMessages(prev => [
      ...prev,
      { role: 'user', text },
      { role: 'ai',   text: '' },
    ]);
    setIsAiLoading(true);

    try {
      const token   = localStorage.getItem('pero_token');
      const baseUrl = getApiBaseUrl();

      const response = await fetch(`${baseUrl}/ai/chat/stream`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message:        text,
          chapterContent: getContent(),        // глава всегда в контексте
          scope:          getScope?.() ?? 'book', // 'chapter' — только глава; 'book' — + весь Мир
          projectId,
          chapterId,
          ...(selection?.trim() ? { selection: selection.trim() } : {}),
        }),
      });

      if (!response.ok || !response.body) {
        // Сервер мог вернуть осмысленное сообщение (например, исчерпана квота AI)
        let serverMsg = '';
        try {
          const data = await response.json();
          serverMsg = typeof data?.error === 'string' ? data.error : '';
        } catch { /* тело не JSON — игнорируем */ }
        throw new Error(serverMsg || `HTTP ${response.status}`);
      }

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process all complete SSE lines
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // keep incomplete last chunk

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') break;

          try {
            const parsed = JSON.parse(raw) as { text?: string; error?: string };
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.text) {
              // Append delta to the last (AI) message
              setChatMessages(prev => {
                const last = prev[prev.length - 1];
                if (!last || last.role !== 'ai') return prev;
                return [...prev.slice(0, -1), { ...last, text: last.text + parsed.text! }];
              });
            }
          } catch {
            // skip malformed chunks
          }
        }
      }

      track(eventName, { projectId, chapterId, messageLength: text.length });
    } catch (err) {
      // Replace the empty AI bubble with an error message
      const hasServerMessage =
        err instanceof Error && err.message && !/^HTTP \d+$/.test(err.message);
      const errMsg = hasServerMessage
        ? (err as Error).message
        : 'Не удалось подключиться к серверу ИИ.';
      setChatMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'ai' && last.text === '') {
          return [...prev.slice(0, -1), { role: 'ai', text: errMsg }];
        }
        return [...prev, { role: 'ai', text: errMsg }];
      });
    } finally {
      setIsAiLoading(false);
    }
  };

  // ── Send a chat message (from the input field) ──────────────────────────────
  const handleSendMessage = async () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput('');
    await sendMessage(text, 'chat_message_sent', getSelection?.());
  };

  // ── Send a pre-built prompt (from quick actions) ─────────────────────────────
  const handleSendPrompt = async (prompt: string) => {
    await sendMessage(prompt, 'quick_action_sent');
  };

  // ── Consistency check ───────────────────────────────────────────────────────
  const handleCheckConsistency = async () => {
    if (!projectId || isAiLoading || isCheckingConsistency) return;

    setIsCheckingConsistency(true);
    setChatMessages(prev => [
      ...prev,
      { role: 'ai', text: 'Проверяю главу на противоречия с Миром…' },
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
        resultText = 'Противоречий не найдено. Глава консистентна с Миром.';
      } else {
        const lines = data.issues.map(issue => {
          const icon =
            issue.severity === 'high'   ? 'Высокая:' :
            issue.severity === 'medium' ? 'Средняя:' : 'Низкая:';
          return `${icon} **${issue.entity}**: ${issue.issue}`;
        });
        resultText = `Обнаружены потенциальные противоречия:\n\n${lines.join('\n')}`;
      }

      track('consistency_checked', { projectId, issueCount: data.issues?.length ?? 0 });
      setChatMessages(prev => [...prev.slice(0, -1), { role: 'ai', text: resultText }]);
    } catch (err) {
      const errMsg = err instanceof ApiError && err.status === 429
        ? err.message
        : 'Не удалось выполнить проверку. Попробуйте позже.';
      setChatMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'ai', text: errMsg },
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
    isAiLoading: isAiLoading || isCheckingConsistency,
    isCheckingConsistency,
    chatEndRef,
    handleSendMessage,
    handleSendPrompt,
    handleCheckConsistency,
  };
}
