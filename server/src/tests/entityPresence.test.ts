/**
 * Лексическое присутствие — порт «в кадре». Многословные имена требуют все токены,
 * однословные терпимы к падежам, алиасы учитываются.
 */
import { describe, it, expect } from 'vitest';
import { isMentioned, tokenize, entitiesPresentInChapter } from '../lib/entityPresence.js';

const T = (s: string) => tokenize(s);

describe('isMentioned', () => {
  it('однословное имя ловится в падеже', () => {
    expect(isMentioned('Фейра', T('Я посмотрела на Фейру и кивнула.'))).toBe(true);
    expect(isMentioned('Ризанд', T('Слова Ризанда повисли в воздухе.'))).toBe(true);
  });

  it('многословное имя требует ВСЕ значимые токены', () => {
    expect(isMentioned('Король Сонного королевства', T('Король Сонного королевства вошёл.'))).toBe(true);
    // только «король» в тексте — НЕ матч многословного имени
    expect(isMentioned('Король Сонного королевства', T('Король стражи отдал приказ.'))).toBe(false);
  });

  it('не упомянут → false', () => {
    expect(isMentioned('Тамлин', T('Неста и Элайна сидели у окна.'))).toBe(false);
  });
});

describe('entitiesPresentInChapter', () => {
  it('ловит по имени и по алиасу, остальных не тянет', () => {
    const ents = [
      { name: 'Риз', aliases: ['Ризанд'] },
      { name: 'Фейра', aliases: [] },
      { name: 'Тамлин' },
    ];
    const present = entitiesPresentInChapter('Ризанд молчал, пока Фейра говорила.', ents);
    const names = [...present].map(e => e.name).sort();
    expect(names).toEqual(['Риз', 'Фейра']); // Тамлина нет
  });
});
