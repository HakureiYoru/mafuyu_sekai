import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

// Capture the immutable last v2 revision; this also works after migrating the working tree.
const BASE_REVISION = 'bd37056';
const root = resolve('public');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const server = createServer(async (request, response) => {
  const path = resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
  if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  try {
    const relative = path.slice(root.length + 1).replaceAll('\\', '/');
    const bytes = ['dx.html', 'js/main.js', 'css/main.css'].includes(relative)
      ? execFileSync('git', ['show', `${BASE_REVISION}:public/${relative}`], { maxBuffer: 4 * 1024 * 1024 })
      : await readFile(path);
    response.setHeader('content-type', mime[extname(path)] ?? 'application/octet-stream'); response.end(bytes);
  }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(8765, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:8765/dx.html');
  await page.getByRole('button', { name: 'ENGAGE', exact: true }).waitFor();
  await mkdir('docs/baseline', { recursive: true });
  await page.screenshot({ path: 'docs/baseline/v2-menu.png' });
  await page.getByRole('button', { name: 'ENGAGE', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'docs/baseline/v2-battle.png' });
  const measurement = await page.evaluate(async () => {
    const samples = [], updates = [], draws = [];
    const oldUpdate = window.update, oldDraw = window.draw;
    window.update = () => { const start = performance.now(); oldUpdate(); updates.push(performance.now() - start); };
    window.draw = () => { const start = performance.now(); oldDraw(); draws.push(performance.now() - start); };
    await new Promise(resolve => {
      let previous = 0;
      const sample = time => { if (previous) samples.push(time - previous); previous = time; if (samples.length < 300) requestAnimationFrame(sample); else resolve(); };
      requestAnimationFrame(sample);
    });
    const stats = values => { const sorted = values.toSorted((a, b) => a - b); return { count: values.length, p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0, p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0, p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0 }; };
    const gl = document.createElement('canvas').getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return { frames: stats(samples), updateMs: stats(updates), drawMs: stats(draws), gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable', userAgent: navigator.userAgent };
  });
  await writeFile('docs/baseline/measurement-v2.json', JSON.stringify({ capturedAt: new Date().toISOString(), scenario: 'Opening wave, 1280×720, automated Chromium headless; indicative only, not the integrated-GPU acceptance run.', ...measurement }, null, 2) + '\n');
  console.log(JSON.stringify(measurement));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
