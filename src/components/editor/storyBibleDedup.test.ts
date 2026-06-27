/**
 * Тесты дедуп-детектора findDuplicateGroups (StoryBiblePanel) — самая баг-историчная
 * логика: варианты написания (Ласен/Ласэн), сокращения (Король ⊆ Король Сонного…),
 * защита от ложного слияния категорий («Кольцо X» / «Кольцо Y»), типы, опечатки.
 */
import { describe, it, expect } from 'vitest';
import { findDuplicateGroups } from './StoryBiblePanel';
import type { Entity } from './types';

let seq = 0;
function ent(name: string, opts: { type?: string; aliases?: string[]; sig?: Entity['significance'] } = {}): Entity {
  return {
    id: `e${seq++}`,
    type: opts.type ?? 'character',
    name,
    description: '',
    significance: opts.sig ?? 'major',
    attributes: opts.aliases ? ({ aliases: opts.aliases } as Entity['attributes']) : null,
  };
}

/** Множества имён в найденных группах (для устойчивого сравнения без учёта порядка). */
function groupNameSets(groups: Entity[][]): Set<string>[] {
  return groups.map(g => new Set(g.map(e => e.name)));
}
function hasGroup(groups: Entity[][], names: string[]): boolean {
  return groupNameSets(groups).some(s => s.size === names.length && names.every(n => s.has(n)));
}

describe('findDuplicateGroups', () => {
  it('варианты написания е/э → одна группа', () => {
    const g = findDuplicateGroups([ent('Ласен'), ent('Ласэн')]);
    expect(g).toHaveLength(1);
    expect(hasGroup(g, ['Ласен', 'Ласэн'])).toBe(true);
  });

  it('сокращение: однословное = начало РОВНО одного многословного → слить', () => {
    const g = findDuplicateGroups([ent('Король'), ent('Король Сонного королевства')]);
    expect(hasGroup(g, ['Король', 'Король Сонного королевства'])).toBe(true);
  });

  it('ЛОЖНАЯ категория: «Кольцо» + 2+ многословных «Кольцо …» → НЕ сливаем', () => {
    const g = findDuplicateGroups([
      ent('Кольцо', { type: 'item' }),
      ent('Кольцо из оникса', { type: 'item' }),
      ent('Кольцо смертного жениха', { type: 'item' }),
    ]);
    expect(g).toHaveLength(0); // ни «Кольцо»+что-то, ни два многословных меж собой
  });

  it('разные типы не сливаются', () => {
    const g = findDuplicateGroups([
      ent('Кинжал', { type: 'item' }),
      ent('Кинжальщик', { type: 'character' }),
    ]);
    expect(g).toHaveLength(0);
  });

  it('алиас связывает разные имена', () => {
    const g = findDuplicateGroups([
      ent('Риз', { aliases: ['Ризанд'] }),
      ent('Ризанд'),
    ]);
    expect(hasGroup(g, ['Риз', 'Ризанд'])).toBe(true);
  });

  it('одиночная опечатка (edit-distance ≤1, длина ≥5) → группа', () => {
    const g = findDuplicateGroups([ent('Каллиас'), ent('Калиас')]);
    expect(hasGroup(g, ['Каллиас', 'Калиас'])).toBe(true);
  });

  it('склонение-префикс (Ризанд/Ризанду) → группа', () => {
    const g = findDuplicateGroups([ent('Ризанд'), ent('Ризанду')]);
    expect(hasGroup(g, ['Ризанд', 'Ризанду'])).toBe(true);
  });

  it('совсем разные имена → нет групп', () => {
    const g = findDuplicateGroups([ent('Тамлин'), ent('Амаранта'), ent('Люсьен')]);
    expect(g).toHaveLength(0);
  });

  it('транзитивность: A≈B, B≈C → одна группа из трёх', () => {
    // Ласен ≈ Ласэн (е/э), Ласэн ≈ Ласён (э/ё) → объединение-поиск собирает всех
    const g = findDuplicateGroups([ent('Ласен'), ent('Ласэн'), ent('Ласён')]);
    expect(g).toHaveLength(1);
    expect(g[0]).toHaveLength(3);
  });
});
