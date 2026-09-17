import { describe, expect, it } from 'vitest';
import { CampaignDirector, CAMPAIGN_STAGES, CAMPAIGN_DURATION, ENCOUNTERS, ENEMY_INTRODUCTIONS, type CampaignAction } from './campaign';
import { FixedClock } from './clock';
import { STEP } from './config';

describe('continuous five-encounter campaign', () => {
  it('starts once at Lv1-era progression regardless of legacy season identity', () => {
    for (const season of ['s1', 's2'] as const) {
      const director = new CampaignDirector(season);
      expect(director.step(100)).toEqual([]);
      expect(director.start()).toEqual([{ type: 'stageStarted', stage: 1 }]); expect(director.start()).toEqual([]);
      expect(director.state).toMatchObject({ stage: 1, progression: 0, phase: 'stage', season: 's1' });
    }
  });
  it('gates 90/180/240/300/360, ignores wrong and duplicate kills, and completes only after LACUNA', () => {
    const director = new CampaignDirector(); director.start();
    for (let index = 0; index < 5; index++) {
      const stage = CAMPAIGN_STAGES[index];
      expect(director.step(stage.duration - STEP)).toEqual([]);
      expect(director.step(STEP)).toEqual([{ type: 'encounter', id: ENCOUNTERS[index], stage: index + 1 }]);
      expect(director.state.progression).toBe([90, 180, 240, 300, 360][index]);
      const locked = structuredClone(director.state);
      expect(director.step(120)).toEqual([]); expect(director.state).toEqual(locked);
      expect(director.defeatEncounter(ENCOUNTERS[(index + 1) % 5])).toEqual([]);
      const events = director.defeatEncounter(ENCOUNTERS[index]);
      if (index < 4) {
        expect(events).toEqual([{ type: 'encounterCleared', id: ENCOUNTERS[index], index }, { type: 'stageCleared', stage: index + 1 }, { type: 'stageStarted', stage: index + 2 }]);
        expect(director.state.phase).toBe('stage');
      } else expect(events).toEqual([{ type: 'complete', season: 's2' }]);
      expect(director.defeatEncounter(ENCOUNTERS[index])).toEqual([]);
    }
    expect(director.state.completedStages).toEqual([1, 2, 3, 4, 5]);
    expect(director.state.defeatedEncounters).toEqual(ENCOUNTERS);
  });
  it('introduces all eleven mixed mob families in authored order and budgets exactly 360 seconds', () => {
    expect(CAMPAIGN_STAGES.reduce((sum, stage) => sum + stage.duration, 0)).toBe(CAMPAIGN_DURATION);
    expect(ENEMY_INTRODUCTIONS.map(item => item.time)).toEqual([0, 20, 35, 60, 75, 110, 150, 180, 210, 240, 270]);
    expect(new Set(ENEMY_INTRODUCTIONS.map(item => item.type)).size).toBe(11);
  });
  it('preserves all gate transitions at 30/60/120/144 Hz with two seconds of real boss combat per gate', () => {
    const results = [30, 60, 120, 144].map(hz => {
      const director = new CampaignDirector(), clock = new FixedClock(), events: CampaignAction[] = director.start();
      let tick = 0, defeatAt = Infinity;
      for (let frame = 0; frame <= hz * 370; frame++) clock.advance(frame * 1000 / hz, dt => {
        tick++; const next = director.step(dt); events.push(...next);
        if (next.some(event => event.type === 'encounter')) defeatAt = tick + 120;
        if (director.state.activeEncounter && tick === defeatAt) events.push(...director.defeatEncounter(director.state.activeEncounter));
      });
      expect(director.state.phase).toBe('complete');
      const before = structuredClone(director.state);
      for (const dt of [0, -1, NaN, Infinity]) expect(director.step(dt)).toEqual([]);
      expect(director.state).toEqual(before);
      return { state: director.state, events, tick };
    });
    for (const result of results.slice(1)) expect(result).toEqual(results[0]);
  });
});
