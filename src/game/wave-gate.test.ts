import { describe, expect, it } from 'vitest';
import { BALANCE, MINIBOSS_ENCOUNTER, STEP } from './config';
import { GameSimulation } from './simulation';
import type { CombatEvent, Difficulty, InputAction } from './types';

const difficulties = ['normal', 'hard'] as const;
const input: InputAction = { moveX: 0, moveY: 0, aimX: 3500, aimY: 2000, shoot: false, bomb: false, dash: false };

function quiet(difficulty: Difficulty) {
  const sim = new GameSimulation(3401, difficulty);
  sim.state.spawnTimer = 1e9; sim.state.player.invincible = 1e9;
  return sim;
}

function ticks(sim: GameSimulation, count: number) {
  const events: CombatEvent[] = [];
  for (let i = 0; i < count; i++) events.push(...sim.step(input));
  return events;
}

function holding(difficulty: Difficulty) {
  const sim = quiet(difficulty);
  sim.state.wave = 3; sim.state.waveTime = 40 - STEP;
  const mini = sim.spawnEnemy('miniboss', 1300, 2000)!;
  // Isolate the wave gate from a separate full Boss-pattern endurance test.
  mini.state = 'recover'; mini.timer = 1e9;
  sim.step(input);
  expect(sim.isWaveBlocked()).toBe(true);
  return { sim, mini };
}

function limit(difficulty: Difficulty) {
  return difficulty === 'hard' ? MINIBOSS_ENCOUNTER.hardHoldAdds : MINIBOSS_ENCOUNTER.holdAdds;
}

function interval(difficulty: Difficulty) {
  return difficulty === 'hard' ? MINIBOSS_ENCOUNTER.hardHoldSpawnInterval : MINIBOSS_ENCOUNTER.holdSpawnInterval;
}

function activeAdds(sim: GameSimulation) {
  return sim.state.enemies.filter(e => e.hp > 0 && e.type !== 'miniboss').length
    + sim.state.indicators.filter(i => i.type !== 'miniboss').length;
}

function fillAdds(sim: GameSimulation, count: number) {
  for (let i = 0; i < count; i++) expect(sim.spawnEnemy('basic', 150 + (i % 18) * 95, 150 + Math.floor(i / 18) * 95)).not.toBeNull();
}

describe('third-wave defeat gate', () => {
  it.each(difficulties)('%s holds the wave clock at 40 while combat, elapsed time and resource recovery continue', difficulty => {
    const { sim, mini } = holding(difficulty);
    const sniper = sim.spawnEnemy('sniper', 2500, 1800)!; sniper.cooldown = 0;
    const basic = sim.spawnEnemy('basic', 2350, 2300)!;
    const elapsed = sim.state.elapsed, x = basic.x, y = basic.y;
    sim.state.player.ammo = 20; sim.state.player.heat = 80; sim.state.player.dashCooldown = 2;
    const events = ticks(sim, 150);
    expect(sim.state).toMatchObject({ wave: 3, waveTime: 40, status: 'playing', minibossDefeated: false });
    expect(sim.state.elapsed - elapsed).toBeCloseTo(2.5, 8);
    expect(sim.state.player.ammo).toBeGreaterThan(20); expect(sim.state.player.heat).toBe(0);
    expect(sim.state.player.dashCooldown).toBe(0); expect(mini.timer).toBeLessThan(1e9);
    expect(Math.hypot(basic.x - x, basic.y - y)).toBeGreaterThan(0);
    expect(events.some(e => e.type === 'enemyShot')).toBe(true);
    expect(events.some(e => e.type === 'wave' || e.type === 'support')).toBe(false);
    expect(sim.state.player.xp).toBe(0);
  });

  it.each(difficulties)('%s releases a late kill once, awarding one clear-XP payment and one wave-four support supply', difficulty => {
    const { sim, mini } = holding(difficulty);
    ticks(sim, 120); expect(sim.state.player.xp).toBe(0);
    sim.damageEnemy(mini, mini.hp);
    expect(sim.state.minibossDefeated).toBe(true); expect(sim.state.status).toBe('playing');
    const events = sim.step(input);
    expect(sim.state).toMatchObject({ wave: 4, waveTime: 0, minibossDefeated: true });
    expect(sim.isWaveBlocked()).toBe(false);
    expect(sim.state.player.xp).toBe(80);
    expect(events.filter(e => e.type === 'wave' && e.amount === 4)).toHaveLength(1);
    expect(events.filter(e => e.type === 'support' && e.text === 'arrival')).toHaveLength(1);
    const later = ticks(sim, 120);
    expect(later.some(e => e.type === 'wave' || e.type === 'support' && e.text === 'arrival')).toBe(false);
    expect(sim.state.player.xp).toBe(80);
  });

  it.each(difficulties)('%s still waits for the timer when ECHO is defeated early', difficulty => {
    const sim = quiet(difficulty); sim.state.wave = 3; sim.state.waveTime = 12;
    const mini = sim.spawnEnemy('miniboss', 1300, 2000)!;
    sim.damageEnemy(mini, mini.hp);
    sim.step(input);
    expect(sim.state.wave).toBe(3); expect(sim.state.waveTime).toBeCloseTo(12 + STEP, 8);
    expect(sim.isWaveBlocked()).toBe(false); expect(sim.state.player.xp).toBe(0);
    sim.state.waveTime = 40 - 2 * STEP;
    sim.step(input); expect(sim.state.wave).toBe(3);
    const events = sim.step(input);
    expect(sim.state.wave).toBe(4); expect(sim.state.player.xp).toBe(80);
    expect(events.filter(e => e.type === 'wave' && e.amount === 4)).toHaveLength(1);
  });

  it.each(difficulties)('%s keeps a full-cap pending ECHO appointment alive and does not mistake it for a victory', difficulty => {
    const sim = quiet(difficulty); sim.state.wave = 3; sim.state.waveTime = 40 - STEP;
    fillAdds(sim, BALANCE.limits.enemies);
    ticks(sim, Math.ceil(MINIBOSS_ENCOUNTER.warning / STEP) + 35);
    expect(sim.state).toMatchObject({ wave: 3, waveTime: 40, minibossSpawned: true, minibossDefeated: false });
    expect(sim.isWaveBlocked()).toBe(true); expect(sim.state.player.xp).toBe(0);
    expect(sim.state.enemies.some(e => e.type === 'miniboss')).toBe(false);
    expect(sim.state.indicators.filter(i => i.type === 'miniboss')).toHaveLength(1);
    sim.damageEnemy(sim.state.enemies[0], 99999);
    ticks(sim, 35);
    const mini = sim.state.enemies.find(e => e.type === 'miniboss')!;
    expect(mini).toBeDefined(); expect(sim.isWaveBlocked()).toBe(true);
    expect(sim.state.indicators.filter(i => i.type === 'miniboss')).toHaveLength(0);
    sim.damageEnemy(mini, mini.hp); sim.step(input);
    expect(sim.state.wave).toBe(4); expect(sim.state.minibossDefeated).toBe(true);
  });

  it.each(['pending', 'alive', 'defeated'] as const)('restarting clears %s encounter state and its gate', state => {
    const sim = quiet('hard'); sim.state.wave = 3; sim.state.waveTime = 40 - STEP;
    if (state !== 'pending') {
      const mini = sim.spawnEnemy('miniboss', 1300, 2000)!;
      if (state === 'defeated') sim.damageEnemy(mini, mini.hp);
    }
    sim.step(input); sim.reset();
    expect(sim.state).toMatchObject({ difficulty: 'hard', wave: 1, waveTime: 0, minibossSpawned: false, minibossDefeated: false });
    expect(sim.state.indicators).toHaveLength(0); expect(sim.state.enemies).toHaveLength(0);
    expect(sim.isWaveBlocked()).toBe(false);
  });

  it.each(difficulties)('%s endless ignores the story gate even with a living ECHO', difficulty => {
    const sim = quiet(difficulty); sim.reset('endless'); sim.state.spawnTimer = 1e9; sim.state.player.invincible = 1e9;
    sim.state.wave = 3; sim.state.waveTime = 40 - STEP;
    const mini = sim.spawnEnemy('miniboss', 1300, 2000)!;
    sim.step(input);
    expect(sim.state.wave).toBe(4); expect(sim.state.enemies).toContain(mini);
    expect(sim.isWaveBlocked()).toBe(false); expect(sim.state.player.xp).toBe(0);
  });
});

describe('bounded pressure while the wave is held', () => {
  it.each(difficulties)('%s counts queued births against its hold threshold and never accumulates catch-up spawns', difficulty => {
    const { sim, mini } = holding(difficulty);
    fillAdds(sim, limit(difficulty) - 2);
    // Deliver setup's explicit spawn events before measuring scheduled reinforcements.
    sim.step(input); sim.state.spawnTimer = 0;
    const spawnTimes: number[] = [];
    for (let i = 0; i < 600; i++) {
      const events = sim.step(input);
      if (events.some(e => e.type === 'spawn' && e.enemyType !== 'miniboss')) spawnTimes.push(sim.state.elapsed);
      expect(activeAdds(sim)).toBeLessThanOrEqual(limit(difficulty));
      expect(sim.state.spawnTimer).toBeGreaterThanOrEqual(-STEP);
    }
    expect(spawnTimes).toHaveLength(2);
    expect(spawnTimes[1] - spawnTimes[0]).toBeGreaterThanOrEqual(interval(difficulty) - STEP - 1e-8);
    expect(activeAdds(sim)).toBe(limit(difficulty));
    expect(sim.state.spawnTimer).toBeGreaterThan(0);
    sim.damageEnemy(mini, mini.hp);
    const events = ticks(sim, 60);
    expect(sim.state.wave).toBe(4);
    expect(events.filter(e => e.type === 'spawn').length).toBeLessThanOrEqual(3);
    expect(sim.state.spawnTimer).toBeGreaterThanOrEqual(-STEP);
  });

  it.each(difficulties)('%s includes ordinary birth reservations when deciding whether a minelayer may add another mine', difficulty => {
    const { sim } = holding(difficulty);
    const layer = sim.spawnEnemy('minelayer', 2000, 2300)!;
    fillAdds(sim, limit(difficulty) - 2);
    sim.state.indicators.push({ id: 999001, type: 'basic', x: 2500, y: 2500, time: 5, duration: 5 });
    expect(activeAdds(sim)).toBe(limit(difficulty));
    layer.state = 'charge'; layer.timer = STEP; layer.angle = 0;
    sim.step(input);
    expect(activeAdds(sim)).toBeLessThanOrEqual(limit(difficulty));
    expect(sim.state.enemies.some(e => e.type === 'mine')).toBe(false);
  });

  it('keeps pre-existing excess enemies intact while suppressing new births', () => {
    const { sim } = holding('normal'); fillAdds(sim, 36);
    sim.step(input);
    const ids = sim.state.enemies.map(e => e.id);
    sim.state.spawnTimer = 0;
    const events = ticks(sim, 180);
    expect(sim.state.enemies.map(e => e.id)).toEqual(ids);
    expect(events.some(e => e.type === 'spawn')).toBe(false);
    expect(sim.state.indicators).toHaveLength(0); expect(sim.isWaveBlocked()).toBe(true);
  });
});
