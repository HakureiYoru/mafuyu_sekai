import dialogueData from './data/dialogue.json';
import { CONVERSATIONS, type Conversation, type ConversationLine } from './data/conversations';
import type { CombatEvent, CommsGesture, CommsMessage, CommsMood, EnemyType } from './types';

type Line = { id: string; sender: string; color: string; text: string; maxed?: boolean };
const data: Record<string, Line[]> = dialogueData;
const families: Partial<Record<EnemyType, string>> = {
  basic: 'B', dasher: 'C', sniper: 'A', sprayer: 'A', minelayer: 'B',
  shield: 'B', weaver: 'A', returner: 'C', sampler: 'A', repairer: 'B', carrier: 'B',
};
const isBoss = (type?: EnemyType) => type === 'boss' || type === 'miniboss' || type === 'palisade' || type === 'reprise';
const attackGroup = (type?: EnemyType) => type === 'miniboss' ? 'ECHO_ATTACK'
  : type === 'palisade' ? 'PALISADE_ATTACK' : type === 'reprise' ? 'REPRISE_ATTACK' : 'BOSS_ATTACK';
const entryCategory = (event: CombatEvent): Conversation['category'] => event.encounterId === 's2:final' ? 'lacuna'
  : event.encounterId === 's2:palisade' || event.enemyType === 'palisade' ? 'palisade'
    : event.encounterId === 's2:reprise' || event.enemyType === 'reprise' ? 'reprise'
      : event.encounterId === 's1:echo' || event.enemyType === 'miniboss' ? 'echo' : 'mafuyu';
const isEntrance = (event: CombatEvent) => event.type === 'boss' || (event.type === 'attack' && event.text === 'arrival');
const importance = (event: CombatEvent) => isEntrance(event) ? 100 : event.type === 'card' ? 90
  : event.type === 'damage' ? 80 : event.type === 'attack' && event.text === 'encounterCleared' ? 70
    : event.type === 'bossLow' ? 60 : event.type === 'levelup' || event.type === 'leveldown' ? 50 : 0;
const lineDuration = (message: CommsMessage) => Math.max(1.8, message.fullText.length / 35 + 1.4);

/** All presentation time follows the one simulation clock; no wall-clock callbacks or chatter backlog. */
export class Dialogue {
  private remaining: CommsMessage[] = [];
  private current: CommsMessage | null = null;
  private previous: CommsMessage | null = null;
  private terminal = false;
  private age = 0;
  private time = 0;
  private sequence = 0;
  private nextConversation = 0;
  private last = new Map<string, number>();
  // Round-robin also varies opening lines across retries, without retaining chat history.
  private selections = new Map<string, number>();

  reset() {
    this.clear(); this.terminal = false; this.age = 0; this.time = 0;
    this.nextConversation = 0; this.last.clear();
  }
  start() { this.reset(); this.converse('opening', true); }
  startEndless() { this.clear(); this.terminal = false; this.converse('endless', true); }
  private clear() { this.remaining = []; this.current = null; this.previous = null; this.age = 0; }
  private message(line: ConversationLine, conversationId: string | null, replacements: Record<string, string> = {}, color?: string): CommsMessage {
    let text = line.text;
    for (const [key, value] of Object.entries(replacements)) text = text.replaceAll(`{${key}}`, value);
    return { id: ++this.sequence, conversationId, speaker: line.speaker, avatar: line.speaker === 'EMU' ? 'player' : 'enemy',
      color: color ?? (line.speaker === 'EMU' ? '#91efe0' : '#c1adfa'), text, fullText: text, mood: line.mood, gesture: line.gesture };
  }
  private converse(category: Conversation['category'], priority = false, replacements: Record<string, string> = {}, maxed?: boolean, terminal = false) {
    if (this.terminal || (!priority && (this.current || this.time < this.nextConversation))) return false;
    const options = CONVERSATIONS.filter(item => item.category === category && (maxed === undefined || item.maxed === undefined || item.maxed === maxed));
    if (!options.length) return false;
    const key = `conversation:${category}:${maxed ?? 'any'}`, selection = this.selections.get(key) ?? 0;
    const conversation = options[selection % options.length];
    this.selections.set(key, selection + 1); this.last.set(category, this.time);
    const conversationId = `${conversation.id}:${++this.sequence}`;
    const messages = conversation.lines.map(line => this.message(line, conversationId, replacements));
    this.clear(); this.nextConversation = this.time + 12;
    if (terminal) {
      // The result stops simulation immediately: display its final exchange together.
      this.previous = messages[messages.length - 2]; this.current = messages[messages.length - 1];
      this.age = lineDuration(this.current); this.terminal = true;
    } else {
      this.current = messages[0]; this.remaining = messages.slice(1);
    }
    return true;
  }
  private narrate(text: string) {
    this.clear();
    this.current = this.message({ speaker: 'MAFUYU', text, mood: 'shadow', gesture: 'none' }, null);
  }
  say(group: string, priority = false, replacements: Record<string, string> = {}, maxed?: boolean) {
    if (this.terminal || (!priority && (this.current || this.time - (this.last.get(group) ?? -100) < 8))) return;
    const options = data[group]?.filter(line => maxed === undefined || line.maxed === undefined || line.maxed === maxed);
    if (!options?.length) return;
    const selection = this.selections.get(group) ?? 0, line = options[selection % options.length];
    const speaker = line.sender.startsWith('EMU') ? 'EMU' : 'MAFUYU';
    // Authored exchanges already own their replies; legacy shouts enter that same bounded path.
    if (speaker === 'EMU' && line.text.includes('Wonderhoy')) {
      if (this.converse('wonderhoy', priority)) { this.selections.set(group, selection + 1); this.last.set(group, this.time); }
      return;
    }
    this.selections.set(group, selection + 1); this.last.set(group, this.time);
    const mood: CommsMood = speaker === 'EMU' ? 'happy' : group.includes('ATTACK') || group === 'BOSS_LOW_HP' ? 'rage' : 'cold';
    const gesture: CommsGesture = mood === 'rage' ? 'tremble' : 'none';
    this.clear(); this.current = this.message({ speaker, text: line.text, mood, gesture }, null, replacements, line.color);
  }
  handle(events: CombatEvent[], score: number) {
    if (this.terminal) return;
    let terminal: CombatEvent | undefined;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === 'failure' || events[i].type === 'complete') { terminal = events[i]; break; }
    }
    if (terminal) {
      this.converse(terminal.type === 'failure' ? 'failure' : 'complete', true, { score: `${score}` }, undefined, true);
      return;
    }
    // One important notice per simulation batch; incidental kills/bombs cannot replace it.
    let urgent: CombatEvent | undefined;
    for (const event of events) if (importance(event) > (urgent ? importance(urgent) : 0)) urgent = event;
    if (urgent) {
      if (isEntrance(urgent)) {
        const category = entryCategory(urgent);
        // Spawn warning and actual arrival refer to the same entrance.
        if (this.time - (this.last.get(category) ?? -100) >= 3) this.converse(category, true);
      } else if (urgent.type === 'card') {
        if (urgent.text === 'cleared') this.say('CARD_CLEARED', true);
        else this.narrate(`「${urgent.text ?? '下一张符卡'}」`);
      } else if (urgent.type === 'damage') this.converse('damage', true);
      else if (urgent.type === 'levelup') this.converse('upgrade', true, {}, (urgent.amount ?? 1) >= 10);
      else if (urgent.type === 'leveldown') this.say('LEVEL_DOWN_EVENT', true);
      else if (urgent.type === 'bossLow') this.say('BOSS_LOW_HP', true);
      else this.say('ENCOUNTER_CLEARED', true);
      return;
    }
    // No queued event log: lines that cannot be spoken now are already out of date.
    for (const event of events) {
      if (event.type === 'bomb') this.converse('wonderhoy');
      else if (event.type === 'heal') this.converse('heal');
      else if (event.type === 'xpLoss') this.say('LEVEL_DOWN_EVENT');
      else if (event.type === 'attack' && isBoss(event.enemyType)) this.say(attackGroup(event.enemyType));
      else if (event.enemyType && families[event.enemyType]) {
        const family = families[event.enemyType];
        if (event.type === 'spawn') this.say(`TYPE_${family}_SPAWN`);
        else if (event.type === 'attack') this.say(`TYPE_${family}_ATTACK`);
        else if (event.type === 'kill') this.say(`TYPE_${family}_DEATH`);
      }
    }
  }
  update(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0 || this.terminal) return;
    this.time += dt; this.age += dt;
    while (this.current && this.age >= lineDuration(this.current)) {
      this.age -= lineDuration(this.current);
      const next = this.remaining.shift();
      if (!next) { this.clear(); break; }
      this.previous = this.current.conversationId === next.conversationId && this.current.speaker !== next.speaker ? this.current : null;
      this.current = next;
    }
  }
  getMessage(reducedMotion = false): CommsMessage | null {
    if (!this.current) return null;
    return { ...this.current, text: reducedMotion || this.terminal ? this.current.fullText : this.current.fullText.slice(0, Math.max(1, Math.floor(this.age * 35))) };
  }
  getPreviousMessage(): CommsMessage | null { return this.previous ? { ...this.previous, text: this.previous.fullText } : null; }
}
