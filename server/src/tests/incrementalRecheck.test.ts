/**
 * Инкрементальный recheck — чистая логика экономии токенов (без БД/AI).
 * Извлечено из routes/bible.ts: детект изменённых абзацев → шлём модели только их.
 */
import { describe, it, expect } from 'vitest';
import {
  contentHash, splitParagraphs, paragraphHashes, computeIncrementalText,
} from '../lib/incrementalRecheck.js';

// Каждый абзац заведомо длиннее порога (>30 симв.).
const P = (n: number) => `Это абзац номер ${n}, в нём достаточно текста чтобы пройти фильтр длины.`;
const join = (arr: string[]) => arr.join('\n\n');

describe('splitParagraphs', () => {
  it('режет по пустым строкам', () => {
    const out = splitParagraphs(join([P(1), P(2), P(3)]));
    expect(out).toHaveLength(3);
    expect(out[0]).toContain('номер 1');
  });

  it('схлопывает внутренние переводы строк и пробелы в один пробел', () => {
    const out = splitParagraphs('Первая строка абзаца идёт сюда\nи продолжается на второй строке тоже.');
    expect(out).toHaveLength(1);
    expect(out[0]).not.toContain('\n');
    expect(out[0]).toBe('Первая строка абзаца идёт сюда и продолжается на второй строке тоже.');
  });

  it('выкидывает пустые и слишком короткие (≤30) строки', () => {
    const out = splitParagraphs(join([P(1), 'Коротко.', '   ', P(2)]));
    expect(out).toHaveLength(2);
    expect(out.every(p => p.includes('абзац номер'))).toBe(true);
  });

  it('пустой текст → []', () => {
    expect(splitParagraphs('')).toEqual([]);
    expect(splitParagraphs('\n\n   \n\n')).toEqual([]);
  });
});

describe('contentHash', () => {
  it('детерминирован и 16 hex-символов', () => {
    const h = contentHash('какой-то текст');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(contentHash('какой-то текст')).toBe(h);
  });

  it('разный вход → разный хеш', () => {
    expect(contentHash('текст А')).not.toBe(contentHash('текст Б'));
  });
});

describe('paragraphHashes', () => {
  it('по одному хешу на значимый абзац, стабильно', () => {
    const text = join([P(1), P(2), P(3)]);
    const h = paragraphHashes(text);
    expect(h).toHaveLength(3);
    expect(h).toEqual(paragraphHashes(text));
    expect(new Set(h).size).toBe(3); // все разные
  });
});

describe('computeIncrementalText', () => {
  const text = join([P(1), P(2), P(3), P(4)]);
  const baseline = paragraphHashes(text);

  it('нет базлайна → полный текст, не инкремент', () => {
    const r = computeIncrementalText(text, []);
    expect(r.isIncremental).toBe(false);
    expect(r.aiText).toBe(text);
  });

  it('меньше 3 абзацев → полный текст даже с базлайном', () => {
    const two = join([P(1), P(2)]);
    const r = computeIncrementalText(two, paragraphHashes(two));
    expect(r.isIncremental).toBe(false);
    expect(r.aiText).toBe(two);
  });

  it('изменилось меньшинство (1 из 4) → инкремент, шлём только изменённый абзац', () => {
    const changedPara = 'Это совсем новый абзац на месте второго, и он длинный достаточно.';
    const next = join([P(1), changedPara, P(3), P(4)]);
    const r = computeIncrementalText(next, baseline);
    expect(r.isIncremental).toBe(true);
    expect(r.aiText).toContain('совсем новый абзац');
    expect(r.aiText).not.toContain('номер 1');
    expect(r.aiText).not.toContain('номер 4');
  });

  it('ровно 50% изменено (2 из 4) → инкремент (порог ≤0.5)', () => {
    const next = join([
      'Новый первый абзац, достаточно длинный для прохождения фильтра.',
      'Новый второй абзац, тоже достаточно длинный для фильтра длины.',
      P(3), P(4),
    ]);
    const r = computeIncrementalText(next, baseline);
    expect(r.isIncremental).toBe(true);
  });

  it('изменилось большинство (3 из 4) → полный текст', () => {
    const next = join([
      'Новый первый абзац, достаточно длинный для прохождения фильтра.',
      'Новый второй абзац, тоже достаточно длинный для фильтра длины.',
      'Новый третий абзац, и он опять длинный достаточно для фильтра.',
      P(4),
    ]);
    const r = computeIncrementalText(next, baseline);
    expect(r.isIncremental).toBe(false);
    expect(r.aiText).toBe(next);
  });

  it('ничего не изменилось → полный текст (нет смысла слать пустое)', () => {
    const r = computeIncrementalText(text, baseline);
    expect(r.isIncremental).toBe(false);
    expect(r.aiText).toBe(text);
  });
});
