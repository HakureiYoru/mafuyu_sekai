import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { setInterval, clearInterval } from 'node:timers';
import assert from 'node:assert/strict';

const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const url = 'http://127.0.0.1:5185', output = 'docs/validation';
const cases = [
  { name: 'mafuyu-flower', season: 's1', cardIndex: 2 },
  { name: 'lacuna-diagonals', season: 's2', cardIndex: 1 },
  { name: 'lacuna-nodes', season: 's2', cardIndex: 2 },
  { name: 'lacuna-rings', season: 's2', cardIndex: 4 },
  { name: 'lacuna-finale', season: 's2', cardIndex: 5 },
  { name: 'modules-and-carriers', season: 's2', modules: ['shatter', 'chain', 'prism', 'droneHoming', 'droneBurst', 'doubleDash', 'intercept'] },
];
const report = { version, measuredAt: new Date().toISOString(), scenario: '1920×1080 medium, production WebGL; hardest recurring cards and seven-module second-season combat. Each case has a 3s warmup then 24s of real browser RAF sampling. Practice player invincibility is enabled; this measures performance, not human difficulty.', errors: [], cases: [] };
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5185', '--strictPort'], { windowsHide: true, stdio: 'ignore' });
let browser;
try {
  await mkdir(output, { recursive: true });
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error('Build first and free port 5185.');
    try { if ((await fetch(url)).ok) break; } catch { /* Startup. */ }
    await delay(100);
  }
  browser = await chromium.launch({ headless: true, channel: 'chromium', args: process.platform === 'win32' ? ['--use-angle=d3d11'] : [] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(`${url}/?debug=1`);
  await page.getByRole('button', { name: '开始游戏' }).waitFor();
  await page.evaluate(() => window.__MAFUYU_DEBUG__.difficulty('hard'));
  for (const item of cases) {
    await page.evaluate(item => {
      window.__MAFUYU_DEBUG__.practice(item);
      const state = window.__MAFUYU_DEBUG__.state();
      if (item.modules) { state.wave = 6; state.spawnTimer = 0; state.mode = 'endless'; }
    }, item);
    let bot;
    if (item.modules) bot = setInterval(async () => {
      await page.evaluate(() => {
        const state = window.__MAFUYU_DEBUG__.state(), p = state.player, canvas = document.querySelector('canvas');
        const e = state.enemies.find(e => e.hp > 0) ?? { x: p.x + 300, y: p.y };
        const rect = canvas.getBoundingClientRect();
        const pointer = { clientX: rect.left + (e.x - state.camera.x + 800) / 1600 * rect.width, clientY: rect.top + (e.y - state.camera.y + 450) / 900 * rect.height,
          button: 0, buttons: 1, pointerType: 'mouse', pointerId: 1, bubbles: true };
        canvas.dispatchEvent(new window.PointerEvent('pointermove', pointer)); canvas.dispatchEvent(new window.PointerEvent('pointerdown', pointer));
        if (p.dashCooldown <= 0) { window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyR' })); window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'KeyR' })); }
      }).catch(e => report.errors.push(e.message));
    }, 100);
    await page.waitForTimeout(3000);
    const metrics = await page.evaluate(async () => {
      const samples = [], resources = []; let previous = 0, first = 0, lastResource = 0;
      await new Promise(resolve => {
        const sample = now => {
          first ||= now; if (previous) samples.push(now - previous); previous = now;
          if (now - lastResource >= 1000) {
            const state = window.__MAFUYU_DEBUG__.state();
            resources.push({ time: (now - first) / 1000, ...window.__MAFUYU_DEBUG__.snapshot().stats,
              beams: state.beams.length, hazards: state.hazards.length, parts: state.enemies.filter(e => e.role === 'part' || e.type === 'core').length,
              modules: state.build.modules, card: state.enemies.find(e => e.spell)?.spell?.cardIndex });
            lastResource = now;
          }
          if (now - first < 24000) requestAnimationFrame(sample); else resolve();
        }; requestAnimationFrame(sample);
      });
      samples.sort((a, b) => a - b);
      const at = fraction => samples[Math.min(samples.length - 1, Math.floor(samples.length * fraction))];
      const canvas = document.querySelector('canvas'), gl = canvas.getContext('webgl2'), ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable', canvas: { width: canvas.width, height: canvas.height },
        frameMs: { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: samples.at(-1) }, samples: samples.length, resources };
    });
    if (bot) clearInterval(bot);
    await page.screenshot({ path: `${output}/v${version}-${item.name}.png` });
    report.cases.push({ ...item, ...metrics });
    console.log(JSON.stringify({ case: item.name, frameMs: metrics.frameMs, maxBullets: Math.max(...metrics.resources.map(r => r.bullets)) }));
    assert.ok(metrics.resources.every(r => r.bullets <= 4096 && r.hazards <= 12 && r.textures <= 64));
  }
  assert.equal(report.errors.length, 0);
} finally {
  await writeFile(`${output}/danmaku-v${version}.json`, JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); server.kill();
}
