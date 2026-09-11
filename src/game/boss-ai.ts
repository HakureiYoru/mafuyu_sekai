import { BALANCE, VIEW, WORLD } from './config';
import { angleDelta, beamGeometry, clamp, normalize, pointInBeam, TAU } from './math';
import type { AreaHazard, BossBrain, CombatEvent, Difficulty, Enemy, EnemyShotOptions, Player } from './types';

const EPSILON = 1e-8;

/** Attack timings and geometry are also consumed by telegraph rendering and fairness tests. */
export const BOSS_ATTACKS = {
  opening: 1.8,
  phaseThresholds: [0.65, 0.3],
  phaseShift: 1.6,
  phaseLaserGrace: 4,
  recovery: BALANCE.boss.patternGap,
  breathing: [1.6, 1.3, 1],
  positioning: { maxDistance: 900, edgeMargin: 260, edgeBodyPadding: 60, viewPadding: 80, speed: 110, horizontalOffset: 520 },
  volley: { warning: [1.15, 1.05, 0.95], count: [11, 13, 15], bursts: [9, 10, 11], layers: [2, 2, 2], interval: 0.46,
    angleStep: 0.18, speed: [230, 245, 260], speedStep: 18, radius: 6, tail: 0.5,
    lobeOffset: 0.6, sway: 0.3, swayStep: 0.72, gap: 0.58, laneOffset: 0.9,
    turnRate: 0.22, turnDelay: 0.55, turnDuration: 0.8, acceleration: 30, maxSpeed: 330 },
  nova: { warning: [1.3, 1.15, 1.05], count: [22, 24, 26], rings: [7, 8, 9], layers: [2, 2, 3], interval: 0.62,
    gap: [0.6, 0.56, 0.52], laneOffset: 0.36, speed: [190, 205, 220], speedStep: 22, radius: 7, tail: 0.5,
    interleave: 0.5, rotation: 0.17, turnRate: 0.25, turnDelay: 0.4, turnDuration: 0.65, acceleration: 24, maxSpeed: 310 },
  novaFlanks: { enabled: false, warning: 0.85, radius: 75, offset: 170, duration: 0.36 },
  bombard: { warning: 1.25, count: 3, delay: 0.5, radius: 100, duration: 0.38, offset: 145,
    ringCount: [22, 26, 30], rings: [6, 7, 8], ringInterval: 0.6, ringSpeed: [190, 210, 230], ringRadius: 8,
    ringGap: 0.58, laneOffset: 0.62, rotation: 0.13, tail: 1.4 },
  laser: {
    warning: BALANCE.boss.laserWarning, duration: BALANCE.boss.laserDuration,
    angularSpeed: BALANCE.boss.angularSpeed, width: BALANCE.boss.laserWidth, length: BALANCE.boss.laserLength,
    cooldown: BALANCE.boss.laserCooldown, sideAngle: 0.65, hold: 0.25,
  },
} as const;

const HARD_BOSS_ATTACKS = {
  ...BOSS_ATTACKS,
  opening: 1.1,
  phaseLaserGrace: 3,
  recovery: 0.65,
  breathing: [0.8, 0.65, 0.5],
  positioning: { ...BOSS_ATTACKS.positioning, speed: 150 },
  volley: { ...BOSS_ATTACKS.volley, warning: [0.95, 0.9, 0.85], count: [13, 15, 17], bursts: [12, 14, 15], layers: [2, 3, 3],
    interval: 0.38, angleStep: 0.17, gap: 0.42, tail: 0.5 },
  nova: { ...BOSS_ATTACKS.nova, warning: [1.05, 0.95, 0.85], count: [26, 28, 30], rings: [9, 10, 11], layers: [2, 3, 3],
    interval: 0.5, gap: [0.46, 0.43, 0.4], rotation: 0.21, tail: 0.5 },
  novaFlanks: { ...BOSS_ATTACKS.novaFlanks, enabled: true },
  bombard: { ...BOSS_ATTACKS.bombard, warning: 0.85, count: 5, delay: 0.24, radius: 85, duration: 0.34, offset: 160,
    ringCount: [28, 32, 36], rings: [9, 10, 11], ringInterval: 0.46, ringGap: 0.42, tail: 1.2 },
  laser: { ...BOSS_ATTACKS.laser, warning: 1.25, duration: 2.6, hold: 0.15, angularSpeed: 0.42, sideAngle: 0.58, cooldown: 9 },
} as const;

/** Stable shared references: attack simulation and renderer always use identical run difficulty geometry. */
export function bossAttacks(difficulty: Difficulty = 'normal') {
  return difficulty === 'hard' ? HARD_BOSS_ATTACKS : BOSS_ATTACKS;
}

export interface BossAiContext {
  difficulty?: Difficulty;
  player: Player;
  elapsed: number;
  shoot(enemy: Enemy, angle: number, speed: number, radius: number, color: number, options?: EnemyShotOptions): void;
  emit(event: CombatEvent): void;
  damagePlayer(): void;
  clearHostileProjectiles(): void;
  clearBossHazards(): void;
  spawnHazard(hazard: Omit<AreaHazard, 'id'>): void;
}

export function createBossBrain(): BossBrain {
  return { phase: 1, skill: 'idle', cycle: 0, lockedAngle: 0, sweepDirection: -1, targetX: 0, targetY: 0, shotCount: 0, auxTimer: 0 };
}

/** The same committed escape lane drives every layer, curved trajectory and visible telegraph. */
export function bossPatternLanes(e: Enemy, difficulty: Difficulty = 'normal'): { angle: number; width: number }[] {
  const brain = e.boss;
  if (!brain || !['volley', 'nova', 'bombard'].includes(brain.skill)) return [];
  const cfg = bossAttacks(difficulty), direction = brain.cycle % 2 === 1 ? 1 : -1;
  const offset = brain.skill === 'volley' ? cfg.volley.laneOffset : brain.skill === 'nova' ? -cfg.nova.laneOffset : cfg.bombard.laneOffset;
  const width = brain.skill === 'volley' ? cfg.volley.gap : brain.skill === 'nova' ? cfg.nova.gap[brain.phase - 1] : cfg.bombard.ringGap;
  return [{ angle: brain.lockedAngle + direction * offset, width }];
}

/** Encloses every future fan axis plus its finite post-launch curvature, not only the first burst. */
export function bossVolleyArc(e: Enemy, difficulty: Difficulty = 'normal'): { angle: number; width: number } {
  const cfg = bossAttacks(difficulty).volley, phase = (e.boss?.phase ?? 1) - 1;
  return { angle: e.boss?.lockedAngle ?? e.angle,
    width: Math.min(TAU, (cfg.count[phase] - 0.5) * cfg.angleStep + 2 * (cfg.lobeOffset + cfg.sway + cfg.turnRate * cfg.turnDuration)) };
}

function clearsLane(angle: number, lane: { angle: number; width: number }, turn = 0): boolean {
  // Every heading on the finite curve remains outside the lane, so the entire position path does too.
  return Math.abs(angleDelta(lane.angle, angle)) > lane.width / 2 + Math.abs(turn) + 0.015;
}

function announce(e: Enemy, ctx: BossAiContext, text: string, amount?: number): void {
  ctx.emit({ type: 'attack', enemyType: 'boss', targetId: e.id, x: e.x, y: e.y, angle: e.angle, text, amount });
}

function beginRecovery(e: Enemy, brain: BossBrain, ctx: BossAiContext): void {
  e.state = 'recover'; e.timer = bossAttacks(ctx.difficulty).recovery; e.vx = e.vy = 0;
  brain.skill = 'idle'; brain.auxTimer = 0; brain.shotCount = 0;
}

function beginBreathing(e: Enemy, brain: BossBrain, ctx: BossAiContext): void {
  e.state = 'chase'; e.timer = bossAttacks(ctx.difficulty).breathing[brain.phase - 1]; e.cooldown = 0;
  brain.skill = 'idle'; brain.auxTimer = 0; brain.shotCount = 0;
}

/** Only approach/standing position reads the player's current location; committed attacks do not. */
function needsReposition(e: Enemy, ctx: BossAiContext): boolean {
  const config = bossAttacks(ctx.difficulty).positioning;
  const margin = Math.max(config.edgeMargin, e.radius + config.edgeBodyPadding);
  const cameraX = clamp(ctx.player.x, VIEW.width / 2, WORLD.width - VIEW.width / 2);
  const cameraY = clamp(ctx.player.y, VIEW.height / 2, WORLD.height - VIEW.height / 2);
  return Math.hypot(ctx.player.x - e.x, ctx.player.y - e.y) > config.maxDistance
    || e.x < margin || e.y < margin || e.x > WORLD.width - margin || e.y > WORLD.height - margin
    || Math.abs(e.x - cameraX) > VIEW.width / 2 - config.viewPadding
    || Math.abs(e.y - cameraY) > VIEW.height / 2 - config.viewPadding;
}

function reposition(e: Enemy, ctx: BossAiContext): void {
  const config = bossAttacks(ctx.difficulty).positioning;
  const margin = Math.max(config.edgeMargin, e.radius + config.edgeBodyPadding);
  const towardCenter = ctx.player.x < WORLD.width / 2 ? 1 : -1;
  const x = clamp(ctx.player.x + towardCenter * config.horizontalOffset, margin, WORLD.width - margin);
  const y = clamp(ctx.player.y, margin, WORLD.height - margin);
  const direction = normalize(x - e.x, y - e.y);
  e.vx = direction.x * config.speed; e.vy = direction.y * config.speed;
  e.angle = Math.atan2(ctx.player.y - e.y, ctx.player.x - e.x);
}

function beginSkill(e: Enemy, brain: BossBrain, ctx: BossAiContext): void {
  const attacks = bossAttacks(ctx.difficulty);
  const phase = brain.phase - 1;
  const toward = Math.atan2(ctx.player.y - e.y, ctx.player.x - e.x);
  e.vx = e.vy = 0; e.cooldown = 0;
  brain.targetX = ctx.player.x; brain.targetY = ctx.player.y;
  brain.lockedAngle = toward; brain.shotCount = 0; brain.auxTimer = 0;
  if (e.laserCooldown <= EPSILON) {
    brain.skill = 'laser'; brain.sweepDirection = brain.sweepDirection === 1 ? -1 : 1;
    brain.lockedAngle = toward - brain.sweepDirection * attacks.laser.sideAngle;
    e.angle = brain.lockedAngle; e.state = 'laserWarmup'; e.timer = attacks.laser.warning;
    // Remove all older threats before committing to the long, fully visible sweep warning.
    ctx.clearHostileProjectiles(); ctx.clearBossHazards();
    announce(e, ctx, 'laser');
    return;
  }

  const sequences = [
    ['volley', 'nova', 'bombard'],
    ['nova', 'bombard', 'volley'],
    ['bombard', 'volley', 'nova'],
  ] as const;
  let skill: 'volley' | 'nova' | 'bombard' = sequences[phase][brain.cycle % 3];
  if (ctx.difficulty === 'hard' && brain.cycle % 2 === 0) {
    const distance = Math.hypot(ctx.player.x - e.x, ctx.player.y - e.y);
    const observedSpeed = Math.hypot(ctx.player.vx, ctx.player.vy);
    skill = distance < 390 ? 'nova' : observedSpeed >= 140 ? 'bombard' : 'volley';
  }
  brain.cycle++; brain.skill = skill;
  e.attackIndex = skill === 'volley' ? 0 : skill === 'nova' ? 1 : 2;
  e.angle = brain.lockedAngle;
  if (skill === 'volley') {
    e.state = 'aim'; e.timer = attacks.volley.warning[phase];
  } else if (skill === 'nova') {
    e.state = 'novaWarmup'; e.timer = attacks.nova.warning[phase];
    if (attacks.novaFlanks.enabled && brain.phase >= 2) {
      const flank = attacks.novaFlanks;
      const lane = bossPatternLanes(e, ctx.difficulty)[0];
      const distance = Math.hypot(brain.targetX - e.x, brain.targetY - e.y);
      const centerX = e.x + Math.cos(lane.angle) * distance, centerY = e.y + Math.sin(lane.angle) * distance;
      const tangentX = -Math.sin(lane.angle), tangentY = Math.cos(lane.angle);
      for (let i = 0; i < 2; i++) {
        const offset = (i === 0 ? 1 : -1) * flank.offset;
        const warning = Math.max(flank.warning, attacks.nova.warning[phase] + (i + 0.5) * attacks.nova.interval);
        ctx.spawnHazard({
          x: clamp(centerX + tangentX * offset, flank.radius, WORLD.width - flank.radius),
          y: clamp(centerY + tangentY * offset, flank.radius, WORLD.height - flank.radius),
          radius: flank.radius, warning, warningDuration: warning, life: flank.duration, duration: flank.duration,
          sourceId: e.id, kind: 'bombard', active: false,
        });
      }
    }
  } else {
    e.state = 'bombardWarmup'; e.timer = attacks.bombard.warning;
    const bombard = attacks.bombard;
    const tangentX = -Math.sin(brain.lockedAngle), tangentY = Math.cos(brain.lockedAngle);
    const radialX = Math.cos(brain.lockedAngle), radialY = Math.sin(brain.lockedAngle);
    // Reveal the whole line/cross and every future countdown together; later movement never relocates it.
    for (let i = 0; i < bombard.count; i++) {
      const offset = (i === 0 ? 0 : i % 2 === 1 ? 1 : -1) * bombard.offset;
      const axisX = i < 3 ? tangentX : radialX, axisY = i < 3 ? tangentY : radialY;
      const warning = bombard.warning + i * bombard.delay;
      ctx.spawnHazard({
        x: clamp(brain.targetX + axisX * offset, bombard.radius, WORLD.width - bombard.radius),
        y: clamp(brain.targetY + axisY * offset, bombard.radius, WORLD.height - bombard.radius),
        radius: bombard.radius, warning, warningDuration: warning,
        life: bombard.duration, duration: bombard.duration, sourceId: e.id, kind: 'bombard', active: false,
      });
    }
  }
  announce(e, ctx, skill);
}

function fireVolley(e: Enemy, brain: BossBrain, ctx: BossAiContext): void {
  const phase = brain.phase - 1, config = bossAttacks(ctx.difficulty).volley, count = config.count[phase];
  const lane = bossPatternLanes(e, ctx.difficulty)[0];
  for (let layer = 0; layer < config.layers[phase]; layer++) {
    const wing = layer === 0 ? -1 : layer === 1 ? 1 : 0;
    const turn = (wing || (brain.shotCount % 2 === 0 ? 1 : -1)) * config.turnRate;
    const center = brain.lockedAngle + wing * (config.lobeOffset + Math.sin(brain.shotCount * config.swayStep) * config.sway);
    const interleave = (brain.shotCount % 2 === 0 ? -1 : 1) * config.angleStep / 4;
    for (let i = 0; i < count; i++) {
      const angle = center + (i - (count - 1) / 2) * config.angleStep + interleave;
      if (!clearsLane(angle, lane, turn * config.turnDuration)) continue;
      ctx.shoot(e, angle, config.speed[phase] + layer * config.speedStep, config.radius, layer === 0 ? 0xf5a3d4 : layer === 1 ? 0xb3a0ff : 0xffd58a,
        { shape: layer === 0 ? 'rice' : 'kunai', turnRate: turn, turnDelay: config.turnDelay, turnDuration: config.turnDuration,
          acceleration: config.acceleration, maxSpeed: config.maxSpeed });
    }
  }
  brain.shotCount++; e.cooldown = config.interval;
}

function fireNova(e: Enemy, brain: BossBrain, ctx: BossAiContext): void {
  const phase = brain.phase - 1, config = bossAttacks(ctx.difficulty).nova, count = config.count[phase];
  const lane = bossPatternLanes(e, ctx.difficulty)[0];
  for (let layer = 0; layer < config.layers[phase]; layer++) {
    const direction = layer % 2 === 0 ? 1 : -1;
    const rotation = direction * brain.shotCount * config.rotation + layer * config.interleave * TAU / count;
    const turn = direction * config.turnRate;
    for (let i = 0; i < count; i++) {
      const angle = brain.lockedAngle + i * TAU / count + rotation;
      if (!clearsLane(angle, lane, turn * config.turnDuration)) continue;
      ctx.shoot(e, angle, config.speed[phase] + layer * config.speedStep, config.radius, layer === 0 ? 0xb8b1ff : layer === 1 ? 0xffcf73 : 0xffb5de,
        { shape: layer % 2 === 0 ? 'kunai' : 'orb', turnRate: turn, turnDelay: config.turnDelay, turnDuration: config.turnDuration,
          acceleration: config.acceleration, maxSpeed: config.maxSpeed });
    }
  }
  brain.shotCount++; e.cooldown = config.interval;
}

function fireBombardRing(e: Enemy, brain: BossBrain, ctx: BossAiContext): void {
  const phase = brain.phase - 1, config = bossAttacks(ctx.difficulty).bombard;
  const lane = bossPatternLanes(e, ctx.difficulty)[0], count = config.ringCount[phase];
  const rotation = brain.shotCount * config.rotation * (brain.cycle % 2 === 0 ? -1 : 1);
  for (let i = 0; i < count; i++) {
    const angle = brain.lockedAngle + i * TAU / count + rotation;
    if (!clearsLane(angle, lane)) continue;
    ctx.shoot(e, angle, config.ringSpeed[phase], config.ringRadius, brain.shotCount % 2 === 0 ? 0xffcb89 : 0xfc95bd,
      { shape: brain.shotCount % 2 === 0 ? 'orb' : 'rice' });
  }
  brain.shotCount++; e.cooldown = config.ringInterval;
}

/** Fixed-step, deterministic Boss decisions. The simulation owns position integration and e.cooldown. */
export function updateBossAi(e: Enemy, dt: number, ctx: BossAiContext): void {
  if (e.hp <= 0 || ctx.player.hp <= 0 || !Number.isFinite(dt) || dt <= 0) return;
  const attacks = bossAttacks(ctx.difficulty);
  const brain = e.boss ??= createBossBrain();
  const health = e.hp / Math.max(1, e.maxHp);
  const phase = health <= attacks.phaseThresholds[1] ? 3 : health <= attacks.phaseThresholds[0] ? 2 : 1;
  if (phase > brain.phase) {
    brain.phase = phase; brain.skill = 'idle'; brain.cycle = 0; brain.shotCount = 0; brain.auxTimer = 0;
    e.state = 'phaseShift'; e.timer = attacks.phaseShift; e.vx = e.vy = 0; e.cooldown = 0;
    e.laserCooldown = Math.max(e.laserCooldown, attacks.phaseLaserGrace);
    ctx.clearHostileProjectiles(); ctx.clearBossHazards();
    announce(e, ctx, 'phase', phase);
    return;
  }
  if (e.state === 'phaseShift') {
    e.vx = e.vy = 0; e.timer = Math.max(0, e.timer - dt);
    if (e.timer <= EPSILON) beginBreathing(e, brain, ctx);
    return;
  }

  if (e.state === 'laserWarmup') {
    e.vx = e.vy = 0; e.angle = brain.lockedAngle;
    e.timer = Math.max(0, e.timer - dt);
    if (e.timer <= EPSILON) { e.state = 'laser'; e.timer = attacks.laser.duration; brain.auxTimer = 0; }
    return;
  }
  if (e.state === 'laser') {
    e.vx = e.vy = 0;
    const config = attacks.laser;
    brain.auxTimer = Math.min(config.duration, brain.auxTimer + dt);
    const sweepTime = Math.max(0, brain.auxTimer - config.hold);
    e.angle = brain.lockedAngle + brain.sweepDirection * config.angularSpeed * sweepTime;
    e.timer = Math.max(0, config.duration - brain.auxTimer);
    const beam = beamGeometry(e.x, e.y, e.angle, config.length, config.width);
    if (ctx.player.invincible <= EPSILON && pointInBeam(ctx.player.x, ctx.player.y, ctx.player.radius, beam)) {
      ctx.damagePlayer();
      if (ctx.player.hp <= 0) return;
    }
    if (e.timer <= EPSILON) { e.laserCooldown = config.cooldown; beginRecovery(e, brain, ctx); }
    return;
  }

  e.laserCooldown = Math.max(0, e.laserCooldown - dt);
  if (e.state === 'recover') {
    e.vx = e.vy = 0; e.timer = Math.max(0, e.timer - dt);
    if (e.timer <= EPSILON) beginBreathing(e, brain, ctx);
    return;
  }
  if (e.state === 'aim' || e.state === 'novaWarmup' || e.state === 'bombardWarmup') {
    e.vx = e.vy = 0; e.angle = brain.lockedAngle;
    e.timer = Math.max(0, e.timer - dt);
    if (e.timer > EPSILON) return;
    const phaseIndex = brain.phase - 1;
    if (e.state === 'aim') {
      e.state = 'volley';
      e.timer = (attacks.volley.bursts[phaseIndex] - 1) * attacks.volley.interval + attacks.volley.tail;
      fireVolley(e, brain, ctx);
    } else if (e.state === 'novaWarmup') {
      e.state = 'nova';
      e.timer = (attacks.nova.rings[phaseIndex] - 1) * attacks.nova.interval + attacks.nova.tail;
      fireNova(e, brain, ctx);
    } else {
      e.state = 'bombard';
      e.timer = Math.max((attacks.bombard.count - 1) * attacks.bombard.delay + attacks.bombard.duration,
        (attacks.bombard.rings[phaseIndex] - 1) * attacks.bombard.ringInterval + attacks.bombard.tail);
      fireBombardRing(e, brain, ctx);
    }
    return;
  }
  if (e.state === 'volley' || e.state === 'nova' || e.state === 'bombard') {
    e.vx = e.vy = 0; e.angle = brain.lockedAngle; e.timer = Math.max(0, e.timer - dt);
    const phaseIndex = brain.phase - 1;
    if (e.state === 'volley' && brain.shotCount < attacks.volley.bursts[phaseIndex] && e.cooldown <= EPSILON) fireVolley(e, brain, ctx);
    if (e.state === 'nova' && brain.shotCount < attacks.nova.rings[phaseIndex] && e.cooldown <= EPSILON) fireNova(e, brain, ctx);
    if (e.state === 'bombard' && brain.shotCount < attacks.bombard.rings[phaseIndex] && e.cooldown <= EPSILON) fireBombardRing(e, brain, ctx);
    if (e.timer <= EPSILON) beginRecovery(e, brain, ctx);
    return;
  }

  // No attacks begin from outside the viewport or while pressed against the world boundary.
  e.state = 'chase'; brain.skill = 'idle'; e.timer = Math.max(0, e.timer - dt);
  if (needsReposition(e, ctx)) { reposition(e, ctx); return; }
  e.vx = e.vy = 0;
  e.angle = Math.atan2(ctx.player.y - e.y, ctx.player.x - e.x);
  if (e.timer <= EPSILON) beginSkill(e, brain, ctx);
}
