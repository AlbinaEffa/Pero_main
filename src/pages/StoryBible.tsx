import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, BookOpen, User, Plus, Check, AlertTriangle,
  Sparkles, ChevronLeft, FileText, BarChart2, ChevronUp, X, Bell,
  Users, MapPin, Box, Globe,
} from 'lucide-react';
import { api } from '../services/api';
import { Entity, Chapter } from '../components/editor/types';

// ── Types ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'inbox',      label: 'Новое',        icon: Bell,   type: '' },
  { id: 'characters', label: 'Персонажи',    icon: Users,  type: 'character' },
  { id: 'locations',  label: 'Локации',      icon: MapPin, type: 'location' },
  { id: 'items',      label: 'Предметы',     icon: Box,    type: 'item' },
  { id: 'rules',      label: 'Правила мира', icon: Globe,  type: 'rule' },
] as const;

type TabId = typeof TABS[number]['id'];

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
  if (status === 'pending')  return <span className="inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-[#FFF4E5] text-[#B86B11] border border-[#FFE0B2]">Ожидает</span>;
  if (status === 'rejected') return <span className="inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-[#FFF0F0] text-[#C0392B] border border-[#FFCDD2]">Отклонено</span>;
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function StoryBible() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [activeTab, setActiveTab] = useState<TabId>('inbox');
  const [entities, setEntities] = useState<Entity[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Load entities + chapters together
  useEffect(() => {
    if (!id) return;
    setIsLoading(true);
    Promise.all([
      api.get<{ entities: Entity[] }>(`/bible/${id}`),
      api.get<{ chapters: Chapter[] }>(`/projects/${id}/chapters`),
    ])
      .then(([bibleData, chaptersData]) => {
        const ents = bibleData.entities ?? [];
        setEntities(ents);
        setChapters(chaptersData.chapters ?? []);
        // Pre-select first entity in current tab
        const firstInTab = ents.filter(e => e.status === 'pending')[0];
        if (firstInTab) setSelectedId(firstInTab.id);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [id]);

  // Derived lists
  const tabCfg = TABS.find(t => t.id === activeTab)!;
  const tabEntities = activeTab === 'inbox'
    ? entities.filter(e => e.status === 'pending')
    : entities.filter(e => e.type === tabCfg.type && e.status === 'approved');

  const pendingCount = entities.filter(e => e.status === 'pending').length;
  const selected = tabEntities.find(e => e.id === selectedId) ?? tabEntities[0] ?? null;

  function switchTab(tab: TabId) {
    setActiveTab(tab);
    setSelectedId(null);
  }

  // Approve / reject
  async function handleApprove(entityId: string) {
    try {
      const data = await api.patch<{ entity: Entity }>(`/bible/${entityId}/approve`);
      setEntities(prev => prev.map(e => e.id === entityId ? data.entity : e));
    } catch (e) { console.error(e); }
  }

  async function handleReject(entityId: string) {
    try {
      const data = await api.patch<{ entity: Entity }>(`/bible/${entityId}/reject`);
      setEntities(prev => prev.map(e => e.id === entityId ? data.entity : e));
    } catch (e) { console.error(e); }
  }

  const editorPath = id && chapters[0]
    ? `/editor/${id}/${chapters[0].id}`
    : id ? `/editor/${id}` : '/dashboard';

  return (
    <div className="flex h-screen w-full bg-[#F9FAFB] font-sans overflow-hidden text-[#1a1a1a]">

      {/* ── Left Sidebar ──────────────────────────────────────────────────── */}
      <aside className="w-[220px] bg-[#1e2d1f] text-white/80 flex flex-col flex-shrink-0 shadow-xl z-20">
        {/* Logo */}
        <div className="p-4 flex items-center gap-3 border-b border-white/10">
          <Link to="/dashboard" className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white/60 hover:text-white">
            <ChevronLeft size={18} />
          </Link>
          <span className="font-serif font-medium text-white tracking-wide">Перо</span>
        </div>

        {/* Nav */}
        <div className="p-3 space-y-1 border-b border-white/10">
          <Link
            to={`/bible/${id}`}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm bg-white/15 text-white"
          >
            <BookOpen size={16} className="text-white/50" />
            Библия истории
          </Link>
          <Link
            to={editorPath}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm hover:bg-white/10 transition-colors"
          >
            <Sparkles size={16} className="text-white/50" />
            ИИ-Соавтор
          </Link>
        </div>

        {/* Chapter list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
          <div className="flex items-center justify-between px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1 mt-2">
            <span>Главы</span>
          </div>
          {isLoading && (
            <p className="px-3 text-xs text-white/30">Загрузка...</p>
          )}
          {!isLoading && chapters.length === 0 && (
            <p className="px-3 text-xs text-white/30">Нет глав</p>
          )}
          {chapters.map(chapter => (
            <Link
              key={chapter.id}
              to={`/editor/${id}/${chapter.id}`}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-white/10 text-[#f5f0e8]/60 hover:text-white"
            >
              <FileText size={14} className="text-[#f5f0e8]/40 flex-shrink-0" />
              <span className="truncate">{chapter.title}</span>
            </Link>
          ))}
        </div>

        {/* Stats stub */}
        <div className="p-4 border-t border-white/10">
          <div className="flex items-center justify-between border-2 border-[#1a56db] rounded-md px-3 py-2.5 text-white">
            <div className="flex items-center gap-2.5">
              <BarChart2 size={18} strokeWidth={2} />
              <span className="font-semibold text-[15px] tracking-wide">Statistics</span>
            </div>
            <ChevronUp size={16} className="text-white/60" strokeWidth={2} />
          </div>
        </div>
      </aside>

      {/* ── Main Content ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Top bar */}
        <header className="h-16 bg-white flex items-center justify-between px-6 border-b border-black/5 flex-shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate(-1)} className="text-black/60 hover:text-black transition-colors">
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-[17px] font-semibold text-[#1a1a1a]">Story Bible — {tabCfg.label}</h1>
          </div>
          <button
            onClick={() => navigate('/settings')}
            className="w-8 h-8 rounded-full bg-[#E5D5C5] flex items-center justify-center text-[#8C6B4A] border border-black/5 hover:bg-[#d4c1b0] transition-colors"
          >
            <User size={16} />
          </button>
        </header>

        {/* Tabs */}
        <div className="px-8 pt-6 border-b border-black/5 bg-white flex-shrink-0">
          <div className="flex gap-8">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                className={`pb-4 text-[15px] font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-black text-black'
                    : 'border-transparent text-black/50 hover:text-black/80'
                }`}
              >
                {tab.label}
                {tab.id === 'inbox' && pendingCount > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center w-4 h-4 bg-[#D35400] text-white text-[9px] font-bold rounded-full">
                    {pendingCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-black/40 text-sm">Загрузка...</div>
        ) : (
          <div className="flex-1 flex overflow-hidden">

            {/* List column */}
            <div className={`overflow-y-auto p-8 bg-white ${selected && activeTab !== 'inbox' ? 'flex-1 border-r border-black/5' : 'flex-1'}`}>
              {activeTab === 'inbox' ? (
                // ── Inbox ──────────────────────────────────────────────────
                <>
                  <h2 className="text-[13px] font-bold text-black/40 uppercase tracking-wider mb-6">
                    Ожидают проверки
                  </h2>
                  {tabEntities.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-black/30">
                      <Check size={36} className="mb-3 text-black/20" />
                      <p className="text-[15px] font-medium">Всё проверено</p>
                      <p className="text-sm mt-1">Новых предложений нет</p>
                    </div>
                  ) : (
                    <div className="space-y-3 max-w-2xl">
                      {tabEntities.map(entity => (
                        <div key={entity.id} className="bg-white border border-black/8 rounded-2xl p-5 flex items-start gap-4 shadow-sm hover:shadow-md transition-shadow">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-bold text-[16px] text-[#1a1a1a]">{entity.name}</span>
                              <span className="text-[10px] font-bold text-black/40 uppercase tracking-wider">{typeLabel(entity.type)}</span>
                            </div>
                            {entity.description && (
                              <p className="text-[13px] text-black/60 leading-relaxed line-clamp-2">{entity.description}</p>
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
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/5 hover:bg-black/10 text-black/60 text-[12px] font-medium transition-colors"
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
                  <h2 className="text-[13px] font-bold text-black/40 uppercase tracking-wider mb-8">
                    {tabCfg.label}
                  </h2>
                  {tabEntities.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-black/30">
                      <tabCfg.icon size={36} className="mb-3 text-black/20" />
                      <p className="text-[15px] font-medium">Пока пусто</p>
                      <p className="text-sm mt-1">Добавьте записи через ИИ-извлечение в редакторе</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {tabEntities.map(entity => {
                        const isSelected = entity.id === selected?.id;
                        return (
                          <div
                            key={entity.id}
                            onClick={() => setSelectedId(entity.id)}
                            className={`cursor-pointer rounded-2xl p-4 transition-all border-2 ${
                              isSelected
                                ? 'border-[#1a1a1a] bg-white shadow-sm'
                                : 'border-transparent bg-black/[0.02] hover:bg-black/[0.05]'
                            }`}
                          >
                            {/* Icon avatar */}
                            <div className="aspect-square rounded-xl bg-[#F0F0EB] flex items-center justify-center mb-3 relative">
                              <tabCfg.icon size={32} className="text-black/20" />
                              {isSelected && (
                                <div className="absolute top-2 right-2 w-5 h-5 bg-[#2C3E2D] rounded-full flex items-center justify-center text-white shadow-md border-2 border-white">
                                  <Check size={12} strokeWidth={3} />
                                </div>
                              )}
                            </div>
                            <h3 className="font-bold text-[15px] text-[#1a1a1a] truncate">{entity.name}</h3>
                            <p className="text-[11px] font-bold text-black/40 uppercase tracking-wider mt-0.5">
                              {typeLabel(entity.type)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Detail panel */}
            {activeTab !== 'inbox' && selected && (
              <div className="w-[400px] overflow-y-auto bg-[#F9FAFB] flex-shrink-0 flex flex-col border-l border-black/5">
                {/* Header */}
                <div className="p-10 flex flex-col items-center text-center border-b border-black/5 bg-white">
                  <div className="w-24 h-24 rounded-2xl bg-[#F0F0EB] flex items-center justify-center mb-6 shadow-sm border border-black/5">
                    <tabCfg.icon size={40} className="text-black/20" />
                  </div>
                  <h2 className="text-3xl font-bold text-[#1a1a1a] mb-2">{selected.name}</h2>
                  <p className="text-[13px] font-bold text-[#4A90E2] uppercase tracking-wider mb-3">
                    {typeLabel(selected.type)}
                  </p>
                  {statusBadge(selected.status)}
                </div>

                {/* Body */}
                <div className="p-8 flex-1 flex flex-col gap-6">
                  {selected.description ? (
                    <div>
                      <h4 className="text-[12px] font-bold text-black/40 uppercase tracking-wider mb-3 ml-1">
                        Описание
                      </h4>
                      <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm text-[14px] leading-relaxed text-black/80">
                        {selected.description}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center py-6 text-black/30">
                      <AlertTriangle size={24} className="mb-2" />
                      <p className="text-sm">Описание отсутствует</p>
                    </div>
                  )}

                  <div className="mt-auto pt-6 flex flex-col gap-4">
                    <button className="w-full bg-[#2C3E2D] hover:bg-[#1e2b1f] text-white py-3.5 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors shadow-sm">
                      <Sparkles size={18} />
                      Спросить AI
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
