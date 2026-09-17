import { expect, test, type Page } from '@playwright/test';
import { EVOLUTIONS, MODULES } from '../src/game/upgrades';
import type { EvolutionId, ModuleId } from '../src/game/types';

const ids = Object.keys(MODULES) as ModuleId[];
async function open(page: Page) {
  await page.goto('/?debug=1');
  await expect(page.getByRole('button', { name: '开始游戏', exact: true })).toBeVisible();
}

test('unlimited build has a compact HUD and a complete readable pause inventory', async ({ page }) => {
  await open(page);
  await page.evaluate(modules => {
    const debug = window.__MAFUYU_DEBUG__;
    debug.practice({ modules, encounter: 'palisade' });
    const state = debug.state(); state.player.invincible = 3600; state.spawnTimer = 3600;
    for (const id of modules) state.build.ranks[id] = 10000;
  }, ids);
  await page.keyboard.press('Escape');
  await expect(page.locator('.module-summary')).toContainText('36');
  await expect(page.locator('.module-summary')).toContainText('360000');
  await expect(page.locator('.module-summary')).not.toContainText('/ 6');
  await expect(page.locator('.paused-modules article')).toHaveCount(36);
  await expect(page.locator('.paused-modules article').first()).toContainText('Lv.10000');
  expect(await page.locator('.module-live>span').count()).toBeLessThanOrEqual(3);
  await page.screenshot({ path: 'test-results/v6-build-inventory.png', style: '.debug-panel{visibility:hidden!important;}' });
  await page.locator('.paused-modules article').last().scrollIntoViewIfNeeded();
  await expect(page.locator('.paused-modules article').last()).toBeVisible();
  const fits = await page.locator('.paused-modules').evaluate(element => element.scrollWidth <= element.clientWidth + 1);
  expect(fits).toBe(true);
});

test('upgrade cards show current rank benefits, static reduced-motion previews and recent upgrade', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const debug = window.__MAFUYU_DEBUG__; debug.settings({ reducedMotion: true }); debug.start();
    const state = debug.state(); state.player.invincible = 3600; state.spawnTimer = 3600;
    state.pickups.push({ id: 990001, type: 'xp', value: 100, age: 0, x: state.player.x, y: state.player.y });
  });
  await expect(page.getByRole('dialog', { name: '选择强化' })).toBeVisible();
  await expect(page.locator('.upgrade-card')).toHaveCount(3);
  const preview = page.locator('.module-preview').first();
  await expect(preview).toHaveAttribute('data-static', 'true');
  expect(await preview.locator('.preview-action').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await expect(page.locator('.upgrade-card').first().locator('.upgrade-rank')).toContainText('I');
  await page.screenshot({ path: 'test-results/v6-upgrade-choice.png', style: '.debug-panel{visibility:hidden!important;}' });
  await page.keyboard.press('1');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.module-summary')).toContainText('1');
  await expect(page.locator('.module-recent')).toContainText('＋');
  await page.keyboard.press('Escape');
  await expect(page.locator('.paused-modules article')).toHaveCount(1);
});

test('all six viewport layouts keep unlimited build text outside the 16:9 field', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.evaluate(modules => {
    window.__MAFUYU_DEBUG__.settings({ reducedMotion: true, quality: 'low' });
    window.__MAFUYU_DEBUG__.practice({ modules, encounter: 'palisade' });
    window.__MAFUYU_DEBUG__.state().player.invincible = 3600;
  }, ids);
  for (const [width, height] of [[1280, 720], [1920, 1080], [2560, 1440], [2560, 1080], [807, 519], [807, 900]]) {
    await page.setViewportSize({ width, height });
    const rail = page.locator('.module-summary'); await expect(rail).toBeVisible();
    await expect.poll(async () => {
      const host = await page.locator('#game-host').boundingBox(), box = await rail.boundingBox();
      return !!host && !!box && box.y >= host.y + host.height - 1 && box.x >= 0 && box.x + box.width <= width;
    }).toBe(true);
    const current = await page.locator('.module-recent').boundingBox();
    expect(current!.y + current!.height).toBeLessThanOrEqual(height);
    await page.screenshot({ path: `test-results/v6-build-${width}x${height}.png` });
  }
  expect(errors).toEqual([]);
});

test('full evolved build renders real projectile, drone, dash and damage effects at low quality', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 }); await open(page);
  await page.evaluate(({ modules, evolutions }) => {
    const debug = window.__MAFUYU_DEBUG__;
    debug.settings({ quality: 'low', screenShake: 0, reducedMotion: true });
    debug.practice({ modules, ranks: Object.fromEntries(modules.map(id => [id, 5])), evolutions, encounter: 'palisade' });
    const state = debug.state(); state.player.invincible = 3600; state.player.x = state.player.prevX = 1620;
    state.player.y = state.player.prevY = 1900;
    const boss = state.enemies.find(enemy => enemy.type === 'palisade')!;
    // A durable visual target avoids replacing the encounter mid capture; this is not a DPS fixture.
    boss.hp = boss.maxHp = 1e6;
  }, { modules: ids, evolutions: Object.keys(EVOLUTIONS) as EvolutionId[] });
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().companions.length)).toBe(3);
  const host = (await page.locator('#game-host').boundingBox())!;
  const aim = await page.evaluate(() => {
    const state = window.__MAFUYU_DEBUG__.state(), enemy = state.enemies.find(item => item.type === 'palisade')!;
    return { x: (enemy.x - state.camera.x + 800) / 1600, y: (enemy.y - state.camera.y + 450) / 900 };
  });
  await page.mouse.move(host.x + host.width * aim.x, host.y + host.height * aim.y);
  await page.mouse.down(); await page.keyboard.down('Shift');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().moduleVisuals?.some(effect => ['blade', 'pulse', 'spotlight', 'note'].includes(effect.kind))), { intervals: [50] }).toBe(true);
  await page.screenshot({ path: 'test-results/v6-full-build-fire.png', style: '.debug-panel{visibility:hidden!important;}' });
  await page.keyboard.up('Shift'); await page.keyboard.down('d'); await page.keyboard.press('r');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().moduleVisuals?.some(effect => effect.kind === 'lane')), { intervals: [30] }).toBe(true);
  await page.keyboard.up('d');
  await page.evaluate(() => window.__MAFUYU_DEBUG__.pause());
  await page.screenshot({ path: 'test-results/v6-full-build-dash.png', style: '.dialog-overlay,.debug-panel{visibility:hidden!important;}.hud-inactive{opacity:1!important;}' });
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().moduleVisuals?.some(effect => effect.kind === 'decoy'))).toBe(true);
  await page.evaluate(() => window.__MAFUYU_DEBUG__.resume());
  await page.evaluate(() => {
    const state = window.__MAFUYU_DEBUG__.state(), p = state.player;
    p.invincible = 0; p.dashTime = 0; p.hpReserve = 0;
    state.hazards.push({ id: 990808, kind: 'bombard', sourceId: state.enemies.find(enemy => enemy.type === 'palisade')!.id,
      x: p.x, y: p.y, radius: 10, warning: 0, warningDuration: 0, life: .06, duration: .06, active: true });
  });
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().moduleVisuals?.some(effect => effect.moduleId === 'counterPulse')), { intervals: [20] }).toBe(true);
  await page.evaluate(() => window.__MAFUYU_DEBUG__.pause());
  await page.screenshot({ path: 'test-results/v6-full-build-counter.png', style: '.dialog-overlay,.debug-panel{visibility:hidden!important;}.hud-inactive{opacity:1!important;}' });
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('all ten elite templates visibly announce their first locked movement or attack', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 }); await open(page);
  for (let stage = 1; stage <= 5; stage++) for (const variant of [0, 1]) {
    let seed = 1;
    while (true) { const hash = Math.imul(seed ^ Math.imul(stage, 0x9e3779b1), 0x85ebca6b); if (((hash ^ (hash >>> 16)) & 1) === variant) break; seed++; }
    await page.evaluate(({ stage, seed }) => {
      const debug = window.__MAFUYU_DEBUG__; debug.start({ seed });
      debug.settings({ quality: 'low', screenShake: 0, reducedMotion: true });
      const state = debug.state(); state.wave = state.campaign.stage = stage; state.player.invincible = 3600;
      debug.advanceStage();
    }, { stage, seed });
    await expect(page.getByLabel('波内精英')).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const enemy = window.__MAFUYU_DEBUG__.state().enemies.find(item => item.role === 'elite');
      return !!enemy && (!!enemy.action || (enemy.elite?.pending.length ?? 0) > 0 || ['charge', 'laserWarmup', 'volley'].includes(enemy.state));
    }), { intervals: [30] }).toBe(true);
    expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().enemies.find(item => item.role === 'elite')!.elite!.variant)).toBe(variant);
    await page.evaluate(() => window.__MAFUYU_DEBUG__.pause());
    await page.screenshot({ path: `test-results/v6-elite-${stage}-${variant}.png`, style: '.dialog-overlay,.debug-panel{visibility:hidden!important;}.hud-inactive{opacity:1!important;}' });
  }
  expect(errors).toEqual([]);
});
