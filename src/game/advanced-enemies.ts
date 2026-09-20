import { VIEW, WORLD } from './config';
import { beamGeometry, clamp } from './math';
import type { Season2AiContext } from './season2-ai';
import type { Enemy, EnemyType, Vec2 } from './types';

export const ADVANCED_TYPES: readonly EnemyType[] = ['stalker', 'prismWarden', 'conductor'];
export interface AdvancedCue extends Vec2 { angle: number; length: number; width: number; kind: 'dash' | 'fan' | 'beam'; unitId?: number }
export interface AdvancedBrain { phase: 'hunt' | 'windup' | 'rush' | 'followup' | 'recover'; timer: number; cycle: number; cues: AdvancedCue[]; parts: number[]; deployed: boolean; origin: Vec2 }
export const createAdvancedBrain = (): AdvancedBrain => ({ phase: 'hunt', timer: .8, cycle: 0, cues: [], parts: [], deployed: false, origin: { x: 0, y: 0 } });
export const ADVANCED_BALANCE = { warning: 1.1, hardWarning: .9, followup: .85, hardFollowup: .7, recovery: 1.2, hardRecovery: 1, dashSpeed: 540, hardDashSpeed: 600, dashLength: 330, beamWidth: 36, beamLength: 700, lensHp: 18 } as const;
const EPS = 1e-8;
const alive = (ctx: Season2AiContext, id: number) => ctx.enemies.find(e => e.id === id && e.hp > 0);
const visible = (point: Vec2, ctx: Season2AiContext) => {
  const x = ctx.arena ? ctx.arena.x + VIEW.width / 2 : clamp(ctx.player.x, VIEW.width / 2, WORLD.width - VIEW.width / 2);
  const y = ctx.arena ? ctx.arena.y + VIEW.height / 2 : clamp(ctx.player.y, VIEW.height / 2, WORLD.height - VIEW.height / 2);
  return Math.abs(point.x - x) < VIEW.width / 2 - 55 && Math.abs(point.y - y) < VIEW.height / 2 - 55;
};
function recover(e: Enemy, ctx: Season2AiContext) {
  const b = e.advanced!; b.phase = 'recover'; b.timer = ctx.difficulty === 'hard' ? 1 : 1.2; b.cues = [];
  e.state = 'recover'; e.vx = e.vy = 0; e.exposedUntil = ctx.elapsed + b.timer;
}
function warn(e: Enemy, phase: 'windup' | 'followup', time: number, ctx: Season2AiContext) {
  const b = e.advanced!; b.phase = phase; b.timer = time; e.state = phase === 'windup' ? 'charge' : 'aim'; e.timer = time; e.vx = e.vy = 0;
  ctx.emit({ type: 'attack', text: 'windup', enemyType: e.type, x: e.x, y: e.y, targetId: e.id });
}
function fan(e: Enemy, cue: AdvancedCue, ctx: Season2AiContext) {
  const count = ctx.difficulty === 'hard' ? 7 : 5;
  for (let i = 0; i < count; i++) ctx.shootAt(e, cue.x, cue.y, cue.angle + (i - (count - 1) / 2) * .16, 285, 7, 0xffa36f, { shape: 'kunai' });
}
export function advancedDeath(e: Enemy, ctx: Season2AiContext): void {
  if (e.advanced) for (const id of e.advanced.parts) { const part = alive(ctx, id); if (part) ctx.retirePart(part); }
  if (e.archetypeId === 'prismLens') {
    const parent = ctx.enemies.find(other => other.id === e.parentId && other.hp > 0);
    if (parent) { parent.exposedUntil = ctx.elapsed + 1.2; ctx.emit({ type: 'interrupt', text: '镜片击碎', x: e.x, y: e.y, targetId: e.id }); }
  }
}
/** Every multi-step commitment owns frozen geometry; no future player position is consulted on release. */
export function updateAdvancedEnemy(e: Enemy, dt: number, ctx: Season2AiContext): void {
  if (!Number.isFinite(dt) || dt <= 0 || e.hp <= 0 || ctx.player.hp <= 0) return;
  if (e.archetypeId === 'prismLens') {
    e.vx = e.vy = 0;
    if (!ctx.enemies.some(parent => parent.id === e.parentId && parent.hp > 0)) ctx.retirePart(e);
    return;
  }
  const b = e.advanced!; if (!b || e.hp <= 0 || ctx.player.hp <= 0) return;
  // Weakpoint cancellation and encounter suppression cannot resurrect an old commitment.
  if (e.state === 'recover' && !['recover', 'hunt'].includes(b.phase)) recover(e, ctx);
  b.timer = Math.max(0, b.timer - dt); e.timer = b.timer;
  const hard = ctx.difficulty === 'hard', warning = hard ? .9 : 1.1;
  if (b.phase === 'recover') { e.vx = e.vy = 0; if (b.timer <= EPS) { b.phase = 'hunt'; b.timer = 1.1; e.state = 'chase'; } return; }
  if (b.phase === 'rush') {
    if (b.timer <= EPS) {
      e.vx = e.vy = 0;
      b.cues = [{ x: e.x, y: e.y, angle: Math.atan2(b.origin.y - e.y, b.origin.x - e.x), length: 800, width: .8, kind: 'fan' }];
      warn(e, 'followup', hard ? .7 : .85, ctx);
    }
    return;
  }
  if (b.phase === 'followup') {
    if (b.timer <= EPS) {
      const cue = b.cues.shift(); if (cue && (!cue.unitId || alive(ctx, cue.unitId))) fan(e, cue, ctx);
      if (b.cues.length) { b.timer = hard ? .22 : .3; e.timer = b.timer; } else recover(e, ctx);
    }
    return;
  }
  if (b.phase === 'windup') {
    if (b.timer > EPS) return;
    if (e.type === 'stalker') {
      const cue = b.cues[0], speed = hard ? 600 : 540;
      e.angle = cue.angle; e.vx = Math.cos(cue.angle) * speed; e.vy = Math.sin(cue.angle) * speed;
      b.phase = 'rush'; b.timer = cue.length / speed; e.state = 'dash'; return;
    }
    if (e.type === 'conductor') { b.phase = 'followup'; b.timer = 0; e.state = 'volley'; return; }
    for (const cue of b.cues) {
      const unit = cue.unitId ? alive(ctx, cue.unitId) : e;
      if (!unit) continue;
      if (cue.kind === 'beam') ctx.spawnHazard({ ...cue, radius: cue.width / 2, sourceId: unit.id, kind: 'beam', warning: 0, warningDuration: warning, active: true, duration: .32, life: .32 });
      else fan(e, cue, ctx);
    }
    recover(e, ctx); return;
  }
  const dx = ctx.player.x - e.x, dy = ctx.player.y - e.y, distance = Math.max(1, Math.hypot(dx, dy));
  const desired = e.type === 'stalker' ? 300 : 440;
  const side = b.cycle % 2 ? -1 : 1, radial = distance > desired + 60 ? 1 : distance < desired - 80 ? -.7 : 0;
  e.vx = (dx / distance * radial - dy / distance * side * .45) * e.speed;
  e.vy = (dy / distance * radial + dx / distance * side * .45) * e.speed;
  e.angle = Math.atan2(dy, dx);
  if (b.timer > EPS || !visible(e, ctx) || distance > 720) return;
  let cues: AdvancedCue[];
  if (e.type === 'stalker') {
    const end = { x: clamp(ctx.player.x, e.radius, WORLD.width - e.radius), y: clamp(ctx.player.y, e.radius, WORLD.height - e.radius) };
    cues = [{ x: e.x, y: e.y, angle: Math.atan2(end.y - e.y, end.x - e.x), length: Math.min(330, distance + 65), width: e.radius * 2, kind: 'dash' }];
  } else if (e.type === 'prismWarden') {
    if (!b.deployed) {
      b.deployed = true;
      for (const sign of [-1, 1]) {
        const x = clamp(e.x - Math.sin(e.angle) * sign * 110, 28, WORLD.width - 28), y = clamp(e.y + Math.cos(e.angle) * sign * 110, 28, WORLD.height - 28);
        if (!visible({ x, y }, ctx)) continue;
        const part = ctx.spawnPart(e, 'arm', x, y);
        if (part) { part.hp = part.maxHp = Math.ceil(18 * (hard ? 1.35 : 1)); part.radius = 20; part.archetypeId = 'prismLens'; part.season2 = undefined; b.parts.push(part.id); }
      }
    }
    cues = b.parts.map(id => alive(ctx, id)).filter((part): part is Enemy => !!part && visible(part, ctx)).map(part => ({ x: part.x, y: part.y, angle: e.angle, length: 700, width: 36, kind: 'beam' as const, unitId: part.id }));
    // After both lenses break, its readable fan fallback keeps the body useful without regrowing parts.
    if (!cues.length) cues = [{ x: e.x, y: e.y, angle: e.angle, length: 800, width: .8, kind: 'fan' }];
  } else {
    const allies = ctx.enemies.filter(unit => unit.hp > 0 && unit.role === 'mob' && !ADVANCED_TYPES.includes(unit.type) && Math.hypot(unit.x - e.x, unit.y - e.y) < 380 && visible(unit, ctx)).sort((a, c) => a.id - c.id).slice(0, 2);
    cues = [e, ...allies].map(unit => ({ x: unit.x, y: unit.y, angle: Math.atan2(ctx.player.y - unit.y, ctx.player.x - unit.x), length: 800, width: .8, kind: 'fan' as const, unitId: unit.id }));
  }
  const beams = cues.filter(c => c.kind === 'beam').length, bullets = e.type === 'stalker' ? hard ? 7 : 5 : (cues.length - beams) * (hard ? 7 : 5);
  const intent = { sourceId: e.id, x: e.x, y: e.y, angle: e.angle, kind: 'sample' as const, points: cues.map(c => ({ x: c.x + Math.cos(c.angle) * Math.min(300, c.length), y: c.y + Math.sin(c.angle) * Math.min(300, c.length) })), width: 120, range: 0, warning, duration: 1.2 };
  if (!ctx.canCommit('sample', intent) || ctx.reserveAttack && !ctx.reserveAttack(e.id, bullets, beams, warning + 2.5)) { b.timer = .2; return; }
  b.cues = cues; b.origin = { x: ctx.player.x, y: ctx.player.y }; b.cycle++;
  warn(e, 'windup', warning, ctx);
}

export function advancedTelegraphs(e: Enemy): readonly AdvancedCue[] {
  return e.advanced && ['windup', 'followup'].includes(e.advanced.phase) ? e.advanced.cues : [];
}
export const advancedGeometry = (cue: AdvancedCue) => beamGeometry(cue.x, cue.y, cue.angle, cue.length, cue.width);
