import { useState, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Upload, Users, MapPin, Box, Globe, ArrowRight, AlertCircle, RotateCcw,
} from 'lucide-react';
import { PeroMark, PeroLogo } from '../components/Logo';
import { getApiBaseUrl } from '../services/api';
import { setPendingManuscript } from '../services/demoCarry';
import { track } from '../services/analytics';

/**
 * Демо «попробуй на своей рукописи» — БЕЗ регистрации.
 * Аноним загружает рукопись → Перо реально извлекает библию по первой главе
 * (POST /demo/extract-first, один AI-вызов) → показываем «вкус» → мягкая стена.
 * Рукопись держим в памяти (demoCarry) — после входа достраиваем библию всей книги.
 */

const API = getApiBaseUrl();
const ACCEPTED_EXTS = ['.txt', '.docx', '.pdf', '.epub', '.fb2'];

const TYPE_META: Record<string, { icon: typeof Users; label: string; plural: string; cls: string }> = {
  character: { icon: Users,  label: 'персонаж', plural: 'Персонажи', cls: 'bg-rose-100 text-rose-600' },
  location:  { icon: MapPin, label: 'локация',  plural: 'Локации',   cls: 'bg-emerald-100 text-emerald-700' },
  item:      { icon: Box,    label: 'предмет',  plural: 'Предметы',  cls: 'bg-amber-100 text-amber-600' },
  rule:      { icon: Globe,  label: 'правило',  plural: 'Правила',   cls: 'bg-blue-100 text-blue-600' },
};

interface DemoEntity {
  type: string;
  name: string;
  description: string;
  significance: string | null;
}
interface DemoResult {
  title: string;
  totalChapters: number;
  totalWords: number;
  firstChapter: { title: string; wordCount: number };
  entities: DemoEntity[];
  relationsCount: number;
  suggestedGenres?: string[];
}

type Stage = 'idle' | 'reading' | 'done' | 'error';

export default function Demo() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('idle');
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<DemoResult | null>(null);
  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
    if (!ACCEPTED_EXTS.includes(ext)) {
      setError(`Формат ${ext} не поддерживается. Допустимы: ${ACCEPTED_EXTS.join(', ')}`);
      setStage('error');
      return;
    }
    fileRef.current = file;
    setFileName(file.name);
    setError('');
    setStage('reading');
    track('demo_upload_started', { ext });

    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${API}/demo/extract-first`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Не удалось разобрать рукопись.');
        setStage('error');
        return;
      }
      setResult(data as DemoResult);
      setStage('done');
      track('demo_extract_done', { entities: (data.entities ?? []).length, chapters: data.totalChapters });
    } catch {
      setError('Не удалось подключиться к серверу. Попробуйте позже.');
      setStage('error');
    }
  }, []);

  const onPick = () => inputRef.current?.click();
  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = '';
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const goRegister = () => {
    setPendingManuscript(fileRef.current, result?.suggestedGenres ?? []);
    track('demo_register_clicked');
    navigate('/login');
  };

  const reset = () => {
    setStage('idle');
    setResult(null);
    setError('');
    setFileName('');
    fileRef.current = null;
  };

  return (
    <div className="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)] flex flex-col font-sans">
      {/* Header */}
      <header className="flex items-center justify-between px-6 lg:px-12 py-5">
        <Link to="/" className="text-ink hover:opacity-80 transition-opacity"><PeroLogo size={22} /></Link>
        <Link to="/login" className="text-sm font-medium text-ink/70 hover:text-ink transition-colors">Войти</Link>
      </header>

      <main className="flex-1 flex flex-col items-center px-6">
        {stage === 'idle' && (
          <div className="w-full max-w-xl text-center pt-12 md:pt-20">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#E7EAE3] text-[var(--color-accent)] mb-6">
              Бесплатно · без регистрации
            </span>
            <h1 className="font-serif text-4xl md:text-5xl font-semibold leading-[1.1] mb-4">
              Посмотрите, как Перо читает вашу книгу
            </h1>
            <p className="text-ink/65 leading-relaxed mb-9 max-w-md mx-auto">
              Загрузите рукопись — Перо прочитает первую главу и на ваших глазах построит
              кусочек Мира: персонажей, локации, предметы. Прямо сейчас, без аккаунта.
            </p>

            <div
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={onPick}
              className={`rounded-3xl border-2 border-dashed cursor-pointer transition-all px-6 py-14 ${
                isDragging
                  ? 'border-[var(--color-accent)] bg-[#E7EAE3]/50'
                  : 'border-ink/15 bg-white hover:border-ink/30'
              }`}
            >
              <input ref={inputRef} type="file" accept={ACCEPTED_EXTS.join(',')} className="hidden" onChange={onInput} />
              <Upload size={36} className={`mx-auto mb-4 ${isDragging ? 'text-[var(--color-accent)]' : 'text-ink/30'}`} />
              <p className="text-[15px] font-semibold text-ink/70 mb-1">Перетащите рукопись сюда</p>
              <p className="text-[13px] text-ink/55">или нажмите, чтобы выбрать файл</p>
            </div>
            <p className="text-[12px] text-ink/55 mt-4">
              TXT · DOCX · PDF · EPUB · FB2 · до 20 МБ · Тексты не используются для обучения моделей
            </p>
          </div>
        )}

        {stage === 'reading' && (
          <div className="flex flex-col items-center text-center pt-24">
            <div className="w-16 h-16 rounded-full bg-white shadow-sm flex items-center justify-center mb-6">
              <PeroMark size={30} className="text-[var(--color-accent)] animate-[quill_1.6s_ease-in-out_infinite]" />
            </div>
            <h1 className="font-serif text-3xl font-semibold mb-2">Перо читает первую главу…</h1>
            <p className="text-sm text-ink/55">{fileName}</p>
            <style>{`@keyframes quill { 0%,100% { transform: rotate(-6deg) translateY(0) } 50% { transform: rotate(4deg) translateY(-3px) } }`}</style>
          </div>
        )}

        {stage === 'error' && (
          <div className="w-full max-w-md text-center pt-24">
            <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-5">
              <AlertCircle size={26} className="text-red-600" />
            </div>
            <h1 className="font-serif text-2xl font-semibold mb-2">Не вышло прочитать</h1>
            <p className="text-ink/65 mb-7">{error}</p>
            <button onClick={reset} className="inline-flex items-center gap-2 bg-ink text-[#f5f0e8] px-6 py-3 rounded-xl text-sm font-medium hover:bg-ink/85 transition-colors">
              <RotateCcw size={16} /> Попробовать снова
            </button>
          </div>
        )}

        {stage === 'done' && result && (
          <DemoResultView result={result} onRegister={goRegister} onReset={reset} />
        )}
      </main>

      <footer className="py-8 text-center text-[12px] text-ink/55">
        <Link to="/" className="hover:text-ink/70 transition-colors">← На главную</Link>
      </footer>
    </div>
  );
}

function DemoResultView({ result, onRegister, onReset }: { result: DemoResult; onRegister: () => void; onReset: () => void }) {
  const counts = (['character', 'location', 'item', 'rule'] as const).map(t => ({
    t,
    n: result.entities.filter(e => e.type === t).length,
  })).filter(c => c.n > 0);

  const restChapters = Math.max(0, result.totalChapters - 1);
  const visible = result.entities.slice(0, 6);

  return (
    <div className="w-full max-w-xl pt-12 md:pt-16 pb-10">
      <div className="text-center mb-8">
        <PeroMark size={28} className="text-[var(--color-accent)] mx-auto mb-4" />
        <h1 className="font-serif text-3xl md:text-4xl font-semibold mb-2">
          {result.entities.length > 0 ? 'Вот что нашло Перо в первой главе' : 'Перо прочитало первую главу'}
        </h1>
        <p className="text-ink/55 font-serif italic text-lg">
          «{result.firstChapter.title}» · из {result.totalChapters} {pluralChapters(result.totalChapters)}
        </p>
        {result.suggestedGenres && result.suggestedGenres.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5 mt-3">
            <span className="text-[11px] uppercase tracking-wide text-ink/55 font-bold self-center">Жанр:</span>
            {result.suggestedGenres.map(g => (
              <span key={g} className="text-[12px] px-2.5 py-1 rounded-full bg-[#E7EAE3] text-[var(--color-accent)] font-medium">{g}</span>
            ))}
          </div>
        )}
      </div>

      {counts.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {counts.map(({ t, n }) => {
            const meta = TYPE_META[t];
            return (
              <span key={t} className="inline-flex items-center gap-2 bg-white border border-ink/8 rounded-full px-4 py-2 text-sm">
                <meta.icon size={15} className="text-ink/55" />
                <b className="font-semibold">{n}</b>
                <span className="text-ink/60">{meta.plural.toLowerCase()}</span>
              </span>
            );
          })}
        </div>
      )}

      {visible.length > 0 ? (
        <div className="space-y-2 mb-9">
          {visible.map((e, i) => {
            const meta = TYPE_META[e.type] ?? TYPE_META.character;
            return (
              <div key={i} className="flex items-start gap-3 bg-white rounded-2xl px-4 py-3 border border-ink/6 shadow-sm">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${meta.cls}`}>
                  <meta.icon size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <p className="font-serif text-lg font-semibold text-ink truncate">{e.name}</p>
                    <span className="text-[10px] uppercase tracking-wider text-ink/55 font-bold flex-shrink-0">{meta.label}</span>
                  </div>
                  {e.description && (
                    <p className="text-[13px] text-ink/60 leading-relaxed line-clamp-2">{e.description}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-center text-ink/60 leading-relaxed mb-9 max-w-md mx-auto">
          В первой главе пока тихо — так бывает на прологах. Перо найдёт героев глубже
          в книге, как только прочитает её целиком.
        </p>
      )}

      {/* Мягкая стена */}
      <div className="bg-ink text-[#f5f0e8] rounded-3xl px-7 py-8 text-center">
        <h2 className="font-serif text-2xl font-semibold mb-2">
          {restChapters > 0
            ? `Это только первая глава. Осталось ещё ${restChapters} ${pluralChapters(restChapters)}`
            : 'Хотите сохранить этот Мир?'}
        </h2>
        <p className="text-[#f5f0e8]/70 leading-relaxed mb-6 max-w-md mx-auto">
          Создайте аккаунт — Перо прочитает книгу целиком, построит связи и таймлайны
          персонажей и найдёт противоречия. Бесплатно, без карты.
        </p>
        <button
          onClick={onRegister}
          className="inline-flex items-center gap-2.5 bg-[#f5f0e8] text-ink px-7 py-3.5 rounded-xl text-[15px] font-semibold hover:bg-white transition-colors"
        >
          Создать аккаунт и дочитать
          <ArrowRight size={18} />
        </button>
      </div>

      <div className="text-center mt-6">
        <button onClick={onReset} className="text-sm text-ink/55 hover:text-ink/80 transition-colors inline-flex items-center gap-1.5">
          <RotateCcw size={14} /> Загрузить другую рукопись
        </button>
      </div>
    </div>
  );
}

function pluralChapters(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'глава';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'главы';
  return 'глав';
}
