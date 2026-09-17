import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setPriority } from 'node:os';
import { setTimeout as yieldBetweenCases } from 'node:timers/promises';
import { simulationLoader } from './simulation-loader.mjs';

// Real simulation, input-only controllers and real choices. No production source is rewritten.
const root = resolve(import.meta.dirname, '..'), output = resolve(root, 'docs/validation');
setPriority(10);
const loader = simulationLoader(root);
const { GameSimulation } = await import(await loader.url('src/game/simulation.ts'));
const { steering, projectileForecast, minimumDistance, crossesBeam } = await import(await loader.url('src/game/fairness.test.ts'));
const { miniBossAttacks, miniBossLaserGeometry, miniBossDashGeometry } = await import(await loader.url('src/game/miniboss-ai.ts'));
const { bossActionTelegraph } = await import(await loader.url('src/game/boss-actions.ts'));
const { MODULES, moduleRank } = await import(await loader.url('src/game/upgrades.ts'));
const profiles = {
  main: ['pulseChamber', 'crescentMagazine', 'anchorStars', 'beamCircuit', 'prism', 'precision', 'piercing', 'wingShots', 'shatter', 'chain', 'ricochet', 'rearSpark'],
  drone: ['droneSpotlight', 'droneConduit', 'droneNotes', 'dronePlectrum', 'droneBurst', 'crossOrbit', 'orbitBlade', 'returnWing', 'droneHoming', 'division', 'slow', 'intercept'],
  mobility: ['doubleDash', 'dashLane', 'slipstream', 'decoyEcho', 'counterPulse', 'dashEcho', 'vent', 'reserveAmmo', 'graze', 'revive', 'magnet', 'brakeField'],
  balanced: ['pulseChamber', 'droneSpotlight', 'doubleDash', 'anchorStars', 'droneConduit', 'dashLane', 'precision', 'droneBurst', 'prism', 'revive', 'magnet', 'piercing'],
};
const round = number => Math.round(number * 1000) / 1000;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (number, low, high) => Math.max(low, Math.min(high, number));
const percentile = (values, fraction) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))] : null;
const major = enemy => ['boss', 'miniboss'].includes(enemy.role);
const visible = (enemy, world) => Math.abs(enemy.x - world.camera.x) < 800 + enemy.radius && Math.abs(enemy.y - world.camera.y) < 450 + enemy.radius;
const observations = new WeakMap();
const STEP = 1 / 60, SAMPLE = 0.15, SAMPLES = 8, REACTION = 0.2;

/** Only currently displayed, committed actions are known after a 200ms visual reaction. */
function perceived(world, sim) {
  let memory = observations.get(sim); if (!memory) { memory = new Map(); observations.set(sim, memory); }
  const hazards = world.hazards.filter(h => h.active || h.warningDuration - h.warning >= REACTION), paths = new Map();
  const seen = new Set();
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0 || !visible(enemy, world)) continue;
    const action = bossActionTelegraph(enemy);
    if (action && (action.phase !== 'warning' || action.warning - action.remaining >= REACTION)) paths.set(enemy.id, { x: enemy.x, y: enemy.y, endX: action.endX, endY: action.endY,
      delay: action.phase === 'warning' ? action.remaining : 0, duration: action.phase === 'warning' ? enemy.action.duration : action.phase === 'moving' ? action.remaining : Infinity });
    if (!enemy.miniboss) continue;
    const kind = ['laserWarmup', 'laser'].includes(enemy.state) ? 'laser' : ['charge', 'dash'].includes(enemy.state) ? 'dash' : null;
    if (!kind) continue; seen.add(enemy.id);
    let observation = memory.get(enemy.id);
    if (!observation || observation.kind !== kind || observation.state !== enemy.state && ['laserWarmup', 'charge'].includes(enemy.state)) {
      observation = { kind, state: enemy.state, at: world.elapsed }; memory.set(enemy.id, observation);
    }
    observation.state = enemy.state;
    if (world.elapsed - observation.at < REACTION - 1e-8) continue;
    const cfg = miniBossAttacks(world.difficulty);
    if (kind === 'laser') {
      const active = enemy.state === 'laser', shape = miniBossLaserGeometry(enemy, world.difficulty);
      hazards.push({ ...shape, kind: 'beam', active, warning: active ? 0 : enemy.timer, life: active ? enemy.timer : cfg.laser.duration });
    } else {
      const shape = miniBossDashGeometry(enemy, world.difficulty);
      paths.set(enemy.id, { ...shape, delay: enemy.state === 'charge' ? enemy.timer : 0, duration: enemy.state === 'charge' ? cfg.dash.duration : Math.max(1e-8, enemy.timer) });
    }
  }
  for (const id of memory.keys()) if (!seen.has(id)) memory.delete(id);
  return { hazards, paths };
}
function baseInput(sim, previous, immortal) {
  const w = sim.state, p = w.player, living = w.enemies.filter(enemy => enemy.hp > 0 && (enemy.disabledUntil ?? 0) <= w.elapsed);
  const target = living.find(enemy => major(enemy) || enemy.role === 'elite') ?? living.reduce((best, enemy) => !best || distance(enemy, p) < distance(best, p) ? enemy : best, null);
  const pickups = w.pickups.filter(item => !(item.type === 'hp' && p.hp >= p.maxHp) && !(item.type === 'coolant' && !p.overheated && p.heat <= 0 && p.heatLock <= 0));
  const pickup = pickups.reduce((best, item) => !best || distance(item, p) < distance(best, p) ? item : best, null);
  let x = 2000 - p.x, y = 2000 - p.y;
  if (target) {
    const dx = target.x - p.x, dy = target.y - p.y, d = Math.max(1, distance(target, p)), desired = major(target) || target.role === 'elite' ? 400 : 280;
    const approach = d > desired + 60 ? 1 : d < desired - 60 ? -1 : 0;
    x = dx / d * approach - dy / d * 0.6; y = dy / d * approach + dx / d * 0.6;
  }
  const pickupReach = collectionPolicy === 'low' ? 180 : collectionPolicy === 'medium' ? 500 : 850;
  if (pickup && distance(pickup, p) < pickupReach && !living.some(enemy => distance(enemy, p) < enemy.radius + 70)) { x = pickup.x - p.x; y = pickup.y - p.y; const d = Math.max(1, Math.hypot(x, y)); x /= d; y /= d; }
  for (const enemy of living) {
    const d = Math.max(1, distance(enemy, p)), proximity = enemy.radius + 190;
    if (d < proximity) { x += (p.x - enemy.x) / d * (proximity - d) / 40; y += (p.y - enemy.y) / d * (proximity - d) / 40; }
  }
  x += p.x < 200 ? 3 : p.x > 3800 ? -3 : 0; y += p.y < 200 ? 3 : p.y > 3800 ? -3 : 0;
  const length = Math.max(1e-8, Math.hypot(x, y));
  return { moveX: x / length, moveY: y / length, focus: false, shoot: !!target, dash: immortal && !!target && !previous.dash && sim.dashCharges > 0 && p.perfectWindow <= 0 && w.tick % 60 < 6,
    bomb: false, aimX: target?.x ?? p.x, aimY: target?.y ?? p.y };
}
function openInput(sim, previous, immortal) {
  const base = baseInput(sim, previous, immortal), w = sim.state, p = w.player;
  if (immortal) return base;
  if (p.dashTime > 0) return { ...base, moveX: previous.moveX, moveY: previous.moveY, dash: false };
  const threats = perceived(w, sim), bodies = w.enemies.filter(enemy => enemy.hp > 0 && (enemy.disabledUntil ?? 0) <= w.elapsed && (distance(enemy, p) < 650 || threats.paths.has(enemy.id)));
  const bullets = w.bullets.filter(bullet => bullet.owner === 'enemy' && distance(bullet, p) < 700).map(projectileForecast);
  const bounds = w.arena ?? { x: 0, y: 0, width: 4000, height: 4000 };
  const bodyPoint = (enemy, time) => {
    const path = threats.paths.get(enemy.id); if (!path) return { x: enemy.x + enemy.vx * time, y: enemy.y + enemy.vy * time };
    const fraction = clamp((time - path.delay) / path.duration, 0, 1);
    return { x: path.x + (path.endX - path.x) * fraction, y: path.y + (path.endY - path.y) * fraction };
  };
  const cost = (x, y, dash) => {
    const points = [{ x: p.x, y: p.y }]; let value = dash ? 500 : 0;
    for (let i = 1; i <= SAMPLES; i++) {
      const time = i * SAMPLE, length = 300 * time + (dash ? 780 * Math.min(0.18, time) : 0);
      const rawX = p.x + x * length, rawY = p.y + y * length;
      const point = { x: clamp(rawX, bounds.x + 18, bounds.x + bounds.width - 18), y: clamp(rawY, bounds.y + 18, bounds.y + bounds.height - 18) };
      points.push(point); value += 5 * (Math.abs(rawX - point.x) + Math.abs(rawY - point.y));
      if (dash && time <= 0.18) continue;
      for (const enemy of bodies) {
        const from = bodyPoint(enemy, time - SAMPLE), to = bodyPoint(enemy, time), before = points[i - 1];
        const clearance = minimumDistance(before.x - from.x, before.y - from.y, point.x - to.x, point.y - to.y) - enemy.radius - 18;
        value += clearance < 5 ? 1e7 : 80 * Math.exp(-clearance / 28);
      }
      for (const h of threats.hazards) {
        const low = Math.max(time - SAMPLE, h.active ? 0 : h.warning), high = Math.min(time, h.warning + h.life); if (low > high) continue;
        const before = points[i - 1], from = (low - (time - SAMPLE)) / SAMPLE, to = (high - (time - SAMPLE)) / SAMPLE;
        const ax = before.x + (point.x - before.x) * from, ay = before.y + (point.y - before.y) * from, bx = before.x + (point.x - before.x) * to, by = before.y + (point.y - before.y) * to;
        const hit = h.kind === 'beam' ? crossesBeam(ax, ay, bx, by, h.x, h.y, h.angle ?? 0, h.length ?? 0, h.width ?? 0) : minimumDistance(ax - h.x, ay - h.y, bx - h.x, by - h.y) < h.radius + 7;
        if (hit) value += 1e7 * (2 - time);
      }
    }
    for (const bullet of bullets) for (let i = 1; i <= SAMPLES; i++) {
      if (dash && i * SAMPLE <= 0.18) continue;
      const clearance = minimumDistance(bullet.points[i - 1].x - points[i - 1].x, bullet.points[i - 1].y - points[i - 1].y, bullet.points[i].x - points[i].x, bullet.points[i].y - points[i].y) - bullet.radius - 7;
      value += clearance < 2 ? 1e7 * (2 - i * SAMPLE) : 80 * Math.exp(-clearance / 14);
    }
    value += Math.hypot(points[SAMPLES].x - p.x - base.moveX * 300, points[SAMPLES].y - p.y - base.moveY * 300) * 0.1;
    return value + (1 - x * previous.moveX - y * previous.moveY) * 2;
  };
  const directions = [{ x: 0, y: 0 }, ...Array.from({ length: 16 }, (_, i) => ({ x: Math.cos(i * Math.PI / 8), y: Math.sin(i * Math.PI / 8) }))];
  let best = { x: 0, y: 0, dash: false, cost: Infinity };
  for (const direction of directions) { const value = cost(direction.x, direction.y, false); if (value < best.cost) best = { ...direction, dash: false, cost: value }; }
  if (best.cost > 1e5 && sim.dashCharges > 0 && !previous.dash) for (const direction of directions.slice(1)) { const value = cost(direction.x, direction.y, true); if (value < best.cost) best = { ...direction, dash: true, cost: value }; }
  return { ...base, moveX: best.x, moveY: best.y, focus: Math.hypot(best.x, best.y) < 0.1, dash: best.dash,
    bomb: !previous.bomb && p.bombs > 0 && p.hp <= 2 && p.invincible <= 0 && best.cost > 1e5 && !best.dash };
}
function run(seed, difficulty, profile, immortal) {
  const sim = new GameSimulation(seed, difficulty), started = performance.now(), rows = new Map(), choices = [], injuries = [], bossEntries = [], eliteEntries = [], telemetry = [];
  const lives = new Map(), deaths = [], entriesSeen = new Set();
  let collectedXp = 0, budgetAttempts = 0, budgetRejected = 0, deferrals = 0, deferredCanceled = 0, acceptedCommits = 0, coreHits = 0, nextSample = 10;
  const reservations = { completed: 0, canceled: 0, canceledWhileAlive: 0, canceledOnDeath: 0, resetCleanup: 0, expiredWithPayload: 0, rejectedPromisedEmission: 0, canceledBullets: 0, canceledHazards: 0 };
  const reservationOwners = new Map(), reservationByType = {};
  let previousSample = { deferredCanceled: 0, acceptedCommits: 0, reservationCompleted: 0, reservationCanceled: 0, reservationExpired: 0 };
  // Read-only observations of actual promise lifetimes, distinct from admission retries.
  const budget = sim.attackBudget, pending = value => !!value && value.bullets + value.hazards > 0;
  const originalCancel = budget.cancel.bind(budget), originalExpire = budget.expire.bind(budget), originalTake = budget.take.bind(budget), originalReset = budget.reset.bind(budget), originalBudgetReserve = budget.reserve.bind(budget);
  const recordPromise = (source, field, value) => {
    const key = reservationOwners.get(source) ?? 'unknown';
    const record = reservationByType[key] ??= { completed: 0, canceled: 0, expired: 0, reset: 0, rejected: 0, expiredBullets: 0, expiredHazards: 0 };
    record[field]++;
    if (field === 'expired') { record.expiredBullets += value.bullets; record.expiredHazards += value.hazards; }
    if (field !== 'rejected') reservationOwners.delete(source);
  };
  budget.reserve = (source, ...args) => {
    const result = originalBudgetReserve(source, ...args), enemy = sim.state.enemies.find(item => item.id === source);
    if (result && budget.reservations.has(source)) reservationOwners.set(source, `${enemy?.encounterId ?? enemy?.role ?? 'unknown'}:${enemy?.type ?? 'unknown'}`);
    return result;
  };
  budget.cancel = source => {
    const value = budget.reservations.get(source);
    if (pending(value)) {
      reservations.canceled++; reservations.canceledBullets += value.bullets; reservations.canceledHazards += value.hazards;
      const alive = sim.state.enemies.some(enemy => enemy.id === source && enemy.hp > 0);
      if (alive) reservations.canceledWhileAlive++; else reservations.canceledOnDeath++;
      recordPromise(source, 'canceled', value);
    }
    return originalCancel(source);
  };
  budget.expire = now => { for (const [source, value] of budget.reservations) if (pending(value) && value.expires < now) { reservations.expiredWithPayload++; recordPromise(source, 'expired', value); } return originalExpire(now); };
  budget.take = (source, kind, live) => {
    const value = budget.reservations.get(source), promised = pending(value) && value[kind] > 0;
    const result = originalTake(source, kind, live);
    if (promised && !result) { reservations.rejectedPromisedEmission++; recordPromise(source, 'rejected', value); }
    if (promised && result && !budget.reservations.has(source)) { reservations.completed++; recordPromise(source, 'completed', value); }
    return result;
  };
  budget.reset = () => { for (const [source, value] of budget.reservations) if (pending(value)) { reservations.resetCleanup++; recordPromise(source, 'reset', value); } return originalReset(); };
  const originalSpawn = sim.spawnEnemy.bind(sim);
  sim.spawnEnemy = (...args) => { const result = originalSpawn(...args); if (result) lives.set(result.id, { id: result.id, type: result.type, role: result.role, born: sim.state.elapsed, firstAttack: null, firstRelease: null, firstSupport: null, firstVisible: null }); return result; };
  const originalShot = sim.enemyShootAt.bind(sim);
  sim.enemyShootAt = (enemy, ...args) => { const before = sim.state.bullets.length; const result = originalShot(enemy, ...args); if (sim.state.bullets.length > before) { const life = lives.get(enemy.id); if (life && life.firstAttack === null) life.firstAttack = sim.state.elapsed; } return result; };
  const originalReserve = sim.reserveAttack.bind(sim);
  sim.reserveAttack = (...args) => { budgetAttempts++; const result = originalReserve(...args); if (!result) budgetRejected++; return result; };
  const originalCommit = sim.threats.canCommit.bind(sim.threats);
  sim.threats.canCommit = (intent, ctx) => { const result = originalCommit(intent, { ...ctx, onDeferredCancel: id => { deferredCanceled++; ctx.onDeferredCancel?.(id); } }); if (!result) deferrals++; else acceptedCommits++; return result; };
  const originalPickup = sim.collectPickup.bind(sim);
  sim.collectPickup = pickup => { const value = pickup.value, type = pickup.type, result = originalPickup(pickup); if (type === 'xp') collectedXp += value - pickup.value; return result; };
  const originalDamage = sim.damageEnemy.bind(sim);
  sim.damageEnemy = (enemy, ...args) => { const before = enemy.hp, life = lives.get(enemy.id); if (life) life.role = enemy.role; const result = originalDamage(enemy, ...args); if (before > 0 && enemy.hp <= 0 && life) life.killedByDamage = true; return result; };
  let action = { moveX: 0, moveY: 0, aimX: 2000, aimY: 1800, shoot: false, dash: false, bomb: false };
  const preference = id => {
    if (id.startsWith('evolution:')) return -100;
    if (id === 'reward:heal' && sim.state.player.hp < 3) return -50;
    if (!(id in MODULES)) return 100;
    const order = profiles[profile].indexOf(id), rank = moduleRank(sim.state.build, id);
    // Prefer III/V milestones, then new behavior. High ranks do not monopolize all offers.
    return (order >= 0 ? order : 35) + (rank === 2 || rank === 4 ? -6 : rank >= 5 ? 8 + Math.log2(rank) : 0);
  };
  while (sim.state.elapsed < 1200 && !['failed', 'complete'].includes(sim.state.status)) {
    while (sim.state.status === 'upgrade') {
      const build = sim.state.build, offer = [...build.choices], selected = offer.toSorted((a, b) => preference(a) - preference(b))[0];
      choices.push({ at: round(sim.state.elapsed), level: sim.state.player.level, source: build.pendingRewards[0]?.source, offer, selected, beforeRank: selected in MODULES ? moduleRank(build, selected) : null });
      if (!selected || !sim.chooseUpgrade(selected, build.offerId ?? undefined)) throw new Error('A production upgrade choice was rejected.');
      action.dash = action.bomb = false;
    }
    const w = sim.state, p = w.player, boss = w.enemies.find(enemy => enemy.hp > 0 && enemy.spell);
    if (immortal) p.invincible = 3600;
    for (const enemy of w.enemies) {
      if (enemy.hp <= 0) continue; const life = lives.get(enemy.id);
      if (life) life.role = enemy.role;
      if (life && life.firstVisible === null && visible(enemy, w)) life.firstVisible = w.elapsed;
      if (life && life.firstAttack === null && (enemy.state === 'dash' || enemy.state === 'laser' || distance(enemy, p) <= enemy.radius + 18)) life.firstAttack = w.elapsed;
      if ((major(enemy) || enemy.role === 'elite') && !entriesSeen.has(enemy.id)) {
        entriesSeen.add(enemy.id); const entry = { id: enemy.encounterId, type: enemy.type, eliteVariant: enemy.elite?.variant, elapsed: round(w.elapsed), progression: round(w.campaign.progression), hp: p.hp, bombs: p.bombs,
          level: p.level, xp: p.xp, collectedXp, companions: w.companions.length, modules: [...w.build.modules], ranks: { ...w.build.ranks }, totalRanks: Object.values(w.build.ranks).reduce((sum, rank) => sum + rank, 0), evolutions: [...w.build.evolutions], maxHp: enemy.maxHp };
        (enemy.role === 'elite' ? eliteEntries : bossEntries).push(entry);
      }
    }
    for (const hazard of w.hazards) if (hazard.active) { const life = lives.get(hazard.sourceId); if (life && life.firstAttack === null) life.firstAttack = w.elapsed; }
    if (w.tick % 6 === 0) {
      const previous = action;
      if (boss) {
        action = immortal ? { ...previous, moveX: 0, moveY: 0, focus: true, dash: !previous.dash && sim.dashCharges > 0, bomb: false } : steering(sim, boss, previous, REACTION);
        action.shoot = true; action.aimX = boss.x; action.aimY = boss.y;
        if (!immortal) action.bomb = !previous.bomb && p.bombs > 0 && p.hp <= 2 && p.invincible <= 0 && sim.dashCharges === 0 && w.bullets.some(b => b.owner === 'enemy' && distance(b, p) < 65);
      } else action = openInput(sim, previous, immortal);
      const clear = !w.enemies.some(enemy => enemy.hp > 0 && distance(enemy, p) < enemy.radius + 220);
      if (!action.dash && !previous.dash && sim.dashCharges > 0 && p.perfectWindow <= 0 && clear && w.tick % 60 < 6) action.dash = true;
    }
    const segment = boss ? `${w.campaign.activeEncounter}:card${boss.spell.cardIndex + 1}` : w.campaign.activeEncounter ?? w.campaign.activeElite ?? `approach:${w.campaign.stage}`;
    if (!rows.has(segment)) rows.set(segment, { id: segment, seconds: 0, damage: 0, bossDamage: 0, eliteDamage: 0, sources: {}, received: {}, bombs: 0, beams: 0, kills: 0, coreHits: 0, heatLockedSeconds: 0 });
    const row = rows.get(segment); row.seconds += STEP; if (p.overheated) row.heatLockedSeconds += STEP;
    for (const event of sim.step(action)) {
      if (event.type === 'attack') {
        const life = lives.get(event.targetId);
        if (life && event.text === 'release' && life.firstRelease === null) life.firstRelease = w.elapsed;
        if (life && event.text === 'repair' && event.amount > 0 && life.firstSupport === null) life.firstSupport = w.elapsed;
      }
      if (event.type === 'hit' && event.enemyType && event.amount > 0) {
        const source = event.moduleId ?? event.damageSource ?? 'unknown'; row.damage += event.amount; row.sources[source] = (row.sources[source] ?? 0) + event.amount;
        if (['boss', 'miniboss', 'palisade', 'reprise'].includes(event.enemyType)) row.bossDamage += event.amount;
        if (lives.get(event.targetId)?.role === 'elite') row.eliteDamage += event.amount;
        if (event.hitResult === 'weakpoint') { row.coreHits++; coreHits++; }
      }
      if (event.type === 'damage') { row.received[event.damageSource ?? 'unknown'] = (row.received[event.damageSource ?? 'unknown'] ?? 0) + event.amount; injuries.push({ at: round(w.elapsed), segment, source: event.damageSource, hp: p.hp, bombs: p.bombs, dashCharges: sim.dashCharges }); }
      if (event.type === 'bomb') row.bombs++; if (event.type === 'beam') row.beams++;
      if (event.type === 'kill') {
        row.kills++; const life = lives.get(event.targetId);
        if (life) { deaths.push({ ...life, died: round(w.elapsed), ttk: round(w.elapsed - life.born), visibleTtk: life.firstVisible === null ? null : round(w.elapsed - life.firstVisible) }); lives.delete(event.targetId); }
      }
    }
    // Kill events historically did not carry targetId: retire known dead entity IDs by presence.
    const livingIds = new Set(w.enemies.filter(enemy => enemy.hp > 0).map(enemy => enemy.id));
    for (const [id, life] of lives) if (!livingIds.has(id)) { deaths.push({ ...life, died: round(w.elapsed), ttk: round(w.elapsed - life.born), visibleTtk: life.firstVisible === null ? null : round(w.elapsed - life.firstVisible), removalMayBeSettlement: !life.killedByDamage }); lives.delete(id); }
    if (w.elapsed + 1e-8 >= nextSample) {
      const mobs = deaths.filter(life => life.role === 'mob' && life.killedByDamage), fired = mobs.filter(life => life.firstAttack !== null);
      const recent = mobs.filter(life => life.died > nextSample - 10), recentFired = recent.filter(life => life.firstAttack !== null);
      const canceled = deferredCanceled - previousSample.deferredCanceled, accepted = acceptedCommits - previousSample.acceptedCommits;
      const completedPromises = reservations.completed - previousSample.reservationCompleted, canceledPromises = reservations.canceled - previousSample.reservationCanceled, expiredPromises = reservations.expiredWithPayload - previousSample.reservationExpired;
      const recentReleased = recent.filter(life => life.firstRelease !== null || life.firstAttack !== null), recentSupport = recent.filter(life => life.firstSupport !== null);
      telemetry.push({ elapsed: round(w.elapsed), progression: round(w.campaign.progression), enemies: w.enemies.length, ordinaryAlive: w.enemies.filter(e => e.role === 'mob').length,
        enemyBullets: w.bullets.filter(b => b.owner === 'enemy').length, playerBullets: w.bullets.filter(b => b.owner === 'player').length, moduleActors: w.moduleVisuals?.length ?? 0, hazards: w.hazards.length,
        level: p.level, moduleKinds: w.build.modules.length, totalRanks: Object.values(w.build.ranks).reduce((sum, rank) => sum + rank, 0), hp: p.hp, bombs: p.bombs, dashCharges: sim.dashCharges, collectedXp, coreHits,
        ordinaryRemoved: mobs.length, ordinaryFirstAttack: fired.length, ordinaryFirstAttackRatio: mobs.length ? round(fired.length / mobs.length) : null, ordinaryVisibleTtkP50: percentile(mobs.filter(life => life.visibleTtk !== null).map(life => life.visibleTtk), 0.5),
        windowOrdinaryKilled: recent.length, windowFirstAttackRatio: recent.length ? round(recentFired.length / recent.length) : null, windowVisibleTtkP50: percentile(recent.filter(life => life.visibleTtk !== null).map(life => life.visibleTtk), 0.5),
        windowReleaseRatio: recent.length ? round(recentReleased.length / recent.length) : null, windowSupportSuccesses: recentSupport.length,
        windowAdmissionTimeoutRate: canceled + accepted ? round(canceled / (canceled + accepted)) : 0,
        windowReservationCancelRate: completedPromises + canceledPromises + expiredPromises ? round(canceledPromises / (completedPromises + canceledPromises + expiredPromises)) : 0,
        budgetAttempts, budgetRejected, budgetRejectRate: budgetAttempts ? round(budgetRejected / budgetAttempts) : 0, deferredAttempts: deferrals, deferredCanceled, reservations: { ...reservations } });
      previousSample = { deferredCanceled, acceptedCommits, reservationCompleted: reservations.completed, reservationCanceled: reservations.canceled, reservationExpired: reservations.expiredWithPayload };
      nextSample += 10;
    }
  }
  const w = sim.state;
  return { seed, difficulty, profile, collectionPolicy, mode: immortal ? 'DPS' : 'normalHP', result: w.status, elapsed: round(w.elapsed), computeSeconds: round((performance.now() - started) / 1000), level: w.player.level, progression: round(w.campaign.progression),
    collectedXp, hp: w.player.hp, bombs: w.player.bombs, bossEntries, eliteEntries, choices, injuries, coreHits, reservations, reservationByType,
    modules: [...w.build.modules], ranks: { ...w.build.ranks }, evolutions: [...w.build.evolutions], deaths, telemetry,
    segments: [...rows.values()].map(row => ({ ...row, seconds: round(row.seconds), damage: round(row.damage), bossDamage: round(row.bossDamage), eliteDamage: round(row.eliteDamage), dps: round(row.damage / row.seconds), bossDps: round(row.bossDamage / row.seconds), heatLockedSeconds: round(row.heatLockedSeconds) })) };
}

const quick = process.env.MAFUYU_BALANCE_QUICK === '1', profile = process.env.MAFUYU_BALANCE_PROFILE, requestedMode = process.env.MAFUYU_BALANCE_MODE;
const collectionPolicy = process.env.MAFUYU_BALANCE_COLLECTION ?? 'high';
if (profile && !profiles[profile]) throw new Error('Unknown balance profile.');
if (requestedMode && !['normalHP', 'DPS'].includes(requestedMode)) throw new Error('Unknown mode.');
if (!['low', 'medium', 'high'].includes(collectionPolicy)) throw new Error('Unknown collection policy.');
const seedCount = Number(process.env.MAFUYU_BALANCE_SEEDS ?? (quick ? 1 : 10));
const hash = content => createHash('sha256').update(content).digest('hex');
for (const file of ['scripts/balance-v6.mjs', 'scripts/simulation-loader.mjs']) loader.hashes[file] = hash(await readFile(resolve(root, file)));
const report = { version: '6.0.0', measuredAt: new Date().toISOString(), sourceHashes: loader.hashes, status: 'running',
  method: 'Real 60Hz fresh-Lv1 simulation, real offers and drops; no forced modules or enemy stats. Controls every 100ms. Visible committed body paths and spell cues are recognized after 200ms. Eight projectile samples are 150ms apart, matching route samples. Core damage is counted only on hit events with enemyType, excluding auxiliary weakpoint damage notifications. Only labelled DPS cases receive invulnerability.',
  metricDefinitions: {
    firstAttack: 'Observed projectile creation, active hazard, dash/laser phase or contact reach before damage death. Basic/carrier contact pressure counts; repair-only support does not. This conservative metric does not claim every mine placement was observed.',
    firstRelease: 'Attack release cue or observed first attack. A minelayer release is an attempted volley; individual mines can still be blocked by spacing/capacity. Successful repairs are reported separately.',
    ordinaryPopulation: 'Only role=mob entities actually killed by damage. Encounter cleanup and spawned mines/cores/parts are excluded. Role is read after spawn assignment.',
    admissionTimeout: 'Actual ThreatDirector onDeferredCancel callbacks divided by accepted admissions plus timeout callbacks, separately from per-tick false retry counts.',
    reservationCancellation: 'Remaining AttackBudget promises explicitly canceled divided by completed, canceled and expired promise lifetimes in that 10-second window. Alive-source and dead/missing-source cancellation are separate. Reset cleanup and expired payloads are reported, not silently treated as successful attacks.',
    rejectedPromisedEmission: 'A reserved bullet/hazard release for which AttackBudget.take returned false. This is distinct from normal admission rejection or player-caused interruption.',
    collectedXp: 'Redeemed XP pickup value only; boss/direct awards, converted support/bombs and choice XP are not silently included. Entry level and current XP reflect all production rewards.',
    damage: 'Actual clamped HP loss from production hit events, split by new moduleId or legacy damageSource. Overkill and auxiliary weakpoint-only hit notifications are excluded.',
  },
  limitations: ['Synthetic precise aiming and prediction are not human playtesting.', 'Ordinary attack cancellation retries are counted separately from actual deferred cancellation.', 'Removal-based ordinary TTK may include encounter cleanup, and is explicitly labelled.', 'Core hits are naturally aimed body-center hits during exposed windows; controller does not plan every weakpoint mechanic.', 'Collection policies pursue real useful drops within 180/500/850 world units for low/medium/high; these are controlled collection strategies, not measured player skill groups. Settlement still collects existing drops.', 'CPU simulation timings are not browser frame timings.'],
  matrix: { seeds: Array.from({ length: seedCount }, (_, i) => 60001 + i), difficulties: process.env.MAFUYU_BALANCE_DIFFICULTY ? [process.env.MAFUYU_BALANCE_DIFFICULTY] : quick ? ['normal'] : ['normal', 'hard'], profiles: profile ? [profile] : Object.keys(profiles), modes: requestedMode ? [requestedMode] : quick ? ['DPS'] : ['normalHP'], collectionPolicy }, cases: [] };
const suffix = process.env.MAFUYU_BALANCE_LABEL ?? (quick ? 'calibration' : '0.0');
const reportPath = resolve(output, suffix === '0.0' ? 'balance-v6.0.0.json' : `balance-v6-${suffix}.json`);
await mkdir(output, { recursive: true });
for (const seed of report.matrix.seeds) for (const difficulty of report.matrix.difficulties) for (const selected of report.matrix.profiles) for (const mode of report.matrix.modes) {
  const result = run(seed, difficulty, selected, mode === 'DPS'); report.cases.push(result);
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.cases.length}: ${seed} ${difficulty} ${selected} ${mode} ${result.result} ${result.elapsed}s Lv${result.level} ${result.choices.length} choices; ${result.computeSeconds}s CPU wall`);
  await yieldBetweenCases(100);
}
const actual = report.cases.filter(item => item.mode === 'normalHP');
report.summary = { complete: actual.filter(item => item.result === 'complete').length, normalHpCases: actual.length, completedTimeP10: percentile(actual.filter(item => item.result === 'complete').map(item => item.elapsed), 0.1), completedTimeP50: percentile(actual.filter(item => item.result === 'complete').map(item => item.elapsed), 0.5), completedTimeP90: percentile(actual.filter(item => item.result === 'complete').map(item => item.elapsed), 0.9),
  collectionXpP10: percentile(actual.map(item => item.collectedXp), 0.1), collectionXpP50: percentile(actual.map(item => item.collectedXp), 0.5), collectionXpP90: percentile(actual.map(item => item.collectedXp), 0.9) };
report.changedSources = [];
for (const [file, expected] of Object.entries(loader.hashes)) if (hash(await readFile(resolve(root, file))) !== expected) report.changedSources.push(file);
report.status = report.changedSources.length ? 'stale-sources' : 'complete'; report.finishedAt = new Date().toISOString();
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`Saved ${reportPath}; ${report.status}.`);
if (report.changedSources.length) process.exitCode = 2;
