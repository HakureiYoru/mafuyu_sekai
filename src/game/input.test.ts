import { describe, expect, it } from 'vitest';
import { InputState } from './input';
import { FixedClock } from './clock';

describe('input transitions', () => {
  it('consumes a bomb once until a new physical key press', () => {
    const input = new InputState();
    input.keyDown('Space');
    expect(input.read(0, 0).bomb).toBe(true);
    input.keyDown('Space', true);
    input.keyDown('Space');
    expect(input.read(0, 0).bomb).toBe(false);
    input.keyUp('Space'); input.keyDown('Space');
    expect(input.read(0, 0).bomb).toBe(true);
  });
  it('clears held movement, fire and pending actions together', () => {
    const input = new InputState();
    input.keyDown('KeyW'); input.keyDown('KeyR'); input.shoot = true;
    input.clear();
    expect(input.read(10, 20)).toMatchObject({ moveX: 0, moveY: 0, dash: false, bomb: false, shoot: false, aimX: 810, aimY: 470 });
  });
});
describe('fixed clock', () => {
  it.each([30, 60, 120, 144])('advances exactly 600 ticks in ten seconds at %i Hz', hz => {
    const clock = new FixedClock(); let ticks = 0;
    for (let frame = 0; frame <= hz * 10; frame++) clock.advance(frame * 1000 / hz, () => { ticks++; });
    expect(ticks).toBe(600);
  });
  it('caps a long stall and discards elapsed time across pause', () => {
    const clock = new FixedClock(); let ticks = 0;
    clock.advance(0, () => { ticks++; });
    clock.advance(30000, () => { ticks++; });
    expect(ticks).toBeLessThanOrEqual(6);
    clock.reset(); clock.advance(90000, () => { ticks++; });
    expect(ticks).toBe(6);
  });
  it('stops catch-up immediately when a simulation step completes the run', () => {
    const clock = new FixedClock(); let ticks = 0;
    clock.advance(0, () => {});
    clock.advance(100, () => { ticks++; return false; });
    expect(ticks).toBe(1);
  });
});
