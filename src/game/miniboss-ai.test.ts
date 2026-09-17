import { describe, expect, it } from 'vitest';
import { BALANCE, STEP, WORLD } from './config';
import { FixedClock } from './clock';
import { angleDelta, clamp, normalize, pointInBeam, segmentCircleHit } from './math';
import { advanceProjectileMotion } from './projectile-motion';
import { GameSimulation } from './simulation';
import { createMiniBossBrain, MINIBOSS_ATTACKS, miniBossAttacks, miniBossDashGeometry, miniBossLandingTelegraph, miniBossLaserGeometry, updateMiniBossAi } from './miniboss-ai';
import type { MiniBossAiContext } from './miniboss-ai';
import type { Bullet, CombatEvent, Difficulty, Enemy, EnemyShotOptions, Player } from './types';

function harness(difficulty: Difficulty = 'normal', phase: 1 | 2 = 1) {
  const player: Player = { x: 2450, y: 2000, prevX: 2450, prevY: 2000, vx: 0, vy: 0, radius: 18,
    hp: 5, maxHp: 5, hpReserve: 0, bombs: 0, level: 1, xp: 0, heat: 0, angle: 0, invincible: 0,
    commandTargetId: null, commandTime: 0, commandCooldown: 0,
    dashTime: 0, dashCooldown: 0, dashVx: 0, dashVy: 0, perfectWindow: 0, shotCooldown: 0,
    specialCooldown: 0, idleTime: 0, heatLock: 0, overheated: false, focus: false };
  const maxHp = difficulty === 'hard' ? 1620 : 1200;
  const enemy: Enemy = { id: 11, type: 'miniboss', x: 2000, y: 2000, prevX: 2000, prevY: 2000, vx: 0, vy: 0,
    radius: 64, hp: phase === 2 ? maxHp * 0.4 : maxHp, maxHp, speed: 155 * (difficulty === 'hard' ? 1.3 : 1),
    angle: 0, state: 'chase', timer: 0, cooldown: 0, laserCooldown: 0, attackIndex: 0, hitTime: 0,
    lowHpSpoken: false, directionX: 0, directionY: 0, miniboss: { ...createMiniBossBrain(), phase } };
  const events: (CombatEvent & { time: number; state: Enemy['state'] })[] = [];
  const shots: { x: number; y: number; angle: number; speed: number; time: number; options?: EnemyShotOptions }[] = [];
  const bullets: Bullet[] = [];
  const counts = { damage: 0, contact: 0, bulletHits: 0, commits: 0 };
  let allowCommit = true;
  const damage = () => {
    if (player.hp <= 0 || player.invincible > 1e-8) return;
    counts.damage++; player.hp = Math.max(0, player.hp - (difficulty === 'hard' ? 2 : 1));
    player.invincible = BALANCE.player.hitInvincible;
  };
  const ctx: MiniBossAiContext = {
    player, elapsed: 0, difficulty,
    canCommit: () => { counts.commits++; return allowCommit; },
    emit: event => events.push({ ...event, time: ctx.elapsed, state: enemy.state }),
    shoot: (e, angle, speed, radius, color, options) => {
      shots.push({ x: e.x, y: e.y, angle, speed, time: ctx.elapsed, options });
      const actualSpeed = speed * (difficulty === 'hard' ? 1.28 : 1);
      bullets.push({ id: shots.length, owner: 'enemy', x: e.x, y: e.y, prevX: e.x, prevY: e.y,
        vx: Math.cos(angle) * actualSpeed, vy: Math.sin(angle) * actualSpeed, speed: actualSpeed, radius,
        damage: difficulty === 'hard' ? 2 : 1, life: 8, color, homing: false, lockRange: 0,
        targetId: null, remainingHits: 1, hitIds: new Set(), kind: 'normal', motionAge: 0, ...options });
    },
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
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i]; b.prevX = b.x; b.prevY = b.y; b.life -= dt;
      advanceProjectileMotion(b, dt); b.x += b.vx * dt; b.y += b.vy * dt;
      const hit = segmentCircleHit(b.prevX - player.prevX, b.prevY - player.prevY,
        b.x - player.x, b.y - player.y, 0, 0, b.radius + player.radius) !== null;
      if (hit && player.invincible <= 1e-8) { counts.bulletHits++; damage(); }
      if (hit || b.life <= 0) bullets.splice(i, 1);
    }
  }
  function until(state: Enemy['state'], limit = 1200) {
    for (let i = 0; i < limit && enemy.state !== state; i++) tick();
    expect(enemy.state).toBe(state);
  }
  function run(ticks: number) { for (let i = 0; i < ticks; i++) tick(); }
  return { player, enemy, ctx, counts, events, shots, bullets, tick, run, until, permit: (value: boolean) => { allowCommit = value; } };
}

describe('ECHO pursuit and committed combos', () => {
  it('returns stable profiles and independent complete brains', () => {
    expect(miniBossAttacks()).toBe(MINIBOSS_ATTACKS); expect(miniBossAttacks('hard')).toBe(miniBossAttacks('hard'));
    const a = createMiniBossBrain(), b = createMiniBossBrain();
    a.phase = 2; a.cycle = 9; a.targetX = 900; a.dashesLeft = 4; a.lasersLeft = 3; a.combo = 'crossfire';
    expect(b).toEqual({ phase: 1, cycle: 0, lockedAngle: 0, targetX: 0, targetY: 0, dashesLeft: 0,
      combo: 'pursuit', lasersLeft: 0, laserIndex: 0, chainIndex: 0, burstAngle: 0 });
  });

  it.each(['normal', 'hard'] as const)('%s actively closes on a moving player at its boss speed without owning position/cooldown integration', difficulty => {
    const h = harness(difficulty), speed = difficulty === 'hard' ? 300 : 240;
    h.enemy.x = 1000; h.enemy.cooldown = 2; h.player.vy = 100;
    updateMiniBossAi(h.enemy, STEP, h.ctx);
    expect(h.enemy.x).toBe(1000); expect(h.enemy.y).toBe(2000); expect(h.enemy.cooldown).toBe(2);
    expect(Math.hypot(h.enemy.vx, h.enemy.vy)).toBeCloseTo(speed);
    expect(h.enemy.vx).toBeGreaterThan(0);
    const before = Math.hypot(h.player.x - h.enemy.x, h.player.y - h.enemy.y); h.run(120);
    expect(Math.hypot(h.player.x - h.enemy.x, h.player.y - h.enemy.y)).toBeLessThan(before - 350);
    expect(h.events).toHaveLength(0);
  });

  it.each(['normal', 'hard'] as const)('%s never starts a combo offscreen or at contact distance', difficulty => {
    for (const [x, y] of [[1400, 2000], [2000, 1000], [2400, 2000], [64, 2000]]) {
      const h = harness(difficulty); h.enemy.x = x; h.enemy.y = y; h.tick();
      expect(h.enemy.state).toBe('chase'); expect(h.events).toHaveLength(0); expect(h.counts.commits).toBe(0);
    }
  });

  for (const difficulty of ['normal', 'hard'] as const) for (const phase of [1, 2] as const) {
    it(`${difficulty} phase ${phase} performs every dash, delayed landing burst and laser on a single reservation`, () => {
      const h = harness(difficulty, phase), cfg = miniBossAttacks(difficulty); h.player.invincible = 1000;
      h.permit(false); h.run(12); expect(h.enemy.state).toBe('chase');
      h.permit(true); h.tick(); const calls = h.counts.commits; h.permit(false); h.until('recover');
      const windups = h.events.filter(event => event.text === 'windup');
      const dashReleases = h.events.filter(event => event.text === 'release' && event.state === 'dash');
      const lasers = h.events.filter(event => event.text === 'laser');
      const laserReleases = h.events.filter(event => event.text === 'release' && event.state === 'laser');
      const bursts = h.events.filter(event => event.text === 'burst');
      expect(windups).toHaveLength(cfg.dash.counts[phase - 1]); expect(dashReleases).toHaveLength(windups.length);
      expect(lasers).toHaveLength(cfg.laser.counts[phase - 1]); expect(laserReleases).toHaveLength(lasers.length);
      expect(bursts).toHaveLength(windups.length); expect(h.counts.commits).toBe(calls);
      for (let i = 0; i < windups.length; i++) {
        const warning = phase === 2 ? cfg.dash.phase2Warning : cfg.dash.warning;
        expect(dashReleases[i].time - windups[i].time).toBeGreaterThanOrEqual(warning - 1e-8);
        expect(bursts[i].time - dashReleases[i].time).toBeGreaterThanOrEqual(cfg.dash.duration + cfg.settle - 1e-8);
      }
      for (let i = 0; i < lasers.length; i++) {
        const warning = phase === 2 ? cfg.laser.phase2Warning : cfg.laser.warning;
        expect(laserReleases[i].time - lasers[i].time).toBeGreaterThanOrEqual(warning - 1e-8);
        if (i > 0) expect(lasers[i].time - laserReleases[i - 1].time).toBeGreaterThanOrEqual(cfg.laser.duration + cfg.laser.gap - 1e-8);
      }
      expect(h.ctx.elapsed).toBeLessThan(8.5); expect(h.shots.length).toBeGreaterThanOrEqual(windups.length * 5);
    });
  }

  it.each(['normal', 'hard'] as const)('%s can dash through the sampled player, but ends beyond body overlap and exactly at its preview', difficulty => {
    const h = harness(difficulty); h.player.x = 2240; h.player.invincible = 1000; h.tick();
    const startX = h.enemy.x, target = { x: h.enemy.miniboss!.targetX, y: h.enemy.miniboss!.targetY };
    expect(target.x).toBeGreaterThan(h.player.x + h.enemy.radius + h.player.radius);
    expect(segmentCircleHit(startX, h.enemy.y, target.x, target.y, h.player.x, h.player.y, h.enemy.radius + h.player.radius)).not.toBeNull();
    const preview = miniBossDashGeometry(h.enemy), angle = h.enemy.angle;
    expect(preview.endX).toBeCloseTo(target.x); expect(preview.endY).toBeCloseTo(target.y);
    const landing = miniBossLandingTelegraph(h.enemy, difficulty);
    h.player.x = 2500; h.player.y = 2300; h.until('dash');
    expect(h.enemy.angle).toBe(angle); expect(miniBossLandingTelegraph(h.enemy, difficulty)).toEqual(landing);
    expect(h.enemy.x).toBe(startX); h.until('aim');
    expect(h.enemy.x).toBeCloseTo(target.x, 7); expect(h.enemy.y).toBeCloseTo(target.y, 7);
    expect(h.shots).toHaveLength(0); h.tick(); expect(h.enemy.x).toBeCloseTo(target.x, 7); expect(h.shots).toHaveLength(0);
  });

  it.each(['normal', 'hard'] as const)('%s alternates pursuit fans with predeclared crossfire rings and fixed safe gaps', difficulty => {
    const h = harness(difficulty, 2); h.enemy.miniboss!.cycle = 1; h.player.invincible = 1000;
    h.tick(); expect(h.enemy.miniboss!.combo).toBe('crossfire');
    const previews: ReturnType<typeof miniBossLandingTelegraph>[] = [];
    let chain = 0;
    for (let i = 0; i < 600 && h.enemy.state !== 'recover'; i++) {
      if (h.enemy.state === 'charge' && h.enemy.miniboss!.chainIndex !== chain) {
        chain = h.enemy.miniboss!.chainIndex; previews.push(miniBossLandingTelegraph(h.enemy, difficulty));
      }
      h.tick();
    }
    expect(h.enemy.state).toBe('recover'); expect(previews.some(p => p.pattern === 'ring')).toBe(true);
    expect(h.shots.some(s => s.options?.shape === 'rice')).toBe(true); expect(h.shots.some(s => s.options?.shape === 'orb')).toBe(true);
    for (const preview of previews.filter(p => p.pattern === 'ring')) {
      const ring = h.shots.filter(s => s.options?.shape === 'orb' && Math.hypot(s.x - preview.x, s.y - preview.y) < 0.01);
      expect(ring.length).toBeGreaterThan(5);
      expect(ring.every(s => Math.abs(angleDelta(preview.angle, s.angle)) > preview.gap / 2)).toBe(true);
    }
  });

  it.each(['normal', 'hard'] as const)('%s landing preview contains the outermost curved rice trajectory, not just its launch angle', difficulty => {
    const h = harness(difficulty); h.player.invincible = 1000; h.tick();
    const preview = miniBossLandingTelegraph(h.enemy, difficulty), cfg = miniBossAttacks(difficulty).landing;
    h.until('aim'); while (h.shots.length === 0) h.tick();
    let passedOriginalEdge = false;
    for (const bullet of h.bullets) {
      const b = structuredClone(bullet);
      for (let i = 0; i < 90; i++) {
        advanceProjectileMotion(b, STEP);
        const offset = Math.abs(angleDelta(preview.angle, Math.atan2(b.vy, b.vx)));
        expect(offset).toBeLessThanOrEqual(preview.spread / 2 + 1e-8);
        if (offset > cfg.fanSpread / 2 + 0.05) passedOriginalEdge = true;
      }
    }
    expect(passedOriginalEdge).toBe(true);
  });

  it.each(['normal', 'hard'] as const)('%s keeps every beam locked throughout its warning and active interval, then visibly reacquires', difficulty => {
    const h = harness(difficulty, 2); h.player.invincible = 1000; h.until('laserWarmup');
    const index = h.enemy.miniboss!.laserIndex, angle = h.enemy.angle;
    h.player.y += 140; h.until('laser'); expect(h.enemy.angle).toBe(angle);
    while (h.enemy.state === 'laser') { h.tick(); expect(h.enemy.angle).toBe(angle); }
    h.until('laserWarmup'); expect(h.enemy.miniboss!.laserIndex).toBe(index + 1);
    expect(Math.abs(angleDelta(angle, h.enemy.angle))).toBeGreaterThan(0.1);
    expect(h.enemy.timer).toBe(difficulty === 'hard' ? 0.5 : 0.65);
  });

  it('finishes the old combo before a single low-health transition, and creates clean state on restart', () => {
    const h = harness('hard'); h.player.invincible = 1000; h.tick(); h.enemy.hp = h.enemy.maxHp * 0.45;
    h.tick(); expect(h.enemy.miniboss!.phase).toBe(1); h.until('recover');
    expect(h.events.filter(e => e.text === 'windup')).toHaveLength(3); h.tick();
    expect(h.enemy.state).toBe('phaseShift'); expect(h.enemy.miniboss!.phase).toBe(2);
    h.until('chase'); h.tick(); h.until('recover');
    expect(h.events.filter(e => e.text === 'windup')).toHaveLength(7);
    expect(h.events.filter(e => e.text === 'phase')).toHaveLength(1);
    const fresh = harness('hard'); fresh.tick();
    expect(fresh.enemy.miniboss).toMatchObject({ phase: 1, cycle: 1, chainIndex: 1, dashesLeft: 3, lasersLeft: 2, laserIndex: 0, combo: 'pursuit' });
  });

  it('freezes without side effects for terminal actors or invalid simulation steps', () => {
    for (const failure of ['enemy', 'player', 'zero', 'nan', 'negative'] as const) {
      const h = harness(); h.player.invincible = 1000; h.until('laserWarmup');
      if (failure === 'enemy') h.enemy.hp = 0; if (failure === 'player') h.player.hp = 0;
      const before = structuredClone({ enemy: h.enemy, player: h.player, events: h.events, counts: h.counts });
      updateMiniBossAi(h.enemy, failure === 'zero' ? 0 : failure === 'nan' ? NaN : failure === 'negative' ? -1 : STEP, h.ctx);
      expect({ enemy: h.enemy, player: h.player, events: h.events, counts: h.counts }).toEqual(before);
    }
  });

  it.each(['normal', 'hard'] as const)('%s cancels unseen follow-ups without emitting their landing burst or beam', difficulty => {
    const h = harness(difficulty, 2); h.tick(); h.until('dash'); h.player.x = 3800; h.player.y = 3800; h.until('recover');
    expect(h.events.filter(event => event.text === 'laser')).toHaveLength(0); expect(h.shots).toHaveLength(0);
    expect(h.counts.damage).toBe(0); expect(h.counts.commits).toBe(1);
  });
});

function setCorner(h: ReturnType<typeof harness>, x: number, y: number) {
  if (x === 0) return;
  h.player.x = x > 0 ? 18 : WORLD.width - 18; h.player.y = y > 0 ? 18 : WORLD.height - 18;
  h.enemy.x = x > 0 ? 360 : WORLD.width - 360; h.enemy.y = y > 0 ? 220 : WORLD.height - 220;
}

describe('ECHO route and warning fairness', () => {
  for (const [difficulty, phase] of [['normal', 1], ['normal', 2], ['hard', 1]] as const) {
    it(`${difficulty} phase ${phase}: a continuous ordinary orbit can avoid a complete combo including all landing projectiles`, () => {
      const attempts: { damage: number; dashes: number; lasers: number }[] = [];
      for (const side of [1, -1]) for (const radius of [300, 420, 520]) {
        const h = harness(difficulty, phase), cfg = miniBossAttacks(difficulty);
        const anchor = { x: 2000, y: 2000 }; h.tick(); h.run(12); h.permit(false);
        let laserOrbit = false;
        for (let tick = 0; tick < 600 && h.enemy.state !== 'recover' && h.player.hp > 0; tick++) {
          if (!laserOrbit && h.enemy.miniboss!.laserIndex > 0) { anchor.x = h.enemy.x; anchor.y = h.enemy.y; laserOrbit = true; }
          const dx = h.player.x - anchor.x, dy = h.player.y - anchor.y, distance = Math.hypot(dx, dy);
          const desired = laserOrbit ? Math.min(radius, 400) : radius;
          const radial = clamp((desired - distance) / desired, -0.8, 0.8);
          const direction = normalize(-dy * side + dx * radial, dx * side + dy * radial);
          h.player.vx = direction.x * 300; h.player.vy = direction.y * 300; h.tick();
        }
        const dashes = h.events.filter(e => e.text === 'windup').length, lasers = h.events.filter(e => e.text === 'laser').length;
        attempts.push({ damage: h.counts.damage, dashes, lasers });
        if (h.enemy.state === 'recover' && h.counts.damage === 0 && dashes === cfg.dash.counts[phase - 1] && lasers === cfg.laser.counts[phase - 1]) {
          expect(h.shots.length).toBeGreaterThan(5); expect(h.player.invincible).toBe(0); expect(h.player.dashTime).toBe(0); return;
        }
      }
      expect(attempts, 'Every complete-combo ordinary route took damage').toContainEqual({ damage: 0,
        dashes: miniBossAttacks(difficulty).dash.counts[phase - 1], lasers: miniBossAttacks(difficulty).laser.counts[phase - 1] });
    });
  }

  it('hard phase two: a real movement-and-dash input sequence survives all four dashes and three lasers without damage or extra resources', () => {
    const attempts: { damage: number; dashes: number; lasers: number; playerDashes: number }[] = [];
    for (const side of [1, -1]) for (const radius of [300, 420, 520]) for (const firstDash of [18, 30, 45, 60, 90]) {
      const sim = new GameSimulation(3407, 'hard'), p = sim.state.player;
      p.x = p.prevX = 2450; p.y = p.prevY = 2000; p.invincible = 0; sim.state.spawnTimer = 1e9;
      const enemy = sim.spawnEnemy('miniboss', 2000, 2000)!; enemy.hp = enemy.maxHp * 0.4; enemy.miniboss!.phase = 2;
      const events: CombatEvent[] = []; const anchor = { x: 2000, y: 2000 };
      for (let tick = 0; tick < 600 && enemy.state !== 'recover' && sim.state.status === 'playing'; tick++) {
        const dx = p.x - anchor.x, dy = p.y - anchor.y, distance = Math.hypot(dx, dy);
        const radial = clamp((radius - distance) / radius, -0.8, 0.8);
        const direction = tick < 12 ? { x: 0, y: 0 } : normalize(-dy * side + dx * radial, dx * side + dy * radial);
        // Physical presses are separated by the real 2.6-second cooldown. The simulation owns dash travel and protection.
        events.push(...sim.step({ moveX: direction.x, moveY: direction.y, aimX: 2000, aimY: 2000,
          shoot: false, bomb: false, dash: tick >= firstDash && (tick - firstDash) % 156 === 0 }));
      }
      const damage = events.filter(e => e.type === 'damage').length;
      const dashes = events.filter(e => e.type === 'attack' && e.enemyType === 'miniboss' && e.text === 'windup').length;
      const lasers = events.filter(e => e.type === 'attack' && e.enemyType === 'miniboss' && e.text === 'laser').length;
      const playerDashes = events.filter(e => e.type === 'dash').length;
      attempts.push({ damage, dashes, lasers, playerDashes });
      if (enemy.state === 'recover' && damage === 0 && dashes === 4 && lasers === 3 && playerDashes > 0) {
        expect(p.hp).toBe(BALANCE.player.hp); expect(p.bombs).toBe(BALANCE.player.bombs);
        expect(events.some(e => e.type === 'enemyShot')).toBe(true); expect(sim.state.tick).toBeGreaterThan(300);
        expect(enemy.miniboss!.chainIndex).toBe(4); expect(enemy.miniboss!.laserIndex).toBe(3); return;
      }
    }
    throw new Error(`No full-combo dash route survived: ${JSON.stringify(attempts)}`);
  });

  for (const difficulty of ['normal', 'hard'] as const) for (const [name, x, y] of [['center', 0, 0], ['top-left', 1, 1], ['top-right', -1, 1], ['bottom-left', 1, -1], ['bottom-right', -1, -1]] as const) {
    it(`${difficulty} ${name}: an ordinary sidestep after a 0.2-second reaction avoids the committed dash and its landing burst`, () => {
      const candidates = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      const successful = candidates.some(([moveX, moveY]) => {
        const h = harness(difficulty, 2); setCorner(h, x, y); h.tick();
        const state = () => h.enemy.state;
        if (state() !== 'charge') return false;
        const brain = h.enemy.miniboss!; brain.dashesLeft = 1; brain.lasersLeft = 1;
        h.permit(false); h.run(12);
        const direction = normalize(moveX, moveY); h.player.vx = direction.x * 300; h.player.vy = direction.y * 300;
        for (let i = 0; i < 180 && state() !== 'laserWarmup' && h.player.hp > 0; i++) h.tick();
        if (state() !== 'laserWarmup') return false;
        // Continue the same walk through the short laser; all real landing projectiles remain in flight.
        h.until('recover'); h.enemy.hp = 0;
        return h.counts.damage === 0 && h.counts.contact === 0 && h.shots.length > 0 && h.player.invincible === 0;
      });
      expect(successful).toBe(true);
    });
  }

  it.each(['normal', 'hard'] as const)('%s no longer lets a stationary target ignore a crossing dash', difficulty => {
    const h = harness(difficulty); h.player.x = 2240; h.tick(); h.until('aim');
    expect(h.counts.contact).toBeGreaterThan(0); expect(h.counts.damage).toBe(1);
    expect(h.player.hp).toBe(difficulty === 'hard' ? 3 : 4);
  });

  it.each(['normal', 'hard'] as const)('%s fixed-beam positive control damages only after the full independently locked warning', difficulty => {
    const h = harness(difficulty), cfg = miniBossAttacks(difficulty);
    h.enemy.state = 'laserWarmup'; h.enemy.timer = cfg.laser.warning;
    h.enemy.miniboss!.lockedAngle = h.enemy.angle = 0; h.enemy.miniboss!.lasersLeft = 1;
    h.until('laser'); expect(h.counts.damage).toBe(0); h.until('recover');
    expect(h.counts.damage).toBe(1); expect(h.counts.contact).toBe(0);
    expect(h.player.hp).toBe(difficulty === 'hard' ? 3 : 4);
  });

  it('stops the active timer on lethal beam damage', () => {
    const h = harness('hard'); h.player.hp = 1; h.enemy.state = 'laser'; h.enemy.timer = 0.3;
    h.enemy.miniboss!.lockedAngle = 0; const timer = h.enemy.timer; h.tick();
    expect(h.player.hp).toBe(0); expect(h.enemy.timer).toBe(timer);
    const before = structuredClone(h.enemy); updateMiniBossAi(h.enemy, STEP, h.ctx); expect(h.enemy).toEqual(before);
  });

  it.each(['normal', 'hard'] as const)('%s has bounded landing endpoints and readable path geometry at every corner through a full enraged combo', difficulty => {
    for (const [x, y] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const h = harness(difficulty, 2); setCorner(h, x, y); h.player.invincible = 1000; h.tick();
      for (let i = 0; i < 600 && h.enemy.state !== 'recover'; i++) {
        const brain = h.enemy.miniboss!;
        if (h.enemy.state === 'charge') {
          expect(brain.targetX).toBeGreaterThanOrEqual(88 - 1e-8); expect(brain.targetX).toBeLessThanOrEqual(WORLD.width - 88 + 1e-8);
          expect(brain.targetY).toBeGreaterThanOrEqual(88 - 1e-8); expect(brain.targetY).toBeLessThanOrEqual(WORLD.height - 88 + 1e-8);
          expect(Math.hypot(brain.targetX - h.player.x, brain.targetY - h.player.y)).toBeGreaterThanOrEqual(h.enemy.radius + h.player.radius + 64 - 1e-8);
          const beam = miniBossDashGeometry(h.enemy); expect(beam.endX).toBeCloseTo(brain.targetX); expect(beam.endY).toBeCloseTo(brain.targetY);
        }
        if (h.enemy.state === 'laserWarmup') expect(pointInBeam(h.player.x, h.player.y, h.player.radius, miniBossLaserGeometry(h.enemy, difficulty))).toBe(true);
        h.tick();
      }
      expect(h.enemy.state).toBe('recover'); expect(h.events.filter(e => e.text === 'windup')).toHaveLength(miniBossAttacks(difficulty).dash.counts[1]);
    }
  });

  it.each(['normal', 'hard'] as const)('%s advances an actual 12 seconds with phase changes, combos, and projectiles identically at every render rate', difficulty => {
    function sample(hz: number) {
      const h = harness(difficulty); h.player.invincible = 1000; h.enemy.hp = h.enemy.maxHp * 0.4;
      const clock = new FixedClock(); clock.advance(0, dt => h.tick(dt));
      for (let frame = 1; frame <= hz * 12; frame++) clock.advance(frame * 1000 / hz, dt => h.tick(dt));
      expect(h.ctx.elapsed).toBeCloseTo(12, 8); expect(h.enemy.miniboss!.phase).toBe(2);
      expect(h.events.filter(event => event.text === 'phase')).toHaveLength(1);
      expect(h.events.filter(event => event.text === 'windup').length).toBeGreaterThan(0);
      expect(h.events.filter(event => event.text === 'laser').length).toBeGreaterThan(0); expect(h.shots.length).toBeGreaterThan(10);
      return { enemy: h.enemy, events: h.events, shots: h.shots, bullets: h.bullets, elapsed: h.ctx.elapsed };
    }
    const expected = sample(60); for (const hz of [30, 120, 144]) expect(sample(hz)).toEqual(expected);
  });
});
