import { test, expect } from '@playwright/test';

test('arcade nickname entry survives a network failure and refresh without uploading historical scores', async ({ page }) => {
  let submissions = 0;
  await page.route('**/api/run', route => route.fulfill({ json: { runId: 'ranked-run-12345', token: 'test-ticket', expiresAt: Date.now() + 60000 } }));
  await page.route('**/api/submit', route => { submissions++; return route.fulfill({ status: submissions === 1 ? 503 : 200, json: submissions === 1 ? { error: '暂时离线，请重试' } : { improved: true } }); });
  await page.goto('/'); await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await page.waitForTimeout(1500); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '结束本局，返回主菜单' }).click();
  await page.getByRole('textbox', { name: '排行榜昵称' }).fill('笑梦测试');
  await page.getByRole('button', { name: '留名', exact: true }).click();
  await expect(page.getByText('暂时离线，请重试')).toBeVisible();
  await page.reload(); await expect(page.getByRole('textbox', { name: '排行榜昵称' })).toHaveValue('笑梦测试');
  await page.getByRole('button', { name: '留名', exact: true }).click();
  await expect(page.getByText('Wonderhoy！成绩上榜啦！')).toBeVisible(); expect(submissions).toBe(2);
});

test('leaderboard fits portrait phones and shows eight filters, fixed avatar and own rank', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const entry = { rank: 1, nickname: 'Wonderhoy！', score: 123456, progression: 360, elapsed: 720, mode: 'story', outcome: 'complete' };
  await page.route('**/api/leaderboard?*', route => route.fulfill({ json: { entries: [entry], own: entry, total: 1 } }));
  await page.goto('/'); await page.getByRole('button', { name: '排行榜', exact: true }).click();
  await expect(page.getByText('你 · Wonderhoy！')).toBeVisible();
  for (const difficulty of ['normal', 'hard']) for (const mode of ['story', 'endless']) for (const controls of ['keyboardMouse', 'touch']) {
    await page.getByLabel('榜单难度').selectOption(difficulty); await page.getByLabel('榜单模式').selectOption(mode); await page.getByLabel('榜单操作').selectOption(controls);
    await expect(page.getByText('你 · Wonderhoy！')).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '关闭', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('energy mesh, high-quality local glow and pooled particles render and freeze with gameplay', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.goto('/?debug=1'); await page.getByRole('button', { name: '开始游戏', exact: true }).waitFor();
  await page.evaluate(() => {
    window.__MAFUYU_DEBUG__.settings({ quality: 'high' });
    window.__MAFUYU_DEBUG__.practice({ modules: ['beamCircuit', 'prism', 'droneSpotlight', 'droneConduit'], ranks: { beamCircuit: 5, prism: 5, droneSpotlight: 5, droneConduit: 5 } });
    const s = window.__MAFUYU_DEBUG__.state(); s.player.invincible = 100;
    s.beams.push({ id: 99999, x: s.player.x, y: s.player.y, angle: -.25, width: 88, length: 2400, life: 10, duration: 10 });
  });
  await page.waitForTimeout(400); await page.keyboard.press('Escape');
  const before = await page.evaluate(() => window.__MAFUYU_DEBUG__.state().elapsed);
  await page.waitForTimeout(300); expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().elapsed)).toBe(before);
  expect(errors).toEqual([]);
});
