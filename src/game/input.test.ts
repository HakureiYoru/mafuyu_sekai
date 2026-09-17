import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputController, InputState } from './input';
import { FixedClock } from './clock';
import { DEFAULT_KEYBINDINGS, rebindKey } from './settings';

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
  it('ignores removed Q/E defaults without interfering with held main fire', () => {
    const input = new InputState(); input.shoot = true;
    input.keyDown('KeyQ'); input.keyDown('KeyE');
    expect(input.keys.size).toBe(0);
    expect(input.read(0, 0)).toMatchObject({ shoot: true, dash: false, bomb: false });
    expect(input.read(0, 0)).not.toHaveProperty('beam');
    expect(input.read(0, 0)).not.toHaveProperty('command');
  });
  it('uses remapped movement/actions and clears the old held keys on rebinding', () => {
    const input = new InputState(); input.keyDown('KeyW'); input.keyDown('KeyQ');
    let bindings = rebindKey({ ...DEFAULT_KEYBINDINGS }, 'moveUp', 'ArrowUp');
    bindings = rebindKey(bindings, 'dash', 'KeyE'); input.setBindings(bindings);
    expect(input.read(0, 0)).toMatchObject({ moveY: 0, dash: false });
    input.keyDown('KeyW'); input.keyDown('ArrowUp'); input.keyDown('KeyE'); input.keyDown('KeyQ');
    expect(input.read(0, 0)).toMatchObject({ moveY: -1, dash: true, bomb: false });
  });
  it('preserves the right-Shift focus alias unless that physical key was assigned to another action', () => {
    const input = new InputState(); input.keyDown('ShiftRight'); expect(input.read(0, 0).focus).toBe(true);
    input.setBindings(rebindKey({ ...DEFAULT_KEYBINDINGS }, 'dash', 'ShiftRight'));
    input.keyDown('ShiftRight'); expect(input.read(0, 0)).toMatchObject({ focus: false, dash: true });
    input.keyDown('ShiftLeft'); expect(input.read(0, 0).focus).toBe(true);
  });
});

class PointerHost extends EventTarget {
  captures = new Set<number>();
  released: number[] = [];
  closest() { return null; }
  getBoundingClientRect() { return { left: 100, top: 50, width: 800, height: 450 }; }
  setPointerCapture(id: number) { this.captures.add(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); this.released.push(id); }
}
function dispatch(target: EventTarget, type: string, fields: Record<string, unknown> = {}) {
  target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), fields));
}
describe('browser input lifecycle at the DOM boundary', () => {
  afterEach(() => vi.unstubAllGlobals());
  function setup() {
    const host = new PointerHost(), win = new EventTarget(), doc = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal('HTMLElement', PointerHost); vi.stubGlobal('window', win); vi.stubGlobal('document', doc);
    const pause = vi.fn(), toggle = vi.fn(), input = new InputController(host as unknown as HTMLElement, () => true, pause, toggle);
    return { host, win, doc, pause, toggle, input };
  }
  it('captures held fire across the canvas edge and releases it on a global pointerup without losing movement', () => {
    const { host, win, input } = setup();
    dispatch(win, 'keydown', { code: 'KeyW', repeat: false });
    dispatch(host, 'pointerdown', { pointerId: 7, button: 0, clientX: 500, clientY: 275 });
    expect(host.captures.has(7)).toBe(true);
    dispatch(host, 'pointerleave');
    expect(input.read(10, 20)).toMatchObject({ shoot: true, moveY: -1, aimX: 810, aimY: 470 });
    dispatch(win, 'pointerup', { pointerId: 7, button: 0 });
    expect(input.read(0, 0)).toMatchObject({ shoot: false, moveY: -1 }); expect(host.released).toEqual([7]);
    input.destroy();
  });
  it.each(['blur', 'hidden', 'escape', 'clear', 'destroy'])('releases capture and pending dash/bomb on %s', reason => {
    const { host, win, doc, pause, toggle, input } = setup();
    dispatch(host, 'pointerdown', { pointerId: 8, button: 0, clientX: 400, clientY: 200 });
    dispatch(win, 'keydown', { code: 'KeyR', repeat: false }); dispatch(win, 'keydown', { code: 'Space', repeat: false });
    if (reason === 'blur') dispatch(win, 'blur');
    else if (reason === 'hidden') { doc.hidden = true; dispatch(doc, 'visibilitychange'); }
    else if (reason === 'escape') dispatch(win, 'keydown', { code: 'Escape', repeat: false });
    else if (reason === 'clear') input.clear();
    else input.destroy();
    expect(input.read(0, 0)).toMatchObject({ shoot: false, dash: false, bomb: false }); expect(host.captures.size).toBe(0);
    if (reason === 'blur' || reason === 'hidden') expect(pause).toHaveBeenCalledOnce();
    if (reason === 'escape') expect(toggle).toHaveBeenCalledOnce();
    input.destroy();
    dispatch(win, 'keydown', { code: 'KeyR', repeat: false });
    expect(input.read(0, 0).dash).toBe(false);
  });
  it('drops held fire when the browser cancels pointer capture', () => {
    const { host, input } = setup();
    dispatch(host, 'pointerdown', { pointerId: 9, button: 0, clientX: 400, clientY: 200 });
    dispatch(host, 'lostpointercapture', { pointerId: 9 }); expect(input.read(0, 0).shoot).toBe(false);
    input.destroy();
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
