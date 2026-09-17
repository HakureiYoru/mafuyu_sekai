import { BALANCE, VIEW, WORLD } from './config';
import { angleDelta, beamGeometry, clamp, normalize, pointInBeam, TAU } from './math';
import type { CombatEvent, Difficulty, Enemy, EnemyShotOptions, MiniBossBrain, Player } from './types';
import { beginBossAction, bossActionTarget, updateBossAction, type AttackBudgetContext } from './boss-actions';

const EPSILON = 1e-8;

/** Shared by simulation and telegraphs; all durations are seconds, distances world pixels. */
export const MINIBOSS_ATTACKS = {
  phaseThreshold: 0.45, phaseShift: 0.7,
  positioning: { minRange: 155, maxRange: 850, viewPadding: 80, edgeMargin: 88, preferredRange: 330, speed: 240 },
  dash: { warning: 0.6, phase2Warning: 0.5, speed: 920, duration: 0.46, clearance: 64,
    counts: [2, 3], prediction: 0.18, maxLead: 90 },
  settle: 0.28,
  landing: { fanCount: 5, fanSpread: 1.25, fanSpeed: 255, ringCount: 16, ringSpeed: 225, gap: 1.1, radius: 8, range: 750,
    turnRate: 0.18, turnDelay: 0.3, turnDuration: 0.45 },
  laser: { warning: 0.7, phase2Warning: 0.65, duration: 0.34, width: 60, length: 1600, counts: [1, 2], gap: 0.16, crossAngle: 0.08 },
  recovery: 0.85, phase2Recovery: 0.65,
} as const;

const HARD_ATTACKS = {
  ...MINIBOSS_ATTACKS,
  positioning: { ...MINIBOSS_ATTACKS.positioning, speed: 300 },
  dash: { ...MINIBOSS_ATTACKS.dash, warning: 0.45, phase2Warning: 0.4, speed: 1080, duration: 0.44,
    counts: [3, 4], prediction: 0.25, maxLead: 120 },
  settle: 0.22,
  landing: { ...MINIBOSS_ATTACKS.landing, fanCount: 7, fanSpread: 1.45, fanSpeed: 280, ringCount: 20, ringSpeed: 245, gap: 1 },
  laser: { ...MINIBOSS_ATTACKS.laser, warning: 0.55, phase2Warning: 0.5, duration: 0.38, width: 72, length: 1800, counts: [2, 3], gap: 0.12 },
  recovery: 0.65, phase2Recovery: 0.5,
} as const;

export function miniBossAttacks(difficulty: Difficulty = 'normal') {
  return difficulty === 'hard' ? HARD_ATTACKS : MINIBOSS_ATTACKS;
}

export interface MiniBossAiContext extends AttackBudgetContext {
  player: Player;
  elapsed: number;
  difficulty?: Difficulty;
  canCommit(): boolean;
  emit(event: CombatEvent): void;
  shoot(enemy: Enemy, angle: number, speed: number, radius: number, color: number, options?: EnemyShotOptions): void;
  damagePlayer(): void;
}

export function createMiniBossBrain(): MiniBossBrain {
  return { phase: 1, cycle: 0, lockedAngle: 0, targetX: 0, targetY: 0, dashesLeft: 0,
    combo: 'pursuit', lasersLeft: 0, laserIndex: 0, chainIndex: 0, burstAngle: 0 };
}

export function miniBossDashGeometry(e: Enemy, _difficulty?: Difficulty) {
  const brain = e.miniboss;
  return beamGeometry(e.x, e.y, e.angle, brain ? Math.hypot(brain.targetX - e.x, brain.targetY - e.y) : 0, e.radius * 2);
}

export function miniBossLaserGeometry(e: Enemy, difficulty: Difficulty = 'normal') {
  const cfg = miniBossAttacks(difficulty).laser;
  return beamGeometry(e.x, e.y, e.angle, cfg.length, cfg.width);
}

export interface MiniBossLandingTelegraph {
  x: number; y: number; angle: number; pattern: 'fan' | 'ring'; spread: number; gap: number; range: number;
}

/** The landing burst's origin and bearing are visible from the beginning of that dash warning. */
export function miniBossLandingTelegraph(e: Enemy, difficulty: Difficulty = 'normal'): MiniBossLandingTelegraph {
  const brain = e.miniboss, cfg = miniBossAttacks(difficulty).landing;
  return { x: brain?.targetX ?? e.x, y: brain?.targetY ?? e.y, angle: brain?.burstAngle ?? e.angle,
    pattern: brain?.combo === 'crossfire' && brain.chainIndex % 2 === 0 ? 'ring' : 'fan',
    spread: cfg.fanSpread + 2 * cfg.turnRate * cfg.turnDuration, gap: cfg.gap, range: cfg.range };
}

function stop(e: Enemy): void { e.vx = e.vy = 0; }

function cue(e: Enemy, ctx: MiniBossAiContext, text: string): void {
  ctx.emit({ type: 'attack', enemyType: 'miniboss', targetId: e.id, x: e.x, y: e.y, angle: e.angle, text });
}

function visible(e: Enemy, ctx: MiniBossAiContext): boolean {
  const cameraX = clamp(ctx.player.x, VIEW.width / 2, WORLD.width - VIEW.width / 2);
  const cameraY = clamp(ctx.player.y, VIEW.height / 2, WORLD.height - VIEW.height / 2);
  const padding = miniBossAttacks(ctx.difficulty).positioning.viewPadding;
  return Math.abs(e.x - cameraX) <= VIEW.width / 2 - padding
    && Math.abs(e.y - cameraY) <= VIEW.height / 2 - padding;
}

function reposition(e: Enemy, dt: number, ctx: MiniBossAiContext): void {
  const cfg = miniBossAttacks(ctx.difficulty).positioning;
  const margin = Math.max(cfg.edgeMargin, e.radius + 24);
  // Approach on the current side of the player, instead of retreating to a distant fixed flank.
  const away = normalize(e.x - ctx.player.x, e.y - ctx.player.y);
  const inward = normalize(WORLD.width / 2 - ctx.player.x, WORLD.height / 2 - ctx.player.y);
  const x = clamp(ctx.player.x + (away.x || away.y ? away.x : inward.x) * cfg.preferredRange, margin, WORLD.width - margin);
  const y = clamp(ctx.player.y + (away.x || away.y ? away.y : inward.y) * cfg.preferredRange, margin, WORLD.height - margin);
  const distance = Math.hypot(x - e.x, y - e.y), direction = normalize(x - e.x, y - e.y);
  // This is a dedicated boss positioning speed, like MAFUYU's, independent of ordinary-enemy multipliers.
  const speed = Math.min(cfg.speed, distance / dt);
  e.vx = direction.x * speed; e.vy = direction.y * speed;
  e.angle = Math.atan2(ctx.player.y - e.y, ctx.player.x - e.x);
}

function rayTravel(e: Enemy, angle: number, desired: number, margin: number): number {
  const x = Math.cos(angle), y = Math.sin(angle);
  let travel = desired;
  if (x > EPSILON) travel = Math.min(travel, (WORLD.width - margin - e.x) / x);
  else if (x < -EPSILON) travel = Math.min(travel, (margin - e.x) / x);
  if (y > EPSILON) travel = Math.min(travel, (WORLD.height - margin - e.y) / y);
  else if (y < -EPSILON) travel = Math.min(travel, (margin - e.y) / y);
  return Math.max(0, travel);
}

/** Commit through a sampled interception point when space permits; never steer during the warning or dash. */
function beginCharge(e: Enemy, brain: MiniBossBrain, ctx: MiniBossAiContext): boolean {
  const cfg = miniBossAttacks(ctx.difficulty), player = ctx.player;
  const lead = Math.min(cfg.dash.prediction, cfg.dash.maxLead / Math.max(1, Math.hypot(player.vx, player.vy)));
  const targetX = clamp(player.x + player.vx * lead, player.radius, WORLD.width - player.radius);
  const targetY = clamp(player.y + player.vy * lead, player.radius, WORLD.height - player.radius);
  const angle = Math.atan2(targetY - e.y, targetX - e.x);
  const distance = Math.hypot(targetX - e.x, targetY - e.y);
  const side = (e.id + brain.cycle + brain.chainIndex) % 2 === 0 ? 1 : -1;
  const margin = Math.max(cfg.positioning.edgeMargin, e.radius + 24);
  const maxTravel = cfg.dash.speed * cfg.dash.duration;
  const clearance = e.radius + player.radius + cfg.dash.clearance;
  // Try an aggressive straight route first. Near a wall, shorten it or use a readable oblique route.
  for (const offset of [0, side * 0.65, -side * 0.65, side * 1.2, -side * 1.2]) {
    const heading = angle + offset;
    let travel = rayTravel(e, heading, maxTravel, margin);
    let x = e.x + Math.cos(heading) * travel, y = e.y + Math.sin(heading) * travel;
    if (offset === 0 && (Math.hypot(x - targetX, y - targetY) < clearance || Math.hypot(x - player.x, y - player.y) < clearance)) {
      travel = rayTravel(e, heading, Math.max(0, distance - clearance - cfg.dash.maxLead * 0.2), margin);
      x = e.x + Math.cos(heading) * travel; y = e.y + Math.sin(heading) * travel;
    }
    if (travel < 45 || Math.hypot(x - player.x, y - player.y) < clearance || Math.hypot(x - targetX, y - targetY) < clearance) continue;
    brain.targetX = x; brain.targetY = y;
    brain.burstAngle = Math.atan2(targetY - y, targetX - x); brain.chainIndex++;
    brain.lockedAngle = Math.atan2(y - e.y, x - e.x);
    e.angle = brain.lockedAngle; e.directionX = Math.cos(e.angle); e.directionY = Math.sin(e.angle);
    e.state = 'charge'; e.timer = brain.phase === 2 ? cfg.dash.phase2Warning : cfg.dash.warning;
    stop(e); cue(e, ctx, 'windup');
    return true;
  }
  return false;
}

function recover(e: Enemy, brain: MiniBossBrain, ctx: MiniBossAiContext): void {
  const cfg = miniBossAttacks(ctx.difficulty);
  e.state = 'recover'; e.timer = brain.phase === 2 ? cfg.phase2Recovery : cfg.recovery;
  brain.dashesLeft = brain.lasersLeft = 0; stop(e);
  e.exposedUntil = ctx.elapsed + e.timer;
}

function fireLanding(e: Enemy, ctx: MiniBossAiContext): void {
  const cfg = miniBossAttacks(ctx.difficulty).landing, preview = miniBossLandingTelegraph(e, ctx.difficulty);
  // No fresh aim is sampled on release: every ray belongs to the landing preview that preceded the dash.
  if (preview.pattern === 'ring') {
    for (let i = 0; i < cfg.ringCount; i++) {
      const angle = preview.angle + i * TAU / cfg.ringCount;
      if (Math.abs(angleDelta(preview.angle, angle)) <= cfg.gap / 2) continue;
      ctx.shoot(e, angle, cfg.ringSpeed, cfg.radius, 0xffb45f, { shape: 'orb' });
    }
  } else {
    for (let i = 0; i < cfg.fanCount; i++) {
      const fraction = i / (cfg.fanCount - 1) - 0.5;
      ctx.shoot(e, preview.angle + fraction * cfg.fanSpread, cfg.fanSpeed, cfg.radius, 0xff956b,
        { shape: 'rice', turnRate: Math.sign(fraction) * cfg.turnRate, turnDelay: cfg.turnDelay, turnDuration: cfg.turnDuration });
    }
  }
  cue(e, ctx, 'burst');
}

function beginLaser(e: Enemy, brain: MiniBossBrain, ctx: MiniBossAiContext): void {
  const cfg = miniBossAttacks(ctx.difficulty).laser;
  const offset = brain.combo === 'crossfire' && brain.laserIndex > 0 ? (brain.laserIndex % 2 ? 1 : -1) * cfg.crossAngle : 0;
  brain.lockedAngle = Math.atan2(ctx.player.y - e.y, ctx.player.x - e.x) + offset;
  brain.laserIndex++; e.angle = brain.lockedAngle; e.state = 'laserWarmup';
  e.timer = brain.phase === 2 ? cfg.phase2Warning : cfg.warning;
  cue(e, ctx, 'laser');
}

/** Single simulation update; the caller exclusively integrates positions and decrements cooldown. */
export function updateMiniBossAi(e: Enemy, dt: number, ctx: MiniBossAiContext): void {
  if (e.hp <= 0 || ctx.player.hp <= 0 || !Number.isFinite(dt) || dt <= 0) return;
  const cfg = miniBossAttacks(ctx.difficulty), brain = e.miniboss ??= createMiniBossBrain();
  if (e.action) {
    updateBossAction(e, dt, ctx);
    if (!e.action) { brain.dashesLeft = 0; brain.lasersLeft = cfg.laser.counts[brain.phase - 1]; brain.laserIndex = 0; beginLaser(e, brain, ctx); }
    return;
  }
  // Finish committed warnings/attacks before changing phase; low health never produces an unannounced replacement.
  if (brain.phase === 1 && e.hp / Math.max(1, e.maxHp) <= cfg.phaseThreshold && (e.state === 'chase' || e.state === 'recover')) {
    brain.phase = 2; brain.dashesLeft = brain.lasersLeft = 0;
    e.state = 'phaseShift'; e.timer = cfg.phaseShift; stop(e); cue(e, ctx, 'phase');
    return;
  }
  if (e.state === 'phaseShift' || e.state === 'recover') {
    stop(e); e.timer = Math.max(0, e.timer - dt);
    if (e.timer <= EPSILON) { e.state = 'chase'; e.timer = 0; }
    return;
  }
  if (e.state === 'charge') {
    stop(e); e.angle = brain.lockedAngle; e.timer = Math.max(0, e.timer - dt);
    if (e.timer <= EPSILON) {
      e.state = 'dash'; e.timer = cfg.dash.duration; brain.dashesLeft--;
      cue(e, ctx, 'release');
    }
    return;
  }
  if (e.state === 'dash') {
    const remaining = Math.max(EPSILON, e.timer), travel = Math.min(dt, Math.max(0, e.timer));
    const vx = (brain.targetX - e.x) / remaining * travel / dt;
    const vy = (brain.targetY - e.y) / remaining * travel / dt;
    e.timer = Math.max(0, e.timer - dt); e.angle = brain.lockedAngle;
    if (e.timer <= EPSILON) { e.state = 'aim'; e.timer = cfg.settle; }
    // Preserve the fractional final displacement even though this tick transitions to the stationary settle state.
    e.vx = vx; e.vy = vy;
    return;
  }
  if (e.state === 'aim') {
    stop(e); e.timer = Math.max(0, e.timer - dt);
    if (e.timer > EPSILON) return;
    if (!visible(e, ctx) || Math.hypot(ctx.player.x - e.x, ctx.player.y - e.y) > cfg.positioning.maxRange) {
      recover(e, brain, ctx); return;
    }
    if (brain.laserIndex === 0) fireLanding(e, ctx);
    if (brain.dashesLeft > 0) {
      if (!beginCharge(e, brain, ctx)) recover(e, brain, ctx);
      return;
    }
    beginLaser(e, brain, ctx);
    return;
  }
  if (e.state === 'laserWarmup') {
    stop(e); e.angle = brain.lockedAngle; e.timer = Math.max(0, e.timer - dt);
    if (e.timer <= EPSILON) { e.state = 'laser'; e.timer = cfg.laser.duration; cue(e, ctx, 'release'); }
    return;
  }
  if (e.state === 'laser') {
    stop(e); e.angle = brain.lockedAngle;
    const beam = miniBossLaserGeometry(e, ctx.difficulty);
    if (ctx.player.invincible <= EPSILON && pointInBeam(ctx.player.x, ctx.player.y, BALANCE.player.hitRadius, beam)) {
      ctx.damagePlayer();
      if (ctx.player.hp <= 0) return;
    }
    e.timer = Math.max(0, e.timer - dt);
    if (e.timer <= EPSILON) {
      brain.lasersLeft--;
      if (brain.lasersLeft > 0) { e.state = 'aim'; e.timer = cfg.laser.gap; }
      else recover(e, brain, ctx);
    }
    return;
  }

  e.state = 'chase'; e.timer = Math.max(0, e.timer - dt);
  const distance = Math.hypot(ctx.player.x - e.x, ctx.player.y - e.y);
  const margin = Math.max(cfg.positioning.edgeMargin, e.radius + 24);
  if (!visible(e, ctx) || distance > cfg.positioning.maxRange || distance < cfg.positioning.minRange
    || e.x < margin || e.y < margin || e.x > WORLD.width - margin || e.y > WORLD.height - margin) {
    reposition(e, dt, ctx); return;
  }
  e.angle = Math.atan2(ctx.player.y - e.y, ctx.player.x - e.x);
  if (e.timer > EPSILON || e.cooldown > EPSILON || !ctx.canCommit()) { reposition(e, dt, ctx); return; }
  // Only landing bursts consume this reservation; expire spare ring capacity before the laser/recovery ends.
  const duration = cfg.dash.counts[brain.phase - 1] * ((brain.phase === 2 ? cfg.dash.phase2Warning : cfg.dash.warning) + cfg.dash.duration + cfg.settle) + 0.15;
  if (ctx.reserveAttack && !ctx.reserveAttack(e.id, cfg.dash.counts[brain.phase - 1] * cfg.landing.ringCount, 0, duration)) return;
  brain.cycle++; brain.combo = brain.cycle % 2 ? 'pursuit' : 'crossfire';
  if (brain.cycle % 3 === 0 && beginBossAction(e, { kind: 'sidestep', ...bossActionTarget(e, ctx.player, 350, brain.cycle % 2 ? 1.05 : -1.05),
    warning: ctx.difficulty === 'hard' ? 0.5 : 0.65, duration: 0.45, recovery: ctx.difficulty === 'hard' ? 0.5 : 0.7 }, ctx)) return;
  brain.dashesLeft = cfg.dash.counts[brain.phase - 1]; brain.lasersLeft = cfg.laser.counts[brain.phase - 1];
  brain.laserIndex = brain.chainIndex = 0;
  if (!beginCharge(e, brain, ctx)) recover(e, brain, ctx);
}
