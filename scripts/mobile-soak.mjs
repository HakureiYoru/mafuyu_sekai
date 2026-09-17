import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';

const seconds = Number(process.env.MAFUYU_MOBILE_SOAK_SECONDS ?? 1800);
const difficulty = process.env.MAFUYU_MOBILE_SOAK_DIFFICULTY ?? 'normal';
const renderFps = Number(process.env.MAFUYU_MOBILE_SOAK_FPS ?? 60);
if (!Number.isFinite(seconds) || seconds < 5 || seconds > 1800) throw new Error('MAFUYU_MOBILE_SOAK_SECONDS must be 5–1800. Only 1800 qualifies as the 30-minute acceptance run.');
if (!['normal', 'hard'].includes(difficulty) || ![30, 60].includes(renderFps)) throw new Error('Invalid mobile soak difficulty or render FPS.');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = `docs/validation/mobile-soak-${stamp}`;
const port = 5185, url = `http://127.0.0.1:${port}`;
const args = process.platform === 'win32' ? ['--use-angle=d3d11'] : [];
const modules = ['piercing','wingShots','precision','shatter','chain','prism','droneHoming','droneBurst','slow','division','intercept','orbitBlade','doubleDash','vent','reserveAmmo','graze','revive','magnet','ricochet','rearSpark','crossOrbit','returnWing','brakeField','dashEcho','pulseChamber','anchorStars','crescentMagazine','beamCircuit','droneSpotlight','droneNotes','dronePlectrum','droneConduit','decoyEcho','slipstream','dashLane','counterPulse'];
const evolutions = ['needleArray','spiralBloom','forkNetwork','triangleAssault','huntingReturn','echoTrail','sonicBreak','starCarpet','lunarCut','choralBeam','stageSpotlight','staticGarden','stringEcho','triangleHall','livingSpeaker','headwindFlame','echoHighway','counterCurtain'];
const report = {
  version: JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version,
  measuredAt: new Date().toISOString(), status: 'running', requestedWallSeconds: seconds,
  acceptanceDuration: seconds === 1800, difficulty, renderFps,
  scenario: 'Production preview, 844×390, low quality, touch controls; real wall-clock endless practice with all 36 modules at rank V, all 18 evolutions and three companions. Actual Chromium CDP touch points operate the DOM joystick and dash buttons; touch taps choose actual rewards. No extra simulation steps, time acceleration, mouse, or keyboard gameplay input.',
  caveat: 'Desktop Chromium mobile emulation, not physical Android/iPhone. Diagnostic invincibility isolates runtime stability. These results do not establish mobile hardware performance or human difficulty. Practice does not create a persistent clear.',
  launch: { channel: 'chromium', headless: true, args, viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true },
  measurement: { sampleSeconds: 30, forcedGcSeconds: 300, inputMilliseconds: 100,
    domGuard: 'Each phase has an independent post-GC baseline. Playing and the complete upgrade menu retain their exact connected-node/structure counts. Above baseline +500 DOM nodes or +100 listeners, preserve raw counters, force GC, then recheck the unchanged limits.',
    simulation: 'Fixed 60 Hz simulation with separately throttled rendering. Real reward menus pause simulation and their wall time is recorded.' },
  samples: [], phaseBaselines: {}, browserErrors: [], consoleErrors: [], violations: [], recovery: null,
};
await mkdir(output, { recursive: true });
const html = await readFile('dist/index.html', 'utf8');
const entry = html.match(/src="\.?\/([^" ]+\.js)"/)?.[1];
if (!entry) throw new Error('Production entry missing; build before running mobile soak.');
const artifactHash = async () => createHash('sha256').update(await readFile(`dist/${entry}`)).digest('hex');
report.artifact = { entry, sha256: await artifactHash() };
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { windowsHide: true, stdio: 'ignore' });
let browser, page, cdp, baseline, lastPhase = 'playing', choiceBegan = null;
let lastDash = -10, lastFocus = -10, lastBeamId = 0;
const points = new Map();
const bot = { updates: 0, moves: 0, dashes: 0, focusToggles: 0, choices: 0, beamsObserved: 0, maxDroneBullets: 0, upgradeWallMs: 0, phaseTransitions: 0 };
const persist = () => writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
const check = (condition, message) => { if (!condition && !report.violations.includes(message)) report.violations.push(message); };
const resource = async method => { try { return await cdp.send(method); } catch (error) { return { unavailable: error.message }; } };
async function touches(type) { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...points.values()] }); }
async function release() { if (points.size) { points.clear(); await touches('touchEnd'); } }
const point = (id, x, y) => ({ id, x, y, radiusX: 4, radiusY: 4, force: 1 });
async function buttonFinger(position) {
  if (!position) return;
  points.set(2, point(2, position.x, position.y)); await touches('touchStart');
  points.delete(2); await touches(points.size ? 'touchMove' : 'touchEnd');
}
async function input() {
  const data = await page.evaluate(() => {
    const debug = window.__MAFUYU_DEBUG__, state = debug.state(), snap = debug.snapshot(), p = state.player;
    const at = name => { const r = document.querySelector(`[data-touch-control="${name}"]`)?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; };
    const nearest = entries => entries.reduce((best, item) => !best || Math.hypot(item.x - p.x, item.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y) ? item : best, null);
    const target = nearest(state.enemies), pickup = nearest(state.pickups), boss = state.enemies.find(e => ['boss', 'miniboss', 'palisade', 'reprise'].includes(e.type));
    let dx, dy;
    if (boss) { const x = p.x - boss.x, y = p.y - boss.y, d = Math.hypot(x, y) || 1, radial = (d - boss.radius - 180) * 0.02; dx = -y / d - x / d * radial; dy = x / d - y / d * radial; }
    else if (pickup) { dx = pickup.x - p.x; dy = pickup.y - p.y; }
    else if (target) { dx = target.x - p.x; dy = target.y - p.y; }
    else { dx = Math.cos(state.elapsed * 0.5); dy = Math.sin(state.elapsed * 0.5); }
    const length = Math.hypot(dx, dy) || 1;
    return { phase: snap.phase, orientationBlocked: snap.orientationBlocked, elapsed: state.elapsed, dashCharges: snap.dashCharges,
      stick: at('stick'), dash: at('dash'), focus: at('focus'), direction: { x: dx / length, y: dy / length },
      beamIds: state.beams.map(b => b.id), droneBullets: state.bullets.filter(b => b.kind === 'drone').length };
  });
  bot.updates++;
  for (const id of data.beamIds) if (id > lastBeamId) { bot.beamsObserved++; lastBeamId = id; }
  bot.maxDroneBullets = Math.max(bot.maxDroneBullets, data.droneBullets);
  if (data.phase !== lastPhase) { bot.phaseTransitions++; lastPhase = data.phase; }
  if (data.phase === 'upgrade') {
    choiceBegan ??= performance.now(); await release();
    await page.locator('.upgrade-card').first().tap(); bot.choices++;
    return;
  }
  if (choiceBegan !== null) { bot.upgradeWallMs += performance.now() - choiceBegan; choiceBegan = null; }
  if (data.phase !== 'playing' || data.orientationBlocked) { await release(); throw new Error(`Unexpected ${data.phase}, orientationBlocked=${data.orientationBlocked}`); }
  if (!data.stick) throw new Error('Touch joystick disappeared while playing.');
  if (!points.has(1)) { points.set(1, point(1, data.stick.x, data.stick.y)); await touches('touchStart'); }
  points.set(1, point(1, data.stick.x + data.direction.x * 48, data.stick.y + data.direction.y * 48));
  await touches('touchMove'); bot.moves++;
  if (data.dashCharges > 0 && data.elapsed - lastDash > 3.2) { await buttonFinger(data.dash); bot.dashes++; lastDash = data.elapsed; }
  if (data.elapsed - lastFocus > 4) { await buttonFinger(data.focus); bot.focusToggles++; lastFocus = data.elapsed; }
}
async function sample(wallSeconds, forceGc = false) {
  const gc = forceGc ? await resource('HeapProfiler.collectGarbage') : null;
  const game = await page.evaluate(() => {
    const d = window.__MAFUYU_DEBUG__, s = d.state(), h = d.snapshot();
    return { elapsed: s.elapsed, tick: s.tick, phase: h.phase, mode: s.mode, difficulty: s.difficulty, controlMode: h.controlMode,
      orientationBlocked: h.orientationBlocked, touch: h.touch, settings: { quality: h.settings.quality, touchFrameRate: h.settings.touchFrameRate },
      wave: s.wave, score: s.score, kills: s.kills, player: { hp: s.player.hp, level: s.player.level, heat: s.player.heat, bombs: s.player.bombs },
      modules: s.build.modules.length, evolutions: s.build.evolutions.length, companions: s.companions.length,
      enemies: s.enemies.length, mines: s.enemies.filter(e => e.type === 'mine').length, pickups: s.pickups.length, hazards: s.hazards.length, beams: s.beams.length,
      stats: h.stats, resources: d.resources(), lifecycle: d.lifecycle(), canvasCount: document.querySelectorAll('#game-host canvas').length,
      finite: [s.player, ...s.enemies, ...s.bullets, ...s.pickups, ...s.companions, ...s.beams, ...s.hazards, ...s.playerAreas].every(o => Number.isFinite(o.x) && Number.isFinite(o.y)) };
  });
  const liveDom = () => page.evaluate(() => ({ phase: window.__MAFUYU_DEBUG__.snapshot().phase, connectedNodes: document.querySelectorAll('*').length,
    structure: { dialogs: document.querySelectorAll('[role="dialog"]').length, upgradeCards: document.querySelectorAll('.upgrade-card').length,
      moduleArticles: document.querySelectorAll('.paused-modules article').length, evolutionRecipes: document.querySelectorAll('.evolution-recipes>div>p').length,
      modulePreviews: document.querySelectorAll('.module-preview').length, canvases: document.querySelectorAll('#game-host canvas').length } }));
  let [heap, dom, metrics] = await Promise.all([resource('Runtime.getHeapUsage'), resource('Memory.getDOMCounters'), resource('Performance.getMetrics')]);
  let view = await liveDom(), phaseBaseline = report.phaseBaselines[view.phase];
  // The bot is idle during probes: a playing→upgrade transition may happen, but upgrade cannot resume itself.
  if (view.phase !== game.phase) { [heap, dom, metrics] = await Promise.all([resource('Runtime.getHeapUsage'), resource('Memory.getDOMCounters'), resource('Performance.getMetrics')]); view = await liveDom(); phaseBaseline = report.phaseBaselines[view.phase]; }
  let domRecheck = null;
  if (!phaseBaseline || typeof dom.nodes === 'number' && dom.nodes > phaseBaseline.dom.nodes + 500
    || typeof dom.jsEventListeners === 'number' && dom.jsEventListeners > phaseBaseline.dom.jsEventListeners + 100) {
    domRecheck = { reason: phaseBaseline ? 'DOM or listener threshold exceeded' : 'Establish independent phase baseline', before: { heap, dom, live: view }, gc: await resource('HeapProfiler.collectGarbage') };
    [heap, dom, metrics] = await Promise.all([resource('Runtime.getHeapUsage'), resource('Memory.getDOMCounters'), resource('Performance.getMetrics')]);
    view = await liveDom(); phaseBaseline = report.phaseBaselines[view.phase];
    domRecheck.after = { heap, dom, live: view };
  }
  if (!phaseBaseline) {
    phaseBaseline = { wallSeconds, dom, connectedNodes: view.connectedNodes, structure: view.structure };
    report.phaseBaselines[view.phase] = phaseBaseline;
  }
  const row = { wallSeconds, gc, domRecheck, liveDom: view, ...game, bot: { ...bot }, heap, dom, performanceMetrics: metrics.metrics ?? metrics };
  baseline ??= row; report.samples.push(row);
  check(game.controlMode === 'touch' && !game.orientationBlocked && game.settings.quality === 'low' && game.settings.touchFrameRate === renderFps, 'Touch settings or landscape gate changed during soak.');
  check(game.difficulty === difficulty, 'Configured difficulty was not applied or changed during soak.');
  check(['playing', 'upgrade'].includes(game.phase) && game.mode === 'endless', 'The run left endless combat or reward selection.');
  check(game.lifecycle.rafActive === (game.phase === 'playing') && game.canvasCount === 1, 'RAF/phase mismatch or duplicate canvas.');
  check(game.modules === 36 && game.evolutions === 18 && game.companions === 3, 'Full build or companions were lost.');
  check(game.finite, 'Non-finite world coordinates.');
  check(game.resources.enemyBullets <= 3072 && game.resources.playerBullets <= 1536, 'Separate bullet live-count capacity exceeded.');
  check(game.resources.enemyBullets + game.resources.promises.bullets <= 3072 && game.hazards + game.resources.promises.hazards <= 48, 'Live enemy attacks plus promised capacity exceeded the reserved budget.');
  const pools = game.resources.pools;
  check(pools.enemyAllocated <= 3072 && pools.playerAllocated <= 1536, 'Separate bullet pool allocation exceeded.');
  check(pools.enemyFree + game.resources.enemyBullets === pools.enemyAllocated && pools.playerFree + game.resources.playerBullets === pools.playerAllocated, 'Bullet pool ownership bookkeeping diverged.');
  check(game.resources.modules.actors <= 192 && game.beams <= 64 && game.hazards <= 48 && game.enemies <= 180 && game.mines <= 70, 'A bounded gameplay resource exceeded capacity.');
  check(game.stats.particles <= 900 && game.stats.textures <= 64 && game.stats.voices <= 24, 'A presentation resource exceeded capacity.');
  if (typeof heap.usedSize === 'number') check(heap.usedSize <= 512 * 1048576, 'Observed JS heap exceeded 512 MiB.');
  if (view.phase === 'playing') check(view.structure.dialogs === 0 && view.structure.upgradeCards === 0 && view.structure.moduleArticles === 0, 'Playing retained a visible upgrade dialog or build-history DOM.');
  if (view.phase === 'upgrade') check(view.structure.dialogs === 1 && view.structure.upgradeCards === 3 && view.structure.moduleArticles === 36 && view.structure.evolutionRecipes === 18 && view.structure.modulePreviews <= 3, 'Upgrade DOM does not match the exact full-build menu structure.');
  if (typeof dom.nodes === 'number') check(dom.nodes <= phaseBaseline.dom.nodes + 500, `DOM nodes grew >500 from the ${view.phase} baseline after GC.`);
  if (typeof dom.jsEventListeners === 'number') check(dom.jsEventListeners <= phaseBaseline.dom.jsEventListeners + 100, `DOM event listeners grew >100 from the ${view.phase} baseline after GC.`);
  check(view.connectedNodes <= phaseBaseline.connectedNodes + 500, `Connected DOM nodes grew >500 from the ${view.phase} baseline.`);
  await persist(); return row;
}

try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Preview failed; ensure port ${port} is free.`);
    try { if ((await fetch(url)).ok) break; } catch { /* This process owns the preview server. */ }
    if (attempt === 99) throw new Error('Preview did not become ready.');
    await delay(100);
  }
  browser = await chromium.launch({ headless: true, channel: 'chromium', args });
  page = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  page.on('pageerror', error => report.browserErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  cdp = await page.context().newCDPSession(page); await resource('Performance.enable');
  await page.goto(`${url}/?debug=1`); await page.getByRole('button', { name: '开始游戏', exact: true }).waitFor();
  await page.evaluate(({ difficulty, renderFps }) => { const d = window.__MAFUYU_DEBUG__; d.settings({ quality: 'low', controlMode: 'touch', touchFrameRate: renderFps }); d.difficulty(difficulty); }, { difficulty, renderFps });
  await page.getByRole('button', { name: '开始游戏', exact: true }).tap();
  await page.evaluate(({ modules, evolutions }) => {
    const d = window.__MAFUYU_DEBUG__;
    d.practice({ mode: 'endless', modules, ranks: Object.fromEntries(modules.map(id => [id, 5])), evolutions });
    const s = d.state(); s.player.level = 10; s.player.xp = 0; s.player.invincible = 3600;
    if (!s.companions.length) s.pickups.push({ id: 910000, type: 'support', value: 3, x: s.player.x, y: s.player.y, age: 0 });
  }, { modules, evolutions });
  await page.waitForFunction(() => window.__MAFUYU_DEBUG__.state().companions.length === 3);
  report.environment = await page.evaluate(() => {
    const canvas = document.querySelector('#game-host canvas'), gl = canvas.getContext('webgl2'), info = gl?.getExtension('WEBGL_debug_renderer_info');
    return { userAgent: navigator.userAgent, gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unavailable', canvas: { width: canvas.width, height: canvas.height }, maxTouchPoints: navigator.maxTouchPoints };
  });
  await page.screenshot({ path: `${output}/start.png` }); await sample(0, true);
  const began = performance.now(); let nextSample = 30, nextGc = 300, nextProgress = 60;
  console.log(`[mobile-soak] ${seconds}s wall-clock, ${renderFps} FPS rendering, touch input, ${report.environment.gpu}. Report ${output}`);
  while (performance.now() - began < seconds * 1000) {
    const updateBegan = performance.now(); await input();
    const wall = (performance.now() - began) / 1000;
    if (wall >= nextSample) { await sample(wall, wall >= nextGc); nextSample += 30; if (wall >= nextGc) nextGc += 300; }
    if (report.violations.length) throw new Error(report.violations.join(' '));
    if (wall >= nextProgress) { const latest = report.samples.at(-1); console.log(`[mobile-soak] ${Math.floor(wall / 60)}m; sim ${latest.elapsed.toFixed(1)}s; bullets ${latest.resources.enemyBullets}/${latest.resources.playerBullets}; input ${bot.moves}; choices ${bot.choices}`); nextProgress += 60; }
    await delay(Math.max(1, 100 - (performance.now() - updateBegan)));
  }
  await release();
  if (choiceBegan !== null) bot.upgradeWallMs += performance.now() - choiceBegan;
  const final = await sample((performance.now() - began) / 1000, true);
  report.wallSeconds = (performance.now() - began) / 1000; report.simulatedSeconds = final.elapsed - baseline.elapsed; report.simulatedTicks = final.tick - baseline.tick;
  report.choiceWallSeconds = bot.upgradeWallMs / 1000; report.bot = { ...bot };
  report.minimumSimulatedSeconds = Math.max(0, seconds - report.choiceWallSeconds - (seconds === 1800 ? 25 : 3));
  check(report.simulatedSeconds >= report.minimumSimulatedSeconds, 'The simulation lost too much wall-clock time.');
  check(Math.abs(report.simulatedTicks / 60 - report.simulatedSeconds) < 0.02, 'Fixed-step elapsed time disagrees with tick count.');
  check(bot.moves > seconds * 4 && bot.dashes > 0 && bot.beamsObserved > 0 && bot.maxDroneBullets > 0, 'The run failed to exercise actual touch movement, dashes, beams or companions.');
  const retained = report.samples.filter(s => s.gc && !s.gc.unavailable && typeof s.heap.usedSize === 'number');
  report.retainedHeapSamples = retained.map(s => ({ wallSeconds: s.wallSeconds, usedBytes: s.heap.usedSize }));
  if (retained.length >= 2) check(retained.at(-1).heap.usedSize <= retained[0].heap.usedSize * 3 + 64 * 1048576, 'Retained heap grew beyond baseline×3 +64MiB.');
  await page.screenshot({ path: `${output}/end.png` });
  await page.evaluate(() => window.__MAFUYU_DEBUG__.restart());
  await page.waitForFunction(() => window.__MAFUYU_DEBUG__.state().tick > 5);
  const restart = await page.evaluate(() => { const d = window.__MAFUYU_DEBUG__, s = d.state(); return { life: d.lifecycle(), mode: s.mode, level: s.player.level, touch: d.snapshot().touch, companions: s.companions.length, modules: s.build.modules.length }; });
  check(restart.life.rafActive && restart.mode === 'story' && restart.level === 1 && restart.companions === 0 && restart.modules === 0 && !restart.touch.focus && restart.touch.lockedTargetId === null, 'Restart retained build or touch input.');
  await page.getByRole('button', { name: '暂停游戏', exact: true }).tap();
  await page.getByRole('button', { name: '结束本局，返回主菜单', exact: true }).tap();
  const menu = await page.evaluate(() => ({ life: window.__MAFUYU_DEBUG__.lifecycle(), tick: window.__MAFUYU_DEBUG__.state().tick }));
  await delay(250);
  check(!menu.life.rafActive && menu.life.phase === 'menu' && await page.evaluate(() => window.__MAFUYU_DEBUG__.state().tick) === menu.tick, 'Menu retained a running simulation.');
  report.recovery = { restart, menu }; check(report.browserErrors.length === 0 && report.consoleErrors.length === 0, 'Browser/console errors occurred.');
  check(await artifactHash() === report.artifact.sha256, 'Production artifact changed during mobile soak.');
  report.status = report.violations.length ? 'failed' : 'passed';
  if (report.violations.length) throw new Error(report.violations.join(' '));
  console.log(`[mobile-soak] passed ${report.wallSeconds.toFixed(1)}s wall / ${report.simulatedSeconds.toFixed(1)}s simulation; ${output}/report.json`);
} catch (error) {
  report.status = 'failed'; report.failure = error.stack ?? error.message; process.exitCode = 1;
  console.error(`[mobile-soak] failed: ${error.message}`);
  if (page && !page.isClosed()) { await release().catch(() => {}); await page.screenshot({ path: `${output}/failure.png` }).catch(() => {}); }
} finally {
  report.finishedAt = new Date().toISOString(); await persist();
  try { await browser?.close(); } finally { server.kill(); }
}
