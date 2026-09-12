import { describe, expect, it } from 'vitest';
import { CampaignDirector, SEASONS } from './campaign';
import type { CampaignAction, EncounterId } from './campaign';
import { STEP } from './config';
import { FixedClock } from './clock';

function advance(director: CampaignDirector, seconds: number): CampaignAction[] {
  const actions: CampaignAction[] = [];
  for (let tick = 0; tick < Math.round(seconds / STEP); tick++) actions.push(...director.step(STEP));
  return actions;
}

describe('campaign objectives and stage gates', () => {
  it('preserves the first-season timed ECHO gate and completes only its registered final encounter', () => {
    const director = new CampaignDirector('s1');
    expect(director.start()).toEqual([{ type: 'stageStarted', stage: 1 }]); expect(director.start()).toEqual([]);
    expect(advance(director, 80).filter(a => a.type === 'stageCleared').map(a => a.stage)).toEqual([1, 2]);
    expect(director.state.stage).toBe(3);
    expect(advance(director, 8 - STEP)).toEqual([]);
    expect(director.step(STEP)).toEqual([{ type: 'encounter', id: 's1:echo', stage: 3 }]);
    expect(advance(director, 32)).toEqual([]);
    expect(director.state).toMatchObject({ stage: 3, stageElapsed: 40, phase: 'encounter', activeEncounter: 's1:echo' });
    expect(advance(director, 120)).toEqual([]); expect(director.state.stageElapsed).toBe(40);
    expect(director.defeatEncounter('s2:final')).toEqual([]);
    expect(director.defeatEncounter('s1:echo')).toEqual([{ type: 'stageCleared', stage: 3 }, { type: 'stageStarted', stage: 4 }]);
    expect(director.defeatEncounter('s1:echo')).toEqual([]);
    expect(advance(director, 80).at(-1)).toEqual({ type: 'encounter', id: 's1:mafuyu', stage: 5 });
    expect(director.state.phase).toBe('encounter');
    expect(director.defeatEncounter('s1:mafuyu')).toEqual([{ type: 'complete', season: 's1' }]);
    expect(director.state.completedStages).toEqual([1, 2, 3, 4, 5]);
    expect(director.defeatEncounter('s1:mafuyu')).toEqual([]); expect(director.step(100)).toEqual([]);
  });

  it('allows an early ECHO kill without shortening its wave or spawning it again', () => {
    const director = new CampaignDirector('s1'); director.start(); advance(director, 88);
    expect(director.defeatEncounter('s1:echo')).toEqual([]);
    expect(director.state).toMatchObject({ stage: 3, stageElapsed: expect.closeTo(8), phase: 'stage', activeEncounter: null });
    expect(advance(director, 32)).toEqual([{ type: 'stageCleared', stage: 3 }, { type: 'stageStarted', stage: 4 }]);
    expect(director.state.defeatedEncounters).toEqual(['s1:echo']);
  });

  it('offers seven choices outside combat, gates stages two and four, then offers the final card before the final Boss', () => {
    const director = new CampaignDirector('s2');
    expect(director.step(75)).toEqual([]);
    const choices = director.start();
    expect(choices).toEqual([{ type: 'choice', index: 0, stage: 1 }]);
    expect(advance(director, 10)).toEqual([]); expect(director.state.stageElapsed).toBe(0);
    expect(director.resolveChoice()).toEqual([{ type: 'stageStarted', stage: 1 }]);
    expect(director.resolveChoice()).toEqual([]);
    const clears: number[] = [];
    for (let stage = 1; stage <= 6; stage++) {
      let actions = advance(director, 75);
      if (stage === 2 || stage === 4) {
        const id: EncounterId = stage === 2 ? 's2:palisade' : 's2:reprise';
        expect(actions).toEqual([{ type: 'catchup', stage, minLevel: stage === 2 ? 5 : 7, companions: 1, overflowXp: 60 }, { type: 'encounter', id, stage }]);
        expect(director.state.completedStages).not.toContain(stage);
        expect(advance(director, 40)).toEqual([]); expect(director.resolveChoice()).toEqual([]);
        expect(director.defeatEncounter('s1:mafuyu')).toEqual([]);
        actions = director.defeatEncounter(id);
        expect(director.defeatEncounter(id)).toEqual([]);
      }
      clears.push(...actions.filter(a => a.type === 'stageCleared').map(a => a.stage));
      choices.push(...actions.filter(a => a.type === 'choice'));
      expect(director.state.phase).toBe('choice');
      expect(director.resolveChoice()).toEqual(stage < 6 ? [{ type: 'stageStarted', stage: stage + 1 }] : [{ type: 'encounter', id: 's2:final', stage: 6 }]);
    }
    expect(clears).toEqual([1, 2, 3, 4, 5, 6]);
    expect(choices.filter(a => a.type === 'choice').map(a => a.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(director.state.choiceIndex).toBe(7); expect(director.state.phase).toBe('encounter');
    expect(director.state.catchupStages).toEqual([2, 4]);
    expect(director.defeatEncounter('s2:final')).toEqual([{ type: 'complete', season: 's2' }]);
  });

  it('awards catch-up at the exact pre-Boss boundary without repeating on waits, menus or duplicate defeat calls', () => {
    const director = new CampaignDirector('s2'); director.start(); director.resolveChoice();
    director.step(75); director.resolveChoice();
    expect(advance(director, 75 - STEP)).toEqual([]); expect(director.state.catchupStages).toEqual([]);
    expect(director.step(STEP)).toEqual([
      { type: 'catchup', stage: 2, minLevel: 5, companions: 1, overflowXp: 60 },
      { type: 'encounter', id: 's2:palisade', stage: 2 },
    ]);
    expect(director.state.completedStages).toEqual([1]);
    expect(director.start()).toEqual([]); expect(advance(director, 300)).toEqual([]); expect(director.resolveChoice()).toEqual([]);
    expect(director.defeatEncounter('s2:palisade').some(a => a.type === 'catchup')).toBe(false);
    expect(director.defeatEncounter('s2:palisade')).toEqual([]);
    expect(director.state.catchupStages).toEqual([2]);
    expect(new CampaignDirector('s2').state.catchupStages).toEqual([]);
    const firstSeason = new CampaignDirector('s1'); firstSeason.start();
    expect(advance(firstSeason, 88).some(a => a.type === 'catchup')).toBe(false);
    expect(firstSeason.state.catchupStages).toEqual([]);
  });

  it('covers all six new enemy families by stage four and keeps the six authored stage names', () => {
    expect(SEASONS.s2.name).toBe('第二季 · 镜界复奏');
    expect(SEASONS.s2.stages.map(s => s.name)).toEqual(['镜界入口', '幕门街区', '中继回廊', '复奏断层', '裂核庭院', '终章前线']);
    expect(new Set(SEASONS.s2.stages.slice(0, 4).flatMap(s => s.enemyPool ?? []))).toEqual(new Set(['shield', 'returner', 'weaver', 'sampler', 'repairer', 'carrier']));
    expect(SEASONS.s2.stages.reduce((sum, s) => sum + s.duration, 0)).toBe(450);
  });

  it('keeps all objective transitions deterministic at 30/60/120/144 Hz and ignores invalid elapsed values', () => {
    const results = [30, 60, 120, 144].map(hz => {
      const director = new CampaignDirector('s2'), clock = new FixedClock(), events: CampaignAction[] = [];
      let tick = 0, defeatAt = 0;
      const handle = (actions: CampaignAction[]) => {
        events.push(...actions);
        for (const action of actions) {
          if (action.type === 'choice') handle(director.resolveChoice());
          if (action.type === 'encounter') defeatAt = tick + 120;
        }
      };
      handle(director.start());
      for (let frame = 0; frame <= hz * 460; frame++) clock.advance(frame * 1000 / hz, dt => {
        tick++; handle(director.step(dt));
        if (director.state.activeEncounter && tick >= defeatAt) handle(director.defeatEncounter(director.state.activeEncounter));
      });
      expect(director.state.phase).toBe('complete');
      const before = structuredClone(director.state);
      for (const dt of [0, -1, NaN, Infinity]) expect(director.step(dt)).toEqual([]);
      expect(director.state).toEqual(before);
      return { state: director.state, events };
    });
    for (const result of results.slice(1)) expect(result).toEqual(results[0]);
    const fresh = new CampaignDirector('s2'); expect(fresh.state.completedStages).toEqual([]); expect(fresh.state.choiceIndex).toBe(0);
  });
});
