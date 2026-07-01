import { ReactNode, useState, useEffect } from 'react';
import {
  PanelRight, ChevronRight, Eye, Loader2, CheckCircle2,
  Sparkles, AlertTriangle, Check, X, BookOpen, ArrowRight, StickyNote, Plus, Lightbulb,
} from 'lucide-react';
import { Entity } from './types';
import { SverkaPeek } from './SverkaPeek';

const NOTE_KIND_COLOR: Record<string, string> = {
  idea: '#71597F', note: '#4A5D4E', question: '#54627F', todo: '#A14F44',
};

const TYPE_PIGMENT: Record<string, string> = {
  character: '#A14F44', location: '#4A5D4E', item: '#91682E', rule: '#54627F',
};
const TYPE_LABEL: Record<string, string> = {
  character: 'персонаж', location: 'локация', item: 'предмет', rule: 'правило',
};
const TYPE_LABEL_PLURAL: Record<string, string> = {
  character: 'Персонажи', location: 'Локации', item: 'Предметы', rule: 'Правила',
};
const TYPE_ORDER = ['character', 'location', 'item', 'rule'];

/** Группирует сущности по типу в каноническом порядке (персонажи → локации → предметы → правила → прочее). */
function groupByType(list: Entity[]): [string, Entity[]][] {
  const map = new Map<string, Entity[]>();
  for (const e of list) {
    const k = e.type || 'other';
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(e);
  }
  const ordered: [string, Entity[]][] = [];
  for (const t of TYPE_ORDER) {
    const v = map.get(t);
    if (v) { ordered.push([t, v]); map.delete(t); }
  }
  for (const [k, v] of map) ordered.push([k, v]);
  return ordered;
}

interface Props {
  collapsed: boolean;
  onToggleCollapse: () => void;

  /** Авторский план этой главы (режим архитектора) — сшивает план→текст (Этап C). */
  scenePlan?: string | null;
  onOpenPlan?: () => void;
  /** Хэндофф серии: контекст прошлых книг (открытые нити) для книги N>1. */
  seriesHandoff?: { bookOrder: number; openThreads: { title: string; closesHere: boolean }[] } | null;
  onOpenSeriesWorld?: () => void;

  /** Сводка после «Прочитать»: счётчики ведут в нужную линзу «Мира». */
  summaryFindings?: number;
  summaryContradictions?: number;
  summaryDangling?: number;
  onOpenSummaryLens?: (target: string) => void;

  /** Канал «Сверка»: находки приходят в рельс по грани зума (глава/книга/серия). */
  projectId?: string;
  chapterId?: string | null;
  sverkaScope?: 'chapter' | 'project' | 'series';
  sverkaSeriesId?: string | null;
  onJumpToQuote?: (chapterId: string, quote: string) => void;
  onJumpToBook?: (projectId: string, chapterId: string, quote: string) => void;
  onOpenThreads?: () => void;
  onOpenReport?: () => void;
  onSverkaChanged?: () => void;

  freshness: 'fresh' | 'stale' | 'unknown';
  isExtracting: boolean;
  onRead: () => void;

  /** Сущности, встречающиеся в текущей главе (память сцены). */
  sceneEntities: Entity[];
  /** Служебный раздел (благодарности/посвящение/…) — ИИ его не анализирует. */
  isServiceChapter?: boolean;
  /** POV-рассказчик текущей главы (null — третье лицо/не указан). */
  povCharacter: string | null;
  /** Имена персонажей для подсказок выбора POV. */
  povOptions: string[];
  /** Сохранить POV главы (строка-имя или null — убрать). */
  onSetPov: (value: string | null) => void;
  /** Краткая аннотация текущей главы (что произошло) — null, если ещё нет. */
  chapterSynopsis: string | null;
  /** Находки Пера в этой главе, ждущие одобрения. */
  findingsHere: Entity[];
  onApproveFinding: (id: string) => void;
  onRejectFinding: (id: string) => void;
  /** Ids сущностей с возможной нестыковкой. */
  contradictionIds: Set<string>;

  onOpenEntity: (e: Entity) => void;
  onOpenWorld: () => void;

  /** Заметки этой главы (маргиналии) + открыть линзу «Заметки». */
  chapterNotes?: { id: string; kind: string; body: string }[];
  onOpenNotes?: () => void;

  mode: 'scene' | 'sverka' | 'chat';
  onModeChange: (m: 'scene' | 'sverka' | 'chat') => void;

  /** Чат с Пером (CoauthorPanel) — вставляется как есть. */
  chat: ReactNode;
}

function shortFact(e: Entity): string {
  const a = e.attributes as Record<string, string> | null | undefined;
  const pick = a?.appearance || a?.role || a?.physicalDetails || a?.properties || a?.scope || '';
  const text = (pick || e.description || '').trim();
  return text.length > 52 ? text.slice(0, 51) + '…' : text;
}

/** Строка сущности в памяти главы. Клик — открывает профиль слоем по центру (не инлайн).
 *  `dim` — приглушённая (для «ещё в главе»). */
function EntityRow({ e, hasConflict, dim, onOpen }: {
  e: Entity; hasConflict: boolean; dim?: boolean; onOpen: (e: Entity) => void;
}) {
  return (
    <button onClick={() => onOpen(e)}
      className={`flex items-start gap-2.5 w-full text-left rounded-xl border border-transparent hover:border-[#1e2d1f]/10 transition-all p-2.5 ${
        dim ? 'bg-white/40 hover:bg-white/70 opacity-80' : 'bg-white/70 hover:bg-white'
      }`}>
      <span className="w-6 h-6 rounded-full flex-shrink-0 mt-0.5" style={{ background: (TYPE_PIGMENT[e.type] ?? '#54627F') + '22' }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-[14px] font-medium text-[#1e2d1f] truncate">{e.name}</span>
          {hasConflict && <AlertTriangle size={12} className="text-[#A14F44] flex-shrink-0" />}
        </span>
        <span className="block text-[11px] uppercase tracking-wide" style={{ color: TYPE_PIGMENT[e.type] ?? '#54627F' }}>{TYPE_LABEL[e.type] ?? 'мир'}</span>
        {shortFact(e) && <span className="block text-[13px] text-[#1e2d1f]/55 leading-snug mt-0.5">{shortFact(e)}</span>}
      </span>
      <ChevronRight size={14} className="flex-shrink-0 mt-0.5 text-[#1e2d1f]/30" />
    </button>
  );
}

/** Список сущностей, сгруппированный по типам (персонажи → локации → предметы → правила). */
function GroupedEntityRows({ entities, dim, contradictionIds, onOpen }: {
  entities: Entity[]; dim?: boolean; contradictionIds: Set<string>; onOpen: (e: Entity) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {groupByType(entities).map(([type, items]) => (
        <div key={type}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TYPE_PIGMENT[type] ?? '#54627F' }} />
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: TYPE_PIGMENT[type] ?? '#54627F' }}>
              {TYPE_LABEL_PLURAL[type] ?? 'Прочее'} · {items.length}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {items.map(e => (
              <EntityRow key={e.id} e={e} hasConflict={contradictionIds.has(e.id)} dim={dim} onOpen={onOpen} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Редактор POV главы: имя рассказчика с подсказками или «третье лицо». Авторская правка — авторитет. */
function PovEditor({ value, options, onSet }: { value: string | null; options: string[]; onSet: (v: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => { setDraft(value ?? ''); }, [value]);
  const commit = () => { const v = draft.trim(); if (v !== (value ?? '')) onSet(v || null); };
  return (
    <div className="flex items-center gap-2 rounded-lg bg-[#1e2d1f]/[0.03] px-2.5 py-1.5">
      <span className="text-[12px] font-medium text-[#1e2d1f]/55 flex-shrink-0">От лица</span>
      <input
        list="pov-options" value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        placeholder="третье лицо"
        className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-[#1e2d1f] placeholder:text-[#1e2d1f]/30"
      />
      <datalist id="pov-options">{options.map(o => <option key={o} value={o} />)}</datalist>
      {value && (
        <button onClick={() => { setDraft(''); onSet(null); }} title="Убрать (третье лицо)" aria-label="Убрать POV"
          className="flex-shrink-0 p-0.5 rounded text-[#1e2d1f]/35 hover:bg-[#1e2d1f]/8 transition-colors">
          <X size={12} />
        </button>
      )}
    </div>
  );
}

/**
 * Правый спутник «Перо» — внешняя память + советчик рядом с письмом. Две вкладки:
 * «Глава» (кто/что в этой главе, находки и нестыковки здесь — чтобы не держать в голове;
 * глава может состоять из нескольких сцен, поэтому ярлык именно «Глава», а не «Сцена»)
 * и «Спросить» (чат). Заменяет иконочный рельс: одна осмысленная колонка, не уходишь из текста.
 */
export function WorldCompanion({
  collapsed, onToggleCollapse,
  scenePlan, onOpenPlan,
  seriesHandoff, onOpenSeriesWorld,
  summaryFindings = 0, summaryContradictions = 0, summaryDangling = 0, onOpenSummaryLens,
  projectId, chapterId, sverkaScope = 'chapter', sverkaSeriesId, onJumpToQuote, onJumpToBook, onOpenThreads, onOpenReport, onSverkaChanged,
  freshness, isExtracting, onRead,
  sceneEntities, isServiceChapter,
  povCharacter, povOptions, onSetPov, chapterSynopsis,
  findingsHere, onApproveFinding, onRejectFinding, contradictionIds,
  onOpenEntity, onOpenWorld, chapterNotes = [], onOpenNotes, mode, onModeChange, chat,
}: Props) {
  const sceneConflicts = sceneEntities.filter(e => contradictionIds.has(e.id));
  // Три режима рельса: «В кадре» (память сцены) · «Сверка» (находки) · «Спросить» (чат).
  const showScene = mode === 'scene';
  const showSverka = mode === 'sverka';
  const sverkaBadge = summaryContradictions + summaryDangling + summaryFindings; // ambient-счётчик находок
  // Рамка = ГЛАВА: показываем всех персонажей/локации/предметы этой главы, без привязки к курсору.

  // Свёрнут: на md+ анимируем ширину 0↔288 — колонка редактора и нижний бар плавно
  // разъезжаются, без «прыжка» (бар центрируется по колонке и следует за её шириной).
  // На узких — это полноэкранный оверлей, прячем по collapsed (не анимируем поток).
  return (
    <div
      className={`flex-shrink-0 overflow-hidden transition-[width] duration-300 ease-out max-md:fixed max-md:inset-0 max-md:z-[60] ${
        collapsed ? 'md:w-0 max-md:hidden' : 'md:w-[288px] max-md:w-full'
      }`}
      aria-hidden={collapsed}
    >
    <div className="flex flex-col h-full w-[288px] max-md:w-full border-l border-[#1e2d1f]/10 bg-[#f5f0e8]/95">
      {/* Header — переключатель у внутренней грани (как у левого сайдбара), бренд-перо убрано */}
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-[#1e2d1f]/5">
        <button onClick={onToggleCollapse} title="Скрыть панель" aria-label="Скрыть спутник"
          className="-ml-1 p-1.5 rounded-md text-[#1e2d1f]/45 hover:bg-[#1e2d1f]/5 hover:text-[#1e2d1f] transition-colors">
          <PanelRight size={18} />
        </button>
        <span className="text-[13px] font-semibold text-[#1e2d1f]">Перо</span>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1 px-3 py-2 border-b border-[#1e2d1f]/5">
        {([['scene', 'В кадре'], ['sverka', 'Сверка'], ['chat', 'Спросить']] as const).map(([id, label]) => (
          <button key={id} onClick={() => onModeChange(id)}
            className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors ${
              mode === id ? 'bg-[#1e2d1f] text-[#f5f0e8]' : 'text-[#1e2d1f]/55 hover:bg-[#1e2d1f]/[0.06]'
            }`}>
            {label}
            {id === 'sverka' && sverkaBadge > 0 && (
              <span className={`ml-1 text-[9px] rounded-full px-1.5 py-0.5 ${mode === 'sverka' ? 'bg-[#f5f0e8]/20 text-[#f5f0e8]' : 'bg-[#A14F44]/15 text-[#A14F44]'}`}>{sverkaBadge}</span>
            )}
          </button>
        ))}
      </div>

      {mode === 'chat' ? (
        <div className="flex-1 min-h-0 flex flex-col">{chat}</div>
      ) : isServiceChapter ? (
        <div className="flex-1 overflow-y-auto p-4 text-[12px]">
          <div className="flex items-center gap-1.5 text-[#1e2d1f]/45 mb-2">
            <BookOpen size={14} /> <span className="font-semibold uppercase tracking-wider text-[10px]">Служебный раздел</span>
          </div>
          <p className="text-[12px] text-[#1e2d1f]/60 leading-relaxed">
            Перо не анализирует благодарности, посвящения, предисловия и подобные разделы —
            это не сюжет, и токены на них не тратятся.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 text-[13px]">
          {/* Статус чтения */}
          <div className="flex items-center gap-2">
            {isExtracting ? (
              <ReadingFeed />
            ) : freshness === 'fresh' ? (
              <span className="flex items-center gap-1.5 text-[#4D6B4D]"><CheckCircle2 size={14} /> Перо прочитало главу</span>
            ) : (
              <>
                <span className="text-[#1e2d1f]/55">{freshness === 'stale' ? 'Глава изменилась' : 'Глава не прочитана'}</span>
                <button onClick={onRead} className="ml-auto flex items-center gap-1 font-semibold text-[#f5f0e8] bg-[#1e2d1f] hover:bg-[#2a3f2b] rounded-lg px-2.5 py-1 transition-colors">
                  <Eye size={13} /> Прочитать
                </button>
              </>
            )}
          </div>

          {/* Канал «Сверка»: находки приходят к автору — отдельный режим рельса, не мешают памяти сцены. */}
          {showSverka && projectId && onJumpToQuote && onOpenThreads && (
            <SverkaPeek projectId={projectId} chapterId={chapterId ?? null} scope={sverkaScope} seriesId={sverkaSeriesId} onJumpToQuote={onJumpToQuote} onJumpToBook={onJumpToBook} onOpenThreads={onOpenThreads} onOpenReport={onOpenReport} onChanged={onSverkaChanged} />
          )}

          {/* Инбокс «на подтверждение» — отдельный поток (новые сущности на одобрение), НЕ Сверка.
              Нестыковки/провисания живут в SverkaPeek выше — здесь их пилюли убраны (был двойной счётчик). */}
          {showSverka && onOpenSummaryLens && summaryFindings > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => onOpenSummaryLens('inbox')}
                className="flex items-center gap-1.5 rounded-lg bg-[#71597F]/[0.1] text-[#71597F] px-2.5 py-1.5 text-[12px] font-medium hover:bg-[#71597F]/[0.16] transition-colors">
                <Sparkles size={13} /> {summaryFindings} на подтверждение
              </button>
            </div>
          )}

          {/* Хэндофф серии — контекст прошлых книг для книги N>1: открытые нити франшизы как чек-лист */}
          {showScene && seriesHandoff && (
            <div className="rounded-lg bg-[#54627F]/[0.08] px-2.5 py-2">
              <button
                onClick={onOpenSeriesWorld}
                className="flex items-center gap-1.5 mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#54627F] hover:text-[#3f4c63] transition-colors"
                title="Открыть единый Мир серии"
              >
                <BookOpen size={12} /> Из прошлых книг серии (кн. {seriesHandoff.bookOrder})
              </button>
              {seriesHandoff.openThreads.length > 0 ? (
                <ul className="flex flex-col gap-0.5">
                  {seriesHandoff.openThreads.map((t, i) => (
                    <li key={i} className="text-[12px] text-[#1e2d1f]/75 flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-[#54627F] flex-shrink-0" />
                      {t.title}{t.closesHere && <span className="text-[10px] text-[#A14F44]">· закрыть здесь</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11.5px] text-[#1e2d1f]/45">Открытых нитей нет — мир серии под рукой.</p>
              )}
            </div>
          )}

          {/* Замысел сцены (Этап C) — авторский план этой главы из «Сюжета», сшивает план→текст */}
          {showScene && scenePlan && scenePlan.trim() && (
            <div className="rounded-lg bg-[#A14F44]/[0.06] px-2.5 py-2">
              <button
                onClick={onOpenPlan}
                className="flex items-center gap-1.5 mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#A14F44]/80 hover:text-[#A14F44] transition-colors"
                title="Открыть в «Сюжете»"
              >
                <Lightbulb size={12} /> Замысел сцены
              </button>
              <p className="text-[12.5px] text-[#1e2d1f]/75 leading-relaxed whitespace-pre-wrap">{scenePlan.trim()}</p>
            </div>
          )}

          {/* POV главы — правится вручную (исправить мис-детект, проставить где пусто) */}
          {showScene && <PovEditor value={povCharacter} options={povOptions} onSet={onSetPov} />}

          {/* Синопсис главы — «что произошло» (извлекается ИИ при чтении) */}
          {showScene && chapterSynopsis && (
            <div className="rounded-lg bg-[#1e2d1f]/[0.03] px-2.5 py-2">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[#1e2d1f]/40 mb-1">Синопсис</div>
              <p className="text-[13px] text-[#1e2d1f]/70 leading-relaxed">{chapterSynopsis}</p>
            </div>
          )}

          {/* Находки здесь (новые сущности на одобрение) — в режиме «Сверка» */}
          {showSverka && findingsHere.length > 0 && (
            <div className="rounded-xl bg-[#71597F]/[0.07] p-2.5">
              <div className="flex items-center gap-1.5 mb-2 text-[#71597F] font-semibold text-[12px]"><Sparkles size={14} /> Перо нашло здесь</div>
              <div className="flex flex-col gap-1.5">
                {findingsHere.map(f => (
                  <div key={f.id} className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-1.5">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: TYPE_PIGMENT[f.type] ?? '#54627F' }} />
                    <span className="min-w-0 flex-1 truncate text-[#1e2d1f]">{f.name}</span>
                    <button onClick={() => onApproveFinding(f.id)} title="Добавить" className="p-1 rounded-md text-[#4D6B4D] hover:bg-[#E5EBE0]"><Check size={14} /></button>
                    <button onClick={() => onRejectFinding(f.id)} title="Скрыть" className="p-1 rounded-md text-[#1e2d1f]/40 hover:bg-[#1e2d1f]/5"><X size={13} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Нестыковки здесь — в режиме «Сверка» */}
          {showSverka && sceneConflicts.length > 0 && (
            <div className="rounded-xl bg-[#A14F44]/[0.08] p-2.5">
              <div className="flex items-center gap-1.5 mb-1.5 text-[#A14F44] font-semibold text-[12px]"><AlertTriangle size={14} /> Возможные нестыковки</div>
              {sceneConflicts.map(e => (
                <button key={e.id} onClick={() => onOpenEntity(e)} className="block w-full text-left text-[12.5px] text-[#A14F44] hover:underline py-0.5">{e.name} — проверить</button>
              ))}
            </div>
          )}

          {/* Рамка = глава: все персонажи/локации/предметы/правила этой главы */}
          {showScene && (sceneEntities.length === 0 ? (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#1e2d1f]/45 mb-2">В этой главе</div>
              <p className="text-[12.5px] text-[#1e2d1f]/45 leading-relaxed">Здесь пока никого. Нажмите «Прочитать» — Перо найдёт, кто и что в этой главе.</p>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#A14F44] mb-2">
                <Eye size={13} /> В этой главе · {sceneEntities.length}
              </div>
              <GroupedEntityRows entities={sceneEntities} contradictionIds={contradictionIds} onOpen={onOpenEntity} />
            </div>
          ))}

          {/* Маргиналии: заметки этой главы (привязанные по chapterId) — рядом с текстом. */}
          {showScene && onOpenNotes && (
            <div className="mt-1">
              <button onClick={onOpenNotes} className="w-full flex items-center gap-1.5 mb-2 text-[#1e2d1f]/55 hover:text-[#1e2d1f] transition-colors">
                <StickyNote size={13} />
                <span className="text-[11px] font-bold uppercase tracking-wider">Заметки главы{chapterNotes.length ? ` · ${chapterNotes.length}` : ''}</span>
                <Plus size={13} className="ml-auto" />
              </button>
              {chapterNotes.slice(0, 4).map(n => {
                const color = NOTE_KIND_COLOR[n.kind] ?? '#4A5D4E';
                return (
                  <button key={n.id} onClick={onOpenNotes} className="w-full text-left bg-white/70 hover:bg-white border border-[#1e2d1f]/8 rounded-lg px-2.5 py-1.5 mb-1.5 transition-colors" style={{ borderLeft: `2.5px solid ${color}` }}>
                    <span className="text-[12px] text-[#1e2d1f]/80 line-clamp-2 leading-snug">{n.body.split('\n')[0]}</span>
                  </button>
                );
              })}
              {chapterNotes.length > 4 && (
                <button onClick={onOpenNotes} className="text-[11px] text-[#1e2d1f]/45 hover:text-[#1e2d1f]/70 px-1">ещё {chapterNotes.length - 4} →</button>
              )}
            </div>
          )}

          {showScene && (
            <button onClick={onOpenWorld} className="mt-1 flex items-center justify-center gap-1.5 text-[13px] font-medium text-[#1e2d1f]/70 hover:text-[#1e2d1f] border border-[#1e2d1f]/10 hover:border-[#1e2d1f]/20 rounded-xl py-2 transition-colors">
              <BookOpen size={14} /> Весь Мир <ArrowRight size={13} />
            </button>
          )}

          {/* Сверка пуста — мягкая подсказка вместо голого статуса */}
          {showSverka && sverkaBadge === 0 && findingsHere.length === 0 && sceneConflicts.length === 0 && (
            <p className="text-[12.5px] text-[#1e2d1f]/45 leading-relaxed">
              Перо пока ничего не нашло. Нажмите «Прочитать» — находки и нестыковки придут сюда.
            </p>
          )}
        </div>
      )}
    </div>
    </div>
  );
}

// #7: живая лента ожидания ИИ. Извлечение — один запрос без стриминга стадий, поэтому
// проговариваем реальные этапы работы Пера по таймеру, пока идёт «Прочитать». Даёт ощущение
// движения (извлечение долгое) вместо немого спиннера. Стадии — в порядке конвейера извлечения.
const READING_STAGES = [
  'Читаю главу целиком…',
  'Нахожу персонажей, локации, предметы…',
  'Связываю находки с Миром…',
  'Сверяю факты — ищу нестыковки…',
  'Собираю синопсис главы…',
];
function ReadingFeed() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI(v => (v + 1) % READING_STAGES.length), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="flex items-center gap-1.5 text-[#91682E] min-w-0">
      <Loader2 size={14} className="animate-spin shrink-0" />
      <span key={i} className="truncate animate-[fadeIn_260ms_ease-out]">{READING_STAGES[i]}</span>
    </span>
  );
}
