import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { getPriority, setPriority } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { simulationLoader } from './simulation-loader.mjs';

const root = resolve(import.meta.dirname, '..'), output = resolve(root, 'docs/validation');
const pauseFile = resolve(root, '.tmp/balance-v4.1.pause');
setPriority(10);
const loader = simulationLoader(root);
const { GameSimulation } = await import(await loader.url('src/game/simulation.ts'));
const fairnessUrl = await loader.url('src/game/fairness.test.ts');
// Reuse the previously documented visible-warning steering algorithm, without its old report or instrumentation.
const legacy = await readFile(resolve(root, 'scripts/balance-v4.mjs'), 'utf8');
const controllerStart = legacy.indexOf('function openWorldInput('), controllerEnd = legacy.indexOf('function run({');
if (controllerStart < 0 || controllerEnd <= controllerStart) throw new Error('Legacy input-only controller extraction marker changed');
const controller = legacy.slice(controllerStart, controllerEnd);
const helper = `import {steering,projectileForecast,minimumDistance,crossesBeam} from ${JSON.stringify(fairnessUrl)};\n${controller}\nexport {openWorldInput,bossInput,forecastOpenWorldInput};`;
const { openWorldInput, bossInput, forecastOpenWorldInput } = await import(`data:text/javascript;base64,${Buffer.from(helper).toString('base64')}`);
const preferences = {
  main: ['prism', 'precision', 'wingShots', 'piercing', 'chain', 'shatter', 'doubleDash', 'reserveAmmo', 'vent', 'division', 'droneBurst', 'droneHoming', 'orbitBlade', 'intercept', 'slow', 'graze', 'revive', 'magnet'],
  drone: ['orbitBlade', 'division', 'droneBurst', 'droneHoming', 'slow', 'intercept', 'prism', 'precision', 'wingShots', 'piercing', 'chain', 'shatter', 'doubleDash', 'vent', 'reserveAmmo', 'graze', 'revive', 'magnet'],
  resource: ['doubleDash', 'vent', 'reserveAmmo', 'revive', 'graze', 'magnet', 'prism', 'precision', 'wingShots', 'division', 'droneBurst', 'droneHoming', 'orbitBlade', 'intercept', 'piercing', 'chain', 'shatter', 'slow'],
};
const round = n => Math.round(n * 1000) / 1000;
const hash = content => createHash('sha256').update(content).digest('hex');
for (const path of ['scripts/balance-v4.1.mjs', 'scripts/simulation-loader.mjs', 'scripts/balance-v4.mjs']) {
  loader.hashes[path] = hash(await readFile(resolve(root, path)));
}
const quick = process.env.MAFUYU_BALANCE_QUICK === '1';
const checkpointFile = resolve(root, `.tmp/balance-v4.1-${quick ? 'calibration-' : ''}checkpoint.json`);
const reportFile = resolve(output, quick ? 'balance-v4.1-calibration.json' : 'balance-v4.1.0.json');
// This signature protects all scenario parameters, decision logic and case ordering when only the report writer changes.
const harnessSource = await readFile(resolve(root, 'scripts/balance-v4.1.mjs'), 'utf8');
const signatureSpans = [['const preferences =', 'const round ='], ['function segment(', 'await mkdir(output'],
  ['for (const immortal of [false, true]) await sample(', 'if (report.cases.length !== report.plannedCases)']];
const executionSignature = hash(signatureSpans.map(([start, end]) => {
  const low = harnessSource.indexOf(`\n${start}`) + 1, high = harnessSource.indexOf(`\n${end}`) + 1;
  if (low <= 0 || high <= low) throw new Error('Balance execution-signature marker changed');
  return harnessSource.slice(low, high);
}).join('\n'));
let report = { version: '4.1.0', generatedAt: new Date().toISOString(), sourceHashes: loader.hashes, executionSignature,
  methods: 'Real fixed-60-Hz simulation, decisions every 100ms; final warnings have the existing 200ms reaction delay. Visible-projectile/ground-warning steering for normal-HP runs. All seven choices use seeded real offers. Q/E use physical press edges and legal resources. Separate immortal cases measure damage reachability, not survival. Exact aim/prediction is not human playtesting. No dynamic enemy HP or damage changes.',
  limitations: ['Synthetic controls use real press/release edges, not DOM/browser input; this is not a browser performance test.',
    'The inherited controller does not deliberately aim at exposed weakpoints, flank shields, or optimise module combinations; normal-HP failures alone do not prove impossible encounters.',
    'Generic module projectiles share their production damageSource category. Weakpoint damage is reported separately and never counted as enemy-body DPS.',
    'Immortal runs continually restore 3600 seconds of invulnerability; their survivability and resource availability are not human-play conclusions.',
    'Segment DPS includes intro/recovery time. Final-Boss seconds includes all six card intros, but excludes the preceding arrival warning.'],
  priority: getPriority(), matrix: { quick, campaignCases: quick ? 3 : 108, controlCases: quick ? 2 : 8 },
  plannedCases: quick ? 5 : 116, cases: [], status: 'running' };
function segment(w) { const boss = w.enemies.find(e => e.hp > 0 && e.spell); return boss ? `card:${boss.spell.cardIndex + 1}` : w.campaign.activeEncounter ?? `stage:${w.wave}`; }
function run(options) {
  const { seed, season = 's2', difficulty = 'normal', level = 7, companions = 3, profile = 'main', immortal = false, bossOnly = false, skills = true, policy = 'reactive' } = options;
  const sim = new GameSimulation(seed, difficulty);
  sim.reset('story', seed, difficulty, { season, carryover: season === 's2' ? { level, xp: 0, companions } : undefined });
  if (bossOnly) {
    sim.state.player.level = level;
    while (sim.state.companions.length < companions) sim.deployCompanion();
    const stage = season === 's1' ? 5 : 6;
    Object.assign(sim.state.campaign, { stage, phase: 'encounter', activeEncounter: season === 's1' ? 's1:mafuyu' : 's2:final' });
    sim.state.wave = stage; sim.state.status = 'playing'; sim.spawnEnemy('boss', 2000, 1780);
  }
  const rows = new Map(), choices = [], injuries = [], start = performance.now(), startCpu = process.cpuUsage();
  let input = { moveX: 0, moveY: 0, shoot: false, dash: false, bomb: false, beam: false, command: false, aimX: 2000, aimY: 1700 };
  let previousCharge = 0, qExpired = 0, tick = 0;
  while (sim.state.elapsed < (bossOnly ? 300 : 1200) && !['failed', 'complete'].includes(sim.state.status)) {
    if (sim.state.status === 'upgrade') {
      const offer = [...sim.state.build.choices], selected = [...offer].sort((a, b) => preferences[profile].indexOf(a) - preferences[profile].indexOf(b))[0];
      choices.push({ index: sim.state.build.choiceIndex, at: round(sim.state.elapsed), level: sim.state.player.level, companions: sim.state.companions.length, offer, selected });
      if (!sim.chooseUpgrade(selected)) throw new Error('Rejected real offered module');
      input = { ...input, dash: false, bomb: false, beam: false, command: false };
    }
    const w = sim.state, p = w.player, boss = w.enemies.find(e => e.hp > 0 && e.type === 'boss');
    if (immortal) p.invincible = 3600;
    if (tick % 6 === 0) {
      const previous = input;
      input = boss ? bossInput(sim, boss, previous, policy, immortal) : immortal ? openWorldInput(sim, previous, true) : forecastOpenWorldInput(sim, previous);
      input.beam = skills && !previous.beam && p.perfectWindow > 0 && p.dashTime <= 0;
      input.command = skills && !previous.command && p.commandCooldown <= 0;
      // Offensive dash is optional and obeys the same stock/cooldown; never aim it through nearby bodies.
      const clearDash = !w.enemies.some(e => e.hp > 0 && Math.hypot(e.x - p.x, e.y - p.y) < e.radius + 220);
      if (skills && policy === 'reactive' && !input.dash && !previous.dash && sim.dashCharges > 0 && p.perfectWindow <= 0 && clearDash && w.tick % 60 < 6) input.dash = true;
    }
    const key = segment(w);
    if (!rows.has(key)) rows.set(key, { id: key, startedAt: round(w.elapsed), endedAt: 0,
      hpStart: p.hp, hpEnd: p.hp, levelStart: p.level, levelEnd: p.level, companionsStart: w.companions.length, companionsEnd: w.companions.length,
      build: [...w.build.modules], seconds: 0, activeSeconds: 0, damage: 0, bossDamage: 0, weakpointDamage: 0, weakpointHits: 0,
      received: {}, sources: {}, targets: {}, modules: {}, beams: 0, commands: 0, interrupts: 0, shieldBreaks: 0, deviceBursts: 0, bombs: 0,
      dashes: 0, primaryShots: 0, kills: 0, pickups: {}, heatLockedSeconds: 0, firingSeconds: 0 });
    const row = rows.get(key); row.seconds += 1 / 60;
    if (w.enemies.length || w.bullets.some(b => b.owner === 'enemy') || w.hazards.length) row.activeSeconds += 1 / 60;
    if (p.overheated) row.heatLockedSeconds += 1 / 60;
    if (input.shoot && !p.overheated) row.firingSeconds += 1 / 60;
    const events = sim.step(input); tick++;
    row.endedAt = round(w.elapsed); row.hpEnd = p.hp; row.levelEnd = p.level; row.companionsEnd = w.companions.length;
    const fired = events.some(e => e.type === 'beam');
    if (previousCharge > 0 && p.perfectWindow === 0 && !fired && w.status === 'playing') qExpired++;
    previousCharge = p.perfectWindow;
    for (const e of events) {
      if (e.type === 'hit' && e.enemyType && e.amount > 0) {
        row.damage += e.amount; row.sources[e.damageSource ?? 'weakpoint'] = (row.sources[e.damageSource ?? 'weakpoint'] ?? 0) + e.amount;
        row.targets[e.enemyType] = (row.targets[e.enemyType] ?? 0) + e.amount;
        if (e.enemyType === 'boss') row.bossDamage += e.amount;
      }
      if (e.type === 'hit' && e.hitResult === 'weakpoint') { row.weakpointHits++; row.weakpointDamage += e.amount ?? 0; }
      if (e.type === 'damage') { row.received[e.damageSource ?? 'unknown'] = (row.received[e.damageSource ?? 'unknown'] ?? 0) + e.amount; injuries.push({ at: round(w.elapsed), segment: key, source: e.damageSource, hp: p.hp, bombs: p.bombs, dashCharges: sim.dashCharges }); }
      if (e.type === 'module') row.modules[e.moduleId] = (row.modules[e.moduleId] ?? 0) + 1;
      if (e.type === 'beam') row.beams++;
      if (e.type === 'command' && e.text === 'issued') row.commands++;
      if (e.type === 'interrupt') row.interrupts++;
      if (e.type === 'shieldBreak') row.shieldBreaks++;
      if (e.type === 'attack' && e.text === 'deviceBurst') row.deviceBursts++;
      if (e.type === 'bomb') row.bombs++;
      if (e.type === 'dash') row.dashes++;
      if (e.type === 'shot') row.primaryShots++;
      if (e.type === 'kill') row.kills++;
      if (e.type === 'pickup') row.pickups[e.pickupType] = (row.pickups[e.pickupType] ?? 0) + (e.amount ?? 0);
    }
  }
  const segments = [...rows.values()].map(row => ({ ...row, seconds: round(row.seconds), activeSeconds: round(row.activeSeconds), damage: round(row.damage), bossDamage: round(row.bossDamage),
    weakpointDamage: round(row.weakpointDamage), dps: round(row.damage / row.seconds), bossDps: round(row.bossDamage / row.seconds),
    activeDps: row.activeSeconds ? round(row.damage / row.activeSeconds) : 0,
    firingSeconds: round(row.firingSeconds), heatLockedSeconds: round(row.heatLockedSeconds) }));
  const cards = segments.filter(row => row.id.startsWith('card:'));
  const cpu = process.cpuUsage(startCpu), totals = { seconds: 0, activeSeconds: 0, damage: 0, bossDamage: 0, bombs: 0, beams: 0, commands: 0, interrupts: 0, shieldBreaks: 0, deviceBursts: 0 };
  for (const row of rows.values()) for (const key of Object.keys(totals)) totals[key] += row[key];
  for (const key of Object.keys(totals)) totals[key] = round(totals[key]);
  const finalBossSeconds = cards.reduce((n, row) => n + row.seconds, 0), finalBossDamage = cards.reduce((n, row) => n + row.bossDamage, 0);
  return { ...options, season, difficulty, level, companions, profile, immortal, skills, status: sim.state.status, elapsed: round(sim.state.elapsed),
    outcome: sim.state.status === 'complete' ? 'complete' : sim.state.status === 'failed' ? 'failed' : 'timeout',
    computeSeconds: round((performance.now() - start) / 1000), cpuSeconds: round((cpu.user + cpu.system) / 1e6), finalLevel: sim.state.player.level, finalCompanions: sim.state.companions.length,
    hp: sim.state.player.hp, choices, modules: sim.state.build.modules, catchup: sim.state.campaign.catchupStages,
    qExpired, injuries, totals, segments, finalBossSeconds: round(finalBossSeconds), finalBossDamage: round(finalBossDamage),
    finalBossDps: finalBossSeconds ? round(finalBossDamage / finalBossSeconds) : 0, lastCard: cards.at(-1)?.id ?? null };
}
await mkdir(output, { recursive: true });
await mkdir(resolve(root, '.tmp'), { recursive: true });
let resumeCount = 0, visitedCases = 0;
const harnessPath = 'scripts/balance-v4.1.mjs';
if (process.env.MAFUYU_BALANCE_RESUME === '1') {
  const saved = JSON.parse(await readFile(checkpointFile, 'utf8'));
  if (saved.version !== report.version || saved.plannedCases !== report.plannedCases || saved.executionSignature !== executionSignature) throw new Error('Cannot resume a different balance experiment');
  for (const [path, expected] of Object.entries(saved.sourceHashes)) {
    if (path !== harnessPath && loader.hashes[path] !== expected) throw new Error(`Cannot resume changed simulation/controller source: ${path}`);
  }
  if (Object.keys(loader.hashes).some(path => !(path in saved.sourceHashes))) throw new Error('Cannot resume a changed simulation dependency graph');
  report = saved; resumeCount = report.cases.length; report.status = 'running';
  report.harnessVersions ??= [{ hash: saved.sourceHashes[harnessPath], firstCase: 1 }];
  if (!report.harnessVersions.some(version => version.hash === loader.hashes[harnessPath])) report.harnessVersions.push({ hash: loader.hashes[harnessPath], firstCase: resumeCount + 1, reason: 'Atomic report writing and exact-case resume only; identical execution signature.' });
  report.resumeHistory ??= [];
  report.resumeHistory.push({ at: new Date().toISOString(), persistedCases: resumeCount, executionSignature });
  console.log(`Verified all simulation/controller hashes; resuming after ${resumeCount}/${report.plannedCases} persisted cases.`);
} else report.harnessVersions = [{ hash: loader.hashes[harnessPath], firstCase: 1 }];

async function withSharingRetry(action) {
  for (let attempt = 0; ; attempt++) {
    try { return await action(); }
    catch (error) {
      if (!['UNKNOWN', 'EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 9) throw error;
      await delay(Math.min(1000, 100 * 2 ** attempt));
    }
  }
}
async function atomicWrite(path, content) {
  const temporary = `${path}.${process.pid}.tmp`;
  await withSharingRetry(() => writeFile(temporary, content));
  await withSharingRetry(() => rename(temporary, path));
}
async function save() {
  const content = JSON.stringify(report, null, 2) + '\n';
  // Checkpoint first: even an externally locked public report cannot lose the finished case.
  await atomicWrite(checkpointFile, content);
  await atomicWrite(reportFile, content);
}
function caseKey(options) {
  return JSON.stringify([options.seed, options.season ?? 's2', options.difficulty ?? 'normal', options.level ?? 7, options.companions ?? 3,
    options.profile ?? 'main', options.immortal ?? false, options.bossOnly ?? false, options.skills ?? true, options.policy ?? 'reactive']);
}
async function sample(options) {
  if (visitedCases < resumeCount) {
    if (caseKey(options) !== caseKey(report.cases[visitedCases])) throw new Error(`Cannot resume reordered case ${visitedCases + 1}`);
    visitedCases++; return;
  }
  visitedCases++;
  let paused = false;
  while (await readFile(pauseFile).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) {
    if (!paused) console.log('Balance worker paused between cases for independent performance measurement.');
    paused = true; await delay(1000);
  }
  if (paused) console.log('Balance worker resumed.');
  const result = run(options); report.cases.push(result); await save();
  console.log(`${report.cases.length}/${report.plannedCases}: ${result.season} ${result.difficulty} Lv${result.level}/${result.companions} ${result.profile} ${result.immortal ? 'DPS' : 'normalHP'} ${result.skills ? 'QE' : 'noQE'} ${result.status}, total ${result.elapsed}s, final ${result.finalBossSeconds}s; CPU wall ${result.computeSeconds}s`);
  await delay(100);
}
for (const immortal of [false, true]) await sample({ seed: 41001, season: 's1', bossOnly: true, immortal });
if (quick) {
  for (const profile of Object.keys(preferences)) await sample({ seed: 41001, profile });
} else {
  for (const seed of [41001, 41002, 41003]) for (const difficulty of ['normal', 'hard']) for (const [level, companions] of [[4, 1], [7, 3], [10, 3]]) for (const profile of Object.keys(preferences)) for (const immortal of [false, true]) await sample({ seed, difficulty, level, companions, profile, immortal });
  for (const profile of Object.keys(preferences)) await sample({ seed: 41001, profile, skills: false });
  for (const policy of ['circle', 'oldLane']) await sample({ seed: 41001, season: 's1', bossOnly: true, skills: false, policy });
  await sample({ seed: 41001, season: 's2', profile: 'main', skills: false, immortal: true });
}
if (report.cases.length !== report.plannedCases) throw new Error(`Incomplete matrix: ${report.cases.length}/${report.plannedCases}`);
report.changedSourcesAfterRun = [];
for (const [path, expected] of Object.entries(report.sourceHashes)) {
  const finalHash = hash(await readFile(resolve(root, path)));
  const knownWriter = path === harnessPath && report.harnessVersions.some(version => version.hash === finalHash);
  if (finalHash !== expected && !knownWriter) report.changedSourcesAfterRun.push(path);
}
report.calibrationOnly = quick || report.changedSourcesAfterRun.length > 0;
report.status = 'complete'; report.finishedAt = new Date().toISOString(); await save();
