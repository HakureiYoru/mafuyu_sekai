import { describe, expect, it } from 'vitest';
import { BALANCE, STEP } from './config';
import { FixedClock } from './clock';
import { GameSimulation } from './simulation';
import { MODULES, EVOLUTIONS } from './upgrades';
import type { Bullet, Enemy, InputAction, ModuleId, EvolutionId } from './types';

const idle: InputAction = { moveX: 0, moveY: 0, aimX: 2700, aimY: 2000, shoot: false, dash: false, bomb: false };
interface Internals {
  addBullet(x: number, y: number, angle: number, speed: number, owner: 'enemy' | 'player', damage: number, radius: number, color: number,
    kind?: Bullet['kind'], hits?: number, homing?: boolean, range?: number, reservationSource?: number): Bullet | null;
  reserveAttack(source: number, bullets: number, hazards: number, duration: number): boolean;
  queueSpawn(size: number): void;
  spawnElite(stage: number, variant: 0 | 1, x: number, y: number, id: string): Enemy;
}
const internals = (sim: GameSimulation) => sim as unknown as Internals;
function quiet(): GameSimulation { const sim = new GameSimulation(60001); sim.state.spawnTimer = 1e9; sim.state.player.invincible = 1e9; return sim; }
function tick(sim: GameSimulation, count = 1, input = idle): void { for (let i = 0; i < count; i++) sim.step(input); }
function chooseAll(sim: GameSimulation): void { while (sim.state.status === 'upgrade') expect(sim.chooseUpgrade(sim.state.build.choices[0], sim.state.build.offerId!)).toBe(true); }

describe('v6 integrated combat contracts', () => {
  it('keeps the first elite mandatory while ordinary progression and reinforcements continue', () => {
    const sim = quiet(), w = sim.state;
    w.waveTime = 40 - STEP; tick(sim);
    expect(w.indicators.filter(i => i.eliteStage === 1)).toHaveLength(1);
    tick(sim, 80); const elite = w.enemies.find(e => e.role === 'elite')!;
    expect(elite.hp).toBe(360); expect(w.campaign.phase).toBe('stage');
    w.waveTime = 90 - STEP; tick(sim);
    expect(w.campaign.eliteGate).toBe(true); expect(w.campaign.progression).toBe(90);
    expect(w.indicators.some(i => i.type === 'miniboss')).toBe(false);
    const before = w.elapsed; tick(sim, 120); expect(w.elapsed).toBeCloseTo(before + 2); expect(w.campaign.progression).toBe(90);
    sim.damageEnemy(elite, 1e8); sim.damageEnemy(elite, 1e8);
    expect(w.campaign.defeatedElites).toHaveLength(1);
    expect(w.build.pendingRewards.filter(r => r.source === 'elite')).toHaveLength(1);
    chooseAll(sim); tick(sim, 100);
    expect(w.enemies.filter(e => e.role === 'miniboss')).toHaveLength(1);
  });
  it('allocates full enemy promises independently from a saturated player pool', () => {
    const sim = quiet(), api = internals(sim);
    for (let i = 0; i < BALANCE.limits.playerBullets; i++) expect(api.addBullet(100, 100, 0, 0, 'player', 1, 4, 0)).not.toBeNull();
    expect(api.addBullet(100, 100, 0, 0, 'player', 1, 4, 0)).toBeNull();
    expect(api.reserveAttack(77, BALANCE.limits.enemyBullets, 0, 2)).toBe(true);
    expect(api.addBullet(100, 100, 0, 0, 'enemy', 1, 4, 0)).toBeNull();
    for (let i = 0; i < BALANCE.limits.enemyBullets; i++) expect(api.addBullet(100, 100, 0, 0, 'enemy', 1, 4, 0, 'normal', 1, false, 0, 77)).not.toBeNull();
    expect(sim.state.bullets).toHaveLength(4608);
    sim.reset(); expect(sim.state.bullets).toHaveLength(0);
    expect(api.reserveAttack(78, BALANCE.limits.enemyBullets, 48, 1)).toBe(true);
  });
  it('choosing an upgrade freezes the complete battlefield and action programs', () => {
    const sim = quiet(), p = sim.state.player;
    const elite = internals(sim).spawnElite(1, 0, p.x + 280, p.y, 'fixture:elite');
    tick(sim, 50);
    expect(elite.action || elite.elite!.pending.length).toBeTruthy();
    sim.state.pickups.push({ id: 100000, type: 'xp', value: 100, x: p.x, y: p.y, age: 0 });
    tick(sim); expect(sim.state.status).toBe('upgrade');
    const before = JSON.stringify(sim.state); tick(sim, 600, { ...idle, shoot: true, dash: true });
    expect(JSON.stringify(sim.state)).toBe(before);
    chooseAll(sim); tick(sim); expect(sim.state.player.dashTime).toBe(0);
  });
  it('assigns one functional loot carrier per formation while every ordinary kill gives XP', () => {
    const sim = quiet(); sim.state.mode = 'endless';
    internals(sim).queueSpawn(3);
    expect(sim.state.indicators).toHaveLength(3);
    expect(sim.state.indicators.filter(i => i.lootCarrier)).toHaveLength(1);
    const ids = new Set(sim.state.indicators.map(i => i.squadId)); expect(ids.size).toBe(1);
    tick(sim, 90);
    for (const enemy of sim.state.enemies) if (enemy.role === 'mob') sim.damageEnemy(enemy, 1e9);
    expect(sim.state.pickups.filter(p => p.type === 'xp').reduce((sum, p) => sum + p.value, 0)).toBe(30);
    expect(sim.state.pickups.filter(p => p.type !== 'xp').length).toBeLessThanOrEqual(1);
  });
  it('exposed cores reward aim without making the rest of the body invulnerable', () => {
    const sim = quiet(); const elite = internals(sim).spawnElite(2, 0, 2400, 2000, 'fixture:elite');
    elite.exposedUntil = 2;
    sim.damageEnemy(elite, 10, { x: 2000, y: 2000, angle: 0, kind: 'normal' });
    expect(elite.hp).toBeCloseTo(650 - 13.5);
    sim.damageEnemy(elite, 10, { x: 2000, y: 2100, angle: 0, kind: 'normal' });
    expect(elite.hp).toBeCloseTo(650 - 23.5);
  });
  it('all 36 modules and 18 evolutions stay deterministic with bounded attack entities at high ranks', () => {
    const results = [30, 60, 120, 144].map(hz => {
      const sim = quiet(); sim.state.build.modules = Object.keys(MODULES) as ModuleId[];
      sim.state.build.ranks = Object.fromEntries(sim.state.build.modules.map(id => [id, 100]));
      sim.state.build.evolutions = Object.keys(EVOLUTIONS) as EvolutionId[]; sim.refreshBuild();
      sim.state.pickups.push({ id: 90001, type: 'support', value: 3, x: 2000, y: 2000, age: 0 });
      const target = sim.spawnEnemy('sprayer', 2380, 2000)!; target.hp = target.maxHp = 1e7; target.cooldown = 1e9; target.speed = 0;
      const clock = new FixedClock(); let maxActors = 0;
      for (let frame = 0; frame <= hz * 12; frame++) clock.advance(frame * 1000 / hz, dt => {
        sim.step({ ...idle, aimX: target.x, aimY: target.y, shoot: true, focus: sim.state.tick % 120 < 60, dash: sim.state.tick % 150 === 0 }, dt);
        maxActors = Math.max(maxActors, sim.state.moduleVisuals?.length ?? 0);
      });
      expect(maxActors).toBeGreaterThan(5); expect(maxActors).toBeLessThanOrEqual(192);
      expect(sim.state.bullets.filter(b => b.owner === 'player').length).toBeLessThanOrEqual(1536);
      expect(target.hp).toBeLessThan(target.maxHp);
      return { hp: target.hp, tick: sim.state.tick, p: sim.state.player, bullets: sim.state.bullets.length, visuals: sim.state.moduleVisuals, maxActors };
    });
    for (const result of results.slice(1)) expect(result).toEqual(results[0]);
  });
});
