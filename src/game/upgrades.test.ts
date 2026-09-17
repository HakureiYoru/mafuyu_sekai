import { describe, expect, it } from 'vitest';
import { addResonanceXp, BEHAVIOR_MODULES, buildDamageMultiplier, buildModuleViews, choiceView, chooseModule, createBuild, eligibleEvolutions, enqueueUpgrade, EVOLUTIONS, hasEvolution, moduleRank, MODULES, MODULE_VALUES, NEW_MODULE_IDS, newModuleStats, offerModules, rankValue, rerollModules, resolveBuildStats } from './upgrades';
import type { ModuleId, PlayerBuild, UpgradeChoiceId } from './types';

function owned(build: PlayerBuild, id: ModuleId, rank = 1): void {
  if (!build.modules.includes(id)) build.modules.push(id);
  build.ranks[id] = rank;
}
function pending(build: PlayerBuild, source: 'level' | 'boss' = 'level', id = `${source}:${(build.rewardWatermarks?.[source] ?? -1) + 1}`): void {
  expect(enqueueUpgrade(build, source, id)).toBe(true);
}
function isModule(id: UpgradeChoiceId): id is ModuleId { return id in MODULES; }

describe('continuous-campaign module rewards', () => {
  it('has 36 ranked modules and eighteen recipes with no inherited build strength', () => {
    expect(Object.keys(MODULES)).toHaveLength(36);
    for (const branch of ['main', 'drone', 'resource']) expect(Object.values(MODULES).filter(module => module.branch === branch)).toHaveLength(12);
    expect(Object.keys(EVOLUTIONS)).toHaveLength(18);
    const build = createBuild();
    expect(build.modules).toEqual([]); expect(build.ranks).toEqual({}); expect(build.evolutions).toEqual([]);
    expect(build.levelFloor).toBe(1); expect(build.rerollsRemaining).toBe(2);
    expect(offerModules(build, 10, 1)).toEqual([]);
  });

  it('keeps receiving unique rewards past the old thirteen-reward ceiling', () => {
    const build = createBuild();
    for (let level = 2; level <= 10; level++) pending(build, 'level', `level:${level}`);
    for (let boss = 0; boss < 4; boss++) pending(build, 'boss', `boss:${boss}`);
    expect(build.pendingRewards).toHaveLength(13);
    expect(enqueueUpgrade(build, 'level', 'level:11')).toBe(true);
    expect(enqueueUpgrade(build, 'boss', 'boss:4')).toBe(true);
    expect(enqueueUpgrade(build, 'boss', 'level:2')).toBe(false);
    for (let index = 0; index < 15; index++) {
      const offers = offerModules(build, 10, 22);
      expect(offers).toHaveLength(3); expect(new Set(offers).size).toBe(3);
      expect(chooseModule(build, offers[0], { offerId: build.offerId! })).toBe(true);
    }
    expect(build.pendingRewards).toEqual([]); expect(build.choiceIndex).toBe(15);
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

  it('offers owned growth and new modules even beyond six equipped modules', () => {
    for (let seed = 0; seed < 100; seed++) {
      const build = createBuild(); owned(build, 'piercing'); build.choiceIndex = 2; pending(build);
      const offered = offerModules(build, 5, seed);
      expect(offered).toContain('piercing'); expect(offered.some(id => isModule(id) && !build.modules.includes(id))).toBe(true);
    }
    const build = createBuild();
    for (const id of ['piercing', 'wingShots', 'precision', 'shatter', 'chain', 'prism'] as const) owned(build, id);
    pending(build); const offered = offerModules(build, 10, 2);
    expect(offered.some(id => isModule(id) && !build.modules.includes(id))).toBe(true);
    const id = offered.find(id => isModule(id) && !build.modules.includes(id)) as ModuleId; expect(chooseModule(build, id)).toBe(true);
    expect(moduleRank(build, id)).toBe(1); expect(build.modules).toHaveLength(7);
    pending(build); expect(offerModules(build, 10, 2)).toHaveLength(3);
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

  it('never exhausts upgrades even when all modules are already at very high rank', () => {
    const build = createBuild();
    for (const id of Object.keys(MODULES) as ModuleId[]) owned(build, id, 10000);
    pending(build); const offers = offerModules(build, 10, 2); expect(offers.every(isModule)).toBe(true);
    expect(new Set(offers).size).toBe(3); expect(chooseModule(build, offers[0])).toBe(true);
    expect(moduleRank(build, offers[0] as ModuleId)).toBe(10001); expect(build.modules).toHaveLength(36);
    expect(choiceView(build, 'reward:xp').kind).toBe('resource');
  });

  it('allows passive revival growth after the single revival was consumed', () => {
    const build = createBuild(); owned(build, 'revive', 2); pending(build);
    build.choices = ['revive'];
    expect(chooseModule(build, 'revive', { reviveConsumed: true })).toBe(true);
    expect(moduleRank(build, 'revive')).toBe(3); expect(build.pendingRewards).toHaveLength(0);
  });
});

describe('in-place evolutions without a global ceiling', () => {
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

  it('offers a third evolution without removing its primary or partner', () => {
    const build = createBuild();
    for (const id of ['piercing', 'precision', 'wingShots', 'rearSpark', 'chain', 'slow'] as const) owned(build, id, 2);
    for (const evolution of ['needleArray', 'spiralBloom'] as const) {
      pending(build, 'boss'); offerModules(build, 10, 6); build.choices = [`evolution:${evolution}`];
      expect(chooseModule(build, `evolution:${evolution}`)).toBe(true);
    }
    expect(build.modules).toHaveLength(6); expect(eligibleEvolutions(build)).toContain('forkNetwork');
    pending(build, 'boss'); expect(offerModules(build, 10, 3)).toContain('evolution:forkNetwork');
    expect(chooseModule(build, 'evolution:forkNetwork')).toBe(true); expect(build.evolutions).toHaveLength(3);
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

  it('grants one choice per 600 XP forever while capping only the old damage bonus', () => {
    const build = createBuild();
    expect(addResonanceXp(build, 599)).toBe(0); expect(addResonanceXp(build, 21)).toBe(1); expect(build.resonanceXp).toBe(20);
    expect(addResonanceXp(build, 1200)).toBe(2); expect(build.resonanceXp).toBe(20);
    expect(addResonanceXp(build, 10000)).toBe(16); expect(build.resonance).toBe(19); expect(build.resonanceXp).toBe(420);
    expect(addResonanceXp(build, 600)).toBe(1); expect(buildDamageMultiplier(build)).toBe(1.2);
    expect(build.pendingRewards).toHaveLength(1); expect(build.pendingRewards[0].count).toBe(20);
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

describe('bounded identity and finite infinite-rank growth', () => {
  it('keeps bounded history and rejects ancient replay after thousands of rewards', () => {
    const build = createBuild();
    for (let sequence = 1; sequence <= 2000; sequence++) {
      expect(enqueueUpgrade(build, 'elite', `elite:${sequence}`, sequence)).toBe(true);
      build.choices = ['pulseChamber']; expect(chooseModule(build, 'pulseChamber')).toBe(true);
    }
    expect(build.rewardHistory.length).toBeLessThanOrEqual(32); expect(build.pendingRewards).toEqual([]);
    expect(enqueueUpgrade(build, 'elite', 'elite:1', 1)).toBe(false);
    expect(moduleRank(build, 'pulseChamber')).toBe(2000);
  });
  it('compresses enormous XP rewards without losing identity on partial consumption', () => {
    const build = createBuild(); expect(addResonanceXp(build, 600 * 10000 + 23)).toBe(10000);
    expect(build.pendingRewards).toHaveLength(1); expect(build.pendingRewards[0].count).toBe(10000); expect(build.resonanceXp).toBe(23);
    const offers = offerModules(build, 10, 44), firstId = build.offerId!; chooseModule(build, offers[0], { offerId: firstId });
    offerModules(build, 10, 44); expect(build.pendingRewards[0].count).toBe(9999);
    expect(chooseModule(build, build.choices[0], { offerId: firstId })).toBe(false);
    addResonanceXp(build, 600); expect(build.pendingRewards).toHaveLength(1); expect(build.pendingRewards[0].count).toBe(10000);
  });
  it('allows continued growth after evolution and collects all eighteen recipes', () => {
    const build = createBuild(); for (const id of Object.keys(MODULES) as ModuleId[]) owned(build, id, 3);
    for (const evolution of Object.keys(EVOLUTIONS) as (keyof typeof EVOLUTIONS)[]) {
      pending(build, 'boss'); offerModules(build, 10, 3); build.choices = [`evolution:${evolution}`]; expect(chooseModule(build, `evolution:${evolution}`)).toBe(true);
    }
    expect(build.evolutions).toHaveLength(18); expect(build.modules).toHaveLength(36);
    pending(build); build.choices = ['piercing']; expect(chooseModule(build, 'piercing')).toBe(true); expect(moduleRank(build, 'piercing')).toBe(4);
  });
  it('preserves every original layer-I and layer-II tuple', () => {
    for (const id of Object.keys(MODULE_VALUES) as (keyof typeof MODULE_VALUES)[]) {
      const build = createBuild(); owned(build, id);
      for (const value of Object.values(MODULE_VALUES[id])) if (Array.isArray(value)) {
        expect(rankValue(build, id, value as unknown as readonly [number, number])).toBe(value[0]);
        build.ranks[id] = 2; expect(rankValue(build, id, value as unknown as readonly [number, number])).toBe(value[1]); build.ranks[id] = 1;
      }
    }
  });
  it('keeps damage increasing, cooldown positive and entity counts fixed after V', () => {
    for (const id of NEW_MODULE_IDS) {
      const five = newModuleStats(id, 5); let lastDamage = 0;
      for (const rank of [1, 3, 5, 20, 100, 10000]) {
        const stats = newModuleStats(id, rank); for (const value of Object.values(stats)) expect(Number.isFinite(value)).toBe(true);
        expect(stats.cooldown).toBeGreaterThanOrEqual(five.cooldown * 0.65);
        if (stats.damage !== undefined) { expect(stats.damage).toBeGreaterThanOrEqual(lastDamage); lastDamage = stats.damage; }
        if (rank > 5) for (const key of ['count', 'capacity', 'targets']) if (five[key] !== undefined) expect(stats[key]).toBe(five[key]);
      }
    }
  });
  it('reuses immutable snapshots and scales scalar as well as tuple cooldowns', () => {
    const build = createBuild(); owned(build, 'vent', 2); const first = resolveBuildStats(build);
    expect(resolveBuildStats(build)).toBe(first); expect(first.values.vent?.cooldown).toBe(4);
    build.ranks.vent = 5; const next = resolveBuildStats(build); expect(next).not.toBe(first); expect(next.values.vent?.cooldown).toBeCloseTo(3.2);
    expect(first.values.vent?.cooldown).toBe(4); expect(Object.isFrozen(next.values.vent)).toBe(true);
    owned(build, 'doubleDash', 4); expect(choiceView(build, 'doubleDash').description).toContain('1.84'); expect(choiceView(build, 'doubleDash').description).not.toContain('2.3 秒');
  });
});
