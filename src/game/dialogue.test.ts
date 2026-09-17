import { describe, expect, it } from 'vitest';
import { Dialogue } from './dialogue';
import dialogueData from './data/dialogue.json';
import { CONVERSATIONS } from './data/conversations';
import type { CombatEvent, EnemyType } from './types';

const event = (type: CombatEvent['type'], extra: Partial<CombatEvent> = {}): CombatEvent => ({ type, x: 0, y: 0, ...extra });

describe('two-character combat conversations', () => {
  it('authors 24 short exchanges with alternating characters and all eight expressions', () => {
    expect(CONVERSATIONS).toHaveLength(24);
    expect(new Set(CONVERSATIONS.map(item => item.id)).size).toBe(24);
    const counts: Record<string, number> = {};
    for (const conversation of CONVERSATIONS) {
      counts[conversation.category] = (counts[conversation.category] ?? 0) + 1;
      expect(conversation.lines.length).toBeGreaterThanOrEqual(2);
      expect(conversation.lines.length).toBeLessThanOrEqual(3);
      conversation.lines.forEach((line, i) => {
        expect(line.text.length).toBeLessThanOrEqual(24);
        expect(line.speaker === 'EMU' ? ['happy', 'cheer', 'surprised', 'hurt'] : ['cold', 'annoyed', 'shadow', 'rage']).toContain(line.mood);
        if (i) expect(line.speaker).not.toBe(conversation.lines[i - 1].speaker);
      });
    }
    expect(counts).toEqual({ opening: 2, wonderhoy: 6, damage: 3, heal: 2, upgrade: 3,
      echo: 1, palisade: 1, mafuyu: 1, reprise: 1, lacuna: 1, failure: 1, complete: 1, endless: 1 });
    expect(new Set(CONVERSATIONS.flatMap(item => item.lines.map(line => line.mood))).size).toBe(8);
  });
  it('preserves all 223 original supplement lines and their unique ids', () => {
    const lines = Object.values(dialogueData).flat();
    expect(lines).toHaveLength(223);
    expect(new Set(lines.map(line => line.id)).size).toBe(lines.length);
    expect(lines.every(line => line.text.length <= 48 && ['EMU', 'MAFUYU'].includes(line.sender))).toBe(true);
  });
  it('opens in-character, types at simulation speed, and preserves the complete previous sentence', () => {
    const dialogue = new Dialogue(); dialogue.start();
    const opening = dialogue.getMessage(true)!;
    expect(opening).toMatchObject({ speaker: 'EMU', avatar: 'player', mood: 'cheer', gesture: 'hop', fullText: '学姐！Wonderhoy！！' });
    expect(opening.text).not.toMatch(/第一季|继承|选好模块/);
    expect(dialogue.getMessage()?.text).toBe('学');
    expect(dialogue.getPreviousMessage()).toBeNull();
    dialogue.update(0.2);
    expect(dialogue.getMessage()?.text).toBe(opening.fullText.slice(0, 7));
    expect(dialogue.getMessage()?.id).toBe(opening.id);
    expect(dialogue.getMessage()?.gesture).toBe('hop');
    dialogue.update(1.61);
    expect(dialogue.getMessage()).toMatchObject({ speaker: 'MAFUYU', avatar: 'enemy', mood: 'shadow', conversationId: opening.conversationId });
    expect(dialogue.getPreviousMessage()).toEqual(opening);
    dialogue.update(5);
    expect(dialogue.getMessage()).toBeNull();
    expect(dialogue.getPreviousMessage()).toBeNull();
  });
  it('does not advance typing, poses, or the previous sentence without simulation updates', () => {
    const dialogue = new Dialogue(); dialogue.start(); dialogue.update(1.9);
    const message = dialogue.getMessage(), previous = dialogue.getPreviousMessage();
    for (let i = 0; i < 100; i++) {
      expect(dialogue.getMessage()).toEqual(message);
      expect(dialogue.getPreviousMessage()).toEqual(previous);
    }
    expect(dialogue.getMessage(true)?.text).toBe(message?.fullText);
    expect(dialogue.getMessage(true)?.id).toBe(message?.id);
  });
  it('waits for full text plus 1.4 seconds before switching even a longer sentence', () => {
    const dialogue = new Dialogue();
    dialogue.handle([event('boss', { encounterId: 's2:final' })], 0);
    const message = dialogue.getMessage(true)!;
    const duration = Math.max(1.8, message.text.length / 35 + 1.4);
    dialogue.update(duration - 0.001);
    expect(dialogue.getMessage()?.id).toBe(message.id);
    expect(dialogue.getMessage()?.text).toBe(message.fullText);
    dialogue.update(0.002);
    expect(dialogue.getMessage()?.id).not.toBe(message.id);
    expect(dialogue.getPreviousMessage()).toEqual(message);
  });
  it.each([30, 60, 120, 144])('has the same conversation state after 2.5 simulated seconds at %i Hz', hz => {
    const dialogue = new Dialogue(); dialogue.start();
    for (let i = 0; i < hz * 2.5; i++) dialogue.update(1 / hz);
    expect(dialogue.getMessage()?.text).toBe('……这里不需要你的声音。');
    expect(dialogue.getPreviousMessage()?.text).toBe('学姐！Wonderhoy！！');
    expect(dialogue.getMessage()?.id).toBe(3);
  });
  it.each([
    ['s1:echo', 'miniboss', 'ECHO'],
    ['s2:palisade', 'palisade', 'PALISADE'],
    ['s1:mafuyu', 'boss', 'MAFUYU'],
    ['s2:reprise', 'reprise', 'REPRISE'],
    ['s2:final', 'boss', 'LACUNA'],
  ] as const)('announces %s with its own identity and deduplicates warning/arrival', (encounterId, enemyType, name) => {
    const dialogue = new Dialogue(); dialogue.start();
    dialogue.handle([event('attack', { text: 'arrival', encounterId, enemyType })], 0);
    const entrance = dialogue.getMessage(true)!;
    expect(entrance.text).toContain(name);
    expect(dialogue.getPreviousMessage()).toBeNull();
    dialogue.update(2);
    const next = dialogue.getMessage(true);
    dialogue.handle([event(enemyType === 'boss' ? 'boss' : 'spawn', { encounterId, enemyType })], 0);
    expect(dialogue.getMessage(true)).toEqual(next);
    expect(dialogue.getPreviousMessage()).toEqual(entrance);
    dialogue.update(6);
    expect(dialogue.getMessage(true)).toBeNull();
  });
  it('keeps an entrance over incidental card and upgrade events in the same batch', () => {
    const dialogue = new Dialogue();
    dialogue.handle([
      event('card', { text: '测试符卡' }), event('levelup', { amount: 3 }),
      event('attack', { text: 'arrival', encounterId: 's1:mafuyu', enemyType: 'boss' }), event('bomb'),
    ], 0);
    expect(dialogue.getMessage(true)?.text).toContain('MAFUYU');
    dialogue.update(0.5);
    dialogue.handle([event('card', { text: '下一张符卡' }), event('bomb')], 0);
    expect(dialogue.getMessage(true)?.text).toBe('「下一张符卡」');
    expect(dialogue.getPreviousMessage()).toBeNull();
    dialogue.update(8);
    expect(dialogue.getMessage()).toBeNull();
  });
  it('translates card and encounter completion rather than showing raw event codes', () => {
    const dialogue = new Dialogue(); dialogue.start();
    dialogue.handle([event('card', { text: 'cleared', encounterId: 's1:mafuyu', enemyType: 'boss' })], 0);
    expect(dialogue.getMessage(true)?.text).toBe(dialogueData.CARD_CLEARED[0].text);
    dialogue.handle([event('attack', { text: 'encounterCleared', encounterId: 's1:mafuyu' })], 0);
    expect(dialogue.getMessage(true)?.text).toBe(dialogueData.ENCOUNTER_CLEARED[0].text);
  });
  it('does not let mines, cores, parts, or defeated bosses generate ordinary-mob chatter', () => {
    const dialogue = new Dialogue(); dialogue.start();
    const opening = dialogue.getMessage(true);
    const types: EnemyType[] = ['mine', 'core', 'arm', 'node', 'miniboss', 'palisade', 'reprise', 'boss'];
    dialogue.handle(types.flatMap(enemyType => [event('spawn', { enemyType }), event('kill', { enemyType })]), 0);
    expect(dialogue.getMessage(true)).toEqual(opening);
    dialogue.update(10);
    expect(dialogue.getMessage()).toBeNull();
  });
  it('reserves max-level exchange for level ten and rotates the two earlier upgrade exchanges', () => {
    const dialogue = new Dialogue();
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      dialogue.handle([event('levelup', { amount: 5 })], 0);
      seen.add(dialogue.getMessage(true)!.fullText);
      expect(dialogue.getMessage(true)?.text).not.toContain('满级');
    }
    expect(seen.size).toBe(2);
    dialogue.handle([event('levelup', { amount: 10 })], 0);
    expect(dialogue.getMessage(true)?.text).toContain('满级');
  });
  it.each([
    ['miniboss', 'ECHO_ATTACK'], ['palisade', 'PALISADE_ATTACK'], ['reprise', 'REPRISE_ATTACK'],
  ] as const)('keeps %s legacy mechanics out of six-card banter', (enemyType, group) => {
    const dialogue = new Dialogue();
    dialogue.handle([event('attack', { enemyType, text: 'windup' })], 0);
    expect(dialogue.getMessage(true)?.text).toBe(dialogueData[group][0].text);
    expect(dialogue.getMessage()?.conversationId).toBeNull();
  });
  it('rotates six Wonderhoy conversations without duplicate automatic replies', () => {
    const dialogue = new Dialogue(), seen = new Set<string>();
    const conversations = CONVERSATIONS.filter(item => item.category === 'wonderhoy');
    for (const conversation of conversations) {
      dialogue.handle([event('bomb')], 0);
      const id = dialogue.getMessage()!.conversationId!;
      seen.add(id.split(':')[0]);
      for (let i = 0; i < conversation.lines.length; i++) {
        const line = conversation.lines[i];
        expect(dialogue.getMessage(true)).toMatchObject({ speaker: line.speaker, text: line.text, conversationId: id });
        if (i) expect(dialogue.getPreviousMessage()?.text).toBe(conversation.lines[i - 1].text);
        dialogue.update(Math.max(1.8, line.text.length / 35 + 1.4) + 0.001);
      }
      expect(dialogue.getMessage()).toBeNull();
      expect(dialogue.getPreviousMessage()).toBeNull();
      dialogue.update(12);
    }
    expect(seen.size).toBe(6);
  });
  it('applies a global 12-second spacing to ordinary new conversations across event types', () => {
    const dialogue = new Dialogue();
    dialogue.handle([event('bomb')], 0);
    dialogue.update(11.99);
    dialogue.handle([event('pickup', { pickupType: 'hp' }), event('bomb')], 0);
    expect(dialogue.getMessage()).toBeNull();
    dialogue.update(0.011);
    dialogue.handle([event('pickup', { pickupType: 'hp' })], 0);
    expect(dialogue.getMessage()?.conversationId).toMatch(/^heal-/);
  });
  it.each(['damage', 'boss', 'card'] as const)('drops all unspoken conversation turns when %s interrupts', type => {
    const dialogue = new Dialogue();
    dialogue.handle([event('bomb')], 0); dialogue.update(0.5);
    const interrupted = dialogue.getMessage()?.conversationId;
    dialogue.handle([event(type, { encounterId: 's2:final', text: type === 'card' ? '测试符卡' : undefined })], 20);
    expect(dialogue.getMessage()?.conversationId).not.toBe(interrupted);
    expect(dialogue.getPreviousMessage()).toBeNull();
    dialogue.update(10);
    expect(dialogue.getMessage()).toBeNull();
    expect(dialogue.getPreviousMessage()).toBeNull();
  });
  it('drops bombs during damage instead of replaying stale chatter afterwards', () => {
    const dialogue = new Dialogue();
    dialogue.handle([event('damage')], 0);
    const important = dialogue.getMessage(true);
    for (let i = 0; i < 100; i++) dialogue.handle([event('bomb')], 0);
    expect(dialogue.getMessage(true)).toEqual(important);
    dialogue.update(20);
    expect(dialogue.getMessage()).toBeNull();
    expect(dialogue.getPreviousMessage()).toBeNull();
  });
  it.each(['complete', 'failure'] as const)('shows both full terminal %s lines immediately and keeps repeated settlement idempotent', type => {
    const dialogue = new Dialogue(); dialogue.handle([event('bomb')], 0);
    const batch = [event(type), event('bomb'), event('levelup', { amount: 10 }), event('pickup', { pickupType: 'hp' })];
    dialogue.handle(batch, 2468);
    const current = dialogue.getMessage()!, previous = dialogue.getPreviousMessage()!;
    expect(current.text).toBe(current.fullText);
    expect(previous.text).toBe(previous.fullText);
    expect(current.conversationId).toBe(previous.conversationId);
    expect(current.speaker).not.toBe(previous.speaker);
    if (type === 'failure') expect(previous.text).toContain('2468');
    else expect(current.text).toContain('Wonderhoy');
    dialogue.handle(batch, 9876); dialogue.update(100);
    expect(dialogue.getMessage()).toEqual(current);
    expect(dialogue.getPreviousMessage()).toEqual(previous);
    dialogue.startEndless();
    expect(dialogue.getPreviousMessage()).toBeNull();
    expect(dialogue.getMessage()?.conversationId).not.toBe(current.conversationId);
    expect(dialogue.getMessage(true)?.text).toBe('还要玩！Wonderhoy！！');
    dialogue.update(10);
    expect(dialogue.getMessage()).toBeNull();
  });
  it('clears both characters on reset and starts a distinct conversation instance on retry', () => {
    const dialogue = new Dialogue(); dialogue.start(); dialogue.update(2);
    const old = dialogue.getMessage()!;
    expect(dialogue.getPreviousMessage()).not.toBeNull();
    dialogue.reset(); dialogue.update(50);
    expect(dialogue.getMessage()).toBeNull();
    expect(dialogue.getPreviousMessage()).toBeNull();
    dialogue.start();
    expect(dialogue.getMessage()?.id).not.toBe(old.id);
    expect(dialogue.getMessage()?.conversationId).not.toBe(old.conversationId);
    expect(dialogue.getPreviousMessage()).toBeNull();
    dialogue.update(20);
    expect(dialogue.getMessage()).toBeNull();
  });
});
