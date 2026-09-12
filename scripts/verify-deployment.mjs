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
  await mkdir('.tmp', { recursive: true });
  await page.screenshot({ path: `.tmp/deployed-v${version}.png` });
  assert.equal(report.errors.length, 0); report.result = 'passed';
  console.log(JSON.stringify({ version, sha, url, result: report.result, entry: report.entry, errors: report.errors }, null, 2));
} catch (error) { report.result = 'failed'; report.error = error.stack ?? error.message; throw error; }
finally { await mkdir('.tmp', { recursive: true }); await writeFile(`.tmp/deployment-v${version}.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
