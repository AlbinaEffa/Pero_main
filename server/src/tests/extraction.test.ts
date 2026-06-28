/**
 * Юнит-тесты чистых функций extraction.ts — горячее ядро (дедуп, нормализация,
 * фильтр местоимений/мета, жанр/настроение, заголовки глав). БЕЗ БД и AI — быстро.
 *
 * Сценарии взяты из реальной истории багов (Ласен/Ласэн, склонения как ложный дедуп,
 * местоимения-как-сущности, «Глава N»-мусор).
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeNameRu,
  findLikelyDuplicate,
  isMetaEntity,
  sanitizePov,
  sanitizeSynopsis,
  isLowInfoChapterTitle,
  aliasesOf,
  cleanJsonResponse,
  descriptionsDiffer,
  isValidUUID,
  extractEntitySnippet,
} from '../lib/extraction.js';
import { coerceGenres, coerceMoodColor } from '../lib/extractionPrompts.js';

describe('normalizeNameRu', () => {
  it('сводит е/э/ё → е', () => {
    expect(normalizeNameRu('Ласэн')).toBe('ласен');
    expect(normalizeNameRu('Ласён')).toBe('ласен');
    expect(normalizeNameRu('Ласен')).toBe('ласен');
  });
  it('й → и, ъ → ь, нижний регистр, схлоп пробелов', () => {
    expect(normalizeNameRu('Йорик')).toBe('иорик');
    expect(normalizeNameRu('Подъезд')).toBe('подьезд');
    expect(normalizeNameRu('  Два   Слова ')).toBe('два слова');
  });
  it('null/undefined → пустая строка', () => {
    expect(normalizeNameRu(null)).toBe('');
    expect(normalizeNameRu(undefined)).toBe('');
  });
});

describe('findLikelyDuplicate', () => {
  const approved = [
    { id: 'a', name: 'Ласен', type: 'character', attributes: { aliases: ['Ласена'] } },
    { id: 'b', name: 'Каллиас', type: 'character', attributes: {} },
    { id: 'c', name: 'Дворец', type: 'location', attributes: {} },
  ];
  it('ловит опечатку/склонение (edit-distance ≤1) однозначного кандидата', () => {
    expect(findLikelyDuplicate('Ласан', 'character', approved)).toEqual({ id: 'a', name: 'Ласен' });
    expect(findLikelyDuplicate('Калиас', 'character', approved)).toEqual({ id: 'b', name: 'Каллиас' });
  });
  it('точное норм-совпадение (е/э) → null (это работа авто-резолвера, не подсказки)', () => {
    expect(findLikelyDuplicate('Ласэн', 'character', approved)).toBeNull();
  });
  it('тип не совпадает → не матчим', () => {
    expect(findLikelyDuplicate('Дворес', 'character', approved)).toBeNull(); // Дворец — location
  });
  it('короткие имена (<4 норм-символов) → null', () => {
    expect(findLikelyDuplicate('Рик', 'character', approved)).toBeNull();
  });
  it('неоднозначность (2+ кандидата) → null', () => {
    const ambig = [
      { id: 'x', name: 'Мара', type: 'character', attributes: {} },
      { id: 'y', name: 'Кара', type: 'character', attributes: {} },
    ];
    expect(findLikelyDuplicate('Тара', 'character', ambig)).toBeNull();
  });
  it('совсем другое имя → null', () => {
    expect(findLikelyDuplicate('Тамлин', 'character', approved)).toBeNull();
  });
});

describe('isMetaEntity (фильтр местоимений и эхо-полей)', () => {
  it('местоимения — не сущности', () => {
    for (const p of ['я', 'Он', 'ОНА', 'мы', 'I', 'they']) {
      expect(isMetaEntity({ name: p })).toBe(true);
    }
  });
  it('названия полей промпта — мета', () => {
    for (const m of ['Имя персонажа', 'название', 'Каноническое имя', 'character name']) {
      expect(isMetaEntity({ name: m })).toBe(true);
    }
  });
  it('плейсхолдер в скобках «<имя персонажа из текста>» — мета', () => {
    expect(isMetaEntity({ name: '<Имя персонажа из текста>' })).toBe(true);
  });
  it('мета-описание тоже отсекает', () => {
    expect(isMetaEntity({ name: 'Ризанд', description: 'описание персонажа' })).toBe(true);
  });
  it('реальное имя — НЕ мета', () => {
    expect(isMetaEntity({ name: 'Ризанд', description: 'высокий тёмнокрылый воин' })).toBe(false);
    expect(isMetaEntity({ name: 'Двор кошмаров' })).toBe(false);
  });
  it('пустое имя — мусор (мета)', () => {
    expect(isMetaEntity({ name: '' })).toBe(true);
    expect(isMetaEntity({ name: null })).toBe(true);
  });
});

describe('sanitizePov', () => {
  it('местоимение → null', () => {
    expect(sanitizePov('я')).toBeNull();
    expect(sanitizePov('Она')).toBeNull();
  });
  it('маркеры «нет рассказчика» → null', () => {
    for (const v of ['третье лицо', 'неизвестно', 'нет', 'narrator', 'от третьего лица']) {
      expect(sanitizePov(v)).toBeNull();
    }
  });
  it('слишком длинное (предложение) → null', () => {
    expect(sanitizePov('а'.repeat(81))).toBeNull();
  });
  it('настоящее имя → возвращает как есть', () => {
    expect(sanitizePov('Равонна')).toBe('Равонна');
  });
  it('не-строка → null', () => {
    expect(sanitizePov(42)).toBeNull();
    expect(sanitizePov(null)).toBeNull();
  });
});

describe('sanitizeSynopsis', () => {
  it('слишком короткое → null', () => {
    expect(sanitizeSynopsis('коротко')).toBeNull(); // <8
  });
  it('мусор-маркеры → null', () => {
    expect(sanitizeSynopsis('null')).toBeNull();
    expect(sanitizeSynopsis('неизвестно')).toBeNull();
  });
  it('валидный синопсис проходит', () => {
    expect(sanitizeSynopsis('Героиня прибывает ко Двору и встречает Ризанда.')).toBe(
      'Героиня прибывает ко Двору и встречает Ризанда.',
    );
  });
  it('длинное обрезается до 400 с многоточием', () => {
    const out = sanitizeSynopsis('я '.repeat(300));
    expect(out!.length).toBeLessThanOrEqual(400);
    expect(out!.endsWith('…')).toBe(true);
  });
});

describe('isLowInfoChapterTitle', () => {
  it('пусто / голый номер / число → true', () => {
    expect(isLowInfoChapterTitle('')).toBe(true);
    expect(isLowInfoChapterTitle('Глава 5')).toBe(true);
    expect(isLowInfoChapterTitle('  Глава 12  ')).toBe(true);
    expect(isLowInfoChapterTitle('7')).toBe(true);
  });
  it('склейка номеров (мусор оглавления) → true', () => {
    expect(isLowInfoChapterTitle('Глава 79 Глава 8 Глава 9')).toBe(true);
  });
  it('информативный заголовок → false', () => {
    expect(isLowInfoChapterTitle('Глава 5: Битва за крепость')).toBe(false);
    expect(isLowInfoChapterTitle('Часть первая')).toBe(false);
  });
});

describe('aliasesOf', () => {
  it('возвращает строковые алиасы', () => {
    expect(aliasesOf({ aliases: ['Риз', 'Ризанд'] })).toEqual(['Риз', 'Ризанд']);
  });
  it('фильтрует не-строки', () => {
    expect(aliasesOf({ aliases: ['Риз', 42, null] })).toEqual(['Риз']);
  });
  it('нет алиасов / null → пустой массив', () => {
    expect(aliasesOf({})).toEqual([]);
    expect(aliasesOf(null)).toEqual([]);
  });
});

describe('coerceGenres', () => {
  it('канонизирует валидные, отсекает мусор', () => {
    expect(coerceGenres(['фэнтези', 'литрпг', 'выдуманный жанр'])).toEqual(['Фэнтези', 'ЛитРПГ']);
  });
  it('парсит JSON-строку', () => {
    expect(coerceGenres('["Детектив","Триллер"]')).toEqual(['Детектив', 'Триллер']);
  });
  it('дедуп + кап 3', () => {
    expect(coerceGenres(['Драма', 'драма', 'Юмор', 'Боевик', 'Мистика'])).toEqual(['Драма', 'Юмор', 'Боевик']);
  });
  it('объект / мусор → пустой массив', () => {
    expect(coerceGenres({ x: 1 })).toEqual([]);
    expect(coerceGenres('не json')).toEqual([]);
  });
});

describe('coerceMoodColor', () => {
  it('известное настроение → пигмент', () => {
    expect(coerceMoodColor('мрачное')).toBe('#2C3E50');
    expect(coerceMoodColor('Тёплое')).toBe('#C66B49'); // регистронезависимо
  });
  it('неизвестное / не-строка → null', () => {
    expect(coerceMoodColor('розовое')).toBeNull();
    expect(coerceMoodColor(null)).toBeNull();
    expect(coerceMoodColor(123)).toBeNull();
  });
});

describe('cleanJsonResponse', () => {
  it('срезает markdown-обёртку ```json', () => {
    expect(cleanJsonResponse('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(cleanJsonResponse('```\n[1,2]\n```')).toBe('[1,2]');
  });
});

describe('descriptionsDiffer / isValidUUID / extractEntitySnippet', () => {
  it('descriptionsDiffer игнорирует регистр/пробелы', () => {
    expect(descriptionsDiffer('Высокий  воин', 'высокий воин')).toBe(false);
    expect(descriptionsDiffer('воин', 'маг')).toBe(true);
  });
  it('isValidUUID', () => {
    expect(isValidUUID('567fff36-d3de-46cb-8778-101d3cba376c')).toBe(true);
    expect(isValidUUID('не-uuid')).toBe(false);
  });
  it('extractEntitySnippet берёт окно вокруг имени', () => {
    const text = 'Жил-был Ризанд в высоком замке на краю мира.';
    const snip = extractEntitySnippet(text, 'Ризанд', 10);
    expect(snip).toContain('Ризанд');
    expect(text).toContain(snip);
  });
});
