import { expect, test, type Page } from '@playwright/test';
import type { DebugControls } from '../src/game/runtime';

declare global { interface Window { __MAFUYU_DEBUG__: DebugControls } }
const profileKey = 'mafuyu-sekai:profile:v1';
async function open(page: Page) {
  await page.goto('/?debug=1');
  await expect(page.getByRole('button', { name: '开始游戏' })).toBeVisible();
}
async function killEncounter(page: Page, type: 'miniboss' | 'palisade' | 'reprise') {
  await expect.poll(() => page.evaluate(type => window.__MAFUYU_DEBUG__.state().enemies.some(enemy => enemy.type === type), type)).toBe(true);
  await page.evaluate(type => { const debug = window.__MAFUYU_DEBUG__, enemy = debug.state().enemies.find(enemy => enemy.type === type)!; debug.damageEnemy(enemy.id, 1e7); }, type);
}
async function completeFirstSeason(page: Page) {
  await page.getByRole('button', { name: '开始游戏' }).click();
  await page.evaluate(() => { window.__MAFUYU_DEBUG__.state().player.invincible = 3600; });
  for (let stage = 1; stage <= 5; stage++) {
    await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().wave)).toBe(stage);
    await page.evaluate(() => window.__MAFUYU_DEBUG__.advanceStage());
    if (stage === 3) await killEncounter(page, 'miniboss');
  }
  for (let card = 0; card < 6; card++) {
    await expect.poll(() => page.evaluate(() => { const boss = window.__MAFUYU_DEBUG__.state().enemies.find(enemy => enemy.type === 'boss'); return boss?.spell?.stage === 'active' ? boss.spell.cardIndex : -1; })).toBe(card);
    await page.evaluate(() => {
      const debug = window.__MAFUYU_DEBUG__, state = debug.state(), boss = state.enemies.find(enemy => enemy.type === 'boss')!;
      state.player.level = 6; state.player.xp = 40;
      debug.damageEnemy(boss.id, boss.hp);
    });
  }
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('complete');
  await expect(page.getByRole('button', { name: /进入第二季/ })).toBeVisible();
}

test('locked season rejects caller carryover and a debug result does not unlock it', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('button', { name: /第二季/ })).toBeDisabled();
  await page.evaluate(() => window.__MAFUYU_DEBUG__.start({ season: 's2', carryover: { level: 10, xp: 0, companions: 3 } }));
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('menu');
  await page.evaluate(() => window.__MAFUYU_DEBUG__.scenario('complete'));
  await expect(page.getByRole('button', { name: /进入第二季/ })).toHaveCount(0);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().season2Unlocked)).toBe(false);
  expect(await page.evaluate(key => localStorage.getItem(key), profileKey)).toBeNull();
});
test('real S1 card clears persist, unlock both S2 difficulties, and all seven choices precede the final boss', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await completeFirstSeason(page);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), profileKey);
  expect(Object.values(saved.clears)).toHaveLength(1);
  expect(saved.carryover).toMatchObject({ level: 6, xp: 40 });
  await page.reload(); await expect(page.getByRole('button', { name: '开始游戏' })).toBeVisible();
  await page.getByRole('button', { name: /第二季/ }).click();
  for (const difficulty of ['困难', '普通']) {
    await page.getByRole('button', { name: difficulty, exact: true }).click();
    await page.getByRole('button', { name: '开始游戏' }).click();
    await expect(page.getByRole('dialog')).toContainText('带上新的共鸣');
    expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.lifecycle().rafActive)).toBe(false);
    expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().level)).toBe(6);
    if (difficulty === '困难') await page.getByRole('button', { name: '结束本局，返回主菜单' }).click();
  }
  await page.keyboard.press('1');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('playing');
  await page.evaluate(() => { window.__MAFUYU_DEBUG__.state().player.invincible = 3600; });
  for (let stage = 1; stage <= 6; stage++) {
    await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().wave)).toBe(stage);
    await page.evaluate(() => window.__MAFUYU_DEBUG__.advanceStage());
    if (stage === 2) await killEncounter(page, 'palisade');
    if (stage === 4) await killEncounter(page, 'reprise');
    await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('upgrade');
    const before = await page.evaluate(() => ({ tick: window.__MAFUYU_DEBUG__.state().tick, choices: window.__MAFUYU_DEBUG__.snapshot().upgradeChoices }));
    expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.lifecycle().rafActive)).toBe(false);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().tick)).toBe(before.tick);
    if (stage === 6) expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().bossPending)).toBe(false);
    await page.keyboard.press(String(stage % 3 + 1));
    await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().modules.length)).toBe(stage + 1);
    const modules = await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().modules);
    expect(new Set(modules).size).toBe(modules.length);
  }
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().enemies.some(enemy => enemy.type === 'boss'))).toBe(true);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot())).toMatchObject({ seasonId: 's2', arena: true, cardCount: 6 });
  for (let card = 0; card < 6; card++) {
    await expect.poll(() => page.evaluate(() => { const boss = window.__MAFUYU_DEBUG__.state().enemies.find(enemy => enemy.type === 'boss'); return boss?.spell?.stage === 'active' ? boss.spell.cardIndex : -1; })).toBe(card);
    await page.evaluate(() => { const debug = window.__MAFUYU_DEBUG__, boss = debug.state().enemies.find(enemy => enemy.type === 'boss')!; debug.damageEnemy(boss.id, boss.hp); });
  }
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('complete');
  expect(await page.evaluate(key => Object.keys(JSON.parse(localStorage.getItem(key)!).clears).length, profileKey)).toBe(2);
  await page.getByRole('button', { name: /继续.*无尽/ }).click();
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().mode)).toBe('endless');
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().wave)).toBe(7);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().modules.length)).toBe(7);
  await page.evaluate(() => window.__MAFUYU_DEBUG__.restart());
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot())).toMatchObject({ phase: 'upgrade', level: 6, xp: 40, modules: [], resonance: 0 });
  const restarts = await page.evaluate(() => {
    const debug = window.__MAFUYU_DEBUG__, result = [];
    for (let i = 0; i < 20; i++) {
      debug.upgrade(debug.snapshot().upgradeChoices[0]);
      const playingRaf = debug.lifecycle().rafActive;
      debug.state().build.resonance = 4;
      debug.restart();
      result.push({ playingRaf, phase: debug.snapshot().phase, level: debug.snapshot().level, modules: debug.snapshot().modules.length, resonance: debug.snapshot().resonance, raf: debug.lifecycle().rafActive });
    }
    return result;
  });
  for (const restart of restarts) expect(restart).toEqual({ playingRaf: true, phase: 'upgrade', level: 6, modules: 0, resonance: 0, raf: false });
  await expect(page.locator('#game-host canvas')).toHaveCount(1);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).carryover, profileKey)).toEqual(saved.carryover);
  expect(errors).toEqual([]);
});

test('cross-tab clear merges into the menu and a blocked storage write remains usable in session', async ({ page, context }) => {
  await open(page);
  const second = await context.newPage(); await open(second);
  await completeFirstSeason(page);
  await expect(second.getByRole('button', { name: /第二季/ })).toBeEnabled();
  await expect(second.getByText(/其他标签页的通关/)).toBeVisible();
  await second.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); }; });
  await second.getByRole('button', { name: '开始游戏' }).click();
  await second.evaluate(() => { window.__MAFUYU_DEBUG__.state().score = 999999; window.__MAFUYU_DEBUG__.menu(); });
  expect(await second.evaluate(() => window.__MAFUYU_DEBUG__.snapshot())).toMatchObject({ saveStatus: 'session', season2Unlocked: true });
  await expect(second.locator('.save-session')).toBeVisible();
});

test('status rails remain outside the 16:9 canvas, including ultrawide windows', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: '开始游戏' }).click();
  for (const [width, height] of [[1280, 720], [1920, 1080], [2560, 1440], [2560, 1080]]) {
    await page.setViewportSize({ width, height });
    const host = (await page.locator('#game-host').boundingBox())!, top = (await page.locator('.battle-top').boundingBox())!, bottom = (await page.locator('.battle-bottom').boundingBox())!;
    expect(host.width / host.height).toBeCloseTo(16 / 9, 3);
    expect(host.y).toBeGreaterThanOrEqual(top.y + top.height - .1);
    expect(host.y + host.height).toBeLessThanOrEqual(bottom.y + .1);
    expect(bottom.y + bottom.height).toBeLessThanOrEqual(height);
  }
});
