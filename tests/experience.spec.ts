import { test, expect, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.goto('/?debug=1');
  await expect(page.getByRole('button', { name: '开始游戏' })).toBeVisible();
}

async function waitForDialogSettled(page: Page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Visibility succeeds during the 230ms dialog-in animation; screenshots need its final state.
  // Reduced-motion settings produce no animations and therefore resolve immediately.
  await dialog.evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  await expect(dialog).toHaveCSS('opacity', '1');
}

test('keybinding swap, damage-number preferences and pause module states are visible and persistent', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '体验设置', exact: true }).click();
  await page.getByRole('button', { name: '重要命中', exact: true }).click();
  await page.getByRole('button', { name: '改键：冲刺', exact: true }).click();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: '改键：冲刺', exact: true })).toContainText('空格');
  await expect(page.getByRole('button', { name: '改键：炸弹', exact: true })).toContainText('R');
  await page.getByRole('button', { name: '改键：冲刺', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await waitForDialogSettled(page);
  await page.screenshot({ path: 'test-results/v5.0-settings-keybindings.png' });
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('button', { name: '开始游戏' })).toBeVisible();
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().settings)).toMatchObject({ damageNumbers: 'important', keybindings: { dash: 'Space', bomb: 'KeyR' } });
  await page.evaluate(() => window.__MAFUYU_DEBUG__.practice({ modules: ['intercept', 'revive', 'vent'], encounter: 'palisade' }));
  await page.keyboard.press('Escape');
  await expect(page.locator('.paused-modules article')).toHaveCount(3);
  await expect(page.locator('.paused-modules')).toContainText('就绪');
  await expect(page.locator('.controls-guide')).toContainText('随后左键释放贯穿炮');
  await waitForDialogSettled(page);
  await page.screenshot({ path: 'test-results/v5.0-pause-modules.png' });
  await expect(page.getByRole('progressbar', { name: '弹药', exact: true })).toHaveCount(0);
});

test('held primary fire releases the dash beam and removed Q/E do nothing', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.evaluate(() => window.__MAFUYU_DEBUG__.practice({ encounter: 'palisade' }));
  const bounds = (await page.locator('#game-host').boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * .8, bounds.y + bounds.height / 2);
  await page.keyboard.press('q'); await page.keyboard.press('e');
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().beams.length)).toBe(0);
  await expect(page.locator('.skill-chip')).toHaveCount(2);
  await page.mouse.down(); await page.keyboard.press('r');
  await page.waitForFunction(() => {
    const d = window.__MAFUYU_DEBUG__; if (!d.state().beams.length) return false; d.pause(); return true;
  });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().beams[0])).toMatchObject({ length: 2400, width: 88 });
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.perfectWindow)).toBe(0);
  await page.screenshot({ path: 'test-results/v5.0-beam-720.png' });
  expect(errors).toEqual([]);
});

test('status rails keep four viewports clear and low motion retains PALISADE warnings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  for (const [width, height] of [[1280, 720], [1920, 1080], [2560, 1440], [2560, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      window.__MAFUYU_DEBUG__.settings({ quality: 'low', reducedMotion: true });
      window.__MAFUYU_DEBUG__.practice({ encounter: 'palisade' });
    });
    await page.waitForFunction(() => window.__MAFUYU_DEBUG__.state().enemies.some(enemy => enemy.type === 'palisade' && enemy.state === 'charge' && enemy.timer > 0.2));
    const host = (await page.locator('#game-host').boundingBox())!, top = (await page.locator('.battle-top').boundingBox())!, bottom = (await page.locator('.battle-bottom').boundingBox())!;
    expect(host.width / host.height).toBeCloseTo(16 / 9, 3);
    expect(host.y).toBeGreaterThanOrEqual(top.y + top.height - 1);
    expect(host.y + host.height).toBeLessThanOrEqual(bottom.y + 1);
    await page.screenshot({ path: `test-results/v5.0-low-${width}x${height}.png` });
    expect(await page.locator('#game-host canvas').count()).toBe(1);
  }
  expect(errors).toEqual([]);
});
