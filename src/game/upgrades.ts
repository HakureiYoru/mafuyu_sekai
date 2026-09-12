import { SeededRandom } from './math';
import type { CarryoverSnapshot, ModuleId, PlayerBuild } from './types';

export type ModuleBranch = 'main' | 'drone' | 'resource';
export interface ModuleDefinition { id: ModuleId; name: string; branch: ModuleBranch; description: string }
export const MODULES: Record<ModuleId, ModuleDefinition> = {
  piercing: { id: 'piercing', name: '贯通线圈', branch: 'main', description: '普通主炮额外穿透 1 个不同目标；同一目标不重复受伤。' },
  wingShots: { id: 'wingShots', name: '双联翼炮', branch: 'main', description: '每轮追加两枚平行副弹，各造成 1 点伤害，不额外消耗弹药或热量。' },
  precision: { id: 'precision', name: '精密校准', branch: 'main', description: '保持慢速瞄准 0.35 秒后，普通主炮伤害增加 20%；松开后结束。' },
  shatter: { id: 'shatter', name: '碎晶弹头', branch: 'main', description: '主炮击杀迸发 6 枚伤害为 1 的短程碎片；冷却 0.45 秒，碎片不会再次引爆。' },
  chain: { id: 'chain', name: '导电追踪', branch: 'main', description: '特殊弹索敌扩大至 600；命中后向 220 内最多两个其他目标连锁，各造成 5 点伤害。' },
  prism: { id: 'prism', name: '分光棱镜', branch: 'main', description: '冲刺光束追加两束侧向光束，各造成 12 点伤害；副束不清弹、不重复伤害主束目标。' },
  droneHoming: { id: 'droneHoming', name: '追迹矩阵', branch: 'drone', description: '基础子机弹获得 1.2 秒有限追踪，最大转速 2 弧度／秒。' },
  droneBurst: { id: 'droneBurst', name: '共振集火', branch: 'drone', description: '子机累计 12 次基础弹命中追加一枚伤害为 12 的穿甲弹；最多命中两个目标，冷却至少 3 秒。' },
  slow: { id: 'slow', name: '离子束缚', branch: 'drone', description: '子机命中使普通怪移动减速 25%，持续 0.8 秒；不影响 Boss 或已承诺的突进。' },
  division: { id: 'division', name: '分工索敌', branch: 'drone', description: '子机索敌扩大至 720，优先分配不同目标；目标不足时共同集火。' },
  intercept: { id: 'intercept', name: '防卫拦截', branch: 'drone', description: '每 8 秒储备一次拦截，消除进入玩家周围 90 内的一枚敌弹；不拦截激光或地面攻击。' },
  orbitBlade: { id: 'orbitBlade', name: '轨道护刃', branch: 'drone', description: '子机获得半径 24 的攻击圈，造成 4 点伤害；同一目标共享 0.4 秒冷却，不挡敌弹。' },
  doubleDash: { id: 'doubleDash', name: '双蓄推进', branch: 'resource', description: '冲刺最多储存两次，按原冷却逐次回复；强化光束机会不会叠加。' },
  vent: { id: 'vent', name: '排热喷口', branch: 'resource', description: '冲刺结束降低 25 热量，冷却 4 秒；不缩短过热的强制锁定。' },
  reserveAmmo: { id: 'reserveAmmo', name: '备用弹匣', branch: 'resource', description: '弹药低于 20 时自动补充 30，冷却 10 秒；不解除过热。' },
  graze: { id: 'graze', name: '擦弹回收', branch: 'resource', description: '非无敌状态擦过敌弹返还 1 弹药并降低 1 热量；每秒最多三次，每枚敌弹仅一次。' },
  revive: { id: 'revive', name: '复苏应答', branch: 'resource', description: '本次挑战一次：致命伤改为剩余 1 点生命，并获得 0.8 秒无敌；仍损失经验。' },
  magnet: { id: 'magnet', name: '寻物脉冲', branch: 'resource', description: '每 10 秒触发 0.8 秒、范围 600 的拾取牵引；只吸引已有掉落。' },
};
export const RESONANCE = { xpPerRank: 600, maxRank: 4, damagePerRank: 0.05, maxDamageBonus: 0.4 } as const;
export const MODULE_CHOICE_LIMIT = 7;

export function createBuild(carryover?: CarryoverSnapshot): PlayerBuild {
  const level = carryover?.level;
  return { modules: [], levelFloor: typeof level === 'number' && Number.isFinite(level) ? Math.max(1, Math.min(10, Math.floor(level))) : 1,
    resonance: 0, resonanceXp: 0, choices: [], choiceIndex: 0 };
}

/** Called only at campaign choice gates. Reopening the same gate never rerolls an existing offer. */
export function offerModules(build: PlayerBuild, level: number, seed: number): ModuleId[] {
  if (build.choiceIndex >= MODULE_CHOICE_LIMIT) return [];
  if (build.choices.length) return [...build.choices];
  const available = Object.values(MODULES).filter(module => !build.modules.includes(module.id) && (module.id !== 'chain' || level >= 4));
  const random = new SeededRandom((Number.isFinite(seed) ? seed : 12345) ^ Math.imul(build.choiceIndex + 1, 0x9e3779b1));
  const take = (pool: ModuleDefinition[]) => pool[Math.floor(random.next() * pool.length)].id;
  const selected: ModuleId[] = [];
  for (const branch of ['main', 'drone', 'resource'] as const) {
    const pool = available.filter(module => module.branch === branch);
    if (pool.length) selected.push(take(pool));
  }
  while (selected.length < 3) {
    const pool = available.filter(module => !selected.includes(module.id));
    if (!pool.length) break;
    selected.push(take(pool));
  }
  for (let index = selected.length - 1; index > 0; index--) {
    const other = Math.floor(random.next() * (index + 1));
    [selected[index], selected[other]] = [selected[other], selected[index]];
  }
  build.choices = selected;
  return [...selected];
}

/** Only IDs from the pending offer can be committed, once. Modules survive damage until the run resets. */
export function chooseModule(build: PlayerBuild, id: ModuleId): boolean {
  if (build.choiceIndex >= MODULE_CHOICE_LIMIT || !build.choices.includes(id) || build.modules.includes(id) || !MODULES[id]) return false;
  build.modules.push(id); build.choices = []; build.choiceIndex++;
  return true;
}

/** Precision is a main-shot-only condition supplied by the combat caller; other sources get resonance alone. */
export function buildDamageMultiplier(build: PlayerBuild, precisionActive = false): number {
  const rank = Number.isFinite(build.resonance) ? Math.max(0, Math.min(RESONANCE.maxRank, Math.floor(build.resonance))) : 0;
  const precision = precisionActive && build.modules.includes('precision') ? 0.2 : 0;
  return 1 + Math.min(RESONANCE.maxDamageBonus, rank * RESONANCE.damagePerRank + precision);
}

/** Feed only XP left after normal weapon leveling. Returns newly earned resonance ranks. */
export function addResonanceXp(build: PlayerBuild, amount: number, level = 10): number {
  if (level < 10 || !Number.isFinite(amount) || amount <= 0 || build.resonance >= RESONANCE.maxRank) return 0;
  const before = build.resonance;
  build.resonanceXp += amount;
  const ranks = Math.floor(build.resonanceXp / RESONANCE.xpPerRank);
  build.resonance = Math.min(RESONANCE.maxRank, build.resonance + ranks);
  build.resonanceXp = build.resonance === RESONANCE.maxRank ? 0 : build.resonanceXp % RESONANCE.xpPerRank;
  return build.resonance - before;
}
