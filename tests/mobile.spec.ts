import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';
import type { DebugControls } from '../src/game/runtime';

declare global { interface Window { __MAFUYU_DEBUG__: DebugControls } }
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const messages: string[] = []; errors.set(page, messages);
  page.on('pageerror', error => messages.push(error.message));
  page.on('console', message => { if (message.type() === 'error') messages.push(message.text()); });
});
test.afterEach(({ page }) => { expect(errors.get(page) ?? [], 'No browser runtime or console errors').toEqual([]); });
const control = (page: Page, name: string) => page.locator(`[data-touch-control="${name}"]`);
const phase = (page: Page) => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase);
async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Touch target is not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function start(page: Page) {
  await page.goto('/?debug=1');
  await expect(page.getByRole('button', { name: '开始游戏', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始游戏', exact: true }).tap();
  await expect.poll(() => phase(page)).toBe('playing');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().controlMode)).toBe('touch');
  await page.evaluate(() => { window.__MAFUYU_DEBUG__.state().player.invincible = 3600; });
}
async function targetFixture(page: Page) {
  await page.evaluate(() => {
    const d = window.__MAFUYU_DEBUG__;
    d.practice({ encounter: 'palisade' });
    const s = d.state(); s.player.level = 1; s.companions.length = 0; s.pickups.length = 0; s.spawnTimer = 3600;
    for (const e of s.enemies) e.hp = e.maxHp = 1e7;
  });
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().enemies.some(e => e.type === 'arm'))).toBe(true);
}

/** Real Chromium touch input. Omitting one active point dispatches its release while retaining others. */
class Fingers {
  private points = new Map<number, { id: number; x: number; y: number; radiusX: number; radiusY: number; force: number }>();
  constructor(private cdp: CDPSession) {}
  async down(id: number, point: { x: number; y: number }) {
    this.points.set(id, { ...point, id, radiusX: 4, radiusY: 4, force: 1 });
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...this.points.values()] });
  }
  async move(id: number, point: { x: number; y: number }) {
    const previous = this.points.get(id); if (!previous) throw new Error('Finger must start before moving');
    this.points.set(id, { ...previous, ...point });
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [...this.points.values()] });
  }
  async up(id: number) {
    this.points.delete(id);
    await this.cdp.send('Input.dispatchTouchEvent', { type: this.points.size ? 'touchMove' : 'touchEnd', touchPoints: [...this.points.values()] });
  }
  async cancel() { this.points.clear(); await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); }
}

test('touch start does not wait for audio downloads and auto-fire produces a real first shot', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/(?:sound\/shot\.wav|assets\/music\/bg\.mp3)$/, async route => { await held; await route.continue().catch(() => {}); });
  try {
    await start(page); await targetFixture(page);
    await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.heat)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().enemies.some(e => e.hp < e.maxHp))).toBe(true);
    expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().touch.autoFireEnabled)).toBe(true);
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('tapping a visible boss arm locks the part, and its defeat releases the lock', async ({ page }) => {
  await start(page); await targetFixture(page);
  const target = await page.evaluate(() => {
    const s = window.__MAFUYU_DEBUG__.state(), e = s.enemies.find(e => e.type === 'arm')!;
    e.hp = e.maxHp = 1e7;
    const rect = document.querySelector('#game-host canvas')!.getBoundingClientRect();
    return { id: e.id, x: rect.left + (e.x - s.camera.x + 800) / 1600 * rect.width,
      y: rect.top + (e.y - s.camera.y + 450) / 900 * rect.height };
  });
  await page.touchscreen.tap(target.x, target.y);
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().touch.lockedTargetId)).toBe(target.id);
  await page.evaluate(id => window.__MAFUYU_DEBUG__.damageEnemy(id, 1e9), target.id);
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().touch.lockedTargetId)).not.toBe(target.id);
});

test('touch heat control cools automatically and a dash still releases the empowered beam', async ({ page }) => {
  await start(page); await targetFixture(page);
  await page.evaluate(() => { const p = window.__MAFUYU_DEBUG__.state().player; p.heat = 90; p.overheated = true; p.heatLock = 1.2; });
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().touch.cooling)).toBe(true);
  await control(page, 'dash').tap();
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().beams.length), { intervals: [10, 20, 30] }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().touch.cooling)).toBe(false);
  await control(page, 'fire').tap();
  await expect(control(page, 'fire')).toHaveAttribute('aria-pressed', 'false');
  const heat = await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.heat);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.heat)).toBeLessThanOrEqual(heat);
});

test('three real touch points have independent releases; cancellation pauses and clears all held input', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Chromium CDP covers genuine simultaneous touch points; WebKit exercises single-touch flows separately.');
  await start(page);
  const cdp = await page.context().newCDPSession(page), fingers = new Fingers(cdp);
  const stick = await center(control(page, 'stick')), focus = await center(control(page, 'focus')), dash = await center(control(page, 'dash'));
  await fingers.down(1, stick); await fingers.move(1, { x: stick.x + 48, y: stick.y });
  await fingers.down(2, focus); await fingers.down(3, dash);
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().touch.focus)).toBe(true);
  await fingers.up(3); await fingers.up(2);
  await page.waitForTimeout(220);
  const before = await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.x);
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.x)).toBeGreaterThan(before + 15);
  expect(await phase(page)).toBe('playing');
  await fingers.cancel();
  await expect.poll(() => phase(page)).toBe('paused');
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().touch.focus)).toBe(false);
  const stopped = await page.evaluate(() => ({ x: window.__MAFUYU_DEBUG__.state().player.x, tick: window.__MAFUYU_DEBUG__.state().tick }));
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().tick)).toBe(stopped.tick);
  await page.getByRole('button', { name: /继续游戏/ }).tap();
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.x)).toBeCloseTo(stopped.x, 2);
  await cdp.detach();
});

test('a final upgrade selected in portrait cannot resume the simulation through the orientation gate', async ({ page }) => {
  await start(page);
  await page.evaluate(() => { const s = window.__MAFUYU_DEBUG__.state(), p = s.player; s.spawnTimer = 3600; s.pickups.push({ id: 910001, type: 'xp', value: 100, x: p.x, y: p.y, age: 0 }); });
  await expect.poll(() => phase(page)).toBe('upgrade');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().orientationBlocked)).toBe(true);
  await page.locator('.upgrade-card').first().tap();
  await expect.poll(() => phase(page)).toBe('paused');
  const tick = await page.evaluate(() => window.__MAFUYU_DEBUG__.state().tick);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().tick)).toBe(tick);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.lifecycle().rafActive)).toBe(false);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole('button', { name: /继续游戏/ }).tap();
  await expect.poll(() => phase(page)).toBe('playing');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().tick)).toBeGreaterThan(tick);
});

test('touch settings and saved run score survive refresh without adding starting power', async ({ page }) => {
  await start(page); await page.getByRole('button', { name: '暂停游戏', exact: true }).tap();
  await page.getByRole('button', { name: '体验设置', exact: true }).tap();
  await page.getByRole('group', { name: '操作方式', exact: true }).getByRole('button', { name: '触屏', exact: true }).tap();
  await page.getByRole('button', { name: '30 帧 · 省电', exact: true }).tap();
  await page.getByRole('group', { name: '画面品质', exact: true }).getByRole('button', { name: /轻量/ }).tap();
  await page.getByRole('button', { name: /完成/ }).tap();
  await page.getByRole('button', { name: /继续游戏/ }).tap();
  await page.evaluate(() => { window.__MAFUYU_DEBUG__.state().score = 6789; });
  await page.getByRole('button', { name: '暂停游戏', exact: true }).tap();
  await page.getByRole('button', { name: '结束本局，返回主菜单', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mafuyu-sekai:profile:v3') ?? '{}').bestScores?.v6?.normal?.story)).toBe(6789);
  await page.reload();
  await expect(page.getByRole('button', { name: '开始游戏', exact: true })).toBeVisible();
  expect(await page.evaluate(() => { const s = window.__MAFUYU_DEBUG__.snapshot(); return { controlMode: s.settings.controlMode, fps: s.settings.touchFrameRate, quality: s.settings.quality }; })).toEqual({ controlMode: 'touch', fps: 30, quality: 'low' });
  await page.getByRole('button', { name: '开始游戏', exact: true }).tap();
  expect(await page.evaluate(() => ({ level: window.__MAFUYU_DEBUG__.state().player.level, modules: window.__MAFUYU_DEBUG__.state().build.modules.length }))).toEqual({ level: 1, modules: 0 });
});

test('scrolling a reward card does not choose it; a separate tap commits exactly once', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native multi-step touch scrolling is driven through Chromium CDP.');
  await page.setViewportSize({ width: 568, height: 320 }); await start(page);
  await page.evaluate(() => { const s = window.__MAFUYU_DEBUG__.state(), p = s.player; s.spawnTimer = 3600; s.pickups.push({ id: 910002, type: 'xp', value: 100, x: p.x, y: p.y, age: 0 }); });
  await expect.poll(() => phase(page)).toBe('upgrade');
  const before = await page.evaluate(() => ({ offer: window.__MAFUYU_DEBUG__.snapshot().upgradeOfferId, modules: window.__MAFUYU_DEBUG__.state().build.modules.length }));
  const card = page.locator('.upgrade-card').first(); await card.scrollIntoViewIfNeeded();
  const box = (await card.boundingBox())!, cdp = await page.context().newCDPSession(page), fingers = new Fingers(cdp);
  const startAt = { x: box.x + box.width / 2, y: Math.min(260, box.y + 110) };
  await fingers.down(1, startAt);
  for (let i = 1; i <= 6; i++) { await fingers.move(1, { x: startAt.x, y: startAt.y - i * 20 }); await page.waitForTimeout(20); }
  await fingers.up(1);
  expect(await phase(page)).toBe('upgrade');
  expect(await page.evaluate(() => ({ offer: window.__MAFUYU_DEBUG__.snapshot().upgradeOfferId, modules: window.__MAFUYU_DEBUG__.state().build.modules.length }))).toEqual(before);
  await card.tap();
  await expect.poll(() => phase(page)).toBe('playing');
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().build.modules.length)).toBe(before.modules + 1);
  await cdp.detach();
});

test('twenty touch restarts retain one canvas and one loop without old movement or target state', async ({ page }) => {
  await start(page);
  for (let index = 0; index < 20; index++) {
    await control(page, 'focus').tap();
    await page.evaluate(() => window.__MAFUYU_DEBUG__.restart());
    await expect.poll(() => phase(page)).toBe('playing');
    expect(await page.evaluate(() => { const d = window.__MAFUYU_DEBUG__, s = d.state(); return { life: d.lifecycle(), hp: s.player.hp, level: s.player.level, touch: d.snapshot().touch }; })).toMatchObject({ life: { rafActive: true, disposed: false }, hp: 5, level: 1, touch: { focus: false, lockedTargetId: null, autoFireEnabled: true } });
  }
  await expect(page.locator('#game-host canvas')).toHaveCount(1);
  const before = await page.evaluate(() => ({ tick: window.__MAFUYU_DEBUG__.state().tick, x: window.__MAFUYU_DEBUG__.state().player.x }));
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ tick: window.__MAFUYU_DEBUG__.state().tick, x: window.__MAFUYU_DEBUG__.state().player.x }));
  expect(after.tick - before.tick).toBeGreaterThan(15); expect(after.tick - before.tick).toBeLessThan(45); expect(after.x).toBeCloseTo(before.x, 2);
});

for (const [width, height] of [[568, 320], [667, 375], [844, 390], [932, 430], [1024, 768]]) {
  test(`touch layout ${width}×${height}, safe areas, and corresponding portrait`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height }); await start(page);
    // CSS env(safe-area-inset-*) is zero on desktop emulators; injected variables test layout only.
    await page.locator('#game-shell').evaluate(shell => { (shell as HTMLElement).style.setProperty('--safe-left', '18px'); (shell as HTMLElement).style.setProperty('--safe-right', '18px'); });
    const geometry = await page.evaluate(() => {
      const field = document.querySelector('#game-host canvas')!.getBoundingClientRect();
      const controls = [...document.querySelectorAll('.touch-stick-zone,.touch-action-zone,.touch-comms,.touch-hud-top,.touch-hud-bottom')];
      return { ratio: field.width / field.height, field: { x: field.x, y: field.y, width: field.width, height: field.height },
        overlaps: controls.filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && Math.min(r.right, field.right) - Math.max(r.left, field.left) > 1 && Math.min(r.bottom, field.bottom) - Math.max(r.top, field.top) > 1; }).map(el => el.className),
        buttons: [...document.querySelectorAll('[data-touch-control]:not([data-touch-control="stick"])')].map(el => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height, x: r.x, y: r.y, right: r.right, bottom: r.bottom }; }) };
    });
    expect(geometry.ratio).toBeCloseTo(16 / 9, 2); expect(geometry.overlaps).toEqual([]);
    expect(geometry.field.width).toBeGreaterThan(250);
    for (const button of geometry.buttons) { expect(button.width).toBeGreaterThanOrEqual(44); expect(button.height).toBeGreaterThanOrEqual(44); expect(button.x).toBeGreaterThanOrEqual(0); expect(button.right).toBeLessThanOrEqual(width); expect(button.bottom).toBeLessThanOrEqual(height); }
    await page.screenshot({ path: testInfo.outputPath(`landscape-${width}x${height}.png`) });
    await page.setViewportSize({ width: height, height: width });
    await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().orientationBlocked)).toBe(true);
    await expect.poll(() => phase(page)).toBe('paused');
    await expect(page.getByRole('dialog', { name: '请横屏游玩' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`portrait-${height}x${width}.png`) });
    await page.getByRole('button', { name: '返回主菜单', exact: true }).tap();
    await expect(page.getByRole('button', { name: '横屏后开始', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '体验设置', exact: true }).tap();
    await expect(page.getByRole('dialog', { name: '游戏设置' })).toBeVisible();
  });
}
