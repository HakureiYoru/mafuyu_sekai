import { WORLD } from './config';
import { beginBossAction, bossActionTarget, updateBossAction, type AttackBudgetContext } from './boss-actions';
import { clamp, normalize, TAU } from './math';
import { createSeason2Brain, returningProgram } from './season2-ai';
import type { AreaHazard, ArenaRect, CombatEvent, Difficulty, Enemy, EnemyShotOptions, EnemyType, Player, Vec2 } from './types';

type ElitePattern = 'leaper' | 'chaser' | 'gate' | 'beam' | 'messenger' | 'sampler' | 'hunter' | 'thrower' | 'executor' | 'ring';
export interface EliteDefinition { id: ElitePattern; name: string; type: EnemyType; hp: number; radius: number; stage: number }
export const ELITE_GROUPS: readonly (readonly [EliteDefinition, EliteDefinition])[] = [
  [{ id: 'leaper', name: '跃袭标兵', type: 'dasher', hp: 360, radius: 46, stage: 1 }, { id: 'chaser', name: '追声快手', type: 'basic', hp: 360, radius: 46, stage: 1 }],
  [{ id: 'gate', name: '噤声门卫', type: 'shield', hp: 450, radius: 52, stage: 2 }, { id: 'beam', name: '横梁巡查', type: 'sniper', hp: 450, radius: 48, stage: 2 }],
  [{ id: 'messenger', name: '折光信使', type: 'returner', hp: 700, radius: 48, stage: 3 }, { id: 'sampler', name: '旧影记录员', type: 'sampler', hp: 700, radius: 48, stage: 3 }],
  [{ id: 'hunter', name: '回声猎手', type: 'dasher', hp: 900, radius: 50, stage: 4 }, { id: 'thrower', name: '停拍投手', type: 'returner', hp: 800, radius: 50, stage: 4 }],
  [{ id: 'executor', name: '裂核执刑者', type: 'carrier', hp: 1100, radius: 54, stage: 5 }, { id: 'ring', name: '环阵监察', type: 'weaver', hp: 1000, radius: 54, stage: 5 }],
];
export interface EliteTelegraph {
  kind: 'fan' | 'beam' | 'wall' | 'ring' | 'sample'; x: number; y: number; angle: number; spread: number;
  length: number; width: number; radius: number; warning: number; remaining: number; points?: Vec2[];
}
interface EliteShot extends Vec2 { angle: number; speed: number; options?: EnemyShotOptions }
interface EliteRelease { at: number; sourceId: number; shots: EliteShot[]; cue: EliteTelegraph }
export interface EliteBrain {
  stage: number; variant: 0 | 1; cycle: number; nextAttack: number; initialized: boolean; partIds: number[];
  returnPoint: Vec2 | null; pending: EliteRelease[]; samples: Vec2[]; nextSample: number; samplesLeft: number; exposeAt: number; extraDash: number;
}
export interface EliteAiContext extends AttackBudgetContext {
  player: Player; difficulty: Difficulty; elapsed: number; enemies: readonly Enemy[]; arena?: ArenaRect | null;
  canCommit(): boolean;
  shootAt(source: Enemy, x: number, y: number, angle: number, speed: number, radius: number, color: number, options?: EnemyShotOptions): void;
  spawnHazard(hazard: Omit<AreaHazard, 'id'>): void;
  spawnPart(parent: Enemy, type: 'arm' | 'node' | 'core', x: number, y: number): Enemy | null;
  retirePart(part: Enemy): void; emit(event: CombatEvent): void;
}
export function createEliteBrain(stage: number, variant: 0 | 1): EliteBrain {
  return { stage: clamp(Math.floor(stage), 1, 5), variant, cycle: 0, nextAttack: 0, initialized: false,
    partIds: [], returnPoint: null, pending: [], samples: [], nextSample: 0, samplesLeft: 0, exposeAt: Infinity, extraDash: 0 };
}
export function eliteDefinition(enemy: Enemy): EliteDefinition {
  const brain = enemy.elite;
  return ELITE_GROUPS[(brain?.stage ?? 1) - 1][brain?.variant ?? 0];
}
export function eliteTelegraphs(enemy: Enemy): readonly EliteTelegraph[] {
  return enemy.hp > 0 ? enemy.elite?.pending.map(item => item.cue) ?? [] : [];
}
function cue(e: Enemy, ctx: EliteAiContext, text: string): void {
  ctx.emit({ type: 'attack', text, x: e.x, y: e.y, enemyType: e.type, targetId: e.id, encounterId: e.encounterId });
}
function fanShots(x: number, y: number, angle: number, count: number, spread: number, speed: number, options?: EnemyShotOptions): EliteShot[] {
  return Array.from({ length: count }, (_, i) => ({ x, y, angle: angle + (count === 1 ? 0 : i / (count - 1) - 0.5) * spread, speed, options }));
}
function emission(e: Enemy, ctx: EliteAiContext, shots: EliteShot[], kind: EliteTelegraph['kind'], angle: number, spread: number, warning: number,
  extra: Partial<EliteTelegraph> = {}, sourceId = e.id): EliteRelease {
  return { at: ctx.elapsed + warning, sourceId, shots, cue: { kind, x: e.x, y: e.y, angle, spread, warning,
    remaining: warning, length: 1100, width: 14, radius: kind === 'ring' ? 240 : 7, ...extra } };
}
function reserve(e: Enemy, ctx: EliteAiContext, shots: number, hazards: number, duration: number): boolean {
  return !ctx.reserveAttack || ctx.reserveAttack(e.id, shots, hazards, duration);
}
function movementRecovery(difficulty: Difficulty): number { return difficulty === 'hard' ? 1.2 : 1.4; }
function dash(e: Enemy, ctx: EliteAiContext, side = 0, retrace = false): boolean {
  const brain = e.elite!, hard = ctx.difficulty === 'hard';
  const target = retrace && brain.returnPoint ? brain.returnPoint : bossActionTarget(e, ctx.player, e.radius >= 52 ? 230 : brain.stage === 1 ? 270 : 330, side);
  const previous = { x: e.x, y: e.y };
  const warning = hard ? 0.5 : 0.65, duration = side ? 0.5 : brain.stage === 1 ? 0.45 : 0.46;
  const recovery = movementRecovery(ctx.difficulty);
  const accepted = beginBossAction(e, { kind: retrace ? 'retrace' : side ? 'sidestep' : 'dash', ...target,
    warning, duration, recovery }, ctx);
  if (accepted) { if (!retrace) brain.returnPoint = previous; brain.nextAttack = ctx.elapsed + warning + duration + recovery; }
  return accepted;
}

/** Ten deliberately small two-action templates. No attack reads future input or changes a committed route. */
export function updateEliteAi(e: Enemy, dt: number, ctx: EliteAiContext): void {
  if (e.hp <= 0 || ctx.player.hp <= 0 || !Number.isFinite(dt) || dt <= 0) return;
  const brain = e.elite;
  if (!brain) return;
  const definition = eliteDefinition(e), hard = ctx.difficulty === 'hard', warning = hard ? 0.55 : 0.75;
  if (!brain.initialized) {
    brain.initialized = true; brain.nextAttack = ctx.elapsed + 0.6;
    if (definition.id === 'gate') {
      const arm = ctx.spawnPart(e, 'arm', e.x, e.y - 90);
      if (arm) { arm.hp = arm.maxHp = Math.round(70 * (hard ? 1.35 : 1)); arm.season2 = createSeason2Brain('arm'); arm.season2.heading = -1; brain.partIds.push(arm.id); }
    }
  }
  if (brain.samplesLeft > 0 && ctx.elapsed >= brain.nextSample - 1e-8) {
    const point = { x: ctx.player.x, y: ctx.player.y }, delay = hard ? 0.7 : 0.9;
    brain.samples.push(point); brain.samplesLeft--; brain.nextSample += 0.35;
    ctx.spawnHazard({ ...point, kind: 'bombard', sourceId: e.id, radius: 50, warning: delay, warningDuration: delay,
      duration: 0.25, life: 0.25, active: false });
  }
  let keep = 0;
  for (const release of brain.pending) {
    const source = release.sourceId === e.id ? e : ctx.enemies.find(other => other.id === release.sourceId && other.hp > 0);
    if (!source) continue;
    release.cue.remaining = Math.max(0, release.at - ctx.elapsed);
    if (release.at <= ctx.elapsed + 1e-8) {
      for (const shot of release.shots) ctx.shootAt(source, shot.x, shot.y, shot.angle, shot.speed, 7, 0xffab76, shot.options);
      cue(e, ctx, 'release');
    } else brain.pending[keep++] = release;
  }
  brain.pending.length = keep;
  if (ctx.elapsed >= brain.exposeAt - 1e-8) {
    e.exposedUntil = brain.nextAttack; brain.exposeAt = Infinity; cue(e, ctx, 'core-exposed');
  }
  if (updateBossAction(e, dt, ctx)) return;
  if (brain.pending.length || brain.samplesLeft > 0) { e.state = 'volley'; e.vx = e.vy = 0; return; }
  if (ctx.elapsed < brain.nextAttack - 1e-8) { e.state = 'recover'; e.vx = e.vy = 0; return; }
  const distance = Math.hypot(ctx.player.x - e.x, ctx.player.y - e.y);
  if (distance > 700 || distance < 160) {
    const direction = normalize(ctx.player.x - e.x, ctx.player.y - e.y), sign = distance < 160 ? -1 : 1;
    e.vx = direction.x * (hard ? 360 : 310) * sign; e.vy = direction.y * (hard ? 360 : 310) * sign; e.state = 'chase'; return;
  }
  if (!ctx.canCommit()) { e.state = 'chase'; e.vx = e.vy = 0; return; }
  // A full volley separates lunges; large bodies reposition sideways only after two ranged attacks.
  brain.extraDash = 0;
  const second = brain.cycle % 2 === 1;
  const angle = Math.atan2(ctx.player.y - e.y, ctx.player.x - e.x), releases: EliteRelease[] = [];
  e.angle = angle; e.vx = e.vy = 0;
  const large = ['gate', 'executor', 'ring'].includes(definition.id);
  const move = large ? brain.cycle % 3 === 2 : ['leaper', 'chaser', 'hunter'].includes(definition.id) ? !second
    : ['sampler', 'beam', 'thrower'].includes(definition.id) && second;
  if (move) {
    const side = large ? (brain.cycle % 2 ? -1 : 1) * Math.PI / 2
      : ['chaser', 'beam', 'thrower'].includes(definition.id) ? (brain.cycle % 2 ? -1 : 1) * 0.85 : 0;
    const landingFan = ['beam', 'thrower', 'ring'].includes(definition.id);
    if (landingFan && !reserve(e, ctx, 6, 0, (hard ? 0.5 : 0.65) + 0.5 + movementRecovery(ctx.difficulty) + 0.15)) return;
    if (dash(e, ctx, side, definition.id === 'hunter' && brain.cycle % 4 === 2)) {
      if (landingFan && e.action) {
        const a = e.action, bearing = Math.atan2(ctx.player.y - a.targetY, ctx.player.x - a.targetX);
        brain.pending.push(emission(e, ctx, fanShots(a.targetX, a.targetY, bearing, 6, 1.3, 250), 'fan', bearing, 1.3,
          a.warning + a.duration + a.recovery + 0.05, { x: a.targetX, y: a.targetY }));
        brain.nextAttack = brain.pending[brain.pending.length - 1].at + (hard ? 0.6 : 0.8);
      }
      brain.cycle++; cue(e, ctx, 'elite-move');
    }
    return;
  }
  if (definition.id === 'beam') {
    if (!reserve(e, ctx, 0, 1, hard ? 0.71 : 0.96)) return;
    const delay = hard ? 0.7 : 0.95;
    ctx.spawnHazard({ kind: 'beam', x: e.x, y: e.y, angle, width: 40, length: 1400, radius: 20,
      warning: delay, warningDuration: delay, duration: 0.3, life: 0.3, sourceId: e.id, active: false, angularSpeed: 0 });
    brain.nextAttack = ctx.elapsed + delay + 0.9; brain.exposeAt = ctx.elapsed + delay + 0.3; brain.cycle++; cue(e, ctx, 'elite-beam'); return;
  }
  if (definition.id === 'sampler') {
    if (!reserve(e, ctx, 0, 2, 0.5)) return;
    brain.samples = []; brain.samplesLeft = 2; brain.nextSample = ctx.elapsed;
    brain.nextAttack = ctx.elapsed + 2; brain.exposeAt = ctx.elapsed + 1.4; brain.cycle++; cue(e, ctx, 'elite-sample'); return;
  }
  if (definition.id === 'executor') {
    if (!reserve(e, ctx, 12, 0, 1.2)) return;
    for (const side of [-1, 1]) {
      const x = clamp(e.x - Math.sin(angle) * side * 110, 20, WORLD.width - 20), y = clamp(e.y + Math.cos(angle) * side * 110, 20, WORLD.height - 20);
      const core = ctx.spawnPart(e, 'core', x, y);
      if (core) { core.hp = core.maxHp = Math.round(45 * (hard ? 1.35 : 1)); core.timer = hard ? 0.7 : 0.95;
        core.season2 = createSeason2Brain('core'); core.season2.heading = angle; }
    }
    brain.cycle++; brain.nextAttack = ctx.elapsed + 1.7; brain.exposeAt = ctx.elapsed + 1; cue(e, ctx, 'elite-cores'); return;
  }
  if (definition.id === 'gate') {
    const arm = ctx.enemies.find(other => brain.partIds.includes(other.id) && other.hp > 0);
    if (arm) {
      for (let batch = 0; batch < 2; batch++) {
        const shots: EliteShot[] = [];
        for (const offset of [-240, -210, -180, -150, -120, 0, 30, 60, 90, 120]) shots.push({
          x: e.x - Math.sin(angle) * offset, y: e.y + Math.cos(angle) * offset, angle, speed: 230, options: { shape: 'rice', attackGroup: 'wall' } });
        releases.push(emission(e, ctx, shots, 'wall', angle, 0, warning + batch * 0.45,
          { width: 480, points: shots.map(shot => ({ x: shot.x, y: shot.y })) }, arm.id));
      }
    } else releases.push(emission(e, ctx, fanShots(e.x, e.y, angle, 5, 1.2, 260), 'fan', angle, 1.2, warning));
  } else if (definition.id === 'messenger' || definition.id === 'thrower') {
    if (second) {
      for (let batch = 0; batch < 3; batch++) releases.push(emission(e, ctx,
        fanShots(e.x, e.y, angle + (batch - 1) * 0.18, 3, 0.35, 300, { shape: 'rice' }), 'fan', angle + (batch - 1) * 0.18, 0.35, warning + batch * 0.3));
    } else for (let batch = 0; batch < (definition.id === 'thrower' ? 2 : 1); batch++) {
      const heading = angle + batch * 0.2;
      releases.push(emission(e, ctx, fanShots(e.x, e.y, heading, definition.id === 'thrower' ? 10 : 9, 1.6, 250,
        { shape: 'kunai', program: returningProgram(250, 1.2, hard ? 0.55 : 0.65) }), 'fan', heading, 1.6, warning + batch * 0.4));
    }
  } else if (definition.id === 'ring') {
    const inward = Math.floor(brain.cycle / 2) % 2 === 1, radius = inward ? 320 : e.radius + 12;
    const shots = Array.from({ length: 16 }, (_, i) => {
      const bearing = i * TAU / 16 + brain.cycle * 0.13;
      return { x: e.x + Math.cos(bearing) * radius, y: e.y + Math.sin(bearing) * radius, angle: bearing + (inward ? Math.PI : 0), speed: 230, options: { shape: 'orb' as const } };
    }).filter(shot => shot.x > 8 && shot.y > 8 && shot.x < WORLD.width - 8 && shot.y < WORLD.height - 8);
    releases.push(emission(e, ctx, shots, 'ring', angle, TAU, inward ? (hard ? 0.8 : 1) : warning, { radius, points: shots.map(shot => ({ x: shot.x, y: shot.y })) }));
  } else {
    for (let batch = 0; batch < (definition.id === 'chaser' ? 2 : 1); batch++) {
      const heading = angle + batch * 0.24;
      releases.push(emission(e, ctx, fanShots(e.x, e.y, heading, definition.id === 'chaser' ? 3 : 5, 1.1, 250), 'fan', heading, 1.1, warning + batch * 0.3));
    }
  }
  let duration = Math.max(...releases.map(item => item.at - ctx.elapsed), warning);
  const movingVolley = definition.id === 'messenger' && !second;
  if (movingVolley) duration = (hard ? 0.5 : 0.65) + 0.55 + movementRecovery(ctx.difficulty) + 0.05;
  if (!reserve(e, ctx, releases.reduce((count, item) => count + item.shots.length, 0), 0, duration + 0.1)) return;
  if (movingVolley && beginBossAction(e, { kind: 'sidestep', ...bossActionTarget(e, ctx.player, 240, brain.cycle % 2 ? -0.9 : 0.9),
    warning: hard ? 0.5 : 0.65, duration: 0.55, recovery: movementRecovery(ctx.difficulty) }, ctx)) {
    for (const release of releases) {
      release.at = ctx.elapsed + duration; release.cue.x = e.action!.targetX; release.cue.y = e.action!.targetY;
      release.cue.warning = release.cue.remaining = duration;
      for (const shot of release.shots) { shot.x = e.action!.targetX; shot.y = e.action!.targetY; }
    }
  }
  brain.pending.push(...releases); brain.cycle++; brain.nextAttack = ctx.elapsed + duration + (hard ? 0.6 : 0.8);
  brain.exposeAt = ctx.elapsed + duration; e.state = 'charge'; e.timer = warning; cue(e, ctx, 'elite-windup');
}
