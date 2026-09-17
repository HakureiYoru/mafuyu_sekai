import { describe, expect, it } from 'vitest';
import { BALANCE } from './config';
import { clamp } from './math';
import { advanceProjectileMotion } from './projectile-motion';
import { GameSimulation } from './simulation';
import { advanceSpellCard, SPELL_CARDS, spellTelegraphs } from './spellcards';
import { bossActionTelegraph } from './boss-actions';
import type { Bullet, Difficulty, Enemy, InputAction, SeasonId } from './types';

const ARENA = { x: 1200, y: 1550, width: 1600, height: 900 };
const HORIZON = 1.2, SAMPLES = 8, INTERVAL = HORIZON / SAMPLES;
const DIRECTIONS = Array.from({ length: 24 }, (_, i) => ({ x: Math.cos(i * Math.PI / 12), y: Math.sin(i * Math.PI / 12) }));
const STARTS = [[2000, 2220], [1218, 1568], [2782, 1568], [1218, 2432], [2782, 2432], [2000, 1976]] as const;
interface Forecast { radius: number; points: { x: number; y: number }[] }
function minimumDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, t = clamp(-(ax * dx + ay * dy) / Math.max(1e-9, dx * dx + dy * dy), 0, 1);
  return Math.hypot(ax + t * dx, ay + t * dy);
}
function crossesBeam(ax: number, ay: number, bx: number, by: number, x: number, y: number, angle: number, length: number, width: number): boolean {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const from = [(ax - x) * cos + (ay - y) * sin, -(ax - x) * sin + (ay - y) * cos];
  const to = [(bx - x) * cos + (by - y) * sin, -(bx - x) * sin + (by - y) * cos];
  let enter = 0, leave = 1;
  const limits = [[-10, length + 10], [-width / 2 - 10, width / 2 + 10]];
  for (let axis = 0; axis < 2; axis++) {
    const delta = to[axis] - from[axis];
    if (Math.abs(delta) < 1e-8) { if (from[axis] < limits[axis][0] || from[axis] > limits[axis][1]) return false; }
    else {
      let low = (limits[axis][0] - from[axis]) / delta, high = (limits[axis][1] - from[axis]) / delta;
      if (low > high) [low, high] = [high, low];
      enter = Math.max(enter, low); leave = Math.min(leave, high);
      if (enter > leave) return false;
    }
  }
  return true;
}
function projectileForecast(bullet: Bullet): Forecast {
  const copy = { ...bullet }, points = [{ x: copy.x, y: copy.y }];
  for (let i = 0; i < SAMPLES; i++) {
    for (let remaining = INTERVAL; remaining > 1e-8;) {
      const dt = Math.min(1 / 60, remaining), delta = advanceProjectileMotion(copy, dt);
      copy.x += delta?.dx ?? copy.vx * dt; copy.y += delta?.dy ?? copy.vy * dt; remaining -= dt;
    }
    points.push({ x: copy.x, y: copy.y });
  }
  return { radius: bullet.radius, points };
}
function start(season: SeasonId, difficulty: Difficulty, card: number, placement: readonly [number, number]) {
  const sim = new GameSimulation(4004, difficulty);
  sim.reset('story', 4004, difficulty, { difficulty });
  // Baseline movement tests deliberately have no optional defensive module or auto-firing companion.
  sim.state.build.modules = [];
  const boss = sim.spawnEnemy('boss', 2000, 1780, season === 's1' ? 's1:mafuyu' : 's2:final')!;
  for (let i = 0; i < card; i++) advanceSpellCard(boss, difficulty);
  const p = sim.state.player;
  p.x = p.prevX = placement[0]; p.y = p.prevY = placement[1]; p.invincible = 0;
  return { sim, boss };
}

/** Deterministic input-only route finder; uses visible committed attacks, never future AI decisions. */
function steering(sim: GameSimulation, boss: Enemy, previous: InputAction, senseDelay = 0.2, orbitSide = 1): InputAction {
  const w = sim.state, p = w.player;
  if (p.dashTime > 0) return { ...previous, dash: false };
  const bullets = w.bullets.filter(b => b.owner === 'enemy' && Math.hypot(b.x - p.x, b.y - p.y) < 660).map(projectileForecast);
  // Pending emissions become readable after a real 200 ms reaction delay. Forecasts include the delay until release.
  for (const cue of boss.spell!.cues) {
    if (cue.warning - cue.remaining < senseDelay || cue.remaining > HORIZON) continue;
    for (const shot of cue.shots) {
      if (Math.hypot(shot.x - p.x, shot.y - p.y) > 660) continue;
      const speed = shot.speed * (w.difficulty === 'hard' ? 1.28 : 1);
      bullets.push({ radius: shot.radius, points: Array.from({ length: SAMPLES + 1 }, (_, i) => {
        const age = i * INTERVAL - cue.remaining;
        return age < 0 ? { x: 1e7, y: 1e7 } : { x: shot.x + Math.cos(shot.angle) * speed * age, y: shot.y + Math.sin(shot.angle) * speed * age };
      }) });
    }
  }
  const hazards = w.hazards.filter(h => h.active || h.warningDuration - h.warning >= senseDelay);
  const visibleAction = bossActionTelegraph(boss);
  const action = visibleAction && (visibleAction.phase !== 'warning' || visibleAction.warning - visibleAction.remaining >= senseDelay)
    ? visibleAction : null;
  // The route planner learns the swept body path from the same telegraph the player sees, after 200 ms.
  // It does not read the next combo, future aim or not-yet-announced destination.
  const bodyPoints = Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const time = i * INTERVAL;
    if (action && boss.action) {
      const delay = action.phase === 'warning' ? action.remaining : 0;
      const duration = action.phase === 'warning' ? boss.action.duration : action.phase === 'moving' ? action.remaining : 0;
      const fraction = action.phase === 'recover' ? 0 : clamp((time - delay) / Math.max(1e-8, duration), 0, 1);
      return { x: boss.x + (action.endX - boss.x) * fraction, y: boss.y + (action.endY - boss.y) * fraction };
    }
    return { x: clamp(boss.x + boss.vx * time, ARENA.x + boss.radius, ARENA.x + ARENA.width - boss.radius),
      y: clamp(boss.y + boss.vy * time, ARENA.y + boss.radius, ARENA.y + ARENA.height - boss.radius) };
  });
  const goalAngle = Math.atan2(p.y - boss.y, p.x - boss.x) + orbitSide * 0.35;
  let goalX = clamp(boss.x + Math.cos(goalAngle) * 520, ARENA.x + 65, ARENA.x + ARENA.width - 65);
  let goalY = clamp(boss.y + Math.sin(goalAngle) * 520, ARENA.y + 65, ARENA.y + ARENA.height - 65);
  let gateTime = 2.5;
  for (const cue of boss.spell!.cues) {
    if (cue.gapCenter === undefined || cue.warning - cue.remaining < senseDelay) continue;
    const horizontal = cue.endY !== cue.y, speed = cue.shots[0].speed * (w.difficulty === 'hard' ? 1.28 : 1);
    const distance = horizontal ? (p.x - cue.x) * Math.cos(cue.angle) : (p.y - cue.y) * Math.sin(cue.angle);
    const arrival = cue.remaining + distance / speed;
    if (arrival < 0 || arrival > gateTime) continue;
    gateTime = arrival; goalX = horizontal ? p.x : cue.x + cue.gapCenter; goalY = horizontal ? cue.y + cue.gapCenter : p.y;
  }
  const rows = new Map<string, Bullet[]>();
  for (const bullet of w.bullets) {
    if (bullet.owner !== 'enemy' || bullet.radius !== 7) continue;
    const horizontal = Math.abs(bullet.vy) < 1e-7, vertical = Math.abs(bullet.vx) < 1e-7;
    if (!horizontal && !vertical) continue;
    const key = `${horizontal ? 'h' : 'v'}:${(horizontal ? bullet.x : bullet.y).toFixed(2)}`;
    const row = rows.get(key); if (row) row.push(bullet); else rows.set(key, [bullet]);
  }
  for (const row of rows.values()) {
    if (row.length < 6) continue;
    const horizontal = Math.abs(row[0].vy) < 1e-7;
    const arrival = horizontal ? (p.x - row[0].x) / row[0].vx : (p.y - row[0].y) / row[0].vy;
    if (arrival < 0 || arrival > gateTime) continue;
    const coordinates = row.map(b => horizontal ? b.y : b.x).sort((a, b) => a - b);
    if (!coordinates.some((coordinate, i) => i > 0 && coordinate - coordinates[i - 1] > 1 && coordinate - coordinates[i - 1] < 30)) continue;
    let size = 50, center: number | undefined;
    for (let i = 1; i < coordinates.length; i++) if (coordinates[i] - coordinates[i - 1] > size) {
      size = coordinates[i] - coordinates[i - 1]; center = (coordinates[i] + coordinates[i - 1]) / 2;
    }
    if (center === undefined) continue;
    gateTime = arrival; goalX = horizontal ? p.x : center; goalY = horizontal ? center : p.y;
  }
  const score = (x: number, y: number, dash: boolean, focus = false): number => {
    const points = [{ x: p.x, y: p.y }];
    let cost = dash ? 600 : focus ? 2 : 0;
    for (let i = 1; i <= SAMPLES; i++) {
      const speed = focus ? BALANCE.player.focusSpeed : BALANCE.player.speed;
      const time = i * INTERVAL, distance = dash ? 1080 * Math.min(0.18, time) + speed * Math.max(0, time - 0.18) : speed * time;
      const rawX = p.x + x * distance, rawY = p.y + y * distance;
      const point = { x: clamp(rawX, ARENA.x + 18, ARENA.x + ARENA.width - 18), y: clamp(rawY, ARENA.y + 18, ARENA.y + ARENA.height - 18) };
      points.push(point);
      cost += (Math.abs(rawX - point.x) + Math.abs(rawY - point.y)) * 5;
      if (dash && time <= 0.18 + 1e-8) continue;
      const bodyDistance = minimumDistance(points[i - 1].x - bodyPoints[i - 1].x, points[i - 1].y - bodyPoints[i - 1].y,
        point.x - bodyPoints[i].x, point.y - bodyPoints[i].y) - boss.radius - 18;
      cost += bodyDistance < 8 ? 1e7 : Math.exp(-bodyDistance / 35) * 150;
      for (const hazard of hazards) {
        const low = Math.max((i - 1) * INTERVAL, hazard.active ? 0 : hazard.warning), high = Math.min(time, hazard.warning + hazard.life);
        if (low > high) continue;
        const before = points[i - 1], from = (low - (i - 1) * INTERVAL) / INTERVAL, to = (high - (i - 1) * INTERVAL) / INTERVAL;
        const ax = before.x + (point.x - before.x) * from, ay = before.y + (point.y - before.y) * from;
        const bx = before.x + (point.x - before.x) * to, by = before.y + (point.y - before.y) * to;
        const hit = hazard.kind === 'beam'
          ? crossesBeam(ax, ay, bx, by, hazard.x, hazard.y, hazard.angle ?? 0, hazard.length ?? 0, hazard.width ?? 0)
          : minimumDistance(ax - hazard.x, ay - hazard.y, bx - hazard.x, by - hazard.y) < hazard.radius + 13;
        if (hit) cost += 1e7 * (2 - time);
      }
    }
    for (const bullet of bullets) for (let i = 1; i <= SAMPLES; i++) {
      if (dash && i === 1) continue;
      if (bullet.points[i - 1].x === 1e7 || bullet.points[i].x === 1e7) continue;
      const clearance = minimumDistance(bullet.points[i - 1].x - points[i - 1].x, bullet.points[i - 1].y - points[i - 1].y,
        bullet.points[i].x - points[i].x, bullet.points[i].y - points[i].y) - bullet.radius - 7;
      cost += clearance < 2 ? 1e7 * (2 - i * INTERVAL) : Math.exp(-clearance / 14) * 80;
    }
    const last = points.at(-1)!;
    cost += Math.hypot(last.x - goalX, last.y - goalY) * (gateTime < 2.5 ? 2 : 0.1);
    cost += (1 - (x * previous.moveX + y * previous.moveY)) * 2;
    return cost;
  };
  let best = { x: 0, y: 0, dash: false, focus: false, value: score(0, 0, false) };
  for (const direction of DIRECTIONS) for (const focus of [false, true]) {
    const value = score(direction.x, direction.y, false, focus);
    if (value < best.value) best = { ...direction, dash: false, focus, value };
  }
  if (best.value > 1e5 && p.dashCooldown <= 0) for (const direction of DIRECTIONS) {
    const value = score(direction.x, direction.y, true);
    if (value < best.value) best = { ...direction, dash: true, focus: false, value };
  }
  return { moveX: best.x, moveY: best.y, dash: best.dash, bomb: false, shoot: false, focus: best.focus, aimX: boss.x, aimY: boss.y };
}

function runRoute(season: SeasonId, difficulty: Difficulty, card: number, placement: readonly [number, number], moving: boolean, seconds = 24, orbitSide = 1) {
  const { sim, boss } = start(season, difficulty, card, placement), p = sim.state.player;
  let input: InputAction = { moveX: 0, moveY: 0, dash: false, bomb: false, shoot: false, aimX: boss.x, aimY: boss.y };
  let damage = 0, dashes = 0, shots = 0, distance = 0;
  const damageLog: { time: number; source?: string; x: number; y: number; action?: string }[] = [];
  const cues = new Set<number>(), hazardIds = new Set<number>();
  for (let tick = 0; tick < seconds * 60 && sim.state.status === 'playing'; tick++) {
    if (moving && tick % 6 === 0) input = steering(sim, boss, input, 0.2, orbitSide);
    const x = p.x, y = p.y, events = sim.step(input);
    damage += events.filter(event => event.type === 'damage').length;
    for (const event of events) if (event.type === 'damage') damageLog.push({ time: sim.state.elapsed, source: event.damageSource, x: p.x, y: p.y, action: boss.action?.phase });
    dashes += events.filter(event => event.type === 'dash').length;
    shots += events.filter(event => event.type === 'enemyShot').length;
    distance += Math.hypot(p.x - x, p.y - y);
    for (const cue of spellTelegraphs(boss)) cues.add(cue.id);
    for (const hazard of sim.state.hazards) hazardIds.add(hazard.id);
  }
  return { damage, dashes, shots, distance, cues: cues.size, hazards: hazardIds.size, elapsed: sim.state.elapsed,
    hp: p.hp, invincible: p.invincible, bombs: p.bombs, index: boss.spell!.shotIndex, damageLog, orbitSide };
}

/** Blind controls read only elapsed time / body position, never bullets, hazards or telegraphs. */
function runBlindControl(season: SeasonId, difficulty: Difficulty, card: number, strategy: 'circle' | 'old-lane') {
  const { sim, boss } = start(season, difficulty, card, [2000, 2320]), p = sim.state.player;
  let damage = 0, distance = 0;
  for (let tick = 0; tick < 24 * 60 && sim.state.status === 'playing'; tick++) {
    const angle = Math.PI / 2 + sim.state.elapsed * BALANCE.player.speed / 320;
    // The former broadly safe direction was below the emitter; this controller only follows that bearing.
    const target = strategy === 'circle' ? { x: 2000 + Math.cos(angle) * 320, y: 2000 + Math.sin(angle) * 320 }
      : { x: boss.x, y: clamp(boss.y + 450, ARENA.y + 18, ARENA.y + ARENA.height - 18) };
    const dx = target.x - p.x, dy = target.y - p.y, length = Math.hypot(dx, dy);
    const speed = Math.min(1, length / (BALANCE.player.speed / 60));
    const x = p.x, y = p.y;
    const events = sim.step({ moveX: length > 1e-8 ? dx / length * speed : 0, moveY: length > 1e-8 ? dy / length * speed : 0,
      aimX: boss.x, aimY: boss.y, shoot: false, dash: false, bomb: false });
    damage += events.filter(event => event.type === 'damage').length;
    distance += Math.hypot(p.x - x, p.y - y);
  }
  return { damage, distance };
}

describe('complete committed spellcard routes in the fixed arena', () => {
  it.each((['s1', 's2'] as const).flatMap(season => (['normal', 'hard'] as const).flatMap(difficulty =>
    Array.from({ length: 6 }, (_, card) => ({ season, difficulty, card, name: SPELL_CARDS[season][difficulty][card].name }))))) (
    '$season $difficulty $name has a full input-only route from the ordinary start, corners and near-body range', ({ season, difficulty, card }) => {
      // Search two fixed steering preferences. Each complete attempt independently uses only visible tells;
      // selecting a successful recorded route never changes health, bullets, inputs or AI mid-run.
      const outcomes = STARTS.map(placement => {
        const clockwise = runRoute(season, difficulty, card, placement, true);
        return clockwise.damage === 0 ? clockwise : runRoute(season, difficulty, card, placement, true, 24, -1);
      });
      for (const outcome of outcomes) {
        expect(outcome.elapsed, JSON.stringify(outcomes)).toBeCloseTo(24, 6);
        expect(outcome.index).toBeGreaterThanOrEqual(5);
        expect(outcome.shots + outcome.hazards).toBeGreaterThan(5);
        expect(outcome.damage, JSON.stringify(outcomes)).toBe(0);
        expect(outcome.bombs).toBe(BALANCE.player.bombs);
        expect(outcome.dashes).toBeLessThanOrEqual(Math.ceil(24 / BALANCE.dash.cooldown));
        expect(outcome.distance).toBeGreaterThan(100);
      }
    });
  it.each((['s1', 's2'] as const).flatMap(season => Array.from({ length: 6 }, (_, card) => ({ season, card }))))(
    '$season card $card damages a stationary control under the same real simulation', ({ season, card }) => {
      const outcome = runRoute(season, 'normal', card, STARTS[0], false, 20);
      expect(outcome.damage).toBeGreaterThan(0); expect(outcome.dashes).toBe(0); expect(outcome.distance).toBe(0);
    });
  it.each((['s1', 's2'] as const).flatMap(season => (['normal', 'hard'] as const).flatMap(difficulty =>
    (['circle', 'old-lane'] as const).map(strategy => ({ season, difficulty, strategy }))))) (
    '$season $difficulty blind $strategy cannot solve the card set without reading attacks', ({ season, difficulty, strategy }) => {
      const outcomes = Array.from({ length: 6 }, (_, card) => runBlindControl(season, difficulty, card, strategy));
      expect(outcomes.filter(outcome => outcome.damage > 0).length, JSON.stringify(outcomes)).toBeGreaterThanOrEqual(3);
      expect(outcomes.every(outcome => outcome.distance > 100), JSON.stringify(outcomes)).toBe(true);
    });
});
