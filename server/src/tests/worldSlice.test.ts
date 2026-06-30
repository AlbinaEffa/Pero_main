/**
 * Срез Мира: reserved (major ∪ present ∪ POV-герой) не дропается; дальние minor режутся по бюджету.
 * POV-герой включается ЯВНО даже если по имени в главе не назван (1-е лицо «я»).
 */
import { describe, it, expect } from 'vitest';
import { selectWorldSlice, type SliceEntity, type SliceLink } from '../lib/worldSlice.js';

const e = (id: string, name: string, sig: string | null, attrs: unknown = {}): SliceEntity =>
  ({ id, name, type: 'character', description: `${name} — описание`, significance: sig, attributes: attrs });

const entities: SliceEntity[] = [
  e('1', 'Фейра', 'major'),
  e('2', 'Ризанд', 'major'),
  e('3', 'Тамлин', 'minor'),
  e('4', 'Люсьен', 'minor', { aliases: ['Лис'] }),
  e('5', 'Амрена', 'moderate'),
];
const links: SliceLink[] = [{ sourceEntityId: '1', targetEntityId: '4', relation: 'союзник' }];

describe('selectWorldSlice', () => {
  it('present + major попадают; minor по алиасу ловится', () => {
    const r = selectWorldSlice({ entities, links, chapterText: 'Фейра молчала. Лис посмотрел на неё.', budgetChars: 100000 });
    const names = r.entities.map(x => x.name);
    expect(names).toContain('Фейра');   // present + major
    expect(names).toContain('Ризанд');  // major всегда
    expect(names).toContain('Люсьен');  // present по алиасу «Лис»
  });

  it('POV-герой включён, даже если по имени в главе НЕ назван (1-е лицо)', () => {
    // Текст без имени «Фейра» — она рассказчик («я»). Лексика её не словит.
    const r = selectWorldSlice({ entities, links, chapterText: 'Я открыла глаза. Болела рука.', pov: 'Фейра', budgetChars: 1 });
    expect(r.entities.map(x => x.name)).toContain('Фейра');
    expect(r.stats.povIncluded).toBe(true);
  });

  it('дальние minor режутся при малом бюджете, major/present/POV остаются', () => {
    const r = selectWorldSlice({ entities, links, chapterText: 'Фейра шла одна.', pov: 'Фейра', budgetChars: 1 });
    const names = r.entities.map(x => x.name);
    expect(names).toContain('Фейра');     // present + POV
    expect(names).toContain('Ризанд');    // major
    expect(names).not.toContain('Тамлин');// дальний minor — срезан
    expect(r.stats.dropped).toBeGreaterThan(0);
  });

  it('связи срезаются до включённых сущностей', () => {
    const r = selectWorldSlice({ entities, links, chapterText: 'Фейра молчала. Лис рядом.', budgetChars: 100000 });
    // оба конца (Фейра, Люсьен) present → связь валидна
    expect(r.links.length).toBe(1);
  });
});
