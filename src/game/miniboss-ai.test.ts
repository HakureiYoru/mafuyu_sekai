import { describe, expect, it } from 'vitest';
import { BALANCE, STEP, WORLD } from './config';
import { FixedClock } from './clock';
import { beamGeometry, clamp, normalize, pointInBeam, segmentCircleHit } from './math';
import { createMiniBossBrain, MINIBOSS_ATTACKS, miniBossAttacks, updateMiniBossAi } from './miniboss-ai';
import type { MiniBossAiContext } from './miniboss-ai';
import type { CombatEvent, Difficulty, Enemy, Player } from './types';

function harness(difficulty: Difficulty = 'normal', phase: 1 | 2 = 1) {
  const player: Player = { x: 2450, y: 2000, prevX: 2450, prevY: 2000, vx: 0, vy: 0, radius: 18,
    hp: 5, maxHp: 5, bombs: 0, level: 1, xp: 0, ammo: 120, heat: 0, angle: 0, invincible: 0,
    dashTime: 0, dashCooldown: 0, dashVx: 0, dashVy: 0, perfectWindow: 0, shotCooldown: 0,
    specialCooldown: 0, idleTime: 0, heatLock: 0, overheated: false, focus: false };
  const maxHp = difficulty === 'hard' ? 810 : 600;
  const enemy: Enemy = { id: 11, type: 'miniboss', x: 2000, y: 2000, prevX: 2000, prevY: 2000, vx: 0, vy: 0,
    radius: 64, hp: phase === 2 ? maxHp * 0.4 : maxHp, maxHp, speed: 155 * (difficulty === 'hard' ? 1.3 : 1),
    angle: 0, state: 'chase', timer: 0, cooldown: 0, laserCooldown: 0, attackIndex: 0, hitTime: 0,
    lowHpSpoken: false, directionX: 0, directionY: 0, miniboss: { ...createMiniBossBrain(), phase } };
  const events: (CombatEvent & { time: number })[] = [];
  const counts = { damage: 0, contact: 0, commits: 0, shots: 0 };
  let allowCommit = true;
  const damage = () => {
    if (player.hp <= 0 || player.invincible > 1e-8) return;
    counts.damage++; player.hp -= difficulty === 'hard' ? 2 : 1; player.invincible = BALANCE.player.hitInvincible;
  };
  const ctx: MiniBossAiContext = {
    player, elapsed: 0, difficulty,
    canCommit: () => { counts.commits++; return allowCommit; },
    emit: event => events.push({ ...event, time: ctx.elapsed }),
    shoot: () => { counts.shots++; },
    damagePlayer: damage,
  };
  function tick(dt = STEP) {
    if (player.hp <= 0 || enemy.hp <= 0) return;
    ctx.elapsed += dt; player.invincible = Math.max(0, player.invincible - dt);
    player.prevX = player.x; player.prevY = player.y;
    player.x = clamp(player.x + player.vx * dt, player.radius, WORLD.width - player.radius);
    player.y = clamp(player.y + player.vy * dt, player.radius, WORLD.height - player.radius);
    enemy.prevX = enemy.x; enemy.prevY = enemy.y; enemy.cooldown -= dt;
    updateMiniBossAi(enemy, dt, ctx);
    enemy.x = clamp(enemy.x + enemy.vx * dt, enemy.radius, WORLD.width - enemy.radius);
    enemy.y = clamp(enemy.y + enemy.vy * dt, enemy.radius, WORLD.height - enemy.radius);
    if (segmentCircleHit(enemy.prevX - player.prevX, enemy.prevY - player.prevY,
      enemy.x - player.x, enemy.y - player.y, 0, 0, enemy.radius + player.radius) !== null) {
      counts.contact++; damage();
    }
  }
  function until(state: Enemy['state'], limit = 1200) {
    for (let i = 0; i < limit && enemy.state !== state; i++) tick();
    expect(enemy.state).toBe(state);
  }
  function run(ticks: number) { for (let i = 0; i < ticks; i++) tick(); }
  return { player, enemy, ctx, counts, events, tick, run, until, permit: (value: boolean) => { allowCommit = value; } };
}

describe('ECHO commitment and simulation ownership', () => {
  it('returns cached difficulty parameters and independent fresh brains', () => {
    expect(miniBossAttacks()).toBe(MINIBOSS_ATTACKS);
    expect(miniBossAttacks('normal')).toBe(miniBossAttacks('normal'));
    expect(miniBossAttacks('hard')).toBe(miniBossAttacks('hard'));
    expect(miniBossAttacks('hard').dash.speed).toBeGreaterThan(MINIBOSS_ATTACKS.dash.speed);
    expect(miniBossAttacks('hard').laser.warning).toBeLessThan(MINIBOSS_ATTACKS.laser.warning);
    const a = createMiniBossBrain(), b = createMiniBossBrain();
    a.phase = 2; a.cycle = 9; a.targetX = 900; a.dashesLeft = 2;
    expect(b).toEqual({ phase: 1, cycle: 0, lockedAngle: 0, targetX: 0, targetY: 0, dashesLeft: 0 });
  });

  it('does not integrate positions or decrement the caller-owned cooldown', () => {
    const h = harness('hard'); h.enemy.x = 1000; h.enemy.cooldown = 2;
    updateMiniBossAi(h.enemy, STEP, h.ctx);
    expect(h.enemy.x).toBe(1000); expect(h.enemy.y).toBe(2000); expect(h.enemy.cooldown).toBe(2);
    expect(Math.hypot(h.enemy.vx, h.enemy.vy)).toBeCloseTo(155 * 1.3);
  });

  it.each(['normal', 'hard'] as const)('%s never commits from offscreen, too far away, or inside body range', difficulty => {
    for (const [x, y] of [[1400, 2000], [2000, 1000], [2400, 2000], [64, 2000]]) {
      const h = harness(difficulty); h.enemy.x = x; h.enemy.y = y;
      h.tick();
      expect(h.enemy.state).toBe('chase'); expect(h.events).toHaveLength(0); expect(h.counts.commits).toBe(0);
      expect(Math.hypot(h.enemy.vx, h.enemy.vy)).toBeCloseTo(h.enemy.speed);
    }
  });

  it.each(['normal', 'hard'] as const)('%s waits for one global commitment then completes the combo without requesting another', difficulty => {
    const h = harness(difficulty, 2); h.permit(false); h.run(30);
    expect(h.enemy.state).toBe('chase'); expect(h.events).toHaveLength(0);
    h.permit(true); h.tick(); const calls = h.counts.commits; h.permit(false);
    expect(h.enemy.state).toBe('charge'); h.until('recover');
    expect(h.counts.commits).toBe(calls);
    expect(h.events.filter(event => event.text === 'windup')).toHaveLength(difficulty === 'hard' ? 2 : 1);
    expect(h.events.filter(event => event.text === 'laser')).toHaveLength(1);
    expect(h.counts.shots).toBe(0);
  });

  it.each(['normal', 'hard'] as const)('%s locks a dash at its first warning frame and travels exactly to its legal endpoint', difficulty => {
    const h = harness(difficulty); h.tick();
    const start = { x: h.enemy.x, y: h.enemy.y };
    const target = { x: h.enemy.miniboss!.targetX, y: h.enemy.miniboss!.targetY };
    const angle = h.enemy.angle;
    h.player.x = 2200; h.player.y = 2500;
    h.until('dash');
    expect(h.enemy.angle).toBe(angle); expect(h.enemy.miniboss).toMatchObject({ targetX: target.x, targetY: target.y });
    expect(h.enemy.x).toBe(start.x); expect(h.enemy.y).toBe(start.y);
    h.until('aim');
    expect(h.enemy.x).toBeCloseTo(target.x, 7); expect(h.enemy.y).toBeCloseTo(target.y, 7);
    expect(Math.hypot(target.x - start.x, target.y - start.y)).toBeCloseTo(miniBossAttacks(difficulty).dash.speed * miniBossAttacks(difficulty).dash.duration, 7);
    const x = h.enemy.x, y = h.enemy.y; h.tick();
    expect(h.enemy.x).toBe(x); expect(h.enemy.y).toBe(y);
  });

  it('gives each difficult phase-two dash a separate complete warning and a stationary settle before the laser', () => {
    const h = harness('hard', 2), cfg = miniBossAttacks('hard'); h.tick(); h.until('recover');
    const windups = h.events.filter(event => event.text === 'windup');
    const releases = h.events.filter(event => event.text === 'release');
    expect(windups).toHaveLength(2); expect(releases).toHaveLength(3);
    for (let i = 0; i < 2; i++) expect(releases[i].time - windups[i].time).toBeCloseTo(cfg.dash.phase2Warning, 6);
    const laser = h.events.find(event => event.text === 'laser')!;
    expect(laser.time - releases[1].time).toBeGreaterThanOrEqual(cfg.dash.duration + cfg.settle - 1e-8);
    expect(releases[2].time - laser.time).toBeCloseTo(cfg.laser.phase2Warning, 6);
  });

  it('changes phase once at low health after finishing an already locked attack and resets without residual combo state', () => {
    const h = harness('hard'); h.tick(); h.enemy.hp = h.enemy.maxHp * 0.45;
    h.tick(); expect(h.enemy.miniboss!.phase).toBe(1); expect(h.enemy.state).toBe('charge');
    h.until('recover'); expect(h.events.filter(event => event.text === 'windup')).toHaveLength(1);
    h.tick(); expect(h.enemy.state).toBe('phaseShift'); expect(h.enemy.miniboss!.phase).toBe(2);
    h.run(50); expect(h.enemy.state).toBe('phaseShift');
    h.tick(); expect(h.enemy.state).toBe('chase');
    expect(h.events.filter(event => event.text === 'phase')).toHaveLength(1);
    h.tick(); h.until('recover');
    expect(h.events.filter(event => event.text === 'windup')).toHaveLength(3);
    const fresh = harness('hard'); fresh.tick();
    expect(fresh.enemy.miniboss).toMatchObject({ phase: 1, cycle: 1, dashesLeft: 1 });
    expect(fresh.events.filter(event => event.text === 'windup')).toHaveLength(1);
  });

  it('freezes without side effects for dead actors and invalid or zero simulation steps', () => {
    for (const failure of ['enemy', 'player', 'zero', 'nan', 'negative'] as const) {
      const h = harness(); h.until('laserWarmup');
      if (failure === 'enemy') h.enemy.hp = 0;
      if (failure === 'player') h.player.hp = 0;
      const before = structuredClone({ enemy: h.enemy, player: h.player, events: h.events, counts: h.counts });
      updateMiniBossAi(h.enemy, failure === 'zero' ? 0 : failure === 'nan' ? NaN : failure === 'negative' ? -1 : STEP, h.ctx);
      expect({ enemy: h.enemy, player: h.player, events: h.events, counts: h.counts }).toEqual(before);
    }
  });

  it.each(['normal', 'hard'] as const)('%s cancels the follow-up safely if the player has moved beyond visibility/range', difficulty => {
    const h = harness(difficulty, 2); h.tick(); h.until('dash');
    h.player.x = 3800; h.player.y = 3800; h.until('recover');
    expect(h.events.filter(event => event.text === 'laser')).toHaveLength(0);
    expect(h.counts.damage).toBe(0); expect(h.counts.commits).toBe(1);
  });
});

/** Choose an ordinary straight route from the already visible fixed beam; no future AI state is used. */
function escapeDirection(h: ReturnType<typeof harness>) {
  const cfg = miniBossAttacks(h.ctx.difficulty), beam = beamGeometry(h.enemy.x, h.enemy.y, h.enemy.angle, cfg.laser.length, cfg.laser.width);
  const candidates = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (const [x, y] of candidates) {
    const direction = normalize(x, y);
    const endX = clamp(h.player.x + direction.x * 135, h.player.radius, WORLD.width - h.player.radius);
    const endY = clamp(h.player.y + direction.y * 135, h.player.radius, WORLD.height - h.player.radius);
    if (Math.hypot(endX - h.player.x, endY - h.player.y) < 90) continue;
    if (pointInBeam(endX, endY, h.player.radius, beam)) continue;
    if (segmentCircleHit(h.player.x, h.player.y, endX, endY, h.enemy.x, h.enemy.y, h.enemy.radius + h.player.radius + 2) !== null) continue;
    return direction;
  }
  throw new Error(`No ordinary escape route from fixed ECHO beam at ${h.player.x},${h.player.y}; enemy ${h.enemy.x},${h.enemy.y}`);
}

describe('ECHO reaction and world-boundary fairness', () => {
  for (const difficulty of ['normal', 'hard'] as const) {
    for (const phase of [1, 2] as const) {
      for (const [corner, mirrorX, mirrorY] of [['center', 0, 0], ['top-left', 1, 1], ['top-right', -1, 1], ['bottom-left', 1, -1], ['bottom-right', -1, -1]] as const) {
        it(`${difficulty} phase ${phase} ${corner}: a 0.2s reaction and 135px ordinary walk avoid the entire combo`, () => {
          const h = harness(difficulty, phase);
          if (corner !== 'center') {
            h.player.x = mirrorX === 1 ? 18 : WORLD.width - 18;
            h.player.y = mirrorY === 1 ? 18 : WORLD.height - 18;
            h.enemy.x = mirrorX === 1 ? 360 : WORLD.width - 360;
            h.enemy.y = mirrorY === 1 ? 220 : WORLD.height - 220;
          }
          h.until('laserWarmup');
          expect(h.counts.damage).toBe(0); expect(h.counts.contact).toBe(0);
          const direction = escapeDirection(h), lockedAngle = h.enemy.angle;
          h.run(12); // Human reaction interval: 0.2 seconds, with no movement or invulnerability.
          h.player.vx = direction.x * 300; h.player.vy = direction.y * 300;
          h.run(27); h.player.vx = h.player.vy = 0; // 135 pixels maximum, no dash or bomb.
          expect(h.enemy.angle).toBe(lockedAngle);
          h.until('recover');
          expect(h.counts.damage).toBe(0); expect(h.counts.contact).toBe(0); expect(h.player.hp).toBe(5);
          expect(h.player.invincible).toBe(0); expect(h.player.dashTime).toBe(0); expect(h.player.bombs).toBe(0);
          expect(h.enemy.x).toBeGreaterThanOrEqual(h.enemy.radius); expect(h.enemy.x).toBeLessThanOrEqual(WORLD.width - h.enemy.radius);
          expect(h.enemy.y).toBeGreaterThanOrEqual(h.enemy.radius); expect(h.enemy.y).toBeLessThanOrEqual(WORLD.height - h.enemy.radius);
        });
      }
    }
  }

  it.each(['normal', 'hard'] as const)('%s stationary positive control takes exactly one fixed-beam hit after its full warning', difficulty => {
    const h = harness(difficulty); h.until('laserWarmup'); const angle = h.enemy.angle;
    expect(h.counts.damage).toBe(0); h.until('laser'); expect(h.counts.damage).toBe(0);
    h.until('recover');
    expect(h.counts.damage).toBe(1); expect(h.player.hp).toBe(difficulty === 'hard' ? 3 : 4);
    expect(h.counts.contact).toBe(0); expect(h.enemy.angle).toBe(angle);
  });

  it('stops immediately on a lethal laser and does not advance its active timer after terminal damage', () => {
    const h = harness('hard'); h.player.hp = 1; h.until('laser');
    const timer = h.enemy.timer; h.tick(); expect(h.player.hp).toBeLessThanOrEqual(0); expect(h.enemy.timer).toBe(timer);
    const before = structuredClone(h.enemy); updateMiniBossAi(h.enemy, STEP, h.ctx);
    expect(h.enemy).toEqual(before); expect(h.counts.damage).toBe(1);
  });

  it.each(['normal', 'hard'] as const)('%s produces the same combo and endpoint across 30/60/120/144Hz render clocks', difficulty => {
    function sample(hz: number) {
      const h = harness(difficulty); h.player.invincible = 1000; h.enemy.hp = h.enemy.maxHp * 0.4;
      const clock = new FixedClock();
      clock.advance(0, dt => h.tick(dt));
      for (let frame = 1; frame <= hz * 12; frame++) clock.advance(frame * 1000 / hz, dt => h.tick(dt));
      expect(h.ctx.elapsed).toBeCloseTo(12, 8);
      expect(h.enemy.miniboss!.phase).toBe(2);
      expect(h.events.filter(event => event.text === 'phase')).toHaveLength(1);
      expect(h.events.filter(event => event.text === 'windup').length).toBeGreaterThan(0);
      expect(h.events.filter(event => event.text === 'laser').length).toBeGreaterThan(0);
      return { enemy: h.enemy, damage: h.counts.damage, events: h.events, elapsed: h.ctx.elapsed };
    }
    const expected = sample(60);
    for (const hz of [30, 120, 144]) expect(sample(hz)).toEqual(expected);
  });
});
