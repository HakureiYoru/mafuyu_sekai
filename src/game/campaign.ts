import { BALANCE, MINIBOSS_ENCOUNTER } from './config';
import type { EnemyType, SeasonId } from './types';

export type EncounterId = 's1:echo' | 's1:mafuyu' | 's2:palisade' | 's2:reprise' | 's2:final';
export interface CampaignStage {
  name: string;
  duration: number;
  enemyPool?: EnemyType[];
  midEncounter?: { time: number; id: EncounterId };
  exitEncounter?: EncounterId;
}
export interface SeasonDefinition { id: SeasonId; name: string; stages: CampaignStage[]; finalEncounter: EncounterId }
export const SEASONS: Record<SeasonId, SeasonDefinition> = {
  s1: { id: 's1', name: '第一季 · 失落的共鸣', finalEncounter: 's1:mafuyu', stages: Array.from({ length: 5 }, (_, index) => ({
    name: ['光源接入', '信号深入', '游猎回声', '共鸣追溯', '核心边界'][index],
    duration: BALANCE.spawn.waveDuration,
    ...(index + 1 === MINIBOSS_ENCOUNTER.wave ? { midEncounter: { time: MINIBOSS_ENCOUNTER.time, id: 's1:echo' as const } } : {}),
  })) },
  s2: { id: 's2', name: '第二季 · 镜界复奏', finalEncounter: 's2:final', stages: [
    { name: '镜界入口', duration: 75, enemyPool: ['shield', 'returner'] },
    { name: '幕门街区', duration: 75, enemyPool: ['shield', 'returner', 'weaver'], exitEncounter: 's2:palisade' },
    { name: '中继回廊', duration: 75, enemyPool: ['returner', 'sampler', 'repairer'] },
    { name: '复奏断层', duration: 75, enemyPool: ['shield', 'sampler', 'repairer', 'carrier'], exitEncounter: 's2:reprise' },
    { name: '裂核庭院', duration: 75, enemyPool: ['weaver', 'returner', 'repairer', 'carrier'] },
    { name: '终章前线', duration: 75, enemyPool: ['shield', 'weaver', 'returner', 'sampler', 'repairer', 'carrier'] },
  ] },
};

export interface CampaignProgress {
  season: SeasonId;
  stage: number;
  stageElapsed: number;
  phase: 'stage' | 'encounter' | 'choice' | 'complete';
  activeEncounter: EncounterId | null;
  completedStages: number[];
  defeatedEncounters: EncounterId[];
  /** Number of choices already committed; the initial season-two offer has index zero. */
  choiceIndex: number;
}
export type CampaignAction =
  | { type: 'stageStarted'; stage: number }
  | { type: 'stageCleared'; stage: number }
  | { type: 'encounter'; id: EncounterId; stage: number }
  | { type: 'choice'; index: number; stage: number }
  | { type: 'complete'; season: SeasonId };

const EPSILON = 1e-8;

/** Owns campaign objectives only. The simulation owns enemy lifetimes, rewards and all combat clocks. */
export class CampaignDirector {
  readonly state: CampaignProgress;
  private started = false;

  constructor(season: SeasonId) {
    this.state = { season, stage: 1, stageElapsed: 0, phase: season === 's2' ? 'choice' : 'stage',
      activeEncounter: null, completedStages: [], defeatedEncounters: [], choiceIndex: 0 };
  }

  start(): CampaignAction[] {
    if (this.started) return [];
    this.started = true;
    return this.state.phase === 'choice'
      ? [{ type: 'choice', index: 0, stage: 1 }]
      : [{ type: 'stageStarted', stage: 1 }];
  }

  step(dt: number): CampaignAction[] {
    if (!this.started || !Number.isFinite(dt) || dt <= 0 || this.state.phase !== 'stage') return [];
    const progress = this.state, stage = SEASONS[progress.season].stages[progress.stage - 1], actions: CampaignAction[] = [];
    progress.stageElapsed = Math.min(stage.duration, progress.stageElapsed + dt);
    const mid = stage.midEncounter;
    if (mid && progress.stageElapsed >= mid.time - EPSILON && !progress.activeEncounter && !progress.defeatedEncounters.includes(mid.id)) {
      progress.activeEncounter = mid.id;
      actions.push({ type: 'encounter', id: mid.id, stage: progress.stage });
    }
    if (progress.stageElapsed < stage.duration - EPSILON) return actions;
    progress.stageElapsed = stage.duration;
    if (progress.activeEncounter) { progress.phase = 'encounter'; return actions; }
    if (stage.exitEncounter && !progress.defeatedEncounters.includes(stage.exitEncounter)) {
      progress.phase = 'encounter'; progress.activeEncounter = stage.exitEncounter;
      actions.push({ type: 'encounter', id: stage.exitEncounter, stage: progress.stage });
    } else actions.push(...this.clearStage());
    return actions;
  }

  defeatEncounter(id: EncounterId): CampaignAction[] {
    const progress = this.state;
    if (!this.started || progress.phase === 'complete' || progress.activeEncounter !== id || progress.defeatedEncounters.includes(id)) return [];
    progress.activeEncounter = null; progress.defeatedEncounters.push(id);
    if (id === SEASONS[progress.season].finalEncounter) {
      progress.phase = 'complete';
      return [{ type: 'complete', season: progress.season }];
    }
    const stage = SEASONS[progress.season].stages[progress.stage - 1];
    if (progress.stageElapsed >= stage.duration - EPSILON) return this.clearStage();
    progress.phase = 'stage';
    return [];
  }

  resolveChoice(): CampaignAction[] {
    const progress = this.state;
    if (!this.started || progress.phase !== 'choice') return [];
    progress.choiceIndex++;
    // Entry choice starts stage one; subsequent choices follow an already-cleared stage.
    if (!progress.completedStages.includes(progress.stage)) {
      progress.phase = 'stage';
      return [{ type: 'stageStarted', stage: progress.stage }];
    }
    return this.advance();
  }

  private clearStage(): CampaignAction[] {
    const progress = this.state;
    if (progress.completedStages.includes(progress.stage)) return [];
    progress.completedStages.push(progress.stage);
    const actions: CampaignAction[] = [{ type: 'stageCleared', stage: progress.stage }];
    if (progress.season === 's2') {
      progress.phase = 'choice';
      actions.push({ type: 'choice', index: progress.choiceIndex, stage: progress.stage });
    } else actions.push(...this.advance());
    return actions;
  }

  private advance(): CampaignAction[] {
    const progress = this.state, definition = SEASONS[progress.season];
    if (progress.stage === definition.stages.length) {
      progress.phase = 'encounter'; progress.activeEncounter = definition.finalEncounter;
      return [{ type: 'encounter', id: definition.finalEncounter, stage: progress.stage }];
    }
    progress.stage++; progress.stageElapsed = 0; progress.phase = 'stage';
    return [{ type: 'stageStarted', stage: progress.stage }];
  }
}
