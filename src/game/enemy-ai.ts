import { clamp } from './math';
import { BALANCE } from './config';
import type { CombatEvent, Difficulty, Enemy, EnemyTactics, Player } from './types';

/** Telegraphs, simulation timing and renderer progress indicators share these values. */
export const ENEMY_ATTACKS = {
  basic: { leadTime: 0.35, maxLead: 110, flankDistance: 180, mergeDistance: 140 },
  dasher: { warning: 0.85, lockWindow: 0.45, speed: 500, duration: 0.62, recovery: 0.7, cooldown: 1.6, commitRange: 340 },
  sniper: { minRange: 500, maxRange: 620, warning: 1.1, lockWindow: 0.55, prediction: 0.25, speed: 600, radius: 10,
    shots: 2, shotGap: 0.18, recovery: 0.8, cooldown: 1.35, commitRange: 920 },
  sprayer: { minRange: 380, maxRange: 560, warning: 0.8, lockWindow: 0.8, sector: 1.3,
    shots: 9, shotGap: 0.14, speed: 270, radius: 8, recovery: 1.4, cooldown: 0.6, commitRange: 850 },
  minelayer: { orbitRadius: 450, retreatDistance: 320, warning: 0.65, shots: 2, shotGap: 0.28,
    mineSpacing: 128, recovery: 0.35, cooldown: 3, commitRange: 800 },
  mine: { arming: 1.1 },
} as const;

const HARD_ENEMY_ATTACKS = {
  basic: { leadTime: 0.5, maxLead: 160, flankDistance: 240, mergeDistance: 125 },
  dasher: { warning: 0.6, lockWindow: 0.35, speed: 620, duration: 0.55, recovery: 0.65, cooldown: 1.1, commitRange: 370 },
  sniper: { minRange: 540, maxRange: 680, warning: 0.8, lockWindow: 0.45, prediction: 0.35, speed: 600, radius: 10,
    shots: 3, shotGap: 0.14, recovery: 0.7, cooldown: 1, commitRange: 1000 },
  sprayer: { minRange: 380, maxRange: 560, warning: 0.6, lockWindow: 0.6, sector: 1.5,
    shots: 13, shotGap: 0.095, speed: 270, radius: 8, recovery: 1.1, cooldown: 0.5, commitRange: 900 },
  minelayer: { orbitRadius: 430, retreatDistance: 320, warning: 0.5, shots: 3, shotGap: 0.18,
    mineSpacing: 140, recovery: 0.5, cooldown: 2.3, commitRange: 800 },
  mine: ENEMY_ATTACKS.mine,
} as const;

/** Cached immutable profiles; projectile/movement difficulty multipliers belong to the simulation. */
export function enemyAttacks(difficulty: Difficulty = 'normal') {
  return difficulty === 'hard' ? HARD_ENEMY_ATTACKS : ENEMY_ATTACKS;
}

export interface EnemyAiContext {
  player: Player;
  elapsed: number;
  wave: number;
  difficulty?: Difficulty;
  allowAttack: boolean;
  canCommit(): boolean;
  shoot(enemy: Enemy, angle: number, speed: number, radius: number, color: number): void;
  emit(event: CombatEvent): void;
  plantMine(x: number, y: number): void;
}

const EPSILON = 1e-8;
type StrongType = 'dasher' | 'sniper' | 'sprayer' | 'minelayer';

function memory(enemy: Enemy): EnemyTactics {
  return enemy.tactics ??= { shotsLeft: 0, shotTimer: 0, sweepStart: 0, sweepIndex: 0, locked: false };
}

function stop(enemy: Enemy): void { enemy.vx = 0; enemy.vy = 0; }

function steer(enemy: Enemy, x: number, y: number, dt: number, speed = enemy.speed): void {
  const length = Math.hypot(x, y), scale = length > EPSILON ? speed / length : 0;
  const alpha = 1 - Math.exp(-7 * dt);
  enemy.vx += (x * scale - enemy.vx) * alpha;
  enemy.vy += (y * scale - enemy.vy) * alpha;
}

function bearing(enemy: Enemy, player: Player, lead = 0): number {
  return Math.atan2(player.y + player.vy * lead - enemy.y, player.x + player.vx * lead - enemy.x);
}

function cue(enemy: Enemy, context: EnemyAiContext, text: 'windup' | 'release'): void {
  context.emit({ type: 'attack', x: enemy.x, y: enemy.y, enemyType: enemy.type, targetId: enemy.id, angle: enemy.angle, text });
}

function recover(enemy: Enemy, type: StrongType, context: EnemyAiContext): void {
  enemy.state = 'recover'; enemy.timer = enemyAttacks(context.difficulty)[type].recovery;
  const tactics = memory(enemy);
  tactics.shotsLeft = 0; tactics.shotTimer = 0;
  stop(enemy);
}

function begin(enemy: Enemy, state: 'charge' | 'aim', warning: number, angle: number, locked: boolean, context: EnemyAiContext): void {
  enemy.state = state; enemy.timer = warning; enemy.angle = angle;
  const tactics = memory(enemy);
  tactics.locked = locked; tactics.shotsLeft = 0; tactics.shotTimer = 0; tactics.sweepIndex = 0;
  stop(enemy); cue(enemy, context, 'windup');
}

function updateBasic(enemy: Enemy, dt: number, decide: boolean, context: EnemyAiContext, distance: number): void {
  if (!decide) return;
  const player = context.player, cfg = enemyAttacks(context.difficulty).basic;
  let targetX = player.x, targetY = player.y;
  if (distance > cfg.mergeDistance) {
    const hard = context.difficulty === 'hard';
    const role = Math.abs(enemy.id) % (hard ? 4 : 3);
    if (role === 1) {
      // Use only already-observed velocity, with both a time and a displacement ceiling.
      const lead = Math.min(cfg.leadTime, cfg.maxLead / Math.max(1, Math.hypot(player.vx, player.vy)));
      targetX += player.vx * lead; targetY += player.vy * lead;
    } else if (role >= 2 && distance > EPSILON) {
      const side = hard ? (role === 2 ? -1 : 1) : enemy.id % 2 === 0 ? -1 : 1;
      const offset = Math.min(cfg.flankDistance, (distance - cfg.mergeDistance) * 0.45) * side;
      const observedSpeed = Math.hypot(player.vx, player.vy);
      if (hard && observedSpeed > 30) {
        // The two wings intercept opposite sides of the observed travel lane, with bounded lead.
        const lead = Math.min(cfg.leadTime, cfg.maxLead / observedSpeed) * 0.65;
        targetX += player.vx * lead - player.vy / observedSpeed * offset;
        targetY += player.vy * lead + player.vx / observedSpeed * offset;
      } else {
        targetX -= (player.y - enemy.y) / distance * offset;
        targetY += (player.x - enemy.x) / distance * offset;
      }
    }
  }
  steer(enemy, targetX - enemy.x, targetY - enemy.y, dt);
  enemy.angle = bearing(enemy, player);
}

function flankSide(enemy: Enemy, context: EnemyAiContext, angle: number): number {
  const side = enemy.id % 2 === 0 ? -1 : 1;
  if (context.difficulty !== 'hard') return side;
  const across = Math.cos(angle) * context.player.vy - Math.sin(angle) * context.player.vx;
  return Math.abs(across) > 30 ? Math.sign(across) * side : side;
}

/** Radial retreat/approach plus a fixed side-step: no reading input, teleporting or speed bonuses. */
function keepRange(enemy: Enemy, dt: number, context: EnemyAiContext, distance: number, min: number, max: number, sideWeight = 0.6): void {
  const angle = bearing(enemy, context.player), side = flankSide(enemy, context, angle);
  const forward = distance < min ? -1 : distance > max ? 1 : 0;
  steer(enemy, Math.cos(angle) * forward - Math.sin(angle) * side * sideWeight,
    Math.sin(angle) * forward + Math.cos(angle) * side * sideWeight, dt);
  enemy.angle = angle;
}

function recovery(enemy: Enemy, type: StrongType, dt: number, decide: boolean, context: EnemyAiContext, distance: number): void {
  const profile = enemyAttacks(context.difficulty);
  if (context.difficulty === 'hard') {
    if (decide) {
      const min = type === 'sniper' ? profile.sniper.minRange : type === 'sprayer' ? profile.sprayer.minRange : type === 'minelayer' ? profile.minelayer.retreatDistance : 170;
      const max = type === 'sniper' ? profile.sniper.maxRange : type === 'sprayer' ? profile.sprayer.maxRange : type === 'minelayer' ? profile.minelayer.orbitRadius : profile.dasher.commitRange;
      keepRange(enemy, dt, context, distance, min, max, 0.9);
    }
  } else if (type === 'sprayer') {
    if (decide) {
      const toward = bearing(enemy, context.player), side = enemy.id % 2 === 0 ? -1 : 1;
      steer(enemy, -Math.sin(toward) * side, Math.cos(toward) * side, dt);
    }
  } else if (type === 'sniper') {
    if (decide) {
      if (distance < profile.sniper.minRange) keepRange(enemy, dt, context, distance, profile.sniper.minRange, profile.sniper.maxRange, 0.25);
      else stop(enemy);
    }
  } else {
    stop(enemy);
  }
  enemy.timer = Math.max(0, enemy.timer - dt);
  if (enemy.timer <= EPSILON) {
    enemy.state = 'chase'; enemy.cooldown = profile[type].cooldown;
    memory(enemy).locked = false;
  }
}

function releaseVolley(enemy: Enemy, type: 'sniper' | 'sprayer' | 'minelayer', context: EnemyAiContext): void {
  const profile = enemyAttacks(context.difficulty), tactics = memory(enemy), cfg = profile[type];
  tactics.shotsLeft = cfg.shots; tactics.shotTimer = 0; tactics.sweepIndex = 0; tactics.locked = true;
  const side = enemy.id % 2 === 0 ? -1 : 1;
  tactics.sweepStart = enemy.angle - (type === 'sprayer' ? profile.sprayer.sector * side / 2 : 0);
  enemy.state = 'volley'; enemy.timer = (cfg.shots - 1) * cfg.shotGap;
  cue(enemy, context, 'release');
  volley(enemy, type, 0, context);
}

function volley(enemy: Enemy, type: 'sniper' | 'sprayer' | 'minelayer', dt: number, context: EnemyAiContext): void {
  const profile = enemyAttacks(context.difficulty), tactics = memory(enemy), cfg = profile[type];
  const hard = context.difficulty === 'hard';
  stop(enemy);
  tactics.shotTimer -= dt; enemy.timer = Math.max(0, enemy.timer - dt);
  // Carry fractional intervals forward so shot cadence is independent of decision throttling.
  while (tactics.shotsLeft > 0 && tactics.shotTimer <= EPSILON) {
    if (type === 'minelayer') {
      const spacing = profile.minelayer.mineSpacing;
      const offset = hard && tactics.sweepIndex === 2 ? 0 : (tactics.sweepIndex - 0.5) * spacing;
      const behind = hard && tactics.sweepIndex === 2 ? -spacing * Math.sqrt(3) / 2 : 0;
      const x = enemy.x + Math.cos(enemy.angle) * behind - Math.sin(enemy.angle) * offset;
      const y = enemy.y + Math.sin(enemy.angle) * behind + Math.cos(enemy.angle) * offset;
      // The third point closes the back of an equilateral triangle, never the player's current position.
      if (!hard || Math.hypot(x - context.player.x, y - context.player.y) >= BALANCE.ai.mineSafeDistance) context.plantMine(x, y);
    } else if (type === 'sniper') {
      const sniper = profile.sniper;
      context.shoot(enemy, enemy.angle, sniper.speed, sniper.radius, 0xff925f);
    } else {
      const sprayer = profile.sprayer, side = enemy.id % 2 === 0 ? -1 : 1;
      // Hard alternates the two advertised edges, converging inward without retargeting the cone.
      const index = hard ? (tactics.sweepIndex % 2 === 0 ? Math.floor(tactics.sweepIndex / 2) : sprayer.shots - 1 - Math.floor(tactics.sweepIndex / 2)) : tactics.sweepIndex;
      const angle = tactics.sweepStart + side * sprayer.sector * index / (sprayer.shots - 1);
      context.shoot(enemy, angle, sprayer.speed, sprayer.radius, 0xffbd68);
    }
    tactics.shotsLeft--; tactics.sweepIndex++; tactics.shotTimer += cfg.shotGap;
  }
  if (tactics.shotsLeft === 0) recover(enemy, type, context);
}

function updateDasher(enemy: Enemy, dt: number, decide: boolean, context: EnemyAiContext, distance: number): void {
  const cfg = enemyAttacks(context.difficulty).dasher, tactics = memory(enemy);
  if (enemy.state === 'charge') {
    stop(enemy);
    if (enemy.timer > cfg.lockWindow + EPSILON && decide) enemy.angle = bearing(enemy, context.player);
    enemy.timer = Math.max(0, enemy.timer - dt);
    tactics.locked = enemy.timer <= cfg.lockWindow + EPSILON;
    if (enemy.timer <= EPSILON) {
      enemy.state = 'dash'; enemy.timer = cfg.duration;
      enemy.directionX = Math.cos(enemy.angle); enemy.directionY = Math.sin(enemy.angle);
      cue(enemy, context, 'release');
    }
    return;
  }
  if (enemy.state === 'dash') {
    // A fractional final tick makes the distance exactly speed × duration before integration.
    const travel = Math.min(dt, enemy.timer);
    enemy.timer = Math.max(0, enemy.timer - dt);
    if (enemy.timer <= EPSILON) recover(enemy, 'dasher', context);
    enemy.vx = enemy.directionX * cfg.speed * travel / dt;
    enemy.vy = enemy.directionY * cfg.speed * travel / dt;
    return;
  }
  if (decide) {
    const toward = bearing(enemy, context.player), side = flankSide(enemy, context, toward);
    const flank = clamp((distance - 160) / 700, 0, 0.4) * side;
    steer(enemy, Math.cos(toward + flank), Math.sin(toward + flank), dt);
    enemy.angle = toward;
  }
  if (context.allowAttack && distance <= cfg.commitRange && enemy.cooldown <= EPSILON && context.canCommit()) {
    begin(enemy, 'charge', cfg.warning, bearing(enemy, context.player), false, context);
  }
}

function updateSniper(enemy: Enemy, dt: number, decide: boolean, context: EnemyAiContext, distance: number): void {
  const cfg = enemyAttacks(context.difficulty).sniper, tactics = memory(enemy);
  const prediction = Math.min(cfg.prediction, distance / cfg.speed,
    context.difficulty === 'hard' ? enemyAttacks('hard').basic.maxLead / Math.max(1, Math.hypot(context.player.vx, context.player.vy)) : Infinity);
  if (enemy.state === 'aim') {
    stop(enemy);
    if (enemy.timer > cfg.lockWindow + EPSILON && decide) {
      enemy.angle = bearing(enemy, context.player, prediction);
    }
    enemy.timer = Math.max(0, enemy.timer - dt); tactics.locked = enemy.timer <= cfg.lockWindow + EPSILON;
    if (enemy.timer <= EPSILON) releaseVolley(enemy, 'sniper', context);
    return;
  }
  if (enemy.state === 'volley') { volley(enemy, 'sniper', dt, context); return; }
  if (decide) keepRange(enemy, dt, context, distance, cfg.minRange, cfg.maxRange, 0.35);
  if (context.allowAttack && distance <= cfg.commitRange && enemy.cooldown <= EPSILON && context.canCommit()) {
    begin(enemy, 'aim', cfg.warning, bearing(enemy, context.player, prediction), false, context);
  }
}

function updateSprayer(enemy: Enemy, dt: number, decide: boolean, context: EnemyAiContext, distance: number): void {
  const cfg = enemyAttacks(context.difficulty).sprayer;
  if (enemy.state === 'aim') {
    stop(enemy); enemy.timer = Math.max(0, enemy.timer - dt);
    if (enemy.timer <= EPSILON) releaseVolley(enemy, 'sprayer', context);
    return;
  }
  if (enemy.state === 'volley') { volley(enemy, 'sprayer', dt, context); return; }
  if (decide) keepRange(enemy, dt, context, distance, cfg.minRange, cfg.maxRange);
  if (context.allowAttack && distance <= cfg.commitRange && enemy.cooldown <= EPSILON && context.canCommit()) {
    // The entire cone is committed before its difficulty-specific telegraph begins.
    begin(enemy, 'aim', cfg.warning, bearing(enemy, context.player), true, context);
  }
}

function updateMinelayer(enemy: Enemy, dt: number, decide: boolean, context: EnemyAiContext, distance: number): void {
  const cfg = enemyAttacks(context.difficulty).minelayer;
  if (enemy.state === 'charge' || enemy.state === 'lay') {
    stop(enemy); enemy.timer = Math.max(0, enemy.timer - dt);
    if (enemy.timer <= EPSILON) releaseVolley(enemy, 'minelayer', context);
    return;
  }
  if (enemy.state === 'volley') { volley(enemy, 'minelayer', dt, context); return; }
  if (decide) {
    const toward = bearing(enemy, context.player), side = flankSide(enemy, context, toward);
    const radial = distance < cfg.retreatDistance ? -1 : clamp((distance - cfg.orbitRadius) / 120, -1, 1);
    const lateral = distance < cfg.retreatDistance ? 0.2 : 0.8;
    steer(enemy, Math.cos(toward) * radial - Math.sin(toward) * side * lateral,
      Math.sin(toward) * radial + Math.cos(toward) * side * lateral, dt);
    enemy.angle = toward;
  }
  if (context.allowAttack && distance >= cfg.retreatDistance && distance <= cfg.commitRange && enemy.cooldown <= EPSILON && context.canCommit()) {
    begin(enemy, 'charge', cfg.warning, bearing(enemy, context.player), true, context);
  }
}

/** Updates intent and attack clocks only; the owner integrates positions and resolves all collisions. */
export function updateEnemyAi(enemy: Enemy, dt: number, decide: boolean, context: EnemyAiContext): void {
  if (dt <= 0 || !Number.isFinite(dt) || enemy.hp <= 0 || enemy.type === 'boss' || enemy.type === 'miniboss') return;
  if (enemy.type === 'mine') {
    stop(enemy);
    if (enemy.state === 'arming') {
      enemy.timer = Math.max(0, enemy.timer - dt);
      if (enemy.timer <= EPSILON) enemy.state = 'chase';
    }
    return;
  }
  const distance = Math.hypot(context.player.x - enemy.x, context.player.y - enemy.y);
  if (enemy.type === 'basic') { updateBasic(enemy, dt, decide, context, distance); return; }
  const type = enemy.type;
  if (type !== 'dasher' && type !== 'sniper' && type !== 'sprayer' && type !== 'minelayer') return;
  const committed = enemy.state === 'charge' || enemy.state === 'aim' || enemy.state === 'dash' || enemy.state === 'volley' || enemy.state === 'lay';
  if (!context.allowAttack && committed) { recover(enemy, type, context); return; }
  if (enemy.state === 'recover') { recovery(enemy, type, dt, decide, context, distance); return; }
  if (type === 'dasher') updateDasher(enemy, dt, decide, context, distance);
  else if (type === 'sniper') updateSniper(enemy, dt, decide, context, distance);
  else if (type === 'sprayer') updateSprayer(enemy, dt, decide, context, distance);
  else updateMinelayer(enemy, dt, decide, context, distance);
}
