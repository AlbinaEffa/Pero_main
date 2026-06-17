import { ReactNode } from 'react';
import {
  Feather, ChevronsRight, ChevronsLeft, Eye, Loader2, CheckCircle2,
  Sparkles, AlertTriangle, Check, X, BookOpen, ArrowRight,
} from 'lucide-react';
import { Entity } from './types';

const TYPE_PIGMENT: Record<string, string> = {
  character: '#A14F44', location: '#4A5D4E', item: '#91682E', rule: '#54627F',
};
const TYPE_LABEL: Record<string, string> = {
  character: 'персонаж', location: 'локация', item: 'предмет', rule: 'правило',
};

interface Props {
  collapsed: boolean;
  onToggleCollapse: () => void;

  freshness: 'fresh' | 'stale' | 'unknown';
  isExtracting: boolean;
  onRead: () => void;

  /** Сущности, встречающиеся в текущей главе (память сцены). */
  sceneEntities: Entity[];
  /** Ids тех, кто прямо сейчас «в кадре» — в сцене вокруг курсора. */
  inSceneIds: Set<string>;
  /** Находки Пера в этой главе, ждущие одобрения. */
  findingsHere: Entity[];
  onApproveFinding: (id: string) => void;
  onRejectFinding: (id: string) => void;
  /** Ids сущностей с возможной нестыковкой. */
  contradictionIds: Set<string>;

  onOpenEntity: (e: Entity) => void;
  onOpenWorld: () => void;

  mode: 'scene' | 'chat';
  onModeChange: (m: 'scene' | 'chat') => void;

  /** Чат с Пером (CoauthorPanel) — вставляется как есть. */
  chat: ReactNode;
}

function shortFact(e: Entity): string {
  const a = e.attributes as Record<string, string> | null | undefined;
  const pick = a?.appearance || a?.role || a?.physicalDetails || a?.properties || a?.scope || '';
  const text = (pick || e.description || '').trim();
  return text.length > 52 ? text.slice(0, 51) + '…' : text;
}

/** Строка сущности в памяти сцены. `dim` — приглушённая (для «ещё в главе»). */
function EntityRow({ e, hasConflict, onOpen, dim }: {
  e: Entity; hasConflict: boolean; onOpen: (e: Entity) => void; dim?: boolean;
}) {
  return (
    <button onClick={() => onOpen(e)}
      className={`flex items-start gap-2.5 text-left rounded-xl border border-transparent hover:border-[#1e2d1f]/10 transition-all p-2.5 ${
        dim ? 'bg-white/40 hover:bg-white/70 opacity-80' : 'bg-white/70 hover:bg-white'
      }`}>
      <span className="w-6 h-6 rounded-full flex-shrink-0 mt-0.5" style={{ background: (TYPE_PIGMENT[e.type] ?? '#54627F') + '22' }} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="text-[12.5px] font-medium text-[#1e2d1f] truncate">{e.name}</span>
          {hasConflict && <AlertTriangle size={11} className="text-[#A14F44] flex-shrink-0" />}
        </span>
        <span className="block text-[10.5px] uppercase tracking-wide" style={{ color: TYPE_PIGMENT[e.type] ?? '#54627F' }}>{TYPE_LABEL[e.type] ?? 'мир'}</span>
        {shortFact(e) && <span className="block text-[11px] text-[#1e2d1f]/55 leading-snug mt-0.5">{shortFact(e)}</span>}
      </span>
    </button>
  );
}

/**
 * Правый спутник «Перо» — внешняя память + советчик рядом с письмом. Две вкладки:
 * «Сцена» (кто/что в этой главе, находки и нестыковки здесь — чтобы не держать в голове)
 * и «Спросить» (чат). Заменяет иконочный рельс: одна осмысленная колонка, не уходишь из текста.
 */
export function WorldCompanion({
  collapsed, onToggleCollapse,
  freshness, isExtracting, onRead,
  sceneEntities, inSceneIds, findingsHere, onApproveFinding, onRejectFinding, contradictionIds,
  onOpenEntity, onOpenWorld, mode, onModeChange, chat,
}: Props) {
  const sceneConflicts = sceneEntities.filter(e => contradictionIds.has(e.id));
  // Память сцены: кто прямо сейчас в кадре vs. остальные по главе.
  const inFrame = sceneEntities.filter(e => inSceneIds.has(e.id));
  const restOfChapter = sceneEntities.filter(e => !inSceneIds.has(e.id));

  // Закрыт — справа НИЧЕГО (никакого рельса). Вызов из нижней панели кнопкой «Перо».
  if (collapsed) return null;

  return (
    <div className="flex flex-col flex-shrink-0 border-l border-[#1e2d1f]/10 bg-[#f5f0e8]/95 w-[288px] max-md:fixed max-md:inset-0 max-md:w-full max-md:z-[60]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-[#1e2d1f]/5">
        <Feather size={16} className="text-[#1e2d1f]" />
        <span className="text-[13px] font-semibold text-[#1e2d1f]">Перо</span>
        <button onClick={onToggleCollapse} title="Свернуть" aria-label="Свернуть спутник"
          className="ml-auto p-1 rounded-md text-[#1e2d1f]/45 hover:bg-[#1e2d1f]/5 hover:text-[#1e2d1f] transition-colors">
          <ChevronsRight size={16} />
        </button>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1 px-3 py-2 border-b border-[#1e2d1f]/5">
        {([['scene', 'Сцена'], ['chat', 'Спросить']] as const).map(([id, label]) => (
          <button key={id} onClick={() => onModeChange(id)}
            className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors ${
              mode === id ? 'bg-[#1e2d1f] text-[#f5f0e8]' : 'text-[#1e2d1f]/55 hover:bg-[#1e2d1f]/[0.06]'
            }`}>
            {label}
            {id === 'scene' && (findingsHere.length + sceneConflicts.length) > 0 && (
              <span className="ml-1 text-[9px] rounded-full px-1.5 py-0.5 bg-[#71597F]/15 text-[#71597F]">{findingsHere.length + sceneConflicts.length}</span>
            )}
          </button>
        ))}
      </div>

      {mode === 'chat' ? (
        <div className="flex-1 min-h-0 flex flex-col">{chat}</div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 text-[12px]">
          {/* Статус чтения */}
          <div className="flex items-center gap-2">
            {isExtracting ? (
              <span className="flex items-center gap-1.5 text-[#91682E]"><Loader2 size={14} className="animate-spin" /> Перо читает главу…</span>
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

          {/* Находки здесь */}
          {findingsHere.length > 0 && (
            <div className="rounded-xl bg-[#71597F]/[0.07] p-2.5">
              <div className="flex items-center gap-1.5 mb-2 text-[#71597F] font-semibold text-[11px]"><Sparkles size={13} /> Перо нашло здесь</div>
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

          {/* Нестыковки здесь */}
          {sceneConflicts.length > 0 && (
            <div className="rounded-xl bg-[#A14F44]/[0.08] p-2.5">
              <div className="flex items-center gap-1.5 mb-1.5 text-[#A14F44] font-semibold text-[11px]"><AlertTriangle size={13} /> Возможные нестыковки</div>
              {sceneConflicts.map(e => (
                <button key={e.id} onClick={() => onOpenEntity(e)} className="block w-full text-left text-[11.5px] text-[#A14F44] hover:underline py-0.5">{e.name} — проверить</button>
              ))}
            </div>
          )}

          {/* Память сцены: «В кадре» (вокруг курсора) + «Ещё в главе» */}
          {sceneEntities.length === 0 ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#1e2d1f]/45 mb-2">В этой главе</div>
              <p className="text-[11.5px] text-[#1e2d1f]/45 leading-relaxed">Здесь пока никого. Нажмите «Прочитать» — Перо найдёт, кто и что в этой главе.</p>
            </div>
          ) : (
            <>
              {inFrame.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#A14F44] mb-2">
                    <Eye size={12} /> В кадре · {inFrame.length}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {inFrame.map(e => (
                      <EntityRow key={e.id} e={e} hasConflict={contradictionIds.has(e.id)} onOpen={onOpenEntity} />
                    ))}
                  </div>
                </div>
              )}
              {restOfChapter.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[#1e2d1f]/40 mb-2">
                    {inFrame.length > 0 ? 'Ещё в главе' : 'В этой главе'} · {restOfChapter.length}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {restOfChapter.map(e => (
                      <EntityRow key={e.id} e={e} hasConflict={contradictionIds.has(e.id)} onOpen={onOpenEntity} dim />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <button onClick={onOpenWorld} className="mt-1 flex items-center justify-center gap-1.5 text-[12px] font-medium text-[#1e2d1f]/70 hover:text-[#1e2d1f] border border-[#1e2d1f]/10 hover:border-[#1e2d1f]/20 rounded-xl py-2 transition-colors">
            <BookOpen size={14} /> Весь Мир <ArrowRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
