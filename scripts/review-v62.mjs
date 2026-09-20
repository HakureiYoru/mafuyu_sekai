import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.ARCADE_REVIEW_URL ?? 'http://127.0.0.1:5187';
const browser = await chromium.launch({ args: process.platform === 'win32' ? ['--use-angle=d3d11'] : [] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
const out = 'docs/validation/v6.2'; await mkdir(out, { recursive: true });
try {
  await page.goto(`${base}/?debug=1`); await page.getByRole('button', { name: '开始游戏', exact: true }).waitFor();
  await page.getByRole('button', { name: '排行榜', exact: true }).click(); await page.getByText('免注册休闲榜', { exact: false }).waitFor(); await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/leaderboard.png` }); await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => {
    const d = window.__MAFUYU_DEBUG__; d.settings({ quality: 'high' }); d.scenario('arsenal');
    const s = d.state(); s.enemies.length = 0; s.spawnTimer = 100; s.player.invincible = 100;
    s.beams.push({ id: 900001, x: s.player.x, y: s.player.y, angle: -.23, width: 88, length: 2400, life: 20, duration: 20 });
  });
  await page.waitForTimeout(300); await page.screenshot({ path: `${out}/energy-beam.png` });
  await page.evaluate(() => window.__MAFUYU_DEBUG__.practice({ season: 's1', cardIndex: 1 }));
  await page.waitForTimeout(3000); await page.screenshot({ path: `${out}/spell-passage.png` });
  await writeFile(`${out}/visual-check.json`, JSON.stringify({ date: new Date().toISOString(), errors }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
