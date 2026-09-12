import { describe, expect, it } from 'vitest';
import { GameSimulation } from './simulation';
import { STEP } from './config';
import { FixedClock } from './clock';
import type { Bullet, InputAction, ModuleId } from './types';

const input = (extra: Partial<InputAction> = {}): InputAction => ({ moveX: 0, moveY: 0, aimX: 3000, aimY: 2000, shoot: false, bomb: false, dash: false, ...extra });
const shot = (extra: Partial<Bullet> = {}): Bullet => ({ id: 9999, owner: 'player', x: 2200, y: 2000, prevX: 2200, prevY: 2000,
  vx: 0, vy: 0, speed: 0, radius: 4, damage: extra.owner === 'enemy' ? 1 : 2, color: 0xffffff, life: 2, homing: false, lockRange: 0,
  targetId: null, remainingHits: 1, hitIds: new Set(), kind: 'normal', ...extra });
function run(modules: ModuleId[] = [], level = 7, companions = 0) {
  const sim = new GameSimulation(400);
  sim.reset('story', 400, 'normal', { season: 's2', carryover: { level, xp: 20, companions } });
  sim.chooseUpgrade(sim.state.build.choices[0]); sim.state.build.modules = [...modules];
  sim.state.spawnTimer = 99999; sim.state.player.invincible = 99999;
  return sim;
}
function ticks(sim: GameSimulation, n: number, controls = input()) { for (let i = 0; i < n; i++) sim.step(controls); }
function target(sim: GameSimulation, x = 2200, y = 2000, hp = 1000) {
  const enemy = sim.spawnEnemy('basic', x, y)!; enemy.hp = enemy.maxHp = hp; enemy.speed = 0;
  return enemy;
}
function hit(sim: GameSimulation, enemy: ReturnType<typeof target>, kind: Bullet['kind'], damage = 2) {
  sim.state.bullets.push(shot({ id: 9999 + sim.state.tick, kind, x: enemy.x, y: enemy.y, damage }));
  sim.step(input());
}

describe('v4 combat modules use non-recursive sources', () => {
  it('adds pierce and two wings without another ammunition or heat charge; precision requires continuous focus', () => {
    const sim = run(['piercing', 'wingShots', 'precision']);
    sim.state.player.specialCooldown = 999;
    ticks(sim, 21, input({ focus: true }));
    sim.step(input({ focus: true, shoot: true }));
    const rounds = sim.state.bullets.filter(b => b.owner === 'player');
    expect(rounds.filter(b => b.kind === 'module')).toHaveLength(2);
    expect(rounds.filter(b => b.kind === 'normal').every(b => b.damage === 2.4 && b.remainingHits >= 2)).toBe(true);
    expect(sim.state.player.ammo).toBe(119);
    sim.clearInput(); sim.state.player.shotCooldown = 0;
    sim.step(input({ shoot: true }));
    expect(sim.state.bullets.filter(b => b.bornTick === sim.state.tick && b.kind === 'normal').every(b => b.damage === 2)).toBe(true);
  });
  it('only a main shot kill shatters, at most once per 0.45 seconds', () => {
    const sim = run(['shatter']); sim.state.player.specialCooldown = 999;
    hit(sim, target(sim, 2200, 2000, 1), 'module', 5);
    expect(sim.state.bullets.filter(b => b.kind === 'module')).toHaveLength(0);
    hit(sim, target(sim, 2300, 2000, 1), 'normal', 5);
    expect(sim.state.bullets.filter(b => b.kind === 'module')).toHaveLength(6);
    hit(sim, target(sim, 2400, 2000, 1), 'normal', 5);
    expect(sim.state.bullets.filter(b => b.kind === 'module')).toHaveLength(6);
    ticks(sim, 25); expect(sim.state.bullets.filter(b => b.kind === 'module')).toHaveLength(0);
  });
  it('a special hit chains to exactly two additional targets; chains do not shatter', () => {
    const sim = run(['chain', 'shatter']); sim.state.player.specialCooldown = 999;
    const first = target(sim), second = target(sim, 2270), third = target(sim, 2200, 2100), outside = target(sim, 2700);
    hit(sim, first, 'special', 10);
    expect([first.hp, second.hp, third.hp, outside.hp]).toEqual([990, 995, 995, 1000]);
    expect(sim.state.bullets.some(b => b.kind === 'module')).toBe(false);
  });
  it('twelve base drone hits earn one burst, while module hits cannot build the meter', () => {
    const sim = run(['droneBurst', 'slow']); sim.state.player.specialCooldown = 999; const enemy = target(sim);
    for (let i = 0; i < 12; i++) hit(sim, enemy, 'module');
    expect(sim.state.bullets).toHaveLength(0);
    for (let i = 0; i < 12; i++) hit(sim, enemy, 'drone');
    const burst = sim.state.bullets.find(b => b.kind === 'module');
    expect(burst).toMatchObject({ damage: 12, remainingHits: 1 }); expect(burst?.hitIds.has(enemy.id)).toBe(true);
    expect(enemy.slowUntil).toBeCloseTo(sim.state.elapsed + 0.8);
    for (let i = 0; i < 12; i++) hit(sim, enemy, 'drone');
    expect(sim.state.bullets.filter(b => b.kind === 'module')).toHaveLength(1);
  });
  it('interception stores one charge and orbit blades share a target cooldown', () => {
    const sim = run(['intercept', 'orbitBlade'], 7, 3); sim.state.player.specialCooldown = 999;
    const enemy = target(sim, 2000, 2000); enemy.radius = 150;
    for (const companion of sim.state.companions) companion.shotCooldown = 999;
    sim.state.bullets.push(shot({ owner: 'enemy', x: 2040, radius: 6 }));
    sim.step(input()); expect(sim.state.bullets.filter(b => b.owner === 'enemy')).toHaveLength(0);
    const hp = enemy.hp; ticks(sim, 12); expect(enemy.hp).toBe(hp);
    sim.state.bullets.push(shot({ owner: 'enemy', x: 2040 }));
    sim.step(input()); expect(sim.state.bullets.some(b => b.owner === 'enemy')).toBe(true);
  });
  it('prism side beams cannot damage main-beam victims a second time or clear extra bullets', () => {
    const sim = run(['prism']); sim.state.player.specialCooldown = 999;
    const main = target(sim, 2600, 2000), side = target(sim, 2900, 2127); main.radius = side.radius = 18;
    sim.state.player.perfectWindow = 0.5;
    sim.state.bullets.push(shot({ owner: 'enemy', x: 2900, y: 2127 }));
    sim.step(input({ shoot: true }));
    expect(main.hp).toBe(960); expect(side.hp).toBe(988);
    expect(sim.state.beams).toHaveLength(3);
    expect(sim.state.bullets.some(b => b.owner === 'enemy')).toBe(true);
  });
  it('releases per-target blade cooldowns when a live enemy is removed by an encounter boundary', () => {
    const sim = run(['orbitBlade'], 7, 3);
    const enemy = target(sim, 2000, 2000); enemy.radius = 150;
    for (const companion of sim.state.companions) companion.shotCooldown = 999;
    sim.step(input());
    const memory = (sim as unknown as { bladeTimes: Map<number, number> }).bladeTimes;
    expect(memory.has(enemy.id)).toBe(true);
    sim.spawnEnemy('boss', 2000, 1780);
    expect(memory.size).toBe(0);
  });
});

describe('v4 resource state, collision core and progression', () => {
  it('uses radius 7 for enemy bullets and radius 18 for bodies, with a disjoint graze band', () => {
    const sim = run(['graze']); const p = sim.state.player; p.invincible = 0; p.ammo = 50; p.heat = 50; p.idleTime = 0;
    sim.state.bullets.push(shot({ owner: 'enemy', x: 2020, radius: 6, life: 10 }));
    sim.step(input()); expect(p.hp).toBe(5); expect(p.ammo).toBe(51);
    ticks(sim, 5); expect(p.ammo).toBe(51);
    sim.state.bullets.push(shot({ owner: 'enemy', x: 2012, radius: 6 }));
    sim.step(input()); expect(p.hp).toBe(4);
    p.invincible = 0; target(sim, 2030, 2000).radius = 18;
    sim.step(input()); expect(p.hp).toBe(3);
  });
  it('caps bombs at five and converts all surplus units into thirty XP each', () => {
    const sim = run(); const p = sim.state.player; p.bombs = 4; p.xp = 0;
    sim.state.pickups.push({ id: 991, x: p.x, y: p.y, type: 'bomb', value: 4, age: 0 });
    sim.step(input()); expect(p.bombs).toBe(5); expect(p.xp).toBe(90);
  });
  it('revives once, keeps the inherited level floor and does not reset the consumed revive in endless', () => {
    const sim = run(['revive']); const p = sim.state.player;
    const lethal = () => { p.hp = 1; p.invincible = 0; sim.state.bullets.push(shot({ owner: 'enemy', x: p.x, y: p.y })); sim.step(input()); };
    lethal(); expect(p.hp).toBe(1); expect(p.invincible).toBeCloseTo(0.8); expect(p.level).toBe(7);
    sim.state.status = 'complete'; sim.continueEndless(); lethal(); expect(sim.state.status).toBe('failed');
  });
  it('earns only local resonance at level ten and clears it on a season retry', () => {
    const sim = run([], 10); const p = sim.state.player; p.xp = 0;
    sim.state.pickups.push({ id: 990, type: 'xp', value: 2500, age: 0, x: p.x, y: p.y });
    sim.step(input()); expect(sim.state.build).toMatchObject({ resonance: 4, resonanceXp: 0 });
    sim.reset('story', 400, 'normal', { season: 's2', carryover: { level: 7, xp: 20, companions: 1 } });
    expect(sim.state.build).toMatchObject({ resonance: 0, modules: [], levelFloor: 7 });
  });
  it('recharges two dashes sequentially, applies vent once and preserves heat lock', () => {
    const sim = run(['vent']);
    sim.state.build.choices = ['doubleDash']; sim.state.status = 'upgrade'; sim.chooseUpgrade('doubleDash');
    const p = sim.state.player; p.heat = 80; p.heatLock = 5; p.overheated = true;
    sim.step(input({ dash: true })); ticks(sim, 11); expect(sim.dashCharges).toBe(1); expect(p.heat).toBeLessThanOrEqual(55); expect(p.overheated).toBe(true);
    sim.step(input({ dash: true })); expect(sim.dashCharges).toBe(0);
    ticks(sim, 144); expect(sim.dashCharges).toBe(1);
    ticks(sim, 156); expect(sim.dashCharges).toBe(2);
  });
  it('pauses seven offers, commits once, requires both minibosses, and puts choice seven before the final', () => {
    const sim = new GameSimulation(400); sim.reset('story', 400, 'normal', { season: 's2', carryover: { level: 7, xp: 20, companions: 3 } });
    let offers = 0;
    for (let stage = 1; stage <= 6; stage++) {
      expect(sim.state.status).toBe('upgrade'); const tick = sim.state.tick;
      sim.step(input({ shoot: true })); expect(sim.state.tick).toBe(tick);
      const choice = sim.state.build.choices[0]; expect(sim.chooseUpgrade(choice)).toBe(true); expect(sim.chooseUpgrade(choice)).toBe(false); offers++;
      sim.state.player.invincible = 99999; sim.state.spawnTimer = 99999; sim.state.waveTime = 75 - STEP;
      sim.step(input());
      if (stage === 2 || stage === 4) {
        expect(sim.state.status).toBe('playing'); expect(sim.isWaveBlocked()).toBe(true); ticks(sim, 100);
        const boss = sim.state.enemies.find(e => e.role === 'miniboss')!; expect(boss).toBeTruthy();
        const hp = sim.state.player.hp; sim.damageEnemy(boss, 1e9); expect(sim.state.player.hp).toBeGreaterThanOrEqual(hp);
      }
      expect(sim.state.status).toBe('upgrade');
    }
    expect(sim.state.enemies.some(e => e.type === 'boss')).toBe(false);
    sim.chooseUpgrade(sim.state.build.choices[0]); offers++;
    expect(offers).toBe(7); expect(sim.state.bossPending).toBe(true); ticks(sim, 120);
    expect(sim.state.enemies.find(e => e.type === 'boss')?.archetypeId).toBe('lacuna');
  });
  it('module cooldowns, limited homing, dash inventory and simulation clocks agree at 30/60/120/144 Hz', () => {
    const results = [30, 60, 120, 144].map(hz => {
      const sim = run(['droneHoming', 'droneBurst', 'vent', 'reserveAmmo', 'intercept'], 7, 3);
      sim.state.build.choices = ['doubleDash']; sim.state.status = 'upgrade'; sim.chooseUpgrade('doubleDash');
      target(sim, 2400).hp = 99999;
      const clock = new FixedClock();
      for (let frame = 0; frame <= hz * 8; frame++) clock.advance(frame * 1000 / hz, dt => { sim.step(input({ shoot: true, dash: sim.state.tick % 120 === 0 }), dt); });
      return { p: sim.state.player, tick: sim.state.tick, charges: sim.dashCharges, shots: sim.state.bullets, companions: sim.state.companions };
    });
    for (const result of results.slice(1)) expect(result).toEqual(results[0]);
  });
});
