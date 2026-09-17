import { describe, expect, it } from 'vitest';
import { BALANCE, STEP } from './config';
import { GameSimulation } from './simulation';
import type { CombatEvent, Difficulty, InputAction } from './types';

const difficulties = ['normal', 'hard'] as const;
const input: InputAction = { moveX: 0, moveY: 0, aimX: 3500, aimY: 2000, shoot: false, bomb: false, dash: false };
// These fixtures isolate the main-boss gate after its light elite has already been defeated.
function quiet(difficulty: Difficulty) {
  const sim = new GameSimulation(3401, difficulty); sim.state.spawnTimer = 1e9; sim.state.player.invincible = 1e9;
  sim.state.campaign.spawnedElites.push('elite:1:0'); sim.state.campaign.defeatedElites.push('elite:1:0'); return sim;
}
function ticks(sim: GameSimulation, count: number) { const events: CombatEvent[] = []; for (let i = 0; i < count; i++) events.push(...sim.step(input)); return events; }
function drainUpgrades(sim: GameSimulation): void { while (sim.state.status === 'upgrade') sim.chooseUpgrade(sim.state.build.choices[0]); }
function holding(difficulty: Difficulty) {
  const sim = quiet(difficulty); sim.state.waveTime = 90 - STEP;
  sim.step(input); ticks(sim, 96);
  const mini = sim.state.enemies.find(enemy => enemy.type === 'miniboss')!;
  expect(mini).toBeDefined(); mini.state = 'recover'; mini.timer = 1e9;
  sim.state.spawnTimer = 1e9; expect(sim.isWaveBlocked()).toBe(true); return { sim, mini };
}
function limit(difficulty: Difficulty) { return difficulty === 'hard' ? 16 : 12; }
function interval(difficulty: Difficulty) { return difficulty === 'hard' ? 2.4 : 3; }
function activeAdds(sim: GameSimulation) { return sim.state.enemies.filter(e => e.hp > 0 && e.role !== 'miniboss' && e.role !== 'part').length + sim.state.indicators.filter(i => !i.encounterId).length; }
function fillAdds(sim: GameSimulation, count: number) { for (let i = 0; i < count; i++) expect(sim.spawnEnemy('basic', 150 + i % 18 * 95, 150 + Math.floor(i / 18) * 95)).not.toBeNull(); }

describe('continuous encounter progression gates', () => {
  it.each(difficulties)('%s holds progression at 90 while real combat and cooling continue', difficulty => {
    const { sim, mini } = holding(difficulty);
    const sniper = sim.spawnEnemy('sniper', 2500, 1800)!; sniper.cooldown = 0;
    const basic = sim.spawnEnemy('basic', 2350, 2300)!;
    const elapsed = sim.state.elapsed, x = basic.x, y = basic.y;
    sim.state.player.heat = 80; sim.state.player.dashCooldown = 2;
    const events = ticks(sim, 150);
    expect(sim.state).toMatchObject({ wave: 1, waveTime: 90, status: 'playing', minibossDefeated: false });
    expect(sim.state.campaign.progression).toBe(90); expect(sim.state.elapsed - elapsed).toBeCloseTo(2.5, 8);
    expect(sim.state.player.heat).toBe(0); expect(sim.state.player.dashCooldown).toBe(0); expect(mini.timer).toBeLessThan(1e9);
    expect(Math.hypot(basic.x - x, basic.y - y)).toBeGreaterThan(0); expect(events.some(e => e.type === 'enemyShot')).toBe(true);
  });
  it.each(difficulties)('%s clears the first Boss once, rewards it once, and queues its level and Boss offers', difficulty => {
    const { sim, mini } = holding(difficulty), p = sim.state.player;
    p.hp = 2; p.bombs = 1; p.heat = 80; p.dashCooldown = 2;
    const other = sim.spawnEnemy('basic', 1800, 1700)!;
    const kills = sim.state.kills;
    sim.damageEnemy(mini, mini.hp);
    expect(sim.state.status).toBe('upgrade'); expect(sim.state.wave).toBe(2); expect(sim.state.waveTime).toBe(0);
    expect(p).toMatchObject({ hp: 4, bombs: 2, heat: 0, dashCooldown: 0, level: 2, xp: 20 });
    expect(sim.state.companions).toHaveLength(2); expect(sim.state.enemies).not.toContain(other); expect(sim.state.kills).toBe(kills + 1);
    expect(sim.state.build.pendingRewards.map(reward => reward.source)).toEqual(['level', 'boss']);
    const before = structuredClone(sim.state); sim.damageEnemy(mini, 1e9); ticks(sim, 600); expect(sim.state).toEqual(before);
  });
  it('does not grant an encounter reward for an unregistered enemy with the same type', () => {
    const sim = quiet('normal'); sim.state.wave = 2; sim.state.campaign.stage = 2;
    const mini = sim.spawnEnemy('miniboss', 1300, 2000)!;
    sim.damageEnemy(mini, mini.hp);
    expect(sim.state.campaign.defeatedEncounters).toEqual([]); expect(sim.state.build.pendingRewards).toEqual([]);
    expect(sim.state.player.xp).toBe(0);
  });
  it.each(['pending', 'alive', 'defeated'] as const)('restarting clears %s gate state and all build rewards', state => {
    const sim = quiet('hard'); sim.state.waveTime = 90 - STEP; sim.step(input);
    if (state !== 'pending') { ticks(sim, 96); const mini = sim.state.enemies.find(e => e.type === 'miniboss')!; if (state === 'defeated') sim.damageEnemy(mini, mini.hp); }
    sim.reset();
    expect(sim.state).toMatchObject({ difficulty: 'hard', wave: 1, waveTime: 0, minibossSpawned: false, minibossDefeated: false });
    expect(sim.state.campaign.progression).toBe(0); expect(sim.state.build.pendingRewards).toEqual([]);
    expect(sim.state.indicators).toHaveLength(0); expect(sim.state.enemies).toHaveLength(0); expect(sim.isWaveBlocked()).toBe(false);
  });
  it.each(difficulties)('%s also holds endless progression during its scheduled ECHO encounter', difficulty => {
    const sim = quiet(difficulty); sim.reset('endless'); sim.state.spawnTimer = 1e9; sim.state.player.invincible = 1e9;
    sim.state.wave = 10; sim.state.waveTime = 18 - STEP; sim.step(input); ticks(sim, 78);
    const elite = sim.state.enemies.find(e => e.role === 'elite')!; expect(elite).toBeDefined(); sim.damageEnemy(elite, elite.hp);
    drainUpgrades(sim);
    sim.state.wave = 10; sim.state.waveTime = BALANCE.spawn.waveDuration - STEP; sim.step(input); ticks(sim, 96);
    const mini = sim.state.enemies.find(e => e.type === 'miniboss')!; expect(mini).toBeDefined();
    const before = sim.state.waveTime; ticks(sim, 120); expect(sim.state.wave).toBe(10); expect(sim.state.waveTime).toBe(before);
    sim.damageEnemy(mini, mini.hp); expect(sim.state.wave).toBe(11); expect(sim.state.status).toBe('upgrade');
    expect(sim.state.build.pendingRewards.some(reward => reward.source === 'boss')).toBe(true);
    drainUpgrades(sim);
    expect(sim.state.status).toBe('playing');
  });
});

describe('bounded reinforcements while a Boss holds progression', () => {
  it.each(difficulties)('%s counts pending births and never accumulates catch-up debt', difficulty => {
    const { sim } = holding(difficulty); fillAdds(sim, limit(difficulty) - 2 - activeAdds(sim));
    sim.step(input); sim.state.spawnTimer = 0; const spawnTimes: number[] = [], initialKills = sim.state.kills;
    for (let i = 0; i < 600; i++) {
      const events = sim.step(input);
      if (events.some(e => e.type === 'spawn' && e.enemyType !== 'miniboss')) spawnTimes.push(sim.state.elapsed);
      expect(activeAdds(sim)).toBeLessThanOrEqual(limit(difficulty)); expect(sim.state.spawnTimer).toBeGreaterThanOrEqual(-STEP);
    }
    expect(spawnTimes).toHaveLength(2); expect(spawnTimes[1] - spawnTimes[0]).toBeGreaterThanOrEqual(interval(difficulty) - STEP - 1e-8);
    expect(activeAdds(sim) + sim.state.kills - initialKills).toBe(limit(difficulty)); expect(sim.state.spawnTimer).toBeGreaterThan(0);
  });
  it.each(difficulties)('%s includes queued ordinary births when a minelayer tries to add a mine', difficulty => {
    const { sim } = holding(difficulty), layer = sim.spawnEnemy('minelayer', 2000, 2300)!;
    fillAdds(sim, limit(difficulty) - 1 - activeAdds(sim));
    sim.state.indicators.push({ id: 999001, type: 'basic', x: 2500, y: 2500, time: 5, duration: 5 });
    expect(activeAdds(sim)).toBe(limit(difficulty)); layer.state = 'charge'; layer.timer = STEP; layer.angle = 0;
    sim.step(input); expect(activeAdds(sim)).toBeLessThanOrEqual(limit(difficulty)); expect(sim.state.enemies.some(e => e.type === 'mine')).toBe(false);
  });
  it('trims existing excess mobs at encounter admission without granting kill or XP rewards', () => {
    const sim = quiet('normal'); fillAdds(sim, 80); sim.state.waveTime = 90 - STEP;
    sim.step(input);
    expect(activeAdds(sim)).toBeLessThanOrEqual(12); expect(sim.state.kills).toBe(0); expect(sim.state.player.xp).toBe(0);
    expect(sim.state.pickups.some(pickup => pickup.type === 'xp')).toBe(false);
  });
});
