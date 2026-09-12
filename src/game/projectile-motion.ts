import type { Bullet } from './types';

/** Only the fixed simulation clock changes trajectories. Turns stop after a finite, predeclared interval. */
export function advanceProjectileMotion(bullet: Bullet, dt: number): { dx: number; dy: number } | undefined {
  if (bullet.owner !== 'enemy' || !Number.isFinite(dt) || dt <= 0) return;
  const age = bullet.motionAge ?? 0, end = age + dt;
  bullet.motionAge = end;
  if (bullet.program?.length) {
    let remaining = dt, dx = 0, dy = 0;
    bullet.programIndex ??= 0; bullet.programAge ??= 0;
    bullet.programAngle ??= Math.atan2(bullet.vy, bullet.vx);
    bullet.programSpeed ??= bullet.speed;
    // Programs are immutable shared data; only the cursor belongs to a pooled bullet.
    for (let guard = 0; remaining > 1e-10 && guard < 32; guard++) {
      const phase = bullet.program[bullet.programIndex];
      if (!phase) { dx += bullet.vx * remaining; dy += bullet.vy * remaining; break; }
      if (!bullet.programEntered) {
        if (phase.reverse) { bullet.programAngle += Math.PI; bullet.speed = bullet.programSpeed; }
        if (phase.speed !== undefined) bullet.speed = Math.max(0, phase.speed);
        if (bullet.speed > 0) bullet.programSpeed = bullet.speed;
        bullet.programEntered = true;
      }
      const duration = Math.max(0, phase.duration), slice = Math.min(remaining, Math.max(0, duration - bullet.programAge));
      bullet.programAngle += (phase.turnRate ?? 0) * slice;
      bullet.vx = Math.cos(bullet.programAngle) * bullet.speed; bullet.vy = Math.sin(bullet.programAngle) * bullet.speed;
      dx += bullet.vx * slice; dy += bullet.vy * slice;
      bullet.programAge += slice; remaining -= slice;
      if (bullet.programAge >= duration - 1e-10) { bullet.programIndex++; bullet.programAge = 0; bullet.programEntered = false; }
      else break;
    }
    return { dx, dy };
  }
  const delay = bullet.turnDelay ?? 0, duration = bullet.turnDuration ?? 0;
  const turnTime = Math.max(0, Math.min(end, delay + duration) - Math.max(age, delay));
  const turn = (bullet.turnRate ?? 0) * turnTime;
  const acceleration = bullet.acceleration ?? 0;
  if (turn === 0 && acceleration === 0) return;
  const angle = Math.atan2(bullet.vy, bullet.vx) + turn;
  bullet.speed = Math.max(0, Math.min(bullet.maxSpeed ?? bullet.speed, bullet.speed + acceleration * dt));
  bullet.vx = Math.cos(angle) * bullet.speed; bullet.vy = Math.sin(angle) * bullet.speed;
}
