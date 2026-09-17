import { describe, expect, it } from 'vitest';
import { GameSimulation } from './simulation';
import { exposeWeakpoint } from './enemy-ai';
import { STEP } from './config';
import type { Enemy, InputAction } from './types';

const idle: InputAction = { moveX: 0, moveY: 0, aimX: 2400, aimY: 2000, shoot: false, dash: false, bomb: false };
function scene() {
  const sim = new GameSimulation(4100);
  sim.state.spawnTimer = 999;
  sim.state.player.invincible = 999;
  return sim;
}
function freeze(enemy: Enemy) { enemy.cooldown = 999; enemy.speed = 0; }

describe('v4.1 interaction ownership and collision', () => {
  it('a swept shot breaks the exposed emitter without also damaging the body', () => {
    const sim = scene(), p = sim.state.player;
    const enemy = sim.spawnEnemy('sniper', p.x + 170, p.y)!;
    enemy.angle = Math.PI; enemy.state = 'aim'; enemy.timer = 1; freeze(enemy); exposeWeakpoint(enemy);
    const hp = enemy.hp;
    const events = sim.step({ ...idle, shoot: true });
    for (let tick = 0; tick < 20; tick++) events.push(...sim.step({ ...idle, shoot: true }));
    expect(events.filter(e => e.type === 'interrupt')).toHaveLength(1);
    expect(events.some(e => e.hitResult === 'weakpoint')).toBe(true);
    expect(enemy.weakpoint).toBeUndefined();
    // The first two Lv1 rounds are consumed by the 4-HP emitter.
    expect(enemy.hp).toBe(hp);
  });

  it('heavy shots damage at most three distinct ordinary targets and keep player ownership separate', () => {
    const sim = scene(), p = sim.state.player;
    const source = sim.spawnEnemy('sniper', p.x - 500, p.y)!; freeze(source);
    const targets = [0, 1, 2, 3].map(i => { const e = sim.spawnEnemy('basic', p.x - 400 + i * 70, p.y)!; e.hp = e.maxHp = 40; freeze(e); return e; });
    const heavy = { id: 90000, owner: 'enemy' as const, x: p.x - 480, y: p.y, prevX: p.x - 480, prevY: p.y, vx: 36000, vy: 0,
      radius: 8, damage: 1, life: 4, color: 0xffffff, speed: 36000, homing: false, lockRange: 0, targetId: null,
      remainingHits: 1, hitIds: new Set<number>(), kind: 'normal' as const, sourceId: source.id, friendlyDamage: 8, friendlyHits: 3 };
    sim.state.bullets.push(heavy);
    sim.step(idle);
    expect(targets.map(e => e.hp)).toEqual([32, 32, 32, 40]);
    expect(source.hp).toBe(source.maxHp);
    expect(heavy.friendlyHits).toBe(0);
    heavy.x = p.x - 480; heavy.vx = 36000;
    sim.step(idle);
    expect(targets.map(e => e.hp)).toEqual([32, 32, 32, 40]);
  });

  it('beam hits the shield once at its current reduction then opens it for 1.2 seconds', () => {
    const sim = scene(), p = sim.state.player;
    const shield = sim.spawnEnemy('shield', p.x + 280, p.y)!; shield.angle = Math.PI; freeze(shield);
    sim.damageEnemy(shield, 40, { x: p.x, y: p.y, kind: 'beam' });
    expect(shield.hp).toBe(shield.maxHp - 10);
    expect(shield.shieldBrokenUntil).toBeCloseTo(1.2);
    sim.damageEnemy(shield, 2, p);
    expect(shield.hp).toBe(shield.maxHp - 12);
  });

  it('the automatic dash beam cancels an actually committed shield attack reservation', () => {
    const sim = scene(), p = sim.state.player;
    const shield = sim.spawnEnemy('shield', p.x + 280, p.y)!;
    shield.angle = Math.PI; shield.cooldown = 0; shield.speed = 0;
    const director = (sim as unknown as { threats: { intents: readonly { sourceId: number }[] } }).threats;
    sim.step(idle);
    expect(shield.state).toBe('charge');
    expect(director.intents.some(intent => intent.sourceId === shield.id)).toBe(true);
    expect(sim.state.bullets.some(bullet => bullet.owner === 'enemy' && bullet.sourceId === shield.id)).toBe(false);

    p.perfectWindow = 0.85;
    const events = sim.step({ ...idle, aimX: shield.x, aimY: shield.y, shoot: true });
    expect(events.filter(event => event.type === 'beam')).toHaveLength(1);
    expect(events.filter(event => event.type === 'shieldBreak' && event.targetId === shield.id)).toHaveLength(1);
    expect(shield.hp).toBe(shield.maxHp - 10);
    expect(shield.state).toBe('recover');
    expect(shield.shieldBrokenUntil).toBeGreaterThan(sim.state.elapsed);
    expect(director.intents.some(intent => intent.sourceId === shield.id)).toBe(false);
    expect(sim.state.bullets.some(bullet => bullet.owner === 'enemy' && bullet.sourceId === shield.id)).toBe(false);
  });

  it('shooting a device yields one bounded blast without device chains or boss damage', () => {
    const sim = scene(), p = sim.state.player;
    const mine = sim.spawnEnemy('mine', p.x + 400, p.y)!;
    const other = sim.spawnEnemy('mine', mine.x + 50, mine.y)!;
    const targets = Array.from({ length: 7 }, (_, i) => { const e = sim.spawnEnemy('basic', mine.x, mine.y + 10 + i * 10)!; e.hp = e.maxHp = 40; return e; });
    const mini = sim.spawnEnemy('miniboss', mine.x + 40, mine.y)!;
    sim.damageEnemy(mine, 1000);
    sim.damageEnemy(mine, 1000);
    expect(targets.map(e => e.hp)).toEqual([34, 34, 34, 34, 34, 34, 40]);
    expect(other.hp).toBe(1); expect(mini.hp).toBe(mini.maxHp); expect(p.hp).toBe(p.maxHp);
    expect(sim.step(idle).filter(e => e.type === 'attack' && e.text === 'deviceBurst')).toHaveLength(1);
  });

  it('actual damage feedback excludes overkill and carries the incoming direction', () => {
    const sim = scene(), p = sim.state.player, enemy = sim.spawnEnemy('basic', p.x, p.y + 300)!;
    sim.damageEnemy(enemy, 100, { x: p.x, y: p.y, angle: Math.PI / 2, kind: 'beam' });
    const hit = sim.step(idle).find(e => e.type === 'hit' && e.targetId === enemy.id)!;
    expect(hit.amount).toBe(6); expect(hit.angle).toBe(Math.PI / 2); expect(hit.damageSource).toBe('beam');
  });

  it('a pooled heavy projectile cannot give a later player round friendly-fire properties', () => {
    const sim = scene();
    const internals = sim as unknown as { addBullet(x: number, y: number, angle: number, speed: number, owner: 'enemy' | 'player', damage: number, radius: number, color: number): import('./types').Bullet };
    const heavy = internals.addBullet(2000, 2000, 0, 600, 'enemy', 1, 8, 0xffffff);
    heavy.friendlyDamage = 8; heavy.friendlyHits = 3; heavy.life = STEP / 2;
    sim.step(idle);
    const reused = internals.addBullet(2000, 2000, 0, 600, 'player', 2, 4, 0xffffff);
    expect(reused).toBe(heavy); expect(reused.friendlyDamage).toBeUndefined(); expect(reused.friendlyHits).toBeUndefined();
  });
});
