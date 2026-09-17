import { describe, expect, it } from 'vitest';
import { BALANCE, ENEMIES, STEP, xpNeeded } from './config';
import { FixedClock } from './clock';
import { beamGeometry, pointInBeam, SeededRandom, segmentCircleHit, SpatialGrid } from './math';
import { ObjectPool } from './pool';
import { GameSimulation } from './simulation';
import { SPELL_CARDS } from './spellcards';
import { CAMPAIGN_STAGES, ENCOUNTERS } from './campaign';
import { MODULES } from './upgrades';
import type { Bullet, EnemyType, InputAction, PickupType } from './types';

const idle = (extra: Partial<InputAction> = {}): InputAction => ({ moveX: 0, moveY: 0, aimX: 3500, aimY: 2000, shoot: false, dash: false, bomb: false, ...extra });
function ticks(sim: GameSimulation, count: number, input = idle()) {
  const events = [];
  for (let i = 0; i < count; i++) events.push(...sim.step(input));
  return events;
}
function finishChoices(sim: GameSimulation) {
  while (sim.state.status === 'upgrade') {
    const choice = sim.state.build.choices.find(id => id in MODULES && MODULES[id as keyof typeof MODULES].branch !== 'drone') ?? sim.state.build.choices[0];
    expect(sim.chooseUpgrade(choice, sim.state.build.offerId ?? undefined)).toBe(true);
  }
}
function quiet(seed = 12345): GameSimulation {
  const sim = new GameSimulation(seed);
  sim.state.spawnTimer = 1e9;
  sim.state.player.invincible = 1e9;
  return sim;
}
function bullet(extra: Partial<Bullet> = {}): Bullet {
  return { id: 10000, x: 2000, y: 2000, prevX: 2000, prevY: 2000, vx: 1000, vy: 0, radius: 4,
    owner: 'player', damage: extra.owner === 'enemy' ? 1 : 2, life: 10, color: 0xffffff, homing: false, speed: 1000, lockRange: 300,
    targetId: null, remainingHits: 1, hitIds: new Set(), kind: 'normal', ...extra };
}
function defeatFinal(sim: GameSimulation) {
  const boss = sim.state.enemies.find(e => e.type === 'boss')!;
  for (let card = 0; card < 6; card++) {
    ticks(sim, 50); expect(boss.spell!.cardIndex).toBe(card);
    sim.damageEnemy(boss, 1e9);
  }
}

describe('deterministic fixed-step combat', () => {
  it('produces the same movement, shots, cooldowns, and wave at 30/60/120/144 Hz', () => {
    const results = [30, 60, 120, 144].map(hz => {
      const sim = quiet(531); const clock = new FixedClock(); let shots = 0;
      for (let frame = 0; frame <= hz * 61; frame++) {
        clock.advance(frame * 1000 / hz, dt => {
          const t = sim.state.tick;
          const events = sim.step(idle({ moveX: t % 120 < 60 ? 1 : -1, moveY: t % 240 < 120 ? 1 : -1, shoot: t % 240 < 120, dash: t % 240 === 0 }), dt);
          shots += events.filter(e => e.type === 'shot').length;
        });
      }
      return { x: sim.state.player.x, y: sim.state.player.y, shots, cooldown: sim.state.player.dashCooldown, wave: sim.state.wave, tick: sim.state.tick };
    });
    expect(results[0].wave).toBe(1);
    expect(results.every(result => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true);
  });
  it('normalizes diagonals and responds on the first tick without an overheat movement penalty', () => {
    const horizontal = quiet(), diagonal = quiet();
    horizontal.state.player.heat = 100; horizontal.state.player.overheated = true;
    ticks(horizontal, 60, idle({ moveX: 1 }));
    ticks(diagonal, 60, idle({ moveX: 1, moveY: 1 }));
    expect(horizontal.state.player.x - 2000).toBeCloseTo(300, 8);
    expect(Math.hypot(diagonal.state.player.x - 2000, diagonal.state.player.y - 2000)).toBeCloseTo(300, 8);
    const fresh = quiet(); const first = fresh.step(idle({ moveX: 1, shoot: true }));
    expect(fresh.state.player.x).toBe(2005);
    expect(first.filter(e => e.type === 'shot')).toHaveLength(1);
    expect(fresh.state.player.heat).toBeCloseTo(BALANCE.heat.rate * STEP);
  });
  it('fires Lv1 six times per second and captures damage before a later level change', () => {
    const sim = quiet(); const events = ticks(sim, 60, idle({ shoot: true }));
    expect(events.filter(e => e.type === 'shot')).toHaveLength(6);
    expect(sim.state.bullets.every(b => b.damage === 2)).toBe(true);
    sim.state.player.level = 10;
    expect(sim.state.bullets.every(b => b.damage === 2)).toBe(true);
  });
  it('locks a stationary dash toward aim and integrates its partial final frame', () => {
    const sim = quiet();
    sim.step(idle({ dash: true }));
    ticks(sim, 10, idle({ aimX: 0, aimY: 0 }));
    expect(sim.state.player.x - 2000).toBeCloseTo(1080 * 0.18, 7);
    expect(sim.state.player.y).toBe(2000);
    expect(sim.state.player.dashTime).toBe(0);
    expect(sim.state.player.perfectWindow).toBeCloseTo(BALANCE.dash.window);
    const events = sim.step(idle({ shoot: true }));
    expect(events.find(e => e.type === 'beam')?.amount).toBe(BALANCE.dash.damage);
    expect(sim.state.beams[0]).toMatchObject({ length: 2400, width: 88, life: 0.32 });
    expect(sim.state.bullets).toHaveLength(0);
    expect(sim.state.player.perfectWindow).toBe(0);
  });
  it('uses movement direction for a dash and consumes held bomb/dash only once', () => {
    const sim = quiet();
    const events = ticks(sim, 240, idle({ moveY: -1, bomb: true, dash: true }));
    expect(events.filter(e => e.type === 'bomb')).toHaveLength(1);
    expect(events.filter(e => e.type === 'dash')).toHaveLength(1);
    expect(sim.state.player.bombs).toBe(2);
    expect(sim.state.player.y).toBeLessThan(2000);
    sim.step(idle());
    expect(sim.step(idle({ bomb: true, dash: true })).filter(e => e.type === 'bomb' || e.type === 'dash')).toHaveLength(2);
  });
  it('accepts fresh dash/bomb presses after pause clears simulation input history', () => {
    const sim = quiet();
    ticks(sim, 181, idle({ dash: true, bomb: true }));
    expect(sim.state.player.bombs).toBe(2);
    sim.clearInput();
    const events = sim.step(idle({ dash: true, bomb: true }));
    expect(events.filter(e => e.type === 'dash' || e.type === 'bomb')).toHaveLength(2);
    expect(sim.state.player.bombs).toBe(1);
  });
  it('fires the dash reward immediately even if the ordinary weapon is cooling down', () => {
    const sim = quiet();
    sim.state.player.perfectWindow = BALANCE.dash.window;
    sim.state.player.shotCooldown = 0.15;
    const events = sim.step(idle({ shoot: true }));
    expect(events.filter(e => e.type === 'beam' && e.amount === 40)).toHaveLength(1);
    expect(sim.state.player.perfectWindow).toBe(0);
  });
  it('overheats after four seconds, cools only after the idle delay and requires the full lock plus unlock temperature', () => {
    const sim = quiet();
    ticks(sim, 240, idle({ shoot: true }));
    expect(sim.state.player.overheated).toBe(true);
    expect(sim.state.player.heat).toBe(100);
    expect(sim.state.player.heatLock).toBeCloseTo(1.2);
    ticks(sim, 9);
    expect(sim.state.player.heat).toBeCloseTo(100);
    ticks(sim, 6);
    expect(sim.state.player.heat).toBeCloseTo(95);
    ticks(sim, 1);
    expect(sim.state.player.heat).toBeCloseTo(95 - 50 / 60);
    ticks(sim, 56);
    expect(sim.state.player.overheated).toBe(true); // minimum lock elapsed; heat remains above 35
    ticks(sim, 15);
    expect(sim.state.player.overheated).toBe(false);
    expect(sim.state.player.heat).toBeCloseTo(35);
  });
  it('unlocks the automatic special at Lv4 without adding heat', () => {
    const sim = quiet(); const enemy = sim.spawnEnemy('sprayer', 2200, 2000)!;
    enemy.speed = 0; enemy.cooldown = 1e9;
    sim.state.player.level = 3;
    ticks(sim, 25);
    expect(sim.state.bullets).toHaveLength(0);
    sim.state.player.level = 4;
    const events = ticks(sim, 19);
    expect(events.filter(e => e.type === 'shot' && e.amount === 10)).toHaveLength(1);
    expect(sim.state.player.heat).toBe(0);
    expect(sim.state.bullets.filter(b => b.kind === 'special')).toHaveLength(1);
    expect(sim.state.player.specialCooldown).toBeCloseTo(3);
    expect(sim.state.bullets.find(b => b.kind === 'special')?.remainingHits).toBe(1);
  });
});

describe('swept collision, hazards, and pools', () => {
  it('finds an intersection even when a fast bullet crosses a whole enemy in one tick', () => {
    const sim = quiet(), enemy = sim.spawnEnemy('basic', 2120, 2000)!;
    enemy.speed = 0;
    sim.state.bullets.push(bullet({ vx: 18000, speed: 18000, damage: 6 }));
    const events = sim.step(idle());
    expect(events.some(e => e.type === 'kill' && e.targetId === enemy.id)).toBe(true);
    expect(sim.state.enemies).toHaveLength(0);
  });
  it('sorts impacts by travel order and never damages one target twice with a piercing bullet', () => {
    const sim = quiet(), farther = sim.spawnEnemy('sprayer', 2250, 2000)!, nearer = sim.spawnEnemy('sprayer', 2120, 2000)!;
    farther.speed = nearer.speed = 0; farther.cooldown = nearer.cooldown = 1e9;
    const shot = bullet({ vx: 18000, speed: 18000, remainingHits: 20, damage: 20 });
    sim.state.bullets.push(shot);
    const hits = sim.step(idle()).filter(e => e.type === 'hit');
    expect(hits.map(e => e.targetId)).toEqual([nearer.id, farther.id]);
    expect(nearer.hp).toBe(ENEMIES.sprayer.hp - 20); expect(farther.hp).toBe(ENEMIES.sprayer.hp - 20);
    shot.x = shot.prevX = nearer.x; shot.vx = 0;
    ticks(sim, 5);
    expect(nearer.hp).toBe(ENEMIES.sprayer.hp - 20);
    expect(shot.hitIds.size).toBe(2);
  });
  it('allows full-world sprayer range and recycles only at the world edge', () => {
    const sim = quiet();
    sim.state.bullets.push(bullet({ owner: 'enemy', x: 10, prevX: 10, vx: 240, life: Infinity }));
    ticks(sim, 600);
    expect(sim.state.bullets).toHaveLength(1);
    expect(sim.state.bullets[0].x).toBeCloseTo(2410);
    ticks(sim, 420);
    expect(sim.state.bullets).toHaveLength(0);
  });
  it('clears enemy bullets globally while restricting bomb damage to the local square', () => {
    const sim = quiet();
    const near = sim.spawnEnemy('basic', 2100, 2000)!, far = sim.spawnEnemy('basic', 3400, 2000)!;
    sim.state.bullets.push(bullet({ owner: 'enemy', x: 10, y: 10, vx: 0 }), bullet({ owner: 'player', x: 10, y: 10, vx: 0 }));
    sim.step(idle({ bomb: true }));
    expect(near.hp).toBe(0); expect(far.hp).toBe(far.maxHp);
    expect(sim.state.bullets).toHaveLength(1);
    expect(sim.state.bullets[0].owner).toBe('player');
  });
  it('shares exact beam geometry for telegraph and circle/rectangle damage', () => {
    const beam = beamGeometry(10, 20, Math.PI / 2, 100, 20);
    expect(beam.corners).toHaveLength(8);
    expect(beam.endX).toBeCloseTo(10); expect(beam.endY).toBeCloseTo(120);
    expect(pointInBeam(10, 80, 0, beam)).toBe(true);
    expect(pointInBeam(25, 80, 4, beam)).toBe(false);
    expect(pointInBeam(25, 80, 5, beam)).toBe(true);
    expect(pointInBeam(10, 10, 5, beam)).toBe(false);
    expect(segmentCircleHit(0, 0, 100, 0, 50, 0, 10)).toBeCloseTo(0.4);
    expect(segmentCircleHit(0, 0, 0, 0, 0, 0, 1)).toBe(0);
    expect(segmentCircleHit(0, 0, 0, 0, 10, 0, 1)).toBe(null);
  });
  it('reuses objects with reset state and bounds retained storage', () => {
    const pool = new ObjectPool(() => ({ value: 0 }), item => { item.value = 0; }, 2);
    const a = pool.acquire(), b = pool.acquire(), c = pool.acquire();
    a.value = 99; pool.release(a); pool.release(b); pool.release(c);
    expect(pool.size).toBe(2); expect(pool.created).toBe(3);
    pool.acquire(); expect(pool.acquire()).toBe(a); expect(a.value).toBe(0);
    pool.clear(); expect(pool.size).toBe(0);
  });
  it('finds center-grid candidates without duplicates across adjacent cells', () => {
    const grid = new SpatialGrid<{ x: number; y: number }>(100), out: { x: number; y: number }[] = [];
    grid.insert({ x: 99, y: 99 }); grid.insert({ x: 101, y: 101 });
    expect(grid.query(90, 90, 110, 110, out)).toHaveLength(2);
    grid.clear(); expect(grid.query(0, 0, 200, 200, out)).toHaveLength(0);
  });
});

describe('progression, drops, and lifecycle', () => {
  it('keeps XP overflow across multiple level gains and caps damage XP loss without lowering the gained level', () => {
    const sim = quiet(); const p = sim.state.player;
    sim.state.pickups.push({ id: 10001, type: 'xp', x: p.x, y: p.y, value: 280, age: 0 });
    sim.step(idle());
    expect(p.level).toBe(3); expect(p.xp).toBe(20);
    finishChoices(sim);
    p.invincible = 0;
    sim.state.bullets.push(bullet({ owner: 'enemy', x: p.x, y: p.y, vx: 0, speed: 0 }));
    sim.step(idle());
    expect(p.hp).toBe(4); expect(p.level).toBe(3);
    expect(p.xp).toBe(0);
    p.invincible = 0; p.xp = 200;
    sim.state.bullets.push(bullet({ owner: 'enemy', x: p.x, y: p.y, vx: 0, speed: 0 }));
    sim.step(idle());
    expect(p.level).toBe(3); expect(p.xp).toBe(200 - Math.floor(xpNeeded(3) * BALANCE.xp.loss));
  });
  it('supports all seven pickup types including global attraction and homing burst', () => {
    const sim = quiet(); const p = sim.state.player;
    p.hp = 2; p.dashCooldown = 2; p.commandCooldown = 2; p.heat = 90; p.overheated = true;
    const types: PickupType[] = ['xp', 'hp', 'bomb', 'supply', 'coolant', 'miniBomb', 'blackHole'];
    types.forEach((type, i) => sim.state.pickups.push({ id: 11000 + i, x: p.x, y: p.y, type, value: type === 'xp' ? 10 : 1, age: 0 }));
    const events = sim.step(idle());
    expect(events.filter(e => e.type === 'pickup')).toHaveLength(7);
    expect(p).toMatchObject({ hp: 3, heat: 0, overheated: false, bombs: 4, xp: 10 });
    expect(p.dashCooldown).toBeCloseTo(1 - STEP);
    expect(sim.state.blackHoleTime).toBe(3);
    expect(sim.state.bullets.filter(b => b.kind === 'burst')).toHaveLength(25);
    sim.state.pickups.push({ id: 12000, x: 100, y: 100, type: 'xp', value: 30, age: 0 });
    ticks(sim, 30);
    expect(sim.state.pickups).toHaveLength(0); expect(p.xp).toBe(40);
  });
  it('retains stacked refill rewards when full and redeems one dose per refill', () => {
    const sim = quiet(), p = sim.state.player;
    sim.state.pickups.push({ id: 20002, type: 'coolant', value: 3, age: 0, x: p.x, y: p.y },
      { id: 20003, type: 'hp', value: 3, age: 0, x: p.x, y: p.y });
    expect(sim.step(idle()).filter(e => e.type === 'pickup')).toHaveLength(0);
    expect(sim.state.pickups.map(item => item.value)).toEqual([3, 3]);
    p.heat = 80; p.overheated = true; p.heatLock = 1; p.hp = 4;
    const events = sim.step(idle()).filter(e => e.type === 'pickup');
    expect(events.map(e => e.amount)).toEqual([1, 1]);
    expect(p).toMatchObject({ heat: 0, overheated: false, heatLock: 0, hp: 5 });
    expect(sim.state.pickups.map(item => item.value)).toEqual([2, 2]);
    expect(sim.step(idle()).filter(e => e.type === 'pickup')).toHaveLength(0);
    p.heat = 30; p.hp = 3;
    sim.step(idle());
    expect(sim.state.pickups.map(item => [item.type, item.value])).toEqual([['coolant', 1]]);
    p.heat = 30;
    sim.step(idle());
    expect(sim.state.pickups).toHaveLength(0);
  });
  it('adds every stacked black-hole duration without overwriting an active attraction', () => {
    const sim = quiet(), p = sim.state.player;
    sim.state.blackHoleTime = 2;
    sim.state.pickups.push({ id: 20004, type: 'blackHole', value: 3, age: 0, x: p.x, y: p.y });
    const events = sim.step(idle());
    expect(sim.state.blackHoleTime).toBeCloseTo(2 - STEP + 3 * 3);
    expect(events.find(e => e.type === 'pickup')?.amount).toBe(3);
    expect(sim.state.pickups).toHaveLength(0);
  });
  it('redeems every stacked skill-supply dose and converts only wholly unused doses into XP', () => {
    const sim = quiet(), p = sim.state.player; p.dashCooldown = 2.5; p.commandCooldown = 0.5; p.xp = 0;
    sim.state.pickups.push({ id: 20006, type: 'supply', value: 4, age: 0, x: p.x, y: p.y });
    const events = sim.step(idle());
    expect(p.dashCooldown).toBe(0); expect(p.xp).toBe(20);
    expect(events.find(e => e.type === 'pickup' && e.pickupType === 'supply')?.amount).toBe(4);
    expect(sim.state.pickups).toHaveLength(0);
  });
  it('defers mini-bomb rewards at bullet capacity and eventually emits every stored burst', () => {
    const sim = quiet(), p = sim.state.player;
    for (let i = 0; i < BALANCE.limits.bullets - 6; i++) sim.state.bullets.push(bullet({ id: 30000 + i, owner: 'enemy', x: 100, y: 100, vx: 0, speed: 0, life: Infinity }));
    sim.state.pickups.push({ id: 20005, type: 'miniBomb', value: 5, age: 0, x: p.x, y: p.y });
    expect(sim.step(idle()).filter(e => e.type === 'pickup')).toHaveLength(0);
    expect(sim.state.pickups[0].value).toBe(5);
    sim.step(idle({ bomb: true }));
    expect(sim.state.bullets.filter(b => b.kind === 'burst')).toHaveLength(100);
    expect(sim.state.pickups[0].value).toBe(1);
    sim.step(idle());
    expect(sim.state.bullets.filter(b => b.kind === 'burst')).toHaveLength(125);
    expect(sim.state.pickups).toHaveLength(0);
  });
  it('merges nearby XP drops without losing rewards', () => {
    const sim = quiet(79);
    for (let i = 0; i < 100; i++) {
      const enemy = sim.spawnEnemy('basic', 1000, 1000)!;
      sim.damageEnemy(enemy, 99999);
    }
    const xp = sim.state.pickups.filter(p => p.type === 'xp');
    expect(xp).toHaveLength(1);
    expect(xp[0].value).toBeGreaterThan(100);
    expect(xp[0].value).toBe(1000);
    expect(sim.state.pickups.some(pickup => pickup.type !== 'xp')).toBe(true);
  });
  it('introduces all enemy types with wave balance and keeps mine health at one in endless', () => {
    const sim = quiet(); sim.state.wave = 5; sim.state.campaign.progression = 360;
    expect(sim.spawnEnemy('basic', 100, 100)!.hp).toBe(24);
    expect(sim.spawnEnemy('dasher', 100, 100)!.hp).toBe(56);
    const types: EnemyType[] = ['sniper', 'sprayer', 'minelayer', 'mine'];
    for (const type of types) expect(sim.spawnEnemy(type, 100, 100)!.type).toBe(type);
    sim.reset('endless'); sim.state.wave = 50;
    expect(sim.spawnEnemy('mine', 100, 100)!.hp).toBe(1);
  });
  it('gates all five encounters and continues at endless wave six only after the final six-card Boss', () => {
    const sim = quiet();
    for (let index = 0; index < CAMPAIGN_STAGES.length; index++) {
      sim.state.waveTime = CAMPAIGN_STAGES[index].duration - STEP;
      sim.step(idle()); ticks(sim, 120);
      const encounter = sim.state.enemies.find(e => e.role === 'miniboss' || e.role === 'boss')!;
      expect(encounter.encounterId).toBe(ENCOUNTERS[index]);
      if (encounter.type === 'boss') {
        expect(Math.hypot(sim.state.player.x - encounter.x, sim.state.player.y - encounter.y)).toBeGreaterThan(350);
        expect(sim.state.player.heat).toBe(0); defeatFinal(sim);
      } else sim.damageEnemy(encounter, 1e9);
      if (index < 4) { expect(sim.state.status).toBe('upgrade'); finishChoices(sim); expect(sim.state.status).toBe('playing'); }
    }
    expect(sim.state.status).toBe('complete'); expect(sim.state.campaign.progression).toBe(360);
    sim.continueEndless();
    expect(sim.state).toMatchObject({ status: 'playing', mode: 'endless', wave: 6, bossStage: false, bossPending: false });
    expect(sim.state.player.hp).toBe(5);
  });
  it('settles existing XP before Boss entry and preserves unusable resources inside the arena', () => {
    const sim = quiet(), p = sim.state.player;
    sim.state.pickups.push({ id: 888, type: 'xp', value: 500, age: 0, x: 1000, y: 1000 },
      { id: 889, type: 'hp', value: 3, age: 0, x: 1500, y: 1500 }, { id: 890, type: 'coolant', value: 2, age: 0, x: 1500, y: 1500 });
    const boss = sim.spawnEnemy('boss', 0, 0, 's2:final')!;
    expect(p.level).toBe(4); expect(p.xp).toBe(10);
    expect(sim.state.pickups.map(item => [item.type, item.value, item.x, item.y])).toEqual([['hp', 3, p.x, p.y], ['coolant', 2, p.x, p.y]]);
    sim.step(idle()); finishChoices(sim);
    expect(boss.spell?.cardIndex).toBe(0); defeatFinal(sim); sim.continueEndless();
    expect(sim.state.pickups.map(item => [item.type, item.value])).toEqual([['hp', 3], ['coolant', 2]]);
  });
  it('locks a short spell laser throughout its full visible warning and removes it after its duration', () => {
    const sim = quiet(); const boss = sim.spawnEnemy('boss', 0, 0)!;
    boss.spell!.cardIndex = 3;
    for (let i = 0; i < 180 && !sim.state.hazards.length; i++) sim.step(idle());
    const beam = sim.state.hazards.find(h => h.kind === 'beam')!;
    expect(beam).toBeTruthy(); expect(beam.warningDuration).toBe(1.2);
    const locked = beam.angle; sim.state.player.x = 2600;
    ticks(sim, Math.round(beam.warning / STEP) - 1);
    expect(beam.active).toBe(false); expect(beam.angle).toBe(locked);
    sim.step(idle()); expect(beam.active).toBe(true);
    ticks(sim, Math.ceil(beam.duration / STEP) + 1);
    expect(sim.state.hazards.some(h => h.id === beam.id)).toBe(false);
  });
  it.each(['contact', 'laser', 'bullet'] as const)('keeps failure terminal when %s kills the player before a lethal Boss shot resolves', hazard => {
    const sim = quiet(), boss = sim.spawnEnemy('boss', 0, 0)!, p = sim.state.player;
    boss.hp = 2; boss.spell!.cardIndex = 5; boss.spell!.stage = 'active'; boss.spell!.age = 1; boss.spell!.nextAttack = 999;
    p.hp = 1; p.invincible = 0;
    p.x = hazard === 'contact' ? boss.x : boss.x + 400; p.y = boss.y;
    if (hazard === 'laser') sim.state.hazards.push({ id: 989, sourceId: boss.id, x: boss.x, y: boss.y, angle: 0, width: 42, length: 1600, radius: 21, kind: 'beam', warning: 0, warningDuration: 1.2, active: true, life: 1, duration: 1 });
    if (hazard === 'bullet') sim.state.bullets.push(bullet({ owner: 'enemy', x: p.x, y: p.y, vx: 0, speed: 0 }));
    sim.state.bullets.push(bullet({ x: boss.x, y: boss.y, vx: 0, speed: 0, damage: 2 }));
    const events = sim.step(idle());
    expect(sim.state.status).toBe('failed');
    expect(events.filter(e => e.type === 'failure' || e.type === 'complete').map(e => e.type)).toEqual(['failure']);
    expect(events.filter(e => (e.type === 'hit' || e.type === 'kill') && e.targetId === boss.id)).toHaveLength(0);
    expect(boss.hp).toBe(2);
    sim.damageEnemy(boss, 99999);
    expect(boss.hp).toBe(2);
    expect(sim.step(idle())).toHaveLength(0);
  });
  it('stops later bullet damage once the winning Boss shot has made completion terminal', () => {
    const sim = quiet(), boss = sim.spawnEnemy('boss', 0, 0, 's2:final')!, p = sim.state.player;
    boss.hp = 2; boss.spell!.cardIndex = 5; boss.spell!.stage = 'active'; boss.spell!.age = 1; boss.spell!.nextAttack = 999; p.hp = 1; p.invincible = 0;
    sim.state.bullets.push(bullet({ x: boss.x, y: boss.y, vx: 0, speed: 0, damage: 2 }),
      bullet({ owner: 'enemy', x: p.x, y: p.y, vx: 0, speed: 0 }));
    const events = sim.step(idle());
    expect(sim.state.status).toBe('complete'); expect(p.hp).toBe(1);
    expect(events.filter(e => e.type === 'failure' || e.type === 'complete').map(e => e.type)).toEqual(['complete']);
    expect(events.filter(e => e.type === 'damage')).toHaveLength(0);
  });
  it.each([1, 2, 3] as const)('requires both independent cards in phase %i and emits actual bullets after the warning', phase => {
    for (const index of [(phase - 1) * 2, (phase - 1) * 2 + 1]) {
      const sim = quiet(), boss = sim.spawnEnemy('boss', 0, 0)!;
      boss.spell!.cardIndex = index; boss.hp = boss.maxHp = SPELL_CARDS.s1.normal[index].hp;
      ticks(sim, 47);
      expect(sim.state.bullets.filter(b => b.owner === 'enemy')).toHaveLength(0);
      const events = ticks(sim, 360);
      const bullets = sim.state.bullets.filter(b => b.owner === 'enemy');
      expect(events.some(event => event.type === 'enemyShot')).toBe(true);
      expect(boss.spell!.cardIndex).toBe(index);
      expect(bullets.every(b => Number.isFinite(b.speed) && b.speed >= 0 && b.radius <= 8)).toBe(true);
    }
  });
  it('resets an in-flight boss telegraph and combat resources identically on twenty restarts', () => {
    const sim = new GameSimulation(68), baseline = structuredClone(sim.state);
    for (let i = 0; i < 20; i++) {
      const boss = sim.spawnEnemy('boss', 0, 0)!;
      boss.spell!.cardIndex = 3; sim.state.player.x = 2600; sim.state.player.y = 2000;
      sim.step(idle({ dash: true, bomb: true, shoot: true }));
      ticks(sim, 50);
      expect(sim.state.hazards.some(h => h.kind === 'beam' && !h.active)).toBe(true);
      sim.state.blackHoleTime = 3;
      sim.state.player.invincible = 0; sim.state.player.hp = 1;
      sim.state.bullets.push(bullet({ owner: 'enemy', x: sim.state.player.x, y: sim.state.player.y, vx: 0, speed: 0, radius: 1000 }));
      sim.step(idle());
      expect(sim.state.status).toBe('failed');
      sim.reset();
      expect(sim.state).toEqual(baseline);
      expect(sim.step(idle()).some(e => e.type === 'boss' || e.type === 'damage')).toBe(false);
      sim.reset();
    }
  });
  it('rotates all five encounters at endless gates without resetting the build', () => {
    const sim = quiet(); sim.reset('endless'); sim.state.player.invincible = 1e9;
    for (let index = 0; index < 5; index++) {
      sim.state.wave = (index + 1) * 10; sim.state.waveTime = BALANCE.spawn.waveDuration - STEP;
      sim.step(idle()); ticks(sim, 121);
      const enemy = sim.state.enemies.find(e => e.role === 'boss' || e.role === 'miniboss')!;
      expect(enemy.encounterId).toBe(ENCOUNTERS[index]);
      if (enemy.type === 'boss') defeatFinal(sim); else sim.damageEnemy(enemy, 1e9);
      expect(sim.state).toMatchObject({ wave: (index + 1) * 10 + 1, bossStage: false, pendingWave: 0, mode: 'endless', status: 'playing' });
    }
  });
  it('builds an identical bounded stress scene and enforces enemy/mine caps', () => {
    const a = new GameSimulation(1), b = new GameSimulation(2);
    a.debugStress(); b.debugStress();
    expect(a.state).toEqual(b.state);
    expect(a.state.enemies).toHaveLength(250);
    expect(a.state.enemies.filter(e => e.type !== 'mine')).toHaveLength(180);
    expect(a.state.enemies.filter(e => e.type === 'mine')).toHaveLength(70);
    expect(a.state.bullets).toHaveLength(1200);
    expect(a.spawnEnemy('mine', 0, 0)).toBe(null);
    expect(a.spawnEnemy('basic', 0, 0)).toBe(null);
    ticks(a, 180);
    expect(a.state.bullets).toHaveLength(1200);
    expect(a.state.enemies).toHaveLength(250);
    a.reset();
    for (let i = 0; i < 180; i++) a.spawnEnemy(i < 70 ? 'mine' : 'basic', 1000, 1000);
    expect(a.state.enemies).toHaveLength(180);
    expect(a.spawnEnemy('basic', 1000, 1000)).toBe(null);
  });
  it('keeps a seeded random stream repeatable', () => {
    const a = new SeededRandom(33), b = new SeededRandom(33), c = new SeededRandom(34);
    const expected = Array.from({ length: 50 }, () => a.next());
    expect(Array.from({ length: 50 }, () => b.next())).toEqual(expected);
    expect(Array.from({ length: 50 }, () => c.next())).not.toEqual(expected);
    expect(expected.every(value => value >= 0 && value < 1)).toBe(true);
  });
});

describe('support companions and instantaneous dash beam', () => {
  const collectSupport = (sim: GameSimulation, value = 1) => {
    const p = sim.state.player;
    sim.state.pickups.push({ id: 70000 + sim.state.tick, type: 'support', value, x: p.x, y: p.y, age: 0 });
    const events = sim.step(idle()); finishChoices(sim); return events;
  };

  it('guarantees a nearby support at progression 45 exactly once, and clears it on reset', () => {
    const sim = quiet(), p = sim.state.player;
    sim.state.waveTime = 45 - STEP;
    const events = sim.step(idle());
    expect(events.filter(e => e.type === 'support' && e.text === 'arrival')).toHaveLength(1);
    const supply = sim.state.pickups.find(item => item.type === 'support')!;
    expect(Math.hypot(supply.x - p.x, supply.y - p.y)).toBeLessThanOrEqual(72);
    const picked = ticks(sim, 45);
    expect(picked.filter(e => e.type === 'support' && e.text === 'deployed')).toHaveLength(1);
    expect(sim.state.companions).toHaveLength(1);
    expect(ticks(sim, 60).some(e => e.type === 'support' && e.text === 'arrival')).toBe(false);
    sim.reset(); expect(sim.state.companions).toHaveLength(0); expect(sim.state.pickups).toHaveLength(0);
  });
  it('caps companions at three and converts every surplus module to XP with level overflow', () => {
    const sim = quiet();
    const deployed = collectSupport(sim, 5).filter(e => e.type === 'support' && e.text === 'deployed');
    expect(deployed.map(event => event.amount)).toEqual([1, 2, 3]);
    expect(sim.state.companions).toHaveLength(3); expect(sim.state.player.level).toBe(2); expect(sim.state.player.xp).toBe(20);
    collectSupport(sim, 4);
    expect(sim.state.companions).toHaveLength(3);
    expect(sim.state.player.level).toBe(3); expect(sim.state.player.xp).toBe(100);
    const before = sim.state.player.xp;
    for (const value of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(collectSupport(sim, value).some(event => event.type === 'support')).toBe(false);
    }
    expect(sim.state.player.xp).toBe(before); expect(sim.state.pickups).toHaveLength(0);
  });

  it('keeps companions and weapon level through damage, Boss entry, and endless continuation, but clears companions on reset', () => {
    const sim = quiet(); collectSupport(sim, 3);
    const ids = sim.state.companions.map(companion => companion.id), p = sim.state.player;
    p.level = 3; p.xp = 0; p.invincible = 0;
    sim.state.bullets.push(bullet({ owner: 'enemy', x: p.x, y: p.y, vx: 0, speed: 0 }));
    sim.step(idle());
    expect(p.hp).toBe(4); expect(p.level).toBe(3); expect(p.xp).toBe(0);
    expect(sim.state.companions.map(companion => companion.id)).toEqual(ids);
    const boss = sim.spawnEnemy('boss', 0, 0, 's2:final')!;
    expect(sim.state.companions.map(companion => companion.id)).toEqual(ids);
    expect(boss.spell?.cardIndex).toBe(0); defeatFinal(sim); sim.continueEndless();
    expect(sim.state.companions.map(companion => companion.id)).toEqual(ids);
    sim.reset(); expect(sim.state.companions).toHaveLength(0); expect(sim.state.beams).toHaveLength(0);
  });

  it('fires independent, staggered drone shots while the player is idle and overheated without heat cost', () => {
    const sim = quiet(), control = quiet(); collectSupport(sim, 3);
    const enemy = sim.spawnEnemy('sprayer', 2370, 2000)!;
    enemy.hp = enemy.maxHp = 10000; enemy.speed = 0; enemy.cooldown = 1e9;
    for (const run of [sim, control]) { run.state.player.heat = 100; run.state.player.overheated = true; run.state.player.heatLock = 1.2; run.state.player.idleTime = 0; }
    const firingTicks: number[] = [];
    for (let tick = 0; tick < 30; tick++) {
      const events = sim.step(idle()); control.step(idle());
      const shots = events.filter(e => e.type === 'shot' && e.text === 'drone');
      expect(shots.length).toBeLessThanOrEqual(1);
      if (shots.length) firingTicks.push(tick);
    }
    expect(firingTicks).toHaveLength(3); expect(new Set(firingTicks).size).toBe(3);
    expect(sim.state.player.heat).toBeCloseTo(control.state.player.heat);
    expect(sim.state.player.overheated).toBe(true);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    expect(sim.state.bullets.filter(b => b.kind === 'drone').every(b => b.owner === 'player' && !b.homing && b.damage === 3)).toBe(true);
  });

  it('limits companion acquisition range and keeps orbital bodies inside world bounds', () => {
    const sim = quiet(); collectSupport(sim, 3);
    const enemy = sim.spawnEnemy('sprayer', 3500, 3500)!; enemy.speed = 0; enemy.cooldown = 1e9;
    sim.state.player.x = sim.state.player.y = BALANCE.player.radius;
    expect(ticks(sim, 90).some(event => event.type === 'shot' && event.text === 'drone')).toBe(false);
    expect(sim.state.companions.every(c => c.targetId === null && c.x >= c.radius && c.y >= c.radius && Number.isFinite(c.vx) && Number.isFinite(c.vy))).toBe(true);
    enemy.x = 300; enemy.y = 300;
    expect(ticks(sim, 40).some(event => event.type === 'shot' && event.text === 'drone')).toBe(true);
  });

  it('preserves distinct firing phases for modules picked up on separate ticks and after idle target reacquisition', () => {
    const sim = quiet(), enemy = sim.spawnEnemy('sprayer', 2370, 2000)!;
    enemy.hp = enemy.maxHp = 100000; enemy.speed = 0; enemy.cooldown = 1e9;
    const shotTicks: number[] = [];
    const advance = (support = false) => {
      const events = support ? collectSupport(sim) : sim.step(idle());
      const shots = events.filter(event => event.type === 'shot' && event.text === 'drone');
      expect(shots.length).toBeLessThanOrEqual(1);
      if (shots.length) shotTicks.push(sim.state.tick);
    };
    for (let tick = 1; tick <= 144; tick++) advance(tick === 1 || tick === 25 || tick === 50);
    expect(sim.state.companions).toHaveLength(3);
    expect(shotTicks.length).toBeGreaterThan(8);
    const steady = shotTicks.filter(tick => tick >= 73);
    expect(steady.slice(1).map((tick, index) => tick - steady[index])).toEqual(Array(steady.length - 1).fill(12));
    enemy.x = enemy.y = 3500;
    for (let tick = 0; tick < 53; tick++) advance();
    const beforeReacquisition = shotTicks.length;
    enemy.x = 2370; enemy.y = 2000;
    for (let tick = 0; tick < 108; tick++) advance();
    expect(shotTicks.length - beforeReacquisition).toBe(9);
    const reacquired = shotTicks.slice(beforeReacquisition);
    expect(reacquired.slice(1).map((tick, index) => tick - reacquired[index])).toEqual(Array(8).fill(12));
  });

  it('casts the dash corridor instantly at long range, damages each target once, and only clears intersecting hostile bullets', () => {
    const sim = quiet(), p = sim.state.player; p.x = 700; p.y = 2000;
    const positions = [[1000, 2000], [3000, 2000], [3250, 2000], [1500, 2200]];
    const enemies = positions.map(([x, y]) => {
      const enemy = sim.spawnEnemy('sprayer', x, y)!;
      enemy.hp = enemy.maxHp = 1000; enemy.speed = 0; enemy.cooldown = 1e9;
      return enemy;
    });
    sim.state.bullets.push(bullet({ id: 901, owner: 'enemy', x: 1800, y: 2020, vx: 0 }),
      bullet({ id: 902, owner: 'enemy', x: 1800, y: 2200, vx: 0 }),
      bullet({ id: 903, owner: 'player', x: 1800, y: 2020, vx: 0 }));
    p.perfectWindow = BALANCE.dash.window;
    const events = sim.step(idle({ shoot: true }));
    expect(events.filter(e => e.type === 'beam')).toHaveLength(1);
    expect(enemies.map(enemy => enemy.hp)).toEqual([960, 960, 1000, 1000]);
    expect(sim.state.bullets.map(b => b.id)).toEqual([902, 903]);
    expect(sim.state.beams[0]).toMatchObject({ x: 700, y: 2000, angle: 0, length: 2400, width: 88, life: 0.32, duration: 0.32 });
    ticks(sim, 19);
    expect(enemies.map(enemy => enemy.hp)).toEqual([960, 960, 1000, 1000]);
    expect(sim.state.beams).toHaveLength(1);
    sim.step(idle()); expect(sim.state.beams).toHaveLength(0);
  });

  it('allows the dash beam while overheated, adds no heat, and cannot repeat without a new reward', () => {
    const sim = quiet(), p = sim.state.player;
    p.perfectWindow = BALANCE.dash.window; p.shotCooldown = 0.15; p.overheated = true; p.heat = 100; p.heatLock = 1.2;
    const events = sim.step(idle({ shoot: true }));
    expect(events.filter(e => e.type === 'beam')).toHaveLength(1);
    expect(p).toMatchObject({ heat: 100, overheated: true, perfectWindow: 0 });
    expect(sim.state.bullets).toHaveLength(0);
    expect(ticks(sim, 10, idle({ shoot: true })).filter(e => e.type === 'beam' || e.type === 'shot')).toHaveLength(0);
    p.overheated = false; p.heat = 0; p.heatLock = 0; p.shotCooldown = 0;
    expect(sim.step(idle({ shoot: true })).filter(e => e.type === 'shot')).toHaveLength(1);
  });

  it('automatically consumes the dash beam on held LMB and clears visuals on reset or final completion', () => {
    const sim = quiet(), p = sim.state.player;
    p.perfectWindow = BALANCE.dash.window;
    expect(sim.step(idle({ shoot: true })).some(event => event.type === 'beam')).toBe(true);
    expect(p.perfectWindow).toBe(0); expect(sim.state.beams).toHaveLength(1);
    sim.reset(); expect(sim.state.beams).toHaveLength(0);
    const boss = sim.spawnEnemy('boss', 0, 0, 's2:final')!;
    boss.hp = 40; boss.spell!.cardIndex = 5; boss.spell!.stage = 'active'; boss.spell!.age = 1;
    sim.state.player.perfectWindow = BALANCE.dash.window;
    const events = sim.step(idle({ shoot: true, aimX: boss.x, aimY: boss.y }));
    expect(events.filter(event => event.type === 'complete' || event.type === 'failure').map(event => event.type)).toEqual(['complete']);
    expect(sim.state.beams).toHaveLength(0);
  });
  it('limits a beam cast to 180 different targets even in the oversized stress fixture', () => {
    const sim = quiet(); sim.debugStress();
    const p = sim.state.player; p.x = 500; p.y = 2000; p.perfectWindow = BALANCE.dash.window;
    sim.state.enemies.forEach((enemy, i) => { enemy.x = enemy.prevX = 800 + i * 5; enemy.y = enemy.prevY = 2000; });
    sim.step(idle({ shoot: true, aimX: 3500, aimY: 2000 }));
    expect(sim.state.enemies.filter(enemy => enemy.hp < enemy.maxHp)).toHaveLength(180);
  });

  it('does not let companions fire after contact has already ended the run', () => {
    const sim = quiet(); collectSupport(sim, 3);
    const p = sim.state.player; p.hp = 1; p.invincible = 0;
    sim.spawnEnemy('basic', p.x, p.y);
    for (const companion of sim.state.companions) companion.shotCooldown = 0;
    const events = sim.step(idle());
    expect(sim.state.status).toBe('failed');
    expect(events.some(event => event.type === 'shot' && event.text === 'drone')).toBe(false);
    expect(sim.state.beams).toHaveLength(0);
  });

  it('produces identical companion orbits, shots, beams, and damage at every supported render refresh rate', () => {
    const outputs = [30, 60, 120, 144].map(hz => {
      const sim = quiet(914); collectSupport(sim, 3);
      const enemy = sim.spawnEnemy('sprayer', 2400, 2000)!;
      enemy.hp = enemy.maxHp = 100000; enemy.speed = 0; enemy.cooldown = 1e9;
      const clock = new FixedClock(); let beams = 0, drones = 0;
      for (let frame = 0; frame <= hz * 8; frame++) clock.advance(frame * 1000 / hz, dt => {
        const tick = sim.state.tick;
        const events = sim.step(idle({ shoot: true, dash: tick % 200 === 0, aimX: enemy.x, aimY: enemy.y }), dt);
        beams += events.filter(e => e.type === 'beam').length;
        drones += events.filter(e => e.type === 'shot' && e.text === 'drone').length;
      });
      return { companions: sim.state.companions, beams, drones, hp: enemy.hp, heat: sim.state.player.heat };
    });
    expect(outputs[0].drones).toBeGreaterThan(20); expect(outputs[0].beams).toBeGreaterThan(0);
    for (const output of outputs.slice(1)) expect(output).toEqual(outputs[0]);
  });
});

describe('long-session stability', () => {
  it('runs 30 simulated minutes of endless with bounded entities and finite positions', () => {
    const sim = new GameSimulation(20260911); sim.reset('endless');
    const p = sim.state.player; p.invincible = 1e9; p.level = 10;
    sim.state.pickups.push({ id: 80000, type: 'support', value: 3, x: p.x, y: p.y, age: 0 });
    sim.step(idle());
    const startElapsed = sim.state.elapsed;
    let maxEnemies = 0, maxBullets = 0, maxPickups = 0, maxBeams = 0, maxHazards = 0, beamCasts = 0, droneShots = 0;
    let companionsStable = true, beamsStable = true, hazardsStable = true;
    for (let tick = 0; tick < 30 * 60 * 60; tick++) {
      const t = tick * STEP, boss = sim.state.enemies.find(e => e.type === 'boss'), target = boss ?? sim.state.enemies[0];
      // Engage the Boss inside its visible attack range; an endless world-size kite would never exercise hazards.
      const moveX = boss ? boss.x + Math.cos(t * 0.3) * 600 - p.x : Math.cos(t * 0.16);
      const moveY = boss ? boss.y + Math.sin(t * 0.3) * 240 - p.y : Math.sin(t * 0.16);
      const events = sim.step(idle({ moveX, moveY, aimX: target?.x ?? 2000, aimY: target?.y ?? 2000,
        shoot: !p.overheated && p.heat < 80, dash: tick % 200 === 0, bomb: tick % 1800 === 0 }));
      for (const event of events) {
        if (event.type === 'beam') beamCasts++;
        if (event.type === 'shot' && event.text === 'drone') droneShots++;
      }
      maxEnemies = Math.max(maxEnemies, sim.state.enemies.length); maxBullets = Math.max(maxBullets, sim.state.bullets.length); maxPickups = Math.max(maxPickups, sim.state.pickups.length);
      maxBeams = Math.max(maxBeams, sim.state.beams.length);
      maxHazards = Math.max(maxHazards, sim.state.hazards.length);
      companionsStable &&= sim.state.companions.length === 3 && sim.state.companions.every(c => [c.x, c.y, c.prevX, c.prevY, c.vx, c.vy, c.angle].every(Number.isFinite));
      beamsStable &&= sim.state.beams.every(beam => [beam.x, beam.y, beam.angle, beam.life].every(Number.isFinite) && beam.life > 0 && beam.life <= beam.duration);
      hazardsStable &&= sim.state.hazards.every(hazard => [hazard.x, hazard.y, hazard.radius, hazard.warning, hazard.warningDuration, hazard.life, hazard.duration].every(Number.isFinite)
        && hazard.radius > 0 && hazard.warning >= 0 && hazard.warning <= hazard.warningDuration && hazard.life > 0 && hazard.life <= hazard.duration);
    }
    expect(sim.state.status).toBe('playing'); expect(sim.state.elapsed - startElapsed).toBeCloseTo(1800, 5);
    expect(maxEnemies).toBeLessThanOrEqual(BALANCE.limits.enemies);
    expect(maxBullets).toBeLessThanOrEqual(BALANCE.limits.bullets);
    expect(maxPickups).toBeLessThan(2000);
    expect(sim.state.enemies.every(e => Number.isFinite(e.x) && Number.isFinite(e.y) && e.hp > 0)).toBe(true);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    expect(companionsStable).toBe(true); expect(sim.state.companions).toHaveLength(3);
    expect(beamsStable).toBe(true); expect(maxBeams).toBeLessThanOrEqual(1);
    expect(hazardsStable).toBe(true); expect(maxHazards).toBeLessThanOrEqual(BALANCE.ai.hazards); expect(maxHazards).toBeGreaterThan(0);
    expect(beamCasts).toBeGreaterThan(0); expect(droneShots).toBeGreaterThan(0);
  }, 120000);
});
