import { describe, expect, it } from 'vitest';
import { FixedClock, RenderGate } from './clock';
import { GameSimulation } from './simulation';
import { TouchInputState } from './touch-input';
import { STEP } from './config';
import type { InputAction } from './types';

const idle: InputAction = { moveX: 0, moveY: 0, aimX: 2800, aimY: 2000, shoot: false, dash: false, bomb: false };
function quiet() { const sim = new GameSimulation(61001); sim.state.spawnTimer = 1e6; return sim; }

describe('touch movement and independent rendering', () => {
  it.each([30, 60, 120, 144])('preserves analog movement, diagonal speed and 60Hz simulation at %iHz', hz => {
    for (const cap of [30, 60]) {
      const sim = quiet(), clock = new FixedClock(), render = new RenderGate(); let draws = 0;
      for (let frame = 0; frame <= hz * 2; frame++) {
        const timestamp = frame * 1000 / hz;
        clock.advance(timestamp, dt => { sim.step({ ...idle, moveX: 0.3, moveY: 0.4 }, dt); });
        if (render.ready(timestamp, cap)) draws++;
      }
      expect(sim.state.tick).toBe(120);
      expect(sim.state.player.x).toBeCloseTo(2180, 6);
      expect(sim.state.player.y).toBeCloseTo(2240, 6);
      expect(draws).toBe(Math.min(hz, cap) * 2 + 1);
    }
  });
  it('keeps full keyboard diagonal speed and slow movement bounded', () => {
    for (const focus of [false, true]) {
      const sim = quiet();
      for (let i = 0; i < 60; i++) sim.step({ ...idle, moveX: 1, moveY: 1, focus });
      expect(Math.hypot(sim.state.player.x - 2000, sim.state.player.y - 2000)).toBeCloseTo(focus ? 180 : 300);
    }
  });
  it('uses independent stationary dash direction without moving on cooldown or changing aim', () => {
    const sim = quiet(), player = sim.state.player;
    sim.step({ ...idle, dash: true, dashDirection: { x: -1, y: 0 } });
    expect(player.dashVx).toBe(-1080); expect(player.angle).toBe(0);
    for (let i = 0; i < 20; i++) sim.step(idle);
    const x = player.x;
    sim.step({ ...idle, dash: true, dashDirection: { x: -1, y: 0 } });
    expect(player.x).toBe(x); expect(player.dashTime).toBe(0);
    const moving = quiet(); moving.step({ ...idle, moveY: 0.5, dash: true, dashDirection: { x: -1, y: 0 } });
    expect(moving.state.player.dashVy).toBe(1080); expect(moving.state.player.dashVx).toBe(0);
  });
  it.each([false, true])('retains a buffered touch dash direction with current movement priority (%s)', moving => {
    const sim = quiet(), touch = new TouchInputState(), player = sim.state.player;
    const query = sim.queryTouchTargets.bind(sim);
    sim.spawnEnemy('basic', player.x + 600, player.y);
    touch.command({ type: 'move', x: -1, y: 0 }); touch.command({ type: 'move', x: 0, y: 0 });
    player.dashCooldown = 0.1; touch.command({ type: 'dash' });
    sim.step(touch.read(sim.state, STEP, query));
    expect(player.dashTime).toBe(0);
    if (moving) touch.command({ type: 'move', x: 0, y: 1 });
    for (let frame = 0; frame < 9 && player.dashTime === 0; frame++) sim.step(touch.read(sim.state, STEP, query));
    expect(player.dashTime).toBeGreaterThan(0);
    expect(player.dashVx).toBe(moving ? 0 : -1080);
    expect(player.dashVy).toBe(moving ? 1080 : 0);
  });
  it.each(['clear', 'reset', 'consume', 'expire'] as const)('discards the cached direction after %s', cleanup => {
    const sim = quiet(); sim.state.player.dashCooldown = cleanup === 'consume' || cleanup === 'expire' ? 0 : 0.1;
    if (cleanup === 'expire') sim.state.player.dashTime = 0.4;
    sim.step({ ...idle, dash: true, dashDirection: { x: -1, y: 0 } });
    if (cleanup === 'clear') sim.clearInput();
    if (cleanup === 'reset') sim.reset();
    for (let frame = 0; frame < 30; frame++) sim.step(idle);
    const player = sim.state.player;
    expect(player.dashTime).toBe(0);
    if (cleanup === 'clear' || cleanup === 'reset') expect(player.x).toBe(2000);
    player.dashCooldown = 0;
    sim.step({ ...idle, aimX: player.x + 600, aimY: player.y, dash: true });
    expect(player.dashVx).toBe(1080); expect(player.dashVy).toBe(0);
  });
  it('activates the 80-heat reserve module before touch auto-fire reaches its 85-heat stop', () => {
    const sim = quiet(), touch = new TouchInputState(), player = sim.state.player;
    sim.state.build.modules.push('reserveAmmo'); sim.state.build.ranks.reserveAmmo = 1; sim.refreshBuild();
    const target = sim.spawnEnemy('basic', player.x + 600, player.y)!; target.hp = target.maxHp = 10000; target.speed = 0;
    player.heat = 79;
    let activations = 0;
    for (let frame = 0; frame < 30; frame++) {
      const action = touch.read(sim.state, STEP, sim.queryTouchTargets.bind(sim));
      expect(action.shoot).toBe(true); expect(touch.hud.cooling).toBe(false);
      activations += sim.step(action).filter(event => event.type === 'module' && event.moduleId === 'reserveAmmo').length;
    }
    expect(activations).toBe(1); expect(player.heat).toBeCloseTo(61.5);
    expect(sim.moduleStates.find(module => module.id === 'reserveAmmo')?.status).toBe('cooldown');
  });
  it('holds touch focus through actual precision shots and brake-field activation, then clears both input states', () => {
    const sim = quiet(), touch = new TouchInputState(), player = sim.state.player;
    sim.state.build.modules.push('precision', 'brakeField');
    Object.assign(sim.state.build.ranks, { precision: 1, brakeField: 1 }); sim.refreshBuild();
    const target = sim.spawnEnemy('basic', player.x + 600, player.y)!; target.hp = target.maxHp = 10000; target.speed = 0;
    touch.command({ type: 'focus' });
    let fields = 0;
    for (let frame = 0; frame < 42; frame++) {
      fields += sim.step(touch.read(sim.state, STEP, sim.queryTouchTargets.bind(sim)))
        .filter(event => event.type === 'module' && event.moduleId === 'brakeField').length;
    }
    expect(player.focus).toBe(true); expect(fields).toBe(1);
    expect(sim.moduleStates.find(module => module.id === 'precision')?.status).toBe('active');
    expect(sim.state.bullets.some(bullet => bullet.kind === 'normal' && Math.abs(bullet.damage - 2.4) < 1e-8)).toBe(true);
    expect(sim.state.playerAreas.some(area => area.kind === 'brake' && area.radius === 110)).toBe(true);
    touch.clear(); sim.clearInput(); sim.step(touch.read(sim.state, STEP, sim.queryTouchTargets.bind(sim)));
    expect(player.focus).toBe(false);
    expect(sim.moduleStates.find(module => module.id === 'precision')?.status).toBe('ready');
  });
  it('queries new large targets crossing the viewport edge before a simulation step', () => {
    const sim = quiet(), boss = sim.spawnEnemy('boss', 2850, 2000)!;
    expect(sim.queryTouchTargets({ x: 1200, y: 1550, width: 1600, height: 900 }, [])).toContain(boss);
  });
  it('resets presentation deadlines on resume and rate changes without accumulating skipped draws', () => {
    const gate = new RenderGate();
    expect(gate.ready(0, 30)).toBe(true); expect(gate.ready(16, 30)).toBe(false);
    expect(gate.ready(16, 60)).toBe(true); expect(gate.ready(10000, 60)).toBe(true);
    expect(gate.ready(10001, 60)).toBe(false);
    gate.reset(); expect(gate.ready(10001, 30)).toBe(true);
    expect(gate.ready(10002, null)).toBe(true);
  });
});
