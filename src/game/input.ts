import { VIEW } from './config';
import { DEFAULT_KEYBINDINGS, normalizeKeybindings } from './settings';
import type { BindingAction, KeyBindings } from './settings';
import type { InputAction } from './types';

/** Browser-independent input state. Discrete actions are consumed exactly once. */
export class InputState {
  readonly keys = new Set<string>();
  shoot = false;
  pointerX = VIEW.width / 2;
  pointerY = VIEW.height / 2;
  private dash = false;
  private bomb = false;
  protected bindings: KeyBindings;
  constructor(bindings: KeyBindings = DEFAULT_KEYBINDINGS) { this.bindings = normalizeKeybindings(bindings); }
  setBindings(bindings: KeyBindings): void { this.clear(); this.bindings = normalizeKeybindings(bindings); }
  private focusAlias(code: string): boolean {
    const other = this.bindings.focus === 'ShiftLeft' ? 'ShiftRight' : this.bindings.focus === 'ShiftRight' ? 'ShiftLeft' : '';
    return code === other && !Object.values(this.bindings).includes(other);
  }
  handlesKey(code: string): boolean { return Object.values(this.bindings).includes(code) || this.focusAlias(code); }
  private held(action: BindingAction): boolean {
    return this.keys.has(this.bindings[action]) || (action === 'focus' && [...this.keys].some(code => this.focusAlias(code)));
  }
  keyDown(code: string, repeat = false) {
    if (repeat || this.keys.has(code) || !this.handlesKey(code)) return;
    this.keys.add(code);
    if (code === this.bindings.dash) this.dash = true;
    if (code === this.bindings.bomb) this.bomb = true;
  }
  keyUp(code: string) { this.keys.delete(code); }
  requestDash() { this.dash = true; }
  read(cameraX: number, cameraY: number): InputAction {
    const result: InputAction = {
      moveX: Number(this.held('moveRight')) - Number(this.held('moveLeft')),
      moveY: Number(this.held('moveDown')) - Number(this.held('moveUp')),
      aimX: this.pointerX + cameraX, aimY: this.pointerY + cameraY,
      shoot: this.shoot, dash: this.dash, bomb: this.bomb, focus: this.held('focus'),
    };
    this.dash = false;
    this.bomb = false;
    return result;
  }
  clear() { this.keys.clear(); this.shoot = false; this.dash = false; this.bomb = false; }
}

export class InputController extends InputState {
  private readonly abort = new AbortController();
  private capturedPointer: number | null = null;
  constructor(private host: HTMLElement, private active: () => boolean, pause: () => void, togglePause: () => void, bindings: KeyBindings = DEFAULT_KEYBINDINGS) {
    super(bindings);
    const options = { signal: this.abort.signal };
    window.addEventListener('keydown', event => {
      const editing = event.target instanceof HTMLElement && !!event.target.closest('input,select,textarea,[contenteditable="true"]');
      if (event.code === 'Escape' && !event.repeat && !editing) { event.preventDefault(); this.clear(); togglePause(); return; }
      if (!this.active() || editing || !this.handlesKey(event.code)) return;
      event.preventDefault();
      this.keyDown(event.code, event.repeat);
    }, options);
    window.addEventListener('keyup', event => this.keyUp(event.code), options);
    host.addEventListener('pointermove', event => { if (event.pointerType !== 'touch' && this.active()) this.updatePointer(event); }, options);
    host.addEventListener('pointerdown', event => {
      if (!this.active() || event.pointerType === 'touch') return;
      event.preventDefault();
      this.updatePointer(event);
      if (event.button === 0) {
        this.shoot = true;
        this.releasePointer();
        try { this.host.setPointerCapture(event.pointerId); this.capturedPointer = event.pointerId; }
        catch { /* Synthetic events may not have an active pointer; global pointerup still clears fire. */ }
      }
      if (event.button === 2) this.requestDash();
    }, options);
    window.addEventListener('pointerup', event => { if (event.pointerType !== 'touch' && event.button === 0 && (this.capturedPointer === null || event.pointerId === this.capturedPointer)) { this.shoot = false; this.releasePointer(); } }, options);
    host.addEventListener('pointerleave', () => { if (this.capturedPointer === null) this.shoot = false; }, options);
    host.addEventListener('lostpointercapture', event => {
      if (event.pointerId === this.capturedPointer) { this.capturedPointer = null; this.shoot = false; }
    }, options);
    host.addEventListener('pointercancel', event => { if (event.pointerType !== 'touch') this.clear(); }, options);
    host.addEventListener('contextmenu', event => event.preventDefault(), options);
    window.addEventListener('blur', () => { this.clear(); pause(); }, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.clear(); pause(); } }, options);
  }
  private updatePointer(event: PointerEvent) {
    const rect = this.host.getBoundingClientRect();
    this.pointerX = (event.clientX - rect.left) / Math.max(1, rect.width) * VIEW.width;
    this.pointerY = (event.clientY - rect.top) / Math.max(1, rect.height) * VIEW.height;
  }
  private releasePointer(): void {
    const pointer = this.capturedPointer; this.capturedPointer = null;
    if (pointer === null) return;
    try { if (this.host.hasPointerCapture(pointer)) this.host.releasePointerCapture(pointer); }
    catch { /* A removed host or a cancelled browser pointer may have released it already. */ }
  }
  override clear(): void { this.releasePointer(); super.clear(); }
  destroy() { this.abort.abort(); this.clear(); }
}
