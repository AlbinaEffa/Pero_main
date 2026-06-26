/**
 * ShareBibleButton — автор включает/отзывает публичную read-only ссылку на библию (Этап D).
 * Самодостаточный: сам грузит статус и дёргает /share/:id/(enable|disable). Ссылку строит из
 * origin фронта + токена. Делится КАТАЛОГОМ Мира + замыслом, без рукописи и без входа.
 */
import { useState, useEffect, useRef } from 'react';
import { Share2, Check, Copy, Globe } from 'lucide-react';
import { api } from '../../services/api';

export function ShareBibleButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<{ enabled: boolean; token: string | null }>(`/share/${projectId}/status`)
      .then(r => setToken(r.token)).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const url = token ? `${window.location.origin}/share/${token}` : '';

  const enable = async () => {
    setBusy(true);
    try { const r = await api.post<{ token: string }>(`/share/${projectId}/enable`, {}); setToken(r.token); }
    finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true);
    try { await api.post(`/share/${projectId}/disable`, {}); setToken(null); }
    finally { setBusy(false); }
  };
  const copy = () => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Поделиться библией"
        className={`p-1.5 rounded-md transition-colors ${token ? 'text-[#A14F44] bg-[#A14F44]/10' : 'text-[#1e2d1f]/45 hover:bg-[#1e2d1f]/5'}`}
      >
        <Share2 size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-72 bg-white rounded-xl shadow-xl border border-[#1e2d1f]/10 p-3.5 z-50">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#1e2d1f] mb-1">
            <Globe size={13} className="text-[#A14F44]" /> Поделиться библией
          </div>
          <p className="text-[11px] leading-relaxed text-[#1e2d1f]/55 mb-2.5">
            Любой со ссылкой увидит каталог Мира и замысел книги — без рукописи и без входа.
          </p>
          {token ? (
            <>
              <div className="flex gap-1.5">
                <input
                  readOnly value={url}
                  onFocus={e => e.target.select()}
                  className="flex-1 min-w-0 bg-[#f5f0e8] rounded-lg px-2 py-1.5 text-[11px] text-[#1e2d1f]/70 outline-none"
                />
                <button
                  onClick={copy}
                  className="flex-shrink-0 px-2 rounded-lg bg-[#1e2d1f] text-[#f5f0e8] hover:bg-[#2a3f2b] transition-colors"
                  title="Скопировать"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <button
                onClick={disable} disabled={busy}
                className="mt-2.5 text-[11px] font-medium text-[#A14F44]/80 hover:text-[#A14F44] disabled:opacity-50"
              >
                Отозвать ссылку
              </button>
            </>
          ) : (
            <button
              onClick={enable} disabled={busy}
              className="w-full py-1.5 rounded-lg bg-[#1e2d1f] text-[#f5f0e8] text-[12px] font-medium hover:bg-[#2a3f2b] transition-colors disabled:opacity-50"
            >
              {busy ? 'Создаю…' : 'Создать ссылку'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
