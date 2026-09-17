import { describe, expect, it } from 'vitest';
import { addResonanceXp, BEHAVIOR_MODULES, buildDamageMultiplier, buildModuleViews, choiceView, chooseModule, createBuild, eligibleEvolutions, enqueueUpgrade, EVOLUTIONS, hasEvolution, moduleRank, MODULES, MODULE_VALUES, offerModules, rankValue, rerollModules } from './upgrades';
import type { ModuleId, PlayerBuild, UpgradeChoiceId } from './types';

function owned(build: PlayerBuild, id: ModuleId, rank: 1 | 2 = 1): void {
  if (!build.modules.includes(id)) build.modules.push(id);
  build.ranks[id] = rank;
}
function pending(build: PlayerBuild, source: 'level' | 'boss' = 'level', id = `${source}:${build.rewardHistory.length}`): void {
  expect(enqueueUpgrade(build, source, id)).toBe(true);
}
function isModule(id: UpgradeChoiceId): id is ModuleId { return id in MODULES; }

describe('continuous-campaign module rewards', () => {
  it('has 24 ranked modules and six recipes with no inherited build strength', () => {
    expect(Object.keys(MODULES)).toHaveLength(24);
    for (const branch of ['main', 'drone', 'resource']) expect(Object.values(MODULES).filter(module => module.branch === branch)).toHaveLength(8);
    expect(Object.keys(EVOLUTIONS)).toHaveLength(6);
    const build = createBuild();
    expect(build.modules).toEqual([]); expect(build.ranks).toEqual({}); expect(build.evolutions).toEqual([]);
    expect(build.levelFloor).toBe(1); expect(build.rerollsRemaining).toBe(2);
    expect(offerModules(build, 10, 1)).toEqual([]);
  });

  it('enqueues nine unique level rewards and four boss rewards, even before choosing', () => {
    const build = createBuild();
    for (let level = 2; level <= 10; level++) pending(build, 'level', `level:${level}`);
    for (let boss = 0; boss < 4; boss++) pending(build, 'boss', `boss:${boss}`);
    expect(build.pendingRewards).toHaveLength(13);
    expect(enqueueUpgrade(build, 'level', 'level:11')).toBe(false);
    expect(enqueueUpgrade(build, 'boss', 'boss:4')).toBe(false);
    expect(enqueueUpgrade(build, 'boss', 'level:2')).toBe(false);
    for (let index = 0; index < 13; index++) {
      const offers = offerModules(build, 10, 22);
      expect(offers).toHaveLength(3); expect(new Set(offers).size).toBe(3);
      expect(chooseModule(build, offers[0], { offerId: build.offerId! })).toBe(true);
    }
    expect(build.pendingRewards).toEqual([]); expect(build.choiceIndex).toBe(13);
    expect(enqueueUpgrade(build, 'level', 'level:2')).toBe(false);
    expect(offerModules(build, 10, 22)).toEqual([]);
  });

  it('keeps offers deterministic, stable and isolated from returned arrays', () => {
    const a = createBuild(), b = createBuild(); pending(a); pending(b);
    const offers = offerModules(a, 5, 34), other = offerModules(b, 5, 34);
    expect(offers).toEqual(other);
    expect(offerModules(a, 10, 999)).toEqual(offers);
    offers.reverse(); expect(a.choices).toEqual(other);
    expect(chooseModule(a, 'reward:xp')).toBe(false);
    expect(chooseModule(a, other[0])).toBe(true);
    expect(chooseModule(a, other[0])).toBe(false);
    expect(a.choices).toEqual([]); expect(a.choiceIndex).toBe(1);
    expect(enqueueUpgrade(a, 'level', a.rewardHistory[0].id)).toBe(false);
  });

  it('guards stale commits across queued rewards and rerolls using the offer identity', () => {
    const build = createBuild(); pending(build, 'level', 'level:2'); pending(build, 'level', 'level:3');
    const first = offerModules(build, 5, 1), oldId = build.offerId!;
    expect(chooseModule(build, first[0], { offerId: oldId })).toBe(true);
    const second = offerModules(build, 5, 1);
    expect(chooseModule(build, second[0], { offerId: oldId })).toBe(false);
    const beforeReroll = build.offerId!; rerollModules(build, 5, 1);
    expect(chooseModule(build, build.choices[0], { offerId: beforeReroll })).toBe(false);
    expect(build.choiceIndex).toBe(1); expect(build.pendingRewards).toHaveLength(1);
  });

  it('offers an owned rank and a new slot where possible, while protecting the six-slot limit', () => {
    for (let seed = 0; seed < 100; seed++) {
      const build = createBuild(); owned(build, 'piercing'); build.choiceIndex = 2; pending(build);
      const offered = offerModules(build, 5, seed);
      expect(offered).toContain('piercing'); expect(offered.some(id => isModule(id) && !build.modules.includes(id))).toBe(true);
    }
    const build = createBuild();
    for (const id of ['piercing', 'wingShots', 'precision', 'shatter', 'chain', 'prism'] as const) owned(build, id);
    pending(build); const offered = offerModules(build, 10, 2);
    expect(offered.every(id => isModule(id) && build.modules.includes(id))).toBe(true);
    const id = offered[0] as ModuleId; expect(chooseModule(build, id)).toBe(true);
    expect(moduleRank(build, id)).toBe(2); expect(build.modules).toHaveLength(6);
    pending(build); expect(offerModules(build, 10, 2)).not.toContain(id);
  });

  it('provides a behavior in both opening offers and withholds special upgrades before Lv4', () => {
    for (let seed = 0; seed < 120; seed++) {
      const build = createBuild();
      for (let index = 0; index < 2; index++) {
        pending(build); const offers = offerModules(build, 2 + index, seed);
        const behavior = offers.find(id => isModule(id) && BEHAVIOR_MODULES.includes(id));
        expect(behavior, `${seed}:${index}`).toBeDefined(); expect(offers).not.toContain('chain');
        expect(chooseModule(build, behavior!)).toBe(true);
      }
    }
  });

  it('prioritizes a missing evolution partner without sacrificing the owned upgrade slot', () => {
    const build = createBuild(); owned(build, 'piercing'); build.choiceIndex = 2; pending(build);
    const offers = offerModules(build, 10, 42);
    expect(offers).toContain('piercing'); expect(offers).toContain('precision');
  });

  it('allows exactly two explicit rerolls and never consumes the queued reward', () => {
    const a = createBuild(), b = createBuild(); pending(a); pending(b);
    offerModules(a, 8, 4); offerModules(b, 8, 4);
    for (let index = 0; index < 2; index++) {
      const previous = [...a.choices];
      expect(rerollModules(a, 8, 4)).toEqual(rerollModules(b, 8, 4));
      expect(a.choices.some(id => !previous.includes(id))).toBe(true);
    }
    const before = structuredClone(a);
    expect(rerollModules(a, 8, 4)).toEqual([]); expect(a).toEqual(before);
    expect(a.pendingRewards).toHaveLength(1); expect(a.choiceIndex).toBe(0);
  });

  it('uses three distinct resource fallbacks after ranks are exhausted', () => {
    const build = createBuild();
    for (const id of ['piercing', 'wingShots', 'precision', 'shatter', 'chain', 'prism'] as const) owned(build, id, 2);
    pending(build); expect(offerModules(build, 10, 2).sort()).toEqual(['reward:bomb', 'reward:heal', 'reward:xp']);
    const modules = structuredClone(build.modules);
    expect(chooseModule(build, 'reward:heal')).toBe(true); expect(build.modules).toEqual(modules);
    pending(build); expect(offerModules(build, 10, 2).sort()).toEqual(['reward:bomb', 'reward:heal', 'reward:xp']);
    expect(choiceView(build, 'reward:xp').kind).toBe('resource');
  });

  it('does not offer or commit consumed revival upgrades', () => {
    const build = createBuild(); owned(build, 'revive'); pending(build);
    expect(offerModules(build, 10, 2, { reviveConsumed: true })).not.toContain('revive');
    build.choices = ['revive'];
    expect(chooseModule(build, 'revive', { reviveConsumed: true })).toBe(false);
    expect(moduleRank(build, 'revive')).toBe(1); expect(build.pendingRewards).toHaveLength(1);
  });
});

describe('two in-place evolution slots', () => {
  it('requires the complete II + I recipe and a boss reward', () => {
    for (const evolution of Object.values(EVOLUTIONS)) {
      const build = createBuild(); owned(build, evolution.primary); owned(build, evolution.partner);
      expect(eligibleEvolutions(build)).not.toContain(evolution.id);
      build.ranks[evolution.primary] = 2; expect(eligibleEvolutions(build)).toContain(evolution.id);
      pending(build); expect(offerModules(build, 10, 3)).not.toContain(`evolution:${evolution.id}`);
      chooseModule(build, build.choices[0]); pending(build, 'boss');
      expect(offerModules(build, 10, 3)).toContain(`evolution:${evolution.id}`);
      const before = [...build.modules]; expect(chooseModule(build, `evolution:${evolution.id}`)).toBe(true);
      expect(build.modules).toEqual(before); expect(hasEvolution(build, evolution.id)).toBe(true);
      expect(moduleRank(build, evolution.partner)).toBeGreaterThanOrEqual(1);
      const view = buildModuleViews(build).find(module => module.id === evolution.primary)!;
      expect(view.name).toBe(evolution.name); expect(view.evolution).toBe(evolution.id);
    }
  });

  it('never offers a third evolution or frees a slot after evolving', () => {
    const build = createBuild();
    for (const id of ['piercing', 'precision', 'wingShots', 'rearSpark', 'chain', 'slow'] as const) owned(build, id, 2);
    for (const evolution of ['needleArray', 'spiralBloom'] as const) {
      pending(build, 'boss'); offerModules(build, 10, 6); build.choices = [`evolution:${evolution}`];
      expect(chooseModule(build, `evolution:${evolution}`)).toBe(true);
    }
    expect(build.modules).toHaveLength(6); expect(eligibleEvolutions(build)).toEqual([]);
    pending(build, 'boss'); expect(offerModules(build, 10, 3).every(id => !id.startsWith('evolution:'))).toBe(true);
    build.choices = ['evolution:forkNetwork']; expect(chooseModule(build, 'evolution:forkNetwork')).toBe(false);
  });
});

describe('ranked numbers and capped resonance', () => {
  it('exposes rank-specific values and descriptions without mutating the build', () => {
    const build = createBuild(); expect(rankValue(build, 'prism', MODULE_VALUES.prism.sideDamage)).toBe(0);
    expect(choiceView(build, 'prism').rank).toBe(1); owned(build, 'prism');
    expect(rankValue(build, 'prism', MODULE_VALUES.prism.sideDamage)).toBe(12);
    expect(choiceView(build, 'prism').rank).toBe(2); expect(choiceView(build, 'prism').description).toContain('18');
    build.ranks.prism = 2; expect(rankValue(build, 'prism', MODULE_VALUES.prism.sideDamage)).toBe(18);
  });

  it('grants one resonance per 600 surplus XP and caps the bonus at four ranks', () => {
    const build = createBuild();
    expect(addResonanceXp(build, 599)).toBe(0); expect(addResonanceXp(build, 21)).toBe(1); expect(build.resonanceXp).toBe(20);
    expect(addResonanceXp(build, 1200)).toBe(2); expect(build.resonanceXp).toBe(20);
    expect(addResonanceXp(build, 10000)).toBe(1); expect(build.resonance).toBe(4); expect(build.resonanceXp).toBe(0);
    expect(addResonanceXp(build, 600)).toBe(0);
  });

  it('ignores invalid or pre-Lv10 resonance and adds precision I / II only to main shots', () => {
    const build = createBuild(); expect(addResonanceXp(build, 1000, 9)).toBe(0);
    for (const amount of [0, -1, Infinity, NaN]) expect(addResonanceXp(build, amount)).toBe(0);
    expect(buildDamageMultiplier(build, true)).toBe(1); owned(build, 'precision');
    expect(buildDamageMultiplier(build, true)).toBe(1.2); addResonanceXp(build, 2400);
    expect(buildDamageMultiplier(build)).toBe(1.2); expect(buildDamageMultiplier(build, true)).toBe(1.4);
    build.ranks.precision = 2; expect(buildDamageMultiplier(build, true)).toBe(1.5);
    build.resonance = 999; expect(buildDamageMultiplier(build, true)).toBe(1.5);
  });
});
