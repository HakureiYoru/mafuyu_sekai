import { BALANCE, ENEMIES, STEP, VIEW, WORLD, xpNeeded } from './config';
import { angleDelta, beamGeometry, clamp, normalize, pointInBeam, SeededRandom, segmentCircleHit, SpatialGrid, TAU } from './math';
import { ObjectPool } from './pool';
import type { Bullet, CombatEvent, Companion, Enemy, EnemyType, InputAction, Pickup, PickupType, Player, WorldState } from './types';

const EPSILON = 1e-8;
const PICKUP_COLORS: Record<PickupType, number> = { xp: 0x73f7eb, hp: 0xa6f1aa, bomb: 0xffcb69, ammo: 0x69ffc0, coolant: 0x69caff, miniBomb: 0xffbb55, blackHole: 0xbb88ff, support: 0x9ceaff };
const emptyBullet = (): Bullet => ({ id: 0, owner: 'player', x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0, radius: 4, damage: 2, life: 0, color: 0, homing: false, speed: 0, lockRange: 0, targetId: null, remainingHits: 1, hitIds: new Set(), kind: 'normal' });

export class GameSimulation {
  state!: WorldState;
  private seed: number;
  private random!: SeededRandom;
  private nextId = 1;
  private events: CombatEvent[] = [];
  private queuedEvents: CombatEvent[] = [];
  private stepping = false;
  private previousDash = false;
  private previousBomb = false;
  private bossAddTimer = BALANCE.boss.addInterval as number;
  private specialWindup = 0;
  private specialTarget: number | null = null;
  private stressMode = false;
  private enemyCount = 0;
  private mineCount = 0;
  private maxEnemyRadius = 0;
  private maxEnemyMotion = 0;
  private readonly byId = new Map<number, Enemy>();
  private readonly grid = new SpatialGrid<Enemy>(160);
  private readonly candidates: Enemy[] = [];
  private readonly impacts: { enemy: Enemy; time: number }[] = [];
  private readonly suppliedWaves = new Set<number>();
  private readonly bulletPool = new ObjectPool(emptyBullet, bullet => bullet.hitIds.clear(), BALANCE.limits.bullets);

  constructor(seed = 12345) { this.seed = seed; this.reset(); }

  reset(mode: 'story' | 'endless' = 'story', seed = this.seed): void {
    if (this.state) for (const bullet of this.state.bullets) this.bulletPool.release(bullet);
    this.seed = seed;
    this.random = new SeededRandom(seed);
    this.nextId = 1;
    this.events = [];
    this.queuedEvents = [];
    this.byId.clear();
    this.grid.clear();
    this.candidates.length = 0;
    this.impacts.length = 0;
    this.suppliedWaves.clear();
    this.previousDash = this.previousBomb = false;
    this.specialWindup = 0;
    this.specialTarget = null;
    this.bossAddTimer = BALANCE.boss.addInterval;
    this.enemyCount = this.mineCount = 0;
    this.stressMode = false;
    const x = WORLD.width / 2, y = WORLD.height / 2;
    const player: Player = { x, y, prevX: x, prevY: y, vx: 0, vy: 0, radius: BALANCE.player.radius,
      hp: BALANCE.player.hp, maxHp: BALANCE.player.hp, bombs: BALANCE.player.bombs, level: 1, xp: 0,
      ammo: BALANCE.ammo.max, heat: 0, angle: -Math.PI / 2, invincible: 1, dashTime: 0, dashCooldown: 0,
      dashVx: 0, dashVy: 0, perfectWindow: 0, shotCooldown: 0, specialCooldown: 0, idleTime: 0,
      heatLock: 0, overheated: false };
    this.state = { status: 'playing', mode, elapsed: 0, tick: 0, score: 0, kills: 0, wave: mode === 'endless' ? 6 : 1,
      waveTime: 0, spawnTimer: 0.6, bossStage: false, bossPending: false, pendingWave: 0,
      blackHoleTime: 0, player, camera: { x, y, prevX: x, prevY: y }, enemies: [], bullets: [], pickups: [], indicators: [], companions: [], beams: [] };
  }

  /** Edge history is reset on pause/blur so a new physical press resumes cleanly. */
  clearInput(): void { this.previousDash = this.previousBomb = false; }

  continueEndless(): void {
    if (this.state.status !== 'complete') return;
    this.state.mode = 'endless';
    this.state.status = 'playing';
    this.state.wave = 6;
    this.state.waveTime = 0;
    this.state.spawnTimer = 1;
    this.state.bossStage = this.state.bossPending = false;
    this.state.pendingWave = 0;
    this.clearCombat();
    const player = this.state.player;
    player.hp = player.maxHp;
    player.ammo = BALANCE.ammo.max;
    player.heat = player.heatLock = 0;
    player.overheated = false;
    player.invincible = 2;
    player.dashTime = player.perfectWindow = player.shotCooldown = player.dashCooldown = 0;
    this.clearInput();
    this.specialWindup = 0;
    this.specialTarget = null;
    this.emit({ type: 'wave', x: player.x, y: player.y, amount: 6 });
  }

  step(input: InputAction, dt = STEP): CombatEvent[] {
    this.events = this.queuedEvents;
    this.queuedEvents = [];
    if (this.state.status !== 'playing' || dt <= 0 || !Number.isFinite(dt)) return this.events;
    this.stepping = true;
    const world = this.state;
    world.tick++;
    world.elapsed += dt;
    world.blackHoleTime = Math.max(0, world.blackHoleTime - dt);
    this.updateBeams(dt);
    this.rebuildGrid();
    this.updatePlayer(input, dt);
    if (world.status === 'playing') {
      if (!this.stressMode) this.updateWaves(dt);
      this.updateEnemies(dt);
    }
    if (world.status === 'playing') {
      this.rebuildGrid();
      this.separateEnemies(dt);
      this.rebuildGrid();
      this.updateCompanions(dt);
      this.updateBullets(dt);
    }
    if (world.status === 'playing') this.updatePickups(dt);
    if (world.status === 'playing' && this.stressMode) this.maintainStressBullets();
    this.pruneEnemies();
    const camera = world.camera, player = world.player;
    camera.prevX = camera.x; camera.prevY = camera.y;
    camera.x = clamp(player.x, VIEW.width / 2, WORLD.width - VIEW.width / 2);
    camera.y = clamp(player.y, VIEW.height / 2, WORLD.height - VIEW.height / 2);
    if (world.status !== 'playing') this.clearCombat();
    this.stepping = false;
    return this.events;
  }

  private emit(event: CombatEvent): void { (this.stepping ? this.events : this.queuedEvents).push(event); }

  private updatePlayer(input: InputAction, dt: number): void {
    const p = this.state.player;
    p.prevX = p.x; p.prevY = p.y;
    p.invincible = Math.max(0, p.invincible - dt);
    p.shotCooldown = Math.max(0, p.shotCooldown - dt);
    p.specialCooldown = Math.max(0, p.specialCooldown - dt);
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    p.perfectWindow = Math.max(0, p.perfectWindow - dt);
    p.heatLock = Math.max(0, p.heatLock - dt);
    const aimX = input.aimX - p.x, aimY = input.aimY - p.y;
    if (Math.hypot(aimX, aimY) > EPSILON) p.angle = Math.atan2(aimY, aimX);
    const direction = normalize(input.moveX, input.moveY);
    if (input.dash && !this.previousDash && p.dashCooldown <= EPSILON && p.dashTime <= EPSILON) {
      const dash = direction.x || direction.y ? direction : { x: Math.cos(p.angle), y: Math.sin(p.angle) };
      p.dashVx = dash.x * BALANCE.dash.speed; p.dashVy = dash.y * BALANCE.dash.speed;
      p.dashTime = BALANCE.dash.duration;
      p.dashCooldown = BALANCE.dash.cooldown;
      p.perfectWindow = 0;
      this.emit({ type: 'dash', x: p.x, y: p.y, angle: Math.atan2(dash.y, dash.x), color: 0x73f7eb });
    }
    this.previousDash = input.dash;
    const dashDelta = Math.min(dt, p.dashTime);
    if (dashDelta > 0) {
      p.invincible = Math.max(p.invincible, p.dashTime);
      p.x += p.dashVx * dashDelta; p.y += p.dashVy * dashDelta;
      p.dashTime = Math.max(0, p.dashTime - dt);
      if (p.dashTime <= EPSILON) { p.dashTime = 0; p.perfectWindow = BALANCE.dash.window; }
    }
    p.vx = dashDelta > 0 ? p.dashVx : direction.x * BALANCE.player.speed;
    p.vy = dashDelta > 0 ? p.dashVy : direction.y * BALANCE.player.speed;
    p.x = clamp(p.x + direction.x * BALANCE.player.speed * (dt - dashDelta), p.radius, WORLD.width - p.radius);
    p.y = clamp(p.y + direction.y * BALANCE.player.speed * (dt - dashDelta), p.radius, WORLD.height - p.radius);
    if (input.bomb && !this.previousBomb && p.bombs > 0) this.useBomb();
    this.previousBomb = input.bomb;
    if (this.state.status !== 'playing') return;

    const beamReady = input.shoot && p.perfectWindow > 0 && p.ammo >= 1;
    const firing = input.shoot && !p.overheated && p.ammo >= 1;
    if (beamReady) {
      p.idleTime = 0;
      this.fireDashBeam();
      if (this.state.status !== 'playing') return;
    } else if (firing) {
      p.idleTime = 0;
      if (p.shotCooldown <= EPSILON) this.playerShoot();
      p.heat = Math.min(BALANCE.heat.max, p.heat + BALANCE.heat.rate * dt);
      if (p.heat >= BALANCE.heat.max - EPSILON) { p.heat = BALANCE.heat.max; p.overheated = true; p.heatLock = BALANCE.heat.lock; }
    } else {
      const previousIdle = p.idleTime;
      p.idleTime += dt;
      const coolDelta = Math.max(0, p.idleTime - Math.max(previousIdle, BALANCE.heat.delay));
      const ammoDelta = Math.max(0, p.idleTime - Math.max(previousIdle, BALANCE.ammo.delay));
      p.heat = Math.max(0, p.heat - BALANCE.heat.cooling * coolDelta);
      p.ammo = Math.min(BALANCE.ammo.max, p.ammo + BALANCE.ammo.regen * ammoDelta);
    }
    if (p.overheated && p.heatLock <= EPSILON && p.heat <= BALANCE.heat.unlock + EPSILON) p.overheated = false;
    this.updateSpecial(dt);
  }

  private playerShoot(): void {
    const p = this.state.player, lv = clamp(p.level, 1, BALANCE.xp.cap) - 1;
    const count = BALANCE.weapon.counts[lv];
    if (this.state.bullets.length + count > BALANCE.limits.bullets) return;
    p.ammo = Math.max(0, p.ammo - 1);
    p.shotCooldown = BALANCE.weapon.intervals[lv] * STEP;
    const color = p.level >= 10 ? 0xffcb69 : p.level >= 7 ? 0xc99dff : p.level >= 4 ? 0x69baff : 0x73f7eb;
    for (let i = 0; i < count; i++) {
      const angle = p.angle + (i - (count - 1) / 2) * BALANCE.weapon.spreads[lv];
      this.addBullet(p.x, p.y, angle, BALANCE.weapon.speeds[lv], 'player', BALANCE.weapon.damage,
        p.level >= 10 ? 6 : 4, color, 'normal', p.level >= 10 ? 2 : 1, p.level >= 7, BALANCE.weapon.homingRange);
    }
    this.emit({ type: 'shot', x: p.x + Math.cos(p.angle) * 30, y: p.y + Math.sin(p.angle) * 30, angle: p.angle, color: 0x73f7eb, amount: BALANCE.weapon.damage });
  }

  private fireDashBeam(): void {
    const p = this.state.player, dash = BALANCE.dash;
    const beam = beamGeometry(p.x, p.y, p.angle, dash.beamLength, dash.beamWidth);
    p.ammo--; p.perfectWindow = 0;
    p.shotCooldown = BALANCE.weapon.intervals[clamp(p.level, 1, BALANCE.xp.cap) - 1] * STEP;
    this.state.beams.push({ id: this.nextId++, x: p.x, y: p.y, angle: p.angle, length: dash.beamLength, width: dash.beamWidth, life: dash.beamDuration, duration: dash.beamDuration });
    this.emit({ type: 'beam', x: p.x, y: p.y, angle: p.angle, amount: dash.damage, color: 0x73ffcd });
    let keep = 0;
    for (const b of this.state.bullets) {
      if (b.owner === 'enemy' && pointInBeam(b.x, b.y, b.radius, beam)) this.bulletPool.release(b);
      else this.state.bullets[keep++] = b;
    }
    this.state.bullets.length = keep;
    const padding = this.maxEnemyRadius + dash.beamWidth / 2;
    this.grid.query(Math.min(beam.x, beam.endX) - padding, Math.min(beam.y, beam.endY) - padding,
      Math.max(beam.x, beam.endX) + padding, Math.max(beam.y, beam.endY) + padding, this.candidates);
    this.impacts.length = 0;
    const dx = Math.cos(p.angle), dy = Math.sin(p.angle);
    for (const enemy of this.candidates) {
      if (enemy.hp > 0 && pointInBeam(enemy.x, enemy.y, enemy.radius, beam)) {
        this.impacts.push({ enemy, time: (enemy.x - p.x) * dx + (enemy.y - p.y) * dy });
      }
    }
    this.impacts.sort((a, b) => a.time - b.time || a.enemy.id - b.enemy.id);
    for (let i = 0; i < Math.min(dash.targets, this.impacts.length); i++) {
      if (this.state.status !== 'playing') break;
      this.damageEnemy(this.impacts[i].enemy, dash.damage);
    }
  }

  private updateBeams(dt: number): void {
    let keep = 0;
    for (const beam of this.state.beams) {
      beam.life -= dt;
      if (beam.life > EPSILON) this.state.beams[keep++] = beam;
    }
    this.state.beams.length = keep;
  }

  private updateCompanions(dt: number): void {
    const p = this.state.player, cfg = BALANCE.companion, companions = this.state.companions;
    for (let i = 0; i < companions.length; i++) {
      if (this.state.status !== 'playing') break;
      const companion = companions[i], orbit = this.state.elapsed * cfg.orbitSpeed + i * TAU / companions.length;
      companion.prevX = companion.x; companion.prevY = companion.y;
      companion.x = clamp(p.x + Math.cos(orbit) * cfg.orbitRadius, companion.radius, WORLD.width - companion.radius);
      companion.y = clamp(p.y + Math.sin(orbit) * cfg.orbitRadius, companion.radius, WORLD.height - companion.radius);
      companion.vx = (companion.x - companion.prevX) / dt; companion.vy = (companion.y - companion.prevY) / dt;
      const target = this.nearestEnemy(companion.x, companion.y, cfg.range);
      companion.targetId = target?.id ?? null;
      companion.angle = target ? Math.atan2(target.y - companion.y, target.x - companion.x) : orbit + Math.PI / 2;
      companion.shotCooldown -= dt;
      if (companion.shotCooldown <= EPSILON) {
        // Keeping each independent phase running while idle prevents a synchronized volley on reacquisition.
        companion.shotCooldown += cfg.interval;
        if (!target) continue;
        const shot = this.addBullet(companion.x, companion.y, companion.angle, cfg.bulletSpeed, 'player', cfg.damage, 4, 0x9ceaff, 'drone');
        if (shot) this.emit({ type: 'shot', text: 'drone', x: companion.x, y: companion.y, angle: companion.angle, amount: cfg.damage, color: 0x9ceaff, targetId: target.id });
      }
    }
  }

  private deployCompanion(): void {
    const p = this.state.player, companions = this.state.companions, cfg = BALANCE.companion;
    const index = companions.length, orbit = this.state.elapsed * cfg.orbitSpeed + index * TAU / (index + 1), radius = 14;
    const x = clamp(p.x + Math.cos(orbit) * cfg.orbitRadius, radius, WORLD.width - radius);
    const y = clamp(p.y + Math.sin(orbit) * cfg.orbitRadius, radius, WORLD.height - radius);
    // Join the existing firing clock instead of starting a new phase at pickup time.
    const phase = index === 0 ? 0 : (companions[0].shotCooldown + index * cfg.interval / cfg.max) % cfg.interval;
    const shotCooldown = index > 0 && phase <= EPSILON ? cfg.interval : phase;
    const companion: Companion = { id: this.nextId++, x, y, prevX: x, prevY: y, vx: 0, vy: 0, radius,
      angle: orbit + Math.PI / 2, shotCooldown, targetId: null };
    companions.push(companion);
    this.emit({ type: 'support', text: 'deployed', x, y, amount: companions.length, color: 0x9ceaff });
  }

  private supplyCompanion(): void {
    const w = this.state;
    if (this.stressMode || this.suppliedWaves.has(w.wave) || !BALANCE.companion.supplyWaves.some(wave => wave === w.wave)) return;
    this.suppliedWaves.add(w.wave);
    const angle = w.player.angle + Math.PI / 2;
    const x = clamp(w.player.x + Math.cos(angle) * 72, w.player.radius, WORLD.width - w.player.radius);
    const y = clamp(w.player.y + Math.sin(angle) * 72, w.player.radius, WORLD.height - w.player.radius);
    this.addPickup('support', x, y, 1);
    this.emit({ type: 'support', text: 'arrival', x, y, amount: w.companions.length, color: 0x9ceaff });
  }

  private updateSpecial(dt: number): void {
    const p = this.state.player;
    if (p.level < BALANCE.special.level || p.overheated || p.ammo < 1) { this.specialWindup = 0; this.specialTarget = null; return; }
    if (this.specialWindup > 0) {
      this.specialWindup -= dt;
      if (this.specialWindup <= EPSILON) {
        const target = this.specialTarget === null ? null : this.byId.get(this.specialTarget);
        if (target && target.hp > 0 && Math.hypot(target.x - p.x, target.y - p.y) <= BALANCE.special.range + target.radius) {
          const angle = Math.atan2(target.y - p.y, target.x - p.x);
          const bullet = this.addBullet(p.x, p.y, angle, BALANCE.special.speed, 'player', BALANCE.special.damage, 9, 0xf096ff, 'special', 1, true, BALANCE.special.range);
          if (bullet) { bullet.targetId = target.id; p.ammo--; p.specialCooldown = BALANCE.special.cooldown; this.emit({ type: 'shot', x: p.x, y: p.y, color: 0xf096ff, angle, amount: BALANCE.special.damage }); }
        }
        this.specialWindup = 0; this.specialTarget = null;
      }
    } else if (p.specialCooldown <= EPSILON) {
      const target = this.nearestEnemy(p.x, p.y, BALANCE.special.range);
      if (target) { this.specialTarget = target.id; this.specialWindup = BALANCE.special.windup; }
    }
  }

  private useBomb(): void {
    const p = this.state.player, half = BALANCE.bomb.size / 2;
    p.bombs--;
    p.invincible = Math.max(p.invincible, BALANCE.bomb.invincible);
    for (const e of this.state.enemies) {
      if (e.hp > 0 && Math.abs(e.x - p.x) <= half + e.radius && Math.abs(e.y - p.y) <= half + e.radius) this.damageEnemy(e, BALANCE.bomb.damage);
    }
    let keep = 0;
    for (const b of this.state.bullets) {
      if (b.owner === 'enemy') this.bulletPool.release(b);
      else this.state.bullets[keep++] = b;
    }
    this.state.bullets.length = keep;
    this.emit({ type: 'bomb', x: p.x, y: p.y, color: 0xffcb69, amount: BALANCE.bomb.size });
  }

  private updateWaves(dt: number): void {
    const w = this.state;
    if (!w.bossStage && !w.bossPending) {
      w.waveTime += dt;
      if (w.waveTime >= BALANCE.spawn.waveDuration - EPSILON) {
        w.waveTime = 0;
        const needsBoss = w.mode === 'story' ? w.wave === BALANCE.spawn.storyWaves : w.wave % BALANCE.spawn.endlessBossInterval === 0;
        if (needsBoss) {
          w.bossPending = true;
          w.pendingWave = w.mode === 'endless' ? w.wave + 1 : 0;
          w.indicators.length = 0;
          w.indicators.push({ id: this.nextId++, x: WORLD.width / 2, y: WORLD.height / 2, type: 'boss', time: 2, duration: 2 });
        } else {
          w.wave++;
          this.emit({ type: 'wave', x: w.player.x, y: w.player.y, amount: w.wave });
          this.supplyCompanion();
        }
      }
    }
    if (w.bossStage) {
      this.bossAddTimer -= dt;
      if (this.bossAddTimer <= EPSILON) {
        this.bossAddTimer += BALANCE.boss.addInterval;
        if (this.enemyCount - 1 + w.indicators.length < BALANCE.boss.maxAdds) this.queueSpawn();
      }
    } else if (!w.bossPending) {
      w.spawnTimer -= dt;
      if (w.spawnTimer <= EPSILON) {
        const base = BALANCE.spawn.intervals[Math.min(w.wave - 1, 4)];
        w.spawnTimer += w.mode === 'endless' ? Math.max(0.5, base - (w.wave - 5) * 0.015) : base;
        this.queueSpawn();
      }
    }
    for (let i = w.indicators.length - 1; i >= 0; i--) {
      const indicator = w.indicators[i];
      indicator.time -= dt;
      if (indicator.time <= EPSILON) {
        w.indicators.splice(i, 1);
        this.spawnEnemy(indicator.type, indicator.x, indicator.y);
      }
    }
  }

  private queueSpawn(): void {
    const w = this.state;
    if (this.enemyCount + w.indicators.length >= BALANCE.limits.enemies) return;
    const angle = this.random.next() * TAU;
    let x = clamp(w.player.x + Math.cos(angle) * 980, 70, WORLD.width - 70);
    let y = clamp(w.player.y + Math.sin(angle) * 980, 70, WORLD.height - 70);
    if (Math.hypot(x - w.player.x, y - w.player.y) < 420) {
      const inward = Math.atan2(WORLD.height / 2 - w.player.y, WORLD.width / 2 - w.player.x);
      x = clamp(w.player.x + Math.cos(inward) * 850, 70, WORLD.width - 70);
      y = clamp(w.player.y + Math.sin(inward) * 850, 70, WORLD.height - 70);
    }
    const roll = this.random.next();
    let type: EnemyType = 'basic';
    if (w.wave > 1 && roll > 0.6) type = 'dasher';
    if (w.wave > 2 && roll > 0.75) type = 'minelayer';
    if (w.wave > 3 && roll > 0.85) type = 'sniper';
    if (w.wave > 4 && roll > 0.92) type = 'sprayer';
    if ((type === 'minelayer' || type === 'sniper') && this.random.next() < 0.7) type = 'basic';
    w.indicators.push({ id: this.nextId++, x, y, type, time: BALANCE.spawn.warning, duration: BALANCE.spawn.warning });
  }

  spawnEnemy(type: EnemyType, x: number, y: number): Enemy | null {
    const w = this.state;
    const atEnemyCap = this.stressMode
      ? this.enemyCount - this.mineCount >= BALANCE.limits.enemies && type !== 'mine'
      : this.enemyCount >= BALANCE.limits.enemies;
    if (type !== 'boss' && (atEnemyCap || (type === 'mine' && this.mineCount >= BALANCE.limits.mines))) return null;
    if (type === 'boss') {
      this.clearCombat();
      x = WORLD.width / 2; y = WORLD.height / 2;
      w.bossStage = true; w.bossPending = false;
      const p = w.player;
      const safeDistance = BALANCE.boss.radius + p.radius + 220;
      if (Math.hypot(p.x - x, p.y - y) < safeDistance) {
        const direction = Math.hypot(p.x - x, p.y - y) < 1 ? { x: 0, y: 1 } : normalize(p.x - x, p.y - y);
        p.x = p.prevX = x + direction.x * safeDistance; p.y = p.prevY = y + direction.y * safeDistance;
      }
      w.camera.x = w.camera.prevX = clamp(p.x, VIEW.width / 2, WORLD.width - VIEW.width / 2);
      w.camera.y = w.camera.prevY = clamp(p.y, VIEW.height / 2, WORLD.height - VIEW.height / 2);
      p.ammo = BALANCE.ammo.max; p.heat = p.heatLock = 0; p.overheated = false;
      p.invincible = Math.max(p.invincible, 2);
      this.bossAddTimer = BALANCE.boss.addInterval;
      this.specialWindup = 0; this.specialTarget = null;
    }
    const base = ENEMIES[type], waveBonus = Math.max(0, w.wave - 1);
    let hp = type === 'basic' ? base.hp + waveBonus * 2 : type === 'mine' ? 1 : type === 'boss' ? BALANCE.boss.hp : base.hp * (1 + waveBonus * 0.18);
    let speed = base.speed as number, radius = base.radius as number;
    if (w.mode === 'endless') {
      const extra = Math.max(0, w.wave - 5);
      if (type !== 'mine') hp *= (1 + extra * 0.2) * (1 + extra * 0.3);
      speed = Math.min(300, speed * (1 + extra * 0.02));
      radius *= Math.min(3, 1 + extra * 0.05);
    }
    hp = Math.ceil(hp);
    const enemy: Enemy = { id: this.nextId++, type, x: clamp(x, radius, WORLD.width - radius), y: clamp(y, radius, WORLD.height - radius),
      prevX: x, prevY: y, vx: 0, vy: 0, radius, hp, maxHp: hp, speed, angle: this.random.next() * TAU,
      state: 'chase', timer: type === 'boss' ? 5 : 0, cooldown: type === 'sniper' ? 0.6 + this.random.next() : type === 'minelayer' ? 2 : 0,
      laserCooldown: BALANCE.boss.firstLaser, attackIndex: 0, hitTime: 0, lowHpSpoken: false, directionX: 0, directionY: 0 };
    enemy.prevX = enemy.x; enemy.prevY = enemy.y;
    this.state.enemies.push(enemy); this.byId.set(enemy.id, enemy);
    this.enemyCount++; if (type === 'mine') this.mineCount++;
    this.emit({ type: type === 'boss' ? 'boss' : 'spawn', x: enemy.x, y: enemy.y, enemyType: type, targetId: enemy.id, color: ENEMIES[type].color });
    return enemy;
  }

  private updateEnemies(dt: number): void {
    const w = this.state, p = w.player;
    // New mines start moving/attacking on the next simulation step.
    const count = w.enemies.length;
    for (let i = 0; i < count; i++) {
      if (w.status !== 'playing') break;
      const e = w.enemies[i];
      if (e.hp <= 0) continue;
      e.prevX = e.x; e.prevY = e.y;
      e.hitTime = Math.max(0, e.hitTime - dt);
      e.cooldown -= dt;
      const dx = p.x - e.x, dy = p.y - e.y, distance = Math.hypot(dx, dy);
      const toward = Math.atan2(dy, dx);
      // Only steering decisions are throttled; all clocks, movement, firing, and collisions still run every step.
      const decide = distance < 1250 || ((w.tick + e.id) & 1) === 0;
      if (e.type === 'basic') {
        if (decide) {
          const angle = toward + Math.cos(w.elapsed * 0.6 + e.id) * 0.2;
          this.steer(e, Math.cos(angle) * e.speed, Math.sin(angle) * e.speed, dt, 7);
          e.angle = toward;
        }
      } else if (e.type === 'dasher') this.updateDasher(e, toward, distance, dt, decide);
      else if (e.type === 'sniper') this.updateSniper(e, toward, distance, dt, decide);
      else if (e.type === 'sprayer') {
        if (decide) this.steer(e, Math.cos(toward + 0.5) * e.speed, Math.sin(toward + 0.5) * e.speed, dt, 5);
        if (e.cooldown <= EPSILON) { e.cooldown += 10 * STEP; e.angle += 1; this.enemyShoot(e, e.angle, 240, 8, 0x69caff); }
      } else if (e.type === 'minelayer') {
        if (decide) {
          if (e.x < 200 || e.x > WORLD.width - 200 || e.y < 200 || e.y > WORLD.height - 200) e.angle = Math.atan2(WORLD.height / 2 - e.y, WORLD.width / 2 - e.x);
          else e.angle += (this.random.next() - 0.5) * 0.2;
          this.steer(e, Math.cos(e.angle) * e.speed, Math.sin(e.angle) * e.speed, dt, 5);
        }
        if (e.cooldown <= EPSILON) {
          e.cooldown += 2;
          if (!w.bossStage || this.enemyCount - 1 < BALANCE.boss.maxAdds) this.spawnEnemy('mine', e.x, e.y);
          this.emit({ type: 'attack', x: e.x, y: e.y, enemyType: e.type, targetId: e.id });
        }
      } else if (e.type === 'boss') this.updateBoss(e, toward, dt);
      if (w.status !== 'playing') break;
      e.x = clamp(e.x + e.vx * dt, e.radius, WORLD.width - e.radius);
      e.y = clamp(e.y + e.vy * dt, e.radius, WORLD.height - e.radius);
      if (w.status === 'playing' && p.invincible <= EPSILON) {
        const impact = segmentCircleHit(p.prevX - e.prevX, p.prevY - e.prevY, p.x - e.x, p.y - e.y, 0, 0, p.radius + e.radius);
        if (impact !== null) {
          if (e.type === 'mine') this.damageEnemy(e, 99999);
          this.damagePlayer();
        }
      }
    }
  }

  private steer(e: Enemy, vx: number, vy: number, dt: number, response: number): void {
    const alpha = 1 - Math.exp(-response * dt);
    e.vx += (vx - e.vx) * alpha; e.vy += (vy - e.vy) * alpha;
  }

  private updateDasher(e: Enemy, toward: number, distance: number, dt: number, decide: boolean): void {
    if (e.state === 'chase') {
      if (decide) { this.steer(e, Math.cos(toward) * e.speed, Math.sin(toward) * e.speed, dt, 7); e.angle = toward; }
      if (distance < 330 && e.cooldown <= EPSILON) { e.state = 'charge'; e.timer = 40 * STEP; }
    } else if (e.state === 'charge') {
      this.steer(e, 0, 0, dt, 12);
      if (e.timer > 0.12) e.angle = toward;
      e.timer -= dt;
      if (e.timer <= EPSILON) {
        e.state = 'dash'; e.timer = 1;
        e.directionX = Math.cos(e.angle); e.directionY = Math.sin(e.angle);
        this.emit({ type: 'attack', x: e.x, y: e.y, angle: e.angle, enemyType: e.type, targetId: e.id });
      }
    } else if (e.state === 'dash') {
      e.vx = e.directionX * 420; e.vy = e.directionY * 420;
      e.timer -= dt;
      if (e.timer <= EPSILON) { e.state = 'recover'; e.timer = 0.5; }
    } else {
      this.steer(e, 0, 0, dt, 7);
      e.timer -= dt;
      if (e.timer <= EPSILON) { e.state = 'chase'; e.cooldown = 1; }
    }
  }

  private updateSniper(e: Enemy, toward: number, distance: number, dt: number, decide: boolean): void {
    if (e.state === 'aim') {
      this.steer(e, 0, 0, dt, 10);
      if (e.timer > 0.2 + EPSILON) e.angle = toward;
      e.timer -= dt;
      if (e.timer <= EPSILON) {
        this.enemyShoot(e, e.angle, 600, 10, 0xc99dff);
        this.emit({ type: 'attack', x: e.x, y: e.y, enemyType: e.type, targetId: e.id });
        e.state = 'chase'; e.cooldown = 1.35;
      }
    } else {
      if (decide) {
        const forward = distance < 400 ? -e.speed * 1.2 : distance > 500 ? e.speed * 0.8 : 0;
        const strafe = Math.sin(this.state.elapsed * 1.2 + e.id) * 45;
        this.steer(e, Math.cos(toward) * forward - Math.sin(toward) * strafe, Math.sin(toward) * forward + Math.cos(toward) * strafe, dt, 6);
        e.angle = toward;
      }
      if (e.cooldown <= EPSILON) { e.state = 'aim'; e.timer = 0.65; }
    }
  }

  private updateBoss(e: Enemy, toward: number, dt: number): void {
    const b = BALANCE.boss;
    if (e.state === 'laserWarmup') {
      e.vx = e.vy = 0;
      if (e.timer > b.laserLock + EPSILON) e.angle = toward;
      e.timer -= dt;
      if (e.timer <= EPSILON) { e.state = 'laser'; e.timer = b.laserDuration; e.vx = e.vy = 0; }
      return;
    }
    if (e.state === 'laser') {
      e.angle += b.angularSpeed * dt;
      e.timer -= dt;
      const p = this.state.player;
      if (p.invincible <= EPSILON && pointInBeam(p.x, p.y, p.radius, beamGeometry(e.x, e.y, e.angle, b.laserLength, b.laserWidth))) this.damagePlayer();
      if (e.timer <= EPSILON) { e.state = 'recover'; e.timer = b.patternGap; e.laserCooldown = b.laserCooldown; }
      return;
    }
    e.laserCooldown -= dt;
    if (e.laserCooldown <= EPSILON) {
      e.state = 'laserWarmup'; e.timer = b.laserWarning; e.angle = toward; e.vx = e.vy = 0;
      this.emit({ type: 'attack', x: e.x, y: e.y, enemyType: 'boss', text: 'laser', targetId: e.id });
      return;
    }
    this.steer(e, Math.cos(toward) * e.speed, Math.sin(toward) * e.speed, dt, 5);
    e.timer -= dt;
    if (e.state === 'recover') {
      if (e.timer <= EPSILON) { e.state = 'chase'; e.timer = 5; e.cooldown = 0; }
      return;
    }
    if (e.timer <= EPSILON) {
      e.attackIndex = (e.attackIndex + 1) % 3; e.state = 'recover'; e.timer = b.patternGap;
      this.emit({ type: 'attack', x: e.x, y: e.y, enemyType: 'boss', targetId: e.id });
      return;
    }
    if (e.cooldown > EPSILON) return;
    if (e.attackIndex === 0) {
      e.cooldown = 10 * STEP; e.angle += 0.48;
      for (let i = 0; i < 3; i++) this.enemyShoot(e, e.angle + i * TAU / 3, 300, 10, 0xffcb69);
    } else if (e.attackIndex === 1) {
      e.cooldown = 1;
      for (let i = 0; i < 12; i++) this.enemyShoot(e, i * TAU / 12 + this.state.elapsed * 0.12, 360, 12, 0xff6584);
    } else {
      e.cooldown = 20 * STEP;
      for (let i = -1; i <= 1; i++) this.enemyShoot(e, toward + i * 0.3, 360, 12, 0xf096ff);
    }
  }

  private enemyShoot(e: Enemy, angle: number, speed: number, radius: number, color: number): void {
    const bullet = this.addBullet(e.x, e.y, angle, speed, 'enemy', 1, radius, color);
    if (bullet) this.emit({ type: 'enemyShot', x: e.x, y: e.y, color, angle, enemyType: e.type });
  }

  private addBullet(x: number, y: number, angle: number, speed: number, owner: Bullet['owner'], damage: number, radius: number, color: number,
    kind: Bullet['kind'] = 'normal', remainingHits = 1, homing = false, lockRange = 0): Bullet | null {
    const cap = owner === 'enemy' ? BALANCE.limits.bullets - BALANCE.limits.playerReserve : BALANCE.limits.bullets;
    if (this.state.bullets.length >= cap) return null;
    const b = this.bulletPool.acquire();
    b.id = this.nextId++; b.x = b.prevX = x; b.y = b.prevY = y;
    b.vx = Math.cos(angle) * speed; b.vy = Math.sin(angle) * speed;
    b.owner = owner; b.damage = damage; b.radius = radius; b.color = color; b.speed = speed;
    // All straight bullets can cross the complete world. Homing bullets have finite lifetime.
    b.life = homing ? (kind === 'burst' ? 5 : 3) : Infinity;
    b.homing = homing; b.lockRange = lockRange; b.targetId = null; b.remainingHits = remainingHits; b.kind = kind;
    b.hitIds.clear();
    this.state.bullets.push(b);
    return b;
  }

  private rebuildGrid(): void {
    this.grid.clear(); this.maxEnemyRadius = this.maxEnemyMotion = 0;
    for (const e of this.state.enemies) if (e.hp > 0) {
      this.grid.insert(e);
      this.maxEnemyRadius = Math.max(this.maxEnemyRadius, e.radius);
      this.maxEnemyMotion = Math.max(this.maxEnemyMotion, Math.abs(e.x - e.prevX), Math.abs(e.y - e.prevY));
    }
  }

  private nearestEnemy(x: number, y: number, range: number, excluded?: Set<number>): Enemy | null {
    this.grid.query(x - range - this.maxEnemyRadius, y - range - this.maxEnemyRadius, x + range + this.maxEnemyRadius, y + range + this.maxEnemyRadius, this.candidates);
    let closest: Enemy | null = null, best = range * range;
    for (const e of this.candidates) {
      if (e.hp <= 0 || excluded?.has(e.id)) continue;
      const distance = Math.max(0, Math.hypot(e.x - x, e.y - y) - e.radius);
      if (distance * distance <= best) { best = distance * distance; closest = e; }
    }
    return closest;
  }

  private separateEnemies(dt: number): void {
    for (const e of this.state.enemies) {
      if (e.hp <= 0 || e.type === 'mine' || e.type === 'boss') continue;
      const range = e.radius + this.maxEnemyRadius;
      this.grid.query(e.x - range, e.y - range, e.x + range, e.y + range, this.candidates);
      for (const other of this.candidates) {
        if (other.id <= e.id || other.hp <= 0 || other.type === 'mine' || other.type === 'boss') continue;
        const dx = e.x - other.x, dy = e.y - other.y, distance = Math.hypot(dx, dy), overlap = e.radius + other.radius - distance;
        if (overlap <= 0) continue;
        const force = Math.min(overlap * 0.3, 50 * dt), nx = distance > EPSILON ? dx / distance : Math.cos(e.id), ny = distance > EPSILON ? dy / distance : Math.sin(e.id);
        e.x = clamp(e.x + nx * force, e.radius, WORLD.width - e.radius); e.y = clamp(e.y + ny * force, e.radius, WORLD.height - e.radius);
        other.x = clamp(other.x - nx * force, other.radius, WORLD.width - other.radius); other.y = clamp(other.y - ny * force, other.radius, WORLD.height - other.radius);
      }
    }
  }

  private updateBullets(dt: number): void {
    const bullets = this.state.bullets, p = this.state.player;
    let keep = 0;
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      // Preserve unprocessed objects for terminal cleanup without moving or resolving them.
      if (this.state.status !== 'playing') { bullets[keep++] = b; continue; }
      b.prevX = b.x; b.prevY = b.y;
      if (b.homing) {
        let target = b.targetId === null ? null : this.byId.get(b.targetId) ?? null;
        if (target && (target.hp <= 0 || b.hitIds.has(target.id) || Math.hypot(target.x - b.x, target.y - b.y) > b.lockRange + target.radius)) target = null;
        if (!target && ((this.state.tick + b.id) % 4 === 0 || b.targetId !== null)) target = this.nearestEnemy(b.x, b.y, b.lockRange, b.hitIds);
        b.targetId = target?.id ?? null;
        if (target) {
          const angle = Math.atan2(b.vy, b.vx), desired = Math.atan2(target.y - b.y, target.x - b.x);
          const turned = angle + clamp(angleDelta(angle, desired), -5 * dt, 5 * dt);
          b.vx = Math.cos(turned) * b.speed; b.vy = Math.sin(turned) * b.speed;
        }
      }
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let dead = b.life <= 0;
      if (!dead && b.owner === 'player') {
        const padding = this.maxEnemyRadius + this.maxEnemyMotion + b.radius;
        this.grid.query(Math.min(b.prevX, b.x) - padding, Math.min(b.prevY, b.y) - padding, Math.max(b.prevX, b.x) + padding, Math.max(b.prevY, b.y) + padding, this.candidates);
        this.impacts.length = 0;
        for (const e of this.candidates) {
          if (e.hp <= 0 || b.hitIds.has(e.id)) continue;
          const time = segmentCircleHit(b.prevX - e.prevX, b.prevY - e.prevY, b.x - e.x, b.y - e.y, 0, 0, b.radius + e.radius);
          if (time !== null) this.impacts.push({ enemy: e, time });
        }
        this.impacts.sort((a, c) => a.time - c.time || a.enemy.id - c.enemy.id);
        for (const impact of this.impacts) {
          if (impact.enemy.hp <= 0) continue;
          b.hitIds.add(impact.enemy.id);
          this.damageEnemy(impact.enemy, b.damage);
          b.remainingHits--;
          if (b.remainingHits <= 0) { dead = true; break; }
          if (this.state.status !== 'playing') break;
        }
      } else if (!dead && b.owner === 'enemy' && this.state.status === 'playing' && p.invincible <= EPSILON) {
        if (segmentCircleHit(b.prevX - p.prevX, b.prevY - p.prevY, b.x - p.x, b.y - p.y, 0, 0, b.radius + p.radius) !== null) {
          this.damagePlayer(); dead = true;
        }
      }
      dead ||= b.x < -b.radius || b.y < -b.radius || b.x > WORLD.width + b.radius || b.y > WORLD.height + b.radius;
      if (dead) this.bulletPool.release(b); else bullets[keep++] = b;
    }
    bullets.length = keep;
  }

  damageEnemy(enemy: Enemy, amount: number): void {
    if (this.state.status !== 'playing' || enemy.hp <= 0 || amount <= 0) return;
    const damage = enemy.type === 'dasher' && enemy.state === 'charge' ? Math.ceil(amount * 1.3) : amount;
    enemy.hp = Math.max(0, enemy.hp - damage); enemy.hitTime = 0.09;
    this.emit({ type: 'hit', x: enemy.x, y: enemy.y, amount: damage, targetId: enemy.id, enemyType: enemy.type, color: ENEMIES[enemy.type].color });
    if (enemy.type === 'boss' && enemy.hp < enemy.maxHp * 0.3 && !enemy.lowHpSpoken) {
      enemy.lowHpSpoken = true; this.emit({ type: 'bossLow', x: enemy.x, y: enemy.y, enemyType: 'boss', targetId: enemy.id });
    }
    if (enemy.hp > 0) return;
    this.byId.delete(enemy.id); this.enemyCount--; if (enemy.type === 'mine') this.mineCount--;
    this.state.kills++;
    this.emit({ type: 'kill', x: enemy.x, y: enemy.y, enemyType: enemy.type, targetId: enemy.id, color: ENEMIES[enemy.type].color, amount: enemy.radius });
    if (enemy.type !== 'mine') this.state.score += Math.round(enemy.maxHp * 10);
    if (enemy.type === 'boss') {
      this.state.bossStage = this.state.bossPending = false;
      if (this.state.mode === 'story') {
        this.state.status = 'complete'; this.state.pendingWave = 0;
        this.emit({ type: 'complete', x: enemy.x, y: enemy.y, amount: this.state.score });
      } else {
        this.state.wave = this.state.pendingWave || this.state.wave + 1;
        this.state.pendingWave = 0; this.state.waveTime = 0; this.state.spawnTimer = 1;
        this.emit({ type: 'wave', x: enemy.x, y: enemy.y, amount: this.state.wave });
      }
    } else if (enemy.type !== 'mine') this.dropLoot(enemy);
  }

  private damagePlayer(): void {
    const p = this.state.player;
    if (p.invincible > EPSILON || this.state.status !== 'playing') return;
    p.hp = Math.max(0, p.hp - 1); p.invincible = BALANCE.player.hitInvincible;
    let loss = Math.max(1, Math.floor(xpNeeded(p.level) * BALANCE.xp.loss));
    const before = p.level;
    while (loss > p.xp && p.level > 1) { loss -= p.xp; p.level--; p.xp = xpNeeded(p.level); }
    p.xp = Math.max(0, p.xp - loss);
    this.emit({ type: 'damage', x: p.x, y: p.y, amount: 1, color: 0xff6584 });
    this.emit({ type: 'leveldown', x: p.x, y: p.y, amount: p.level, text: p.level < before ? 'LEVEL DOWN' : 'XP LOST' });
    if (p.hp <= 0) { this.state.status = 'failed'; this.emit({ type: 'failure', x: p.x, y: p.y, amount: this.state.score }); }
  }

  private dropLoot(enemy: Enemy): void {
    const drop = BALANCE.drops;
    let type: PickupType = 'xp';
    if (this.random.next() < drop.blackHole) type = 'blackHole';
    else if (this.random.next() < (enemy.type === 'minelayer' ? drop.minelayerAmmo : drop.ammo)) type = 'ammo';
    else if ((enemy.type === 'dasher' || enemy.type === 'sniper') && this.random.next() < drop.coolant) type = 'coolant';
    else if (this.random.next() < drop.bomb) type = 'bomb';
    else if (this.random.next() < drop.miniBomb) type = 'miniBomb';
    else if (this.random.next() < drop.hp) type = 'hp';
    this.addPickup(type, enemy.x, enemy.y, type === 'xp' ? BALANCE.xp.pickup : 1);
  }

  private addPickup(type: PickupType, x: number, y: number, value: number): void {
    // Spatial aggregation bounds long-session loot growth and never discards rewards.
    const cell = BALANCE.limits.pickupCells;
    const cellX = Math.floor(x / cell), cellY = Math.floor(y / cell);
    const existing = this.state.pickups.find(p => p.type === type && Math.floor(p.x / cell) === cellX && Math.floor(p.y / cell) === cellY);
    if (existing) { existing.value += value; return; }
    this.state.pickups.push({ id: this.nextId++, type, x, y, value, age: 0 });
  }

  private updatePickups(dt: number): void {
    const w = this.state, p = w.player;
    let keep = 0;
    for (const pickup of w.pickups) {
      pickup.age += dt;
      const distance = Math.hypot(p.x - pickup.x, p.y - pickup.y), blackHole = w.blackHoleTime > 0;
      const range = blackHole ? 6000 : 150;
      if (distance < range) {
        const pull = 1 - Math.exp(-(blackHole ? 18 : 6.3) * dt);
        pickup.x += (p.x - pickup.x) * pull; pickup.y += (p.y - pickup.y) * pull;
      }
      const inReach = Math.hypot(p.x - pickup.x, p.y - pickup.y) <= (blackHole ? 40 : 24);
      if (!inReach || !this.collectPickup(pickup)) w.pickups[keep++] = pickup;
    }
    w.pickups.length = keep;
  }

  /** Returns true only when every stored reward has actually been redeemed. */
  private collectPickup(pickup: Pickup): boolean {
    const p = this.state.player, value = pickup.value;
    let consumed = value;
    if (pickup.type === 'xp') {
      this.gainXp(value);
    } else if (pickup.type === 'support') {
      if (!Number.isFinite(value) || value <= 0) return true;
      const units = Math.floor(value);
      if (units === 0) return true;
      const deployed = Math.min(units, Math.max(0, BALANCE.companion.max - this.state.companions.length));
      for (let i = 0; i < deployed; i++) this.deployCompanion();
      this.gainXp((units - deployed) * BALANCE.companion.surplusXp);
    } else if (pickup.type === 'hp') {
      consumed = Math.min(value, p.maxHp - p.hp);
      if (consumed <= 0) return false;
      p.hp += consumed;
    }
    else if (pickup.type === 'bomb') p.bombs += value;
    else if (pickup.type === 'ammo') {
      if (p.ammo >= BALANCE.ammo.max - EPSILON) return false;
      consumed = 1; p.ammo = BALANCE.ammo.max;
    } else if (pickup.type === 'coolant') {
      if (p.heat <= EPSILON && p.heatLock <= EPSILON && !p.overheated) return false;
      consumed = 1; p.heat = p.heatLock = 0; p.overheated = false;
    }
    else if (pickup.type === 'blackHole') this.state.blackHoleTime += 3 * value;
    else if (pickup.type === 'miniBomb') {
      consumed = Math.min(value, 4, Math.floor((BALANCE.limits.bullets - this.state.bullets.length) / 25));
      if (consumed <= 0) return false;
      const count = 25 * consumed;
      for (let i = 0; i < count; i++) this.addBullet(p.x, p.y, i * TAU / count, 600, 'player', BALANCE.weapon.damage, 6, 0xffbb55, 'burst', 1, true, 1000);
    }
    pickup.value -= consumed;
    this.emit({ type: 'pickup', x: p.x, y: p.y, pickupType: pickup.type, amount: consumed, color: PICKUP_COLORS[pickup.type] });
    return pickup.value <= EPSILON;
  }

  private gainXp(value: number): void {
    const p = this.state.player;
    p.xp += value;
    while (p.level < BALANCE.xp.cap && p.xp >= xpNeeded(p.level)) {
      p.xp -= xpNeeded(p.level); p.level++;
      this.emit({ type: 'levelup', x: p.x, y: p.y, amount: p.level, color: 0xffcb69 });
    }
    if (p.level >= BALANCE.xp.cap) p.xp = Math.min(p.xp, xpNeeded(p.level));
  }

  private pruneEnemies(): void {
    let keep = 0;
    for (const e of this.state.enemies) if (e.hp > 0) this.state.enemies[keep++] = e;
    this.state.enemies.length = keep;
  }

  private clearCombat(): void {
    this.state.enemies.length = 0;
    for (const b of this.state.bullets) this.bulletPool.release(b);
    this.state.bullets.length = 0;
    this.state.indicators.length = 0;
    this.state.beams.length = 0;
    this.byId.clear(); this.grid.clear();
    this.enemyCount = this.mineCount = 0;
  }

  private maintainStressBullets(): void {
    const p = this.state.player;
    while (this.state.bullets.length > 1200) this.bulletPool.release(this.state.bullets.pop()!);
    while (this.state.bullets.length < 1200) {
      const angle = this.random.next() * TAU;
      this.addBullet(p.x + (this.random.next() - 0.5) * 1450, p.y + (this.random.next() - 0.5) * 780, angle, 240, 'enemy', 1, 6, this.state.bullets.length % 2 ? 0xff6584 : 0xffcb69);
    }
  }

  /** Stress-only cap override: 180 non-mine enemies + 70 mines; maintain 1,200 bullets. */
  debugStress(): void {
    this.reset('endless', 20260911);
    this.stressMode = true;
    const p = this.state.player;
    p.invincible = 1e9; p.level = 10;
    const types: EnemyType[] = ['basic', 'dasher', 'sniper', 'sprayer', 'minelayer'];
    for (let i = 0; i < 250; i++) {
      const angle = i * 2.399963229728653, radius = 180 + Math.sqrt(i / 250) * 500;
      const e = this.spawnEnemy(i < 70 ? 'mine' : types[i % types.length], p.x + Math.cos(angle) * radius, p.y + Math.sin(angle) * radius);
      if (e) { e.hp = e.maxHp = 1e9; }
    }
    this.maintainStressBullets();
    this.queuedEvents.length = 0;
  }
}
