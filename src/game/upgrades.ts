import { SeededRandom } from './math';
import type { EvolutionId, ModuleId, ModuleRank, PlayerBuild, ResourceChoiceId, UpgradeChoiceId, UpgradeSource } from './types';

export type ModuleBranch = 'main' | 'drone' | 'resource';
export interface ModuleDefinition { id: ModuleId; name: string; branch: ModuleBranch; description: string; rank2Description: string; flavor: string }
// Original fan-game banter stays separate from the exact combat descriptions.
const MODULE_FLAVORS: Record<ModuleId, string> = {
  piercing: '笑梦：学姐们排好队，一个 Wonderhoy 都不能少！',
  wingShots: '单手打招呼不够热情，那就两边一起。',
  precision: '真冬：你终于愿意安静慢下来了。',
  shatter: '笑梦说这是彩纸。学姐建议别伸手接。',
  chain: '一个人听见 Wonderhoy，就会有更多人听见。',
  prism: '学姐，你的水族箱能借我打个舞台灯吗？',
  droneHoming: '小笑梦认准了学姐，绕路也要打招呼。',
  droneBurst: '大家一起喊！……学姐为什么往后退？',
  slow: '真冬：先慢一点。我还没说可以开演。',
  division: '小笑梦分头营业，每位学姐都得招呼到。',
  intercept: '收到学姐的回礼了！这个……好像不能接。',
  orbitBlade: '笑梦：小小的我，替我去和学姐贴贴！',
  doubleDash: '杂技演员的基本功：蹦过去，再蹦回来。',
  vent: '太热了？再跑一圈！这是笑梦的解决方案。',
  reserveAmmo: '凤凰乐园后台特供：让热情稍微冷静一下。',
  graze: '差一点就碰到了！这也算杂技成功吧？',
  revive: '还不能谢幕，Wonderhoy 才喊到一半！',
  magnet: '散场可以，亮晶晶的小道具必须全部带走。',
  ricochet: '这位学姐收到了，顺便也跟那位打个招呼。',
  rearSpark: '真冬：你走就走，为什么背后还在放礼花。',
  crossOrbit: '小笑梦们排成一圈。学姐没有参加游戏。',
  returnWing: '真冬：再见。……怎么又回来了？',
  brakeField: '笑梦把这叫慢动作表演。学姐只想暂停。',
  dashEcho: '笑梦已经跑远，留在原地的热情才刚开场。',
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
};

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
export interface EvolutionDefinition { id: EvolutionId; name: string; primary: ModuleId; partner: ModuleId; description: string; flavor: string }
export const EVOLUTIONS: Record<EvolutionId, EvolutionDefinition> = {
  needleArray: { id: 'needleArray', name: '针轨贯阵', primary: 'piercing', partner: 'precision', description: '慢移时将当轮基础主炮合为一枚高速针弹，保留合计伤害，最多命中五个不同目标；副弹独立。', flavor: '笑梦说学会了优等生的专注。专注于把全排学姐串起来。' },
  spiralBloom: { id: 'spiralBloom', name: '回旋花火', primary: 'wingShots', partner: 'rearSpark', description: '保留翼炮与尾弹，射击期间每 1.2 秒追加六枚环形短弹，各 2 伤害，射程 420。', flavor: '凤凰乐园巡回演出，临时加演空白 SEKAI 场！' },
  forkNetwork: { id: 'forkNetwork', name: '分叉电网', primary: 'chain', partner: 'slow', description: '保留特殊主弹与连锁，另向最多两个不同目标发射各 6 伤害的追踪弹；副弹不再连锁。', flavor: 'Wonderhoy 开始群发。真冬正在寻找免打扰按钮。' },
  triangleAssault: { id: 'triangleAssault', name: '三角围攻', primary: 'droneBurst', partner: 'crossOrbit', description: '集火追加弹由现有子机交叉发射，总伤害 18 按数量均分；每弹最多命中两个目标，保留 3 秒冷却。', flavor: '学姐左边有笑梦，右边有笑梦，正前方还是笑梦。' },
  huntingReturn: { id: 'huntingReturn', name: '巡猎回旋', primary: 'orbitBlade', partner: 'returnWing', description: '护刃返回轨道的途中也可伤害经过的敌人，每趟每敌一次 4 伤害；不阻挡敌弹。', flavor: '小笑梦：回后台之前，再和路上的学姐们打个招呼！' },
  echoTrail: { id: 'echoTrail', name: '残响疾行', primary: 'doubleDash', partner: 'dashEcho', description: '保留双蓄 II，残影爆破替换为持续 0.75 秒、宽 64 的冲刺尾迹；余迹 I／II 时每敌一次 8／12 伤害，冷却 4 秒，不清弹。', flavor: '真冬：人走了，Wonderhoy 还在地上。' },
};
export const EVOLUTION_VALUES = {
  needleArray: { targets: 5 }, spiralBloom: { cooldown: 1.2, count: 6, damage: 2, range: 420 },
  forkNetwork: { targets: 2, damage: 6 }, triangleAssault: { damage: 18, targets: 2, cooldown: 3 },
  huntingReturn: { damage: 4 }, echoTrail: { duration: 0.75, width: 64, damage: [8, 12], cooldown: 4 },
} as const;
export const RESONANCE = { xpPerRank: 600, maxRank: 4, damagePerRank: 0.05, maxDamageBonus: 0.5 } as const;
export const MODULE_CHOICE_LIMIT = 13;
export const MODULE_SLOT_LIMIT = 6;
export const EVOLUTION_LIMIT = 2;
export const BEHAVIOR_MODULES: readonly ModuleId[] = ['precision', 'prism', 'division', 'orbitBlade', 'doubleDash', 'rearSpark', 'crossOrbit', 'returnWing', 'brakeField', 'dashEcho'];
export interface ChoiceContext { reviveConsumed?: boolean; offerId?: string }
type BuildView = Pick<PlayerBuild, 'modules' | 'ranks' | 'evolutions'>;

export function createBuild(): PlayerBuild {
  return { modules: [], ranks: {}, evolutions: [], levelFloor: 1, resonance: 0, resonanceXp: 0, choices: [], choiceIndex: 0,
    pendingRewards: [], rewardHistory: [], rerollsRemaining: 2, offerRevision: 0, offerId: null };
}
export function moduleRank(build: Pick<PlayerBuild, 'modules' | 'ranks'>, id: ModuleId): 0 | ModuleRank {
  return build.modules.includes(id) ? build.ranks[id] === 2 ? 2 : 1 : 0;
}
export function rankValue(build: Pick<PlayerBuild, 'modules' | 'ranks'>, id: ModuleId, values: readonly [number, number]): number {
  const rank = moduleRank(build, id); return rank ? values[rank - 1] : 0;
}
export function hasEvolution(build: Pick<PlayerBuild, 'evolutions'>, id: EvolutionId): boolean { return build.evolutions.includes(id); }
export function evolutionForModule(build: BuildView, id: ModuleId): EvolutionDefinition | undefined {
  return build.evolutions.map(evolution => EVOLUTIONS[evolution]).find(evolution => evolution.primary === id);
}
export function eligibleEvolutions(build: BuildView): EvolutionId[] {
  if (build.evolutions.length >= EVOLUTION_LIMIT) return [];
  return Object.values(EVOLUTIONS).filter(evolution => !hasEvolution(build, evolution.id)
    && moduleRank(build, evolution.primary) === 2 && moduleRank(build, evolution.partner) >= 1).map(evolution => evolution.id);
}

/** Reward identity, including consumed rewards, prevents duplicate level or encounter events. */
export function enqueueUpgrade(build: PlayerBuild, source: UpgradeSource, rewardId: string): boolean {
  if (!rewardId || build.rewardHistory.length >= MODULE_CHOICE_LIMIT || build.rewardHistory.some(reward => reward.id === rewardId)
    || build.rewardHistory.filter(reward => reward.source === source).length >= (source === 'level' ? 9 : 4)) return false;
  const reward = { id: rewardId, source }; build.rewardHistory.push(reward); build.pendingRewards.push({ ...reward }); return true;
}
function availableModules(build: PlayerBuild, level: number, context: ChoiceContext): ModuleId[] {
  return Object.values(MODULES).filter(module => {
    const rank = moduleRank(build, module.id);
    return rank < 2 && (rank > 0 || build.modules.length < MODULE_SLOT_LIMIT) && (module.id !== 'chain' || level >= 4)
      && !(module.id === 'revive' && context.reviveConsumed) && !evolutionForModule(build, module.id);
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
  if (!reward || build.choiceIndex >= MODULE_CHOICE_LIMIT) return [];
  if (build.choices.length) return [...build.choices];
  const random = new SeededRandom(hashSeed(seed, `${reward.id}:${build.offerRevision}`));
  const available = availableModules(build, level, context), selected: UpgradeChoiceId[] = [];
  const addRandom = (pool: readonly UpgradeChoiceId[]) => {
    const candidates = pool.filter(id => !selected.includes(id));
    if (selected.length < 3 && candidates.length) selected.push(candidates[Math.floor(random.next() * candidates.length)]);
  };
  if (reward.source === 'boss') addRandom(eligibleEvolutions(build).map(id => `evolution:${id}` as const));
  if (build.choiceIndex < 2) addRandom(available.filter(id => BEHAVIOR_MODULES.includes(id)));
  addRandom(available.filter(id => moduleRank(build, id) === 1));
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
  if (!build.pendingRewards.length || build.choiceIndex >= MODULE_CHOICE_LIMIT || !build.choices.includes(id)
    || (context.offerId !== undefined && context.offerId !== build.offerId)) return false;
  if (id.startsWith('evolution:')) {
    const evolution = id.slice('evolution:'.length) as EvolutionId;
    if (build.pendingRewards[0].source !== 'boss' || !eligibleEvolutions(build).includes(evolution)) return false;
    build.evolutions.push(evolution);
  } else if (!id.startsWith('reward:')) {
    const moduleId = id as ModuleId, rank = moduleRank(build, moduleId);
    if (!MODULES[moduleId] || rank >= 2 || (rank === 0 && build.modules.length >= MODULE_SLOT_LIMIT)
      || (moduleId === 'revive' && context.reviveConsumed) || evolutionForModule(build, moduleId)) return false;
    if (!rank) build.modules.push(moduleId);
    build.ranks[moduleId] = rank === 0 ? 1 : 2;
  }
  build.pendingRewards.shift(); build.choices = []; build.offerId = null; build.offerRevision = 0; build.choiceIndex++;
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
  'reward:heal': { name: '应急修复', description: '回复 2 HP；每点溢出治疗转换为 30 XP。', flavor: '真冬：休息一下吧。笑梦：好！休息完啦！' },
  'reward:bomb': { name: '炸弹补给', description: '获得 1 枚炸弹；达到上限时转换为 30 XP。', flavor: '谢幕礼炮。笑梦坚持认为现在还没到谢幕的时候。' },
  'reward:xp': { name: '共鸣结晶', description: '获得 100 XP；保留升级溢出，Lv10 后计入共鸣。', flavor: '被学姐礼貌送客，也是一种宝贵的舞台经验。' },
};
export function choiceView(build: Pick<PlayerBuild, 'modules' | 'ranks'>, id: UpgradeChoiceId): UpgradeChoiceView {
  if (id.startsWith('evolution:')) {
    const evolution = EVOLUTIONS[id.slice('evolution:'.length) as EvolutionId];
    return { id, name: evolution.name, description: evolution.description, flavor: evolution.flavor, branch: MODULES[evolution.primary].branch, kind: 'evolution', rank: null };
  }
  if (id.startsWith('reward:')) return { id, ...RESOURCE_CHOICES[id as ResourceChoiceId], branch: 'resource', kind: 'resource', rank: null };
  const moduleId = id as ModuleId, module = MODULES[moduleId], rank = moduleRank(build, moduleId) ? 2 : 1;
  return { id, name: module.name, description: rank === 1 ? module.description : module.rank2Description, flavor: module.flavor, branch: module.branch, kind: rank === 1 ? 'module' : 'rank', rank };
}
export function buildModuleViews(build: BuildView): { id: ModuleId; name: string; description: string; flavor: string; branch: ModuleBranch; rank: ModuleRank; evolution: EvolutionId | null }[] {
  return build.modules.map(id => {
    const module = MODULES[id], rank = moduleRank(build, id) as ModuleRank, evolution = evolutionForModule(build, id);
    return { id, name: evolution?.name ?? module.name, description: evolution?.description ?? (rank === 2 ? module.rank2Description : module.description),
      flavor: evolution?.flavor ?? module.flavor, branch: module.branch, rank, evolution: evolution?.id ?? null };
  });
}

/** Precision applies only to the ordinary main shot, and combines additively with resonance. */
export function buildDamageMultiplier(build: PlayerBuild, precisionActive = false): number {
  const resonance = Number.isFinite(build.resonance) ? Math.max(0, Math.min(RESONANCE.maxRank, Math.floor(build.resonance))) : 0;
  return 1 + resonance * RESONANCE.damagePerRank + (precisionActive ? rankValue(build, 'precision', MODULE_VALUES.precision.bonus) : 0);
}
export function addResonanceXp(build: PlayerBuild, amount: number, level = 10): number {
  if (level < 10 || !Number.isFinite(amount) || amount <= 0 || build.resonance >= RESONANCE.maxRank) return 0;
  const before = build.resonance; build.resonanceXp += amount;
  build.resonance = Math.min(RESONANCE.maxRank, build.resonance + Math.floor(build.resonanceXp / RESONANCE.xpPerRank));
  build.resonanceXp = build.resonance === RESONANCE.maxRank ? 0 : build.resonanceXp % RESONANCE.xpPerRank;
  return build.resonance - before;
}
