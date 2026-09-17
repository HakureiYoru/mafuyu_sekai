import { describe, expect, it } from 'vitest';
import { FixedClock } from './clock';
import { beamGeometry, clamp, pointInBeam, segmentCircleHit } from './math';
import { advanceProjectileMotion } from './projectile-motion';
import { GameSimulation } from './simulation';
import { advanceSpellCard, createSpellBrain, SPELL_BALANCE, SPELL_CARDS, spellCardDefinition, spellReturnPreview, spellTelegraphs, updateSpellBoss } from './spellcards';
import type { SpellBossContext } from './spellcards';
import type { AreaHazard, Bullet, CombatEvent, Difficulty, Enemy, EnemyShotOptions, Player, SeasonId } from './types';

const ARENA = { x: 1200, y: 1550, width: 1600, height: 900 };
const STEP = 1 / 60;
function harness(season: SeasonId = 's1', difficulty: Difficulty = 'normal', card = 0) {
  const player: Player = { x: 2000, y: 2220, prevX: 2000, prevY: 2220, vx: 0, vy: 0, radius: 18,
    hp: 5, maxHp: 5, hpReserve: 0, bombs: 3, level: 7, xp: 0, heat: 0, angle: 0, invincible: 0,
    commandTargetId: null, commandTime: 0, commandCooldown: 0,
    dashTime: 0, dashCooldown: 0, dashVx: 0, dashVy: 0, perfectWindow: 0, shotCooldown: 0,
    specialCooldown: 0, idleTime: 0, heatLock: 0, overheated: false, focus: false };
  const enemy: Enemy = { id: 1, type: 'boss', archetypeId: season === 's1' ? 'mafuyu' : 'lacuna', x: 2000, y: 1780,
    prevX: 2000, prevY: 1780, vx: 0, vy: 0, radius: 160, hp: 1, maxHp: 1, speed: 150, angle: 0,
    state: 'chase', timer: 0, cooldown: 0, laserCooldown: 0, attackIndex: 0, hitTime: 0, lowHpSpoken: false,
    directionX: 0, directionY: 0, spell: createSpellBrain(season, difficulty) };
  for (let i = 0; i < card; i++) advanceSpellCard(enemy, difficulty);
  enemy.hp = enemy.maxHp = spellCardDefinition(enemy, difficulty).hp;
  const enemies = [enemy], bullets: Bullet[] = [], shots: { time: number; sourceId: number; x: number; y: number; angle: number; options?: EnemyShotOptions }[] = [];
  const hazards: AreaHazard[] = [], announced: Omit<AreaHazard, 'id'>[] = [], events: CombatEvent[] = [];
  let nextId = 10, hits = 0, time = 0;
  const ctx: SpellBossContext = {
    player, arena: ARENA, difficulty, elapsed: 0, enemies,
    shootAt: (source, x, y, angle, rawSpeed, radius, color, options) => {
      shots.push({ time, sourceId: source.id, x, y, angle, options });
      const multiplier = difficulty === 'hard' ? 1.28 : 1, speed = rawSpeed * multiplier;
      bullets.push({ id: nextId++, owner: 'enemy', x, y, prevX: x, prevY: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        radius, damage: 1, life: 30, color, speed, homing: false, lockRange: 0, targetId: null, remainingHits: 1, hitIds: new Set(), kind: 'normal',
        ...options, program: options?.program?.map(phase => ({ ...phase, speed: phase.speed === undefined ? undefined : phase.speed * multiplier })) });
    },
    spawnHazard: hazard => { announced.push({ ...hazard }); hazards.push({ ...hazard, id: nextId++ }); },
    emit: event => events.push(event),
    spawnPart: (parent, archetypeId, x, y) => {
      const part: Enemy = { ...enemy, id: nextId++, type: 'node', role: 'part', archetypeId, parentId: parent.id,
        x, y, prevX: x, prevY: y, radius: 34, hp: 180, maxHp: 180, spell: undefined };
      enemies.push(part); return part;
    },
  };
  function tick(dt = STEP, dx = 0, dy = 0): void {
    time += dt; ctx.elapsed += dt;
    player.prevX = player.x; player.prevY = player.y;
    player.x = clamp(player.x + dx * dt, ARENA.x + 18, ARENA.x + ARENA.width - 18);
    player.y = clamp(player.y + dy * dt, ARENA.y + 18, ARENA.y + ARENA.height - 18);
    player.vx = dx; player.vy = dy;
    enemy.prevX = enemy.x; enemy.prevY = enemy.y;
    const oldHazardCount = hazards.length;
    updateSpellBoss(enemy, dt, ctx);
    enemy.x += enemy.vx * dt; enemy.y += enemy.vy * dt;
    for (let i = bullets.length - 1; i >= 0; i--) {
      const bullet = bullets[i]; bullet.prevX = bullet.x; bullet.prevY = bullet.y;
      const movement = advanceProjectileMotion(bullet, dt);
      bullet.x += movement?.dx ?? bullet.vx * dt; bullet.y += movement?.dy ?? bullet.vy * dt;
      if (segmentCircleHit(bullet.prevX - player.prevX, bullet.prevY - player.prevY, bullet.x - player.x, bullet.y - player.y, 0, 0, bullet.radius + 7) !== null) {
        hits++; bullets.splice(i, 1); continue;
      }
      if (bullet.x < ARENA.x - 20 || bullet.y < ARENA.y - 20 || bullet.x > ARENA.x + ARENA.width + 20 || bullet.y > ARENA.y + ARENA.height + 20) bullets.splice(i, 1);
    }
    // Production updates existing hazards before AI creates this tick's new warnings.
    for (let i = oldHazardCount - 1; i >= 0; i--) {
      const hazard = hazards[i];
      if (hazard.warning > 0) { hazard.warning -= dt; hazard.active = hazard.warning <= 1e-8; }
      else {
        hazard.life -= dt;
        if (hazard.kind === 'beam') {
          if (pointInBeam(player.x, player.y, 7, beamGeometry(hazard.x, hazard.y, hazard.angle ?? 0, hazard.length ?? 0, hazard.width ?? 0))) hits++;
        } else if (Math.hypot(player.x - hazard.x, player.y - hazard.y) < 7 + hazard.radius) hits++;
      }
      if (hazard.life <= 0) hazards.splice(i, 1);
    }
  }
  function run(seconds: number, dt = STEP): void { for (let t = 0; t < seconds - 1e-8; t += dt) tick(Math.min(dt, seconds - t)); }
  return { player, enemy, ctx, enemies, bullets, hazards, announced, events, shots, tick, run, get hits() { return hits; }, get time() { return time; } };
}

describe('independent six-card encounters', () => {
  it.each(['s1', 's2'] as const)('%s retains the agreed six names and exact normal/hard HP without shared mutable brains', season => {
    const expected = season === 's1' ? [1200, 1300, 1400, 1500, 1700, 1900] : [2600, 2900, 3100, 3500, 3800, 4100];
    expect(SPELL_CARDS[season].normal.map(card => card.hp)).toEqual(expected);
    expect(SPELL_CARDS[season].hard.map(card => card.hp)).toEqual(expected.map(hp => Math.round(hp * 1.35)));
    expect(new Set(SPELL_CARDS[season].normal.map(card => card.pattern)).size).toBe(6);
    const a = createSpellBrain(season), b = createSpellBrain(season);
    a.partIds.push(99); a.shotIndex = 90;
    expect(b.partIds).toEqual([]); expect(b.shotIndex).toBe(0);
    expect(Object.isFrozen(SPELL_CARDS[season].normal[0])).toBe(true);
  });
  it.each(['normal', 'hard'] as const)('has exactly five advances, resets all pending attacks and ends after the sixth %s card', difficulty => {
    const h = harness('s1', difficulty);
    for (let index = 0; index < 6; index++) {
      h.run(2); expect(h.events.filter(event => event.type === 'card').at(-1)?.amount).toBe(index + 1);
      h.enemy.hp = 0;
      const advanced = advanceSpellCard(h.enemy, difficulty);
      expect(advanced).toBe(index < 5);
      if (advanced) {
        expect(h.enemy.hp).toBe(SPELL_CARDS.s1[difficulty][index + 1].hp);
        expect(h.enemy.spell).toMatchObject({ cardIndex: index + 1, age: 0, shotIndex: 0, cycle: 0, initialized: false, partIds: [], cues: [] });
        expect(h.enemy.vx).toBe(0); expect(h.enemy.vy).toBe(0);
      }
    }
    expect(h.enemy.hp).toBe(0);
  });
  it('does not schedule, fire or move a dead boss or advance on zero/invalid time', () => {
    const h = harness(); h.run(0.9);
    const before = structuredClone(h.enemy);
    updateSpellBoss(h.enemy, 0, h.ctx); updateSpellBoss(h.enemy, Number.NaN, h.ctx);
    expect(h.enemy).toEqual(before);
    h.enemy.hp = 0;
    const age = h.enemy.spell!.age, shotCount = h.shots.length;
    updateSpellBoss(h.enemy, 10, h.ctx);
    expect(h.enemy.spell!.age).toBe(age); expect(h.shots.length).toBe(shotCount);
  });
  it.each(['normal', 'hard'] as const)('each card really emits a distinct mechanic in %s, with bounded pending work', difficulty => {
    for (const season of ['s1', 's2'] as const) for (let card = 0; card < 6; card++) {
      const h = harness(season, difficulty, card);
      let maxCues = 0, maxHazards = 0, maxBullets = 0;
      for (let tick = 0; tick < 18 * 60; tick++) {
        h.tick(); maxCues = Math.max(maxCues, spellTelegraphs(h.enemy).length);
        maxHazards = Math.max(maxHazards, h.hazards.length); maxBullets = Math.max(maxBullets, h.bullets.length);
      }
      expect(h.shots.length + h.announced.length, `${season} card ${card + 1}`).toBeGreaterThan(8);
      expect(h.enemy.spell!.shotIndex).toBeGreaterThan(4);
      expect(maxCues).toBeLessThanOrEqual(5); expect(maxHazards).toBeLessThanOrEqual(5);
      expect(maxBullets).toBeLessThan(1100);
      expect(h.enemy.x - h.enemy.radius).toBeGreaterThanOrEqual(ARENA.x);
      expect(h.enemy.x + h.enemy.radius).toBeLessThanOrEqual(ARENA.x + ARENA.width);
      expect(h.enemy.y - h.enemy.radius).toBeGreaterThanOrEqual(ARENA.y);
      expect(h.hits, `${season} card ${card + 1}: initial standing position must not remain permanently safe`).toBeGreaterThan(0);
    }
  });
});

describe('committed attacks and source lifetime', () => {
  it('locks pending emission geometry while the player changes direction, and removes the hint when it fires', () => {
    const h = harness(); h.run(0.8);
    const original = structuredClone(spellTelegraphs(h.enemy)[0]);
    expect(original.remaining).toBeGreaterThanOrEqual(0.7 - 1e-8);
    h.enemy.spell!.nextAttack = Infinity;
    h.player.x = 2600; h.player.y = 1600;
    h.run(0.65);
    expect(spellTelegraphs(h.enemy)[0]).toMatchObject({ x: original.x, y: original.y, angle: original.angle });
    expect(h.shots).toHaveLength(0);
    h.run(0.1); expect(h.shots.length).toBe(15); expect(spellTelegraphs(h.enemy)).toHaveLength(0);
  });
  it.each(['normal', 'hard'] as const)('all %s lasers have full warnings and immutable origin, direction and length', difficulty => {
    const h = harness('s1', difficulty, 3); h.run(SPELL_CARDS.s1[difficulty][3].intro);
    const original = { ...h.announced[0] };
    expect(original).toMatchObject({ kind: 'beam', active: false, angularSpeed: 0,
      warning: SPELL_BALANCE[difficulty].laserWarning, warningDuration: SPELL_BALANCE[difficulty].laserWarning });
    h.player.x = ARENA.x + 18; h.player.y = ARENA.y + 18;
    h.run(original.warning - STEP);
    expect(h.hazards[0]).toMatchObject({ x: original.x, y: original.y, angle: original.angle, length: original.length });
    expect(h.hazards[0].active).toBe(false);
  });
  it('kills node-owned queued shots when the node dies, without cancelling living nodes or respawning destroyed parts', () => {
    const h = harness('s2', 'hard', 2); h.run(0.55);
    const parts = h.enemies.filter(enemy => enemy.parentId === h.enemy.id);
    expect(parts).toHaveLength(3);
    expect(spellTelegraphs(h.enemy).filter(cue => cue.sourceId !== h.enemy.id)).toHaveLength(3);
    parts[0].hp = 0;
    h.run(0.8);
    expect(h.shots.some(shot => shot.sourceId === parts[0].id)).toBe(false);
    expect(h.shots.some(shot => shot.sourceId === parts[1].id)).toBe(true);
    h.run(8); expect(h.enemies.filter(enemy => enemy.parentId === h.enemy.id)).toHaveLength(3);
  });
  it('cancels a disabled node warning and resumes only after the five-second shutdown', () => {
    const h = harness('s2', 'normal', 2); h.run(0.8);
    const node = h.enemies.find(enemy => enemy.parentId === h.enemy.id)!;
    node.disabledUntil = h.ctx.elapsed + 5;
    h.run(4.9); expect(h.shots.some(shot => shot.sourceId === node.id)).toBe(false);
    h.run(2.3); expect(h.shots.some(shot => shot.sourceId === node.id)).toBe(true);
    expect(h.enemies.filter(enemy => enemy.parentId === h.enemy.id)).toHaveLength(2);
  });
  it.each(['normal', 'hard'] as const)('keeps %s fold-back previews aligned across stop and reverse phase boundaries', difficulty => {
    const h = harness('s2', difficulty, 3); h.run(SPELL_CARDS.s2[difficulty][3].intro);
    const cue = spellTelegraphs(h.enemy)[0], before = { ...cue.returnPaths![0] };
    h.run(0.2); expect(cue.returnPaths![0].remainingUntilReverse).toBeCloseTo(before.remainingUntilReverse - 0.2, 8);
    h.run(cue.remaining + STEP);
    const original = h.bullets.find(bullet => bullet.program)!;
    const bullet: Bullet = { ...original, x: before.x, y: before.y, motionAge: 0, programIndex: 0, programAge: 0, programEntered: false,
      programAngle: Math.atan2(original.vy, original.vx), programSpeed: original.program![0].speed };
    for (const dt of [2.7, bullet.program![1].duration, STEP, 0.5]) {
      const move = advanceProjectileMotion(bullet, dt)!; bullet.x += move.dx; bullet.y += move.dy;
      const preview = spellReturnPreview(bullet)!;
      expect(preview.x).toBeCloseTo(before.x, 7); expect(preview.y).toBeCloseTo(before.y, 7);
      expect(preview.turnX).toBeCloseTo(before.turnX, 7); expect(preview.turnY).toBeCloseTo(before.turnY, 7);
      expect(preview.endX).toBeCloseTo(before.endX, 7); expect(preview.endY).toBeCloseTo(before.endY, 7);
    }
  });
  it('uses the real projectile program to stop, then reverse exactly once', () => {
    const h = harness('s2', 'normal', 3); h.run(1.85);
    const shot = h.shots.find(shot => shot.options?.program);
    expect(shot).toBeDefined();
    const bullet = h.bullets.find(bullet => bullet.program)!;
    expect(bullet).toBeDefined();
    const initialAngle = Math.atan2(bullet.vy, bullet.vx);
    // Advance a copy through production motion code without player collisions or arena retirement.
    const copy = { ...bullet, programIndex: 0, programAge: 0, programEntered: false, motionAge: 0, programAngle: initialAngle, programSpeed: 200 };
    const outbound = advanceProjectileMotion(copy, 2.7)!;
    expect(Math.hypot(outbound.dx, outbound.dy)).toBeCloseTo(540, 7);
    const hold = advanceProjectileMotion(copy, 0.7)!;
    expect(Math.hypot(hold.dx, hold.dy)).toBeCloseTo(0, 7);
    const returning = advanceProjectileMotion(copy, 0.5)!;
    expect(returning.dx * Math.cos(initialAngle) + returning.dy * Math.sin(initialAngle)).toBeCloseTo(-117.5, 7);
    advanceProjectileMotion(copy, 0.5);
    expect(copy.vx * Math.cos(initialAngle) + copy.vy * Math.sin(initialAngle)).toBeCloseTo(-235, 7);
  });
});

describe('physical gaps and ordinary movement at arena edges', () => {
  it.each(['normal', 'hard'] as const)('the complete %s seven-wall train requires repeated movement and has a walking route', difficulty => {
    const run = (move: boolean) => {
      const h = harness('s2', difficulty); h.player.x = ARENA.x + 100;
      let cueId = 0, reactAt = Infinity, target = h.player.y;
      for (let tick = 0; tick < 12 * 60; tick++) {
        const cue = spellTelegraphs(h.enemy).find(cue => cue.kind === 'wall');
        if (cue && cue.id !== cueId) { cueId = cue.id; target = cue.y + cue.gapCenter!; reactAt = h.time + 0.2; }
        const speed = move && h.time >= reactAt ? clamp((target - h.player.y) / STEP, -180, 180) : 0;
        h.tick(STEP, 0, speed);
        if (h.enemy.spell!.shotIndex >= 7) h.enemy.spell!.nextAttack = Infinity;
      }
      expect(h.enemy.spell!.shotIndex).toBe(7); expect(h.shots.length).toBeGreaterThan(200);
      return h;
    };
    expect(run(false).hits).toBeGreaterThan(0);
    const walking = run(true);
    expect(walking.hits).toBe(0); expect(walking.player.invincible).toBe(0);
    expect(Math.abs(walking.player.y - 2220)).toBeGreaterThan(350);
  });
  it.each(['normal', 'hard'] as const)('a %s wall has the promised physical lip spacing and its next opening changes', difficulty => {
    const h = harness('s2', difficulty); h.run(SPELL_CARDS.s2[difficulty][0].intro);
    const first = structuredClone(spellTelegraphs(h.enemy)[0]);
    expect(first.gapWidth).toBe(SPELL_BALANCE[difficulty].gateWidth);
    h.run(first.warning + STEP);
    const wallShots = h.shots.filter(shot => shot.x === first.x).map(shot => shot.y).sort((a, b) => a - b);
    const center = first.y + first.gapCenter!;
    const lower = wallShots.filter(y => y < center).at(-1)!;
    const upper = wallShots.find(y => y > center)!;
    expect(upper - lower - 14).toBeCloseTo(first.gapWidth!, 8);
    h.run(1);
    const next = spellTelegraphs(h.enemy).find(cue => cue.kind === 'wall');
    expect(next).toBeDefined(); expect(next!.gapCenter).not.toBe(first.gapCenter);
  });
  it.each((['normal', 'hard'] as const).flatMap(difficulty => [0, 1, 2, 3].map(corner => ({ difficulty, corner }))))(
    '$difficulty: the first wall is escapable from corner $corner after a 0.2-second reaction without dash or invulnerability', ({ difficulty, corner }) => {
      const h = harness('s2', difficulty);
      h.player.x = ARENA.x + (corner % 2 ? ARENA.width - 18 : 18);
      h.player.y = ARENA.y + (corner < 2 ? 18 : ARENA.height - 18);
      h.run(SPELL_CARDS.s2[difficulty][0].intro);
      const cue = { ...spellTelegraphs(h.enemy)[0] };
      expect(cue.kind).toBe('wall'); h.enemy.spell!.nextAttack = Infinity;
      const start = h.time, target = cue.y + cue.gapCenter!;
      for (let tick = 0; tick < 9 * 60; tick++) {
        const distance = target - h.player.y;
        const speed = h.time - start < 0.2 ? 0 : clamp(distance / STEP, -300, 300);
        h.tick(STEP, 0, speed);
      }
      expect(h.shots.length).toBeGreaterThan(30); expect(h.hits).toBe(0);
      expect(h.player.invincible).toBe(0); expect(h.player.dashTime).toBe(0);
    });
  it.each(['normal', 'hard'] as const)('sampled %s ground marks can be escaped inward from all four corners', difficulty => {
    for (let corner = 0; corner < 4; corner++) {
      const h = harness('s1', difficulty, 4);
      h.player.x = ARENA.x + (corner % 2 ? ARENA.width - 18 : 18);
      h.player.y = ARENA.y + (corner < 2 ? 18 : ARENA.height - 18);
      h.run(SPELL_CARDS.s1[difficulty][4].intro);
      h.enemy.spell!.nextAttack = Infinity;
      expect(h.announced[0]).toMatchObject({ x: h.player.x, y: h.player.y, kind: 'bombard' });
      const originX = h.player.x, originY = h.player.y;
      h.run(0.2);
      for (let tick = 0; tick < 0.8 * 60; tick++) h.tick(STEP, corner % 2 ? -212 : 212, corner < 2 ? 212 : -212);
      expect(Math.hypot(h.player.x - originX, h.player.y - originY)).toBeGreaterThan(200);
      expect(h.hits).toBe(0); expect(h.player.invincible).toBe(0);
    }
  });
});

describe('fixed clock and bounded encounter lifetime', () => {
  it('produces the same nonempty 24-second attacks at 30, 60 and 144 Hz render clocks', () => {
    const result = (fps: number) => {
      const h = harness('s2', 'hard', 3), clock = new FixedClock();
      clock.advance(0, () => h.tick());
      for (let frame = 1; frame <= fps * 24; frame++) clock.advance(frame * 1000 / fps, () => h.tick());
      expect(h.enemy.spell!.age).toBeCloseTo(24, 6); expect(h.shots.length).toBeGreaterThan(100);
      expect(h.events.some(event => event.type === 'card')).toBe(true);
      return { age: h.enemy.spell!.age, index: h.enemy.spell!.shotIndex,
        shots: h.shots.map(shot => [shot.sourceId, Number(shot.time.toFixed(7)), Number(shot.angle.toFixed(7))]) };
    };
    expect(result(30)).toEqual(result(60)); expect(result(144)).toEqual(result(60));
  });
  it('uses dt rather than external wall time and does not replay missed events after a pause', () => {
    const h = harness(); h.run(2); const age = h.enemy.spell!.age, count = h.shots.length;
    h.ctx.elapsed += 3600;
    updateSpellBoss(h.enemy, 0, h.ctx);
    expect(h.enemy.spell!.age).toBe(age); expect(h.shots).toHaveLength(count);
    h.tick(); expect(h.enemy.spell!.age).toBeCloseTo(age + STEP, 10);
    expect(h.shots.length - count).toBeLessThan(30);
  });
});

describe('production simulation spell integration', () => {
  it.each(['normal', 'hard'] as const)('isolates seven %s slice walls to retain their measured 7-radius gap route independently of body actions', difficulty => {
    const sim = new GameSimulation(7004, difficulty);
    sim.reset('story', 7004, difficulty, { difficulty });
    const boss = sim.spawnEnemy('boss', 2000, 1780, 's2:final')!;
    boss.spell!.nextMotion = Infinity;
    const p = sim.state.player; p.invincible = 0; p.x = p.prevX = ARENA.x + 100;
    let cueId = 0, reactAt = Infinity, target = p.y, emitted = 0;
    for (let tick = 0; tick < 12 * 60; tick++) {
      const cue = spellTelegraphs(boss).find(cue => cue.kind === 'wall');
      if (cue && cue.id !== cueId) { cueId = cue.id; target = cue.y + cue.gapCenter!; reactAt = sim.state.elapsed + 0.2; }
      const move = sim.state.elapsed >= reactAt && Math.abs(target - p.y) > 3 ? Math.sign(target - p.y) : 0;
      const events = sim.step({ moveX: 0, moveY: move, focus: true, shoot: false, dash: false, bomb: false, aimX: boss.x, aimY: boss.y });
      emitted += events.filter(event => event.type === 'enemyShot').length;
      if (boss.spell!.shotIndex >= 7) boss.spell!.nextAttack = Infinity;
    }
    expect(sim.state.elapsed).toBeCloseTo(12, 8); expect(boss.spell!.shotIndex).toBe(7);
    expect(emitted).toBe(7); expect(p.hp).toBe(5); expect(p.invincible).toBe(0);
    expect(p.bombs).toBe(3); expect(p.dashCooldown).toBe(0);
    expect(sim.state.camera).toMatchObject({ x: 2000, y: 2000 });
    expect(p.radius).toBe(18);
  });
  it.each(['normal', 'hard'] as const)('actual %s laser contact uses the 7-radius core, while preserving the 18-radius body', difficulty => {
    const sim = new GameSimulation(7033, difficulty), boss = sim.spawnEnemy('boss', 2000, 1780)!;
    for (let card = 0; card < 3; card++) advanceSpellCard(boss, difficulty);
    const idle = { moveX: 0, moveY: 0, shoot: false, dash: false, bomb: false, aimX: boss.x, aimY: boss.y };
    for (let tick = 0; tick < 120 && sim.state.hazards.length === 0; tick++) sim.step(idle);
    const beam = sim.state.hazards.find(hazard => hazard.kind === 'beam')!;
    expect(beam).toBeDefined(); boss.spell!.nextAttack = Infinity;
    const angle = beam.angle!, p = sim.state.player, width = beam.width!;
    const position = (offset: number) => {
      p.x = p.prevX = beam.x + Math.cos(angle) * 500 - Math.sin(angle) * offset;
      p.y = p.prevY = beam.y + Math.sin(angle) * 500 + Math.cos(angle) * offset;
    };
    p.invincible = 0; position(width / 2 + 7.5);
    for (let tick = 0; tick < 120 && !beam.active; tick++) sim.step(idle);
    expect(beam.active).toBe(true); expect(p.hp).toBe(5);
    position(width / 2 + 6.5); sim.step(idle);
    expect(p.hp).toBe(difficulty === 'hard' ? 3 : 4); expect(p.radius).toBe(18);
  });
});
