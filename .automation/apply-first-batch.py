"""One-shot, branch-only patch. Removed by the applying commit; never shipped."""
from pathlib import Path
import json
import subprocess

EXPECTED = {
    'src/game/runtime.ts': '01054f94df15d11263b5c57569020d5f81587fd4',
    'src/game/renderer.ts': 'd32b2fca775d9cabba0a5114b99754a496ebed40',
    'src/game/effects.ts': '9fb6c35b18d275d63727b2d9c6de7219c3a7092e',
    'src/App.tsx': '28b03b7fcc70990c7a6093c1ea8c0804b2ba3c0c',
    'src/game/runtime-campaign.test.ts': '596fd3b80eb47ed75daaa8795ec39f589439f731',
    'vercel.json': 'f77863fa5918236d6402b7c620db6c3960682910',
}
for name, expected in EXPECTED.items():
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD:' + name], text=True).strip()
    if actual != expected:
        raise RuntimeError(f'Refusing to patch changed input: {name}: {actual}')

files = {name: Path(name).read_text(encoding='utf-8') for name in EXPECTED}
def replace(name, old, new, count=1):
    actual = files[name].count(old)
    if actual != count:
        raise RuntimeError(f'{name}: expected {count} occurrences, found {actual}: {old[:120]!r}')
    files[name] = files[name].replace(old, new)
def add(name, text):
    if Path(name).exists():
        raise RuntimeError(f'Refusing to overwrite new file: {name}')
    files[name] = text

r = 'src/game/runtime.ts'
replace(r, "import { FixedClock, RenderGate } from './clock';", "import { FixedClock, RenderGate } from './clock';\nimport { createRunSeed } from './run-seed';\nimport { requestGameFullscreen } from './fullscreen';\nimport { watchDevicePixelRatio } from './render-resolution';")
replace(r, '  private saves = new SaveRepository();', '  private saves = new SaveRepository();\n  // Refresh only at persistence boundaries, never in the combat HUD hot path.\n  private savedHud = this.readSavedHud();')
replace(r, '  private simulation = new GameSimulation(12345, this.difficulty);', '  private runSeed = 12345;\n  private simulation = new GameSimulation(this.runSeed, this.difficulty);')
replace(r, '  private resizeObserver: ResizeObserver;', '  private resizeObserver: ResizeObserver;\n  private stopWatchingDensity: () => void;')
replace(r, "    this.resizeObserver = new ResizeObserver(() => {\n      if (!this.renderer || this.disposed) return;\n      try { this.renderer.resize(); if (this.phase !== 'playing') this.renderer.render(this.simulation.state, 1, 0); } catch (error) { this.fail(error); }\n    });\n    this.resizeObserver.observe(host);", "    this.resizeObserver = new ResizeObserver(this.resizeRenderer);\n    this.resizeObserver.observe(host);\n    this.stopWatchingDensity = watchDevicePixelRatio(this.resizeRenderer);")
replace(r, '      const result = this.saves.mergeExternal(event.newValue);', '      const result = this.saves.mergeExternal(event.newValue);\n      this.savedHud = this.readSavedHud();')
replace(r, '  private onViewportChange = () => this.updateViewport(true);', "  private resizeRenderer = () => {\n    if (!this.renderer || this.disposed) return;\n    try { this.renderer.resize(); if (this.phase !== 'playing') this.renderer.render(this.simulation.state, 1, 0); } catch (error) { this.fail(error); }\n  };\n  private onViewportChange = () => { this.updateViewport(true); this.resizeRenderer(); };")
replace(r, "  requestFullscreen = async (): Promise<void> => {\n    try {\n      if (!document.fullscreenElement && this.shell.requestFullscreen) await this.shell.requestFullscreen();\n      const orientation = window.screen?.orientation as (ScreenOrientation & { lock?: (value: string) => Promise<void> }) | undefined;\n      if (document.fullscreenElement && orientation?.lock) await orientation.lock('landscape');\n    } catch { /* Optional enhancement: browser landscape remains playable without it. */ }\n  };", '  requestFullscreen = (): Promise<void> => requestGameFullscreen(this.shell);')
replace(r, '    this.saves.mergeExternal();', '    this.saves.mergeExternal();\n    this.savedHud = this.readSavedHud();')
replace(r, "    this.simulation.reset('story', options.seed, this.difficulty, { difficulty: this.difficulty });", "    this.runSeed = options.seed ?? createRunSeed(this.runSeed);\n    this.simulation.reset('story', this.runSeed, this.difficulty, { difficulty: this.difficulty });")
replace(r, '    this.saves.recordScore(mode, difficulty, score);', '    this.saves.recordScore(mode, difficulty, score);\n    this.savedHud = this.readSavedHud();')
replace(r, "      encounterId: final, score: state.score, source: 'gameplay' });", "      encounterId: final, score: state.score, source: 'gameplay' });\n    this.savedHud = this.readSavedHud();")
replace(r, '    const profile = this.saves.getProfile(), legacy = this.saves.getLegacyHistory(), legacyV5 = this.saves.getLegacyV5History();', '    const saved = this.savedHud;')
replace(r, 'profile.bestScores.v6[state.difficulty][state.mode]', 'saved.bestScores[state.difficulty][state.mode]')
replace(r, 'Math.max(legacy.bestScores.s1[state.difficulty], legacy.bestScores.s2[state.difficulty], legacyV5.bestScores[state.difficulty].story, legacyV5.bestScores[state.difficulty].endless)', 'saved.historicalBestScores[state.difficulty]')
replace(r, "Object.keys(profile.clears).length || Object.values(profile.bestScores.v6).some(scores => scores.story || scores.endless) ? 'saved' : 'empty'", "saved.hasRecord ? 'saved' : 'empty'")
replace(r, '  private publish() {', """  private readSavedHud() {
    const profile = this.saves.getProfile();
    const legacy = this.saves.getLegacyHistory(), legacyV5 = this.saves.getLegacyV5History();
    const historical = (difficulty: Difficulty) => Math.max(legacy.bestScores.s1[difficulty], legacy.bestScores.s2[difficulty],
      legacyV5.bestScores[difficulty].story, legacyV5.bestScores[difficulty].endless);
    return {
      bestScores: profile.bestScores.v6,
      historicalBestScores: { normal: historical('normal'), hard: historical('hard') },
      hasRecord: Object.keys(profile.clears).length > 0 || Object.values(profile.bestScores.v6).some(scores => scores.story > 0 || scores.endless > 0),
    };
  }
  private publish() {""")
replace(r, 'this.abort.abort(); this.resizeObserver.disconnect();', 'this.abort.abort(); this.resizeObserver.disconnect(); this.stopWatchingDensity();')
replace(r, '      snapshot: () => this.getSnapshot(),', '      snapshot: () => this.getSnapshot(),\n      seed: () => this.runSeed,')
replace(r, "        this.simulation.reset(options?.mode ?? 'endless', 20260912, this.difficulty, { difficulty: this.difficulty });", "        this.runSeed = 20260912;\n        this.simulation.reset(options?.mode ?? 'endless', this.runSeed, this.difficulty, { difficulty: this.difficulty });")
replace(r, '  snapshot(): HudSnapshot; state(): WorldState;', '  seed(): number;\n  snapshot(): HudSnapshot; state(): WorldState;')

p = 'src/game/renderer.ts'
replace(p, "import { EffectSystem, retainEffectNumberFont } from './effects';", "import { EffectSystem, retainEffectNumberFont } from './effects';\nimport { resolveRenderResolution } from './render-resolution';")
replace(p, "    const width = Math.max(1, rect.width), height = Math.max(1, rect.height);\n    const factor = QUALITY[this.settings.quality].scale;\n    const touch = this.controlMode === 'touch';\n    const scale = Math.min(width / VIEW.width, height / VIEW.height) * Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2);\n    const mobileBudget = { low: 960 * 540, medium: 1280 * 720, high: 1600 * 900 }[this.settings.quality];\n    const limit = touch ? Math.sqrt(mobileBudget / (VIEW.width * VIEW.height)) : Math.sqrt(1920 * 1080 / (VIEW.width * VIEW.height)) * factor;\n    const resolution = Math.max(0.25, Math.min(scale, limit));\n    this.app.renderer.resize(VIEW.width, VIEW.height, resolution);", "    const resolution = resolveRenderResolution(rect.width, rect.height, window.devicePixelRatio, this.settings.quality, this.controlMode);\n    // CSS owns the displayed size; the simulation and pointer mapping stay at VIEW.\n    // Do not reallocate/clear an unchanged drawing buffer on redundant resize events.\n    if (Math.abs(this.app.renderer.resolution - resolution) > 0.0001) {\n      this.app.renderer.resize(VIEW.width, VIEW.height, resolution);\n    }")
replace(p, 'resolution: 1.5', 'resolution: 2', count=2)
if files[p].count('QUALITY') == 1:
    replace(p, 'ENEMIES, QUALITY, VIEW', 'ENEMIES, VIEW')
replace('src/game/effects.ts', 'resolution: 1.5', 'resolution: 2', count=2)
replace('src/App.tsx', "void runtime.requestFullscreen().catch(() => setNotice('当前浏览器不支持全屏，可直接横屏游玩。'));", "void runtime.requestFullscreen().catch((error: unknown) => setNotice(error instanceof Error ? error.message : '未能进入全屏，可直接横屏游玩。'));")
replace('vercel.json', '"buildCommand": "npm run build"', '"buildCommand": "npm run check"')

add('src/game/run-seed.ts', """/** Keep random new games separate from explicitly seeded replays and simulation tests. */
const randomWord = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
export function createRunSeed(previous: number, sample: () => number = randomWord): number {
  const seed = (sample() >>> 0) || 1;
  // Avoid a zero PRNG state and guarantee that consecutive normal starts differ,
  // even in the exceptionally rare case of a repeated random word.
  return seed === (previous >>> 0) ? seed === 0xffffffff ? 1 : seed + 1 : seed;
}
""")
add('src/game/fullscreen.ts', """/** Fullscreen failure is visible; optional orientation-lock failure is not fatal. */
export async function requestGameFullscreen(shell: HTMLElement): Promise<void> {
  if (document.fullscreenElement !== shell) {
    if (typeof shell.requestFullscreen !== 'function') {
      throw new Error('当前浏览器不支持全屏，可直接横屏游玩。');
    }
    try {
      // Call synchronously up to the first await, preserving the user's activation.
      await shell.requestFullscreen();
    } catch {
      throw new Error('浏览器未允许进入全屏，可直接横屏游玩或再次尝试。');
    }
  }
  const orientation = window.screen?.orientation as (ScreenOrientation & { lock?: (value: string) => Promise<void> }) | undefined;
  if (document.fullscreenElement === shell && typeof orientation?.lock === 'function') {
    try { await orientation.lock('landscape'); } catch { /* Fullscreen remains useful without orientation lock. */ }
  }
}
""")
add('src/game/render-resolution.ts', """import { VIEW } from './config';
import type { GameSettings, ResolvedControlMode } from './types';

/** Physical-pixel budgets, independent of particle/star counts. No supersampling. */
export const RENDER_PIXEL_BUDGET = {
  touch: { low: 1280 * 720, medium: 1600 * 900, high: 1920 * 1080 },
  keyboardMouse: { low: 1920 * 1080, medium: 2560 * 1440, high: 2880 * 1620 },
} as const;
const positive = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;

export function resolveRenderResolution(width: number, height: number, devicePixelRatio: number,
  quality: GameSettings['quality'], mode: ResolvedControlMode): number {
  const cssScale = Math.min(positive(width, 1) / VIEW.width, positive(height, 1) / VIEW.height);
  const density = Math.min(positive(devicePixelRatio, 1), mode === 'touch' ? 2 : 2.5);
  const budgetScale = Math.sqrt(RENDER_PIXEL_BUDGET[mode][quality] / (VIEW.width * VIEW.height));
  return Math.max(1 / VIEW.height, Math.min(cssScale * density, budgetScale));
}

/** DPR can change without a ResizeObserver event when moving between monitors. */
export function watchDevicePixelRatio(onChange: () => void): () => void {
  let query: MediaQueryList | undefined;
  let disposed = false;
  const listen = () => {
    query?.removeEventListener?.('change', changed);
    query = window.matchMedia(`(resolution: ${positive(window.devicePixelRatio, 1)}dppx)`);
    query.addEventListener?.('change', changed);
  };
  const changed = () => {
    if (disposed) return;
    listen();
    onChange();
  };
  listen();
  return () => { disposed = true; query?.removeEventListener?.('change', changed); };
}
""")
add('src/game/run-seed.test.ts', """import { describe, expect, it } from 'vitest';
import { createRunSeed } from './run-seed';

describe('new-run seeds', () => {
  it('uses the sampled unsigned value', () => expect(createRunSeed(12345, () => 123456)).toBe(123456));
  it('never starts the random generator at zero', () => expect(createRunSeed(12345, () => 0)).toBe(1));
  it('does not repeat the previous seed on a random collision', () => expect(createRunSeed(42, () => 42)).toBe(43));
  it('wraps a collision at uint32 max without returning zero', () => expect(createRunSeed(0xffffffff, () => 0xffffffff)).toBe(1));
  it('uses real browser-compatible crypto by default', () => {
    const seed = createRunSeed(12345);
    expect(Number.isInteger(seed)).toBe(true); expect(seed).toBeGreaterThan(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff); expect(seed).not.toBe(12345);
  });
});
""")
add('src/game/fullscreen.test.ts', """import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestGameFullscreen } from './fullscreen';

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const doc: { fullscreenElement: Element | null } = { fullscreenElement: null };
  const lock = vi.fn(async () => {});
  const shell = { requestFullscreen: vi.fn(async () => { doc.fullscreenElement = shell as unknown as HTMLElement; }) };
  vi.stubGlobal('document', doc); vi.stubGlobal('window', { screen: { orientation: { lock } } });
  return { doc, lock, shell, element: shell as unknown as HTMLElement };
}
describe('fullscreen feedback', () => {
  it('reports unavailable fullscreen instead of silently resolving', async () => {
    fixture(); await expect(requestGameFullscreen({} as HTMLElement)).rejects.toThrow('不支持全屏');
  });
  it('reports rejected requests without trying orientation lock', async () => {
    const f = fixture(); f.shell.requestFullscreen.mockRejectedValue(new Error('NotAllowedError'));
    await expect(requestGameFullscreen(f.element)).rejects.toThrow('未允许进入全屏');
    expect(f.lock).not.toHaveBeenCalled();
  });
  it('enters fullscreen and attempts landscape lock', async () => {
    const f = fixture(); await requestGameFullscreen(f.element);
    expect(f.shell.requestFullscreen).toHaveBeenCalledTimes(1); expect(f.lock).toHaveBeenCalledWith('landscape');
  });
  it('does not request fullscreen again for the current shell', async () => {
    const f = fixture(); f.doc.fullscreenElement = f.element; await requestGameFullscreen(f.element);
    expect(f.shell.requestFullscreen).not.toHaveBeenCalled();
  });
  it('does not misreport successful fullscreen as failure when lock is rejected', async () => {
    const f = fixture(); f.lock.mockRejectedValue(new Error('NotSupportedError'));
    await expect(requestGameFullscreen(f.element)).resolves.toBeUndefined();
    expect(f.doc.fullscreenElement).toBe(f.element);
  });
  it('works without an orientation API', async () => {
    const f = fixture(); vi.stubGlobal('window', {});
    await expect(requestGameFullscreen(f.element)).resolves.toBeUndefined();
  });
});
""")
add('src/game/render-resolution.test.ts', """import { afterEach, describe, expect, it, vi } from 'vitest';
import { RENDER_PIXEL_BUDGET, resolveRenderResolution, watchDevicePixelRatio } from './render-resolution';

afterEach(() => vi.unstubAllGlobals());
describe('bounded high-density rendering', () => {
  it('uses a 2560x1440 buffer for 1280x720 desktop at DPR 2 on medium', () => {
    expect(resolveRenderResolution(1280, 720, 2, 'medium', 'keyboardMouse')).toBeCloseTo(1.6);
  });
  it('raises touch low quality to a bounded 720p buffer, not 540p', () => {
    expect(resolveRenderResolution(844, 475, 3, 'low', 'touch')).toBeCloseTo(0.8);
  });
  it('does not supersample a normal-density display', () => {
    expect(resolveRenderResolution(1600, 900, 1, 'high', 'keyboardMouse')).toBe(1);
  });
  it('fits the smaller viewport dimension without changing the logical aspect ratio', () => {
    expect(resolveRenderResolution(1200, 450, 1, 'high', 'keyboardMouse')).toBe(0.5);
  });
  it('caps extreme viewports and DPR at each tier budget', () => {
    for (const mode of ['touch', 'keyboardMouse'] as const) for (const quality of ['low', 'medium', 'high'] as const) {
      const scale = resolveRenderResolution(10000, 10000, 10, quality, mode);
      expect(1600 * 900 * scale * scale).toBeLessThanOrEqual(RENDER_PIXEL_BUDGET[mode][quality] + 0.01);
    }
  });
  it('sanitizes hidden or invalid viewport measurements', () => {
    for (const value of [0, -1, NaN, Infinity]) {
      const scale = resolveRenderResolution(value, value, value, 'low', 'touch');
      expect(Number.isFinite(scale)).toBe(true); expect(scale).toBeGreaterThan(0);
    }
  });
  it('re-arms the DPR query and removes its listener on disposal', () => {
    const first = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const second = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const matchMedia = vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
    const browser = { devicePixelRatio: 1, matchMedia };
    vi.stubGlobal('window', browser);
    const changed = vi.fn(), stop = watchDevicePixelRatio(changed);
    const handler = first.addEventListener.mock.calls[0][1] as () => void;
    browser.devicePixelRatio = 2; handler();
    expect(first.removeEventListener).toHaveBeenCalledWith('change', handler);
    expect(matchMedia).toHaveBeenLastCalledWith('(resolution: 2dppx)'); expect(changed).toHaveBeenCalledTimes(1);
    stop(); expect(second.removeEventListener).toHaveBeenCalledWith('change', handler);
    handler(); expect(changed).toHaveBeenCalledTimes(1);
  });
});
""")
files['src/game/runtime-campaign.test.ts'] += """

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
      expect(getters.map(getter => getter.mock.calls.length)).toEqual(before.map(count => count + 1));
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
"""
add('playwright.smoke.config.ts', """import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'first-batch.spec.ts', timeout: 60_000,
  expect: { timeout: 15_000 }, workers: 1, fullyParallel: false,
  outputDir: 'test-results/smoke',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/smoke', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:5185', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-retina', use: { browserName: 'chromium', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 } },
    { name: 'mobile-retina-chromium', use: { browserName: 'chromium', viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true } },
    { name: 'mobile-retina-webkit', use: { browserName: 'webkit', viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true } },
  ],
  webServer: { command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5185 --strictPort',
    url: 'http://127.0.0.1:5185', reuseExistingServer: false },
});
""")
add('tests/first-batch.spec.ts', """import { expect, test, type Page } from '@playwright/test';
import type { DebugControls } from '../src/game/runtime';

declare global { interface Window { __MAFUYU_DEBUG__: DebugControls } }
const phase = (page: Page) => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase);
async function menu(page: Page) {
  await page.goto('/?debug=1');
  await expect(page.getByRole('button', { name: '开始游戏', exact: true })).toBeVisible();
}
async function buffer(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#game-host canvas')!;
    const rect = canvas.getBoundingClientRect(), snapshot = window.__MAFUYU_DEBUG__.snapshot();
    const budgets = snapshot.controlMode === 'touch' ? { low: 1280 * 720, medium: 1600 * 900, high: 1920 * 1080 }
      : { low: 1920 * 1080, medium: 2560 * 1440, high: 2880 * 1620 };
    const scale = Math.min(Math.min(rect.width / 1600, rect.height / 900) * Math.min(devicePixelRatio, snapshot.controlMode === 'touch' ? 2 : 2.5),
      Math.sqrt(budgets[snapshot.settings.quality] / (1600 * 900)));
    return { width: canvas.width, height: canvas.height, expectedWidth: 1600 * scale, expectedHeight: 900 * scale,
      cssWidth: rect.width, cssHeight: rect.height };
  });
}

test('start, level choice, pause, new seed, explicit replay and persisted score', async ({ page }) => {
  await menu(page); await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect.poll(() => phase(page)).toBe('playing');
  await page.evaluate(() => {
    const s = window.__MAFUYU_DEBUG__.state(); s.player.invincible = 3600; s.spawnTimer = 3600;
    s.pickups.push({ id: 9999001, type: 'xp', value: 100, x: s.player.x, y: s.player.y, age: 0 });
  });
  await expect.poll(() => phase(page)).toBe('upgrade');
  await page.evaluate(() => { const d = window.__MAFUYU_DEBUG__, s = d.snapshot(); d.upgrade(s.upgradeChoices[0], s.upgradeOfferId ?? undefined); });
  await expect.poll(() => phase(page)).toBe('playing');
  await page.evaluate(() => window.__MAFUYU_DEBUG__.pause()); await expect.poll(() => phase(page)).toBe('paused');
  await page.evaluate(() => window.__MAFUYU_DEBUG__.resume()); await expect.poll(() => phase(page)).toBe('playing');
  const seeds = await page.evaluate(() => {
    const d = window.__MAFUYU_DEBUG__, first = d.seed(); d.restart(); const second = d.seed();
    d.start({ seed: 123 }); const explicit = d.seed(); d.start({ seed: 123 }); const repeated = d.seed();
    d.state().score = 12345; d.menu(); return { first, second, explicit, repeated };
  });
  expect(seeds.first).not.toBe(seeds.second); expect(seeds.explicit).toBe(123); expect(seeds.repeated).toBe(123);
  await page.reload(); await expect.poll(() => phase(page)).toBe('menu');
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().bestScore)).toBe(12345);
});

test('retina drawing buffers follow each quality budget without CSS stretching', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await menu(page);
  for (const quality of ['low', 'medium', 'high'] as const) {
    await page.evaluate(q => window.__MAFUYU_DEBUG__.settings({ quality: q }), quality);
    await expect.poll(async () => {
      const b = await buffer(page); return Math.max(Math.abs(b.width - b.expectedWidth), Math.abs(b.height - b.expectedHeight));
    }).toBeLessThanOrEqual(1.1);
    const b = await buffer(page); expect(b.width).toBeGreaterThan(b.cssWidth); expect(b.height).toBeGreaterThan(b.cssHeight);
  }
  await page.evaluate(() => { const d = window.__MAFUYU_DEBUG__; d.start({ seed: 123 }); d.state().player.invincible = 3600; });
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().tick)).toBeGreaterThan(5);
  await page.screenshot({ path: testInfo.outputPath('clarity.png') });
  expect(errors).toEqual([]);
});

test('unsupported fullscreen displays feedback and does not block a normal start', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: undefined }));
  await menu(page); await page.evaluate(() => window.__MAFUYU_DEBUG__.settings({ controlMode: 'touch' }));
  await page.getByRole('button', { name: '全屏游玩', exact: true }).click();
  await expect(page.getByText('当前浏览器不支持全屏，可直接横屏游玩。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click(); await expect.poll(() => phase(page)).toBe('playing');
});

test('rotation pauses touch play and restores the sharp landscape buffer', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch-orientation regression');
  await menu(page); await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect.poll(() => phase(page)).toBe('playing');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().orientationBlocked)).toBe(true);
  await expect.poll(() => phase(page)).toBe('paused');
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().orientationBlocked)).toBe(false);
  await expect.poll(async () => {
    const b = await buffer(page); return Math.max(Math.abs(b.width - b.expectedWidth), Math.abs(b.height - b.expectedHeight));
  }).toBeLessThanOrEqual(1.1);
});
""")
add('.github/workflows/ci.yml', """name: CI
on:
  push:
    branches: [master]
  pull_request:
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: ci-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
jobs:
  quality:
    name: Quality and browser smoke
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - run: npm ci --include=dev
      - run: npm run check
      - run: npx playwright install --with-deps chromium webkit
      - run: npx playwright test --config playwright.smoke.config.ts
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: browser-smoke-${{ github.run_id }}
          path: |
            playwright-report/smoke
            test-results/smoke
          if-no-files-found: ignore
          retention-days: 7
""")
add('docs/first-batch-20260918.md', """# First-batch optimization and rendering clarity

Based on master `65cea13a033be92b6e5fa232300ab15fbb339613` (v6.1.2).

## Runtime

HUD publications use cached score/history summaries. The cache is refreshed after initialization, opening a new run, external storage merges, score recording, and completion recording. SaveRepository still owns mutable data and returns defensive copies; gameplay updates do not obtain full profile/history copies.

Ordinary start/restart requests a new nonzero uint32 seed. Explicit `start({seed})` still forwards the seed unchanged, including zero. Debug practice remains fixed-seed. The active seed is available through `window.__MAFUYU_DEBUG__.seed()` in debug mode for reproduction. No combat/balance parameters changed.

Fullscreen unavailable/rejected errors now reach the UI. Optional orientation-lock rejection does not turn a successful fullscreen request into an error.

## Rendering

The old renderer already handled DPR in resize(); initialization at resolution 1 was not itself the root cause. Its 540p mobile-low pixel ceiling and DPR 1.5 ceiling limited clarity. New budgets are independent of the particle/star scale and bounded by the displayed physical size:

| Quality | Touch maximum buffer | Desktop maximum buffer |
| --- | --- | --- |
| Low | 1280 x 720 | 1920 x 1080 |
| Medium | 1600 x 900 | 2560 x 1440 |
| High | 1920 x 1080 | 2880 x 1620 |

DPR is capped at 2 on touch and 2.5 on desktop. Smaller displays do not allocate the full budget. The 1600 x 900 logical coordinate system, field of view, collision geometry, CSS layout, and pointer mapping are unchanged. No whole-canvas pixelated sampling or sharpening filter is applied. Text/bitmap fonts use resolution 2 instead of 1.5. Particle counts are unchanged. DPR changes re-arm a media query, resize and redraw paused screens; redundant buffer resizes are avoided and listeners are released on destroy.

Higher pixel budgets increase fill-rate and framebuffer cost. Real phone temperature, battery use and sustained FPS still require physical-device checks; desktop Chromium/WebKit emulation is not a real iPhone/Android performance measurement. Low-resolution source artwork cannot regain missing detail through a larger framebuffer.

## Validation and release gates

`npm run check` runs typecheck, lint, unit tests, asset validation and production build. Vercel now uses this command, so those failures block its build. PRs and master pushes run the same check plus a focused Playwright matrix: desktop DPR 2, touch Chromium DPR 3 and touch WebKit DPR 3. The matrix covers lifecycle/upgrade, seed behavior, saved-score reload, fullscreen fallback, buffer sizing and rotation; its screenshots and failure traces are uploaded.

Run browser smoke locally after building:

```sh
npm ci --include=dev
npm run check
npx playwright install --with-deps chromium webkit
npx playwright test --config playwright.smoke.config.ts
```

Test definitions are not a claim of passing results; consult the actual CI run for this revision. Existing full desktop/mobile suites and long soaks remain available. GitHub branch-protection/ruleset settings are not changed by this patch; making the CI job a required merge check is a separate repository setting. The Vercel build gate does not include browser tests.
""")
for name, content in files.items():
    path = Path(name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.rstrip() + '\n', encoding='utf-8')
print('Patched files:\n' + '\n'.join(sorted(files)))
