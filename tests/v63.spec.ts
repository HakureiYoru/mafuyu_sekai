import { test, expect } from '@playwright/test';

test('specialized wing fire and heavy needles survive pause and restart without residual attacks', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1'); await page.getByRole('button', { name: '开始游戏', exact: true }).waitFor();
  await page.evaluate(() => {
    const d = window.__MAFUYU_DEBUG__;
    d.practice({ modules: ['piercing', 'precision', 'wingShots', 'droneBurst', 'droneHoming'], ranks: { wingShots: 5, piercing: 3 } });
    const s = d.state(); s.spawnTimer = 100; s.player.level = 10;
  });
  const box = (await page.locator('#game-host').boundingBox())!;
  await page.mouse.move(box.x + box.width * .9, box.y + box.height * .5);
  await page.keyboard.down('Shift'); await page.mouse.down();
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().bullets.some(b => b.visualId === 'railOverdrive'))).toBe(true);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().bullets.filter(b => b.visualId === 'wing').length)).toBeGreaterThanOrEqual(6);
  await page.keyboard.press('Escape'); await page.mouse.up(); await page.keyboard.up('Shift');
  const time = await page.evaluate(() => window.__MAFUYU_DEBUG__.state().elapsed);
  await page.waitForTimeout(250); expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().elapsed)).toBe(time);
  await page.evaluate(() => window.__MAFUYU_DEBUG__.restart());
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().build.modules)).toEqual([]);
  expect(errors).toEqual([]);
});

for (const type of ['stalker', 'prismWarden', 'conductor'] as const) test(`${type} warning renders, freezes, and retires owned parts on death`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1'); await page.getByRole('button', { name: '开始游戏', exact: true }).waitFor();
  await page.evaluate(type => {
    const d = window.__MAFUYU_DEBUG__; d.settings({ quality: 'low', reducedMotion: true }); d.practice({ encounter: type });
    const s = d.state(); s.spawnTimer = 100; s.pickups = []; s.enemies.forEach(e => { e.hp = e.maxHp = 10000; });
  }, type);
  await expect.poll(() => page.evaluate(type => window.__MAFUYU_DEBUG__.state().enemies.find(e => e.type === type)?.advanced?.phase, type)).toBe('windup');
  await page.evaluate(() => window.__MAFUYU_DEBUG__.pause());
  const before = await page.evaluate(type => JSON.stringify(window.__MAFUYU_DEBUG__.state().enemies.find(e => e.type === type)?.advanced), type);
  await page.waitForTimeout(250);
  expect(await page.evaluate(type => JSON.stringify(window.__MAFUYU_DEBUG__.state().enemies.find(e => e.type === type)?.advanced), type)).toBe(before);
  await page.evaluate(type => { const d = window.__MAFUYU_DEBUG__, e = d.state().enemies.find(e => e.type === type)!; d.damageEnemy(e.id, 1e9); d.resume(); }, type);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().enemies.filter(e => e.archetypeId === 'prismLens' && e.hp > 0))).toEqual([]);
  expect(errors).toEqual([]);
});
