import type { SpellBrain } from './spellcards';
import type { Season2Brain } from './season2-ai';
import type { CampaignProgress } from './campaign';

export type Difficulty = 'normal' | 'hard';
export type SeasonId = 's1' | 's2';
export interface CarryoverSnapshot { level: number; xp: number; companions: number }
export interface RunStartOptions { season: SeasonId; difficulty: Difficulty; carryover?: CarryoverSnapshot; seed?: number }
export type ModuleId = 'piercing' | 'wingShots' | 'precision' | 'shatter' | 'chain' | 'prism' | 'droneHoming' | 'droneBurst' | 'slow' | 'division' | 'intercept' | 'orbitBlade' | 'doubleDash' | 'vent' | 'reserveAmmo' | 'graze' | 'revive' | 'magnet';
export interface PlayerBuild { modules: ModuleId[]; levelFloor: number; resonance: number; resonanceXp: number; choices: ModuleId[]; choiceIndex: number }
export interface ArenaRect { x: number; y: number; width: number; height: number }
export type EnemyType = 'basic' | 'dasher' | 'sniper' | 'sprayer' | 'minelayer' | 'mine' | 'boss' | 'miniboss' | 'shield' | 'weaver' | 'returner' | 'sampler' | 'repairer' | 'carrier' | 'palisade' | 'reprise' | 'arm' | 'node' | 'core';
export type EnemyRole = 'mob' | 'miniboss' | 'boss' | 'part' | 'hazard';
export type PickupType = 'xp' | 'hp' | 'bomb' | 'ammo' | 'coolant' | 'miniBomb' | 'blackHole' | 'support';
export type GamePhase = 'loading' | 'menu' | 'playing' | 'paused' | 'upgrade' | 'failed' | 'complete' | 'error';
export type Quality = 'low' | 'medium' | 'high';
export interface Vec2 { x: number; y: number }
export interface MovingBody extends Vec2 { prevX: number; prevY: number; vx: number; vy: number; radius: number }
export interface InputAction { moveX: number; moveY: number; aimX: number; aimY: number; shoot: boolean; dash: boolean; bomb: boolean; focus?: boolean }
export interface Player extends MovingBody {
  hp: number; maxHp: number; bombs: number; level: number; xp: number; ammo: number; heat: number;
  angle: number; invincible: number; dashTime: number; dashCooldown: number; dashVx: number; dashVy: number;
  perfectWindow: number; shotCooldown: number; specialCooldown: number; idleTime: number; heatLock: number; overheated: boolean; focus: boolean;
}
export interface MiniBossBrain {
  phase: 1 | 2; cycle: number; lockedAngle: number; targetX: number; targetY: number; dashesLeft: number;
  combo: 'pursuit' | 'crossfire'; lasersLeft: number; laserIndex: number; chainIndex: number; burstAngle: number;
}
export type EnemyBulletShape = 'rice' | 'orb' | 'kunai';
export interface ProjectileMotionPhase { duration: number; speed?: number; turnRate?: number; reverse?: boolean }
export interface EnemyShotOptions {
  shape?: EnemyBulletShape; turnRate?: number; turnDelay?: number; turnDuration?: number;
  acceleration?: number; maxSpeed?: number;
  program?: readonly ProjectileMotionPhase[];
}
export interface EnemyTactics { shotsLeft: number; shotTimer: number; sweepStart: number; sweepIndex: number; locked: boolean }
export interface AreaHazard extends Vec2 {
  id: number; radius: number; warning: number; warningDuration: number; life: number; duration: number;
  sourceId: number; kind: 'bombard' | 'beam'; active: boolean;
  angle?: number; width?: number; length?: number; angularSpeed?: number;
}
export interface Enemy extends MovingBody {
  id: number; type: EnemyType; hp: number; maxHp: number; speed: number; angle: number;
  state: 'chase' | 'charge' | 'dash' | 'recover' | 'aim' | 'laserWarmup' | 'laser' | 'arming' | 'lay' | 'volley' | 'phaseShift' | 'novaWarmup' | 'nova' | 'bombardWarmup' | 'bombard';
  timer: number; cooldown: number; laserCooldown: number; attackIndex: number; hitTime: number;
  lowHpSpoken: boolean; directionX: number; directionY: number;
  miniboss?: MiniBossBrain;
  tactics?: EnemyTactics;
  archetypeId?: string; role?: EnemyRole; encounterId?: string;
  spell?: SpellBrain; season2?: Season2Brain; parentId?: number; disabledUntil?: number; slowUntil?: number;
}
export interface Bullet extends MovingBody {
  id: number; owner: 'player' | 'enemy'; damage: number; life: number; color: number;
  homing: boolean; speed: number; lockRange: number; targetId: number | null; remainingHits: number;
  hitIds: Set<number>; kind: 'normal' | 'perfect' | 'special' | 'burst' | 'drone' | 'module';
  shape?: EnemyBulletShape; motionAge?: number; turnRate?: number; turnDelay?: number; turnDuration?: number;
  acceleration?: number; maxSpeed?: number;
  program?: readonly ProjectileMotionPhase[]; programIndex?: number; programAge?: number; programEntered?: boolean; programSpeed?: number; programAngle?: number;
  sourceId?: number; grazed?: boolean; homingTime?: number; turnSpeed?: number; bornTick?: number;
  attackGroup?: 'wall';
}
export interface Companion extends MovingBody { id: number; angle: number; shotCooldown: number; targetId: number | null }
export interface PlayerBeam extends Vec2 { id: number; angle: number; length: number; width: number; life: number; duration: number }
export interface Pickup extends Vec2 { id: number; type: PickupType; value: number; age: number }
export interface SpawnIndicator extends Vec2 { id: number; type: EnemyType; time: number; duration: number; encounterId?: string }
export interface WorldState {
  status: 'playing' | 'upgrade' | 'failed' | 'complete'; mode: 'story' | 'endless'; difficulty: Difficulty; elapsed: number; tick: number;
  score: number; kills: number; wave: number; waveTime: number; spawnTimer: number;
  bossStage: boolean; bossPending: boolean; pendingWave: number; blackHoleTime: number;
  minibossSpawned: boolean; minibossDefeated: boolean;
  player: Player; camera: { x: number; y: number; prevX: number; prevY: number };
  enemies: Enemy[]; bullets: Bullet[]; pickups: Pickup[]; indicators: SpawnIndicator[];
  companions: Companion[]; beams: PlayerBeam[]; hazards: AreaHazard[];
  seasonId: SeasonId; campaign: CampaignProgress; build: PlayerBuild; arena: ArenaRect | null;
}
export type CombatEventType = 'shot' | 'enemyShot' | 'hit' | 'kill' | 'dash' | 'bomb' | 'damage' | 'pickup' | 'levelup' | 'leveldown' | 'wave' | 'boss' | 'bossLow' | 'complete' | 'failure' | 'spawn' | 'attack' | 'beam' | 'support' | 'upgrade' | 'card';
export interface CombatEvent extends Vec2 {
  type: CombatEventType; color?: number; amount?: number; text?: string; angle?: number;
  enemyType?: EnemyType; pickupType?: PickupType; targetId?: number;
  seasonId?: SeasonId; encounterId?: string;
}
export interface GameSettings { quality: Quality; masterVolume: number; musicVolume: number; sfxVolume: number; screenShake: number; reducedMotion: boolean }
export interface CommsMessage { id: number; speaker: string; text: string; color: string; avatar: 'player' | 'enemy' }
export interface PerformanceStats { fps: number; frameP95: number; frameP99: number; updateMs: number; renderMs: number; enemies: number; bullets: number; particles: number; pickups: number; voices: number; textures: number }
export interface HudSnapshot {
  phase: GamePhase; loading: number; error: string | null; mode: 'story' | 'endless'; score: number; bestScore: number;
  wave: number; waveProgress: number; elapsed: number; kills: number; hp: number; maxHp: number;
  bombs: number; level: number; xp: number; xpNeeded: number; ammo: number; maxAmmo: number; heat: number;
  overheated: boolean; dashCooldown: number; perfectWindow: number; bossHp: number; bossMaxHp: number;
  bossStage: boolean; bossPhase: number; bossAction: string; focus: boolean; companions: number; comms: CommsMessage | null; announcement: string; settings: GameSettings; stats: PerformanceStats;
  difficulty: Difficulty; minibossHp: number; minibossMaxHp: number; minibossAction: string; waveBlocked: boolean;
  seasonId: SeasonId; season2Unlocked: boolean; carryover: CarryoverSnapshot | null; saveStatus: 'saved' | 'session' | 'empty'; saveMessage: string;
  stageName: string; stageCount: number; cardName: string; cardIndex: number; cardCount: number; arena: boolean;
  modules: readonly ModuleId[]; upgradeChoices: readonly ModuleId[]; resonance: number; dashCharges: number;
}
export interface RuntimeControls {
  start(options?: Partial<RunStartOptions>): void; pause(): void; resume(): void; restart(): void; continueEndless(): void; returnToMenu(): void;
  setSettings(settings: Partial<GameSettings>): void; subscribe(listener: () => void): () => void; getSnapshot(): HudSnapshot;
  setDifficulty(difficulty: Difficulty): void;
  setSeason(season: SeasonId): void; continueSeason(): void; chooseUpgrade(id: ModuleId): void;
}
