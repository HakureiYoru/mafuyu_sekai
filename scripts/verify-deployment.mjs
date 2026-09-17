import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const url = process.env.MAFUYU_DEPLOYMENT_URL ?? 'https://mafuyu-sekai.vercel.app';
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const proxy = process.env.MAFUYU_BROWSER_PROXY;
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: process.platform === 'win32' ? ['--use-angle=d3d11'] : [],
  ...(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { version, sha, url, checkedAt: new Date().toISOString(), fixture: 'Isolated browser profile. Only approach timers are accelerated by debug.advanceStage; all five mandatory bosses and twelve cards are defeated through the real damage/completion path. Upgrade choices use DOM keys. This verifies deployment and persistence, not human difficulty.', errors: [], encounters: [], choices: [] };
page.on('pageerror', error => report.errors.push(error.message));
async function choosePending() {
  for (let i = 0; i < 14; i++) {
    const choice = await page.evaluate(() => {
      const d = window.__MAFUYU_DEBUG__, b = d.state().build;
      return { phase: d.snapshot().phase, offer: b.offerId, choices: b.choices };
    });
    if (choice.phase !== 'upgrade') return;
    report.choices.push(choice);
    await page.keyboard.press('1');
    await page.waitForFunction(previous => {
      const d = window.__MAFUYU_DEBUG__; return d.snapshot().phase !== 'upgrade' || d.state().build.offerId !== previous;
    }, choice.offer);
  }
  throw new Error('Upgrade queue did not drain.');
}
try {
  const response = await page.goto(url + '/?debug=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  assert.equal(response.status(), 200);
  const entry = await page.locator('script[type="module"][src]').getAttribute('src');
  const asset = await page.request.get(new URL(entry, url).href);
  assert.equal(asset.status(), 200);
  const localHtml = await readFile('dist/index.html', 'utf8');
  const localEntry = localHtml.match(/src="\.\/([^" ]+\.js)"/)?.[1];
  assert.ok(localEntry, 'A local production build is required for artifact verification.');
  const digest = content => createHash('sha256').update(content).digest('hex');
  report.artifact = { entry, deployedSha256: digest(await asset.body()), localEntry, localSha256: digest(await readFile(`dist/${localEntry}`)) };
  assert.equal(report.artifact.deployedSha256, report.artifact.localSha256, 'The live game entry does not match the tested local production artifact.');
  await page.getByRole('button', { name: 'v' + version + ' · 更新日志', exact: true }).waitFor({ timeout: 45000 });
  assert.equal(await page.getByRole('button', { name: /第二季/ }).count(), 0);
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  const fresh = await page.evaluate(() => {
    const s = window.__MAFUYU_DEBUG__.state(); s.player.invincible = 3600;
    return { level: s.player.level, xp: s.player.xp, companions: s.companions.length, modules: s.build.modules.length };
  });
  assert.deepEqual(fresh, { level: 1, xp: 0, companions: 0, modules: 0 });
  const encounters = ['s1:echo', 's2:palisade', 's1:mafuyu', 's2:reprise', 's2:final'];
  for (const [index, id] of encounters.entries()) {
    await choosePending();
    await page.evaluate(() => window.__MAFUYU_DEBUG__.advanceStage());
    await page.waitForFunction(id => window.__MAFUYU_DEBUG__.state().enemies.some(e => e.encounterId === id && ['boss', 'miniboss'].includes(e.role)), id);
    const encounter = { id, cards: [] };
    const cards = id === 's1:mafuyu' || id === 's2:final' ? 6 : 1;
    for (let card = 0; card < cards; card++) {
      if (cards === 6) await page.waitForFunction(({ id, card }) => {
        const e = window.__MAFUYU_DEBUG__.state().enemies.find(e => e.encounterId === id && e.role === 'boss');
        return e?.spell?.cardIndex === card && e.spell.stage === 'active';
      }, { id, card });
      encounter.cards.push(await page.evaluate(id => {
        const d = window.__MAFUYU_DEBUG__, e = d.state().enemies.find(e => e.encounterId === id && ['boss', 'miniboss'].includes(e.role));
        const result = { hp: e.hp, card: e.spell?.cardIndex ?? null, name: d.snapshot().cardName };
        d.damageEnemy(e.id, e.hp); return result;
      }, id));
    }
    report.encounters.push(encounter);
    if (index < 4) {
      await page.waitForFunction(index => {
        const d = window.__MAFUYU_DEBUG__; return d.state().campaign.stage > index + 1 && d.snapshot().phase === 'upgrade';
      }, index);
      assert.equal(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase), 'upgrade');
      assert.equal(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().arena), null);
      await choosePending();
    }
  }
  await page.waitForFunction(() => window.__MAFUYU_DEBUG__.snapshot().phase === 'complete');
  report.saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mafuyu-sekai:profile:v2')));
  assert.equal(report.saved.version, 2);
  assert.equal(Object.keys(report.saved.clears).length, 1);
  assert.equal(Object.values(report.saved.clears)[0].encounterId, 's2:final');
  assert.ok(report.saved.bestScores.v5.normal.story > 0);
  const savedText = await page.evaluate(() => localStorage.getItem('mafuyu-sekai:profile:v2'));
  await page.reload();
  await page.getByRole('button', { name: '开始游戏', exact: true }).waitFor({ timeout: 45000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('mafuyu-sekai:profile:v2')), savedText);
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  report.restarted = await page.evaluate(() => {
    const d = window.__MAFUYU_DEBUG__, s = d.state();
    return { level: s.player.level, xp: s.player.xp, companions: s.companions.length, modules: s.build.modules.length, bombs: s.player.bombs, hp: s.player.hp, canvases: document.querySelectorAll('#game-host canvas').length, raf: d.lifecycle().rafActive };
  });
  assert.deepEqual(report.restarted, { level: 1, xp: 0, companions: 0, modules: 0, bombs: 3, hp: 5, canvases: 1, raf: true });
  const origin = await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.x);
  await page.keyboard.down('KeyD');
  await page.waitForFunction(x => window.__MAFUYU_DEBUG__.state().player.x > x + 50, origin);
  await page.keyboard.up('KeyD');
  await page.keyboard.press('Escape');
  await mkdir('.tmp', { recursive: true });
  await page.screenshot({ path: '.tmp/deployed-v' + version + '.png' });
  assert.equal(report.errors.length, 0);
  report.result = 'passed';
  console.log(JSON.stringify({ version, sha, url, result: report.result, encounters: report.encounters.map(e => e.id), choices: report.choices.length, errors: report.errors }, null, 2));
} catch (error) { report.result = 'failed'; report.error = error.stack ?? error.message; throw error; }
finally {
  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/deployment-v' + version + '.json', JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
