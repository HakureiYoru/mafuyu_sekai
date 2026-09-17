import { describe, expect, it } from 'vitest';
import { GameSimulation } from './simulation';
import { BALANCE, STEP } from './config';
import { enqueueUpgrade } from './upgrades';
import type { InputAction } from './types';

const idle: InputAction = { moveX: 0, moveY: 0, aimX: 2500, aimY: 2000, dash: false, shoot: false, bomb: false };
function quiet() { const sim = new GameSimulation(512); sim.state.spawnTimer = 1e9; sim.state.player.invincible = 1e9; return sim; }

describe('v5 continuous run boundary regressions', () => {
  it('queues every crossed weapon level and freezes the full battlefield in place while choosing', () => {
    const sim = quiet(), w = sim.state, p = w.player;
    const enemy = sim.spawnEnemy('sprayer', 2450, 2000)!; enemy.cooldown = 1e9;
    w.hazards.push({ id: 900, sourceId: enemy.id, x: 1500, y: 1500, radius: 50, warning: 1, warningDuration: 1, life: 1, duration: 1, active: false, kind: 'bombard' });
    w.playerAreas.push({ id: 901, kind: 'brake', x: 1000, y: 1000, radius: 110, warning: 0, warningDuration: 0, life: 0.8, duration: 0.8, damage: 0, slow: 0.25, hitIds: new Set() });
    w.pickups.push({ id: 902, type: 'xp', x: p.x, y: p.y, value: 500, age: 0 }); p.dashCooldown = 2;
    sim.step(idle);
    expect(w.status).toBe('upgrade'); expect(w.build.pendingRewards.map(reward => reward.id)).toEqual(['level:2', 'level:3', 'level:4']);
    const frozen = structuredClone(w);
    for (let i = 0; i < 144; i++) sim.step({ ...idle, shoot: true, dash: true, bomb: true });
    expect(w).toEqual(frozen); expect(w.enemies[0]).toBe(enemy);
    const offer = w.build.offerId!, choice = w.build.choices[0];
    expect(sim.chooseUpgrade(choice, offer)).toBe(true); expect(w.status).toBe('upgrade');
    expect(sim.chooseUpgrade(choice, offer)).toBe(false);
    expect(w.elapsed).toBe(frozen.elapsed); expect(w.hazards).toEqual(frozen.hazards); expect(w.playerAreas).toEqual(frozen.playerAreas);
  });
  it('clears live units before settling rewards, stores medicine, and preserves unused coolant', () => {
    const sim = quiet(), w = sim.state, p = w.player;
    w.waveTime = 90 - STEP; sim.step(idle);
    for (let i = 0; i < 96; i++) sim.step(idle);
    const boss = w.enemies.find(e => e.type === 'miniboss')!;
    const extra = sim.spawnEnemy('basic', p.x + 100, p.y)!;
    w.pickups.push({ id: 930, type: 'xp', value: 30, x: 100, y: 100, age: 0 },
      { id: 931, type: 'hp', value: 3, x: 100, y: 100, age: 0 }, { id: 932, type: 'coolant', value: 2, x: 100, y: 100, age: 0 },
      { id: 933, type: 'miniBomb', value: 1, x: 100, y: 100, age: 0 });
    p.bombs = 5; const kills = w.kills;
    sim.damageEnemy(boss, boss.hp);
    expect(w.kills).toBe(kills + 1); expect(w.enemies).not.toContain(extra); expect(w.enemies).toHaveLength(0);
    expect(p.level).toBe(2); expect(p.xp).toBe(80); // Boss120 + bomb overflow30 + existing30 - Lv2 threshold100.
    expect(p.hpReserve).toBe(3);
    expect(w.pickups.map(item => [item.type, item.value, item.x, item.y])).toEqual([['coolant', 2, p.x, p.y]]);
    expect(w.bullets).toHaveLength(25); expect(w.bullets.every(bullet => bullet.owner === 'player')).toBe(true);
    expect(w.status).toBe('upgrade'); expect(w.campaign.defeatedEncounters).toEqual(['s1:echo']);
  });
  it('continues endless into outstanding earned choices before advancing any cooldown or motion', () => {
    const sim = quiet(), w = sim.state;
    w.build.modules.push('vent', 'revive'); w.build.ranks.vent = 2;
    enqueueUpgrade(w.build, 'level', 'level:2'); w.status = 'complete';
    const elapsed = w.elapsed; sim.continueEndless();
    expect(w.status).toBe('upgrade'); expect(w.mode).toBe('endless'); expect(w.build.modules).toEqual(['vent', 'revive']);
    sim.step({ ...idle, shoot: true, dash: true }); expect(w.elapsed).toBe(elapsed); expect(w.build.ranks.vent).toBe(2);
  });
  it('returns to a clean Lv1 build on twenty restarts without retaining rank, area, reward, or input state', () => {
    const sim = quiet(); sim.reset(); const baseline = structuredClone(sim.state);
    for (let i = 0; i < 20; i++) {
      const w = sim.state; w.player.level = 10; w.build.modules.push('doubleDash', 'dashEcho'); w.build.ranks.doubleDash = 2;
      w.build.evolutions.push('echoTrail'); sim.step({ ...idle, dash: true, shoot: true });
      for (let tick = 0; tick < 11; tick++) sim.step(idle);
      expect(w.playerAreas.length).toBeGreaterThan(0); enqueueUpgrade(w.build, 'boss', 'encounter:s1:echo');
      sim.reset(); expect(sim.state).toEqual(baseline);
      expect(sim.state.player).toMatchObject({ level: 1, xp: 0, hp: BALANCE.player.hp, bombs: BALANCE.player.bombs });
    }
  });
});
