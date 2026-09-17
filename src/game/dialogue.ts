import dialogueData from './data/dialogue.json';
import type { CombatEvent, CommsMessage, EnemyType } from './types';

type Line = { id: string; sender: string; color: string; text: string; maxed?: boolean };
const data: Record<string, Line[]> = dialogueData;
const families: Partial<Record<EnemyType, string>> = {
  basic: 'B', dasher: 'C', sniper: 'A', sprayer: 'A', minelayer: 'B',
  shield: 'B', weaver: 'A', returner: 'C', sampler: 'A', repairer: 'B', carrier: 'B',
};
const isBoss = (type?: EnemyType) => type === 'boss' || type === 'miniboss' || type === 'palisade' || type === 'reprise';
const attackGroup = (type?: EnemyType) => type === 'miniboss' ? 'ECHO_ATTACK'
  : type === 'palisade' ? 'PALISADE_ATTACK' : type === 'reprise' ? 'REPRISE_ATTACK' : 'BOSS_ATTACK';
const entryGroup = (event: CombatEvent) => event.encounterId === 's2:final' ? 'LACUNA_ENTRY'
  : event.encounterId === 's2:palisade' || event.enemyType === 'palisade' ? 'PALISADE_ENTRY'
    : event.encounterId === 's2:reprise' || event.enemyType === 'reprise' ? 'REPRISE_ENTRY'
      : event.encounterId === 's1:echo' || event.enemyType === 'miniboss' ? 'ECHO_ENTRY' : 'BOSS_ENTRY';

/** Dialogue runs on simulation time; pausing never leaves orphaned timeouts. */
export class Dialogue {
  private queue: CommsMessage[] = [];
  private current: CommsMessage | null = null;
  private replies = new Map<number, CommsMessage>();
  private replyCount = 0;
  private protectedUntil = 0;
  private age = 0;
  private time = 0;
  private sequence = 0;
  private last = new Map<string, number>();
  private selections = new Map<string, number>();
  reset() {
    this.queue = []; this.current = null; this.replies.clear(); this.replyCount = 0; this.protectedUntil = 0;
    this.age = 0; this.time = 0; this.last.clear();
  }
  start() { this.reset(); this.say('SYSTEM_STATUS', true); }
  private narrate(text: string, speaker = 'EMU') {
    this.queue = []; this.replies.clear(); this.age = 0;
    this.current = { id: ++this.sequence, speaker, avatar: speaker === 'EMU' ? 'player' : 'enemy', color: speaker === 'EMU' ? '#91efe0' : '#c1adfa', text };
  }
  say(group: string, priority = false, replacements: Record<string, string> = {}, maxed?: boolean) {
    if (!priority && (this.time - (this.last.get(group) ?? -100)) < 8) return;
    const options = data[group]?.filter(line => maxed === undefined || line.maxed === undefined || line.maxed === maxed);
    if (!options?.length) return;
    const selection = this.selections.get(group) ?? 0;
    const line = options[selection % options.length];
    this.selections.set(group, selection + 1);
    this.last.set(group, this.time);
    let text = line.text;
    for (const [key, value] of Object.entries(replacements)) text = text.replaceAll(`{${key}}`, value);
    const message: CommsMessage = { id: ++this.sequence, speaker: line.sender.startsWith('EMU') ? 'EMU' : 'MAFUYU', avatar: line.sender.startsWith('EMU') ? 'player' : 'enemy', color: line.color, text };
    if (priority || !this.current) {
      this.current = message; this.age = 0;
      if (priority) { this.queue = []; this.replies.clear(); }
    }
    else if (this.queue.length < 2) this.queue.push(message);
    else return;
    // One short reply belongs to an accepted shout, never to a free-running timer.
    // Important events discard both queued banter and its unspoken replies.
    if (message.speaker === 'EMU' && text.includes('Wonderhoy') && group !== 'COMPLETE_EVENT') {
      const options = data.WONDERHOY_REPLY;
      const reply = options[Math.min(this.replyCount++, options.length - 1)];
      this.replies.set(message.id, { id: ++this.sequence, speaker: 'MAFUYU', avatar: 'enemy', color: reply.color, text: reply.text });
    }
  }
  handle(events: CombatEvent[], score: number) {
    // Settlement can emit upgrades or a killing bomb after the terminal event.
    // The stopped runtime must retain the full result line, with no stale reply.
    let terminal: CombatEvent | undefined;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === 'failure' || events[i].type === 'complete') { terminal = events[i]; break; }
    }
    if (terminal) {
      this.say(terminal.type === 'failure' ? 'FAILURE_EVENT' : 'COMPLETE_EVENT', true, { score: `${score}` });
      this.replies.clear(); this.protectedUntil = this.time + 2.5; this.age = 10;
      return;
    }
    for (const event of events) {
      if (['damage', 'boss', 'bossLow', 'card', 'levelup', 'leveldown'].includes(event.type)
        || (event.type === 'attack' && (event.text === 'arrival' || event.text === 'encounterCleared'))) {
        this.protectedUntil = this.time + 2.5;
      }
      if (event.type === 'card' && event.text === 'cleared') this.say('CARD_CLEARED', true);
      else if (event.type === 'card') this.narrate(`「${event.text ?? '下一张符卡'}」`, 'MAFUYU');
      else if (event.type === 'boss' || (event.type === 'attack' && event.text === 'arrival')) {
        const group = entryGroup(event);
        // The spawn warning and actual arrival belong to the same entrance line.
        if (this.time - (this.last.get(group) ?? -100) >= 3) this.say(group, true);
      }
      else if (event.type === 'attack' && event.text === 'encounterCleared') this.say('ENCOUNTER_CLEARED', true);
      else if (event.type === 'bossLow') this.say('BOSS_LOW_HP', true);
      else if (event.type === 'damage') this.say('PLAYER_DAMAGE', true);
      else if (event.type === 'leveldown') this.say('LEVEL_DOWN_EVENT', true);
      else if (event.type === 'xpLoss') this.say('LEVEL_DOWN_EVENT');
      else if (event.type === 'levelup') { this.say('LEVEL_UP_EVENT', true, {}, (event.amount ?? 1) >= 10); this.say('EMU_LEVELUP'); }
      else if (event.type === 'bomb') this.say('EMU_WONDERHOY', this.time >= this.protectedUntil);
      else if (event.type === 'pickup' && event.pickupType === 'hp') { this.say('HP_RECOVER_EVENT'); this.say('EMU_HEAL'); }
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
    this.time += dt; this.age += dt;
    if (this.current) {
      const reply = this.replies.get(this.current.id);
      if (this.age > (reply ? 1.6 : 5.5)) {
        this.replies.delete(this.current.id);
        this.current = reply ?? this.queue.shift() ?? null; this.age = 0;
      }
    }
  }
  getMessage(reducedMotion = false): CommsMessage | null {
    if (!this.current) return null;
    return { ...this.current, text: reducedMotion ? this.current.text : this.current.text.slice(0, Math.max(1, Math.floor(this.age * 35))) };
  }
}
