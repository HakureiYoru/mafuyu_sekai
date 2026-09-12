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
  await page.getByRole('button', { name: '改键：贯穿炮', exact: true }).click();
  await page.keyboard.press('e');
  await expect(page.getByRole('button', { name: '改键：贯穿炮', exact: true })).toContainText('E');
  await expect(page.getByRole('button', { name: '改键：子机指令', exact: true })).toContainText('Q');
  await page.getByRole('button', { name: '改键：贯穿炮', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await waitForDialogSettled(page);
  await page.screenshot({ path: 'test-results/v4.1-settings-keybindings.png' });
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('button', { name: '开始游戏' })).toBeVisible();
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().settings)).toMatchObject({ damageNumbers: 'important', keybindings: { beam: 'KeyE', command: 'KeyQ' } });
  await page.evaluate(() => window.__MAFUYU_DEBUG__.practice({ modules: ['intercept', 'revive', 'vent'], encounter: 'palisade' }));
  await page.keyboard.press('Escape');
  await expect(page.locator('.paused-modules article')).toHaveCount(3);
  await expect(page.locator('.paused-modules')).toContainText('就绪');
  await expect(page.locator('.controls-guide')).toContainText('手动贯穿炮');
  await waitForDialogSettled(page);
  await page.screenshot({ path: 'test-results/v4.1-pause-modules.png' });
  await expect(page.getByRole('progressbar', { name: '弹药', exact: true })).toHaveCount(0);
});

test('manual Q preserves its stored shot during primary fire and E shows a confirmed target', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.evaluate(() => window.__MAFUYU_DEBUG__.practice({ encounter: 'palisade' }));
  const bounds = (await page.locator('#game-host').boundingBox())!;
  const target = await page.evaluate(() => {
    const state = window.__MAFUYU_DEBUG__.state(), enemy = state.enemies.find(enemy => enemy.type === 'palisade')!;
    return { id: enemy.id, x: (enemy.x - state.camera.x + 800) / 1600, y: (enemy.y - state.camera.y + 450) / 900 };
  });
  await page.mouse.move(bounds.x + target.x * bounds.width, bounds.y + target.y * bounds.height);
  await page.keyboard.press('e');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.commandTargetId)).toBe(target.id);
  await expect(page.locator('.skill-chip.is-commanding')).toContainText('集火');
  await page.keyboard.press('r');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.perfectWindow)).toBeGreaterThan(3);
  await page.mouse.down();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().beams.length)).toBe(0);
  await page.keyboard.press('q');
  await page.waitForFunction(() => window.__MAFUYU_DEBUG__.state().beams.length > 0);
  await page.screenshot({ path: 'test-results/v4.1-beam-720.png' });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.perfectWindow)).toBe(0);
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
    await page.screenshot({ path: `test-results/v4.1-low-${width}x${height}.png` });
    expect(await page.locator('#game-host canvas').count()).toBe(1);
  }
  expect(errors).toEqual([]);
});
