import { expect, test, type Page } from '@playwright/test';
import type { DebugControls } from '../src/game/runtime';

declare global { interface Window { __MAFUYU_DEBUG__: DebugControls } }
const profileKey = 'mafuyu-sekai:profile:v2';
async function open(page: Page) {
  await page.goto('/?debug=1');
  await expect(page.getByRole('button', { name: '开始游戏' })).toBeVisible();
}
async function killEncounter(page: Page, type: 'miniboss' | 'palisade' | 'reprise') {
  await expect.poll(() => page.evaluate(type => window.__MAFUYU_DEBUG__.state().enemies.some(enemy => enemy.type === type), type)).toBe(true);
  await page.evaluate(type => { const debug = window.__MAFUYU_DEBUG__, enemy = debug.state().enemies.find(enemy => enemy.type === type)!; debug.damageEnemy(enemy.id, 1e7); }, type);
}
async function resolveChoices(page: Page) {
  for (let guard = 0; guard < 14; guard++) {
    const phase = await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase);
    if (phase !== 'upgrade') return;
    await page.keyboard.press('1');
  }
}
async function completeCampaign(page: Page) {
  await page.getByRole('button', { name: '开始游戏' }).click();
  await page.evaluate(() => { window.__MAFUYU_DEBUG__.state().player.invincible = 3600; });
  for (const [index, encounter] of ['miniboss', 'palisade', 'mafuyu', 'reprise', 'lacuna'].entries()) {
    await resolveChoices(page);
    await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().wave)).toBe(index + 1);
    await page.evaluate(() => window.__MAFUYU_DEBUG__.advanceStage());
    if (encounter === 'miniboss' || encounter === 'palisade' || encounter === 'reprise') await killEncounter(page, encounter);
    else for (let card = 0; card < 6; card++) {
      await expect.poll(() => page.evaluate(() => {
        const boss = window.__MAFUYU_DEBUG__.state().enemies.find(enemy => enemy.type === 'boss');
        return boss?.spell?.stage === 'active' ? boss.spell.cardIndex : -1;
      })).toBe(card);
      await page.evaluate(() => { const d = window.__MAFUYU_DEBUG__, boss = d.state().enemies.find(enemy => enemy.type === 'boss')!; d.damageEnemy(boss.id, boss.hp); });
    }
    if (index < 4) {
      await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('upgrade');
      expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.lifecycle().rafActive)).toBe(false);
      await resolveChoices(page);
      expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().arena)).toBeNull();
      expect(await page.evaluate(key => Object.keys(JSON.parse(localStorage.getItem(key) ?? '{"clears":{}}').clears).length, profileKey)).toBe(0);
    }
  }
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('complete');
}

test('fresh run ignores historical strength and a debug result never saves a completion', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('mafuyu-sekai:profile:v1', JSON.stringify({ version: 1, revision: 0, clears: {}, carryover: { level: 10, xp: 0, companions: 3 }, bestScores: { s1: { normal: 1234, hard: 0 } } })); });
  await open(page);
  await expect(page.getByRole('group', { name: '选择季度' })).toHaveCount(0);
  await expect(page.getByText('旧版历史纪录 1,234')).toBeVisible();
  await page.getByRole('button', { name: '开始游戏' }).click();
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot())).toMatchObject({ phase: 'playing', level: 1, companions: 0, modules: [] });
  await page.evaluate(() => window.__MAFUYU_DEBUG__.scenario('complete'));
  expect(await page.evaluate(key => localStorage.getItem(key), profileKey)).toBeNull();
});

test('all five encounters continue one run, only LACUNA saves, and refresh starts Lv1', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await completeCampaign(page);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), profileKey);
  expect(Object.values(saved.clears)).toHaveLength(1);
  expect(Object.values(saved.clears)[0]).toMatchObject({ ruleset: 'v5', encounterId: 's2:final' });
  expect(saved).not.toHaveProperty('carryover');
  const modules = await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().modules);
  await page.getByRole('button', { name: /继续.*无尽/ }).click();
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot())).toMatchObject({ mode: 'endless', modules });
  await page.reload(); await expect(page.getByRole('button', { name: '开始游戏' })).toBeVisible();
  await page.getByRole('button', { name: '开始游戏' }).click();
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot())).toMatchObject({ phase: 'playing', level: 1, xp: 0, modules: [], resonance: 0, companions: 0 });
  expect(errors).toEqual([]);
});

test('level choices freeze existing enemies, reroll twice and reject a stale offer', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: '开始游戏' }).click();
  await page.evaluate(() => {
    const s = window.__MAFUYU_DEBUG__.state(); s.player.invincible = 3600;
    s.pickups.push({ id: 990001, type: 'xp', value: 100, x: s.player.x, y: s.player.y, age: 0 });
  });
  await expect(page.getByRole('dialog')).toContainText('选择强化');
  const frozen = await page.evaluate(() => {
    const d = window.__MAFUYU_DEBUG__; return { tick: d.state().tick, enemies: JSON.stringify(d.state().enemies), offer: d.snapshot().upgradeOfferId, id: d.snapshot().upgradeChoices[0] };
  });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().tick)).toBe(frozen.tick);
  expect(await page.evaluate(() => JSON.stringify(window.__MAFUYU_DEBUG__.state().enemies))).toBe(frozen.enemies);
  await page.getByRole('button', { name: '重抽 · 2' }).click();
  await page.getByRole('button', { name: '重抽 · 1' }).click();
  await expect(page.getByRole('button', { name: '重抽 · 0' })).toBeDisabled();
  await page.evaluate(({ id, offer }) => window.__MAFUYU_DEBUG__.upgrade(id, offer!), frozen);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('upgrade');
  await page.keyboard.press('1');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('playing');
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().modules)).toHaveLength(1);
});

test('cross-tab scores merge and rejected storage stays usable in the current session', async ({ page, context }) => {
  await open(page); const second = await context.newPage(); await open(second);
  await page.evaluate(() => { const d = window.__MAFUYU_DEBUG__; d.start(); d.state().score = 4321; d.menu(); });
  await expect.poll(() => second.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().bestScore)).toBe(4321);
  await expect(second.getByText(/其他标签页的通关/)).toBeVisible();
  await second.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); }; });
  await second.getByRole('button', { name: '开始游戏' }).click();
  await second.evaluate(() => { const d = window.__MAFUYU_DEBUG__; d.state().score = 999999; d.menu(); });
  expect(await second.evaluate(() => window.__MAFUYU_DEBUG__.snapshot())).toMatchObject({ saveStatus: 'session', bestScore: 999999 });
  await expect(second.locator('.save-session')).toContainText('未保存到浏览器');
});

test('a real lethal hit exposes failed score persistence on the failure screen before retry', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: '开始游戏' }).click();
  // Orphaned hazards are deliberately removed; use a living source for the lethal hit.
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().enemies.length)).toBeGreaterThan(0);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
    const state = window.__MAFUYU_DEBUG__.state(), player = state.player;
    state.score = 7654; player.hp = 1; player.invincible = 0;
    state.hazards.push({ id: 990002, x: player.x, y: player.y, radius: 120,
      warning: 0, warningDuration: 0, life: 1, duration: 1, sourceId: state.enemies[0].id, kind: 'bombard', active: true });
  });
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('failed');
  await expect(page.getByRole('dialog').locator('.save-session')).toContainText('未保存到浏览器');
  await expect(page.getByRole('dialog')).toContainText('7,654');
  expect(await page.evaluate(key => localStorage.getItem(key), profileKey)).toBeNull();
  await page.getByRole('button', { name: '再次挑战' }).click();
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot())).toMatchObject({ phase: 'playing', level: 1, hp: 5, bestScore: 7654 });
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
