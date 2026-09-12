import { describe, expect, it } from 'vitest';
import { BALANCE, STEP } from './config';
import { GameSimulation } from './simulation';
import { InputState } from './input';
import type { InputAction } from './types';

const input = (extra: Partial<InputAction> = {}): InputAction => ({ moveX: 0, moveY: 0, aimX: 3500, aimY: 2000, shoot: false, dash: false, bomb: false, focus: false, ...extra });
function quiet() {
  const sim = new GameSimulation(32);
  sim.state.spawnTimer = 1e9;
  return sim;
}

describe('precise movement and forgiving dash input', () => {
  it.each(['ShiftLeft', 'ShiftRight'])('%s responds on press/release and clears on blur', key => {
    const keys = new InputState();
    keys.keyDown(key); expect(keys.read(0, 0).focus).toBe(true);
    keys.keyUp(key); expect(keys.read(0, 0).focus).toBe(false);
    keys.keyDown(key); keys.clear(); expect(keys.read(0, 0).focus).toBe(false);
  });

  it('normalizes focused diagonals to 180 and immediately restores full speed on release', () => {
    const sim = quiet(), p = sim.state.player;
    for (let tick = 0; tick < 60; tick++) sim.step(input({ focus: true, moveX: 1, moveY: 1 }));
    expect(Math.hypot(p.x - 2000, p.y - 2000)).toBeCloseTo(180, 8);
    const before = p.x;
    sim.step(input({ moveX: 1 }));
    expect(p.focus).toBe(false); expect(p.x - before).toBe(5);
  });

  it('narrows the real projectile spread without changing damage, count or resource cost', () => {
    const outcomes = [false, true].map(focus => {
      const sim = quiet(); sim.state.player.level = 5;
      const shots = sim.step(input({ shoot: true, focus })).filter(event => event.type === 'shot');
      const bullets = sim.state.bullets;
      return { count: bullets.length, damage: bullets.map(b => b.damage),
        heat: sim.state.player.heat, shots: shots.length, angles: bullets.map(b => Math.atan2(b.vy, b.vx)) };
    });
    expect(outcomes[0].count).toBeGreaterThan(1);
    expect({ ...outcomes[1], angles: [] }).toEqual({ ...outcomes[0], angles: [] });
    outcomes[1].angles.forEach((angle, i) => expect(angle).toBeCloseTo(outcomes[0].angles[i] / 2, 8));
  });

  it('accepts a short press just before cooldown completes, fires once, and keeps dash speed in focus', () => {
    const sim = quiet(), p = sim.state.player;
    p.dashCooldown = 0.1;
    const events = [...sim.step(input({ dash: true, focus: true }))];
    expect(events.some(e => e.type === 'dash')).toBe(false);
    for (let tick = 0; tick < 30; tick++) events.push(...sim.step(input({ focus: true })));
    expect(events.filter(e => e.type === 'dash')).toHaveLength(1);
    expect(p.x - 2000).toBeCloseTo(BALANCE.dash.speed * BALANCE.dash.duration, 8);
    expect(p.perfectWindow).toBeGreaterThan(0);
  });

  it('does not queue early presses or retrigger a held dash', () => {
    const sim = quiet(); sim.state.player.dashCooldown = 0.3;
    const events = [];
    for (let tick = 0; tick < 240; tick++) events.push(...sim.step(input({ dash: true })));
    expect(events.some(e => e.type === 'dash')).toBe(false);
    sim.step(input());
    expect(sim.step(input({ dash: true })).filter(e => e.type === 'dash')).toHaveLength(1);
  });

  it.each(['clearInput', 'reset'] as const)('%s cancels queued actions and focused state', method => {
    const sim = quiet(); sim.state.player.dashCooldown = STEP * 4;
    sim.step(input({ dash: true, focus: true }));
    sim[method]();
    expect(sim.state.player.focus).toBe(false);
    const events = [];
    for (let tick = 0; tick < 15; tick++) events.push(...sim.step(input()));
    expect(events.some(e => e.type === 'dash')).toBe(false);
    expect(sim.state.player.x).toBe(2000);
  });
});
