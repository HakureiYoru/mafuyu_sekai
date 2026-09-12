import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const seconds = Number(process.env.MAFUYU_SOAK_SECONDS ?? 1800);
const difficulty = process.env.MAFUYU_SOAK_DIFFICULTY ?? 'normal';
const season = process.env.MAFUYU_SOAK_SEASON ?? 's2';
if (!['s1', 's2'].includes(season)) throw new Error('MAFUYU_SOAK_SEASON must be s1 or s2.');
if (!['normal', 'hard'].includes(difficulty)) throw new Error('MAFUYU_SOAK_DIFFICULTY must be normal or hard.');
if (!Number.isFinite(seconds) || seconds < 5 || seconds > 1800) throw new Error('MAFUYU_SOAK_SECONDS must be between 5 and 1800 seconds.');
const url = 'http://127.0.0.1:5183';
const output = 'docs/validation';
const args = process.platform === 'win32' ? ['--use-angle=d3d11'] : [];
const limits = { enemies: 180, mines: 70, hazards: 12, bullets: 4096, particles: 900, textures: 64, voices: 24, pickups: 20000, usedHeapBytes: 512 * 1024 * 1024 };
const report = {
  version: JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version,
  measuredAt: new Date().toISOString(), status: 'running', requestedWallSeconds: seconds, difficulty, season,
  scenario: 'Production preview; 1920×1080; medium quality; second-season endless practice with Lv8, three support craft and seven modules; real-time combat driven by DOM keyboard/pointer input every 100 ms. No extra simulation steps or clock acceleration. Practice never grants a persistent clear.',
  caveat: 'The player is invincible for this unattended stability run. Automated aim and movement do not validate human difficulty, fairness, or the 6–10 minute story balance.',
  launch: { channel: 'chromium', headless: true, args }, limits,
  measurement: { resourceIntervalSeconds: 30, progressIntervalSeconds: 60, forcedGcIntervalSeconds: 300,
    forcedGc: 'CDP HeapProfiler.collectGarbage at baseline, every five minutes, the final sample, and on a listener-threshold recheck; pauses are included in elapsed-time checks. Use the separate benchmark for frame-performance acceptance.',
    listenerGuard: 'The limit remains baseline plus 100 listeners. A raw count above it triggers an additional GC and a fresh heap/DOM/Performance sample; only the post-GC listener count is tested. Both samples are retained as evidence.',
    pools: 'Private pool free/allocated counts are not exposed by the runtime debug API. Live pooled bullets/particles, reported texture/voice counts, and retained heap are recorded as observable proxies; pool internals are not claimed as measured.' },
  samples: [], browserErrors: [], consoleErrors: [], violations: [], recovery: null,
};
await mkdir(output, { recursive: true });
try {
  const previous = await readFile(`${output}/soak.json`, 'utf8');
  if (JSON.parse(previous).status === 'failed') {
    const archive = `${output}/soak-failed-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    await writeFile(archive, previous);
    report.previousFailureArchive = archive;
  }
} catch (error) { if (error.code !== 'ENOENT') report.previousReportWarning = error.message; }
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5183', '--strictPort'], { windowsHide: true, stdio: 'ignore' });
let browser, page, cdp, firstSample;
const persist = () => writeFile(`${output}/soak.json`, JSON.stringify(report, null, 2) + '\n');
const check = (condition, message) => { if (!condition && !report.violations.includes(message)) report.violations.push(message); };
const resource = async (method) => {
  try { return await cdp.send(method); } catch (error) { return { unavailable: error.message }; }
};

async function sample(wallSeconds, forceGc = false) {
  let gc = null;
  if (forceGc) {
    const began = performance.now();
    const result = await resource('HeapProfiler.collectGarbage');
    gc = { durationMs: performance.now() - began, ...result };
  }
  const [game, initialHeap, initialDom, initialMetrics] = await Promise.all([
    page.evaluate(() => {
      const debug = window.__MAFUYU_DEBUG__, state = debug.state(), snapshot = debug.snapshot();
      const bodies = [state.player, ...state.enemies, ...state.bullets, ...state.pickups, ...state.companions, ...state.beams, ...state.hazards];
      return { elapsed: state.elapsed, tick: state.tick, wave: state.wave, kills: state.kills, score: state.score,
        phase: snapshot.phase, status: state.status, mode: state.mode, season: state.seasonId, modules: state.build.modules, difficulty: state.difficulty, lifecycle: debug.lifecycle(),
        canvasCount: document.querySelectorAll('#game-host canvas').length,
        enemies: state.enemies.length, mines: state.enemies.filter(enemy => enemy.type === 'mine').length,
        hazards: state.hazards.length, bullets: state.bullets.length, pickups: state.pickups.length, indicators: state.indicators.length,
        companions: state.companions.length, beams: state.beams.length, droneBullets: state.bullets.filter(bullet => bullet.kind === 'drone').length,
        player: { hp: state.player.hp, level: state.player.level, ammo: state.player.ammo, heat: state.player.heat, bombs: state.player.bombs },
        stats: snapshot.stats, finite: bodies.every(body => Number.isFinite(body.x) && Number.isFinite(body.y)) && Number.isFinite(state.elapsed) && Number.isFinite(state.score),
        bot: window.__MAFUYU_SOAK__?.summary(),
      };
    }), resource('Runtime.getHeapUsage'), resource('Memory.getDOMCounters'), resource('Performance.getMetrics'),
  ]);
  let heap = initialHeap, dom = initialDom, metrics = initialMetrics, listenerRecheck = null;
  if (firstSample && typeof dom.jsEventListeners === 'number' && dom.jsEventListeners > firstSample.dom.jsEventListeners + 100) {
    const before = { heap, dom, performanceMetrics: metrics.metrics ?? metrics };
    const began = performance.now();
    const result = await resource('HeapProfiler.collectGarbage');
    const validationGc = { durationMs: performance.now() - began, ...result };
    [heap, dom, metrics] = await Promise.all([resource('Runtime.getHeapUsage'), resource('Memory.getDOMCounters'), resource('Performance.getMetrics')]);
    listenerRecheck = { limit: firstSample.dom.jsEventListeners + 100, before, gc: validationGc, after: { heap, dom, performanceMetrics: metrics.metrics ?? metrics } };
    gc = { ...validationGc, reason: 'listener-threshold-recheck', scheduledGc: gc };
    console.log(`[soak] ${wallSeconds.toFixed(1)}s listener recheck: ${before.dom.jsEventListeners} -> ${dom.jsEventListeners ?? 'unavailable'} after GC; unchanged limit ${listenerRecheck.limit}.`);
    check(!validationGc.unavailable, 'Could not collect garbage to verify the exceeded listener limit.');
    check(typeof dom.jsEventListeners === 'number', 'Post-GC DOM event listener count is unavailable.');
  }
  const row = { wallSeconds, gc, listenerRecheck, ...game, heap, dom, performanceMetrics: metrics.metrics ?? metrics };
  firstSample ??= row;
  report.samples.push(row);
  check(game.phase === 'playing' && game.status === 'playing' && game.mode === 'endless', `Unexpected game phase/status at ${wallSeconds.toFixed(1)}s: ${game.phase}/${game.status}/${game.mode}`);
  check(game.difficulty === difficulty, 'Difficulty changed during the stability run.');
  check(game.season === season, 'Season changed during the stability run.');
  check(game.lifecycle.rafActive && game.canvasCount === 1, `Expected one active game RAF and one canvas at ${wallSeconds.toFixed(1)}s.`);
  check(game.finite, `Non-finite game state at ${wallSeconds.toFixed(1)}s.`);
  check(game.companions === 3 && game.beams <= 3, `Support craft or beam count invalid at ${wallSeconds.toFixed(1)}s.`);
  for (const key of ['enemies', 'mines', 'hazards', 'bullets', 'pickups']) check(game[key] <= limits[key], `${key} exceeded ${limits[key]}.`);
  for (const key of ['particles', 'textures', 'voices']) check(game.stats[key] <= limits[key], `${key} exceeded ${limits[key]}.`);
  if (typeof heap.usedSize === 'number') check(heap.usedSize <= limits.usedHeapBytes, 'Observed JS heap exceeded 512 MiB.');
  if (typeof dom.nodes === 'number') check(dom.nodes <= firstSample.dom.nodes + 500, 'DOM nodes grew by more than 500 from baseline.');
  if (typeof dom.jsEventListeners === 'number') check(dom.jsEventListeners <= firstSample.dom.jsEventListeners + 100, 'DOM event listeners grew by more than 100 from baseline after GC.');
  if (typeof dom.documents === 'number') check(dom.documents <= firstSample.dom.documents + 4, 'DOM documents grew by more than four from baseline.');
  await persist();
  return row;
}

try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Preview failed. Build first and ensure port 5183 is free.');
    try { if ((await fetch(url)).ok) break; } catch { /* Wait for this preview process. */ }
    if (attempt === 99) throw new Error('Preview did not become ready. Run npm run build first.');
    await delay(100);
  }
  browser = await chromium.launch({ headless: true, channel: 'chromium', args });
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => report.browserErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  cdp = await page.context().newCDPSession(page);
  await resource('Performance.enable');
  await page.goto(`${url}/?debug=1`);
  await page.getByRole('button', { name: '开始游戏' }).waitFor();
  await page.evaluate(({ difficulty, season }) => {
    window.__MAFUYU_DEBUG__.difficulty(difficulty);
    window.__MAFUYU_DEBUG__.practice({ season, mode: 'endless', modules: ['prism', 'shatter', 'chain', 'droneHoming', 'droneBurst', 'doubleDash', 'intercept'] });
    const state = window.__MAFUYU_DEBUG__.state();
    if (!state.companions.length) state.pickups.push({ id: 900001, type: 'support', value: 3, x: state.player.x, y: state.player.y, age: 0 });
  }, { difficulty, season });
  await page.waitForFunction(() => window.__MAFUYU_DEBUG__.snapshot().phase === 'playing' && window.__MAFUYU_DEBUG__.state().mode === 'endless');
  await page.waitForFunction(() => window.__MAFUYU_DEBUG__.state().companions.length === 3);
  await page.evaluate(() => {
    const debug = window.__MAFUYU_DEBUG__, canvas = document.querySelector('#game-host canvas');
    debug.state().player.invincible = 3600;
    const held = new Set(), counts = { updates: 0, keyDowns: 0, pointerMoves: 0, dashes: 0, beamsObserved: 0, droneBulletsObserved: 0 };
    const transitions = [];
    let shooting = false, previousPhase = 'playing', lastDash = -10, lastBeamId = 0, stopped = false;
    const key = (code, down) => {
      if (held.has(code) === down) return;
      if (down) { held.add(code); counts.keyDowns++; } else held.delete(code);
      window.dispatchEvent(new window.KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code === 'Space' ? ' ' : code.slice(3).toLowerCase(), bubbles: true }));
    };
    const release = () => {
      for (const code of [...held]) key(code, false);
      if (shooting) { window.dispatchEvent(new window.PointerEvent('pointerup', { button: 0, buttons: 0, pointerType: 'mouse', bubbles: true })); shooting = false; }
    };
    const update = () => {
      if (stopped) return;
      counts.updates++;
      const state = debug.state(), phase = debug.snapshot().phase, player = state.player;
      if (phase !== previousPhase) { transitions.push({ phase, elapsed: state.elapsed }); previousPhase = phase; }
      if (phase !== 'playing') { release(); return; }
      for (const beam of state.beams) if (beam.id > lastBeamId) { lastBeamId = beam.id; counts.beamsObserved++; }
      counts.droneBulletsObserved = Math.max(counts.droneBulletsObserved, state.bullets.filter(bullet => bullet.kind === 'drone').length);
      const nearest = values => values.reduce((best, value) => !best || Math.hypot(value.x - player.x, value.y - player.y) < Math.hypot(best.x - player.x, best.y - player.y) ? value : best, null);
      const boss = state.enemies.find(enemy => enemy.type === 'boss'), target = boss ?? nearest(state.enemies), pickup = nearest(state.pickups);
      let dx, dy;
      if (boss) {
        const x = player.x - boss.x, y = player.y - boss.y, distance = Math.hypot(x, y) || 1, radial = (distance - boss.radius - 150) * 0.02;
        dx = -y / distance - x / distance * radial; dy = x / distance - y / distance * radial;
      } else if (pickup) { dx = pickup.x - player.x; dy = pickup.y - player.y; }
      else if (target) { dx = target.x - player.x; dy = target.y - player.y; }
      else { dx = Math.cos(state.elapsed * 0.5); dy = Math.sin(state.elapsed * 0.5); }
      const length = Math.hypot(dx, dy) || 1;
      key('KeyA', dx / length < -0.22); key('KeyD', dx / length > 0.22);
      key('KeyW', dy / length < -0.22); key('KeyS', dy / length > 0.22);
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(5, Math.min(1595, (target?.x ?? player.x + dx * 100) - state.camera.x + 800));
      const y = Math.max(5, Math.min(895, (target?.y ?? player.y + dy * 100) - state.camera.y + 450));
      const pointer = { clientX: rect.left + x / 1600 * rect.width, clientY: rect.top + y / 900 * rect.height, pointerType: 'mouse', pointerId: 1, bubbles: true, button: 0, buttons: 1 };
      canvas.dispatchEvent(new window.PointerEvent('pointermove', pointer)); counts.pointerMoves++;
      if (!shooting) { canvas.dispatchEvent(new window.PointerEvent('pointerdown', pointer)); shooting = true; }
      if (player.dashCooldown <= 0 && state.elapsed - lastDash >= 3.2) { key('KeyR', true); key('KeyR', false); lastDash = state.elapsed; counts.dashes++; }
    };
    const timer = window.setInterval(update, 100);
    window.__MAFUYU_SOAK__ = { stop: () => { stopped = true; window.clearInterval(timer); release(); }, summary: () => ({ ...counts, transitions: [...transitions] }) };
    update();
  });
  report.environment = await page.evaluate(() => {
    const canvas = document.querySelector('#game-host canvas'), gl = canvas.getContext('webgl2'), info = gl?.getExtension('WEBGL_debug_renderer_info');
    return { userAgent: navigator.userAgent, gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unavailable', canvas: { width: canvas.width, height: canvas.height } };
  });
  await page.screenshot({ path: `${output}/soak-start.png` });
  const baseline = await sample(0, true);
  const began = performance.now();
  let nextSample = 30, nextGc = 300, nextProgress = 60;
  console.log(`[soak] started ${seconds}s real-time endless run; simulation tick ${baseline.tick}; ${report.environment.gpu}`);
  while (performance.now() - began < seconds * 1000) {
    await delay(Math.min(1000, Math.max(1, seconds * 1000 - (performance.now() - began))));
    const wall = (performance.now() - began) / 1000;
    const phase = await page.evaluate(() => window.__MAFUYU_DEBUG__.snapshot().phase);
    if (phase !== 'playing') throw new Error(`Game unexpectedly entered ${phase} after ${wall.toFixed(1)} wall seconds.`);
    if (wall >= nextSample) {
      await sample(wall, wall >= nextGc);
      nextSample += 30;
      if (wall >= nextGc) nextGc += 300;
      if (report.violations.length) throw new Error(report.violations.join(' '));
    }
    if (wall >= nextProgress) {
      const latest = report.samples.at(-1);
      console.log(`[soak] ${Math.floor(wall / 60)}m; sim ${(latest.elapsed - baseline.elapsed).toFixed(1)}s; wave ${latest.wave}; kills ${latest.kills}; enemies ${latest.enemies}; bullets ${latest.bullets}; heap ${typeof latest.heap.usedSize === 'number' ? (latest.heap.usedSize / 1048576).toFixed(1) + ' MiB' : 'unavailable'}`);
      nextProgress += 60;
    }
  }
  await page.evaluate(() => window.__MAFUYU_SOAK__.stop());
  const final = await sample((performance.now() - began) / 1000, true);
  report.wallSeconds = (performance.now() - began) / 1000;
  report.simulatedSeconds = final.elapsed - baseline.elapsed;
  report.simulatedTicks = final.tick - baseline.tick;
  const minimumSimulated = seconds >= 1800 ? seconds - 20 : Math.max(seconds * 0.9, seconds - 2);
  report.minimumSimulatedSeconds = minimumSimulated;
  check(report.simulatedSeconds >= minimumSimulated, `Simulation advanced only ${report.simulatedSeconds.toFixed(2)}s; expected at least ${minimumSimulated}s.`);
  check(Math.abs(report.simulatedTicks / 60 - report.simulatedSeconds) < 0.02, 'Tick count disagrees with the fixed 60 Hz simulation elapsed time.');
  check(final.bot.transitions.length === 0, 'The bot observed an unexpected phase transition during the run.');
  check(final.bot.pointerMoves > seconds * 5 && final.bot.dashes > 0, 'The input bot did not drive the game throughout the run.');
  check(final.bot.beamsObserved > 0 && final.bot.droneBulletsObserved > 0, 'The run did not exercise support projectiles and the dash beam.');
  const retained = report.samples.filter(row => row.gc && !row.gc.unavailable && typeof row.heap.usedSize === 'number');
  report.retainedHeapSamples = retained.map(row => ({ wallSeconds: row.wallSeconds, usedBytes: row.heap.usedSize, gcDurationMs: row.gc.durationMs }));
  if (retained.length >= 2) check(retained.at(-1).heap.usedSize <= retained[0].heap.usedSize * 3 + 64 * 1048576, 'Retained JS heap exceeded three times baseline plus 64 MiB after GC.');
  await page.screenshot({ path: `${output}/soak-end.png` });
  await page.evaluate(() => window.__MAFUYU_DEBUG__.start({ season: 's1' }));
  await page.waitForFunction(() => window.__MAFUYU_DEBUG__.state().tick >= 5);
  const restart = await page.evaluate(() => ({ lifecycle: window.__MAFUYU_DEBUG__.lifecycle(), mode: window.__MAFUYU_DEBUG__.state().mode, wave: window.__MAFUYU_DEBUG__.state().wave, companions: window.__MAFUYU_DEBUG__.state().companions.length, beams: window.__MAFUYU_DEBUG__.state().beams.length, hazards: window.__MAFUYU_DEBUG__.state().hazards.length, canvases: document.querySelectorAll('#game-host canvas').length }));
  check(restart.lifecycle.rafActive && restart.lifecycle.phase === 'playing' && restart.mode === 'story' && restart.wave === 1 && restart.canvases === 1, 'Restart did not recover one active story game.');
  check(restart.companions === 0 && restart.beams === 0 && restart.hazards === 0, 'Restart retained old support craft or beam state.');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '结束本局，返回主菜单' }).click();
  await page.getByRole('button', { name: '开始游戏' }).waitFor();
  const menu = await page.evaluate(() => ({ lifecycle: window.__MAFUYU_DEBUG__.lifecycle(), tick: window.__MAFUYU_DEBUG__.state().tick, canvases: document.querySelectorAll('#game-host canvas').length }));
  await delay(250);
  const menuTick = await page.evaluate(() => window.__MAFUYU_DEBUG__.state().tick);
  check(menu.lifecycle.phase === 'menu' && !menu.lifecycle.rafActive && menu.canvases === 1 && menuTick === menu.tick, 'Menu recovery left an active loop, changing simulation, or extra canvas.');
  report.recovery = { restart, menu, menuTickAfter250ms: menuTick };
  check(report.browserErrors.length === 0 && report.consoleErrors.length === 0, 'Browser or console errors occurred.');
  report.status = report.violations.length ? 'failed' : 'passed';
  console.log(`[soak] ${report.status}; wall ${report.wallSeconds.toFixed(1)}s; simulated ${report.simulatedSeconds.toFixed(1)}s; ${report.samples.length} resource samples; restart/menu checked.`);
  if (report.violations.length) throw new Error(report.violations.join(' '));
} catch (error) {
  report.status = 'failed'; report.failure = error.stack ?? error.message;
  console.error(`[soak] failed: ${error.message}`);
  process.exitCode = 1;
  if (page && !page.isClosed()) {
    await page.evaluate(() => window.__MAFUYU_SOAK__?.stop()).catch(() => {});
    await page.screenshot({ path: `${output}/soak-failure.png` }).catch(() => {});
  }
} finally {
  report.finishedAt = new Date().toISOString();
  await persist();
  try { await browser?.close(); } finally { server.kill(); }
}
