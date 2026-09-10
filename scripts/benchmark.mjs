import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const url = 'http://127.0.0.1:5182';
const output = 'docs/validation';
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5182', '--strictPort'], { windowsHide: true, stdio: 'ignore' });
let browser;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Preview failed. Build first and ensure port 5182 is free.');
    try { if ((await fetch(url)).ok) break; } catch { /* wait for our preview process */ }
    if (attempt === 99) throw new Error('Preview did not become ready. Run npm run build first.');
    await delay(100);
  }
  const args = process.platform === 'win32' ? ['--use-angle=d3d11'] : [];
  browser = await chromium.launch({ headless: true, channel: 'chromium', args });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${url}/?debug=1`);
  await page.getByRole('button', { name: '开始游戏' }).waitFor();
  await mkdir(output, { recursive: true });
  await page.locator('[aria-label="性能信息"]').evaluate(element => { element.style.visibility = 'hidden'; });
  await page.screenshot({ path: `${output}/v${version}-menu.png` });
  await page.evaluate(() => window.__MAFUYU_DEBUG__.stress());
  await page.waitForTimeout(3000);
  const report = await page.evaluate(async () => {
    const samples = [], resources = [];
    await new Promise(resolve => {
      let previous = 0, first = 0, lastResources = 0;
      const sample = now => {
        first ||= now;
        if (previous) samples.push(now - previous);
        previous = now;
        if (now - lastResources > 1000) { resources.push({ time: (now - first) / 1000, ...window.__MAFUYU_DEBUG__.snapshot().stats }); lastResources = now; }
        if (now - first < 30000) requestAnimationFrame(sample); else resolve();
      };
      requestAnimationFrame(sample);
    });
    const sorted = samples.toSorted((a, b) => a - b);
    const percentile = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const canvas = document.querySelector('#game-host canvas');
    const gl = canvas.getContext('webgl2'), debug = gl?.getExtension('WEBGL_debug_renderer_info');
    const state = window.__MAFUYU_DEBUG__.state();
    return {
      userAgent: navigator.userAgent, gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable',
      canvas: { width: canvas.width, height: canvas.height }, count: samples.length,
      averageFps: 1000 / (samples.reduce((sum, n) => sum + n, 0) / samples.length),
      frameMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: sorted.at(-1) },
      finalCounts: { enemies: state.enemies.length, mines: state.enemies.filter(e => e.type === 'mine').length, bullets: state.bullets.length, particles: window.__MAFUYU_DEBUG__.snapshot().stats.particles },
      resources,
    };
  });
  await page.screenshot({ path: `${output}/v${version}-stress.png` });
  const serialized = JSON.stringify({ version, measuredAt: new Date().toISOString(), scenario: 'Production build; 1920×1080; medium; 3s warmup + 30s sustained 180 non-mine enemies + 70 mines + 1200 bullets + 900 moving particles.', launch: { channel: 'chromium', headless: true, args }, errors, ...report }, null, 2) + '\n';
  await writeFile(`${output}/performance-v${version}.json`, serialized);
  await writeFile(`${output}/performance.json`, serialized);
  console.log(JSON.stringify({ averageFps: report.averageFps, frameMs: report.frameMs, counts: report.finalCounts, gpu: report.gpu, errors }, null, 2));
  if (errors.length || report.finalCounts.enemies !== 250 || report.finalCounts.mines !== 70 || report.finalCounts.bullets !== 1200 || report.finalCounts.particles !== 900) throw new Error('Stress scene was not sustained or a browser error occurred. Inspect docs/validation/performance.json.');
} finally { await browser?.close(); server.kill(); }
