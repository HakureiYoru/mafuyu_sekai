import { VIEW, WORLD } from './config';
import { difficultyConfig } from './difficulty';
import { angleDelta, clamp, normalize, TAU } from './math';
import type { AreaHazard, CombatEvent, Difficulty, Enemy, EnemyShotOptions, EnemyType, Player, ProjectileMotionPhase, Vec2 } from './types';

const EPSILON = 1e-8;
const MOB_TYPES = new Set<EnemyType>(['basic', 'dasher', 'sniper', 'sprayer', 'minelayer', 'shield', 'weaver', 'returner', 'sampler', 'carrier']);

export interface Season2Brain {
  phase: 1 | 2; cycle: number; lockedAngle: number; targetId: number | null;
  points: Vec2[]; auxTimer: number; shotsLeft: number; partsSpawned: boolean; deathHandled: boolean;
  healedIds: number[]; heading: number; partIds: number[]; lostArms: number[];
}

export function createSeason2Brain(_type: EnemyType): Season2Brain {
  return { phase: 1, cycle: 0, lockedAngle: 0, targetId: null, points: [], auxTimer: 0, shotsLeft: 0,
    partsSpawned: false, deathHandled: false, healedIds: [], heading: 0, partIds: [], lostArms: [] };
}

export const SEASON2_ATTACKS = {
  shield: { warning: 0.9, recovery: 1.2, cooldown: 1.5, arc: Math.PI * 2 / 3, multiplier: 0.25, turnSpeed: 1.5, speed: 250 },
  weaver: { warning: 1.1, recovery: 1.1, cooldown: 3.2, halfWidth: 448, spacing: 28, gapOffset: 168, gapWidth: 64, speed: 220, radius: 8, travel: 1000 },
  returner: { warning: 0.85, recovery: 0.8, cooldown: 2.6, spread: 0.5, speed: 300, outbound: 1.7, pause: 0.65 },
  sampler: { interval: 0.3, samples: 3, warning: 1.1, stagger: 0.18, radius: 50, duration: 0.28, cooldown: 3.8 },
  repairer: { warning: 1.2, cooldown: 3.5, range: 540, fraction: 0.2, maxTargets: 6 },
  carrier: { cores: 3, coreCap: 12, radius: 27, warning: 0.95, speed: 210, lifetime: 2.4 },
  palisade: { warning: 1.25, recovery: 1.2, cooldown: 0.9, phaseThreshold: 0.5, phaseShift: 1.1, armOffset: 145, batches: 2, batchGap: 0.85 },
  reprise: { warning: 1.05, recovery: 1.2, cooldown: 0.6, phaseThreshold: 0.5, phaseShift: 1.1,
    fanCount: 11, ringCount: 18, spread: 2.2, speed: 240, outbound: 1.65, pause: 0.65, phase2Gap: 0.5, gap: 0.65 },
} as const;

const HARD_ATTACKS = {
  ...SEASON2_ATTACKS,
  shield: { ...SEASON2_ATTACKS.shield, warning: 0.8, recovery: 1.05 },
  weaver: { ...SEASON2_ATTACKS.weaver, warning: 1, gapWidth: 48, cooldown: 2.7 },
  returner: { ...SEASON2_ATTACKS.returner, warning: 0.75, spread: 0.65 },
  sampler: { ...SEASON2_ATTACKS.sampler, warning: 1, cooldown: 3.3 },
  palisade: { ...SEASON2_ATTACKS.palisade, warning: 1.1, batches: 3, batchGap: 0.75, recovery: 1 },
  reprise: { ...SEASON2_ATTACKS.reprise, warning: 0.95, fanCount: 15, ringCount: 22, recovery: 1, phase2Gap: 0.45 },
} as const;

/** Values here are before the simulation's one global difficulty multiplier. */
export function season2Attacks(difficulty: Difficulty = 'normal') { return difficulty === 'hard' ? HARD_ATTACKS : SEASON2_ATTACKS; }

export interface Season2AiContext {
  player: Player; difficulty: Difficulty; elapsed: number; enemies: readonly Enemy[];
  canCommit(kind?: 'wall' | 'sample'): boolean;
  shootAt(source: Enemy, x: number, y: number, angle: number, speed: number, radius: number, color: number, options?: EnemyShotOptions): void;
  spawnHazard(hazard: Omit<AreaHazard, 'id'>): void;
  spawnPart(parent: Enemy, type: 'arm' | 'node' | 'core', x: number, y: number): Enemy | null;
  retirePart(part: Enemy): void;
  emit(event: CombatEvent): void;
}

export interface Season2Telegraph {
  kind: 'shield' | 'wall' | 'fan' | 'ring' | 'sample' | 'repair' | 'core';
  x: number; y: number; angle: number; radius: number; spread: number;
  points: readonly Vec2[]; warning: number; remaining: number; color: number;
  gapOffset?: number; gapWidth?: number; halfWidth?: number; travel?: number;
}

function memory(e: Enemy): Season2Brain { return e.season2 ??= createSeason2Brain(e.type); }
function stop(e: Enemy): void { e.vx = e.vy = 0; }
function cue(e: Enemy, ctx: Season2AiContext, text: string, amount?: number): void {
  ctx.emit({ type: 'attack', enemyType: e.type, targetId: e.id, x: e.x, y: e.y, angle: e.angle, text, amount });
}
function recover(e: Enemy, time: number, cooldown: number): void {
  e.state = 'recover'; e.timer = time; e.cooldown = cooldown; memory(e).shotsLeft = 0; stop(e);
}
function warning(e: Enemy, ctx: Season2AiContext, time: number, state: Enemy['state'] = 'charge'): void {
  e.state = state; e.timer = time; e.angle = memory(e).lockedAngle; stop(e); cue(e, ctx, 'windup');
}
function visible(e: Enemy, p: Player): boolean {
  const x = clamp(p.x, VIEW.width / 2, WORLD.width - VIEW.width / 2);
  const y = clamp(p.y, VIEW.height / 2, WORLD.height - VIEW.height / 2);
  return Math.abs(e.x - x) < VIEW.width / 2 - 70 && Math.abs(e.y - y) < VIEW.height / 2 - 70;
}
function approach(e: Enemy, p: Player, dt: number, range: number): void {
  const dx = p.x - e.x, dy = p.y - e.y, distance = Math.hypot(dx, dy);
  const target = distance < range - 70 ? -1 : distance > range + 40 || !visible(e, p) ? 1 : 0;
  const n = normalize(dx, dy), speed = Math.min(e.speed, Math.abs(distance - range) / dt);
  e.vx = n.x * speed * target; e.vy = n.y * speed * target;
}
function snapshot(e: Enemy, p: Player): void { memory(e).lockedAngle = Math.atan2(p.y - e.y, p.x - e.x); }

/** Initial linear travel, a visible stationary beat, one reversal, then expiry by the simulation. */
export function returningProgram(speed: number, outbound: number, pause = 0.65): readonly ProjectileMotionPhase[] {
  return [{ duration: outbound, speed }, { duration: pause, speed: 0 }, { duration: outbound, speed, reverse: true }];
}

/** Bullet centers used both by emission and the wall telegraph; gaps include projectile radius. */
export function season2WallPoints(e: Enemy, difficulty: Difficulty = 'normal'): Vec2[] {
  const cfg = season2Attacks(difficulty).weaver, brain = e.season2, angle = brain?.lockedAngle ?? e.angle;
  const points: Vec2[] = [];
  const halfGap = cfg.gapWidth / 2 + cfg.radius;
  const segments = [[-cfg.halfWidth, -cfg.gapOffset - halfGap], [-cfg.gapOffset + halfGap, cfg.gapOffset - halfGap], [cfg.gapOffset + halfGap, cfg.halfWidth]];
  for (const [start, end] of segments) {
    const count = Math.ceil((end - start) / cfg.spacing);
    for (let i = 0; i <= count; i++) {
      const offset = start + (end - start) * i / count;
      if (e.type === 'palisade' && brain?.lostArms.includes(offset < 0 ? -1 : 1)) continue;
      const x = e.x - Math.sin(angle) * offset, y = e.y + Math.cos(angle) * offset;
      if (x < cfg.radius || y < cfg.radius || x > WORLD.width - cfg.radius || y > WORLD.height - cfg.radius) continue;
      points.push({ x, y });
    }
  }
  return points;
}

/** Read-only display contract. It never consumes RNG, changes phase or retargets the attack. */
export function season2Telegraph(e: Enemy, difficulty: Difficulty = 'normal'): Season2Telegraph | null {
  const brain = e.season2;
  if (!brain || e.hp <= 0) return null;
  const cfg = season2Attacks(difficulty);
  const base = { x: e.x, y: e.y, angle: brain.lockedAngle, radius: e.radius, spread: 0, points: brain.points,
    warning: e.timer, remaining: e.timer, color: 0xffae8c };
  if (e.type === 'shield' && e.state !== 'recover') return { ...base, kind: 'shield', angle: e.angle, spread: cfg.shield.arc, warning: cfg.shield.warning };
  if (e.type === 'palisade' && e.state === 'charge' && brain.lostArms.length === 2) return { ...base, kind: 'fan', spread: 0.6, radius: 1000, warning: cfg.palisade.warning };
  if ((e.type === 'weaver' || e.type === 'palisade') && ['charge', 'volley'].includes(e.state)) {
    return { ...base, kind: 'wall', points: season2WallPoints(e, difficulty), warning: e.type === 'palisade' ? cfg.palisade.warning : cfg.weaver.warning,
      gapOffset: cfg.weaver.gapOffset, gapWidth: cfg.weaver.gapWidth, halfWidth: cfg.weaver.halfWidth, travel: cfg.weaver.travel, color: 0xe4acff };
  }
  if (e.type === 'returner' && e.state === 'charge') return { ...base, kind: 'fan', spread: cfg.returner.spread, radius: cfg.returner.speed * difficultyConfig(difficulty).bulletSpeed * cfg.returner.outbound, warning: cfg.returner.warning };
  if (e.type === 'sampler' && e.state === 'charge') return { ...base, kind: 'sample', radius: cfg.sampler.radius, warning: cfg.sampler.interval * (cfg.sampler.samples - 1) };
  if (e.type === 'repairer' && e.state === 'charge') return { ...base, kind: 'repair', warning: cfg.repairer.warning, color: 0xe4d28f };
  if (e.type === 'core') return { ...base, kind: 'core', warning: cfg.carrier.warning, angle: brain.heading };
  if (e.type === 'reprise' && ['charge', 'volley'].includes(e.state)) return { ...base,
    kind: brain.cycle % 2 ? 'fan' : 'ring', spread: cfg.reprise.spread, radius: e.radius + 18 + cfg.reprise.speed * difficultyConfig(difficulty).bulletSpeed * cfg.reprise.outbound, warning: cfg.reprise.warning, color: 0xdab3ff };
  return null;
}

export function shieldDamageMultiplier(e: Enemy, sourceX: number, sourceY: number): number {
  if (e.type !== 'shield' || e.hp <= 0 || e.state === 'recover' || e.state === 'phaseShift') return 1;
  const cfg = SEASON2_ATTACKS.shield;
  return Math.abs(angleDelta(e.angle, Math.atan2(sourceY - e.y, sourceX - e.x))) <= cfg.arc / 2 + EPSILON ? cfg.multiplier : 1;
}

function wall(e: Enemy, ctx: Season2AiContext): void {
  const cfg = season2Attacks(ctx.difficulty).weaver, brain = memory(e);
  for (const point of season2WallPoints(e, ctx.difficulty)) {
    let source = e;
    if (e.type === 'palisade') {
      const side = (point.x - e.x) * -Math.sin(brain.lockedAngle) + (point.y - e.y) * Math.cos(brain.lockedAngle) < 0 ? -1 : 1;
      const arm = ctx.enemies.find(part => part.hp > 0 && part.parentId === e.id && part.type === 'arm' && part.season2?.heading === side);
      if (!arm || (arm.disabledUntil ?? 0) > ctx.elapsed) continue;
      source = arm;
    }
    ctx.shootAt(source, point.x, point.y, brain.lockedAngle, cfg.speed, cfg.radius, 0xe0a4ff,
      { shape: 'rice', program: [{ duration: cfg.travel / (cfg.speed * difficultyConfig(ctx.difficulty).bulletSpeed), speed: cfg.speed }] });
  }
  cue(e, ctx, 'release');
}

function repairTarget(e: Enemy, ctx: Season2AiContext): Enemy | undefined {
  const cfg = season2Attacks(ctx.difficulty).repairer, brain = memory(e);
  if (brain.healedIds.length >= cfg.maxTargets) return undefined;
  return ctx.enemies.filter(target => target.id !== e.id && target.hp > 0 && target.hp < target.maxHp && MOB_TYPES.has(target.type)
    && (!target.role || target.role === 'mob') && !brain.healedIds.includes(target.id)
    && Math.hypot(target.x - e.x, target.y - e.y) <= cfg.range
    && !ctx.enemies.some(other => other.id !== e.id && other.hp > 0 && other.type === 'repairer' && other.state === 'charge' && other.season2?.targetId === target.id))
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.id - b.id)[0];
}

function initializeArms(e: Enemy, ctx: Season2AiContext): void {
  const brain = memory(e), cfg = season2Attacks(ctx.difficulty).palisade;
  if (brain.partsSpawned) return;
  while (brain.partIds.length < 2) {
    const side = brain.partIds.length ? 1 : -1;
    const arm = ctx.spawnPart(e, 'arm', clamp(e.x, 30, WORLD.width - 30), clamp(e.y + side * cfg.armOffset, 30, WORLD.height - 30));
    if (!arm) return;
    arm.parentId = e.id; memory(arm).heading = side; brain.partIds.push(arm.id);
  }
  brain.partsSpawned = true;
}

function updateArm(e: Enemy, dt: number, ctx: Season2AiContext): void {
  const parent = ctx.enemies.find(target => target.id === e.parentId && target.hp > 0);
  if (!parent) { ctx.retirePart(e); return; }
  const offset = memory(e).heading * season2Attacks(ctx.difficulty).palisade.armOffset;
  const x = parent.x - Math.sin(parent.angle) * offset, y = parent.y + Math.cos(parent.angle) * offset;
  e.vx = (clamp(x, e.radius, WORLD.width - e.radius) - e.x) / dt;
  e.vy = (clamp(y, e.radius, WORLD.height - e.radius) - e.y) / dt;
  e.angle = parent.angle;
}

function repriseBurst(e: Enemy, ctx: Season2AiContext, index: number): void {
  const cfg = season2Attacks(ctx.difficulty).reprise, brain = memory(e), ring = brain.cycle % 2 === 0;
  const count = ring ? cfg.ringCount : cfg.fanCount, offset = index ? 0.16 : 0;
  const program = returningProgram(cfg.speed, cfg.outbound, cfg.pause);
  for (let i = 0; i < count; i++) {
    const relative = ring ? i * TAU / count + offset : (i / (count - 1) - 0.5) * cfg.spread;
    if (ring && Math.abs(angleDelta(0, relative)) < cfg.gap / 2) continue;
    const angle = brain.lockedAngle + relative;
    const radius = e.radius + 18;
    ctx.shootAt(e, e.x + Math.cos(angle) * radius, e.y + Math.sin(angle) * radius,
      angle, cfg.speed, 8, index ? 0xffbd8a : 0xd9a3ff, { shape: ring ? 'orb' : 'kunai', program });
  }
  cue(e, ctx, 'release');
}

/** Caller decrements cooldown and integrates positions; no rendering clock participates in these decisions. */
export function updateSeason2Ai(e: Enemy, dt: number, ctx: Season2AiContext): void {
  if (e.hp <= 0 || ctx.player.hp <= 0 || !Number.isFinite(dt) || dt <= 0) return;
  const brain = memory(e), cfg = season2Attacks(ctx.difficulty), p = ctx.player;
  if (e.type === 'arm') { updateArm(e, dt, ctx); return; }
  if (e.type === 'node') { stop(e); return; }
  if (e.type === 'core') {
    if (brain.deathHandled) { stop(e); return; }
    stop(e); e.state = 'arming'; e.timer = Math.max(0, e.timer - dt);
    if (e.timer <= EPSILON) {
      brain.deathHandled = true;
      ctx.shootAt(e, e.x, e.y, brain.heading, cfg.carrier.speed, 10, 0xff9e81,
        { shape: 'orb', program: [{ duration: cfg.carrier.lifetime, speed: cfg.carrier.speed }] });
      cue(e, ctx, 'release'); ctx.retirePart(e);
    }
    return;
  }
  if ((e.disabledUntil ?? 0) > ctx.elapsed) { stop(e); return; }
  if (e.type === 'palisade') initializeArms(e, ctx);
  const boss = e.type === 'palisade' || e.type === 'reprise';
  if (boss && brain.phase === 1 && e.hp / Math.max(1, e.maxHp) <= cfg[e.type as 'palisade' | 'reprise'].phaseThreshold
    && ['chase', 'recover'].includes(e.state)) {
    brain.phase = 2; e.state = 'phaseShift'; e.timer = cfg.palisade.phaseShift; stop(e); cue(e, ctx, 'phase', 2); return;
  }
  if (e.state === 'recover' || e.state === 'phaseShift') {
    stop(e); e.timer = Math.max(0, e.timer - dt);
    if (e.timer <= EPSILON) e.state = 'chase';
    return;
  }
  if (e.state === 'volley') {
    stop(e); e.timer = Math.max(0, e.timer - dt); brain.auxTimer -= dt;
    if (brain.shotsLeft > 0 && brain.auxTimer <= EPSILON) {
      if (e.type === 'palisade') { wall(e, ctx); brain.auxTimer += cfg.palisade.batchGap; }
      if (e.type === 'reprise') { repriseBurst(e, ctx, 1); brain.auxTimer += cfg.reprise.phase2Gap; }
      brain.shotsLeft--;
    }
    if (e.timer <= EPSILON) {
      const profile = e.type === 'palisade' ? cfg.palisade : cfg.reprise;
      recover(e, profile.recovery, profile.cooldown);
    }
    return;
  }
  if (e.state === 'charge') {
    stop(e); e.angle = brain.lockedAngle;
    e.timer = Math.max(0, e.timer - dt);
    if (e.type === 'sampler') {
      brain.auxTimer -= dt;
      if (brain.points.length < cfg.sampler.samples && brain.auxTimer <= EPSILON) {
        brain.points.push({ x: clamp(p.x, cfg.sampler.radius, WORLD.width - cfg.sampler.radius), y: clamp(p.y, cfg.sampler.radius, WORLD.height - cfg.sampler.radius) });
        brain.auxTimer += cfg.sampler.interval;
      }
    }
    if (e.type === 'repairer') {
      const target = ctx.enemies.find(other => other.id === brain.targetId);
      if (!target || target.hp <= 0 || !MOB_TYPES.has(target.type) || Math.hypot(target.x - e.x, target.y - e.y) > cfg.repairer.range) {
        brain.targetId = null; brain.points.length = 0; recover(e, 0.4, 1); return;
      }
      brain.points[0] = { x: target.x, y: target.y };
    }
    if (e.timer > EPSILON) return;
    if (e.type === 'shield') {
      for (const offset of [-0.16, 0, 0.16]) ctx.shootAt(e, e.x, e.y, e.angle + offset, cfg.shield.speed, 8, 0xffce87, { shape: 'rice' });
      cue(e, ctx, 'release'); recover(e, cfg.shield.recovery, cfg.shield.cooldown);
    } else if (e.type === 'weaver') {
      wall(e, ctx); recover(e, cfg.weaver.recovery, cfg.weaver.cooldown);
    } else if (e.type === 'returner') {
      const program = returningProgram(cfg.returner.speed, cfg.returner.outbound, cfg.returner.pause);
      for (const side of [-1, 1]) ctx.shootAt(e, e.x, e.y, e.angle + side * cfg.returner.spread / 2,
        cfg.returner.speed, 9, 0xffa6bf, { shape: 'kunai', program });
      cue(e, ctx, 'release'); recover(e, cfg.returner.recovery, cfg.returner.cooldown);
    } else if (e.type === 'sampler') {
      brain.points.forEach((point, index) => {
        const time = cfg.sampler.warning + cfg.sampler.stagger * index;
        ctx.spawnHazard({ ...point, radius: cfg.sampler.radius, warning: time, warningDuration: time,
          duration: cfg.sampler.duration, life: cfg.sampler.duration, active: false, kind: 'bombard', sourceId: e.id });
      });
      cue(e, ctx, 'release'); recover(e, cfg.sampler.warning + cfg.sampler.stagger * 2 + cfg.sampler.duration, cfg.sampler.cooldown);
    } else if (e.type === 'repairer') {
      const target = ctx.enemies.find(other => other.id === brain.targetId);
      if (target && target.hp > 0 && !brain.healedIds.includes(target.id)) {
        const amount = Math.min(target.maxHp - target.hp, Math.ceil(target.maxHp * cfg.repairer.fraction));
        target.hp += amount; brain.healedIds.push(target.id); cue(e, ctx, 'repair', amount);
      }
      brain.targetId = null; recover(e, 0.65, cfg.repairer.cooldown);
    } else if (e.type === 'palisade') {
      wall(e, ctx); e.state = 'volley'; brain.shotsLeft = cfg.palisade.batches - 1;
      brain.auxTimer = cfg.palisade.batchGap; e.timer = cfg.palisade.batchGap * (cfg.palisade.batches - 1) + 0.5;
      if (brain.lostArms.length === 2) {
        for (const offset of [-0.3, 0, 0.3]) ctx.shootAt(e, e.x, e.y, e.angle + offset, 190, 8, 0xffc58b, { shape: 'orb' });
      }
    } else if (e.type === 'reprise') {
      repriseBurst(e, ctx, 0); e.state = 'volley'; brain.shotsLeft = brain.phase === 2 ? 1 : 0;
      brain.auxTimer = cfg.reprise.phase2Gap;
      e.timer = cfg.reprise.outbound * 2 + cfg.reprise.pause + (brain.phase === 2 ? cfg.reprise.phase2Gap : 0);
    }
    return;
  }

  e.state = 'chase';
  const range = e.type === 'shield' ? 240 : e.type === 'carrier' ? 95 : e.type === 'repairer' ? 520 : boss ? 420 : 470;
  approach(e, p, dt, range);
  const desired = Math.atan2(p.y - e.y, p.x - e.x);
  e.angle += clamp(angleDelta(e.angle, desired), -cfg.shield.turnSpeed * dt, cfg.shield.turnSpeed * dt);
  if (e.type === 'carrier' || !visible(e, p) || Math.hypot(p.x - e.x, p.y - e.y) > (boss ? 800 : 700) || e.cooldown > EPSILON) return;
  if (e.type === 'repairer') {
    const target = repairTarget(e, ctx);
    if (!target || !ctx.canCommit()) return;
    brain.targetId = target.id; brain.points = [{ x: target.x, y: target.y }]; snapshot(e, p);
    warning(e, ctx, cfg.repairer.warning); return;
  }
  const kind = e.type === 'weaver' || e.type === 'palisade' ? 'wall' : e.type === 'sampler' ? 'sample' : undefined;
  if (!ctx.canCommit(kind)) return;
  brain.cycle++; snapshot(e, p); brain.points.length = 0;
  if (e.type === 'sampler') {
    brain.points.push({ x: clamp(p.x, cfg.sampler.radius, WORLD.width - cfg.sampler.radius), y: clamp(p.y, cfg.sampler.radius, WORLD.height - cfg.sampler.radius) });
    brain.auxTimer = cfg.sampler.interval;
    warning(e, ctx, cfg.sampler.interval * (cfg.sampler.samples - 1));
  } else if (e.type === 'palisade') {
    // Phase two changes the wall's travel direction only before its next complete warning.
    if (brain.phase === 2 && brain.cycle % 2 === 0) brain.lockedAngle += Math.PI / 2;
    warning(e, ctx, cfg.palisade.warning);
  } else if (e.type === 'shield' || e.type === 'weaver' || e.type === 'returner' || e.type === 'reprise') warning(e, ctx, cfg[e.type].warning);
}

/** Called once by the simulation's normal death path. This hook never awards score or drops itself. */
export function onSeason2Death(e: Enemy, ctx: Season2AiContext): void {
  if (e.hp > 0) return;
  const brain = memory(e);
  if (brain.deathHandled) return;
  brain.deathHandled = true;
  if (e.type === 'arm') {
    const parent = ctx.enemies.find(other => other.id === e.parentId && other.type === 'palisade' && other.hp > 0);
    if (parent) {
      const lost = memory(parent).lostArms; if (!lost.includes(brain.heading)) lost.push(brain.heading);
      if (lost.length === 2) recover(parent, season2Attacks(ctx.difficulty).palisade.recovery, 0.8);
      cue(parent, ctx, 'part-break');
    }
    return;
  }
  if (e.type !== 'carrier' || ctx.player.hp <= 0) return;
  const cfg = season2Attacks(ctx.difficulty).carrier;
  let available = Math.max(0, cfg.coreCap - ctx.enemies.filter(other => other.type === 'core' && other.hp > 0).length);
  for (let i = 0; i < cfg.cores && available > 0; i++) {
    const angle = e.angle + i * TAU / cfg.cores;
    const part = ctx.spawnPart(e, 'core', clamp(e.x + Math.cos(angle) * cfg.radius, 15, WORLD.width - 15), clamp(e.y + Math.sin(angle) * cfg.radius, 15, WORLD.height - 15));
    if (!part) continue;
    part.parentId = e.id; part.state = 'arming'; part.timer = cfg.warning; memory(part).heading = angle; available--;
  }
}
