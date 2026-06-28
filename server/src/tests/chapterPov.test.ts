/**
 * POV-инвариант: служебные главы (голос автора) детерминированно получают POV «Автор».
 * Чистая логика (без БД/AI).
 */
import { describe, it, expect } from 'vitest';
import {
  SERVICE_CHAPTER_TYPES, ALLOWED_CHAPTER_TYPES, AUTHOR_POV,
  isServiceChapter, deterministicPov,
} from '../lib/chapterPov.js';

describe('chapterPov — POV-инвариант', () => {
  it('служебные типы распознаются', () => {
    for (const t of ['acknowledgments', 'dedication', 'foreword', 'afterword']) {
      expect(isServiceChapter(t), t).toBe(true);
    }
  });

  it('сюжетные/структурные — НЕ служебные', () => {
    for (const t of ['chapter', 'prologue', 'epilogue', 'part', 'interlude']) {
      expect(isServiceChapter(t), t).toBe(false);
    }
    expect(isServiceChapter(null)).toBe(false);
    expect(isServiceChapter(undefined)).toBe(false);
    expect(isServiceChapter('')).toBe(false);
  });

  it('детерминированный POV: служебная → «Автор», сюжетная → null', () => {
    expect(deterministicPov('acknowledgments')).toBe(AUTHOR_POV);
    expect(deterministicPov('dedication')).toBe('Автор');
    expect(deterministicPov('chapter')).toBeNull();
    expect(deterministicPov('prologue')).toBeNull();
    expect(deterministicPov(null)).toBeNull();
  });

  it('ALLOWED содержит и сюжетные, и служебные; SERVICE ⊂ ALLOWED', () => {
    expect(ALLOWED_CHAPTER_TYPES).toContain('chapter');
    expect(ALLOWED_CHAPTER_TYPES).toContain('acknowledgments');
    for (const t of SERVICE_CHAPTER_TYPES) expect(ALLOWED_CHAPTER_TYPES).toContain(t);
  });
});
