import { test, expect, type Page } from '@playwright/test';
import type { DebugControls } from '../src/game/runtime';

declare global { interface Window { __MAFUYU_DEBUG__: DebugControls } }
async function ready(page: Page) {
  await page.goto('/?debug=1');
  await page.getByRole('button', { name: '开始游戏', exact: true }).waitFor();
  await page.evaluate(() => {
    const d = window.__MAFUYU_DEBUG__;
    d.scenario('arsenal');
    for (const e of d.state().enemies) { e.hp = e.maxHp = 10000; e.speed = 0; e.cooldown = 999; }
  });
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().companions.length)).toBe(3);
}
async function aim(page: Page, x: number, y: number) {
  const screen = await page.evaluate(({ x, y }) => {
    const s = window.__MAFUYU_DEBUG__.state(), r = document.querySelector('#game-host')!.getBoundingClientRect();
    return { x: r.left + (x - s.camera.x + 800) / 1600 * r.width, y: r.top + (y - s.camera.y + 450) / 900 * r.height };
  }, { x, y });
  await page.mouse.move(screen.x, screen.y);
}

test('holding main fire preserves dash charge until Q, then E selects and releases a real target', async ({ page }) => {
  await ready(page); await aim(page, 2450, 2000);
  await page.mouse.down(); await page.keyboard.press('r');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.perfectWindow)).toBeGreaterThan(3);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().beams.length)).toBe(0);
  await page.keyboard.press('q');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().beams.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.perfectWindow)).toBe(0);
  await page.mouse.up(); await aim(page, 2450, 2000); await page.keyboard.press('e');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.commandTargetId)).not.toBeNull();
  const target = await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.commandTargetId!);
  await page.evaluate(id => window.__MAFUYU_DEBUG__.damageEnemy(id, 1e7), target);
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.commandTargetId)).toBeNull();
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.commandCooldown)).toBeGreaterThan(6);
  await expect(page.getByRole('meter', { name: '弹药' })).toHaveCount(0);
});

test('pause freezes Q/E clocks and pointer capture carries firing over the canvas edge', async ({ page }) => {
  await ready(page); await aim(page, 2450, 2000); await page.keyboard.press('e'); await page.keyboard.press('r');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.perfectWindow)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  const before = await page.evaluate(() => {
    const p = window.__MAFUYU_DEBUG__.state().player; return [p.perfectWindow, p.commandTime, p.commandCooldown];
  });
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => { const p = window.__MAFUYU_DEBUG__.state().player; return [p.perfectWindow, p.commandTime, p.commandCooldown]; })).toEqual(before);
  await page.getByRole('button', { name: /继续游戏/ }).click();
  await aim(page, 2300, 2000); await page.mouse.down();
  const host = (await page.locator('#game-host').boundingBox())!;
  await page.mouse.move(host.x + host.width / 2, Math.max(0, host.y - 8));
  const heat = await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.heat);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.heat)).toBeGreaterThan(heat);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('paused');
});

test('Q remapping persists and old binding does not release stored fire', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const d = window.__MAFUYU_DEBUG__, settings = d.snapshot().settings;
    d.settings({ keybindings: { ...settings.keybindings, beam: 'KeyF' }, damageNumbers: 'important' });
  });
  await page.reload(); await page.getByRole('button', { name: '开始游戏', exact: true }).waitFor();
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().settings)).toMatchObject({ keybindings: { beam: 'KeyF' }, damageNumbers: 'important' });
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await page.keyboard.press('r');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.perfectWindow)).toBeGreaterThan(0);
  await page.keyboard.press('q');
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.perfectWindow)).toBeGreaterThan(0);
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.perfectWindow)).toBe(0);
});
