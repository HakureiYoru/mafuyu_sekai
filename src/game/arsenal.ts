import { clamp } from './math';
import { MODULES, moduleRank } from './upgrades';
import type { PlayerBuild } from './types';

/** Growth follows earned weapon level, never enemy HP or recursive proc damage. */
export const supportGrowth = (level: number) => 1 + 0.2 * (clamp(level, 1, 10) - 1);
export const wingGrowth = (level: number) => 1 + 0.25 * (clamp(level, 1, 10) - 1);
export const wingLanes = (rank: number) => rank >= 5 ? 3 : rank >= 3 ? 2 : 1;
export function droneSpecialization(build: PlayerBuild): number {
  const types = build.modules.filter(id => MODULES[id].branch === 'drone' && moduleRank(build, id) > 0).length;
  return 1 + Math.min(5, types) * 0.1;
}
export const ARSENAL_SYNERGIES = [
  { modules: ['piercing', 'precision'], name: '聚焦穿阵', text: '校准完成后每六轮追加一枚重针，造成当轮主炮75%的合计伤害，穿透五敌。' },
  { modules: ['wingShots', 'precision'], name: '交叉翼阵', text: '慢移时两侧翼炮交叉汇聚；普通移动时宽幅展开。' },
  { modules: ['wingShots', 'piercing'], name: '贯通翼列', text: '翼炮继承一半额外穿透，最多命中三敌。' },
  { modules: ['droneSpotlight', 'droneConduit'], name: '合唱聚光', text: '追光成束时同伴同步补射半伤光束；最多两束，每敌各一次。' },
  { modules: ['droneBurst', 'droneHoming'], name: '追迹重击', text: '共振穿甲弹获得有限追踪，减少高速目标闪避造成的空枪。' },
] as const;
