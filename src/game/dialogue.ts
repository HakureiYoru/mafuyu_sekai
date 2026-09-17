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
  private age = 0;
  private time = 0;
  private sequence = 0;
  private last = new Map<string, number>();
  private selections = new Map<string, number>();
  reset() { this.queue = []; this.current = null; this.age = 0; this.time = 0; this.last.clear(); }
  start() { this.reset(); this.say('SYSTEM_STATUS', true); }
  private narrate(text: string, speaker = 'EMU') {
    this.queue = []; this.age = 0;
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
    if (priority || !this.current) { this.current = message; this.age = 0; if (priority) this.queue = []; }
    else if (this.queue.length < 2) this.queue.push(message);
  }
  handle(events: CombatEvent[], score: number) {
    for (const event of events) {
      if (event.type === 'card' && event.text === 'cleared') this.say('CARD_CLEARED', true);
      else if (event.type === 'card') this.narrate(`「${event.text ?? '下一张符卡'}」——学姐，这也算普通问候？！`);
      else if (event.type === 'boss' || (event.type === 'attack' && event.text === 'arrival')) {
        const group = entryGroup(event);
        // The spawn warning and actual arrival belong to the same entrance line.
        if (this.time - (this.last.get(group) ?? -100) >= 3) this.say(group, true);
      }
      else if (event.type === 'attack' && event.text === 'encounterCleared') this.say('ENCOUNTER_CLEARED', true);
      else if (event.type === 'bossLow') this.say('BOSS_LOW_HP', true);
      else if (event.type === 'failure') { this.say('FAILURE_EVENT', true, { score: `${score}` }); this.age = 10; }
      else if (event.type === 'damage') this.say('PLAYER_DAMAGE', true);
      else if (event.type === 'leveldown') this.say('LEVEL_DOWN_EVENT', true);
      else if (event.type === 'xpLoss') this.say('LEVEL_DOWN_EVENT');
      else if (event.type === 'levelup') { this.say('LEVEL_UP_EVENT', true, {}, (event.amount ?? 1) >= 10); this.say('EMU_LEVELUP'); }
      else if (event.type === 'bomb') this.say('EMU_WONDERHOY', true);
      else if (event.type === 'pickup' && event.pickupType === 'hp') { this.say('HP_RECOVER_EVENT'); this.say('EMU_HEAL'); }
      else if (event.type === 'attack' && isBoss(event.enemyType)) this.say(attackGroup(event.enemyType));
      else if (event.enemyType && families[event.enemyType]) {
        const family = families[event.enemyType];
        if (event.type === 'spawn') this.say(`TYPE_${family}_SPAWN`);
        else if (event.type === 'attack') this.say(`TYPE_${family}_ATTACK`);
        else if (event.type === 'kill') this.say(`TYPE_${family}_DEATH`);
      }
      else if (event.type === 'complete') {
        this.say('COMPLETE_EVENT', true);
        this.age = 10;
      }
    }
  }
  update(dt: number) {
    this.time += dt; this.age += dt;
    if (this.current && this.age > 5.5) { this.current = this.queue.shift() ?? null; this.age = 0; }
  }
  getMessage(reducedMotion = false): CommsMessage | null {
    if (!this.current) return null;
    return { ...this.current, text: reducedMotion ? this.current.text : this.current.text.slice(0, Math.max(1, Math.floor(this.age * 35))) };
  }
}
