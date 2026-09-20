import { describe, expect, it } from 'vitest';
import { GameSimulation } from './simulation';
import { supportGrowth, wingGrowth, wingLanes, droneSpecialization } from './arsenal';
import { createBuild } from './upgrades';
import { FixedClock } from './clock';
import type { InputAction, ModuleId } from './types';
const idle: InputAction = { moveX: 0, moveY: 0, aimX: 2800, aimY: 2000, shoot: false, dash: false, bomb: false };
function scene(ids: ModuleId[], rank = 1, level = 10) {
  const sim = new GameSimulation(6300); sim.state.spawnTimer = 1e9; sim.state.player.level = level; sim.state.player.specialCooldown = 1e9; sim.state.player.invincible = 1e9;
  sim.state.build.modules = ids; sim.state.build.ranks = Object.fromEntries(ids.map(id => [id, rank])); sim.refreshBuild(); return sim;
}
describe('visible specialized weapons', () => {
  it('keeps growth and projectile counts finite at extreme ranks', () => {
    for (const rank of [1, 2, 3, 5, 20, 100, 10000]) {
      const sim = scene(['wingShots'], rank); sim.step({ ...idle, shoot: true });
      const wings = sim.state.bullets.filter(b => b.visualId === 'wing');
      expect(wings.length).toBe(wingLanes(rank) * 2); expect(wings.length).toBeLessThanOrEqual(6);
      expect(wings.every(b => Number.isFinite(b.damage) && b.attackSource === 'secondary')).toBe(true);
    }
    expect(supportGrowth(10)).toBeCloseTo(2.8); expect(wingGrowth(10)).toBe(3.25);
    const build = createBuild(); build.modules = ['droneHoming', 'droneBurst', 'division', 'intercept', 'orbitBlade', 'slow'];
    expect(droneSpecialization(build)).toBe(1.5);
  });
  it('makes level ten rank II wings contribute 19.5 total per volley without changing base main damage', () => {
    const sim = scene(['wingShots'], 2); sim.step({ ...idle, shoot: true });
    expect(sim.state.bullets.filter(b => b.visualId === 'wing').reduce((n, b) => n + b.damage, 0)).toBe(19.5);
    expect(sim.state.bullets.filter(b => b.kind === 'normal').reduce((n, b) => n + b.damage, 0)).toBe(10);
  });
  it('converges focused wings and snapshots their damage before a later upgrade', () => {
    const sim = scene(['wingShots', 'precision', 'piercing'], 2); sim.step({ ...idle, shoot: true, focus: true });
    const wings = sim.state.bullets.filter(b => b.visualId === 'wing');
    expect(wings).toHaveLength(2); expect(wings[0].vy * wings[1].vy).toBeLessThan(0); expect(wings.every(b => b.remainingHits === 2)).toBe(true);
    const damage = wings[0].damage; sim.state.build.ranks.wingShots = 100; sim.refreshBuild(); expect(wings[0].damage).toBe(damage);
  });
  it('requires the full focus hold, emits a bounded rail, and clears charging on restart', () => {
    const sim = scene(['piercing', 'precision']);
    for (let i = 0; i < 120; i++) sim.step({ ...idle, shoot: true, focus: true });
    expect(sim.state.bullets.some(b => b.visualId === 'railOverdrive' && b.attackSource === 'secondary' && b.remainingHits === 5)).toBe(true);
    sim.reset(); expect(sim.state.bullets).toHaveLength(0);
    for (let i = 0; i < 30; i++) sim.step({ ...idle, shoot: true });
    expect(sim.state.bullets.some(b => b.visualId === 'railOverdrive')).toBe(false);
  });
  it('matches weapon output under 30/60/120/144 Hz render clocks', () => {
    const run = (hz: number) => {
      const sim = scene(['wingShots', 'precision', 'piercing'], 5), clock = new FixedClock();
      for (let frame = 0; frame <= hz * 4; frame++) clock.advance(frame * 1000 / hz, () => { sim.step({ ...idle, shoot: true, focus: true }); });
      return sim.state.bullets.map(b => [b.visualId, b.x, b.y, b.damage]);
    };
    for (const hz of [30, 120, 144]) expect(run(hz)).toEqual(run(60));
  });
});
