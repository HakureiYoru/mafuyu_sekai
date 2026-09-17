import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

// Reuse exactly the frozen balance controller; add read-only XP bookkeeping only.
// Production simulation imports and every input/choice branch remain byte-for-byte unchanged.
const root = resolve(import.meta.dirname, '..'), source = await readFile(resolve(root, 'scripts/balance-v6.mjs'), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
let audit = source.slice(0, source.indexOf('\nconst quick ='));
const replaceOnce = (before, after) => {
  if (!audit.includes(before) || audit.indexOf(before) !== audit.lastIndexOf(before)) throw new Error('Frozen audit insertion anchor changed.');
  audit = audit.replace(before, after);
};
replaceOnce("from './simulation-loader.mjs'", `from ${JSON.stringify(pathToFileURL(resolve(root, 'scripts/simulation-loader.mjs')).href)}`);
replaceOnce("const root = resolve(import.meta.dirname, '..'), output = resolve(root, 'docs/validation');", `const root = ${JSON.stringify(root)}, output = resolve(root, 'docs/validation');`);
replaceOnce('let collectedXp = 0, budgetAttempts', 'let earnedXp = 0, xpLost = 0, collectedXp = 0, budgetAttempts');
replaceOnce('const originalDamage = sim.damageEnemy.bind(sim);', `const originalGainXp = sim.gainXp.bind(sim);
  sim.gainXp = value => { if (Number.isFinite(value) && value > 0) earnedXp += value; return originalGainXp(value); };
  const originalDamage = sim.damageEnemy.bind(sim);`);
replaceOnce('for (const event of sim.step(action)) {', "for (const event of sim.step(action)) {\n      if (event.type === 'xpLoss') xpLost += event.amount;");
replaceOnce('collectedXp, hp: w.player.hp, bombs:', 'collectedXp, earnedXp, xpLost, unspentResonanceXp: w.build.resonanceXp, earnedResonanceRanks: w.build.resonance, hp: w.player.hp, bombs:');
audit += `
const collectionPolicy = 'high';
const cases = [run(60007, 'normal', 'balanced', false), run(60005, 'normal', 'mobility', false), run(60001, 'normal', 'main', false), run(60009, 'normal', 'balanced', false)];
export default { cases: cases.map(item => ({ seed: item.seed, profile: item.profile, result: item.result, seconds: item.elapsed,
  choices: item.choices.length, choiceSources: Object.fromEntries([...new Set(item.choices.map(choice => choice.source))].map(source => [source, item.choices.filter(choice => choice.source === source).length])),
  ordinaryKills: item.deaths.filter(life => life.role === 'mob' && life.killedByDamage).length,
  injuries: item.injuries.length, xpPickups: item.collectedXp, earnedXp: item.earnedXp, xpLost: item.xpLost, unspentResonanceXp: item.unspentResonanceXp, earnedResonanceRanks: item.earnedResonanceRanks,
  bossTtk: item.bossEntries.map(entry => ({ id: entry.id, seconds: item.deaths.find(life => ['boss','miniboss'].includes(life.role) && life.type === entry.type && Math.abs(life.born-entry.elapsed)<.1)?.ttk ?? null })) })), sourceHashes: loader.hashes };
`;
const result = (await import(`data:text/javascript;base64,${Buffer.from(audit).toString('base64')}`)).default;
const report = { version: '6.0.0', method: 'Unmodified frozen balance input and choice controller with additive wrappers around production gainXp and xpLoss events; normal HP, no forced equipment or XP.', balanceScriptSha256: hash(source), auditScriptSha256: hash(await readFile(resolve(root, 'scripts/audit-growth-v6.mjs'))), ...result, changedSources: [] };
for (const [path, expected] of Object.entries(result.sourceHashes)) if (hash(await readFile(resolve(root, path))) !== expected) report.changedSources.push(path);
if (hash(await readFile(resolve(root, 'scripts/balance-v6.mjs'))) !== report.balanceScriptSha256) report.changedSources.push('scripts/balance-v6.mjs');
report.status = report.changedSources.length ? 'stale-sources' : 'complete';
await writeFile(resolve(root, 'docs/validation/growth-v6.0.0-xp-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.cases));
if (report.changedSources.length) process.exitCode = 2;
