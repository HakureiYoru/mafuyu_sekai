import { describe, expect, it } from 'vitest';
import { BALANCE } from './config';
import { GameSimulation } from './simulation';
import type { Bullet, Difficulty, InputAction } from './types';

const idle: InputAction = { moveX: 0, moveY: 0, aimX: 3500, aimY: 2000, shoot: false, dash: false, bomb: false };

function quiet(difficulty: Difficulty = 'normal') {
  const sim = new GameSimulation(519, difficulty);
  sim.state.spawnTimer = 1e9;
  sim.state.player.invincible = 1e9;
  return sim;
}

function medicine(sim: GameSimulation, value: number, id = 990001) {
  const p = sim.state.player;
  sim.state.pickups.push({ id, type: 'hp', x: p.x, y: p.y, value, age: 0 });
}

function hit(sim: GameSimulation, damage: number) {
  const p = sim.state.player;
  p.invincible = 0;
  const bullet: Bullet = {
    id: 990100, x: p.x, y: p.y, prevX: p.x, prevY: p.y, vx: 0, vy: 0, radius: 4,
    owner: 'enemy', damage, life: 10, color: 0xffffff, homing: false, speed: 0,
    lockRange: 0, targetId: null, remainingHits: 1, hitIds: new Set(), kind: 'normal',
  };
  sim.state.bullets.push(bullet);
  return sim.step(idle);
}

describe('stored healing pickups', () => {
  it('banks every full-health stack and removes it without repeating pickup or healing events', () => {
    const sim = quiet(), p = sim.state.player;
    expect(p.hpReserve).toBe(0);
    medicine(sim, 3);
    medicine(sim, 2, 990002);
    const events = sim.step(idle);
    expect(p.hp).toBe(p.maxHp);
    expect(p.hpReserve).toBe(5);
    expect(sim.state.pickups).toHaveLength(0);
    expect(events.filter(event => event.type === 'pickup' && event.pickupType === 'hp').map(event => event.amount)).toEqual([3, 2]);
    expect(events.filter(event => event.type === 'heal')).toHaveLength(0);
    for (let tick = 0; tick < 120; tick++) {
      expect(sim.step(idle).filter(event => event.type === 'pickup' || event.type === 'heal')).toHaveLength(0);
    }
    expect(p.hpReserve).toBe(5);
  });

  it('heals missing health immediately and stores all overflow from mixed stacks', () => {
    const sim = quiet(), p = sim.state.player;
    p.hp = p.maxHp - 2;
    medicine(sim, 5);
    medicine(sim, 2, 990002);
    const events = sim.step(idle);
    expect(p.hp).toBe(p.maxHp);
    expect(p.hpReserve).toBe(5);
    expect(sim.state.pickups).toHaveLength(0);
    expect(events.filter(event => event.type === 'heal').map(event => event.amount)).toEqual([2]);
    expect(events.filter(event => event.type === 'pickup' && event.pickupType === 'hp').map(event => event.amount)).toEqual([5, 2]);
  });

  it('uses existing reserve for an injured living player without creating another pickup event', () => {
    const sim = quiet(), p = sim.state.player;
    p.hp = 2;
    p.hpReserve = 2;
    const events = sim.step(idle);
    expect(p.hp).toBe(4);
    expect(p.hpReserve).toBe(0);
    expect(events.filter(event => event.type === 'heal').map(event => event.amount)).toEqual([2]);
    expect(events.filter(event => event.type === 'pickup')).toHaveLength(0);
  });

  it.each([
    { reserve: 1, healed: 1, remaining: 0 },
    { reserve: 4, healed: 2, remaining: 2 },
  ])('consumes $healed reserve immediately after a hard-mode two-HP hit from $reserve stored HP', ({ reserve, healed, remaining }) => {
    const sim = quiet('hard'), p = sim.state.player;
    medicine(sim, reserve);
    sim.step(idle);
    const events = hit(sim, 2);
    expect(p.hp).toBe(p.maxHp - 2 + healed);
    expect(p.hpReserve).toBe(remaining);
    expect(sim.state.status).toBe('playing');
    expect(events.filter(event => event.type === 'damage').map(event => event.amount)).toEqual([2]);
    expect(events.filter(event => event.type === 'heal').map(event => event.amount)).toEqual([healed]);
    expect(events.filter(event => event.type === 'pickup')).toHaveLength(0);
  });

  it('does not turn stored healing into a revive after lethal damage', () => {
    const sim = quiet(), p = sim.state.player;
    medicine(sim, 10);
    sim.step(idle);
    const events = hit(sim, p.maxHp);
    expect(sim.state.status).toBe('failed');
    expect(p.hp).toBe(0);
    expect(p.hpReserve).toBe(10);
    expect(events.filter(event => event.type === 'failure')).toHaveLength(1);
    expect(events.filter(event => event.type === 'heal')).toHaveLength(0);
    sim.step(idle);
    expect(p.hp).toBe(0);
    expect(p.hpReserve).toBe(10);
  });

  it.each(['upgrade', 'failed', 'complete'] as const)('does not consume reserve while %s', status => {
    const sim = quiet(), p = sim.state.player;
    p.hp = 3;
    p.hpReserve = 2;
    sim.state.status = status;
    expect(sim.step(idle).filter(event => event.type === 'heal')).toHaveLength(0);
    expect(p.hp).toBe(3);
    expect(p.hpReserve).toBe(2);
  });

  it('stores remote medicine during boss settlement and carries the reserve into endless', () => {
    const sim = quiet(), w = sim.state, p = w.player;
    medicine(sim, 3);
    sim.step(idle);
    const miniboss = sim.spawnEnemy('miniboss', 1300, 2000)!;
    w.pickups.push({ id: 990002, type: 'hp', x: 100, y: 100, value: 4, age: 0 });
    sim.damageEnemy(miniboss, miniboss.hp);
    expect(w.campaign.defeatedEncounters).toContain('s1:echo');
    expect(w.pickups.some(pickup => pickup.type === 'hp')).toBe(false);
    expect(p.hpReserve).toBe(7);
    const settlement = sim.step(idle);
    expect(settlement.filter(event => event.type === 'pickup' && event.pickupType === 'hp').map(event => event.amount)).toEqual([4]);
    expect(settlement.filter(event => event.type === 'heal')).toHaveLength(0);
    w.status = 'complete';
    sim.continueEndless();
    expect(w.mode).toBe('endless');
    expect(p.hpReserve).toBe(7);
    expect(p.hp).toBe(p.maxHp);
  });

  it('clears saved medicine and pickups when restarting', () => {
    const sim = quiet(), p = sim.state.player;
    medicine(sim, 8);
    sim.step(idle);
    expect(p.hpReserve).toBe(8);
    sim.reset();
    expect(sim.state.player).toMatchObject({ hp: BALANCE.player.hp, hpReserve: 0 });
    expect(sim.state.pickups).toHaveLength(0);
    expect(sim.step(idle).filter(event => event.type === 'heal' || event.type === 'pickup')).toHaveLength(0);
  });
});
