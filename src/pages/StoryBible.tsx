import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, BookOpen, Check, AlertTriangle,
  X, Bell,
  Users, MapPin, Box, Globe, Pencil, ScanSearch, ShieldCheck, ExternalLink,
} from 'lucide-react';
import { api } from '../services/api';
import { track } from '../services/analytics';
import { registerApproval, AhaCelebration } from '../components/AhaCelebration';
import { AppSidebar, SidebarChapterLinks } from '../components/AppSidebar';
import { Entity, EntitySignificance, EntityLink, EntityEvent, Chapter } from '../components/editor/types';
import {
  significanceLabel, significanceColor, groupBySignificance,
  ATTRIBUTE_LABELS,
  EntityAttributesBlock, EntityConnectionsBlock, EntityTimelineBlock, FirstAppearanceLine,
} from '../components/editor/entityDisplay';

// ── Types ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'inbox',      label: 'Новое',        icon: Bell,   type: '' },
  { id: 'characters', label: 'Персонажи',    icon: Users,  type: 'character' },
  { id: 'locations',  label: 'Локации',      icon: MapPin, type: 'location' },
  { id: 'items',      label: 'Предметы',     icon: Box,    type: 'item' },
  { id: 'rules',      label: 'Правила мира', icon: Globe,  type: 'rule' },
  { id: 'contradictions', label: 'Противоречия', icon: AlertTriangle, type: '' },
] as const;

type TabId = typeof TABS[number]['id'];

const TYPE_TO_TAB: Record<string, TabId> = {
  character: 'characters',
  location:  'locations',
  item:      'items',
  rule:      'rules',
};

/** Editable attribute keys per entity type (порядок = порядок полей в форме). */
const EDITABLE_ATTRIBUTES: Record<string, string[]> = {
  character: ['aliases', 'appearance', 'personality', 'role', 'background', 'motivations', 'speech', 'secrets', 'plotRelevance'],
  location:  ['region', 'physicalDetails', 'mood'],
  item:      ['properties', 'origin', 'owner'],
  rule:      ['scope', 'exceptions'],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function typeLabel(type: string) {
  const map: Record<string, string> = {
    character: 'Персонаж',
    location:  'Локация',
    item:      'Предмет',
    rule:      'Правило мира',
  };
  return map[type] ?? type;
}

function statusBadge(status?: string) {
  if (status === 'pending')  return <span className="inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-amber-100 text-amber-700 border border-amber-200">Ожидает</span>;
  if (status === 'rejected') return <span className="inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-red-100 text-red-700 border border-red-200">Отклонено</span>;
  return null;
}

/** Attribute value → form string (aliases array joins with ', '). */
function attrToString(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  if (v == null) return '';
  return String(v);
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function StoryBible() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [activeTab, setActiveTab] = useState<TabId>('inbox');
  const [entities, setEntities] = useState<Entity[]>([]);
  const [links, setLinks] = useState<EntityLink[]>([]);
  const [events, setEvents] = useState<EntityEvent[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contradictionCount, setContradictionCount] = useState(0);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Load entities + links + events + chapters together
  useEffect(() => {
    if (!id) return;
    setIsLoading(true);
    Promise.all([
      api.get<{ entities: Entity[]; links?: EntityLink[]; events?: EntityEvent[] }>(`/bible/${id}`),
      api.get<{ chapters: Chapter[] }>(`/projects/${id}/chapters`),
    ])
      .then(([bibleData, chaptersData]) => {
        const ents = bibleData.entities ?? [];
        setEntities(ents);
        setLinks(bibleData.links ?? []);
        setEvents(bibleData.events ?? []);
        setChapters(chaptersData.chapters ?? []);
        // Pre-select first entity in current tab
        const firstInTab = ents.filter(e => e.status === 'pending')[0];
        if (firstInTab) setSelectedId(firstInTab.id);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [id]);

  // Счётчик открытых противоречий для бейджа на вкладке (лёгкий запрос)
  useEffect(() => {
    if (!id) return;
    api.get<{ issues?: { id: string }[] }>(`/bible/${id}/contradictions`)
      .then(d => setContradictionCount((d.issues ?? []).length))
      .catch(() => {});
  }, [id, activeTab]);

  // Derived lists
  const tabCfg = TABS.find(t => t.id === activeTab)!;
  const tabEntities = activeTab === 'inbox'
    ? entities.filter(e => e.status === 'pending')
    : entities.filter(e => e.type === tabCfg.type && e.status === 'approved');

  const approvedEntities = entities.filter(e => e.status === 'approved');
  const pendingCount = entities.filter(e => e.status === 'pending').length;
  const selected = tabEntities.find(e => e.id === selectedId) ?? tabEntities[0] ?? null;
  const chapterRefs = chapters.map(c => ({ id: c.id, title: c.title, order: c.order }));

  function switchTab(tab: TabId) {
    setActiveTab(tab);
    setSelectedId(null);
  }

  /** Follow a connection link: jump to the entity on the other end. */
  function openEntity(entity: Entity) {
    const tab = TYPE_TO_TAB[entity.type];
    if (!tab) return;
    setActiveTab(tab);
    setSelectedId(entity.id);
  }

  // Approve / reject
  async function handleApprove(entityId: string) {
    try {
      const data = await api.patch<{ entity: Entity }>(`/bible/${entityId}/approve`);
      setEntities(prev => prev.map(e => e.id === entityId ? data.entity : e));
      track('entity_approved', { projectId: id, type: data.entity?.type });
      registerApproval(id);
    } catch (e) { console.error(e); }
  }

  async function handleReject(entityId: string) {
    try {
      const data = await api.patch<{ entity: Entity }>(`/bible/${entityId}/reject`);
      setEntities(prev => prev.map(e => e.id === entityId ? data.entity : e));
    } catch (e) { console.error(e); }
  }

  /** Manual edit by the author — авторская правка перезаписывает поля. */
  async function handleSaveEntity(entityId: string, patch: {
    name: string;
    description: string;
    significance: EntitySignificance | null;
    attributes: Record<string, unknown> | null;
  }) {
    const data = await api.patch<{ entity: Entity }>(`/bible/${entityId}`, patch);
    setEntities(prev => prev.map(e => e.id === entityId ? data.entity : e));
  }

  async function handleDeleteLink(linkId: string) {
    try {
      await api.delete(`/bible/links/${linkId}`);
      setLinks(prev => prev.filter(l => l.id !== linkId));
    } catch (e) { console.error(e); }
  }

  async function handleDeleteEvent(eventId: string) {
    try {
      await api.delete(`/bible/events/${eventId}`);
      setEvents(prev => prev.filter(ev => ev.id !== eventId));
    } catch (e) { console.error(e); }
  }

  return (
    <div className="flex h-screen w-full bg-[#F5F0E8] font-sans overflow-hidden text-[#1E2D1F]">
      <AhaCelebration />

      {/* ── Left Sidebar (общий компонент) ─────────────────────────────────── */}
      {!isSidebarCollapsed && (
        <div className="hidden md:flex">
          <AppSidebar
            projectId={id!}
            active="bible"
            onCollapse={() => setIsSidebarCollapsed(true)}
          >
            <SidebarChapterLinks projectId={id!} chapters={chapters} isLoading={isLoading} />
          </AppSidebar>
        </div>
      )}

      {/* ── Main Content ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Top bar */}
        <header className="h-16 bg-[#F5F0E8] flex items-center justify-between px-6 border-b border-ink/10 flex-shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate(-1)} className="text-ink/60 hover:text-ink transition-colors">
              <ArrowLeft size={20} />
            </button>
            <h1 className="font-sans text-base font-semibold text-[#1E2D1F]">Мир — {tabCfg.label}</h1>
          </div>
        </header>

        {/* Tabs */}
        <div className="px-8 max-md:px-4 pt-6 border-b border-ink/10 bg-[#F5F0E8] flex-shrink-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          <div className="flex gap-8 max-md:gap-5 whitespace-nowrap">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                className={`pb-4 text-sm border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-ink text-ink font-semibold'
                    : 'border-transparent text-ink/50 hover:text-ink/80 font-medium'
                }`}
              >
                {tab.label}
                {tab.id === 'inbox' && pendingCount > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center w-4 h-4 bg-rose-500 text-white text-[9px] font-bold rounded-full">
                    {pendingCount}
                  </span>
                )}
                {tab.id === 'contradictions' && contradictionCount > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center min-w-4 h-4 px-1 bg-red-600 text-white text-[9px] font-bold rounded-full">
                    {contradictionCount > 9 ? '9+' : contradictionCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-ink/55 text-sm">Загрузка...</div>
        ) : activeTab === 'contradictions' ? (
          <ContradictionsPanel
            projectId={id!}
            onOpenChapter={(chapterId) => navigate(`/editor/${id}/${chapterId}`)}
          />
        ) : (
          <div className="flex-1 flex overflow-hidden">

            {/* List column */}
            <div className={`overflow-y-auto p-8 max-md:p-4 bg-[#F5F0E8] ${selected && activeTab !== 'inbox' ? 'flex-1 border-r border-ink/10' : 'flex-1'}`}>
              {activeTab === 'inbox' ? (
                // ── Inbox ──────────────────────────────────────────────────
                <>
                  <h2 className="text-[13px] font-bold text-ink/55 uppercase tracking-wider mb-6">
                    Ожидают проверки
                  </h2>
                  {tabEntities.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-ink/30">
                      <Check size={36} className="mb-3 text-ink/20" />
                      <p className="text-[15px] font-medium">Всё проверено</p>
                      <p className="text-sm mt-1">Новых предложений нет</p>
                    </div>
                  ) : (
                    <div className="space-y-3 max-w-2xl">
                      {tabEntities.map(entity => (
                        <div key={entity.id} className="bg-white border border-ink/8 rounded-2xl p-5 flex items-start gap-4 shadow-sm hover:shadow-md transition-shadow">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-bold text-[16px] text-[#1E2D1F]">{entity.name}</span>
                              <span className="text-[10px] font-bold text-ink/55 uppercase tracking-wider">{typeLabel(entity.type)}</span>
                              {entity.significance && (
                                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${significanceColor(entity.significance)}`}>
                                  {significanceLabel(entity.significance)}
                                </span>
                              )}
                            </div>
                            {entity.description && (
                              <p className="text-[13px] text-ink/60 leading-relaxed line-clamp-2">{entity.description}</p>
                            )}
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            <button
                              onClick={() => handleApprove(entity.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2C3E2D] hover:bg-[#1e2b1f] text-white text-[12px] font-medium transition-colors"
                            >
                              <Check size={13} strokeWidth={2.5} />
                              Добавить
                            </button>
                            <button
                              onClick={() => handleReject(entity.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ink/5 hover:bg-ink/10 text-ink/60 text-[12px] font-medium transition-colors"
                            >
                              <X size={13} strokeWidth={2.5} />
                              Отклонить
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                // ── Entity grid ────────────────────────────────────────────
                <>
                  <h2 className="text-[13px] font-bold text-ink/55 uppercase tracking-wider mb-8">
                    {tabCfg.label}
                  </h2>
                  {tabEntities.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-ink/30">
                      <tabCfg.icon size={36} className="mb-3 text-ink/20" />
                      <p className="text-[15px] font-medium">Пока пусто</p>
                      <p className="text-sm mt-1">Добавьте записи через ИИ-извлечение в редакторе</p>
                    </div>
                  ) : (
                    <div className="space-y-8">
                      {groupBySignificance(tabEntities).map(group => (
                        <div key={group.key}>
                          <div className="flex items-center gap-2 mb-4">
                            <span className="text-[12px] font-bold uppercase tracking-wider text-ink/55">{group.title}</span>
                            <span className="text-[12px] text-ink/25 font-medium">· {group.items.length}</span>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {group.items.map(entity => {
                              const isSelected = entity.id === selected?.id;
                              return (
                                <div
                                  key={entity.id}
                                  onClick={() => setSelectedId(entity.id)}
                                  className={`cursor-pointer rounded-2xl p-4 transition-all border-2 ${
                                    isSelected
                                      ? 'border-[#1E2D1F] bg-white shadow-sm'
                                      : 'border-transparent bg-white/60 hover:bg-white'
                                  }`}
                                >
                                  {/* Icon avatar */}
                                  <div className="aspect-square rounded-xl bg-[#F0F0EB] flex items-center justify-center mb-3 relative">
                                    <tabCfg.icon size={32} className="text-ink/20" />
                                    {isSelected && (
                                      <div className="absolute top-2 right-2 w-5 h-5 bg-[#2C3E2D] rounded-full flex items-center justify-center text-white shadow-md border-2 border-white">
                                        <Check size={12} strokeWidth={3} />
                                      </div>
                                    )}
                                  </div>
                                  <h3 className="font-bold text-[15px] text-[#1E2D1F] truncate">{entity.name}</h3>
                                  <p className="text-[11px] font-bold text-ink/55 uppercase tracking-wider mt-0.5">
                                    {typeLabel(entity.type)}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Detail panel: на широких экранах — колонка справа; на узких —
                оверлей, открывается явным тапом по карточке (selectedId) */}
            {activeTab !== 'inbox' && selected && selectedId && (
              <div className="fixed inset-0 bg-ink/30 z-40 lg:hidden" onClick={() => setSelectedId(null)} />
            )}
            {activeTab !== 'inbox' && selected && (
              <EntityDetailPanel
                key={selected.id}
                entity={selected}
                icon={tabCfg.icon}
                links={links}
                events={events}
                approvedEntities={approvedEntities}
                chapters={chapterRefs}
                mobileOverlay={selectedId !== null}
                onClose={() => setSelectedId(null)}
                onSelectEntity={openEntity}
                onDeleteLink={handleDeleteLink}
                onDeleteEvent={handleDeleteEvent}
                onSave={handleSaveEntity}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ContradictionsPanel (PRD P1.2) ────────────────────────────────────────────

interface ContradictionReport {
  id: string;
  status: 'running' | 'done' | 'failed';
  totalChapters: number;
  scannedChapters: number;
  error: string | null;
  createdAt: string;
}
interface ContradictionIssue {
  id: string;
  chapterId: string | null;
  chapterTitle: string | null;
  entityName: string | null;
  issue: string;
  severity: 'low' | 'medium' | 'high';
}

function severityMeta(s: string): { label: string; cls: string } {
  if (s === 'high')   return { label: 'Высокая',  cls: 'bg-red-100 text-red-700' };
  if (s === 'medium') return { label: 'Средняя',  cls: 'bg-amber-100 text-amber-700' };
  return { label: 'Низкая', cls: 'bg-emerald-100 text-emerald-700' };
}
const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function ContradictionsPanel({ projectId, onOpenChapter }: {
  projectId: string;
  onOpenChapter: (chapterId: string) => void;
}) {
  const [report, setReport] = useState<ContradictionReport | null>(null);
  const [issues, setIssues] = useState<ContradictionIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  const load = React.useCallback(async () => {
    try {
      const data = await api.get<{ report: ContradictionReport | null; issues: ContradictionIssue[] }>(
        `/bible/${projectId}/contradictions`,
      );
      setReport(data.report);
      setIssues(data.issues ?? []);
    } catch (e) {
      console.error('Failed to load contradictions:', e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Поллинг, пока сканирование идёт
  useEffect(() => {
    if (report?.status !== 'running') return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [report?.status, load]);

  async function startScan() {
    setStarting(true);
    try {
      await api.post(`/bible/${projectId}/contradictions/scan`, {});
      track('contradiction_scan_started', { projectId });
      await load();
    } catch (e: any) {
      if (e?.status === 429) {
        alert('Дневная квота AI исчерпана — проверка станет доступна завтра или на Pro.');
      } else if (e?.status === 409) {
        await load(); // уже идёт — просто подтянем статус
      } else {
        console.error('Failed to start scan:', e);
      }
    } finally {
      setStarting(false);
    }
  }

  async function dismiss(issueId: string) {
    setIssues(prev => prev.filter(i => i.id !== issueId)); // оптимистично
    try {
      await api.post(`/bible/contradictions/${issueId}/dismiss`, {});
      track('contradiction_dismissed', { projectId });
    } catch (e) {
      console.error('Failed to dismiss:', e);
      load(); // откатить к серверу
    }
  }

  const running = report?.status === 'running';
  const sorted = [...issues].sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 1) - (SEVERITY_ORDER[b.severity] ?? 1),
  );

  // Группировка по главам, в порядке появления
  const byChapter = sorted.reduce<{ chapterId: string | null; chapterTitle: string; items: ContradictionIssue[] }[]>((acc, it) => {
    const key = it.chapterId ?? '—';
    let g = acc.find(x => (x.chapterId ?? '—') === key);
    if (!g) { g = { chapterId: it.chapterId, chapterTitle: it.chapterTitle ?? 'Без главы', items: [] }; acc.push(g); }
    g.items.push(it);
    return acc;
  }, []);

  return (
    <div className="flex-1 overflow-y-auto bg-[#F5F0E8] p-8 max-md:p-4">
      <div className="max-w-2xl mx-auto">
        {/* Шапка раздела */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h2 className="font-serif text-2xl font-semibold text-[#1E2D1F] mb-1">Противоречия по всей книге</h2>
            <p className="text-[13px] text-ink/55 leading-relaxed max-w-md">
              Перо сверит каждую главу со всей библией истории и найдёт несоответствия — пока их не нашли читатели.
            </p>
          </div>
          <button
            onClick={startScan}
            disabled={starting || running}
            className="flex-shrink-0 flex items-center gap-2 bg-[#1E2D1F] text-[#f5f0e8] px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-[#2a3f2b] transition-colors disabled:opacity-50"
          >
            <ScanSearch size={16} />
            {running ? 'Идёт проверка…' : starting ? 'Запуск…' : report ? 'Проверить заново' : 'Проверить всю книгу'}
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center text-ink/55 text-sm">Загрузка…</div>
        ) : running ? (
          <div className="bg-white rounded-2xl border border-ink/8 shadow-sm p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-4 h-4 border-2 border-ink/20 border-t-[#4A5D4E] rounded-full animate-spin" />
              <span className="text-sm font-medium text-ink/70">
                Читаю главу {report!.scannedChapters + 1}
                {report!.totalChapters > 0 ? ` из ${report!.totalChapters}` : ''}…
              </span>
            </div>
            {report!.totalChapters > 0 && (
              <div className="h-1.5 bg-ink/8 rounded-full overflow-hidden">
                <div className="h-full bg-[#4A5D4E] rounded-full transition-all duration-500"
                  style={{ width: `${Math.round((report!.scannedChapters / report!.totalChapters) * 100)}%` }} />
              </div>
            )}
            {issues.length > 0 && (
              <p className="text-[12px] text-ink/60 mt-3">Уже найдено: {issues.length}</p>
            )}
          </div>
        ) : !report ? (
          <div className="bg-white rounded-2xl border border-ink/8 shadow-sm p-10 text-center">
            <AlertTriangle size={28} className="text-ink/25 mx-auto mb-3" />
            <p className="text-sm text-ink/60 mb-1">Проверка ещё не запускалась</p>
            <p className="text-[13px] text-ink/55">Нажмите «Проверить всю книгу» — это займёт пару минут.</p>
          </div>
        ) : issues.length === 0 ? (
          <div className="bg-white rounded-2xl border border-ink/8 shadow-sm p-10 text-center">
            <ShieldCheck size={30} className="text-emerald-600 mx-auto mb-3" />
            <p className="text-[15px] font-medium text-ink/80 mb-1">Противоречий не найдено</p>
            <p className="text-[13px] text-ink/60">
              {report.error
                ? report.error
                : `Проверено глав: ${report.scannedChapters}. Мир консистентен.`}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {report.error && (
              <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{report.error}</p>
            )}
            <p className="text-[13px] text-ink/50">
              Найдено противоречий: <b className="text-ink/75">{issues.length}</b>. Отклоните те, что не считаете ошибкой.
            </p>
            {byChapter.map(group => (
              <div key={group.chapterId ?? '—'}>
                <div className="flex items-center gap-2 mb-2.5 ml-0.5">
                  <BookOpen size={13} className="text-ink/55" />
                  <span className="text-[12px] font-bold text-ink/55">{group.chapterTitle}</span>
                  {group.chapterId && (
                    <button
                      onClick={() => onOpenChapter(group.chapterId!)}
                      className="text-ink/55 hover:text-ink/70 transition-colors"
                      title="Открыть главу"
                    >
                      <ExternalLink size={12} />
                    </button>
                  )}
                </div>
                <div className="space-y-2.5">
                  {group.items.map(it => {
                    const sev = severityMeta(it.severity);
                    return (
                      <div key={it.id} className="bg-white rounded-2xl border border-ink/8 shadow-sm p-4 group">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${sev.cls}`}>{sev.label}</span>
                              {it.entityName && (
                                <span className="text-[12px] font-semibold text-ink/70">{it.entityName}</span>
                              )}
                            </div>
                            <p className="text-[13.5px] text-ink/80 leading-relaxed">{it.issue}</p>
                          </div>
                          <button
                            onClick={() => dismiss(it.id)}
                            className="flex-shrink-0 text-[11px] text-ink/55 hover:text-ink/75 font-medium px-2.5 py-1 rounded-lg hover:bg-ink/5 transition-colors"
                            title="Это не ошибка"
                          >
                            Отклонить
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── EntityDetailPanel ─────────────────────────────────────────────────────────

interface DetailProps {
  entity: Entity;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  links: EntityLink[];
  events: EntityEvent[];
  approvedEntities: Entity[];
  chapters: { id: string; title: string; order: number }[];
  /** true, когда сущность выбрана явно — на узких экранах панель становится оверлеем. */
  mobileOverlay: boolean;
  onClose: () => void;
  onSelectEntity: (entity: Entity) => void;
  onDeleteLink: (linkId: string) => void;
  onDeleteEvent: (eventId: string) => void;
  onSave: (entityId: string, patch: {
    name: string;
    description: string;
    significance: EntitySignificance | null;
    attributes: Record<string, unknown> | null;
  }) => Promise<void>;
}

function EntityDetailPanel({
  entity, icon: Icon, links, events, approvedEntities, chapters,
  mobileOverlay, onClose,
  onSelectEntity, onDeleteLink, onDeleteEvent, onSave,
}: DetailProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draftName, setDraftName] = useState(entity.name);
  const [draftDescription, setDraftDescription] = useState(entity.description ?? '');
  const [draftSignificance, setDraftSignificance] = useState<EntitySignificance | ''>(entity.significance ?? '');
  const [draftAttrs, setDraftAttrs] = useState<Record<string, string>>({});

  const editableKeys = EDITABLE_ATTRIBUTES[entity.type] ?? [];

  function startEditing() {
    const attrs = (entity.attributes ?? {}) as Record<string, unknown>;
    setDraftName(entity.name);
    setDraftDescription(entity.description ?? '');
    setDraftSignificance(entity.significance ?? '');
    setDraftAttrs(Object.fromEntries(editableKeys.map(k => [k, attrToString(attrs[k])])));
    setIsEditing(true);
  }

  async function save() {
    setIsSaving(true);
    try {
      // Preserve unknown attribute keys; overwrite/remove only the edited ones
      const merged: Record<string, unknown> = { ...((entity.attributes ?? {}) as Record<string, unknown>) };
      for (const key of editableKeys) {
        const raw = (draftAttrs[key] ?? '').trim();
        if (!raw) {
          delete merged[key];
        } else if (key === 'aliases') {
          merged[key] = raw.split(',').map(s => s.trim()).filter(Boolean);
        } else {
          merged[key] = raw;
        }
      }
      await onSave(entity.id, {
        name: draftName.trim() || entity.name,
        description: draftDescription,
        significance: draftSignificance || null,
        attributes: Object.keys(merged).length > 0 ? merged : null,
      });
      setIsEditing(false);
    } catch (e) {
      console.error('Failed to save entity:', e);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className={`overflow-y-auto bg-[#F5F0E8] flex-shrink-0 flex-col border-l border-ink/5 lg:flex lg:static lg:w-[400px] ${
      mobileOverlay
        ? 'flex max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-50 max-lg:w-full max-lg:max-w-[440px] max-lg:shadow-2xl'
        : 'max-lg:hidden'
    }`}>
      {/* Header */}
      <div className="p-8 flex flex-col items-center text-center border-b border-ink/5 bg-white relative">
        <button
          onClick={onClose}
          className="lg:hidden absolute top-4 left-4 p-2 rounded-lg text-ink/55 hover:text-ink/70 hover:bg-ink/5 transition-colors"
          title="Закрыть"
        >
          <X size={18} />
        </button>
        {!isEditing && (
          <button
            onClick={startEditing}
            className="absolute top-4 right-4 p-2 rounded-lg text-ink/30 hover:text-ink/70 hover:bg-ink/5 transition-colors"
            title="Редактировать"
          >
            <Pencil size={15} />
          </button>
        )}
        <div className="w-24 h-24 rounded-2xl bg-[#F0F0EB] flex items-center justify-center mb-5 shadow-sm border border-ink/5">
          <Icon size={40} className="text-ink/20" />
        </div>
        {isEditing ? (
          <input
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            className="text-2xl font-bold text-[#1E2D1F] mb-2 text-center border-b-2 border-ink/15 focus:border-ink/50 outline-none bg-transparent w-full"
          />
        ) : (
          <h2 className="text-3xl font-bold text-[#1E2D1F] mb-2">{entity.name}</h2>
        )}
        <p className="text-[13px] font-bold text-blue-500 uppercase tracking-wider mb-2">
          {typeLabel(entity.type)}
        </p>
        <div className="flex items-center justify-center gap-2 flex-wrap mb-1">
          {isEditing ? (
            <select
              value={draftSignificance}
              onChange={e => setDraftSignificance(e.target.value as EntitySignificance | '')}
              className="text-[12px] border border-ink/15 rounded-lg px-2 py-1 bg-white outline-none"
            >
              <option value="">Без категории</option>
              <option value="major">Ключевой</option>
              <option value="moderate">Важный</option>
              <option value="minor">Эпизодический</option>
            </select>
          ) : (
            entity.significance && (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${significanceColor(entity.significance)}`}>
                {significanceLabel(entity.significance)}
              </span>
            )
          )}
          {statusBadge(entity.status)}
        </div>
        {!isEditing && (
          <div className="mt-2">
            <FirstAppearanceLine entity={entity} chapters={chapters} />
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-6 flex-1 flex flex-col gap-5">
        {isEditing ? (
          <>
            <div>
              <h4 className="text-[12px] font-bold text-ink/55 uppercase tracking-wider mb-2 ml-1">Описание</h4>
              <textarea
                value={draftDescription}
                onChange={e => setDraftDescription(e.target.value)}
                rows={4}
                className="w-full bg-white p-4 rounded-2xl border border-ink/10 focus:border-ink/30 shadow-sm text-[14px] leading-relaxed text-ink/80 outline-none resize-y"
              />
            </div>
            {editableKeys.length > 0 && (
              <div>
                <h4 className="text-[12px] font-bold text-ink/55 uppercase tracking-wider mb-2 ml-1">Детали</h4>
                <div className="bg-white rounded-2xl border border-ink/10 shadow-sm overflow-hidden">
                  {editableKeys.map((key, i) => (
                    <div key={key} className={`px-4 py-3 ${i < editableKeys.length - 1 ? 'border-b border-ink/5' : ''}`}>
                      <label className="block text-[11px] font-semibold text-ink/55 mb-1">
                        {ATTRIBUTE_LABELS[key] ?? key}
                        {key === 'aliases' && <span className="font-normal text-ink/30"> (через запятую)</span>}
                      </label>
                      <textarea
                        value={draftAttrs[key] ?? ''}
                        onChange={e => setDraftAttrs(prev => ({ ...prev, [key]: e.target.value }))}
                        rows={key === 'background' || key === 'motivations' ? 2 : 1}
                        className="w-full text-[13px] text-ink/80 leading-relaxed outline-none resize-none border-b border-transparent focus:border-ink/20"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={isSaving}
                className="flex-1 bg-[#2C3E2D] hover:bg-[#1e2b1f] disabled:opacity-50 text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors shadow-sm"
              >
                <Check size={16} />
                {isSaving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button
                onClick={() => setIsEditing(false)}
                disabled={isSaving}
                className="px-5 py-3 rounded-xl bg-ink/5 hover:bg-ink/10 text-ink/60 font-medium transition-colors"
              >
                Отмена
              </button>
            </div>
          </>
        ) : (
          <>
            {entity.description ? (
              <div>
                <h4 className="text-[12px] font-bold text-ink/55 uppercase tracking-wider mb-2 ml-1">
                  Описание
                </h4>
                <div className="bg-white p-4 rounded-2xl border border-ink/5 shadow-sm text-[14px] leading-relaxed text-ink/80">
                  {entity.description}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center py-6 text-ink/30">
                <AlertTriangle size={24} className="mb-2" />
                <p className="text-sm">Описание отсутствует</p>
              </div>
            )}

            <EntityAttributesBlock attributes={entity.attributes} />

            <EntityConnectionsBlock
              entity={entity}
              links={links}
              entities={approvedEntities}
              onSelectEntity={onSelectEntity}
              onDeleteLink={onDeleteLink}
            />

            <EntityTimelineBlock
              entity={entity}
              events={events}
              chapters={chapters}
              onDeleteEvent={onDeleteEvent}
            />
          </>
        )}
      </div>
    </div>
  );
}
