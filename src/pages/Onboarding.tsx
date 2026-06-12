import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../services/api';
import { track } from '../services/analytics';
import { Chapter } from '../components/editor/types';
import { useWorldBuild, extractQuotes } from '../components/onboarding/useWorldBuild';
import { ReadingStep } from '../components/onboarding/ReadingStep';
import { WorldMapStep } from '../components/onboarding/WorldMapStep';

/**
 * Онбординг «Перо читает вашу книгу» (PRD P0.4, 10x-версия из CEO-ревью 12.06).
 *
 * Шаги: reading (живая лента находок) → map («Карта мира»).
 * Загрузка файла происходит ДО этого экрана (ImportModal в Dashboard) —
 * сюда попадают сразу после создания проекта.
 *
 * Состояние выводится из БД (джобы + библия): закрытие вкладки безопасно,
 * при возврате онбординг продолжается с места.
 */
export default function Onboarding() {
  const { projectId } = useParams<{ projectId: string }>();
  const [step, setStep] = useState<'reading' | 'map'>('reading');
  const [projectTitle, setProjectTitle] = useState('');
  const [firstChapterId, setFirstChapterId] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<string[]>([]);
  const world = useWorldBuild(projectId);
  const trackedReading = useRef(false);

  // Название проекта + главы (цитаты для ленты + id первой главы для CTA)
  useEffect(() => {
    if (!projectId) return;
    api.get<{ project: { title?: string } }>(`/projects/${projectId}`)
      .then(d => setProjectTitle(d.project?.title ?? ''))
      .catch(() => {});
    api.get<{ chapters: Chapter[] }>(`/projects/${projectId}/chapters`)
      .then(d => {
        const chapters = d.chapters ?? [];
        if (chapters.length > 0) {
          setFirstChapterId(chapters[0].id);
          setQuotes(extractQuotes(chapters.map(c => c.content ?? '').filter(Boolean)));
        }
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!trackedReading.current && projectId) {
      trackedReading.current = true;
      track('onboarding_reading_viewed', { projectId });
    }
  }, [projectId]);

  // Если джоб извлечения нет вообще (прямой заход в старый проект) — сразу карта
  useEffect(() => {
    if (step === 'reading' && world.counts && world.counts.total === 0) {
      setStep('map');
    }
  }, [step, world.counts]);

  // Завершение чтения — телеметрия aha-воронки
  const handleReadingComplete = () => {
    track('onboarding_extraction_done', {
      projectId,
      entities: world.entities.length,
      partial: world.isPartial,
      failedChapters: world.counts?.failed ?? 0,
    });
    setStep('map');
  };

  if (!projectId) return null;

  return (
    <div className="min-h-screen w-full bg-[#f5f0e8] font-sans text-[#1e2d1f] overflow-y-auto">
      {step === 'reading' ? (
        <ReadingStep world={world} quotes={quotes} onComplete={handleReadingComplete} />
      ) : (
        <WorldMapStep
          projectId={projectId}
          projectTitle={projectTitle}
          firstChapterId={firstChapterId}
          world={world}
        />
      )}
    </div>
  );
}
