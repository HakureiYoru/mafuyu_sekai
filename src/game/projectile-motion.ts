import type { Bullet } from './types';

/** Only the fixed simulation clock changes trajectories. Turns stop after a finite, predeclared interval. */
export function advanceProjectileMotion(bullet: Bullet, dt: number): void {
  if (bullet.owner !== 'enemy' || !Number.isFinite(dt) || dt <= 0) return;
  const age = bullet.motionAge ?? 0, end = age + dt;
  bullet.motionAge = end;
  const delay = bullet.turnDelay ?? 0, duration = bullet.turnDuration ?? 0;
  const turnTime = Math.max(0, Math.min(end, delay + duration) - Math.max(age, delay));
  const turn = (bullet.turnRate ?? 0) * turnTime;
  const acceleration = bullet.acceleration ?? 0;
  if (turn === 0 && acceleration === 0) return;
  const angle = Math.atan2(bullet.vy, bullet.vx) + turn;
  bullet.speed = Math.max(0, Math.min(bullet.maxSpeed ?? bullet.speed, bullet.speed + acceleration * dt));
  bullet.vx = Math.cos(angle) * bullet.speed; bullet.vy = Math.sin(angle) * bullet.speed;
}
