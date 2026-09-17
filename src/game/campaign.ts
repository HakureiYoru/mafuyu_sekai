import type { EnemyType, SeasonId } from './types';

export type EncounterId = 's1:echo' | 's1:mafuyu' | 's2:palisade' | 's2:reprise' | 's2:final';
export interface CampaignStage { name: string; duration: number; eliteTime: number; enemyPool?: EnemyType[]; exitEncounter: EncounterId; midEncounter?: { time: number; id: EncounterId } }
export const CAMPAIGN_STAGES: readonly CampaignStage[] = [
  { name: '空白被吵醒', duration: 90, eliteTime: 40, exitEncounter: 's1:echo' },
  { name: '拒绝你的声音', duration: 90, eliteTime: 40, exitEncounter: 's2:palisade' },
  { name: '笑容开始崩裂', duration: 60, eliteTime: 30, exitEncounter: 's1:mafuyu' },
  { name: '回声停不下来', duration: 60, eliteTime: 30, exitEncounter: 's2:reprise' },
  { name: '25时全面失控', duration: 60, eliteTime: 30, exitEncounter: 's2:final' },
];
export const CAMPAIGN_DURATION = 360;
export const ENCOUNTERS = CAMPAIGN_STAGES.map(stage => stage.exitEncounter);
export const ENEMY_INTRODUCTIONS: readonly { time: number; type: EnemyType }[] = [
  { time: 0, type: 'basic' }, { time: 20, type: 'dasher' }, { time: 35, type: 'returner' },
  { time: 60, type: 'sniper' }, { time: 75, type: 'shield' }, { time: 110, type: 'carrier' },
  { time: 150, type: 'minelayer' }, { time: 180, type: 'weaver' }, { time: 210, type: 'repairer' },
  { time: 240, type: 'sprayer' }, { time: 270, type: 'sampler' },
];
export interface CampaignDefinition { id: string; duration: number; stages: readonly CampaignStage[]; finalEncounter: EncounterId }
export const CAMPAIGN: CampaignDefinition = { id: 'continuous', duration: CAMPAIGN_DURATION, stages: CAMPAIGN_STAGES, finalEncounter: 's2:final' };
export interface CampaignProgress {
  season: SeasonId; stage: number; stageElapsed: number; progression: number;
  phase: 'stage' | 'encounter' | 'choice' | 'complete'; activeEncounter: EncounterId | null;
  completedStages: number[]; defeatedEncounters: EncounterId[]; choiceIndex: number;
  activeElite: string | null; spawnedElites: string[]; defeatedElites: string[]; eliteGate: boolean;
}
export type CampaignAction =
  | { type: 'stageStarted'; stage: number }
  | { type: 'stageCleared'; stage: number }
  | { type: 'encounter'; id: EncounterId; stage: number }
  | { type: 'encounterCleared'; id: EncounterId; index: number }
  | { type: 'elite'; id: string; stage: number; variant: 0 | 1 }
  | { type: 'eliteCleared'; id: string; stage: number }
  | { type: 'complete'; season: SeasonId };
const EPSILON = 1e-8;

/** Only ordinary combat advances progression. Simulation time and enemy clocks remain independent. */
export class CampaignDirector {
  readonly state: CampaignProgress;
  private started = false;
  constructor(_season: SeasonId = 's1', private readonly seed = 1) {
    this.state = { season: 's1', stage: 1, stageElapsed: 0, progression: 0, phase: 'stage', activeEncounter: null,
      completedStages: [], defeatedEncounters: [], choiceIndex: 0, activeElite: null, spawnedElites: [], defeatedElites: [], eliteGate: false };
  }
  start(): CampaignAction[] { if (this.started) return []; this.started = true; return [{ type: 'stageStarted', stage: 1 }]; }
  step(dt: number): CampaignAction[] {
    const p = this.state;
    if (!this.started || !Number.isFinite(dt) || dt <= 0 || p.phase !== 'stage') return [];
    const stage = CAMPAIGN_STAGES[p.stage - 1];
    if (!stage) return [];
    const actions: CampaignAction[] = [];
    p.stageElapsed = Math.min(stage.duration, p.stageElapsed + dt);
    p.progression = CAMPAIGN_STAGES.slice(0, p.stage - 1).reduce((sum, item) => sum + item.duration, 0) + p.stageElapsed;
    if (p.stageElapsed >= stage.eliteTime - EPSILON && !p.spawnedElites.some(id => id.startsWith(`elite:${p.stage}:`))) {
      const hash = Math.imul((this.seed | 0) ^ Math.imul(p.stage, 0x9e3779b1), 0x85ebca6b);
      const variant = ((hash ^ (hash >>> 16)) & 1) as 0 | 1;
      const id = `elite:${p.stage}:${variant}`;
      p.activeElite = id; p.spawnedElites.push(id);
      actions.push({ type: 'elite', id, stage: p.stage, variant });
    }
    if (p.stageElapsed < stage.duration - EPSILON) return actions;
    p.stageElapsed = stage.duration; p.progression = Math.round(p.progression);
    if (p.activeElite) { p.eliteGate = true; return actions; }
    p.activeEncounter = stage.exitEncounter; p.phase = 'encounter';
    return [...actions, { type: 'encounter', id: stage.exitEncounter, stage: p.stage }];
  }
  defeatElite(id: string): CampaignAction[] {
    const p = this.state;
    if (!this.started || p.phase !== 'stage' || p.activeElite !== id || p.defeatedElites.includes(id)) return [];
    p.activeElite = null; p.defeatedElites.push(id);
    const actions: CampaignAction[] = [{ type: 'eliteCleared', id, stage: p.stage }];
    if (p.eliteGate) {
      p.eliteGate = false; p.phase = 'encounter'; p.activeEncounter = CAMPAIGN_STAGES[p.stage - 1].exitEncounter;
      actions.push({ type: 'encounter', id: p.activeEncounter, stage: p.stage });
    }
    return actions;
  }
  defeatEncounter(id: EncounterId): CampaignAction[] {
    const p = this.state;
    if (!this.started || p.phase !== 'encounter' || p.activeEncounter !== id || p.defeatedEncounters.includes(id)) return [];
    p.activeEncounter = null; p.defeatedEncounters.push(id); p.completedStages.push(p.stage);
    if (id === 's2:final') { p.phase = 'complete'; return [{ type: 'complete', season: 's2' }]; }
    const actions: CampaignAction[] = [{ type: 'encounterCleared', id, index: p.stage - 1 }, { type: 'stageCleared', stage: p.stage }];
    p.stage++; p.stageElapsed = 0; p.phase = 'stage'; p.season = p.stage >= 4 ? 's2' : 's1';
    actions.push({ type: 'stageStarted', stage: p.stage }); return actions;
  }
}
