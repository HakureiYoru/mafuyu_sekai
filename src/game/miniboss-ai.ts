import { VIEW, WORLD } from './config';
import { beamGeometry, clamp, normalize, pointInBeam, segmentCircleHit } from './math';
import type { CombatEvent, Difficulty, Enemy, MiniBossBrain, Player } from './types';

const EPSILON = 1e-8;

/** Shared by simulation and telegraphs; all durations are seconds, distances world pixels. */
export const MINIBOSS_ATTACKS = {
  phaseThreshold: 0.45, phaseShift: 0.85,
  positioning: { minRange: 260, maxRange: 850, viewPadding: 80, edgeMargin: 88, preferredRange: 450 },
  dash: { warning: 0.75, phase2Warning: 0.65, speed: 760, duration: 0.42, flankOffset: 200, clearance: 24 },
  settle: 0.25,
  laser: { warning: 0.9, phase2Warning: 0.85, duration: 0.32, width: 60, length: 1600 },
  recovery: 1.2, phase2Recovery: 1,
} as const;

const HARD_ATTACKS = {
  ...MINIBOSS_ATTACKS,
  dash: { ...MINIBOSS_ATTACKS.dash, warning: 0.5, phase2Warning: 0.45, speed: 880, duration: 0.38 },
  laser: { warning: 0.65, phase2Warning: 0.65, duration: 0.4, width: 72, length: 1800 },
  recovery: 1, phase2Recovery: 0.9,
} as const;

export function miniBossAttacks(difficulty: Difficulty = 'normal') {
  return difficulty === 'hard' ? HARD_ATTACKS : MINIBOSS_ATTACKS;
}

export interface MiniBossAiContext {
  player: Player;
  elapsed: number;
  difficulty?: Difficulty;
  canCommit(): boolean;
  emit(event: CombatEvent): void;
  shoot(enemy: Enemy, angle: number, speed: number, radius: number, color: number): void;
  damagePlayer(): void;
}

export function createMiniBossBrain(): MiniBossBrain {
  return { phase: 1, cycle: 0, lockedAngle: 0, targetX: 0, targetY: 0, dashesLeft: 0 };
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
  const side = ctx.player.x < WORLD.width / 2 ? 1 : -1;
  const x = clamp(ctx.player.x + side * cfg.preferredRange, margin, WORLD.width - margin);
  const y = clamp(ctx.player.y, margin, WORLD.height - margin);
  const distance = Math.hypot(x - e.x, y - e.y), direction = normalize(x - e.x, y - e.y);
  // Difficulty-scaled ordinary speed belongs to the caller. Never apply it twice here.
  const speed = Math.min(e.speed, distance / dt);
  e.vx = direction.x * speed; e.vy = direction.y * speed;
  e.angle = Math.atan2(ctx.player.y - e.y, ctx.player.x - e.x);
}

/** Flank the sampled position instead of ending inside its body; neither goal nor direction tracks later movement. */
function beginCharge(e: Enemy, brain: MiniBossBrain, ctx: MiniBossAiContext): boolean {
  const cfg = miniBossAttacks(ctx.difficulty), player = ctx.player;
  const toward = normalize(player.x - e.x, player.y - e.y);
  const side = (e.id + brain.cycle + brain.dashesLeft) % 2 === 0 ? 1 : -1;
  const margin = Math.max(cfg.positioning.edgeMargin, e.radius + cfg.dash.clearance);
  const maxTravel = cfg.dash.speed * cfg.dash.duration;
  const clearance = e.radius + player.radius + cfg.dash.clearance;
  // Check both flank sides and an outward escape. Clamping a flank at a corner must not turn it into a body charge.
  for (let i = 0; i < 3; i++) {
    const sign = i === 0 ? side : -side;
    const goalX = i < 2 ? player.x - toward.y * cfg.dash.flankOffset * sign : e.x - toward.x * maxTravel;
    const goalY = i < 2 ? player.y + toward.x * cfg.dash.flankOffset * sign : e.y - toward.y * maxTravel;
    const dx = clamp(goalX, margin, WORLD.width - margin) - e.x;
    const dy = clamp(goalY, margin, WORLD.height - margin) - e.y;
    const distance = Math.hypot(dx, dy), fraction = Math.min(1, maxTravel / Math.max(EPSILON, distance));
    const x = e.x + dx * fraction, y = e.y + dy * fraction;
    if (distance < 1 || segmentCircleHit(e.x, e.y, x, y, player.x, player.y, clearance) !== null) continue;
    brain.targetX = x; brain.targetY = y;
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
  brain.dashesLeft = 0; stop(e);
}

/** Single simulation update; the caller exclusively integrates positions and decrements cooldown. */
export function updateMiniBossAi(e: Enemy, dt: number, ctx: MiniBossAiContext): void {
  if (e.hp <= 0 || ctx.player.hp <= 0 || !Number.isFinite(dt) || dt <= 0) return;
  const cfg = miniBossAttacks(ctx.difficulty), brain = e.miniboss ??= createMiniBossBrain();
  // Finish committed warnings/attacks before changing phase; low health never produces an unannounced replacement.
  if (brain.phase === 1 && e.hp / Math.max(1, e.maxHp) <= cfg.phaseThreshold && (e.state === 'chase' || e.state === 'recover')) {
    brain.phase = 2; brain.dashesLeft = 0;
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
    if (brain.dashesLeft > 0) {
      if (!beginCharge(e, brain, ctx)) recover(e, brain, ctx);
      return;
    }
    brain.lockedAngle = Math.atan2(ctx.player.y - e.y, ctx.player.x - e.x);
    e.angle = brain.lockedAngle; e.state = 'laserWarmup';
    e.timer = brain.phase === 2 ? cfg.laser.phase2Warning : cfg.laser.warning;
    cue(e, ctx, 'laser');
    return;
  }
  if (e.state === 'laserWarmup') {
    stop(e); e.angle = brain.lockedAngle; e.timer = Math.max(0, e.timer - dt);
    if (e.timer <= EPSILON) { e.state = 'laser'; e.timer = cfg.laser.duration; cue(e, ctx, 'release'); }
    return;
  }
  if (e.state === 'laser') {
    stop(e); e.angle = brain.lockedAngle;
    const beam = beamGeometry(e.x, e.y, e.angle, cfg.laser.length, cfg.laser.width);
    if (ctx.player.invincible <= EPSILON && pointInBeam(ctx.player.x, ctx.player.y, ctx.player.radius, beam)) {
      ctx.damagePlayer();
      if (ctx.player.hp <= 0) return;
    }
    e.timer = Math.max(0, e.timer - dt);
    if (e.timer <= EPSILON) recover(e, brain, ctx);
    return;
  }

  e.state = 'chase'; e.timer = Math.max(0, e.timer - dt);
  const distance = Math.hypot(ctx.player.x - e.x, ctx.player.y - e.y);
  const margin = Math.max(cfg.positioning.edgeMargin, e.radius + 24);
  if (!visible(e, ctx) || distance > cfg.positioning.maxRange || distance < cfg.positioning.minRange
    || e.x < margin || e.y < margin || e.x > WORLD.width - margin || e.y > WORLD.height - margin) {
    reposition(e, dt, ctx); return;
  }
  stop(e); e.angle = Math.atan2(ctx.player.y - e.y, ctx.player.x - e.x);
  if (e.timer > EPSILON || e.cooldown > EPSILON || !ctx.canCommit()) return;
  brain.cycle++; brain.dashesLeft = ctx.difficulty === 'hard' && brain.phase === 2 ? 2 : 1;
  if (!beginCharge(e, brain, ctx)) recover(e, brain, ctx);
}
