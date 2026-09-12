import dialogueData from './data/dialogue.json';
import type { CombatEvent, CommsMessage, EnemyType, SeasonId } from './types';

type Line = { id: string; sender: string; color: string; text: string; maxed?: boolean };
const data: Record<string, Line[]> = dialogueData;
const family = (type?: EnemyType) => type === 'dasher' ? 'C' : type === 'sniper' || type === 'sprayer' ? 'A' : 'B';

/** Dialogue runs on simulation time; pausing never leaves orphaned timeouts. */
export class Dialogue {
  private queue: CommsMessage[] = [];
  private current: CommsMessage | null = null;
  private age = 0;
  private time = 0;
  private sequence = 0;
  private last = new Map<string, number>();
  private selections = new Map<string, number>();
  private season: SeasonId = 's1';
  reset() { this.queue = []; this.current = null; this.age = 0; this.time = 0; this.last.clear(); }
  start(season: SeasonId = 's1') {
    this.reset(); this.season = season;
    if (season === 's2') this.narrate('第一季的共鸣还在。选好模块，我们一起穿过镜界。');
    else this.say('SYSTEM_STATUS', true);
  }
  private narrate(text: string, speaker = 'EMU') {
    this.queue = []; this.age = 0;
    this.current = { id: ++this.sequence, speaker, avatar: speaker === 'EMU' ? 'player' : 'enemy', color: speaker === 'EMU' ? '#91efe0' : '#c1adfa', text };
  }
  say(group: string, priority = false, replacements: Record<string, string> = {}) {
    if (!priority && (this.time - (this.last.get(group) ?? -100)) < 8) return;
    const options = data[group];
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
      if (this.season === 's2' && event.type === 'wave') {
        const lines = ['镜界入口到了。护盾的正面很硬，绕到侧面吧。', '前面是幕门街区。弹墙会留下短暂的通路。', '中继回廊正在记录脚步。看见地面印记后，别停在原地。', '复奏断层中，修复者和裂核一同出现。先找到维系它们的连线。', '裂核庭院到了。让子机守住侧翼，我们继续向前。', '这是终章前线。所有回声都在这里汇合，再走一步。'];
        this.narrate(lines[Math.max(0, Math.min(5, (event.amount ?? 1) - 1))]);
      }
      else if (event.type === 'card') this.narrate(`${event.text ?? '下一张符卡'}。每一层弹幕都在变化，跟着空隙慢慢穿过去。`);
      else if (this.season === 's2' && event.type === 'boss') this.narrate('LACUNA，就在镜面的另一侧。把我们带来的共鸣，完整地传过去。');
      else if (this.season === 's2' && event.type === 'complete') this.narrate('镜界也听到了！这一次，两个世界都留下了我们的声音。');
      else if (this.season === 's2' && event.type === 'attack' && event.text === 'arrival') this.narrate(event.enemyType === 'palisade' ? 'PALISADE 封住了前路。拆掉侧臂，弹墙就会松动。' : event.enemyType === 'reprise' ? 'REPRISE 的弹幕会停驻再折返。别站在它离开的轨迹上。' : '终点正在回应，准备迎接新的共鸣。');
      else if (event.type === 'boss') this.say('BOSS_ENTRY', true);
      else if (event.type === 'bossLow') this.say('BOSS_LOW_HP', true);
      else if (event.type === 'failure') { this.say('FAILURE_EVENT', true, { score: `${score}` }); this.age = 10; }
      else if (event.type === 'damage') this.say('PLAYER_DAMAGE', true);
      else if (event.type === 'leveldown') this.say('LEVEL_DOWN_EVENT', true);
      else if (event.type === 'levelup') { this.say('LEVEL_UP_EVENT', true); this.say('EMU_LEVELUP'); }
      else if (event.type === 'bomb') this.say('EMU_WONDERHOY', true);
      else if (event.type === 'pickup' && event.pickupType === 'hp') { this.say('HP_RECOVER_EVENT'); this.say('EMU_HEAL'); }
      else if (event.type === 'spawn' && event.enemyType !== 'mine' && event.enemyType !== 'boss') this.say(`TYPE_${family(event.enemyType)}_SPAWN`);
      else if (event.type === 'attack') this.say(event.enemyType === 'boss' ? 'BOSS_ATTACK' : `TYPE_${family(event.enemyType)}_ATTACK`);
      else if (event.type === 'kill' && event.enemyType !== 'mine') this.say(`TYPE_${family(event.enemyType)}_DEATH`);
      else if (event.type === 'complete') {
        this.queue = [];
        this.current = { id: ++this.sequence, speaker: 'EMU', avatar: 'player', color: '#91efe0', text: 'Wonderhoy！这一次，我们一起走向光亮吧。' };
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
