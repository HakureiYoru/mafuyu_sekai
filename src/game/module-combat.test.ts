import { describe, expect, it } from 'vitest';
import { ModuleCombat, MODULE_COMBAT_LIMITS, type ModuleCombatContext } from './module-combat';
import { GameSimulation } from './simulation';
import { createBuild, EVOLUTIONS, MODULES, NEW_MODULE_IDS, resolveBuildStats } from './upgrades';
import type { Enemy, InputAction, ModuleId } from './types';

const input: InputAction = { moveX: 0, moveY: 0, aimX: 1500, aimY: 1000, shoot: true, dash: false, bomb: false };
function fixture(modules: readonly ModuleId[] = [], rank = 1) {
  const state = new GameSimulation(61001).state;
  Object.assign(state.player, { x: 1000, y: 1000, prevX: 1000, prevY: 1000, angle: 0, focus: false, heat: 70 });
  state.enemies = []; state.bullets = []; state.companions = []; state.build = createBuild();
  for (const id of modules) { state.build.modules.push(id); state.build.ranks[id] = rank; }
  const damage: { id: number; amount: number; module: ModuleId }[] = [], slows: { id: number; amount: number; duration: number }[] = [];
  const control = new ModuleCombat();
  const ctx: ModuleCombatContext = {
    state, stats: resolveBuildStats(state.build), query: (x, y, radius) => state.enemies.filter(enemy => enemy.hp > 0 && Math.hypot(enemy.x - x, enemy.y - y) <= radius),
    damage: (enemy, amount, source) => { expect(source.kind).toBe('module'); enemy.hp -= amount; damage.push({ id: enemy.id, amount, module: source.moduleId }); },
    slow: (enemy, amount, duration) => { slows.push({ id: enemy.id, amount, duration }); },
    push: (enemy, dx, dy) => { enemy.x += dx; enemy.y += dy; },
    collect: pickup => { const index = state.pickups.indexOf(pickup); if (index < 0) return false; state.player.xp += pickup.value; state.pickups.splice(index, 1); return true; },
    emit: () => undefined,
  };
  const addEnemy = (x = 1100, y = 1000, radius = 10): Enemy => {
    const enemy: Enemy = { id: state.enemies.length + 1, type: 'basic', role: 'mob', x, y, prevX: x, prevY: y, vx: 0, vy: 0, radius, hp: 1e8, maxHp: 1e8, speed: 0, angle: 0,
      state: 'chase', timer: 0, cooldown: 0, laserCooldown: 0, attackIndex: 0, hitTime: 0, lowHpSpoken: false, directionX: 1, directionY: 0 };
    state.enemies.push(enemy); return enemy;
  };
  const addDrone = (target = state.enemies[0], x = 1000, y = 1000) => { const drone = { id: 100 + state.companions.length, x, y, prevX: x, prevY: y, vx: 0, vy: 0, radius: 14, angle: 0, shotCooldown: 0, targetId: target?.id ?? null }; state.companions.push(drone); return drone; };
  const advance = (seconds: number, action = input) => { for (let tick = 0; tick < Math.round(seconds * 60); tick++) { state.elapsed += 1 / 60; state.tick++; control.step(1 / 60, ctx, action); } };
  const evolve = (...ids: (keyof typeof EVOLUTIONS)[]) => { state.build.evolutions.push(...ids); ctx.stats = resolveBuildStats(state.build); };
  return { state, control, ctx, damage, slows, addEnemy, addDrone, advance, evolve };
}

describe('main-cannon derivatives', () => {
  it('fires a pulse on the fifth base volley, damages nearest three once, and excludes outside geometry', () => {
    const f = fixture(['pulseChamber']); for (let index = 0; index < 4; index++) f.addEnemy(1080 + index * 20);
    f.addEnemy(1100, 1100);
    for (let i = 0; i < 4; i++) f.control.onMainShot(f.ctx); expect(f.control.visuals).toHaveLength(0);
    f.control.onMainShot(f.ctx); f.advance(0.25);
    expect(f.damage).toHaveLength(3); expect(f.damage.map(hit => hit.amount)).toEqual([6, 6, 6]); expect(f.damage.map(hit => hit.id)).toEqual([1, 2, 3]);
  });
  it('keeps the V-layer double pulse and captures resonance at emission exactly once', () => {
    const f = fixture(['pulseChamber'], 5); f.state.build.resonance = 4; f.addEnemy();
    for (let i = 0; i < 5; i++) f.control.onMainShot(f.ctx);
    f.state.build.resonance = 0; f.advance(0.4);
    expect(f.damage.map(hit => hit.amount)).toEqual([6, 6]);
  });
  it('delays star detonation and does not recursively create more stars on secondary damage', () => {
    const f = fixture(['anchorStars'], 5), target = f.addEnemy();
    f.control.onMainHit(f.ctx, target); f.advance(0.6); expect(f.damage).toHaveLength(0);
    f.advance(0.1); expect(f.damage.filter(hit => hit.id === target.id)).toHaveLength(1);
    expect(f.control.visuals.filter(visual => visual.kind === 'star')).toHaveLength(1);
    expect(f.control.visuals.filter(visual => visual.kind === 'blade')).toHaveLength(6);
    f.advance(1); expect(f.control.visuals.filter(visual => visual.kind === 'star')).toHaveLength(0);
  });
  it('returns a lunar blade along its actual original path with one outbound and one return hit', () => {
    const f = fixture(['crescentMagazine']); f.evolve('lunarCut'); f.addEnemy(1000, 1000, 10);
    f.control.onMainShot(f.ctx); f.advance(1.35);
    expect(f.damage).toHaveLength(2); expect(f.damage[0].amount).toBe(4); expect(f.damage[1].amount).toBeCloseTo(2.4);
  });
  it('locks beam echoes to the firing geometry and never clears enemy bullets', () => {
    const f = fixture(['beamCircuit'], 5); f.addEnemy(1250); const far = f.addEnemy(2000, 1500);
    f.control.onBeam(f.ctx, { x: 1000, y: 1000, angle: 0, length: 2400, width: 88 });
    f.state.player.x = 2000; f.state.player.y = 1500; f.state.player.angle = Math.PI;
    f.advance(0.8); expect(f.damage.every(hit => hit.id !== far.id)).toBe(true); expect(f.damage.length).toBeGreaterThan(0);
    expect(f.damage.every(hit => hit.module === 'beamCircuit')).toBe(true);
  });
  it('emits sideways sonic-break branches that do not re-hit the parent wave target', () => {
    const f = fixture(['pulseChamber'], 3); f.state.player.focus = true; f.evolve('sonicBreak'); const primary = f.addEnemy(1200); f.addEnemy(1260, 1120);
    for (let i = 0; i < 5; i++) f.control.onMainShot(f.ctx); f.advance(0.6);
    expect(f.damage.filter(hit => hit.id === primary.id)).toHaveLength(1); expect(f.damage.some(hit => hit.id === 2)).toBe(true);
  });
});

describe('automatic drone forms', () => {
  it('choir beams add at most two half-damage partners and capture level growth once', () => {
    const f = fixture(['droneSpotlight', 'droneConduit']); f.state.player.level = 10;
    const target = f.addEnemy(1300, 1000, 50);
    for (let i = 0; i < 3; i++) f.addDrone(target, 1000, 980 + i * 20);
    f.advance(.7);
    const hits = f.damage.filter(hit => hit.module === 'droneSpotlight');
    expect(hits.map(hit => hit.amount).sort((a, b) => a - b)).toEqual([14, 14, 28]);
    f.advance(1); expect(f.damage.filter(hit => hit.module === 'droneSpotlight')).toHaveLength(3);
    expect(f.state.companions).toHaveLength(3);
  });
  it('locks spotlight direction only at the end of charge and applies damage once', () => {
    const f = fixture(['droneSpotlight']); const target = f.addEnemy(1200); f.addDrone(target);
    f.advance(0.3); expect(f.damage).toHaveLength(0);
    target.x = target.prevX = 1000; target.y = target.prevY = 1200; f.advance(0.3);
    expect(f.damage).toHaveLength(1); expect(f.damage[0].amount).toBe(10);
  });
  it('uses only existing drones for the III / V relay and never adds companions', () => {
    for (const count of [1, 2, 3]) {
      const f = fixture(['droneSpotlight'], 5); const target = f.addEnemy(1200, 1000, 80);
      for (let i = 0; i < count; i++) f.addDrone(target, 1000, 980 + i * 20);
      f.advance(1); expect(f.damage).toHaveLength(count); expect(f.state.companions).toHaveLength(count);
    }
  });
  it('arms notes before triggering and respects per-tier concurrent caps', () => {
    const f = fixture(['droneNotes'], 5); const target = f.addEnemy(1020); f.addDrone(target);
    f.advance(0.45); expect(f.damage).toHaveLength(0); expect(f.control.visuals.filter(v => v.kind === 'note')).toHaveLength(3);
    f.advance(0.2); expect(f.damage.length).toBeGreaterThan(0); expect(f.damage.every(hit => hit.amount === 4.5)).toBe(true);
    f.advance(15); expect(f.control.visuals.filter(v => v.kind === 'note').length).toBeLessThanOrEqual(6);
  });
  it('uses the swept annulus for plectrum, not an invisible filled sector', () => {
    const f = fixture(['dronePlectrum']); const rim = f.addEnemy(1085, 1000, 5), center = f.addEnemy(1000, 1000, 5); f.addDrone(rim);
    f.advance(0.5); expect(f.damage.some(hit => hit.id === rim.id)).toBe(true); expect(f.damage.some(hit => hit.id === center.id)).toBe(false);
  });
  it('deduplicates conduit intersections across every edge of the triangle', () => {
    const f = fixture(['droneConduit'], 5); const target = f.addEnemy(1000, 1000, 100);
    f.addDrone(target, 1000, 1000); f.addDrone(target, 1100, 1000); f.addDrone(target, 1050, 1080);
    f.advance(1); expect(f.damage).toHaveLength(1); expect(f.damage[0].amount).toBe(8);
  });
  it('shows the same moving two-drone utility triangle that slows without adding damage edges', () => {
    const f = fixture(['droneConduit'], 3); f.evolve('triangleHall');
    const inside = f.addEnemy(1000, 1100, 2), outside = f.addEnemy(1180, 1100, 2);
    f.addEnemy(950, 1100, 2); // Player-to-drone side is a utility boundary, never a damage edge.
    const left = f.addDrone(inside, 900, 1200), right = f.addDrone(inside, 1100, 1200);
    f.advance(1 / 60);
    const view = f.control.visuals.find(item => item.kind === 'conduit')!;
    expect(view.utilityGeometry).toEqual({ shape: 'path', points: [{ x: 900, y: 1200 }, { x: 1100, y: 1200 }, { x: 1000, y: 1000 }], closed: true, width: 40 });
    expect(view.geometry).toMatchObject({ shape: 'path', points: [{ x: 900, y: 1200 }, { x: 1100, y: 1200 }], closed: false });
    expect(f.slows.some(hit => hit.id === inside.id)).toBe(true);
    expect(f.slows.some(hit => hit.id === outside.id)).toBe(false);
    expect(f.damage).toHaveLength(0);
    left.x += 400; right.x += 400; f.state.player.x += 400; f.slows.length = 0;
    const movedInside = f.addEnemy(1400, 1100, 2); f.advance(1 / 60);
    expect(view.utilityGeometry).toMatchObject({ points: [{ x: 1300, y: 1200 }, { x: 1500, y: 1200 }, { x: 1400, y: 1000 }] });
    expect(f.slows.some(hit => hit.id === inside.id)).toBe(false);
    expect(f.slows.some(hit => hit.id === movedInside.id)).toBe(true);
    expect(f.damage).toHaveLength(0);
  });
  it('shows a single-drone utility line and the existing three-drone polygon without inventing corners', () => {
    for (const count of [1, 3]) {
      const f = fixture(['droneConduit'], 5); f.evolve('triangleHall'); const target = f.addEnemy(2000, 2000);
      for (let index = 0; index < count; index++) f.addDrone(target, 900 + index * 100, 1200 + (index % 2) * 100);
      f.advance(1 / 60);
      const view = f.control.visuals.find(item => item.kind === 'conduit')!;
      expect(view.utilityGeometry).toMatchObject({ shape: 'path', closed: count === 3, width: 40 });
      if (view.utilityGeometry?.shape !== 'path' || view.geometry.shape !== 'path') throw new Error('expected conduit paths');
      expect(view.utilityGeometry.points).toEqual(view.geometry.points);
      expect(view.utilityGeometry.points).toHaveLength(count === 1 ? 2 : 3);
    }
  });
  it('leaves nonrecursive star carpets and final conduit pulses', () => {
    const f = fixture(['anchorStars', 'droneConduit'], 3); const target = f.addEnemy(); f.addDrone(target); f.evolve('starCarpet', 'triangleHall');
    f.control.onMainHit(f.ctx, target); f.advance(1.8);
    expect(f.damage.filter(hit => hit.module === 'anchorStars').length).toBeLessThanOrEqual(2);
    expect(f.control.getStats().actors).toBeLessThan(4);
  });
});

describe('visible tactical mobility', () => {
  it('decoys redirect only uncommitted regular enemies and collect the same loot once', () => {
    const f = fixture(['decoyEcho'], 5), enemy = f.addEnemy(1100); f.evolve('livingSpeaker');
    f.state.player.x = 1200; f.control.onDashEnd(f.ctx, { x: 1000, y: 1000 });
    expect(f.control.visuals.filter(v => v.kind === 'decoy')).toHaveLength(2); expect(f.control.decoyTarget(f.ctx, enemy)).not.toBeNull();
    enemy.state = 'charge'; expect(f.control.decoyTarget(f.ctx, enemy)).toBeNull(); enemy.state = 'chase'; enemy.role = 'miniboss'; expect(f.control.decoyTarget(f.ctx, enemy)).toBeNull();
    f.state.pickups = [{ id: 1, x: 1000, y: 1000, age: 0, type: 'xp', value: 70 }]; f.advance(1.3);
    expect(f.state.player.xp).toBe(70); expect(f.state.pickups).toHaveLength(0);
  });
  it('slipstream activates after a full straight second and cannot override focus or dash', () => {
    const f = fixture(['slipstream'], 5), moving = { ...input, moveX: 1 };
    f.advance(0.9, moving); expect(f.control.moveSpeed(300, f.ctx)).toBe(300);
    f.advance(0.15, moving); expect(f.control.moveSpeed(300, f.ctx)).toBe(385);
    f.state.player.focus = true; expect(f.control.moveSpeed(180, f.ctx)).toBe(180);
    f.state.player.focus = false; f.state.player.dashTime = 0.1; expect(f.control.moveSpeed(1080, f.ctx)).toBe(1080);
    f.state.player.dashTime = 0; f.advance(1, input); expect(f.control.moveSpeed(300, f.ctx)).toBe(300);
  });
  it('lanes do not stack speed and trigger an evolved pulse only on actual reentry', () => {
    const f = fixture(['dashLane'], 5); f.evolve('echoHighway'); f.state.player.x = 1200; f.control.onDashEnd(f.ctx, { x: 1000, y: 1000 });
    expect(f.control.moveSpeed(300, f.ctx)).toBe(375); f.advance(0.1); expect(f.control.visuals.filter(v => v.kind === 'blade')).toHaveLength(0);
    f.state.player.y = 1200; f.advance(0.1); f.state.player.y = 1000; f.advance(0.1);
    expect(f.control.visuals.filter(v => v.kind === 'blade')).toHaveLength(1); f.advance(0.6); f.state.player.y = 1200; f.advance(0.1); f.state.player.y = 1000; f.advance(0.1);
    expect(f.control.visuals.filter(v => v.kind === 'blade')).toHaveLength(0);
  });
  it('counter rings push ordinary bodies but do not grant damage immunity or move a boss', () => {
    const f = fixture(['counterPulse'], 5), mob = f.addEnemy(1100), boss = f.addEnemy(1100, 1000); boss.role = 'boss';
    const invincible = f.state.player.invincible; f.control.onDamage(f.ctx); f.advance(0.6);
    expect(mob.x).toBeGreaterThan(1100); expect(boss.x).toBe(1100); expect(f.state.player.invincible).toBe(invincible); expect(f.damage).toHaveLength(0);
    expect(f.control.visuals.some(item => item.kind === 'field')).toBe(true);
    mob.x = 1100; f.advance(0.1); expect(f.slows.some(item => item.id === mob.id)).toBe(true);
  });
  it('consumed revival can still gain cooling without generating another revive state', () => {
    const f = fixture(['revive'], 5); f.control.onDamage(f.ctx); expect(f.state.player.heat).toBe(58);
    f.control.onDamage(f.ctx); expect(f.state.player.heat).toBe(58); expect(f.state.player.hp).toBe(5);
  });
});

describe('clock, pooling boundaries, and restart', () => {
  it('freezes all clocks during upgrades and resets all effects and cooldowns', () => {
    const f = fixture(['anchorStars']); f.control.onMainHit(f.ctx, f.addEnemy()); const before = structuredClone(f.control.visuals);
    f.state.status = 'upgrade'; f.advance(5); expect(f.control.visuals).toEqual(before); expect(f.damage).toHaveLength(0);
    f.state.status = 'playing'; f.advance(0.7); expect(f.damage).toHaveLength(1); f.control.reset();
    expect(f.control.visuals).toEqual([]); expect(f.control.getStats()).toMatchObject({ actors: 0, cooldowns: 0, rememberedTargets: 0 });
  });
  it('supports all thirty-six modules and eighteen evolutions at rank 10000 within fixed actor budgets', () => {
    const f = fixture(Object.keys(MODULES) as ModuleId[], 10000); f.evolve(...Object.keys(EVOLUTIONS) as (keyof typeof EVOLUTIONS)[]);
    const target = f.addEnemy(1100, 1000, 70); for (let i = 0; i < 3; i++) f.addDrone(target, 1000, 980 + i * 20);
    let maximum = 0;
    for (let tick = 0; tick < 60 * 20; tick++) {
      if (tick % 6 === 0) { f.control.onMainShot(f.ctx); f.control.onMainHit(f.ctx, target); }
      if (tick % 180 === 0) { f.control.onDashEnd(f.ctx, { x: 850, y: 1000 }); f.control.onBeam(f.ctx, { x: 1000, y: 1000, angle: 0, length: 2400, width: 88 }); f.control.onDamage(f.ctx); }
      f.advance(1 / 60, { ...input, moveX: 1 }); maximum = Math.max(maximum, f.control.getStats().actors);
      expect(f.control.getStats().actors).toBeLessThanOrEqual(MODULE_COMBAT_LIMITS.actors);
      expect(f.control.visuals.length).toBe(f.control.getStats().actors);
      expect(f.state.companions).toHaveLength(3);
    }
    expect(maximum).toBeGreaterThan(10); expect(f.damage.length).toBeGreaterThan(10);
    expect(f.damage.every(hit => Number.isFinite(hit.amount) && hit.amount > 0)).toBe(true);
    expect(f.control.getStats().cooldowns).toBeLessThanOrEqual(NEW_MODULE_IDS.length + 1);
    f.control.clearEncounter(); expect(f.control.visuals).toHaveLength(0);
  });
  it('produces the same result under 30 / 60 / 120 / 144 Hz presentation schedules', () => {
    const results = [30, 60, 120, 144].map(hz => {
      const f = fixture(['crescentMagazine', 'anchorStars', 'droneSpotlight'], 5), target = f.addEnemy(1140, 1000, 90); f.addDrone(target);
      let accumulator = 0, ticks = 0;
      for (let frame = 0; frame < hz * 5; frame++) {
        accumulator += 1 / hz;
        while (accumulator >= 1 / 60 - 1e-9) {
          if (ticks % 6 === 0) { f.control.onMainShot(f.ctx); f.control.onMainHit(f.ctx, target); }
          f.advance(1 / 60); ticks++; accumulator -= 1 / 60;
        }
      }
      return { damage: f.damage, visuals: f.control.visuals.map(v => [v.kind, v.x, v.y, v.age]), ticks };
    });
    for (const result of results) expect(result).toEqual(results[0]);
  });
});

describe('remaining evolution combat contracts', () => {
  it('choral side beams cannot duplicate targets already hit by the echo round', () => {
    const f = fixture(['beamCircuit'], 5); f.evolve('choralBeam'); const common = f.addEnemy(1050, 1000, 10); const side = f.addEnemy(1400, 1085, 10);
    f.control.onBeam(f.ctx, { x: 1000, y: 1000, angle: 0, length: 2400, width: 88 }); f.advance(0.8);
    expect(f.damage.filter(hit => hit.id === common.id)).toHaveLength(1);
    expect(f.damage.filter(hit => hit.id === side.id)).toHaveLength(1); expect(f.damage.find(hit => hit.id === side.id)?.amount).toBe(6);
  });
  it('stage spotlight hits three beam targets and a separate endpoint target once', () => {
    const f = fixture(['droneSpotlight']); f.evolve('stageSpotlight'); const target = f.addEnemy(1100);
    f.addEnemy(1200); f.addEnemy(1300); const endpoint = f.addEnemy(1680); f.addDrone(target);
    f.advance(0.8); expect(f.damage).toHaveLength(4); expect(f.damage.find(hit => hit.id === endpoint.id)?.amount).toBe(4);
  });
  it('static garden lets two note generations overlap but keeps the six-note cap', () => {
    const f = fixture(['droneNotes'], 5); f.evolve('staticGarden'); const target = f.addEnemy(1700); const drone = f.addDrone(target);
    f.advance(3.9); expect(f.control.visuals.filter(v => v.kind === 'note')).toHaveLength(3);
    drone.x = 1180; f.advance(0.8);
    expect(f.control.visuals.filter(v => v.kind === 'note')).toHaveLength(6);
    expect(f.control.visuals.some(v => v.kind === 'link')).toBe(true);
    f.advance(8); expect(f.control.visuals.filter(v => v.kind === 'note').length).toBeLessThanOrEqual(6);
  });
  it('string echo selects an enemy the preceding sweep did not hit', () => {
    const f = fixture(['dronePlectrum']); f.evolve('stringEcho'); const rim = f.addEnemy(1085), distant = f.addEnemy(1320); f.addDrone(rim);
    f.advance(1); expect(f.damage.filter(hit => hit.id === rim.id)).toHaveLength(1);
    expect(f.damage.filter(hit => hit.id === distant.id)).toHaveLength(1); expect(f.damage.find(hit => hit.id === distant.id)?.amount).toBe(4);
  });
  it('headwind produces only four three-shot secondary volleys per speed window', () => {
    const f = fixture(['slipstream'], 5); f.evolve('headwindFlame'); f.addEnemy(880, 1000, 80);
    f.advance(2.2, { ...input, moveX: 1 }); expect(f.damage).toHaveLength(12); expect(f.damage.every(hit => hit.amount === 1.5)).toBe(true);
    f.advance(1); expect(f.damage).toHaveLength(12);
  });
  it('counter curtain clears at most three ordinary bullets and cannot immediately refresh', () => {
    const f = fixture(['counterPulse'], 5); f.evolve('counterCurtain');
    for (let i = 0; i < 5; i++) f.state.bullets.push({ id: i + 1, owner: 'enemy', x: 1010 + i * 10, y: 1000, prevX: 1010 + i * 10, prevY: 1000, vx: -50, vy: 0, radius: 4, damage: 1, life: 3, color: 0, homing: false, speed: 50, lockRange: 0, targetId: null, remainingHits: 1, hitIds: new Set(), kind: 'normal' });
    f.control.onDamage(f.ctx); f.advance(0.1); expect(f.state.bullets.filter(b => b.life > 0)).toHaveLength(2);
    f.control.onDamage(f.ctx); f.advance(0.5); expect(f.state.bullets.filter(b => b.life > 0)).toHaveLength(2);
  });
});
