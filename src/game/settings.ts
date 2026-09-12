import type { GameSettings } from './types';

export type BindingAction = 'moveUp' | 'moveDown' | 'moveLeft' | 'moveRight' | 'dash' | 'bomb' | 'focus' | 'beam' | 'command';
export type KeyBindings = Record<BindingAction, string>;
export type DamageNumberMode = 'all' | 'important' | 'off';

export const BINDING_LABELS: Readonly<Record<BindingAction, string>> = {
  moveUp: '向上移动', moveDown: '向下移动', moveLeft: '向左移动', moveRight: '向右移动',
  dash: '冲刺', bomb: '炸弹', focus: '慢速瞄准', beam: '贯穿炮', command: '子机指令',
};
export const DEFAULT_KEYBINDINGS: Readonly<KeyBindings> = Object.freeze({
  moveUp: 'KeyW', moveDown: 'KeyS', moveLeft: 'KeyA', moveRight: 'KeyD',
  dash: 'KeyR', bomb: 'Space', focus: 'ShiftLeft', beam: 'KeyQ', command: 'KeyE',
});
export const DEFAULT_GAME_SETTINGS: Readonly<GameSettings> = Object.freeze({
  quality: 'medium', masterVolume: 0.7, musicVolume: 0.45, sfxVolume: 0.65, screenShake: 0.45,
  reducedMotion: false, damageNumbers: 'all', keybindings: DEFAULT_KEYBINDINGS,
});
const actions = Object.keys(DEFAULT_KEYBINDINGS) as BindingAction[];
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Physical keys only: browser/system modifiers and the game's menu keys stay reserved. */
export function isBindableKey(code: string): boolean {
  if (['Digit1', 'Digit2', 'Digit3'].includes(code)) return false;
  return /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right)|Control(Left|Right)|Enter|Backspace|CapsLock|Bracket(Left|Right)|Semicolon|Quote|Comma|Period|Slash|Backslash|Minus|Equal|Backquote|Numpad[0-9]|Numpad(Add|Subtract|Multiply|Divide|Decimal|Enter))$/.test(code);
}

/** A binding change moves the displaced action to this action's previous key. */
export function rebindKey(bindings: KeyBindings, action: BindingAction, code: string): KeyBindings {
  const next = { ...bindings };
  if (!actions.includes(action) || !isBindableKey(code)) return next;
  const displaced = actions.find(candidate => candidate !== action && next[candidate] === code);
  if (displaced) next[displaced] = next[action];
  next[action] = code;
  return next;
}

export function normalizeKeybindings(value: unknown, base: KeyBindings = DEFAULT_KEYBINDINGS): KeyBindings {
  const source = record(value);
  let result = { ...base };
  for (const action of actions) {
    const code = source[action];
    if (typeof code === 'string' && isBindableKey(code)) result = rebindKey(result, action, code);
  }
  return result;
}

/** Accepts both a legacy saved object and a partial settings update without sharing nested state. */
export function normalizeSettings(value: unknown, base: GameSettings = DEFAULT_GAME_SETTINGS): GameSettings {
  const source = record(value);
  const number = (key: 'masterVolume' | 'musicVolume' | 'sfxVolume' | 'screenShake') => {
    const value = source[key];
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : base[key];
  };
  return {
    quality: source.quality === 'low' || source.quality === 'medium' || source.quality === 'high' ? source.quality : base.quality,
    masterVolume: number('masterVolume'), musicVolume: number('musicVolume'), sfxVolume: number('sfxVolume'), screenShake: number('screenShake'),
    reducedMotion: typeof source.reducedMotion === 'boolean' ? source.reducedMotion : base.reducedMotion,
    damageNumbers: source.damageNumbers === 'all' || source.damageNumbers === 'important' || source.damageNumbers === 'off' ? source.damageNumbers : base.damageNumbers,
    keybindings: normalizeKeybindings(source.keybindings, base.keybindings),
  };
}

export function keyLabel(code: string): string {
  const names: Record<string, string> = { Space: '空格', ShiftLeft: '左 Shift', ShiftRight: '右 Shift', ControlLeft: '左 Ctrl', ControlRight: '右 Ctrl',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'Caps Lock',
    BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`' };
  return names[code] ?? code.replace(/^Key|^Digit/, '').replace(/^Numpad/, '小键盘 ');
}
