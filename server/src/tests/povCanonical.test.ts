/**
 * POV Фаза 4 — канонизация имени рассказчика к сущности Каталога (межкнижный/книжный дедуп POV).
 */
import { describe, it, expect } from 'vitest';
import { canonicalizePov } from '../lib/extraction.js';

const CHARS = [
  { name: 'Риз', attributes: { aliases: ['Ризанд', 'Верховный Владыка'] } },
  { name: 'Фейра', attributes: {} },
  { name: 'Ласэн', attributes: null },
];

describe('canonicalizePov', () => {
  it('алиас → каноническое имя сущности', () => {
    expect(canonicalizePov('Ризанд', CHARS)).toBe('Риз');
    expect(canonicalizePov('Верховный Владыка', CHARS)).toBe('Риз');
  });

  it('вариант написания (е/э) → канон', () => {
    expect(canonicalizePov('Ласен', CHARS)).toBe('Ласэн');
  });

  it('точное совпадение возвращает само имя', () => {
    expect(canonicalizePov('Фейра', CHARS)).toBe('Фейра');
  });

  it('нет совпадения → исходное имя (новый рассказчик — норма)', () => {
    expect(canonicalizePov('Тамлин', CHARS)).toBe('Тамлин');
  });

  it('пусто/null → null', () => {
    expect(canonicalizePov(null, CHARS)).toBeNull();
    expect(canonicalizePov('', CHARS)).toBeNull();
    expect(canonicalizePov('   ', CHARS)).toBeNull();
  });
});
