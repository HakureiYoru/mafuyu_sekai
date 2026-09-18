import { describe, expect, it } from 'vitest';
import { choiceEvolutionHints, evolutionPaths } from './upgrade-guidance';
import { createBuild, EVOLUTIONS } from './upgrades';
import type { ModuleId, PlayerBuild } from './types';

function own(build: PlayerBuild, id: ModuleId, rank = 1) {
  if (!build.modules.includes(id)) build.modules.push(id);
  build.ranks[id] = rank;
}

describe('evolution path guidance', () => {
  it('counts an absent primary as two selections and describes rank I to II growth', () => {
    const build = createBuild();
    expect(evolutionPaths(build).find(path => path.id === 'needleArray')).toMatchObject({
      primaryRank: 0, partnerRank: 0, status: 'unstarted', missing: ['贯通线圈 II', '精密校准 I'], stepsRemaining: 3,
    });
    own(build, 'piercing');
    expect(evolutionPaths(build).find(path => path.id === 'needleArray')).toMatchObject({
      primaryRank: 1, partnerRank: 0, status: 'progress', missing: ['贯通线圈升至 II', '精密校准 I'], stepsRemaining: 2,
    });
    own(build, 'precision');
    expect(evolutionPaths(build).find(path => path.id === 'needleArray')).toMatchObject({
      primaryRank: 1, partnerRank: 1, status: 'progress', missing: ['贯通线圈升至 II'], stepsRemaining: 1,
    });
  });

  it('recognizes partner-only progress without treating the partner as the rank-II requirement', () => {
    const build = createBuild();
    own(build, 'crossOrbit', 2);
    const relevant = evolutionPaths(build).filter(path => path.partner === 'crossOrbit');
    expect(relevant.map(path => path.id)).toEqual(['triangleAssault', 'triangleHall']);
    expect(relevant.every(path => path.status === 'progress' && path.stepsRemaining === 2 && path.partnerRank === 2)).toBe(true);
    expect(relevant[0].missing).toEqual(['共振集火 II']);
    expect(relevant[1].missing).toEqual(['束流棱台 II']);
  });

  it.each(Object.values(EVOLUTIONS))('$name follows the real II + I recipe, including ranks above II', recipe => {
    const build = createBuild();
    own(build, recipe.primary, 1);
    own(build, recipe.partner, 1);
    expect(evolutionPaths(build).find(path => path.id === recipe.id)?.status).toBe('progress');
    build.ranks[recipe.primary] = 2;
    expect(evolutionPaths(build).find(path => path.id === recipe.id)).toMatchObject({ status: 'ready', missing: [], stepsRemaining: 0 });
    build.ranks[recipe.primary] = 50;
    expect(evolutionPaths(build).find(path => path.id === recipe.id)).toMatchObject({ primaryRank: 50, status: 'ready', stepsRemaining: 0 });
    build.evolutions.push(recipe.id);
    expect(evolutionPaths(build).find(path => path.id === recipe.id)).toMatchObject({ status: 'evolved', missing: [], stepsRemaining: 0 });
  });

  it('sorts ready, nearest started, unstarted, and completed paths in that order', () => {
    const build = createBuild();
    own(build, 'piercing', 2); own(build, 'precision');
    own(build, 'chain'); own(build, 'slow');
    own(build, 'crossOrbit');
    own(build, 'wingShots', 2); own(build, 'rearSpark');
    build.evolutions.push('spiralBloom');
    const paths = evolutionPaths(build), order = { ready: 0, progress: 1, unstarted: 2, evolved: 3 };
    expect(paths[0].id).toBe('needleArray');
    expect(paths[1].id).toBe('forkNetwork');
    expect(paths.at(-1)?.id).toBe('spiralBloom');
    for (let index = 1; index < paths.length; index++) {
      expect(order[paths[index - 1].status]).toBeLessThanOrEqual(order[paths[index].status]);
      if (paths[index].status === 'progress' && paths[index - 1].status === 'progress') {
        expect(paths[index - 1].stepsRemaining).toBeLessThanOrEqual(paths[index].stepsRemaining);
      }
    }
  });
});

describe('choice-specific evolution guidance', () => {
  it('previews the first primary rank and then rank II without claiming an instant evolution', () => {
    const build = createBuild();
    expect(choiceEvolutionHints(build, 'piercing').find(hint => hint.id === 'needleArray')).toEqual({
      id: 'needleArray', name: '针轨贯阵', text: '还缺 贯通线圈升至 II、精密校准 I', status: 'start',
    });
    own(build, 'piercing'); own(build, 'precision');
    expect(choiceEvolutionHints(build, 'piercing')[0]).toEqual({
      id: 'needleArray', name: '针轨贯阵', text: '选后配方齐全', status: 'ready',
    });
    expect(build.evolutions).toEqual([]);
    expect(choiceEvolutionHints(build, 'piercing').every(hint => hint.status !== 'evolved' && !hint.text.includes('本次进化'))).toBe(true);
  });

  it('shows reverse-role partner choices and all recipes sharing a partner, with the closest first', () => {
    const build = createBuild();
    own(build, 'droneBurst', 1); own(build, 'droneConduit', 2);
    expect(choiceEvolutionHints(build, 'crossOrbit')).toEqual([
      { id: 'triangleHall', name: '三角回廊', text: '选后配方齐全', status: 'ready' },
      { id: 'triangleAssault', name: '三角围攻', text: '还缺 共振集火升至 II', status: 'closer' },
    ]);
  });

  it('prioritizes a newly completed recipe over an already ready recipe for the same choice', () => {
    const build = createBuild();
    own(build, 'piercing'); own(build, 'precision'); own(build, 'crescentMagazine', 2);
    expect(choiceEvolutionHints(build, 'piercing').map(hint => hint.id)).toEqual(['needleArray', 'lunarCut']);
    expect(choiceEvolutionHints(build, 'piercing').every(hint => hint.status === 'ready')).toBe(true);
    expect(choiceEvolutionHints(build, 'piercing').map(hint => hint.text)).toEqual(['选后配方齐全', '配方已齐全']);
  });

  it('omits acquired evolutions from ordinary cards but identifies an actual evolution selection', () => {
    const build = createBuild();
    own(build, 'droneBurst', 2); own(build, 'crossOrbit');
    build.evolutions.push('triangleAssault');
    expect(choiceEvolutionHints(build, 'crossOrbit').map(hint => hint.id)).toEqual(['triangleHall']);
    expect(choiceEvolutionHints(build, 'droneBurst')).toEqual([]);
    expect(choiceEvolutionHints(build, 'evolution:triangleAssault')).toEqual([
      { id: 'triangleAssault', name: '三角围攻', text: '本次进化', status: 'evolved' },
    ]);
    expect(choiceEvolutionHints(build, 'reward:heal')).toEqual([]);
  });

  it('uses legacy implicit rank I and ignores unowned rank entries just like gameplay', () => {
    const build = createBuild();
    build.modules.push('piercing'); build.ranks.precision = 100;
    expect(evolutionPaths(build).find(path => path.id === 'needleArray')).toMatchObject({ primaryRank: 1, partnerRank: 0, stepsRemaining: 2 });
    expect(choiceEvolutionHints(build, 'precision').find(hint => hint.id === 'needleArray')).toMatchObject({ text: '还缺 贯通线圈升至 II', status: 'closer' });
  });

  it('leaves source arrays, ranks, and definitions untouched and returns independent results', () => {
    const build = createBuild();
    own(build, 'piercing'); own(build, 'precision');
    const original = structuredClone(build), definitions = structuredClone(EVOLUTIONS);
    Object.freeze(build.modules); Object.freeze(build.ranks); Object.freeze(build.evolutions); Object.freeze(build);
    const paths = evolutionPaths(build), hints = choiceEvolutionHints(build, 'piercing');
    choiceEvolutionHints(build, 'evolution:needleArray');
    paths[0].missing.push('污染'); paths[0].name = '污染'; hints[0].text = '污染';
    expect(build).toEqual(original);
    expect(EVOLUTIONS).toEqual(definitions);
    expect(evolutionPaths(build).some(path => path.missing.includes('污染') || path.name === '污染')).toBe(false);
    expect(choiceEvolutionHints(build, 'piercing').some(hint => hint.text === '污染')).toBe(false);
  });
});
