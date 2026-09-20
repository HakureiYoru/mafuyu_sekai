import { afterEach, describe, expect, it, vi } from 'vitest';
import { BitmapFontManager, BitmapText, Text, Texture, type BitmapFont } from 'pixi.js';
import { EffectSystem, EFFECT_NUMBER_CHARS, EFFECT_NUMBER_FONT, retainEffectNumberFont } from './effects';
import { DEFAULT_GAME_SETTINGS } from './settings';
import type { GameSettings } from './types';

const systems: EffectSystem[] = [];
function create(settings: Partial<GameSettings> = {}) {
  const system = new EffectSystem({ glow: Texture.EMPTY, spark: Texture.EMPTY, ring: Texture.EMPTY, player: Texture.EMPTY }, { ...DEFAULT_GAME_SETTINGS, ...settings });
  systems.push(system); return system;
}
const labels = (system: EffectSystem) => system.labels.children.filter(label => label.visible).map(label => (label as unknown as { text: string }).text);
afterEach(() => { systems.splice(0).forEach(system => system.destroy()); vi.restoreAllMocks(); });

describe('combat feedback semantics and bounded effects', () => {
  it('keeps directional impacts aligned and reflects shield sparks against the shot', () => {
    const system = create();
    system.handle({ type: 'hit', hitResult: 'body', x: 0, y: 0, angle: Math.PI, amount: 2 });
    system.update(1 / 60);
    expect(system.particlePositions.every(sprite => sprite.x < 0)).toBe(true);
    system.reset();
    system.handle({ type: 'hit', hitResult: 'shield', x: 0, y: 0, angle: Math.PI, amount: 0.5 });
    system.update(1 / 60);
    expect(system.particlePositions.every(sprite => sprite.x > 0)).toBe(true);
  });

  it('filters damage digits while preserving important outcomes and truthful XP loss', () => {
    const system = create({ damageNumbers: 'important' });
    system.handle({ type: 'hit', x: 0, y: 0, amount: 2, targetId: 1, hitResult: 'body' });
    system.handle({ type: 'hit', x: 0, y: 0, amount: 4, targetId: 2, hitResult: 'weakpoint' });
    expect(labels(system)).toEqual(['4']);
    system.setSettings({ ...DEFAULT_GAME_SETTINGS, damageNumbers: 'off' });
    system.handle({ type: 'xpLoss', x: 0, y: 0, amount: 38 });
    system.handle({ type: 'interrupt', x: 0, y: 0 });
    expect(labels(system)).toEqual(['经验 −38', '打断']);
    system.handle({ type: 'leveldown', x: 0, y: 0, text: 'XP LOST' });
    expect(labels(system)).not.toContain('武装降级');
  });

  it('aggregates repeated numbers by target instead of allocating one text per bullet', () => {
    const system = create();
    for (let i = 0; i < 30; i++) system.handle({ type: 'hit', x: 0, y: 0, amount: 2, targetId: 1 });
    system.update(0.05); system.update(0.05);
    expect(labels(system)).toEqual(['60']);
    expect(system.labelTextureCount).toBe(1);
  });

  it('coalesces a three-drone arrival into the final count instead of covering the player with three labels', () => {
    const system = create();
    for (let amount = 1; amount <= 3; amount++) system.handle({ type: 'support', text: 'deployed', x: amount * 30, y: 0, amount });
    expect(labels(system)).toEqual(['子机接入 3/3']);
    expect(system.labelTextureCount).toBe(1);
  });

  it('shows disabled nodes as temporary shutdown and broken arms as component destruction', () => {
    const system = create({ damageNumbers: 'off' });
    system.handle({ type: 'kill', hitResult: 'part', enemyType: 'node', x: 0, y: 0 });
    system.handle({ type: 'kill', hitResult: 'part', enemyType: 'arm', x: 200, y: 0 });
    expect(labels(system)).toEqual(['节点停机', '部件击破']);
  });

  it('keeps shield fractions and weakpoint health separate from ordinary body damage', () => {
    const system = create();
    system.handle({ type: 'hit', hitResult: 'shield', targetId: 1, amount: 0.5, x: 0, y: 0 });
    system.handle({ type: 'hit', hitResult: 'body', targetId: 1, amount: 2, x: 0, y: 0 });
    system.handle({ type: 'hit', hitResult: 'weakpoint', targetId: 1, amount: 2, x: 0, y: 0 });
    expect(labels(system)).toEqual(['0.5', '2', '2']);
  });

  it('retains the full device blast footprint in reduced motion and names resonance loss and card completion accurately', () => {
    const system = create({ reducedMotion: true, quality: 'low' });
    system.handle({ type: 'attack', text: 'deviceBurst', x: 0, y: 0, amount: 140 });
    expect(system.particlePositions.some(sprite => Math.abs(sprite.width * 59 / 128 - 140) < 0.01)).toBe(true);
    system.handle({ type: 'xpLoss', text: '共鸣经验', amount: 24, x: 0, y: 0 });
    system.handle({ type: 'card', text: 'cleared', amount: 2, x: 0, y: 0 });
    expect(labels(system)).toEqual(['共鸣经验 −24', '符卡 2 击破']);
  });

  it('reserves space and preempts ordinary damage numbers for critical messages', () => {
    const system = create();
    for (let i = 0; i < 80; i++) system.handle({ type: 'hit', x: 0, y: 0, amount: 2, targetId: i });
    expect(labels(system)).toHaveLength(32);
    for (let i = 0; i < 5; i++) system.handle({ type: 'shieldBreak', x: i, y: 0 });
    expect(labels(system)).toHaveLength(36);
    expect(labels(system).filter(text => text === '护盾击破')).toHaveLength(5);
    expect(system.labels.children).toHaveLength(36);
    expect(system.labelTextureCount).toBe(6); // Five fixed messages and one shared numeric atlas.
  });

  it.each(['low', 'medium', 'high'] as const)('keeps %s particle budget bounded and gives beam feedback space at capacity', quality => {
    const system = create({ quality });
    system.debugStress(0, 0);
    const before = system.count;
    system.handle({ type: 'beam', x: 0, y: 0, angle: 0 });
    expect(system.count).toBeGreaterThanOrEqual(before);
    expect(system.count).toBeLessThanOrEqual(quality === 'low' ? 300 : quality === 'medium' ? 900 : 1600);
    expect(system.particlePositions.some(sprite => sprite.x === 44)).toBe(true);
    const pooled = system.allocatedParticles;
    for (let i = 0; i < 20; i++) { system.reset(); system.debugStress(0, 0); system.handle({ type: 'beam', x: 0, y: 0 }); }
    expect(system.allocatedParticles).toBe(pooled);
    system.reset(); expect(system.count).toBe(0); expect(labels(system)).toEqual([]);
  });

  it('reduced motion preserves critical feedback without portrait trails or label bounce', () => {
    const system = create({ reducedMotion: true });
    system.trail(0, 0, 0); expect(system.count).toBe(0);
    system.handle({ type: 'module', moduleId: 'orbitBlade', x: 0, y: 0 }); system.update(1 / 60);
    expect(labels(system)).toEqual(['轨道护刃']);
    expect(system.labels.children[0].scale.x).toBe(1);
  });

  it('reuses one bitmap label for ten thousand distinct numeric strings without creating canvas Text', () => {
    const system = create(); let first: unknown;
    for (let index = 0; index < 10000; index++) {
      system.reset(); system.handle({ type: 'hit', x: 0, y: 0, amount: 1 + index / 10, targetId: 1 });
      const label = system.labels.children[0] as BitmapText;
      first ??= label; expect(label).toBe(first); expect(label).toBeInstanceOf(BitmapText);
      expect(label.style.fontFamily).toBe(EFFECT_NUMBER_FONT);
      expect([...label.text].every(character => EFFECT_NUMBER_CHARS.includes(character))).toBe(true);
    }
    expect(system.labels.children).toHaveLength(1);
    expect(system.labels.children.some(label => label instanceof Text)).toBe(false);
    expect(system.labelTextureCount).toBe(1);
  });

  it('routes every varying numeric prefix to the finite glyph set and keeps fixed Chinese as Text', () => {
    const system = create();
    system.handle({ type: 'xpLoss', text: '共鸣经验', x: 0, y: 0, amount: 987654321 });
    system.handle({ type: 'heal', x: 0, y: 0, amount: 12345 });
    system.handle({ type: 'pickup', pickupType: 'hp', x: 0, y: 0, amount: 67890 });
    system.handle({ type: 'pickup', pickupType: 'bomb', x: 0, y: 0, amount: 10 });
    system.handle({ type: 'pickup', pickupType: 'supply', text: '满额转换经验 +10000', x: 0, y: 0, amount: 10000 });
    system.handle({ type: 'pickup', pickupType: 'support', text: '子机已满 · 转为经验', x: 0, y: 0, amount: 10000 });
    system.handle({ type: 'levelup', x: 0, y: 0, amount: 10 });
    system.handle({ type: 'support', text: 'deployed', x: 0, y: 0, amount: 3 });
    system.handle({ type: 'card', text: 'cleared', x: 0, y: 0, amount: 6 });
    system.handle({ type: 'module', text: '第10000波', x: 0, y: 0 });
    for (const child of system.labels.children) {
      expect(child).toBeInstanceOf(BitmapText);
      expect([...(child as BitmapText).text].every(character => EFFECT_NUMBER_CHARS.includes(character))).toBe(true);
      expect((child as BitmapText).text).not.toContain('?');
    }
    system.handle({ type: 'interrupt', x: 0, y: 0 });
    expect(system.labels.children.at(-1)).toBeInstanceOf(Text);
    expect(labels(system)).toContain('共鸣经验 −987654321');
    expect(labels(system)).toContain('炸弹 +1');
    expect(labels(system)).toContain('血药 +67890');
    expect(labels(system)).toContain('满额转换经验 +10000');
  });

  it('shares and releases the public font installation across renderer lifetimes', () => {
    const install = vi.spyOn(BitmapFontManager, 'install').mockReturnValue({ pages: [{}] } as BitmapFont);
    const uninstall = vi.spyOn(BitmapFontManager, 'uninstall').mockImplementation(() => undefined);
    const a = retainEffectNumberFont(), b = retainEffectNumberFont();
    try {
      expect(install).toHaveBeenCalledTimes(1);
      expect(install).toHaveBeenCalledWith(expect.objectContaining({ name: EFFECT_NUMBER_FONT, chars: EFFECT_NUMBER_CHARS, dynamicFill: true }));
      a(); a(); expect(uninstall).not.toHaveBeenCalled();
      b(); expect(uninstall).toHaveBeenCalledExactlyOnceWith(EFFECT_NUMBER_FONT);
    } finally { a(); b(); }
  });
});
