import { clamp, normalize, TAU } from './math';
import { difficultyConfig } from './difficulty';
import type { AreaHazard, ArenaRect, Bullet, CombatEvent, Difficulty, Enemy, EnemyShotOptions, Player, SeasonId } from './types';
import { beginBossAction, bossActionTarget, updateBossAction, type AttackBudgetContext } from './boss-actions';

const EPSILON = 1e-8;
export type SpellPattern = 'needles' | 'weave' | 'flower' | 'mirrors' | 'seals' | 'blank'
  | 'slices' | 'diagonals' | 'nodes' | 'reprise' | 'rings' | 'partition';
export interface SpellCardDefinition {
  readonly id: string; readonly name: string; readonly hp: number; readonly pattern: SpellPattern;
  readonly intro: number; readonly color: number;
}
export interface SpellTelegraph {
  id: number; sourceId: number; kind: 'wall' | 'fan' | 'ring';
  x: number; y: number; endX: number; endY: number; angle: number; spread: number; length: number;
  color: number; warning: number; remaining: number;
  /** Distance along the wall's emitting line, and the physical clear width between bullet edges. */
  gapCenter?: number; gapWidth?: number;
  motif?: 'star'; returnPaths?: readonly SpellReturnPath[];
}
export interface SpellReturnPath {
  x: number; y: number; turnX: number; turnY: number; endX: number; endY: number;
  remainingUntilReverse: number; wait: number; width: number;
}
interface PlannedShot { x: number; y: number; angle: number; speed: number; radius: number; color: number; options?: EnemyShotOptions }
interface SpellEmission extends SpellTelegraph { fireAt: number; shots: PlannedShot[] }
export interface SpellBrain {
  season: SeasonId; cardIndex: number; age: number; cycle: number; shotIndex: number; nextAttack: number;
  stage: 'intro' | 'active'; anchorIndex: number; targetX: number; targetY: number; partIds: number[];
  initialized: boolean; partsSpawned: boolean; cueSequence: number; holdUntil: number;
  gateCenter: number; gateDirection: 1 | -1; cues: SpellEmission[];
  nextMotion: number; motionCycle: number; retreatX: number; retreatY: number;
  beat: 'volley' | 'drain' | 'motion' | 'recover'; clearAt: number;
  passage: SpellPassage | null;
}
/** Collision-space opening for one committed batch; never grants immunity or paints a safe overlay. */
export interface SpellPassage { kind: 'wall' | 'ring'; center: number; width: number; angle: number; expires: number }
export interface SpellBossContext extends AttackBudgetContext {
  player: Player; arena: ArenaRect; difficulty: Difficulty; elapsed: number; enemies: Enemy[];
  shootAt(source: Enemy, x: number, y: number, angle: number, speed: number, radius: number, color: number, options?: EnemyShotOptions): void;
  spawnHazard(hazard: Omit<AreaHazard, 'id'>): void;
  emit(event: CombatEvent): void;
  spawnPart(parent: Enemy, archetypeId: string, x: number, y: number): Enemy | null;
  retirePart?(part: Enemy): void;
}

const CARD_NAMES = {
  s1: ['冷光·噤声针雨', '封锁·交错绝域', '逆相·笑容崩裂', '折光·拒绝回声', '刻印·旧影埋葬', '空白·把声音抹掉'],
  s2: ['断层·噤声切片', '斜织·破碎囚笼', '冷核·无声凝视', '逆流·回声噩梦', '深渊·内外坍缩', '25时·全域崩坏'],
} as const;
// Fixed campaign budgets: upgrades never cause enemies to scale with a player's actual build.
const CARD_HP = { s1: [1200, 1300, 1400, 1500, 1700, 1900], s2: [2600, 2900, 3100, 3500, 3800, 4100] } as const;
const CARD_PATTERNS: Record<SeasonId, readonly SpellPattern[]> = {
  s1: ['needles', 'weave', 'flower', 'mirrors', 'seals', 'blank'],
  s2: ['slices', 'diagonals', 'nodes', 'reprise', 'rings', 'partition'],
};
function definitions(season: SeasonId, difficulty: Difficulty): readonly SpellCardDefinition[] {
  return Object.freeze(CARD_NAMES[season].map((name, index) => Object.freeze({
    id: `${season}-${index + 1}`, name, hp: Math.round(CARD_HP[season][index] * (difficulty === 'hard' ? 1.35 : 1)),
    pattern: CARD_PATTERNS[season][index], intro: difficulty === 'hard' ? 0.55 : 0.8,
    color: season === 's1' ? 0xd2b1ff : 0xffbb73,
  })));
}
export const SPELL_CARDS = Object.freeze({
  s1: Object.freeze({ normal: definitions('s1', 'normal'), hard: definitions('s1', 'hard') }),
  s2: Object.freeze({ normal: definitions('s2', 'normal'), hard: definitions('s2', 'hard') }),
});
export const SPELL_BALANCE = {
  normal: { warning: 0.7, laserWarning: 1.2, gateWidth: 112, gateStep: 68, speed: 205, anchorSpeed: 210,
    firstMotion: 6, motionInterval: 8, motionWarning: 1.1, recovery: 1.2 },
  hard: { warning: 0.55, laserWarning: 0.8, gateWidth: 88, gateStep: 82, speed: 220, anchorSpeed: 250,
    firstMotion: 5, motionInterval: 6.5, motionWarning: 0.9, recovery: 0.9 },
} as const;

export function createSpellBrain(season: SeasonId, difficulty: Difficulty = 'normal'): SpellBrain {
  return { season, cardIndex: 0, age: 0, cycle: 0, shotIndex: 0, nextAttack: SPELL_CARDS[season][difficulty][0].intro,
    stage: 'intro', anchorIndex: 0, targetX: 0, targetY: 0, partIds: [], initialized: false, partsSpawned: false,
    cueSequence: 0, holdUntil: 0, gateCenter: 0, gateDirection: 1, cues: [], nextMotion: SPELL_BALANCE[difficulty].firstMotion,
    motionCycle: 0, retreatX: 0, retreatY: 0, beat: 'volley', clearAt: 0, passage: null };
}
export function spellCardDefinition(enemy: Enemy, difficulty: Difficulty = 'normal'): SpellCardDefinition {
  const season = enemy.spell?.season ?? (enemy.archetypeId === 'lacuna' ? 's2' : 's1');
  return SPELL_CARDS[season][difficulty][clamp(enemy.spell?.cardIndex ?? 0, 0, 5)];
}
/** The simulation clears the defeated card's bullets, hazards and parts before accepting new damage. */
export function advanceSpellCard(enemy: Enemy, difficulty: Difficulty = 'normal'): boolean {
  const old = enemy.spell;
  if (!old || old.cardIndex >= SPELL_CARDS[old.season][difficulty].length - 1) return false;
  const next = createSpellBrain(old.season, difficulty);
  next.cardIndex = old.cardIndex + 1;
  next.nextAttack = SPELL_CARDS[next.season][difficulty][next.cardIndex].intro;
  enemy.spell = next;
  enemy.hp = enemy.maxHp = spellCardDefinition(enemy, difficulty).hp;
  enemy.state = 'phaseShift'; enemy.timer = spellCardDefinition(enemy, difficulty).intro;
  enemy.vx = enemy.vy = 0; enemy.cooldown = 0; enemy.attackIndex = 0; enemy.lowHpSpoken = false;
  enemy.action = undefined; enemy.exposedUntil = 0;
  return true;
}
export function spellTelegraphs(enemy: Enemy): readonly SpellTelegraph[] { return enemy.spell?.cues ?? []; }

/** The same immutable three-stage motion program supplies the renderer's fold-back warning. */
export function spellReturnPreview(bullet: Bullet): SpellReturnPath | null {
  const program = bullet.program;
  if (bullet.owner !== 'enemy' || !program || program.length !== 3 || program[1].speed !== 0 || !program[2].reverse) return null;
  const outbound = program[0], pause = program[1], returning = program[2], age = bullet.motionAge ?? 0;
  const index = bullet.programIndex ?? 0, reversed = index > 2 || (index === 2 && bullet.programEntered);
  const angle = (bullet.programAngle ?? Math.atan2(bullet.vy, bullet.vx)) - (reversed ? Math.PI : 0);
  const outSpeed = outbound.speed ?? bullet.speed, returnSpeed = returning.speed ?? outSpeed;
  const distance = outSpeed * Math.min(age, outbound.duration) - returnSpeed * Math.max(0, age - outbound.duration - pause.duration);
  const x = bullet.x - Math.cos(angle) * distance, y = bullet.y - Math.sin(angle) * distance;
  const turnDistance = outSpeed * outbound.duration, endDistance = turnDistance - returnSpeed * returning.duration;
  return { x, y, turnX: x + Math.cos(angle) * turnDistance, turnY: y + Math.sin(angle) * turnDistance,
    endX: x + Math.cos(angle) * endDistance, endY: y + Math.sin(angle) * endDistance,
    remainingUntilReverse: Math.max(0, outbound.duration + pause.duration - age), wait: pause.duration, width: bullet.radius * 2 };
}

function announce(enemy: Enemy, ctx: SpellBossContext, text: string, x = enemy.x, y = enemy.y): void {
  ctx.emit({ type: 'attack', enemyType: 'boss', targetId: enemy.id, x, y, text,
    color: spellCardDefinition(enemy, ctx.difficulty).color });
}
function schedule(enemy: Enemy, source: Enemy, ctx: SpellBossContext, cue: Omit<SpellTelegraph, 'id' | 'sourceId' | 'remaining'>, shots: PlannedShot[]): void {
  const brain = enemy.spell!;
  if (ctx.reserveAttack && !ctx.reserveAttack(enemy.id, shots.length, 0, cue.warning + 0.1)) return;
  brain.cues.push({ ...cue, id: ++brain.cueSequence, sourceId: source.id, remaining: cue.warning,
    fireAt: brain.age + cue.warning, shots });
  // Finish committed crossing/return trains before moving the body through their lanes.
  const multiplier = difficultyConfig(ctx.difficulty).bulletSpeed;
  const exitDistance = (x: number, y: number, angle: number) => {
    const dx = Math.cos(angle), dy = Math.sin(angle), a = ctx.arena;
    return Math.max(0, Math.min(Math.abs(dx) < 1e-7 ? Infinity : ((dx > 0 ? a.x + a.width + 24 : a.x - 24) - x) / dx,
      Math.abs(dy) < 1e-7 ? Infinity : ((dy > 0 ? a.y + a.height + 24 : a.y - 24) - y) / dy));
  };
  const returnDuration = (shot: PlannedShot) => {
    const program = shot.options!.program!, out = program[0], pause = program[1], back = program[2];
    const speed = (out.speed ?? shot.speed) * multiplier;
    const outwardExit = exitDistance(shot.x, shot.y, shot.angle) / speed;
    if (outwardExit <= out.duration) return outwardExit;
    const x = shot.x + Math.cos(shot.angle) * speed * out.duration, y = shot.y + Math.sin(shot.angle) * speed * out.duration;
    return out.duration + pause.duration + Math.min(back.duration, exitDistance(x, y, shot.angle + Math.PI) / ((back.speed ?? shot.speed) * multiplier));
  };
  const travel = Math.max(0, ...shots.map(shot => shot.options?.program
    ? returnDuration(shot)
    : cue.kind === 'wall' ? exitDistance(shot.x, shot.y, shot.angle) / (shot.speed * multiplier)
      : cue.kind === 'ring' ? (cue.length > 150 ? cue.length * 2 : 900) / (shot.speed * multiplier)
        : Math.hypot(ctx.player.x - shot.x, ctx.player.y - shot.y) / (shot.speed * multiplier) + 0.7));
  brain.clearAt = Math.max(brain.clearAt, brain.age + cue.warning + travel);
  if (source.id === enemy.id && cue.kind !== 'wall') brain.holdUntil = Math.max(brain.holdUntil, brain.age + cue.warning);
  announce(enemy, ctx, `spell-${cue.kind}`, cue.x, cue.y);
}
function fan(enemy: Enemy, source: Enemy, ctx: SpellBossContext, x: number, y: number, angle: number, count: number,
  spread: number, speed: number, options: EnemyShotOptions = { shape: 'rice' }, warning: number = SPELL_BALANCE[ctx.difficulty].warning): void {
  const color = spellCardDefinition(enemy, ctx.difficulty).color;
  const shots: PlannedShot[] = [];
  for (let i = 0; i < count; i++) shots.push({ x, y, angle: angle + (count === 1 ? 0 : i / (count - 1) - 0.5) * spread,
    speed, radius: 6, color, options });
  const multiplier = difficultyConfig(ctx.difficulty).bulletSpeed;
  const returnPaths = options.program?.[2]?.reverse ? shots.map(shot => {
    const program = options.program!, out = (program[0].speed ?? speed) * multiplier * program[0].duration;
    const end = out - (program[2].speed ?? speed) * multiplier * program[2].duration;
    return { x, y, turnX: x + Math.cos(shot.angle) * out, turnY: y + Math.sin(shot.angle) * out,
      endX: x + Math.cos(shot.angle) * end, endY: y + Math.sin(shot.angle) * end,
      remainingUntilReverse: warning + program[0].duration + program[1].duration, wait: program[1].duration, width: shot.radius * 2 };
  }) : undefined;
  schedule(enemy, source, ctx, { kind: 'fan', x, y, endX: x, endY: y, angle, spread, length: 260, color, warning, returnPaths }, shots);
}
function star(enemy: Enemy, ctx: SpellBossContext): void {
  const b = enemy.spell!, color = spellCardDefinition(enemy, ctx.difficulty).color, hard = ctx.difficulty === 'hard';
  const angle = Math.atan2(ctx.player.y - enemy.y, ctx.player.x - enemy.x), shots: PlannedShot[] = [];
  for (let arm = 0; arm < 5; arm++) for (let layer = 0; layer < (hard ? 5 : 3); layer++) {
    shots.push({ x: enemy.x, y: enemy.y, angle: angle + arm * TAU / 5 + (layer - (hard ? 2 : 1)) * 0.1,
      speed: 165 + layer * 13, radius: 6, color, options: { shape: 'kunai', turnRate: (b.shotIndex % 2 ? -1 : 1) * 0.1,
        turnDelay: 0.7, turnDuration: 0.6 } });
  }
  schedule(enemy, enemy, ctx, { kind: 'ring', x: enemy.x, y: enemy.y, endX: enemy.x, endY: enemy.y, angle,
    spread: TAU, length: 110, color, warning: SPELL_BALANCE[ctx.difficulty].warning, motif: 'star' }, shots);
}
function ring(enemy: Enemy, ctx: SpellBossContext, count: number, rotation: number, speed: number,
  turn = 0, spawnRadius = 0, inward = false, opening?: number): void {
  const color = spellCardDefinition(enemy, ctx.difficulty).color, b = enemy.spell!, cfg = SPELL_BALANCE[ctx.difficulty];
  // A wide, readable opening rotates with the batch; there is no permanent common bearing.
  const gate = opening ?? Math.atan2(ctx.player.y - enemy.y, ctx.player.x - enemy.x) + (b.shotIndex % 2 ? 0.3 : -0.3);
  const referenceRadius = spawnRadius || Math.max(260, Math.hypot(ctx.player.x - enemy.x, ctx.player.y - enemy.y));
  const halfOpening = Math.max(0.16, Math.asin(Math.min(0.8, (cfg.gateWidth / 2 + 6) / referenceRadius)));
  b.passage = { kind: 'ring', center: gate, width: cfg.gateWidth, angle: gate, expires: b.age + 6 };
  const shots: PlannedShot[] = [];
  for (let i = 0; i < count; i++) {
    const angle = rotation + i * TAU / count;
    // This opening belongs to one approaching ring. Later rings use different committed orientations.
    if (Math.abs(Math.atan2(Math.sin(angle - gate), Math.cos(angle - gate))) < halfOpening) continue;
    const x = enemy.x + Math.cos(angle) * spawnRadius, y = enemy.y + Math.sin(angle) * spawnRadius;
    if (x < ctx.arena.x + 8 || x > ctx.arena.x + ctx.arena.width - 8 || y < ctx.arena.y + 8 || y > ctx.arena.y + ctx.arena.height - 8) continue;
    shots.push({ x, y, angle: angle + (inward ? Math.PI : 0), speed, radius: 6, color,
      options: { shape: 'orb', turnRate: turn, turnDelay: 0.35, turnDuration: 0.65 } });
  }
  schedule(enemy, enemy, ctx, { kind: 'ring', x: enemy.x, y: enemy.y, endX: enemy.x, endY: enemy.y,
    angle: rotation, spread: TAU, length: Math.max(90, spawnRadius), color,
    warning: spawnRadius > 0 ? (ctx.difficulty === 'hard' ? 0.8 : 1) : SPELL_BALANCE[ctx.difficulty].warning }, shots);
}
/** A dense travelling wall has a measured physical opening, independent of distance from its emitter. */
function wall(enemy: Enemy, ctx: SpellBossContext, axis: 'x' | 'y', reverse = false, sparse = false): void {
  const b = enemy.spell!, a = ctx.arena, cfg = SPELL_BALANCE[ctx.difficulty];
  const length = axis === 'x' ? a.height - 16 : a.width - 16;
  const origin = axis === 'x' ? a.y + 8 : a.x + 8;
  const playerAlong = (axis === 'x' ? ctx.player.y : ctx.player.x) - origin;
  const margin = cfg.gateWidth / 2 + 30;
  if (b.shotIndex === 0 || b.gateCenter === 0) {
    b.gateCenter = clamp(playerAlong, margin, length - margin);
    b.gateDirection = b.gateCenter > length / 2 ? -1 : 1;
  } else {
    const next = b.gateCenter + cfg.gateStep * b.gateDirection;
    if (next < margin || next > length - margin) b.gateDirection = b.gateDirection === 1 ? -1 : 1;
    b.gateCenter = clamp(b.gateCenter + cfg.gateStep * b.gateDirection, margin, length - margin);
  }
  const x = axis === 'x' ? a.x + (reverse ? a.width - 8 : 8) : a.x + 8;
  const y = axis === 'y' ? a.y + (reverse ? a.height - 8 : 8) : a.y + 8;
  const angle = axis === 'x' ? (reverse ? Math.PI : 0) : (reverse ? -Math.PI / 2 : Math.PI / 2);
  const color = spellCardDefinition(enemy, ctx.difficulty).color, radius = 7;
  const width = cfg.gateWidth, spacing = sparse ? (ctx.difficulty === 'hard' ? 44 : 58) : 22;
  const positions: number[] = [];
  {
    // Include exact lip bullets. Rounding a regular grid must never shrink the promised gap.
    const low = b.gateCenter - width / 2 - radius, high = b.gateCenter + width / 2 + radius;
    for (let n = low; n >= 0; n -= spacing) positions.push(n);
    for (let n = high; n <= length; n += spacing) positions.push(n);
    positions.push(0, length);
  }
  const shots = positions.map(position => ({ x: x + (axis === 'y' ? position : 0), y: y + (axis === 'x' ? position : 0),
    angle, speed: cfg.speed, radius, color, options: { shape: 'rice' as const } }));
  schedule(enemy, enemy, ctx, { kind: 'wall', x, y, endX: x + (axis === 'y' ? length : 0), endY: y + (axis === 'x' ? length : 0),
    angle, spread: 0, length, color, warning: ctx.difficulty === 'hard' ? 0.8 : 1,
    gapCenter: b.gateCenter, gapWidth: width }, shots);
  b.passage = { kind: 'wall', center: b.gateCenter, width, angle, expires: b.clearAt };
}
function beam(enemy: Enemy, ctx: SpellBossContext, x: number, y: number, angle: number, width = 42, duration = 0.45): void {
  const warning = SPELL_BALANCE[ctx.difficulty].laserWarning;
  if (ctx.reserveAttack && !ctx.reserveAttack(enemy.id, 0, 1, 0.1)) return;
  ctx.spawnHazard({ kind: 'beam', x, y, angle, width, length: Math.hypot(ctx.arena.width, ctx.arena.height) + 40,
    radius: width / 2, warning, warningDuration: warning, life: duration, duration, sourceId: enemy.id, active: false, angularSpeed: 0 });
  enemy.spell!.holdUntil = Math.max(enemy.spell!.holdUntil, enemy.spell!.age + warning + duration);
  enemy.spell!.clearAt = Math.max(enemy.spell!.clearAt, enemy.spell!.age + warning + duration);
  announce(enemy, ctx, 'spell-beam', x, y);
}
function seal(enemy: Enemy, ctx: SpellBossContext, x: number, y: number, radius = 62, delay = 0): void {
  const warning = (ctx.difficulty === 'hard' ? 0.7 : 0.9) + delay;
  if (ctx.reserveAttack && !ctx.reserveAttack(enemy.id, 0, 1, 0.1)) return;
  // Preserve the sampled centre at walls: moving it inward could cut off the escape after commitment.
  ctx.spawnHazard({ kind: 'bombard', x: clamp(x, ctx.arena.x, ctx.arena.x + ctx.arena.width),
    y: clamp(y, ctx.arena.y, ctx.arena.y + ctx.arena.height), radius, warning, warningDuration: warning,
    life: 0.35, duration: 0.35, sourceId: enemy.id, active: false });
  announce(enemy, ctx, 'spell-seal', x, y);
  enemy.spell!.clearAt = Math.max(enemy.spell!.clearAt, enemy.spell!.age + warning + 0.35);
}
function diagonalRow(enemy: Enemy, ctx: SpellBossContext): void {
  const b = enemy.spell!, a = ctx.arena, hard = ctx.difficulty === 'hard', color = spellCardDefinition(enemy, ctx.difficulty).color;
  const direction = b.shotIndex % 2 === 0 ? 1 : -1;
  const angle = Math.PI / 2 + direction * 0.36, spacing = hard ? 66 : 84;
  const offset = b.shotIndex % 3 * spacing / 3, shots: PlannedShot[] = [];
  // Project the gate onto the player's row so diagonal bullets preserve the advertised width.
  const projected = ctx.player.x - Math.tan(angle - Math.PI / 2) * -(ctx.player.y - a.y - 8);
  const gate = clamp(projected + (nudge(b.shotIndex) * 65), a.x + 100, a.x + a.width - 100);
  for (let x = a.x + 16 + offset; x < a.x + a.width - 16; x += spacing) {
    if (Math.abs(x - gate) < SPELL_BALANCE[ctx.difficulty].gateWidth / 2 + 6) continue;
    shots.push({ x, y: a.y + 8, angle, speed: hard ? 200 : 180, radius: 6, color, options: { shape: 'kunai' } });
  }
  schedule(enemy, enemy, ctx, { kind: 'wall', x: a.x + 8, y: a.y + 8, endX: a.x + a.width - 8, endY: a.y + 8,
    angle, spread: 0, length: a.width - 16, color, warning: SPELL_BALANCE[ctx.difficulty].warning,
    gapCenter: gate - a.x - 8, gapWidth: SPELL_BALANCE[ctx.difficulty].gateWidth }, shots);
}
const nudge = (index: number) => index % 2 ? 1 : -1;
function firePattern(enemy: Enemy, ctx: SpellBossContext): number {
  const b = enemy.spell!, a = ctx.arena, hard = ctx.difficulty === 'hard', n = b.shotIndex;
  const toward = Math.atan2(ctx.player.y - enemy.y, ctx.player.x - enemy.x);
  const pattern = spellCardDefinition(enemy, ctx.difficulty).pattern;
  const speed = SPELL_BALANCE[ctx.difficulty].speed;
  switch (pattern) {
    case 'needles':
      fan(enemy, enemy, ctx, enemy.x, enemy.y, toward, hard ? 19 : 15, 2.35, speed + 20);
      if (hard && n % 3 === 2) ring(enemy, ctx, 22, n * 0.31, 140);
      return hard ? 1.15 : 1.4;
    case 'weave':
      // Two parallel gates form one phrase. Change axis only after the prior train exits;
      // a perpendicular row must never close the gate while the player is passing it.
      if (n % 2 === 0) b.gateCenter = 0;
      wall(enemy, ctx, Math.floor(n / 2) % 2 ? 'x' : 'y');
      return n % 2 ? Math.max(hard ? 1.2 : 1.5, b.clearAt - b.age + .15) : hard ? 1.2 : 1.5;
    case 'flower':
      ring(enemy, ctx, hard ? 62 : 50, n * (hard ? 0.22 : 0.18), hard ? 175 : 155, (n % 2 ? 1 : -1) * 0.17);
      if (n % 2 === 1) fan(enemy, enemy, ctx, enemy.x, enemy.y, toward, hard ? 3 : 1, 0.5, 275,
        { shape: 'rice' }, SPELL_BALANCE[ctx.difficulty].warning + 0.4);
      return hard ? 1.1 : 1.35;
    case 'mirrors': {
      if (n % 2 === 0) {
        const x = a.x + (n % 4 ? a.width - 28 : 28), y = a.y + 110 + n % 3 * 120;
        beam(enemy, ctx, x, y, Math.atan2(ctx.player.y - y, ctx.player.x - x), hard ? 52 : 42);
      } else fan(enemy, enemy, ctx, enemy.x, enemy.y, toward, hard ? 13 : 9, 1.7, 190,
        { shape: 'kunai', program: [{ duration: 2.2, speed: 190 }, { duration: hard ? 0.55 : 0.7, speed: 0 },
          { duration: 5, speed: 230, reverse: true }] }, hard ? 0.8 : 1);
      return hard ? 1.65 : 2;
    }
    case 'seals':
      seal(enemy, ctx, ctx.player.x, ctx.player.y, hard ? 70 : 62);
      if (hard && n % 2 === 1) seal(enemy, ctx, ctx.player.x + (ctx.player.x < a.x + a.width / 2 ? -130 : 130), ctx.player.y, 55, 0.3);
      if (n % 2 === 0) star(enemy, ctx);
      return hard ? 1.1 : 1.45;
    case 'blank':
      if (n % 6 < 3) wall(enemy, ctx, 'y');
      else if (n % 6 === 3) ring(enemy, ctx, hard ? 42 : 34, n * 0.2, 150, n % 2 ? 0.12 : -0.12);
      else if (n % 6 === 4) beam(enemy, ctx, enemy.x, enemy.y, toward, hard ? 58 : 46, 0.4);
      else seal(enemy, ctx, ctx.player.x, ctx.player.y, 58);
      return hard ? 1.45 : 1.8;
    case 'slices':
      wall(enemy, ctx, 'x', b.cycle % 2 === 1);
      // A direction reversal starts only after the complete previous train can leave the arena.
      if (n % 7 === 6) { b.cycle++; b.gateCenter = 0; return 8; }
      return hard ? 1.25 : 1.55;
    case 'diagonals':
      diagonalRow(enemy, ctx);
      if (hard && n % 4 === 3) fan(enemy, enemy, ctx, enemy.x, enemy.y, toward, 7, 1.4, 230);
      return hard ? 0.85 : 1.05;
    case 'nodes': {
      const living = ctx.enemies.filter(part => b.partIds.includes(part.id) && part.hp > 0 && (part.disabledUntil ?? 0) <= ctx.elapsed);
      for (const part of living) fan(enemy, part, ctx, part.x, part.y, Math.atan2(ctx.player.y - part.y, ctx.player.x - part.x),
        hard ? 9 : 7, 1.45, hard ? 210 : 185);
      if (n % 2 === 0) ring(enemy, ctx, hard ? 32 : 26, n * 0.21, 150);
      return hard ? 1.4 : 1.8;
    }
    case 'reprise': {
      const x = n % 2 ? a.x + a.width * 0.22 : enemy.x, y = n % 2 ? a.y + 80 : enemy.y;
      fan(enemy, enemy, ctx, x, y, Math.atan2(ctx.player.y - y, ctx.player.x - x), hard ? 15 : 11, 1.85, 200,
        { shape: 'kunai', program: [{ duration: 2.7, speed: 200 }, { duration: hard ? 0.55 : 0.7, speed: 0 },
          { duration: 6, speed: 235, reverse: true }] }, hard ? 0.8 : 1);
      return hard ? 2.05 : 2.5;
    }
    case 'rings':
      if (n % 2 === 0) ring(enemy, ctx, hard ? 46 : 38, toward + (n % 4 ? 0.13 : 0), 155, n % 4 ? 0.1 : 0);
      else ring(enemy, ctx, hard ? 48 : 40, n * 0.19, hard ? 170 : 150, 0, 410, true, toward + (n % 4 === 1 ? 0.26 : -0.26));
      return hard ? 1.65 : 2;
    case 'partition':
      if (n % 4 === 0) {
        const x = clamp(ctx.player.x, a.x + 90, a.x + a.width - 90);
        beam(enemy, ctx, x, a.y + 8, Math.PI / 2, hard ? 58 : 44, 0.42);
      } else if (n % 4 === 2) {
        beam(enemy, ctx, a.x + 8, clamp(ctx.player.y, a.y + 80, a.y + a.height - 80), 0, hard ? 58 : 44, 0.42);
      } else wall(enemy, ctx, 'y', false, true);
      if (hard && n % 4 === 3) seal(enemy, ctx, ctx.player.x, ctx.player.y, 55);
      return hard ? 1.45 : 1.8;
  }
}

function moveToAnchor(enemy: Enemy, dt: number, ctx: SpellBossContext): void {
  const b = enemy.spell!, a = ctx.arena, margin = enemy.radius + 24;
  if (updateBossAction(enemy, dt, ctx)) return;
  if (b.age < b.holdUntil - EPSILON) { enemy.vx = enemy.vy = 0; return; }
  const targets = [0.5, 0.35, 0.65];
  b.targetX = clamp(a.x + a.width * targets[b.anchorIndex % targets.length], a.x + margin, a.x + a.width - margin);
  b.targetY = clamp(a.y + 230, a.y + margin, a.y + a.height - margin);
  const dx = b.targetX - enemy.x, dy = b.targetY - enemy.y, distance = Math.hypot(dx, dy);
  const direction = normalize(dx, dy), speed = Math.min(distance / dt, SPELL_BALANCE[ctx.difficulty].anchorSpeed);
  const futureX = enemy.x + direction.x * speed * dt, futureY = enemy.y + direction.y * speed * dt;
  // Do not body-check a nearby player as an unannounced side effect of changing the emission anchor.
  const bodyDistance = enemy.radius + ctx.player.radius + 36;
  if (Math.hypot(futureX - ctx.player.x, futureY - ctx.player.y) < bodyDistance) { enemy.vx = enemy.vy = 0; return; }
  enemy.vx = direction.x * speed; enemy.vy = direction.y * speed;
}

/** Three readable body actions accompany the card language: side-cut, pursuit lunge, then old-route retreat. */
function considerBodyAction(enemy: Enemy, ctx: SpellBossContext): void {
  const b = enemy.spell!, a = ctx.arena;
  if (b.beat !== 'drain' || enemy.action || b.cues.length || b.age < b.clearAt || b.age < b.holdUntil) return;
  const cfg = SPELL_BALANCE[ctx.difficulty];
  const index = (b.motionCycle + b.cardIndex) % 3, lacuna = b.season === 's2';
  const previous = { x: enemy.x, y: enemy.y };
  const target = index === 0 ? { x: ctx.player.x + (ctx.player.x < a.x + a.width / 2 ? 280 : -280),
    y: clamp(ctx.player.y - 250, a.y + 210, a.y + a.height - 230) }
    : index === 2 && b.retreatX ? { x: b.retreatX, y: b.retreatY }
      : bossActionTarget(enemy, ctx.player, lacuna ? 470 : 400, index === 2 ? 0.8 : 0.25);
  if (beginBossAction(enemy, { kind: index === 0 ? 'sidestep' : index === 2 ? 'retrace' : 'dash', ...target,
    warning: cfg.motionWarning, duration: lacuna ? 0.6 : 0.7, recovery: cfg.recovery }, ctx)) {
    b.retreatX = previous.x; b.retreatY = previous.y; b.motionCycle++;
    b.nextMotion = b.age + cfg.motionInterval; b.beat = 'motion';
  } else { b.nextMotion = b.age + cfg.motionInterval; b.beat = 'volley'; b.nextAttack = b.age + 0.25; }
}

/** Runs entirely on the simulation clock; does not integrate positions or apply player damage. */
export function updateSpellBoss(enemy: Enemy, dt: number, ctx: SpellBossContext): void {
  const b = enemy.spell;
  if (!b || enemy.hp <= 0 || dt <= 0 || !Number.isFinite(dt)) return;
  const definition = spellCardDefinition(enemy, ctx.difficulty);
  if (!b.initialized) {
    b.initialized = true;
    ctx.emit({ type: 'card', x: enemy.x, y: enemy.y, enemyType: 'boss', targetId: enemy.id,
      text: definition.name, amount: b.cardIndex + 1, color: definition.color, seasonId: b.season });
  }
  b.age += dt;
  let keep = 0;
  for (const cue of b.cues) {
    const source = cue.sourceId === enemy.id ? enemy : ctx.enemies.find(part => part.id === cue.sourceId && part.hp > 0);
    if (!source || source.hp <= 0 || (source.disabledUntil ?? 0) > ctx.elapsed) continue;
    cue.remaining = Math.max(0, cue.fireAt - b.age);
    if (cue.returnPaths) for (const path of cue.returnPaths) {
      path.remainingUntilReverse = cue.remaining + (cue.shots[0]?.options?.program?.[0].duration ?? 0) + path.wait;
    }
    if (cue.fireAt <= b.age + EPSILON) {
      for (const shot of cue.shots) ctx.shootAt(source, shot.x, shot.y, shot.angle, shot.speed, shot.radius, shot.color, shot.options);
    } else b.cues[keep++] = cue;
  }
  b.cues.length = keep;
  if (b.age < definition.intro - EPSILON) {
    b.stage = 'intro'; enemy.state = 'phaseShift'; enemy.timer = definition.intro - b.age;
    moveToAnchor(enemy, dt, ctx); return;
  }
  b.stage = 'active'; enemy.state = 'volley'; enemy.timer = 0;
  // Complete the card's small phrase before a single deliberate relocation, never an independent dash timer.
  const phrase = definition.pattern === 'slices' ? 7 : definition.pattern === 'blank' ? 6 : definition.pattern === 'partition' ? 4 : 2;
  if (b.beat === 'volley' && b.age >= b.nextMotion && b.shotIndex % phrase === 0) b.beat = 'drain';
  considerBodyAction(enemy, ctx);
  if (definition.pattern === 'nodes' && !b.partsSpawned) {
    b.partsSpawned = true;
    for (const fraction of (ctx.difficulty === 'hard' ? [0.25, 0.5, 0.75] : [0.3, 0.7])) {
      const part = ctx.spawnPart(enemy, 'node', ctx.arena.x + ctx.arena.width * fraction, ctx.arena.y + 115);
      if (part) b.partIds.push(part.id);
    }
  }
  if (b.beat === 'volley' && b.age >= b.nextAttack - EPSILON) {
    b.nextAttack = b.age + firePattern(enemy, ctx); b.shotIndex++; enemy.attackIndex = b.shotIndex;
    if (b.shotIndex % 4 === 0) b.anchorIndex = (b.anchorIndex + 1) % 3;
  }
  enemy.angle = Math.atan2(ctx.player.y - enemy.y, ctx.player.x - enemy.x);
  const ownedAction = !!enemy.action;
  moveToAnchor(enemy, dt, ctx);
  if (enemy.action) b.beat = enemy.action.phase === 'recover' ? 'recover' : 'motion';
  else if (ownedAction) { b.beat = 'volley'; b.nextAttack = b.age + 0.25; b.clearAt = b.age; b.passage = null; }
}
