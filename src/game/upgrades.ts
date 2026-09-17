import { SeededRandom } from './math';
import type { EvolutionId, ModuleId, ModuleRank, PlayerBuild, ResourceChoiceId, UpgradeChoiceId, UpgradeSource } from './types';

export type ModuleBranch = 'main' | 'drone' | 'resource';
export interface ModuleDefinition { id: ModuleId; name: string; branch: ModuleBranch; description: string; rank2Description: string; flavor: string; rank3Description?: string; rank5Description?: string }
// Original fan-game banter stays separate from the exact combat descriptions.
const MODULE_FLAVORS: Record<ModuleId, string> = {
  piercing: '笑梦：咻——！真冬：……连沉默都被穿透了。',
  wingShots: '笑梦：砰砰！真冬：一边吵还不够？！',
  precision: '笑梦：嘘……砰！真冬：……又骗我。',
  shatter: '笑梦：哗啦啦！真冬：……全都碎了。',
  chain: '笑梦：哔哩！哔哩！真冬：别把声音传过来！',
  prism: '笑梦：亮晶晶！真冬：把那道光关掉！！',
  droneHoming: '笑梦：追上啦！真冬：别过来……别过来！',
  droneBurst: '小笑梦：Wonderhoy！！真冬：一起闭嘴！！',
  slow: '笑梦：慢——慢——哇！真冬：慢下来也很吵。',
  division: '笑梦：这边！那边！真冬：哪里都有你？！',
  intercept: '笑梦：啪！没啦！真冬：……下一颗呢？',
  orbitBlade: '笑梦：贴贴！真冬：别碰我！！',
  doubleDash: '笑梦：咻！咻！真冬：不是让你再跑回来！',
  vent: '笑梦：呼——！真冬：连喘气都这么响……',
  reserveAmmo: '笑梦：冰冰的！真冬：……只有你还这么热闹。',
  graze: '笑梦：呜哇！差一点！真冬：下一次别想躲开。',
  revive: '真冬：终于安静了。笑梦：Wonderhoy！！',
  magnet: '笑梦：哇！都来啦！真冬：……空白也被你填满。',
  ricochet: '笑梦：叮！当！真冬：这声音怎么还会弹？！',
  rearSpark: '笑梦：砰！砰！真冬：背过身也闭不了嘴？！',
  crossOrbit: '小笑梦：哇！哇！真冬：别围着我喊！！',
  returnWing: '真冬：……走了？笑梦：回来啦！',
  brakeField: '笑梦：慢一点！真冬：我要停的是你的嘴。',
  dashEcho: '笑梦：咻——砰！真冬：人走了还在吵？！',
  pulseChamber: '笑梦：砰——哇！真冬：连空气都在叫。',
  anchorStars: '笑梦：星星留下啦！真冬：把它们也带走。',
  crescentMagazine: '笑梦：弯弯的！真冬：……别绕回来。',
  beamCircuit: '笑梦：还有！还有！真冬：这道光怎么还没断？！',
  droneSpotlight: '小笑梦：学姐！看这里！真冬：不准照过来。',
  droneNotes: '笑梦：叮——！真冬：地上也全是噪音。',
  dronePlectrum: '小笑梦：转圈圈！真冬：别围着我。',
  droneConduit: '笑梦：连起来啦！真冬：把线剪断。',
  decoyEcho: '纸笑梦：Wonderhoy！真冬：假的也闭嘴！！',
  slipstream: '笑梦：跑快快！真冬：……风里也是你的声音。',
  dashLane: '笑梦：这条路！真冬：不准留下痕迹。',
  counterPulse: '笑梦：呜哇！弹开！真冬：……还不肯安静。',
};
const definition = (id: ModuleId, name: string, branch: ModuleBranch, description: string, rank2Description: string): ModuleDefinition => ({ id, name, branch, description, rank2Description, flavor: MODULE_FLAVORS[id] });
export const MODULES: Record<ModuleId, ModuleDefinition> = {
  piercing: definition('piercing', '贯通线圈', 'main', '普通主炮额外穿透 1 个不同目标。', '普通主炮额外穿透 2 个不同目标。'),
  wingShots: definition('wingShots', '双联翼炮', 'main', '每轮追加两枚平行副弹，各造成 1 点伤害，不额外加热。', '两枚平行副弹各造成 1.5 点伤害。'),
  precision: definition('precision', '精密校准', 'main', '保持慢移 0.35 秒后，普通主炮伤害增加 20%。', '保持慢移 0.35 秒后，普通主炮伤害增加 30%。'),
  shatter: definition('shatter', '碎晶弹头', 'main', '主炮击杀迸发 6 枚伤害为 1 的短程碎片；冷却 0.45 秒。', '主炮击杀产生的六枚碎片各造成 1.5 点伤害。'),
  chain: definition('chain', '导电追踪', 'main', '特殊弹索敌扩大至 600；命中后向 220 内最多两个其他目标连锁，各造成 5 点伤害。', '特殊弹命中后最多连锁三个其他目标，各造成 5 点伤害。'),
  prism: definition('prism', '分光棱镜', 'main', '贯穿炮追加两束 12 点侧束；慢移时改为集中束，首目标受到 52 点伤害。侧束不重复伤害主束目标，不额外清弹。', '两束侧束各造成 18 点伤害；慢移集中束首目标受到 58 点伤害。'),
  droneHoming: definition('droneHoming', '追迹矩阵', 'drone', '基础子机弹获得 1.2 秒有限追踪，最大转速 2 弧度／秒。', '基础子机弹的有限追踪持续 1.6 秒。'),
  droneBurst: definition('droneBurst', '共振集火', 'drone', '子机累计 12 次基础命中追加 12 伤害穿甲弹，最多命中两个目标；冷却至少 3 秒。', '子机累计 10 次基础命中追加 14 伤害穿甲弹。'),
  slow: definition('slow', '离子束缚', 'drone', '子机基础命中使普通怪减速 25%，持续 0.8 秒；不影响首领或已承诺的突进。', '减速提高至 35%，持续 0.8 秒。'),
  division: definition('division', '分工索敌', 'drone', '子机索敌扩大至 720，自动优先分配不同目标。', '子机索敌扩大至 840，自动优先分配不同目标。'),
  intercept: definition('intercept', '防卫拦截', 'drone', '每 8 秒储备一次拦截，消除周围 90 内的一枚敌弹；不拦截激光或范围攻击。', '拦截储备冷却缩短至 6 秒，仍最多储备一次。'),
  orbitBlade: definition('orbitBlade', '轨道护刃', 'drone', '子机护刃造成 4 伤害，同目标共享 0.4 秒冷却；自动接近主炮命中的目标，标记消失后返回轨道。', '护刃伤害提高至 5；护刃不阻挡敌弹。'),
  doubleDash: definition('doubleDash', '双蓄推进', 'resource', '冲刺最多储存两次，每 2.6 秒逐次回复；贯穿炮窗口不叠加。', '两次冲刺的逐次回复时间缩短至 2.3 秒。'),
  vent: definition('vent', '排热喷口', 'resource', '冲刺结束降低 25 热量，冷却 4 秒；不跳过强制过热锁定。', '冲刺结束降低 35 热量，冷却仍为 4 秒。'),
  reserveAmmo: definition('reserveAmmo', '冷凝弹仓', 'resource', '热量达到 80 时自动降低 30，冷却 10 秒；不跳过强制过热锁定。', '热量达到 80 时自动降低 40，冷却仍为 10 秒。'),
  graze: definition('graze', '擦弹回收', 'resource', '非无敌擦弹降热 2、减少冲刺回充 0.05 秒；每秒最多三次，每弹一次，每轮回充最多返还 0.3 秒。', '每次擦弹降热 3、减少回充 0.08 秒；每轮回充最多返还 0.45 秒。'),
  revive: definition('revive', '复苏应答', 'resource', '本局一次致命伤保留 1 HP，获得 0.8 秒无敌；仍损失经验。', '致命伤保留 2 HP，获得 1.2 秒无敌；已消耗的复苏不会恢复。'),
  magnet: definition('magnet', '寻物脉冲', 'resource', '每 10 秒触发 0.8 秒、范围 600 的拾取牵引。', '每 8 秒触发 0.8 秒、范围 750 的拾取牵引。'),
  ricochet: definition('ricochet', '反跳弹芯', 'main', '普通主炮命中后，向 220 内另一个目标反跳一次，造成原弹 40% 伤害；冷却 0.25 秒。', '反跳伤害提高至原弹的 60%，不再触发其他模块。'),
  rearSpark: definition('rearSpark', '尾迹火花', 'main', '持续射击时每 0.6 秒向后发射两枚短弹，各 1 伤害，射程 360。', '两枚尾弹各造成 1.5 点伤害。'),
  crossOrbit: definition('crossOrbit', '交叉阵位', 'drone', '子机均匀分布于半径 150 的轨道。', '子机轨道半径提高至 180，索敌范围额外增加 80。'),
  returnWing: definition('returnWing', '回旋机翼', 'drone', '每 6 秒一轮基础子机弹直线出射，0.4 秒后原路返回；该轮不追踪，同目标去回各命中一次。', '回旋弹轮次冷却缩短至 4.5 秒；返回命中不触发追加效果。'),
  brakeField: definition('brakeField', '制动场', 'resource', '慢移 0.6 秒后生成半径 110、持续 0.8 秒的场，使普通怪减速 25%；冷却 6 秒。', '制动场半径提高至 140，减速提高至 35%；不影响首领或已承诺突进。'),
  dashEcho: definition('dashEcho', '余迹脉冲', 'resource', '冲刺结束留下残影，0.3 秒后以半径 90 爆破，造成 6 伤害；冷却 4 秒，不清弹。', '残影爆破半径提高至 110，造成 10 伤害。'),
  pulseChamber: definition('pulseChamber', '脉冲鼓膜', 'main', '每五轮主炮追加伤害 6、长 180、宽 60 的声波，最多命中三个目标；至少间隔 1 秒。', '声波伤害 7，长度 220，宽度 72。'),
  anchorStars: definition('anchorStars', '锚星弹', 'main', '主炮命中留下星印，0.65 秒后半径 75 爆破、伤害 6；冷却 1.5 秒。', '星印伤害 7，半径 80。'),
  crescentMagazine: definition('crescentMagazine', '弯月弹匣', 'main', '射击每 1.4 秒追加一枚伤害 4 的弯月刃，沿弧线切过最多三个目标。', '弯月刃伤害提高至 5.5。'),
  beamCircuit: definition('beamCircuit', '贯穿回路', 'main', '贯穿炮后 0.3 秒沿原方向追加伤害 8、长 900 的余光；不清弹。', '余光合计伤害提高至 9。'),
  droneSpotlight: definition('droneSpotlight', '焦点灯', 'drone', '每 3.6 秒一台子机蓄光 0.35 秒，发出伤害 6 的短束；不停止基础射击。', '短束伤害 7，射程 650。'),
  droneNotes: definition('droneNotes', '浮游音符', 'drone', '每 4 秒留下一个冷色音符，成形后敌人靠近即爆破、伤害 6；最多两个。', '每轮音符合计伤害 8。'),
  dronePlectrum: definition('dronePlectrum', '扫弦拨片', 'drone', '每 2.8 秒一台子机扫出 90° 刀弧，半径 85、伤害 4；每敌一次。', '扫弦伤害 4.5，半径 92.5。'),
  droneConduit: definition('droneConduit', '束流棱台', 'drone', '每 4 秒在子机间连线 0.35 秒、伤害 4；一台时连接主机，每敌一次。', '束流伤害 5，持续 0.475 秒。'),
  decoyEcho: definition('decoyEcho', '纸偶诱饵', 'resource', '冲刺起点留 0.8 秒纸偶，误导 500 内普通怪未锁定的攻击；冷却 6 秒。', '纸偶持续 0.925 秒。'),
  slipstream: definition('slipstream', '踏空回旋', 'resource', '沿同方向移动 1 秒后，普通移速 345、持续 0.7 秒；冷却 5 秒，不影响慢移和冲刺。', '踏空期间普通移速提高至 355。'),
  dashLane: definition('dashLane', '裂隙航道', 'resource', '冲刺留 2 秒、宽 70 航道；其中普通移速 +15%，普通怪减速 15%；冷却 4 秒。', '航道宽 80、持续 2.25 秒，移速和减速各 17.5%。'),
  counterPulse: definition('counterPulse', '受身反压', 'resource', '实际受伤时将 130 内普通怪推开 60；冷却 6 秒，不清弹或增加无敌。', '首圈反压范围提高至 150。'),
};

Object.assign(MODULES.pulseChamber, { rank3Description: '双弧声波：伤害 8、长 260、宽 84，最多三个目标。', rank5Description: '两道声波相隔 0.14 秒，各伤害 5、长 300、宽 96，各最多三个目标。' });
Object.assign(MODULES.anchorStars, { rank3Description: '星印伤害 8、半径 85，散出三枚伤害 2 的短芒。', rank5Description: '星印伤害 10、半径 95，散出六枚伤害 2.5 的短芒；不重复命中圆爆目标。' });
Object.assign(MODULES.crescentMagazine, { rank3Description: '两枚镜像刀弧，各伤害 3.5。', rank5Description: '三枚刀弧各伤害 3、宽 40，各最多四个目标。' });
Object.assign(MODULES.beamCircuit, { rank3Description: '两束平行余光，延迟 0.25 / 0.45 秒，各伤害 5。', rank5Description: '三束平行余光，延迟 0.2 / 0.35 / 0.5 秒，各伤害 4.5，不清弹。' });
Object.assign(MODULES.droneSpotlight, { rank3Description: '最多两台现有子机依次点亮，各伤害 8。', rank5Description: '最多三台子机依次点亮，各伤害 10、射程 740。' });
Object.assign(MODULES.droneNotes, { rank3Description: '每轮成对音符，各伤害 5；最多四枚。', rank5Description: '每轮三角音符，各伤害 4.5；最多六枚。' });
Object.assign(MODULES.dronePlectrum, { rank3Description: '180° 刀弧，半径 100、伤害 5。', rank5Description: '360° 闭合刀弧，半径 120、伤害 6，整圈每敌一次。' });
Object.assign(MODULES.droneConduit, { rank3Description: '束流持续 0.6 秒、伤害 6。', rank5Description: '三台子机形成闭合三角，持续 0.75 秒、伤害 8，所有边共享判定。' });
Object.assign(MODULES.decoyEcho, { rank3Description: '纸偶结束释放收声波：110 内普通怪减速 20%、0.6 秒。', rank5Description: '起点和冲刺中点各留一只纸偶，持续 1.2 秒，收声波不叠乘。' });
Object.assign(MODULES.slipstream, { rank3Description: '移速 365，宽 48 风道将普通怪向两侧推开 30。', rank5Description: '移速 385，宽 64 风道附带 20% 减速、持续 0.7 秒。' });
Object.assign(MODULES.dashLane, { rank3Description: '双轨航道宽 90、持续 2.5 秒，移动加速和敌人减速各 20%。', rank5Description: '航道宽 110、持续 3 秒，加速和减速各 25%；交叉不叠加。' });
Object.assign(MODULES.counterPulse, { rank3Description: '0.25 秒后追加半径 170、推开 40 的第二圈反压。', rank5Description: '第二圈留下 0.75 秒、减速 25% 的网格区；不影响首领或已承诺突进。' });

/** Combat numbers are shared with the fixed-step simulation; tuples index rank I / II. */
export const MODULE_VALUES = {
  piercing: { extraHits: [1, 2] }, wingShots: { damage: [1, 1.5] }, precision: { bonus: [0.2, 0.3], hold: 0.35 },
  shatter: { damage: [1, 1.5], count: 6, cooldown: 0.45 }, chain: { targets: [2, 3], damage: 5, range: 220, lockRange: 600 },
  prism: { sideDamage: [12, 18], focusDamage: [52, 58] }, droneHoming: { duration: [1.2, 1.6], turnSpeed: 2 },
  droneBurst: { hits: [12, 10], damage: [12, 14], cooldown: 3, targets: 2 }, slow: { amount: [0.25, 0.35], duration: 0.8 },
  division: { range: [720, 840] }, intercept: { cooldown: [8, 6], radius: 90 }, orbitBlade: { damage: [4, 5], radius: 24, cooldown: 0.4, transit: 0.25, markDuration: 1.4, markCooldown: 0.8 },
  doubleDash: { cooldown: [2.6, 2.3], charges: 2 }, vent: { heat: [25, 35], cooldown: 4 }, reserveAmmo: { heat: [30, 40], threshold: 80, cooldown: 10 },
  graze: { heat: [2, 3], recharge: [0.05, 0.08], refundCap: [0.3, 0.45], rate: 3 }, revive: { hp: [1, 2], invincible: [0.8, 1.2] }, magnet: { cooldown: [10, 8], range: [600, 750], duration: 0.8 },
  ricochet: { ratio: [0.4, 0.6], range: 220, cooldown: 0.25 }, rearSpark: { damage: [1, 1.5], cooldown: 0.6, range: 360, count: 2 },
  crossOrbit: { radius: [150, 180], bonusRange: [0, 80] }, returnWing: { cooldown: [6, 4.5], returnAt: 0.4 },
  brakeField: { radius: [110, 140], slow: [0.25, 0.35], hold: 0.6, duration: 0.8, cooldown: 6 },
  dashEcho: { radius: [90, 110], damage: [6, 10], warning: 0.3, cooldown: 4 },
} as const;

export const NEW_MODULE_IDS = ['pulseChamber', 'anchorStars', 'crescentMagazine', 'beamCircuit', 'droneSpotlight', 'droneNotes', 'dronePlectrum', 'droneConduit', 'decoyEcho', 'slipstream', 'dashLane', 'counterPulse'] as const;
export type NewModuleId = typeof NEW_MODULE_IDS[number];
/** Each tuple describes tiers 1 / 3 / 5. Damage is per volley except spotlight. */
export const NEW_MODULE_VALUES: Record<NewModuleId, Record<string, number | readonly [number, number, number]>> = {
  pulseChamber: { cooldown: 1, rounds: 5, damage: [6, 8, 10], length: [180, 260, 300], width: [60, 84, 96], targets: 3, count: [1, 1, 2] },
  anchorStars: { cooldown: 1.5, damage: [6, 8, 10], radius: [75, 85, 95], warning: 0.65, count: [0, 3, 6], fragmentDamage: [0, 2, 2.5], range: [180, 180, 240], capacity: 2 },
  crescentMagazine: { cooldown: 1.4, damage: [4, 7, 9], count: [1, 2, 3], width: [32, 32, 40], targets: [3, 3, 4], speed: 650, duration: 0.65 },
  beamCircuit: { cooldown: 2, damage: [8, 10, 13.5], count: [1, 2, 3], length: 900, width: [24, 24, 28] },
  droneSpotlight: { cooldown: 3.6, damage: [6, 8, 10], count: [1, 2, 3], length: [620, 680, 740], width: [16, 18, 20], warning: 0.35, duration: 0.18 },
  droneNotes: { cooldown: 4, damage: [6, 10, 13.5], count: [1, 2, 3], radius: [65, 70, 75], capacity: [2, 4, 6], warning: 0.5, duration: 3 },
  dronePlectrum: { cooldown: 2.8, damage: [4, 5, 6], radius: [85, 100, 120], width: [16, 18, 20], arc: [Math.PI / 2, Math.PI, Math.PI * 2], duration: [0.25, 0.35, 0.45] },
  droneConduit: { cooldown: 4, damage: [4, 6, 8], width: [12, 14, 16], duration: [0.35, 0.6, 0.75] },
  decoyEcho: { cooldown: 6, duration: [0.8, 1.05, 1.2], range: 500, count: [1, 1, 2], radius: 110 },
  slipstream: { cooldown: 5, duration: 0.7, hold: 1, moveSpeed: [345, 365, 385], width: [0, 48, 64], push: 30 },
  dashLane: { cooldown: 4, duration: [2, 2.5, 3], width: [70, 90, 110], moveBonus: [0.15, 0.2, 0.25], slow: [0.15, 0.2, 0.25], capacity: 2 },
  counterPulse: { cooldown: 6, radius: [130, 170, 170], push: 60, count: [1, 2, 2] },
};
export const highRankFactor = (rank: number): number => 1 + 0.12 * Math.log2(Math.max(1, rank - 4));
export function highRankCooldown(base: number, rank: number): number { return base * (0.65 + 0.35 / highRankFactor(rank)); }
const formKeys = new Set(['count', 'targets', 'capacity', 'rounds']);
const newStatsCache = new Map<string, Readonly<Record<string, number>>>();
export function newModuleStats(id: NewModuleId, rank: number): Readonly<Record<string, number>> {
  const actual = Math.max(1, Math.floor(Number.isFinite(rank) ? rank : 1)), key = `${id}:${actual}`;
  const cached = newStatsCache.get(key); if (cached) return cached;
  const form = actual >= 5 ? 2 : actual >= 3 ? 1 : 0, index = Math.min(2, (actual - 1) / 2), result: Record<string, number> = {};
  for (const [name, value] of Object.entries(NEW_MODULE_VALUES[id])) {
    let number = typeof value === 'number' ? value : formKeys.has(name) ? value[form]
      : value[Math.floor(index)] + (value[Math.ceil(index)] - value[Math.floor(index)]) * (index % 1);
    if (actual > 5) {
      if (/damage/i.test(name)) number *= highRankFactor(actual);
      else if (name === 'cooldown') number = highRankCooldown(number, actual);
      else if (['radius', 'range', 'length', 'width', 'push'].includes(name)) number *= 1 + 0.25 * (1 - 1 / highRankFactor(actual));
      else if (name === 'moveSpeed') number += (400 - number) * (1 - 1 / highRankFactor(actual));
      else if (name === 'slow') number += (0.5 - number) * (1 - 1 / highRankFactor(actual));
    }
    result[name] = number;
  }
  // Rank progression in endless must not turn the stat cache into a lifetime history.
  if (newStatsCache.size >= 128) newStatsCache.delete(newStatsCache.keys().next().value!);
  const frozen = Object.freeze(result); newStatsCache.set(key, frozen); return frozen;
}

type LegacyRule = 'damage' | 'cooldown' | 'range' | 'duration' | 'count' | 'threshold' | 'slow' | 'hp' | 'invincible';
const legacyRules = new Map<readonly [number, number], { rule: LegacyRule; cap?: number }>();
function configureLegacyRules(): void {
  for (const values of Object.values(MODULE_VALUES)) for (const [key, value] of Object.entries(values)) {
    if (!Array.isArray(value)) continue;
    const rule: LegacyRule = key === 'cooldown' ? 'cooldown' : ['range', 'radius', 'bonusRange'].includes(key) ? 'range'
      : key === 'duration' ? 'duration' : key === 'amount' || key === 'slow' ? 'slow' : key === 'hits' ? 'threshold'
      : ['extraHits', 'targets'].includes(key) ? 'count' : key === 'hp' ? 'hp' : key === 'invincible' ? 'invincible' : 'damage';
    legacyRules.set(value as unknown as readonly [number, number], { rule });
  }
}
configureLegacyRules();
function scaleLegacyValue(id: ModuleId, values: readonly [number, number], rank: number): number {
  const rule = legacyRules.get(values)?.rule ?? 'damage', tier = Math.min(5, rank), part = (tier - 1) / 4, base = values[1];
  if (rule === 'count') return Math.min(id === 'chain' ? 5 : 8, base + (tier >= 5 ? 2 : 1));
  if (rule === 'threshold') return Math.max(6, Math.round(base * (1 - 0.4 * part)));
  if (rule === 'hp') return 3;
  if (rule === 'invincible') return Math.min(1.8, base + 0.4 * part);
  if (rule === 'cooldown') return highRankCooldown(base * (tier === 3 ? 0.9 : tier === 4 ? 0.85 : 0.8), rank);
  if (rule === 'slow') return Math.min(0.5, base * (1 + 0.4 * part) + (rank > 5 ? (0.5 - base * 1.4) * (1 - 1 / highRankFactor(rank)) : 0));
  if (rule === 'range' || rule === 'duration') return base * (1 + 0.2 * part) * (rank > 5 ? 1 + 0.25 * (1 - 1 / highRankFactor(rank)) : 1);
  return base * (tier === 3 ? 1.2 : tier === 4 ? 1.3 : 1.4) * highRankFactor(rank);
}

export interface ResolvedBuildStats { signature: string; ranks: Readonly<Partial<Record<ModuleId, number>>>; values: Readonly<Partial<Record<ModuleId, Readonly<Record<string, number>>>>>; evolutions: ReadonlySet<EvolutionId> }
const resolvedCache = new WeakMap<PlayerBuild, ResolvedBuildStats>();
/** Resolve once on equip/rank changes; combat keeps the returned immutable snapshot. */
export function resolveBuildStats(build: PlayerBuild): ResolvedBuildStats {
  const signature = build.modules.map(id => `${id}:${moduleRank(build, id)}`).join('|') + '/' + build.evolutions.join(',');
  const old = resolvedCache.get(build); if (old?.signature === signature) return old;
  const ranks: Partial<Record<ModuleId, number>> = {}, values: Partial<Record<ModuleId, Readonly<Record<string, number>>>> = {};
  for (const id of build.modules) {
    const rank = ranks[id] = moduleRank(build, id);
    if ((NEW_MODULE_IDS as readonly string[]).includes(id)) values[id] = newModuleStats(id as NewModuleId, rank);
    else { const result: Record<string, number> = {}; for (const [key, value] of Object.entries(MODULE_VALUES[id as keyof typeof MODULE_VALUES])) {
      if (Array.isArray(value)) result[key] = rankValue(build, id, value as unknown as readonly [number, number]);
      else { const scalar = value as number; result[key] = rank <= 2 ? scalar : key === 'cooldown' ? highRankCooldown(scalar * (rank === 3 ? 0.9 : rank === 4 ? 0.85 : 0.8), rank)
        : key === 'damage' ? scalar * (rank === 3 ? 1.2 : rank === 4 ? 1.3 : 1.4) * highRankFactor(rank) : scalar; }
    } values[id] = Object.freeze(result); }
  }
  const resolved = { signature, ranks: Object.freeze(ranks), values: Object.freeze(values), evolutions: new Set(build.evolutions) };
  resolvedCache.set(build, resolved); return resolved;
}
export interface EvolutionDefinition { id: EvolutionId; name: string; primary: ModuleId; partner: ModuleId; description: string; flavor: string }
export const EVOLUTIONS: Record<EvolutionId, EvolutionDefinition> = {
  needleArray: { id: 'needleArray', name: '针轨贯阵', primary: 'piercing', partner: 'precision', description: '慢移时将当轮基础主炮合为一枚高速针弹，保留合计伤害，最多命中五个不同目标；副弹独立。', flavor: '笑梦：咻————！真冬：别把光捅进来！' },
  spiralBloom: { id: 'spiralBloom', name: '回旋花火', primary: 'wingShots', partner: 'rearSpark', description: '保留翼炮与尾弹，射击期间每 1.2 秒追加六枚环形短弹，各 2 伤害，射程 420。', flavor: '笑梦：哇！砰砰砰！真冬：吵死了吵死了！！' },
  forkNetwork: { id: 'forkNetwork', name: '分叉电网', primary: 'chain', partner: 'slow', description: '保留特殊主弹与连锁，另向最多两个不同目标发射各 6 伤害的追踪弹；副弹不再连锁。', flavor: '笑梦：Wonderhoy！Wonderhoy！真冬：别再传了！！' },
  triangleAssault: { id: 'triangleAssault', name: '三角围攻', primary: 'droneBurst', partner: 'crossOrbit', description: '集火追加弹由现有子机交叉发射，总伤害 18 按数量均分；每弹最多命中两个目标，保留 3 秒冷却。', flavor: '小笑梦：哇！哇！哇！真冬：到底有几个你？！' },
  huntingReturn: { id: 'huntingReturn', name: '巡猎回旋', primary: 'orbitBlade', partner: 'returnWing', description: '护刃返回轨道的途中也可伤害经过的敌人，每趟每敌一次 4 伤害；不阻挡敌弹。', flavor: '笑梦：转回来啦！真冬：不是让你回来！！' },
  echoTrail: { id: 'echoTrail', name: '残响疾行', primary: 'doubleDash', partner: 'dashEcho', description: '保留双蓄 II，残影爆破替换为持续 0.75 秒、宽 64 的冲刺尾迹；余迹 I／II 时每敌一次 8／12 伤害，冷却 4 秒，不清弹。', flavor: '笑梦：咻咻——！真冬：……地上也是你的声音。' },
  sonicBreak: { id: 'sonicBreak', name: '聚音破阵', primary: 'pulseChamber', partner: 'precision', description: '慢移声波末端左右分裂声刃，各为声波伤害的 50%，射程 220；不重复伤害声波目标。', flavor: '笑梦：左右都听见啦！真冬：……不想听。' },
  starCarpet: { id: 'starCarpet', name: '星屑地毯', primary: 'anchorStars', partner: 'shatter', description: '星印爆破留下半径 60、持续 1 秒的星屑区，造成圆爆伤害 40%，每敌一次；最多三片。', flavor: '笑梦：铺满星星！真冬：连落脚的地方都……' },
  lunarCut: { id: 'lunarCut', name: '月环裁切', primary: 'crescentMagazine', partner: 'piercing', description: '弯月沿原路径返回，回程伤害为去程 60%；同目标去回各一次。', flavor: '笑梦：绕回来啦！真冬：别再回来！！' },
  choralBeam: { id: 'choralBeam', name: '合唱贯穿', primary: 'beamCircuit', partner: 'prism', description: '余光轮次追加两束 ±12° 侧声，各伤害 6、长 650；不重复命中余光目标、不清弹。', flavor: '笑梦：一起！哇——！真冬：把光和声音都关掉。' },
  stageSpotlight: { id: 'stageSpotlight', name: '舞台追光', primary: 'droneSpotlight', partner: 'division', description: '追光束最多穿透三敌，末端形成半径 45、伤害 4 的光圈；不重复伤害该束目标。', flavor: '小笑梦：学姐是主角！真冬：……别把我照出来。' },
  staticGarden: { id: 'staticGarden', name: '静电花园', primary: 'droneNotes', partner: 'slow', description: '音符成形后保留 4.5 秒；220 内连线使普通怪减速 25%，触发时追加伤害 4 的电脉冲，不连锁引爆。', flavor: '笑梦：叮叮叮！真冬：走到哪里都在响。' },
  stringEcho: { id: 'stringEcho', name: '游弦回响', primary: 'dronePlectrum', partner: 'droneHoming', description: '扫弦结束向最近未被刀弧命中的目标发出伤害 4 的有限追踪刃；射程 360。', flavor: '小笑梦：还有一声！真冬：……最后一声也不许。' },
  triangleHall: { id: 'triangleHall', name: '三角回廊', primary: 'droneConduit', partner: 'crossOrbit', description: '连线围成区域使普通怪减速 20%；结束时边线追加一次伤害 4 的脉冲，所有边共享去重。', flavor: '笑梦：围起来啦！真冬：把出口还给我。' },
  livingSpeaker: { id: 'livingSpeaker', name: '人形扬声器', primary: 'decoyEcho', partner: 'magnet', description: '纸偶吸引 400 内掉落；消失时收取已进入 80 内的掉落，不复制收益。', flavor: '纸笑梦：Wonderhoy！真冬：假的声音也能把一切拖走。' },
  headwindFlame: { id: 'headwindFlame', name: '逆风焰尾', primary: 'slipstream', partner: 'rearSpark', description: '加速窗口每 0.2 秒向后发三枚伤害 1.5 的短弹，射程 220，每次最多四轮。', flavor: '笑梦：跑过去啦！真冬：噪音还留在后面。' },
  echoHighway: { id: 'echoHighway', name: '回音高速路', primary: 'dashLane', partner: 'dashEcho', description: '离开航道后首次重新进入，沿航道发出伤害 8、宽 64 的波；每条一次，不清弹或回充。', flavor: '笑梦：再跑一圈！真冬：这条路怎么还在叫？！' },
  counterCurtain: { id: 'counterCurtain', name: '反幕护场', primary: 'counterPulse', partner: 'intercept', description: '首圈反压最多消除 130 内最近的三枚普通敌弹；不影响激光、范围攻击或拦截储备。', flavor: '笑梦：呜哇！散开！真冬：……还有下一次。' },
};
export const EVOLUTION_VALUES = {
  needleArray: { targets: 5 }, spiralBloom: { cooldown: 1.2, count: 6, damage: 2, range: 420 },
  forkNetwork: { targets: 2, damage: 6 }, triangleAssault: { damage: 18, targets: 2, cooldown: 3 },
  huntingReturn: { damage: 4 }, echoTrail: { duration: 0.75, width: 64, damage: [8, 12], cooldown: 4 },
} as const;
export const RESONANCE = { xpPerRank: 600, maxRank: 4, damagePerRank: 0.05, maxDamageBonus: 0.2 } as const;
/** Compatibility exports are unbounded rules, not UI slot counts. */
export const MODULE_CHOICE_LIMIT = Infinity;
export const MODULE_SLOT_LIMIT = Infinity;
export const EVOLUTION_LIMIT = Infinity;
export const BEHAVIOR_MODULES: readonly ModuleId[] = ['precision', 'prism', 'division', 'orbitBlade', 'doubleDash', 'rearSpark', 'crossOrbit', 'returnWing', 'brakeField', 'dashEcho', 'pulseChamber', 'anchorStars', 'crescentMagazine', 'beamCircuit', 'droneSpotlight', 'droneNotes', 'dronePlectrum', 'droneConduit', 'decoyEcho', 'slipstream', 'dashLane', 'counterPulse'];
export interface ChoiceContext { reviveConsumed?: boolean; offerId?: string }
type BuildView = Pick<PlayerBuild, 'modules' | 'ranks' | 'evolutions'>;

export function createBuild(): PlayerBuild {
  return { modules: [], ranks: {}, evolutions: [], levelFloor: 1, resonance: 0, resonanceXp: 0, choices: [], choiceIndex: 0,
    pendingRewards: [], rewardHistory: [], rerollsRemaining: 2, offerRevision: 0, offerId: null, rewardWatermarks: {}, rewardSequence: 0 };
}
export function moduleRank(build: Pick<PlayerBuild, 'modules' | 'ranks'>, id: ModuleId): 0 | ModuleRank {
  if (!build.modules.includes(id)) return 0;
  const rank = build.ranks[id] ?? 1;
  return Number.isFinite(rank) && rank >= 1 ? Math.floor(rank) : 1;
}
export function rankValue(build: Pick<PlayerBuild, 'modules' | 'ranks'>, id: ModuleId, values: readonly [number, number]): number {
  const rank = moduleRank(build, id);
  if (rank <= 2) return rank ? values[rank - 1] : 0;
  return scaleLegacyValue(id, values, rank);
}
export function hasEvolution(build: Pick<PlayerBuild, 'evolutions'>, id: EvolutionId): boolean { return build.evolutions.includes(id); }
export function evolutionForModule(build: BuildView, id: ModuleId): EvolutionDefinition | undefined {
  return build.evolutions.map(evolution => EVOLUTIONS[evolution]).find(evolution => evolution.primary === id);
}
export function eligibleEvolutions(build: BuildView): EvolutionId[] {
  return Object.values(EVOLUTIONS).filter(evolution => !hasEvolution(build, evolution.id)
    && moduleRank(build, evolution.primary) >= 2 && moduleRank(build, evolution.partner) >= 1).map(evolution => evolution.id);
}

/** Reward identity, including consumed rewards, prevents duplicate level or encounter events. */
export function enqueueUpgrade(build: PlayerBuild, source: UpgradeSource, rewardId: string, sequence?: number, count = 1): boolean {
  if (!rewardId || !Number.isSafeInteger(count) || count < 1 || build.rewardHistory.some(reward => reward.id === rewardId)
    || build.pendingRewards.some(reward => reward.id === rewardId)) return false;
  const serial = sequence ?? (/\d+$/.test(rewardId) ? Number(rewardId.match(/\d+$/)?.[0]) : undefined);
  const watermarks = build.rewardWatermarks ??= {};
  if (serial !== undefined && (!Number.isSafeInteger(serial) || serial < 0 || serial <= (watermarks[source] ?? -1))) return false;
  if (serial !== undefined) watermarks[source] = serial + count - 1;
  const reward = { id: rewardId, source, sequence: serial, count };
  build.rewardHistory.push({ ...reward });
  if (build.rewardHistory.length > 32) build.rewardHistory.splice(0, build.rewardHistory.length - 32);
  const previous = build.pendingRewards[build.pendingRewards.length - 1];
  if (source === 'resonance' && previous?.source === source && previous.sequence !== undefined && serial === previous.sequence + (previous.count ?? 1)) previous.count = (previous.count ?? 1) + count;
  else build.pendingRewards.push({ ...reward });
  build.rewardSequence = (build.rewardSequence ?? 0) + count;
  return true;
}
function availableModules(build: PlayerBuild, level: number, context: ChoiceContext): ModuleId[] {
  void context;
  return Object.values(MODULES).filter(module => {
    return module.id !== 'chain' || level >= 4;
  }).map(module => module.id);
}
function hashSeed(seed: number, text: string): number {
  let hash = Number.isFinite(seed) ? seed | 0 : 12345;
  for (const character of text) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash;
}

/** An offer is stable until explicitly rerolled or consumed; this never changes the world. */
export function offerModules(build: PlayerBuild, level: number, seed: number, context: ChoiceContext = {}): UpgradeChoiceId[] {
  const reward = build.pendingRewards[0];
  if (!reward) return [];
  if (build.choices.length) return [...build.choices];
  const random = new SeededRandom(hashSeed(seed, `${reward.id}:${build.offerRevision}`));
  const available = availableModules(build, level, context), selected: UpgradeChoiceId[] = [];
  const addRandom = (pool: readonly UpgradeChoiceId[]) => {
    const candidates = pool.filter(id => !selected.includes(id));
    if (selected.length < 3 && candidates.length) selected.push(candidates[Math.floor(random.next() * candidates.length)]);
  };
  if (reward.source === 'boss' || reward.source === 'elite') addRandom(eligibleEvolutions(build).map(id => `evolution:${id}` as const));
  if (build.choiceIndex < 2) addRandom(available.filter(id => BEHAVIOR_MODULES.includes(id)));
  const owned = available.filter(id => moduleRank(build, id) > 0);
  const milestones = owned.filter(id => [2, 4].includes(moduleRank(build, id)));
  addRandom(milestones.length ? milestones : owned);
  const partners = Object.values(EVOLUTIONS).filter(evolution => moduleRank(build, evolution.primary) > 0 && !hasEvolution(build, evolution.id)).map(evolution => evolution.partner);
  const newModules = available.filter(id => moduleRank(build, id) === 0);
  addRandom(newModules.filter(id => partners.includes(id)));
  addRandom(newModules);
  while (selected.length < 3) {
    const previous = selected.length; addRandom(available); if (selected.length === previous) break;
  }
  for (const fallback of ['reward:heal', 'reward:bomb', 'reward:xp'] as const) if (selected.length < 3) selected.push(fallback);
  for (let index = selected.length - 1; index > 0; index--) {
    const other = Math.floor(random.next() * (index + 1)); [selected[index], selected[other]] = [selected[other], selected[index]];
  }
  build.choices = selected; build.offerId = `${reward.id}:${build.offerRevision}`;
  return [...selected];
}

/** The UI supplies offerId so a stale click cannot consume the next reward or a rerolled offer. */
export function chooseModule(build: PlayerBuild, id: UpgradeChoiceId, context: ChoiceContext = {}): boolean {
  if (!build.pendingRewards.length || !build.choices.includes(id)
    || (context.offerId !== undefined && context.offerId !== build.offerId)) return false;
  if (id.startsWith('evolution:')) {
    const evolution = id.slice('evolution:'.length) as EvolutionId;
    if (!['boss', 'elite'].includes(build.pendingRewards[0].source) || !eligibleEvolutions(build).includes(evolution)) return false;
    build.evolutions.push(evolution);
  } else if (!id.startsWith('reward:')) {
    const moduleId = id as ModuleId, rank = moduleRank(build, moduleId);
    if (!MODULES[moduleId]) return false;
    if (!rank) build.modules.push(moduleId);
    build.ranks[moduleId] = rank + 1;
  }
  const reward = build.pendingRewards[0];
  if ((reward.count ?? 1) > 1) { reward.count!--; reward.sequence = (reward.sequence ?? 0) + 1; reward.id = `${reward.source}:${reward.sequence}`; }
  else build.pendingRewards.shift();
  build.choices = []; build.offerId = null; build.offerRevision = 0; build.choiceIndex++;
  return true;
}
export function rerollModules(build: PlayerBuild, level: number, seed: number, context: ChoiceContext = {}): UpgradeChoiceId[] {
  if (!build.pendingRewards.length || !build.choices.length || build.rerollsRemaining <= 0
    || (context.offerId !== undefined && context.offerId !== build.offerId)) return [];
  const previous = [...build.choices]; build.rerollsRemaining--; build.offerRevision++; build.choices = [];
  let next = offerModules(build, level, seed, context);
  // A variable pool should change; an exhausted pool still correctly offers its three resources.
  for (let attempts = 0; attempts < 8 && next.every(id => previous.includes(id)); attempts++) {
    build.offerRevision++; build.choices = []; next = offerModules(build, level, seed, context);
  }
  return next;
}

export interface UpgradeChoiceView { id: UpgradeChoiceId; name: string; description: string; flavor: string; branch: ModuleBranch; kind: 'module' | 'rank' | 'evolution' | 'resource'; rank: ModuleRank | null }
const RESOURCE_CHOICES: Record<ResourceChoiceId, Pick<UpgradeChoiceView, 'name' | 'description' | 'flavor'>> = {
  'reward:heal': { name: '应急修复', description: '回复 2 HP；每点溢出治疗转换为 30 XP。', flavor: '笑梦：好啦！哇！真冬：……怎么又有力气了。' },
  'reward:bomb': { name: '炸弹补给', description: '获得 1 枚炸弹；达到上限时转换为 30 XP。', flavor: '笑梦：砰——！真冬：那个词，不准再喊！！' },
  'reward:xp': { name: '共鸣结晶', description: '获得 100 XP；保留升级溢出，Lv10 后计入共鸣。', flavor: '笑梦：又变强啦！真冬：……噪音还在增加。' },
};
export function choiceView(build: Pick<PlayerBuild, 'modules' | 'ranks'>, id: UpgradeChoiceId): UpgradeChoiceView {
  if (id.startsWith('evolution:')) {
    const evolution = EVOLUTIONS[id.slice('evolution:'.length) as EvolutionId];
    return { id, name: evolution.name, description: evolution.description, flavor: evolution.flavor, branch: MODULES[evolution.primary].branch, kind: 'evolution', rank: null };
  }
  if (id.startsWith('reward:')) return { id, ...RESOURCE_CHOICES[id as ResourceChoiceId], branch: 'resource', kind: 'resource', rank: null };
  const moduleId = id as ModuleId, module = MODULES[moduleId], rank = moduleRank(build, moduleId) + 1;
  return { id, name: module.name, description: moduleDescription(moduleId, rank), flavor: module.flavor, branch: module.branch, kind: rank === 1 ? 'module' : 'rank', rank };
}
const formatted = (value: number): string => Number(value.toFixed(3)).toString();
const MODULE_MECHANICS: Record<ModuleId, string> = {
  piercing: '基础主炮穿透不同目标', wingShots: '每轮主炮附加两侧翼弹', precision: '保持慢移后强化基础主炮', shatter: '基础主炮击杀迸发碎晶', chain: '特殊追踪弹连锁附近其他目标', prism: '贯穿炮分光，慢移改为集中束',
  droneHoming: '基础子机弹有限转向追踪', droneBurst: '基础子机命中积攒穿甲集火', slow: '子机命中减速普通怪，不影响首领或已承诺突进', division: '子机扩大射程并分散索敌', intercept: '最多储存一次敌弹拦截', orbitBlade: '子机接近主炮标记并用护刃伤敌',
  doubleDash: '最多两次冲刺库存，逐次回充', vent: '冲刺结束排热，不跳过过热锁定', reserveAmmo: '热量达到阈值自动降热', graze: '非无敌擦弹降热并返还部分冲刺回充', revive: '整局一次致命伤复苏，升级不恢复已消耗次数', magnet: '周期性牵引掉落',
  ricochet: '基础主炮命中后向另一目标反跳', rearSpark: '持续射击向身后发射短弹', crossOrbit: '子机扩大环绕轨道', returnWing: '周期性子机弹出射后原路返回', brakeField: '持续慢移形成普通怪减速场', dashEcho: '冲刺结束留下延时残影爆破',
  pulseChamber: '每五轮主炮发出前向声波，V 层变为双波', anchorStars: '主炮命中留下延爆星印，III / V 层追加三 / 六短芒', crescentMagazine: '持续射击追加弯月刃，III / V 层变为镜像双刃 / 三刃', beamCircuit: '贯穿炮沿原方向追加余光，III / V 层变为双 / 三束，不清弹',
  droneSpotlight: '现有子机蓄光后锁向发射，III / V 层最多两 / 三台依次参与', droneNotes: '子机留下靠近触发的音符，III / V 层成对 / 三角排布', dronePlectrum: '子机扫出刀弧，III / V 层展开半圈 / 整圈', droneConduit: '子机间连线伤敌，V 层三机闭合三角，整轮共享命中去重',
  decoyEcho: '冲刺留下误导普通怪的纸偶，III 层消失减速，V 层双纸偶', slipstream: '连续直线移动触发踏空，III 层推开普通怪，V 层追加减速', dashLane: '冲刺铺设航道，加速普通移动并减速普通怪，不叠乘', counterPulse: '实际受伤推开普通怪，III 层双环，V 层留下减速网格',
};
export function moduleDescription(id: ModuleId, rank: number): string {
  const module = MODULES[id];
  if (rank === 1) return module.description;
  if (rank === 2) return module.rank2Description;
  if ((NEW_MODULE_IDS as readonly string[]).includes(id)) {
    const stats = newModuleStats(id as NewModuleId, rank);
    const numbers = [stats.damage === undefined ? null : `伤害 ${formatted(stats.damage)}${id === 'droneSpotlight' ? '／束' : '／轮'}`, `冷却 ${formatted(stats.cooldown)} 秒`, stats.moveSpeed === undefined ? null : `普通移速 ${formatted(stats.moveSpeed)}`,
      stats.slow === undefined ? null : `减速 ${formatted(stats.slow * 100)}%`].filter(Boolean).join(' · ');
    return `${MODULE_MECHANICS[id]}。第 ${rank} 层：${numbers}。${rank > 5 ? '形态与实体数不再增加，后续递减成长。' : ''}`;
  }
  const temporary = { modules: [id], ranks: { [id]: rank } }, base = MODULE_VALUES[id as keyof typeof MODULE_VALUES];
  const stats = Object.entries(base).filter(([, value]) => Array.isArray(value)).map(([key, values]) => {
    const labels: Record<string, string> = { damage: '伤害', extraHits: '额外穿透', bonus: '主炮加成', targets: '连锁目标', sideDamage: '侧束伤害', focusDamage: '集中束伤害', duration: '持续秒数', hits: '命中需求', amount: '减速比例', range: '范围', cooldown: '冷却秒数', heat: '降热', recharge: '回充返还', refundCap: '单轮返还上限', hp: '复苏生命', invincible: '复苏无敌秒数', ratio: '反跳比例', radius: '半径', bonusRange: '额外射程', slow: '减速比例' };
    return `${labels[key] ?? key} ${formatted(rankValue(temporary, id, values as unknown as readonly [number, number]))}`;
  }).join(' · ');
  return `${MODULE_MECHANICS[id]}。第 ${rank} 层：${stats}。${id === 'revive' ? `受伤降热 ${rank >= 5 ? 12 : rank === 4 ? 10 : 8}，冷却 ${formatted(highRankCooldown(6, rank))} 秒；复苏仍整局一次，不恢复已消耗次数。` : '形态在 III / V 层展开，V 层后递减强化。'}`;
}
export function buildModuleViews(build: BuildView): { id: ModuleId; name: string; description: string; flavor: string; branch: ModuleBranch; rank: ModuleRank; evolution: EvolutionId | null }[] {
  return build.modules.map(id => {
    const module = MODULES[id], rank = moduleRank(build, id) as ModuleRank, evolution = evolutionForModule(build, id);
    return { id, name: evolution?.name ?? module.name, description: `${moduleDescription(id, rank)}${evolution ? ` ${evolution.description}` : ''}`,
      flavor: evolution?.flavor ?? module.flavor, branch: module.branch, rank, evolution: evolution?.id ?? null };
  });
}

/** Four legacy resonance damage ranks remain; every later 600 XP still grants a choice. */
export function buildDamageMultiplier(build: PlayerBuild, precisionActive = false): number {
  const resonance = Number.isFinite(build.resonance) ? clampResonance(build.resonance) : 0;
  return 1 + resonance * RESONANCE.damagePerRank + (precisionActive ? rankValue(build, 'precision', MODULE_VALUES.precision.bonus) : 0);
}
const clampResonance = (rank: number) => Math.max(0, Math.min(RESONANCE.maxRank, Math.floor(rank)));
export function addResonanceXp(build: PlayerBuild, amount: number, level = 10): number {
  if (level < 10 || !Number.isFinite(amount) || amount <= 0) return 0;
  build.resonanceXp += amount;
  const count = Math.floor(build.resonanceXp / RESONANCE.xpPerRank);
  if (count > 0) {
    const first = build.resonance + 1;
    if (!enqueueUpgrade(build, 'resonance', `resonance:${first}`, first, count)) return 0;
    build.resonance += count; build.resonanceXp %= RESONANCE.xpPerRank;
  }
  return count;
}
