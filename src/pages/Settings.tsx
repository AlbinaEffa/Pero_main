import { useState, useEffect, useRef, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Save, Download, Loader2, Crown, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getApiBaseUrl, api } from '../services/api';

const API = getApiBaseUrl();

type EditorFontName = 'cormorant' | 'literata' | 'source-serif';
type TextWidth = 'narrow' | 'medium' | 'wide';

interface BillingStatus { plan: 'free' | 'pro'; planExpiresAt: string | null; priceRub: number; periodDays: number; }
interface QuotaStatus { plan: 'free' | 'pro'; used: number; limit: number; remaining: number; resetsAt: string; }

const FONT_OPTIONS: { id: EditorFontName; label: string; family: string }[] = [
  { id: 'literata',     label: 'Литерата',    family: "'Literata', Georgia, serif" },
  { id: 'cormorant',    label: 'Cormorant',   family: "'Cormorant Garamond', Georgia, serif" },
  { id: 'source-serif', label: 'Source Serif',family: "'Source Serif 4', Georgia, serif" },
];
const WIDTH_OPTIONS: { id: TextWidth; label: string }[] = [
  { id: 'narrow', label: 'Узкая' },
  { id: 'medium', label: 'Средняя' },
  { id: 'wide',   label: 'Широкая' },
];

// ── Кирпичики дизайн-системы (пергамент + чернила, без гласса/теней/кружков) ──
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-[11px] font-bold uppercase tracking-widest text-[#1e2d1f]/45 mb-3 ml-1">{title}</h2>
      <div className="bg-white rounded-2xl border border-[#1e2d1f]/8 divide-y divide-[#1e2d1f]/[0.06]">{children}</div>
    </section>
  );
}
function Row({ title, desc, control }: { title: string; desc?: string; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-[#1e2d1f]">{title}</div>
        {desc && <div className="text-[12.5px] text-[#1e2d1f]/60 mt-0.5 leading-snug">{desc}</div>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)}
      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${on ? 'bg-[#1E2D1F]' : 'bg-[#E8E2D5]'}`}>
      <span className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}
function Segmented<T extends string>({ value, options, onChange, optionStyle }: {
  value: T; options: { id: T; label: string; family?: string }[]; onChange: (v: T) => void; optionStyle?: boolean;
}) {
  return (
    <div className="inline-flex rounded-lg bg-[#1e2d1f]/[0.05] p-0.5">
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)}
          style={optionStyle && o.family ? { fontFamily: o.family } : undefined}
          className={`px-3 py-1.5 rounded-md text-[13px] transition-colors ${
            value === o.id ? 'bg-white text-[#1e2d1f] font-semibold shadow-[0_1px_2px_rgba(30,45,31,0.08)]' : 'text-[#1e2d1f]/55 hover:text-[#1e2d1f]'
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function Settings({
  onClose,
  showWordCount: externalShowWordCount,
  setShowWordCount: externalSetShowWordCount,
  indentParagraphs: externalIndentParagraphs,
  setIndentParagraphs: externalSetIndentParagraphs,
  editorFont: externalEditorFont,
  setEditorFont: externalSetEditorFont,
}: {
  onClose?: () => void;
  showWordCount?: boolean;
  setShowWordCount?: (val: boolean) => void;
  indentParagraphs?: boolean;
  setIndentParagraphs?: (val: boolean) => void;
  editorFont?: EditorFontName;
  setEditorFont?: (val: EditorFontName) => void;
}) {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.displayName || '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedOk, setSavedOk] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);

  // Редактор-настройки: проп (живьём в модалке) ИЛИ localStorage (отдельная страница).
  const [localShowWordCount, setLocalShowWordCount] = useState(() => localStorage.getItem('pero_showWordCount') !== 'false');
  const [localIndent, setLocalIndent] = useState(() => localStorage.getItem('pero_indentParagraphs') === 'true');
  const [localFont, setLocalFont] = useState<EditorFontName>(() => (localStorage.getItem('pero_editorFont') as EditorFontName) || 'literata');
  const [textWidth, setTextWidthState] = useState<TextWidth>(() => (localStorage.getItem('pero_textWidth') as TextWidth) || 'medium');

  const showWordCount = externalShowWordCount ?? localShowWordCount;
  const setShowWordCount = (v: boolean) => { localStorage.setItem('pero_showWordCount', String(v)); externalSetShowWordCount ? externalSetShowWordCount(v) : setLocalShowWordCount(v); };
  const indentParagraphs = externalIndentParagraphs ?? localIndent;
  const setIndentParagraphs = (v: boolean) => { localStorage.setItem('pero_indentParagraphs', String(v)); externalSetIndentParagraphs ? externalSetIndentParagraphs(v) : setLocalIndent(v); };
  const editorFont = externalEditorFont ?? localFont;
  const setEditorFont = (f: EditorFontName) => { localStorage.setItem('pero_editorFont', f); externalSetEditorFont ? externalSetEditorFont(f) : setLocalFont(f); };
  const setTextWidth = (w: TextWidth) => { localStorage.setItem('pero_textWidth', w); setTextWidthState(w); window.dispatchEvent(new Event('pero:textwidth')); };

  // ── Тариф + квота ──
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [billingError, setBillingError] = useState('');
  const pollCount = useRef(0);

  useEffect(() => { api.get<QuotaStatus>('/ai/quota').then(setQuota).catch(() => {}); }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fetchStatus = () => {
      api.get<BillingStatus>('/billing/status').then(status => {
        setBilling(status);
        const cameFromPayment = new URLSearchParams(window.location.search).get('payment') === 'pending';
        if (cameFromPayment && status.plan !== 'pro' && pollCount.current < 10) {
          pollCount.current += 1;
          timer = setTimeout(fetchStatus, 3000);
        }
      }).catch(() => {});
    };
    fetchStatus();
    return () => { if (timer) clearTimeout(timer); };
  }, []);

  const handleCheckout = async () => {
    setIsCheckingOut(true); setBillingError('');
    try {
      const { confirmationUrl } = await api.post<{ confirmationUrl: string }>('/billing/checkout', {});
      window.location.href = confirmationUrl;
    } catch (err: any) {
      setBillingError(err?.message || 'Не удалось создать платёж. Попробуйте ещё раз.');
      setIsCheckingOut(false);
    }
  };

  const handleSave = async () => {
    const token = localStorage.getItem('pero_token');
    if (!token) return;
    setIsSaving(true); setSaveError(''); setSavedOk(false);
    try {
      const res = await fetch(`${API}/auth/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ displayName: name }),
      });
      if (!res.ok) throw new Error('Ошибка сохранения');
      const data = await res.json();
      updateUser({ displayName: data.user.displayName });
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
    } catch {
      setSaveError('Не удалось сохранить. Попробуйте ещё раз.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloadAll = async () => {
    const token = localStorage.getItem('pero_token');
    if (!token) return;
    setIsDownloadingAll(true);
    try {
      const res = await fetch(`${API}/export/all`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Ошибка загрузки');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pero-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { /* тихо */ } finally { setIsDownloadingAll(false); }
  };

  const initial = (user?.displayName || user?.email || '?').trim().charAt(0).toUpperCase();
  const nameChanged = name.trim() !== (user?.displayName || '');

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f5f0e8] p-8 md:p-12 overflow-y-auto w-full text-left">
      <div className="max-w-2xl mx-auto w-full">
        <button
          onClick={() => onClose ? onClose() : navigate('/dashboard')}
          className="flex items-center gap-1.5 text-[13px] font-medium text-[#1e2d1f]/55 hover:text-[#1E2D1F] transition-colors mb-7"
        >
          <ChevronLeft size={16} /> {onClose ? 'Назад к редактору' : 'Назад к проектам'}
        </button>

        <h1 className="font-serif text-[32px] leading-tight text-[#1e2d1f] mb-1">Настройки</h1>
        <p className="text-[14px] text-[#1e2d1f]/60 mb-10">Профиль, редактор и ваш тариф.</p>

        {/* Профиль */}
        <Section title="Профиль">
          <div className="flex items-center gap-4 px-5 py-5">
            <div className="w-14 h-14 rounded-full bg-[#1e2d1f]/[0.06] border border-[#1e2d1f]/8 flex items-center justify-center font-serif text-[22px] text-[#1e2d1f]/70 shrink-0">
              {initial}
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-[#1e2d1f] truncate">{user?.displayName || 'Без имени'}</div>
              <div className="text-[12.5px] text-[#1e2d1f]/55 truncate">{user?.email}</div>
            </div>
          </div>
          <div className="px-5 py-4">
            <label className="block text-[12.5px] font-medium text-[#1e2d1f]/70 mb-1.5">Имя автора</label>
            <div className="flex items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Как вас представить читателю"
                className="flex-1 min-w-0 bg-[#1e2d1f]/[0.03] border border-[#1e2d1f]/10 rounded-xl px-3.5 py-2.5 text-[14px] text-[#1e2d1f] outline-none focus:border-[#1e2d1f]/25 transition-colors"
              />
              <button
                onClick={handleSave}
                disabled={isSaving || !nameChanged}
                className="flex items-center gap-1.5 bg-[#1E2D1F] hover:bg-[#16221A] disabled:opacity-40 text-white px-4 py-2.5 rounded-xl font-medium text-[14px] transition-colors shrink-0"
              >
                {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {savedOk ? 'Готово' : 'Сохранить'}
              </button>
            </div>
            {saveError && <p className="text-[12.5px] text-[#9E4338] mt-2">{saveError}</p>}
          </div>
        </Section>

        {/* Редактор */}
        <Section title="Редактор">
          <Row title="Шрифт рукописи" desc="Шрифт полотна текста — на ваш вкус."
            control={<Segmented value={editorFont} options={FONT_OPTIONS} onChange={setEditorFont} optionStyle />} />
          <Row title="Ширина колонки" desc="Насколько широка строка текста."
            control={<Segmented value={textWidth} options={WIDTH_OPTIONS} onChange={setTextWidth} />} />
          <Row title="Красная строка" desc="Отступ в начале новых абзацев."
            control={<Toggle on={indentParagraphs} onChange={setIndentParagraphs} />} />
          <Row title="Счётчик слов" desc="Показывать число слов в редакторе."
            control={<Toggle on={showWordCount} onChange={setShowWordCount} />} />
        </Section>

        {/* Перо (ИИ) */}
        <Section title="Перо">
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[14px] font-medium text-[#1e2d1f]">Дневная норма Пера</span>
              <span className="text-[13px] font-semibold text-[#1e2d1f]/75">
                {quota ? `${quota.used} из ${quota.limit}` : '…'}
              </span>
            </div>
            {quota && (
              <>
                <div className="h-1.5 rounded-full bg-[#1e2d1f]/[0.08] overflow-hidden">
                  <div className="h-full rounded-full bg-[#4A5D4E]" style={{ width: `${Math.min(100, (quota.used / Math.max(1, quota.limit)) * 100)}%` }} />
                </div>
                <p className="text-[12.5px] text-[#1e2d1f]/60 mt-2 leading-snug">
                  Осталось {quota.remaining} действий Пера на сегодня (чтение глав, чат, проверка нестыковок). Обнулится завтра.
                </p>
              </>
            )}
          </div>
        </Section>

        {/* Тариф */}
        <Section title="Тариф">
          <div className="px-5 py-5">
            <div className="flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-full bg-[#EBE4EE] flex items-center justify-center text-[#71597F] shrink-0">
                <Crown size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-[#1e2d1f] mb-0.5">{billing?.plan === 'pro' ? 'Pro' : 'Бесплатный'}</div>
                <p className="text-[12.5px] text-[#1e2d1f]/60 leading-snug">
                  {billing?.plan === 'pro'
                    ? <>Активен{billing?.planExpiresAt ? ` до ${new Date(billing.planExpiresAt).toLocaleDateString('ru-RU')}` : ''}. Безлимит проектов, 300 действий Пера в день, экспорт в Word, диктовка.</>
                    : <>1 активный проект, 20 действий Пера в день. Pro снимает лимиты: безлимит проектов, 300 действий в день, экспорт в Word, диктовка.</>}
                </p>
              </div>
            </div>
            {billing?.plan !== 'pro' && (
              <button
                onClick={handleCheckout}
                disabled={isCheckingOut || !billing}
                className="mt-4 flex items-center gap-2 px-4 py-2.5 bg-[#1E2D1F] hover:bg-[#16221A] disabled:opacity-40 text-white rounded-xl font-medium text-[14px] transition-colors"
              >
                {isCheckingOut ? <Loader2 size={15} className="animate-spin" /> : <Crown size={15} />}
                {isCheckingOut ? 'Создаём платёж…' : `Оформить Pro — ${billing?.priceRub ?? 599} ₽/мес`}
              </button>
            )}
            {billingError && <p className="text-[12.5px] text-[#9E4338] mt-2">{billingError}</p>}
          </div>
        </Section>

        {/* Данные */}
        <Section title="Данные">
          <div className="px-5 py-4">
            <p className="text-[12.5px] text-[#1e2d1f]/60 leading-relaxed mb-3">
              Все тексты хранятся в защищённой базе. В любой момент можно скачать полную копию — со всеми проектами и главами.
            </p>
            <button
              onClick={handleDownloadAll}
              disabled={isDownloadingAll}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#E8E2D5] hover:bg-[#ded7c7] disabled:opacity-50 rounded-xl font-medium text-[#1e2d1f] text-[14px] transition-colors"
            >
              {isDownloadingAll ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              Скачать все проекты (.zip)
            </button>
          </div>
        </Section>

        {/* Аккаунт */}
        <Section title="Аккаунт">
          <button onClick={() => logout()} className="flex items-center gap-2.5 px-5 py-4 w-full text-left text-[14px] font-medium text-[#1e2d1f]/70 hover:text-[#1e2d1f] transition-colors">
            <LogOut size={16} /> Выйти из аккаунта
          </button>
        </Section>
      </div>
    </div>
  );
}
