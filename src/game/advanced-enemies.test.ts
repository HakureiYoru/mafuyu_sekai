import { describe, expect, it } from 'vitest';
import { ADVANCED_TYPES, advancedDeath, advancedGeometry, advancedTelegraphs, updateAdvancedEnemy } from './advanced-enemies';
import { GameSimulation } from './simulation';
import { ENEMY_INTRODUCTIONS } from './campaign';
import { FixedClock } from './clock';
import type { Season2AiContext } from './season2-ai';
import type { AreaHazard, EnemyType } from './types';
function harness(type: EnemyType, hard = false) {
  const sim = new GameSimulation(63, hard ? 'hard' : 'normal'), e = sim.spawnEnemy(type, 2300, 2000)!;
  const shots: { id: number; x: number; y: number; angle: number; time: number }[] = [], hazards: Omit<AreaHazard, 'id'>[] = [];
  let accepted = true;
  const ctx: Season2AiContext = { player: sim.state.player, elapsed: 0, difficulty: hard ? 'hard' : 'normal', enemies: sim.state.enemies,
    canCommit: () => accepted, reserveAttack: () => accepted, emit: () => {},
    shootAt: (source, x, y, angle) => shots.push({ id: source.id, x, y, angle, time: ctx.elapsed }),
    spawnHazard: h => hazards.push(h), retirePart: part => { part.hp = 0; },
    spawnPart: (parent, part, x, y) => { const unit = sim.spawnEnemy(part, x, y); if (unit) unit.parentId = parent.id; return unit; },
  };
  const tick = () => { ctx.elapsed += 1 / 60; updateAdvancedEnemy(e, 1 / 60, ctx); e.x += e.vx / 60; e.y += e.vy / 60; };
  const run = (seconds: number) => { for (let i = 0; i < seconds * 60; i++) tick(); };
  return { sim, e, ctx, shots, hazards, tick, run, deny: () => { accepted = false; } };
}
describe('three post-ECHO tactical enemies', () => {
  it('unlocks in authored order only after the first mandatory boss node', () => {
    expect(ENEMY_INTRODUCTIONS.filter(item => ADVANCED_TYPES.includes(item.type)).map(item => item.time)).toEqual([100, 125, 165]);
  });
  it.each(ADVANCED_TYPES)('%s reserves its attack before showing committed cues, and freezes at dt zero', type => {
    const h = harness(type); h.deny(); h.run(5); expect(h.shots).toHaveLength(0); expect(h.hazards).toHaveLength(0); expect(advancedTelegraphs(h.e)).toHaveLength(0);
    const before = structuredClone(h.e); updateAdvancedEnemy(h.e, 0, h.ctx); expect(h.e).toEqual(before);
  });
  it.each([false, true])('stalker locks the entire rush then separately warns its return fire (hard=%s)', hard => {
    const h = harness('stalker', hard);
    for (let i = 0; i < 300 && h.e.advanced!.phase !== 'windup'; i++) h.tick();
    const cue = { ...h.e.advanced!.cues[0] }, origin = { x: h.e.x, y: h.e.y };
    expect(h.e.advanced!.timer).toBeCloseTo(hard ? .9 : 1.1); h.ctx.player.y += 250;
    for (let i = 0; i < 200 && h.e.advanced!.phase !== 'rush'; i++) h.tick();
    expect(Math.atan2(h.e.vy, h.e.vx)).toBeCloseTo(cue.angle);
    for (let i = 0; i < 100 && h.e.advanced!.phase !== 'followup'; i++) h.tick();
    expect(Math.hypot(h.e.x - origin.x, h.e.y - origin.y)).toBeLessThanOrEqual(cue.length + 11);
    expect(h.shots).toHaveLength(0); expect(h.e.advanced!.timer).toBeGreaterThanOrEqual(.69);
    h.run(1); expect(h.shots.length).toBe(hard ? 7 : 5); expect(h.e.state).toBe('recover');
  });
  it('breaking one lens cancels that beam; live beam uses exactly the telegraphed geometry', () => {
    const h = harness('prismWarden'); for (let i = 0; i < 240 && h.e.advanced!.phase !== 'windup'; i++) h.tick();
    const [a, b] = h.e.advanced!.cues; expect(a.kind).toBe('beam');
    const lens = h.ctx.enemies.find(unit => unit.id === a.unitId)!; lens.hp = 0; advancedDeath(lens, h.ctx);
    h.run(1.2); expect(h.hazards).toHaveLength(1); const beam = h.hazards[0];
    expect(beam).toMatchObject({ x: b.x, y: b.y, angle: b.angle, width: b.width, length: b.length, sourceId: b.unitId });
    expect(advancedGeometry(b).width).toBe(36);
    advancedDeath(h.e, h.ctx); expect(h.ctx.enemies.filter(unit => unit.parentId === h.e.id && unit.hp > 0)).toHaveLength(0);
  });
  it('does not regrow broken lenses or let part death complete the campaign', () => {
    const h = harness('prismWarden'); h.run(1); const parts = h.ctx.enemies.filter(unit => unit.parentId === h.e.id);
    for (const part of parts) h.sim.damageEnemy(part, 999);
    h.run(12); expect(h.e.advanced!.parts).toHaveLength(parts.length); expect(h.shots.length).toBeGreaterThan(0);
    expect(h.sim.state.campaign.defeatedEncounters).toHaveLength(0); expect(h.sim.state.status).toBe('playing');
  });
  it('conductor releases staggered locked origins and cancels only a killed relay', () => {
    const h = harness('conductor'); h.sim.spawnEnemy('basic', 2230, 2040); h.sim.spawnEnemy('shield', 2250, 1970);
    for (let i = 0; i < 240 && h.e.advanced!.phase !== 'windup'; i++) h.tick();
    const cues = h.e.advanced!.cues.map(cue => ({ ...cue })); expect(cues).toHaveLength(3);
    const ally = h.ctx.enemies.find(unit => unit.id === cues[1].unitId)!; ally.hp = 0;
    h.ctx.player.x -= 200; h.run(2.5);
    expect(h.shots).toHaveLength(10); expect(new Set(h.shots.map(shot => shot.time)).size).toBe(2);
    expect(h.shots.slice(5).every(shot => shot.x === cues[2].x && shot.y === cues[2].y)).toBe(true);
  });
  it.each(ADVANCED_TYPES)('%s remains deterministic across 30/60/120/144 Hz', type => {
    const run = (hz: number) => { const h = harness(type), clock = new FixedClock(); for (let i = 0; i <= hz * 12; i++) clock.advance(i * 1000 / hz, h.tick); return { enemy: h.e, shots: h.shots, hazards: h.hazards }; };
    for (const hz of [30, 120, 144]) expect(run(hz)).toEqual(run(60));
  });
});
