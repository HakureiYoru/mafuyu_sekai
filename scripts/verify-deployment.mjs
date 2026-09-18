import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const url = process.env.MAFUYU_DEPLOYMENT_URL ?? 'https://mafuyu-sekai.vercel.app';
const touch = process.env.MAFUYU_DEPLOYMENT_TOUCH === '1';
const legacyAudio = process.env.MAFUYU_DEPLOYMENT_LEGACY_AUDIO === '1';
const suffix = touch ? '-touch' : '';
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const proxy = process.env.MAFUYU_BROWSER_PROXY;
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: process.platform === 'win32' ? ['--use-angle=d3d11'] : [],
  ...(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {}) });
const page = await browser.newPage(touch ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 } });
const report = { version, sha, url, checkedAt: new Date().toISOString(), fixture: 'Isolated browser profile. Only approach timers are accelerated by debug.advanceStage; all five gate elites, five mandatory bosses and twelve cards are defeated through the real damage/completion path. Upgrade choices use DOM keys. This verifies deployment and persistence, not human difficulty.', errors: [], elites: [], encounters: [], choices: [] };
page.on('pageerror', error => report.errors.push(error.message));
report.controlMode = touch ? 'touch' : 'keyboardMouse';
if (legacyAudio) await page.addInitScript(() => {
  Object.defineProperty(window.AudioParam.prototype, 'cancelAndHoldAtTime', { configurable: true, value: undefined });
  window.__MAFUYU_AUDIO_DUCKS__ = 0;
  const ramp = window.AudioParam.prototype.linearRampToValueAtTime;
  window.AudioParam.prototype.linearRampToValueAtTime = function (value, time) {
    if (Math.abs(value - 10 ** (-4 / 20)) < 1e-6) window.__MAFUYU_AUDIO_DUCKS__++;
    return ramp.call(this, value, time);
  };
});
if (touch) report.fixture = report.fixture.replace('DOM keys', 'DOM touch taps');
async function activate(locator) { if (touch) await locator.tap(); else await locator.click(); }
async function choosePending() {
  for (let i = 0; i < 64; i++) {
    const choice = await page.evaluate(() => {
      const d = window.__MAFUYU_DEBUG__, b = d.state().build;
      return { phase: d.snapshot().phase, offer: b.offerId, choices: b.choices };
    });
    if (choice.phase !== 'upgrade') return;
    report.choices.push(choice);
    if (touch) await page.locator('.upgrade-card').first().tap(); else await page.keyboard.press('1');
    await page.waitForFunction(previous => {
      const d = window.__MAFUYU_DEBUG__; return d.snapshot().phase !== 'upgrade' || d.state().build.offerId !== previous;
    }, choice.offer);
  }
  throw new Error('Upgrade queue did not drain.');
}
async function defeatGateElite() {
  await page.waitForFunction(() => window.__MAFUYU_DEBUG__.state().enemies.some(enemy => enemy.role === 'elite' && enemy.hp > 0));
  const result = await page.evaluate(() => {
    const debug = window.__MAFUYU_DEBUG__, state = debug.state(), elite = state.enemies.find(enemy => enemy.role === 'elite' && enemy.hp > 0);
    const result = { id: elite.encounterId, name: debug.snapshot().eliteName, hp: elite.maxHp,
      progression: state.campaign.progression, gate: state.campaign.eliteGate, previouslyDefeated: state.campaign.defeatedElites.length };
    debug.damageEnemy(elite.id, 1e8); return result;
  });
  assert.equal(result.gate, true, 'Advancing the timer must still leave the mandatory elite gate closed.');
  await page.waitForFunction(() => window.__MAFUYU_DEBUG__.snapshot().phase === 'upgrade');
  const defeated = await page.evaluate(() => window.__MAFUYU_DEBUG__.state().campaign.defeatedElites);
  assert.ok(defeated.includes(result.id)); assert.equal(defeated.length, result.previouslyDefeated + 1);
  report.elites.push(result); await choosePending();
}
try {
  const response = await page.goto(url + '/?debug=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  assert.equal(response.status(), 200);
  const entry = await page.locator('script[type="module"][src]').getAttribute('src');
  // Use the browser's network configuration, which may differ from Node's proxy/DNS.
  const deployedSha256 = await page.evaluate(async entryUrl => {
    const asset = await fetch(entryUrl, { cache: 'no-store' });
    if (!asset.ok) throw new Error(`Entry request failed: ${asset.status}`);
    const hash = await window.crypto.subtle.digest('SHA-256', await asset.arrayBuffer());
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }, new URL(entry, url).href);
  const localHtml = await readFile('dist/index.html', 'utf8');
  const localEntry = localHtml.match(/src="\.\/([^" ]+\.js)"/)?.[1];
  assert.ok(localEntry, 'A local production build is required for artifact verification.');
  const digest = content => createHash('sha256').update(content).digest('hex');
  report.artifact = { entry, deployedSha256, localEntry, localSha256: digest(await readFile(`dist/${localEntry}`)) };
  assert.equal(report.artifact.deployedSha256, report.artifact.localSha256, 'The live game entry does not match the tested local production artifact.');
  await page.getByRole('button', { name: 'v' + version + ' · 更新日志', exact: true }).waitFor({ timeout: 45000 });
  assert.equal(await page.getByRole('button', { name: /第二季/ }).count(), 0);
  await activate(page.getByRole('button', { name: '开始游戏', exact: true }));
  assert.equal(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().controlMode), report.controlMode);
  const fresh = await page.evaluate(() => {
    const s = window.__MAFUYU_DEBUG__.state(); s.player.invincible = 3600;
    return { level: s.player.level, xp: s.player.xp, companions: s.companions.length, modules: s.build.modules.length };
  });
  assert.deepEqual(fresh, { level: 1, xp: 0, companions: 0, modules: 0 });
  if (touch && legacyAudio) {
    await page.locator('[data-touch-control="fire"]').tap();
    assert.equal(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().touch.autoFireEnabled), false);
    await page.locator('[data-touch-control="fire"]').tap();
    assert.equal(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().touch.autoFireEnabled), true);
  }
  // Verify the deployed decorative assets and the actual two-character exchange.
  const commsManifest = JSON.parse(await readFile('public/assets/comms/manifest.json', 'utf8'));
  report.commsAssets = await page.evaluate(async assets => Promise.all(assets.map(async asset => {
    const response = await fetch(`/assets/comms/${asset.file}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Communication sprite request failed: ${asset.file}`);
    const data = await response.arrayBuffer();
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return { file: asset.file, bytes: data.byteLength, sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') };
  })), commsManifest.assets);
  for (const asset of report.commsAssets) {
    const expected = commsManifest.assets.find(item => item.file === asset.file);
    assert.equal(asset.sha256, expected.sha256); assert.equal(asset.bytes, expected.bytes);
  }
  await page.waitForFunction(() => {
    const d = window.__MAFUYU_DEBUG__, s = d.snapshot();
    return s.comms?.speaker === 'MAFUYU' && s.comms.text === s.comms.fullText && s.commsPrevious?.speaker === 'EMU';
  });
  await page.locator('.comms-sprite').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  report.comms = await page.evaluate(() => {
    const s = window.__MAFUYU_DEBUG__.snapshot();
    return { layout: document.querySelector('[data-testid="comms-root"]')?.getAttribute('data-layout'),
      current: s.comms, previous: s.commsPrevious,
      images: [...document.querySelectorAll('.comms-sprite')].map(image => ({ src: image.getAttribute('src'), width: image.naturalWidth, fallback: image.getAttribute('data-fallback') })) };
  });
  assert.equal(report.comms.layout, touch ? 'compact' : 'sides');
  assert.equal(report.comms.images.length, 2);
  assert.ok(report.comms.images.every(image => touch ? image.width > 0 && image.fallback === 'true' : image.width === 512 && image.fallback === 'false'));
  await mkdir('.tmp', { recursive: true });
  await page.screenshot({ path: `.tmp/deployment-comms-v${version}${suffix}.png`, style: '[aria-label="性能信息"] { visibility: hidden !important; }' });
  const encounters = ['s1:echo', 's2:palisade', 's1:mafuyu', 's2:reprise', 's2:final'];
  for (const [index, id] of encounters.entries()) {
    await choosePending();
    await page.evaluate(() => window.__MAFUYU_DEBUG__.advanceStage());
    await defeatGateElite();
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
  report.saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mafuyu-sekai:profile:v3')));
  assert.equal(report.saved.version, 3);
  assert.equal(report.elites.length, 5);
  assert.equal(Object.keys(report.saved.clears).length, 1);
  assert.equal(Object.values(report.saved.clears)[0].encounterId, 's2:final');
  assert.equal(Object.values(report.saved.clears)[0].ruleset, 'v6');
  assert.ok(report.saved.bestScores.v6.normal.story > 0);
  report.build = await page.evaluate(() => {
    const s = window.__MAFUYU_DEBUG__.snapshot();
    return { modules: s.modules.length, layers: Object.values(s.moduleRanks).reduce((sum, rank) => sum + rank, 0), evolutions: s.evolutions.length };
  });
  const savedText = await page.evaluate(() => localStorage.getItem('mafuyu-sekai:profile:v3'));
  // Reload creates a new window and resets the injected probe; retain the completed run's evidence.
  const duckRampsBeforeReload = legacyAudio ? await page.evaluate(() => window.__MAFUYU_AUDIO_DUCKS__) : 0;
  await page.reload();
  await page.getByRole('button', { name: '开始游戏', exact: true }).waitFor({ timeout: 45000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('mafuyu-sekai:profile:v3')), savedText);
  await activate(page.getByRole('button', { name: '开始游戏', exact: true }));
  report.restarted = await page.evaluate(() => {
    const d = window.__MAFUYU_DEBUG__, s = d.state();
    return { level: s.player.level, xp: s.player.xp, companions: s.companions.length, modules: s.build.modules.length, bombs: s.player.bombs, hp: s.player.hp, canvases: document.querySelectorAll('#game-host canvas').length, raf: d.lifecycle().rafActive };
  });
  assert.deepEqual(report.restarted, { level: 1, xp: 0, companions: 0, modules: 0, bombs: 3, hp: 5, canvases: 1, raf: true });
  const origin = await page.evaluate(() => window.__MAFUYU_DEBUG__.state().player.x);
  if (touch) {
    const cdp = await page.context().newCDPSession(page), box = await page.locator('[data-touch-control="stick"]').boundingBox();
    const point = { id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, x: point.x + 48 }] });
    await page.waitForFunction(x => window.__MAFUYU_DEBUG__.state().player.x > x + 50, origin);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
    await page.getByRole('button', { name: '暂停游戏', exact: true }).tap();
    await page.getByRole('button', { name: '继续游戏', exact: true }).tap();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('dialog', { name: '请横屏游玩', exact: true }).waitFor();
    const tick = await page.evaluate(() => window.__MAFUYU_DEBUG__.state().tick);
    await page.setViewportSize({ width: 844, height: 390 });
    assert.equal(await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase), 'paused');
    assert.equal(await page.evaluate(() => window.__MAFUYU_DEBUG__.state().tick), tick);
    report.touchFlow = { realJoystick: true, tapRewards: true, pauseResume: true, rotationKeepsPaused: true, savedAndRefreshed: true };
  } else {
    await page.keyboard.down('KeyD');
    await page.waitForFunction(x => window.__MAFUYU_DEBUG__.state().player.x > x + 50, origin);
    await page.keyboard.up('KeyD'); await page.keyboard.press('Escape');
  }
  await page.getByRole('heading', { name: '先别喊了。', exact: true }).waitFor();
  await page.locator('[aria-label="性能信息"]').evaluate(element => { element.style.visibility = 'hidden'; });
  await mkdir('.tmp', { recursive: true });
  await page.screenshot({ path: '.tmp/deployed-v' + version + suffix + '.png', animations: 'disabled' });
  assert.equal(report.errors.length, 0);
  if (legacyAudio) {
    const reloadedProbe = await page.evaluate(() => ({
      holdAvailable: typeof window.AudioParam.prototype.cancelAndHoldAtTime === 'function',
      duckRampsAfterReload: window.__MAFUYU_AUDIO_DUCKS__,
    }));
    report.audioCompatibility = { ...reloadedProbe, duckRampsBeforeReload,
      duckRamps: duckRampsBeforeReload + reloadedProbe.duckRampsAfterReload };
    assert.equal(report.audioCompatibility.holdAvailable, false);
    assert.ok(report.audioCompatibility.duckRamps > 0, 'The real danger ducking path must run without the optional hold API.');
  }
  report.result = 'passed';
  console.log(JSON.stringify({ version, sha, url, result: report.result, encounters: report.encounters.map(e => e.id), choices: report.choices.length, errors: report.errors }, null, 2));
} catch (error) { report.result = 'failed'; report.error = error.stack ?? error.message; throw error; }
finally {
  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/deployment-v' + version + suffix + '.json', JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
