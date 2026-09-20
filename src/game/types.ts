import type { SpellBrain } from './spellcards';
import type { Season2Brain } from './season2-ai';
import type { CampaignProgress } from './campaign';
import type { KeyBindings } from './settings';
import type { BossActionState } from './boss-actions';
import type { EliteBrain } from './elite-ai';
import type { ModuleVisual } from './module-combat';

export type Difficulty = 'normal' | 'hard';
export type SeasonId = 's1' | 's2';
export interface CarryoverSnapshot { level: number; xp: number; companions: number }
export interface RunStartOptions { difficulty: Difficulty; seed?: number }
export type ModuleId = 'piercing' | 'wingShots' | 'precision' | 'shatter' | 'chain' | 'prism' | 'droneHoming' | 'droneBurst' | 'slow' | 'division' | 'intercept' | 'orbitBlade' | 'doubleDash' | 'vent' | 'reserveAmmo' | 'graze' | 'revive' | 'magnet' | 'ricochet' | 'rearSpark' | 'crossOrbit' | 'returnWing' | 'brakeField' | 'dashEcho' | 'pulseChamber' | 'anchorStars' | 'crescentMagazine' | 'beamCircuit' | 'droneSpotlight' | 'droneNotes' | 'dronePlectrum' | 'droneConduit' | 'decoyEcho' | 'slipstream' | 'dashLane' | 'counterPulse';
export type EvolutionId = 'needleArray' | 'spiralBloom' | 'forkNetwork' | 'triangleAssault' | 'huntingReturn' | 'echoTrail' | 'sonicBreak' | 'starCarpet' | 'lunarCut' | 'choralBeam' | 'stageSpotlight' | 'staticGarden' | 'stringEcho' | 'triangleHall' | 'livingSpeaker' | 'headwindFlame' | 'echoHighway' | 'counterCurtain';
/** Positive whole numbers, with no gameplay rank ceiling. */
export type ModuleRank = number;
export type UpgradeSource = 'level' | 'boss' | 'elite' | 'resonance';
export type ResourceChoiceId = 'reward:heal' | 'reward:bomb' | 'reward:xp';
export type UpgradeChoiceId = ModuleId | `evolution:${EvolutionId}` | ResourceChoiceId;
export interface UpgradeReward { id: string; source: UpgradeSource; sequence?: number; count?: number }
export interface PlayerBuild {
  modules: ModuleId[]; ranks: Partial<Record<ModuleId, ModuleRank>>; evolutions: EvolutionId[];
  levelFloor: number; resonance: number; resonanceXp: number; choices: UpgradeChoiceId[]; choiceIndex: number;
  pendingRewards: UpgradeReward[]; rewardHistory: UpgradeReward[]; rerollsRemaining: number; offerRevision: number; offerId: string | null;
  rewardWatermarks?: Partial<Record<UpgradeSource, number>>; rewardSequence?: number;
}
export interface ArenaRect { x: number; y: number; width: number; height: number }
export type EnemyType = 'basic' | 'dasher' | 'sniper' | 'sprayer' | 'minelayer' | 'mine' | 'boss' | 'miniboss' | 'shield' | 'weaver' | 'returner' | 'sampler' | 'repairer' | 'carrier' | 'palisade' | 'reprise' | 'arm' | 'node' | 'core';
export type EnemyRole = 'mob' | 'elite' | 'miniboss' | 'boss' | 'part' | 'hazard';
export type PickupType = 'xp' | 'hp' | 'bomb' | 'supply' | 'coolant' | 'miniBomb' | 'blackHole' | 'support';
export type GamePhase = 'loading' | 'menu' | 'playing' | 'paused' | 'upgrade' | 'failed' | 'complete' | 'error';
export type Quality = 'low' | 'medium' | 'high';
export interface Vec2 { x: number; y: number }
export interface MovingBody extends Vec2 { prevX: number; prevY: number; vx: number; vy: number; radius: number }
export interface InputAction { moveX: number; moveY: number; aimX: number; aimY: number; shoot: boolean; dash: boolean; bomb: boolean; focus?: boolean; dashDirection?: Vec2 }
export type ControlMode = 'auto' | 'keyboardMouse' | 'touch';
export type ResolvedControlMode = Exclude<ControlMode, 'auto'>;
export type TouchAction = { type: 'move'; x: number; y: number } | { type: 'dash' | 'bomb' | 'focus' | 'fire' | 'clear' } | { type: 'lock'; x: number; y: number; radius: number };
export interface TouchHud { autoFireEnabled: boolean; cooling: boolean; focus: boolean; lockedTargetId: number | null }
export interface TouchAim extends Vec2 { radius: number; manual: boolean }
export interface Player extends MovingBody {
  hp: number; maxHp: number; hpReserve: number; bombs: number; level: number; xp: number; heat: number;
  commandTargetId: number | null; commandTime: number; commandCooldown: number;
  markTargetId?: number | null; markTime?: number;
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
  attackGroup?: 'wall';
  friendlyDamage?: number; friendlyHits?: number;
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
  weakpoint?: { x: number; y: number; radius: number; hp: number; maxHp: number }; shieldBrokenUntil?: number;
  id: number; type: EnemyType; hp: number; maxHp: number; speed: number; angle: number;
  state: 'chase' | 'charge' | 'dash' | 'recover' | 'aim' | 'laserWarmup' | 'laser' | 'arming' | 'lay' | 'volley' | 'phaseShift' | 'novaWarmup' | 'nova' | 'bombardWarmup' | 'bombard';
  timer: number; cooldown: number; laserCooldown: number; attackIndex: number; hitTime: number;
  lowHpSpoken: boolean; directionX: number; directionY: number;
  miniboss?: MiniBossBrain;
  tactics?: EnemyTactics;
  archetypeId?: string; role?: EnemyRole; encounterId?: string;
  spell?: SpellBrain; season2?: Season2Brain; parentId?: number; disabledUntil?: number; slowUntil?: number;
  slowAmount?: number;
  action?: BossActionState; elite?: EliteBrain; exposedUntil?: number;
  lootCarrier?: boolean; squadId?: number;
}
export interface Bullet extends MovingBody {
  friendlyDamage?: number; friendlyHits?: number;
  id: number; owner: 'player' | 'enemy'; damage: number; life: number; color: number;
  homing: boolean; speed: number; lockRange: number; targetId: number | null; remainingHits: number;
  hitIds: Set<number>; kind: 'normal' | 'perfect' | 'special' | 'burst' | 'drone' | 'module';
  shape?: EnemyBulletShape; motionAge?: number; turnRate?: number; turnDelay?: number; turnDuration?: number;
  acceleration?: number; maxSpeed?: number;
  program?: readonly ProjectileMotionPhase[]; programIndex?: number; programAge?: number; programEntered?: boolean; programSpeed?: number; programAngle?: number;
  sourceId?: number; grazed?: boolean; homingTime?: number; turnSpeed?: number; bornTick?: number;
  attackGroup?: 'wall';
  returnOriginX?: number; returnOriginY?: number; returning?: boolean; returnAt?: number; returnHitIds?: Set<number>; moduleId?: ModuleId;
  attackSource?: 'main' | 'drone' | 'secondary' | 'enemy'; visualId?: string;
}
export interface Companion extends MovingBody { id: number; angle: number; shotCooldown: number; targetId: number | null; transit?: number; orbitTargetId?: number | null; transitX?: number; transitY?: number }
export interface PlayerBeam extends Vec2 { id: number; angle: number; length: number; width: number; life: number; duration: number }
export interface PlayerArea extends Vec2 {
  id: number; kind: 'brake' | 'echo' | 'trail'; endX?: number; endY?: number; radius: number; width?: number;
  warning: number; warningDuration: number; life: number; duration: number; damage: number; slow?: number; hitIds: Set<number>;
}
export interface Pickup extends Vec2 { id: number; type: PickupType; value: number; age: number }
export interface SpawnIndicator extends Vec2 { id: number; type: EnemyType; time: number; duration: number; encounterId?: string; eliteStage?: number; eliteVariant?: 0 | 1; lootCarrier?: boolean; squadId?: number }
export interface WorldState {
  status: 'playing' | 'upgrade' | 'failed' | 'complete'; mode: 'story' | 'endless'; difficulty: Difficulty; elapsed: number; tick: number;
  score: number; kills: number; wave: number; waveTime: number; spawnTimer: number;
  bossStage: boolean; bossPending: boolean; pendingWave: number; blackHoleTime: number;
  minibossSpawned: boolean; minibossDefeated: boolean;
  player: Player; camera: { x: number; y: number; prevX: number; prevY: number };
  enemies: Enemy[]; bullets: Bullet[]; pickups: Pickup[]; indicators: SpawnIndicator[];
  companions: Companion[]; beams: PlayerBeam[]; hazards: AreaHazard[];
  playerAreas: PlayerArea[];
  moduleVisuals?: readonly ModuleVisual[];
  seasonId: SeasonId; campaign: CampaignProgress; build: PlayerBuild; arena: ArenaRect | null;
}
export type CombatEventType = 'shot' | 'enemyShot' | 'hit' | 'kill' | 'dash' | 'bomb' | 'damage' | 'pickup' | 'heal' | 'levelup' | 'leveldown' | 'wave' | 'boss' | 'bossLow' | 'complete' | 'failure' | 'spawn' | 'attack' | 'beam' | 'support' | 'upgrade' | 'card' | 'interrupt' | 'shieldBreak' | 'command' | 'module' | 'xpLoss';
export interface CombatEvent extends Vec2 {
  damageSource?: string;
  hitResult?: 'body' | 'shield' | 'weakpoint' | 'part'; moduleId?: ModuleId;
  type: CombatEventType; color?: number; amount?: number; text?: string; angle?: number;
  enemyType?: EnemyType; pickupType?: PickupType; targetId?: number;
  seasonId?: SeasonId; encounterId?: string;
}
export interface ModuleState { id: ModuleId; status: 'ready' | 'active' | 'cooldown' | 'consumed'; remaining: number }
export interface GameSettings { quality: Quality; masterVolume: number; musicVolume: number; sfxVolume: number; screenShake: number; reducedMotion: boolean; damageNumbers: 'all' | 'important' | 'off'; keybindings: KeyBindings; controlMode: ControlMode; touchFrameRate: 30 | 60 }
export type CommsMood = 'happy' | 'cheer' | 'surprised' | 'hurt' | 'cold' | 'annoyed' | 'shadow' | 'rage';
export type CommsGesture = 'none' | 'hop' | 'flinch' | 'tilt' | 'tremble';
export interface CommsMessage {
  id: number; conversationId: string | null; speaker: string; text: string; fullText: string;
  color: string; avatar: 'player' | 'enemy'; mood: CommsMood; gesture: CommsGesture;
}
export interface PerformanceStats { fps: number; renderFps: number; simulationHz: number; frameP95: number; frameP99: number; updateMs: number; renderMs: number; enemies: number; bullets: number; particles: number; pickups: number; voices: number; textures: number }
export interface HudSnapshot {
  controlMode: ResolvedControlMode; orientationBlocked: boolean; touch: TouchHud;
  phase: GamePhase; loading: number; error: string | null; mode: 'story' | 'endless'; score: number; bestScore: number;
  wave: number; waveProgress: number; elapsed: number; kills: number; hp: number; maxHp: number; hpReserve: number;
  bombs: number; level: number; xp: number; xpNeeded: number; heat: number;
  moduleStates: readonly ModuleState[];
  overheated: boolean; dashCooldown: number; perfectWindow: number; bossHp: number; bossMaxHp: number;
  bossStage: boolean; bossPhase: number; bossAction: string; focus: boolean; companions: number; comms: CommsMessage | null; commsPrevious: CommsMessage | null; announcement: string; settings: GameSettings; stats: PerformanceStats;
  difficulty: Difficulty; minibossHp: number; minibossMaxHp: number; minibossAction: string; waveBlocked: boolean;
  saveStatus: 'saved' | 'session' | 'empty'; saveMessage: string;
  stageName: string; stageCount: number; cardName: string; cardIndex: number; cardCount: number; arena: boolean;
  progression: number; historicalBestScore: number;
  modules: readonly ModuleId[]; moduleRanks: Partial<Record<ModuleId, ModuleRank>>; evolutions: readonly EvolutionId[];
  upgradeChoices: readonly UpgradeChoiceId[]; choiceSource: UpgradeSource | null; upgradeOfferId: string | null; rerollsRemaining: number;
  resonance: number; resonanceXp?: number; dashCharges: number;
  recentUpgrade?: { id: UpgradeChoiceId; sequence: number };
  eliteName?: string; eliteHp?: number; eliteMaxHp?: number;
}
export interface RuntimeControls {
  readonly leaderboard?: import('../leaderboard/client').LeaderboardClient;
  touchAction(action: TouchAction): void; requestFullscreen(): Promise<void>;
  start(options?: Partial<RunStartOptions>): void; pause(): void; resume(): void; restart(): void; continueEndless(): void; returnToMenu(): void;
  setSettings(settings: Partial<GameSettings>): void; subscribe(listener: () => void): () => void; getSnapshot(): HudSnapshot;
  setDifficulty(difficulty: Difficulty): void;
  chooseUpgrade(id: UpgradeChoiceId, offerId?: string): void; rerollUpgrades(): void;
}
