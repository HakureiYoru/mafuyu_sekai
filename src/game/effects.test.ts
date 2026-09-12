import { afterEach, describe, expect, it } from 'vitest';
import { Texture } from 'pixi.js';
import { EffectSystem } from './effects';
import { DEFAULT_GAME_SETTINGS } from './settings';
import type { GameSettings } from './types';

const systems: EffectSystem[] = [];
function create(settings: Partial<GameSettings> = {}) {
  const system = new EffectSystem({ glow: Texture.EMPTY, spark: Texture.EMPTY, ring: Texture.EMPTY, player: Texture.EMPTY }, { ...DEFAULT_GAME_SETTINGS, ...settings });
  systems.push(system); return system;
}
const labels = (system: EffectSystem) => system.labels.children.filter(label => label.visible).map(label => (label as unknown as { text: string }).text);
afterEach(() => { systems.splice(0).forEach(system => system.destroy()); });

describe('combat feedback semantics and bounded effects', () => {
  it('keeps directional impacts aligned and reflects shield sparks against the shot', () => {
    const system = create();
    system.handle({ type: 'hit', hitResult: 'body', x: 0, y: 0, angle: Math.PI, amount: 2 });
    system.update(1 / 60);
    expect(system.particles.children.filter(sprite => sprite.visible).every(sprite => sprite.x < 0)).toBe(true);
    system.reset();
    system.handle({ type: 'hit', hitResult: 'shield', x: 0, y: 0, angle: Math.PI, amount: 0.5 });
    system.update(1 / 60);
    expect(system.particles.children.filter(sprite => sprite.visible).every(sprite => sprite.x > 0)).toBe(true);
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
    expect(system.particles.children.some(sprite => sprite.visible && Math.abs(sprite.width * 59 / 128 - 140) < 0.01)).toBe(true);
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
    expect(system.labelTextureCount).toBe(36);
  });

  it.each(['low', 'medium', 'high'] as const)('keeps %s particle budget bounded and gives beam feedback space at capacity', quality => {
    const system = create({ quality });
    system.debugStress(0, 0);
    const before = system.count;
    system.handle({ type: 'beam', x: 0, y: 0, angle: 0 });
    expect(system.count).toBeGreaterThanOrEqual(before);
    expect(system.count).toBeLessThanOrEqual(quality === 'low' ? 300 : quality === 'medium' ? 900 : 1600);
    expect(system.particles.children.some(sprite => sprite.visible && sprite.x === 44)).toBe(true);
    const pooled = system.particles.children.length;
    for (let i = 0; i < 20; i++) { system.reset(); system.debugStress(0, 0); system.handle({ type: 'beam', x: 0, y: 0 }); }
    expect(system.particles.children.length).toBe(pooled);
    system.reset(); expect(system.count).toBe(0); expect(labels(system)).toEqual([]);
  });

  it('reduced motion preserves critical feedback without portrait trails or label bounce', () => {
    const system = create({ reducedMotion: true });
    system.trail(0, 0, 0); expect(system.count).toBe(0);
    system.handle({ type: 'command', text: 'issued', x: 0, y: 0 }); system.update(1 / 60);
    expect(labels(system)).toEqual(['子机集火']);
    expect(system.labels.children[0].scale.x).toBe(1);
  });
});
