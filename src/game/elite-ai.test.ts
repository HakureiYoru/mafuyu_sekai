import { describe, expect, it } from 'vitest';
import { ELITE_GROUPS, createEliteBrain, eliteTelegraphs, updateEliteAi, type EliteAiContext } from './elite-ai';
import { FixedClock } from './clock';
import { GameSimulation } from './simulation';
import { createSeason2Brain, updateSeason2Ai } from './season2-ai';
import type { AreaHazard, CombatEvent, Difficulty, Enemy, EnemyShotOptions } from './types';

function harness(stage: number, variant: 0 | 1, difficulty: Difficulty = 'normal') {
  const sim = new GameSimulation(6, difficulty), definition = ELITE_GROUPS[stage - 1][variant];
  const e = sim.spawnEnemy(definition.type, 2350, 1900)!;
  e.role = 'elite'; e.radius = definition.radius; e.hp = e.maxHp = definition.hp; e.elite = createEliteBrain(stage, variant); e.season2 = undefined;
  sim.state.player.x = 2000; sim.state.player.y = 2000;
  const enemies = [e], events: CombatEvent[] = [], hazards: Omit<AreaHazard, 'id'>[] = [];
  const shots: { time: number; x: number; y: number; angle: number; options?: EnemyShotOptions }[] = [];
  let allowed = true, nextId = 30;
  const ctx: EliteAiContext = {
    player: sim.state.player, enemies, difficulty, elapsed: 0, canCommit: () => true, reserveAttack: () => allowed,
    emit: event => events.push(event), spawnHazard: h => hazards.push(h),
    shootAt: (_source, x, y, angle, _speed, _radius, _color, options) => shots.push({ time: ctx.elapsed, x, y, angle, options }),
    spawnPart: (parent, type, x, y) => {
      const part: Enemy = { ...e, type, id: nextId++, x, y, prevX: x, prevY: y, role: type === 'core' ? 'hazard' : 'part',
        elite: undefined, action: undefined, parentId: parent.id, season2: createSeason2Brain(type), radius: 20, hp: 70, maxHp: 70 };
      enemies.push(part); return part;
    }, retirePart: part => { part.hp = 0; },
  };
  const tick = (dt = 1 / 60) => {
    ctx.elapsed += dt;
    for (const actor of [...enemies]) if (actor.hp > 0) {
      actor.cooldown -= dt;
      if (actor === e) updateEliteAi(actor, dt, ctx); else updateSeason2Ai(actor, dt, ctx);
      actor.x += actor.vx * dt; actor.y += actor.vy * dt;
    }
  };
  const run = (seconds: number) => { for (let i = 0; i < seconds * 60; i++) tick(); };
  return { e, sim, enemies, events, shots, hazards, ctx, tick, run, deny: () => { allowed = false; } };
}
describe('ten two-action mandatory elites', () => {
  it('provides exactly two distinct templates per stage with fixed increasing health', () => {
    expect(ELITE_GROUPS.map(group => group.length)).toEqual([2, 2, 2, 2, 2]);
    expect(new Set(ELITE_GROUPS.flat().map(item => item.id)).size).toBe(10);
    expect(ELITE_GROUPS.map(group => group.map(template => template.hp))).toEqual([[360, 360], [450, 450], [700, 700], [900, 800], [1100, 1000]]);
  });
  it.each(ELITE_GROUPS.flat().map(definition => [definition.name, definition.stage, ELITE_GROUPS[definition.stage - 1].indexOf(definition)] as const))(
    '%s attacks and moves, leaves no unbounded pending history, and never grants itself immunity', (_name, stage, variant) => {
      const h = harness(stage, variant as 0 | 1); let maximum = 0;
      for (let tick = 0; tick < 30 * 60; tick++) {
        h.tick(); maximum = Math.max(maximum, eliteTelegraphs(h.e).length);
        expect(h.e.disabledUntil ?? 0).toBe(0);
      }
      expect(h.events.some(event => event.text?.startsWith('action-'))).toBe(true);
      expect(h.shots.length + h.hazards.length).toBeGreaterThan(0);
      expect(h.e.elite!.cycle).toBeGreaterThan(3); expect(maximum).toBeLessThanOrEqual(3);
    });
  it('shows no new warning when the full attack budget cannot be reserved', () => {
    for (let stage = 1; stage <= 5; stage++) for (const variant of [0, 1] as const) {
      const h = harness(stage, variant); h.deny(); h.run(4);
      expect(h.shots).toEqual([]); expect(h.hazards).toEqual([]); expect(eliteTelegraphs(h.e)).toEqual([]); expect(h.e.action).toBeUndefined();
      expect(h.events.filter(event => event.text?.includes('windup') || event.text?.startsWith('action-'))).toEqual([]);
    }
  });
  it('cancels a destroyed arm release but retains the lateral reposition and alternative fan', () => {
    const h = harness(2, 0); h.run(0.8);
    const arm = h.enemies.find(e => e.type === 'arm')!; arm.hp = 0;
    h.run(15);
    expect(h.events.some(event => event.text === 'action-sidestep')).toBe(true);
    expect(h.shots.length).toBeGreaterThan(0); expect(h.enemies.filter(e => e.type === 'arm')).toHaveLength(1);
  });
  it('does not retain retired core identities across a long executor encounter', () => {
    const h = harness(5, 0); let maximumLive = 0;
    for (let tick = 0; tick < 120 * 60; tick++) {
      h.tick();
      for (let index = h.enemies.length - 1; index >= 0; index--) if (h.enemies[index].hp <= 0) h.enemies.splice(index, 1);
      maximumLive = Math.max(maximumLive, h.enemies.length - 1);
      expect(h.e.elite!.partIds).toHaveLength(0);
    }
    expect(h.events.filter(event => event.text === 'elite-cores').length).toBeGreaterThan(15);
    expect(maximumLive).toBe(2); expect(h.e.elite!.pending.length).toBeLessThanOrEqual(3);
  });
  it('keeps all elite actions identical across render rates and freezes at zero simulation dt', () => {
    const run = (hz: number) => {
      const h = harness(4, 1), clock = new FixedClock();
      for (let frame = 0; frame <= hz * 15; frame++) clock.advance(frame * 1000 / hz, dt => h.tick(dt));
      const snapshot = structuredClone(h.e); updateEliteAi(h.e, 0, h.ctx); expect(h.e).toEqual(snapshot);
      return { shots: h.shots, events: h.events, enemy: h.e, hazards: h.hazards };
    };
    for (const hz of [30, 120, 144]) expect(run(hz)).toEqual(run(60));
  });

  for (const difficulty of ['normal', 'hard'] as const) {
    it.each(ELITE_GROUPS.flat().map(definition => [definition.name, definition.stage, ELITE_GROUPS[definition.stage - 1].indexOf(definition)] as const))(
      `${difficulty} %s locks its route and then stays still without firing throughout the full movement recovery`, (_name, stage, variant) => {
        const h = harness(stage, variant as 0 | 1, difficulty), recovery = difficulty === 'hard' ? 1.2 : 1.4;
        for (let tick = 0; tick < 1800 && !h.e.action; tick++) h.tick();
        expect(h.e.action).toBeDefined();
        const route = { x: h.e.action!.targetX, y: h.e.action!.targetY, angle: h.e.action!.angle };
        h.sim.state.player.y += 100;
        for (let tick = 0; tick < 180 && h.e.action?.phase !== 'recover'; tick++) {
          h.tick();
          expect(h.e.action).toMatchObject({ targetX: route.x, targetY: route.y, angle: route.angle });
        }
        expect(h.e.action?.phase).toBe('recover');
        const x = h.e.x, y = h.e.y, entered = h.ctx.elapsed, shots = h.shots.length;
        expect(h.e.exposedUntil! - entered).toBeCloseTo(recovery);
        for (let tick = 0; tick < recovery * 60 - 1; tick++) {
          h.tick();
          expect(h.e.state).toBe('recover'); expect(h.e.vx).toBe(0); expect(h.e.vy).toBe(0);
          expect(h.e.x).toBe(x); expect(h.e.y).toBe(y); expect(h.shots).toHaveLength(shots);
        }
        h.tick();
        expect(h.ctx.elapsed - entered).toBeCloseTo(recovery);
        expect(h.e.action).toBeUndefined(); expect(h.e.x).toBe(x); expect(h.e.y).toBe(y);
      });

    it.each([['leaper', 1, 0], ['chaser', 1, 1], ['hunter', 4, 0]] as const)(
      `${difficulty} %s always separates successive lunges with a ranged attack`, (_name, stage, variant) => {
        const h = harness(stage, variant, difficulty); h.run(30);
        const actions = h.events.filter(event => event.text === 'elite-move' || event.text === 'elite-windup').map(event => event.text);
        expect(actions.length).toBeGreaterThan(3);
        expect(actions.slice(0, 4)).toEqual(['elite-move', 'elite-windup', 'elite-move', 'elite-windup']);
        expect(h.shots.length).toBeGreaterThan(0);
      });

    it.each([['gate', 2, 0], ['executor', 5, 0], ['ring', 5, 1]] as const)(
      `${difficulty} large %s uses two ranged attacks per lateral reposition and never chains a body dash`, (_name, stage, variant) => {
        const h = harness(stage, variant, difficulty); h.run(30);
        const actions = h.events.filter(event => ['elite-move', 'elite-windup', 'elite-cores'].includes(event.text ?? '')).map(event => event.text);
        expect(actions.length).toBeGreaterThan(5);
        expect(actions.slice(0, 6).map(text => text === 'elite-move' ? 'move' : 'volley')).toEqual(['volley', 'volley', 'move', 'volley', 'volley', 'move']);
        expect(h.events.filter(event => event.text === 'action-dash' || event.text === 'action-retrace')).toEqual([]);
        expect(h.e.elite!.extraDash).toBe(0);
      });
  }
});
