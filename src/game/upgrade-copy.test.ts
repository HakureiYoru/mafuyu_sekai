import { describe, expect, it } from 'vitest';
import { compactChoiceDescription } from './upgrade-copy';
import { createBuild, EVOLUTIONS, MODULES } from './upgrades';
import type { EvolutionId, ModuleId } from './types';

function summary(id: ModuleId, proposedRank: number, evolutions: EvolutionId[] = []) {
  const build = createBuild();
  if (proposedRank > 1) { build.modules = [id]; build.ranks[id] = proposedRank - 1; }
  build.evolutions = evolutions;
  return compactChoiceDescription(build, id);
}

describe('compact upgrade choice descriptions', () => {
  it('covers every choice and keeps high-rank cards readable without mutating the build', () => {
    for (const id of Object.keys(MODULES) as ModuleId[]) for (const rank of [1, 2, 3, 4, 5, 6, 20, 10000]) for (const evolutions of [[], Object.keys(EVOLUTIONS) as EvolutionId[]]) {
      const text = summary(id, rank, evolutions);
      expect(text, `${id}:${rank}`).toBeTruthy();
      expect(text.length, `${id}:${rank}: ${text}`).toBeLessThanOrEqual(40);
      expect(text).not.toMatch(/undefined|NaN|Infinity|III|\bV\b/);
    }
    const build = createBuild(), before = structuredClone(build);
    for (const id of Object.keys(EVOLUTIONS) as EvolutionId[]) {
      expect(compactChoiceDescription(build, `evolution:${id}`).length).toBeLessThanOrEqual(40);
    }
    for (const id of ['reward:heal', 'reward:bomb', 'reward:xp'] as const) {
      expect(compactChoiceDescription(build, id)).toMatch(/HP|XP/);
    }
    compactChoiceDescription(build, 'pulseChamber');
    expect(build).toEqual(before);
  });

  it('shows the actual proposed shape without advertising a future milestone', () => {
    expect(summary('crescentMagazine', 2)).toContain('1枚弯月刃');
    expect(summary('crescentMagazine', 3)).toContain('2枚弯月刃');
    expect(summary('crescentMagazine', 4)).toContain('2枚弯月刃');
    expect(summary('crescentMagazine', 4)).toContain('每枚伤害4');
    expect(summary('crescentMagazine', 5)).toContain('3枚弯月刃');
    expect(summary('pulseChamber', 3)).toContain('1道声波');
    expect(summary('pulseChamber', 4)).toContain('1道声波');
    expect(summary('pulseChamber', 5)).toContain('2道声波');
    expect(summary('droneConduit', 4)).not.toContain('三角');
    expect(summary('droneConduit', 5)).toContain('三角');
  });

  it('uses interpolated arc values and restricts new passive effects to their real ranks', () => {
    expect(summary('dronePlectrum', 2)).toContain('135°');
    expect(summary('dronePlectrum', 4)).toContain('270°');
    expect(summary('dronePlectrum', 5)).toContain('360°');
    expect(summary('decoyEcho', 2)).not.toContain('减速');
    expect(summary('decoyEcho', 3)).toContain('减速');
    expect(summary('slipstream', 4)).not.toContain('减速');
    expect(summary('slipstream', 5)).toContain('减速');
    expect(summary('counterPulse', 4)).not.toContain('减速');
    expect(summary('counterPulse', 5)).toContain('减速');
  });

  it('retains defensive limits and reports high-rank growth without adding projectiles or revives', () => {
    expect(summary('doubleDash', 20)).toContain('最多储存两次');
    expect(summary('intercept', 20)).toContain('最多储备一次');
    expect(summary('revive', 20)).toContain('已用不恢复');
    expect(summary('crescentMagazine', 20)).toContain('3枚弯月刃');
    expect(summary('piercing', 6)).toContain('基础伤害×1.12');
    expect(summary('wingShots', 4)).toContain('伤害3.9');
  });

  it('describes evolved replacement attacks using their resulting-rank damage', () => {
    const trail = summary('dashEcho', 3, ['echoTrail']);
    expect(trail).toContain('0.75秒尾迹');
    expect(trail).toContain('伤害14.4');
    expect(trail).not.toMatch(/爆破|半径/);
    expect(summary('dashEcho', 6, ['echoTrail'])).toContain('伤害18.82');
    const volley = summary('droneBurst', 3, ['triangleAssault']);
    expect(volley).toContain('累计8次基础命中');
    expect(volley).toContain('总伤害36');
    expect(volley).not.toContain('16.8');
    expect(summary('droneBurst', 6, ['triangleAssault'])).toContain('总伤害40.32');
  });

  it('keeps the evolved needle target cap and never claims evolved counter pulses cannot clear bullets', () => {
    expect(summary('piercing', 3, ['needleArray'])).toContain('慢移针弹最多命中5敌');
    expect(summary('piercing', 3, ['needleArray'])).toContain('非慢移主炮额外穿透3敌');
    expect(summary('piercing', 6, ['needleArray'])).toContain('基础主炮伤害×1.12');
    for (const rank of [3, 4, 5, 6, 20]) {
      const text = summary('counterPulse', rank, ['counterCurtain']);
      expect(text).toContain('首圈最多清三枚普通弹');
      expect(text).not.toContain('不清弹');
    }
    expect(summary('counterPulse', 4, ['counterCurtain'])).not.toContain('减速');
    expect(summary('counterPulse', 5, ['counterCurtain'])).toContain('减速区25%');
  });
});
