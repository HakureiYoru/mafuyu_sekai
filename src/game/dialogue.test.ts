import { describe, expect, it } from 'vitest';
import { Dialogue } from './dialogue';

describe('continuous campaign communications', () => {
  it('opens without inherited-season instructions and preserves paused dialogue time', () => {
    const dialogue = new Dialogue(); dialogue.start();
    const line = dialogue.getMessage(true)!.text;
    expect(line).not.toMatch(/第一季|继承|选好模块/);
    expect(dialogue.getMessage(true)?.text).toBe(line);
    dialogue.update(6);
    expect(dialogue.getMessage(true)).toBeNull();
  });
  it('names encounters by their identity and resets to a fresh campaign', () => {
    const dialogue = new Dialogue(); dialogue.start();
    dialogue.handle([{ type: 'attack', text: 'arrival', enemyType: 'palisade', x: 0, y: 0 }], 0);
    expect(dialogue.getMessage(true)?.text).toContain('PALISADE');
    dialogue.handle([{ type: 'boss', encounterId: 's2:final', x: 0, y: 0 }], 0);
    expect(dialogue.getMessage(true)?.text).toContain('LACUNA');
    dialogue.handle([{ type: 'card', text: '内外环交替', x: 0, y: 0 }], 0);
    expect(dialogue.getMessage(true)?.text).toContain('内外环交替');
    dialogue.handle([{ type: 'complete', seasonId: 's2', x: 0, y: 0 }], 0);
    expect(dialogue.getMessage(true)?.text).toContain('Wonderhoy');
    dialogue.start(); dialogue.handle([{ type: 'complete', x: 0, y: 0 }], 0);
    expect(dialogue.getMessage(true)?.text).toContain('Wonderhoy');
  });
});
