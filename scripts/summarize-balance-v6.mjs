import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, sep, basename } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..'), output = resolve(root, 'docs/validation'), scratch = resolve(root, '.tmp/v6-research');
const checked = path => {
  const absolute = resolve(path);
  if (!absolute.toLowerCase().startsWith(root.toLowerCase() + sep)) throw new Error(`Path outside this worktree: ${absolute}`);
  return absolute;
};
const round = number => Math.round(number * 1000) / 1000;
const quantile = (values, fraction) => values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)] : null;
const distribution = values => ({ count: values.length, min: values.length ? Math.min(...values) : null, p25: quantile(values, 0.25), median: quantile(values, 0.5), p75: quantile(values, 0.75), p90: quantile(values, 0.9), max: values.length ? Math.max(...values) : null });
const sum = values => values.reduce((a, b) => a + b, 0);
const encounters = ['s1:echo', 's2:palisade', 's1:mafuyu', 's2:reprise', 's2:final'];
const names = ['ECHO', 'PALISADE', 'MAFUYU', 'REPRISE', 'LACUNA'];
const rawPath = checked(resolve(output, 'balance-v6.0.0.json'));
async function readReport(path) {
  try { return await readFile(checked(path)); } catch (error) { if (error.code !== 'ENOENT') throw error; return gunzipSync(await readFile(checked(path + '.gz'))); }
}
const raw = await readReport(rawPath), report = JSON.parse(raw);
if (report.status !== 'complete' || report.cases.length !== 80 || report.cases.some(item => item.mode !== 'normalHP')) throw new Error('Final report is incomplete, stale or is not the 80-case normal-HP matrix.');

function lifetimes(item) {
  return item.bossEntries.map(entry => {
    const death = item.deaths.find(life => ['boss', 'miniboss'].includes(life.role) && life.type === entry.type && Math.abs(life.born - entry.elapsed) < 0.1);
    return { entry, born: entry.elapsed, died: death?.died ?? item.elapsed, seconds: death?.ttk ?? null };
  });
}
function phaseSummary(items, from, until) {
  const samples = items.flatMap(item => {
    const bosses = lifetimes(item);
    return item.telemetry.filter(sample => sample.progression >= from && sample.progression < until && !bosses.some(boss => sample.elapsed >= boss.born && sample.elapsed <= boss.died));
  });
  const ordinaryKilled = sum(samples.map(item => item.windowOrdinaryKilled));
  // Reconstruct the exact numerator from per-enemy deaths for each sampled ten-second window.
  let observedAttack = 0, released = 0, killed = 0;
  for (const item of items) {
    const bosses = lifetimes(item);
    for (const sample of item.telemetry) {
      if (sample.progression < from || sample.progression >= until || bosses.some(boss => sample.elapsed >= boss.born && sample.elapsed <= boss.died)) continue;
      const deaths = item.deaths.filter(life => life.role === 'mob' && life.killedByDamage && life.died > sample.elapsed - 10 && life.died <= sample.elapsed + 0.001);
      killed += deaths.length;
      observedAttack += deaths.filter(life => life.firstAttack !== null).length;
      released += deaths.filter(life => life.firstRelease !== null || life.firstAttack !== null).length;
    }
  }
  return { from, until, sampleCount: samples.length, includes: 'Routine combat and light elites; excludes timestamps inside the five major boss lifetimes.', enemyBullets: distribution(samples.map(item => item.enemyBullets)), ordinaryAlive: distribution(samples.map(item => item.ordinaryAlive)),
    ordinaryKilled, exactWindowKilled: killed, observedAttack, firstAttackRatio: killed ? round(observedAttack / killed) : null, released, releaseRatio: killed ? round(released / killed) : null,
    visibleTtkWindowMedians: distribution(samples.map(item => item.windowVisibleTtkP50).filter(value => value !== null)), admissionTimeoutWindowRate: distribution(samples.map(item => item.windowAdmissionTimeoutRate)), reservationCancelWindowRate: distribution(samples.map(item => item.windowReservationCancelRate)) };
}
function summarize(items) {
  const completed = items.filter(item => item.result === 'complete');
  const sourceDamage = {};
  for (const item of items) for (const row of item.segments) for (const [source, amount] of Object.entries(row.sources)) sourceDamage[source] = (sourceDamage[source] ?? 0) + amount;
  const totalDamage = sum(Object.values(sourceDamage));
  const reservations = {};
  for (const item of items) for (const [key, value] of Object.entries(item.reservations)) reservations[key] = (reservations[key] ?? 0) + value;
  return { cases: items.length, results: Object.fromEntries([...new Set(items.map(item => item.result))].map(result => [result, items.filter(item => item.result === result).length])),
    completionSeconds: distribution(completed.map(item => item.elapsed)), choices: distribution(items.map(item => item.choices.length)),
    choiceGoal: { lower: 24, upper: 30, below: items.filter(item => item.choices.length < 24).length, within: items.filter(item => item.choices.length >= 24 && item.choices.length <= 30).length,
      above: items.filter(item => item.choices.length > 30).length, atLeast24Share: round(items.filter(item => item.choices.length >= 24).length / items.length) },
    lowChoiceRuns: items.filter(item => item.choices.length <= 22).map(item => ({ seed: item.seed, profile: item.profile, seconds: item.elapsed, choices: item.choices.length, xpPickups: item.collectedXp,
      ordinaryKills: item.deaths.filter(life => life.role === 'mob' && life.killedByDamage).length, injuries: item.injuries.length,
      choiceSources: Object.fromEntries([...new Set(item.choices.map(choice => choice.source))].map(source => [source, item.choices.filter(choice => choice.source === source).length])),
      bossTtk: lifetimes(item).map(life => ({ id: life.entry.id, seconds: life.seconds })) })),
    injuryEvents: distribution(items.map(item => item.injuries.length)), bombsUsed: distribution(items.map(item => sum(item.segments.map(row => row.bombs)))),
    finalHp: distribution(items.map(item => item.hp)), finalBombs: distribution(items.map(item => item.bombs)), coreHits: distribution(items.map(item => item.coreHits)), xpPickups: distribution(items.map(item => item.collectedXp)), reservations,
    early: phaseSummary(items, 0, 90), late: phaseSummary(items, 300, 360),
    bosses: encounters.map((id, index) => {
      const rows = items.map(item => {
        const life = lifetimes(item).find(value => value.entry.id === id), segments = item.segments.filter(row => row.id === id || row.id.startsWith(id + ':card'));
        return life ? { seed: item.seed, profile: item.profile, seconds: life.seconds, level: life.entry.level, totalRanks: life.entry.totalRanks, moduleKinds: life.entry.modules.length, evolutions: life.entry.evolutions.length, hp: life.entry.hp, bombs: life.entry.bombs,
          actualBossDamage: round(sum(segments.map(row => row.bossDamage))), dps: life.seconds ? round(sum(segments.map(row => row.bossDamage)) / life.seconds) : null } : null;
      }).filter(Boolean);
      return { id, name: names[index], ttk: distribution(rows.map(row => row.seconds).filter(value => value !== null)), entryLevel: distribution(rows.map(row => row.level)), entryTotalRanks: distribution(rows.map(row => row.totalRanks)), actualDps: distribution(rows.map(row => row.dps).filter(value => value !== null)), longest: [...rows].filter(row => row.seconds !== null).sort((a, b) => b.seconds - a.seconds).slice(0, 3) };
    }),
    sources: Object.entries(sourceDamage).sort((a, b) => b[1] - a[1]).map(([source, amount]) => ({ source, damage: round(amount), share: round(amount / totalDamage) })),
    profiles: [...new Set(items.map(item => item.profile))].map(profile => ({ profile, seconds: distribution(completed.filter(item => item.profile === profile).map(item => item.elapsed)), choices: distribution(items.filter(item => item.profile === profile).map(item => item.choices.length)) })) };
}
const collection = [];
await mkdir(scratch, { recursive: true });
async function archive(path) {
  path = checked(path);
  let data;
  try { data = await readFile(path); } catch (error) { if (error.code !== 'ENOENT') throw error; await readFile(checked(path + '.gz')); return; }
  await writeFile(checked(path + '.gz'), gzipSync(data, { level: 9 }));
  await rename(path, checked(resolve(scratch, basename(path))));
}
for (const policy of ['low', 'medium', 'high']) {
  const path = checked(resolve(output, `balance-v6-collection-${policy}-dps.json`)), data = JSON.parse(await readReport(path));
  if (data.status !== 'complete') throw new Error(`${policy} collection report is not complete.`);
  const item = data.cases[0];
  collection.push({ policy, mode: item.mode, seed: item.seed, seconds: item.elapsed, xpPickups: item.collectedXp, choices: item.choices.length, entryLevels: item.bossEntries.map(entry => entry.level), entryTotalRanks: item.bossEntries.map(entry => entry.totalRanks), moduleKinds: item.modules.length, evolutions: item.evolutions.length, archive: basename(path) + '.gz' });
}
const summary = { version: report.version, status: report.status, measuredAt: report.measuredAt, finishedAt: report.finishedAt, archive: 'balance-v6.0.0.json.gz', sourceHashes: report.sourceHashes, method: report.method, limitations: report.limitations, metricDefinitions: report.metricDefinitions,
  normal: summarize(report.cases.filter(item => item.difficulty === 'normal')), hard: summarize(report.cases.filter(item => item.difficulty === 'hard')), collection };
try { summary.xpAudit = JSON.parse(await readFile(resolve(output, 'growth-v6.0.0-xp-audit.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await writeFile(checked(resolve(output, 'balance-v6.0.0-summary.json')), JSON.stringify(summary, null, 2) + '\n');
const fmt = value => value === null ? '—' : value.toFixed(3);
const mainRows = ['normal', 'hard'].map(key => { const item = summary[key]; return `| ${key === 'normal' ? '普通' : '困难'} | ${item.results.complete ?? 0}/${item.cases} | ${fmt(item.completionSeconds.min)}–${fmt(item.completionSeconds.max)} | ${fmt(item.completionSeconds.median)} | ${item.choices.min}–${item.choices.max} | ${item.injuryEvents.min}–${item.injuryEvents.max} | ${item.bombsUsed.min}–${item.bombsUsed.max} |`; });
const phaseRows = ['normal', 'hard'].flatMap(key => ['early', 'late'].map(phase => { const value = summary[key][phase]; return `| ${key === 'normal' ? '普通' : '困难'} | ${value.from}–${value.until} | ${value.sampleCount} | ${value.enemyBullets.median}／${value.enemyBullets.p90}／${value.enemyBullets.max} | ${value.observedAttack}/${value.exactWindowKilled}（${fmt(100 * value.firstAttackRatio)}%） | ${fmt(100 * value.releaseRatio)}% |`; }));
const bossRows = names.map((name, index) => `| ${name} | ${fmt(summary.normal.bosses[index].ttk.median)}（${fmt(summary.normal.bosses[index].ttk.min)}–${fmt(summary.normal.bosses[index].ttk.max)}） | ${fmt(summary.hard.bosses[index].ttk.median)}（${fmt(summary.hard.bosses[index].ttk.min)}–${fmt(summary.hard.bosses[index].ttk.max)}） | ${summary.normal.bosses[index].entryLevel.min}–${summary.normal.bosses[index].entryLevel.max} |`);
const lowRows = summary.normal.lowChoiceRuns.map(item => `| ${item.seed}／${item.profile} | ${item.choices} | ${item.seconds} | ${item.ordinaryKills}／${item.xpPickups} | ${item.injuries} | ${item.bossTtk.map(boss => boss.seconds).join('／')} |`);
const auditRows = (summary.xpAudit?.cases ?? []).map(item => `| ${item.seed}／${item.profile} | ${item.choices} | ${item.earnedXp} | ${item.xpLost} | ${item.earnedResonanceRanks} | ${item.unspentResonanceXp} |`);
const section = `## 最终正常生命矩阵

80 局已结束，报告状态 \`complete\`，所有加载源码开始／结束 SHA-256 一致。完整原始记录：\`balance-v6.0.0.json.gz\`；精简汇总：\`balance-v6.0.0-summary.json\`。单位为模拟秒，不计玩家停留选卡的现实时间。

| 难度 | 通关/局数 | 完成时间范围 | 完成时间中位 | 选卡次数 | 受伤事件数 | 炸弹使用数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${mainRows.join('\n')}

**选卡机会目标尚未整体达到。** 普通选卡次数 P25／中位／P75 为 ${summary.normal.choices.p25}／${summary.normal.choices.median}／${summary.normal.choices.p75}；达到 24 次的占 ${summary.normal.choiceGoal.atLeast24Share * 100}%（${summary.normal.choiceGoal.within + summary.normal.choiceGoal.above}/40），${summary.normal.choiceGoal.below}/40 低于 24 次，即多数低于 24–30 次的设计目标。困难 ${summary.hard.choiceGoal.within}/40 在 24–30 内，${summary.hard.choiceGoal.above}/40 高于 30。目标不是每局硬保底；保留真实 600 XP 阈值和受伤扣经验规则，列为首版后续平衡观察项。

以下普通 21／22 次局，9 次等级、5 次轻精英、4 次主首领奖励均完整；差异全部在共鸣次数，没有漏排选择。五首领 TTK 顺序为 ECHO／PALISADE／MAFUYU／REPRISE／LACUNA。

| 种子／偏好 | 选卡 | 有效秒数 | 普通伤害击杀／XP 球 | 受伤 | 五首领 TTK |
| --- | ---: | ---: | --- | ---: | --- |
${lowRows.join('\n')}

独立 XP 审计复用完全相同的输入、选择控制器，只读包装生产 gainXp 和 xpLoss 事件；来源 \`growth-v6.0.0-xp-audit.json\`。累计经验减去受伤损失，等于 Lv10 所需 3970 + 600 × 共鸣选卡 + 未满额余额，四局均精确守恒。

| 种子／偏好 | 选卡 | 全来源获得 XP | 受伤损失 XP | 共鸣选择 | 共鸣余额 |
| --- | ---: | ---: | ---: | ---: | ---: |
${auditRows.join('\n')}

低选卡不是简单的“强构筑快杀导致少增援”：60007 混合局用时约 799 秒却仅 21 次，而更快的 60001 主炮局约 707 秒有 24 次。前者击杀和 XP 球收益较少，且实际损失 1054 XP，后者仅损失 100 XP；慢至约 867 秒的机动局也只有 22 次。应结合清杂效率、伤害扣经验和功能掉落转换观察，不能只用通关快慢解释。

按推进时间比较常规战斗与轻精英；排除五主首领的存活区间。十秒样本中，首攻分子直接从对应伤害死亡记录重新计数，不平均百分比；单次样本可能跨段落边界，原始时间戳均保留。

| 难度 | 推进区间 | 十秒样本数 | 敌弹中位／P90／最大 | 实际首攻比例 | 释放阶段比例 |
| --- | --- | ---: | --- | --- | ---: |
${phaseRows.join('\n')}

五主首领 TTK 为实体出生至击破，包含其动作和符卡过渡；不是用理论满命中 DPS 推算。每行给中位及最短–最长。

| 首领 | 普通 TTK | 困难 TTK | 普通入口等级范围 |
| --- | --- | --- | --- |
${bossRows.join('\n')}

普通预约审计：已承诺释放拒绝 ${summary.normal.reservations.rejectedPromisedEmission} 次，带剩余载荷到期 ${summary.normal.reservations.expiredWithPayload} 次；困难对应 ${summary.hard.reservations.rejectedPromisedEmission}／${summary.hard.reservations.expiredWithPayload} 次。到期与主动打断、伤害击杀、清场重置的来源细分保留在压缩原始文件中，不用到期数伪称危险实际落地率。

自动控制器的无损或少伤结果不代表真人难度。四个偏好会改变真实选卡，但控制器不会针对每个近程模块调整最佳站位，也不会主动规划所有弱点窗口，所以这不是各构筑的最优 DPS 排名。后续真人重点验证后期战术怪能否被识别、精英动作需要何种学习、无目标模块的构筑能否在资源压力下完成，以及较长的困难机动构筑战斗是否乏味。没有为迎合时长目标更改首领 HP。

三档收集原始记录也压缩为 \`balance-v6-collection-{low,medium,high}-dps.json.gz\`。开发中间记录与未压缩副本放入本地 \`.tmp/v6-research\`，不作为发布证据。运行 \`node scripts/balance-v6.mjs\` 可重生成完整原始数据，再运行 \`node scripts/summarize-balance-v6.mjs\` 生成压缩与汇总。
`;
const docPath = checked(resolve(output, 'balance-v6.0.0.md')), doc = await readFile(docPath, 'utf8');
await writeFile(docPath, doc.slice(0, doc.indexOf('## 最终正常生命矩阵')) + section);
await archive(rawPath);
for (const policy of ['low', 'medium', 'high']) await archive(resolve(output, `balance-v6-collection-${policy}-dps.json`));
for (const name of ['balance-v6-first-dps.json', 'balance-v6-matrix-first.json', 'balance-v6-normal-controller-check.json', 'balance-v6-metrics-audit.json']) {
  try { await rename(checked(resolve(output, name)), checked(resolve(scratch, name))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
console.log(JSON.stringify({ normal: summary.normal.completionSeconds, hard: summary.hard.completionSeconds, archive: summary.archive }));
