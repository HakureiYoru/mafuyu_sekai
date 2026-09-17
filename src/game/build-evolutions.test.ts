import { describe, expect, it } from 'vitest';
import { STEP } from './config';
import { GameSimulation } from './simulation';
import { enqueueUpgrade, offerModules } from './upgrades';
import type { Bullet, CombatEvent, Enemy, EvolutionId, InputAction, ModuleId, UpgradeChoiceId } from './types';

const idle = (extra: Partial<InputAction> = {}): InputAction => ({ moveX: 0, moveY: 0, aimX: 3000, aimY: 2000, shoot: false, dash: false, bomb: false, ...extra });
function advance(sim: GameSimulation, count: number, controls = idle()): CombatEvent[] {
  const events: CombatEvent[] = []; for (let tick = 0; tick < count; tick++) events.push(...sim.step(controls)); return events;
}
function scene(modules: ModuleId[], rank: 1 | 2 = 2, drones = 0, evolution?: EvolutionId) {
  const sim = new GameSimulation(5007); sim.state.spawnTimer = 1e9;
  sim.state.player.level = 5; sim.state.player.specialCooldown = 1e9; sim.state.player.invincible = 1e9;
  for (const id of modules) { sim.state.build.modules.push(id); sim.state.build.ranks[id] = rank; }
  if (evolution) sim.state.build.evolutions.push(evolution);
  if (drones) {
    sim.state.pickups.push({ id: 9000, type: 'support', value: drones, x: 2000, y: 2000, age: 0 }); sim.step(idle());
    for (const drone of sim.state.companions) drone.shotCooldown = 1e9;
  }
  return sim;
}
function target(sim: GameSimulation, x = 2300, y = 2000, hp = 1000, type: Enemy['type'] = 'basic') {
  const enemy = sim.spawnEnemy(type, x, y)!; enemy.hp = enemy.maxHp = hp; enemy.speed = 0; enemy.cooldown = 1e9; return enemy;
}
function bullet(sim: GameSimulation, x: number, y: number, extra: Partial<Bullet> = {}): Bullet {
  const shot: Bullet = { id: 9900 + sim.state.tick + sim.state.bullets.length, owner: 'player', x, y, prevX: x, prevY: y,
    vx: 0, vy: 0, speed: 0, radius: 4, damage: 2, color: 0xffffff, life: 10, homing: false, lockRange: 0,
    targetId: null, remainingHits: 1, hitIds: new Set(), kind: 'normal', ...extra };
  sim.state.bullets.push(shot); return shot;
}
function hit(sim: GameSimulation, enemy: Enemy, kind: Bullet['kind'] = 'normal', damage = 2) {
  bullet(sim, enemy.x, enemy.y, { kind, damage }); return sim.step(idle());
}
function resource(sim: GameSimulation, id: UpgradeChoiceId) {
  enqueueUpgrade(sim.state.build, 'boss', `fixture:${sim.state.build.choiceIndex}`);
  offerModules(sim.state.build, sim.state.player.level, 2); sim.state.build.choices = [id]; sim.state.status = 'upgrade';
  return sim.chooseUpgrade(id, sim.state.build.offerId!);
}

describe('rank II changes actual combat output', () => {
  it('fires 2.6-damage main shots with two added penetrations, and independent 1.5-damage wings', () => {
    const sim = scene(['precision', 'piercing', 'wingShots']);
    advance(sim, 21, idle({ focus: true })); sim.step(idle({ focus: true, shoot: true }));
    const main = sim.state.bullets.filter(b => b.kind === 'normal'), wings = sim.state.bullets.filter(b => b.kind === 'module');
    expect(main).toHaveLength(3); expect(main.every(b => b.damage === 2.6 && b.remainingHits === 3)).toBe(true);
    expect(wings.map(b => b.damage)).toEqual([1.5, 1.5]); expect(sim.state.player.heat).toBeCloseTo(25 * STEP);
  });

  it('deals 18 through side beams, or 58 to the first focused victim without duplicate side damage', () => {
    for (const focus of [false, true]) {
      const sim = scene(['prism']), main = target(sim, 2600), side = target(sim, 2900, 2127);
      main.radius = side.radius = 18; sim.state.player.perfectWindow = 0.85;
      sim.step(idle({ shoot: true, focus }));
      expect(main.hp).toBe(focus ? 942 : 960); expect(side.hp).toBe(focus ? 1000 : 982);
      expect(sim.state.beams).toHaveLength(focus ? 1 : 3);
    }
  });

  it('chains exactly three 5-damage hits and shatters only primary kills into six 1.5-damage shards', () => {
    const sim = scene(['chain', 'shatter']);
    const first = target(sim), others = [target(sim, 2360, 1970), target(sim, 2250, 2080), target(sim, 2370, 2090), target(sim, 2520, 2000)];
    hit(sim, first, 'special', 10); expect(others.filter(e => e.hp === 995)).toHaveLength(3);
    expect(sim.state.bullets).toHaveLength(0);
    hit(sim, target(sim, 2800, 2200, 1), 'normal', 2);
    const shards = sim.state.bullets.filter(b => b.kind === 'module'); expect(shards).toHaveLength(6); expect(shards.every(b => b.damage === 1.5)).toBe(true);
  });

  it('triggers a 14-damage burst on the tenth drone hit, while secondary hits never count', () => {
    const sim = scene(['droneBurst']), enemy = target(sim); const events: CombatEvent[] = [];
    for (let index = 0; index < 9; index++) events.push(...hit(sim, enemy, 'drone'));
    for (let index = 0; index < 12; index++) events.push(...hit(sim, enemy, 'module'));
    expect(events.some(event => event.type === 'module' && event.moduleId === 'droneBurst')).toBe(false);
    events.push(...hit(sim, enemy, 'drone'));
    expect(events.filter(event => event.type === 'module' && event.moduleId === 'droneBurst')).toHaveLength(1);
    expect(events.some(event => event.damageSource === 'module' && event.amount === 14)).toBe(true);
  });

  it('rank II vent, condenser, revival and dash charge obey their actual numbers and preserve locks', () => {
    const sim = scene(['vent', 'reserveAmmo', 'revive', 'doubleDash']); const p = sim.state.player;
    p.heat = 90; p.overheated = true; p.heatLock = 3;
    sim.step(idle({ dash: true })); expect(p.heat).toBe(50); expect(p.dashCooldown).toBeCloseTo(2.3);
    advance(sim, 10); expect(p.heat).toBeLessThanOrEqual(15); expect(p.overheated).toBe(true);
    expect(sim.dashCharges).toBe(1);
    p.hp = 1; p.invincible = 0; bullet(sim, p.x, p.y, { owner: 'enemy', damage: 1 }); sim.step(idle());
    expect(p.hp).toBe(2); expect(p.invincible).toBeCloseTo(1.2);
    p.hp = 1; p.invincible = 0; bullet(sim, p.x, p.y, { owner: 'enemy', damage: 1 }); sim.step(idle());
    expect(sim.state.status).toBe('failed');
  });

  it('limits rank II graze refunds across repeated windows, and never counts invincible grazes', () => {
    const sim = scene(['graze']), p = sim.state.player; p.invincible = 0; p.heat = 100; p.idleTime = 0; p.dashCooldown = 10;
    const start = p.dashCooldown;
    for (let group = 0; group < 3; group++) {
      for (let i = 0; i < 4; i++) bullet(sim, p.x + 24, p.y, { owner: 'enemy', radius: 6, life: STEP * 2 });
      sim.step(idle()); if (group < 2) advance(sim, 59);
    }
    expect(p.dashCooldown).toBeCloseTo(start - 121 * STEP - 0.45);
    const cooldown = p.dashCooldown; p.invincible = 2;
    bullet(sim, p.x + 24, p.y, { owner: 'enemy', radius: 6 }); sim.step(idle());
    expect(p.dashCooldown).toBeCloseTo(cooldown - STEP);
  });

  it('rank II passive modules use longer homing and pickup range with shorter interception cooldown', () => {
    const sim = scene(['droneHoming', 'magnet', 'intercept'], 2, 1), drone = sim.state.companions[0];
    target(sim, 2400); drone.shotCooldown = 0;
    sim.state.pickups.push({ id: 987, type: 'xp', value: 10, x: 2670, y: 2000, age: 0 });
    bullet(sim, 2040, 2000, { owner: 'enemy' }); sim.step(idle());
    expect(sim.state.bullets.some(b => b.owner === 'enemy')).toBe(false);
    expect(sim.moduleStates.find(module => module.id === 'intercept')?.remaining).toBeCloseTo(6);
    expect(sim.state.bullets.find(b => b.kind === 'drone')?.homingTime).toBeCloseTo(1.6 - STEP);
    expect(sim.state.pickups.find(pickup => pickup.id === 987)!.x).toBeLessThan(2670);
    expect(sim.moduleStates.find(module => module.id === 'magnet')!.remaining).toBeCloseTo(8 - STEP);
  });
});

describe('new module geometry and non-recursive effects', () => {
  it('ricochets at 60% to one other target, shares a cooldown and cannot trigger from secondary hits', () => {
    const sim = scene(['ricochet']), first = target(sim), second = target(sim, 2390);
    hit(sim, first, 'module', 10); expect(sim.state.bullets).toHaveLength(0);
    hit(sim, first, 'normal', 10); const rebound = sim.state.bullets.find(b => b.kind === 'module')!;
    expect(rebound).toMatchObject({ damage: 6, targetId: second.id }); expect(rebound.hitIds.has(first.id)).toBe(true);
    hit(sim, first, 'normal', 10); expect(sim.state.bullets.filter(b => b.kind === 'module')).toHaveLength(1);
    advance(sim, 7); expect(second.hp).toBe(994); expect(first.hp).toBe(970);
  });

  it('rear sparks fire behind the aim direction at 1.5 damage and expire after 360 units', () => {
    const sim = scene(['rearSpark']); sim.step(idle({ shoot: true }));
    const sparks = sim.state.bullets.filter(b => b.kind === 'module'); expect(sparks).toHaveLength(2);
    expect(sparks.every(b => b.damage === 1.5 && b.vx < 0)).toBe(true);
    advance(sim, 31); expect(sim.state.bullets.some(b => sparks.includes(b))).toBe(false);
    expect(sim.moduleStates.find(module => module.id === 'rearSpark')?.remaining).toBeGreaterThan(0);
  });

  it('cross orbit II moves all drones to radius 180 and extends actual acquisition range by 80', () => {
    const sim = scene(['crossOrbit', 'division'], 2, 3), p = sim.state.player;
    const enemy = target(sim, p.x + 850); sim.step(idle());
    for (const drone of sim.state.companions) expect(Math.hypot(drone.x - p.x, drone.y - p.y)).toBeCloseTo(180, 5);
    expect(sim.state.companions.some(drone => drone.targetId === enemy.id)).toBe(true);
  });

  it('returning wings damage one target once per leg, disable homing and do not count return procs', () => {
    const sim = scene(['returnWing', 'droneHoming', 'droneBurst'], 2, 1), drone = sim.state.companions[0];
    const enemy = target(sim, 2250, 2000); enemy.radius = 50; drone.shotCooldown = 0;
    const events = sim.step(idle()), returning = sim.state.bullets.find(b => b.moduleId === 'returnWing')!;
    expect(returning.homing).toBe(false);
    drone.shotCooldown = 1e9;
    events.push(...advance(sim, 48));
    expect(events.filter(event => event.targetId === enemy.id && event.damageSource === 'drone')).toHaveLength(1);
    expect(events.filter(event => event.targetId === enemy.id && event.damageSource === 'module')).toHaveLength(1);
    expect(enemy.hp).toBe(994);
  });

  it('brake and ion slow choose the strongest amount, leaving bosses and committed dashes unaffected', () => {
    const sim = scene(['brakeField', 'slow']); sim.state.build.ranks.slow = 1;
    const mob = target(sim, 2090), committed = target(sim, 2100, 2070, 1000, 'dasher'), boss = target(sim, 2120, 1960, 1000, 'miniboss');
    committed.state = 'charge'; committed.timer = 5; boss.cooldown = 1e9;
    advance(sim, 36, idle({ focus: true })); expect(mob.slowAmount).toBe(0.35);
    hit(sim, mob, 'drone'); expect(mob.slowAmount).toBe(0.35);
    expect(committed.slowUntil).toBeUndefined(); expect(boss.slowUntil).toBeUndefined();
    expect(sim.state.playerAreas.find(area => area.kind === 'brake')?.radius).toBe(140);
  });

  it('dash echo waits 0.3 seconds, hits once for 10, and never clears enemy bullets or causes shards', () => {
    const sim = scene(['dashEcho', 'shatter']); const enemy = target(sim, 2260, 2000, 1000);
    bullet(sim, 2260, 2040, { owner: 'enemy', life: 10 });
    sim.step(idle({ dash: true })); advance(sim, 10);
    expect(sim.state.playerAreas).toHaveLength(1); expect(enemy.hp).toBe(1000);
    advance(sim, 16); expect(enemy.hp).toBe(1000);
    advance(sim, 3); expect(enemy.hp).toBe(990);
    advance(sim, 12); expect(enemy.hp).toBe(990);
    expect(sim.state.bullets.some(b => b.owner === 'enemy')).toBe(true);
    expect(sim.state.bullets.some(b => b.kind === 'module')).toBe(false);
  });
});

describe('evolved combat preserves its slot effects and bounded additional damage', () => {
  it('needle array conserves the focused volley damage in one five-target shot and keeps wings independent', () => {
    const sim = scene(['piercing', 'precision', 'wingShots'], 2, 0, 'needleArray');
    advance(sim, 21, idle({ focus: true })); sim.step(idle({ shoot: true, focus: true }));
    const needle = sim.state.bullets.filter(b => b.kind === 'normal'); expect(needle).toHaveLength(1);
    expect(needle[0].damage).toBeCloseTo(7.8); expect(needle[0]).toMatchObject({ remainingHits: 5, speed: 1500 });
    expect(sim.state.bullets.filter(b => b.kind === 'module')).toHaveLength(2);
    sim.state.player.shotCooldown = 0; sim.step(idle({ shoot: true }));
    expect(sim.state.bullets.filter(b => b.bornTick === sim.state.tick && b.kind === 'normal')).toHaveLength(3);
  });

  it('spiral bloom adds six 2-damage radial shots while retaining two wings and two rear sparks', () => {
    const sim = scene(['wingShots', 'rearSpark'], 2, 0, 'spiralBloom'); sim.step(idle({ shoot: true }));
    const extras = sim.state.bullets.filter(b => b.kind === 'module');
    expect(extras.filter(b => b.damage === 2)).toHaveLength(6); expect(extras.filter(b => b.damage === 1.5)).toHaveLength(4);
    expect(new Set(extras.filter(b => b.damage === 2).map(b => Math.atan2(b.vy, b.vx).toFixed(3))).size).toBe(6);
  });

  it('fork network adds two distinct homing targets at 6 damage, and adds nothing for a lone victim', () => {
    for (const count of [1, 3]) {
      const sim = scene(['chain', 'slow'], 2, 0, 'forkNetwork'); sim.state.player.specialCooldown = 0;
      for (let i = 0; i < count; i++) target(sim, 2350 + i * 50, 1950 + i * 70);
      advance(sim, 19);
      const special = sim.state.bullets.find(b => b.kind === 'special')!, extras = sim.state.bullets.filter(b => b.kind === 'module');
      expect(special).toBeDefined(); expect(extras).toHaveLength(count === 1 ? 0 : 2);
      expect(new Set(extras.map(b => b.targetId)).size).toBe(extras.length);
      expect(extras.every(b => b.damage === 6 && b.homing && b.hitIds.has(special.targetId!))).toBe(true);
    }
  });

  it('triangle assault divides total burst damage 18 across three drone origins', () => {
    const sim = scene(['droneBurst', 'crossOrbit'], 2, 3, 'triangleAssault'), enemy = target(sim, 2500);
    let events: CombatEvent[] = []; for (let i = 0; i < 10; i++) events = hit(sim, enemy, 'drone');
    expect(events.filter(event => event.type === 'module' && event.moduleId === 'droneBurst')).toHaveLength(1);
    const bursts = sim.state.bullets.filter(b => b.kind === 'module'); expect(bursts).toHaveLength(3);
    expect(bursts.reduce((damage, b) => damage + b.damage, 0)).toBe(18); expect(bursts.every(b => b.remainingHits === 2)).toBe(true);
    expect(new Set(bursts.map(b => `${b.prevX}:${b.prevY}`)).size).toBe(3);
  });

  it('hunting return sweeps through a target for exactly four secondary damage on its return trip', () => {
    const sim = scene(['orbitBlade', 'returnWing'], 2, 1, 'huntingReturn'), marked = target(sim, 2400);
    hit(sim, marked); advance(sim, 16);
    const drone = sim.state.companions[0], p = sim.state.player;
    const crossing = target(sim, (drone.x + p.x) / 2, (drone.y + p.y) / 2); crossing.radius = 24;
    p.markTime = STEP;
    const events = advance(sim, 20);
    const returns = events.filter(event => event.targetId === crossing.id && event.damageSource === 'huntingReturn');
    expect(returns).toHaveLength(1); expect(returns[0].amount).toBe(4); expect(crossing.hp).toBe(996);
    expect(sim.state.bullets).toHaveLength(0);
  });

  it('echo trail replaces the circular pulse, damages once for 12 and keeps enemy bullets alive', () => {
    const sim = scene(['doubleDash', 'dashEcho'], 2, 0, 'echoTrail'), enemy = target(sim, 2100);
    bullet(sim, 2100, 2020, { owner: 'enemy', life: 10 });
    sim.step(idle({ dash: true })); advance(sim, 10);
    expect(sim.state.playerAreas).toHaveLength(1); expect(sim.state.playerAreas[0]).toMatchObject({ kind: 'trail', width: 64, duration: 0.75, damage: 12 });
    expect(enemy.hp).toBe(988); advance(sim, 30); expect(enemy.hp).toBe(988);
    expect(sim.state.bullets.some(b => b.owner === 'enemy')).toBe(true); expect(sim.dashCharges).toBe(1);
  });
});

describe('reward application and pooled state', () => {
  it('gives exact fallback XP and converts full healing and bombs without discarding the reward', () => {
    const sim = scene([]); const p = sim.state.player; p.xp = 0;
    expect(resource(sim, 'reward:heal')).toBe(true); expect(p.xp).toBe(60);
    p.hp = 2; expect(resource(sim, 'reward:heal')).toBe(true); expect(p.hp).toBe(4); expect(p.xp).toBe(60);
    p.bombs = 5; expect(resource(sim, 'reward:bomb')).toBe(true); expect(p.bombs).toBe(5); expect(p.xp).toBe(90);
    expect(resource(sim, 'reward:xp')).toBe(true); expect(p.xp).toBe(190);
  });

  it('clears return-program state when a pooled projectile becomes a new shot', () => {
    const sim = scene([]);
    const pool = sim as unknown as { addBullet(x: number, y: number, angle: number, speed: number, owner: 'player', damage: number, radius: number, color: number): Bullet };
    const previous = pool.addBullet(2000, 2000, 0, 600, 'player', 3, 4, 0xffffff);
    Object.assign(previous, { returnOriginX: 2000, returnOriginY: 2000, returnAt: 0.4, returning: true, moduleId: 'returnWing', life: STEP / 2 });
    previous.returnHitIds = new Set([41]); sim.step(idle());
    const reused = pool.addBullet(2000, 2000, 0, 600, 'player', 2, 4, 0xffffff);
    expect(reused).toBe(previous); expect(reused.returnAt).toBeUndefined(); expect(reused.returnOriginX).toBeUndefined();
    expect(reused.moduleId).toBeUndefined(); expect(reused.returning).toBe(false); expect(reused.returnHitIds).toBeUndefined();
  });
});
