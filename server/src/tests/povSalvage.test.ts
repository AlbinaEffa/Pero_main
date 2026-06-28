/**
 * POV Фаза 2 — чистая логика спасения само-упоминаний:
 *  • isSelfReferenceName — что считается само-упоминанием рассказчика;
 *  • povContextBlock — врезка «ракурс главы» подаётся только при известном POV (не «Автор»).
 * (Сам резолвер processExtractionResults бьёт в БД — проверяется интеграционно.)
 */
import { describe, it, expect } from 'vitest';
import { isSelfReferenceName } from '../lib/extraction.js';
import { povContextBlock } from '../lib/extractionPrompts.js';

describe('isSelfReferenceName — само-упоминания рассказчика', () => {
  it('первое лицо — само-упоминание', () => {
    for (const n of ['я', 'Я', 'меня', 'мне', 'мной', 'мы', 'нас', 'нам']) {
      expect(isSelfReferenceName(n), n).toBe(true);
    }
  });

  it('родовые слова-роли протагониста — само-упоминание', () => {
    for (const n of ['героиня', 'Героиня', 'герой', 'главная героиня', 'протагонист', 'рассказчик', 'повествовательница']) {
      expect(isSelfReferenceName(n), n).toBe(true);
    }
  });

  it('2-е/3-е лицо, антагонист, реальные имена — НЕ само-упоминание', () => {
    for (const n of ['ты', 'вы', 'он', 'она', 'они', 'антагонист', 'Фейра', 'Ризанд', 'Неста', '']) {
      expect(isSelfReferenceName(n), n).toBe(false);
    }
    expect(isSelfReferenceName(null)).toBe(false);
    expect(isSelfReferenceName(undefined)).toBe(false);
  });
});

describe('povContextBlock — врезка «ракурс главы»', () => {
  it('известный POV-герой → врезка с его именем', () => {
    const block = povContextBlock('Фейра');
    expect(block).toContain('Фейра');
    expect(block).toContain('ОТ ПЕРВОГО ЛИЦА');
    expect(block).toMatch(/POV/);
  });

  it('пустой POV или «Автор» (служебная глава) → пустая врезка', () => {
    expect(povContextBlock(null)).toBe('');
    expect(povContextBlock(undefined)).toBe('');
    expect(povContextBlock('')).toBe('');
    expect(povContextBlock('   ')).toBe('');
    expect(povContextBlock('Автор')).toBe('');
  });
});
