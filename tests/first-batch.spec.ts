import { expect, test, type Page } from '@playwright/test';
import type { DebugControls } from '../src/game/runtime';

declare global { interface Window { __MAFUYU_DEBUG__: DebugControls } }
const phase = (page: Page) => page.evaluate(() => window.__MAFUYU_DEBUG__?.snapshot().phase ?? 'loading');
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
      cssWidth: rect.width, cssHeight: rect.height, density: devicePixelRatio };
  });
}

/** Inspect compositor output, not a cleared WebGL back-buffer or the surrounding HTML HUD. */
async function battlefieldHasVisiblePixels(page: Page): Promise<boolean> {
  const screenshot = await page.locator('#game-host canvas').screenshot();
  return page.evaluate(async data => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const sample = document.createElement('canvas'); sample.width = 64; sample.height = 64;
    const context = sample.getContext('2d')!;
    context.drawImage(image, image.width * 0.4, image.height * 0.4, image.width * 0.2, image.height * 0.2, 0, 0, 64, 64);
    const pixels = context.getImageData(0, 0, 64, 64).data;
    let bright = 0;
    for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 70) bright++;
    return bright > 8;
  }, screenshot.toString('base64'));
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

test('drawing buffers follow each quality and density budget without CSS stretching', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await menu(page);
  for (const quality of ['low', 'medium', 'high'] as const) {
    await page.evaluate(q => window.__MAFUYU_DEBUG__.settings({ quality: q }), quality);
    await expect.poll(async () => {
      const b = await buffer(page); return Math.max(Math.abs(b.width - b.expectedWidth), Math.abs(b.height - b.expectedHeight));
    }).toBeLessThanOrEqual(1.1);
    const b = await buffer(page);
    if (b.density > 1 && b.expectedWidth > b.cssWidth + 1 && b.expectedHeight > b.cssHeight + 1) {
      expect(b.width).toBeGreaterThan(b.cssWidth); expect(b.height).toBeGreaterThan(b.cssHeight);
    }
  }
  await page.evaluate(() => { const d = window.__MAFUYU_DEBUG__; d.start({ seed: 123 }); d.state().player.invincible = 3600; });
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().tick)).toBeGreaterThan(60);
  await expect.poll(() => battlefieldHasVisiblePixels(page), { message: 'The battlefield must visibly contain the player, not a black canvas.' }).toBe(true);
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
