import { describe, expect, it } from 'vitest';
import { BALANCE, STEP } from './config';
import { GameSimulation } from './simulation';
import { FixedClock } from './clock';
import { MODULES } from './upgrades';
import type { CarryoverSnapshot, CombatEvent, InputAction } from './types';

const input = (extra: Partial<InputAction> = {}): InputAction => ({ moveX: 0, moveY: 0, aimX: 2600, aimY: 2000,
  shoot: false, dash: false, bomb: false, ...extra });
const advance = (sim: GameSimulation, count: number, controls = input()) => {
  const events: CombatEvent[] = [];
  for (let tick = 0; tick < count; tick++) events.push(...sim.step(controls));
  return events;
};
function scene(carryover?: CarryoverSnapshot) {
  const sim = new GameSimulation(4101);
  if (carryover) {
    sim.reset('story', 4101, 'normal', { season: 's2', carryover });
    // A non-drone entry module cannot itself supply a companion to this fixture.
    sim.chooseUpgrade(sim.state.build.choices.find(id => MODULES[id].branch !== 'drone')!);
  }
  sim.state.spawnTimer = 99999; sim.state.player.specialCooldown = 99999;
  return sim;
}
function target(sim: GameSimulation, x = 2400) {
  const enemy = sim.spawnEnemy('basic', x, 2000)!;
  enemy.speed = 0; enemy.hp = enemy.maxHp = 1000; enemy.cooldown = 99999;
  return enemy;
}

describe('v4.1 independent Q and E controls', () => {
  it('queues one Q during the actual dash and fires at its endpoint without spending main-shot heat', () => {
    const sim = scene(), p = sim.state.player;
    const events = sim.step(input({ dash: true }));
    events.push(...sim.step(input({ beam: true })));
    expect(events.some(event => event.type === 'beam')).toBe(false);
    expect(p.dashTime).toBeGreaterThan(0);
    events.push(...advance(sim, 9, input({ beam: true })));
    expect(p.dashTime).toBe(0);
    expect(p.x).toBeCloseTo(2000 + BALANCE.dash.speed * BALANCE.dash.duration);
    expect(events.filter(event => event.type === 'beam')).toHaveLength(1);
    expect(p.perfectWindow).toBe(0); expect(p.heat).toBe(0);
    expect(advance(sim, 12, input({ beam: true })).some(event => event.type === 'beam')).toBe(false);
  });

  it('pause input clearing cancels a queued Q but keeps the earned charge for a fresh press', () => {
    const sim = scene(), p = sim.state.player;
    sim.step(input({ dash: true })); sim.step(input({ beam: true }));
    sim.clearInput();
    expect(advance(sim, 9).some(event => event.type === 'beam')).toBe(false);
    expect(p.perfectWindow).toBeCloseTo(4);
    sim.clearInput();
    expect(p.perfectWindow).toBeCloseTo(4);
    expect(sim.step(input({ beam: true })).filter(event => event.type === 'beam')).toHaveLength(1);
    expect(p.perfectWindow).toBe(0);
  });

  it('a second dash refreshes one charge rather than accumulating two shots', () => {
    const sim = scene({ level: 5, xp: 0, companions: 0 });
    sim.state.build.modules = ['doubleDash'];
    sim.step(input({ dash: true })); advance(sim, 20);
    const oldWindow = sim.state.player.perfectWindow;
    expect(oldWindow).toBeGreaterThan(0); expect(oldWindow).toBeLessThan(4);
    sim.step(input({ dash: true })); advance(sim, 10);
    expect(sim.state.player.perfectWindow).toBeCloseTo(4);
    expect(sim.step(input({ beam: true })).filter(event => event.type === 'beam')).toHaveLength(1);
    sim.step(input());
    expect(sim.step(input({ beam: true })).some(event => event.type === 'beam')).toBe(false);
  });

  it('empty and unavailable E commands cost nothing; a valid cursor target costs once and concentrates all drones', () => {
    const noDrone = scene(), unavailable = target(noDrone);
    noDrone.step(input({ command: true, aimX: unavailable.x }));
    expect(noDrone.state.player.commandCooldown).toBe(0);
    const sim = scene({ level: 5, xp: 0, companions: 3 }), p = sim.state.player;
    const near = target(sim, 2260), selected = target(sim, 2440);
    sim.step(input({ command: true, aimX: 1000, aimY: 1000 }));
    expect(p.commandCooldown).toBe(0); expect(p.commandTargetId).toBeNull();
    sim.step(input());
    const events = sim.step(input({ command: true, aimX: selected.x }));
    expect(events.filter(event => event.type === 'command' && event.text === 'issued')).toHaveLength(1);
    expect(p.commandTargetId).toBe(selected.id); expect(p.commandCooldown).toBe(8);
    expect(sim.state.companions.every(companion => companion.targetId === selected.id)).toBe(true);
    sim.step(input({ command: true, aimX: near.x }));
    expect(p.commandTargetId).toBe(selected.id); expect(p.commandCooldown).toBeCloseTo(8 - STEP);
  });

  it('E tolerates a brief range excursion, then returns to automatic fire at 0.3 seconds without refunding cooldown', () => {
    const sim = scene({ level: 5, xp: 0, companions: 1 }), p = sim.state.player;
    const enemy = target(sim, 2350);
    sim.step(input({ command: true, aimX: enemy.x }));
    enemy.x = p.x + BALANCE.companion.range + enemy.radius + 10;
    advance(sim, 17); expect(p.commandTargetId).toBe(enemy.id);
    enemy.x = 2350; sim.step(input()); expect(p.commandTargetId).toBe(enemy.id);
    enemy.x = p.x + BALANCE.companion.range + enemy.radius + 10;
    advance(sim, 17); expect(p.commandTargetId).toBe(enemy.id);
    const events = sim.step(input());
    expect(p.commandTargetId).toBeNull(); expect(p.commandTime).toBe(0);
    expect(p.commandCooldown).toBeCloseTo(8 - 36 * STEP);
    expect(events.filter(event => event.type === 'command' && event.text === 'expired')).toHaveLength(1);
  });

  it('keeps real Q/E casts, movement, heat and vent cooldown identical at 30/60/120/144 Hz', () => {
    const simulate = (hz: number) => {
      const sim = scene({ level: 5, xp: 17, companions: 3 }), clock = new FixedClock();
      sim.state.build.modules = ['vent'];
      sim.state.player.invincible = 999;
      const enemy = target(sim, 2440); enemy.hp = enemy.maxHp = 10000;
      const timeline: { tick: number; event: CombatEvent }[] = [];
      const checkpoints: { tick: number; window: number; commandTime: number; heat: number }[] = [];
      let overheated = false;
      for (let frame = 0; frame <= hz * 10; frame++) clock.advance(frame * 1000 / hz, dt => {
        const tick = sim.state.tick;
        const events = sim.step(input({
          aimX: enemy.x, aimY: enemy.y,
          moveY: tick % 120 < 60 ? 1 : -1,
          focus: tick % 60 < 30,
          shoot: tick < 420 || tick >= 480,
          dash: tick === 20 || tick === 200 || tick === 380,
          // Two buffered presses, then a fresh press after earning the third charge.
          beam: tick === 22 || tick === 205 || tick === 400 || tick === 450,
          command: tick === 0 || tick === 480,
        }), dt);
        for (const event of events) timeline.push({ tick: sim.state.tick, event });
        overheated ||= sim.state.player.overheated;
        if ([31, 211, 391, 401, 481, 600].includes(sim.state.tick)) checkpoints.push({ tick: sim.state.tick,
          window: sim.state.player.perfectWindow, commandTime: sim.state.player.commandTime, heat: sim.state.player.heat });
      });
      return { state: structuredClone(sim.state), timeline, checkpoints, overheated, modules: sim.moduleStates };
    };

    const expected = simulate(60), events = expected.timeline.map(item => item.event);
    expect(expected.state.tick).toBe(600);
    expect(expected.state.elapsed).toBeCloseTo(10);
    expect(expected.state.player.y).not.toBeCloseTo(2000);
    expect(events.filter(event => event.type === 'dash')).toHaveLength(3);
    expect(expected.timeline.filter(item => item.event.type === 'beam').map(item => item.tick)).toEqual([31, 211, 401]);
    expect(expected.checkpoints.find(point => point.tick === 391)!.window).toBeCloseTo(4);
    expect(expected.checkpoints.find(point => point.tick === 401)!.window).toBe(0);
    expect(expected.timeline.filter(item => item.event.type === 'command' && item.event.text === 'issued').map(item => item.tick)).toEqual([1, 481]);
    expect(expected.state.player.commandCooldown).toBeCloseTo(8 - 119 * STEP);
    expect(expected.state.player.commandTime).toBeCloseTo(4 - 119 * STEP);
    expect(events.some(event => event.type === 'hit' && event.damageSource === 'drone')).toBe(true);
    expect(events.some(event => event.type === 'hit' && event.damageSource === 'beam')).toBe(true);
    expect(expected.state.enemies[0].hp).toBeLessThan(10000);
    expect(expected.overheated).toBe(true);
    expect(expected.state.player.overheated).toBe(false);
    expect(expected.state.player.heat).toBeGreaterThan(0);
    expect(events.filter(event => event.type === 'module' && event.moduleId === 'vent')).toHaveLength(2);
    expect(expected.modules[0]).toMatchObject({ id: 'vent', status: 'cooldown' });
    expect(expected.modules[0].remaining).toBeGreaterThan(0);
    for (const hz of [30, 120, 144]) expect(simulate(hz)).toEqual(expected);
  });
});

describe('v4.1 campaign catch-up is local and precedes its encounter', () => {
  it('raises low carryover at stage two and four before arrival, preserving current XP and granting one drone each time', () => {
    const carryover = Object.freeze({ level: 1, xp: 17, companions: 1 });
    const sim = scene(carryover), p = sim.state.player;
    for (const [stage, floor, companions] of [[2, 5, 2], [4, 7, 3]] as const) {
      sim.state.wave = stage; sim.state.waveTime = 75 - STEP * 2;
      const previousLevel = p.level, previousCompanions = sim.state.companions.length;
      sim.step(input()); expect(p.level).toBe(previousLevel); expect(sim.state.companions).toHaveLength(previousCompanions);
      const events = sim.step(input());
      expect(p.level).toBe(floor); expect(p.xp).toBe(17); expect(sim.state.companions).toHaveLength(companions);
      expect(events.findIndex(event => event.type === 'support' && event.text === 'catchup'))
        .toBeLessThan(events.findIndex(event => event.type === 'attack' && event.text === 'arrival'));
      expect(sim.state.indicators.some(indicator => indicator.encounterId === (stage === 2 ? 's2:palisade' : 's2:reprise'))).toBe(true);
      expect(advance(sim, 10).filter(event => event.type === 'support' && event.text === 'catchup')).toHaveLength(0);
    }
    expect(sim.state.campaign.catchupStages).toEqual([2, 4]);
    expect(carryover).toEqual({ level: 1, xp: 17, companions: 1 });
    sim.reset('story', 4101, 'normal', { season: 's2', carryover });
    expect(sim.state.player).toMatchObject({ level: 1, xp: 17 });
    expect(sim.state.companions).toHaveLength(1); expect(sim.state.campaign.catchupStages).toEqual([]);
  });

  it('full-drone and already-strong carryover receives exactly 60 XP once without losing power', () => {
    const sim = scene({ level: 8, xp: 17, companions: 3 });
    sim.state.wave = 2; sim.state.waveTime = 75 - STEP;
    sim.step(input());
    expect(sim.state.player).toMatchObject({ level: 8, xp: 77 }); expect(sim.state.companions).toHaveLength(3);
    advance(sim, 20); expect(sim.state.player.xp).toBe(77);
    expect(sim.state.build.levelFloor).toBe(8);
  });

  it('second-season endless mode cannot award authored stage catch-up', () => {
    const sim = new GameSimulation(4101);
    sim.reset('endless', 4101, 'normal', { season: 's2', carryover: { level: 1, xp: 17, companions: 1 } });
    sim.state.spawnTimer = 99999; sim.state.waveTime = BALANCE.spawn.waveDuration - STEP;
    const events = sim.step(input());
    expect(events.some(event => event.type === 'support' && event.text === 'catchup')).toBe(false);
    expect(sim.state.player).toMatchObject({ level: 1, xp: 17 });
    expect(sim.state.companions).toHaveLength(1); expect(sim.state.campaign.catchupStages).toEqual([]);
  });
});
