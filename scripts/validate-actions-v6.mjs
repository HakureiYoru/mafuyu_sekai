import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { simulationLoader } from './simulation-loader.mjs';

// Isolated boss fixtures, then input-only controls: no production source is rewritten.
const root = resolve(import.meta.dirname, '..'), output = resolve(root, 'docs/validation');
const loader = simulationLoader(root);
const { GameSimulation } = await import(await loader.url('src/game/simulation.ts'));
const { bossActionTelegraph } = await import(await loader.url('src/game/boss-actions.ts'));
const { BALANCE, STEP, WORLD } = await import(await loader.url('src/game/config.ts'));
const round = value => Math.round(value * 1000) / 1000;
const point = entity => ({ x: round(entity.x), y: round(entity.y) });
const variants = ['palisade-intact', 'palisade-armless', 'reprise-half'];
const strategies = ['stationary', 'fixed-circle', 'single-retreat'];
const report = {
  version: '6.0.0', generatedAt: new Date().toISOString(), sourceHashes: loader.hashes,
  method: {
    step: STEP, maximumSeconds: 45, seed: 60217, hp: BALANCE.player.hp,
    equipment: 'Lv1, zero modules, zero companions; shooting / dash / bomb disabled',
    immunity: 'No artificial invincibility; retain ordinary on-hit protection and stop at real death',
    setup: 'Real open-world encounters without ordinary reinforcements. Break both PALISADE arms through damageEnemy; lower REPRISE to 45% HP through damageEnemy before measurement.',
    stationary: 'Hold initial position 360 world units below boss.',
    fixedCircle: 'Follow the same clockwise radius-360 circle at base speed; reads only elapsed time and own position.',
    singleRetreat: 'Hold down from y=700 toward the real y=3982 boundary, never steer from attacks. Record pre-boundary hits separately.',
    limitations: 'Blind-control tests establish pressure / exploit candidates, not human difficulty or proof of survival for all inputs. No build DPS or ordinary-add pressure is included.',
  },
  cases: [], summary: {},
};

function inputFor(strategy, sim, elapsed) {
  const p = sim.state.player;
  let moveX = 0, moveY = strategy === 'single-retreat' ? 1 : 0;
  if (strategy === 'fixed-circle') {
    const angle = Math.PI / 2 + elapsed * BALANCE.player.speed / 360;
    const dx = 2000 + Math.cos(angle) * 360 - p.x, dy = 2000 + Math.sin(angle) * 360 - p.y;
    const length = Math.hypot(dx, dy);
    if (length > 1e-8) { moveX = dx / length; moveY = dy / length; }
  }
  return { moveX, moveY, aimX: 2000, aimY: 2000, shoot: false, dash: false, bomb: false, focus: false };
}

function run(variant, difficulty, strategy) {
  const sim = new GameSimulation(60217, difficulty), w = sim.state, p = w.player;
  const reprise = variant === 'reprise-half', stage = reprise ? 4 : 2;
  const encounter = reprise ? 's2:reprise' : 's2:palisade';
  w.wave = stage; w.campaign.stage = stage; w.campaign.progression = reprise ? 300 : 180;
  w.campaign.phase = 'encounter'; w.campaign.activeEncounter = encounter; w.spawnTimer = 1e9;
  w.build.modules = []; w.build.ranks = {}; w.build.evolutions = []; w.companions = [];
  p.x = p.prevX = 2000; p.y = p.prevY = strategy === 'single-retreat' ? 700 : 2360;
  p.invincible = 0; p.bombs = 0;
  w.camera.x = w.camera.prevX = p.x; w.camera.y = w.camera.prevY = p.y;
  const boss = sim.spawnEnemy(reprise ? 'reprise' : 'palisade', 2000, p.y - 360, encounter);
  if (!boss) throw new Error('Boss fixture failed to spawn');
  boss.cooldown = 1; // The same one-second observation lead-in for all fixtures.
  if (reprise) sim.damageEnemy(boss, boss.hp * 0.55);
  sim.step(inputFor('stationary', sim, 0)); // Initialize real parts / phase transition.
  if (variant === 'palisade-armless') for (const arm of [...w.enemies]) if (arm.parentId === boss.id && arm.type === 'arm') sim.damageEnemy(arm, arm.hp);
  const begin = w.elapsed;
  const result = { variant, difficulty, strategy, elapsed: 0, status: 'playing', hp: p.hp, hits: 0, firstHitAt: null,
    boundaryAt: null, preBoundaryHits: 0, preBoundaryAttackStarts: 0, attackStarts: 0, bodyActions: 0,
    shots: 0, visibleBullets: 0, maximumBullets: 0, playerDistance: 0, bossDistance: 0, maximumSeparation: 0,
    hitsBySource: {}, actionKinds: {}, hitLog: [], actionLog: [], trajectory: [] };
  for (let tick = 0; tick < 45 * 60 && w.status === 'playing'; tick++) {
    const px = p.x, py = p.y, bx = boss.x, by = boss.y;
    const events = sim.step(inputFor(strategy, sim, w.elapsed - begin)), time = w.elapsed - begin;
    const atBoundary = p.x <= p.radius + 1e-7 || p.x >= WORLD.width - p.radius - 1e-7 || p.y <= p.radius + 1e-7 || p.y >= WORLD.height - p.radius - 1e-7;
    if (atBoundary && result.boundaryAt === null) result.boundaryAt = round(time);
    result.playerDistance += Math.hypot(p.x - px, p.y - py); result.bossDistance += Math.hypot(boss.x - bx, boss.y - by);
    result.maximumSeparation = Math.max(result.maximumSeparation, Math.hypot(p.x - boss.x, p.y - boss.y));
    const enemyBullets = w.bullets.filter(bullet => bullet.owner === 'enemy' && bullet.life > 0);
    result.visibleBullets += enemyBullets.filter(bullet => bullet.bornTick === w.tick).length;
    result.maximumBullets = Math.max(result.maximumBullets, enemyBullets.length);
    for (const event of events) {
      if (event.type === 'damage') {
        result.hits++; result.firstHitAt ??= round(time); if (result.boundaryAt === null) result.preBoundaryHits++;
        const source = event.damageSource ?? 'unknown'; result.hitsBySource[source] = (result.hitsBySource[source] ?? 0) + 1;
        result.hitLog.push({ time: round(time), source, damage: event.amount, player: point(p), boss: point(boss), state: boss.state, action: boss.action?.kind ?? null, phase: boss.action?.phase ?? null });
      }
      if (event.type === 'enemyShot') result.shots++;
      if (event.type !== 'attack' || event.targetId !== boss.id || !(event.text === 'windup' || event.text?.startsWith('action-'))) continue;
      result.attackStarts++; if (result.boundaryAt === null) result.preBoundaryAttackStarts++;
      const kind = event.text; result.actionKinds[kind] = (result.actionKinds[kind] ?? 0) + 1;
      if (kind.startsWith('action-')) result.bodyActions++;
      result.actionLog.push({ time: round(time), kind, player: point(p), boss: point(boss), phase: boss.season2?.phase,
        bodyPath: bossActionTelegraph(boss), bullets: enemyBullets.length });
    }
    if (tick % 30 === 0 || w.status !== 'playing') result.trajectory.push({ time: round(time), player: point(p), boss: point(boss),
      separation: round(Math.hypot(p.x - boss.x, p.y - boss.y)), hp: p.hp, bossState: boss.state,
      action: boss.action?.kind ?? null, actionPhase: boss.action?.phase ?? null, bullets: enemyBullets.length,
      nearestBulletClearance: enemyBullets.length ? round(Math.min(...enemyBullets.map(bullet => Math.hypot(p.x - bullet.x, p.y - bullet.y) - bullet.radius - BALANCE.player.hitRadius))) : null });
  }
  result.elapsed = round(w.elapsed - begin); result.status = w.status; result.hp = p.hp;
  for (const key of ['playerDistance', 'bossDistance', 'maximumSeparation']) result[key] = round(result[key]);
  return result;
}

for (const variant of variants) for (const difficulty of ['normal', 'hard']) for (const strategy of strategies) {
  const result = run(variant, difficulty, strategy); report.cases.push(result);
  console.log(`${variant} ${difficulty} ${strategy}: ${result.hits} hits, ${result.bodyActions} body actions / ${result.attackStarts} starts, ${result.elapsed}s, ${result.status}; boundary=${result.boundaryAt}, pre-boundary hits=${result.preBoundaryHits}`);
}
report.summary = {
  cases: report.cases.length,
  hitCases: report.cases.filter(result => result.hits > 0).length,
  naturalDeaths: report.cases.filter(result => result.status === 'failed').length,
  untouchedCases: report.cases.filter(result => result.hits === 0).map(({ variant, difficulty, strategy, bodyActions, attackStarts }) => ({ variant, difficulty, strategy, bodyActions, attackStarts })),
  retreatCases: report.cases.filter(result => result.strategy === 'single-retreat').map(({ variant, difficulty, firstHitAt, boundaryAt, preBoundaryHits, preBoundaryAttackStarts, status }) =>
    ({ variant, difficulty, firstHitAt, boundaryAt, preBoundaryHits, preBoundaryAttackStarts, status })),
};
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'actions-v6.0.0.json'), JSON.stringify(report, null, 2) + '\n');
const rows = report.cases.map(result => `| ${result.variant} | ${result.difficulty} | ${result.strategy} | ${result.hits} | ${result.bodyActions} / ${result.attackStarts} | ${result.elapsed} | ${result.status} | ${result.boundaryAt ?? '—'} / ${result.preBoundaryHits} |`).join('\n');
const notes = report.summary.untouchedCases.length ? `**${report.summary.untouchedCases.length} 组无伤，不视为通过难度验收。** 见 JSON 中完整动作和位置轨迹。` : `${report.summary.hitCases} 组均出现真实受伤，${report.summary.naturalDeaths} 组自然死亡；这只证明三种固定盲操作不能完全化解这些首领。`;
await writeFile(resolve(output, 'actions-v6.0.0.md'), `# v6 动作首领盲操作对照\n\n${notes}\n\n固定种子 60217，60Hz 原始生产模拟。每组最多 45 秒，死亡即停止；Lv1、5 HP，无装备、无子机、不开火、不冲刺、不炸弹、不设置无敌，保留正常受伤保护。隔离普通增援；断臂／半血仅在测量前通过真实伤害入口设置。\n\n单向后退始于 y=700，持续按下直到真实世界边界 y=3982。必须分开阅读触边前与触边后命中，不能把边界堵住当成开放区域追击成功。\n\n| 首领状态 | 难度 | 固定策略 | 受伤次数 | 位移动作 / 总起手 | 运行秒 | 结束状态 | 首次触边秒 / 触边前受伤 |\n| --- | --- | --- | ---: | ---: | ---: | --- | --- |\n${rows}\n\n本轮首跑曾发现普通断臂 PALISADE 被固定圆周完整躲过 45 秒、18 次动作，以及六组单向后退均直到触边才受伤，因此没有将首跑判为难度通过。原因是追赶在约 645 距离反复退回慢速、超出竖向可见起手范围；断臂后又只追当前位置或圆周切线。\n\n修正让视野外追赶持续到可见距离，并对连续后退预告有限提前量拦截；断臂横切用已发生的速度变化估计转向趋势，转向率限于 ±1.4 rad/s，平滑后仅在起手时采样。普通／困难动作预警仍为 0.7／0.5 秒，预告后目标与方向不再变化，临时变向可以诱导落空。没有改变生命、伤害、弹速或增加无敌门槛。\n\n[完整轨迹、命中来源和源码哈希](actions-v6.0.0.json)。自动对照不替代真人试玩或整局构筑平衡；死亡即止的短组也不等于观察了完整 45 秒所有组合。\n`);
