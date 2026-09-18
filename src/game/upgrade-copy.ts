import { createBuild, EVOLUTION_VALUES, highRankCooldown, highRankFactor, moduleRank, NEW_MODULE_IDS, newModuleStats, rankValue, resolveBuildStats, type NewModuleId } from './upgrades';
import type { EvolutionId, ModuleId, PlayerBuild, ResourceChoiceId, UpgradeChoiceId } from './types';

type BuildRanks = Pick<PlayerBuild, 'modules' | 'ranks'> & { evolutions?: readonly EvolutionId[] };
const number = (value: number): string => Number(value.toFixed(2)).toString();
const percent = (value: number): string => `${number(value * 100)}%`;

// Describe the resulting rank. Future milestones belong in the full detail pane.
function newModuleCopy(id: NewModuleId, rank: number, evolutions: readonly EvolutionId[]): string {
  const s = newModuleStats(id, rank), damage = number(s.damage ?? 0), each = number((s.damage ?? 0) / (s.count || 1));
  switch (id) {
    case 'pulseChamber': return `每五轮主炮发出${s.count}道声波，每道伤害${each}，最多命中三敌。`;
    case 'anchorStars': return `主炮命中留下延爆星印，爆破伤害${damage}${s.count ? `，散出${s.count}枚短芒` : ''}。`;
    case 'crescentMagazine': return `射击时追加${s.count}枚弯月刃，每枚伤害${each}，沿弧线穿过敌人。`;
    case 'beamCircuit': return `贯穿炮后追加${s.count}束余光，每束伤害${each}；不清弹。`;
    case 'droneSpotlight': return `最多${s.count}台现有子机依次发射短束，每束伤害${damage}。`;
    case 'droneNotes': return `子机每轮留下${s.count}枚感应音符，每枚伤害${each}，最多${s.capacity}枚。`;
    case 'dronePlectrum': return `子机扫出${number(s.arc * 180 / Math.PI)}°刀弧，伤害${damage}，每敌一次。`;
    case 'droneConduit': return `${rank >= 5 ? '三台子机可闭合三角' : '子机间连线伤敌'}，每敌伤害${damage}；一台时连接主机。`;
    case 'decoyEcho': return `冲刺留下${s.count}只纸偶，持续${number(s.duration)}秒，误导普通怪${rank >= 3 ? '，消失时减速' : ''}。`;
    case 'slipstream': return `直线移动1秒触发加速，普通移速${number(s.moveSpeed)}${rank >= 5 ? '，推开并减速普通怪' : rank >= 3 ? '，推开普通怪' : '；慢移和冲刺不变'}。`;
    case 'dashLane': return `冲刺留下${number(s.duration)}秒航道，普通移动加速${percent(s.moveBonus)}、普通怪减速${percent(s.slow)}。`;
    case 'counterPulse': return evolutions.includes('counterCurtain')
      ? `受伤${s.count === 2 ? '双圈' : ''}推开普通怪，首圈最多清三枚普通弹${rank >= 5 ? `；减速区25%，冷却${number(s.cooldown)}秒` : ''}。`
      : rank >= 5
      ? `受伤双圈推开普通怪，留下25%减速区；冷却${number(s.cooldown)}秒。`
      : rank >= 3 ? `受伤时两圈推开普通怪，第二圈半径${number(s.radius)}；不清弹。`
        : `受伤时推开${rank === 2 ? 150 : 130}内普通怪；冷却${number(s.cooldown)}秒，不增加无敌。`;
  }
}

function legacyModuleCopy(id: Exclude<ModuleId, NewModuleId>, rank: number, evolutions: readonly EvolutionId[]): string {
  const preview = createBuild(); preview.modules = [id]; preview.ranks[id] = rank;
  const s = resolveBuildStats(preview).values[id]!;
  switch (id) {
    case 'piercing': return evolutions.includes('needleArray')
      ? `慢移针弹最多命中${EVOLUTION_VALUES.needleArray.targets}敌；${rank > 5 ? `基础主炮伤害×${number(highRankFactor(rank))}` : `非慢移主炮额外穿透${s.extraHits}敌`}。`
      : `普通主炮额外穿透${s.extraHits}个不同目标${rank > 5 ? `，基础伤害×${number(highRankFactor(rank))}` : '，可连续命中前后敌人'}。`;
    case 'wingShots': return `每轮主炮两枚平行翼弹，各伤害${number(s.damage)}，不额外加热。`;
    case 'precision': return `保持慢移0.35秒后，普通主炮伤害增加${percent(s.bonus)}。`;
    case 'shatter': return `主炮击杀迸发六枚短程碎片，各伤害${number(s.damage)}。`;
    case 'chain': return `特殊弹命中后连锁最多${s.targets}个其他目标，各伤害${number(s.damage)}。`;
    case 'prism': return `贯穿炮两束侧束各伤害${number(s.sideDamage)}；慢移集中束首敌伤害${number(s.focusDamage)}。`;
    case 'droneHoming': return `基础子机弹转向追踪${number(s.duration)}秒，之后沿当前方向飞行。`;
    case 'droneBurst': return evolutions.includes('triangleAssault')
      ? `子机累计${s.hits}次基础命中后交叉集火，总伤害${number(EVOLUTION_VALUES.triangleAssault.damage * highRankFactor(rank))}，按子机数均分。`
      : `子机累计${s.hits}次基础命中追加穿甲弹，伤害${number(s.damage)}，最多命中两敌。`;
    case 'slow': return `子机命中使普通怪减速${percent(s.amount)}、持续0.8秒；首领不受影响。`;
    case 'division': return `子机索敌范围${number(s.range)}，自动优先分配不同目标。`;
    case 'intercept': return `每${number(s.cooldown)}秒储备一次拦截，消除附近一枚敌弹；最多储备一次。`;
    case 'orbitBlade': return `子机靠近主炮标记，用护刃造成${number(s.damage)}伤害；不挡敌弹。`;
    case 'doubleDash': return `冲刺最多储存两次，每次回充${number(s.cooldown)}秒，逐次回复。`;
    case 'vent': return `冲刺结束降低${number(s.heat)}热量；仍需等待强制过热锁定结束。`;
    case 'reserveAmmo': return `热量达到80时自动降低${number(s.heat)}；冷却${number(s.cooldown)}秒。`;
    case 'graze': return `非无敌擦弹降热${number(s.heat)}，返还冲刺回充${number(s.recharge)}秒；每秒最多三次。`;
    case 'revive': return rank >= 3
      ? `受伤降热${rank >= 5 ? 12 : rank === 4 ? 10 : 8}，冷却${number(highRankCooldown(6, rank))}秒；复苏仍整局一次，已用不恢复。`
      : `本局一次致命伤保留${s.hp} HP，获得${number(s.invincible)}秒无敌；已用次数不恢复。`;
    case 'magnet': return `每${number(s.cooldown)}秒牵引${number(s.range)}范围内掉落，持续0.8秒。`;
    case 'ricochet': return `主炮命中后向另一个目标反跳，造成原弹${percent(s.ratio)}伤害。`;
    case 'rearSpark': return `持续射击每${number(s.cooldown)}秒向后发两枚短弹，各伤害${number(s.damage)}。`;
    case 'crossOrbit': return `子机轨道半径${number(s.radius)}${s.bonusRange ? `，索敌范围额外增加${number(s.bonusRange)}` : '，均匀分布在玩家周围'}。`;
    case 'returnWing': return `每${number(s.cooldown)}秒一轮子机弹原路折返，同目标去回各命中一次。`;
    case 'brakeField': return `慢移0.6秒生成减速场，普通怪减速${percent(s.slow)}，半径${number(s.radius)}。`;
    case 'dashEcho': return evolutions.includes('echoTrail')
      ? `冲刺留下${EVOLUTION_VALUES.echoTrail.duration}秒尾迹，每敌一次伤害${number(rankValue(preview, id, EVOLUTION_VALUES.echoTrail.damage))}；不清弹。`
      : `冲刺结束留下延时爆破，伤害${number(s.damage)}、半径${number(s.radius)}；不清弹。`;
  }
}

const evolutionCopy: Record<EvolutionId, string> = {
  needleArray: '慢移时基础主炮合为一枚高速针弹，保留合计伤害，最多穿过五敌。',
  spiralBloom: '射击时每1.2秒追加六枚环形短弹，保留翼炮与尾弹。',
  forkNetwork: '特殊弹额外向最多两个目标发射追踪弹，保留原有连锁。',
  triangleAssault: '现有子机交叉发射穿甲弹，按子机数平分总伤害，每弹最多命中两敌。',
  huntingReturn: '护刃回到轨道的途中也能伤敌，每趟每敌一次；不挡敌弹。',
  echoTrail: '残影爆破改为0.75秒冲刺尾迹，沿途伤敌；保留双蓄，不清弹。',
  sonicBreak: '慢移声波末端分裂两枚声刃，各为声波伤害50%，不重复伤害原目标。',
  starCarpet: '星印爆破留下1秒星屑区，造成圆爆伤害40%，每敌一次。',
  lunarCut: '弯月刃沿原路径返回，回程伤害为去程60%，去回各命中一次。',
  choralBeam: '余光之后追加两束斜向侧声，不重复伤害余光目标，不清弹。',
  stageSpotlight: '追光束最多穿过三敌，末端追加光圈，不重复伤害该束目标。',
  staticGarden: '音符保留4.5秒，连线使普通怪减速25%，触发时追加电脉冲。',
  stringEcho: '扫弦结束追加一枚追踪刃，追击未被刀弧命中的目标，射程360。',
  triangleHall: '连线围成的区域减速普通怪20%，结束时边线追加一次伤害脉冲。',
  livingSpeaker: '纸偶吸引400内掉落，消失时收取已进入80内的道具。',
  headwindFlame: '加速期间每0.2秒向后发三枚短弹，每次加速最多四轮。',
  echoHighway: '离开航道后首次重返，沿航道发出伤害波；每条一次，不清弹。',
  counterCurtain: '首圈反压消除附近最多三枚普通敌弹，不影响激光或范围攻击。',
};

const resourceCopy: Record<ResourceChoiceId, string> = {
  'reward:heal': '回复2 HP，每点溢出治疗转换为30 XP。',
  'reward:bomb': '获得一枚炸弹，达到上限时转换为30 XP。',
  'reward:xp': '获得100 XP，保留升级溢出，Lv10后计入共鸣。',
};

/** Short choice-card summary; detailed descriptions remain the source for all secondary effects. */
export function compactChoiceDescription(build: BuildRanks, id: UpgradeChoiceId): string {
  if (id.startsWith('evolution:')) return evolutionCopy[id.slice('evolution:'.length) as EvolutionId];
  if (id.startsWith('reward:')) return resourceCopy[id as ResourceChoiceId];
  const moduleId = id as ModuleId, rank = moduleRank(build, moduleId) + 1, evolutions = build.evolutions ?? [];
  return (NEW_MODULE_IDS as readonly string[]).includes(moduleId)
    ? newModuleCopy(moduleId as NewModuleId, rank, evolutions)
    : legacyModuleCopy(moduleId as Exclude<ModuleId, NewModuleId>, rank, evolutions);
}
