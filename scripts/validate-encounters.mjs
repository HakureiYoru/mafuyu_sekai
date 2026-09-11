import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const output = `docs/validation/v${version}`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5184', '--strictPort'], { windowsHide: true, stdio: 'ignore' });
const report = { version, measuredAt: new Date().toISOString(), build: 'Production preview, Chromium D3D11', caveat: 'Invincible debug encounters; phase and next skill seeded, then actual simulation clocks, collision geometry and rendering. These checks do not establish human balance.', errors: [], checks: [] };
let browser;
try {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error('Preview exited; build first and free port 5184.');
    try { if ((await fetch('http://127.0.0.1:5184')).ok) break; } catch { /* Startup. */ }
    await delay(100);
  }
  browser = await chromium.launch({ headless: true, channel: 'chromium', args: process.platform === 'win32' ? ['--use-angle=d3d11'] : [] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:5184/?debug=1');
  await page.getByRole('button', { name: '开始游戏' }).waitFor();
  await page.locator('[aria-label="性能信息"]').evaluate(element => { element.style.visibility = 'hidden'; });
  await page.getByRole('button', { name: '困难', exact: true }).click();
  await page.screenshot({ path: `${output}-hard-menu.png` });
  await page.setViewportSize({ width: 807, height: 519 });
  const start = await page.getByRole('button', { name: '开始游戏' }).boundingBox();
  assert(start && start.y >= 0 && start.y + start.height <= 519);
  await page.screenshot({ path: `${output}-small-menu.png` });
  await page.setViewportSize({ width: 1920, height: 1080 });

  for (const phase of [1, 2]) {
    await page.evaluate(phase => {
      const d = window.__MAFUYU_DEBUG__;
      d.scenario('miniboss-arrival');
      // Collect state transitions without adding a second simulation loop.
      window.__ENCOUNTER_TRACE__ = [];
      window.__ENCOUNTER_TIMER__ = window.setInterval(() => {
        const s = d.state(), e = s.enemies.find(e => e.type === 'miniboss');
        if (e && phase === 2 && e.miniboss.phase === 1) e.hp = e.maxHp * 0.4;
        const key = `${e?.state}/${e?.miniboss.phase}/${e?.miniboss.cycle}`;
        const trace = window.__ENCOUNTER_TRACE__;
        if (trace.at(-1)?.key !== key) trace.push({ key, elapsed: s.elapsed, waveTime: s.waveTime, enemies: s.enemies.length, state: e?.state, phase: e?.miniboss.phase, cycle: e?.miniboss.cycle });
      }, 16);
    }, phase);
    for (const state of ['charge', 'laserWarmup', 'laser']) {
      await page.waitForFunction(({ state, phase }) => {
        const e = window.__MAFUYU_DEBUG__.state().enemies.find(e => e.type === 'miniboss');
        return e?.state === state && e.miniboss.phase === phase;
      }, { state, phase }, { timeout: 15000 });
      await page.screenshot({ path: `${output}-echo-p${phase}-${state}.png` });
    }
    await page.waitForTimeout(12000);
    const check = await page.evaluate(() => {
      window.clearInterval(window.__ENCOUNTER_TIMER__);
      const d = window.__MAFUYU_DEBUG__, s = d.state();
      return { phase: d.snapshot().phase, difficulty: s.difficulty, waveTime: s.waveTime, bossStage: s.bossStage, ordinary: s.enemies.filter(e => e.type !== 'miniboss').length, trace: window.__ENCOUNTER_TRACE__ };
    });
    assert.equal(check.phase, 'playing'); assert.equal(check.difficulty, 'hard');
    assert.equal(check.bossStage, false); assert(check.ordinary > 3);
    assert(check.trace.some(t => t.state === 'recover' && t.phase === phase));
    if (phase === 2) {
      const firstLaser = check.trace.findIndex(t => t.state === 'laserWarmup' && t.phase === 2);
      assert(check.trace.slice(0, firstLaser).filter(t => t.state === 'charge' && t.phase === 2).length >= 2);
    }
    report.checks.push({ encounter: `ECHO phase ${phase}`, ...check });
  }

  for (const skill of ['laser', 'nova', 'bombard']) {
    await page.evaluate(skill => {
      const d = window.__MAFUYU_DEBUG__; d.scenario('boss');
      const b = d.state().enemies.find(e => e.type === 'boss');
      b.timer = 0; b.boss.cycle = 5; b.laserCooldown = skill === 'laser' ? 0 : 14;
      if (skill === 'nova') { b.boss.phase = 3; b.hp = b.maxHp * 0.28; }
    }, skill);
    await page.waitForFunction(skill => {
      const b = window.__MAFUYU_DEBUG__.state().enemies.find(e => e.type === 'boss');
      return b?.boss.skill === skill && b.state !== 'chase';
    }, skill);
    const check = await page.evaluate(() => {
      const d = window.__MAFUYU_DEBUG__, s = d.state(), b = s.enemies.find(e => e.type === 'boss');
      return { difficulty: s.difficulty, state: b.state, phase: b.boss.phase, hp: b.maxHp, warning: b.timer, hazards: s.hazards.map(h => ({ x: h.x, y: h.y, radius: h.radius, warning: h.warning, duration: h.warningDuration })) };
    });
    assert.equal(check.hp, 2430);
    if (skill === 'nova') assert.equal(check.hazards.length, 2);
    if (skill === 'bombard') assert.equal(check.hazards.length, 5);
    if (skill === 'laser') assert(check.warning <= 1.25 && check.warning > 1);
    report.checks.push({ encounter: `Boss ${skill}`, ...check });
    await page.screenshot({ path: `${output}-hard-boss-${skill}.png` });
    await page.waitForTimeout(skill === 'laser' ? 1300 : 950);
    await page.screenshot({ path: `${output}-hard-boss-${skill}-active.png` });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => {
    const d = window.__MAFUYU_DEBUG__; d.settings({ quality: 'low', reducedMotion: true }); d.scenario('miniboss');
  });
  await page.waitForFunction(() => window.__MAFUYU_DEBUG__.state().enemies.some(e => e.type === 'miniboss' && e.state === 'laserWarmup'));
  await page.screenshot({ path: `${output}-echo-low-720.png` });
  report.checks.push(await page.evaluate(() => ({ encounter: 'low quality reduced motion', settings: window.__MAFUYU_DEBUG__.snapshot().settings, mini: window.__MAFUYU_DEBUG__.state().enemies.find(e => e.type === 'miniboss')?.state })));
  assert.equal(report.errors.length, 0);
  console.log(JSON.stringify({ checks: report.checks.map(c => ({ encounter: c.encounter, ordinary: c.ordinary, hazards: c.hazards?.length, transitions: c.trace?.length })), errors: report.errors }));
} finally {
  await writeFile(`docs/validation/visual-v${version}.json`, JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); server.kill();
}
