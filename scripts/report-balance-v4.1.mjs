import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, process.argv[2] ?? 'docs/validation/balance-v4.1.0.json');
const report = JSON.parse(await readFile(source, 'utf8'));
if (report.version !== '4.1.0' || !Array.isArray(report.cases)) throw new Error('Expected a v4.1 balance report');
const destination = source.replace(/\.json$/, '.md');
if (destination === source) throw new Error('The source report must be a JSON file');
const round = value => Math.round(value * 100) / 100;
const range = values => values.length ? `${round(Math.min(...values))}–${round(Math.max(...values))}` : '—';
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? round((sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2) : null;
};
const names = { main: '主炮偏好', drone: '子机偏好', resource: '资源偏好' };
const difficulties = { normal: '普通', hard: '困难' };
const campaign = report.cases.filter(item => item.season === 's2' && !item.bossOnly && item.skills);
const normalHp = campaign.filter(item => !item.immortal);
const completed = items => items.filter(item => item.status === 'complete');
const checks = [];
for (const [index, item] of report.cases.entries()) {
  const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0);
  if (Math.abs(item.totals.seconds - item.elapsed) > 0.002) checks.push(`case ${index + 1}: elapsed/segment total mismatch`);
  if (Math.abs(sum(item.segments, 'bossDamage') - item.finalBossDamage) > 0.005) checks.push(`case ${index + 1}: Boss damage total mismatch`);
  for (const row of item.segments) {
    if (Math.abs(Object.values(row.sources).reduce((a, b) => a + b, 0) - row.damage) > 0.005) checks.push(`case ${index + 1}/${row.id}: damage-source sum mismatch`);
  }
  if (!item.skills && (item.totals.commands || item.totals.beams)) checks.push(`case ${index + 1}: QE-disabled control used a skill`);
  if (item.status === 'complete' && item.segments.filter(row => row.id.startsWith('card:')).length !== 6) checks.push(`case ${index + 1}: victory lacks six actual cards`);
  if (item.status === 'complete' && item.season === 's2' && !item.bossOnly && (item.choices.length !== 7 || item.catchup.join(',') !== '2,4')) checks.push(`case ${index + 1}: campaign skipped choices or catch-up`);
}
if (report.status === 'complete' && report.cases.length !== report.plannedCases) checks.push('The completed report has a partial case count');
if (checks.length) throw new Error(`Balance report failed consistency checks:\n${checks.join('\n')}`);
const table = (columns, rows) => [`| ${columns.join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.join(' | ')} |`)].join('\n');
const outcome = item => item.status === 'complete' ? '通关' : item.status === 'failed' ? '死亡' : '到时未完成';
const time = item => item ? `${round(item.elapsed)} / ${round(item.finalBossSeconds)}${item.status === 'complete' ? '' : '（未通关）'}` : '—';
const sourceTotal = (items, key) => items.reduce((sum, item) => sum + item.segments.filter(row => row.id.startsWith('card:'))
  .reduce((total, row) => total + (row.sources[key] ?? 0), 0), 0);
const lines = [
  '# v4.1 平衡矩阵记录', '',
  `记录时间：${report.finishedAt ?? report.abortedAt ?? report.generatedAt}。数据文件：[${source.split(/[\\/]/).at(-1)}](./${source.split(/[\\/]/).at(-1)})。`, '',
  `矩阵执行状态：**${report.status}，${report.cases.length}/${report.plannedCases} case 已落盘**。${report.calibrationOnly ? '**本文件仅为校准或中断记录，不能作为最终验收通过。**' : '执行完成与游戏通关分别统计；死亡和到时未完成样本保留在下表与 JSON。'}`,
  `S2 正式矩阵已记录 ${campaign.length}/108 case，其中正常生命 ${normalHp.length} 个、无敌输出 ${campaign.length - normalHp.length} 个；另有 ${report.cases.length - campaign.length} 个独立对照。`, '',
  '## 方法与边界', '',
  '- 使用真实 GameSimulation，以固定 60 Hz 推进。每 100 ms 决定输入；最终首领的已显示预告经过 200 ms 反应延迟。使用真实种子、七次实际三选一、合法技能资源和按下/松开边沿。',
  '- 正常生命机器人使用游戏的生命、冲刺、炸弹与拾取规则，不额外增加生命或无敌。无敌组每帧把无敌时间设为 3600 秒，仅用于观察输出可达性与跑位影响。两组不合并评价生存率。',
  '- 控制器能精确瞄准和预测可见弹轨，不读取尚未决定的 AI 攻击；它没有专门绕盾或主动瞄准暴露发射器的策略。测试通过不代表人工试玩结论，失败也不直接证明攻击不可躲。',
  '- 进攻冲刺的附加策略只检查附近身体距离，直接把已选择的步行方向改成冲刺，并未重新检查这条更长路径上的弹幕。它可能消耗本可留给防御的冲刺，或在冲刺结束时进入弹道；这项控制器局限也保留在原始结果中，不能据此削弱游戏攻击。',
  '- 总流程时间含六段普通战斗、小首领、入场及六张符卡；不含升级菜单思考时间。最终 Boss 时间只累计六张符卡，含各卡入场/恢复，**不包含之前的入场倒计时**。表中总时间与 Boss 时间分别列出。',
  '- 有效战斗时间指场内存在敌人、敌弹或地面/激光危险的模拟时间。Boss 身体 DPS 只计该首领实际扣除的 HP；弱点伤害单列，节点及其他敌人的伤害不计入 Boss 身体 DPS。',
  '- 伤害来源来自实际 CombatEvent；通用模块弹仍汇总为 module。完整来源、目标类型、技能次数、过热时长、拾取及受伤时间线保留在 JSON。',
  '- QE 关闭对照仍保留正常防御冲刺；只在 QE 开启时额外尝试安全距离内的进攻冲刺，因此该对照衡量整套主动技能使用方式。',
  '- 单 Node 进程以 BelowNormal 优先级运行，每个 case 之间让出 100 ms；可以在 case 边界暂停让位给 GPU 测量。computeSeconds/cpuSeconds 是验证器运行开销，不是浏览器帧率。', '',
  `源码完整性：${report.changedSourcesAfterRun?.length ? `运行后有变更：${report.changedSourcesAfterRun.join('、')}；不能混用为最终版本证据。` : report.status === 'complete' ? '模拟源码、旧控制器及加载器的哈希全程一致，详见 JSON sourceHashes。' : '中断/运行中记录尚未完成最终源码一致性检查。'}`,
  ...(report.harnessVersions?.length > 1 ? ['报告写入器发生 Windows UNKNOWN/open 错误后增加了原子替换、重试与断点续跑；没有证据确定文件被哪一进程占用。已跑与续跑的全部 case 参数、执行函数及顺序签名一致；新旧写入器哈希和恢复位置分别保存在 harnessVersions/resumeHistory，没有更改模拟。'] : []), '',
  '报告一致性检查：已核对总时间、分段伤害来源之和、Boss 伤害总量、关闭 QE 时技能零触发，以及已通关 S2 的七次选择/两次追赶/六张符卡完整性。', '',
];

for (const immortal of [false, true]) {
  lines.push(`## S2 ${immortal ? '无敌输出对照' : '正常生命结果'}`, '',
    '时间与 DPS 范围仅由已通关样本计算；死亡样本不会以较短的残缺 Boss 时间冒充更快通关。每组原计划三个种子。', '');
  const rows = [];
  for (const difficulty of ['normal', 'hard']) for (const level of [4, 7, 10]) for (const profile of Object.keys(names)) {
    const samples = campaign.filter(item => item.immortal === immortal && item.difficulty === difficulty && item.level === level && item.profile === profile);
    if (!samples.length) continue;
    const done = completed(samples);
    rows.push([difficulties[difficulty], `Lv${level}/${level === 4 ? 1 : 3}`, names[profile], `${done.length}/${samples.length}`,
      range(done.map(item => item.elapsed)), range(done.map(item => item.finalBossSeconds)), range(done.map(item => item.finalBossDps))]);
  }
  lines.push(table(['难度', '继承等级/子机', '选取偏好', '通关/已跑', '总流程秒', 'Boss 秒', 'Boss 身体 DPS'], rows), '');
}

lines.push('## 基准与技能对照', '');
const s1 = report.cases.filter(item => item.season === 's1' && item.bossOnly && item.skills);
lines.push(table(['S1 Lv7/3', '结果', 'Boss 秒', '身体 DPS', 'Q / E / 炸弹'], s1.map(item => [item.immortal ? '无敌输出' : '正常生命', outcome(item), round(item.finalBossSeconds), item.finalBossDps,
  `${item.totals.beams} / ${item.totals.commands} / ${item.totals.bombs}`])), '');
const controls = report.cases.filter(item => item.season === 's2' && !item.skills && !item.immortal);
lines.push(table(['中继承、同种子正常生命', 'QE 开启：总/Boss 秒', 'QE 关闭：总/Boss 秒', '开启 Q / E 次数', '关闭结果'], controls.map(item => {
  const pair = campaign.find(other => !other.immortal && other.seed === item.seed && other.profile === item.profile && other.level === item.level && other.difficulty === item.difficulty);
  return [names[item.profile], time(pair), time(item), pair ? `${pair.totals.beams} / ${pair.totals.commands}` : '—', outcome(item)];
})), '');
const immortalControls = report.cases.filter(item => item.season === 's2' && !item.skills && item.immortal);
lines.push(table(['中继承、同种子无敌输出', 'QE 开启：总/Boss 秒', 'QE 关闭：总/Boss 秒', '关闭结果'], immortalControls.map(item => {
  const pair = campaign.find(other => other.immortal && other.seed === item.seed && other.profile === item.profile && other.level === item.level && other.difficulty === item.difficulty);
  return [names[item.profile], time(pair), time(item), outcome(item)];
})), '');
const positioning = report.cases.filter(item => ['circle', 'oldLane'].includes(item.policy));
lines.push(table(['S1 简单走位对照', '结果', '存活/通关秒', '最后到达符卡', '剩余生命'], positioning.map(item => [item.policy === 'circle' ? '固定圆周' : '旧安全方向', outcome(item), item.elapsed, item.lastCard ?? '—', item.hp])), '');
if (positioning.some(item => item.policy === 'circle' && item.injuries.at(-1)?.source === 'body')) lines.push('圆周对照的最后死因为身体接触：这条具体旧路线会擦到首领，不能据此证明弹幕能破解所有圆周路径。旧安全方向对照与完整实际走位测试应分别解释。', '');

lines.push('## 普通中继承：各段与最终攻击来源', '', '以下汇总三个种子的正常生命、QE 开启样本；中位数仅使用该构筑通关样本。来源是符卡期间对所有敌方实体的伤害构成，包含可破坏节点，**不等于 Boss 身体 DPS 的分子**。', '');
const segmentRows = [], damageRows = [];
for (const profile of Object.keys(names)) {
  const items = completed(campaign.filter(item => !item.immortal && item.difficulty === 'normal' && item.level === 7 && item.profile === profile));
  if (!items.length) continue;
  const segmentMedian = id => median(items.map(item => item.segments.find(row => row.id === id)?.seconds).filter(Number.isFinite)) ?? '—';
  segmentRows.push([names[profile], ...[1, 2, 3, 4, 5, 6].map(stage => segmentMedian(`stage:${stage}`)), segmentMedian('s2:palisade'), segmentMedian('s2:reprise'), median(items.map(item => item.finalBossSeconds))]);
  const sourceKeys = ['normal', 'drone', 'beam', 'special', 'module', 'blade', 'chain', 'device', 'heavy'];
  const amounts = sourceKeys.map(key => sourceTotal(items, key)), total = amounts.reduce((sum, amount) => sum + amount, 0);
  damageRows.push([names[profile], ...amounts.map(amount => `${round(total ? amount / total * 100 : 0)}%`)]);
}
lines.push(table(['偏好', '段1', '段2', '段3', '段4', '段5', '段6', 'PALISADE', 'REPRISE', '最终 Boss'], segmentRows), '',
  table(['偏好', '主炮', '子机', 'Q', '特殊弹', '通用模块', '护刃', '连锁', '装置', '敌方重弹'], damageRows), '');

const unsuccessful = report.cases.filter(item => item.status !== 'complete');
lines.push('## 未通关记录', '', unsuccessful.length ? table(['种子', '季/难度', '继承', '偏好/策略', '无敌', '结果', '总秒 / Boss 秒', '最后符卡', '最后伤害'], unsuccessful.map(item => [item.seed,
  `${item.season}/${difficulties[item.difficulty]}`, `Lv${item.level}/${item.companions}`, item.policy && item.policy !== 'reactive' ? item.policy : names[item.profile],
  item.immortal ? '是' : '否', outcome(item), `${item.elapsed} / ${item.finalBossSeconds}`, item.lastCard ?? '—', item.injuries.at(-1)?.source ?? '—'])) : '本次已记录 case 中没有未通关样本。', '');

const middle = completed(normalHp.filter(item => item.difficulty === 'normal' && item.level === 7));
const low = completed(normalHp.filter(item => item.difficulty === 'normal' && item.level === 4));
const normalCompleted = completed(normalHp.filter(item => item.difficulty === 'normal'));
lines.push('## 可据此判断的范围', '',
  `- 普通中继承已通关样本：总流程 ${range(middle.map(item => item.elapsed))} 秒，最终 Boss ${range(middle.map(item => item.finalBossSeconds))} 秒。`,
  `- 普通低继承已通关样本：总流程 ${range(low.map(item => item.elapsed))} 秒，最终 Boss ${range(low.map(item => item.finalBossSeconds))} 秒。追赶奖励的实际触发段保留在每个 case 的 catchup 数组。`,
  `- 普通正常生命已通关的 ${normalCompleted.length} 个样本中，${normalCompleted.filter(item => item.elapsed >= 600 && item.elapsed <= 900).length} 个总流程处于 10–15 分钟；${normalCompleted.filter(item => item.finalBossSeconds >= 120 && item.finalBossSeconds <= 180).length} 个 Boss 位于 120–180 秒。较强构筑允许更快，区间外样本照实保留。`,
  `- 困难正常生命已通关的 ${completed(normalHp.filter(item => item.difficulty === 'hard')).length} 个样本中，${completed(normalHp.filter(item => item.difficulty === 'hard')).filter(item => item.elapsed > 900).length} 个总流程超过 15 分钟；最高 ${Math.max(0, ...completed(normalHp.filter(item => item.difficulty === 'hard')).map(item => item.elapsed))} 秒。困难档额外压力与普通基准分开评价。`,
  '- 正常生命与无敌组存在不同走位及资源路径，差值只能作为输出损失线索，不能当作单一机制的因果证明。默认数值的最终体验仍需要真人试玩反馈。', '');
await writeFile(destination, `${lines.join('\n').trimEnd()}\n`);
console.log(`Wrote ${destination} (${report.status}, ${report.cases.length}/${report.plannedCases} cases).`);
