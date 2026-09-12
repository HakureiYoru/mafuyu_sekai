import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameRuntime } from './runtime';
import { SaveRepository, PROFILE_KEY } from './profile';
import type { CombatEvent, GamePhase } from './types';
import type { GameSimulation } from './simulation';

vi.mock('./audio', () => ({ GameAudio: class {
  voiceCount = 0; preload = vi.fn(async () => {}); play = vi.fn(); pause = vi.fn(); stop = vi.fn();
  finish = vi.fn(); handle = vi.fn(); setSettings = vi.fn(); destroy = vi.fn();
} }));
vi.mock('./renderer', () => ({ GameRenderer: class {
  init = vi.fn(async () => {}); render = vi.fn(); resize = vi.fn(); resetEffects = vi.fn(); handleEvents = vi.fn();
  setSettings = vi.fn(); destroy = vi.fn(); getStats = () => ({ textures: 5, particles: 0 });
} }));
vi.mock('./input', async () => {
  const { InputState } = await vi.importActual<typeof import('./input')>('./input');
  return { InputController: class extends InputState { destroy() { this.clear(); } } };
});
class MemoryStorage {
  items = new Map<string, string>(); fail = false;
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail) throw new Error('quota'); this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
}
class ElementStub extends EventTarget { dataset = {}; parentElement = { setAttribute: vi.fn() }; }
interface Internals {
  simulation: GameSimulation; phase: GamePhase; runId: string; practiceRun: boolean;
  input: { keyDown(code: string): void; shoot: boolean; keys: Set<string> };
  processEvents(events: CombatEvent[]): void; publish(): void;
}
let storage: MemoryStorage, browser: EventTarget, raf: Map<number, FrameRequestCallback>, sequence: number;
const runtimes: GameRuntime[] = [];
beforeEach(() => {
  storage = new MemoryStorage(); browser = new EventTarget(); raf = new Map(); sequence = 0;
  Object.assign(browser, { location: { search: '' }, matchMedia: () => ({ matches: false }) });
  vi.stubGlobal('localStorage', storage); vi.stubGlobal('window', browser); vi.stubGlobal('document', { activeElement: null });
  vi.stubGlobal('HTMLElement', ElementStub);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++sequence; raf.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { raf.delete(id); });
});
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.destroy(); vi.unstubAllGlobals(); });
async function runtime() { const result = new GameRuntime(new ElementStub() as unknown as HTMLElement); runtimes.push(result); await result.init(); return result; }
function grantClear() {
  return new SaveRepository(storage).recordCompletion({ runId: 'earned-s1-clear', season: 's1', difficulty: 'hard', encounterId: 's1:mafuyu', score: 4200, carryover: { level: 6, xp: 40, companions: 2 }, source: 'gameplay' });
}
function advance(time: number) { const entries = [...raf]; raf.clear(); for (const [, callback] of entries) callback(time); }

describe('runtime campaign persistence and scheduling', () => {
  it('never accepts a supplied carryover or a bare complete status as unlock evidence', async () => {
    const game = await runtime();
    game.start({ season: 's2', carryover: { level: 10, xp: 0, companions: 3 } });
    expect(game.getSnapshot()).toMatchObject({ phase: 'menu', seasonId: 's1', season2Unlocked: false });
    game.start();
    const internal = game as unknown as Internals;
    internal.simulation.state.status = 'complete';
    internal.processEvents([{ type: 'complete', x: 0, y: 0, seasonId: 's1', encounterId: 's1:mafuyu' }]);
    internal.publish();
    expect(game.getSnapshot().season2Unlocked).toBe(false);
    expect(new SaveRepository(storage).getProfile().clears).toEqual({});
  });

  it('records the real final-encounter event once, refreshes unlock, and keeps retries separate', async () => {
    const game = await runtime(); game.start();
    const internal = game as unknown as Internals, sim = internal.simulation, state = sim.state;
    const firstId = internal.runId;
    state.campaign.phase = 'encounter'; state.campaign.activeEncounter = 's1:mafuyu'; state.campaign.stage = 5;
    state.player.level = 6; state.player.xp = 40;
    const boss = sim.spawnEnemy('boss', 2000, 1800)!;
    boss.encounterId = 's1:mafuyu'; boss.spell!.cardIndex = 5; boss.spell!.stage = 'active';
    sim.damageEnemy(boss, boss.hp);
    advance(10); advance(30);
    expect(game.getSnapshot()).toMatchObject({ phase: 'complete', season2Unlocked: true, saveStatus: 'saved' });
    const repo = new SaveRepository(storage), clear = repo.getProfile().clears[`s1:${firstId}`];
    expect(clear).toMatchObject({ encounterId: 's1:mafuyu', carryover: { level: 6, xp: 40, companions: 0 } });
    internal.processEvents([{ type: 'complete', x: 0, y: 0, seasonId: 's1', encounterId: 's1:mafuyu' }]);
    expect(Object.keys(new SaveRepository(storage).getProfile().clears)).toHaveLength(1);
    game.restart(); expect(internal.runId).not.toBe(firstId); expect(raf.size).toBe(1);
  });

  it('stops the only RAF for choices, clears held input and restores the exact S1 snapshot on retry', async () => {
    grantClear(); const game = await runtime();
    game.start({ season: 's2', carryover: { level: 10, xp: 0, companions: 3 } });
    const internal = game as unknown as Internals;
    expect(game.getSnapshot()).toMatchObject({ phase: 'upgrade', level: 6, xp: 40, companions: 2, modules: [] });
    expect(raf.size).toBe(0);
    const pending = game.getSnapshot().upgradeChoices;
    internal.input.keyDown('KeyW'); internal.input.shoot = true;
    const key = new Event('keydown', { cancelable: true }); Object.assign(key, { code: 'Digit2', repeat: false }); browser.dispatchEvent(key);
    expect(game.getSnapshot()).toMatchObject({ phase: 'playing', modules: [pending[1]] });
    expect(internal.input.keys.size).toBe(0); expect(internal.input.shoot).toBe(false); expect(raf.size).toBe(1);
    game.chooseUpgrade(pending[0]); expect(game.getSnapshot().modules).toHaveLength(1); expect(raf.size).toBe(1);
    internal.simulation.state.player.level = 9;
    game.restart();
    expect(game.getSnapshot()).toMatchObject({ phase: 'upgrade', level: 6, xp: 40, companions: 2, modules: [], resonance: 0 });
    expect(game.getSnapshot().upgradeChoices).toEqual(pending); expect(raf.size).toBe(0);
    const repeat = new Event('keydown'); Object.assign(repeat, { code: 'Digit1', repeat: true }); browser.dispatchEvent(repeat);
    expect(game.getSnapshot().phase).toBe('upgrade');
    for (let i = 0; i < 20; i++) {
      game.chooseUpgrade(game.getSnapshot().upgradeChoices[0]);
      expect(raf.size).toBe(1);
      internal.input.keyDown('KeyR'); internal.input.shoot = true;
      internal.simulation.state.build.resonance = 4;
      game.restart();
      expect(game.getSnapshot()).toMatchObject({ phase: 'upgrade', level: 6, xp: 40, companions: 2, modules: [], resonance: 0 });
      expect(internal.input.keys.size).toBe(0); expect(internal.input.shoot).toBe(false); expect(raf.size).toBe(0);
    }
  });

  it('merges another tab without replacing an active build and reports storage failure while retaining the unlock', async () => {
    const game = await runtime(); game.start();
    const tick = (game as unknown as Internals).simulation.state.tick;
    grantClear();
    const event = new Event('storage'); Object.assign(event, { key: PROFILE_KEY, newValue: storage.getItem(PROFILE_KEY) }); browser.dispatchEvent(event);
    expect(game.getSnapshot()).toMatchObject({ season2Unlocked: true, seasonId: 's1', level: 1 });
    expect(game.getSnapshot().saveMessage).toContain('标签页');
    expect((game as unknown as Internals).simulation.state.tick).toBe(tick); expect(raf.size).toBe(1);
    storage.fail = true;
    (game as unknown as Internals).simulation.state.score = 9999;
    game.returnToMenu(); expect(game.getSnapshot()).toMatchObject({ saveStatus: 'session', season2Unlocked: true });
    expect(game.getSnapshot().saveMessage.length).toBeGreaterThan(0);
  });

  it('a practice run cannot write a completion even with matching final-encounter state', async () => {
    const game = await runtime(); game.start();
    const internal = game as unknown as Internals, state = internal.simulation.state;
    internal.practiceRun = true; state.status = 'complete'; state.campaign.phase = 'complete'; state.campaign.defeatedEncounters.push('s1:mafuyu');
    internal.processEvents([{ type: 'complete', seasonId: 's1', encounterId: 's1:mafuyu', x: 0, y: 0 }]); internal.publish();
    expect(game.getSnapshot().season2Unlocked).toBe(false);
  });
});
