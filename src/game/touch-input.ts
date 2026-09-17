import { VIEW } from './config';
import type { ArenaRect, Enemy, InputAction, TouchAction, TouchAim, TouchHud, Vec2, WorldState } from './types';

export const TOUCH_INPUT = Object.freeze({ deadzone: 0.15, stickRadius: 48, baseRadius: 42, evaluateEvery: 0.1,
  minimumHold: 0.35, switchRatio: 0.75, stopHeat: 85, resumeHeat: 35, tapDistance: 10, tapMilliseconds: 350, tapRadius: 22 });
type TargetQuery = (rect: ArenaRect, out: Enemy[]) => Enemy[];
const EPSILON = 1e-8;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const finite = (value: number) => Number.isFinite(value) ? value : 0;
const neutral = (world: WorldState): InputAction => ({ moveX: 0, moveY: 0, aimX: world.player.x + Math.cos(world.player.angle) * 200,
  aimY: world.player.y + Math.sin(world.player.angle) * 200, shoot: false, dash: false, bomb: false, focus: false });

/** Circle/view intersection, including partly visible bosses but excluding off-screen corners. */
function targetable(enemy: Enemy, world: WorldState, view: ArenaRect): boolean {
  if (enemy.hp <= 0 || (enemy.disabledUntil ?? 0) > world.elapsed || enemy.spell?.stage === 'intro') return false;
  const x = clamp(enemy.x, view.x, view.x + view.width), y = clamp(enemy.y, view.y, view.y + view.height);
  return (enemy.x - x) ** 2 + (enemy.y - y) ** 2 <= enemy.radius ** 2;
}
const part = (enemy: Enemy) => enemy.role === 'part' || enemy.type === 'arm' || enemy.type === 'node';
const edgeDistance = (enemy: Enemy, point: Vec2) => Math.max(0, Math.hypot(enemy.x - point.x, enemy.y - point.y) - enemy.radius);

/** Simulation-clock-only touch state. No browser listeners, timers or frame loops. */
export class TouchInputState {
  private move: Vec2 = { x: 0, y: 0 };
  private lastMove: Vec2 | null = null;
  private pendingDash = false;
  private pendingBomb = false;
  private pendingLock: Extract<TouchAction, { type: 'lock' }> | null = null;
  private autoFireEnabled = true;
  private focused = false;
  private cooling = false;
  private previousCooling = false;
  private thermalDirty = true;
  private target: Enemy | null = null;
  private manual = false;
  private elapsed = 0;
  private acquiredAt = 0;
  private nextEvaluation = 0;
  private targetAim: TouchAim | null = null;
  private readonly candidates: Enemy[] = [];

  get hud(): TouchHud { return { autoFireEnabled: this.autoFireEnabled, cooling: this.cooling, focus: this.focused, lockedTargetId: this.manual ? this.target?.id ?? null : null }; }
  get aim(): TouchAim | null { return this.targetAim; }

  command(action: TouchAction): void {
    if (action.type === 'clear') { this.clear(); return; }
    if (action.type === 'move') {
      const x = finite(action.x), y = finite(action.y), length = Math.hypot(x, y);
      const strength = clamp((length - TOUCH_INPUT.deadzone) / (1 - TOUCH_INPUT.deadzone), 0, 1);
      this.move.x = length > 0 ? x / length * strength : 0;
      this.move.y = length > 0 ? y / length * strength : 0;
      if (strength > 0) this.lastMove = { x: x / length, y: y / length };
    } else if (action.type === 'dash') this.pendingDash = true;
    else if (action.type === 'bomb') this.pendingBomb = true;
    else if (action.type === 'focus') this.focused = !this.focused;
    else if (action.type === 'fire') this.autoFireEnabled = !this.autoFireEnabled;
    else if (action.type === 'lock' && Number.isFinite(action.x) && Number.isFinite(action.y) && Number.isFinite(action.radius) && action.radius >= 0) this.pendingLock = { ...action };
  }

  /** Interrupt a gesture, preserving the run's fire preference and last nonzero move direction. */
  clear(): void {
    this.move.x = this.move.y = 0; this.pendingDash = this.pendingBomb = this.focused = false; this.pendingLock = null;
    this.target = null; this.manual = false; this.targetAim = null; this.nextEvaluation = 0;
    this.previousCooling ||= this.cooling; this.cooling = false; this.thermalDirty = true;
    this.candidates.length = 0;
  }
  reset(): void {
    this.clear(); this.autoFireEnabled = true; this.lastMove = null; this.elapsed = this.acquiredAt = 0;
    this.previousCooling = false;
  }

  private acquire(enemy: Enemy | null, manual = false): void {
    this.target = enemy; this.manual = manual && enemy !== null; this.acquiredAt = this.elapsed;
  }

  read(world: WorldState, dt: number, query: TargetQuery): InputAction {
    if (world.status !== 'playing') { this.clear(); return neutral(world); }
    this.elapsed += Math.max(0, finite(dt));
    const p = world.player, view = { x: world.camera.x - VIEW.width / 2, y: world.camera.y - VIEW.height / 2, ...VIEW };
    // One reference membership check also catches encounter cleanup, where removed HP can remain positive.
    if (this.target && (!targetable(this.target, world, view) || !world.enemies.includes(this.target))) {
      this.acquire(null); this.nextEvaluation = 0;
    }
    if (this.pendingLock) {
      const lock = this.pendingLock; this.pendingLock = null;
      this.candidates.length = 0;
      const found = query({ x: lock.x - lock.radius, y: lock.y - lock.radius, width: lock.radius * 2, height: lock.radius * 2 }, this.candidates);
      let selected: Enemy | null = null, distance = Infinity;
      for (const enemy of found) {
        if (!targetable(enemy, world, view)) continue;
        const d = Math.hypot(enemy.x - lock.x, enemy.y - lock.y);
        if (d > enemy.radius + lock.radius) continue;
        if (!selected || Number(part(enemy)) > Number(part(selected)) || part(enemy) === part(selected) && (d < distance || d === distance && enemy.id < selected.id)) { selected = enemy; distance = d; }
      }
      this.acquire(selected, true); this.nextEvaluation = selected ? this.elapsed + TOUCH_INPUT.evaluateEvery : 0;
    }
    if (this.elapsed + EPSILON >= this.nextEvaluation) {
      this.nextEvaluation = this.elapsed + TOUCH_INPUT.evaluateEvery;
      if (!this.manual) {
        this.candidates.length = 0;
        const found = query(view, this.candidates);
        let nearest: Enemy | null = null, distance = Infinity;
        for (const enemy of found) {
          if (!targetable(enemy, world, view)) continue;
          const d = edgeDistance(enemy, p);
          if (d < distance || d === distance && enemy.id < (nearest?.id ?? Infinity)) { nearest = enemy; distance = d; }
        }
        if (!this.target) this.acquire(nearest);
        else if (nearest && nearest !== this.target && this.elapsed - this.acquiredAt + EPSILON >= TOUCH_INPUT.minimumHold
          && distance < edgeDistance(this.target, p) * TOUCH_INPUT.switchRatio) this.acquire(nearest);
      }
    }
    if (this.thermalDirty) {
      this.cooling = p.overheated || p.heat >= TOUCH_INPUT.stopHeat || this.previousCooling && p.heat > TOUCH_INPUT.resumeHeat;
      this.previousCooling = false; this.thermalDirty = false;
    }
    if (p.overheated || p.heat >= TOUCH_INPUT.stopHeat) this.cooling = true;
    else if (p.heat <= TOUCH_INPUT.resumeHeat) this.cooling = false;
    const result = neutral(world);
    result.moveX = this.move.x; result.moveY = this.move.y; result.focus = this.focused;
    result.dash = this.pendingDash; result.bomb = this.pendingBomb;
    if (result.dash) {
      const length = Math.hypot(this.move.x, this.move.y);
      result.dashDirection = length > 0 ? { x: this.move.x / length, y: this.move.y / length }
        : this.lastMove ? { ...this.lastMove } : { x: Math.cos(p.angle), y: Math.sin(p.angle) };
    }
    this.pendingDash = this.pendingBomb = false;
    if (this.target) {
      result.aimX = this.target.x; result.aimY = this.target.y;
      result.shoot = this.autoFireEnabled && (p.perfectWindow > 0 || !this.cooling && !p.overheated);
      this.targetAim ??= { x: 0, y: 0, radius: 0, manual: false };
      Object.assign(this.targetAim, { x: this.target.x, y: this.target.y, radius: this.target.radius, manual: this.manual });
    } else this.targetAim = null;
    return result;
  }
}

interface TouchCallbacks {
  enabled(): boolean; active(): boolean; world(): WorldState; query: TargetQuery;
  interrupt(): void; change(): void;
}
type Control = 'stick' | 'dash' | 'bomb' | 'focus' | 'fire';
interface Finger {
  id: number; role: Control | 'canvas' | 'other'; target: HTMLElement | null;
  startX: number; startY: number; downAt: number; maximumDistance: number; tapEligible: boolean;
}

/** Delegated Pointer Events. CSS is updated in events; the runtime owns the only frame loop. */
export class TouchInputController {
  private readonly state = new TouchInputState();
  private readonly abort = new AbortController();
  private readonly fingers = new Map<number, Finger>();
  private stickPointer: number | null = null;
  private destroyed = false;
  private lastHud = this.state.hud;

  constructor(private readonly shell: HTMLElement, private readonly host: HTMLElement, private readonly callbacks: TouchCallbacks) {
    const signal = this.abort.signal;
    window.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'mouse' && this.accepting()) this.track(event);
    }, { signal, capture: true, passive: true });
    shell.addEventListener('pointerdown', event => this.down(event), { signal, passive: false });
    window.addEventListener('pointermove', event => this.move(event), { signal, passive: false });
    window.addEventListener('pointerup', event => this.up(event), { signal, passive: false });
    window.addEventListener('pointercancel', event => { if (this.fingers.has(event.pointerId)) this.interrupted(); }, { signal });
    shell.addEventListener('lostpointercapture', event => { if (this.fingers.get(event.pointerId)?.target) this.interrupted(); }, { signal });
    window.addEventListener('blur', () => { if (this.callbacks.enabled()) this.interrupted(); }, { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.callbacks.enabled()) this.interrupted(); }, { signal });
  }
  get hud(): TouchHud { return this.state.hud; }
  get aim(): TouchAim | null { return this.state.aim; }
  private accepting(): boolean { return !this.destroyed && this.callbacks.enabled() && this.callbacks.active(); }
  private changed(): void {
    const next = this.state.hud, previous = this.lastHud;
    this.lastHud = next;
    if (!this.destroyed && (next.autoFireEnabled !== previous.autoFireEnabled || next.cooling !== previous.cooling || next.focus !== previous.focus || next.lockedTargetId !== previous.lockedTargetId)) this.callbacks.change();
  }
  command(action: TouchAction): void {
    if (this.destroyed) return;
    if (action.type === 'clear') { this.clear(); return; }
    if (!this.accepting()) return;
    this.state.command(action); this.changed();
  }
  read(dt: number): InputAction {
    const world = this.callbacks.world();
    if (!this.accepting()) { this.clear(); return neutral(world); }
    const input = this.state.read(world, dt, this.callbacks.query); this.changed(); return input;
  }
  private track(event: PointerEvent): Finger {
    const existing = this.fingers.get(event.pointerId);
    if (existing) return existing;
    if (this.fingers.size) for (const finger of this.fingers.values()) finger.tapEligible = false;
    const finger: Finger = { id: event.pointerId, role: 'other', target: null, startX: event.clientX, startY: event.clientY,
      downAt: event.timeStamp, maximumDistance: 0, tapEligible: this.fingers.size === 0 };
    this.fingers.set(event.pointerId, finger); return finger;
  }
  private down(event: PointerEvent): void {
    if (!this.accepting()) return;
    const target = event.target as Element | null;
    const element = target?.closest?.('[data-touch-control]') as HTMLElement | null;
    const control = element?.dataset.touchControl as Control | undefined;
    const touch = event.pointerType !== 'mouse';
    if (!touch && (!control || control === 'stick')) return;
    const finger = this.track(event);
    if (finger.role !== 'other') return;
    if (element && this.shell.contains(element) && control && ['stick', 'dash', 'bomb', 'focus', 'fire'].includes(control)) {
      if (element.matches(':disabled,[aria-disabled="true"]')) return;
      event.preventDefault();
      if (control === 'stick') {
        if (this.stickPointer !== null) return;
        this.stickPointer = finger.id;
        const rect = element.getBoundingClientRect(), insetX = Math.min(TOUCH_INPUT.baseRadius, rect.width / 2), insetY = Math.min(TOUCH_INPUT.baseRadius, rect.height / 2);
        element.style.setProperty('--stick-x', `${clamp(event.clientX - rect.left, insetX, rect.width - insetX)}px`);
        element.style.setProperty('--stick-y', `${clamp(event.clientY - rect.top, insetY, rect.height - insetY)}px`);
        element.style.setProperty('--knob-x', '0px'); element.style.setProperty('--knob-y', '0px'); element.dataset.touchActive = 'true';
        this.state.command({ type: 'move', x: 0, y: 0 });
      } else this.command({ type: control });
      finger.role = control; finger.target = element;
    } else if (touch && target && this.host.contains(target)) {
      event.preventDefault(); finger.role = 'canvas'; finger.target = this.host;
    } else return;
    try { finger.target.setPointerCapture(finger.id); } catch { /* Window release/cancel still terminates synthetic or uncaptured input. */ }
  }
  private move(event: PointerEvent): void {
    const finger = this.fingers.get(event.pointerId);
    if (!finger) return;
    if (!this.accepting()) { this.clear(); return; }
    const dx = event.clientX - finger.startX, dy = event.clientY - finger.startY, distance = Math.hypot(dx, dy);
    finger.maximumDistance = Math.max(finger.maximumDistance, distance);
    if (finger.role !== 'other') event.preventDefault();
    if (finger.role !== 'stick' || finger.id !== this.stickPointer || !finger.target) return;
    const length = Math.max(1, distance / TOUCH_INPUT.stickRadius);
    finger.target.style.setProperty('--knob-x', `${dx / length}px`); finger.target.style.setProperty('--knob-y', `${dy / length}px`);
    this.state.command({ type: 'move', x: dx / TOUCH_INPUT.stickRadius, y: dy / TOUCH_INPUT.stickRadius });
  }
  private up(event: PointerEvent): void {
    const finger = this.fingers.get(event.pointerId);
    if (!finger) return;
    const active = this.accepting();
    finger.maximumDistance = Math.max(finger.maximumDistance, Math.hypot(event.clientX - finger.startX, event.clientY - finger.startY));
    const tap = active && finger.role === 'canvas' && finger.tapEligible && this.fingers.size === 1
      && finger.maximumDistance <= TOUCH_INPUT.tapDistance && event.timeStamp - finger.downAt <= TOUCH_INPUT.tapMilliseconds;
    this.fingers.delete(finger.id); // Normal release must not be mistaken for an unexpected lost capture.
    if (finger.role === 'stick' && this.stickPointer === finger.id) {
      this.stickPointer = null; this.state.command({ type: 'move', x: 0, y: 0 }); this.resetStick(finger.target);
    }
    this.release(finger);
    if (tap) {
      const rect = this.host.getBoundingClientRect(), scale = Math.min(rect.width / VIEW.width, rect.height / VIEW.height);
      if (scale > 0) {
        const x = event.clientX - rect.left - (rect.width - VIEW.width * scale) / 2, y = event.clientY - rect.top - (rect.height - VIEW.height * scale) / 2;
        if (x >= 0 && x <= VIEW.width * scale && y >= 0 && y <= VIEW.height * scale) {
          const world = this.callbacks.world();
          this.command({ type: 'lock', x: world.camera.x - VIEW.width / 2 + x / scale, y: world.camera.y - VIEW.height / 2 + y / scale, radius: TOUCH_INPUT.tapRadius / scale });
        }
      }
    }
    if (finger.role !== 'other') event.preventDefault();
  }
  private resetStick(element: HTMLElement | null): void {
    if (!element) return;
    element.style.setProperty('--knob-x', '0px'); element.style.setProperty('--knob-y', '0px'); delete element.dataset.touchActive;
  }
  private release(finger: Finger): void {
    try { if (finger.target?.hasPointerCapture(finger.id)) finger.target.releasePointerCapture(finger.id); } catch { /* Removed elements may already have lost capture. */ }
  }
  private interrupted(): void {
    const active = this.accepting(); this.clear();
    if (active) this.callbacks.interrupt();
  }
  clear(): void {
    const fingers = [...this.fingers.values()]; this.fingers.clear(); this.stickPointer = null;
    for (const finger of fingers) { if (finger.role === 'stick') this.resetStick(finger.target); this.release(finger); }
    this.state.clear(); this.changed();
  }
  reset(): void { this.clear(); this.state.reset(); this.changed(); }
  destroy(): void { if (this.destroyed) return; this.destroyed = true; this.abort.abort(); this.clear(); }
}
