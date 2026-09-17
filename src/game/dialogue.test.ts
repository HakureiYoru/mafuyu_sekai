import { describe, expect, it } from 'vitest';
import { Dialogue } from './dialogue';
import dialogueData from './data/dialogue.json';
import type { CombatEvent, EnemyType } from './types';

describe('continuous campaign communications', () => {
  it('opens without inherited-season instructions and preserves paused dialogue time', () => {
    const dialogue = new Dialogue(); dialogue.start();
    const line = dialogue.getMessage(true)!.text;
    expect(line).not.toMatch(/第一季|继承|选好模块/);
    expect(dialogue.getMessage(true)?.text).toBe(line);
    dialogue.update(2);
    expect(dialogue.getMessage(true)?.speaker).toBe('MAFUYU');
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
  it('keeps all authored lines short with correct character portraits and score placeholders', () => {
    const lines = Object.values(dialogueData).flat();
    expect(new Set(lines.map(line => line.id)).size).toBe(lines.length);
    expect(lines.every(line => line.text.length <= 48)).toBe(true);
    expect(lines.every(line => ['EMU', 'MAFUYU'].includes(line.sender))).toBe(true);
    const dialogue = new Dialogue(); dialogue.start();
    expect(dialogue.getMessage(true)).toMatchObject({ speaker: 'EMU', avatar: 'player' });
    dialogue.handle([{ type: 'failure', x: 0, y: 0 }], 12345);
    expect(dialogue.getMessage(true)?.text).toContain('12345');
    expect(dialogue.getMessage(true)?.text).not.toContain('{score}');
  });
  it.each([
    ['s1:echo', 'miniboss', 'ECHO'],
    ['s2:palisade', 'palisade', 'PALISADE'],
    ['s2:reprise', 'reprise', 'REPRISE'],
    ['s2:final', 'boss', 'LACUNA'],
  ] as const)('announces %s without a generic mob line replacing the entrance', (encounterId, enemyType, name) => {
    const dialogue = new Dialogue(); dialogue.start();
    dialogue.handle([{ type: 'attack', text: 'arrival', encounterId, enemyType, x: 0, y: 0 }], 0);
    const entrance = dialogue.getMessage(true);
    expect(entrance?.text).toContain(name);
    dialogue.update(2);
    dialogue.handle([{ type: enemyType === 'boss' ? 'boss' : 'spawn', encounterId, enemyType, x: 0, y: 0 }], 0);
    expect(dialogue.getMessage(true)).toEqual(entrance);
    dialogue.update(4);
    expect(dialogue.getMessage(true)).toBeNull();
  });
  it('translates card completion and encounter completion instead of displaying event codes', () => {
    const dialogue = new Dialogue(); dialogue.start();
    dialogue.handle([{ type: 'card', text: 'cleared', encounterId: 's1:mafuyu', enemyType: 'boss', x: 0, y: 0 }], 0);
    expect(dialogue.getMessage(true)?.text).toBe(dialogueData.CARD_CLEARED[0].text);
    dialogue.handle([{ type: 'attack', text: 'encounterCleared', encounterId: 's1:mafuyu', x: 0, y: 0 }], 0);
    expect(dialogue.getMessage(true)?.text).toBe(dialogueData.ENCOUNTER_CLEARED[0].text);
  });
  it('does not give mines, cores, parts, or defeated bosses ordinary-mob dialogue', () => {
    const dialogue = new Dialogue(); dialogue.start();
    const opening = dialogue.getMessage(true);
    const types: EnemyType[] = ['mine', 'core', 'arm', 'node', 'miniboss', 'palisade', 'reprise', 'boss'];
    const events = types.flatMap(enemyType => [
      { type: 'spawn', enemyType, x: 0, y: 0 },
      { type: 'kill', enemyType, x: 0, y: 0 },
    ]) as CombatEvent[];
    dialogue.handle(events, 0);
    expect(dialogue.getMessage(true)).toEqual(opening);
    dialogue.update(2);
    dialogue.update(6);
    expect(dialogue.getMessage(true)).toBeNull();
  });
  it('keeps max-level dialogue out of lower-level upgrades and uses it at level ten', () => {
    const dialogue = new Dialogue(); dialogue.start();
    const ordinary = dialogueData.LEVEL_UP_EVENT.filter(line => !line.maxed).map(line => line.text);
    for (let i = 0; i < 9; i++) {
      dialogue.handle([{ type: 'levelup', amount: 5, x: 0, y: 0 }], 0);
      expect(ordinary).toContain(dialogue.getMessage(true)?.text);
    }
    dialogue.handle([{ type: 'levelup', amount: 10, x: 0, y: 0 }], 0);
    expect(dialogueData.LEVEL_UP_EVENT.filter(line => line.maxed).map(line => line.text)).toContain(dialogue.getMessage(true)?.text);
  });
  it.each([
    ['miniboss', 'ECHO_ATTACK'], ['palisade', 'PALISADE_ATTACK'], ['reprise', 'REPRISE_ATTACK'],
  ] as const)('keeps %s mechanics out of the final-boss six-card banter', (enemyType, group) => {
    const dialogue = new Dialogue(); dialogue.start(); dialogue.update(2); dialogue.update(6);
    dialogue.handle([{ type: 'attack', enemyType, text: 'windup', x: 0, y: 0 }], 0);
    expect(dialogue.getMessage(true)?.text).toBe(dialogueData[group][0].text);
  });
  it('answers repeated Wonderhoy shouts with short, increasingly angry replies', () => {
    const dialogue = new Dialogue();
    for (let i = 0; i < 10; i++) {
      dialogue.handle([{ type: 'bomb', x: 0, y: 0 }], 0);
      expect(dialogue.getMessage(true)).toMatchObject({ speaker: 'EMU', avatar: 'player' });
      expect(dialogue.getMessage(true)?.text).toContain('Wonderhoy');
      dialogue.update(1.61);
      expect(dialogue.getMessage(true)).toMatchObject({ speaker: 'MAFUYU', avatar: 'enemy' });
      expect(dialogue.getMessage(true)?.text).toBe(dialogueData.WONDERHOY_REPLY[Math.min(i, dialogueData.WONDERHOY_REPLY.length - 1)].text);
      dialogue.update(6);
      expect(dialogue.getMessage(true)).toBeNull();
    }
  });
  it.each(['damage', 'boss', 'card', 'failure'] as const)('drops an unspoken shout reply when %s interrupts', type => {
    const dialogue = new Dialogue();
    dialogue.handle([{ type: 'bomb', x: 0, y: 0 }], 0);
    dialogue.update(0.5);
    dialogue.handle([{ type, encounterId: 's2:final', text: type === 'card' ? '测试符卡' : undefined, x: 0, y: 0 }], 20);
    const important = dialogue.getMessage(true);
    if (type !== 'failure') {
      dialogue.update(2);
      expect(dialogue.getMessage(true)).toEqual(important);
    }
    dialogue.update(6);
    expect(dialogue.getMessage(true)).toBeNull();
  });
  it('lets damage and boss notices finish before a later bomb shout', () => {
    for (const event of [{ type: 'damage' }, { type: 'boss', encounterId: 's2:final' }] as const) {
      const dialogue = new Dialogue();
      dialogue.handle([{ ...event, x: 0, y: 0 }], 0);
      const important = dialogue.getMessage(true);
      dialogue.handle([{ type: 'bomb', x: 0, y: 0 }], 0);
      expect(dialogue.getMessage(true)).toEqual(important);
      dialogue.update(6);
      expect(dialogue.getMessage(true)?.speaker).toBe('EMU');
      expect(dialogue.getMessage(true)?.text).toContain('Wonderhoy');
      dialogue.update(2);
      expect(dialogue.getMessage(true)?.speaker).toBe('MAFUYU');
    }
  });
  it.each([
    ['complete', 'COMPLETE_EVENT'], ['failure', 'FAILURE_EVENT'],
  ] as const)('keeps the full %s line despite later settlement events and discards all pending banter', (type, group) => {
    const dialogue = new Dialogue();
    dialogue.handle([{ type: 'damage', x: 0, y: 0 }, { type: 'bomb', x: 0, y: 0 }], 0);
    dialogue.handle([
      { type, x: 0, y: 0 },
      { type: 'bomb', x: 0, y: 0 },
      { type: 'levelup', amount: 10, x: 0, y: 0 },
      { type: 'pickup', pickupType: 'hp', x: 0, y: 0 },
    ], 2468);
    expect(dialogue.getMessage()?.text).toBe(dialogueData[group][0].text.replaceAll('{score}', '2468'));
    expect(dialogue.getMessage()).toEqual(dialogue.getMessage(true));
    // Continuing after the result must not resurrect a queued shout or reply.
    dialogue.update(1 / 60);
    expect(dialogue.getMessage(true)).toBeNull();
    dialogue.update(8);
    expect(dialogue.getMessage(true)).toBeNull();
  });
  it('bounds queued replies during event bursts and removes them on reset', () => {
    const dialogue = new Dialogue();
    dialogue.handle([{ type: 'damage', x: 0, y: 0 }], 0);
    for (let i = 0; i < 50; i++) dialogue.handle([{ type: 'bomb', x: 0, y: 0 }], 0);
    for (let i = 0; i < 4; i++) dialogue.update(6);
    expect(dialogue.getMessage(true)).toBeNull();
    dialogue.handle([{ type: 'bomb', x: 0, y: 0 }], 0);
    dialogue.reset(); dialogue.update(10);
    expect(dialogue.getMessage(true)).toBeNull();
    dialogue.handle([{ type: 'bomb', x: 0, y: 0 }], 0); dialogue.update(2);
    expect(dialogue.getMessage(true)?.text).toBe(dialogueData.WONDERHOY_REPLY[0].text);
  });
});
