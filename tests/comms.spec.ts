import { defeatGateElite } from './campaign-helpers';
import { expect, test, type Page } from '@playwright/test';
import type { DebugControls } from '../src/game/runtime';

declare global { interface Window { __MAFUYU_DEBUG__: DebugControls } }

async function open(page: Page) {
  await page.goto('/?debug=1');
  await expect(page.getByRole('button', { name: '开始游戏', exact: true })).toBeVisible();
}

async function quietRun(page: Page) {
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('playing');
  await page.evaluate(() => {
    const state = window.__MAFUYU_DEBUG__.state();
    state.player.invincible = 3600;
    state.spawnTimer = 3600;
    state.enemies.length = 0;
  });
  await expect(page.getByTestId('comms-root')).toBeVisible();
}

async function frozenPresentation(page: Page) {
  return page.evaluate(() => {
    const debug = window.__MAFUYU_DEBUG__;
    return {
      tick: debug.state().tick,
      message: debug.snapshot().comms,
      previous: document.querySelector('[data-testid="comms-previous"]')?.textContent ?? null,
      animations: [...document.querySelectorAll('.comms-figure')].flatMap(element => element.getAnimations().map(animation => ({
        time: animation.currentTime, state: animation.playState,
      }))),
    };
  });
}

test('six viewport sizes keep both characters and bubbles outside the playable canvas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.evaluate(() => window.__MAFUYU_DEBUG__.settings({ reducedMotion: true }));
  await quietRun(page);
  for (const [width, height] of [[1280, 720], [1920, 1080], [2560, 1440], [2560, 1080], [807, 519], [807, 900]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      const debug = window.__MAFUYU_DEBUG__;
      debug.restart(); debug.state().spawnTimer = 3600; debug.state().player.invincible = 3600;
    });
    await expect.poll(() => page.evaluate(() => !!window.__MAFUYU_DEBUG__.snapshot().commsPrevious)).toBe(true);
    const root = page.getByTestId('comms-root');
    await expect(root).toHaveAttribute('data-layout', width === 807 && height === 900 ? 'compact' : 'sides');
    const host = (await page.locator('#game-host').boundingBox())!;
    expect(host.width / host.height).toBeCloseTo(16 / 9, 3);
    await expect(page.getByTestId('comms-emu')).toBeVisible();
    await expect(page.getByTestId('comms-mafuyu')).toBeVisible();
    await expect(page.getByLabel('已装配模块')).toBeVisible();
    const slots = (await page.getByLabel('已装配模块').boundingBox())!;
    expect(slots.y + slots.height).toBeLessThanOrEqual(height + 1);
    const parts = [page.getByTestId('comms-sprite-emu'), page.getByTestId('comms-sprite-mafuyu'), page.getByTestId('comms-current')];
    if (await root.getAttribute('data-layout') === 'sides') parts.push(page.getByTestId('comms-previous'));
    for (const part of parts) {
      const box = (await part.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.y).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
      const intersectionWidth = Math.min(box.x + box.width, host.x + host.width) - Math.max(box.x, host.x);
      const intersectionHeight = Math.min(box.y + box.height, host.y + host.height) - Math.max(box.y, host.y);
      expect(intersectionWidth <= 1 || intersectionHeight <= 1).toBe(true);
    }
    await expect(root).toHaveCSS('pointer-events', 'none');
    await page.screenshot({ path: `test-results/v5.1-comms-${width}x${height}.png` });
  }
  expect(errors).toEqual([]);
});

test('a reply preserves the whole previous line without restarting the character animation for each letter', async ({ page }) => {
  await open(page);
  await quietRun(page);
  const current = page.getByTestId('comms-current');
  await expect(current).toBeVisible();
  const firstId = await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().comms!.id);
  await page.getByTestId('comms-emu').locator('.comms-figure').evaluate(element => element.setAttribute('data-test-original-figure', 'true'));
  // At 35 characters/s every <=24-character line is complete by one second,
  // and the minimum 1.8-second dwell has not yet advanced to the reply.
  await page.waitForTimeout(1000);
  const fullOpening = await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().comms);
  expect(fullOpening!.id).toBe(firstId);
  expect(fullOpening!.text).toBe(fullOpening!.fullText);
  expect(fullOpening!.text).toContain('Wonderhoy');
  await expect(page.getByTestId('comms-emu').locator('.comms-figure')).toHaveAttribute('data-test-original-figure', 'true');
  await expect(page.getByTestId('comms-previous')).toBeVisible();
  await expect(page.getByTestId('comms-previous').locator('.comms-bubble-text')).toHaveText(fullOpening!.text);
  await expect(page.getByTestId('comms-previous')).toHaveAttribute('data-conversation-id', fullOpening!.conversationId!);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().comms?.speaker)).toBe('MAFUYU');
  await expect(page.getByTestId('comms-current')).toHaveCount(1);
  await expect(page.getByTestId('comms-previous')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/v5.1-comms-reply.png' });
  await expect(page.getByTestId('comms-current')).toHaveCount(0);
  await expect(page.getByTestId('comms-previous')).toHaveCount(0);
  await expect(page.getByTestId('comms-emu')).toBeVisible();
  await expect(page.getByTestId('comms-mafuyu')).toBeVisible();
});

test('pause, focus loss and a real upgrade choice freeze dialogue and character animation', async ({ page }) => {
  await open(page);
  await quietRun(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('comms-root')).toHaveAttribute('data-frozen', 'true');
  const paused = await frozenPresentation(page);
  await page.waitForTimeout(250);
  expect(await frozenPresentation(page)).toEqual(paused);
  await page.getByRole('button', { name: /继续游戏/ }).click();
  await expect(page.getByTestId('comms-root')).toHaveAttribute('data-frozen', 'false');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('paused');
  const blurred = await frozenPresentation(page);
  await page.waitForTimeout(200);
  expect(await frozenPresentation(page)).toEqual(blurred);
  await page.getByRole('button', { name: /继续游戏/ }).click();
  await page.evaluate(() => {
    const state = window.__MAFUYU_DEBUG__.state();
    state.pickups.push({ id: 990801, type: 'xp', value: 100, x: state.player.x, y: state.player.y, age: 0 });
  });
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('upgrade');
  await expect(page.getByTestId('comms-root')).toHaveAttribute('data-frozen', 'true');
  const upgraded = await frozenPresentation(page);
  await page.waitForTimeout(250);
  expect(await frozenPresentation(page)).toEqual(upgraded);
  await page.keyboard.press('1');
  await expect(page.getByTestId('comms-root')).toHaveAttribute('data-frozen', 'false');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().tick)).toBeGreaterThan(upgraded.tick);
});

test('a real hit interrupts banter, and restarting clears the interrupted conversation', async ({ page }) => {
  await open(page);
  await quietRun(page);
  await expect(page.getByTestId('comms-previous')).toBeVisible();
  const previousReply = await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().comms!.id);
  // Give the damaging hazard a living source: orphaned enemy hazards are intentionally discarded.
  await page.evaluate(() => { window.__MAFUYU_DEBUG__.state().spawnTimer = 0; });
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().enemies.length)).toBeGreaterThan(0);
  await page.evaluate(() => {
    const state = window.__MAFUYU_DEBUG__.state();
    state.spawnTimer = 3600;
    state.player.invincible = 0;
    state.hazards.push({ id: 990802, x: state.player.x, y: state.player.y, radius: 90, warning: 0, warningDuration: 0,
      life: 0.1, duration: 0.1, sourceId: state.enemies[0].id, kind: 'bombard', active: true });
  });
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().hp)).toBe(4);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().comms!.id)).not.toBe(previousReply);
  await expect(page.getByTestId('comms-previous')).toHaveCount(0);
  await expect(page.getByTestId('comms-emu')).toHaveAttribute('data-expression', 'hurt');
  await page.screenshot({ path: 'test-results/v5.1-comms-hurt.png' });
  await page.evaluate(() => {
    const debug = window.__MAFUYU_DEBUG__;
    debug.restart(); debug.state().spawnTimer = 3600; debug.state().player.invincible = 3600;
  });
  await expect(page.getByTestId('comms-previous')).toHaveCount(0);
  await expect(page.getByTestId('comms-emu')).toHaveAttribute('data-expression', /happy|cheer/);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().comms?.speaker)).toBe('EMU');
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().hp)).toBe(5);
});

test('collapsed comms leave module slots available and reduced motion keeps full text without animation', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '体验设置', exact: true }).click();
  await page.getByRole('button', { name: /轻量/ }).click();
  await page.getByRole('checkbox', { name: /减弱动态/ }).check();
  await page.keyboard.press('Escape');
  await quietRun(page);
  const opening = await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().comms!.text);
  expect(opening).toContain('Wonderhoy');
  await expect(page.getByTestId('comms-current').locator('.comms-bubble-text')).toHaveText(opening);
  expect(await page.locator('.comms-figure').evaluateAll(elements => elements.flatMap(element => element.getAnimations()).filter(animation => animation.playState === 'running').length)).toBe(0);
  await page.getByRole('button', { name: '收起战斗通讯', exact: true }).click();
  await expect(page.getByTestId('comms-root')).toHaveCount(0);
  await expect(page.getByLabel('已装配模块')).toBeVisible();
  await page.getByRole('button', { name: '展开战斗通讯', exact: true }).click();
  await expect(page.getByTestId('comms-root')).toBeVisible();
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('playing');
  await expect(page.getByTestId('comms-sprite-emu')).toBeVisible();
  await expect(page.getByTestId('comms-sprite-mafuyu')).toBeVisible();
});

test('missing chibi assets fall back to existing portraits without a render error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/assets/comms/**', route => route.abort());
  await open(page);
  await quietRun(page);
  for (const actor of ['emu', 'mafuyu']) {
    const sprite = page.getByTestId(`comms-sprite-${actor}`);
    await expect(sprite).toHaveAttribute('data-fallback', 'true');
    await expect.poll(() => sprite.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.getByTestId('comms-current')).toBeVisible();
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('playing');
  expect(errors).toEqual([]);
});

test('a real boss arrival replaces the opening and a fatal hit immediately keeps the full result pair', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__MAFUYU_DEBUG__.scenario('miniboss-arrival'));
  await defeatGateElite(page);
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().comms?.text)).toContain('ECHO');
  await expect(page.getByTestId('comms-previous')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/v5.1-comms-boss.png' });
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().enemies.some(enemy => enemy.type === 'miniboss'))).toBe(true);
  await page.evaluate(() => {
    const state = window.__MAFUYU_DEBUG__.state();
    state.player.hp = 1; state.player.invincible = 0;
    state.hazards.push({ id: 990803, x: state.player.x, y: state.player.y, radius: 90, warning: 0, warningDuration: 0,
      life: 0.1, duration: 0.1, sourceId: state.enemies[0].id, kind: 'bombard', active: true });
  });
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('failed');
  await expect(page.getByTestId('comms-current').locator('.comms-bubble-text')).toHaveText('……终于安静了。');
  await expect(page.getByTestId('comms-previous')).toBeVisible();
  const result = await frozenPresentation(page);
  await page.waitForTimeout(250);
  expect(await frozenPresentation(page)).toEqual(result);
  await page.getByRole('button', { name: '再次挑战', exact: true }).click();
  await expect(page.getByTestId('comms-previous')).toHaveCount(0);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().comms?.speaker)).toBe('EMU');
});
