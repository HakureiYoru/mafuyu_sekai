import { describe, expect, it } from 'vitest';
import { BALANCE, ENEMIES, MINIBOSS_ENCOUNTER, STEP, VIEW, WORLD } from './config';
import { FixedClock } from './clock';
import { GameSimulation } from './simulation';
import { enemyAttacks } from './enemy-ai';
import { difficultyConfig } from './difficulty';
import { threatProfile } from './threat-director';
import type { CombatEvent, Difficulty, Enemy, InputAction } from './types';

const difficulties = ['normal', 'hard'] as const;
const idle = (extra: Partial<InputAction> = {}): InputAction => ({ moveX: 0, moveY: 0, aimX: 3500, aimY: 2000, shoot: false, dash: false, bomb: false, ...extra });

function quiet(difficulty: Difficulty = 'normal', seed = 3301): GameSimulation {
  const sim = new GameSimulation(seed, difficulty);
  sim.state.spawnTimer = 1e9; sim.state.player.invincible = 1e9;
  // Main-boss fixtures use a completed light-elite gate; actual elite gates have separate integration tests.
  sim.state.campaign.spawnedElites.push('elite:1:0'); sim.state.campaign.defeatedElites.push('elite:1:0');
  return sim;
}

function ticks(sim: GameSimulation, count: number, input = idle()): CombatEvent[] {
  const events: CombatEvent[] = [];
  for (let i = 0; i < count; i++) events.push(...sim.step(input));
  return events;
}

function until(sim: GameSimulation, condition: () => boolean, limit = 300): CombatEvent[] {
  const events: CombatEvent[] = [];
  for (let i = 0; i < limit && !condition(); i++) events.push(...sim.step(idle()));
  expect(condition()).toBe(true);
  return events;
}

function firstShot(sim: GameSimulation, type: 'sniper' | 'sprayer' = 'sniper') {
  const shooter = sim.spawnEnemy(type, 2500, 2000)!;
  shooter.cooldown = 0;
  until(sim, () => sim.state.bullets.some(b => b.owner === 'enemy'));
  return { shooter, bullet: sim.state.bullets.find(b => b.owner === 'enemy')! };
}

function setPlayerPosition(sim: GameSimulation, x: number, y: number) {
  const p = sim.state.player, camera = sim.state.camera;
  p.x = p.prevX = x; p.y = p.prevY = y;
  camera.x = camera.prevX = Math.max(VIEW.width / 2, Math.min(WORLD.width - VIEW.width / 2, x));
  camera.y = camera.prevY = Math.max(VIEW.height / 2, Math.min(WORLD.height - VIEW.height / 2, y));
}

describe('difficulty through the simulation boundary', () => {
  it.each(difficulties)('%s applies ordinary HP and movement multipliers once and keeps mines at one HP', difficulty => {
    const factor = difficulty === 'hard' ? 1.3 : 1;
    const expectedHp = difficulty === 'hard'
      ? { basic: 9, dasher: 21, sniper: 27, sprayer: 48, minelayer: 36, mine: 1 }
      : { basic: 6, dasher: 14, sniper: 18, sprayer: 32, minelayer: 24, mine: 1 };
    for (const type of ['basic', 'dasher', 'sniper', 'sprayer', 'minelayer', 'mine'] as const) {
      const sim = quiet(difficulty), enemy = sim.spawnEnemy(type, 2400, 1700)!;
      expect(enemy.hp).toBe(expectedHp[type]); expect(enemy.maxHp).toBe(expectedHp[type]);
      expect(enemy.speed).toBeCloseTo(ENEMIES[type].speed * factor, 8);
    }
    const scaled = quiet(difficulty); scaled.state.campaign.progression = 240;
    expect(scaled.spawnEnemy('sniper', 2500, 2000)!.hp).toBe(difficulty === 'hard' ? 125 : 83);
    const moving = quiet(difficulty), base = moving.spawnEnemy('basic', 2500, 2000)!;
    ticks(moving, 90);
    expect(Math.hypot(base.vx, base.vy)).toBeCloseTo(115 * factor, 2);
    const player = quiet(difficulty); ticks(player, 60, idle({ moveX: 1 }));
    expect(player.state.player.x - 2000).toBeCloseTo(300, 8);
  });

  it.each(difficulties)('%s applies the separate Boss HP multiplier to both bosses', difficulty => {
    const boss = quiet(difficulty).spawnEnemy('boss', 1000, 1000)!;
    const mini = quiet(difficulty).spawnEnemy('miniboss', 2500, 2000)!;
    expect(boss.maxHp).toBe(difficulty === 'hard' ? 1620 : 1200);
    expect(mini.maxHp).toBe(difficulty === 'hard' ? 2160 : 1600);
    expect(mini.speed).toBeCloseTo(difficulty === 'hard' ? 312 : 240);
    expect(mini.radius).toBe(64);
  });

  it.each(difficulties)('%s scales bullets emitted by actual sniper and sprayer AI exactly once', difficulty => {
    for (const type of ['sniper', 'sprayer'] as const) {
      const sim = quiet(difficulty), { bullet } = firstShot(sim, type);
      const expected = (type === 'sniper' ? 600 : 270) * (difficulty === 'hard' ? 1.28 : 1);
      expect(bullet.speed).toBeCloseTo(expected, 8);
      expect(Math.hypot(bullet.vx, bullet.vy)).toBeCloseTo(expected, 8);
      expect(bullet.damage).toBe(difficulty === 'hard' ? 2 : 1);
    }
    const sim = quiet(difficulty); sim.state.player.invincible = 0;
    firstShot(sim);
    const damageEvents = until(sim, () => sim.state.player.hp < 5);
    expect(sim.state.player.hp).toBe(difficulty === 'hard' ? 3 : 4);
    expect(damageEvents.filter(e => e.type === 'damage').map(e => e.amount)).toEqual([difficulty === 'hard' ? 2 : 1]);
  });

  it.each(difficulties)('%s gives identical combat and miniboss results at 30/60/120/144 Hz rendering', difficulty => {
    function run(hz: number) {
      const sim = quiet(difficulty, 3391), clock = new FixedClock(), events: CombatEvent[] = [];
      sim.state.waveTime = 89; sim.state.spawnTimer = 0;
      const sniper = sim.spawnEnemy('sniper', 2490, 1780)!; sniper.cooldown = 0;
      for (let frame = 0; frame <= hz * 8; frame++) {
        clock.advance(frame * 1000 / hz, dt => {
          const tick = sim.state.tick;
          events.push(...sim.step(idle({ moveY: tick % 120 < 60 ? 1 : -1, shoot: tick % 90 < 45,
            dash: tick % 180 === 0, focus: tick % 120 < 30 }), dt));
        });
      }
      return { state: structuredClone(sim.state), events };
    }
    const expected = run(60);
    expect(expected.state.tick).toBe(480);
    expect(expected.events.filter(e => e.type === 'spawn' && e.enemyType === 'miniboss')).toHaveLength(1);
    expect(expected.events.some(e => e.type === 'enemyShot')).toBe(true);
    for (const hz of [30, 120, 144]) expect(run(hz)).toEqual(expected);
  });

  it('preserves a selected difficulty on reset and endless, but clears old difficulty entities on an explicit change', () => {
    const sim = quiet('hard'); const oldBullet = firstShot(sim).bullet;
    sim.state.waveTime = 90 - STEP;
    sim.step(idle()); expect(sim.state.indicators.some(i => i.type === 'miniboss')).toBe(true);
    sim.reset();
    expect(sim.state.difficulty).toBe('hard'); expect(sim.state.minibossSpawned).toBe(false);
    expect(sim.state.enemies).toHaveLength(0); expect(sim.state.bullets).toHaveLength(0); expect(sim.state.indicators).toHaveLength(0);
    expect(sim.spawnEnemy('basic', 2400, 2000)!.hp).toBe(9);
    const boss = sim.spawnEnemy('boss', 2000, 2000, 's2:final')!;
    for (let card = 0; card < 6; card++) {
      for (let tick = 0; tick < 50; tick++) sim.step(idle());
      expect(boss.spell?.cardIndex).toBe(card); sim.damageEnemy(boss, boss.hp);
    }
    sim.continueEndless();
    expect(sim.state).toMatchObject({ difficulty: 'hard', mode: 'endless', status: 'playing', wave: 6 });
    expect(sim.state.bullets).toHaveLength(0);
    sim.reset('story', 3301, 'normal'); sim.state.spawnTimer = 1e9; sim.state.player.invincible = 1e9;
    expect(sim.state.difficulty).toBe('normal'); expect(sim.state.minibossSpawned).toBe(false);
    const normal = firstShot(sim).bullet;
    expect(normal.damage).toBe(1); expect(normal.speed).toBe(600);
    expect(sim.state.bullets.every(b => b.damage === 1)).toBe(true);
    // Reuse is allowed; no pooled projectile is permitted to carry its old hard-mode damage.
    if (normal === oldBullet) expect(oldBullet.damage).toBe(1);
    sim.reset('endless'); expect(sim.state.difficulty).toBe('normal');
    sim.reset('story', 3301, 'hard'); expect(firstShot(sim).bullet.damage).toBe(2);
    expect(new GameSimulation().state.difficulty).toBe('normal');
  });
});

describe('continuous campaign miniboss integration', () => {
  it.each(difficulties)('%s queues ECHO once at 90 seconds and holds progression while limited adds continue', difficulty => {
    const sim = quiet(difficulty); sim.state.waveTime = 89; sim.state.spawnTimer = 0;
    const events = ticks(sim, 59);
    expect(sim.state.minibossSpawned).toBe(false);
    expect(sim.state.indicators.some(i => i.type === 'miniboss')).toBe(false);
    events.push(...sim.step(idle()));
    expect(sim.state.minibossSpawned).toBe(true);
    expect(sim.state.indicators.filter(i => i.type === 'miniboss')).toHaveLength(1);
    expect(sim.state.bossStage).toBe(false); expect(sim.state.bossPending).toBe(false);
    const started = sim.state.waveTime;
    events.push(...ticks(sim, 8 * 60));
    expect(sim.state.enemies.filter(e => e.type === 'miniboss')).toHaveLength(1);
    expect(sim.state.waveTime).toBe(started);
    expect(sim.state.campaign.progression).toBe(90);
    expect(events.filter(e => e.type === 'attack' && e.enemyType === 'miniboss' && e.text === 'arrival')).toHaveLength(1);
    expect(events.filter(e => e.type === 'spawn' && e.enemyType === 'miniboss')).toHaveLength(1);
    expect(events.filter(e => e.type === 'spawn' && e.enemyType !== 'miniboss').length).toBeGreaterThan(0);
    const mini = sim.state.enemies.find(e => e.type === 'miniboss')!;
    sim.step(idle()); expect(sim.state.wave).toBe(1); expect(sim.state.enemies).toContain(mini);
    expect(sim.isWaveBlocked()).toBe(true);
    sim.damageEnemy(mini, mini.hp); sim.step(idle()); expect(sim.state.wave).toBe(2);
    while (sim.state.status === 'upgrade') sim.chooseUpgrade(sim.state.build.choices[0]);
    expect(sim.state.bossStage).toBe(false);
    events.push(...ticks(sim, 60));
    expect(events.filter(e => e.type === 'attack' && e.enemyType === 'miniboss' && e.text === 'arrival')).toHaveLength(1);
  });

  it.each(difficulties)('%s settles the first boss without rewarding leftover enemies or completing the run', difficulty => {
    const sim = quiet(difficulty), { shooter, bullet } = firstShot(sim);
    const ordinary = sim.spawnEnemy('basic', 2500, 2400)!;
    const mini = sim.spawnEnemy('miniboss', 1300, 2000)!;
    sim.state.player.hp = 2; sim.state.player.bombs = 3; sim.state.player.heat = 90; sim.state.player.dashCooldown = 2;
    sim.damageEnemy(mini, mini.hp);
    expect(sim.state).toMatchObject({ status: 'upgrade', wave: 2, bossStage: false, bossPending: false, minibossSpawned: true });
    expect(sim.state.player).toMatchObject({ hp: 4, bombs: 4, heat: 0, dashCooldown: 0, level: 2, xp: 20 });
    expect(sim.state.companions).toHaveLength(1);
    expect(sim.state.enemies).not.toContain(ordinary); expect(sim.state.enemies).not.toContain(shooter);
    expect(sim.state.bullets).not.toContain(bullet);
    expect(sim.state.score).toBe(Math.round(mini.maxHp * 10 * difficultyConfig(difficulty).score));
    expect(sim.state.build.pendingRewards.map(reward => reward.source)).toEqual(['level', 'boss']);
    const before = structuredClone(sim.state.pickups);
    sim.damageEnemy(mini, 9999); expect(sim.state.pickups).toEqual(before); expect(sim.state.kills).toBe(1);
    const events = sim.step(idle());
    expect(events.some(e => e.type === 'complete' || e.type === 'boss')).toBe(false);
    expect(sim.state.enemies.some(e => e.id === mini.id)).toBe(false);
    expect(sim.state.enemies).toHaveLength(0); expect(sim.state.bullets).toHaveLength(0);
  });

  it.each(difficulties)('%s shares attack reservations with ordinary elites and reset releases those reservations', difficulty => {
    const sim = quiet(difficulty), mini = sim.spawnEnemy('miniboss', 1500, 2000)!;
    const blockers: Enemy[] = [];
    for (let i = 0; i < threatProfile(difficulty, sim.state.campaign.progression).slots; i++) {
      const e = sim.spawnEnemy('sniper', 2320 + i * 85, 1780)!;
      e.state = 'aim'; e.timer = 5; e.cooldown = 0;
      e.tactics = { shotsLeft: 0, shotTimer: 0, sweepStart: 0, sweepIndex: 0, locked: true };
      blockers.push(e);
    }
    sim.step(idle()); expect(mini.state).toBe('chase'); expect(mini.miniboss?.cycle).toBe(0);
    blockers[0].state = 'recover'; blockers[0].timer = 100;
    const events = sim.step(idle());
    expect(mini.state).toBe('charge'); expect(mini.miniboss?.cycle).toBe(1);
    expect(events.filter(e => e.type === 'attack' && e.enemyType === 'miniboss' && e.text === 'windup')).toHaveLength(1);
    sim.reset(); sim.state.spawnTimer = 1e9; sim.state.player.invincible = 1e9;
    expect(sim.state.difficulty).toBe(difficulty); expect(sim.state.minibossSpawned).toBe(false);
    const fresh = sim.spawnEnemy('miniboss', 1500, 2000)!;
    sim.step(idle()); expect(fresh.state).toBe('charge'); expect(fresh.miniboss?.cycle).toBe(1);
  });

  it('retains a full-cap miniboss appointment across retries and spawns it once a place opens', () => {
    const sim = quiet('hard'); sim.state.waveTime = 90 - STEP;
    const events = sim.step(idle());
    for (let i = 0; i < BALANCE.limits.enemies; i++) {
      expect(sim.spawnEnemy('basic', 150 + (i % 18) * 100, 150 + Math.floor(i / 18) * 100)).not.toBeNull();
    }
    events.push(...ticks(sim, Math.ceil(MINIBOSS_ENCOUNTER.warning / STEP) + 65));
    expect(sim.state.enemies).toHaveLength(BALANCE.limits.enemies);
    expect(sim.state.enemies.some(e => e.type === 'miniboss')).toBe(false);
    const appointment = sim.state.indicators.filter(i => i.type === 'miniboss');
    expect(appointment).toHaveLength(1); expect(appointment[0].time).toBeGreaterThan(0);
    expect(events.filter(e => e.type === 'attack' && e.enemyType === 'miniboss' && e.text === 'arrival')).toHaveLength(1);
    sim.damageEnemy(sim.state.enemies[0], 99999);
    events.push(...until(sim, () => sim.state.enemies.some(e => e.type === 'miniboss'), 35));
    expect(sim.state.enemies).toHaveLength(BALANCE.limits.enemies);
    expect(sim.state.enemies.filter(e => e.type === 'miniboss')).toHaveLength(1);
    expect(sim.state.indicators.filter(i => i.type === 'miniboss')).toHaveLength(0);
    expect(events.filter(e => e.type === 'spawn' && e.enemyType === 'miniboss')).toHaveLength(1);
    expect(sim.spawnEnemy('miniboss', 2500, 2000)).toBeNull();
  });

  it('clears an unspawned appointment on restart and does not schedule the encounter in endless', () => {
    const sim = quiet('hard'); sim.state.waveTime = 90 - STEP;
    sim.step(idle()); expect(sim.state.indicators.some(i => i.type === 'miniboss')).toBe(true);
    sim.reset(); sim.state.spawnTimer = 1e9; sim.state.player.invincible = 1e9;
    ticks(sim, 120);
    expect(sim.state.minibossSpawned).toBe(false);
    expect(sim.state.indicators).toHaveLength(0); expect(sim.state.enemies).toHaveLength(0);
    sim.reset('endless'); sim.state.spawnTimer = 1e9; sim.state.player.invincible = 1e9;
    sim.state.wave = 3; sim.state.waveTime = 8;
    ticks(sim, 120);
    expect(sim.state.minibossSpawned).toBe(false);
    expect(sim.state.enemies.some(e => e.type === 'miniboss')).toBe(false);
    expect(sim.state.indicators.some(i => i.type === 'miniboss')).toBe(false);
  });
});

describe('difficulty mine collision fairness', () => {
  it.each(difficulties)('%s keeps a newly placed mine harmless until arming completes, then applies its difficulty damage', difficulty => {
    const sim = quiet(difficulty); sim.state.player.invincible = 0;
    sim.spawnEnemy('mine', sim.state.player.x, sim.state.player.y);
    ticks(sim, Math.round(enemyAttacks(difficulty).mine.arming / STEP) - 1);
    expect(sim.state.player.hp).toBe(5); expect(sim.state.enemies[0].state).toBe('arming');
    const events = sim.step(idle());
    expect(sim.state.player.hp).toBe(difficulty === 'hard' ? 3 : 4);
    expect(sim.state.enemies.some(e => e.type === 'mine')).toBe(false);
    expect(events.filter(e => e.type === 'damage').map(e => e.amount)).toEqual([difficulty === 'hard' ? 2 : 1]);
  });

  it('checks hard triangle spacing after world clamping, including a third point pressed against the edge', () => {
    const sim = quiet('hard'); setPlayerPosition(sim, 600, 400);
    const layer = sim.spawnEnemy('minelayer', 55, 400)!;
    const existing = sim.spawnEnemy('mine', 130, 400)!;
    layer.state = 'charge'; layer.timer = enemyAttacks('hard').minelayer.warning; layer.angle = 0;
    until(sim, () => layer.state === 'recover');
    // The back point is outside the world before clamping. After clamping, it is only 95 units from this mine.
    expect(sim.state.enemies.filter(e => e.type === 'mine')).toEqual([existing]);
    expect(sim.state.player.hp).toBe(5);
  });
});
