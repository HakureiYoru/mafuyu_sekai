import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_SETTINGS, DEFAULT_KEYBINDINGS, isBindableKey, keyLabel, normalizeKeybindings, normalizeSettings, rebindKey } from './settings';

describe('settings migration and physical-key bindings', () => {
  it('preserves legacy preferences and supplies only the newly introduced defaults', () => {
    const legacy = { quality: 'low', masterVolume: 0.2, musicVolume: 0, sfxVolume: 0.4, screenShake: 0, reducedMotion: true };
    const settings = normalizeSettings(legacy);
    expect(settings).toMatchObject({ ...legacy, damageNumbers: 'all' });
    expect(settings.keybindings).toEqual(DEFAULT_KEYBINDINGS);
    settings.keybindings.beam = 'KeyB'; expect(DEFAULT_KEYBINDINGS.beam).toBe('KeyQ');
  });

  it('rejects malformed values without making silent strings or NaN into stored settings', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_GAME_SETTINGS);
    expect(normalizeSettings([])).toEqual(DEFAULT_GAME_SETTINGS);
    expect(normalizeSettings({ quality: 'ultra', masterVolume: Infinity, musicVolume: '0', sfxVolume: -4, screenShake: 4,
      reducedMotion: 'false', damageNumbers: 'secret', keybindings: { beam: 'Escape', command: 'Digit1' } }))
      .toEqual({ ...DEFAULT_GAME_SETTINGS, sfxVolume: 0, screenShake: 1 });
  });

  it('swaps duplicate assignments, preserves every action, and does not mutate the caller', () => {
    const previous = { ...DEFAULT_KEYBINDINGS }, moved = rebindKey(previous, 'beam', 'KeyE');
    expect(moved.beam).toBe('KeyE'); expect(moved.command).toBe('KeyQ');
    expect(previous).toEqual(DEFAULT_KEYBINDINGS); expect(new Set(Object.values(moved)).size).toBe(9);
    expect(rebindKey(moved, 'command', 'Digit2')).toEqual(moved);
    expect(normalizeKeybindings(moved)).toEqual(moved);
  });

  it('handles partial settings updates and invalid duplicate saved maps deterministically', () => {
    const base = normalizeSettings({ damageNumbers: 'off', musicVolume: 0.1, keybindings: { beam: 'KeyB' } });
    const changed = normalizeSettings({ screenShake: 0.9, keybindings: { command: 'KeyB' } }, base);
    expect(changed).toMatchObject({ damageNumbers: 'off', musicVolume: 0.1, screenShake: 0.9 });
    expect(changed.keybindings).toMatchObject({ command: 'KeyB', beam: 'KeyE' });
    expect(base.keybindings).toMatchObject({ command: 'KeyE', beam: 'KeyB' });
    const corrupted = { moveUp: 'KeyQ', moveDown: 'KeyQ', beam: 'KeyQ', command: 'not-a-key' };
    expect(normalizeKeybindings(corrupted)).toEqual(normalizeKeybindings(corrupted));
    expect(new Set(Object.values(normalizeKeybindings(corrupted))).size).toBe(9);
  });

  it('keeps menu shortcuts reserved and presents physical key labels', () => {
    for (const code of ['Escape', 'Digit1', 'Digit2', 'Digit3', 'MetaLeft', 'AltLeft', 'Tab', 'Keyé']) expect(isBindableKey(code)).toBe(false);
    for (const code of ['KeyQ', 'KeyZ', 'Digit4', 'Space', 'ArrowUp', 'ShiftRight', 'Numpad1']) expect(isBindableKey(code)).toBe(true);
    expect(keyLabel('KeyQ')).toBe('Q'); expect(keyLabel('ShiftLeft')).toBe('左 Shift'); expect(keyLabel('Space')).toBe('空格');
  });
});
