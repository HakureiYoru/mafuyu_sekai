import { VIEW } from './config';
import type { InputAction } from './types';

/** Browser-independent input state. Discrete actions are consumed exactly once. */
export class InputState {
  readonly keys = new Set<string>();
  shoot = false;
  pointerX = VIEW.width / 2;
  pointerY = VIEW.height / 2;
  private dash = false;
  private bomb = false;
  keyDown(code: string, repeat = false) {
    if (repeat || this.keys.has(code)) return;
    this.keys.add(code);
    if (code === 'KeyR') this.dash = true;
    if (code === 'Space') this.bomb = true;
  }
  keyUp(code: string) { this.keys.delete(code); }
  requestDash() { this.dash = true; }
  read(cameraX: number, cameraY: number): InputAction {
    const result: InputAction = {
      moveX: Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')),
      moveY: Number(this.keys.has('KeyS')) - Number(this.keys.has('KeyW')),
      aimX: this.pointerX + cameraX, aimY: this.pointerY + cameraY,
      shoot: this.shoot, dash: this.dash, bomb: this.bomb, focus: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
    };
    this.dash = false;
    this.bomb = false;
    return result;
  }
  clear() { this.keys.clear(); this.shoot = false; this.dash = false; this.bomb = false; }
}

export class InputController extends InputState {
  private readonly abort = new AbortController();
  constructor(private host: HTMLElement, private active: () => boolean, pause: () => void, togglePause: () => void) {
    super();
    const options = { signal: this.abort.signal };
    const gameKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'Space', 'ShiftLeft', 'ShiftRight']);
    window.addEventListener('keydown', event => {
      const editing = event.target instanceof HTMLElement && !!event.target.closest('input,select,textarea,[contenteditable="true"]');
      if (event.code === 'Escape' && !event.repeat && !editing) { event.preventDefault(); togglePause(); return; }
      if (!this.active() || editing || !gameKeys.has(event.code)) return;
      event.preventDefault();
      this.keyDown(event.code, event.repeat);
    }, options);
    window.addEventListener('keyup', event => this.keyUp(event.code), options);
    host.addEventListener('pointermove', event => this.updatePointer(event), options);
    host.addEventListener('pointerdown', event => {
      if (!this.active()) return;
      event.preventDefault();
      this.updatePointer(event);
      if (event.button === 0) this.shoot = true;
      if (event.button === 2) this.requestDash();
    }, options);
    window.addEventListener('pointerup', event => { if (event.button === 0) this.shoot = false; }, options);
    host.addEventListener('pointerleave', () => { this.shoot = false; }, options);
    host.addEventListener('pointercancel', () => this.clear(), options);
    host.addEventListener('contextmenu', event => event.preventDefault(), options);
    window.addEventListener('blur', () => { this.clear(); pause(); }, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.clear(); pause(); } }, options);
  }
  private updatePointer(event: PointerEvent) {
    const rect = this.host.getBoundingClientRect();
    this.pointerX = (event.clientX - rect.left) / Math.max(1, rect.width) * VIEW.width;
    this.pointerY = (event.clientY - rect.top) / Math.max(1, rect.height) * VIEW.height;
  }
  destroy() { this.abort.abort(); this.clear(); }
}
