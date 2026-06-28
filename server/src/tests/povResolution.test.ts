/**
 * POV Фаза 3 — детерминированный классификатор книжного резолва POV (без БД/AI).
 */
import { describe, it, expect } from 'vitest';
import { classifyChapterPov, firstPersonRatio, deterministicBookPov, buildPovDetectPrompt } from '../lib/povResolution.js';

const FIRST = 'Я проснулась на рассвете. Меня лихорадило, и я не могла держать меч. Мы с ним вышли в сад, нас никто не видел. Я знала, что мне предстоит. '.repeat(8);
const THIRD = 'Фейра проснулась на рассвете. Ризанд смотрел на неё с тревогой. Они вышли в сад, где их никто не видел. Кассиан ждал у ворот, держа меч наготове. '.repeat(8);

describe('firstPersonRatio', () => {
  it('первое лицо даёт высокую долю, третье — низкую', () => {
    expect(firstPersonRatio(FIRST)).toBeGreaterThan(0.012);
    expect(firstPersonRatio(THIRD)).toBeLessThanOrEqual(0.012);
    expect(firstPersonRatio('')).toBe(0);
  });
});

describe('classifyChapterPov', () => {
  it('служебная глава → план «author» (без AI)', () => {
    expect(classifyChapterPov({ chapterType: 'acknowledgments', text: FIRST }).plan).toBe('author');
    expect(deterministicBookPov('dedication')).toBe('Автор');
    expect(deterministicBookPov('chapter')).toBeNull();
  });

  it('короткий разделитель → «none» (рассказчика нет)', () => {
    const r = classifyChapterPov({ chapterType: 'part', text: 'Часть первая' });
    expect(r.plan).toBe('none');
  });

  it('narrative от первого лица → «detect» (нужен AI-детект имени)', () => {
    const r = classifyChapterPov({ chapterType: 'chapter', text: FIRST });
    expect(r.plan).toBe('detect');
    expect(r.person).toBe('first');
  });

  it('narrative от третьего лица → «none» (POV законно null)', () => {
    const r = classifyChapterPov({ chapterType: 'chapter', text: THIRD });
    expect(r.plan).toBe('none');
    expect(r.person).toBe('third');
  });
});

describe('buildPovDetectPrompt', () => {
  it('фокусный, JSON-формат, режет до начала главы', () => {
    const p = buildPovDetectPrompt('x'.repeat(5000));
    expect(p).toContain('"pov"');
    // начало главы порезано до 1800 символов (промпт = инструкция + ≤1800 текста)
    expect(p).not.toContain('x'.repeat(1801));
    expect(p).toContain('x'.repeat(1800));
  });
});
