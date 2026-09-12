import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const url = process.env.MAFUYU_DEPLOYMENT_URL ?? 'https://mafuyu-sekai.vercel.app';
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const proxy = process.env.MAFUYU_BROWSER_PROXY;
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: process.platform === 'win32' ? ['--use-angle=d3d11'] : [],
  ...(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { version, sha, url, checkedAt: new Date().toISOString(), fixture: 'Fresh browser profile. Stage timers accelerated with debug.advanceStage; ECHO and all six cards individually defeated through the real damage/completion path. This validates deployment, persistence and menus, not human play balance.', errors: [] };
page.on('pageerror', error => report.errors.push(error.message));
try {
  const response = await page.goto(`${url}/?debug=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  assert.equal(response.status(), 200);
  await page.getByRole('button', { name: `v${version} · 更新日志`, exact: true }).waitFor({ timeout: 45000 });
  assert.equal(await page.getByRole('button', { name: /第二季/ }).isDisabled(), true);
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await page.evaluate(() => { window.__MAFUYU_DEBUG__.state().player.invincible = 3600; });
  for (let stage = 1; stage <= 5; stage++) {
    await page.waitForFunction(stage => window.__MAFUYU_DEBUG__.state().wave === stage, stage);
    await page.evaluate(() => window.__MAFUYU_DEBUG__.advanceStage());
    if (stage === 3) {
      await page.waitForFunction(() => window.__MAFUYU_DEBUG__.state().enemies.some(e => e.type === 'miniboss'));
      await page.evaluate(() => { const debug = window.__MAFUYU_DEBUG__, mini = debug.state().enemies.find(e => e.type === 'miniboss'); debug.damageEnemy(mini.id, mini.hp); });
    }
  }
  await page.waitForFunction(() => window.__MAFUYU_DEBUG__.state().enemies.some(e => e.type === 'boss'));
  report.cards = [];
  for (let card = 0; card < 6; card++) {
    await page.waitForFunction(card => { const e = window.__MAFUYU_DEBUG__.state().enemies.find(e => e.type === 'boss'); return e?.spell?.cardIndex === card && e.spell.stage === 'active'; }, card);
    report.cards.push(await page.evaluate(() => {
      const debug = window.__MAFUYU_DEBUG__, e = debug.state().enemies.find(e => e.type === 'boss');
      const result = { name: debug.snapshot().cardName, hp: e.hp, card: e.spell.cardIndex };
      debug.damageEnemy(e.id, e.hp); return result;
    }));
  }
  await page.waitForFunction(() => window.__MAFUYU_DEBUG__.snapshot().phase === 'complete');
  report.saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mafuyu-sekai:profile:v1')));
  assert.equal(Object.keys(report.saved.clears).length, 1);
  assert.ok(report.saved.carryover);
  await page.reload(); await page.getByRole('button', { name: '开始游戏', exact: true }).waitFor({ timeout: 45000 });
  assert.equal(await page.getByRole('button', { name: /第二季/ }).isEnabled(), true);
  await page.getByRole('button', { name: /第二季/ }).click();
  await page.getByRole('button', { name: '困难', exact: true }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  report.entry = await page.evaluate(() => {
    const d = window.__MAFUYU_DEBUG__, s = d.state();
    return { season: s.seasonId, difficulty: s.difficulty, level: s.player.level, xp: s.player.xp, companions: s.companions.length, bombs: s.player.bombs, phase: d.snapshot().phase, choices: s.build.choices.length, raf: d.lifecycle().rafActive };
  });
  assert.equal(report.entry.season, 's2'); assert.equal(report.entry.difficulty, 'hard'); assert.equal(report.entry.bombs, 3);
  assert.equal(report.entry.level, report.saved.carryover.level); assert.equal(report.entry.xp, report.saved.carryover.xp);
  assert.equal(report.entry.companions, report.saved.carryover.companions); assert.equal(report.entry.choices, 3); assert.equal(report.entry.raf, false);
  await page.keyboard.press('1');
  await page.waitForFunction(() => window.__MAFUYU_DEBUG__.state().tick > 30);
  const origin = await page.evaluate(() => { const p = window.__MAFUYU_DEBUG__.state().player; return { x: p.x, y: p.y }; });
  await page.keyboard.down('KeyD');
  await page.waitForFunction(x => window.__MAFUYU_DEBUG__.state().player.x > x + 50, origin.x);
  await page.keyboard.up('KeyD');
  report.movement = await page.evaluate(origin => { const p = window.__MAFUYU_DEBUG__.state().player; return { from: origin, to: { x: p.x, y: p.y } }; }, origin);
  assert.equal(await page.locator('#game-host canvas').count(), 1);
  await page.evaluate(() => window.__MAFUYU_DEBUG__.advanceStage());
  await page.waitForFunction(() => window.__MAFUYU_DEBUG__.snapshot().phase === 'upgrade');
  await page.keyboard.press('1');
  await page.waitForFunction(() => window.__MAFUYU_DEBUG__.state().wave === 2);
  await page.evaluate(() => window.__MAFUYU_DEBUG__.advanceStage());
  await page.waitForFunction(() => window.__MAFUYU_DEBUG__.snapshot().announcement.startsWith('追赶补给'));
  report.catchup = await page.evaluate(() => {
    const d = window.__MAFUYU_DEBUG__, s = d.state(); return { level: s.player.level, companions: s.companions.length, announcement: d.snapshot().announcement };
  });
  assert.ok(report.catchup.level >= 5); assert.ok(report.catchup.companions >= 1);
  assert.match(report.catchup.announcement, /武装保底 Lv5/);
  report.controlsFixture = 'Arsenal practice after the persistence check; durable stationary targets and a heat lock isolate DOM Q/E input. Practice must not alter the campaign save.';
  const savedBeforePractice = await page.evaluate(() => localStorage.getItem('mafuyu-sekai:profile:v1'));
  await page.evaluate(() => {
    const d = window.__MAFUYU_DEBUG__; d.scenario('arsenal');
    const s = d.state();
    for (const e of s.enemies) { e.hp = e.maxHp = 10000; e.speed = 0; e.cooldown = 999; }
    s.player.heat = 100; s.player.overheated = true; s.player.heatLock = 30;
  });
  const aimTarget = async () => {
    const point = await page.evaluate(() => {
      const s = window.__MAFUYU_DEBUG__.state(), r = document.querySelector('#game-host').getBoundingClientRect();
      return { x: r.left + (2450 - s.camera.x + 800) / 1600 * r.width, y: r.top + (2000 - s.camera.y + 450) / 900 * r.height };
    });
    await page.mouse.move(point.x, point.y);
  };
  await aimTarget(); await page.mouse.down(); await page.keyboard.press('r');
  await page.waitForFunction(() => window.__MAFUYU_DEBUG__.state().player.perfectWindow > 3);
  assert.equal(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().beams.length), 0);
  await page.keyboard.press('q');
  await page.waitForFunction(() => window.__MAFUYU_DEBUG__.state().beams.length > 0);
  report.beam = await page.evaluate(() => {
    const s = window.__MAFUYU_DEBUG__.state(); return { storedSeconds: s.player.perfectWindow, beams: s.beams.length, overheated: s.player.overheated };
  });
  assert.equal(report.beam.storedSeconds, 0); assert.equal(report.beam.overheated, true);
  await page.mouse.up(); await aimTarget(); await page.keyboard.press('e');
  await page.waitForFunction(() => window.__MAFUYU_DEBUG__.state().player.commandTargetId !== null);
  report.command = await page.evaluate(() => {
    const p = window.__MAFUYU_DEBUG__.state().player; return { targetId: p.commandTargetId, seconds: p.commandTime, cooldown: p.commandCooldown };
  });
  assert.ok(report.command.seconds > 3 && report.command.cooldown > 7);
  assert.equal(await page.getByRole('meter', { name: '弹药' }).count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('mafuyu-sekai:profile:v1')), savedBeforePractice);
  await mkdir('.tmp', { recursive: true });
  await page.screenshot({ path: `.tmp/deployed-v${version}.png` });
  assert.equal(report.errors.length, 0); report.result = 'passed';
  console.log(JSON.stringify({ version, sha, url, result: report.result, entry: report.entry, errors: report.errors }, null, 2));
} catch (error) { report.result = 'failed'; report.error = error.stack ?? error.message; throw error; }
finally { await mkdir('.tmp', { recursive: true }); await writeFile(`.tmp/deployment-v${version}.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
