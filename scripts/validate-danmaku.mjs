import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const url = 'http://127.0.0.1:5185', output = `docs/validation/v${version}`;
const report = { version, measuredAt: new Date().toISOString(), scenario: 'Production preview; 1080p medium; normal and hard phase-three patterns, 5 seconds each. Skill/phase seeded, invincible stationary player; no extra simulation steps. Frame intervals include encounter startup and are not an input-latency measurement.', errors: [], patterns: [], gates: [] };
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5185', '--strictPort'], { windowsHide: true, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error('Build first and free port 5185.');
    try { if ((await fetch(url)).ok) break; } catch { /* Startup. */ }
    await delay(100);
  }
  browser = await chromium.launch({ headless: true, channel: 'chromium', args: process.platform === 'win32' ? ['--use-angle=d3d11'] : [] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => report.errors.push(e.message));
  for (const difficulty of ['normal', 'hard']) {
    await page.goto(`${url}/?debug=1`);
    await page.getByRole('button', { name: '开始游戏' }).waitFor();
    await page.evaluate(difficulty => window.__MAFUYU_DEBUG__.difficulty(difficulty), difficulty);
    await page.locator('[aria-label="性能信息"]').evaluate(e => { e.style.visibility = 'hidden'; });
    for (const skill of ['volley', 'nova', 'bombard']) {
      await page.evaluate(skill => {
        const d = window.__MAFUYU_DEBUG__; d.scenario('boss');
        const b = d.state().enemies.find(e => e.type === 'boss');
        b.boss.phase = 3; b.hp = b.maxHp * 0.28; b.timer = 0; b.laserCooldown = 999;
        b.boss.cycle = skill === 'volley' ? 1 : skill === 'nova' ? 5 : 3;
      }, skill);
      const result = await page.evaluate(async () => {
        const frames = [], shapes = new Set(), sectors = new Set();
        let peak = 0, visiblePeak = 0, curved = false, finite = true;
        const started = window.__MAFUYU_DEBUG__.state().elapsed;
        await new Promise(resolve => {
          let first, previous;
          const sample = now => {
            first ??= now;
            if (previous !== undefined) frames.push(now - previous);
            previous = now;
            const s = window.__MAFUYU_DEBUG__.state(), b = s.enemies.find(e => e.type === 'boss');
            const shots = s.bullets.filter(b => b.owner === 'enemy');
            peak = Math.max(peak, shots.length);
            visiblePeak = Math.max(visiblePeak, shots.filter(b => Math.abs(b.x - s.camera.x) < 800 && Math.abs(b.y - s.camera.y) < 450).length);
            for (const shot of shots) {
              shapes.add(shot.shape);
              curved ||= shot.turnRate !== 0 && shot.motionAge > shot.turnDelay;
              finite &&= [shot.x, shot.y, shot.speed, shot.vx, shot.vy].every(Number.isFinite);
              if (b) sectors.add(Math.floor((Math.atan2(shot.y - b.y, shot.x - b.x) + Math.PI) / (Math.PI / 4)) % 8);
            }
            if (now - first < 5000) window.requestAnimationFrame(sample); else resolve();
          };
          window.requestAnimationFrame(sample);
        });
        const s = window.__MAFUYU_DEBUG__.state(), sorted = frames.toSorted((a, b) => a - b);
        const percentile = p => sorted[Math.floor((sorted.length - 1) * p)];
        return { difficulty: s.difficulty, simulated: s.elapsed - started, peak, visiblePeak, shapes: [...shapes], sectors: [...sectors], curved, finite,
          frameMs: { p95: percentile(0.95), p99: percentile(0.99), max: sorted.at(-1) }, stats: window.__MAFUYU_DEBUG__.snapshot().stats };
      });
      assert(result.peak > 120); assert(result.visiblePeak > 30); assert(result.finite);
      assert(result.shapes.length >= 2); assert(result.simulated > 4.8);
      if (skill !== 'bombard') assert(result.curved);
      if (skill !== 'volley') assert(result.sectors.length >= 7);
      report.patterns.push({ skill, ...result });
      await page.screenshot({ path: `${output}-${difficulty}-${skill}-curtain.png` });
    }
    await page.evaluate(() => {
      const d = window.__MAFUYU_DEBUG__; d.scenario('miniboss'); d.state().waveTime = 40;
    });
    await page.getByText('击败 ECHO 后进入第四波', { exact: true }).waitFor();
    await page.waitForTimeout(500);
    report.gates.push(await page.evaluate(() => { const s = window.__MAFUYU_DEBUG__.state(); return { difficulty: s.difficulty, wave: s.wave, waveTime: s.waveTime, hp: s.enemies.find(e => e.type === 'miniboss').maxHp, blocked: window.__MAFUYU_DEBUG__.snapshot().waveBlocked }; }));
    await page.screenshot({ path: `${output}-${difficulty}-wave-gate.png` });
  }
  assert(report.gates.every(g => g.blocked && g.wave === 3 && g.waveTime === 40));
  assert.equal(report.errors.length, 0);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(`docs/validation/danmaku-v${version}.json`, JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); server.kill();
}
