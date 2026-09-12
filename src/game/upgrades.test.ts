import { describe, expect, it } from 'vitest';
import { addResonanceXp, buildDamageMultiplier, chooseModule, createBuild, MODULES, offerModules } from './upgrades';
import type { ModuleId } from './types';

describe('deterministic one-time module choices', () => {
  it('defines exactly six mechanisms per branch and protects the inherited level floor', () => {
    expect(Object.keys(MODULES)).toHaveLength(18);
    for (const branch of ['main', 'drone', 'resource']) expect(Object.values(MODULES).filter(m => m.branch === branch)).toHaveLength(6);
    const carryover = { level: 7, xp: 22, companions: 3 }, build = createBuild(carryover);
    expect(build).toEqual({ modules: [], choices: [], choiceIndex: 0, levelFloor: 7, resonance: 0, resonanceXp: 0 });
    carryover.level = 3; expect(build.levelFloor).toBe(7);
    expect(createBuild().levelFloor).toBe(1);
    expect(createBuild({ level: Infinity, xp: 0, companions: 0 }).levelFloor).toBe(1);
    expect(createBuild({ level: 20, xp: 0, companions: 0 }).levelFloor).toBe(10);
  });

  it('produces the same three offers for equal runs, does not reroll a pending offer, and commits only once', () => {
    const a = createBuild(), b = createBuild();
    const offered = offerModules(a, 6, 3411);
    expect(offered).toEqual(offerModules(b, 6, 3411)); expect(new Set(offered).size).toBe(3);
    expect(new Set(offered.map(id => MODULES[id].branch)).size).toBe(3);
    expect(offerModules(a, 10, 999)).toEqual(offered);
    const unavailable = Object.keys(MODULES).find(id => !offered.includes(id as ModuleId)) as ModuleId;
    expect(chooseModule(a, unavailable)).toBe(false);
    expect(chooseModule(a, offered[0])).toBe(true);
    expect(chooseModule(a, offered[0])).toBe(false); expect(chooseModule(a, offered[1])).toBe(false);
    expect(a.choiceIndex).toBe(1); expect(a.modules).toEqual([offered[0]]); expect(a.choices).toEqual([]);
    offered[0] = unavailable; expect(b.choices).not.toContain(unavailable);
  });

  it('supplies seven distinct choices, refills an exhausted branch, and never grants an eighth choice', () => {
    const build = createBuild();
    for (let choice = 0; choice < 7; choice++) {
      const offered = offerModules(build, 10, 42);
      expect(offered).toHaveLength(3); expect(new Set(offered).size).toBe(3);
      expect(offered.every(id => !build.modules.includes(id))).toBe(true);
      const pick = offered.find(id => MODULES[id].branch === 'main') ?? offered[0];
      expect(chooseModule(build, pick)).toBe(true);
    }
    expect(build.modules).toHaveLength(7); expect(build.modules.filter(id => MODULES[id].branch === 'main')).toHaveLength(6);
    expect(offerModules(build, 10, 42)).toEqual([]);
    expect(chooseModule(build, 'intercept')).toBe(false);
    expect(createBuild().modules).toEqual([]);
  });

  it('never offers the special-bullet upgrade before its weapon unlock', () => {
    for (let seed = 0; seed < 100; seed++) expect(offerModules(createBuild(), 3, seed)).not.toContain('chain');
    expect(Array.from({ length: 100 }, (_, seed) => offerModules(createBuild(), 4, seed)).some(offer => offer.includes('chain'))).toBe(true);
  });
});

describe('capped resonance beyond weapon level ten', () => {
  it('retains overflow, grants one rank per 600 XP, and caps both rank and stored surplus', () => {
    const build = createBuild();
    expect(addResonanceXp(build, 599)).toBe(0); expect(build.resonanceXp).toBe(599);
    expect(addResonanceXp(build, 21)).toBe(1); expect(build.resonanceXp).toBe(20);
    expect(addResonanceXp(build, 1200)).toBe(2); expect(build.resonance).toBe(3); expect(build.resonanceXp).toBe(20);
    expect(addResonanceXp(build, 10000)).toBe(1); expect(build.resonance).toBe(4); expect(build.resonanceXp).toBe(0);
    expect(addResonanceXp(build, 600)).toBe(0); expect(build.resonanceXp).toBe(0);
  });
  it('does not convert pre-cap XP, invalid XP, or negative rewards', () => {
    const build = createBuild(), before = structuredClone(build);
    expect(addResonanceXp(build, 1000, 9)).toBe(0);
    for (const amount of [0, -1, Infinity, NaN]) expect(addResonanceXp(build, amount)).toBe(0);
    expect(build).toEqual(before);
  });
  it('adds precision to resonance without multiplying bonuses or weakening baseline shots', () => {
    const build = createBuild();
    expect(buildDamageMultiplier(build)).toBe(1); expect(buildDamageMultiplier(build, true)).toBe(1);
    build.modules.push('precision'); expect(buildDamageMultiplier(build, true)).toBe(1.2);
    addResonanceXp(build, 2400);
    expect(buildDamageMultiplier(build)).toBe(1.2); expect(buildDamageMultiplier(build, true)).toBe(1.4);
    build.resonance = 999; expect(buildDamageMultiplier(build, true)).toBe(1.4);
  });
});
