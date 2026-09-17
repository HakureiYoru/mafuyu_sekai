import { angleDelta, beamGeometry, clamp, pointInBeam, segmentCircleHit, TAU } from './math';
import { buildDamageMultiplier, hasEvolution, highRankCooldown, highRankFactor, moduleRank, newModuleStats, NEW_MODULE_IDS, type NewModuleId, type ResolvedBuildStats } from './upgrades';
import type { CombatEvent, Enemy, InputAction, ModuleId, Pickup, Vec2, WorldState } from './types';

export type ModuleGeometry = { shape: 'circle'; radius: number }
  | { shape: 'beam'; angle: number; length: number; width: number }
  | { shape: 'arc'; angle: number; arc: number; radius: number; width: number }
  | { shape: 'path'; points: readonly Vec2[]; width: number; closed: boolean };
export interface ModuleVisual extends Vec2 {
  id: number; kind: 'pulse' | 'star' | 'blade' | 'echo' | 'spotlight' | 'note' | 'sweep' | 'conduit' | 'decoy' | 'wind' | 'lane' | 'counter' | 'field' | 'link';
  moduleId: ModuleId; rank: number; prevX: number; prevY: number; age: number; duration: number; warning: number; active: boolean; geometry: ModuleGeometry;
  utilityGeometry?: ModuleGeometry;
}
export interface ModuleCombatContext {
  state: WorldState;
  stats?: ResolvedBuildStats;
  query(x: number, y: number, radius: number): readonly Enemy[];
  damage(enemy: Enemy, amount: number, source: { x: number; y: number; kind: 'module'; moduleId: ModuleId }): void;
  slow(enemy: Enemy, amount: number, duration: number): void;
  push(enemy: Enemy, dx: number, dy: number): void;
  collect(pickup: Pickup): boolean;
  emit(event: CombatEvent): void;
}
type Stats = Readonly<Record<string, number>>;
interface Curve { origin: Vec2; angle: number; speed: number; turn: number; outbound: number; returns: boolean; returned: boolean }
interface Actor {
  view: ModuleVisual; damage: number; multiplier: number; hits: Set<number>; skip?: Set<number>; targets: number; started: boolean;
  curve?: Curve; speed?: number; heading?: number; homingId?: number; turnSpeed?: number;
  emitterId?: number; targetId?: number; companionIds?: number[]; slow?: number; push?: number;
  onStart?: (ctx: ModuleCombatContext, actor: Actor) => void;
  onEnd?: (ctx: ModuleCombatContext, actor: Actor) => void;
  group?: Set<number>; hadLeft?: boolean; crossed?: boolean; previousAngle?: number;
}
export const MODULE_COMBAT_LIMITS = { actors: 192, notes: 6, stars: 2, lanes: 2, decoys: 2, carpets: 3 } as const;
const EPSILON = 1e-8;
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const mobCanMove = (enemy: Enemy) => enemy.hp > 0 && enemy.role === 'mob' && !['charge', 'dash'].includes(enemy.state);
function closestPoint(point: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x, dy = b.y - a.y, t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / Math.max(EPSILON, dx * dx + dy * dy), 0, 1);
  return { x: a.x + dx * t, y: a.y + dy * t };
}
function inPolygon(point: Vec2, points: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Simulation-owned supplemental attacks. There is no browser clock, timer, or recursive hit hook. */
export class ModuleCombat {
  readonly visuals: ModuleVisual[] = [];
  private actors: Actor[] = [];
  private cooldowns: Partial<Record<ModuleId, number>> = {};
  private nextId = 1;
  private rounds = 0;
  private rotation = 0;
  private straightTime = 0;
  private straightAngle = 0;
  private windTime = 0;
  private windShots = 0;
  private windShotTimer = 0;
  private windHits = new Set<number>();
  private noteSlowUntil = new Map<number, number>();

  reset(): void {
    this.actors.length = this.visuals.length = 0; this.cooldowns = {}; this.nextId = 1;
    this.rounds = this.rotation = this.straightTime = this.straightAngle = this.windTime = this.windShots = this.windShotTimer = 0;
    this.windHits.clear(); this.noteSlowUntil.clear();
  }
  clearEncounter(): void { this.actors.length = this.visuals.length = 0; this.noteSlowUntil.clear(); this.windTime = 0; this.windHits.clear(); }
  private rank(ctx: ModuleCombatContext, id: ModuleId): number { return ctx.stats ? ctx.stats.ranks[id] ?? 0 : moduleRank(ctx.state.build, id); }
  private stats(ctx: ModuleCombatContext, id: NewModuleId): Stats { return ctx.stats?.values[id] ?? newModuleStats(id, this.rank(ctx, id)); }
  private ready(ctx: ModuleCombatContext, id: NewModuleId): boolean { return this.rank(ctx, id) > 0 && (this.cooldowns[id] ?? 0) <= EPSILON; }
  private trigger(ctx: ModuleCombatContext, id: NewModuleId): Stats {
    const stats = this.stats(ctx, id); this.cooldowns[id] = stats.cooldown;
    ctx.emit({ type: 'module', moduleId: id, x: ctx.state.player.x, y: ctx.state.player.y }); return stats;
  }
  private evolved(ctx: ModuleCombatContext, id: Parameters<typeof hasEvolution>[1]): boolean { return hasEvolution(ctx.state.build, id); }
  private add(ctx: ModuleCombatContext, id: NewModuleId, kind: ModuleVisual['kind'], point: Vec2, geometry: ModuleGeometry, duration: number, damage = 0, warning = 0): Actor | null {
    if (this.actors.length >= MODULE_COMBAT_LIMITS.actors) return null;
    const view: ModuleVisual = { id: this.nextId++, kind, moduleId: id, rank: this.rank(ctx, id), x: point.x, y: point.y, prevX: point.x, prevY: point.y, age: 0, duration: warning + duration, warning, active: warning <= EPSILON, geometry };
    const actor: Actor = { view, damage, multiplier: buildDamageMultiplier(ctx.state.build), hits: new Set(), targets: Infinity, started: false };
    this.actors.push(actor); this.visuals.push(view); return actor;
  }
  private cap(kind: ModuleVisual['kind'], maximum: number, id?: ModuleId): void {
    const matching = this.actors.filter(actor => actor.view.kind === kind && (!id || actor.view.moduleId === id));
    for (let i = 0; i < matching.length - maximum; i++) this.remove(matching[i]);
  }
  private remove(actor: Actor): void {
    const index = this.actors.indexOf(actor); if (index >= 0) this.actors.splice(index, 1);
    const visual = this.visuals.indexOf(actor.view); if (visual >= 0) this.visuals.splice(visual, 1);
  }
  private deal(ctx: ModuleCombatContext, actor: Actor, enemy: Enemy, damage = actor.damage): boolean {
    if (ctx.state.status !== 'playing' || enemy.hp <= 0 || damage <= 0 || actor.hits.has(enemy.id) || actor.skip?.has(enemy.id) || actor.hits.size >= actor.targets) return false;
    actor.hits.add(enemy.id); actor.group?.add(enemy.id);
    ctx.damage(enemy, damage * actor.multiplier, { x: actor.view.x, y: actor.view.y, kind: 'module', moduleId: actor.view.moduleId }); return true;
  }
  private circle(ctx: ModuleCombatContext, actor: Actor, radius: number): void {
    for (const enemy of ctx.query(actor.view.x, actor.view.y, radius + 200)) if (dist(enemy, actor.view) <= radius + enemy.radius) this.deal(ctx, actor, enemy);
  }
  private beam(ctx: ModuleCombatContext, actor: Actor): void {
    const geometry = actor.view.geometry; if (geometry.shape !== 'beam') return;
    const { x, y } = actor.view, dx = Math.cos(geometry.angle), dy = Math.sin(geometry.angle);
    const endX = x + dx * geometry.length, endY = y + dy * geometry.length;
    const shape = beamGeometry(x, y, geometry.angle, geometry.length, geometry.width);
    const candidates = ctx.query((x + endX) / 2, (y + endY) / 2, geometry.length / 2 + geometry.width / 2 + 200)
      .filter(enemy => pointInBeam(enemy.x, enemy.y, enemy.radius, shape))
      .sort((a, b) => (a.x - b.x) * dx + (a.y - b.y) * dy || a.id - b.id);
    for (const enemy of candidates) this.deal(ctx, actor, enemy);
  }
  private shot(ctx: ModuleCombatContext, id: NewModuleId, point: Vec2, angle: number, speed: number, damage: number, range: number, width: number, targets = 1, skip?: Set<number>): Actor | null {
    const actor = this.add(ctx, id, 'blade', point, { shape: 'circle', radius: width / 2 }, range / speed, damage);
    if (actor) { actor.speed = speed; actor.heading = angle; actor.targets = targets; actor.skip = skip; }
    return actor;
  }

  onMainShot(ctx: ModuleCombatContext): void {
    if (ctx.state.status !== 'playing') return;
    const p = ctx.state.player;
    if (this.rank(ctx, 'pulseChamber')) {
      this.rounds++;
      if (this.rounds >= 5 && this.ready(ctx, 'pulseChamber')) {
        this.rounds = 0; const stats = this.trigger(ctx, 'pulseChamber'), focused = p.focus;
        for (let i = 0; i < stats.count; i++) {
          const pulse = this.add(ctx, 'pulseChamber', 'pulse', p, { shape: 'beam', angle: p.angle, length: stats.length, width: stats.width }, 0.2, stats.damage / stats.count, i * 0.14);
          if (!pulse) continue; pulse.targets = stats.targets; pulse.onStart = (c, a) => this.beam(c, a);
          if (focused && this.evolved(ctx, 'sonicBreak')) pulse.onEnd = (c, a) => {
            const geometry = a.view.geometry; if (geometry.shape !== 'beam') return;
            const end = { x: a.view.x + Math.cos(geometry.angle) * geometry.length, y: a.view.y + Math.sin(geometry.angle) * geometry.length };
            for (const side of [-1, 1]) this.shot(c, 'pulseChamber', end, geometry.angle + side * Math.PI / 2, 850, a.damage * 0.5, 220, 20, 2, new Set(a.hits));
          };
        }
      }
    }
    if (this.ready(ctx, 'crescentMagazine')) {
      const stats = this.trigger(ctx, 'crescentMagazine'), returns = this.evolved(ctx, 'lunarCut');
      for (let i = 0; i < stats.count; i++) {
        const side = stats.count === 1 ? -1 : i === 0 ? -1 : i === 1 ? 1 : 0;
        const actor = this.add(ctx, 'crescentMagazine', 'blade', p, { shape: 'circle', radius: stats.width / 2 }, stats.duration * (returns ? 2 : 1), stats.damage / stats.count);
        if (actor) { actor.targets = stats.targets; actor.curve = { origin: { x: p.x, y: p.y }, angle: p.angle + side * 35 * Math.PI / 180, speed: stats.speed, turn: -side * 70 * Math.PI / 180 / stats.duration, outbound: stats.duration, returns, returned: false }; }
      }
    }
  }

  onMainHit(ctx: ModuleCombatContext, enemy: Enemy): void {
    if (!this.ready(ctx, 'anchorStars') || ctx.state.status !== 'playing') return;
    const stats = this.trigger(ctx, 'anchorStars');
    const star = this.add(ctx, 'anchorStars', 'star', enemy, { shape: 'circle', radius: stats.radius }, 0.2, stats.damage, stats.warning);
    if (!star) return;
    star.onStart = (c, actor) => {
      this.circle(c, actor, stats.radius);
      for (let i = 0; i < stats.count; i++) this.shot(c, 'anchorStars', actor.view, i * TAU / stats.count, 700, stats.fragmentDamage, stats.range, 8, 1, new Set(actor.hits));
      if (this.evolved(c, 'starCarpet')) { const carpet = this.add(c, 'anchorStars', 'field', actor.view, { shape: 'circle', radius: 60 }, 1, actor.damage * 0.4); if (carpet) this.cap('field', 3, 'anchorStars'); }
    };
    this.cap('star', stats.capacity);
  }

  onBeam(ctx: ModuleCombatContext, geometry: Vec2 & { angle: number; length: number; width: number }): void {
    if (!this.ready(ctx, 'beamCircuit') || ctx.state.status !== 'playing') return;
    const stats = this.trigger(ctx, 'beamCircuit'), group = new Set<number>();
    for (let i = 0; i < stats.count; i++) {
      const offset = stats.count === 1 ? 0 : (i - (stats.count - 1) / 2) * (stats.count === 2 ? 48 : 32);
      const point = { x: geometry.x - Math.sin(geometry.angle) * offset, y: geometry.y + Math.cos(geometry.angle) * offset };
      const delay = stats.count === 1 ? 0.3 : stats.count === 2 ? 0.25 + i * 0.2 : 0.2 + i * 0.15;
      const beam = this.add(ctx, 'beamCircuit', 'echo', point, { shape: 'beam', angle: geometry.angle, length: stats.length, width: stats.width }, 0.18, stats.damage / stats.count, delay);
      if (beam) { beam.group = group; beam.onStart = (c, a) => this.beam(c, a); }
    }
    if (this.evolved(ctx, 'choralBeam')) for (const side of [-1, 1]) {
      const beam = this.add(ctx, 'beamCircuit', 'echo', geometry, { shape: 'beam', angle: geometry.angle + side * Math.PI / 15, length: 650, width: 18 }, 0.18, 6 * highRankFactor(this.rank(ctx, 'beamCircuit')), 0.52);
      if (beam) { beam.skip = group; beam.onStart = (c, a) => { this.beam(c, a); for (const id of a.hits) group.add(id); }; }
    }
  }

  onDashEnd(ctx: ModuleCombatContext, start: Vec2): void {
    if (ctx.state.status !== 'playing') return;
    const p = ctx.state.player;
    if (this.ready(ctx, 'decoyEcho')) {
      const stats = this.trigger(ctx, 'decoyEcho');
      for (let i = 0; i < stats.count; i++) {
        const point = i ? { x: (start.x + p.x) / 2, y: (start.y + p.y) / 2 } : start;
        const decoy = this.add(ctx, 'decoyEcho', 'decoy', point, { shape: 'circle', radius: 20 }, stats.duration);
        if (decoy) decoy.onEnd = (c, a) => {
          if (a.view.rank >= 3) {
            const ring = this.add(c, 'decoyEcho', 'counter', a.view, { shape: 'circle', radius: stats.radius }, 0.2);
            if (ring) for (const enemy of c.query(a.view.x, a.view.y, stats.radius + 200)) if (mobCanMove(enemy) && dist(enemy, a.view) <= stats.radius + enemy.radius) c.slow(enemy, 0.2, 0.6);
          }
          if (this.evolved(c, 'livingSpeaker')) for (const pickup of [...c.state.pickups]) if (dist(pickup, a.view) <= 80) c.collect(pickup);
        };
      }
      this.cap('decoy', stats.count);
    }
    if (this.ready(ctx, 'dashLane')) {
      const stats = this.trigger(ctx, 'dashLane'), points = [{ ...start }, { x: p.x, y: p.y }];
      const lane = this.add(ctx, 'dashLane', 'lane', start, { shape: 'path', points, width: stats.width, closed: false }, stats.duration);
      if (lane) { lane.slow = stats.slow; lane.hadLeft = false; lane.crossed = false; }
      this.cap('lane', stats.capacity);
    }
  }

  onDamage(ctx: ModuleCombatContext): void {
    if (this.rank(ctx, 'revive') >= 3 && (this.cooldowns.revive ?? 0) <= EPSILON) {
      const rank = this.rank(ctx, 'revive'); this.cooldowns.revive = highRankCooldown(6, rank);
      ctx.state.player.heat = Math.max(0, ctx.state.player.heat - (rank >= 5 ? 12 : rank === 4 ? 10 : 8));
    }
    if (!this.ready(ctx, 'counterPulse')) return;
    const stats = this.trigger(ctx, 'counterPulse'), p = ctx.state.player;
    for (let i = 0; i < stats.count; i++) {
      const radius = i === 0 ? this.rank(ctx, 'counterPulse') === 2 ? 150 : 130 : stats.radius;
      const ring = this.add(ctx, 'counterPulse', 'counter', p, { shape: 'circle', radius }, 0.2, 0, i * 0.25);
      if (!ring) continue;
      ring.onStart = (c, a) => {
        for (const enemy of c.query(a.view.x, a.view.y, radius + 200)) if (mobCanMove(enemy) && dist(enemy, a.view) <= radius + enemy.radius) this.push(c, enemy, a.view, i ? 40 : stats.push);
        if (i === 0 && this.evolved(c, 'counterCurtain')) {
          const bullets = c.state.bullets.filter(b => b.owner === 'enemy' && b.life > 0 && dist(b, a.view) <= 130).sort((a, b) => dist(a, p) - dist(b, p) || a.id - b.id);
          for (const bullet of bullets.slice(0, 3)) bullet.life = 0;
        }
        if (i === 1 && a.view.rank >= 5) { const field = this.add(c, 'counterPulse', 'field', a.view, { shape: 'circle', radius }, 0.75); if (field) field.slow = 0.25; }
      };
    }
  }
  private push(ctx: ModuleCombatContext, enemy: Enemy, origin: Vec2, amount: number): void {
    const dx = enemy.x - origin.x, dy = enemy.y - origin.y, length = Math.hypot(dx, dy);
    ctx.push(enemy, length > EPSILON ? dx / length * amount : amount, length > EPSILON ? dy / length * amount : 0);
  }

  moveSpeed(base: number, ctx: ModuleCombatContext): number {
    const p = ctx.state.player; if (p.focus || p.dashTime > 0) return base;
    let result = this.windTime > 0 ? Math.max(base, this.stats(ctx, 'slipstream').moveSpeed) : base;
    const lane = this.stats(ctx, 'dashLane');
    for (const actor of this.actors) if (actor.view.kind === 'lane' && this.insidePath(p, actor.view.geometry)) result = Math.max(result, base * (1 + lane.moveBonus));
    return Math.min(400, result);
  }
  decoyTarget(ctx: ModuleCombatContext, enemy: Enemy): Vec2 | null {
    if (enemy.role !== 'mob' || enemy.state !== 'chase') return null;
    const range = this.stats(ctx, 'decoyEcho').range;
    return this.actors.filter(actor => actor.view.kind === 'decoy' && dist(actor.view, enemy) <= range)
      .sort((a, b) => dist(a.view, enemy) - dist(b.view, enemy) || a.view.id - b.view.id)[0]?.view ?? null;
  }
  private insidePath(point: Vec2, geometry: ModuleGeometry, padding = 0): boolean {
    if (geometry.shape !== 'path') return false;
    for (let i = 1; i < geometry.points.length + Number(geometry.closed); i++) if (dist(point, closestPoint(point, geometry.points[i - 1], geometry.points[i % geometry.points.length])) <= geometry.width / 2 + padding) return true;
    return false;
  }

  step(dt: number, ctx: ModuleCombatContext, input: InputAction): void {
    if (ctx.state.status !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
    for (const id of Object.keys(this.cooldowns) as ModuleId[]) this.cooldowns[id] = Math.max(0, this.cooldowns[id]! - dt);
    for (const [id, until] of this.noteSlowUntil) if (until <= ctx.state.elapsed) this.noteSlowUntil.delete(id);
    this.updateWind(dt, ctx, input);
    this.updateDrones(ctx);
    // Snapshot traversal: a newborn attack begins next tick, never recursively in its parent's hit.
    const current = [...this.actors];
    for (const actor of current) {
      if (ctx.state.status !== 'playing') break;
      if (!this.actors.includes(actor)) continue;
      const view = actor.view; view.prevX = view.x; view.prevY = view.y; const before = view.age; view.age = Math.min(view.duration, view.age + dt);
      if (actor.emitterId !== undefined && !actor.started) {
        const drone = ctx.state.companions.find(item => item.id === actor.emitterId), target = ctx.state.enemies.find(item => item.id === actor.targetId && item.hp > 0);
        if (drone) { view.x = drone.x; view.y = drone.y; }
        if (target && view.geometry.shape === 'beam') view.geometry.angle = Math.atan2(target.y - view.y, target.x - view.x);
      }
      view.active = view.age + EPSILON >= view.warning;
      if (view.active && !actor.started) { actor.started = true; actor.onStart?.(ctx, actor); }
      if (view.active && ctx.state.status === 'playing') this.advanceActor(ctx, actor, Math.max(0, view.age - Math.max(before, view.warning)));
      if (view.age + EPSILON >= view.duration) { actor.onEnd?.(ctx, actor); this.remove(actor); }
    }
    this.updateNoteLinks(ctx);
    this.pullDecoyLoot(dt, ctx);
  }

  private updateWind(dt: number, ctx: ModuleCombatContext, input: InputAction): void {
    const p = ctx.state.player, moving = Math.hypot(input.moveX, input.moveY) > 0.1 && !p.focus && p.dashTime <= EPSILON;
    if (moving && this.rank(ctx, 'slipstream')) {
      const direction = Math.atan2(input.moveY, input.moveX);
      if (this.straightTime > 0 && Math.abs(angleDelta(this.straightAngle, direction)) > 35 * Math.PI / 180) this.straightTime = 0;
      if (this.straightTime <= 0) this.straightAngle = direction;
      this.straightTime += dt;
      if (this.straightTime >= 1 - EPSILON && this.ready(ctx, 'slipstream')) {
        const stats = this.trigger(ctx, 'slipstream'); this.windTime = stats.duration; this.windShots = 0; this.windShotTimer = 0; this.windHits.clear(); this.straightTime = 0;
        this.add(ctx, 'slipstream', 'wind', p, { shape: 'beam', angle: direction + Math.PI, length: 100, width: stats.width || 30 }, stats.duration);
      }
    } else this.straightTime = 0;
    const windActive = this.windTime > 0; this.windTime = Math.max(0, this.windTime - dt);
    if (!windActive || !moving) return;
    const stats = this.stats(ctx, 'slipstream');
    for (const actor of this.actors) if (actor.view.kind === 'wind') { actor.view.x = p.x; actor.view.y = p.y; }
    if (this.rank(ctx, 'slipstream') >= 3) for (const enemy of ctx.query(p.x, p.y, 100 + stats.width + 200)) {
      if (!mobCanMove(enemy) || this.windHits.has(enemy.id) || segmentCircleHit(p.prevX, p.prevY, p.x, p.y, enemy.x, enemy.y, enemy.radius + stats.width / 2) === null) continue;
      this.windHits.add(enemy.id); this.push(ctx, enemy, p, stats.push); if (this.rank(ctx, 'slipstream') >= 5) ctx.slow(enemy, 0.2, 0.7);
    }
    this.windShotTimer -= dt;
    if (this.evolved(ctx, 'headwindFlame') && this.windShots < 4 && this.windShotTimer <= EPSILON) {
      this.windShots++; this.windShotTimer += 0.2;
      const angle = Math.atan2(input.moveY, input.moveX) + Math.PI;
      for (const offset of [-0.25, 0, 0.25]) this.shot(ctx, 'slipstream', p, angle + offset, 650, 1.5 * highRankFactor(this.rank(ctx, 'slipstream')), 220, 8);
    }
  }

  private updateDrones(ctx: ModuleCombatContext): void {
    const drones = ctx.state.companions, available = drones.filter(drone => drone.targetId !== null && ctx.state.enemies.some(enemy => enemy.id === drone.targetId && enemy.hp > 0));
    if (!available.length) return;
    if (this.ready(ctx, 'droneSpotlight')) {
      const stats = this.trigger(ctx, 'droneSpotlight'), first = this.rotation++ % available.length, assigned = new Set<number>();
      for (let i = 0; i < Math.min(stats.count, available.length); i++) {
        const drone = available[(first + i) % available.length];
        const targets = ctx.query(drone.x, drone.y, stats.length + 200).filter(enemy => enemy.hp > 0 && dist(enemy, drone) <= stats.length + enemy.radius)
          .sort((a, b) => Number(assigned.has(a.id)) - Number(assigned.has(b.id)) || dist(a, drone) - dist(b, drone));
        const target = targets[0]; if (!target) continue; assigned.add(target.id);
        const beam = this.add(ctx, 'droneSpotlight', 'spotlight', drone, { shape: 'beam', angle: drone.angle, length: stats.length, width: stats.width }, stats.duration, stats.damage, stats.warning + i * 0.2);
        if (!beam) continue; beam.emitterId = drone.id; beam.targetId = target.id; beam.targets = this.evolved(ctx, 'stageSpotlight') ? 3 : 1;
        beam.onStart = (c, a) => {
          this.beam(c, a);
          if (this.evolved(c, 'stageSpotlight') && a.view.geometry.shape === 'beam') {
            const geo = a.view.geometry, end = { x: a.view.x + Math.cos(geo.angle) * geo.length, y: a.view.y + Math.sin(geo.angle) * geo.length };
            const flash = this.add(c, 'droneSpotlight', 'field', end, { shape: 'circle', radius: 45 }, 0.18, 4 * highRankFactor(a.view.rank));
            if (flash) { flash.skip = new Set(a.hits); flash.onStart = (next, actor) => this.circle(next, actor, 45); }
          }
        };
      }
    }
    if (this.ready(ctx, 'droneNotes')) {
      const stats = this.trigger(ctx, 'droneNotes'), drone = available[this.rotation++ % available.length];
      for (let i = 0; i < stats.count; i++) {
        const angle = drone.angle + i * TAU / stats.count;
        const point = stats.count === 1 ? drone : stats.count === 2 ? { x: drone.x - Math.sin(drone.angle) * (i ? 40 : -40), y: drone.y + Math.cos(drone.angle) * (i ? 40 : -40) }
          : { x: drone.x + Math.cos(angle) * 90 / Math.sqrt(3), y: drone.y + Math.sin(angle) * 90 / Math.sqrt(3) };
        this.add(ctx, 'droneNotes', 'note', point, { shape: 'circle', radius: stats.radius }, this.evolved(ctx, 'staticGarden') ? 4.5 : stats.duration, stats.damage / stats.count, stats.warning);
      }
      this.cap('note', stats.capacity);
    }
    if (this.ready(ctx, 'dronePlectrum')) {
      const stats = this.trigger(ctx, 'dronePlectrum'), drone = available[this.rotation++ % available.length];
      const actor = this.add(ctx, 'dronePlectrum', 'sweep', drone, { shape: 'arc', angle: drone.angle - stats.arc / 2, arc: 0, radius: stats.radius, width: stats.width }, stats.duration, stats.damage);
      if (actor) {
        actor.heading = drone.angle - stats.arc / 2; actor.previousAngle = actor.heading;
        actor.onEnd = (c, a) => {
          if (!this.evolved(c, 'stringEcho')) return;
          const enemy = c.query(a.view.x, a.view.y, 560).filter(enemy => enemy.hp > 0 && !a.hits.has(enemy.id) && dist(enemy, a.view) <= 360 + enemy.radius).sort((x, y) => dist(x, a.view) - dist(y, a.view) || x.id - y.id)[0];
          if (!enemy) return;
          const shot = this.shot(c, 'dronePlectrum', a.view, Math.atan2(enemy.y - a.view.y, enemy.x - a.view.x), 720, 4 * highRankFactor(a.view.rank), 360, 12, 1, new Set(a.hits));
          if (shot) { shot.homingId = enemy.id; shot.turnSpeed = 2; }
        };
      }
    }
    if (this.ready(ctx, 'droneConduit')) {
      const stats = this.trigger(ctx, 'droneConduit'), count = this.rank(ctx, 'droneConduit') >= 5 ? 3 : 2, selected = drones.slice(0, count);
      const points = selected.length === 1 ? [{ x: ctx.state.player.x, y: ctx.state.player.y }, { x: selected[0].x, y: selected[0].y }] : selected.map(drone => ({ x: drone.x, y: drone.y }));
      const actor = this.add(ctx, 'droneConduit', 'conduit', points[0], { shape: 'path', points, width: stats.width, closed: selected.length === 3 }, stats.duration, stats.damage);
      if (actor) {
        actor.companionIds = selected.map(drone => drone.id);
        actor.onEnd = (c, a) => {
          if (!this.evolved(c, 'triangleHall') || a.view.geometry.shape !== 'path') return;
          const pulse = this.add(c, 'droneConduit', 'conduit', a.view, { ...a.view.geometry, points: a.view.geometry.points.map(point => ({ ...point })) }, 0.12, 4 * highRankFactor(a.view.rank));
          if (pulse) pulse.onStart = (next, item) => this.hitPath(next, item);
        };
      }
    }
  }

  private advanceActor(ctx: ModuleCombatContext, actor: Actor, dt: number): void {
    const view = actor.view, geometry = view.geometry;
    if (view.kind === 'blade') {
      if (actor.curve) {
        const c = actor.curve, age = view.age - view.warning, returning = c.returns && age > c.outbound;
        if (returning && !c.returned) { c.returned = true; actor.hits.clear(); actor.damage *= 0.6; }
        const time = clamp(returning ? 2 * c.outbound - age : age, 0, c.outbound), angle = c.angle + c.turn * time;
        view.x = c.origin.x + (Math.abs(c.turn) < EPSILON ? Math.cos(c.angle) * c.speed * time : c.speed / c.turn * (Math.sin(angle) - Math.sin(c.angle)));
        view.y = c.origin.y + (Math.abs(c.turn) < EPSILON ? Math.sin(c.angle) * c.speed * time : c.speed / c.turn * (Math.cos(c.angle) - Math.cos(angle)));
      } else {
        if (actor.homingId !== undefined) {
          const target = ctx.state.enemies.find(enemy => enemy.id === actor.homingId && enemy.hp > 0);
          if (target) actor.heading = (actor.heading ?? 0) + clamp(angleDelta(actor.heading ?? 0, Math.atan2(target.y - view.y, target.x - view.x)), -(actor.turnSpeed ?? 2) * dt, (actor.turnSpeed ?? 2) * dt);
        }
        view.x += Math.cos(actor.heading ?? 0) * (actor.speed ?? 0) * dt; view.y += Math.sin(actor.heading ?? 0) * (actor.speed ?? 0) * dt;
      }
      const radius = geometry.shape === 'circle' ? geometry.radius : 4;
      const nearby = ctx.query((view.x + view.prevX) / 2, (view.y + view.prevY) / 2, dist(view, { x: view.prevX, y: view.prevY }) / 2 + radius + 200);
      const impacts = nearby.map(enemy => ({ enemy, time: segmentCircleHit(view.prevX - enemy.prevX, view.prevY - enemy.prevY, view.x - enemy.x, view.y - enemy.y, 0, 0, radius + enemy.radius) }))
        .filter(item => item.time !== null).sort((a, b) => a.time! - b.time! || a.enemy.id - b.enemy.id);
      for (const { enemy } of impacts) this.deal(ctx, actor, enemy);
    } else if (view.kind === 'note' && geometry.shape === 'circle') {
      if (ctx.query(view.x, view.y, geometry.radius + 200).some(enemy => enemy.hp > 0 && dist(enemy, view) <= geometry.radius + enemy.radius)) {
        this.circle(ctx, actor, geometry.radius);
        if (this.evolved(ctx, 'staticGarden')) for (const other of this.actors) {
          if (other === actor || other.view.kind !== 'note' || !other.view.active || dist(view, other.view) > 220) continue;
          const line = this.add(ctx, 'droneNotes', 'link', view, { shape: 'path', points: [{ x: view.x, y: view.y }, { x: other.view.x, y: other.view.y }], width: 12, closed: false }, 0.15, 4 * highRankFactor(view.rank));
          if (line) { line.hits = actor.hits; line.onStart = (c, a) => this.hitPath(c, a); }
        }
        this.add(ctx, 'droneNotes', 'counter', view, { shape: 'circle', radius: geometry.radius }, 0.18);
        this.remove(actor);
      }
    } else if (view.kind === 'sweep' && geometry.shape === 'arc') {
      const stats = newModuleStats('dronePlectrum', view.rank), angle = (actor.heading ?? 0) + stats.arc * view.age / view.duration;
      const old = actor.previousAngle ?? actor.heading ?? 0;
      geometry.angle = old; geometry.arc = Math.max(0, angle - old);
      for (const enemy of ctx.query(view.x, view.y, geometry.radius + geometry.width / 2 + 200)) {
        const distance = dist(enemy, view), direction = Math.atan2(enemy.y - view.y, enemy.x - view.x), padding = Math.asin(Math.min(1, (enemy.radius + geometry.width / 2) / Math.max(1, distance)));
        if (distance >= geometry.radius - enemy.radius - geometry.width / 2 && distance <= geometry.radius + enemy.radius + geometry.width / 2 && Math.abs(angleDelta(old + (angle - old) / 2, direction)) <= (angle - old) / 2 + padding) this.deal(ctx, actor, enemy);
      }
      actor.previousAngle = angle;
    } else if (view.kind === 'conduit' && geometry.shape === 'path') {
      if (actor.companionIds) {
        const drones = actor.companionIds.map(id => ctx.state.companions.find(drone => drone.id === id)).filter(drone => !!drone);
        geometry.points = drones.length === 1 ? [{ x: ctx.state.player.x, y: ctx.state.player.y }, { x: drones[0].x, y: drones[0].y }] : drones.map(drone => ({ x: drone.x, y: drone.y }));
      }
      this.hitPath(ctx, actor);
      if (this.evolved(ctx, 'triangleHall')) {
        const candidates = geometry.points.length === 3 ? geometry.points : [...geometry.points, { x: ctx.state.player.x, y: ctx.state.player.y }];
        const polygon = candidates.filter((point, index) => candidates.findIndex(other => other.x === point.x && other.y === point.y) === index);
        view.utilityGeometry = { shape: 'path', points: polygon, closed: polygon.length >= 3, width: 40 };
        for (const enemy of ctx.state.enemies) if (mobCanMove(enemy) && (polygon.length >= 3 && inPolygon(enemy, view.utilityGeometry.points) || this.insidePath(enemy, { ...geometry, width: view.utilityGeometry.width }, enemy.radius))) ctx.slow(enemy, 0.2, 0.15);
      }
    } else if (view.kind === 'field' && geometry.shape === 'circle') {
      if (actor.damage > 0) this.circle(ctx, actor, geometry.radius);
      if (actor.slow) for (const enemy of ctx.query(view.x, view.y, geometry.radius + 200)) if (mobCanMove(enemy) && dist(enemy, view) <= geometry.radius + enemy.radius) ctx.slow(enemy, actor.slow, 0.15);
    } else if (view.kind === 'lane' && geometry.shape === 'path') {
      for (const enemy of ctx.query((geometry.points[0].x + geometry.points[1].x) / 2, (geometry.points[0].y + geometry.points[1].y) / 2, dist(geometry.points[0], geometry.points[1]) / 2 + geometry.width + 200)) if (mobCanMove(enemy) && this.insidePath(enemy, geometry, enemy.radius)) ctx.slow(enemy, actor.slow ?? 0.15, 0.15);
      const inside = this.insidePath(ctx.state.player, geometry);
      if (!inside) actor.hadLeft = true;
      if (inside && actor.hadLeft && !actor.crossed && this.evolved(ctx, 'echoHighway')) {
        actor.crossed = true; const [start, end] = geometry.points;
        this.shot(ctx, 'dashLane', start, Math.atan2(end.y - start.y, end.x - start.x), 800, 8 * highRankFactor(view.rank), Math.max(1, dist(start, end)), 64, Infinity);
      }
    }
  }
  private hitPath(ctx: ModuleCombatContext, actor: Actor): void {
    const geometry = actor.view.geometry; if (geometry.shape !== 'path') return;
    for (let i = 1; i < geometry.points.length + Number(geometry.closed); i++) {
      const a = geometry.points[i - 1], b = geometry.points[i % geometry.points.length];
      for (const enemy of ctx.query((a.x + b.x) / 2, (a.y + b.y) / 2, dist(a, b) / 2 + geometry.width / 2 + 200)) if (segmentCircleHit(a.x, a.y, b.x, b.y, enemy.x, enemy.y, enemy.radius + geometry.width / 2) !== null) this.deal(ctx, actor, enemy);
    }
  }
  private updateNoteLinks(ctx: ModuleCombatContext): void {
    if (!this.evolved(ctx, 'staticGarden')) return;
    const notes = this.actors.filter(actor => actor.view.kind === 'note' && actor.view.active);
    // Passive link previews are rebuilt in a bounded set rather than accumulated every tick.
    for (const actor of [...this.actors]) if (actor.view.kind === 'link' && actor.damage === 0) this.remove(actor);
    for (let i = 0; i < notes.length; i++) for (let j = i + 1; j < notes.length; j++) {
      const a = notes[i].view, b = notes[j].view; if (dist(a, b) > 220) continue;
      this.add(ctx, 'droneNotes', 'link', a, { shape: 'path', points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }], width: 6, closed: false }, 1 / 60 + EPSILON);
      for (const enemy of ctx.query((a.x + b.x) / 2, (a.y + b.y) / 2, 310)) if (mobCanMove(enemy) && (this.noteSlowUntil.get(enemy.id) ?? 0) <= ctx.state.elapsed && segmentCircleHit(a.x, a.y, b.x, b.y, enemy.x, enemy.y, enemy.radius + 3) !== null) {
        this.noteSlowUntil.set(enemy.id, ctx.state.elapsed + 0.5); ctx.slow(enemy, 0.25, 0.8);
      }
    }
  }
  private pullDecoyLoot(dt: number, ctx: ModuleCombatContext): void {
    if (!this.evolved(ctx, 'livingSpeaker')) return;
    const decoys = this.actors.filter(actor => actor.view.kind === 'decoy'); if (!decoys.length) return;
    for (const pickup of ctx.state.pickups) {
      const nearest = decoys.reduce((best, item) => dist(pickup, item.view) < dist(pickup, best.view) ? item : best);
      if (dist(pickup, nearest.view) > 400) continue;
      const factor = 1 - Math.exp(-6.3 * dt); pickup.x += (nearest.view.x - pickup.x) * factor; pickup.y += (nearest.view.y - pickup.y) * factor;
    }
  }
  /** Useful for deterministic stress fixtures; no internal collections escape for mutation. */
  getStats(): { actors: number; visuals: number; cooldowns: number; rememberedTargets: number; modules: number } {
    return { actors: this.actors.length, visuals: this.visuals.length, cooldowns: Object.keys(this.cooldowns).length, rememberedTargets: this.noteSlowUntil.size + this.windHits.size, modules: NEW_MODULE_IDS.length };
  }
}
