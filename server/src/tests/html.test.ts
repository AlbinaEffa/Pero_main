/**
 * Юнит-тесты html.ts — конвертация для ЭКСПОРТА (txt/markdown) и счёт слов.
 * Корректность важна: это файлы, которые автор скачивает. Без БД/AI.
 */
import { describe, it, expect } from 'vitest';
import { htmlToText, htmlToMarkdown, wordCount } from '../lib/html.js';

describe('htmlToText', () => {
  it('срезает теги, абзацы → двойной перенос', () => {
    expect(htmlToText('<p>Первый</p><p>Второй</p>')).toBe('Первый\n\nВторой');
  });
  it('<br> → одинарный перенос', () => {
    expect(htmlToText('Строка<br>Ещё')).toBe('Строка\nЕщё');
  });
  it('декодирует html-сущности', () => {
    expect(htmlToText('<p>Кафе &amp; бар &lt;тут&gt; &quot;цитата&quot; &#39;апостроф&#39;&nbsp;конец</p>'))
      .toBe('Кафе & бар <тут> "цитата" \'апостроф\' конец');
  });
  it('схлопывает 3+ переноса до двух и тримит', () => {
    expect(htmlToText('<p>А</p><p></p><p></p><p>Б</p>')).toBe('А\n\nБ');
  });
  it('пустой вход → пустая строка', () => {
    expect(htmlToText('')).toBe('');
  });
});

describe('htmlToMarkdown', () => {
  it('заголовки h1/h2/h3 → #/##/###', () => {
    expect(htmlToMarkdown('<h1>Заголовок</h1>')).toBe('# Заголовок');
    expect(htmlToMarkdown('<h2>Под</h2>')).toBe('## Под');
    expect(htmlToMarkdown('<h3>Мелкий</h3>')).toBe('### Мелкий');
  });
  it('жирный/курсив → **/*', () => {
    expect(htmlToMarkdown('<p><strong>жирно</strong> и <em>косо</em></p>')).toBe('**жирно** и *косо*');
    expect(htmlToMarkdown('<b>b</b> <i>i</i>')).toBe('**b** *i*');
  });
  it('списки → "- "', () => {
    expect(htmlToMarkdown('<ul><li>раз</li><li>два</li></ul>')).toContain('- раз');
    expect(htmlToMarkdown('<ul><li>раз</li><li>два</li></ul>')).toContain('- два');
  });
});

describe('wordCount', () => {
  it('считает слова в простом тексте', () => {
    expect(wordCount('одно два три')).toBe(3);
  });
  it('считает слова в HTML (через strip)', () => {
    expect(wordCount('<p>одно два</p><p>три</p>')).toBe(3);
  });
  it('пусто → 0', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('   ')).toBe(0);
  });
});
