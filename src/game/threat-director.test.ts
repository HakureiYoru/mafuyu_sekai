import { describe, expect, it } from 'vitest';
import { FixedClock } from './clock';
import { THREAT_PACING, ThreatDirector, hasSafeShortPath, isTacticalEnemy, pointInAttackIntent, threatProfile, spawnPacketSize } from './threat-director';
import type { AttackIntent, ThreatContext } from './threat-director';
import type { AreaHazard, Bullet, Enemy, EnemyType, Player } from './types';

const player = (): Player => ({ x: 2000, y: 2000, prevX: 2000, prevY: 2000, vx: 0, vy: 0, radius: 18,
  hp: 5, maxHp: 5, hpReserve: 0, bombs: 3, level: 1, xp: 0, heat: 0, angle: 0, invincible: 0,
  commandTargetId: null, commandTime: 0, commandCooldown: 0, dashTime: 0, dashCooldown: 0, dashVx: 0, dashVy: 0,
  perfectWindow: 0, shotCooldown: 0, specialCooldown: 0, idleTime: 0, heatLock: 0, overheated: false, focus: false });
const intent = (extra: Partial<AttackIntent> = {}): AttackIntent => ({ sourceId: 1, kind: 'line', x: 1500, y: 2000,
  angle: 0, range: 1600, width: 20, warning: 0.8, duration: 2, speed: 600, ...extra });
const context = (extra: Partial<ThreatContext> = {}): ThreatContext => ({ elapsed: 0, difficulty: 'normal', player: player(), ...extra });
const hazard = (extra: Partial<AreaHazard> = {}): AreaHazard => ({ id: 1, sourceId: 99, x: 2000, y: 2000, radius: 1200,
  warning: 0.2, warningDuration: 0.2, duration: 1, life: 1, active: false, kind: 'bombard', ...extra });
const enemy = (id: number, type: EnemyType = 'sniper'): Enemy => ({ id, type, x: 1500, y: 2000, prevX: 1500, prevY: 2000,
  vx: 0, vy: 0, radius: 36, hp: 10, maxHp: 10, speed: 60, angle: 0, state: 'chase', timer: 0, cooldown: 0,
  laserCooldown: 0, attackIndex: 0, hitTime: 0, lowHpSpoken: false, directionX: 0, directionY: 0 });
const bullet = (extra: Partial<Bullet> = {}): Bullet => ({ id: 1, owner: 'enemy', x: 1700, y: 2000, prevX: 1700, prevY: 2000,
  vx: 600, vy: 0, radius: 8, damage: 1, speed: 600, life: 4, color: 0xffffff, homing: false, lockRange: 0, targetId: null,
  remainingHits: 1, hitIds: new Set(), kind: 'normal', ...extra });

describe('bounded pressure and tactical composition', () => {
  it.each(['normal', 'hard'] as const)('%s alternates exact pressure and recovery durations without owning a clock', difficulty => {
    const d = new ThreatDirector(), cfg = THREAT_PACING[difficulty];
    expect(d.pace(0, difficulty)).toBe('pressure'); expect(d.pace(cfg.pressure - 0.001, difficulty)).toBe('pressure');
    expect(d.pace(cfg.pressure, difficulty)).toBe('breather');
    expect(d.pace(cfg.pressure + cfg.breather - 0.001, difficulty)).toBe('breather');
    expect(d.pace(cfg.pressure + cfg.breather, difficulty)).toBe('pressure');
  });
  it('produces 75/25 eligible composition and counts shield guards as tactical', () => {
    const d = new ThreatDirector(), pool: EnemyType[] = ['basic', 'dasher', 'sniper', 'sprayer', 'shield'];
    const selected = Array.from({ length: 100 }, (_, i) => d.selectSpawn(pool, [], (i + 0.5) / 100)!);
    expect(selected.filter(isTacticalEnemy)).toHaveLength(25);
    expect(new Set(selected)).toEqual(new Set(pool));
    expect(d.selectSpawn(['repairer', 'weaver'], [], 0.1)).toBe('repairer');
    expect(d.selectSpawn(['boss', 'mine', 'arm'], [], 0.1)).toBeNull();
  });
  it.each(['normal', 'hard'] as const)('%s counts queued tactical spawns before allowing another', difficulty => {
    const d = new ThreatDirector(), cap = d.tacticalCap(difficulty);
    const alive = [enemy(1, 'shield')], queued = Array.from({ length: cap - 1 }, () => ({ type: 'sniper' as const }));
    expect(d.selectSpawn(['basic', 'weaver'], alive, 0.95, difficulty, 0, queued)).toBe('basic');
    expect(d.selectSpawn(['weaver'], alive, 0.95, difficulty, 0, queued)).toBeNull();
    alive[0].hp = 0;
    expect(d.selectSpawn(['weaver'], alive, 0.95, difficulty, 0, queued)).toBe('weaver');
    expect(d.selectSpawn(['basic', 'weaver'], [], 0.95, difficulty, threatProfile(difficulty, 360).pressure)).toBe('basic');
  });
  it.each(['normal', 'hard'] as const)('%s still allows limited commitments in a breather', difficulty => {
    const d = new ThreatDirector(), cfg = THREAT_PACING[difficulty];
    for (let i = 0; i < cfg.breatherSlots; i++) expect(d.canCommit(intent({ sourceId: i + 1, kind: 'repair', duration: 3 }),
      context({ difficulty, elapsed: cfg.pressure + i * 0.3 }))).toBe(true);
    expect(d.canCommit(intent({ sourceId: 9, kind: 'repair' }), context({ difficulty, elapsed: cfg.pressure + 0.6 }))).toBe(false);
  });
});

describe('v6 fixed density curves', () => {
  it.each([1, 2, 3])('keeps 25%% tactical members across squads of %i before encounter caps', size => {
    const d = new ThreatDirector(), pool: EnemyType[] = ['basic', 'dasher', 'sniper', 'shield'];
    const leaders = Array.from({ length: 120 }, (_, i) => d.selectSpawn(pool, [], (i + 0.5) / 120, 'normal', 0, [], 360, size)!);
    expect(leaders.filter(isTacticalEnemy).length / (120 * size)).toBe(0.25);
    expect(new Set(leaders)).toEqual(new Set(pool));
  });
  it('raises formation size and tactical slots without reading any player statistics', () => {
    const progression = [0, 90, 180, 240, 300];
    expect(progression.map(p => threatProfile('normal', p).tacticalCap)).toEqual([1, 2, 3, 4, 5]);
    expect(progression.map(p => threatProfile('hard', p).slots)).toEqual([3, 4, 4, 5, 5]);
    expect(progression.map(p => threatProfile('normal', p).interval)).toEqual([1.1, 0.95, 0.85, 0.75, 0.65]);
    expect(Array.from({ length: 8 }, (_, index) => spawnPacketSize(300, index))).toEqual([2, 3, 3, 3, 2, 3, 3, 3]);
    expect(threatProfile('hard', 360).interval).toBeCloseTo(0.65 * 0.78);
  });
});

describe('known danger and short-route conflicts', () => {
  it('retains exact wall gap and finite line geometry instead of treating a whole screen as dangerous', () => {
    const wall = intent({ kind: 'wall', width: 896, gaps: [{ offset: 168, width: 64 }] });
    expect(pointInAttackIntent({ x: 1800, y: 2168 }, wall, 7)).toBe(false);
    expect(pointInAttackIntent({ x: 1800, y: 2188 }, wall, 7)).toBe(false);
    expect(pointInAttackIntent({ x: 1800, y: 2194 }, wall, 7)).toBe(true);
    expect(pointInAttackIntent({ x: 1450, y: 2000 }, wall, 7)).toBe(false);
  });
  it('allows escape from an isolated shot and rejects a future blast that closes every short route', () => {
    expect(hasSafeShortPath(intent(), context())).toBe(true);
    expect(hasSafeShortPath(intent(), context({ hazards: [hazard()] }))).toBe(false);
    expect(hasSafeShortPath(intent(), context({ hazards: [hazard({ warning: 3 })] }))).toBe(true);
    expect(hasSafeShortPath(intent(), context({ hazards: [hazard({ warning: 0, life: 0 })] }))).toBe(true);
  });
  it('does not make a slow fan instantly damage its full advertised range', () => {
    const fan = intent({ kind: 'fan', x: 2500, angle: Math.PI, width: 16, spread: 1.5, warning: 0.6, duration: 4, speed: 270, releaseDuration: 1.2 });
    expect(hasSafeShortPath(fan, context())).toBe(true);
    expect(hasSafeShortPath({ ...fan, speed: undefined }, context())).toBe(false);
  });
  it('sweeps a planned fast line between prediction samples instead of skipping its arrival', () => {
    const tiny = { x: 1982, y: 1982, width: 36, height: 36 };
    expect(hasSafeShortPath(intent({ warning: 0.8, speed: 3000 }), context({ arena: tiny }))).toBe(false);
  });
  it('includes already reserved future hazards and honors arena boundaries', () => {
    const reservation = intent({ sourceId: 2, kind: 'sample', x: 2000, width: 2400, startsAt: 0.2, endsAt: 3 });
    expect(hasSafeShortPath(intent(), context(), [reservation])).toBe(false);
    const tiny = { x: 1975, y: 1975, width: 50, height: 50 };
    expect(hasSafeShortPath(intent({ x: 1950, warning: 0.2, speed: undefined, width: 20 }), context({ arena: tiny }))).toBe(false);
  });
  it('forecasts finite pause/reversal projectiles without changing their source state', () => {
    const b = bullet({ vx: 0, speed: 0, programAngle: Math.PI, programIndex: 1, programAge: 0.5,
      programEntered: true, programSpeed: 600, program: [{ duration: 0.5, speed: 600 }, { duration: 0.6, speed: 0 }, { duration: 1, speed: 600, reverse: true }] });
    const before = structuredClone(b);
    hasSafeShortPath(intent(), context({ bullets: [b] }));
    expect(b).toEqual(before);
    const enclosing = bullet({ x: 2000, radius: 1000, vx: 0, speed: 0 });
    expect(hasSafeShortPath(intent(), context({ bullets: [enclosing] }))).toBe(false);
    enclosing.owner = 'player'; expect(hasSafeShortPath(intent(), context({ bullets: [enclosing] }))).toBe(true);
  });
  it('uses seven-unit projectile hitboxes and eighteen-unit body collisions', () => {
    const p = player(), tiny = { x: p.x - 18, y: p.y - 18, width: 36, height: 36 };
    const offset = bullet({ x: p.x, y: p.y + 16, vx: 0, speed: 0, radius: 8 });
    const away = intent({ x: 100, y: 100, range: 10, speed: undefined });
    expect(hasSafeShortPath(away, context({ arena: tiny, bullets: [offset] }))).toBe(true);
    offset.y = p.y + 15; expect(hasSafeShortPath(away, context({ arena: tiny, bullets: [offset] }))).toBe(false);
    const blocker = enemy(2); blocker.x = p.x; blocker.y = p.y + blocker.radius + 17;
    expect(hasSafeShortPath(away, context({ arena: tiny, enemies: [blocker] }))).toBe(false);
  });
});

describe('deferral and run-owned cleanup', () => {
  it('spreads expensive blocked requests over ticks without imposing conflict cooldown on budget waiters', () => {
    const d = new ThreatDirector(), blocked = context({ hazards: [hazard()] });
    expect(d.canCommit(intent({ sourceId: 1 }), blocked)).toBe(false);
    expect(d.canCommit(intent({ sourceId: 2 }), context())).toBe(false);
    expect(d.canCommit(intent({ sourceId: 2 }), context({ elapsed: 1 / 60 }))).toBe(true);
    expect(d.intents.map(i => i.sourceId)).toEqual([2]);
  });
  it('rechecks conflicts every .2 seconds and cancels an uncommitted request after one second', () => {
    const d = new ThreatDirector(), cancelled: number[] = [], ctx = context({ hazards: [hazard()], onDeferredCancel: id => cancelled.push(id) });
    expect(d.canCommit(intent(), ctx)).toBe(false);
    ctx.hazards = []; ctx.elapsed = 0.1; expect(d.canCommit(intent(), ctx)).toBe(false);
    ctx.elapsed = 0.2; expect(d.canCommit(intent(), ctx)).toBe(true);
    d.reset(); ctx.elapsed = 0; ctx.hazards = [hazard()];
    for (let tick = 0; tick <= 60; tick++) { ctx.elapsed = tick / 60; expect(d.canCommit(intent(), ctx)).toBe(false); }
    expect(cancelled).toEqual([1]); expect(d.intents).toHaveLength(0);
  });
  it('retains a stable readonly list while pruning expired/dead sources without a new request', () => {
    const d = new ThreatDirector(), source = enemy(1), list = d.intents;
    expect(d.canCommit(intent(), context({ enemies: [source] }))).toBe(true);
    expect(d.intents).toBe(list); expect(list).toHaveLength(1);
    d.update(4, [source]); expect(list).toHaveLength(0);
    expect(d.canCommit(intent(), context({ elapsed: 4, enemies: [source] }))).toBe(true);
    source.hp = 0; d.update(4.01, [source]); expect(list).toHaveLength(0);
    source.hp = 10; expect(d.canCommit(intent(), context({ elapsed: 5, enemies: [source] }))).toBe(true);
    d.cancel(1); expect(list).toHaveLength(0);
    expect(d.canCommit(intent(), context({ elapsed: 6, enemies: [source] }))).toBe(true);
    d.reset(); expect(list).toHaveLength(0); expect(d.canCommit(intent(), context())).toBe(true);
  });
  it('keeps selection and accepted attacks identical at 30/60/120/144 render Hz', () => {
    const run = (hz: number) => {
      const d = new ThreatDirector(), clock = new FixedClock(), accepted: number[] = [], spawns: (EnemyType | null)[] = [];
      let tick = 0;
      for (let frame = 0; frame <= hz * 20; frame++) clock.advance(frame * 1000 / hz, () => {
        tick++; const elapsed = tick / 60; d.update(elapsed);
        if (tick % 15 === 0 && d.canCommit(intent({ sourceId: tick, kind: 'repair', duration: 0.6 }), context({ elapsed }))) accepted.push(tick);
        if (tick % 60 === 0) spawns.push(d.selectSpawn(['basic', 'shield'], [], 0.9, 'normal', elapsed));
      });
      return { accepted, spawns, pending: d.intents };
    };
    const expected = run(60); expect(expected.accepted.length).toBeGreaterThan(20);
    for (const hz of [30, 120, 144]) expect(run(hz)).toEqual(expected);
  });
});
