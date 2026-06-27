/**
 * Юнит-тесты чистых утилит редактора (вынесены из Editor.tsx).
 * Покрывают баг-историю: многословный матчинг сущности (требует ВСЕ токены — иначе
 * «Король» ложно тянул «Король Сонного королевства»), разбор заголовков глав по типу.
 */
import { describe, it, expect } from 'vitest';
import {
  russianStemMatch,
  entityMatch,
  splitChapterTitle,
  composeChapterTitle,
  sanitizeChapterContent,
  fallbackNormalizeDictation,
} from './editorUtils';

/** Токенизация как в Editor: слова с порядковым индексом (для firstAt). */
function toWords(text: string): { w: string; at: number }[] {
  return text.toLowerCase().split(/[^а-яёa-z0-9'-]+/i).filter(Boolean).map((w, i) => ({ w, at: i }));
}

describe('russianStemMatch', () => {
  it('ловит склонение по стему (отбрасывает последнюю букву)', () => {
    expect(russianStemMatch('Ризанд', 'встретил Ризанда в замке')).toBe(true);
    expect(russianStemMatch('Тамлин', 'о Тамлине говорили')).toBe(true);
  });
  it('короткие имена матчатся целиком', () => {
    expect(russianStemMatch('Рис', 'это Рис')).toBe(true);
  });
  it('нет совпадения → false', () => {
    expect(russianStemMatch('Ризанд', 'совсем другой текст')).toBe(false);
  });
});

describe('entityMatch', () => {
  it('однословное имя: упомянуто + индекс первого появления', () => {
    const text = 'В замке жил Ризанд и его брат.';
    const r = entityMatch('Ризанд', toWords(text), text);
    expect(r.mentioned).toBe(true);
    expect(r.firstAt).toBe(3); // в-замке-жил-ризанд → индекс 3
  });
  it('многословное имя требует ВСЕ токены (фикс ложного матча по «король»)', () => {
    const onlyKing = 'Король вошёл в зал.';
    expect(entityMatch('Король Сонного королевства', toWords(onlyKing), onlyKing).mentioned).toBe(false);

    const full = 'Сюда явился Король Сонного королевства собственной персоной.';
    expect(entityMatch('Король Сонного королевства', toWords(full), full).mentioned).toBe(true);
  });
  it('не упомянуто → firstAt = Infinity', () => {
    const text = 'Здесь никого из них нет.';
    const r = entityMatch('Ризанд', toWords(text), text);
    expect(r.mentioned).toBe(false);
    expect(r.firstAt).toBe(Infinity);
  });
});

describe('splitChapterTitle', () => {
  it('«Глава N: подзаголовок» → префикс + суффикс', () => {
    expect(splitChapterTitle('Глава 1: Битва за крепость')).toEqual({ prefix: 'Глава 1', suffix: 'Битва за крепость' });
  });
  it('голая «Глава N» → пустой суффикс', () => {
    expect(splitChapterTitle('Глава 5')).toEqual({ prefix: 'Глава 5', suffix: '' });
  });
  it('тип-глава (Пролог) → слово-тип как префикс, дубль слова срезан', () => {
    expect(splitChapterTitle('Пролог', undefined, 'prologue')).toEqual({ prefix: 'Пролог', suffix: '' });
    expect(splitChapterTitle('Пролог: Тьма', undefined, 'prologue')).toEqual({ prefix: 'Пролог', suffix: 'Тьма' });
  });
  it('свободный заголовок без «Глава» → фоллбэк-префикс по порядку', () => {
    expect(splitChapterTitle('Моя сцена', 2)).toEqual({ prefix: 'Глава 3', suffix: 'Моя сцена' });
  });
});

describe('composeChapterTitle', () => {
  it('склеивает префикс + суффикс', () => {
    expect(composeChapterTitle('Глава 1', 'Битва')).toBe('Глава 1 Битва');
  });
  it('пустой суффикс → только префикс', () => {
    expect(composeChapterTitle('Пролог', '')).toBe('Пролог');
    expect(composeChapterTitle('Пролог', '   ')).toBe('Пролог');
  });
});

describe('sanitizeChapterContent', () => {
  it('срезает узел заголовка главы', () => {
    const html = '<h1 data-node-type="chapter-title">Глава 1</h1><p>Текст</p>';
    expect(sanitizeChapterContent(html)).toBe('<p>Текст</p>');
  });
  it('пустой контент → <p></p>', () => {
    expect(sanitizeChapterContent('   ')).toBe('<p></p>');
  });
});

describe('fallbackNormalizeDictation', () => {
  it('схлопывает пробелы и капитализирует первую букву', () => {
    expect(fallbackNormalizeDictation('привет   мир')).toBe('Привет мир');
  });
  it('пустой ввод → пустая строка', () => {
    expect(fallbackNormalizeDictation('   ')).toBe('');
  });
});
