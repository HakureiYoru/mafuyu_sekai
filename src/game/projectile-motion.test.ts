import { describe, expect, it } from 'vitest';
import { STEP } from './config';
import { advanceProjectileMotion } from './projectile-motion';
import { GameSimulation } from './simulation';
import type { Bullet, InputAction } from './types';

const bullet = (extra: Partial<Bullet> = {}): Bullet => ({ id: 1, owner: 'enemy', x: 2000, y: 2000, prevX: 2000, prevY: 2000,
  vx: 200, vy: 0, speed: 200, radius: 7, damage: 1, life: Infinity, color: 0xffaaff, homing: false,
  targetId: null, lockRange: 0, remainingHits: 1, hitIds: new Set(), kind: 'normal', ...extra });
const idle: InputAction = { moveX: 0, moveY: 0, aimX: 3500, aimY: 2000, shoot: false, dash: false, bomb: false };

describe('bounded danmaku trajectories', () => {
  it('keeps the initial straight interval and turns only inside the declared time window', () => {
    const b = bullet({ turnRate: 0.4, turnDelay: 0.5, turnDuration: 0.75 });
    for (let i = 0; i < 30; i++) advanceProjectileMotion(b, STEP);
    expect(Math.atan2(b.vy, b.vx)).toBeCloseTo(0, 10);
    for (let i = 0; i < 45; i++) advanceProjectileMotion(b, STEP);
    expect(Math.atan2(b.vy, b.vx)).toBeCloseTo(0.3, 10);
    for (let i = 0; i < 600; i++) advanceProjectileMotion(b, STEP);
    expect(Math.atan2(b.vy, b.vx)).toBeCloseTo(0.3, 10);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(200, 8);
  });
  it('uses only the overlap when a step crosses both turn boundaries', () => {
    const b = bullet({ turnRate: -2, turnDelay: 0.025, turnDuration: 0.02 });
    advanceProjectileMotion(b, 0.1);
    expect(Math.atan2(b.vy, b.vx)).toBeCloseTo(-0.04, 10);
  });
  it('caps acceleration at its declared terminal speed instead of accelerating forever', () => {
    const b = bullet({ acceleration: 30, maxSpeed: 260 });
    for (let i = 0; i < 60; i++) advanceProjectileMotion(b, STEP);
    expect(b.speed).toBeCloseTo(230, 9);
    for (let i = 0; i < 600; i++) advanceProjectileMotion(b, STEP);
    expect(b.speed).toBe(260); expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(260, 9);
  });
  it('does not change player projectiles or consume invalid simulation deltas', () => {
    const friendly = bullet({ owner: 'player', turnRate: 1, turnDuration: 2, acceleration: 100, maxSpeed: 900 });
    advanceProjectileMotion(friendly, STEP); expect(friendly.motionAge).toBeUndefined(); expect(friendly.vx).toBe(200);
    const hostile = bullet({ turnRate: 1, turnDuration: 2 });
    for (const dt of [0, -1, NaN, Infinity]) advanceProjectileMotion(hostile, dt);
    expect(hostile.motionAge).toBeUndefined(); expect(hostile.vy).toBe(0);
  });
  it('isolates the enemy pool from friendly bullets after a restart', () => {
    const sim = new GameSimulation(34001, 'hard');
    const boss = sim.spawnEnemy('boss', 2000, 2000)!;
    sim.state.player.x = sim.state.player.prevX = 2520; sim.state.player.invincible = 999;
    boss.spell!.cardIndex = 2;
    for (let i = 0; i < 180; i++) sim.step(idle);
    const originals = new Set(sim.state.bullets);
    expect([...originals].some(b => b.shape && b.turnRate !== 0)).toBe(true);
    sim.reset(); sim.state.spawnTimer = 999;
    sim.step({ ...idle, shoot: true });
    const shot = sim.state.bullets.find(b => b.owner === 'player')!;
    expect(originals.has(shot)).toBe(false);
    expect(shot.shape).toBeUndefined();
    expect(shot).toMatchObject({ motionAge: 0, turnRate: 0, turnDelay: 0, turnDuration: 0, acceleration: 0 });
    expect(shot.program).toBeUndefined(); expect(shot.attackGroup).toBeUndefined(); expect(shot.grazed).toBe(false);
  });
  it('integrates phase boundaries exactly, including a collidable stationary interval and one return', () => {
    const program = [{ duration: 0.25, speed: 200 }, { duration: 0.65, speed: 0 }, { duration: 0.25, reverse: true }] as const;
    for (const step of [1 / 60, 0.05, 0.1]) {
      const b = bullet({ program }); let elapsed = 0, x = 0;
      while (elapsed < 1.15 - 1e-10) {
        const dt = Math.min(step, 1.15 - elapsed); const motion = advanceProjectileMotion(b, dt)!; x += motion.dx; elapsed += dt;
        if (elapsed > 0.3 && elapsed < 0.85) { expect(b.speed).toBe(0); expect(x).toBeCloseTo(50, 8); }
      }
      expect(x).toBeCloseTo(0, 8); expect(b.programIndex).toBe(3);
      advanceProjectileMotion(b, 0.1); expect(b.vx).toBeCloseTo(-200, 8);
    }
  });
});
