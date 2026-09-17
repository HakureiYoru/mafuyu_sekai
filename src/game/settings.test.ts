import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_SETTINGS, DEFAULT_KEYBINDINGS, isBindableKey, keyLabel, normalizeKeybindings, normalizeSettings, rebindKey } from './settings';

describe('settings migration and physical-key bindings', () => {
  it('preserves legacy preferences and supplies only the newly introduced defaults', () => {
    const legacy = { quality: 'low', masterVolume: 0.2, musicVolume: 0, sfxVolume: 0.4, screenShake: 0, reducedMotion: true };
    const settings = normalizeSettings(legacy);
    expect(settings).toMatchObject({ ...legacy, damageNumbers: 'all' });
    expect(settings.keybindings).toEqual(DEFAULT_KEYBINDINGS);
    settings.keybindings.dash = 'KeyB'; expect(DEFAULT_KEYBINDINGS.dash).toBe('KeyR');
  });

  it('rejects malformed values without making silent strings or NaN into stored settings', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_GAME_SETTINGS);
    expect(normalizeSettings([])).toEqual(DEFAULT_GAME_SETTINGS);
    expect(normalizeSettings({ quality: 'ultra', masterVolume: Infinity, musicVolume: '0', sfxVolume: -4, screenShake: 4,
      reducedMotion: 'false', damageNumbers: 'secret', keybindings: { dash: 'Escape', bomb: 'Digit1' } }))
      .toEqual({ ...DEFAULT_GAME_SETTINGS, sfxVolume: 0, screenShake: 1 });
  });

  it('swaps duplicate assignments, preserves every action, and does not mutate the caller', () => {
    const previous = { ...DEFAULT_KEYBINDINGS }, moved = rebindKey(previous, 'dash', 'Space');
    expect(moved.dash).toBe('Space'); expect(moved.bomb).toBe('KeyR');
    expect(previous).toEqual(DEFAULT_KEYBINDINGS); expect(new Set(Object.values(moved)).size).toBe(7);
    expect(rebindKey(moved, 'bomb', 'Digit2')).toEqual(moved);
    expect(normalizeKeybindings(moved)).toEqual(moved);
  });

  it('handles partial settings updates and invalid duplicate saved maps deterministically', () => {
    const base = normalizeSettings({ damageNumbers: 'off', musicVolume: 0.1, keybindings: { dash: 'KeyB' } });
    const changed = normalizeSettings({ screenShake: 0.9, keybindings: { bomb: 'KeyB' } }, base);
    expect(changed).toMatchObject({ damageNumbers: 'off', musicVolume: 0.1, screenShake: 0.9 });
    expect(changed.keybindings).toMatchObject({ bomb: 'KeyB', dash: 'Space' });
    expect(base.keybindings).toMatchObject({ bomb: 'Space', dash: 'KeyB' });
    const corrupted = { moveUp: 'KeyQ', moveDown: 'KeyQ', dash: 'KeyQ', bomb: 'not-a-key' };
    expect(normalizeKeybindings(corrupted)).toEqual(normalizeKeybindings(corrupted));
    expect(new Set(Object.values(normalizeKeybindings(corrupted))).size).toBe(7);
  });

  it('drops removed Q/E actions while preserving remaining custom keys', () => {
    const migrated = normalizeSettings({ keybindings: { moveUp: 'ArrowUp', dash: 'KeyQ', focus: 'KeyE', beam: 'KeyB', command: 'KeyC' } });
    expect(migrated.keybindings).toMatchObject({ moveUp: 'ArrowUp', dash: 'KeyQ', focus: 'KeyE' });
    expect(Object.keys(migrated.keybindings)).toHaveLength(7);
    expect(migrated.keybindings).not.toHaveProperty('beam');
    expect(migrated.keybindings).not.toHaveProperty('command');
  });

  it('keeps menu shortcuts reserved and presents physical key labels', () => {
    for (const code of ['Escape', 'Digit1', 'Digit2', 'Digit3', 'MetaLeft', 'AltLeft', 'Tab', 'Keyé']) expect(isBindableKey(code)).toBe(false);
    for (const code of ['KeyQ', 'KeyZ', 'Digit4', 'Space', 'ArrowUp', 'ShiftRight', 'Numpad1']) expect(isBindableKey(code)).toBe(true);
    expect(keyLabel('KeyQ')).toBe('Q'); expect(keyLabel('ShiftLeft')).toBe('左 Shift'); expect(keyLabel('Space')).toBe('空格');
  });
});
