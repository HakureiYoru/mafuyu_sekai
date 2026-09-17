import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const source = await readFile('src/game/types.ts', 'utf8');
const union = name => [...source.match(new RegExp(`export type ${name} = ([\\s\\S]*?);`))[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
const modules = union('ModuleId'), evolutions = union('EvolutionId');
assert.equal(modules.length, 36); assert.equal(evolutions.length, 18);
const args = process.platform === 'win32' ? ['--use-angle=d3d11'] : [];
const url = 'http://127.0.0.1:5186', output = 'docs/validation';
const html = await readFile('dist/index.html', 'utf8'), entry = html.match(/src="\.\/([^" ]+\.js)"/)?.[1];
assert.ok(entry, 'Build the production artifact first.');
const scanPath = `${output}/spell-density-v${version}.json`, scanBytes = await readFile(scanPath), scan = JSON.parse(scanBytes);
assert.equal(scan.version, version); assert.equal(scan.cases.length, 24);
assert.ok(scan.selected && scan.seconds >= 45, 'Run node scripts/scan-spell-density-v6.mjs before benchmarking.');
const changedScanSources = [];
for (const [file, hash] of Object.entries(scan.sourceHashes)) if (createHash('sha256').update(await readFile(file)).digest('hex') !== hash) changedScanSources.push(file);
const report = { version, measuredAt: new Date().toISOString(),
  fixture: '1920×1080 medium quality, production WebGL, 3 seconds warmup. Hard late-wave cases sample 30 wall-clock seconds at endless wave 15 with all 36 modules and 18 evolutions; levels V and 100 test finite entity budgets under sustained firing. The independently scanned densest spellcase uses its measured difficulty/card and samples 45 seconds with Lv1, no companions or pickups, and no shooting, preventing automatic drone/special damage. Player diagnostic invincibility is enabled. DOM input and real upgrade choices are automated; no extra simulation steps or accelerated clock. Resources are sampled every 100ms.',
  limitation: 'These GPU/CPU load fixtures do not represent natural build acquisition or human difficulty. Hardware results are specific to the reported renderer, not an integrated-GPU acceptance claim.',
  densityScan: { path: scanPath, sha256: createHash('sha256').update(scanBytes).digest('hex'), measuredAt: scan.measuredAt, sourceHashes: scan.sourceHashes, changedSources: changedScanSources, selected: scan.selected },
  artifact: { entry, sha256: createHash('sha256').update(await readFile(`dist/${entry}`)).digest('hex') },
  launch: { headless: true, channel: 'chromium', args }, errors: [], cases: [] };
const caseFilter = process.env.MAFUYU_BENCHMARK_CASE;
const reportLabel = process.env.MAFUYU_BENCHMARK_LABEL ?? '';
assert.ok(/^[a-z0-9-]*$/.test(reportLabel), 'Benchmark label must be a plain filename suffix.');
const cases = [{ name: 'full-build-v-late-squads', rank: 5, difficulty: 'hard', seconds: 30 }, { name: 'full-build-100-late-squads', rank: 100, difficulty: 'hard', seconds: 30 },
  { name: `densest-spell-${scan.selected.difficulty}-${scan.selected.cardId}`, rank: 0, difficulty: scan.selected.difficulty, season: scan.selected.season, cardIndex: scan.selected.cardIndex, seconds: 45 }];
if (caseFilter) { assert.ok(cases.some(item => item.name === caseFilter), 'Unknown benchmark case.'); report.caseFilter = caseFilter; }
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5186', '--strictPort'], { windowsHide: true, stdio: 'ignore' });
let browser;
try {
  await mkdir(output, { recursive: true });
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error('Preview failed; ensure port 5186 is free.');
    try { if ((await fetch(url)).ok) break; } catch { /* Await only this owned preview process. */ }
    if (i === 99) throw Error('Preview did not become ready.');
    await delay(100);
  }
  browser = await chromium.launch({ headless: true, channel: 'chromium', args });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(url + '/?debug=1'); await page.getByRole('button', { name: '开始游戏', exact: true }).waitFor();
  for (const item of cases) {
    if (caseFilter && caseFilter !== item.name) continue;
    // Difficulty is a menu-only setting; each case gets a fresh renderer and menu selection.
    await page.reload(); await page.getByRole('button', { name: '开始游戏', exact: true }).waitFor();
    await page.evaluate(({ rank, modules, evolutions, difficulty, season, cardIndex }) => {
      const debug = window.__MAFUYU_DEBUG__;
      debug.settings({ quality: 'medium', screenShake: 0 });
      debug.difficulty(difficulty);
      debug.practice(rank ? { mode: 'endless', modules, ranks: Object.fromEntries(modules.map(id => [id, rank])), evolutions } : { mode: 'endless', season, cardIndex });
      const state = debug.state(); state.player.invincible = 3600;
      if (rank) { state.wave = 15; state.campaign.progression = 360; state.spawnTimer = 0; state.player.level = 10; state.player.xp = 0; }
      else { state.companions.length = 0; state.pickups.length = 0; state.player.level = 1; }
    }, { ...item, modules, evolutions });
    const control = async () => page.evaluate(attack => {
      const debug = window.__MAFUYU_DEBUG__, state = debug.state(), player = state.player;
      if (debug.snapshot().phase === 'upgrade') {
        window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Digit1', bubbles: true }));
        window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'Digit1', bubbles: true })); return;
      }
      if (!attack) return;
      const canvas = document.querySelector('#game-host canvas'), rect = canvas.getBoundingClientRect();
      const target = state.enemies.filter(enemy => enemy.hp > 0).sort((a, b) => Math.hypot(a.x-player.x, a.y-player.y)-Math.hypot(b.x-player.x, b.y-player.y))[0] ?? { x: player.x + 350, y: player.y };
      const event = { clientX: rect.left + (target.x - state.camera.x + 800) / 1600 * rect.width,
        clientY: rect.top + (target.y - state.camera.y + 450) / 900 * rect.height, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', bubbles: true };
      canvas.dispatchEvent(new window.PointerEvent('pointermove', event)); canvas.dispatchEvent(new window.PointerEvent('pointerdown', event));
      const clockwise = Math.floor(state.elapsed / 2) % 4, movement = ['KeyD','KeyS','KeyA','KeyW'];
      for (let i = 0; i < movement.length; i++) window.dispatchEvent(new window.KeyboardEvent(i === clockwise ? 'keydown' : 'keyup', { code: movement[i], bubbles: true }));
      window.dispatchEvent(new window.KeyboardEvent(Math.floor(state.elapsed / 3) % 2 ? 'keydown' : 'keyup', { code: 'ShiftLeft', bubbles: true }));
      if (player.dashCooldown <= 0) { window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyR', bubbles: true })); window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'KeyR', bubbles: true })); }
    }, item.rank > 0);
    let controlling = true;
    const controller = (async () => { while (controlling) { await control(); await delay(100); } })();
    let metrics;
    try {
      await delay(3000);
      metrics = await page.evaluate(async seconds => {
        const samples = [], resources = []; let first = 0, previous = 0, nextResource = 0;
        const start = window.__MAFUYU_DEBUG__.state().elapsed;
        const initialBoss = window.__MAFUYU_DEBUG__.state().enemies.find(enemy => enemy.spell);
        const initialBossHp = initialBoss?.hp ?? null;
        await new Promise(resolve => {
          const record = time => {
            first ||= time; if (previous) samples.push(time - previous); previous = time;
            if (time >= nextResource) {
              const debug = window.__MAFUYU_DEBUG__, state = debug.state();
              resources.push({ wallSeconds: (time - first) / 1000, phase: debug.snapshot().phase, ...debug.snapshot().stats,
                hostile: state.bullets.filter(bullet => bullet.owner === 'enemy').length, friendly: state.bullets.filter(bullet => bullet.owner === 'player').length,
                hazards: state.hazards.length, moduleVisuals: state.moduleVisuals?.length ?? 0, modules: state.build.modules.length,
                totalRanks: Object.values(state.build.ranks).reduce((sum, rank) => sum + rank, 0), evolutions: state.build.evolutions.length, kills: state.kills,
                reservedBullets: debug.resources().promises.bullets, reservedHazards: debug.resources().promises.hazards,
                companions: state.companions.length, bossHp: state.enemies.find(enemy => enemy.spell)?.hp ?? null });
              nextResource = time + 100;
            }
            if (time - first < seconds * 1000) window.requestAnimationFrame(record); else resolve();
          }; window.requestAnimationFrame(record);
        });
        samples.sort((a, b) => a - b); const at = p => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))];
        const canvas = document.querySelector('#game-host canvas'), gl = canvas.getContext('webgl2'), extension = gl?.getExtension('WEBGL_debug_renderer_info');
        return { simulatedSeconds: window.__MAFUYU_DEBUG__.state().elapsed - start, initialBossHp, difficulty: window.__MAFUYU_DEBUG__.state().difficulty,
          gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable', canvas: { width: canvas.width, height: canvas.height },
          samples: samples.length, frameMs: { p50: at(.5), p95: at(.95), p99: at(.99), max: samples.at(-1) }, resources };
      }, item.seconds);
    } finally { controlling = false; await controller; }
    report.cases.push({ ...item, ...metrics });
    await page.screenshot({ path: `${output}/v${version}-${item.name}${reportLabel ? `-${reportLabel}` : ''}.png`, style: '[aria-label="性能信息"]{visibility:hidden!important;}' });
    console.log(JSON.stringify({ case: item.name, gpu: metrics.gpu, frameMs: metrics.frameMs, simulatedSeconds: metrics.simulatedSeconds,
      maxEnemies: Math.max(...metrics.resources.map(r => r.enemies)), maxHostile: Math.max(...metrics.resources.map(r => r.hostile)), maxFriendly: Math.max(...metrics.resources.map(r => r.friendly)), maxModuleVisuals: Math.max(...metrics.resources.map(r => r.moduleVisuals)) }));
    assert.ok(metrics.simulatedSeconds >= item.seconds - 4, 'Combat froze or accumulated excessive catch-up loss.');
    assert.equal(metrics.difficulty, item.difficulty);
    assert.ok(metrics.resources.every(r => ['playing', 'upgrade'].includes(r.phase) && r.hostile <= 3072 && r.friendly <= 1536 && r.hazards <= 48 && r.moduleVisuals <= 192 && r.textures <= 64));
    if (item.rank) assert.ok(metrics.resources.every(r => r.modules === 36 && r.evolutions === 18 && r.totalRanks >= 36 * item.rank));
    else assert.ok(metrics.resources.every(r => r.friendly === 0 && r.companions === 0 && r.bossHp === metrics.initialBossHp), 'The diagnostic spell must receive no player damage.');
  }
  assert.equal(report.errors.length, 0); report.result = 'passed';
} catch (error) { report.result = 'failed'; report.error = error.stack ?? error.message; throw error; }
finally { await writeFile(`${output}/performance-builds-v${version}${reportLabel ? `-${reportLabel}` : ''}.json`, JSON.stringify(report, null, 2) + '\n'); await browser?.close(); server.kill(); }
