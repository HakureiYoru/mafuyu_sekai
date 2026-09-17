import { expect, type Page } from '@playwright/test';

export async function resolveQueuedUpgrades(page: Page): Promise<void> {
  for (let guard = 0; guard < 64; guard++) {
    if (await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase) !== 'upgrade') return;
    await page.keyboard.press('1');
  }
  throw new Error('Upgrade queue did not drain after 64 actual selections');
}

/** Accelerated approach timers still require the actual elite damage/reward/gate path. */
export async function defeatGateElite(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().enemies.some(enemy => enemy.role === 'elite' && enemy.hp > 0))).toBe(true);
  const before = await page.evaluate(() => {
    const debug = window.__MAFUYU_DEBUG__, state = debug.state(), elite = state.enemies.find(enemy => enemy.role === 'elite' && enemy.hp > 0)!;
    const result = { id: elite.encounterId!, defeated: state.campaign.defeatedElites.length };
    debug.damageEnemy(elite.id, 1e8); return result;
  });
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('upgrade');
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().campaign.defeatedElites)).toContain(before.id);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().campaign.defeatedElites.length)).toBe(before.defeated + 1);
  await resolveQueuedUpgrades(page);
}
