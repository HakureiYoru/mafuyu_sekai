import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setPriority } from 'node:os';
import assert from 'node:assert/strict';
import { simulationLoader } from './simulation-loader.mjs';

// CPU-only diagnostic: unchanged production simulation, with an invulnerable stationary target.
const root = resolve(import.meta.dirname, '..'), output = resolve(root, 'docs/validation');
setPriority(10);
const loader = simulationLoader(root);
const { GameSimulation } = await import(await loader.url('src/game/simulation.ts'));
const { SPELL_CARDS, spellCardDefinition } = await import(await loader.url('src/game/spellcards.ts'));
const sha = content => createHash('sha256').update(content).digest('hex');
for (const file of ['scripts/scan-spell-density-v6.mjs', 'scripts/simulation-loader.mjs']) loader.hashes[file] = sha(await readFile(resolve(root, file)));
const seed = 20260912, seconds = 45, sampleSeconds = 0.1;
const report = {
  version: JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version,
  measuredAt: new Date().toISOString(), sourceHashes: loader.hashes, seed, seconds, sampleSeconds,
  method: 'Read-only CPU diagnostic, 60Hz production GameSimulation; 12 independent spellcards × normal/hard, 45 simulated seconds per case, samples every six steps (100ms). Isolated endless practice encounter (identical card behavior, no campaign guaranteed-drone reward), Lv1 player stationary at real arena entrance, invulnerable only to keep the encounter running. No firing, companions, modules, bombs, dashes, hidden body-action disabling, or extra spawned reinforcements. Boss movement, nodes, warnings, collisions, expiry and reservations remain production behavior.',
  ranking: 'Highest sampled live hostile bullet count, then live hazards, then committed reserved bullets; live+reserved and queued telegraph shots are also recorded, not counted as simultaneously rendered bullets.',
  limitations: ['Diagnostic invulnerability is not a reachable-route or human difficulty validation.', '100ms sampled maxima are not guaranteed per-frame maxima.', 'One stationary input trace and one fixed seed do not establish a mathematical maximum across all player paths.', 'CPU accelerated simulation is not a browser frame-time benchmark.'],
  cases: [],
};
for (const season of ['s1', 's2']) for (const difficulty of ['normal', 'hard']) for (let cardIndex = 0; cardIndex < 6; cardIndex++) {
  const sim = new GameSimulation(seed, difficulty);
  sim.reset('endless', seed, difficulty, { difficulty });
  const world = sim.state, encounterId = season === 's1' ? 's1:mafuyu' : 's2:final';
  world.seasonId = season;
  world.campaign.stage = world.wave = season === 's1' ? 3 : 5;
  world.campaign.progression = season === 's1' ? 240 : 360;
  const boss = sim.spawnEnemy('boss', 2000, 1780, encounterId);
  assert.ok(boss?.spell);
  boss.spell.cardIndex = cardIndex;
  boss.hp = boss.maxHp = spellCardDefinition(boss, difficulty).hp;
  world.player.invincible = 3600;
  const startingHp = boss.hp, samples = [], peak = {};
  const action = { moveX: 0, moveY: 0, aimX: 2000, aimY: 1780, shoot: false, dash: false, bomb: false };
  for (let tick = 1; tick <= seconds * 60; tick++) {
    sim.step(action);
    if (tick % 6) continue;
    const resources = sim.resourceCounts;
    const hostile = world.bullets.filter(bullet => bullet.owner === 'enemy').length;
    const row = { at: tick / 60, hostile, hazards: world.hazards.length,
      activeHazards: world.hazards.filter(hazard => hazard.active).length,
      reservedBullets: resources.promises.bullets, reservedHazards: resources.promises.hazards,
      reservationSources: resources.promises.sources,
      livePlusReserved: hostile + resources.promises.bullets,
      cues: boss.spell.cues.length, queuedShots: boss.spell.cues.reduce((sum, cue) => sum + cue.shots.length, 0),
      enemies: world.enemies.length, parts: world.enemies.filter(enemy => enemy.role === 'part').length };
    samples.push(row);
    for (const [key, value] of Object.entries(row)) if (key !== 'at' && (!peak[key] || value > peak[key].value)) peak[key] = { value, at: row.at };
    assert.equal(world.status, 'playing'); assert.equal(boss.spell.cardIndex, cardIndex);
    assert.equal(boss.hp, startingHp); assert.equal(world.player.hp, world.player.maxHp);
    assert.equal(world.companions.length, 0); assert.equal(resources.playerBullets, 0);
  }
  const definition = SPELL_CARDS[season][difficulty][cardIndex];
  const result = { season, difficulty, cardIndex, cardId: definition.id, name: definition.name, pattern: definition.pattern,
    simulatedSeconds: world.elapsed, bossHp: boss.hp, peak, samples };
  report.cases.push(result);
  console.log(`${season} ${difficulty} ${cardIndex + 1} ${definition.name}: live ${peak.hostile.value} @${peak.hostile.at}s, hazards ${peak.hazards.value}, reserved ${peak.reservedBullets.value}, combined ${peak.livePlusReserved.value}`);
}
const ranked = [...report.cases].sort((a, b) => b.peak.hostile.value - a.peak.hostile.value || b.peak.hazards.value - a.peak.hazards.value || b.peak.reservedBullets.value - a.peak.reservedBullets.value);
report.selected = (({ season, difficulty, cardIndex, cardId, name, pattern, peak }) => ({ season, difficulty, cardIndex, cardId, name, pattern, peak }))(ranked[0]);
report.rankingResults = ranked.map(({ cardId, difficulty, peak }) => ({ cardId, difficulty, live: peak.hostile.value, liveAt: peak.hostile.at, hazards: peak.hazards.value, reserved: peak.reservedBullets.value }));
report.changedSources = [];
for (const [file, expected] of Object.entries(loader.hashes)) if (sha(await readFile(resolve(root, file))) !== expected) report.changedSources.push(file);
report.status = report.changedSources.length ? 'snapshot-with-source-drift' : 'complete';
report.finishedAt = new Date().toISOString();
await mkdir(output, { recursive: true });
const file = resolve(output, `spell-density-v${report.version}.json`);
await writeFile(file, JSON.stringify(report, null, 2) + '\n');
console.log(`Selected ${report.selected.difficulty} ${report.selected.cardId}: ${report.selected.peak.hostile.value} sampled hostile bullets. Saved ${file}; ${report.status}.`);
