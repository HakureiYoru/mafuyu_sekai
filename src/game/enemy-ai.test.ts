import { describe, expect, it } from 'vitest';
import { ENEMIES, STEP } from './config';
import { ENEMY_ATTACKS, cancelEnemyAttack, enemyAttacks, interruptEnemy, refreshWeakpoint, updateEnemyAi } from './enemy-ai';
import { FixedClock } from './clock';
import type { EnemyAiContext } from './enemy-ai';
import type { CombatEvent, Difficulty, Enemy, EnemyShotOptions, EnemyType, Player } from './types';

function player(extra: Partial<Player> = {}): Player {
  return { x: 2600, y: 2000, prevX: 2600, prevY: 2000, vx: 0, vy: 0, radius: 18,
    hp: 5, maxHp: 5, hpReserve: 0, bombs: 3, level: 1, xp: 0, heat: 0, angle: 0, commandTargetId: null, commandTime: 0, commandCooldown: 0,
    invincible: 0, dashTime: 0, dashCooldown: 0, dashVx: 0, dashVy: 0,
    perfectWindow: 0, shotCooldown: 0, specialCooldown: 0, idleTime: 0, heatLock: 0,
    overheated: false, focus: false, ...extra };
}

function enemy(type: EnemyType, extra: Partial<Enemy> = {}): Enemy {
  return { id: 5, type, x: 2000, y: 2000, prevX: 2000, prevY: 2000, vx: 0, vy: 0,
    radius: ENEMIES[type].radius, hp: 100, maxHp: 100, speed: ENEMIES[type].speed,
    angle: 0, state: 'chase', timer: 0, cooldown: 0, laserCooldown: 0, attackIndex: 0,
    hitTime: 0, lowHpSpoken: false, directionX: 0, directionY: 0, ...extra };
}

function harness(type: EnemyType, options: { enemy?: Partial<Enemy>; player?: Partial<Player>; allowed?: boolean; commit?: boolean; difficulty?: Difficulty } = {}) {
  const e = enemy(type, options.enemy), p = player(options.player);
  const shots: { angle: number; speed: number; radius: number; color: number; time: number; options?: EnemyShotOptions }[] = [];
  const mines: { x: number; y: number; time: number }[] = [], events: CombatEvent[] = [];
  let requests = 0;
  const ctx: EnemyAiContext = { player: p, elapsed: 0, wave: 4, difficulty: options.difficulty, allowAttack: options.allowed ?? true,
    canCommit: () => { requests++; return options.commit ?? true; },
    shoot: (_enemy, angle, speed, radius, color, options) => shots.push({ angle, speed, radius, color, time: ctx.elapsed, options }),
    plantMine: (x, y) => mines.push({ x, y, time: ctx.elapsed }), emit: event => events.push(event) };
  function tick(decide = true, integrate = false): void {
    ctx.elapsed += STEP; e.cooldown -= STEP;
    updateEnemyAi(e, STEP, decide, ctx);
    if (integrate) { e.x += e.vx * STEP; e.y += e.vy * STEP; }
  }
  function ticks(count: number, decide = true, integrate = false): void { for (let i = 0; i < count; i++) tick(decide, integrate); }
  function until(test: () => boolean, decide = true, integrate = false): void {
    let count = 0;
    while (!test() && count++ < 900) tick(decide, integrate);
    expect(test()).toBe(true);
  }
  return { e, p, ctx, shots, mines, events, tick, ticks, until, requests: () => requests };
}

describe('interruptible commitments and baitable heavy shots', () => {
  it.each(['normal', 'hard'] as const)('%s marks exactly the final sniper projectile for finite enemy friendly damage', difficulty => {
    const h = harness('sniper', { difficulty }); h.tick(); h.until(() => h.e.state === 'recover');
    expect(h.shots).toHaveLength(enemyAttacks(difficulty).sniper.shots);
    expect(h.shots.slice(0, -1).every(shot => shot.options?.friendlyDamage === undefined)).toBe(true);
    expect(h.shots.at(-1)!.options).toMatchObject({ friendlyDamage: 8, friendlyHits: 3, shape: 'kunai' });
    expect(h.shots.every(shot => shot.angle === h.e.angle)).toBe(true);
  });
  it.each(['normal', 'hard'] as const)('%s weakpoints keep partial damage while aiming, then cancel the complete volley once', difficulty => {
    for (const type of ['sniper', 'sprayer'] as const) {
      const h = harness(type, { difficulty }); h.tick();
      const hp = difficulty === 'hard' ? 6 : 4;
      expect(h.e.weakpoint).toMatchObject({ hp, maxHp: hp, radius: 24 });
      expect(interruptEnemy(h.e, 2, h.ctx.elapsed, h.ctx.emit)).toBe(false);
      h.p.y += 60; h.tick();
      expect(h.e.weakpoint!.hp).toBe(hp - 2);
      h.e.x += 25; refreshWeakpoint(h.e);
      expect(h.e.weakpoint!.x).toBeCloseTo(h.e.x + Math.cos(h.e.angle) * (h.e.radius + 8));
      expect(interruptEnemy(h.e, hp, h.ctx.elapsed, h.ctx.emit)).toBe(true);
      expect(h.e.weakpoint).toBeUndefined(); expect(h.e.state).toBe('recover'); expect(h.e.timer).toBe(0.7);
      expect(h.e.cooldown).toBeCloseTo(enemyAttacks(difficulty)[type].cooldown + 0.7);
      expect(interruptEnemy(h.e, hp, h.ctx.elapsed, h.ctx.emit)).toBe(false);
      h.ctx.allowAttack = false; h.ticks(180);
      expect(h.shots).toHaveLength(0); expect(h.events.filter(e => e.type === 'interrupt')).toHaveLength(1);
    }
  });
  it('does not cancel released shots or expose weakpoints on dashers and minelayers', () => {
    const h = harness('sniper'); h.tick(); h.until(() => h.e.state === 'volley');
    expect(h.e.weakpoint).toBeUndefined(); expect(cancelEnemyAttack(h.e)).toBe(false);
    h.until(() => h.e.state === 'recover'); expect(h.shots).toHaveLength(2);
    for (const type of ['dasher', 'minelayer'] as const) {
      const other = harness(type, { player: { x: type === 'dasher' ? 2300 : 2500 } }); other.tick();
      expect(other.e.weakpoint).toBeUndefined();
      expect(interruptEnemy(other.e, 999, 0)).toBe(false);
    }
  });
});

describe('observable enemy tactics', () => {
  it('gives basic enemies direct, bounded interception and flank roles without a speed buff', () => {
    const direct = harness('basic', { enemy: { id: 3 } });
    const lead = harness('basic', { enemy: { id: 4 }, player: { vy: 300 } });
    const flank = harness('basic', { enemy: { id: 5 } });
    for (const h of [direct, lead, flank]) h.ticks(90);
    expect(direct.e.vy).toBeCloseTo(0);
    expect(lead.e.vy).toBeGreaterThan(0);
    expect(flank.e.vy).toBeGreaterThan(lead.e.vy);
    for (const h of [direct, lead, flank]) {
      expect(Math.hypot(h.e.vx, h.e.vy)).toBeLessThanOrEqual(h.e.speed + 1e-8);
      expect(h.e.speed).toBe(ENEMIES.basic.speed);
      expect(h.shots).toHaveLength(0); expect(h.requests()).toBe(0);
    }
    const fast = harness('basic', { enemy: { id: 4 }, player: { vy: 1080 } });
    fast.ticks(90);
    expect(Math.atan2(fast.e.vy, fast.e.vx)).toBeCloseTo(Math.atan2(110, 600), 7);
  });

  it('converges close basic enemies instead of circling forever around the player', () => {
    for (const id of [3, 4, 5]) {
      const h = harness('basic', { enemy: { id }, player: { x: 2100, vy: 300 } });
      h.ticks(30);
      expect(h.e.vx).toBeGreaterThan(0); expect(h.e.vy).toBeCloseTo(0);
    }
  });

  it('preserves existing velocity when a steering decision is skipped', () => {
    const h = harness('basic', { enemy: { vx: 40, vy: -80 } });
    h.tick(false, true);
    expect(h.e.vx).toBe(40); expect(h.e.vy).toBe(-80);
    expect(h.e.x).toBeCloseTo(2000 + 40 * STEP); expect(h.e.y).toBeCloseTo(2000 - 80 * STEP);
  });

  it('leaves position integration and cooldown decrement to its caller', () => {
    const h = harness('basic', { enemy: { cooldown: 5 } });
    updateEnemyAi(h.e, STEP, true, h.ctx);
    expect(h.e.x).toBe(2000); expect(h.e.y).toBe(2000); expect(h.e.cooldown).toBe(5);
    expect(h.e.vx).not.toBe(0);
  });
});

describe('dash commitment', () => {
  it('locks its last 0.45 seconds, dashes along that line for exactly 310 units and recovers', () => {
    const h = harness('dasher', { player: { x: 2300 } });
    h.tick(); expect(h.e.state).toBe('charge'); expect(h.e.timer).toBe(0.85);
    h.ticks(24); expect(h.e.tactics?.locked).toBe(true);
    const locked = h.e.angle;
    h.p.x = 1700; h.p.y = 2400;
    h.until(() => h.e.state === 'dash', false);
    expect(h.e.angle).toBe(locked); expect(h.e.vx).toBe(0); expect(h.e.vy).toBe(0);
    const startX = h.e.x, startY = h.e.y;
    h.until(() => h.e.state === 'recover', false, true);
    expect(h.e.x - startX).toBeCloseTo(310, 7); expect(h.e.y - startY).toBeCloseTo(0, 7);
    h.ticks(42, true, true);
    expect(h.e.state).toBe('chase'); expect(h.e.cooldown).toBeCloseTo(1.6);
    expect(h.e.x - startX).toBeCloseTo(310, 7); expect(h.e.speed).toBe(ENEMIES.dasher.speed);
  });

  it('does not launch from beyond the distance that can threaten a stationary player', () => {
    const h = harness('dasher', { player: { x: 2440 } });
    h.tick(); expect(h.e.state).toBe('chase'); expect(h.requests()).toBe(0);
    expect(Math.abs(h.e.vy)).toBeGreaterThan(0);
  });
});

describe('ranged enemies expose finite windows', () => {
  it('snipers lead by at most 0.25 seconds and fire two shots on the same locked bearing', () => {
    const h = harness('sniper', { player: { vy: 300 } });
    h.tick(); expect(h.e.state).toBe('aim');
    expect(h.e.angle).toBeCloseTo(Math.atan2(75, 600));
    const begun = h.ctx.elapsed;
    h.ticks(33); expect(h.e.tactics?.locked).toBe(true);
    const angle = h.e.angle;
    h.p.x = 1500; h.p.y = 1000; h.p.vy = -1080;
    h.ticks(32); expect(h.shots).toHaveLength(0);
    h.tick(); expect(h.shots).toHaveLength(1);
    h.until(() => h.shots.length === 2);
    expect(h.shots[0].time - begun).toBeCloseTo(1.1, 7);
    expect(h.shots.every(shot => shot.angle === angle && shot.speed === 600 && shot.radius === 10)).toBe(true);
    expect(h.shots[1].time - h.shots[0].time).toBeGreaterThanOrEqual(0.18 - 1e-8);
    expect(h.shots[1].time - h.shots[0].time).toBeLessThan(0.18 + STEP + 1e-8);
    expect(h.e.state).toBe('recover');
    h.ctx.allowAttack = false; h.ticks(180);
    expect(h.shots).toHaveLength(2);
  });

  it('snipers retreat when close, approach when far, and stay within their normal speed', () => {
    const near = harness('sniper', { player: { x: 2300 }, allowed: false });
    const far = harness('sniper', { player: { x: 2800 }, allowed: false });
    near.ticks(60); far.ticks(60);
    expect(near.e.vx).toBeLessThan(0); expect(far.e.vx).toBeGreaterThan(0);
    expect(Math.hypot(near.e.vx, near.e.vy)).toBeLessThanOrEqual(ENEMIES.sniper.speed);
    expect(near.requests()).toBe(0); expect(far.requests()).toBe(0);
  });

  it('sprayers telegraph a fixed cone, then fire exactly nine beats inside 1.3 radians', () => {
    const h = harness('sprayer');
    h.tick(); expect(h.e.state).toBe('aim'); expect(h.e.tactics?.locked).toBe(true);
    const locked = h.e.angle, begun = h.ctx.elapsed;
    h.p.x = 1800; h.p.y = 1300;
    h.ticks(47); expect(h.shots).toHaveLength(0); expect(h.e.angle).toBe(locked);
    h.tick(); expect(h.shots).toHaveLength(1);
    h.until(() => h.shots.length === 9, false);
    expect(h.shots[0].time - begun).toBeCloseTo(0.8, 7);
    expect(h.shots[8].time - h.shots[0].time).toBeCloseTo(1.12, 1);
    const angles = h.shots.map(shot => shot.angle);
    expect(Math.max(...angles) - Math.min(...angles)).toBeCloseTo(1.3, 7);
    expect(angles[4]).toBeCloseTo(locked, 7);
    expect(h.shots.every(shot => shot.speed === 270 && shot.radius === 8)).toBe(true);
    expect(h.e.state).toBe('recover'); expect(h.e.timer).toBe(1.4);
    h.ctx.allowAttack = false; h.ticks(20);
    expect(Math.hypot(h.e.vx, h.e.vy)).toBeGreaterThan(0);
    expect(h.shots).toHaveLength(9);
  });

  it('both sweep directions stay finite and do not rotate into full-circle fire', () => {
    const sweeps = [4, 5].map(id => {
      const h = harness('sprayer', { enemy: { id } });
      h.until(() => h.shots.length === 9);
      return h.shots.map(shot => shot.angle);
    });
    for (let i = 0; i < sweeps[0].length; i++) expect(sweeps[0][i]).toBeCloseTo(sweeps[1][sweeps[1].length - 1 - i], 10);
  });

  it('maintains a committed burst cadence even when every steering update is skipped', () => {
    const near = harness('sniper'), far = harness('sniper');
    near.tick(); far.tick();
    near.until(() => near.shots.length === 2);
    far.until(() => far.shots.length === 2, false);
    expect(far.shots).toEqual(near.shots);
  });
});

describe('mine placement and arming', () => {
  it('waits for the planting warning and leaves a traversable gap between two timed mines', () => {
    const h = harness('minelayer', { player: { x: 2450 } });
    h.tick(); expect(h.e.state).toBe('charge');
    h.ticks(38); expect(h.mines).toHaveLength(0);
    h.tick(); expect(h.mines).toHaveLength(1);
    h.until(() => h.mines.length === 2, false);
    const [first, second] = h.mines;
    expect(second.time - first.time).toBeGreaterThanOrEqual(0.28 - 1e-8);
    expect(second.time - first.time).toBeLessThan(0.28 + STEP + 1e-8);
    expect(Math.hypot(second.x - first.x, second.y - first.y)).toBe(128);
    expect(128 - ENEMIES.mine.radius * 2).toBeGreaterThan(h.p.radius * 2);
    expect(h.e.state).toBe('recover');
    h.until(() => h.e.state === 'chase'); expect(h.e.cooldown).toBe(3);
  });

  it('retreats instead of placing a mine immediately under a nearby player', () => {
    const h = harness('minelayer', { player: { x: 2150 } });
    h.ticks(90);
    expect(h.e.vx).toBeLessThan(0); expect(h.e.state).toBe('chase');
    expect(h.mines).toHaveLength(0); expect(h.requests()).toBe(0);
  });

  it('keeps new mines stationary and unarmed for their full 1.1-second interval', () => {
    const h = harness('mine', { enemy: { state: 'arming', timer: ENEMY_ATTACKS.mine.arming, vx: 50, vy: 70 }, allowed: false });
    h.ticks(65, false, true);
    expect(h.e.state).toBe('arming'); expect(h.e.timer).toBeGreaterThan(0);
    h.tick(false, true);
    expect(h.e.state).toBe('chase'); expect(h.e.timer).toBe(0);
    expect([h.e.x, h.e.y, h.e.vx, h.e.vy]).toEqual([2000, 2000, 0, 0]);
    expect(h.requests()).toBe(0); expect(h.shots).toHaveLength(0);
  });
});

describe('attack director handoff', () => {
  it('never exceeds three newly committed strong attacks when the director caps reservations', () => {
    const h = harness('sniper');
    let accepted = 0, calls = 0;
    h.ctx.canCommit = () => { calls++; if (accepted >= 3) return false; accepted++; return true; };
    const enemies = Array.from({ length: 7 }, (_, id) => enemy('sniper', { id }));
    for (const e of enemies) updateEnemyAi(e, STEP, true, h.ctx);
    expect(enemies.filter(e => e.state === 'aim')).toHaveLength(3); expect(accepted).toBe(3);
    const afterCommit = calls;
    for (const e of enemies.slice(0, 3)) updateEnemyAi(e, STEP, true, h.ctx);
    expect(calls).toBe(afterCommit);
  });

  it.each([
    ['dasher', 'charge'], ['dasher', 'dash'], ['sniper', 'aim'], ['sniper', 'volley'],
    ['sprayer', 'aim'], ['sprayer', 'volley'], ['minelayer', 'charge'], ['minelayer', 'volley'],
  ] as const)('cancels %s / %s immediately when the Boss takes the attack window', (type, state) => {
    const h = harness(type, { enemy: { state, timer: 0.05, vx: 400, vy: 100,
      tactics: { shotsLeft: 2, shotTimer: 0, sweepStart: 0, sweepIndex: 0, locked: true } }, allowed: false });
    h.tick(false, true);
    expect(h.e.state).toBe('recover'); expect(h.e.tactics?.shotsLeft).toBe(0);
    expect([h.e.x, h.e.y, h.e.vx, h.e.vy]).toEqual([2000, 2000, 0, 0]);
    h.ticks(180);
    expect(h.shots).toHaveLength(0); expect(h.mines).toHaveLength(0); expect(h.requests()).toBe(0);
  });

  it('does not alter a Boss, a dead enemy or a zero-duration update', () => {
    for (const [e, dt] of [[enemy('boss'), STEP], [enemy('sniper', { hp: 0 }), STEP], [enemy('sniper'), 0]] as const) {
      const h = harness('basic'), before = JSON.stringify(e);
      updateEnemyAi(e, dt, true, h.ctx);
      expect(JSON.stringify(e)).toBe(before); expect(h.requests()).toBe(0);
    }
  });
});

describe('hard difficulty tactics', () => {
  it('reuses two profiles and leaves omitted difficulty identical to normal', () => {
    expect(enemyAttacks()).toBe(ENEMY_ATTACKS);
    expect(enemyAttacks('normal')).toBe(ENEMY_ATTACKS);
    expect(enemyAttacks('hard')).toBe(enemyAttacks('hard'));
    expect(enemyAttacks('hard')).not.toBe(ENEMY_ATTACKS);
    for (const type of ['basic', 'dasher', 'sniper', 'sprayer', 'minelayer'] as const) {
      const legacy = harness(type, { player: { x: 2340, vy: 120 } });
      const normal = harness(type, { difficulty: 'normal', player: { x: 2340, vy: 120 } });
      legacy.ticks(360, true, true); normal.ticks(360, true, true);
      expect(normal.e).toEqual(legacy.e); expect(normal.shots).toEqual(legacy.shots);
      expect(normal.mines).toEqual(legacy.mines); expect(normal.events).toEqual(legacy.events);
    }
  });

  it('gives basic enemies bounded interception and both wings without multiplying supplied speed', () => {
    const speed = ENEMIES.basic.speed * 1.3;
    const intercept = harness('basic', { difficulty: 'hard', enemy: { id: 1, speed }, player: { vy: 1080 } });
    const wings = [2, 3].map(id => harness('basic', { difficulty: 'hard', enemy: { id, speed }, player: { vx: 300 } }));
    for (const h of [intercept, ...wings]) {
      h.ticks(90);
      expect(Math.hypot(h.e.vx, h.e.vy)).toBeLessThanOrEqual(speed + 1e-8);
      expect(h.e.speed).toBe(speed); expect(h.requests()).toBe(0);
    }
    expect(Math.atan2(intercept.e.vy, intercept.e.vx)).toBeCloseTo(Math.atan2(160, 600), 7);
    expect(wings[0].e.vy).toBeLessThan(0); expect(wings[1].e.vy).toBeGreaterThan(0);
    expect(wings[0].e.vx).toBeCloseTo(wings[1].e.vx, 7);
    for (const id of [0, 1, 2, 3]) {
      const near = harness('basic', { difficulty: 'hard', enemy: { id }, player: { x: 2100, vy: 300 } });
      near.ticks(60); expect(near.e.vy).toBeCloseTo(0); expect(near.e.vx).toBeGreaterThan(0);
    }
  });

  it('commits a faster 341-unit dash without multiplying its configured attack speed', () => {
    const h = harness('dasher', { difficulty: 'hard', enemy: { speed: ENEMIES.dasher.speed * 1.3 }, player: { x: 2340 } });
    h.tick(); expect(h.e.timer).toBe(0.6);
    h.ticks(15); expect(h.e.tactics?.locked).toBe(true);
    const angle = h.e.angle;
    h.p.x = 1800; h.p.y = 2400;
    h.until(() => h.e.state === 'dash'); expect(h.e.angle).toBe(angle);
    h.tick(false, true); expect(Math.hypot(h.e.vx, h.e.vy)).toBeCloseTo(620);
    h.until(() => h.e.state === 'recover', false, true);
    expect(h.e.x - 2000).toBeCloseTo(341, 7); expect(h.e.y).toBeCloseTo(2000, 7);
    expect(h.e.timer).toBe(0.65); expect(h.e.speed).toBe(ENEMIES.dasher.speed * 1.3);
  });

  it('fires three faster-spaced sniper beats on one locked bounded prediction', () => {
    const h = harness('sniper', { difficulty: 'hard', player: { vy: 1080 } });
    h.tick(); const begun = h.ctx.elapsed;
    expect(h.e.angle).toBeCloseTo(Math.atan2(160, 600), 7);
    h.ticks(21); expect(h.e.tactics?.locked).toBe(true);
    const locked = h.e.angle;
    h.p.x = 1500; h.p.y = 2800; h.p.vy = -1080;
    h.until(() => h.shots.length === 3);
    expect(h.shots[0].time - begun).toBeCloseTo(0.8, 7);
    expect(h.shots[2].time - h.shots[0].time).toBeGreaterThanOrEqual(0.28 - 1e-8);
    expect(h.shots[2].time - h.shots[0].time).toBeLessThan(0.28 + STEP);
    // The simulation applies its 1.28 multiplier once; the AI supplies the unchanged base speed.
    expect(h.shots.every(shot => shot.angle === locked && shot.speed === 600 && shot.radius === 10)).toBe(true);
    expect(h.e.state).toBe('recover'); expect(h.e.timer).toBe(0.7);
  });

  it.each([4, 5])('cross-sweeps 13 beats inside one fixed 1.5-radian cone for id %i', id => {
    const h = harness('sprayer', { difficulty: 'hard', enemy: { id } });
    h.tick(); const locked = h.e.angle, begun = h.ctx.elapsed;
    expect(h.e.tactics?.locked).toBe(true);
    h.p.x = 1500; h.p.y = 2700;
    h.until(() => h.shots.length === 13, false);
    const angles = h.shots.map(shot => shot.angle - locked);
    expect(h.shots[0].time - begun).toBeCloseTo(0.6, 7);
    expect(h.shots[12].time - h.shots[0].time).toBeGreaterThanOrEqual(12 * 0.095 - 1e-8);
    expect(h.shots[12].time - h.shots[0].time).toBeLessThan(12 * 0.095 + STEP);
    expect(Math.min(...angles)).toBeCloseTo(-0.75, 7); expect(Math.max(...angles)).toBeCloseTo(0.75, 7);
    expect(angles[0] * angles[1]).toBeLessThan(0);
    expect(Math.abs(angles[2])).toBeLessThan(Math.abs(angles[0])); expect(angles[12]).toBeCloseTo(0);
    expect(h.shots.every(shot => shot.speed === 270 && shot.radius === 8)).toBe(true);
    expect(h.e.state).toBe('recover'); expect(h.e.timer).toBe(1.1);
  });

  it('lays a locked triangle with 140-unit spacing and a full warning before the first mine', () => {
    const h = harness('minelayer', { difficulty: 'hard', player: { x: 2430 } });
    h.tick(); const begun = h.ctx.elapsed;
    h.ticks(29); expect(h.mines).toHaveLength(0);
    h.tick(); expect(h.mines).toHaveLength(1);
    h.p.x = 2500; h.p.y = 2150;
    h.until(() => h.mines.length === 3, false);
    expect(h.mines[0].time - begun).toBeCloseTo(0.5, 7);
    for (let i = 0; i < h.mines.length; i++) {
      const mine = h.mines[i];
      expect(Math.hypot(mine.x - h.p.x, mine.y - h.p.y)).toBeGreaterThanOrEqual(150);
      for (const other of h.mines.slice(i + 1)) expect(Math.hypot(mine.x - other.x, mine.y - other.y)).toBeCloseTo(140, 7);
    }
    expect(h.mines[2].x).toBeLessThan(2000); expect(h.mines[2].y).toBeCloseTo(2000);
    expect(h.e.state).toBe('recover'); expect(h.e.timer).toBe(0.5);
    expect(enemyAttacks('hard').mine.arming).toBe(1.1);
  });

  it('skips a later triangle point if the player enters its safety radius during the volley', () => {
    const h = harness('minelayer', { difficulty: 'hard', player: { x: 2430 } });
    h.until(() => h.mines.length === 1);
    h.p.x = 2000; h.p.y = 2070;
    h.until(() => h.e.state === 'recover', false);
    expect(h.mines).toHaveLength(1);
    expect(h.e.tactics?.shotsLeft).toBe(0);
  });

  it.each(['dasher', 'sniper', 'sprayer', 'minelayer'] as const)('repositions recovering %s from observed movement without firing or gaining speed', type => {
    const speed = ENEMIES[type].speed * 1.3;
    const left = harness(type, { difficulty: 'hard', allowed: false, enemy: { state: 'recover', timer: 1, speed }, player: { vy: 300 } });
    const right = harness(type, { difficulty: 'hard', allowed: false, enemy: { state: 'recover', timer: 1, speed }, player: { vy: -300 } });
    left.ticks(30); right.ticks(30);
    expect(left.e.vy * right.e.vy).toBeLessThan(0);
    for (const h of [left, right]) {
      expect(Math.hypot(h.e.vx, h.e.vy)).toBeGreaterThan(0);
      expect(Math.hypot(h.e.vx, h.e.vy)).toBeLessThanOrEqual(speed + 1e-8);
      expect(h.shots).toHaveLength(0); expect(h.mines).toHaveLength(0); expect(h.requests()).toBe(0);
    }
  });

  it('requires director approval and immediately cancels every hard attack on Boss exclusion', () => {
    for (const type of ['dasher', 'sniper', 'sprayer', 'minelayer'] as const) {
      const denied = harness(type, { difficulty: 'hard', commit: false, player: { x: 2340 } });
      denied.ticks(180);
      expect(denied.requests()).toBeGreaterThan(0); expect(denied.e.state).toBe('chase');
      expect(denied.shots).toHaveLength(0); expect(denied.mines).toHaveLength(0);
      for (const state of [type === 'dasher' || type === 'minelayer' ? 'charge' : 'aim', type === 'dasher' ? 'dash' : 'volley'] as const) {
        const h = harness(type, { difficulty: 'hard', enemy: { state, timer: 0.01, vx: 620,
          tactics: { shotsLeft: 3, shotTimer: 0, sweepStart: 0, sweepIndex: 0, locked: true } }, allowed: false });
        h.tick(false, true);
        expect(h.e.state).toBe('recover'); expect(h.e.timer).toBe(enemyAttacks('hard')[type].recovery);
        expect(h.e.x).toBe(2000); expect(h.e.vx).toBe(0); expect(h.e.tactics?.shotsLeft).toBe(0);
        h.ticks(180); expect(h.shots).toHaveLength(0); expect(h.mines).toHaveLength(0); expect(h.requests()).toBe(0);
      }
    }
    const mini = enemy('miniboss'), before = JSON.stringify(mini), h = harness('basic', { difficulty: 'hard' });
    updateEnemyAi(mini, STEP, true, h.ctx); expect(JSON.stringify(mini)).toBe(before);
  });

  it('runs identical hard attack clocks at 30/60/120/144 Hz rendering and skips only steering decisions', () => {
    function run(hz: number) {
      const h = harness('sprayer', { difficulty: 'hard' }), clock = new FixedClock();
      clock.advance(0, () => {});
      for (let frame = 1; frame <= hz * 8; frame++) clock.advance(frame / hz * 1000, () => h.tick(false));
      return { shots: h.shots, state: h.e.state, timer: h.e.timer, cooldown: h.e.cooldown, events: h.events };
    }
    const expected = run(60);
    for (const hz of [30, 120, 144]) expect(run(hz)).toEqual(expected);
  });
});
