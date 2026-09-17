import { describe, expect, it } from 'vitest';
import { BALANCE, STEP } from './config';
import { GameSimulation } from './simulation';
import { FixedClock } from './clock';
import { InputState } from './input';
import type { Bullet, CombatEvent, InputAction } from './types';

const input = (extra: Partial<InputAction> = {}): InputAction => ({ moveX: 0, moveY: 0, aimX: 2600, aimY: 2000, shoot: false, dash: false, bomb: false, ...extra });
function advance(sim: GameSimulation, count: number, controls = input()): CombatEvent[] {
  const events: CombatEvent[] = []; for (let tick = 0; tick < count; tick++) events.push(...sim.step(controls)); return events;
}
function scene(companions = 0) {
  const sim = new GameSimulation(4101);
  sim.state.spawnTimer = 99999; sim.state.player.specialCooldown = 99999; sim.state.player.invincible = 999;
  if (companions) {
    sim.state.pickups.push({ id: 8000, type: 'support', value: companions, x: 2000, y: 2000, age: 0 });
    sim.step(input());
  }
  return sim;
}
function target(sim: GameSimulation, x = 2400, y = 2000) {
  const enemy = sim.spawnEnemy('basic', x, y)!;
  enemy.speed = 0; enemy.hp = enemy.maxHp = 1000; enemy.cooldown = 99999; return enemy;
}
function hit(sim: GameSimulation, enemy: ReturnType<typeof target>, kind: Bullet['kind'] = 'normal') {
  sim.state.bullets.push({ id: 9000 + sim.state.tick, owner: 'player', x: enemy.x, y: enemy.y, prevX: enemy.x, prevY: enemy.y,
    vx: 0, vy: 0, radius: 4, damage: 2, life: 1, color: 0xffffff, homing: false, speed: 0, lockRange: 0,
    targetId: null, remainingHits: 1, hitIds: new Set(), kind });
  return sim.step(input());
}

describe('v5 dash-followup fire and automatic companions', () => {
  it('holding left fire releases exactly one beam at the dash endpoint without beam heat', () => {
    const sim = scene(), p = sim.state.player;
    const events = sim.step(input({ dash: true }));
    events.push(...advance(sim, 9)); expect(p.dashTime).toBeGreaterThan(0);
    const heat = p.heat;
    events.push(...sim.step(input({ shoot: true })));
    expect(p.dashTime).toBe(0); expect(p.x).toBeCloseTo(2000 + BALANCE.dash.speed * BALANCE.dash.duration);
    expect(events.filter(event => event.type === 'beam')).toHaveLength(1);
    expect(p.perfectWindow).toBe(0); expect(p.heat).toBe(heat);
    expect(advance(sim, 12, input({ shoot: true })).some(event => event.type === 'beam')).toBe(false);
  });

  it('keeps the 0.85-second opportunity across input clearing but expires it in simulated time', () => {
    const sim = scene(), p = sim.state.player;
    sim.step(input({ dash: true })); advance(sim, 10); expect(p.perfectWindow).toBeCloseTo(0.85);
    sim.clearInput(); expect(p.perfectWindow).toBeCloseTo(0.85);
    advance(sim, 50); expect(p.perfectWindow).toBeGreaterThan(0);
    sim.step(input()); expect(p.perfectWindow).toBeCloseTo(0);
    expect(sim.step(input({ shoot: true })).some(event => event.type === 'beam')).toBe(false);
  });

  it('fires through overheat without removing its lock or adding beam heat', () => {
    const sim = scene(), p = sim.state.player; p.heat = 90; p.heatLock = 1; p.overheated = true; p.perfectWindow = 0.85;
    const events = sim.step(input({ shoot: true }));
    expect(events.filter(event => event.type === 'beam')).toHaveLength(1);
    expect(events.some(event => event.type === 'shot')).toBe(false);
    expect(p.heat).toBe(90); expect(p.overheated).toBe(true); expect(p.heatLock).toBeCloseTo(1 - STEP);
  });

  it('a second dash replaces one opportunity and never banks a second beam', () => {
    const sim = scene(), p = sim.state.player; sim.state.build.modules = ['doubleDash'];
    sim.step(input({ dash: true })); advance(sim, 20); expect(p.perfectWindow).toBeGreaterThan(0);
    sim.step(input({ dash: true })); expect(p.perfectWindow).toBe(0);
    advance(sim, 10); expect(p.perfectWindow).toBeCloseTo(0.85);
    expect(sim.step(input({ shoot: true })).filter(event => event.type === 'beam')).toHaveLength(1);
    expect(advance(sim, 10, input({ shoot: true })).some(event => event.type === 'beam')).toBe(false);
  });

  it('Q and E have no default action, including stale input objects from older integrations', () => {
    const keys = new InputState(); keys.keyDown('KeyQ'); keys.keyDown('KeyE');
    expect(keys.handlesKey('KeyQ')).toBe(false); expect(keys.handlesKey('KeyE')).toBe(false);
    expect(keys.read(0, 0)).not.toHaveProperty('beam'); expect(keys.read(0, 0)).not.toHaveProperty('command');
    const sim = scene(1); target(sim); sim.state.player.perfectWindow = 0.85;
    const events = sim.step(Object.assign(input(), { beam: true, command: true }));
    expect(events.some(event => event.type === 'beam' || event.type === 'command')).toBe(false);
    expect(sim.state.player.perfectWindow).toBeCloseTo(0.85 - STEP);
  });

  it('only real primary hits mark targets, with a retarget delay and eventual return to orbit', () => {
    const sim = scene(2), p = sim.state.player; sim.state.build.modules = ['orbitBlade'];
    const first = target(sim, 2290, 1900), second = target(sim, 2390, 2140);
    for (const drone of sim.state.companions) drone.shotCooldown = 999;
    hit(sim, first, 'module'); expect(p.markTargetId).toBeNull();
    hit(sim, first); expect(p.markTargetId).toBe(first.id); expect(p.markTime).toBeCloseTo(1.4);
    hit(sim, second); expect(p.markTargetId).toBe(first.id);
    advance(sim, 47); hit(sim, second); expect(p.markTargetId).toBe(second.id);
    advance(sim, 86); expect(p.markTargetId).toBeNull();
    advance(sim, 16); expect(sim.state.companions.every(drone => drone.orbitTargetId === null)).toBe(true);
    for (const drone of sim.state.companions) expect(Math.hypot(drone.x - p.x, drone.y - p.y)).toBeCloseTo(BALANCE.companion.orbitRadius, 5);
  });

  it('automatic division distributes available targets without a separate command', () => {
    const sim = scene(3); sim.state.build.modules = ['division'];
    for (const [x, y] of [[2200, 1800], [2370, 2000], [2180, 2200]]) target(sim, x, y);
    sim.step(input()); expect(new Set(sim.state.companions.map(drone => drone.targetId)).size).toBe(3);
  });

  it('real beam casts, automatic drones, heat and module timers agree at every rendering rate', () => {
    const simulate = (hz: number) => {
      const sim = scene(3), clock = new FixedClock(); sim.state.build.modules = ['vent', 'orbitBlade', 'division'];
      sim.state.build.ranks = { vent: 2, division: 2 }; sim.state.player.level = 5;
      const enemy = target(sim, 2440); enemy.hp = enemy.maxHp = 10000;
      const timeline: { tick: number; event: CombatEvent }[] = [];
      for (let frame = 0; frame <= hz * 10; frame++) clock.advance(frame * 1000 / hz, dt => {
        const tick = sim.state.tick;
        for (const event of sim.step(input({ aimX: enemy.x, aimY: enemy.y, moveY: tick % 120 < 60 ? 1 : -1,
          focus: tick % 60 < 30, shoot: tick < 420 || tick >= 480, dash: tick === 20 || tick === 200 || tick === 380 }), dt)) timeline.push({ tick: sim.state.tick, event });
      });
      return { state: structuredClone(sim.state), timeline, modules: sim.moduleStates };
    };
    const expected = simulate(60);
    expect(expected.timeline.filter(item => item.event.type === 'dash')).toHaveLength(3);
    expect(expected.timeline.filter(item => item.event.type === 'beam')).toHaveLength(3);
    expect(expected.timeline.some(item => item.event.type === 'hit' && item.event.damageSource === 'drone')).toBe(true);
    expect(expected.timeline.some(item => item.event.type === 'module' && item.event.moduleId === 'vent')).toBe(true);
    for (const hz of [30, 120, 144]) expect(simulate(hz)).toEqual(expected);
  });
});

describe('v5 fresh starts and authored support', () => {
  it('ignores old season and carryover payloads at reset, including high ranks and drones', () => {
    const sim = scene(3);
    const oldOptions = { difficulty: 'hard' as const, season: 's2', carryover: { level: 10, xp: 900, companions: 3 } };
    sim.reset('story', 4101, 'normal', oldOptions);
    expect(sim.state.player).toMatchObject({ level: 1, xp: 0, hp: 5, bombs: 3, heat: 0 });
    expect(sim.state.difficulty).toBe('hard'); expect(sim.state.companions).toHaveLength(0);
    expect(sim.state.status).toBe('playing'); expect(sim.state.build.modules).toEqual([]);
  });

  it('provides one support at 45 progression seconds without altering weapon level', () => {
    const sim = scene(); sim.state.waveTime = 45 - STEP; sim.state.player.xp = 17;
    const events = sim.step(input()); expect(events.filter(event => event.type === 'support' && event.text === 'arrival')).toHaveLength(1);
    advance(sim, 30); expect(sim.state.companions).toHaveLength(1);
    expect(sim.state.player).toMatchObject({ level: 1, xp: 17 });
    expect(advance(sim, 30).some(event => event.type === 'support' && event.text === 'arrival')).toBe(false);
  });

  it('converts a fourth authored support to 60 XP while never applying a level floor', () => {
    const sim = scene(3); sim.state.player.level = 8; sim.state.player.xp = 17; sim.state.waveTime = 45 - STEP;
    sim.step(input()); advance(sim, 30);
    expect(sim.state.companions).toHaveLength(3); expect(sim.state.player).toMatchObject({ level: 8, xp: 77 });
    expect(sim.state.build.levelFloor).toBe(1);
  });
});
