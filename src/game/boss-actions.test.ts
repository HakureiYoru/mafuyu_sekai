import { describe, expect, it } from 'vitest';
import { beginBossAction, bossActionTelegraph, updateBossAction } from './boss-actions';
import { FixedClock } from './clock';
import { GameSimulation } from './simulation';
import type { CombatEvent, EnemyType } from './types';

function harness(type: EnemyType = 'palisade') {
  const sim = new GameSimulation(60), enemy = sim.spawnEnemy(type, 2100, 1700)!;
  const events: CombatEvent[] = [], ctx = { elapsed: 0, player: sim.state.player, emit: (event: CombatEvent) => events.push(event) };
  const tick = (dt = 1 / 60) => {
    ctx.elapsed += dt; updateBossAction(enemy, dt, ctx); enemy.x += enemy.vx * dt; enemy.y += enemy.vy * dt;
  };
  return { sim, enemy, events, ctx, tick };
}
describe('committed body actions', () => {
  it('locks the whole path before movement, then exposes a finite recovery window', () => {
    const h = harness(), origin = { x: h.enemy.x, y: h.enemy.y };
    expect(beginBossAction(h.enemy, { kind: 'dash', x: 2500, y: 1800, warning: 0.7, duration: 0.5, recovery: 0.8 }, h.ctx)).toBe(true);
    const warning = structuredClone(bossActionTelegraph(h.enemy));
    h.ctx.player.x = 1200; h.ctx.player.y = 3200;
    for (let i = 0; i < 41; i++) h.tick();
    expect(h.enemy).toMatchObject(origin); expect(h.enemy.exposedUntil).toBeUndefined();
    expect(bossActionTelegraph(h.enemy)).toMatchObject({ endX: warning!.endX, endY: warning!.endY, angle: warning!.angle });
    for (let i = 0; i < 31; i++) h.tick();
    expect(h.enemy.x).toBeCloseTo(2500, 8); expect(h.enemy.y).toBeCloseTo(1800, 8);
    expect(h.enemy.exposedUntil).toBeCloseTo(2, 8);
    for (let i = 0; i < 48; i++) h.tick();
    expect(h.enemy.action).toBeUndefined(); expect(h.events.filter(event => event.text === 'core-exposed')).toHaveLength(1);
  });
  it('never advertises an action rejected by the budget, and does not move at zero dt', () => {
    const h = harness();
    expect(beginBossAction(h.enemy, { kind: 'sidestep', x: 2400, y: 1800, warning: 0.6, duration: 0.5, recovery: 0.8 },
      { ...h.ctx, reserveAttack: () => false })).toBe(false);
    expect(h.events).toEqual([]); expect(h.enemy.action).toBeUndefined();
    beginBossAction(h.enemy, { kind: 'sidestep', x: 2400, y: 1800, warning: 0.6, duration: 0.5, recovery: 0.8 }, h.ctx);
    const before = structuredClone(h.enemy); updateBossAction(h.enemy, 0, h.ctx); expect(h.enemy).toEqual(before);
  });
  it.each(['miniboss', 'palisade', 'reprise', 'boss'] as const)('%s body remains damageable during every action phase', type => {
    const h = harness(type), e = h.enemy;
    if (e.spell) e.spell.stage = 'active';
    beginBossAction(e, { kind: 'dash', x: e.x + 200, y: e.y, warning: 0.7, duration: 0.5, recovery: 0.8 }, h.ctx);
    for (const phase of ['warning', 'moving', 'recover'] as const) {
      e.action!.phase = phase; const before = e.hp;
      h.sim.damageEnemy(e, 7, { x: e.x + e.radius * 2, y: e.y, kind: 'normal', impactX: e.x + e.radius - 1, impactY: e.y });
      expect(e.hp).toBe(before - 7);
    }
  });
  it('produces identical movement at 30, 60, 120 and 144 Hz', () => {
    const run = (hz: number) => {
      const h = harness(), clock = new FixedClock();
      beginBossAction(h.enemy, { kind: 'retrace', x: 2400, y: 1900, warning: 0.65, duration: 0.47, recovery: 0.8 }, h.ctx);
      for (let frame = 0; frame <= hz * 3; frame++) clock.advance(frame * 1000 / hz, dt => h.tick(dt));
      return { x: h.enemy.x, y: h.enemy.y, events: h.events, action: h.enemy.action };
    };
    for (const hz of [30, 120, 144]) expect(run(hz)).toEqual(run(60));
  });
});
