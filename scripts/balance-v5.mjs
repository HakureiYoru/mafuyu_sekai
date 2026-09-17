import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { setPriority } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { simulationLoader } from './simulation-loader.mjs';

// The game is loaded without changing its damage, spawn or progression methods.
const root = resolve(import.meta.dirname, '..'), output = resolve(root, 'docs/validation');
setPriority(10);
const loader = simulationLoader(root);
const { GameSimulation } = await import(await loader.url('src/game/simulation.ts'));
const fairnessUrl = await loader.url('src/game/fairness.test.ts');
const miniBossUrl = await loader.url('src/game/miniboss-ai.ts');
const source = await readFile(resolve(root, 'scripts/balance-v4.mjs'), 'utf8');
const start = source.indexOf('function openWorldInput('), end = source.indexOf('function run({');
if (start < 0 || end < start) throw new Error('Visible-warning controller source changed.');
let controller = source.slice(start, end);
// Prefer visible nearby drops while still using the controller's body/attack avoidance.
controller = controller.replace("item.type !== 'xp' || p.level < 10 || w.seasonId === 's2'",
  "!(item.type === 'hp' && p.hp >= p.maxHp) && !(item.type === 'coolant' && p.heat <= 0 && p.heatLock <= 0 && !p.overheated)");
controller = controller.replace('  for (const enemy of living) {', `
  const item = pickups.reduce((best, item) => !best || Math.hypot(item.x-p.x,item.y-p.y) < Math.hypot(best.x-p.x,best.y-p.y) ? item : best, null);
  if (item && Math.hypot(item.x-p.x,item.y-p.y) < 850 && !living.some(e => Math.hypot(e.x-p.x,e.y-p.y) < e.radius+70)) {
    const distance = Math.max(1, Math.hypot(item.x-p.x,item.y-p.y)); dx=(item.x-p.x)/distance; dy=(item.y-p.y)/distance;
  }
  for (const enemy of living) {`);
// ECHO renders its committed attacks directly, rather than adding WorldState.hazards.
// Observe those same on-screen geometries, after 200 ms of actually seeing the cue.
// The observer does not inspect future combo choices or mutate the simulation.
const miniPerception = `
const miniObservations = new WeakMap();
function perceivedMiniAttacks(sim) {
  const w = sim.state, observations = miniObservations.get(sim) ?? new Map();
  miniObservations.set(sim, observations);
  const hazards = [], paths = new Map(), visibleIds = new Set();
  for (const enemy of w.enemies) {
    if (enemy.type !== 'miniboss' || enemy.hp <= 0 || !enemy.miniboss) continue;
    if (Math.abs(enemy.x - w.camera.x) > 800 + enemy.radius || Math.abs(enemy.y - w.camera.y) > 450 + enemy.radius) continue;
    const kind = ['laserWarmup', 'laser'].includes(enemy.state) ? 'laser' : ['charge', 'dash'].includes(enemy.state) ? 'dash' : null;
    if (!kind) continue;
    visibleIds.add(enemy.id);
    let observation = observations.get(enemy.id);
    const newWarning = observation && observation.state !== enemy.state && ['laserWarmup', 'charge'].includes(enemy.state);
    if (!observation || observation.kind !== kind || newWarning) {
      observation = { kind, state: enemy.state, seenAt: w.elapsed }; observations.set(enemy.id, observation);
    }
    observation.state = enemy.state;
    if (w.elapsed - observation.seenAt < 0.2 - 1e-8) continue;
    const cfg = miniBossAttacks(w.difficulty);
    if (kind === 'laser') {
      const active = enemy.state === 'laser', geometry = miniBossLaserGeometry(enemy, w.difficulty);
      hazards.push({ ...geometry, kind: 'beam', active, warning: active ? 0 : enemy.timer,
        warningDuration: active ? 0 : enemy.timer, life: active ? enemy.timer : cfg.laser.duration });
    } else {
      const geometry = miniBossDashGeometry(enemy, w.difficulty);
      paths.set(enemy.id, { x: geometry.x, y: geometry.y, endX: geometry.endX, endY: geometry.endY,
        delay: enemy.state === 'charge' ? enemy.timer : 0,
        duration: enemy.state === 'charge' ? cfg.dash.duration : Math.max(1e-8, enemy.timer) });
    }
  }
  for (const id of observations.keys()) if (!visibleIds.has(id)) observations.delete(id);
  return { hazards, paths };
}
`;
const forecastBefore = '  const hazards = w.hazards.filter(h => h.active || h.warningDuration - h.warning >= 0.2);';
if (!controller.includes(forecastBefore)) throw new Error('Open-world hazard forecast contract changed.');
controller = controller.replace(forecastBefore, `${forecastBefore}
  const mini = perceivedMiniAttacks(sim); hazards.push(...mini.hazards);
  const bodyPosition = (enemy, time) => {
    const path = mini.paths.get(enemy.id);
    if (!path) return { x: enemy.x + enemy.vx * time, y: enemy.y + enemy.vy * time };
    const progress = Math.max(0, Math.min(1, (time - path.delay) / path.duration));
    return { x: path.x + (path.endX - path.x) * progress, y: path.y + (path.endY - path.y) * progress };
  };`);
controller = controller.replace('Math.hypot(e.x - p.x, e.y - p.y) < 600);', '(Math.hypot(e.x - p.x, e.y - p.y) < 600 || mini.paths.has(e.id)));');
const bodyBefore = '        const clearance = Math.hypot(point.x - e.x - e.vx * time, point.y - e.y - e.vy * time) - e.radius - 18;';
if (!controller.includes(bodyBefore)) throw new Error('Open-world body forecast contract changed.');
controller = controller.replace(bodyBefore, `        const from = bodyPosition(e, (i - 1) * 0.18), to = bodyPosition(e, time), before = points[i - 1];
        const clearance = minimumDistance(before.x - from.x, before.y - from.y, point.x - to.x, point.y - to.y) - e.radius - 18;`);
const helper = `import {steering,projectileForecast,minimumDistance,crossesBeam} from ${JSON.stringify(fairnessUrl)};\nimport {miniBossAttacks,miniBossDashGeometry,miniBossLaserGeometry} from ${JSON.stringify(miniBossUrl)};\n${miniPerception}\n${controller}\nexport {openWorldInput,bossInput,forecastOpenWorldInput};`;
const { openWorldInput, bossInput, forecastOpenWorldInput } = await import(`data:text/javascript;base64,${Buffer.from(helper).toString('base64')}`);
const preferences = {
  main: ['piercing', 'precision', 'wingShots', 'rearSpark', 'prism', 'chain'],
  drone: ['droneBurst', 'crossOrbit', 'orbitBlade', 'returnWing', 'droneHoming', 'division'],
  mobility: ['doubleDash', 'dashEcho', 'vent', 'reserveAmmo', 'graze', 'revive'],
  balanced: ['piercing', 'precision', 'droneBurst', 'crossOrbit', 'doubleDash', 'dashEcho'],
};
const round = value => Math.round(value * 1000) / 1000;
const hash = content => createHash('sha256').update(content).digest('hex');
for (const path of ['scripts/balance-v5.mjs', 'scripts/balance-v4.mjs', 'scripts/simulation-loader.mjs']) loader.hashes[path] = hash(await readFile(resolve(root, path)));
const quick = process.env.MAFUYU_BALANCE_QUICK === '1';
const selectedProfile = process.env.MAFUYU_BALANCE_PROFILE;
if (selectedProfile && !preferences[selectedProfile]) throw new Error('Unknown balance profile.');
const reportPath = resolve(output, quick ? 'balance-v5-calibration.json' : 'balance-v5.0.0.json');
const report = {
  version: '5.0.0', measuredAt: new Date().toISOString(), sourceHashes: loader.hashes, status: 'running',
  method: 'Actual 60 Hz simulation, seeded real upgrade offers, fresh Lv1 with zero XP and companions. Controls update every 100 ms; visible-warning route controller uses a 200 ms recognition delay. ECHO laser and dash geometry are perceived only after 200 ms on screen. Unusable health/coolant drops are excluded from movement goals. Bomb policy is unchanged. No manual Q/E or forced gear/levels. Only immutable invulnerability is added to separately labelled DPS cases.',
  controllerBaseline: 'balance-v5.0.0-controller-baseline.json',
  limitations: ['Exact mouse aiming and synthetic path prediction are not human playtesting.', 'The controller does not plan exposed-weakpoint shots or coordinated shield flanks.', 'ECHO forecasts use only the current visible committed geometry; unseen later combo attacks are not predicted.', 'Only three seeds are sampled; preference profiles can produce identical builds and are not independent samples.', 'DPS-case movement and invulnerability change survivability; DPS cases cannot establish human clearability.', 'Tests use simulation ticks, not real browser frame performance.'],
  matrix: { seeds: quick ? [50001] : [50001, 50002, 50003], difficulties: quick ? ['normal'] : ['normal', 'hard'], profiles: selectedProfile ? [selectedProfile] : Object.keys(preferences), modes: quick ? ['DPS'] : ['normalHP', 'DPS'] }, cases: [],
};
function run(seed, difficulty, profile, immortal) {
  const sim = new GameSimulation(seed, difficulty);
  sim.reset('story', seed, difficulty, { difficulty, seed });
  const began = performance.now(), rows = new Map(), choices = [], injuries = [], bossEntries = [];
  let input = { moveX: 0, moveY: 0, aimX: 2000, aimY: 1800, shoot: false, dash: false, bomb: false }, previousEncounter = null;
  const rankChoice = id => {
    if (id.startsWith('evolution:')) return -100;
    const rank = preferences[profile].indexOf(id);
    if (rank >= 0) return rank;
    if (id === 'reward:heal' && sim.state.player.hp < 3) return -50;
    return id.startsWith('reward:') ? 100 : 30;
  };
  while (sim.state.elapsed < 1200 && !['failed', 'complete'].includes(sim.state.status)) {
    while (sim.state.status === 'upgrade') {
      const build = sim.state.build, offer = [...build.choices];
      const selected = offer.toSorted((a, b) => rankChoice(a) - rankChoice(b))[0];
      choices.push({ at: round(sim.state.elapsed), level: sim.state.player.level, source: build.pendingRewards[0]?.source, offer, selected });
      if (!selected || !sim.chooseUpgrade(selected, build.offerId ?? undefined)) throw new Error('Production choice was rejected.');
      input.dash = false; input.bomb = false;
    }
    const w = sim.state, p = w.player, boss = w.enemies.find(e => e.hp > 0 && e.spell);
    if (immortal) p.invincible = 3600;
    if (w.campaign.activeEncounter !== previousEncounter) {
      previousEncounter = w.campaign.activeEncounter;
      if (previousEncounter) bossEntries.push({ id: previousEncounter, elapsed: round(w.elapsed), progression: round(w.campaign.progression), level: p.level, xp: p.xp, companions: w.companions.length, hp: p.hp, bombs: p.bombs, modules: [...w.build.modules], ranks: { ...w.build.ranks }, evolutions: [...w.build.evolutions] });
    }
    if (w.tick % 6 === 0) {
      const previous = input;
      input = boss ? bossInput(sim, boss, previous, 'reactive', immortal) : immortal ? openWorldInput(sim, previous, true) : forecastOpenWorldInput(sim, previous);
      const clear = !w.enemies.some(e => e.hp > 0 && Math.hypot(e.x-p.x,e.y-p.y) < e.radius + 220);
      if (!input.dash && !previous.dash && sim.dashCharges > 0 && p.perfectWindow <= 0 && clear && w.tick % 60 < 6) input.dash = true;
    }
    const segment = boss ? `${w.campaign.activeEncounter}:card${boss.spell.cardIndex + 1}` : w.campaign.activeEncounter ?? `approach:${w.campaign.stage}`;
    if (!rows.has(segment)) rows.set(segment, { id: segment, seconds: 0, damage: 0, bossDamage: 0, sources: {}, received: {}, bombs: 0, beams: 0, kills: 0, heatLockedSeconds: 0 });
    const row = rows.get(segment); row.seconds += 1 / 60;
    if (p.overheated) row.heatLockedSeconds += 1 / 60;
    for (const event of sim.step(input)) {
      if (event.type === 'hit' && event.enemyType && event.hitResult !== 'weakpoint' && event.amount > 0) {
        row.damage += event.amount;
        row.sources[event.damageSource ?? 'unknown'] = (row.sources[event.damageSource ?? 'unknown'] ?? 0) + event.amount;
        if (['boss', 'miniboss', 'palisade', 'reprise'].includes(event.enemyType)) row.bossDamage += event.amount;
      }
      if (event.type === 'damage') {
        row.received[event.damageSource ?? 'unknown'] = (row.received[event.damageSource ?? 'unknown'] ?? 0) + event.amount;
        injuries.push({ at: round(w.elapsed), segment, source: event.damageSource, hp: p.hp, bombs: p.bombs });
      }
      if (event.type === 'bomb') row.bombs++;
      if (event.type === 'beam') row.beams++;
      if (event.type === 'kill') row.kills++;
    }
  }
  return { seed, difficulty, profile, mode: immortal ? 'DPS' : 'normalHP', result: sim.state.status, elapsed: round(sim.state.elapsed), computeSeconds: round((performance.now()-began)/1000),
    level: sim.state.player.level, progression: round(sim.state.campaign.progression), bossEntries, choices, injuries,
    modules: [...sim.state.build.modules], ranks: { ...sim.state.build.ranks }, evolutions: [...sim.state.build.evolutions],
    segments: [...rows.values()].map(row => ({ ...row, seconds: round(row.seconds), damage: round(row.damage), bossDamage: round(row.bossDamage), dps: round(row.damage / row.seconds), bossDps: round(row.bossDamage / row.seconds), heatLockedSeconds: round(row.heatLockedSeconds) })) };
}
await mkdir(output, { recursive: true });
for (const seed of report.matrix.seeds) for (const difficulty of report.matrix.difficulties) for (const profile of report.matrix.profiles) for (const mode of report.matrix.modes) {
  const result = run(seed, difficulty, profile, mode === 'DPS'); report.cases.push(result);
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.cases.length}: ${seed} ${difficulty} ${profile} ${mode} ${result.result} ${result.elapsed}s, Lv${result.level}; CPU wall ${result.computeSeconds}s`);
  await delay(100);
}
report.changedSources = [];
for (const [path, expected] of Object.entries(loader.hashes)) if (hash(await readFile(resolve(root, path))) !== expected) report.changedSources.push(path);
report.status = report.changedSources.length ? 'stale-sources' : 'complete';
report.finishedAt = new Date().toISOString();
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
if (report.changedSources.length) throw new Error(`Simulation changed while measuring: ${report.changedSources.join(', ')}`);
