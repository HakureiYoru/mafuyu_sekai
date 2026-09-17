import { STEP, WORLD } from './config';
import { angleDelta, clamp } from './math';
import { advanceProjectileMotion } from './projectile-motion';
import type { AreaHazard, ArenaRect, Bullet, Difficulty, Enemy, EnemyType, Player, SpawnIndicator, Vec2 } from './types';

export const THREAT_PACING = {
  normal: { pressure: 10, breather: 4, tacticalCap: 2, slots: 3, breatherSlots: 1, gap: 0.28 },
  hard: { pressure: 12, breather: 3, tacticalCap: 3, slots: 4, breatherSlots: 2, gap: 0.18 },
  pressureShare: 0.75, maxDeferral: 1, routeSpeeds: [300, 180], routeStep: 0.1, routeHorizon: 0.9, retryInterval: 0.2,
} as const;

export interface AttackIntent extends Vec2 {
  sourceId: number; kind: 'dash' | 'line' | 'fan' | 'wall' | 'sample' | 'repair';
  angle: number; range: number; width: number; spread?: number; warning: number; duration: number;
  /** Locked gaps/points are shared with visible warnings, never sampled from future player input. */
  points?: readonly Vec2[]; gaps?: readonly { offset: number; width: number }[]; extra?: readonly AttackIntent[];
  speed?: number; releaseDuration?: number; startsAt?: number; endsAt?: number; committed?: boolean;
}

export interface ThreatContext {
  elapsed: number; difficulty: Difficulty; player: Player; enemies?: readonly Enemy[];
  hazards?: readonly AreaHazard[]; bullets?: readonly Bullet[]; arena?: ArenaRect | null;
  onDeferredCancel?(sourceId: number): void;
}

const PRESSURE = new Set<EnemyType>(['basic', 'dasher', 'returner', 'carrier']);
const TACTICAL = new Set<EnemyType>(['sniper', 'sprayer', 'minelayer', 'shield', 'weaver', 'sampler', 'repairer']);
export function isTacticalEnemy(type: EnemyType): boolean { return TACTICAL.has(type); }

/** A conservative danger envelope, also suitable for rendering a pending commitment. */
export function pointInAttackIntent(point: Vec2, intent: AttackIntent, padding = 18, includeExtra = true): boolean {
  if (includeExtra && intent.extra?.some(part => pointInAttackIntent(point, part, padding))) return true;
  if (intent.kind === 'repair') return false;
  if (intent.kind === 'sample') return (intent.points ?? [intent]).some(p => Math.hypot(point.x - p.x, point.y - p.y) <= intent.width / 2 + padding);
  const dx = point.x - intent.x, dy = point.y - intent.y;
  const along = dx * Math.cos(intent.angle) + dy * Math.sin(intent.angle);
  const across = -dx * Math.sin(intent.angle) + dy * Math.cos(intent.angle);
  if (intent.kind === 'fan') {
    const radius = Math.hypot(dx, dy);
    return radius <= intent.range + padding && Math.abs(angleDelta(intent.angle, Math.atan2(dy, dx))) <= (intent.spread ?? 0) / 2 + Math.asin(Math.min(1, padding / Math.max(padding, radius)));
  }
  if (along < -padding || along > intent.range + padding || Math.abs(across) > intent.width / 2 + padding) return false;
  return !(intent.gaps ?? []).some(gap => Math.abs(across - gap.offset) < gap.width / 2 - padding);
}

function intentDangerAt(point: Vec2, intent: AttackIntent, time: number, elapsed: number, padding: number): boolean {
  if (intent.extra?.some(part => intentDangerAt(point, { ...part, startsAt: intent.startsAt === undefined ? undefined : intent.startsAt + part.warning - intent.warning }, time, elapsed, padding))) return true;
  const start = intent.startsAt === undefined ? intent.warning : intent.startsAt - elapsed;
  const end = intent.endsAt === undefined ? start + intent.duration : intent.endsAt - elapsed;
  if (time < start || time > end) return false;
  if (intent.speed) {
    const distance = intent.kind === 'fan' ? Math.hypot(point.x - intent.x, point.y - intent.y)
      : (point.x - intent.x) * Math.cos(intent.angle) + (point.y - intent.y) * Math.sin(intent.angle);
    const front = intent.speed * (time - start), back = intent.speed * Math.max(0, time - start - (intent.releaseDuration ?? 0) - THREAT_PACING.routeStep);
    const thickness = intent.kind === 'wall' ? 8 : intent.width / 2;
    if (distance > front + padding + thickness || distance < back - padding - thickness) return false;
  }
  return pointInAttackIntent(point, intent, padding, false);
}

interface ForecastCache { bullets: readonly Bullet[] | null; elapsed: number; count: number; samples: Map<Bullet, Float64Array> }
function createForecastCache(): ForecastCache { return { bullets: null, elapsed: -1, count: 0, samples: new Map() }; }

/** Eight headings at walk/focus speed. Extend beyond longer warnings by .3s, capped at 1.5s. */
export function hasSafeShortPath(candidate: AttackIntent, context: ThreatContext, reservations: readonly AttackIntent[] = [], cache = createForecastCache()): boolean {
  if (candidate.kind === 'repair') return true;
  const p = context.player, bodyRadius = 18, hitRadius = 7, bounds = context.arena ?? { x: 0, y: 0, ...WORLD };
  const intents = [...reservations.filter(intent => intent.sourceId !== candidate.sourceId), candidate];
  const horizon = Math.max(THREAT_PACING.routeHorizon, Math.min(1.5, candidate.warning + 0.3));
  const times = Array.from({ length: Math.ceil(horizon / THREAT_PACING.routeStep) }, (_, i) => (i + 1) * THREAT_PACING.routeStep);
  const routes: Float64Array[] = [];
  // First reject routes using cheap known geometry. In crowded fixtures this often rejects all
  // candidates without forecasting a single projectile, and never changes the admission rule.
  for (let route = 0; route < 16; route++) {
    const heading = route % 8 * Math.PI / 4, speed = THREAT_PACING.routeSpeeds[Math.floor(route / 8)];
    const positions = new Float64Array(times.length * 2);
    let x = p.x, y = p.y, safe = true;
    for (let index = 0; index < times.length && safe; index++) {
      const time = times[index], angle = heading;
      x = clamp(x + Math.cos(angle) * speed * THREAT_PACING.routeStep, bounds.x + bodyRadius, bounds.x + bounds.width - bodyRadius);
      y = clamp(y + Math.sin(angle) * speed * THREAT_PACING.routeStep, bounds.y + bodyRadius, bounds.y + bounds.height - bodyRadius);
      const position = { x, y };
      for (const intent of intents) {
        if (intentDangerAt(position, intent, time, context.elapsed, intent.kind === 'dash' ? bodyRadius : hitRadius)) { safe = false; break; }
      }
      if (!safe) break;
      for (const h of context.hazards ?? []) {
        if (time < h.warning || time > h.warning + h.life) continue;
        const geometry: AttackIntent = { sourceId: h.sourceId, x: h.x, y: h.y, kind: h.kind === 'beam' ? 'line' : 'sample',
          angle: (h.angle ?? 0) + (h.angularSpeed ?? 0) * Math.max(0, time - h.warning), range: h.length ?? 0,
          width: h.kind === 'beam' ? h.width ?? 0 : h.radius * 2, warning: 0, duration: h.duration };
        if (pointInAttackIntent(position, geometry, hitRadius)) { safe = false; break; }
      }
      if (!safe) break;
      if (safe) for (const enemy of context.enemies ?? []) {
        if (enemy.hp <= 0 || enemy.type === 'mine' && enemy.timer > time) continue;
        const dx = x - enemy.x - enemy.vx * time, dy = y - enemy.y - enemy.vy * time, limit = bodyRadius + enemy.radius;
        if (dx * dx + dy * dy <= limit * limit) { safe = false; break; }
      }
      positions[index * 2] = x; positions[index * 2 + 1] = y;
    }
    if (safe) routes.push(positions);
  }
  if (!routes.length) return false;
  const bullets = context.bullets;
  if (!bullets?.length) return true;
  if (cache.bullets !== bullets || cache.elapsed !== context.elapsed || cache.count !== bullets.length) {
    cache.bullets = bullets; cache.elapsed = context.elapsed; cache.count = bullets.length; cache.samples.clear();
  }
  const nearby = bullets.filter(b => {
    if (b.owner !== 'enemy' || b.life <= 0) return false;
    const reach = 450 + Math.max(b.speed, b.maxSpeed ?? 0, b.programSpeed ?? 0, ...(b.program?.map(phase => phase.speed ?? 0) ?? [])) * 1.5 + b.radius + hitRadius;
    const dx = b.x - p.x, dy = b.y - p.y;
    return dx * dx + dy * dy <= reach * reach;
  });
  for (const positions of routes) {
    let safe = true;
    for (const bullet of nearby) {
      const curved = !!(bullet.program?.length || bullet.acceleration || bullet.turnRate);
      let forecast = curved ? cache.samples.get(bullet) : undefined;
      if (curved && !forecast) {
        forecast = new Float64Array(30); const copy = { ...bullet };
        // At most one 1.5s projection per curved bullet per simulation tick, shared by all requests.
        for (let index = 0; index < 15; index++) {
          for (let substep = 0; substep < 6; substep++) {
            const delta = advanceProjectileMotion(copy, STEP);
            copy.x += delta?.dx ?? copy.vx * STEP; copy.y += delta?.dy ?? copy.vy * STEP;
          }
          forecast[index * 2] = copy.x; forecast[index * 2 + 1] = copy.y;
        }
        cache.samples.set(bullet, forecast);
      }
      let previousX = p.x, previousY = p.y, bx = bullet.x, by = bullet.y;
      const limit = hitRadius + bullet.radius, limitSquared = limit * limit;
      for (let index = 0; index < times.length; index++) {
        const time = times[index];
        if (bullet.life < time - THREAT_PACING.routeStep) break;
        const duration = Math.min(time, bullet.life), x = positions[index * 2], y = positions[index * 2 + 1];
        // Common straight projectiles are analytic: no clones, substeps or prediction allocation.
        const nextX = forecast ? forecast[index * 2] : bullet.x + bullet.vx * duration;
        const nextY = forecast ? forecast[index * 2 + 1] : bullet.y + bullet.vy * duration;
        const ax = bx - previousX, ay = by - previousY, dx = nextX - x - ax, dy = nextY - y - ay;
        const t = clamp(-(ax * dx + ay * dy) / Math.max(1e-8, dx * dx + dy * dy), 0, 1);
        const nearX = ax + dx * t, nearY = ay + dy * t;
        if (nearX * nearX + nearY * nearY <= limitSquared) { safe = false; break; }
        previousX = x; previousY = y; bx = nextX; by = nextY;
      }
      if (!safe) break;
    }
    if (safe) return true;
  }
  return false;
}

/** One run-owned coordinator. No clocks, randomness, entities or deferred callbacks survive reset. */
export class ThreatDirector {
  private readonly active: AttackIntent[] = [];
  private readonly deferred = new Map<number, number>();
  private readonly retryAt = new Map<number, number>();
  private forecast = createForecastCache();
  private nextCommit = 0;
  private evaluatedAt = -Infinity;
  get intents(): readonly AttackIntent[] { return this.active; }
  reset(): void { this.active.length = 0; this.deferred.clear(); this.retryAt.clear(); this.nextCommit = 0; this.evaluatedAt = -Infinity; this.forecast = createForecastCache(); }
  clear(): void { this.reset(); }
  cancel(sourceId: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) if (this.active[i].sourceId === sourceId) this.active.splice(i, 1);
    this.deferred.delete(sourceId);
    this.retryAt.delete(sourceId);
  }
  pace(elapsed: number, difficulty: Difficulty = 'normal'): 'pressure' | 'breather' {
    const cfg = THREAT_PACING[difficulty], age = Math.max(0, elapsed) % (cfg.pressure + cfg.breather);
    return age + 1e-8 < cfg.pressure ? 'pressure' : 'breather';
  }
  tacticalCap(difficulty: Difficulty = 'normal', progression = 360): number { return THREAT_PACING[difficulty].tacticalCap - Number(progression < 90); }
  /** Call once each simulation tick even when no actor requests a new attack. */
  update(elapsed: number, enemies?: readonly Enemy[]): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const source = enemies?.find(e => e.id === this.active[i].sourceId);
      if ((this.active[i].endsAt ?? 0) <= elapsed || enemies && (!source || source.hp <= 0)) this.active.splice(i, 1);
    }
    for (const id of this.deferred.keys()) if (enemies && !enemies.some(e => e.id === id && e.hp > 0)) { this.deferred.delete(id); this.retryAt.delete(id); }
  }
  selectSpawn(pool: readonly EnemyType[], enemies: readonly Pick<Enemy, 'type' | 'hp'>[], roll: number,
    difficulty: Difficulty = 'normal', elapsed = 0, indicators: readonly Pick<SpawnIndicator, 'type'>[] = [], progression = 360): EnemyType | null {
    const pressure = pool.filter(type => PRESSURE.has(type));
    const count = enemies.filter(e => e.hp > 0 && TACTICAL.has(e.type)).length + indicators.filter(e => TACTICAL.has(e.type)).length;
    const tactical = count < this.tacticalCap(difficulty, progression) && this.pace(elapsed, difficulty) === 'pressure' ? pool.filter(type => TACTICAL.has(type)) : [];
    const value = clamp(Number.isFinite(roll) ? roll : 0, 0, 1 - Number.EPSILON);
    const choosePressure = value < THREAT_PACING.pressureShare;
    const choices = choosePressure && pressure.length || !tactical.length ? pressure : tactical;
    const eligible = choices.length ? choices : tactical;
    if (!eligible.length) return null;
    const fraction = eligible === pressure && tactical.length ? value / THREAT_PACING.pressureShare
      : eligible === tactical && pressure.length ? (value - THREAT_PACING.pressureShare) / (1 - THREAT_PACING.pressureShare) : value;
    return eligible[Math.min(eligible.length - 1, Math.floor(Math.max(0, fraction) * eligible.length))];
  }
  canCommit(intent: AttackIntent, ctx: ThreatContext): boolean {
    this.update(ctx.elapsed, ctx.enemies);
    if (this.active.some(active => active.sourceId === intent.sourceId)) return false;
    const cfg = THREAT_PACING[ctx.difficulty];
    const cap = this.pace(ctx.elapsed, ctx.difficulty) === 'pressure' ? cfg.slots : cfg.breatherSlots;
    const due = ctx.elapsed + 1e-8 >= (this.retryAt.get(intent.sourceId) ?? 0)
      && ctx.elapsed + 1e-8 >= this.nextCommit && this.active.length < cap;
    // No pressure-fixture burst may perform dozens of geometric forecasts in one fixed tick.
    // Budget waiting can retry next tick; an actual conflict is rechecked after .2s.
    const budgetBlocked = due && this.evaluatedAt === ctx.elapsed;
    let allowed = false;
    if (due && !budgetBlocked) {
      this.evaluatedAt = ctx.elapsed;
      allowed = hasSafeShortPath(intent, ctx, this.active, this.forecast);
    }
    if (!allowed) {
      const first = this.deferred.get(intent.sourceId) ?? ctx.elapsed;
      if (ctx.elapsed - first + 1e-8 >= THREAT_PACING.maxDeferral) {
        this.deferred.delete(intent.sourceId); this.retryAt.delete(intent.sourceId); ctx.onDeferredCancel?.(intent.sourceId);
      } else {
        this.deferred.set(intent.sourceId, first);
        if (!budgetBlocked && ctx.elapsed >= (this.retryAt.get(intent.sourceId) ?? 0)) this.retryAt.set(intent.sourceId, ctx.elapsed + THREAT_PACING.retryInterval);
      }
      return false;
    }
    this.deferred.delete(intent.sourceId);
    this.retryAt.delete(intent.sourceId);
    this.active.push({ ...intent, points: intent.points?.map(p => ({ ...p })), gaps: intent.gaps?.map(gap => ({ ...gap })),
      startsAt: ctx.elapsed + intent.warning, endsAt: ctx.elapsed + intent.warning + intent.duration, committed: true });
    this.nextCommit = ctx.elapsed + cfg.gap;
    return true;
  }
}
