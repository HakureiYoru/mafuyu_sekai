import { afterEach, describe, expect, it, vi } from 'vitest';
import { BALANCE } from './config';
import { SeededRandom } from './math';
import { GameSimulation } from './simulation';
import type { EnemyType } from './types';

function defeat(sim: GameSimulation, type: EnemyType = 'basic') {
  const enemy = sim.spawnEnemy(type, 1000, 1000)!;
  expect(enemy).not.toBeNull();
  sim.damageEnemy(enemy, 1e9, { x: 1000, y: 1000, kind: 'contact' });
}

function defeats(sim: GameSimulation, count: number, type: EnemyType = 'basic') {
  for (let i = 0; i < count; i++) defeat(sim, type);
}

function blackHoles(sim: GameSimulation) {
  return sim.state.pickups.filter(item => item.type === 'blackHole').reduce((sum, item) => sum + item.value, 0);
}

afterEach(() => vi.restoreAllMocks());

describe('black-hole drops throughout a run', () => {
  it.each(['late story', 'endless'] as const)('ends repeated unlucky streaks in %s', mode => {
    vi.spyOn(SeededRandom.prototype, 'next').mockReturnValue(0.99);
    const sim = new GameSimulation();
    if (mode === 'endless') sim.reset('endless');
    sim.state.elapsed = 1800;
    sim.state.wave = mode === 'endless' ? 100 : 5;
    sim.state.campaign.progression = 350;

    for (let drops = 0; drops < 3; drops++) {
      defeats(sim, BALANCE.drops.blackHolePity - 1, 'sampler');
      expect(blackHoles(sim)).toBe(drops);
      defeat(sim, 'sampler');
      expect(blackHoles(sim)).toBe(drops + 1);
    }
  });

  it('allows a normal random drop in a late boss encounter and restarts its drought allowance', () => {
    const random = vi.spyOn(SeededRandom.prototype, 'next').mockReturnValue(0.99);
    const sim = new GameSimulation();
    sim.state.wave = 5; sim.state.campaign.progression = 360; sim.state.elapsed = 1200;
    sim.spawnEnemy('boss', 2000, 1780, 's2:final');
    defeats(sim, BALANCE.drops.blackHolePity - 2, 'weaver');
    const reinforcement = sim.spawnEnemy('repairer', 1000, 1000)!;
    random.mockReturnValue(0.005);
    sim.damageEnemy(reinforcement, 1e9);
    expect(blackHoles(sim)).toBe(1);

    random.mockReturnValue(0.99);
    defeats(sim, BALANCE.drops.blackHolePity - 1, 'weaver');
    expect(blackHoles(sim)).toBe(1);
    defeat(sim, 'weaver');
    expect(blackHoles(sim)).toBe(2);
  });

  it('preserves an outstanding drought across a boss reward and stage transition', () => {
    vi.spyOn(SeededRandom.prototype, 'next').mockReturnValue(0.99);
    const sim = new GameSimulation();
    defeats(sim, BALANCE.drops.blackHolePity - 1);
    defeat(sim, 'miniboss');
    while (sim.state.status === 'upgrade') {
      expect(sim.chooseUpgrade(sim.state.build.choices[0], sim.state.build.offerId ?? undefined)).toBe(true);
    }
    expect(sim.state.wave).toBe(2);
    expect(blackHoles(sim)).toBe(0);
    defeat(sim, 'returner');
    expect(blackHoles(sim)).toBe(1);
  });

  it('does not count destructible hazards or boss parts toward a mob drop', () => {
    vi.spyOn(SeededRandom.prototype, 'next').mockReturnValue(0.99);
    const sim = new GameSimulation();
    defeats(sim, BALANCE.drops.blackHolePity - 1);
    defeat(sim, 'mine'); defeat(sim, 'arm'); defeat(sim, 'core');
    expect(blackHoles(sim)).toBe(0);
    defeat(sim);
    expect(blackHoles(sim)).toBe(1);
  });

  it('starts a fresh drought allowance when restarting a run', () => {
    vi.spyOn(SeededRandom.prototype, 'next').mockReturnValue(0.99);
    const sim = new GameSimulation();
    defeats(sim, BALANCE.drops.blackHolePity - 1);
    sim.reset();
    defeats(sim, BALANCE.drops.blackHolePity - 1);
    expect(blackHoles(sim)).toBe(0);
    defeat(sim);
    expect(blackHoles(sim)).toBe(1);
  });
});
