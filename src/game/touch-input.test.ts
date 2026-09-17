import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameSimulation } from './simulation';
import { TouchInputController, TouchInputState, TOUCH_INPUT } from './touch-input';
import type { ArenaRect, Enemy, EnemyType } from './types';

function fixture() {
  const simulation = new GameSimulation(61), world = simulation.state, input = new TouchInputState();
  const spawn = (x: number, y = world.player.y, type: EnemyType = 'basic') => simulation.spawnEnemy(type, x, y)!;
  const query = vi.fn((_rect: ArenaRect, out: Enemy[]) => { out.length = 0; out.push(...world.enemies); return out; });
  const read = (dt = 1 / 60) => input.read(world, dt, query);
  return { simulation, world, input, spawn, query, read };
}

describe('pure touch movement, transitions and thermal control', () => {
  it('has a radial 15% deadzone, a linear analogue ramp and bounded diagonal magnitude', () => {
    const { input, read } = fixture();
    input.command({ type: 'move', x: 0.15, y: 0 }); expect(read().moveX).toBe(0);
    input.command({ type: 'move', x: 0.575, y: 0 }); expect(read().moveX).toBeCloseTo(0.5);
    input.command({ type: 'move', x: 1, y: 1 }); const action = read(); expect(Math.hypot(action.moveX, action.moveY)).toBeCloseTo(1);
    input.command({ type: 'move', x: NaN, y: Infinity }); expect(read()).toMatchObject({ moveX: 0, moveY: 0 });
  });
  it('consumes dash/bomb once and prefers current move, last move, then the current facing', () => {
    const { input, world, read } = fixture(); world.player.angle = 0.3;
    input.command({ type: 'dash' }); expect(read().dashDirection).toEqual({ x: Math.cos(0.3), y: Math.sin(0.3) });
    expect(read()).not.toHaveProperty('dashDirection');
    input.command({ type: 'move', x: -0.3, y: 0 }); input.command({ type: 'dash' }); input.command({ type: 'bomb' });
    expect(read()).toMatchObject({ dash: true, bomb: true, dashDirection: { x: -1, y: 0 } });
    expect(read()).toMatchObject({ dash: false, bomb: false });
    input.command({ type: 'move', x: 0, y: 0 }); input.command({ type: 'dash' }); expect(read().dashDirection).toEqual({ x: -1, y: 0 });
    input.command({ type: 'move', x: 0, y: 1 }); input.command({ type: 'dash' }); expect(read().dashDirection).toEqual({ x: 0, y: 1 });
  });
  it('clears interrupted input but preserves fire preference/last move, while reset starts a fresh run', () => {
    const { input, read, world } = fixture(); world.player.angle = 0;
    input.command({ type: 'fire' }); input.command({ type: 'focus' }); input.command({ type: 'move', x: 0, y: -1 });
    input.command({ type: 'dash' }); input.command({ type: 'bomb' }); input.clear();
    expect(input.hud).toMatchObject({ autoFireEnabled: false, focus: false, lockedTargetId: null });
    expect(read()).toMatchObject({ moveX: 0, moveY: 0, dash: false, bomb: false });
    input.command({ type: 'dash' }); expect(read().dashDirection).toEqual({ x: 0, y: -1 });
    input.reset(); expect(input.hud.autoFireEnabled).toBe(true);
    input.command({ type: 'dash' }); expect(read().dashDirection).toEqual({ x: 1, y: 0 });
  });
  it('never fires without a target, stops at 85 and resumes only at 35', () => {
    const { world, spawn, read, input } = fixture(); expect(read().shoot).toBe(false);
    spawn(world.player.x + 100); expect(read(0.1).shoot).toBe(true);
    world.player.heat = 84.99; expect(read().shoot).toBe(true);
    world.player.heat = 85; expect(read().shoot).toBe(false); expect(input.hud.cooling).toBe(true);
    world.player.heat = 60; expect(read().shoot).toBe(false);
    world.player.heat = 35; expect(read().shoot).toBe(true); expect(input.hud.cooling).toBe(false);
  });
  it('rebuilds cooling hysteresis after pause without letting pause bypass the thermal wait', () => {
    const { world, spawn, input, read } = fixture(); spawn(world.player.x + 100);
    world.player.heat = 90; read(); input.clear(); world.player.heat = 60;
    expect(read().shoot).toBe(false); expect(input.hud.cooling).toBe(true);
    input.clear(); world.player.heat = 20; expect(read().shoot).toBe(true);
  });
  it('releases a ready dash beam through cooling/overheat, but respects disabled auto-fire and target validity', () => {
    const { world, spawn, input, read } = fixture(); const target = spawn(world.player.x + 100);
    world.player.heat = 100; world.player.overheated = true; world.player.perfectWindow = 0.85;
    expect(read().shoot).toBe(true); expect(input.hud.cooling).toBe(true);
    input.command({ type: 'fire' }); expect(read().shoot).toBe(false);
    input.command({ type: 'fire' }); target.hp = 0; expect(read().shoot).toBe(false);
    target.hp = 1; world.player.perfectWindow = 0; expect(read(0.1).shoot).toBe(false);
    world.player.heat = 20; expect(read().shoot).toBe(false); world.player.overheated = false; expect(read().shoot).toBe(true);
  });
  it('freezes and discards commands on a non-playing world', () => {
    const { world, spawn, input, read } = fixture(); spawn(world.player.x + 100);
    input.command({ type: 'move', x: 1, y: 0 }); input.command({ type: 'bomb' }); world.status = 'upgrade';
    expect(read(10)).toMatchObject({ moveX: 0, shoot: false, bomb: false }); world.status = 'playing';
    expect(read()).toMatchObject({ moveX: 0, bomb: false });
  });
});

describe('touch targeting', () => {
  it('evaluates at 100ms intervals, holds for 350ms and requires a strictly 25% closer replacement', () => {
    const { world, input, spawn, read, query } = fixture(), x = world.player.x;
    const current = spawn(x + 400), next = spawn(x + 500);
    read(0); expect(input.aim?.x).toBe(current.x); expect(query).toHaveBeenCalledTimes(1);
    next.x = x + 200; read(0.099); expect(query).toHaveBeenCalledTimes(1);
    read(0.001); expect(query).toHaveBeenCalledTimes(2); expect(input.aim?.x).toBe(current.x);
    read(0.2); expect(input.aim?.x).toBe(current.x);
    next.x = x + 30 + (400 - 30) * 0.75; read(0.1); expect(input.aim?.x).toBe(current.x);
    next.x = x + 299; read(0.1); expect(input.aim?.x).toBe(next.x); expect(input.aim?.manual).toBe(false);
  });
  it('aims at the current position without leading velocity or delaying aim updates until reevaluation', () => {
    const { world, spawn, input, read, query } = fixture(); const enemy = spawn(world.player.x + 200);
    enemy.vx = 1000; enemy.vy = 1000; read(0); enemy.x += 5; enemy.y -= 9;
    const action = read(0.01); expect(action.aimX).toBe(enemy.x); expect(action.aimY).toBe(enemy.y);
    expect(query).toHaveBeenCalledTimes(1); expect(input.aim).toMatchObject({ x: enemy.x, y: enemy.y });
  });
  it('compares collision edges so a large boss is not replaced merely because its center is farther away', () => {
    const { world, input, spawn, read } = fixture(), x = world.player.x;
    const boss = spawn(x + 600, world.player.y, 'boss'); boss.x = x + 600; boss.y = world.player.y; boss.radius = 300; boss.spell!.stage = 'active';
    const small = spawn(x + 350); small.radius = 20;
    read(0); expect(input.aim?.x).toBe(boss.x);
    small.x = x + 250; read(0.4); expect(input.aim?.x).toBe(boss.x);
    small.x = x + 240; read(0.1); expect(input.aim?.x).toBe(small.x);
  });
  it('uses exact circle/view intersection, not only center inclusion or bounding-box overlap', () => {
    const { world, input, spawn, read } = fixture();
    const corner = spawn(world.camera.x + 824, world.camera.y + 474); corner.radius = 30;
    expect(read().shoot).toBe(false);
    const edge = spawn(world.camera.x + 820); edge.radius = 30;
    expect(read(0.1).shoot).toBe(true); expect(input.aim?.x).toBe(edge.x);
  });
  it('prioritizes a tapped destructible part over an overlapping body and retains manual priority', () => {
    const { world, input, spawn, read } = fixture(); const x = world.player.x;
    const body = spawn(x + 200); body.radius = 100;
    const arm = spawn(x + 230, world.player.y, 'arm'); arm.radius = 15;
    input.command({ type: 'lock', x: x + 230, y: world.player.y, radius: 44 }); read(0);
    expect(input.hud.lockedTargetId).toBe(arm.id); expect(input.aim?.manual).toBe(true);
    spawn(x + 10); read(1); expect(input.hud.lockedTargetId).toBe(arm.id);
    input.command({ type: 'lock', x: x - 600, y: world.player.y, radius: 10 }); read(0);
    expect(input.hud.lockedTargetId).toBeNull(); expect(input.aim?.manual).toBe(false); expect(input.aim?.x).toBe(x + 10);
  });
  it.each(['dead', 'removed', 'disabled', 'offscreen', 'card-intro'])('immediately drops a %s target, even during the minimum hold', reason => {
    const { world, input, spawn, read } = fixture();
    const target = spawn(world.player.x + 100, world.player.y, reason === 'card-intro' ? 'boss' : 'basic');
    if (target.spell) target.spell.stage = 'active';
    input.command({ type: 'lock', x: target.x, y: target.y, radius: 20 }); read(0); expect(input.hud.lockedTargetId).toBe(target.id);
    const replacement = spawn(world.player.x - 300);
    if (reason === 'dead') target.hp = 0;
    else if (reason === 'removed') world.enemies.splice(world.enemies.indexOf(target), 1);
    else if (reason === 'disabled') target.disabledUntil = world.elapsed + 1;
    else if (reason === 'offscreen') target.x = world.camera.x + 3000;
    else target.spell!.stage = 'intro';
    expect(read(1 / 60).aimX).toBe(replacement.x); expect(input.hud.lockedTargetId).toBeNull();
  });
  it('uses stable IDs for equally distant candidates without oscillating', () => {
    const { world, spawn, input, read } = fixture(); const first = spawn(world.player.x - 200); spawn(world.player.x + 200);
    world.enemies.reverse(); read(0); expect(input.aim?.x).toBe(first.x);
    for (let i = 0; i < 10; i++) { world.enemies.reverse(); read(0.1); expect(input.aim?.x).toBe(first.x); }
  });
});

class TouchElement extends EventTarget {
  parent: TouchElement | null = null;
  dataset: Record<string, string> = {};
  values = new Map<string, string>();
  style = { setProperty: (key: string, value: string) => this.values.set(key, value) };
  captures = new Set<number>();
  disabled = false;
  released?: (id: number) => void;
  constructor(readonly rect = { left: 0, top: 0, width: 100, height: 500 }) { super(); }
  contains(node: TouchElement): boolean { return node === this || !!node.parent && this.contains(node.parent); }
  closest(): TouchElement | null { return this.dataset.touchControl ? this : this.parent?.closest() ?? null; }
  matches() { return this.disabled; }
  getBoundingClientRect() { return this.rect; }
  setPointerCapture(id: number) { this.captures.add(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); this.released?.(id); }
}
function event(destination: EventTarget, type: string, fields: Record<string, unknown> = {}) {
  const result = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(fields)) Object.defineProperty(result, key, { configurable: true, value });
  destination.dispatchEvent(result); return result;
}
function domFixture() {
  const base = fixture(), shell = new TouchElement(), host = new TouchElement({ left: 100, top: 50, width: 800, height: 450 }); host.parent = shell;
  const controls = Object.fromEntries(['stick', 'dash', 'bomb', 'focus', 'fire'].map(name => { const element = new TouchElement(); element.parent = shell; element.dataset.touchControl = name; return [name, element]; })) as Record<'stick' | 'dash' | 'bomb' | 'focus' | 'fire', TouchElement>;
  const win = new EventTarget(), doc = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc);
  let active = true, enabled = true;
  const interrupt = vi.fn(() => { active = false; }), change = vi.fn();
  const controller = new TouchInputController(shell as unknown as HTMLElement, host as unknown as HTMLElement,
    { enabled: () => enabled, active: () => active, world: () => base.world, query: base.query, interrupt, change });
  for (const element of [host, ...Object.values(controls)]) element.released = id => event(shell, 'lostpointercapture', { pointerId: id, target: element });
  const down = (target: TouchElement, id: number, x = 50, y = 200, at = 100, pointerType = 'touch') => {
    const fields = { target, pointerId: id, clientX: x, clientY: y, timeStamp: at, pointerType, button: 0 };
    event(win, 'pointerdown', fields); return event(shell, 'pointerdown', fields);
  };
  const move = (id: number, x: number, y: number) => event(win, 'pointermove', { pointerId: id, clientX: x, clientY: y, pointerType: 'touch' });
  const up = (id: number, x = 50, y = 200, at = 200) => event(win, 'pointerup', { pointerId: id, clientX: x, clientY: y, timeStamp: at, pointerType: 'touch' });
  return { ...base, shell, host, controls, win, doc, controller, interrupt, change, down, move, up, setActive: (value: boolean) => { active = value; }, setEnabled: (value: boolean) => { enabled = value; }, read: () => controller.read(1 / 60) };
}

describe('delegated touch Pointer Events and lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('moves with one finger while independently toggling focus, dashing and bombing with others', () => {
    const { controls, controller, down, move, up, read, interrupt, change } = domFixture();
    expect(down(controls.stick, 1).defaultPrevented).toBe(true); expect(read().moveX).toBe(0);
    move(1, 98, 200); expect(read().moveX).toBe(1); expect(controls.stick.values.get('--knob-x')).toBe('48px');
    down(controls.focus, 2); down(controls.dash, 3); down(controls.bomb, 4);
    expect(read()).toMatchObject({ moveX: 1, focus: true, dash: true, bomb: true });
    up(3); expect(read()).toMatchObject({ moveX: 1, focus: true, dash: false, bomb: false });
    up(2); up(4); expect(read()).toMatchObject({ moveX: 1, focus: true });
    const notifications = change.mock.calls.length; move(1, 90, 190); read(); expect(change).toHaveBeenCalledTimes(notifications);
    up(1, 90, 190); expect(read().moveX).toBe(0); expect(controls.stick.dataset.touchActive).toBeUndefined();
    expect(interrupt).not.toHaveBeenCalled(); controller.destroy();
  });
  it('does not transfer stick ownership when another stick finger is lifted or arrives', () => {
    const { controls, controller, down, move, up, read } = domFixture();
    down(controls.stick, 1); move(1, 98, 200); down(controls.stick, 2); move(2, 2, 200); up(2);
    expect(read().moveX).toBe(1); up(1, 98, 200); expect(read().moveX).toBe(0); controller.destroy();
  });
  it('ignores mouse movement on the virtual stick and canvas, while allowing a physical mouse button click', () => {
    const { controls, host, controller, down, move, up, read } = domFixture();
    down(controls.stick, 1, 50, 200, 0, 'mouse'); move(1, 98, 200); expect(read().moveX).toBe(0);
    down(host, 2, 500, 275, 0, 'mouse'); up(2, 500, 275); expect(controller.hud.lockedTargetId).toBeNull();
    down(controls.bomb, 3, 50, 200, 0, 'mouse'); expect(read().bomb).toBe(true); expect(read().bomb).toBe(false); controller.destroy();
  });
  it('handles a nested control label once and never adds a duplicate click listener', () => {
    const { controls, shell, controller, down, up, read } = domFixture(); const label = new TouchElement(); label.parent = controls.fire;
    down(label, 1); up(1); expect(controller.hud.autoFireEnabled).toBe(false);
    event(shell, 'click', { target: label, detail: 1 }); expect(controller.hud.autoFireEnabled).toBe(false);
    event(shell, 'click', { target: label, detail: 0 }); expect(controller.hud.autoFireEnabled).toBe(false);
    controller.command({ type: 'fire' }); expect(controller.hud.autoFireEnabled).toBe(true); expect(read().shoot).toBe(false); controller.destroy();
  });
  it('converts a short single canvas tap with actual viewport scale and preserves part priority', () => {
    const { world, spawn, host, controller, down, up, read, query } = domFixture();
    const body = spawn(2300, 2100); body.radius = 100; const arm = spawn(2300, 2100, 'arm'); arm.radius = 10;
    down(host, 1, 650, 325, 100); up(1, 650, 325, 300); read();
    expect(controller.hud.lockedTargetId).toBe(arm.id); expect(controller.aim).toMatchObject({ x: 2300, y: 2100, manual: true });
    expect(query.mock.calls[0][0]).toEqual({ x: 2300 - 44, y: 2100 - 44, width: 88, height: 88 });
    expect(world.player.x).toBe(2000); controller.destroy();
  });
  it.each(['drag', 'long', 'two-canvas', 'stick-overlap', 'outside-finger'])('does not turn %s into a manual lock', reason => {
    const { world, spawn, controls, host, win, controller, down, move, up, read } = domFixture(); spawn(world.player.x + 300, world.player.y + 100);
    down(host, 1, 650, 325, 100);
    if (reason === 'drag') { move(1, 670, 325); move(1, 650, 325); }
    if (reason === 'two-canvas') { down(host, 2, 700, 325, 120); up(2, 700, 325, 180); }
    if (reason === 'stick-overlap') { down(controls.stick, 2, 50, 200, 120); up(2, 50, 200, 180); }
    if (reason === 'outside-finger') { event(win, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 5, clientY: 5, timeStamp: 120 }); up(2, 5, 5, 180); }
    up(1, 650, 325, reason === 'long' ? 451 : 300); read(); expect(controller.hud.lockedTargetId).toBeNull(); controller.destroy();
  });
  it.each(['cancel', 'lost', 'blur', 'hidden'])('clears every pointer/action and interrupts on abnormal %s', reason => {
    const { controls, shell, win, doc, controller, down, move, read, interrupt } = domFixture();
    down(controls.stick, 1); move(1, 98, 200); down(controls.focus, 2); down(controls.dash, 3); down(controls.bomb, 4);
    if (reason === 'cancel') event(win, 'pointercancel', { pointerId: 2 });
    else if (reason === 'lost') event(shell, 'lostpointercapture', { pointerId: 1 });
    else if (reason === 'blur') event(win, 'blur');
    else { doc.hidden = true; event(doc, 'visibilitychange'); }
    expect(interrupt).toHaveBeenCalledOnce(); expect(read()).toMatchObject({ moveX: 0, shoot: false, focus: false, dash: false, bomb: false });
    expect(Object.values(controls).every(control => control.captures.size === 0)).toBe(true); controller.destroy();
  });
  it('accepts commands only while enabled/active and releases captured fingers on explicit clear/reset/destroy', () => {
    const { controls, controller, down, move, read, setEnabled, setActive, interrupt } = domFixture();
    setActive(false); down(controls.bomb, 1); controller.command({ type: 'dash' }); setActive(true); expect(read()).toMatchObject({ dash: false, bomb: false });
    setEnabled(false); controller.command({ type: 'focus' }); down(controls.stick, 2); setEnabled(true); expect(read().focus).toBe(false);
    down(controls.stick, 3); move(3, 98, 200); controller.command({ type: 'fire' }); controller.clear();
    expect(controls.stick.captures.size).toBe(0); expect(controller.hud.autoFireEnabled).toBe(false);
    controller.reset(); expect(controller.hud.autoFireEnabled).toBe(true);
    down(controls.stick, 4); controller.destroy(); expect(controls.stick.captures.size).toBe(0); down(controls.bomb, 5);
    expect(read()).toMatchObject({ moveX: 0, bomb: false, shoot: false }); expect(interrupt).not.toHaveBeenCalled();
  });
  it('does not publish per-pointer/per-frame HUD changes or create a second frame scheduler', () => {
    const { controls, controller, down, move, read, change } = domFixture(); const raf = vi.fn(); vi.stubGlobal('requestAnimationFrame', raf);
    down(controls.stick, 1);
    for (let i = 0; i < 60; i++) { move(1, 50 + Math.cos(i) * TOUCH_INPUT.stickRadius, 200 + Math.sin(i) * TOUCH_INPUT.stickRadius); read(); }
    expect(change).not.toHaveBeenCalled(); expect(raf).not.toHaveBeenCalled(); controller.destroy();
  });
});
