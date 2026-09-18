import { expect, test, type Locator, type Page } from '@playwright/test';
import { compactChoiceDescription } from '../src/game/upgrade-copy';
import { MODULES } from '../src/game/upgrades';
import type { DebugControls } from '../src/game/runtime';
import type { PlayerBuild, UpgradeChoiceId } from '../src/game/types';

declare global { interface Window { __MAFUYU_DEBUG__: DebugControls } }

type BuildFixture = Pick<PlayerBuild, 'modules' | 'ranks' | 'evolutions'>;

const desktopBuild: BuildFixture = {
  modules: ['piercing', 'precision', 'droneBurst', 'droneConduit', 'wingShots', 'rearSpark'],
  ranks: { piercing: 1, precision: 1, droneBurst: 1, droneConduit: 2, wingShots: 2, rearSpark: 1 },
  evolutions: ['spiralBloom'],
};

const touchBuild: BuildFixture = {
  modules: ['graze', 'droneBurst', 'crossOrbit', 'piercing', 'precision', 'wingShots', 'rearSpark'],
  ranks: { graze: 99999, droneBurst: 2, crossOrbit: 1, piercing: 1, precision: 1, wingShots: 2, rearSpark: 1 },
  evolutions: ['spiralBloom'],
};
const touchChoices: UpgradeChoiceId[] = ['graze', 'evolution:triangleAssault', 'piercing'];

async function openEarnedUpgrade(page: Page, touch = false) {
  await page.goto('/?debug=1');
  const start = page.getByRole('button', { name: '开始游戏', exact: true });
  await expect(start).toBeVisible();
  await page.evaluate(touch => window.__MAFUYU_DEBUG__.settings({
    reducedMotion: true, quality: 'low', controlMode: touch ? 'touch' : 'keyboardMouse',
  }), touch);
  if (touch) await start.tap(); else await start.click();
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('playing');
  await page.evaluate(() => {
    const state = window.__MAFUYU_DEBUG__.state(), player = state.player;
    player.invincible = 3600; state.spawnTimer = 3600;
    state.enemies.length = 0; state.bullets.length = 0; state.pickups.length = 0;
    state.pickups.push({ id: 990701, type: 'xp', value: 100, age: 0, x: player.x, y: player.y });
  });
  await expect(page.getByRole('dialog', { name: '选择强化', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.level)).toBe(2);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().build.pendingRewards.map(reward => reward.source))).toEqual(['level']);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.lifecycle().rafActive)).toBe(false);
}

async function setOffer(page: Page, build: BuildFixture, choices: UpgradeChoiceId[], elite = false) {
  await page.evaluate(({ build, choices, elite }) => {
    const debug = window.__MAFUYU_DEBUG__, current = debug.state().build;
    current.modules = [...build.modules]; current.ranks = { ...build.ranks }; current.evolutions = [...build.evolutions];
    current.choices = [...choices];
    // Keep the real earned reward and offer identity; use an elite source for the evolution-card fixture.
    if (elite) current.pendingRewards[0].source = 'elite';
    debug.settings({ reducedMotion: true });
  }, { build, choices, elite });
  await expect(page.locator('.upgrade-card')).toHaveCount(3);
  for (const id of choices) await expect(page.locator(`.upgrade-card[data-choice="${id}"]`)).toBeVisible();
}

async function pausedBuild(page: Page) {
  return page.evaluate(() => {
    const debug = window.__MAFUYU_DEBUG__, state = debug.state();
    return { phase: debug.snapshot().phase, tick: state.tick, offer: state.build.offerId,
      choices: state.build.choices, modules: state.build.modules, ranks: state.build.ranks,
      evolutions: state.build.evolutions, choiceIndex: state.build.choiceIndex, pending: state.build.pendingRewards };
  });
}

async function expectInsideVisualViewport(locator: Locator) {
  const metrics = await locator.evaluate(element => {
    const box = element.getBoundingClientRect(), viewport = window.visualViewport;
    return { x: box.left, y: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height,
      left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
      viewportRight: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth),
      viewportBottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) };
  });
  expect(metrics.width).toBeGreaterThan(0); expect(metrics.height).toBeGreaterThan(0);
  expect(metrics.x).toBeGreaterThanOrEqual(metrics.left - 1);
  expect(metrics.y).toBeGreaterThanOrEqual(metrics.top - 1);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportRight + 1);
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportBottom + 1);
}

async function expectMainOfferFits(page: Page) {
  const dialog = page.locator('.upgrade-dialog');
  await expect(dialog).not.toHaveClass(/is-inspecting/);
  await expect(page.locator('.upgrade-card')).toHaveCount(3);
  await expectInsideVisualViewport(dialog);
  const scroll = await dialog.evaluate(element => ({ height: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop }));
  expect(scroll.scrollHeight).toBeLessThanOrEqual(scroll.height);
  expect(scroll.scrollTop).toBe(0);
  const controls = page.locator('.upgrade-card, .upgrade-detail, .upgrade-toolbar > button');
  for (let index = 0; index < await controls.count(); index++) await expectInsideVisualViewport(controls.nth(index));
  const cards = await page.locator('.upgrade-card').evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    const content = [...element.querySelectorAll('.upgrade-branch, :scope > strong, .upgrade-description, .upgrade-combo, .upgrade-confirm')].map(child => {
      const rect = child.getBoundingClientRect(), style = getComputedStyle(child);
      return { text: child.textContent?.trim(), top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height,
        scrollHeight: child.scrollHeight, clientHeight: child.clientHeight, display: style.display,
        visibility: style.visibility, lineClamp: style.webkitLineClamp };
    });
    return { id: element.getAttribute('data-choice'), top: box.top, bottom: box.bottom,
      clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, content };
  }));
  for (const card of cards) {
    expect(card.scrollHeight, `${card.id}: card must not hide vertical overflow`).toBeLessThanOrEqual(card.clientHeight + 1);
    for (const content of card.content) {
      expect(content.text).toBeTruthy(); expect(content.display).not.toBe('none'); expect(content.visibility).toBe('visible');
      expect(content.height).toBeGreaterThan(0); expect(content.width).toBeGreaterThan(0);
      expect(content.top, `${card.id}: ${content.text}`).toBeGreaterThanOrEqual(card.top - 1);
      expect(content.bottom, `${card.id}: ${content.text}`).toBeLessThanOrEqual(card.bottom + 1);
      expect(content.scrollHeight, `${card.id}: ${content.text}`).toBeLessThanOrEqual(content.clientHeight + 1);
      expect(['none', '0', '']).toContain(content.lineClamp);
    }
  }
}

test('earned upgrade explains primary and partner recipes, inspection is free, and one selection resumes', async ({ page }) => {
  await openEarnedUpgrade(page);
  await setOffer(page, desktopBuild, ['piercing', 'crossOrbit', 'vent']);
  const original = await pausedBuild(page);
  const primary = page.locator('.upgrade-card[data-choice="piercing"]');
  const partner = page.locator('.upgrade-card[data-choice="crossOrbit"]');
  await expect(primary.locator('.upgrade-combo')).toContainText('针轨贯阵');
  await expect(primary.locator('.upgrade-combo')).toContainText('选后配方齐全');
  await expect(partner.locator('.upgrade-combo')).toContainText('三角回廊');
  await expect(partner.locator('.upgrade-combo')).toContainText('选后配方齐全');
  await expect(partner.locator('.upgrade-combo')).toContainText('还缺 共振集火升至 II');
  await expect(page.getByLabel('当前组合方向')).toContainText('还缺 贯通线圈升至 II');

  const partnerDetail = page.getByRole('button', { name: '查看交叉阵位详情', exact: true });
  await partnerDetail.click();
  await expect(page.getByRole('dialog', { name: '交叉阵位', exact: true })).toBeVisible();
  await expect(page.locator('.upgrade-full-description')).toHaveText(MODULES.crossOrbit.description);
  await expect(page.locator('.upgrade-inspection')).toContainText('查看详情不会选择强化');
  await expect(page.locator('.recipe-path[data-evolution="triangleHall"]')).toContainText('束流棱台 II · 已有 II');
  await expect(page.locator('.recipe-path[data-evolution="triangleHall"]')).toContainText('交叉阵位 I · 未获得');
  await page.keyboard.press('1');
  await expect(page.getByRole('dialog', { name: '交叉阵位', exact: true })).toBeVisible();
  expect(await pausedBuild(page)).toEqual(original);
  await page.keyboard.press('Escape');
  await expect(page.locator('.upgrade-card')).toHaveCount(3);
  await expect(partnerDetail).toBeFocused();

  await page.getByRole('button', { name: '本局构筑与组合', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '本局构筑与组合', exact: true })).toBeVisible();
  const needle = page.locator('.recipe-path[data-evolution="needleArray"]');
  await expect(needle).toContainText('贯通线圈 II · 已有 I');
  await expect(needle).toContainText('精密校准 I · 已有 I');
  await expect(needle).toContainText('还缺：贯通线圈升至 II');
  await expect(page.locator('.recipe-path[data-evolution="triangleHall"]')).toContainText('交叉阵位 I · 未获得');
  await expect(page.locator('.recipe-path[data-evolution="spiralBloom"]')).toContainText('已进化');
  expect(await pausedBuild(page)).toEqual(original);
  await page.getByRole('button', { name: '← 返回选卡', exact: true }).click();

  await page.keyboard.press('1');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('playing');
  const selected = await pausedBuild(page);
  expect(selected.choiceIndex).toBe(original.choiceIndex + 1);
  expect(selected.ranks.piercing).toBe(2);
  expect(selected.modules).toEqual(original.modules);
  expect(selected.evolutions).toEqual(original.evolutions);
  expect(selected.pending).toEqual([]);
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().tick)).toBeGreaterThan(original.tick);
});

test('reroll changes the offer and a new offer resets an open inspection panel', async ({ page }) => {
  await openEarnedUpgrade(page);
  await setOffer(page, desktopBuild, ['piercing', 'crossOrbit', 'vent']);
  const original = await pausedBuild(page);
  await page.getByRole('button', { name: '重抽 · 2', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().upgradeOfferId)).not.toBe(original.offer);
  await expect(page.getByRole('button', { name: '重抽 · 1', exact: true })).toBeVisible();
  const rerolled = await pausedBuild(page);
  expect(rerolled.choices).not.toEqual(original.choices);
  expect(rerolled.choiceIndex).toBe(original.choiceIndex);
  await page.locator('.upgrade-detail').first().click();
  await expect(page.locator('.upgrade-dialog')).toHaveClass(/is-inspecting/);
  await page.evaluate(() => window.__MAFUYU_DEBUG__.reroll());
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().upgradeOfferId)).not.toBe(rerolled.offer);
  await expect(page.locator('.upgrade-dialog')).not.toHaveClass(/is-inspecting/);
  await expect(page.locator('.upgrade-card')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '重抽 · 0', exact: true })).toBeDisabled();
  expect((await pausedBuild(page)).choiceIndex).toBe(original.choiceIndex);
  expect((await pausedBuild(page)).phase).toBe('upgrade');
});

test.describe('touch upgrade layout', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

  for (const [width, height, safeArea] of [[568, 320, false], [667, 375, false], [844, 390, false], [1024, 768, false], [568, 320, true]] as const) {
    test(`${width}x${height}${safeArea ? ' with safe areas' : ''} keeps three complete choices, detail controls and reroll on screen`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openEarnedUpgrade(page, true);
      await setOffer(page, touchBuild, touchChoices, true);
      if (safeArea) await page.locator('#game-shell').evaluate(shell => {
        const style = (shell as HTMLElement).style;
        style.setProperty('--safe-left', '24px'); style.setProperty('--safe-right', '30px');
        style.setProperty('--safe-top', '12px'); style.setProperty('--safe-bottom', '10px');
      });
      expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().controlMode)).toBe('touch');
      await expect(page.getByLabel('当前组合方向')).toContainText('配方齐全 · 本次可选进化');
      await expect(page.locator('.upgrade-card[data-choice="graze"] .upgrade-rank')).toContainText('99999');
      await expect(page.locator('.upgrade-card[data-choice="evolution:triangleAssault"] .upgrade-combo')).toContainText('本次进化');
      await expect(page.locator('.upgrade-card[data-choice="piercing"] .upgrade-combo')).toContainText('选后配方齐全');
      for (const id of touchChoices) {
        await expect(page.locator(`.upgrade-card[data-choice="${id}"] .upgrade-description`)).toHaveText(compactChoiceDescription(touchBuild, id));
      }
      await expectMainOfferFits(page);
      await page.screenshot({ path: `test-results/upgrade-guidance-${width}x${height}${safeArea ? '-safe' : ''}.png`, style: '.debug-panel{visibility:hidden!important;}' });

      const original = await pausedBuild(page);
      await page.getByRole('button', { name: '查看三角围攻详情', exact: true }).tap();
      await expect(page.getByRole('dialog', { name: '三角围攻', exact: true })).toBeVisible();
      await expect(page.locator('.upgrade-full-description')).toContainText('总伤害 18');
      await expectInsideVisualViewport(page.getByRole('button', { name: '← 返回选卡', exact: true }));
      expect(await pausedBuild(page)).toEqual(original);
      await page.getByRole('button', { name: '← 返回选卡', exact: true }).tap();
      await expectMainOfferFits(page);
      await page.getByRole('button', { name: '重抽 · 2', exact: true }).tap();
      await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().upgradeOfferId)).not.toBe(original.offer);
      await expect(page.getByRole('button', { name: '重抽 · 1', exact: true })).toBeVisible();
      expect((await pausedBuild(page)).choiceIndex).toBe(original.choiceIndex);
      await expectMainOfferFits(page);
    });
  }
});
