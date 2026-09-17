import { describe, expect, it } from 'vitest';
import { AttackBudget } from './attack-budget';

describe('committed enemy attack capacity', () => {
  it('protects the complete telegraphed batch from unrelated releases', () => {
    const budget = new AttackBudget(12, 4);
    expect(budget.reserve(1, 8, 2, 2, 0, 4, 2)).toBe(true);
    expect(budget.take(2, 'bullets', 4)).toBe(false);
    expect(budget.take(2, 'hazards', 2)).toBe(false);
    for (let live = 4; live < 12; live++) expect(budget.take(1, 'bullets', live)).toBe(true);
    expect(budget.take(1, 'bullets', 12)).toBe(false);
    expect(budget.take(1, 'hazards', 2)).toBe(true);
    expect(budget.take(1, 'hazards', 3)).toBe(true);
    expect(budget.sources).toBe(0);
  });
  it('rejects the whole batch before its tell and releases cancelled promises', () => {
    const budget = new AttackBudget(10, 2);
    expect(budget.reserve(1, 11, 0, 1, 0, 0, 0)).toBe(false);
    expect(budget.reserve(1, 8, 2, 1, 0, 0, 0)).toBe(true);
    budget.cancel(1);
    expect(budget.reserve(2, 10, 2, 1, 0, 0, 0)).toBe(true);
    budget.expire(1.1);
    expect(budget.reservedBullets).toBe(0);
    expect(budget.reservedHazards).toBe(0);
  });
});
