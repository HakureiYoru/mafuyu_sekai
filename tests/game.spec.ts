import { defeatGateElite } from './campaign-helpers';
import { test, expect, type Page } from '@playwright/test';
import type { DebugControls } from '../src/game/runtime';

declare global { interface Window { __MAFUYU_DEBUG__: DebugControls } }
async function openGame(page: Page) {
  await page.goto('/?debug=1');
  await expect(page.getByRole('button', { name: '开始游戏' })).toBeVisible();
}
async function play(page: Page) {
  await openGame(page);
  await page.getByRole('button', { name: '开始游戏' }).click();
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('playing');
  await page.evaluate(() => { window.__MAFUYU_DEBUG__.state().player.invincible = 3600; });
}

test('assets load, menu enters the complete game, and production UI hides debug tools', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '开始游戏' })).toBeVisible();
  await expect(page.getByLabel('性能信息')).toHaveCount(0);
  expect(await page.evaluate(() => '__MAFUYU_DEBUG__' in window)).toBe(false);
  await page.getByRole('button', { name: '开始游戏' }).click();
  await expect(page.getByLabel('战斗状态')).toBeVisible();
  await expect(page.getByRole('meter', { name: '生命' })).toHaveAttribute('aria-valuenow', '5');
  expect(errors).toEqual([]);
});

test('medicine leaves the playfield, updates reserve HUD, and waits through pause before healing', async ({ page }) => {
  await play(page);
  await page.evaluate(() => {
    const state = window.__MAFUYU_DEBUG__.state(), p = state.player;
    state.spawnTimer = 3600;
    state.enemies.length = 0;
    state.pickups.push({ id: 990001, type: 'hp', value: 4, x: p.x, y: p.y, age: 0 });
  });
  await expect(page.getByLabel('备用血药')).toHaveText('血药 ×4');
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().pickups.some(item => item.type === 'hp'))).toBe(false);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('paused');
  await page.evaluate(() => { window.__MAFUYU_DEBUG__.state().player.hp = 3; });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => {
    const p = window.__MAFUYU_DEBUG__.state().player;
    return { hp: p.hp, reserve: p.hpReserve };
  })).toEqual({ hp: 3, reserve: 4 });
  await page.getByRole('button', { name: /继续游戏/ }).click();
  await expect(page.getByLabel('备用血药')).toHaveText('血药 ×2');
  await expect(page.getByRole('meter', { name: '生命', exact: true })).toHaveAttribute('aria-valuenow', '5');
  await page.evaluate(() => window.__MAFUYU_DEBUG__.restart());
  await expect(page.getByLabel('备用血药')).toHaveText('血药 ×0');
});

test('aim mapping, first shot, stationary dash, single bomb and focus recovery', async ({ page }) => {
  await play(page);
  const bounds = (await page.locator('#game-host').boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.5);
  await expect.poll(() => page.evaluate(() => Math.abs(window.__MAFUYU_DEBUG__.state().player.angle))).toBeLessThan(0.01);
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().bullets.length)).toBeGreaterThan(0);
  await page.mouse.up();
  const before = await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.x);
  await page.keyboard.press('r');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.x)).toBeGreaterThan(before + 180);
  await page.keyboard.down('Space'); await page.keyboard.down('Space');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().bombs)).toBe(2);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().bombs)).toBe(2);
  await page.keyboard.up('Space');
  await page.keyboard.down('w'); await page.mouse.down();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('paused');
  const paused = await page.evaluate(() => ({ tick: window.__MAFUYU_DEBUG__.state().tick, y: window.__MAFUYU_DEBUG__.state().player.y }));
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().tick)).toBe(paused.tick);
  await page.keyboard.up('w'); await page.mouse.up();
  await page.getByRole('button', { name: '继续游戏', exact: false }).click();
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('playing');
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.y)).toBeCloseTo(paused.y, 3);
});

test('twenty restarts never stack canvases, animation loops or old boss transitions', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => window.__MAFUYU_DEBUG__.scenario('boss-warning'));
  await page.waitForTimeout(150);
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.__MAFUYU_DEBUG__.restart());
    const reset = await page.evaluate(() => {
      const state = window.__MAFUYU_DEBUG__.state();
      return { wave: state.wave, bossPending: state.bossPending, pendingWave: state.pendingWave, hp: state.player.hp, life: window.__MAFUYU_DEBUG__.lifecycle() };
    });
    expect(reset).toMatchObject({ wave: 1, bossPending: false, pendingWave: 0, hp: 5, life: { phase: 'playing', rafActive: true, disposed: false } });
  }
  await expect(page.locator('#game-host canvas')).toHaveCount(1);
  const tick = await page.evaluate(() => window.__MAFUYU_DEBUG__.state().tick);
  await page.waitForTimeout(500);
  const difference = await page.evaluate(() => window.__MAFUYU_DEBUG__.state().tick) - tick;
  expect(difference).toBeGreaterThan(15);
  expect(difference).toBeLessThan(45);
});

test('completion continues to endless, failure restarts and Escape pauses', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => window.__MAFUYU_DEBUG__.scenario('complete'));
  await page.getByRole('button', { name: /继续.*无尽|无尽.*继续|进入无尽/ }).click();
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().mode)).toBe('endless');
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().wave)).toBe(6);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('paused');
  await page.evaluate(() => window.__MAFUYU_DEBUG__.scenario('failed'));
  await page.getByRole('button', { name: '再次挑战' }).click();
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('playing');
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().wave)).toBe(1);
});

test('settings persist across reload and dialog is keyboard accessible', async ({ page }) => {
  await openGame(page);
  await page.getByRole('button', { name: '体验设置', exact: true }).click();
  await page.getByRole('button', { name: /轻量/ }).click();
  await page.getByRole('checkbox', { name: /减弱动态/ }).check();
  await page.getByRole('slider', { name: /主音量/ }).fill('0.3');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: '开始游戏' })).toBeVisible();
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().settings)).toMatchObject({ quality: 'low', reducedMotion: true, masterVolume: 0.3 });
});

test('Shift precise movement responds immediately and clears when focus is lost', async ({ page }) => {
  await play(page);
  await page.keyboard.down('d'); await page.keyboard.down('Shift');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.vx)).toBe(180);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.focus)).toBe(true);
  await page.keyboard.up('Shift');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.vx)).toBe(300);
  await page.keyboard.down('Shift');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('paused');
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.focus)).toBe(false);
  await page.keyboard.up('Shift'); await page.keyboard.up('d');
  await page.getByRole('button', { name: '继续游戏', exact: false }).click();
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.vx)).toBe(0);
});

test('fixed arena beam warning locks its geometry and pause preserves its remaining time', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => window.__MAFUYU_DEBUG__.practice({ season: 's1', mode: 'story', cardIndex: 3 }));
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().hazards.some(h => h.kind === 'beam' && !h.active))).toBe(true);
  const before = await page.evaluate(() => {
    const s = window.__MAFUYU_DEBUG__.state(), h = s.hazards.find(h => h.kind === 'beam')!;
    return { id: h.id, angle: h.angle, width: h.width, warning: h.warning, camera: s.camera, arena: s.arena };
  });
  expect(before.arena).toMatchObject({ width: 1600, height: 900 });
  expect(before.width).toBe(42); expect(before.warning).toBeGreaterThan(0);
  await page.keyboard.down('d'); await page.waitForTimeout(200); await page.keyboard.up('d');
  await page.keyboard.press('Escape');
  const paused = await page.evaluate(id => window.__MAFUYU_DEBUG__.state().hazards.find(h => h.id === id)!, before.id);
  expect(paused.angle).toBe(before.angle);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().camera.x)).toBe(before.camera.x);
  await page.waitForTimeout(200);
  expect(await page.evaluate(id => window.__MAFUYU_DEBUG__.state().hazards.find(h => h.id === id)!.warning, before.id)).toBe(paused.warning);
  await page.getByRole('button', { name: '继续游戏', exact: false }).click();
  await expect.poll(() => page.evaluate(id => window.__MAFUYU_DEBUG__.state().hazards.some(h => h.id === id && h.active), before.id)).toBe(true);
  await page.evaluate(() => window.__MAFUYU_DEBUG__.restart());
  expect(await page.evaluate(() => ({ hazards: window.__MAFUYU_DEBUG__.state().hazards.length, arena: window.__MAFUYU_DEBUG__.state().arena }))).toEqual({ hazards: 0, arena: null });
  await expect(page.getByLabel('首领行动')).toHaveCount(0);
});

for (const season of ['s1', 's2'] as const) {
  test(`${season} requires all six cards and cleans the encounter correctly`, async ({ page }) => {
    await openGame(page);
    await page.evaluate(season => window.__MAFUYU_DEBUG__.practice({ season, mode: 'story', cardIndex: 0 }), season);
    for (let card = 1; card <= 6; card++) {
      await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().cardIndex)).toBe(card);
      await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().enemies.find(e => e.role === 'boss')?.spell?.stage)).toBe('active');
      expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().cardCount)).toBe(6);
      expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('playing');
      await page.evaluate(() => { const d = window.__MAFUYU_DEBUG__, boss = d.state().enemies.find(e => e.role === 'boss')!; d.damageEnemy(boss.id, 1e6); });
      if (card < 6) {
        await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().cardIndex)).toBe(card + 1);
        expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().hazards.length)).toBe(0);
      }
    }
    await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe(season === 's1' ? 'upgrade' : 'complete');
    expect(await page.evaluate(() => ({ shots: window.__MAFUYU_DEBUG__.state().bullets.filter(b => b.owner === 'enemy').length,
      parts: window.__MAFUYU_DEBUG__.state().enemies.filter(e => e.role === 'part').length }))).toEqual({ shots: 0, parts: 0 });
    if (season === 's1') {
      await page.keyboard.press('1');
      await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().wave)).toBe(4);
    } else {
      await page.getByRole('button', { name: /继续.*无尽/ }).click();
      await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().mode)).toBe('endless');
    }
    expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().arena)).toBeNull();
  });
}

test('difficulty persists, cannot change during a run, and keeps separate high scores through endless', async ({ page }) => {
  await openGame(page);
  await page.getByRole('button', { name: '困难', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '困难', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '开始游戏' }).click();
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().difficulty)).toBe('hard');
  await page.evaluate(() => { const d = window.__MAFUYU_DEBUG__; d.state().score = 4242; d.difficulty('normal'); });
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().difficulty)).toBe('hard');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '结束本局，返回主菜单' }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mafuyu-sekai:profile:v3')!).bestScores.v6.hard.story)).toBe(4242);
  expect(await page.evaluate(() => localStorage.getItem('mafuyu-sekai:best:v3'))).toBeNull();
  await page.evaluate(() => window.__MAFUYU_DEBUG__.scenario('complete'));
  await page.getByRole('button', { name: /继续.*无尽|无尽.*继续|进入无尽/ }).click();
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().difficulty)).toBe('hard');
  await page.evaluate(() => window.__MAFUYU_DEBUG__.restart());
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().difficulty)).toBe('hard');
});

test('hard cards use their own HP and beam warning instead of old boss phase values', async ({ page }) => {
  await openGame(page);
  await page.getByRole('button', { name: '困难', exact: true }).click();
  await page.evaluate(() => window.__MAFUYU_DEBUG__.practice({ season: 's1', cardIndex: 3 }));
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().hazards.some(h => h.kind === 'beam'))).toBe(true);
  const values = await page.evaluate(() => {
    const s = window.__MAFUYU_DEBUG__.state(), boss = s.enemies.find(e => e.role === 'boss')!;
    const h = s.hazards.find(h => h.kind === 'beam')!;
    return { hp: boss.maxHp, width: h.width, duration: h.warningDuration, remaining: h.warning, difficulty: s.difficulty };
  });
  expect(values).toMatchObject({ hp: 2025, width: 52, duration: 0.8, difficulty: 'hard' });
  expect(values.remaining).toBeGreaterThan(0); expect(values.remaining).toBeLessThanOrEqual(0.8);
});

test('ECHO freezes progression while limited reinforcements and locked lasers continue', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openGame(page);
  await page.getByRole('button', { name: '困难', exact: true }).click();
  await page.evaluate(() => window.__MAFUYU_DEBUG__.scenario('miniboss-arrival'));
  await defeatGateElite(page);
  await expect(page.getByRole('progressbar', { name: '迷你首领生命' })).toBeVisible();
  const before = await page.evaluate(() => {
    const s = window.__MAFUYU_DEBUG__.state(); const e = s.enemies.find(e => e.type === 'miniboss')!;
    return { waveTime: s.waveTime, maxHp: e.maxHp, bossStage: s.bossStage };
  });
  expect(before).toMatchObject({ maxHp: 2160, bossStage: false });
  await expect(page.getByLabel('迷你首领行动')).toContainText('激光锁定');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().enemies.filter(e => e.type !== 'miniboss').length)).toBeGreaterThan(1);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().waveTime)).toBe(before.waveTime);
  await page.evaluate(() => window.__MAFUYU_DEBUG__.restart());
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().minibossSpawned)).toBe(false);
  await expect(page.getByRole('progressbar', { name: '迷你首领生命' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const difficulty of ['普通', '困难']) {
  test(`${difficulty} holds the first encounter until ECHO is defeated, then advances exactly once`, async ({ page }) => {
    await openGame(page);
    await page.getByRole('button', { name: difficulty, exact: true }).click();
    await page.evaluate(() => {
      const d = window.__MAFUYU_DEBUG__; d.scenario('miniboss');
      d.advanceStage();
    });
    await defeatGateElite(page);
    await expect(page.getByText(/击败首领后继续/)).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().enemies.some(enemy => enemy.type === 'miniboss'))).toBe(true);
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => ({ wave: window.__MAFUYU_DEBUG__.state().wave, time: window.__MAFUYU_DEBUG__.state().waveTime }))).toEqual({ wave: 1, time: 90 });
    await page.evaluate(() => {
      const s = window.__MAFUYU_DEBUG__.state(), e = s.enemies.find(e => e.type === 'miniboss')!;
      e.x = e.prevX = s.player.x + 300; e.y = e.prevY = s.player.y;
      e.hp = 1; e.state = 'recover'; e.timer = 20;
      s.player.perfectWindow = 0.8;
    });
    const bounds = (await page.locator('#game-host').boundingBox())!;
    await page.mouse.click(bounds.x + bounds.width * 0.8, bounds.y + bounds.height / 2);
    await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().wave)).toBe(2);
    await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('upgrade');
    while (await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase === 'upgrade')) await page.keyboard.press('1');
    await expect(page.getByText(/击败首领后继续/)).toHaveCount(0);
    expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().minibossDefeated)).toBe(true);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().wave)).toBe(2);
  });
  test(`${difficulty} flower card emits counter-rotating rings and restart removes every projectile`, async ({ page }) => {
    await openGame(page);
    await page.getByRole('button', { name: difficulty, exact: true }).click();
    await page.evaluate(() => window.__MAFUYU_DEBUG__.practice({ season: 's1', cardIndex: 2 }));
    await expect.poll(() => page.evaluate(() => {
      const shots = window.__MAFUYU_DEBUG__.state().bullets.filter(b => b.owner === 'enemy');
      return shots.some(b => (b.turnRate ?? 0) > 0) && shots.some(b => (b.turnRate ?? 0) < 0);
    })).toBe(true);
    const shots = await page.evaluate(() => window.__MAFUYU_DEBUG__.state().bullets.filter(b => b.owner === 'enemy'));
    expect(shots.length).toBeGreaterThan(40);
    expect(shots.some(b => (b.motionAge ?? 0) > 0.6)).toBe(true);
    await page.evaluate(() => window.__MAFUYU_DEBUG__.restart());
    expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().bullets.length)).toBe(0);
  });
}

test('support craft fight while overheated, beam fires through the heat lock, restart clears both', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => {
    window.__MAFUYU_DEBUG__.scenario('arsenal');
    const state = window.__MAFUYU_DEBUG__.state();
    state.player.level = 1;
    state.player.overheated = true; state.player.heat = 100; state.player.heatLock = 30;
    for (const enemy of state.enemies) { enemy.hp = 1e6; enemy.speed = 0; enemy.cooldown = 30; }
  });
  await expect(page.getByLabel('子机支援')).toContainText('3 / 3');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().bullets.some(bullet => bullet.kind === 'drone'))).toBe(true);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.overheated)).toBe(true);
  const bounds = (await page.locator('#game-host').boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.85, bounds.y + bounds.height / 2);
  await page.keyboard.press('r');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.perfectWindow)).toBeGreaterThan(0);
  await page.mouse.down();
  await page.waitForFunction(() => {
    if (!window.__MAFUYU_DEBUG__.state().beams.length) return false;
    window.__MAFUYU_DEBUG__.pause();
    return true;
  });
  await page.mouse.up();
  const frozen = await page.evaluate(() => {
    const state = window.__MAFUYU_DEBUG__.state();
    return { tick: state.tick, beams: state.beams.length, length: state.beams[0].length, width: state.beams[0].width, overheated: state.player.overheated };
  });
  expect(frozen).toMatchObject({ beams: 1, length: 2400, width: 88, overheated: true });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().tick)).toBe(frozen.tick);
  await page.evaluate(() => window.__MAFUYU_DEBUG__.restart());
  await expect(page.getByLabel('子机支援')).toContainText('0 / 3');
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().beams.length)).toBe(0);
});

for (const [width, height] of [[1280, 720], [1920, 1080], [2560, 1440], [2560, 1080]]) {
  test(`layout is usable at ${width}×${height} and maintains a 16:9 arena`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await openGame(page);
    const shell = (await page.locator('#game-host').boundingBox())!;
    expect(shell.width / shell.height).toBeCloseTo(16 / 9, 2);
    const start = (await page.getByRole('button', { name: '开始游戏' }).boundingBox())!;
    expect(start.y).toBeGreaterThanOrEqual(0); expect(start.y + start.height).toBeLessThanOrEqual(height);
    await page.screenshot({ path: testInfo.outputPath('menu.png') });
    await page.getByRole('button', { name: '开始游戏' }).click();
    await expect(page.getByRole('button', { name: '暂停游戏' })).toBeVisible();
    const arena = (await page.locator('#game-host').boundingBox())!;
    const top = (await page.locator('.battle-top').boundingBox())!, bottom = (await page.locator('.battle-bottom').boundingBox())!;
    expect(arena.width / arena.height).toBeCloseTo(16 / 9, 2);
    expect(top.y + top.height).toBeLessThanOrEqual(arena.y + 1);
    expect(bottom.y).toBeGreaterThanOrEqual(arena.y + arena.height - 1);
    await page.evaluate(() => window.__MAFUYU_DEBUG__.practice({ season: 's2', cardIndex: 0 }));
    await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().enemies.find(e => e.role === 'boss')?.spell?.cues.length ?? 0)).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath('battle.png') });
    await page.evaluate(() => { window.__MAFUYU_DEBUG__.settings({ quality: 'low', reducedMotion: true }); window.__MAFUYU_DEBUG__.practice({ season: 's1', cardIndex: 3 }); });
    await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.state().hazards.some(h => h.kind === 'beam' && !h.active))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('low-beam-warning.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  });
}

test('WebGL loss enters a recoverable error state rather than spinning the loop', async ({ page }) => {
  await play(page);
  await page.locator('#game-host canvas').dispatchEvent('webglcontextlost');
  await expect.poll(() => page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase)).toBe('error');
  expect(await page.evaluate(() => window.__MAFUYU_DEBUG__.lifecycle().rafActive)).toBe(false);
  await page.getByRole('button', { name: /重新连接/ }).click();
  await expect(page.getByRole('button', { name: '开始游戏' })).toBeVisible();
  await expect(page.locator('#game-host canvas')).toHaveCount(1);
});

test('missing image offers a working retry without duplicate resources', async ({ page }) => {
  await page.route('**/assets/images/player.png', route => route.fulfill({ status: 404, body: 'missing' }));
  await page.goto('/?debug=1');
  await expect(page.getByRole('button', { name: /重新连接/ })).toBeVisible();
  await page.unroute('**/assets/images/player.png');
  await page.getByRole('button', { name: /重新连接/ }).click();
  await expect(page.getByRole('button', { name: '开始游戏' })).toBeVisible();
  await expect(page.locator('#game-host canvas')).toHaveCount(1);
});

test('legacy entry redirects to the single app and preserves the query and hash', async ({ page }) => {
  await page.goto('/dx.html?debug=1#legacy');
  await expect(page).toHaveURL(/\/\?debug=1#legacy$/);
  await expect(page.getByRole('button', { name: '开始游戏' })).toBeVisible();
  await expect(page.locator('#game-host canvas')).toHaveCount(1);
});
