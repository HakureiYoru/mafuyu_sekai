import { describe, expect, it } from 'vitest';
import { Dialogue } from './dialogue';

describe('season-specific communications', () => {
  it('introduces all six mirror stages and preserves paused dialogue time', () => {
    const dialogue = new Dialogue(); dialogue.start('s2');
    expect(dialogue.getMessage(true)?.text).toContain('第一季');
    const lines: string[] = [];
    for (let stage = 1; stage <= 6; stage++) {
      dialogue.handle([{ type: 'wave', amount: stage, seasonId: 's2', x: 0, y: 0 }], 0);
      const line = dialogue.getMessage(true)!.text; lines.push(line);
      expect(dialogue.getMessage(true)?.text).toBe(line);
    }
    expect(new Set(lines).size).toBe(6);
    expect(lines[0]).toContain('护盾'); expect(lines[2]).toContain('印记'); expect(lines[5]).toContain('终章');
  });
  it('names second-season bosses and cards, then resets back to original first-season dialogue', () => {
    const dialogue = new Dialogue(); dialogue.start('s2');
    dialogue.handle([{ type: 'attack', text: 'arrival', enemyType: 'palisade', x: 0, y: 0 }], 0);
    expect(dialogue.getMessage(true)?.text).toContain('PALISADE');
    dialogue.handle([{ type: 'boss', x: 0, y: 0 }], 0);
    expect(dialogue.getMessage(true)?.text).toContain('LACUNA');
    dialogue.handle([{ type: 'card', text: '内外环交替', x: 0, y: 0 }], 0);
    expect(dialogue.getMessage(true)?.text).toContain('内外环交替');
    dialogue.handle([{ type: 'complete', seasonId: 's2', x: 0, y: 0 }], 0);
    expect(dialogue.getMessage(true)?.text).toContain('两个世界');
    dialogue.start('s1'); dialogue.handle([{ type: 'complete', seasonId: 's1', x: 0, y: 0 }], 0);
    expect(dialogue.getMessage(true)?.text).toContain('Wonderhoy');
  });
});
