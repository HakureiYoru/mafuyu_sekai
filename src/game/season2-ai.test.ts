import { describe, expect, it } from 'vitest';
import { ENEMIES, STEP, WORLD } from './config';
import { FixedClock } from './clock';
import { angleDelta, clamp } from './math';
import { breakShield, createSeason2Brain, onSeason2Death, returningProgram, season2Attacks, season2Telegraph, season2Telegraphs, season2WallPoints, shieldDamageMultiplier, updateSeason2Ai } from './season2-ai';
import { interruptEnemy } from './enemy-ai';
import type { Season2AiContext } from './season2-ai';
import type { AreaHazard, CombatEvent, Difficulty, Enemy, EnemyShotOptions, EnemyType, Player } from './types';

const difficulties = ['normal', 'hard'] as const;
function enemy(type: EnemyType, id = 1, x = 2000, y = 2000): Enemy {
  const cfg = ENEMIES[type];
  return { id, type, archetypeId: type, role: ['palisade', 'reprise'].includes(type) ? 'miniboss' : type === 'core' ? 'hazard' : ['arm', 'node'].includes(type) ? 'part' : 'mob',
    x, y, prevX: x, prevY: y, vx: 0, vy: 0, radius: cfg.radius, hp: cfg.hp, maxHp: cfg.hp, speed: cfg.speed,
    angle: 0, state: 'chase', timer: 0, cooldown: 0, laserCooldown: 0, attackIndex: 0, hitTime: 0, lowHpSpoken: false,
    directionX: 0, directionY: 0, season2: createSeason2Brain(type) };
}
function harness(type: EnemyType, difficulty: Difficulty = 'normal') {
  const e = enemy(type), enemies = [e];
  const player: Player = { x: 2420, y: 2000, prevX: 2420, prevY: 2000, vx: 0, vy: 0, radius: 7,
    hp: 5, maxHp: 5, hpReserve: 0, bombs: 0, level: 4, xp: 0, heat: 0, angle: Math.PI, invincible: 0, commandTargetId: null, commandTime: 0, commandCooldown: 0,
    dashTime: 0, dashCooldown: 0, dashVx: 0, dashVy: 0, perfectWindow: 0, shotCooldown: 0, specialCooldown: 0,
    idleTime: 0, heatLock: 0, overheated: false, focus: false };
  const shots: { sourceId: number; x: number; y: number; angle: number; speed: number; radius: number; options?: EnemyShotOptions; time: number }[] = [];
  const hazards: Omit<AreaHazard, 'id'>[] = [], events: CombatEvent[] = [], retired: number[] = [];
  const commits: ('wall' | 'sample' | undefined)[] = [];
  let permission = true, capacity = 100, nextId = 20;
  const ctx: Season2AiContext = {
    player, difficulty, elapsed: 0, enemies,
    canCommit: kind => { commits.push(kind); return permission; },
    shootAt: (source, x, y, angle, speed, radius, _color, options) => shots.push({ sourceId: source.id, x, y, angle, speed, radius, options, time: ctx.elapsed }),
    spawnHazard: hazard => hazards.push(hazard),
    spawnPart: (parent, type, x, y) => {
      if (capacity-- <= 0) return null;
      const part = enemy(type, nextId++, x, y); part.parentId = parent.id; enemies.push(part); return part;
    },
    retirePart: part => { retired.push(part.id); part.hp = 0; },
    emit: event => events.push(event),
  };
  function tick(dt = STEP) {
    ctx.elapsed += dt;
    for (const target of [...enemies]) if (target.hp > 0) {
      target.prevX = target.x; target.prevY = target.y; target.cooldown -= dt;
      updateSeason2Ai(target, dt, ctx);
      target.x = clamp(target.x + target.vx * dt, target.radius, WORLD.width - target.radius);
      target.y = clamp(target.y + target.vy * dt, target.radius, WORLD.height - target.radius);
    }
  }
  function run(count: number) { for (let i = 0; i < count; i++) tick(); }
  function until(condition: () => boolean, max = 600) {
    for (let i = 0; i < max && !condition(); i++) tick();
    expect(condition()).toBe(true);
  }
  return { e, enemies, player, shots, hazards, events, retired, commits, ctx, tick, run, until,
    permit: (value: boolean) => { permission = value; }, capacity: (value: number) => { capacity = value; } };
}

describe('second-season ownership and shared warnings', () => {
  it.each(['palisade', 'reprise'] as const)('%s keeps pursuing until visible rather than hovering outside the camera', type => {
    const h = harness(type); h.permit(false); h.player.x = h.e.x; h.player.y = h.e.y + 600; h.player.vy = 300;
    const before = h.player.y - h.e.y;
    for (let tick = 0; tick < 30; tick++) { h.player.y += 300 * STEP; h.tick(); }
    expect(h.player.y - h.e.y).toBeLessThan(before - 40);
    expect(h.e.vy).toBeGreaterThan(300); expect(h.shots).toHaveLength(0);
  });
  it.each(difficulties)('%s locks a finite retreat interception and does not retarget a direction change during warning', difficulty => {
    const h = harness('reprise', difficulty); h.player.x = h.e.x + 360; h.player.y = h.e.y; h.player.vx = 300;
    h.tick();
    expect(h.e.action?.kind).toBe('dash'); expect(h.e.action?.phase).toBe('warning');
    const { targetX, targetY, angle } = h.e.action!;
    expect(targetX - h.e.x).toBeGreaterThan(500); expect(targetX - h.e.x).toBeLessThanOrEqual(700);
    h.player.vx = 0; h.player.vy = 300; h.player.y += 120; h.run(12);
    expect(h.e.action).toMatchObject({ targetX, targetY, angle, phase: 'warning' });
    expect(h.e.action!.remaining).toBeGreaterThan(0); expect(h.e.exposedUntil ?? 0).toBe(0);
  });
  it('returns cached profiles but creates isolated finite per-enemy state', () => {
    expect(season2Attacks()).toBe(season2Attacks('normal'));
    expect(season2Attacks('hard')).toBe(season2Attacks('hard'));
    const a = createSeason2Brain('sampler'), b = createSeason2Brain('sampler');
    a.points.push({ x: 1, y: 2 }); a.partIds.push(3); a.healedIds.push(4);
    expect(b.points).toEqual([]); expect(b.partIds).toEqual([]); expect(b.healedIds).toEqual([]);
  });
  it.each(['shield', 'weaver', 'returner', 'sampler', 'palisade', 'reprise'] as const)('%s cannot start an attack without director permission', type => {
    const h = harness(type); h.permit(false); h.run(240);
    expect(h.shots).toHaveLength(0); expect(h.hazards).toHaveLength(0); expect(h.e.state).toBe('chase');
    expect(h.commits.length).toBeGreaterThan(0);
    if (type === 'weaver' || type === 'palisade') expect(h.commits.every(value => value === 'wall')).toBe(true);
    if (type === 'sampler') expect(h.commits.every(value => value === 'sample')).toBe(true);
  });
  it('does not mutate gameplay while reading a wall warning', () => {
    const h = harness('weaver'); h.tick();
    const before = JSON.stringify(h.e);
    for (let i = 0; i < 10; i++) season2Telegraph(h.e, 'hard');
    expect(JSON.stringify(h.e)).toBe(before);
    const bare = enemy('weaver'); bare.season2 = undefined;
    season2WallPoints(bare); expect(bare.season2).toBeUndefined();
  });
  it('ignores invalid deltas and terminal actors without spending an attack slot', () => {
    const h = harness('sampler');
    for (const dt of [0, -1, Infinity, NaN]) updateSeason2Ai(h.e, dt, h.ctx);
    h.player.hp = 0; updateSeason2Ai(h.e, STEP, h.ctx);
    h.player.hp = 5; h.e.hp = 0; updateSeason2Ai(h.e, STEP, h.ctx);
    expect(h.commits).toHaveLength(0); expect(h.events).toHaveLength(0);
  });
});

describe('distinct ordinary enemy solutions', () => {
  it.each(difficulties)('%s cancels weaver fire and repair healing through a finite exposed weakpoint', difficulty => {
    for (const type of ['weaver', 'repairer'] as const) {
      const h = harness(type, difficulty), target = enemy('shield', 2, 2200, 2000); target.hp = 5;
      if (type === 'repairer') h.enemies.push(target);
      h.tick(); expect(h.e.state).toBe('charge');
      expect(h.e.weakpoint).toMatchObject({ radius: 24, hp: difficulty === 'hard' ? 6 : 4 });
      expect(interruptEnemy(h.e, 99, h.ctx.elapsed, h.ctx.emit)).toBe(true);
      expect(h.e.cooldown).toBeCloseTo(season2Attacks(difficulty)[type].cooldown + 0.7);
      h.permit(false); h.run(240);
      expect(h.e.weakpoint).toBeUndefined(); expect(h.e.season2!.targetId).toBeNull();
      expect(h.shots.filter(shot => shot.sourceId === h.e.id)).toHaveLength(0); expect(h.events.filter(event => event.type === 'interrupt')).toHaveLength(1);
      expect(target.hp).toBe(5); expect(h.e.season2!.healedIds).toHaveLength(0);
    }
  });
  it('assigns at most one shield to a support and moves between it and the player without instant turning', () => {
    const h = harness('shield'), support = enemy('weaver', 2, 1750, 2000), second = enemy('shield', 3, 1950, 2040);
    h.enemies.push(support, second); h.permit(false); h.e.angle = Math.PI;
    h.tick();
    expect(h.e.season2!.guardTargetId).toBe(support.id); expect(second.season2!.guardTargetId).toBeNull();
    expect(h.e.vx).toBeLessThan(0);
    expect(Math.abs(angleDelta(Math.PI, h.e.angle))).toBeCloseTo(season2Attacks().shield.turnSpeed * STEP);
    h.permit(true); h.tick(); expect(h.e.state).toBe('chase');
    support.hp = 0; h.tick(); expect(h.e.season2!.guardTargetId).toBeNull();
  });
  it.each(difficulties)('%s marks only shield center fire and exposes one nonrenewable 1.2 second break', difficulty => {
    const h = harness('shield', difficulty); h.tick(); h.until(() => h.shots.length > 0);
    expect(h.shots.map(s => s.options?.friendlyDamage ?? 0)).toEqual([0, 8, 0]);
    expect(h.shots[1].options!.friendlyHits).toBe(3);
    h.until(() => h.e.state === 'charge');
    const start = h.ctx.elapsed, before = h.shots.length;
    expect(breakShield(h.e, start, h.ctx.emit)).toBe(true);
    expect(breakShield(h.e, start + 0.3, h.ctx.emit)).toBe(false);
    expect(h.e.shieldBrokenUntil).toBeCloseTo(start + 1.2);
    h.run(71); expect(h.shots).toHaveLength(before);
    expect(shieldDamageMultiplier(h.e, h.e.x + 100, h.e.y, h.ctx.elapsed)).toBe(1);
    expect(h.events.filter(event => event.type === 'shieldBreak')).toHaveLength(1);
  });
  it('makes a frontal shield resist rather than grant immunity, with an exposed recovery window', () => {
    const e = enemy('shield');
    expect(shieldDamageMultiplier(e, e.x + 100, e.y)).toBe(0.25);
    expect(shieldDamageMultiplier(e, e.x, e.y + 100)).toBe(1);
    expect(shieldDamageMultiplier(e, e.x - 100, e.y)).toBe(1);
    e.state = 'recover'; expect(shieldDamageMultiplier(e, e.x + 100, e.y)).toBe(1);
    expect(shieldDamageMultiplier(enemy('weaver'), 2500, 2000)).toBe(1);
  });
  it('locks the shield shot direction through the whole warning instead of chasing movement', () => {
    const h = harness('shield'); h.tick(); const angle = h.e.angle;
    h.player.x = 1900; h.player.y = 2300; h.run(40);
    expect(h.e.angle).toBe(angle); expect(h.shots).toHaveLength(0);
    h.until(() => h.shots.length > 0);
    expect(h.shots).toHaveLength(3); expect(h.shots[1].angle).toBe(angle);
    expect(h.e.state).toBe('recover');
  });
  it.each(difficulties)('%s emits exactly the shared wall centers after its full warning, with two traversable gaps', difficulty => {
    const h = harness('weaver', difficulty), cfg = season2Attacks(difficulty).weaver;
    h.tick(); const start = h.ctx.elapsed, preview = season2Telegraph(h.e, difficulty)!;
    const origin = { x: h.e.x, y: h.e.y }, angle = h.e.angle;
    h.player.x -= 100; h.player.y += 150;
    h.run(Math.floor(cfg.warning / STEP) - 1); expect(h.shots).toHaveLength(0);
    h.until(() => h.shots.length > 0);
    expect(h.ctx.elapsed - start).toBeGreaterThanOrEqual(cfg.warning - 1e-8);
    expect(h.shots.map(({ x, y }) => ({ x, y }))).toEqual(preview.points);
    for (const side of [-1, 1]) for (const shot of h.shots) {
      const offset = (shot.x - origin.x) * -Math.sin(angle) + (shot.y - origin.y) * Math.cos(angle);
      expect(Math.abs(offset - side * cfg.gapOffset) - shot.radius).toBeGreaterThanOrEqual(cfg.gapWidth / 2 - 1e-8);
    }
    for (const side of [-1, 1]) {
      const clearance = Math.min(...h.shots.map(shot => Math.abs((shot.x - origin.x) * -Math.sin(angle) + (shot.y - origin.y) * Math.cos(angle) - side * cfg.gapOffset) - shot.radius));
      expect(clearance * 2).toBeCloseTo(difficulty === 'hard' ? 48 : 64, 8);
      expect(clearance - h.player.radius).toBeGreaterThanOrEqual(17);
    }
    expect(h.shots.every(shot => shot.speed === cfg.speed)).toBe(true);
    expect(h.shots.every(shot => shot.options?.attackGroup === 'wall')).toBe(true);
    expect(h.shots[0].options!.program![0].duration * cfg.speed * (difficulty === 'hard' ? 1.28 : 1)).toBeCloseTo(preview.travel!, 8);
  });
  it.each(difficulties)('%s returning blades declare one finite reversal and a visible stationary interval', difficulty => {
    const h = harness('returner', difficulty); h.tick(); const preview = season2Telegraph(h.e, difficulty)!;
    h.player.y += 150; h.until(() => h.shots.length > 0);
    expect(h.shots).toHaveLength(2);
    for (const shot of h.shots) {
      const program = shot.options!.program!;
      expect(program.filter(phase => phase.reverse)).toHaveLength(1);
      expect(program[1]).toEqual({ duration: 0.65, speed: 0 });
      expect(program.reduce((total, phase) => total + phase.duration, 0)).toBeCloseTo(4.05);
      expect(Math.abs(angleDelta(preview.angle, shot.angle))).toBeCloseTo(preview.spread / 2, 8);
    }
    expect(preview.radius).toBeCloseTo(300 * 1.7 * (difficulty === 'hard' ? 1.28 : 1), 8);
    expect(returningProgram(200, 1)[2]).toEqual({ duration: 1, speed: 200, reverse: true });
  });
  it('samples three historical positions and never relocates their later explosions', () => {
    const h = harness('sampler'); h.tick(); const first = { x: h.player.x, y: h.player.y };
    h.player.y = 2060; h.run(18);
    h.player.y = 2120; h.run(18);
    expect(h.hazards).toHaveLength(3);
    expect(h.hazards.map(({ x, y }) => ({ x, y }))).toEqual([first, { x: first.x, y: 2060 }, { x: first.x, y: 2120 }]);
    const marks = JSON.stringify(h.hazards); h.player.y = 2450; h.permit(false); h.run(120);
    expect(JSON.stringify(h.hazards)).toBe(marks);
    expect(h.hazards.every(hazard => !hazard.active && hazard.warning >= 1.1 && hazard.sourceId === h.e.id)).toBe(true);
  });
  it('heals a damaged ordinary target only once, bounded to twenty percent, with no overheal', () => {
    const h = harness('repairer'), target = enemy('shield', 2, 2200, 2000); target.hp = 5; h.enemies.push(target);
    h.tick(); expect(h.e.season2!.targetId).toBe(target.id);
    h.until(() => h.events.some(event => event.text === 'repair'));
    expect(target.hp).toBe(5 + Math.ceil(target.maxHp * 0.2)); expect(h.e.season2!.healedIds).toEqual([2]);
    target.hp = 1; h.run(600); expect(target.hp).toBe(1);
    expect(h.events.filter(event => event.text === 'repair')).toHaveLength(1);
  });
  it('cannot heal bosses, repairers, dead units, or a target already reserved by another repairer', () => {
    const h = harness('repairer');
    for (const type of ['boss', 'miniboss', 'palisade', 'reprise', 'repairer', 'arm', 'node'] as const) {
      const target = enemy(type, 30 + h.enemies.length, 2200, 2000); target.hp = 1; h.enemies.push(target);
    }
    const dead = enemy('shield', 90, 2200, 2000); dead.hp = 0; h.enemies.push(dead);
    h.tick(); expect(h.e.state).toBe('chase');
    const target = enemy('shield', 91, 2200, 2000); target.hp = 1; h.enemies.push(target);
    const other = h.enemies.find(e => e.type === 'repairer' && e.id !== h.e.id)!;
    other.state = 'charge'; other.season2!.targetId = target.id; other.timer = 100;
    updateSeason2Ai(h.e, STEP, h.ctx); expect(h.e.state).toBe('chase');
  });
  it('cancels repair when its target dies or leaves range, without reviving it', () => {
    for (const reason of ['death', 'distance'] as const) {
      const h = harness('repairer'), target = enemy('shield', 2, 2200, 2000); target.hp = 5; h.enemies.push(target);
      h.tick(); if (reason === 'death') target.hp = 0; else target.x = 3500;
      updateSeason2Ai(h.e, 1.3, h.ctx);
      expect(target.hp).toBe(reason === 'death' ? 0 : 5); expect(h.e.state).toBe('recover');
      expect(h.events.some(event => event.text === 'repair')).toBe(false);
    }
  });
});

describe('destructible parts and finite death derivatives', () => {
  it.each(difficulties)('%s gives PALISADE left wall and delayed right aimed fan separate locked geometry', difficulty => {
    const h = harness('palisade', difficulty), cfg = season2Attacks(difficulty).palisade;
    h.tick(); const start = h.ctx.elapsed, warnings = season2Telegraphs(h.e, difficulty);
    expect(warnings.map(w => w.kind)).toEqual(['wall', 'fan']);
    const left = h.enemies.find(e => e.type === 'arm' && e.season2!.heading === -1)!;
    const right = h.enemies.find(e => e.type === 'arm' && e.season2!.heading === 1)!;
    const fan = warnings[1], angle = h.e.angle;
    h.player.y += 130; h.until(() => h.shots.length > 0);
    expect(h.ctx.elapsed - start).toBeCloseTo(cfg.warning, 8);
    expect(h.shots.every(shot => shot.sourceId === left.id)).toBe(true);
    expect(h.shots.map(({ x, y }) => ({ x, y }))).toEqual(warnings[0].points);
    expect(h.shots.every(shot => (shot.x - h.e.x) * -Math.sin(angle) + (shot.y - h.e.y) * Math.cos(angle) < 0)).toBe(true);
    const wallTime = h.ctx.elapsed; h.until(() => h.shots.some(shot => shot.sourceId === right.id));
    const batch = h.shots.filter(shot => shot.sourceId === right.id);
    expect(h.ctx.elapsed - wallTime).toBeGreaterThanOrEqual(cfg.batchGap / 2 - 1e-8);
    expect(h.ctx.elapsed - wallTime).toBeLessThan(cfg.batchGap / 2 + STEP);
    expect(batch).toHaveLength(cfg.fanCount);
    expect(batch.every(shot => shot.speed === 180 && shot.x === fan.x && shot.y === fan.y)).toBe(true);
    expect(batch.every(shot => shot.options?.attackGroup === undefined)).toBe(true);
    expect(batch[0].angle).toBeCloseTo(fan.angle - fan.spread / 2);
    expect(batch.at(-1)!.angle).toBeCloseTo(fan.angle + fan.spread / 2);
    right.hp = 0; onSeason2Death(right, h.ctx);
    expect(season2Telegraphs(h.e, difficulty).some(w => w.kind === 'fan')).toBe(false);
    h.permit(false); h.until(() => h.e.state === 'recover');
    expect(h.shots.filter(shot => shot.sourceId === right.id)).toHaveLength(cfg.fanCount);
    expect(h.shots.filter(shot => shot.sourceId === left.id)).toHaveLength(warnings[0].points.length * cfg.batches);
  });
  it('emits exactly three warning cores once per carrier death and observes the global core cap', () => {
    const h = harness('carrier'); h.e.hp = 0;
    onSeason2Death(h.e, h.ctx); onSeason2Death(h.e, h.ctx);
    const cores = h.enemies.filter(e => e.type === 'core');
    expect(cores).toHaveLength(3); expect(cores.every(e => e.state === 'arming' && e.timer === 0.95 && e.parentId === h.e.id)).toBe(true);
    for (let i = 0; i < 8; i++) h.enemies.push(enemy('core', 100 + i));
    const second = enemy('carrier', 10); second.hp = 0; onSeason2Death(second, h.ctx);
    expect(h.enemies.filter(e => e.type === 'core' && e.hp > 0)).toHaveLength(12);
  });
  it('fires an armed core once and retires it; shooting it early prevents its projectile', () => {
    const h = harness('core'); h.e.state = 'arming'; h.e.timer = 0.95; h.e.season2!.heading = 1;
    h.run(56); expect(h.shots).toHaveLength(0);
    h.tick(); expect(h.shots).toHaveLength(1); expect(h.retired).toEqual([h.e.id]);
    h.run(100); expect(h.shots).toHaveLength(1);
    const killed = harness('core'); killed.e.hp = 0; killed.run(100); expect(killed.shots).toHaveLength(0);
  });
  it('retries incomplete arm allocation, never duplicates a successful arm, and does not regenerate destroyed arms', () => {
    const h = harness('palisade'); h.permit(false); h.capacity(1); h.tick();
    expect(h.e.season2!.partIds).toHaveLength(1); expect(h.e.season2!.partsSpawned).toBe(false);
    h.run(30); expect(h.enemies.filter(e => e.type === 'arm')).toHaveLength(1);
    h.capacity(5); h.tick(); expect(h.e.season2!.partIds).toHaveLength(2);
    const arm = h.enemies.find(e => e.type === 'arm')!; arm.hp = 0; onSeason2Death(arm, h.ctx);
    h.run(120); expect(h.enemies.filter(e => e.type === 'arm')).toHaveLength(2);
  });
  it('removes a destroyed arm from all later wall emission and exposes that half in the shared warning', () => {
    const h = harness('palisade'); h.tick();
    const arm = h.enemies.find(e => e.type === 'arm' && e.season2!.heading === -1)!;
    arm.hp = 0; onSeason2Death(arm, h.ctx); onSeason2Death(arm, h.ctx);
    expect(h.e.season2!.lostArms).toEqual([-1]);
    expect(h.e.exposedUntil).toBeCloseTo(h.ctx.elapsed + 2, 8);
    expect(h.events.filter(event => event.text === 'core-exposed')).toHaveLength(1);
    const preview = season2Telegraph(h.e)!, angle = h.e.angle;
    expect(preview.points.every(point => (point.x - h.e.x) * -Math.sin(angle) + (point.y - h.e.y) * Math.cos(angle) >= 0)).toBe(true);
    h.until(() => h.shots.length > 0);
    expect(h.shots.every(shot => shot.sourceId !== arm.id)).toBe(true);
  });
  it('cancels the old wall when both arms break before giving its fallback a new full warning', () => {
    const h = harness('palisade'); h.tick(); h.run(50);
    for (const arm of h.enemies.filter(e => e.type === 'arm')) { arm.hp = 0; onSeason2Death(arm, h.ctx); }
    expect(h.e.state).toBe('recover'); h.run(20); expect(h.shots).toHaveLength(0);
    h.until(() => h.e.state === 'charge'); expect(season2Telegraphs(h.e).some(cue => cue.kind === 'fan')).toBe(true);
    const start = h.ctx.elapsed; h.until(() => h.shots.length > 0);
    expect(h.ctx.elapsed - start).toBeGreaterThanOrEqual(season2Attacks().palisade.warning - 1e-8);
    expect(h.shots).toHaveLength(5);
    expect(h.events.some(event => event.text === 'action-sidestep' || event.text === 'action-dash')).toBe(true);
  });
  it('retires orphaned arms without manufacturing a death reward or another generation', () => {
    const h = harness('arm'); h.e.parentId = 999; h.tick();
    expect(h.retired).toEqual([h.e.id]); expect(h.events).toHaveLength(0); expect(h.enemies).toHaveLength(1);
  });
});

describe('REPRISE choreography and deterministic clocks', () => {
  it.each(['palisade', 'reprise', 'weaver', 'sampler', 'returner', 'core'] as const)('%s does not reveal a promised release before budget admission', type => {
    const h = harness(type); h.ctx.reserveAttack = () => false; h.run(240);
    expect(h.shots).toHaveLength(0); expect(h.hazards).toHaveLength(0);
    expect(season2Telegraphs(h.e)).toEqual([]); expect(h.e.action).toBeUndefined();
  });
  it.each(difficulties)('%s keeps a committed return path locked while the body actively moves through its stationary beat', difficulty => {
    const h = harness('reprise', difficulty), cfg = season2Attacks(difficulty).reprise;
    h.tick(); const angle = h.e.angle;
    h.player.y += 170; h.until(() => h.shots.length > 0); const firstTime = h.ctx.elapsed;
    expect(h.shots).toHaveLength(cfg.fanCount); expect(h.e.angle).toBe(angle);
    expect(h.shots.every(shot => Math.abs(angleDelta(angle, shot.angle)) <= cfg.spread / 2 + 1e-8)).toBe(true);
    const first = { x: h.e.x, y: h.e.y }, program = structuredClone(h.shots[0].options!.program);
    h.permit(false); h.run(120);
    expect(Math.hypot(h.e.x - first.x, h.e.y - first.y)).toBeGreaterThan(200);
    expect(h.ctx.elapsed - firstTime).toBeLessThan(cfg.outbound * 2 + cfg.pause);
    expect(h.shots[0].options!.program).toEqual(program);
    expect(h.events.some(event => event.text === 'action-sidestep')).toBe(true);
    expect(h.shots).toHaveLength(cfg.fanCount);
  });
  it('finishes a committed sequence before changing phase and announces a second return group on the next sequence', () => {
    const h = harness('reprise'); h.tick(); h.e.hp = h.e.maxHp * 0.4;
    h.until(() => h.e.state === 'volley'); expect(h.e.season2!.phase).toBe(1);
    h.until(() => h.e.state === 'phaseShift'); expect(h.e.season2!.phase).toBe(2);
    expect(h.events.filter(event => event.text === 'phase')).toHaveLength(1);
    const before = h.shots.length; h.until(() => h.e.state === 'charge'); const fixed = h.e.angle;
    h.until(() => h.shots.length > before); h.player.y += 160; h.run(31);
    expect(h.e.angle).toBe(fixed);
    const releases = h.events.filter(event => event.text === 'release'); expect(releases).toHaveLength(3);
  });
  it.each(difficulties)('%s has identical attacks, samples, parts and transitions at 30/60/120/144 Hz', difficulty => {
    const run = (hz: number) => {
      const h = harness('palisade', difficulty), clock = new FixedClock();
      for (let frame = 0; frame <= hz * 12; frame++) clock.advance(frame * 1000 / hz, dt => {
        if (h.ctx.elapsed > 6) h.e.hp = h.e.maxHp * 0.4;
        h.tick(dt);
      });
      return { shots: h.shots, events: h.events, state: h.e.state, phase: h.e.season2!.phase, parts: h.e.season2!.partIds };
    };
    const baseline = run(60); expect(baseline.shots.length).toBeGreaterThan(30);
    for (const hz of [30, 120, 144]) expect(run(hz)).toEqual(baseline);
  });
});
