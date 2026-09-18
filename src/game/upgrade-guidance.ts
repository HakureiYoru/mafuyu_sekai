import { EVOLUTIONS, MODULES, moduleRank } from './upgrades';
import type { EvolutionId, ModuleId, PlayerBuild, UpgradeChoiceId } from './types';

type BuildView = Pick<PlayerBuild, 'modules' | 'ranks' | 'evolutions'>;

export interface EvolutionPath {
  id: EvolutionId;
  name: string;
  primary: ModuleId;
  partner: ModuleId;
  primaryRank: number;
  partnerRank: number;
  status: 'evolved' | 'ready' | 'progress' | 'unstarted';
  missing: string[];
  stepsRemaining: number;
}

export interface ChoiceEvolutionHint {
  id: EvolutionId;
  name: string;
  text: string;
  status: 'ready' | 'closer' | 'start' | 'evolved';
}

const pathOrder: Record<EvolutionPath['status'], number> = { ready: 0, progress: 1, unstarted: 2, evolved: 3 };

/** Recipe progress counts module selections, including both ranks of an unowned primary. */
export function evolutionPaths(build: BuildView): EvolutionPath[] {
  return Object.values(EVOLUTIONS).map((recipe): EvolutionPath => {
    const primaryRank = moduleRank(build, recipe.primary), partnerRank = moduleRank(build, recipe.partner);
    const evolved = build.evolutions.includes(recipe.id), missing: string[] = [];
    if (!evolved) {
      if (primaryRank < 2) missing.push(`${MODULES[recipe.primary].name}${primaryRank ? '升至' : ''} II`);
      if (partnerRank < 1) missing.push(`${MODULES[recipe.partner].name} I`);
    }
    const stepsRemaining = evolved ? 0 : Math.max(0, 2 - primaryRank) + Math.max(0, 1 - partnerRank);
    return {
      id: recipe.id, name: recipe.name, primary: recipe.primary, partner: recipe.partner, primaryRank, partnerRank,
      status: evolved ? 'evolved' : stepsRemaining === 0 ? 'ready' : primaryRank || partnerRank ? 'progress' : 'unstarted',
      missing, stepsRemaining,
    };
  }).sort((a, b) => pathOrder[a.status] - pathOrder[b.status] || a.stepsRemaining - b.stepsRemaining);
}

/** Preview a selection without acquiring an evolution merely by completing its ingredients. */
export function choiceEvolutionHints(build: BuildView, id: UpgradeChoiceId): ChoiceEvolutionHint[] {
  if (id.startsWith('reward:')) return [];
  const next: BuildView = { modules: [...build.modules], ranks: { ...build.ranks }, evolutions: [...build.evolutions] };
  if (id.startsWith('evolution:')) {
    const evolutionId = id.slice('evolution:'.length) as EvolutionId;
    if (!EVOLUTIONS[evolutionId]) return [];
    if (!next.evolutions.includes(evolutionId)) next.evolutions.push(evolutionId);
    const path = evolutionPaths(next).find(item => item.id === evolutionId)!;
    return [{ id: path.id, name: path.name, text: '本次进化', status: 'evolved' }];
  }
  const moduleId = id as ModuleId;
  if (!MODULES[moduleId]) return [];
  const rank = moduleRank(build, moduleId);
  if (rank === 0) next.modules.push(moduleId);
  next.ranks[moduleId] = rank + 1;
  const before = new Map(evolutionPaths(build).map(path => [path.id, path]));
  const newlyReady = (path: EvolutionPath) => path.status === 'ready' && before.get(path.id)!.status !== 'ready';
  return evolutionPaths(next)
    .filter(path => path.status !== 'evolved' && (path.primary === moduleId || path.partner === moduleId))
    .sort((a, b) => Number(newlyReady(b)) - Number(newlyReady(a)))
    .map(path => ({
      id: path.id,
      name: path.name,
      text: path.status === 'ready' ? newlyReady(path) ? '选后配方齐全' : '配方已齐全' : `还缺 ${path.missing.join('、')}`,
      status: path.status === 'ready' ? 'ready' : before.get(path.id)!.status === 'unstarted' ? 'start' : 'closer',
    }));
}
