import { describe, expect, it } from 'vitest';
import { BOSS_ATTACKS, bossAttacks, bossPatternLanes, bossVolleyArc, createBossBrain, updateBossAi } from './boss-ai';
import type { BossAiContext } from './boss-ai';
import { BALANCE, STEP, WORLD } from './config';
import { FixedClock } from './clock';
import { angleDelta, clamp, segmentCircleHit } from './math';
import { GameSimulation } from './simulation';
import type { AreaHazard, CombatEvent, Difficulty, Enemy, EnemyShotOptions, InputAction, Player } from './types';

function harness(difficulty?: Difficulty) {
  const player: Player = { x: 2500, y: 2000, prevX: 2500, prevY: 2000, vx: 0, vy: 0, radius: 18,
    hp: 5, maxHp: 5, bombs: 3, level: 1, xp: 0, ammo: 120, heat: 0, angle: 0, invincible: 1e9,
    dashTime: 0, dashCooldown: 0, dashVx: 0, dashVy: 0, perfectWindow: 0, shotCooldown: 0,
    specialCooldown: 0, idleTime: 0, heatLock: 0, overheated: false, focus: false };
  const enemy: Enemy = { id: 1, type: 'boss', x: 2000, y: 2000, prevX: 2000, prevY: 2000, vx: 0, vy: 0,
    radius: 160, hp: 1800, maxHp: 1800, speed: 50, angle: 0, state: 'chase', timer: 0,
    cooldown: 0, laserCooldown: 999, attackIndex: 0, hitTime: 0, lowHpSpoken: false,
    directionX: 0, directionY: 0, boss: createBossBrain() };
  const shots: { angle: number; speed: number; radius: number; color: number; time: number; options?: EnemyShotOptions }[] = [];
  const events: CombatEvent[] = [];
  const hazards: Omit<AreaHazard, 'id'>[] = [];
  const spawned: Omit<AreaHazard, 'id'>[] = [];
  const counts = { clearBullets: 0, clearHazards: 0, damage: 0, maxHazards: 0 };
  const ctx: BossAiContext = {
    player, elapsed: 0, difficulty,
    shoot: (_enemy, angle, speed, radius, color, options) => shots.push({ angle, speed, radius, color, time: ctx.elapsed, options }),
    emit: event => events.push(event),
    damagePlayer: () => { counts.damage++; player.hp--; player.invincible = BALANCE.player.hitInvincible; },
    clearHostileProjectiles: () => { counts.clearBullets++; },
    clearBossHazards: () => { counts.clearHazards++; hazards.length = 0; },
    spawnHazard: hazard => { hazards.push(hazard); spawned.push({ ...hazard }); counts.maxHazards = Math.max(counts.maxHazards, hazards.length); },
  };
  const tick = (dt = STEP) => {
    ctx.elapsed += dt; player.invincible = Math.max(0, player.invincible - dt);
    enemy.prevX = enemy.x; enemy.prevY = enemy.y;
    enemy.cooldown -= dt;
    updateBossAi(enemy, dt, ctx);
    enemy.x = clamp(enemy.x + enemy.vx * dt, enemy.radius, WORLD.width - enemy.radius);
    enemy.y = clamp(enemy.y + enemy.vy * dt, enemy.radius, WORLD.height - enemy.radius);
    for (let i = hazards.length - 1; i >= 0; i--) {
      const hazard = hazards[i];
      if (hazard.warning > 0) { hazard.warning -= dt; hazard.active = hazard.warning <= 1e-8; }
      else hazard.life -= dt;
      if (hazard.life <= 1e-8) hazards.splice(i, 1);
    }
  };
  const run = (ticks: number) => { for (let i = 0; i < ticks; i++) tick(); };
  return { player, enemy, shots, events, hazards, spawned, counts, ctx, tick, run };
}

function finishAttack(h: ReturnType<typeof harness>): void {
  for (let tick = 0; tick < 600 && h.enemy.state !== 'recover'; tick++) h.tick();
  expect(h.enemy.state).toBe('recover');
}

describe('Boss phases and commitment', () => {
  it('creates independent deterministic brains without shared mutable state', () => {
    const a = createBossBrain(), b = createBossBrain();
    expect(a).toEqual(b); a.cycle = 7; expect(b.cycle).toBe(0);
  });
  it('changes phases exactly at 65% and 30%, clears threats, and pauses without repeated transitions', () => {
    const h = harness();
    h.enemy.hp = 1800 * 0.6501; h.enemy.timer = 100;
    h.tick(); expect(h.enemy.boss?.phase).toBe(1);
    h.enemy.hp = 1800 * 0.65;
    h.tick();
    expect(h.enemy.boss?.phase).toBe(2); expect(h.enemy.state).toBe('phaseShift');
    expect(h.enemy.timer).toBe(1.6); expect(h.counts).toMatchObject({ clearBullets: 1, clearHazards: 1 });
    h.run(95);
    expect(h.enemy.state).toBe('phaseShift'); expect(h.shots).toHaveLength(0); expect(h.spawned).toHaveLength(0);
    h.tick(); expect(h.enemy.state).toBe('chase');
    expect(h.events.filter(event => event.text === 'phase').map(event => event.amount)).toEqual([2]);
    h.enemy.hp = 1800 * 0.3; h.tick();
    expect(h.enemy.boss?.phase).toBe(3); expect(h.enemy.state).toBe('phaseShift');
    expect(h.counts).toMatchObject({ clearBullets: 2, clearHazards: 2 });
    h.run(96);
    expect(h.events.filter(event => event.text === 'phase').map(event => event.amount)).toEqual([2, 3]);
  });
  it('cancels an active attack safely when damage skips directly to phase three', () => {
    const h = harness(); h.enemy.laserCooldown = 0; h.tick(); h.run(132);
    expect(h.enemy.state).toBe('laser');
    h.enemy.hp = 100; h.tick();
    expect(h.enemy.state).toBe('phaseShift'); expect(h.enemy.boss?.phase).toBe(3);
    expect(h.counts.clearBullets).toBe(2); expect(h.counts.clearHazards).toBe(2);
    const angle = h.enemy.angle; h.run(60);
    expect(h.enemy.angle).toBe(angle); expect(h.shots).toHaveLength(0); expect(h.counts.damage).toBe(0);
  });
  it('waits to reposition from offscreen, excessive distance, or a world boundary before warning an attack', () => {
    for (const [x, y] of [[1000, 2000], [2000, 1000], [160, 2000]]) {
      const h = harness(); h.enemy.x = x; h.enemy.y = y; h.enemy.laserCooldown = 0;
      h.tick();
      expect(h.enemy.state).toBe('chase'); expect(h.events).toHaveLength(0);
      expect(Math.hypot(h.enemy.vx, h.enemy.vy)).toBeCloseTo(BOSS_ATTACKS.positioning.speed);
      expect(Math.hypot(h.enemy.x - x, h.enemy.y - y)).toBeLessThan(2);
      for (let tick = 0; tick < 1800 && h.enemy.state === 'chase'; tick++) h.tick();
      expect(h.enemy.state).toBe('laserWarmup');
      expect(Math.hypot(h.player.x - h.enemy.x, h.player.y - h.enemy.y)).toBeLessThanOrEqual(900);
    }
  });
});

describe('fully committed laser sweep', () => {
  it('locks the whole 2.2-second warning, holds for 0.25 seconds, then sweeps without reaiming or other attacks', () => {
    const h = harness(); h.enemy.laserCooldown = 0; h.tick();
    const locked = h.enemy.boss!.lockedAngle;
    expect(locked).toBeCloseTo(-0.65); expect(h.enemy.state).toBe('laserWarmup');
    expect(h.counts).toMatchObject({ clearBullets: 1, clearHazards: 1 });
    for (let i = 0; i < 132; i++) {
      h.player.x = 2000 + Math.cos(i * 0.04) * 500; h.player.y = 2000 + Math.sin(i * 0.04) * 500;
      h.tick(); expect(h.enemy.angle).toBe(locked);
    }
    expect(h.enemy.state).toBe('laser'); expect(h.enemy.timer).toBe(3.2);
    h.run(15); expect(h.enemy.angle).toBeCloseTo(locked, 10);
    h.tick(); expect(h.enemy.angle).toBeCloseTo(locked + 0.38 / 60, 10);
    h.run(176);
    expect(h.enemy.state).toBe('recover'); expect(h.enemy.timer).toBe(1.15);
    expect(h.enemy.angle - locked).toBeCloseTo((3.2 - 0.25) * 0.38, 9);
    expect(h.enemy.laserCooldown).toBe(14);
    expect(h.shots).toHaveLength(0); expect(h.spawned).toHaveLength(0);
  });
  it('alternates sweep direction on consecutive casts', () => {
    const h = harness(); h.enemy.laserCooldown = 0; h.tick();
    expect(h.enemy.boss?.sweepDirection).toBe(1);
    h.run(132 + 192);
    h.enemy.state = 'chase'; h.enemy.timer = 0; h.enemy.laserCooldown = 0;
    h.tick();
    expect(h.enemy.boss?.sweepDirection).toBe(-1);
    expect(h.enemy.angle).toBeCloseTo(0.65);
  });
  it.each([[400, 1], [700, 1], [400, -1], [700, -1]])('allows an ordinary 300-unit sidestep from radius %i with direction %i, without dash or invulnerability', (distance, direction) => {
    const h = harness(); h.player.x = 2000 + distance; h.player.invincible = 0;
    h.enemy.laserCooldown = 0; h.enemy.boss!.sweepDirection = direction === 1 ? -1 : 1;
    h.tick(); expect(h.enemy.state).toBe('laserWarmup');
    for (let tick = 0; tick < 132; tick++) { h.player.y += direction * 300 * STEP; h.tick(); }
    expect(h.enemy.state).toBe('laser');
    h.run(192);
    expect(h.player.hp).toBe(5); expect(h.counts.damage).toBe(0);
    expect(h.player.invincible).toBe(0);
  });
  it('does not damage during warning and uses the active beam rectangle for actual contact', () => {
    const h = harness(); h.enemy.laserCooldown = 0; h.player.invincible = 0; h.tick();
    const angle = h.enemy.angle;
    h.player.x = h.enemy.x + Math.cos(angle) * 350; h.player.y = h.enemy.y + Math.sin(angle) * 350;
    h.run(132); expect(h.counts.damage).toBe(0);
    h.tick(); expect(h.counts.damage).toBe(1); expect(h.player.hp).toBe(4);
    h.run(10); expect(h.counts.damage).toBe(1);
  });
});

describe('bounded patterns with visible escape routes', () => {
  it('keeps a committed gap through every rotating phase-three nova layer even when the player moves', () => {
    const h = harness(); h.enemy.hp = 500; h.enemy.boss!.phase = 3; h.enemy.boss!.cycle = 2;
    h.tick(); expect(h.enemy.state).toBe('novaWarmup');
    const locked = h.enemy.boss!.lockedAngle, lane = bossPatternLanes(h.enemy)[0];
    h.player.y += 500; h.run(62);
    expect(h.shots).toHaveLength(0); expect(h.enemy.angle).toBe(locked);
    h.tick(); expect(h.enemy.state).toBe('nova');
    const firstRing = h.shots.map(shot => shot.angle);
    finishAttack(h);
    expect(new Set(h.shots.map(shot => shot.time)).size).toBe(BOSS_ATTACKS.nova.rings[2]);
    expect(h.shots.length).toBeGreaterThan(450);
    expect(h.shots.every(shot => Math.abs(angleDelta(lane.angle, shot.angle)) > lane.width / 2)).toBe(true);
    expect(h.shots.slice(firstRing.length, firstRing.length * 2).map(shot => shot.angle)).not.toEqual(firstRing);
    expect(h.shots.length).toBeLessThan(BOSS_ATTACKS.nova.count[2] * BOSS_ATTACKS.nova.layers[2] * BOSS_ATTACKS.nova.rings[2]);
  });
  it('locks fan direction throughout warning and all subsequent bursts', () => {
    const h = harness(); h.enemy.hp = 500; h.enemy.boss!.phase = 3; h.enemy.boss!.cycle = 1;
    h.tick(); expect(h.enemy.state).toBe('aim'); const locked = h.enemy.angle;
    h.player.x = 1000; h.player.y = 3000;
    h.run(56); expect(h.shots).toHaveLength(0); expect(h.enemy.angle).toBe(locked);
    h.tick(); expect(h.enemy.state).toBe('volley');
    const envelope = bossVolleyArc(h.enemy), lane = bossPatternLanes(h.enemy)[0];
    finishAttack(h);
    expect(new Set(h.shots.map(shot => shot.time)).size).toBe(BOSS_ATTACKS.volley.bursts[2]);
    expect(h.shots.length).toBeGreaterThan(200);
    expect(h.shots.some(shot => Math.abs(angleDelta(locked, shot.angle)) > 1.5)).toBe(true);
    expect(h.shots.every(shot => Math.abs(angleDelta(envelope.angle, shot.angle)) <= envelope.width / 2)).toBe(true);
    expect(h.shots.every(shot => Math.abs(angleDelta(lane.angle, shot.angle)) > lane.width / 2)).toBe(true);
    expect(h.enemy.angle).toBe(locked);
  });
  it('reveals all three bombard circles at once, locks their positions, and never creates a zero-warning impact', () => {
    const h = harness(); h.enemy.boss!.cycle = 2;
    h.tick(); expect(h.enemy.state).toBe('bombardWarmup');
    expect(h.spawned).toHaveLength(3);
    expect(h.spawned.map(hazard => [hazard.x, hazard.y])).toEqual([[2500, 2000], [2500, 2145], [2500, 1855]]);
    expect(h.spawned.map(hazard => hazard.warningDuration)).toEqual([1.25, 1.75, 2.25]);
    expect(h.spawned.every(hazard => hazard.warning > 0 && !hazard.active && hazard.radius === 100 && hazard.duration === 0.38)).toBe(true);
    const original = structuredClone(h.spawned);
    h.player.x = 1000; h.player.y = 1000; finishAttack(h);
    expect(h.spawned).toEqual(original); expect(h.enemy.state).toBe('recover');
    expect(h.hazards).toHaveLength(0); expect(h.counts.maxHazards).toBe(3); expect(h.shots.length).toBeGreaterThan(100);
  });
  it('keeps a complete recovery and attackable breathing interval between skills', () => {
    const h = harness(); h.tick(); finishAttack(h);
    expect(h.enemy.state).toBe('recover'); const shots = h.shots.length;
    h.run(68); expect(h.enemy.state).toBe('recover'); expect(h.shots.length).toBe(shots);
    h.tick(); expect(h.enemy.state).toBe('chase');
    h.run(95); expect(h.enemy.state).toBe('chase'); expect(h.shots.length).toBe(shots);
    h.tick(); expect(h.enemy.state).toBe('novaWarmup'); expect(h.shots.length).toBe(shots);
  });
  it('stops after a fatal laser hit and ignores invalid delta values', () => {
    const h = harness(); h.enemy.laserCooldown = 0; h.tick(); h.run(132);
    h.player.x = h.enemy.x + Math.cos(h.enemy.angle) * 300; h.player.y = h.enemy.y + Math.sin(h.enemy.angle) * 300;
    h.player.invincible = 0; h.player.hp = 1; h.tick();
    expect(h.player.hp).toBe(0); const before = structuredClone(h.enemy);
    h.tick(); expect(h.enemy.angle).toBe(before.angle); expect(h.counts.damage).toBe(1);
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) updateBossAi(h.enemy, dt, h.ctx);
    expect(h.counts.damage).toBe(1);
  });
  it('produces bounded deterministic attacks at 30, 60, 120, and 144 Hz through all phases', () => {
    const outputs = [30, 60, 120, 144].map(hz => {
      const h = harness(), clock = new FixedClock(); h.enemy.laserCooldown = 8;
      for (let frame = 0; frame <= hz * 80; frame++) clock.advance(frame * 1000 / hz, dt => {
        if (h.ctx.elapsed >= 20) h.enemy.hp = 1100;
        if (h.ctx.elapsed >= 45) h.enemy.hp = 450;
        h.tick(dt);
      });
      expect(h.counts.maxHazards).toBeLessThanOrEqual(3);
      expect(h.shots.length).toBeGreaterThan(1000); expect(h.shots.length).toBeLessThan(8000);
      expect(h.events.some(event => event.text === 'laser')).toBe(true);
      expect(h.events.some(event => event.text === 'bombard')).toBe(true);
      expect(h.events.some(event => event.text === 'nova')).toBe(true);
      return { enemy: h.enemy, shots: h.shots, events: h.events, spawned: h.spawned, counts: h.counts };
    });
    for (const output of outputs.slice(1)) expect(output).toEqual(outputs[0]);
  });
});

describe('hard Boss tactics with readable combinations', () => {
  const prepare = (difficulty: Difficulty, phase: 1 | 2 | 3, skill: 'volley' | 'nova' | 'bombard') => {
    const h = harness(difficulty);
    h.enemy.boss!.phase = phase; h.enemy.hp = phase === 1 ? 1800 : phase === 2 ? 1000 : 400;
    if (skill === 'nova') {
      h.enemy.boss!.cycle = [1, 0, 2][phase - 1];
      if (difficulty === 'hard') h.player.x = h.enemy.x + 300;
    } else if (skill === 'volley') h.enemy.boss!.cycle = [0, 2, 1][phase - 1];
    else { h.enemy.boss!.cycle = difficulty === 'normal' ? [2, 1, 0][phase - 1] : 0; h.player.vy = 200; }
    h.tick();
    return h;
  };
  const finishSkill = (h: ReturnType<typeof harness>) => {
    for (let tick = 0; tick < 600 && h.enemy.state !== 'recover'; tick++) h.tick();
    expect(h.enemy.state).toBe('recover');
  };

  it('returns cached difficulty configurations and keeps the default exactly normal', () => {
    expect(bossAttacks()).toBe(BOSS_ATTACKS);
    expect(bossAttacks('normal')).toBe(BOSS_ATTACKS);
    expect(bossAttacks('hard')).toBe(bossAttacks('hard'));
    expect(bossAttacks('hard')).not.toBe(BOSS_ATTACKS);
    expect(bossAttacks('hard').laser).toMatchObject({ warning: 1.25, duration: 2.6, hold: 0.15, angularSpeed: 0.42, sideAngle: 0.58, cooldown: 9 });
    expect(BOSS_ATTACKS.laser.warning).toBe(2.2);
    expect(bossAttacks('hard').positioning.speed).toBe(150); expect(BOSS_ATTACKS.positioning.speed).toBe(110);
    const hard = harness('hard'); hard.enemy.x = 1000; hard.tick();
    expect(hard.enemy.state).toBe('chase'); expect(Math.hypot(hard.enemy.vx, hard.enemy.vy)).toBeCloseTo(150);
  });

  it.each([1, 2, 3] as const)('makes phase %i fan and nova attacks denser without multiplying the global projectile speed twice', phase => {
    for (const skill of ['volley', 'nova'] as const) {
      const normal = prepare('normal', phase, skill), hard = prepare('hard', phase, skill);
      expect(normal.enemy.boss?.skill).toBe(skill); expect(hard.enemy.boss?.skill).toBe(skill);
      expect(hard.enemy.timer).toBeLessThan(normal.enemy.timer);
      finishSkill(normal); finishSkill(hard);
      expect(hard.shots.length).toBeGreaterThan(normal.shots.length);
      const config = BOSS_ATTACKS[skill];
      expect(hard.shots.every(shot => Array.from({ length: bossAttacks('hard')[skill].layers[phase - 1] }, (_, layer) => config.speed[phase - 1] + layer * config.speedStep).includes(shot.speed))).toBe(true);
      expect(hard.shots.every(shot => shot.options?.maxSpeed === config.maxSpeed && shot.options.acceleration === config.acceleration)).toBe(true);
      expect(hard.enemy.timer).toBe(0.65);
    }
  });

  it('chooses close nova, moving-target bombard, or stationary-target fan before committing, with the cooled-down laser taking priority', () => {
    const close = harness('hard'); close.player.x = 2300; close.tick();
    expect(close.enemy.boss?.skill).toBe('nova');
    const moving = harness('hard'); moving.player.x = 2650; moving.player.vy = 200; moving.tick();
    expect(moving.enemy.boss?.skill).toBe('bombard');
    const stationary = harness('hard'); stationary.player.x = 2650; stationary.tick();
    expect(stationary.enemy.boss?.skill).toBe('volley');
    const laser = harness('hard'); laser.player.x = 2650; laser.player.vy = 200; laser.enemy.laserCooldown = 0; laser.tick();
    expect(laser.enemy.boss?.skill).toBe('laser');
    const locked = laser.enemy.boss!.lockedAngle;
    laser.player.x = 1700; laser.player.y = 1700; laser.player.vx = laser.player.vy = 0;
    laser.run(60); expect(laser.enemy.state).toBe('laserWarmup'); expect(laser.enemy.angle).toBe(locked);
  });

  it('keeps the shorter hard laser warning fully locked and preserves its stationary start and recovery', () => {
    const h = harness('hard'), attacks = bossAttacks('hard'); h.enemy.laserCooldown = 0; h.tick();
    const angle = h.enemy.angle;
    expect(h.enemy.timer).toBe(1.25); expect(angle).toBeCloseTo(-0.58);
    h.player.x = 2200; h.player.y = 2500; h.run(74);
    expect(h.enemy.state).toBe('laserWarmup'); expect(h.enemy.angle).toBe(angle);
    h.tick(); expect(h.enemy.state).toBe('laser');
    h.run(9); expect(h.enemy.angle).toBeCloseTo(angle, 10);
    h.run(147);
    expect(h.enemy.state).toBe('recover'); expect(h.enemy.timer).toBe(0.65); expect(h.enemy.laserCooldown).toBe(9);
    expect(h.enemy.angle - angle).toBeCloseTo((attacks.laser.duration - attacks.laser.hold) * attacks.laser.angularSpeed, 10);
    expect(h.shots).toHaveLength(0); expect(h.spawned).toHaveLength(0);
    h.run(38); expect(h.enemy.state).toBe('recover');
    h.tick(); expect(h.enemy.state).toBe('chase'); expect(h.enemy.timer).toBe(0.8);
  });

  it.each([[400, 1], [700, 1], [400, -1], [700, -1]])('allows an ordinary sidestep through warning plus the stationary opening at radius %i, direction %i', (distance, direction) => {
    const h = harness('hard'); h.player.x = 2000 + distance; h.player.invincible = 0;
    h.enemy.laserCooldown = 0; h.enemy.boss!.sweepDirection = direction === 1 ? -1 : 1;
    h.tick(); expect(h.enemy.state).toBe('laserWarmup');
    for (let tick = 0; tick < 75 + 9; tick++) { h.player.y += direction * 300 * STEP; h.tick(); }
    h.run(147);
    expect(h.enemy.state).toBe('recover'); expect(h.player.hp).toBe(5); expect(h.counts.damage).toBe(0);
    expect(h.player.invincible).toBe(0);
  });

  it('lets a correctly timed dash leave the hard sweep before the warning ends without relying on damage immunity', () => {
    const h = harness('hard'); h.player.x = 2700; h.player.invincible = 0;
    h.enemy.laserCooldown = 0; h.tick();
    let dashRemaining = BALANCE.dash.duration as number;
    for (let tick = 0; tick < 75; tick++) {
      const dashDelta = tick >= 24 ? Math.min(dashRemaining, STEP) : 0;
      dashRemaining -= dashDelta;
      h.player.y += BALANCE.dash.speed * dashDelta + BALANCE.player.speed * (STEP - dashDelta);
      h.tick();
    }
    expect(h.enemy.state).toBe('laser'); h.run(156);
    expect(h.counts.damage).toBe(0); expect(h.player.hp).toBe(5); expect(h.player.invincible).toBe(0);
  });

  it.each([2, 3] as const)('announces phase %i nova flank hazards up front while preserving a fixed central escape gap in every interleaved ring', phase => {
    const h = prepare('hard', phase, 'nova'), config = bossAttacks('hard');
    expect(h.spawned).toHaveLength(2);
    expect(h.spawned.every(hazard => hazard.warning >= 0.85 && !hazard.active)).toBe(true);
    const lane = bossPatternLanes(h.enemy, 'hard')[0];
    const lanePoint = { x: h.enemy.x + Math.cos(lane.angle) * 300, y: h.enemy.y + Math.sin(lane.angle) * 300 };
    for (const hazard of h.spawned) expect(Math.hypot(hazard.x - lanePoint.x, hazard.y - lanePoint.y)).toBeCloseTo(config.novaFlanks.offset);
    const initialHazards = structuredClone(h.spawned), gap = config.nova.gap[phase - 1];
    finishSkill(h);
    const rings = new Map<number, number[]>();
    for (const shot of h.shots) rings.set(shot.time, [...(rings.get(shot.time) ?? []), shot.angle]);
    expect(rings.size).toBe(config.nova.rings[phase - 1]);
    const patterns = [...rings.values()]; expect(patterns[0]).not.toEqual(patterns[1]);
    expect(h.shots.every(shot => Math.abs(angleDelta(lane.angle, shot.angle)) > gap / 2)).toBe(true);
    // A ray through every bullet trajectory misses the announced central opening, including projectile radius.
    expect(h.shots.every(shot => segmentCircleHit(h.enemy.x, h.enemy.y, h.enemy.x + Math.cos(shot.angle) * 6000,
      h.enemy.y + Math.sin(shot.angle) * 6000, lanePoint.x, lanePoint.y, h.player.radius + shot.radius) === null)).toBe(true);
    expect(h.spawned.every(hazard => Math.hypot(hazard.x - lanePoint.x, hazard.y - lanePoint.y) > hazard.radius + h.player.radius)).toBe(true);
    expect(h.spawned).toEqual(initialHazards); expect(h.counts.maxHazards).toBe(2);
  });

  it('marks all five hard bombard circles together and leaves a diagonal ordinary-movement escape route', () => {
    const h = prepare('hard', 1, 'bombard'); h.player.invincible = 0;
    expect(h.spawned).toHaveLength(5);
    expect(h.spawned.map(hazard => [hazard.x, hazard.y])).toEqual([[2500, 2000], [2500, 2160], [2500, 1840], [2660, 2000], [2340, 2000]]);
    for (const [index, warning] of [0.85, 1.09, 1.33, 1.57, 1.81].entries()) expect(h.spawned[index].warningDuration).toBeCloseTo(warning, 10);
    const initial = structuredClone(h.spawned);
    for (let tick = 0; tick < 51; tick++) { h.player.x += 300 * STEP / Math.SQRT2; h.player.y += 300 * STEP / Math.SQRT2; h.tick(); }
    expect(h.spawned.every(hazard => Math.hypot(hazard.x - h.player.x, hazard.y - h.player.y) > hazard.radius + h.player.radius)).toBe(true);
    finishSkill(h);
    expect(h.spawned).toEqual(initial); expect(h.counts.maxHazards).toBe(5); expect(h.hazards).toHaveLength(0);
    expect(h.shots.length).toBeGreaterThan(180);
  });

  it('clears a hard nova combination on a phase transition and still grants the full transition pause', () => {
    const h = prepare('hard', 2, 'nova'); expect(h.hazards).toHaveLength(2);
    h.enemy.hp = 300; h.tick();
    expect(h.enemy.state).toBe('phaseShift'); expect(h.enemy.timer).toBe(BOSS_ATTACKS.phaseShift);
    expect(h.enemy.boss?.phase).toBe(3); expect(h.hazards).toHaveLength(0);
    expect(h.counts.clearBullets).toBe(1); expect(h.counts.clearHazards).toBe(1);
    h.run(95); expect(h.enemy.state).toBe('phaseShift'); expect(h.shots).toHaveLength(0);
    h.tick(); expect(h.enemy.state).toBe('chase'); expect(h.enemy.timer).toBe(0.5);
  });

  it('keeps hard attack decisions, combinations, and counts bounded and deterministic across refresh rates', () => {
    const outputs = [30, 60, 120, 144].map(hz => {
      const h = harness('hard'), clock = new FixedClock(); h.enemy.laserCooldown = 8;
      let maxShotsPerTick = 0;
      for (let frame = 0; frame <= hz * 80; frame++) clock.advance(frame * 1000 / hz, dt => {
        if (h.ctx.elapsed >= 20) h.enemy.hp = 1100;
        if (h.ctx.elapsed >= 45) h.enemy.hp = 450;
        h.player.vx = Math.floor(h.ctx.elapsed / 7) % 2 === 0 ? 200 : 0;
        const previous = h.shots.length; h.tick(dt); maxShotsPerTick = Math.max(maxShotsPerTick, h.shots.length - previous);
      });
      expect(h.counts.maxHazards).toBeLessThanOrEqual(5);
      expect(h.shots.length).toBeGreaterThan(1800); expect(h.shots.length).toBeLessThan(12000);
      expect(maxShotsPerTick).toBeLessThanOrEqual(90);
      expect(h.events.some(event => event.text === 'nova')).toBe(true);
      expect(h.events.some(event => event.text === 'bombard')).toBe(true);
      return { enemy: h.enemy, shots: h.shots, events: h.events, spawned: h.spawned, counts: h.counts };
    });
    for (const output of outputs.slice(1)) expect(output).toEqual(outputs[0]);
  });
});

describe('v3.4 live projectile patterns', () => {
  type Skill = 'volley' | 'nova' | 'bombard';
  const idle = (): InputAction => ({ moveX: 0, moveY: 0, aimX: 2000, aimY: 2000, shoot: false, dash: false, bomb: false });
  function setup(difficulty: Difficulty, phase: 1 | 2 | 3, skill: Skill, distance = 500) {
    const sim = new GameSimulation(3401, difficulty), boss = sim.spawnEnemy('boss', 2000, 2000)!;
    const player = sim.state.player;
    player.x = player.prevX = 2000 + distance; player.y = player.prevY = 2000; player.invincible = 1e9;
    boss.hp = boss.maxHp * (phase === 1 ? 1 : phase === 2 ? 0.6 : 0.25);
    boss.boss!.phase = phase; boss.timer = 0; boss.laserCooldown = 999;
    // Odd cycles retain the explicit sequence in either difficulty, independent of tactical selection.
    const index = skill === 'volley' ? [0, 2, 1][phase - 1] : skill === 'nova' ? [1, 0, 2][phase - 1] : [2, 1, 0][phase - 1];
    boss.boss!.cycle = index % 2 === 1 ? index : index + 3;
    sim.step(idle());
    expect(boss.boss!.skill).toBe(skill);
    return { sim, boss, lane: bossPatternLanes(boss, difficulty)[0] };
  }

  for (const difficulty of ['normal', 'hard'] as const) for (const phase of [1, 2, 3] as const) for (const skill of ['volley', 'nova', 'bombard'] as const) {
    it(`${difficulty} phase ${phase} ${skill} emits bounded moving projectiles and preserves the full curved escape route at every render rate`, () => {
      const results = [30, 60, 120, 144].map(hz => {
        const { sim, boss, lane } = setup(difficulty, phase, skill), clock = new FixedClock();
        const shapes = new Set<string>(), ids = new Set<number>(), launches = new Map<number, { angle: number; speed: number }>();
        const safePoints = [300, 500, 800].map(distance => ({ x: boss.x + Math.cos(lane.angle) * distance, y: boss.y + Math.sin(lane.angle) * distance }));
        const envelope = bossVolleyArc(boss, difficulty);
        let firstEmission = 0, endOfPattern = 0, maxLive = 0, maxBatch = 0, curved = false, accelerated = false;
        let safe = true, finite = true, boundedEnvelope = true;
        const start = sim.state.elapsed;
        for (let frame = 0; frame <= hz * 8; frame++) clock.advance(frame * 1000 / hz, dt => {
          const events = sim.step(idle(), dt);
          const burst = events.filter(event => event.type === 'enemyShot' && event.enemyType === 'boss').length;
          if (burst && !firstEmission) firstEmission = sim.state.elapsed;
          if (boss.state === 'recover' && !endOfPattern) endOfPattern = sim.state.elapsed;
          if (endOfPattern) { boss.timer = 1000; boss.laserCooldown = 1000; }
          const bullets = sim.state.bullets.filter(bullet => bullet.owner === 'enemy' && bullet.shape);
          maxBatch = Math.max(maxBatch, bullets.filter(bullet => !ids.has(bullet.id)).length);
          maxLive = Math.max(maxLive, bullets.length);
          for (const bullet of bullets) {
            ids.add(bullet.id); shapes.add(bullet.shape!);
            const angle = Math.atan2(bullet.vy, bullet.vx);
            if (!launches.has(bullet.id)) launches.set(bullet.id, { angle, speed: bullet.speed });
            const initial = launches.get(bullet.id)!;
            curved ||= Math.abs(angleDelta(initial.angle, angle)) > 0.1;
            accelerated ||= bullet.speed > initial.speed + 15;
            finite &&= [bullet.x, bullet.y, bullet.vx, bullet.vy, bullet.speed, bullet.motionAge].every(Number.isFinite);
            // Check the swept circle along every real update, including the finite post-launch turn.
            safe &&= safePoints.every(point => segmentCircleHit(bullet.prevX, bullet.prevY, bullet.x, bullet.y,
              point.x, point.y, sim.state.player.radius + bullet.radius + 8) === null);
            if (skill === 'volley') boundedEnvelope &&= Math.abs(angleDelta(envelope.angle, Math.atan2(bullet.y - 2000, bullet.x - 2000))) <= envelope.width / 2 + 1e-8;
          }
        });
        expect(firstEmission - start).toBeGreaterThanOrEqual(0.8);
        expect(endOfPattern - firstEmission).toBeGreaterThanOrEqual(4);
        expect(endOfPattern - firstEmission).toBeLessThan(7);
        expect(ids.size).toBeGreaterThan(100); expect(ids.size).toBeLessThan(1000);
        expect(maxLive).toBeGreaterThan(100); expect(maxLive).toBeLessThan(1000); expect(maxBatch).toBeLessThanOrEqual(90);
        expect(shapes.size).toBeGreaterThanOrEqual(2); expect(safe).toBe(true); expect(finite).toBe(true); expect(boundedEnvelope).toBe(true);
        if (skill !== 'bombard') { expect(curved).toBe(true); expect(accelerated).toBe(true); }
        expect(sim.state.player.hp).toBe(5);
        return { firstEmission, endOfPattern, maxLive, maxBatch, count: ids.size, shapes: [...shapes],
          bullets: sim.state.bullets.filter(b => b.shape).map(b => [b.id, b.x, b.y, b.vx, b.vy, b.speed, b.motionAge]) };
      });
      for (const result of results.slice(1)) expect(result).toEqual(results[0]);
    });
  }

  for (const difficulty of ['normal', 'hard'] as const) for (const skill of ['volley', 'nova', 'bombard'] as const) for (const distance of [350, 700]) {
    it(`${difficulty} ${skill} leaves a normal-speed escape after 0.2s reaction from radius ${distance}, with the full player hitbox`, () => {
      const { sim, boss, lane } = setup(difficulty, 3, skill, distance), player = sim.state.player;
      // Bombard still requires leaving its separately marked ground circles while taking the ring opening.
      const escapeRadius = skill === 'bombard' ? Math.max(500, distance) : distance;
      const target = { x: boss.x + Math.cos(lane.angle) * escapeRadius, y: boss.y + Math.sin(lane.angle) * escapeRadius };
      player.invincible = 0;
      let damage = 0, ended = false;
      for (let tick = 0; tick < 480; tick++) {
        const input = idle(), dx = target.x - player.x, dy = target.y - player.y;
        if (tick >= 12 && Math.hypot(dx, dy) > BALANCE.player.speed * STEP) { input.moveX = dx; input.moveY = dy; }
        damage += sim.step(input).filter(event => event.type === 'damage').length;
        ended ||= boss.state === 'recover';
        if (ended) boss.timer = 1000;
      }
      expect(ended).toBe(true); expect(Math.hypot(player.x - target.x, player.y - target.y)).toBeLessThanOrEqual(5);
      expect(damage).toBe(0); expect(player.hp).toBe(5); expect(player.invincible).toBe(0);
      expect(player.bombs).toBe(BALANCE.player.bombs); expect(player.dashCooldown).toBe(0);
    });
  }

  it.each(['normal', 'hard'] as const)('%s commits different escape lanes and never uses later player motion to alter any layer', difficulty => {
    const offsets: number[] = [];
    for (const skill of ['volley', 'nova', 'bombard'] as const) {
      const a = setup(difficulty, 3, skill), b = setup(difficulty, 3, skill);
      offsets.push(angleDelta(a.boss.boss!.lockedAngle, a.lane.angle));
      const shotsA: CombatEvent[] = [], shotsB: CombatEvent[] = [];
      const birthsA: number[][] = [], birthsB: number[][] = [], seenA = new Set<number>(), seenB = new Set<number>();
      const capture = (sim: GameSimulation, seen: Set<number>, births: number[][]) => {
        for (const bullet of sim.state.bullets) if (bullet.shape && !seen.has(bullet.id)) {
          seen.add(bullet.id); births.push([sim.state.tick, bullet.id, bullet.x, bullet.y, bullet.vx, bullet.vy, bullet.speed, bullet.turnRate ?? 0]);
        }
      };
      for (let tick = 0; tick < 430 && a.boss.state !== 'recover'; tick++) {
        b.sim.state.player.x = 2000 + Math.cos(tick * 0.05) * 600;
        b.sim.state.player.y = 2000 + Math.sin(tick * 0.05) * 600;
        shotsA.push(...a.sim.step(idle()).filter(e => e.type === 'enemyShot' && e.enemyType === 'boss'));
        shotsB.push(...b.sim.step(idle()).filter(e => e.type === 'enemyShot' && e.enemyType === 'boss'));
        capture(a.sim, seenA, birthsA); capture(b.sim, seenB, birthsB);
        if (a.boss.boss!.skill !== 'idle') expect(bossPatternLanes(b.boss, difficulty)).toEqual([b.lane]);
      }
      expect(shotsA.length).toBeGreaterThanOrEqual(6); expect(shotsB).toEqual(shotsA);
      expect(birthsA.length).toBeGreaterThan(200); expect(birthsB).toEqual(birthsA);
      expect(a.boss.state).toBe('recover'); expect(b.boss.state).toBe('recover');
    }
    expect(new Set(offsets).size).toBe(3);
    expect(offsets.every(offset => Math.abs(offset) >= 0.35)).toBe(true);
  });
});
