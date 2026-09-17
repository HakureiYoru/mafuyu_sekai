import { WORLD } from './config';
import { clamp } from './math';
import type { ArenaRect, CombatEvent, Enemy, Player } from './types';

export interface AttackBudgetContext {
  /** Reserve the entire committed release before drawing a warning. Parts charge their parent's budget. */
  reserveAttack?(sourceId: number, bullets: number, hazards: number, duration: number): boolean;
}
export interface BossActionState {
  id: number; kind: 'dash' | 'sidestep' | 'retrace'; phase: 'warning' | 'moving' | 'recover';
  startX: number; startY: number; targetX: number; targetY: number; angle: number;
  warning: number; duration: number; recovery: number; remaining: number; expose: boolean;
}
export interface BossActionSpec {
  kind: BossActionState['kind']; x: number; y: number; warning: number; duration: number; recovery: number; expose?: boolean;
}
export interface BossActionContext extends AttackBudgetContext {
  elapsed: number; player: Player; arena?: ArenaRect | null; emit(event: CombatEvent): void;
}
export interface BossActionTelegraph {
  kind: 'dash' | 'sidestep' | 'retrace'; x: number; y: number; endX: number; endY: number;
  angle: number; width: number; warning: number; remaining: number; phase: BossActionState['phase'];
}

/** Movement geometry is locked before the tell, shared by the HUD and the swept body collider. */
export function beginBossAction(enemy: Enemy, spec: BossActionSpec, ctx: BossActionContext): boolean {
  if (enemy.hp <= 0 || enemy.action || spec.warning <= 0 || spec.duration <= 0) return false;
  const arena = ctx.arena ?? { x: 0, y: 0, ...WORLD }, margin = enemy.radius + 12;
  const x = clamp(spec.x, arena.x + margin, arena.x + arena.width - margin);
  const y = clamp(spec.y, arena.y + margin, arena.y + arena.height - margin);
  if (Math.hypot(x - enemy.x, y - enemy.y) < 24) return false;
  if (ctx.reserveAttack && !ctx.reserveAttack(enemy.id, 0, 0, spec.warning + spec.duration + spec.recovery)) return false;
  enemy.action = { id: enemy.attackIndex++, kind: spec.kind, phase: 'warning', startX: enemy.x, startY: enemy.y,
    targetX: x, targetY: y, angle: Math.atan2(y - enemy.y, x - enemy.x), warning: spec.warning,
    duration: spec.duration, recovery: spec.recovery, remaining: spec.warning, expose: spec.expose !== false };
  enemy.state = 'charge'; enemy.timer = spec.warning; enemy.vx = enemy.vy = 0;
  ctx.emit({ type: 'attack', text: `action-${spec.kind}`, x: enemy.x, y: enemy.y, targetId: enemy.id, enemyType: enemy.type, angle: enemy.action.angle });
  return true;
}

/** Caller alone integrates positions. Returns true for every tick owned by the movement action. */
export function updateBossAction(enemy: Enemy, dt: number, ctx: BossActionContext): boolean {
  const action = enemy.action;
  if (!action || enemy.hp <= 0 || !Number.isFinite(dt) || dt <= 0) return false;
  enemy.vx = enemy.vy = 0; enemy.angle = action.angle;
  if (action.phase === 'warning') {
    enemy.state = 'charge'; action.remaining = Math.max(0, action.remaining - dt); enemy.timer = action.remaining;
    if (action.remaining <= 1e-8) { action.phase = 'moving'; action.remaining = action.duration; }
  } else if (action.phase === 'moving') {
    enemy.state = 'dash';
    const fraction = Math.min(dt, action.remaining) / Math.max(1e-8, action.remaining) / dt;
    enemy.vx = (action.targetX - enemy.x) * fraction; enemy.vy = (action.targetY - enemy.y) * fraction;
    action.remaining = Math.max(0, action.remaining - dt); enemy.timer = action.remaining;
    if (action.remaining <= 1e-8) {
      action.phase = 'recover'; action.remaining = action.recovery;
      if (action.expose) enemy.exposedUntil = Math.max(enemy.exposedUntil ?? 0, ctx.elapsed + action.recovery);
      ctx.emit({ type: 'attack', text: 'core-exposed', x: action.targetX, y: action.targetY, targetId: enemy.id, enemyType: enemy.type, amount: action.recovery });
    }
  } else {
    enemy.state = 'recover'; action.remaining = Math.max(0, action.remaining - dt); enemy.timer = action.remaining;
    if (action.remaining <= 1e-8) { enemy.action = undefined; enemy.state = 'chase'; enemy.timer = 0; }
  }
  return true;
}

export function bossActionTelegraph(enemy: Enemy): BossActionTelegraph | null {
  const a = enemy.action;
  if (!a || enemy.hp <= 0) return null;
  return { kind: a.kind, x: a.startX, y: a.startY, endX: a.targetX, endY: a.targetY, angle: a.angle,
    width: enemy.radius * 2, warning: a.warning, remaining: a.remaining, phase: a.phase };
}

export function bossActionTarget(enemy: Enemy, player: Player, distance: number, offset = 0): { x: number; y: number } {
  const angle = Math.atan2(player.y - enemy.y, player.x - enemy.x) + offset;
  return { x: enemy.x + Math.cos(angle) * distance, y: enemy.y + Math.sin(angle) * distance };
}
