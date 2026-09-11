import { describe, expect, it } from 'vitest';
import { createBossBrain } from './boss-ai';
import { BALANCE, STEP } from './config';
import { GameSimulation } from './simulation';
import type { InputAction } from './types';

type SweepDirection = 1 | -1;
interface Placement { bossX: number; bossY: number; playerX: number; playerY: number }
interface Route { moveX: number; moveY: number; ticks: number }
const corners = [
  { name: 'top left', bossX: 260, bossY: 260, playerX: 18, playerY: 18, inwardY: 1 },
  { name: 'top right', bossX: 3740, bossY: 260, playerX: 3982, playerY: 18, inwardY: 1 },
  { name: 'bottom left', bossX: 260, bossY: 3740, playerX: 18, playerY: 3982, inwardY: -1 },
  { name: 'bottom right', bossX: 3740, bossY: 3740, playerX: 3982, playerY: 3982, inwardY: -1 },
] as const;
const difference = (to: number, from: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const walk = (moveX = 0, moveY = 0): InputAction => ({
  moveX, moveY, aimX: 2000, aimY: 2000, shoot: false, dash: false, bomb: false, focus: false,
});

function encounter(distance: number, placement?: Placement) {
  const sim = new GameSimulation(32026);
  const boss = sim.spawnEnemy('boss', 2000, 2000)!;
  const player = sim.state.player;
  if (placement) {
    boss.x = boss.prevX = placement.bossX;
    boss.y = boss.prevY = placement.bossY;
  }
  player.x = player.prevX = placement?.playerX ?? boss.x + distance;
  player.y = player.prevY = placement?.playerY ?? boss.y;
  player.invincible = 0;
  player.bombs = 0;
  boss.boss = createBossBrain();
  boss.state = 'chase';
  boss.timer = 0;
  return { sim, boss, player };
}

function startLaser(distance: number, direction: SweepDirection, placement?: Placement) {
  const scene = encounter(distance, placement);
  // Force only the next attack selection; its clocks, motion and damage are real.
  scene.boss.boss!.sweepDirection = direction === 1 ? -1 : 1;
  scene.boss.laserCooldown = 0;
  scene.sim.step(walk());
  expect(scene.boss.state).toBe('laserWarmup');
  expect(scene.boss.boss!.sweepDirection).toBe(direction);
  return scene;
}

function playLaser(distance: number, direction: SweepDirection, escape: boolean, placement?: Placement, inwardY = direction as number) {
  const scene = startLaser(distance, direction, placement);
  const { sim, boss, player } = scene;
  const hp = player.hp, startAngle = boss.angle, initialTick = sim.state.tick;
  let activeTicks = 0, damageEvents = 0, rescueEvents = 0, maxStep = 0;
  let activationPosition: { x: number; y: number } | undefined;

  for (let tick = 0; tick < 600; tick++) {
    const warming = boss.state === 'laserWarmup';
    if (!warming && boss.state !== 'laser') break;
    if (boss.state === 'laser') activeTicks++;
    // A 300 ms reaction delay, then one straight walk toward the advertised far edge.
    // Stop at activation: survival must not rely on continually outrunning the beam.
    const moving = escape && warming && sim.state.tick - initialTick >= 18;
    const beforeX = player.x, beforeY = player.y;
    const events = sim.step(walk(0, moving ? inwardY : 0));
    maxStep = Math.max(maxStep, Math.hypot(player.x - beforeX, player.y - beforeY));
    damageEvents += events.filter(event => event.type === 'damage').length;
    rescueEvents += events.filter(event => event.type === 'dash' || event.type === 'bomb').length;
    if (warming && boss.state === 'laser') activationPosition = { x: player.x, y: player.y };
  }

  expect(activeTicks).toBeGreaterThanOrEqual(180);
  expect(boss.state).toBe('recover');
  expect(direction * difference(boss.angle, startAngle)).toBeGreaterThan(0.9);
  expect(sim.state.enemies).toHaveLength(1);
  expect(sim.state.bullets).toHaveLength(0);
  expect(maxStep).toBeLessThanOrEqual(300 * STEP + 1e-8);
  expect(rescueEvents).toBe(0);
  expect(player.bombs).toBe(0);
  expect(activationPosition).toBeDefined();
  expect(player.x).toBeCloseTo(activationPosition!.x, 8);
  expect(player.y).toBeCloseTo(activationPosition!.y, 8);
  return { ...scene, hp, startAngle, damageEvents };
}

function startBombard(placement?: Placement) {
  const scene = encounter(400, placement);
  scene.boss.boss!.cycle = 2;
  scene.boss.laserCooldown = 999;
  scene.sim.step(walk());
  expect(scene.sim.state.hazards).toHaveLength(3);
  expect(scene.sim.state.hazards.every(hazard => !hazard.active && hazard.sourceId === scene.boss.id)).toBe(true);
  return scene;
}

function playBombard(escape: boolean, placement?: Placement, route: Route = { moveX: 1, moveY: 0, ticks: 36 }, wholePattern = false) {
  const scene = startBombard(placement);
  const { sim, player } = scene;
  const hp = player.hp, startX = player.x, startY = player.y;
  const marked = sim.state.hazards.map(hazard => ({ id: hazard.id, x: hazard.x, y: hazard.y }));
  const activated = new Set<number>();
  let damageEvents = 0, maxStep = 0, rescueEvents = 0, ringBursts = 0, maxLiveBullets = 0;
  let finishedPattern = false;

  for (let tick = 0; tick < (wholePattern ? 480 : 240); tick++) {
    // Notice the markers after 350 ms. The complete combination requires keeping clear of later rings.
    const moving = escape && tick >= 21 && tick < 21 + route.ticks;
    const beforeX = player.x, beforeY = player.y;
    const events = sim.step(walk(moving ? route.moveX : 0, moving ? route.moveY : 0));
    maxStep = Math.max(maxStep, Math.hypot(player.x - beforeX, player.y - beforeY));
    damageEvents += events.filter(event => event.type === 'damage').length;
    rescueEvents += events.filter(event => event.type === 'dash' || event.type === 'bomb').length;
    ringBursts += events.filter(event => event.type === 'enemyShot' && event.enemyType === 'boss').length;
    maxLiveBullets = Math.max(maxLiveBullets, sim.state.bullets.filter(bullet => bullet.owner === 'enemy').length);
    finishedPattern ||= scene.boss.state === 'recover';
    for (const hazard of sim.state.hazards) {
      const original = marked.find(mark => mark.id === hazard.id)!;
      expect(original).toBeDefined();
      expect(hazard.x).toBe(original.x);
      expect(hazard.y).toBe(original.y);
      if (hazard.active) activated.add(hazard.id);
    }
    if (!wholePattern && sim.state.hazards.length === 0) break;
  }

  expect(activated.size).toBe(3);
  expect(sim.state.hazards).toHaveLength(0);
  expect(maxStep).toBeLessThanOrEqual(300 * STEP + 1e-8);
  expect(rescueEvents).toBe(0);
  expect(player.bombs).toBe(0);
  expect(player.x).toBeCloseTo(startX + (escape ? route.moveX * route.ticks * 300 * STEP : 0), 8);
  expect(player.y).toBeCloseTo(startY + (escape ? route.moveY * route.ticks * 300 * STEP : 0), 8);
  if (wholePattern) {
    expect(finishedPattern).toBe(true);
    expect(ringBursts).toBeGreaterThanOrEqual(6);
    expect(maxLiveBullets).toBeGreaterThan(50);
  }
  return { ...scene, hp, startX, damageEvents };
}

describe('unassisted routes through real Boss attacks', () => {
  it.each([
    [400, 1], [400, -1], [700, 1], [700, -1],
  ] as const)('escapes the full laser sector at distance %i, sweep direction %i, then stands safely', (distance, direction) => {
    const { sim, boss, player, hp, startAngle, damageEvents } = playLaser(distance, direction, true);
    expect(sim.state.status).toBe('playing');
    expect(player.hp).toBe(hp);
    expect(player.invincible).toBe(0);
    expect(damageEvents).toBe(0);

    // Independent sector check, beyond the observed final ray with body-size margin.
    const dx = player.x - boss.x, dy = player.y - boss.y;
    const progress = direction * difference(Math.atan2(dy, dx), startAngle);
    const sweep = direction * difference(boss.angle, startAngle);
    expect(progress).toBeGreaterThan(sweep);
    const clearance = Math.abs(dx * Math.sin(boss.angle) - dy * Math.cos(boss.angle));
    expect(clearance).toBeGreaterThan(BALANCE.boss.laserWidth / 2 + player.radius + 20);
  });

  it('does damage to a stationary player, so safe routes cannot pass with an inactive laser', () => {
    const { player, hp, damageEvents } = playLaser(700, 1, false);
    expect(player.hp).toBeLessThan(hp);
    expect(damageEvents).toBeGreaterThan(0);
  });

  it.each([1, -1] as const)('keeps the committed start angle while the player changes position, direction %i', direction => {
    const { sim, boss, player } = startLaser(700, direction);
    const committed = boss.angle, startY = player.y;
    let warningTicks = 0;
    while (boss.state === 'laserWarmup' && warningTicks < 180) {
      sim.step(walk(0, direction));
      expect(difference(boss.angle, committed)).toBeCloseTo(0, 10);
      warningTicks++;
    }
    expect(warningTicks).toBeGreaterThanOrEqual(120);
    expect(boss.state).toBe('laser');
    expect(Math.abs(player.y - startY)).toBeGreaterThan(500);
    expect(player.invincible).toBe(0);
  });

  it('walks out of all three committed ground blasts after a reaction delay without spending a rescue', () => {
    const { sim, player, hp, startX, damageEvents } = playBombard(true);
    expect(sim.state.status).toBe('playing');
    expect(player.x - startX).toBeCloseTo(180, 8);
    expect(player.hp).toBe(hp);
    expect(player.invincible).toBe(0);
    expect(damageEvents).toBe(0);
  });

  it('takes damage when remaining in a marked blast, validating the ground-hazard control', () => {
    const { player, hp, damageEvents } = playBombard(false);
    expect(player.hp).toBeLessThan(hp);
    expect(damageEvents).toBeGreaterThan(0);
  });

  it.each(corners.flatMap(corner => ([1, -1] as const).map(direction => ({ ...corner, direction }))))(
    'walks along the wall out of the laser at $name, direction $direction, and waits without damage', corner => {
      const { sim, boss, player, hp, startAngle, damageEvents } = playLaser(0, corner.direction, true, corner, corner.inwardY);
      expect(sim.state.status).toBe('playing');
      expect(player.hp).toBe(hp);
      expect(player.invincible).toBe(0);
      expect(damageEvents).toBe(0);
      const dx = player.x - boss.x, dy = player.y - boss.y;
      const progress = corner.direction * difference(Math.atan2(dy, dx), startAngle);
      const sweep = corner.direction * difference(boss.angle, startAngle);
      expect(progress < 0 || progress > sweep).toBe(true);
      const distanceToRay = (angle: number) => {
        const along = Math.max(0, dx * Math.cos(angle) + dy * Math.sin(angle));
        return Math.hypot(dx - Math.cos(angle) * along, dy - Math.sin(angle) * along);
      };
      expect(Math.min(distanceToRay(startAngle), distanceToRay(boss.angle)))
        .toBeGreaterThan(BALANCE.boss.laserWidth / 2 + player.radius + 20);
    },
  );

  it.each(corners)('escapes wall-clamped bombard and all accompanying rings at $name by continuing along the wall', corner => {
    const { sim, player, hp, damageEvents } = playBombard(true, corner, { moveX: 0, moveY: corner.inwardY, ticks: 459 }, true);
    expect(sim.state.status).toBe('playing');
    expect(player.hp).toBe(hp);
    expect(player.invincible).toBe(0);
    expect(damageEvents).toBe(0);
  });

  it('keeps lethal ground damage terminal, clears pending hazards, and restores a clean run on reset', () => {
    const { sim, player } = startBombard();
    player.hp = 1;
    const endings: string[] = [];
    for (let tick = 0; tick < 180 && sim.state.status === 'playing'; tick++) {
      endings.push(...sim.step(walk()).filter(event => event.type === 'failure' || event.type === 'complete').map(event => event.type));
    }
    expect(endings).toEqual(['failure']);
    expect(sim.state.status).toBe('failed');
    expect(sim.state.hazards).toHaveLength(0);
    expect(sim.state.enemies).toHaveLength(0);
    expect(sim.state.bullets).toHaveLength(0);
    const frozenTick = sim.state.tick;
    for (let tick = 0; tick < 60; tick++) expect(sim.step(walk())).toHaveLength(0);
    expect(sim.state.tick).toBe(frozenTick);
    sim.reset();
    expect(sim.state.status).toBe('playing');
    expect(sim.state.tick).toBe(0);
    expect(sim.state.hazards).toHaveLength(0);
    expect(sim.state.player.hp).toBe(sim.state.player.maxHp);
    sim.state.spawnTimer = 999;
    sim.state.player.invincible = 0;
    for (let tick = 0; tick < 180; tick++) expect(sim.step(walk()).some(event => event.type === 'damage')).toBe(false);
    expect(sim.state.hazards).toHaveLength(0);
  });

  it('caps and staggers real enemy commitments, then releases the scheduling delay on restart', () => {
    const sim = new GameSimulation(32026);
    sim.state.spawnTimer = 999;
    sim.state.player.invincible = 0;
    sim.state.player.bombs = 0;
    for (let i = 0; i < 9; i++) sim.spawnEnemy('sniper', 2500, 1800 + i * 50)!.cooldown = 0;
    const starts: number[] = [];
    let largest = 0;
    for (let tick = 0; tick < 60; tick++) {
      const events = sim.step(walk());
      starts.push(...events.filter(event => event.type === 'attack' && event.text === 'windup').map(() => sim.state.elapsed));
      const active = sim.state.enemies.filter(enemy => ['aim', 'charge', 'dash', 'volley', 'lay'].includes(enemy.state)).length;
      largest = Math.max(largest, active);
      expect(active).toBeLessThanOrEqual(3);
    }
    expect(largest).toBe(3);
    expect(starts).toHaveLength(3);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(0.28 - 1e-8);
    expect(sim.state.player.hp).toBe(sim.state.player.maxHp);
    sim.reset();
    sim.state.spawnTimer = 999;
    const fresh = sim.spawnEnemy('sniper', 2500, 2000)!;
    fresh.cooldown = 0;
    const events = sim.step(walk());
    expect(fresh.state).toBe('aim');
    expect(events.filter(event => event.type === 'attack' && event.text === 'windup')).toHaveLength(1);
  });
});
