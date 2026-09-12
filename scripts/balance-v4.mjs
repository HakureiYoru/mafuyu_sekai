import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { getPriority, setPriority } from 'node:os';
import { setTimeout as yieldBetweenCases } from 'node:timers/promises';
import ts from 'typescript';

// Run with `node scripts/balance-v4.mjs`. This loads the real TypeScript simulation in memory.
// The only source instrumentation adds optional log labels to existing damage calls; it changes no formula.
const root = resolve(import.meta.dirname, '..'), out = resolve(root, 'docs/validation');
if (process.env.MAFUYU_BALANCE_REPORT_ONLY === '1') {
  const existing = JSON.parse(await readFile(resolve(out, 'balance-v4.0.0.json'), 'utf8'));
  existing.progress = { completedCampaignCases: existing.campaignRuns.length, plannedCampaignCases: 36, status: existing.campaignRuns.length === 36 ? 'complete' : 'partial' };
  await attachReportMetadata(existing);
  await writeFile(resolve(out, 'balance-v4.0.0.json'), `${JSON.stringify(existing, null, 2)}\n`);
  await writeFile(resolve(out, 'balance-v4.0.0.md'), markdownReport(existing));
  console.log('Refreshed the report without running any simulation.');
  process.exit(0);
}
const hashes = {}, cache = new Map();
const requestedPriority = Number(process.env.MAFUYU_BALANCE_PRIORITY ?? 10);
setPriority(requestedPriority);
console.log(`Balance worker priority: ${getPriority()} (10 = BelowNormal on Windows).`);
const instrumentation = [
  ['this.damageEnemy(enemy, b.damage, { x: b.prevX, y: b.prevY });', "this.damageEnemy(enemy, b.damage, { x: b.prevX, y: b.prevY }, 'projectile:' + (b.kind === 'module' ? ({3:'shatter',4:'wingShots',5:'droneBurst'}[b.radius] ?? 'module') : b.kind));"],
  ['this.damageEnemy(this.impacts[i].enemy, dash.damage * buildDamageMultiplier(this.state.build), { x: p.x, y: p.y });', "this.damageEnemy(this.impacts[i].enemy, dash.damage * buildDamageMultiplier(this.state.build), { x: p.x, y: p.y }, 'dashBeam');"],
  ['this.damageEnemy(enemy, 12 * buildDamageMultiplier(this.state.build), { x: p.x, y: p.y });', "this.damageEnemy(enemy, 12 * buildDamageMultiplier(this.state.build), { x: p.x, y: p.y }, 'prismBeam');"],
  ['this.damageEnemy(enemy, 4 * buildDamageMultiplier(this.state.build), { x: companion.x, y: companion.y });', "this.damageEnemy(enemy, 4 * buildDamageMultiplier(this.state.build), { x: companion.x, y: companion.y }, 'orbitBlade');"],
  ['this.damageEnemy(e, BALANCE.bomb.damage);', "this.damageEnemy(e, BALANCE.bomb.damage, undefined, 'bomb');"],
  ['this.damageEnemy(target, 5 * multiplier, enemy);', "this.damageEnemy(target, 5 * multiplier, enemy, 'chain');"],
  ['this.damageEnemy(e, 99999);', "this.damageEnemy(e, 99999, undefined, 'contactMine');"],
  ['if (hazard.active && p.invincible <= EPSILON && hit) this.damagePlayer();', "if (hazard.active && p.invincible <= EPSILON && hit) this.damagePlayer(undefined, hazard.kind);"],
  ['this.damagePlayer(b.damage);', "this.damagePlayer(b.damage, 'enemyProjectile');"],
  ['damagePlayer: () => this.damagePlayer(),', "damagePlayer: () => this.damagePlayer(undefined, 'miniLaser'),"],
];
async function moduleUrl(file) {
  file = resolve(file); if (cache.has(file)) return cache.get(file);
  let source = await readFile(file, 'utf8');
  hashes[relative(root, file).replaceAll('\\', '/')] = createHash('sha256').update(source).digest('hex');
  if (file.endsWith('simulation.ts')) {
    for (const [before, after] of instrumentation) {
      if (!source.includes(before)) throw new Error(`Damage instrumentation no longer matches: ${before}`);
      source = source.replace(before, after);
    }
    source = source.replaceAll('this.damagePlayer();', "this.damagePlayer(undefined, 'body');");
  }
  if (file.endsWith('fairness.test.ts')) {
    // Reuse the already-tested visible-attack route controller; do not register or run Vitest suites.
    source = source.replace("import { describe, expect, it } from 'vitest';", '');
    const marker = source.indexOf("describe('complete committed spellcard routes");
    if (marker < 0) throw new Error('Fairness controller export marker changed');
    source = source.slice(0, marker) + '\nexport { steering, projectileForecast, minimumDistance, crossesBeam };\n';
  }
  let js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  js = js.replaceAll('import.meta.env.BASE_URL', '"/"');
  for (const match of [...js.matchAll(/from\s+(['"])(\.[^'"]+)\1/g)]) {
    const target = resolve(dirname(file), match[2].endsWith('.ts') ? match[2] : `${match[2]}.ts`);
    js = js.replace(match[0], `from ${JSON.stringify(await moduleUrl(target))}`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
  cache.set(file, url); return url;
}
const { GameSimulation } = await import(await moduleUrl(resolve(root, 'src/game/simulation.ts')));
const { steering, projectileForecast, minimumDistance, crossesBeam } = await import(await moduleUrl(resolve(root, 'src/game/fairness.test.ts')));
const { MODULES } = await import(await moduleUrl(resolve(root, 'src/game/upgrades.ts')));
const { SPELL_CARDS } = await import(await moduleUrl(resolve(root, 'src/game/spellcards.ts')));
const STEP = 1 / 60, seed = 40040;
const profiles = {
  main: ['wingShots', 'precision', 'piercing', 'chain', 'shatter', 'prism', 'reserveAmmo', 'vent', 'division', 'droneBurst', 'doubleDash', 'droneHoming', 'intercept', 'magnet', 'orbitBlade', 'slow', 'graze', 'revive'],
  drone: ['droneBurst', 'division', 'droneHoming', 'orbitBlade', 'slow', 'intercept', 'wingShots', 'precision', 'vent', 'reserveAmmo', 'doubleDash', 'magnet', 'piercing', 'chain', 'shatter', 'prism', 'graze', 'revive'],
  resource: ['doubleDash', 'vent', 'reserveAmmo', 'revive', 'graze', 'magnet', 'wingShots', 'precision', 'droneBurst', 'division', 'droneHoming', 'intercept', 'orbitBlade', 'piercing', 'chain', 'shatter', 'prism', 'slow'],
};
const round = value => Math.round(value * 1000) / 1000;
function segmentKey(w) {
  const boss = w.enemies.find(e => e.type === 'boss' && e.hp > 0);
  if (boss?.spell) return `${w.seasonId}:card${boss.spell.cardIndex + 1}`;
  return w.campaign.activeEncounter ?? `${w.seasonId}:stage${w.wave}`;
}
function openWorldInput(sim, previous, immortal) {
  const w = sim.state, p = w.player, living = w.enemies.filter(e => e.hp > 0 && (e.disabledUntil ?? 0) <= w.elapsed);
  let target = living.find(e => e.role === 'miniboss') ?? living.reduce((best, e) => !best || Math.hypot(e.x - p.x, e.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y) ? e : best, null);
  const pickups = w.pickups.filter(item => item.type !== 'xp' || p.level < 10 || w.seasonId === 's2');
  let dx, dy;
  if (target) {
    const tx = target.x - p.x, ty = target.y - p.y, distance = Math.max(1, Math.hypot(tx, ty));
    const desired = target.role === 'miniboss' ? 440 : 300;
    dx = tx / distance * (distance > desired + 60 ? 1 : distance < desired - 70 ? -1 : 0) - ty / distance * 0.65;
    dy = ty / distance * (distance > desired + 60 ? 1 : distance < desired - 70 ? -1 : 0) + tx / distance * 0.65;
  } else {
    const item = pickups.reduce((best, item) => !best || Math.hypot(item.x - p.x, item.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y) ? item : best, null);
    dx = item ? item.x - p.x : 2000 - p.x; dy = item ? item.y - p.y : 2000 - p.y;
  }
  for (const enemy of living) {
    const x = p.x - enemy.x, y = p.y - enemy.y, distance = Math.max(1, Math.hypot(x, y)), danger = enemy.radius + 110;
    if (distance < danger + 100) { const scale = (danger + 100 - distance) / 40; dx += x / distance * scale; dy += y / distance * scale; }
  }
  dx += p.x < 300 ? 3 : p.x > 3700 ? -3 : 0; dy += p.y < 300 ? 3 : p.y > 3700 ? -3 : 0;
  const length = Math.max(1e-8, Math.hypot(dx, dy));
  const danger = w.bullets.some(b => b.owner === 'enemy' && Math.hypot(b.x - p.x, b.y - p.y) < 115)
    || living.some(e => Math.hypot(e.x - p.x, e.y - p.y) < e.radius + 90);
  const dash = !previous.dash && p.dashCooldown <= 0 && (danger || (immortal && target && w.tick % 24 === 0));
  const bomb = !immortal && !previous.bomb && p.bombs > 0 && p.hp <= 2 && danger && p.invincible <= 0 && p.dashCooldown > 0;
  return { moveX: dx / length, moveY: dy / length, focus: false, shoot: !!target, dash, bomb,
    aimX: target?.x ?? p.x, aimY: target?.y ?? p.y };
}
function bossInput(sim, boss, previous, policy, immortal) {
  const p = sim.state.player;
  let input;
  if (policy === 'circle') {
    const phase = sim.state.elapsed * 300 / 320;
    const x = 2000 + Math.cos(phase) * 320, y = 2060 + Math.sin(phase) * 320;
    input = { moveX: x - p.x, moveY: y - p.y, dash: false, bomb: false, focus: false };
  } else if (policy === 'oldLane') {
    // Old strategy: one fixed side offset from the boss, then stand and focus-fire.
    const angle = Math.PI / 2 + 0.9, x = boss.x + Math.cos(angle) * 520, y = boss.y + Math.sin(angle) * 520;
    input = { moveX: Math.abs(x - p.x) > 4 ? x - p.x : 0, moveY: Math.abs(y - p.y) > 4 ? y - p.y : 0,
      dash: false, bomb: false, focus: Math.hypot(x - p.x, y - p.y) <= 5 };
  } else if (immortal) {
    input = { moveX: 0, moveY: 0, focus: true, dash: !previous.dash && p.dashCooldown <= 0, bomb: false };
  } else {
    input = steering(sim, boss, previous);
    input.focus = Math.hypot(input.moveX, input.moveY) < 0.1;
    const danger = sim.state.bullets.some(b => b.owner === 'enemy' && Math.hypot(b.x - p.x, b.y - p.y) < 65);
    input.bomb = !previous.bomb && p.bombs > 0 && p.hp <= 2 && danger && p.invincible <= 0 && p.dashCooldown > 0;
  }
  return { ...input, shoot: true, aimX: boss.x, aimY: boss.y };
}
// A bounded paired diagnostic, kept separate from the original matrix. This fixes the
// open-world bot's documented blindness to visible ground warnings and returning shots.
// It still knows no future AI choice, does not aim at shield weak points, and never adds HP.
function forecastOpenWorldInput(sim, previous) {
  const base = openWorldInput(sim, previous, false), w = sim.state, p = w.player;
  if (p.dashTime > 0) return { ...base, moveX: previous.moveX, moveY: previous.moveY, dash: false, bomb: false };
  const bullets = w.bullets.filter(b => b.owner === 'enemy' && Math.hypot(b.x - p.x, b.y - p.y) < 700).map(projectileForecast);
  const hazards = w.hazards.filter(h => h.active || h.warningDuration - h.warning >= 0.2);
  const bodies = w.enemies.filter(e => e.hp > 0 && (e.disabledUntil ?? 0) <= w.elapsed && Math.hypot(e.x - p.x, e.y - p.y) < 600);
  const bounds = w.arena ?? { x: 0, y: 0, width: 4000, height: 4000 };
  const directions = [{ x: 0, y: 0 }, ...Array.from({ length: 16 }, (_, i) => ({ x: Math.cos(i * Math.PI / 8), y: Math.sin(i * Math.PI / 8) }))];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const cost = (x, y, dash) => {
    const points = [{ x: p.x, y: p.y }]; let value = dash ? 600 : 0;
    for (let i = 1; i <= 5; i++) {
      const time = i * 0.18, distance = 300 * time + (dash ? 780 * Math.min(0.18, time) : 0);
      const rawX = p.x + x * distance, rawY = p.y + y * distance;
      const point = { x: clamp(rawX, bounds.x + 18, bounds.x + bounds.width - 18), y: clamp(rawY, bounds.y + 18, bounds.y + bounds.height - 18) };
      points.push(point); value += 5 * (Math.abs(rawX - point.x) + Math.abs(rawY - point.y));
      if (dash && i === 1) continue;
      for (const e of bodies) {
        const clearance = Math.hypot(point.x - e.x - e.vx * time, point.y - e.y - e.vy * time) - e.radius - 18;
        value += clearance < 5 ? 1e7 : 80 * Math.exp(-clearance / 28);
      }
      for (const h of hazards) {
        const low = Math.max((i - 1) * 0.18, h.active ? 0 : h.warning), high = Math.min(time, h.warning + h.life);
        if (low > high) continue;
        const before = points[i - 1], from = (low - (i - 1) * 0.18) / 0.18, to = (high - (i - 1) * 0.18) / 0.18;
        const ax = before.x + (point.x - before.x) * from, ay = before.y + (point.y - before.y) * from;
        const bx = before.x + (point.x - before.x) * to, by = before.y + (point.y - before.y) * to;
        const hit = h.kind === 'beam' ? crossesBeam(ax, ay, bx, by, h.x, h.y, h.angle ?? 0, h.length ?? 0, h.width ?? 0)
          : minimumDistance(ax - h.x, ay - h.y, bx - h.x, by - h.y) < h.radius + 13;
        if (hit) value += 1e7 * (2 - time);
      }
    }
    for (const b of bullets) for (let i = 1; i <= 5; i++) {
      if (dash && i === 1) continue;
      const clearance = minimumDistance(b.points[i - 1].x - points[i - 1].x, b.points[i - 1].y - points[i - 1].y,
        b.points[i].x - points[i].x, b.points[i].y - points[i].y) - b.radius - 7;
      value += clearance < 2 ? 1e7 * (2 - i * 0.18) : 80 * Math.exp(-clearance / 14);
    }
    value += Math.hypot(points[5].x - p.x - base.moveX * 300, points[5].y - p.y - base.moveY * 300) * 0.1;
    value += (1 - x * previous.moveX - y * previous.moveY) * 2;
    return value;
  };
  let best = { x: 0, y: 0, dash: false, value: cost(0, 0, false) };
  for (const d of directions) { const value = cost(d.x, d.y, false); if (value < best.value) best = { ...d, dash: false, value }; }
  if (best.value > 1e5 && sim.dashCharges > 0 && !previous.dash) for (const d of directions.slice(1)) {
    const value = cost(d.x, d.y, true); if (value < best.value) best = { ...d, dash: true, value };
  }
  return { ...base, moveX: best.x, moveY: best.y, dash: best.dash,
    focus: Math.hypot(best.x, best.y) < 0.1,
    bomb: !previous.bomb && p.bombs > 0 && p.hp <= 2 && p.invincible <= 0 && best.value > 1e5 && !best.dash };
}
function run({ season = 's2', level, companions, profile = 'main', difficulty = 'normal', immortal = false, policy = 'reactive', bossOnly = false, maxSeconds = 1200 }) {
  const sim = new GameSimulation(seed, difficulty);
  sim.reset('story', seed, difficulty, { season, carryover: season === 's2' ? { level, xp: 0, companions } : undefined });
  if (bossOnly) {
    sim.state.player.level = level;
    while (sim.state.companions.length < companions) sim.deployCompanion();
    // Use the director's real final objective, so the six-card victory has normal terminal cleanup.
    sim.state.campaign.stage = season === 's1' ? 5 : 6; sim.state.wave = sim.state.campaign.stage;
    sim.state.campaign.phase = 'encounter'; sim.state.campaign.activeEncounter = season === 's1' ? 's1:mafuyu' : 's2:final';
    sim.state.status = 'playing';
    const boss = sim.spawnEnemy('boss', 2000, 1780); boss.encounterId = sim.state.campaign.activeEncounter;
  }
  const rows = new Map(), choices = [], damageTimeline = [], started = performance.now(), startedCpu = process.cpuUsage();
  const row = key => {
    if (!rows.has(key)) rows.set(key, { id: key, elapsed: 0, activeCombat: 0, damageDealt: 0, damageTaken: 0,
      damageSources: {}, receivedSources: {}, targetTypes: {}, bombs: 0, bombsCollected: 0, hpRecovered: 0, dashes: 0, kills: 0, playerShots: 0, enemyShots: 0,
      startAt: sim.state.elapsed, endAt: sim.state.elapsed, hpStart: sim.state.player.hp, hpEnd: sim.state.player.hp,
      levelStart: sim.state.player.level, levelEnd: sim.state.player.level, modules: [...sim.state.build.modules] });
    return rows.get(key);
  };
  const originalDamage = sim.damageEnemy.bind(sim), originalPlayerDamage = sim.damagePlayer.bind(sim);
  sim.damageEnemy = (enemy, amount, from, label = 'unclassified') => {
    const before = enemy.hp, card = enemy.spell?.cardIndex, disabled = enemy.disabledUntil ?? 0;
    const targetRow = row(enemy.spell ? `${season}:card${card + 1}` : segmentKey(sim.state));
    originalDamage(enemy, amount, from);
    const applied = Math.max(0, enemy.spell?.cardIndex !== card || (enemy.disabledUntil ?? 0) > disabled ? before : before - enemy.hp);
    if (label !== 'contactMine') {
      targetRow.damageDealt += applied; targetRow.damageSources[label] = (targetRow.damageSources[label] ?? 0) + applied;
      targetRow.targetTypes[enemy.type] = (targetRow.targetTypes[enemy.type] ?? 0) + applied;
    }
  };
  sim.damagePlayer = (amount, label = 'unclassified') => {
    const w = sim.state, p = w.player, before = p.hp, targetRow = row(segmentKey(w));
    const availableDash = sim.dashCharges, cooldown = p.dashCooldown;
    originalPlayerDamage(amount);
    const applied = Math.max(0, before - p.hp);
    targetRow.damageTaken += applied; targetRow.receivedSources[label] = (targetRow.receivedSources[label] ?? 0) + applied;
    if (applied > 0) damageTimeline.push({ at: round(w.elapsed), segment: targetRow.id, source: label, hpBefore: before, hpAfter: p.hp,
      level: p.level, x: round(p.x), y: round(p.y), dashCharges: availableDash, dashCooldown: round(cooldown), bombs: p.bombs,
      hazards: w.hazards.filter(h => Math.hypot(h.x - p.x, h.y - p.y) < 250).map(h => ({ kind: h.kind, active: h.active,
        warning: round(h.warning), radius: h.radius, distance: round(Math.hypot(h.x - p.x, h.y - p.y)) })) });
  };
  const originalPickup = sim.collectPickup.bind(sim);
  sim.collectPickup = pickup => {
    const p = sim.state.player, hp = p.hp, bombs = p.bombs, current = row(segmentKey(sim.state));
    const result = originalPickup(pickup);
    current.hpRecovered += Math.max(0, p.hp - hp); current.bombsCollected += Math.max(0, p.bombs - bombs);
    return result;
  };
  let input = { moveX: 0, moveY: 0, aimX: 2000, aimY: 2000, shoot: false, dash: false, bomb: false }, tick = 0, lastCard = null;
  while (sim.state.elapsed < maxSeconds && !['failed', 'complete'].includes(sim.state.status)) {
    if (sim.state.status === 'upgrade') {
      const offer = [...sim.state.build.choices], selected = [...offer].sort((a, b) => profiles[profile].indexOf(a) - profiles[profile].indexOf(b))[0];
      choices.push({ index: sim.state.build.choiceIndex, at: round(sim.state.elapsed), level: sim.state.player.level,
        offer, selected, selectedName: MODULES[selected].name });
      if (!sim.chooseUpgrade(selected)) throw new Error('A real offered module was rejected');
      input = { ...input, dash: false, bomb: false };
    }
    const w = sim.state, p = w.player, boss = w.enemies.find(e => e.type === 'boss' && e.hp > 0);
    if (boss) lastCard = boss.spell.cardIndex;
    if (immortal) p.invincible = 3600;
    if (tick % 6 === 0) input = boss ? bossInput(sim, boss, input, policy, immortal)
      : policy === 'visibleForecast' ? forecastOpenWorldInput(sim, input) : openWorldInput(sim, input, immortal);
    else if (boss) { input.aimX = boss.x; input.aimY = boss.y; }
    const current = row(segmentKey(w)); current.elapsed += STEP;
    if (w.enemies.some(e => e.hp > 0) || w.bullets.some(b => b.owner === 'enemy') || w.hazards.length) current.activeCombat += STEP;
    const events = sim.step(input); tick++;
    for (const event of events) {
      if (event.type === 'bomb') current.bombs++;
      if (event.type === 'dash') current.dashes++;
      if (event.type === 'kill') current.kills++;
      if (event.type === 'shot') current.playerShots++;
      if (event.type === 'enemyShot') current.enemyShots++;
    }
    current.endAt = w.elapsed; current.hpEnd = p.hp; current.levelEnd = p.level;
  }
  const segments = [...rows.values()].map(segment => ({ ...segment, elapsed: round(segment.elapsed), activeCombat: round(segment.activeCombat),
    startAt: round(segment.startAt), endAt: round(segment.endAt), damageDealt: round(segment.damageDealt),
    activeDps: round(segment.damageDealt / Math.max(STEP, segment.activeCombat)), wallClockDps: round(segment.damageDealt / Math.max(STEP, segment.elapsed)),
    damageSources: Object.fromEntries(Object.entries(segment.damageSources).map(([key, value]) => [key, round(value)])) }));
  const usedCpu = process.cpuUsage(startedCpu);
  return { season, difficulty, carryover: { level, xp: 0, companions }, profile, policy, immortal, bossOnly, seed,
    status: sim.state.status, elapsed: round(sim.state.elapsed), cpuSeconds: round((usedCpu.user + usedCpu.system) / 1e6),
    computeWallSeconds: round((performance.now() - started) / 1000), damageTimeline,
    hp: sim.state.player.hp, level: sim.state.player.level, companions: sim.state.companions.length, resonance: sim.state.build.resonance,
    modules: [...sim.state.build.modules], choices, defeated: [...sim.state.campaign.defeatedEncounters],
    lastCard,
    bombsUsed: segments.reduce((sum, segment) => sum + segment.bombs, 0), damageTaken: segments.reduce((sum, segment) => sum + segment.damageTaken, 0),
    bombsCollected: segments.reduce((sum, segment) => sum + segment.bombsCollected, 0), hpRecovered: segments.reduce((sum, segment) => sum + segment.hpRecovered, 0),
    activeCombatSeconds: round(segments.reduce((sum, segment) => sum + segment.activeCombat, 0)), segments };
}
const diagnosticOnly = process.env.MAFUYU_BALANCE_DIAGNOSTIC_ONLY === '1';
const existingReport = diagnosticOnly ? JSON.parse(await readFile(resolve(out, 'balance-v4.0.0.json'), 'utf8')) : null;
if (existingReport) for (const [file, hash] of Object.entries(hashes)) {
  if (existingReport.sourceHashes[file] !== hash) throw new Error(`Cannot mix diagnostics with a different source snapshot: ${file}`);
}
const report = existingReport ?? { version: '4.0.0', generatedAt: new Date().toISOString(), sourceHashes: hashes, seed, processPriority: getPriority(), caseYieldMs: 100,
  methods: {
    normalRuns: 'Normal HP, no added invulnerability. Deterministic input-only bot, 100 ms decisions, 200 ms visible-telegraph response in final-Boss encounters, exact aim at target centres, legal dash/bomb cooldowns. Open-world movement is a simpler approach/orbit/repulsion controller; it does not inspect ground telegraphs or deliberately spend a second stored dash charge.',
    damageRuns: 'Separate immortal runs set player.invincible=3600 each simulation tick. No enemy HP, damage, spawn, clocks or module offers changed. These measure output reachability and later content; they do not validate survival or balance.',
    sourceInstrumentation: 'In-memory TypeScript transpilation adds a fourth damageEnemy label / second damagePlayer label, ignored by production methods. Wrappers measure actual HP removed (not overkill) and classify damage sources. No worktree combat code is rewritten.',
    choices: 'All seven choices, where reached, come from the actual seeded three-option offer. Profiles rank available modules; no module is injected.',
    limitations: 'One seed per configuration, machine-perfect aim and deterministic prediction. Not human playtesting. DPS depends on movement, target availability, shield facing, pickups and acquired modules; immortal measurements are not completion claims.',
  }, spellHp: SPELL_CARDS, baselines: [], controls: [], campaignRuns: [] };
await mkdir(out, { recursive: true });
async function save() {
  report.progress = { completedCampaignCases: report.campaignRuns.length, plannedCampaignCases: 36, status: report.campaignRuns.length === 36 ? 'complete' : 'partial' };
  await attachReportMetadata(report);
  await writeFile(resolve(out, 'balance-v4.0.0.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolve(out, 'balance-v4.0.0.md'), markdownReport(report));
}
if (!diagnosticOnly) for (const immortal of [false, true]) {
  const result = run({ season: 's1', level: 7, companions: 3, bossOnly: true, immortal, maxSeconds: 240 });
  report.baselines.push(result); await save(); console.log(`S1 Lv7/3 ${immortal ? 'DPS' : 'normal'}: ${result.status}, ${result.elapsed}s, HP ${result.hp}`);
  await yieldBetweenCases(100);
}
if (!diagnosticOnly) for (const policy of ['circle', 'oldLane']) for (const level of [7, 10]) {
  const result = run({ season: 's1', level, companions: 3, bossOnly: true, policy, maxSeconds: 240 });
  report.controls.push(result); await save(); console.log(`S1 control ${policy} Lv${level}: ${result.status}, card ${result.lastCard === null ? '-' : result.lastCard + 1}, ${result.elapsed}s`);
  await yieldBetweenCases(100);
}
const quick = process.env.MAFUYU_BALANCE_QUICK === '1';
if (!diagnosticOnly) for (const difficulty of quick ? ['normal'] : ['normal', 'hard']) for (const [level, companions] of quick ? [[7, 3]] : [[4, 1], [7, 3], [10, 3]]) {
  for (const profile of Object.keys(profiles)) for (const immortal of [false, true]) {
    const result = run({ level, companions, profile, difficulty, immortal });
    report.campaignRuns.push(result); await save();
    console.log(`S2 ${difficulty} Lv${level}/${companions} ${profile} ${immortal ? 'DPS' : 'normal'}: ${result.status}, ${result.elapsed}s, choices ${result.choices.length}, HP ${result.hp}`);
    await yieldBetweenCases(100);
  }
}
if (diagnosticOnly) {
  report.diagnosticMethods = 'Paired input-controller experiment only: the same seed, real offers, HP and combat source hashes. Open-world bot now forecasts already-visible projectiles for 0.9 s in 16 candidate walking directions, reads displayed ground warnings after 200 ms, and can spend a legal stored dash. It still uses no future AI decisions, shield weak-point targeting or bomb injection; final-Boss control is unchanged. Baseline failures remain in campaignRuns.';
  report.diagnosticRuns = [];
  for (const [level, companions, difficulty, profile] of [[4, 1, 'normal', 'resource'], [7, 3, 'normal', 'resource'], [4, 1, 'hard', 'resource'], [4, 1, 'hard', 'main']]) {
    const result = run({ level, companions, difficulty, profile, policy: 'visibleForecast' });
    report.diagnosticRuns.push(result); await save();
    console.log(`Paired diagnostic ${difficulty} Lv${level}/${companions} ${profile}: ${result.status}, ${result.elapsed}s, choices ${result.choices.length}, HP ${result.hp}`);
    await yieldBetweenCases(100);
  }
}
function markdownReport(report) {
const row = run => `| ${run.difficulty} | Lv${run.carryover.level}/${run.carryover.companions} 子机 | ${run.profile} | ${run.immortal ? '无敌输出测量' : '正常生命流程'} | ${run.status} | ${run.elapsed} | ${run.activeCombatSeconds} | ${run.damageTaken} | ${run.bombsUsed} | ${run.choices.length}/7 |`;
const markdown = `# v4.0.0 模拟平衡测量\n\n本记录来自真实 GameSimulation 的自动输入，**不是人工试玩，也不是通过率调查**。正常生命流程与额外无敌的输出测量分开列出；单个固定种子不代表玩家总体。完整逐段、各小 Boss、六张符卡的实际伤害来源、受伤来源、弹药动作和模块选项见同名 JSON。\n\n普通 S1 Lv7/三子机基准：${report.baselines.map(run => `${run.immortal ? '无敌输出' : '正常生命'} ${run.status}，${run.elapsed} 秒，受伤 ${run.damageTaken}，炸弹 ${run.bombsUsed}`).join('；')}。目标区间为 75–120 秒。\n\n旧解法对照：${report.controls.map(run => `${run.policy} Lv${run.carryover.level}：${run.status}，第 ${(run.lastCard ?? 0) + 1} 卡，${run.elapsed} 秒`).join('；')}。\n\n| 难度 | 初始继承 | 选取偏好 | 测量条件 | 结果 | 模拟总秒数 | 活跃战斗秒数 | 生命损失 | 炸弹消耗 | 实际选择次数 |\n|---|---|---|---|---|---:|---:|---:|---:|---:|\n${report.campaignRuns.map(row).join('\n')}\n\n每帧按 60 Hz 推进一次模拟；机器人每 100 ms 更新输入。最终 Boss 控制器读取已显示预告需经过 200 ms；基线开放世界控制器只做接近、绕圈和局部推离，不读取地面预告，也没有折返弹的未来路径预测。瞄准为精确目标中心，移动、射击、冲刺、炸弹都通过真实输入。开放世界基线持续移动，未主动启用 precision 的静步增伤；双冲刺模块取得后仍只在冷却归零时使用，因此这些机器人记录不代表模块最佳表现。无敌输出测量每 tick 设置 3600 秒无敌，最终 Boss 时站定聚焦并按冷却使用冲刺；不改变伤害、血量、刷怪、技能时钟或选项。\n\nDPS 分母分别保存本段模拟总时间和本段存在活敌/敌弹/危险区域的活跃时间。伤害按实际扣除的 HP 计算并排除溢出伤害；修复造成的再生生命仍是有效伤害。模块严格从七次真实选项中选取，按主炮、子机或资源优先级排序；实际构筑可能混合分支。\n\n脚本：\`node scripts/balance-v4.mjs\`。源文件 SHA-256 与采样配置随 JSON 保存。此次记录先给出数据，未自动改动平衡。\n`;
const progress = `\n当前矩阵：**${report.campaignRuns.length}/36 个流程 case**。${report.campaignRuns.length === 36 ? '两档难度、三档继承、三类偏好、两种生命条件已记录。' : '这是阶段性数据；其余 case 尚未运行，为独立 GPU 性能测量暂停 CPU 模拟。'}\n`;
const baseline = report.baselines.find(run => !run.immortal);
const baselineRows = baseline?.segments.filter(segment => segment.id.includes(':card')).map(segment =>
  `| ${segment.id} | ${segment.elapsed} | ${segment.damageDealt} | ${segment.activeDps} | ${segment.damageTaken} | ${segment.bombs} |`).join('\n') ?? '';
const details = `\n普通 S1 Lv7/三子机正常生命的逐卡记录：\n\n| 符卡 | 秒数 | 有效伤害 | 活跃 DPS | 生命损失 | 炸弹 |\n|---|---:|---:|---:|---:|---:|\n${baselineRows}\n\nJSON 的 damageSources 按主炮、子机、特殊弹、小炸弹、模块弹、贯穿炮、连锁与炸弹分类；receivedSources 区分敌弹、光束、地面区域和身体接触。targetTypes 区分 Boss 与可击停节点，因此节点卡的总体 DPS 包含对部件的伤害，不能直接当作削减 Boss 血条的 DPS。bombsCollected / hpRecovered 记录实际拾取补给；消耗炸弹可能超过开局三枚，来自流程内真实掉落，并非额外注入。\n`;
return markdown + progress + details + analyticalAppendix(report);
}
async function attachReportMetadata(report) {
  const results = await Promise.all(Object.entries(report.sourceHashes).map(async ([file, hash]) => ({ file,
    matches: createHash('sha256').update(await readFile(resolve(root, file), 'utf8')).digest('hex') === hash })));
  report.sourceVerification = { checkedAt: new Date().toISOString(), allMatch: results.every(x => x.matches), files: results };
  report.reportGeneratorSha256 = createHash('sha256').update(await readFile(resolve(root, 'scripts/balance-v4.mjs'), 'utf8')).digest('hex');
  report.targets = { s1NormalLv7ThreeCompanionsBossSeconds: [75, 120], s2BossSeconds: [120, 180], s2CampaignSeconds: [600, 900] };
  for (const result of [...report.baselines, ...report.controls, ...report.campaignRuns, ...(report.diagnosticRuns ?? [])]) {
    result.stopReason = ['playing', 'upgrade'].includes(result.status) ? 'simulation_time_limit' : result.status;
    result.timeLimitSeconds = result.bossOnly ? 240 : 1200;
    const cards = result.segments.filter(s => s.id.includes(':card'));
    result.finalBoss = { reached: cards.length > 0, cardsReached: cards.length,
      completed: result.status === 'complete', simulatedSeconds: roundValue(cards.reduce((sum, s) => sum + s.elapsed, 0)),
      activeSeconds: roundValue(cards.reduce((sum, s) => sum + s.activeCombat, 0)),
      objectiveHpRemoved: roundValue(cards.reduce((sum, s) => sum + (s.targetTypes.boss ?? 0), 0)),
      objectiveDps: cards.length ? roundValue(cards.reduce((sum, s) => sum + (s.targetTypes.boss ?? 0), 0) / cards.reduce((sum, s) => sum + s.activeCombat, 0)) : null };
    const [minimum, maximum] = result.season === 's1' ? [75, 120] : [120, 180];
    result.finalBoss.timeTargetAssessment = !result.finalBoss.completed ? 'not_completed'
      : result.finalBoss.simulatedSeconds < minimum ? 'below_range' : result.finalBoss.simulatedSeconds > maximum ? 'above_range' : 'within_range';
    result.campaignTimeTargetAssessment = result.bossOnly ? 'not_measured' : result.status !== 'complete' ? 'not_completed'
      : result.elapsed < 600 ? 'below_range' : result.elapsed > 900 ? 'above_range' : 'within_range';
  }
}
function roundValue(value) { return Math.round(value * 1000) / 1000; }
function analyticalAppendix(report) {
  if (report.campaignRuns.length !== 36) return '';
  const number = value => Number(value).toFixed(2);
  const cards = run => run.segments.filter(s => s.id.includes(':card'));
  const objective = (run, id) => {
    const s = run.segments.find(x => x.id === `s2:${id}`);
    return s ? `${number(s.elapsed)} / ${number((s.targetTypes[id] ?? 0) / s.activeCombat)}` : '未到达';
  };
  const totalDps = run => run.segments.reduce((sum, s) => sum + s.damageDealt, 0) / run.activeCombatSeconds;
  const diagnostics = report.diagnosticRuns ?? [];
  const diagnosticRows = diagnostics.map(run => {
    const original = report.campaignRuns.find(x => !x.immortal && x.difficulty === run.difficulty && x.profile === run.profile && x.carryover.level === run.carryover.level);
    return `| ${run.difficulty} Lv${run.carryover.level}/${run.carryover.companions} ${run.profile} | ${original.status} / ${original.elapsed} | ${run.stopReason} | ${run.elapsed} | ${run.activeCombatSeconds} | ${run.finalBoss.simulatedSeconds}${run.status === 'complete' ? '' : '（未结束）'} | ${run.finalBoss.objectiveDps ?? '未到达'} | ${run.damageTaken} / ${run.bombsUsed} |`;
  }).join('\n');
  const normalRows = [...report.campaignRuns.filter(x => !x.immortal && x.difficulty === 'normal'), ...diagnostics.filter(x => x.difficulty === 'normal')].map(run => {
    const stage = run.segments.filter(s => s.id.includes(':stage'));
    const final = cards(run);
    return `| Lv${run.carryover.level}/${run.carryover.companions} ${run.profile}${run.policy === 'visibleForecast' ? '（配对）' : ''} | ${run.status} | ${number(totalDps(run))} | ${stage.map(s => number(s.activeDps)).join(' / ')} | ${objective(run, 'palisade')} | ${objective(run, 'reprise')} | ${final.length ? `${number(run.finalBoss.simulatedSeconds)} / ${number(run.finalBoss.objectiveDps)}` : '未到达'} |`;
  }).join('\n');
  const outputRows = report.campaignRuns.filter(x => x.immortal).map(run => `| ${run.difficulty} Lv${run.carryover.level}/${run.carryover.companions} ${run.profile} | ${run.elapsed} | ${run.activeCombatSeconds} | ${objective(run, 'palisade')} | ${objective(run, 'reprise')} | ${number(run.finalBoss.simulatedSeconds)} / ${number(run.finalBoss.objectiveDps)} | ${cards(run).map(s => `${number(s.elapsed)}/${number((s.targetTypes.boss ?? 0) / s.activeCombat)}`).join(' · ')} |`).join('\n');
  const sources = run => Object.entries(run.segments.reduce((all, s) => {
    for (const [key, value] of Object.entries(s.damageSources)) all[key] = (all[key] ?? 0) + value;
    return all;
  }, {})).sort((a, b) => b[1] - a[1]).map(([name, value]) => `${name}=${number(value)}`).join('；');
  const sourceRows = [...report.campaignRuns.filter(x => !x.immortal && x.difficulty === 'normal'), ...diagnostics].map(run =>
    `| ${run.difficulty} Lv${run.carryover.level} ${run.profile}${run.policy === 'visibleForecast' ? '（配对）' : ''} | ${sources(run)} |`).join('\n');
  return `
## 完成情况与时间口径

原始矩阵 **36/36**：18 项正常生命、18 项无敌输出。正常生命基线 normal 为 4/9 完成、hard 为 1/9 完成；18/18 无敌输出全部到达七次真实选项并完成六卡。这里的比例仅是一个确定性控制器在一个种子的结果，不能外推玩家完成率。

S2 的总模拟时间包含六个 75 秒普通阶段、两场小 Boss 和最终六卡；活跃战斗时间排除没有活敌、敌弹和危险区域的空隙。最终 Boss 时间单列，包含六卡各自的短入场，不包含之前两个小 Boss 与 2 秒召唤等待。菜单选卡立即选择，未计入玩家思考时间。JSON 的 elapsed 是游戏模拟秒数；cpuSeconds / computeWallSeconds 才是本脚本计算成本，不能把模拟结果称作真实浏览器计时。

正常生命基线完成的 normal S2 为 600.150–655.417 秒，最终 Boss 为 87.933–104.134 秒；hard 唯一基线完成为资源 Lv10/3，总计 690.617 秒、最终 Boss 149.367 秒。无敌输出 normal 总计 576.383–710.850 秒，hard 为 633.600–834.083 秒；它证明在当前输出与成长系统下存在该输出速度，**不能证明同速度下能生存，也不是严格理论输出上限**。

**S2 最终 Boss 的 120–180 秒目标尚未跨继承/构筑达标。** 正常生命下，中继承主炮 104.134 秒以及高继承主炮/子机/资源 87.933 / 96.518 / 104.032 秒均偏短；中继承资源配对 124.117 秒、hard 高继承资源 149.367 秒、hard 低继承主炮配对 179.884 秒在目标内；normal 低继承资源配对 248.484 秒偏长。其他正常生命配置未到达或未完成最终 Boss，不能用无敌时间替代其验收。

S2 总流程 600–900 秒目标方面：五项正常生命基线成功记录都在范围内；中继承资源配对 779.183 秒也在范围内。低继承 normal 资源配对 1076.950 秒、hard 主炮配对 1087.183 秒超出上沿；hard 低继承资源在 1200 秒上限未完成。这里没有测量完整 S1 普通阶段总流程，S1 的时间证据只覆盖既定 Lv7/三子机最终 Boss。

## 配对控制器诊断（不覆盖原始失败）

只追加四项：同种子、同模块偏好、同生产源码、正常 HP、无额外无敌。开放世界控制器现在预测已经出现的弹道（含停驻折返）0.9 秒，比较 16 个方向，延迟 200 ms 读取已显示的地面预告，按实际可用存储冲刺执行。仍不读取未来 AI 决策、不寻找镜盾背面、不主动规划进攻冲刺；最终 Boss 控制器保持原样。它仍具有机器精确瞄准和确定性预测能力，不能代表一般玩家。

| 配置 | 原始基线结果 / 秒 | 配对结果 | 总模拟秒 | 活跃战斗秒 | 最终 Boss 秒 | 最终 Boss 有效 DPS | 生命损失 / 炸弹 |
|---|---|---|---:|---:|---:|---:|---:|
${diagnosticRows}

hard Lv4/1 资源到 1200 秒上限时仍为 5 HP、零受伤，已击败两场小 Boss，正在第二张符卡；这是**超时未完成**，不是通关或死亡。四项配对实验都没有使用炸弹，实际也没有触发冲刺，因此改进结果主要来自普通走位预测，不应归功于存储冲刺。原 normal Lv4/1、Lv7/3 资源以及 hard Lv4/1 主炮的死亡不构成“技能不可躲”证据。其余未配对的失败仍保留为未解释完的记录。

失败日志同时证实基线盲点：normal Lv7/3 资源在 242.800 秒、434.367 秒被已经生效的地面爆破命中时仍有一次可用冲刺；其首四选实际为 revive / magnet / reserveAmmo / graze，尚未获得 doubleDash，因此不能把这两次失败误归因于第二次存储冲刺。未命中方向、射线近身运动和补给路线也会改变下一轮刷怪与等级，单种子结果随构筑不单调并不自动等同于游戏随机错误。

## 普通难度各继承和偏好的实际 DPS

阶段列按到达顺序为第 1–6 段活跃 DPS；中途失败只列实际测到的部分。小 Boss 列为“本段秒数 / 对该目标有效 DPS”，包括尚未击杀的部分测量；总体 DPS 包含小怪、可击停部件和再生血量。最终 Boss 使用仅 boss 类型 HP 除以六卡活跃时间，排除 node HP，未到达以文字标明，绝不记作 0 DPS。

| 正常生命配置 | 结果 | 全程总体 DPS | 各普通段 DPS | PALISADE 秒 / 目标 DPS | REPRISE 秒 / 目标 DPS | 最终六卡秒 / 目标 DPS |
|---|---|---:|---|---|---|---|
${normalRows}

## 所有继承/构筑的无敌输出对照

每项均经历真实六段成长与七次选项，末期等级可能高于继承等级。最后一列按六卡顺序列“秒 / Boss 目标 DPS”。这是补齐后段测量的输出条件，不能填入正常生命未到达的格子。

| 配置 | 总模拟秒 | 活跃战斗秒 | PALISADE 秒 / 目标 DPS | REPRISE 秒 / 目标 DPS | 最终六卡秒 / 目标 DPS | 各卡秒 / 目标 DPS |
|---|---:|---:|---|---|---|---|
${outputRows}

## 低继承资源为什么达到 17.95 分钟

normal Lv4/1 资源配对流程为 **1076.950 秒**，超过 10–15 分钟目标上沿 **176.950 秒**，这一偏差必须保留。相同继承/偏好的无敌输出流程为 688.883 秒，两者相差 388.067 秒，来源几乎完全可分解为：PALISADE 多 45.867 秒、REPRISE 多 202.550 秒、最终六卡多 139.651 秒；六个普通段仍各 75 秒。

REPRISE 是主要拖长点。正常生命配对用了 280.867 秒，对该小 Boss 实际 8.545 DPS，整段总 DPS 为 26.000：2400 伤害打在目标，4902.5 打在其他敌人（其中镜盾 2260.5、修复者 871、采样者 1002）。无敌输出用了 78.317 秒、目标 30.645 DPS，并发动 28 次冲刺，贯穿炮对整段造成 2075.75 实际伤害。配对控制器不主动用进攻冲刺，整段 0 次；它为避弹改变输出方向，子机也会攻击近处其他敌人。此记录证明输出分散和未使用进攻资源是重要因素，不能把差异全归为 Boss 基础 HP。

最终六卡正常生命配对在 Lv7/一子机开始，248.484 秒、目标 37.025 DPS；无敌输出在 Lv8/一子机开始，108.833 秒、目标 84.533 DPS。后者可持续聚焦、更多主炮弹数及按冷却贯穿炮，六卡贯穿炮贡献 1520 实际伤害；前者六卡为 0。这也包含击杀/拾取导致的成长差异，**不是仅切换无敌开关的单变量伤害倍率实验**。

hard Lv4/1 资源的配对流程两场小 Boss 分别 225.117 / 477.050 秒，零受伤但明显慢；相同继承的主炮偏好配对能以 1087.183 秒零受伤完成。低继承资源的安全输出与进攻资源利用，仍是 10–15 分钟目标的未通过项。现有证据不支持直接给所有敌人削 HP，也不足以宣称低继承所有构筑已达标。

本轮没有从这些数据发现必须立即修复的战斗代码缺陷，没有自动修改 HP、弹速、刷怪或模块倍率。可落地的下一步是：保留这组失败/超时回归，进一步验证玩家可操作的进攻冲刺和镜盾侧面输出能否把 REPRISE 目标 DPS 拉回合理范围；若正常生命、可执行进攻策略仍不能达标，再对低继承的成长/补给或特定小 Boss 附加怪承伤比例做定向调整，而不降低六卡图案挑战。该后续实验未在本轮无限扩跑。

仅按已观察到的稳态 DPS 做近似估算，normal 低继承资源 37.025 DPS 要在 180 秒内完成，六卡总 HP 应不高于约 6664.5；高继承主炮 104.625 DPS 要至少体验 120 秒，总 HP 应不低于约 12555。两个区间不相交，因此统一乘同一个 Boss HP 系数不足以同时校准两端。该估算没有模拟更改 HP 后的路线/成长反馈，不是建议直接应用这些 HP 数值。若 120–180 秒要覆盖全部继承档，必须同时解决低继承安全输出与高继承高输出的跨度，或明确把该时长目标限定为一个基准构筑；不能靠暗削继承输出掩盖问题。

## 实际伤害来源与审计

下表为正常难度基线和四项配对的全程实际 HP 扣除来源。逐卡/小 Boss 的相同分类位于 JSON segments.damageSources，受伤事件含时间、类型、位置、当时危险区域、剩余炸弹和可用冲刺；对目标和部件的总量位于 targetTypes。source 与 targetTypes 是两组边际合计，节点卡不能从它们反推精确的“某种武器对 Boss”交叉分布。

| 配置 | 全程实际伤害来源 |
|---|---|
${sourceRows}

进程设为 Windows BelowNormal（实际 getPriority=10），每 case 让出 100 ms，全部顺序运行；没有启动浏览器/GPU。JSON 记录 ${Object.keys(report.sourceHashes).length} 个实际加载的生产/控制器源码 SHA-256；最后复核 allMatch=${report.sourceVerification?.allMatch}。reportGeneratorSha256 记录生成当前报表的脚本版本（包含单独的配对诊断模式），不是声称原始矩阵与追加模式使用相同输入策略。刷新报表可用 MAFUYU_BALANCE_REPORT_ONLY=1；仅追加四项诊断可用 MAFUYU_BALANCE_DIAGNOSTIC_ONLY=1，后者会校验源码哈希相符且保留原始 36 case。
`;
}
await writeFile(resolve(out, 'balance-v4.0.0.md'), markdownReport(report));
console.log(`Saved ${report.campaignRuns.length} campaign runs to docs/validation/balance-v4.0.0.json`);
