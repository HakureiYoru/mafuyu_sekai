import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameRuntime } from './runtime';
import { SaveRepository, PROFILE_KEY } from './profile';
import type { ArenaRect, CombatEvent, Enemy, GamePhase, TouchAction, WorldState } from './types';
import type { GameSimulation } from './simulation';
import { enqueueUpgrade } from './upgrades';

vi.mock('./audio', () => ({ GameAudio: class {
  voiceCount = 0; preload = vi.fn(async () => {}); play = vi.fn(); pause = vi.fn(); stop = vi.fn();
  finish = vi.fn(); handle = vi.fn(); setSettings = vi.fn(); destroy = vi.fn();
} }));
vi.mock('./renderer', () => ({ GameRenderer: class {
  init = vi.fn(async () => {}); render = vi.fn(); resize = vi.fn(); resetEffects = vi.fn(); handleEvents = vi.fn();
  setSettings = vi.fn(); setControlMode = vi.fn(); setTouchAim = vi.fn(); destroy = vi.fn(); getStats = () => ({ textures: 5, particles: 0 });
} }));
vi.mock('./input', async () => {
  const { InputState } = await vi.importActual<typeof import('./input')>('./input');
  return { InputController: class extends InputState { destroy() { this.clear(); } } };
});
vi.mock('./touch-input', async () => {
  const { TouchInputState } = await vi.importActual<typeof import('./touch-input')>('./touch-input');
  return { TouchInputController: class {
    state = new TouchInputState();
    constructor(_shell: unknown, _host: unknown, private callbacks: { world(): WorldState; query(rect: ArenaRect, out: Enemy[]): Enemy[] }) {}
    read(dt: number) { return this.state.read(this.callbacks.world(), dt, this.callbacks.query); }
    command(action: TouchAction) { this.state.command(action); }
    clear() { this.state.clear(); }
    reset() { this.state.reset(); }
    destroy() { this.clear(); }
    get hud() { return this.state.hud; }
    get aim() { return this.state.aim; }
  } };
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
let storage: MemoryStorage, browser: EventTarget, raf: Map<number, FrameRequestCallback>, sequence: number, coarse: boolean;
const runtimes: GameRuntime[] = [];
beforeEach(() => {
  storage = new MemoryStorage(); browser = new EventTarget(); raf = new Map(); sequence = 0; coarse = false;
  Object.assign(browser, { innerWidth: 1280, innerHeight: 720, location: { search: '' }, matchMedia: (query: string) => ({ matches: (query.includes('coarse') || query.includes('hover: none')) && coarse }) });
  vi.stubGlobal('localStorage', storage); vi.stubGlobal('window', browser); vi.stubGlobal('document', { activeElement: null });
  vi.stubGlobal('HTMLElement', ElementStub);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++sequence; raf.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { raf.delete(id); });
});
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.destroy(); vi.unstubAllGlobals(); });
async function runtime() { const result = new GameRuntime(new ElementStub() as unknown as HTMLElement); runtimes.push(result); await result.init(); return result; }
function grantClear() {
  return new SaveRepository(storage).recordCompletion({ runId: 'earned-v6-clear', difficulty: 'hard', encounterId: 's2:final', score: 4200, source: 'gameplay' });
}
function advance(time: number) { const entries = [...raf]; raf.clear(); for (const [, callback] of entries) callback(time); }

describe('runtime continuous campaign persistence and scheduling', () => {
  it('starts fresh despite legacy carried strength and never saves a bare complete state', async () => {
    storage.setItem('mafuyu-sekai:profile:v1', JSON.stringify({ version: 1, revision: 0, clears: {}, carryover: { level: 10, xp: 100, companions: 3 } }));
    const game = await runtime(); game.start({ difficulty: 'hard' });
    expect(game.getSnapshot()).toMatchObject({ phase: 'playing', level: 1, companions: 0, modules: [], difficulty: 'hard' });
    const internal = game as unknown as Internals; internal.simulation.state.status = 'complete';
    internal.processEvents([{ type: 'complete', x: 0, y: 0, encounterId: 's2:final' }]); internal.publish();
    expect(new SaveRepository(storage).getProfile().clears).toEqual({});
  });
  it('saves only LACUNA once and retains no carryover on twenty retries', async () => {
    const game = await runtime(); game.start();
    const internal = game as unknown as Internals, state = internal.simulation.state, firstId = internal.runId;
    state.status = 'complete'; state.campaign.phase = 'complete'; state.campaign.defeatedEncounters.push('s2:final');
    internal.processEvents([{ type: 'complete', x: 0, y: 0, encounterId: 's1:mafuyu' }]);
    expect(new SaveRepository(storage).getProfile().clears).toEqual({});
    const event: CombatEvent = { type: 'complete', x: 0, y: 0, encounterId: 's2:final' };
    internal.processEvents([event, event]); internal.publish();
    expect(Object.keys(new SaveRepository(storage).getProfile().clears)).toEqual(['v6:' + firstId]);
    for (let i = 0; i < 20; i++) {
      internal.input.keyDown('KeyR'); internal.input.shoot = true;
      internal.simulation.state.build.resonance = 4; internal.simulation.state.player.level = 9;
      game.restart();
      expect(game.getSnapshot()).toMatchObject({ phase: 'playing', level: 1, xp: 0, companions: 0, modules: [], resonance: 0, rerollsRemaining: 2 });
      expect(internal.input.keys.size).toBe(0); expect(internal.input.shoot).toBe(false); expect(raf.size).toBe(1);
    }
    expect(internal.runId).not.toBe(firstId);
  });
  it('stops the only RAF for a level choice and resumes the frozen battlefield after selection', async () => {
    const game = await runtime(); game.start();
    const internal = game as unknown as Internals, state = internal.simulation.state;
    state.spawnTimer = 3600;
    state.pickups.push({ id: 990001, type: 'xp', value: 100, x: state.player.x, y: state.player.y, age: 0 });
    const enemy = internal.simulation.spawnEnemy('basic', state.player.x + 500, state.player.y)!;
    advance(10); advance(30);
    expect(game.getSnapshot().phase).toBe('upgrade'); expect(raf.size).toBe(0);
    const offer = game.getSnapshot(), frozen = { tick: state.tick, x: enemy.x, cooldown: enemy.cooldown };
    internal.input.keyDown('KeyW'); internal.input.shoot = true;
    advance(1000);
    expect({ tick: state.tick, x: enemy.x, cooldown: enemy.cooldown }).toEqual(frozen);
    game.rerollUpgrades(); expect(game.getSnapshot().rerollsRemaining).toBe(1);
    game.chooseUpgrade(offer.upgradeChoices[0], offer.upgradeOfferId!);
    expect(game.getSnapshot().phase).toBe('upgrade');
    const current = game.getSnapshot(); game.chooseUpgrade(current.upgradeChoices[0], current.upgradeOfferId!);
    expect(game.getSnapshot().phase).toBe('playing'); expect(raf.size).toBe(1);
    expect(state.enemies.some(item => item.id === enemy.id)).toBe(true);
    expect(internal.input.keys.size).toBe(0); expect(internal.input.shoot).toBe(false);
    game.chooseUpgrade(current.upgradeChoices[0], current.upgradeOfferId!);
    expect(game.getSnapshot().modules).toHaveLength(1); expect(raf.size).toBe(1);
  });
  it('merges another tab without replacing the active run and reports storage failure', async () => {
    const game = await runtime(); game.start();
    const internal = game as unknown as Internals, tick = internal.simulation.state.tick;
    grantClear();
    const event = new Event('storage'); Object.assign(event, { key: PROFILE_KEY, newValue: storage.getItem(PROFILE_KEY) }); browser.dispatchEvent(event);
    expect(game.getSnapshot()).toMatchObject({ level: 1, phase: 'playing' });
    expect(game.getSnapshot().saveMessage).toContain('标签页'); expect(internal.simulation.state.tick).toBe(tick); expect(raf.size).toBe(1);
    storage.fail = true; internal.simulation.state.score = 9999; game.returnToMenu();
    expect(game.getSnapshot()).toMatchObject({ saveStatus: 'session', bestScore: 9999 });
    expect(game.getSnapshot().saveMessage).toContain('未保存到浏览器');
  });
  it('practice cannot persist even with a matching final state', async () => {
    const game = await runtime(); game.start();
    const internal = game as unknown as Internals, state = internal.simulation.state;
    internal.practiceRun = true; state.status = 'complete'; state.campaign.phase = 'complete'; state.campaign.defeatedEncounters.push('s2:final');
    internal.processEvents([{ type: 'complete', encounterId: 's2:final', x: 0, y: 0 }]);
    expect(new SaveRepository(storage).getProfile().clears).toEqual({});
  });
  it('keeps an earned final-tick upgrade paused when continuing endless, without mixing mode scores', async () => {
    const game = await runtime(); game.start();
    const internal = game as unknown as Internals, state = internal.simulation.state;
    state.score = 1200; state.status = 'complete'; state.campaign.phase = 'complete'; state.campaign.defeatedEncounters.push('s2:final');
    enqueueUpgrade(state.build, 'level', 'level:2');
    state.build.modules = ['revive']; state.build.ranks.revive = 1;
    internal.processEvents([{ type: 'complete', encounterId: 's2:final', x: 0, y: 0 }]);
    advance(10); advance(30);
    expect(game.getSnapshot().phase).toBe('complete'); expect(raf.size).toBe(0);
    game.continueEndless();
    expect(game.getSnapshot()).toMatchObject({ phase: 'upgrade', mode: 'endless', modules: ['revive'] });
    const tick = state.tick; expect(raf.size).toBe(0); advance(5000); expect(state.tick).toBe(tick);
    const choice = game.getSnapshot(); game.chooseUpgrade(choice.upgradeChoices[0], choice.upgradeOfferId!);
    expect(game.getSnapshot().phase).toBe('playing'); expect(raf.size).toBe(1);
    state.score = 4500;
    internal.processEvents([{ type: 'complete', encounterId: 's2:final', x: 0, y: 0 }]);
    game.returnToMenu();
    const profile = new SaveRepository(storage).getProfile();
    expect(profile.bestScores.v6.normal).toEqual({ story: 1200, endless: 4500 });
    expect(Object.values(profile.clears)).toHaveLength(1); expect(Object.values(profile.clears)[0].score).toBe(1200);
  });
  it('blocks portrait starts and stays paused after rotation back, without retaining touch actions', async () => {
    coarse = true; Object.assign(browser, { innerWidth: 390, innerHeight: 844 });
    const game = await runtime();
    expect(game.getSnapshot()).toMatchObject({ controlMode: 'touch', orientationBlocked: true, settings: { quality: 'low' } });
    game.start(); expect(game.getSnapshot().phase).toBe('menu'); expect(raf.size).toBe(0);
    Object.assign(browser, { innerWidth: 844, innerHeight: 390 }); browser.dispatchEvent(new Event('resize'));
    game.start(); game.touchAction({ type: 'move', x: 1, y: 0 }); game.touchAction({ type: 'focus' }); game.touchAction({ type: 'fire' }); game.touchAction({ type: 'bomb' });
    Object.assign(browser, { innerWidth: 390, innerHeight: 844 }); browser.dispatchEvent(new Event('resize'));
    expect(game.getSnapshot()).toMatchObject({ phase: 'paused', orientationBlocked: true, touch: { focus: false, autoFireEnabled: false } });
    game.resume(); expect(raf.size).toBe(0);
    Object.assign(browser, { innerWidth: 844, innerHeight: 390 }); browser.dispatchEvent(new Event('resize'));
    expect(game.getSnapshot().phase).toBe('paused'); expect(raf.size).toBe(0);
    game.resume(); const state = (game as unknown as Internals).simulation.state, x = state.player.x;
    advance(10); advance(30); expect(state.player.x).toBe(x); expect(state.player.bombs).toBe(3);
    game.restart(); expect(game.getSnapshot().touch.autoFireEnabled).toBe(true); expect(raf.size).toBe(1);
  });
  it('allows portrait choices but cannot resume simulation through the final selection', async () => {
    coarse = true; const game = await runtime(); game.start();
    const internal = game as unknown as Internals, state = internal.simulation.state;
    state.spawnTimer = 3600; state.pickups.push({ id: 980001, type: 'xp', value: 100, x: state.player.x, y: state.player.y, age: 0 });
    advance(10); advance(30); expect(game.getSnapshot().phase).toBe('upgrade');
    Object.assign(browser, { innerWidth: 390, innerHeight: 844 }); browser.dispatchEvent(new Event('resize'));
    const choice = game.getSnapshot(); game.chooseUpgrade(choice.upgradeChoices[0], choice.upgradeOfferId!);
    expect(game.getSnapshot().phase).toBe('paused'); expect(raf.size).toBe(0);
    const tick = state.tick; advance(5000); expect(state.tick).toBe(tick);
  });
  it('fixes auto mode at run start, changes it only while paused, and preserves existing quality', async () => {
    storage.setItem('mafuyu-sekai:settings:v3', JSON.stringify({ quality: 'high', masterVolume: 0.27 }));
    coarse = true; const game = await runtime(); game.start();
    expect(game.getSnapshot()).toMatchObject({ controlMode: 'touch', settings: { quality: 'high', masterVolume: 0.27 } });
    coarse = false; browser.dispatchEvent(new Event('resize'));
    expect(game.getSnapshot().controlMode).toBe('touch');
    game.setSettings({ controlMode: 'keyboardMouse' }); expect(game.getSnapshot().controlMode).toBe('touch');
    game.pause(); game.setSettings({ controlMode: 'keyboardMouse' });
    expect(game.getSnapshot().controlMode).toBe('keyboardMouse'); game.resume(); expect(raf.size).toBe(1);
  });
  it('reports 30 rendered frames separately from the unchanged 60 simulation steps', async () => {
    coarse = true; const game = await runtime(); game.setSettings({ touchFrameRate: 30 }); game.start();
    const state = (game as unknown as Internals).simulation.state; state.spawnTimer = 3600;
    for (let frame = 0; frame <= 144 * 3; frame++) advance(10 + frame * 1000 / 144);
    expect(state.tick).toBe(180); expect(game.getSnapshot().stats.renderFps).toBeCloseTo(30, 0);
    expect(game.getSnapshot().stats.simulationHz).toBeCloseTo(60, 0);
  });
});


describe('first-batch runtime regressions', () => {
  it('does not deep-copy profile/history during repeated HUD publications', async () => {
    const getters = [vi.spyOn(SaveRepository.prototype, 'getProfile'), vi.spyOn(SaveRepository.prototype, 'getLegacyHistory'),
      vi.spyOn(SaveRepository.prototype, 'getLegacyV5History')];
    try {
      const game = await runtime(); game.start();
      const internal = game as unknown as Internals;
      const before = getters.map(getter => getter.mock.calls.length);
      for (let i = 0; i < 120; i++) internal.publish();
      expect(getters.map(getter => getter.mock.calls.length)).toEqual(before);
      internal.simulation.state.score = 9999; game.returnToMenu();
      expect(game.getSnapshot().bestScore).toBe(9999);
      // Saving also makes defensive copies inside SaveRepository; those are not HUD work.
      const afterSave = getters.map(getter => getter.mock.calls.length);
      afterSave.forEach((count, index) => expect(count).toBeGreaterThan(before[index]));
      for (let i = 0; i < 120; i++) internal.publish();
      expect(getters.map(getter => getter.mock.calls.length)).toEqual(afterSave);
    } finally { for (const getter of getters) getter.mockRestore(); }
  });
  it('refreshes cached scores when another tab saves, without restarting combat', async () => {
    const game = await runtime(); game.start({ difficulty: 'normal' });
    new SaveRepository(storage).recordScore('story', 'normal', 7777);
    const event = new Event('storage'); Object.assign(event, { key: PROFILE_KEY, newValue: storage.getItem(PROFILE_KEY) });
    browser.dispatchEvent(event);
    expect(game.getSnapshot()).toMatchObject({ phase: 'playing', bestScore: 7777, saveStatus: 'saved' });
  });
  it('randomizes ordinary starts but forwards explicit seeds, including zero, unchanged', async () => {
    const game = await runtime(); const internal = game as unknown as Internals;
    const reset = vi.spyOn(internal.simulation, 'reset');
    game.start(); const first = reset.mock.calls.at(-1)![1];
    game.start(); const second = reset.mock.calls.at(-1)![1];
    expect(first).not.toBe(second); expect(typeof first).toBe('number');
    for (const seed of [7, 7, 0, 0]) { game.start({ seed }); expect(reset.mock.calls.at(-1)![1]).toBe(seed); }
    reset.mockRestore();
  });
});
