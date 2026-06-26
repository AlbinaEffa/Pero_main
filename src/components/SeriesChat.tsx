/**
 * SeriesChat — чат-брейншторм замысла серии на холсте (P2). Перо = партнёр по обсуждению
 * (идеи/структура мира/героев), прозу не пишет. Беседа сохраняется по серии (chat_history.series_id)
 * и потом подмешивается в контекст «Вся серия» при письме. Стримит через /ai/chat/stream {message, seriesId}.
 */
import { useState, useEffect, useRef } from 'react';
import { Send, Sparkles, Loader2 } from 'lucide-react';
import { api, getApiBaseUrl } from '../services/api';

interface Msg { role: 'user' | 'model'; text: string }

export function SeriesChat({ seriesId }: { seriesId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<{ messages: { role: string; text: string }[] }>(`/ai/history?seriesId=${seriesId}`)
      .then(d => setMessages((d.messages ?? []).map(m => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text }))))
      .catch(() => {});
  }, [seriesId]);
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages]);

  const send = async () => {
    const q = input.trim();
    if (!q || streaming) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', text: q }, { role: 'model', text: '' }]);
    setStreaming(true);
    try {
      const token = localStorage.getItem('pero_token');
      const res = await fetch(`${getApiBaseUrl()}/ai/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ message: q, seriesId }),
      });
      if (!res.body) throw new Error('no body');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const line of parts) {
          const m = line.match(/^data: ([\s\S]*)$/);
          if (!m) continue;
          if (m[1] === '[DONE]') continue;
          try { const j = JSON.parse(m[1]); if (j.text) setMessages(ms => { const c = [...ms]; c[c.length - 1] = { role: 'model', text: c[c.length - 1].text + j.text }; return c; }); } catch { /* skip */ }
        }
      }
    } catch {
      setMessages(ms => { const c = [...ms]; c[c.length - 1] = { role: 'model', text: 'Ошибка — попробуй ещё раз.' }; return c; });
    } finally { setStreaming(false); }
  };

  return (
    <div className="bg-[#FBF8F2] rounded-2xl border border-[#A14F44]/15 flex flex-col" style={{ maxHeight: 420 }}>
      <div className="px-4 py-3 border-b border-[#1e2d1f]/5">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#1e2d1f]"><Sparkles size={14} className="text-[#A14F44]" /> Обсудить замысел с Пером</div>
        <div className="text-[10.5px] text-[#1e2d1f]/45 mt-0.5">брейншторм · беседа сохранится для контекста</div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5 min-h-[120px]">
        {messages.length === 0 && (
          <p className="text-[12px] text-[#1e2d1f]/40 text-center py-6">Спроси Перо: «помоги придумать мир для вампирской саги», «как разбить на книги?»</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'self-end max-w-[85%]' : 'self-start max-w-[90%]'}>
            <div className={`rounded-xl px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'bg-[#A14F44]/10 text-[#1e2d1f]' : 'bg-white text-[#1e2d1f]/85 border border-[#1e2d1f]/5'}`}>
              {m.text || (streaming && i === messages.length - 1 ? <Loader2 size={13} className="animate-spin text-[#1e2d1f]/40" /> : '')}
            </div>
          </div>
        ))}
      </div>
      <div className="px-3 py-2.5 border-t border-[#1e2d1f]/5 flex items-center gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Спроси Перо о замысле…"
          className="flex-1 min-w-0 bg-white rounded-lg px-3 py-2 text-[12.5px] outline-none border border-[#1e2d1f]/10 focus:border-[#A14F44]/40"
        />
        <button onClick={send} disabled={!input.trim() || streaming} className="flex-shrink-0 p-2 rounded-lg bg-[#1e2d1f] text-[#f5f0e8] hover:bg-[#2a3f2b] disabled:opacity-40">
          {streaming ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </div>
      <p className="px-4 pb-2.5 text-[10px] text-[#1e2d1f]/40">Перо подсказывает идеи и структуру — прозу за тебя не пишет.</p>
    </div>
  );
}
