import { BALANCE, ENEMIES, STEP, VIEW, WORLD, xpNeeded } from './config';
import { difficultyConfig } from './difficulty';
import { createMiniBossBrain, updateMiniBossAi } from './miniboss-ai';
import { angleDelta, beamGeometry, clamp, normalize, pointInBeam, SeededRandom, segmentCircleHit, SpatialGrid, TAU } from './math';
import { ObjectPool } from './pool';
import { enemyAttacks, updateEnemyAi, interruptEnemy, cancelEnemyAttack, refreshWeakpoint } from './enemy-ai';
import { ThreatDirector, isTacticalEnemy, type AttackIntent } from './threat-director';
import { advanceProjectileMotion } from './projectile-motion';
import { CampaignDirector, CAMPAIGN_STAGES, ENEMY_INTRODUCTIONS, ENCOUNTERS, type CampaignAction, type EncounterId } from './campaign';
import { createBuild, offerModules, chooseModule, buildDamageMultiplier, addResonanceXp, RESONANCE, moduleRank, hasEvolution, enqueueUpgrade, rerollModules, MODULES, MODULE_VALUES, EVOLUTION_VALUES } from './upgrades';
import { createSpellBrain, spellCardDefinition, advanceSpellCard, updateSpellBoss } from './spellcards';
import { createSeason2Brain, updateSeason2Ai, shieldDamageMultiplier, breakShield, onSeason2Death, type Season2AiContext } from './season2-ai';
import type { AreaHazard, Bullet, CombatEvent, Companion, Difficulty, Enemy, EnemyShotOptions, EnemyType, InputAction, ModuleId, ModuleState, Pickup, PickupType, Player, ProjectileMotionPhase, RunStartOptions, WorldState, UpgradeChoiceId, EvolutionId } from './types';

const EPSILON = 1e-8;
const PICKUP_COLORS: Record<PickupType, number> = { xp: 0x73f7eb, hp: 0xa6f1aa, bomb: 0xffcb69, supply: 0x69ffc0, coolant: 0x69caff, miniBomb: 0xffbb55, blackHole: 0xbb88ff, support: 0x9ceaff };
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
  private grazeRefund = 0;
  private markRetarget = 0;
  private introductionUntil = 0;
  private introducedTypes = new Set<EnemyType>(['basic']);
  private pendingEncounterCleanup = false;
  private dashStart = { x: 0, y: 0 };
  private ricochetTimer = 0;
  private rearTimer = 0;
  private bloomTimer = 0;
  private returnWingTimer = 0;
  private brakeTimer = 0;
  private echoTimer = 0;
  private readonly returnBladeHits = new Map<number, Set<number>>();
  private readonly returningVolley = new Set<number>();
  private dashBuffered = 0;
  private nextEnemyCommit = 0;
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
  private readonly impacts: { enemy: Enemy; time: number; weakpoint?: boolean }[] = [];
  private readonly suppliedWaves = new Set<number>();
  private readonly shotFeedback = new Set<number>();
  private readonly bulletPool = new ObjectPool(emptyBullet, bullet => bullet.hitIds.clear(), BALANCE.limits.bullets);
  private director!: CampaignDirector;
  private readonly threats = new ThreatDirector();
  private focusTime = 0;
  private dashStock = 1;
  private doubleDashActive = false;
  private shatterTimer = 0;
  private burstTimer = 0;
  private burstHits = 0;
  private ventTimer = 0;
  private reserveTimer = 0;
  private interceptTimer = 0;
  private grazeWindow = 0;
  private grazeCount = 0;
  private reviveUsed = false;
  private magnetTimer = 0;
  private magnetTime = 0;
  private readonly bladeTimes = new Map<number, number>();
  private readonly scaledPrograms = new WeakMap<readonly ProjectileMotionPhase[], Partial<Record<Difficulty, readonly ProjectileMotionPhase[]>>>();
  private pendingCardClear: { sources: Set<number>; tick: number } | null = null;

  constructor(seed = 12345, difficulty: Difficulty = 'normal') { this.seed = seed; this.reset('story', seed, difficulty); }

  reset(mode: 'story' | 'endless' = 'story', seed = this.seed, difficulty: Difficulty = this.state?.difficulty ?? 'normal', options?: Partial<RunStartOptions>): void {
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
    this.shotFeedback.clear();
    this.previousDash = this.previousBomb = false;
    this.grazeRefund = this.markRetarget = this.introductionUntil = 0;
    this.ricochetTimer = this.rearTimer = this.bloomTimer = this.returnWingTimer = this.brakeTimer = this.echoTimer = 0;
    this.introducedTypes = new Set(['basic']); this.pendingEncounterCleanup = false; this.returnBladeHits.clear(); this.returningVolley.clear();
    this.dashBuffered = 0;
    this.nextEnemyCommit = 0;
    this.specialWindup = 0;
    this.specialTarget = null;
    this.enemyCount = this.mineCount = 0;
    this.stressMode = false;
    this.focusTime = this.shatterTimer = this.burstTimer = this.burstHits = this.ventTimer = this.reserveTimer = this.interceptTimer = this.grazeWindow = this.grazeCount = this.magnetTimer = this.magnetTime = 0;
    this.dashStock = 1; this.doubleDashActive = this.reviveUsed = false; this.bladeTimes.clear(); this.pendingCardClear = null;
    const season = 's1';
    this.director = new CampaignDirector();
    this.threats.reset();
    const x = WORLD.width / 2, y = WORLD.height / 2;
    const player: Player = { x, y, prevX: x, prevY: y, vx: 0, vy: 0, radius: BALANCE.player.radius,
      hp: BALANCE.player.hp, maxHp: BALANCE.player.hp, bombs: BALANCE.player.bombs, level: 1, xp: 0,
      heat: 0, angle: -Math.PI / 2, invincible: 1, dashTime: 0, dashCooldown: 0,
      commandTargetId: null, commandTime: 0, commandCooldown: 0, markTargetId: null, markTime: 0,
      dashVx: 0, dashVy: 0, perfectWindow: 0, shotCooldown: 0, specialCooldown: 0, idleTime: 0,
      heatLock: 0, overheated: false, focus: false };
    this.state = { status: 'playing', mode, difficulty: options?.difficulty ?? difficulty, minibossSpawned: false, minibossDefeated: false, elapsed: 0, tick: 0, score: 0, kills: 0, wave: mode === 'endless' ? CAMPAIGN_STAGES.length + 1 : 1,
      waveTime: 0, spawnTimer: 0.6, bossStage: false, bossPending: false, pendingWave: 0,
      blackHoleTime: 0, player, camera: { x, y, prevX: x, prevY: y }, enemies: [], bullets: [], pickups: [], indicators: [], companions: [], beams: [], hazards: [],
      seasonId: season, campaign: this.director.state, build: createBuild(), arena: null, playerAreas: [] };
    if (mode === 'story') this.handleCampaignActions(this.director.start());
  }

  /** Edge history is reset on pause/blur so a new physical press resumes cleanly. */
  clearInput(): void { this.previousDash = this.previousBomb = false; this.dashBuffered = 0; this.state.player.focus = false; this.focusTime = 0; }

  continueEndless(): void {
    if (this.state.status !== 'complete') return;
    this.state.mode = 'endless';
    this.state.status = 'playing';
    this.state.wave = CAMPAIGN_STAGES.length + 1;
    this.state.waveTime = 0;
    this.state.spawnTimer = 1;
    this.state.bossStage = this.state.bossPending = false;
    this.state.pendingWave = 0;
    this.state.arena = null;
    this.clearCombat();
    const player = this.state.player;
    player.hp = player.maxHp;
    player.heat = player.heatLock = 0;
    player.overheated = false;
    player.invincible = 2;
    player.dashTime = player.shotCooldown = 0;
    this.clearInput();
    this.specialWindup = 0;
    this.specialTarget = null;
    this.emit({ type: 'wave', x: player.x, y: player.y, amount: this.state.wave });
    this.openUpgrade();
  }

  step(input: InputAction, dt = STEP): CombatEvent[] {
    this.events = this.queuedEvents;
    this.queuedEvents = [];
    if (this.state.status !== 'playing' || dt <= 0 || !Number.isFinite(dt)) return this.events;
    this.stepping = true;
    this.shotFeedback.clear();
    const world = this.state;
    world.tick++;
    world.elapsed += dt;
    this.threats.update(world.elapsed, world.enemies);
    world.blackHoleTime = Math.max(0, world.blackHoleTime - dt);
    this.updateBeams(dt);
    this.rebuildGrid();
    this.updatePlayer(input, dt);
    if (world.status === 'playing') this.updatePlayerAreas(dt);
    if (world.status === 'playing') this.updateHazards(dt);
    if (world.status === 'playing') {
      if (!this.stressMode) this.updateWaves(dt);
      if (world.status === 'playing') this.updateEnemies(dt);
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
    this.flushCardCleanup();
    if (this.pendingEncounterCleanup) { this.pendingEncounterCleanup = false; this.clearCombat(); this.state.arena = null; this.settlePickups(); }
    this.pruneEnemies();
    const camera = world.camera, player = world.player;
    camera.prevX = camera.x; camera.prevY = camera.y;
    camera.x = world.arena ? world.arena.x + VIEW.width / 2 : clamp(player.x, VIEW.width / 2, WORLD.width - VIEW.width / 2);
    camera.y = world.arena ? world.arena.y + VIEW.height / 2 : clamp(player.y, VIEW.height / 2, WORLD.height - VIEW.height / 2);
    if (world.status === 'failed' || world.status === 'complete') { this.clearCombat(); if (world.status === 'complete') this.settlePickups(); }
    else if (world.status === 'playing') this.openUpgrade();
    this.stepping = false;
    return this.events;
  }

  private emit(event: CombatEvent): void { (this.stepping ? this.events : this.queuedEvents).push(event); }

  private updatePlayer(input: InputAction, dt: number): void {
    const p = this.state.player;
    for (const key of ['shatterTimer', 'burstTimer', 'ventTimer', 'reserveTimer', 'interceptTimer', 'magnetTimer', 'magnetTime', 'ricochetTimer', 'rearTimer', 'bloomTimer', 'returnWingTimer', 'brakeTimer', 'echoTimer', 'markRetarget'] as const) this[key] = Math.max(0, this[key] - dt);
    this.grazeWindow += dt;
    if (this.grazeWindow >= 1) { this.grazeWindow %= 1; this.grazeCount = 0; }
    if (this.has('magnet') && this.magnetTimer <= EPSILON) { this.magnetTimer = this.value('magnet', MODULE_VALUES.magnet.cooldown); this.magnetTime = MODULE_VALUES.magnet.duration; this.moduleEvent('magnet'); }
    if (this.has('reserveAmmo') && p.heat >= MODULE_VALUES.reserveAmmo.threshold && this.reserveTimer <= EPSILON) { p.heat = Math.max(0, p.heat - this.value('reserveAmmo', MODULE_VALUES.reserveAmmo.heat)); this.reserveTimer = MODULE_VALUES.reserveAmmo.cooldown; this.moduleEvent('reserveAmmo'); }
    p.prevX = p.x; p.prevY = p.y;
    p.focus = !!input.focus;
    this.focusTime = p.focus ? this.focusTime + dt : 0;
    this.dashBuffered = Math.max(0, this.dashBuffered - dt);
    p.invincible = Math.max(0, p.invincible - dt);
    p.shotCooldown = Math.max(0, p.shotCooldown - dt);
    p.specialCooldown = Math.max(0, p.specialCooldown - dt);
    p.markTime = Math.max(0, (p.markTime ?? 0) - dt);
    if (p.markTime <= EPSILON || !this.byId.has(p.markTargetId ?? -1)) { p.markTargetId = null; p.markTime = 0; }
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    if (this.has('doubleDash')) {
      if (!this.doubleDashActive) { this.doubleDashActive = true; this.dashStock = p.dashCooldown > EPSILON ? 1 : 2; }
      if (p.dashCooldown <= EPSILON && this.dashStock < 2) { this.dashStock++; this.grazeRefund = 0; p.dashCooldown = this.dashStock < 2 ? this.dashRecharge : 0; }
    }
    p.perfectWindow = Math.max(0, p.perfectWindow - dt);
    p.heatLock = Math.max(0, p.heatLock - dt);
    const aimX = input.aimX - p.x, aimY = input.aimY - p.y;
    if (Math.hypot(aimX, aimY) > EPSILON) p.angle = Math.atan2(aimY, aimX);
    const direction = normalize(input.moveX, input.moveY);
    const charged = this.has('doubleDash') ? this.dashStock > 0 : p.dashCooldown <= EPSILON;
    if (input.dash && !this.previousDash && (charged || p.dashCooldown <= BALANCE.dash.inputBuffer + EPSILON)) this.dashBuffered = BALANCE.dash.inputBuffer;
    if (this.dashBuffered > 0 && charged && p.dashTime <= EPSILON) {
      this.dashBuffered = 0;
      this.dashStart = { x: p.x, y: p.y }; p.perfectWindow = 0;
      const dash = direction.x || direction.y ? direction : { x: Math.cos(p.angle), y: Math.sin(p.angle) };
      p.dashVx = dash.x * BALANCE.dash.speed; p.dashVy = dash.y * BALANCE.dash.speed;
      p.dashTime = BALANCE.dash.duration;
      if (this.has('doubleDash')) { this.dashStock--; if (p.dashCooldown <= EPSILON) { p.dashCooldown = this.dashRecharge; this.grazeRefund = 0; } }
      else { p.dashCooldown = this.dashRecharge; this.grazeRefund = 0; }
      this.emit({ type: 'dash', x: p.x, y: p.y, angle: Math.atan2(dash.y, dash.x), color: 0x73f7eb });
    }
    this.previousDash = input.dash;
    const dashDelta = Math.min(dt, p.dashTime);
    if (dashDelta > 0) {
      p.invincible = Math.max(p.invincible, p.dashTime);
      p.x += p.dashVx * dashDelta; p.y += p.dashVy * dashDelta;
      p.dashTime = Math.max(0, p.dashTime - dt);
      if (p.dashTime <= EPSILON) {
        p.dashTime = 0; p.perfectWindow = BALANCE.dash.window;
        if (this.has('vent') && this.ventTimer <= EPSILON) { p.heat = Math.max(0, p.heat - this.value('vent', MODULE_VALUES.vent.heat)); this.ventTimer = MODULE_VALUES.vent.cooldown; this.moduleEvent('vent'); }
        this.createDashEcho();
      }
    }
    const moveSpeed = p.focus ? BALANCE.player.focusSpeed : BALANCE.player.speed;
    p.vx = dashDelta > 0 ? p.dashVx : direction.x * moveSpeed;
    p.vy = dashDelta > 0 ? p.dashVy : direction.y * moveSpeed;
    const arena = this.state.arena ?? { x: 0, y: 0, width: WORLD.width, height: WORLD.height };
    p.x = clamp(p.x + direction.x * moveSpeed * (dt - dashDelta), arena.x + p.radius, arena.x + arena.width - p.radius);
    p.y = clamp(p.y + direction.y * moveSpeed * (dt - dashDelta), arena.y + p.radius, arena.y + arena.height - p.radius);
    if (input.bomb && !this.previousBomb && p.bombs > 0) this.useBomb();
    this.previousBomb = input.bomb;
    if (this.state.status !== 'playing') return;
    const beamReady = input.shoot && p.dashTime <= EPSILON && p.perfectWindow > EPSILON;
    if (beamReady) {
      this.fireDashBeam();
      p.shotCooldown = BALANCE.weapon.intervals[clamp(p.level, 1, 10) - 1] * STEP;
      p.idleTime = 0;
      if (this.state.status !== 'playing') return;
    }
    const firing = input.shoot && !p.overheated;
    if (firing && !beamReady) {
      p.idleTime = 0;
      if (p.shotCooldown <= EPSILON) this.playerShoot();
      p.heat = Math.min(BALANCE.heat.max, p.heat + BALANCE.heat.rate * dt);
      if (p.heat >= BALANCE.heat.max - EPSILON) { p.heat = BALANCE.heat.max; p.overheated = true; p.heatLock = BALANCE.heat.lock; }
    } else if (!beamReady) {
      const previousIdle = p.idleTime;
      p.idleTime += dt;
      const coolDelta = Math.max(0, p.idleTime - Math.max(previousIdle, BALANCE.heat.delay));
      p.heat = Math.max(0, p.heat - BALANCE.heat.cooling * coolDelta);
    }
    if (p.overheated && p.heatLock <= EPSILON && p.heat <= BALANCE.heat.unlock + EPSILON) p.overheated = false;
    if (this.has('brakeField') && this.focusTime >= MODULE_VALUES.brakeField.hold - EPSILON && this.brakeTimer <= EPSILON) {
      this.brakeTimer = MODULE_VALUES.brakeField.cooldown; this.addPlayerArea('brake', p.x, p.y, this.value('brakeField', MODULE_VALUES.brakeField.radius), 0, 0.8, 0, this.value('brakeField', MODULE_VALUES.brakeField.slow)); this.moduleEvent('brakeField');
    }
    if (firing && !beamReady) this.shootPassiveModules();
    this.updateSpecial(dt);
  }

  private playerShoot(): void {
    const p = this.state.player, lv = clamp(p.level, 1, BALANCE.xp.cap) - 1;
    const baseCount = BALANCE.weapon.counts[lv], needle = this.evolved('needleArray') && p.focus;
    const count = needle ? 1 : baseCount;
    if (this.state.bullets.length + count > BALANCE.limits.bullets) return;
    p.shotCooldown = BALANCE.weapon.intervals[lv] * STEP;
    const color = p.level >= 10 ? 0xffcb69 : p.level >= 7 ? 0xc99dff : p.level >= 4 ? 0x69baff : 0x73f7eb;
    const damage = BALANCE.weapon.damage * buildDamageMultiplier(this.state.build, this.focusTime >= MODULE_VALUES.precision.hold - EPSILON);
    for (let i = 0; i < count; i++) {
      const angle = p.angle + (i - (count - 1) / 2) * BALANCE.weapon.spreads[lv] * (p.focus ? BALANCE.player.focusSpread : 1);
      this.addBullet(p.x, p.y, angle, needle ? 1500 : BALANCE.weapon.speeds[lv], 'player', damage * (needle ? baseCount : 1),
        p.level >= 10 ? 6 : 4, color, 'normal', needle ? EVOLUTION_VALUES.needleArray.targets : (p.level >= 10 ? 2 : 1) + moduleRank(this.state.build, 'piercing'), !needle && p.level >= 7, BALANCE.weapon.homingRange);
    }
    if (this.has('wingShots')) for (const side of [-1, 1]) this.addBullet(p.x - Math.sin(p.angle) * side * 22, p.y + Math.cos(p.angle) * side * 22,
      p.angle, BALANCE.weapon.speeds[lv], 'player', this.value('wingShots', MODULE_VALUES.wingShots.damage) * buildDamageMultiplier(this.state.build), 4, 0x9be6ff, 'module');
    this.emit({ type: 'shot', x: p.x + Math.cos(p.angle) * 30, y: p.y + Math.sin(p.angle) * 30, angle: p.angle, color: 0x73f7eb, amount: BALANCE.weapon.damage });
  }

  private fireDashBeam(): void {
    const p = this.state.player, dash = BALANCE.dash;
    const beam = beamGeometry(p.x, p.y, p.angle, dash.beamLength, dash.beamWidth);
    p.perfectWindow = 0;
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
      if (this.validCommandTarget(enemy) && pointInBeam(enemy.x, enemy.y, enemy.radius, beam)) {
        this.impacts.push({ enemy, time: (enemy.x - p.x) * dx + (enemy.y - p.y) * dy });
      }
    }
    this.impacts.sort((a, b) => a.time - b.time || a.enemy.id - b.enemy.id);
    const hitIds = new Set<number>();
    for (let i = 0; i < Math.min(dash.targets, this.impacts.length); i++) {
      if (this.state.status !== 'playing') break;
      hitIds.add(this.impacts[i].enemy.id);
      this.damageEnemy(this.impacts[i].enemy, (dash.damage + (i === 0 && p.focus && this.has('prism') ? this.value('prism', MODULE_VALUES.prism.focusDamage) - dash.damage : 0)) * buildDamageMultiplier(this.state.build), { x: p.x, y: p.y, kind: 'beam', angle: p.angle });
    }
    if (this.has('prism') && !p.focus && this.state.status === 'playing') for (const side of [-1, 1]) {
      const geometry = beamGeometry(p.x, p.y, p.angle + side * 0.14, 1200, 28);
      this.state.beams.push({ id: this.nextId++, x: p.x, y: p.y, angle: geometry.angle, length: 1200, width: 28, life: dash.beamDuration, duration: dash.beamDuration });
      for (const enemy of this.state.enemies) if (enemy.hp > 0 && !hitIds.has(enemy.id) && pointInBeam(enemy.x, enemy.y, enemy.radius, geometry)) {
        hitIds.add(enemy.id); this.damageEnemy(enemy, this.value('prism', MODULE_VALUES.prism.sideDamage) * buildDamageMultiplier(this.state.build), { x: p.x, y: p.y, kind: 'prism' });
      }
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

  private validCommandTarget(enemy: Enemy): boolean {
    return enemy.hp > 0 && (enemy.disabledUntil ?? 0) <= this.state.elapsed && enemy.spell?.stage !== 'intro';
  }

  private shootPassiveModules(): void {
    const p = this.state.player, multiplier = buildDamageMultiplier(this.state.build);
    if (this.has('rearSpark') && this.rearTimer <= EPSILON) {
      this.rearTimer = MODULE_VALUES.rearSpark.cooldown; this.moduleEvent('rearSpark');
      for (const side of [-1, 1]) {
        const bullet = this.addBullet(p.x, p.y, p.angle + Math.PI + side * 0.16, 720, 'player', this.value('rearSpark', MODULE_VALUES.rearSpark.damage) * multiplier, 4, 0x73f7eb, 'module');
        if (bullet) bullet.life = MODULE_VALUES.rearSpark.range / 720;
      }
    }
    if (this.evolved('spiralBloom') && this.bloomTimer <= EPSILON) {
      this.bloomTimer = EVOLUTION_VALUES.spiralBloom.cooldown;
      for (let i = 0; i < 6; i++) {
        const bullet = this.addBullet(p.x, p.y, p.angle + i * TAU / 6, 700, 'player', 2 * multiplier, 4, 0x73f7eb, 'module');
        if (bullet) bullet.life = 420 / 700;
      }
    }
  }

  private addPlayerArea(kind: 'brake' | 'echo' | 'trail', x: number, y: number, radius: number, warning: number, duration: number, damage: number, slow?: number, endX?: number, endY?: number): void {
    if (this.state.playerAreas.length >= 16) return;
    this.state.playerAreas.push({ id: this.nextId++, kind, x, y, radius, warning, warningDuration: warning, life: duration, duration,
      damage: damage * buildDamageMultiplier(this.state.build), slow, endX, endY, width: kind === 'trail' ? EVOLUTION_VALUES.echoTrail.width : undefined, hitIds: new Set() });
  }

  private createDashEcho(): void {
    if (!this.has('dashEcho') || this.echoTimer > EPSILON) return;
    const p = this.state.player;
    this.echoTimer = MODULE_VALUES.dashEcho.cooldown; this.moduleEvent('dashEcho');
    if (this.evolved('echoTrail')) this.addPlayerArea('trail', this.dashStart.x, this.dashStart.y, EVOLUTION_VALUES.echoTrail.width / 2, 0, EVOLUTION_VALUES.echoTrail.duration, this.value('dashEcho', EVOLUTION_VALUES.echoTrail.damage), undefined, p.x, p.y);
    else this.addPlayerArea('echo', p.x, p.y, this.value('dashEcho', MODULE_VALUES.dashEcho.radius), 0.3, 0.18, this.value('dashEcho', MODULE_VALUES.dashEcho.damage));
  }

  private slowEnemy(enemy: Enemy, amount: number, duration: number): void {
    if (enemy.role !== 'mob' || ['charge', 'dash'].includes(enemy.state)) return;
    if ((enemy.slowUntil ?? 0) <= this.state.elapsed || amount >= (enemy.slowAmount ?? 0)) {
      enemy.slowAmount = amount; enemy.slowUntil = this.state.elapsed + duration;
    }
  }

  private updatePlayerAreas(dt: number): void {
    let keep = 0;
    for (const area of this.state.playerAreas) {
      const waiting = Math.min(dt, Math.max(0, area.warning)); area.warning = Math.max(0, area.warning - dt);
      if (area.warning > EPSILON) { this.state.playerAreas[keep++] = area; continue; }
      area.life -= dt - waiting;
      if (area.life < -EPSILON) continue;
      for (const enemy of this.state.enemies) {
        if (this.state.status !== 'playing') break;
        if (!this.validCommandTarget(enemy)) continue;
        const inside = area.kind === 'trail'
          ? segmentCircleHit(area.x, area.y, area.endX ?? area.x, area.endY ?? area.y, enemy.x, enemy.y, area.radius + enemy.radius) !== null
          : Math.hypot(enemy.x - area.x, enemy.y - area.y) <= area.radius + enemy.radius;
        if (!inside) continue;
        if (area.slow) this.slowEnemy(enemy, area.slow, 0.15);
        if (area.damage > 0 && !area.hitIds.has(enemy.id)) {
          area.hitIds.add(enemy.id); this.damageEnemy(enemy, area.damage, { x: area.x, y: area.y, kind: area.kind });
        }
      }
      if (area.life > EPSILON) this.state.playerAreas[keep++] = area;
    }
    this.state.playerAreas.length = keep;
  }

  private moduleEvent(id: ModuleId): void { this.emit({ type: 'module', moduleId: id, x: this.state.player.x, y: this.state.player.y }); }

  get moduleStates(): ModuleState[] {
    return this.state.build.modules.map(id => {
      const remaining = ({ shatter: this.shatterTimer, droneBurst: this.burstTimer, vent: this.ventTimer, reserveAmmo: this.reserveTimer,
        intercept: this.interceptTimer, magnet: this.magnetTimer, ricochet: this.ricochetTimer, rearSpark: this.rearTimer,
        returnWing: this.returnWingTimer, brakeField: this.brakeTimer, dashEcho: this.echoTimer } as Partial<Record<ModuleId, number>>)[id] ?? 0;
      const active = id === 'precision' && this.focusTime >= MODULE_VALUES.precision.hold || id === 'orbitBlade' && (this.state.player.markTime ?? 0) > 0 || id === 'magnet' && this.magnetTime > 0;
      return { id, remaining, status: id === 'revive' && this.reviveUsed ? 'consumed' : active ? 'active' : remaining > EPSILON ? 'cooldown' : 'ready' };
    });
  }

  /** Apply one supply unit in charge order, carrying spare recovery time into the next stock. */
  private recoverSkills(seconds: number): boolean {
    const p = this.state.player;
    const needed = p.dashCooldown > EPSILON;
    let remaining = seconds;
    while (remaining > EPSILON && p.dashCooldown > EPSILON) {
      const spent = Math.min(remaining, p.dashCooldown);
      remaining -= spent; p.dashCooldown -= spent;
      if (p.dashCooldown <= EPSILON && this.has('doubleDash') && this.dashStock < 2) {
        this.dashStock++; this.grazeRefund = 0;
        p.dashCooldown = this.dashStock < 2 ? this.dashRecharge : 0;
      }
    }
    return needed;
  }

  private updateCompanions(dt: number): void {
    const p = this.state.player, cfg = BALANCE.companion, companions = this.state.companions;
    const marked = (p.markTime ?? 0) > 0 ? this.byId.get(p.markTargetId ?? -1) : undefined;
    const mark = marked && this.validCommandTarget(marked) && Math.hypot(marked.x - p.x, marked.y - p.y) <= this.droneRange + marked.radius ? marked : undefined;
    const assigned = new Set<number>();
    for (let i = 0; i < companions.length; i++) {
      if (this.state.status !== 'playing') break;
      const companion = companions[i], orbit = this.state.elapsed * cfg.orbitSpeed + i * TAU / companions.length;
      companion.prevX = companion.x; companion.prevY = companion.y;
      const bladeTarget = this.has('orbitBlade') ? mark : undefined;
      if ((companion.orbitTargetId ?? null) !== (bladeTarget?.id ?? null)) {
        companion.orbitTargetId = bladeTarget?.id ?? null; companion.transit = 0.25;
        companion.transitX = companion.x; companion.transitY = companion.y;
        this.returnBladeHits.delete(companion.id);
        if (!bladeTarget && this.evolved('huntingReturn')) this.returnBladeHits.set(companion.id, new Set());
      }
      const center = bladeTarget ?? p, orbitRadius = bladeTarget ? bladeTarget.radius + 18 : this.has('crossOrbit') ? this.value('crossOrbit', MODULE_VALUES.crossOrbit.radius) : cfg.orbitRadius;
      companion.transit = Math.max(0, (companion.transit ?? 0) - dt);
      const mix = 1 - companion.transit / 0.25;
      const targetX = center.x + Math.cos(orbit) * orbitRadius, targetY = center.y + Math.sin(orbit) * orbitRadius;
      const bounds = this.state.arena ?? { x: 0, y: 0, width: WORLD.width, height: WORLD.height };
      companion.x = clamp((companion.transitX ?? targetX) * (1 - mix) + targetX * mix, bounds.x + companion.radius, bounds.x + bounds.width - companion.radius);
      companion.y = clamp((companion.transitY ?? targetY) * (1 - mix) + targetY * mix, bounds.y + companion.radius, bounds.y + bounds.height - companion.radius);
      companion.vx = (companion.x - companion.prevX) / dt; companion.vy = (companion.y - companion.prevY) / dt;
      const range = this.droneRange;
      const target = this.nearestEnemy(companion.x, companion.y, range, this.has('division') ? assigned : undefined) ?? this.nearestEnemy(companion.x, companion.y, range);
      if (target) assigned.add(target.id);
      companion.targetId = target?.id ?? null;
      companion.angle = target ? Math.atan2(target.y - companion.y, target.x - companion.x) : orbit + Math.PI / 2;
      companion.shotCooldown -= dt;
      if (companion.shotCooldown <= EPSILON) {
        // Keeping each independent phase running while idle prevents a synchronized volley on reacquisition.
        companion.shotCooldown += cfg.interval;
        if (target) {
        if (this.has('returnWing') && this.returnWingTimer <= EPSILON) {
          this.returnWingTimer = this.value('returnWing', MODULE_VALUES.returnWing.cooldown); this.returningVolley.clear();
          for (const item of companions) this.returningVolley.add(item.id);
        }
        const returns = this.returningVolley.delete(companion.id);
        const shot = this.addBullet(companion.x, companion.y, companion.angle, cfg.bulletSpeed, 'player', cfg.damage * buildDamageMultiplier(this.state.build), 4, 0x9ceaff, 'drone', 1, !returns && this.has('droneHoming'), range);
        if (shot) {
          shot.targetId = target.id;
          if (!returns && this.has('droneHoming')) { shot.homingTime = this.value('droneHoming', MODULE_VALUES.droneHoming.duration); shot.turnSpeed = 2; }
          if (returns) { shot.returnOriginX = shot.x; shot.returnOriginY = shot.y; shot.returnAt = 0.4; shot.returning = false; shot.life = 0.8; shot.moduleId = 'returnWing'; }
          this.emit({ type: 'shot', text: 'drone', x: companion.x, y: companion.y, angle: companion.angle, amount: shot.damage, color: 0x9ceaff, targetId: target.id });
        }
        }
      }
      const returnHits = this.returnBladeHits.get(companion.id);
      if (returnHits && !bladeTarget) for (const enemy of this.state.enemies) {
        if (!this.validCommandTarget(enemy) || returnHits.has(enemy.id)) continue;
        if (segmentCircleHit(companion.prevX, companion.prevY, companion.x, companion.y, enemy.x, enemy.y, enemy.radius + 24) === null) continue;
        returnHits.add(enemy.id); this.damageEnemy(enemy, 4 * buildDamageMultiplier(this.state.build), { x: companion.x, y: companion.y, kind: 'huntingReturn' });
      }
      if ((companion.transit ?? 0) <= EPSILON) this.returnBladeHits.delete(companion.id);
      if (this.has('orbitBlade') && (companion.transit ?? 0) <= EPSILON) for (const enemy of this.state.enemies) {
        if (enemy.hp <= 0 || (this.bladeTimes.get(enemy.id) ?? 0) > this.state.elapsed || Math.hypot(companion.x - enemy.x, companion.y - enemy.y) > enemy.radius + 24) continue;
        this.bladeTimes.set(enemy.id, this.state.elapsed + 0.4);
        this.damageEnemy(enemy, this.value('orbitBlade', MODULE_VALUES.orbitBlade.damage) * buildDamageMultiplier(this.state.build), { x: companion.x, y: companion.y, kind: 'blade' });
      }
    }
    if (this.has('intercept') && this.interceptTimer <= EPSILON) {
      let closest: Bullet | null = null, distance = 90;
      for (const bullet of this.state.bullets) if (bullet.owner === 'enemy') {
        const d = Math.hypot(bullet.x - p.x, bullet.y - p.y);
        if (d < distance) { closest = bullet; distance = d; }
      }
      if (closest) { closest.life = 0; this.interceptTimer = this.value('intercept', MODULE_VALUES.intercept.cooldown); this.moduleEvent('intercept'); this.emit({ type: 'hit', x: closest.x, y: closest.y, color: 0x98efff, amount: 0 }); }
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
    if (this.stressMode) return;
    const angle = w.player.angle + Math.PI / 2;
    const x = clamp(w.player.x + Math.cos(angle) * 72, w.player.radius, WORLD.width - w.player.radius);
    const y = clamp(w.player.y + Math.sin(angle) * 72, w.player.radius, WORLD.height - w.player.radius);
    this.addPickup('support', x, y, 1);
    this.emit({ type: 'support', text: 'arrival', x, y, amount: w.companions.length, color: 0x9ceaff });
  }

  private updateSpecial(dt: number): void {
    const p = this.state.player;
    const range = this.has('chain') ? 600 : BALANCE.special.range;
    if (p.level < BALANCE.special.level) { this.specialWindup = 0; this.specialTarget = null; return; }
    if (this.specialWindup > 0) {
      this.specialWindup -= dt;
      if (this.specialWindup <= EPSILON) {
        const target = this.specialTarget === null ? null : this.byId.get(this.specialTarget);
        if (target && target.hp > 0 && Math.hypot(target.x - p.x, target.y - p.y) <= range + target.radius) {
          const angle = Math.atan2(target.y - p.y, target.x - p.x);
          const bullet = this.addBullet(p.x, p.y, angle, BALANCE.special.speed, 'player', BALANCE.special.damage * buildDamageMultiplier(this.state.build), 9, 0xf096ff, 'special', 1, true, range);
          if (bullet) {
            bullet.targetId = target.id; p.specialCooldown = BALANCE.special.cooldown; this.emit({ type: 'shot', x: p.x, y: p.y, color: 0xf096ff, angle, amount: BALANCE.special.damage });
            if (this.evolved('forkNetwork')) {
              const targets = this.state.enemies.filter(e => e.id !== target.id && this.validCommandTarget(e) && Math.hypot(e.x - p.x, e.y - p.y) <= range + e.radius)
                .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y) || a.id - b.id).slice(0, 2);
              for (const other of targets) {
                const extra = this.addBullet(p.x, p.y, Math.atan2(other.y - p.y, other.x - p.x), BALANCE.special.speed, 'player', 6 * buildDamageMultiplier(this.state.build), 7, 0x9be6ff, 'module', 1, true, range);
                if (extra) { extra.targetId = other.id; extra.hitIds.add(target.id); }
              }
            }
          }
        }
        this.specialWindup = 0; this.specialTarget = null;
      }
    } else if (p.specialCooldown <= EPSILON) {
      const target = this.nearestEnemy(p.x, p.y, range);
      if (target) { this.specialTarget = target.id; this.specialWindup = BALANCE.special.windup; }
    }
  }

  private useBomb(): void {
    const p = this.state.player, half = BALANCE.bomb.size / 2;
    p.bombs--;
    p.invincible = Math.max(p.invincible, BALANCE.bomb.invincible);
    for (const e of this.state.enemies) {
      if (e.hp > 0 && Math.abs(e.x - p.x) <= half + e.radius && Math.abs(e.y - p.y) <= half + e.radius) this.damageEnemy(e, BALANCE.bomb.damage, { x: p.x, y: p.y, kind: 'bomb' });
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
    const w = this.state, difficulty = difficultyConfig(w.difficulty);
    if (w.mode === 'story') {
      const progress = this.director.state;
      // Public clocks remain controllable by deterministic debug fixtures.
      if (w.wave !== progress.stage && w.wave >= 1 && w.wave <= CAMPAIGN_STAGES.length) {
        progress.stage = w.wave; progress.phase = 'stage'; progress.activeEncounter = null;
      }
      if (progress.phase === 'stage') progress.stageElapsed = w.waveTime;
      this.handleCampaignActions(this.director.step(dt));
      w.waveTime = progress.stageElapsed;
      if (progress.progression >= BALANCE.companion.supplyTime && !this.suppliedWaves.has(0)) {
        this.suppliedWaves.add(0); this.supplyCompanion();
      }
    } else if (!w.bossStage && !w.bossPending && !w.enemies.some(e => e.hp > 0 && e.role === 'miniboss')) {
      w.waveTime += dt;
      if (w.waveTime >= BALANCE.spawn.waveDuration - EPSILON) {
        w.waveTime = 0;
        if (w.wave % BALANCE.spawn.endlessBossInterval === 0) {
          const id = ENCOUNTERS[(Math.floor(w.wave / BALANCE.spawn.endlessBossInterval) - 1) % ENCOUNTERS.length];
          w.pendingWave = w.wave + 1;
          this.handleCampaignActions([{ type: 'encounter', id, stage: w.wave }]);
        } else { w.wave++; this.emit({ type: 'wave', x: w.player.x, y: w.player.y, amount: w.wave }); }
      }
    }
    if (!w.bossStage && !w.bossPending) {
      w.spawnTimer -= dt;
      if (w.spawnTimer <= EPSILON) {
        if (this.isWaveBlocked()) {
          w.spawnTimer = w.difficulty === 'hard' ? 2.4 : 3;
          if (this.addCount() + w.indicators.filter(i => !i.encounterId).length < this.holdAddLimit()) this.queueSpawn();
        } else {
          const progression = w.mode === 'story' ? w.campaign.progression : 360;
          const interval = 1.1 - 0.4 * clamp(progression / 360, 0, 1);
          w.spawnTimer = (w.mode === 'endless' ? Math.max(0.5, interval - Math.max(0, w.wave - 5) * 0.015) : interval) * difficulty.spawnInterval;
          this.queueSpawn();
        }
      }
    }
    for (let i = w.indicators.length - 1; i >= 0; i--) {
      const indicator = w.indicators[i]; indicator.time -= dt;
      if (indicator.time <= EPSILON) {
        w.indicators.splice(i, 1);
        const spawned = this.spawnEnemy(indicator.type, indicator.x, indicator.y, indicator.encounterId as EncounterId | undefined);
        if (!spawned && indicator.encounterId) { indicator.time = 0.5; w.indicators.push(indicator); }
      }
    }
  }

  isWaveBlocked(): boolean {
    return this.state.mode === 'story' ? this.state.campaign.phase === 'encounter' : this.state.enemies.some(e => e.hp > 0 && e.role === 'miniboss');
  }
  private holdAddLimit(): number { return this.state.difficulty === 'hard' ? 16 : 12; }
  private addCount(): number { return this.state.enemies.filter(e => e.hp > 0 && e.role !== 'boss' && e.role !== 'miniboss' && e.role !== 'part').length; }

  private handleCampaignActions(actions: CampaignAction[]): void {
    const w = this.state, p = w.player;
    for (const action of actions) {
      if (action.type === 'stageStarted') {
        w.wave = action.stage; w.waveTime = 0; w.spawnTimer = 0.8; w.bossStage = w.bossPending = false;
        w.seasonId = w.campaign.season;
        this.emit({ type: 'wave', x: p.x, y: p.y, amount: w.wave, seasonId: w.seasonId });
      } else if (action.type === 'encounterCleared') {
        this.pendingEncounterCleanup = true;
        p.hp = Math.min(p.maxHp, p.hp + 2);
        this.collectPickup({ id: 0, type: 'bomb', x: p.x, y: p.y, value: 1, age: 0 });
        p.heat = p.heatLock = p.dashCooldown = p.dashTime = 0; p.overheated = false; p.invincible = Math.max(2, p.invincible);
        this.dashStock = this.has('doubleDash') ? 2 : 1; this.grazeRefund = 0;
        this.gainXp(BALANCE.xp.bossRewards[action.index] ?? 0);
        if (action.index < 2) this.collectPickup({ id: 0, type: 'support', x: p.x, y: p.y, value: 1, age: 0 });
        enqueueUpgrade(w.build, 'boss', `encounter:${action.id}`);
        this.emit({ type: 'attack', text: 'encounterCleared', x: p.x, y: p.y, encounterId: action.id });
      } else if (action.type === 'encounter') {
        const type: EnemyType = action.id === 's1:echo' ? 'miniboss' : action.id === 's2:palisade' ? 'palisade' : action.id === 's2:reprise' ? 'reprise' : 'boss';
        const side = p.x < WORLD.width / 2 ? 1 : -1;
        const x = clamp(p.x + side * 530, 120, WORLD.width - 120), y = clamp(p.y - 140, 120, WORLD.height - 120), warning = type === 'boss' ? 2 : 1.6;
        w.indicators.length = 0;
        if (type === 'boss') w.bossPending = true;
        else {
          w.spawnTimer = w.difficulty === 'hard' ? 2.4 : 3;
          const adds = w.enemies.filter(e => e.hp > 0 && e.role === 'mob');
          for (const extra of adds.slice(this.holdAddLimit())) this.retirePart(extra);
        }
        if (type === 'miniboss') w.minibossSpawned = true;
        w.indicators.push({ id: this.nextId++, type, x, y, time: warning, duration: warning, encounterId: action.id });
        this.emit({ type: 'attack', enemyType: type, x, y, text: 'arrival', encounterId: action.id });
      } else if (action.type === 'complete') {
        w.status = 'complete'; w.bossStage = w.bossPending = false;
        this.emit({ type: 'complete', x: p.x, y: p.y, amount: w.score, seasonId: 's2', encounterId: 's2:final' });
      }
    }
  }

  private openUpgrade(): void {
    const w = this.state;
    if (w.status !== 'playing' || !w.build.pendingRewards.length || this.stressMode) return;
    offerModules(w.build, w.player.level, this.seed, { reviveConsumed: this.reviveUsed });
    if (!w.build.choices.length) return;
    w.status = 'upgrade'; this.clearInput(); this.emit({ type: 'upgrade', x: w.player.x, y: w.player.y, amount: w.build.choiceIndex });
  }
  chooseUpgrade(id: UpgradeChoiceId, offerId?: string): boolean {
    const w = this.state;
    if (w.status !== 'upgrade' || !chooseModule(w.build, id, { offerId, reviveConsumed: this.reviveUsed })) return false;
    if (id in MODULES && MODULES[id as ModuleId].branch === 'drone' && !w.companions.length) this.deployCompanion();
    if (id === 'doubleDash' && !this.doubleDashActive) { this.doubleDashActive = true; this.dashStock = w.player.dashCooldown > EPSILON ? 1 : 2; }
    if (id === 'reward:heal') { const heal = Math.min(2, w.player.maxHp - w.player.hp); w.player.hp += heal; this.gainXp((2 - heal) * 30); }
    else if (id === 'reward:bomb') { if (w.player.bombs < BALANCE.player.maxBombs) w.player.bombs++; else this.gainXp(30); }
    else if (id === 'reward:xp') this.gainXp(100);
    w.status = 'playing'; this.clearInput(); w.campaign.choiceIndex = w.build.choiceIndex;
    this.openUpgrade(); return true;
  }
  rerollUpgrades(): boolean {
    if (this.state.status !== 'upgrade') return false;
    return rerollModules(this.state.build, this.state.player.level, this.seed, { reviveConsumed: this.reviveUsed }).length > 0;
  }
  get dashCharges(): number { return this.has('doubleDash') ? this.dashStock : Number(this.state.player.dashCooldown <= EPSILON); }
  private has(id: ModuleId): boolean { return moduleRank(this.state.build, id) > 0; }
  private value(id: ModuleId, values: readonly [number, number]): number { return values[moduleRank(this.state.build, id) === 2 ? 1 : 0]; }
  private evolved(id: EvolutionId): boolean { return hasEvolution(this.state.build, id); }
  private get dashRecharge(): number { return this.value('doubleDash', MODULE_VALUES.doubleDash.cooldown); }
  private get droneRange(): number { return (this.has('division') ? this.value('division', MODULE_VALUES.division.range) : BALANCE.companion.range) + (moduleRank(this.state.build, 'crossOrbit') === 2 ? 80 : 0); }

  private queueSpawn(): void {
    const w = this.state, progression = w.mode === 'story' ? w.campaign.progression : 360;
    if (this.enemyCount + w.indicators.length >= BALANCE.limits.enemies - 1) return;
    if (w.elapsed < this.introductionUntil) return;
    const introduction = w.mode === 'story' && w.campaign.phase === 'stage' ? ENEMY_INTRODUCTIONS.find(item => item.time <= progression && !this.introducedTypes.has(item.type)) : undefined;
    const pool = ENEMY_INTRODUCTIONS.filter(item => item.time <= progression).map(item => item.type);
    const type = introduction?.type ?? this.threats.selectSpawn(pool, w.enemies, this.random.next(), w.difficulty, w.elapsed, w.indicators, progression);
    if (!type) return;
    if (isTacticalEnemy(type) && w.enemies.filter(e => e.hp > 0 && isTacticalEnemy(e.type)).length + w.indicators.filter(e => isTacticalEnemy(e.type)).length >= this.threats.tacticalCap(w.difficulty, progression)) return;
    const kindCap = type === 'repairer' ? 2 : type === 'weaver' || type === 'sampler' ? 3 : 180;
    if (w.enemies.filter(e => e.hp > 0 && e.type === type).length + w.indicators.filter(e => e.type === type).length >= kindCap) return;
    const angle = this.random.next() * TAU;
    let x = clamp(w.player.x + Math.cos(angle) * 980, 70, WORLD.width - 70), y = clamp(w.player.y + Math.sin(angle) * 980, 70, WORLD.height - 70);
    if (Math.hypot(x - w.player.x, y - w.player.y) < 420) {
      const inward = Math.atan2(WORLD.height / 2 - w.player.y, WORLD.width / 2 - w.player.x);
      x = clamp(w.player.x + Math.cos(inward) * 850, 70, WORLD.width - 70); y = clamp(w.player.y + Math.sin(inward) * 850, 70, WORLD.height - 70);
    }
    if (introduction) {
      this.introducedTypes.add(type); this.introductionUntil = w.elapsed + 4; this.nextEnemyCommit = Math.max(this.nextEnemyCommit, this.introductionUntil);
      // One new silhouette at a time; ordinary pressure resumes after the four-second introduction.
    }
    w.indicators.push({ id: this.nextId++, x, y, type, time: BALANCE.spawn.warning, duration: BALANCE.spawn.warning });
  }

  spawnEnemy(type: EnemyType, x: number, y: number, encounterId?: EncounterId): Enemy | null {
    const w = this.state;
    const difficulty = difficultyConfig(w.difficulty);
    const mini = type === 'miniboss' || type === 'palisade' || type === 'reprise';
    const part = type === 'arm' || type === 'node', hazard = type === 'mine' || type === 'core';
    if (mini && w.enemies.some(e => e.role === 'miniboss' && e.hp > 0)) return null;
    const atEnemyCap = this.stressMode
      ? this.enemyCount - this.mineCount >= BALANCE.limits.enemies && type !== 'mine'
      : this.enemyCount >= BALANCE.limits.enemies;
    if (type !== 'boss' && (atEnemyCap || (type === 'mine' && this.mineCount >= BALANCE.limits.mines))) return null;
    if (type === 'boss') {
      this.clearCombat();
      w.arena = { x: 1200, y: 1550, width: VIEW.width, height: VIEW.height };
      x = 2000; y = 1780;
      w.bossStage = true; w.bossPending = false;
      const p = w.player;
      p.x = p.prevX = 2000; p.y = p.prevY = 2220; p.vx = p.vy = 0;
      w.camera.x = w.camera.prevX = 2000; w.camera.y = w.camera.prevY = 2000;
      p.heat = p.heatLock = 0; p.overheated = false;
      p.invincible = Math.max(p.invincible, 2);
      this.specialWindup = 0; this.specialTarget = null;
      this.settlePickups();
    }
    const base = ENEMIES[type], progression = w.mode === 'story' ? w.campaign.progression : 360;
    let hp = hazard || part || mini || type === 'boss' ? base.hp : base.hp * (1 + 3 * clamp(progression / 360, 0, 1));
    if (!hazard) hp *= type === 'boss' || mini ? difficulty.bossHp : difficulty.enemyHp;
    let speed = base.speed as number, radius = base.radius as number;
    if (w.mode === 'endless' && !part && type !== 'core' && type !== 'boss') {
      const extra = Math.max(0, w.wave - 5);
      if (type !== 'mine') hp *= (1 + extra * 0.2) * (1 + extra * 0.3);
      speed = Math.min(300, speed * (1 + extra * 0.02));
      radius *= Math.min(3, 1 + extra * 0.05);
    }
    speed *= difficulty.enemySpeed;
    hp = Math.ceil(hp);
    const enemy: Enemy = { id: this.nextId++, type, x: clamp(x, radius, WORLD.width - radius), y: clamp(y, radius, WORLD.height - radius),
      prevX: x, prevY: y, vx: 0, vy: 0, radius, hp, maxHp: hp, speed, angle: this.random.next() * TAU,
      state: type === 'mine' ? 'arming' : 'chase', timer: type === 'mine' ? enemyAttacks(w.difficulty).mine.arming : 0, cooldown: type === 'sniper' ? 0.6 + this.random.next() : type === 'minelayer' ? 2 : 0,
      laserCooldown: 0, attackIndex: 0, hitTime: 0, lowHpSpoken: false, directionX: 0, directionY: 0 };
    enemy.role = type === 'boss' ? 'boss' : mini ? 'miniboss' : part ? 'part' : hazard ? 'hazard' : 'mob';
    const bossSeason = encounterId ? encounterId === 's1:mafuyu' ? 's1' : 's2' : w.seasonId;
    enemy.archetypeId = type === 'boss' ? bossSeason === 's1' ? 'mafuyu' : 'lacuna' : type;
    if (type === 'boss') {
      enemy.spell = createSpellBrain(bossSeason, w.difficulty);
      enemy.hp = enemy.maxHp = spellCardDefinition(enemy, w.difficulty).hp;
      enemy.encounterId = encounterId ?? (bossSeason === 's1' ? 's1:mafuyu' : 's2:final');
      if (w.mode === 'story') { w.campaign.activeEncounter = enemy.encounterId as EncounterId; w.campaign.phase = 'encounter'; }
    }
    if (!['basic', 'dasher', 'sniper', 'sprayer', 'minelayer', 'mine', 'boss', 'miniboss'].includes(type)) enemy.season2 = createSeason2Brain(type);
    if (type === 'miniboss') { enemy.miniboss = createMiniBossBrain(); w.minibossSpawned = true; w.minibossDefeated = false; }
    if (mini) {
      enemy.encounterId = type === 'miniboss' ? 's1:echo' : type === 'palisade' ? 's2:palisade' : 's2:reprise';
      const stage = CAMPAIGN_STAGES[w.wave - 1];
      if (w.mode === 'story' && (stage?.midEncounter?.id === enemy.encounterId || stage?.exitEncounter === enemy.encounterId)) {
        w.campaign.stage = w.wave; w.campaign.stageElapsed = w.waveTime;
        w.campaign.activeEncounter = enemy.encounterId as EncounterId;
        w.campaign.phase = 'encounter';
      }
    }
    enemy.prevX = enemy.x; enemy.prevY = enemy.y;
    this.state.enemies.push(enemy); this.byId.set(enemy.id, enemy);
    this.enemyCount++; if (type === 'mine') this.mineCount++;
    this.emit({ type: type === 'boss' ? 'boss' : 'spawn', x: enemy.x, y: enemy.y, enemyType: type, targetId: enemy.id, encounterId: enemy.encounterId, color: ENEMIES[type].color });
    return enemy;
  }

  private bossExclusive(): boolean {
    const boss = this.state.enemies.find(e => e.type === 'boss' && e.hp > 0);
    return !!boss && !['chase', 'recover'].includes(boss.state);
  }

  private spawnPart(parent: Enemy, type: 'arm' | 'node' | 'core', x: number, y: number): Enemy | null {
    if (type === 'core' && this.state.enemies.filter(e => e.hp > 0 && e.type === 'core').length >= 12) return null;
    const part = this.spawnEnemy(type, x, y);
    if (part) { part.parentId = parent.id; part.encounterId = parent.encounterId; }
    return part;
  }
  private retirePart(part: Enemy): void {
    if (!this.byId.has(part.id)) return;
    part.hp = 0; this.byId.delete(part.id); this.bladeTimes.delete(part.id); this.enemyCount--; if (part.type === 'mine') this.mineCount--;
    this.threats.cancel(part.id);
    this.state.hazards = this.state.hazards.filter(h => h.sourceId !== part.id);
  }
  private spawnHazard(hazard: Omit<AreaHazard, 'id'>): void {
    if (this.state.status !== 'playing' || this.state.hazards.length >= BALANCE.ai.hazards) return;
    this.state.hazards.push({ ...hazard, id: this.nextId++ });
  }
  private season2Context(canCommit: (kind?: 'wall' | 'sample', intent?: AttackIntent) => boolean = () => true): Season2AiContext {
    return { player: this.state.player, difficulty: this.state.difficulty, elapsed: this.state.elapsed, enemies: this.state.enemies,
      canCommit, shootAt: (e, x, y, angle, speed, radius, color, options) => this.enemyShootAt(e, x, y, angle, speed, radius, color, options),
      spawnHazard: h => this.spawnHazard(h), spawnPart: (parent, type, x, y) => this.spawnPart(parent, type, x, y),
      retirePart: part => this.retirePart(part), emit: event => this.emit(event) };
  }

  private updateHazards(dt: number): void {
    const w = this.state, p = w.player;
    let keep = 0;
    for (const hazard of w.hazards) {
      if (!this.byId.has(hazard.sourceId) || this.pendingCardClear?.sources.has(hazard.sourceId)) continue;
      if (!hazard.active) {
        hazard.warning = Math.max(0, hazard.warning - dt);
        if (hazard.warning <= EPSILON) {
          hazard.active = true; hazard.life = hazard.duration;
          this.emit({ type: 'attack', text: 'impact', x: hazard.x, y: hazard.y, color: 0xff886d, amount: hazard.radius, enemyType: 'boss' });
        }
      } else { hazard.life -= dt; if (hazard.kind === 'beam') hazard.angle = (hazard.angle ?? 0) + (hazard.angularSpeed ?? 0) * dt; }
      if (hazard.life <= EPSILON) continue;
      const hit = hazard.kind === 'beam'
        ? pointInBeam(p.x, p.y, BALANCE.player.hitRadius, beamGeometry(hazard.x, hazard.y, hazard.angle ?? 0, hazard.length ?? 0, hazard.width ?? 0))
        : segmentCircleHit(p.prevX, p.prevY, p.x, p.y, hazard.x, hazard.y, BALANCE.player.hitRadius + hazard.radius) !== null;
      if (hazard.active && p.invincible <= EPSILON && hit) this.damagePlayer(undefined, hazard.kind);
      w.hazards[keep++] = hazard;
      if (w.status !== 'playing') break;
    }
    w.hazards.length = keep;
  }

  private updateEnemies(dt: number): void {
    const w = this.state, p = w.player;
    const prepare = (e: Enemy) => {
      e.prevX = e.x; e.prevY = e.y; e.hitTime = Math.max(0, e.hitTime - dt); e.cooldown -= dt;
    };
    const moveAndCollide = (e: Enemy) => {
      const arena = w.arena ?? { x: 0, y: 0, width: WORLD.width, height: WORLD.height };
      const slow = e.role === 'mob' && (e.slowUntil ?? 0) > w.elapsed && !['dash', 'charge'].includes(e.state) ? 1 - (e.slowAmount ?? 0.25) : 1;
      e.x = clamp(e.x + e.vx * dt * slow, arena.x + e.radius, arena.x + arena.width - e.radius);
      e.y = clamp(e.y + e.vy * dt * slow, arena.y + e.radius, arena.y + arena.height - e.radius);
      if (w.status !== 'playing' || p.invincible > EPSILON || e.type === 'core' || (e.disabledUntil ?? 0) > w.elapsed || (e.type === 'mine' && e.state === 'arming')) return;
      if (segmentCircleHit(p.prevX - e.prevX, p.prevY - e.prevY, p.x - e.x, p.y - e.y, 0, 0, p.radius + e.radius) !== null) {
        if (e.type === 'mine') this.damageEnemy(e, 99999, { x: p.x, y: p.y, kind: 'contact' });
        this.damagePlayer();
      }
    };
    // Resolve the Boss before its adds, so a newly committed major attack suppresses them in this same step.
    const boss = w.enemies.find(e => e.type === 'boss' && e.hp > 0);
    if (boss) {
      prepare(boss);
      updateSpellBoss(boss, dt, { player: p, elapsed: w.elapsed, difficulty: w.difficulty, arena: w.arena!, enemies: w.enemies,
        shootAt: (e, x, y, angle, speed, radius, color, options) => this.enemyShootAt(e, x, y, angle, speed, radius, color, options),
        emit: event => this.emit(event), spawnHazard: h => this.spawnHazard(h),
        spawnPart: (parent, type, x, y) => this.spawnPart(parent, type as 'node', x, y), retirePart: part => this.retirePart(part) });
      if (w.status === 'playing') moveAndCollide(boss);
    }
    const exclusive = this.bossExclusive();
    const difficulty = difficultyConfig(w.difficulty);
    const committed = (e: Enemy) => e.type !== 'basic' && e.type !== 'mine' && e.type !== 'boss' && ['aim', 'charge', 'dash', 'volley', 'lay', 'laserWarmup', 'laser'].includes(e.state);
    let commitments = w.enemies.reduce((count, e) => count + Number(e.hp > 0 && committed(e)), 0);
    const canCommit = (e: Enemy, kind?: 'wall' | 'sample', intent?: AttackIntent) => {
      const visible = Math.abs(e.x - w.camera.x) < VIEW.width / 2 - 45 && Math.abs(e.y - w.camera.y) < VIEW.height / 2 - 45;
      if (!visible || exclusive || commitments >= difficulty.attackSlots || w.elapsed < this.nextEnemyCommit) return false;
      if (kind && w.enemies.some(other => other !== e && other.hp > 0 && ['weaver', 'sampler', 'palisade'].includes(other.type) && !['chase', 'recover'].includes(other.state))) return false;
      if (kind && (w.hazards.some(h => ['sampler', 'weaver', 'palisade'].includes(this.byId.get(h.sourceId)?.type ?? ''))
        || w.bullets.some(b => b.owner === 'enemy' && b.life > 0 && b.attackGroup === 'wall'))) return false;
      if (intent && e.role === 'mob' && !this.threats.canCommit(intent, { elapsed: w.elapsed, difficulty: w.difficulty, player: p, enemies: w.enemies,
        hazards: w.hazards, bullets: w.bullets, arena: w.arena, onDeferredCancel: id => { const source = this.byId.get(id); if (source) cancelEnemyAttack(source); } })) return false;
      commitments++; this.nextEnemyCommit = w.elapsed + difficulty.commitGap; return true;
    };
    const miniboss = w.enemies.find(e => e.type === 'miniboss' && e.hp > 0);
    if (miniboss && w.status === 'playing') {
      prepare(miniboss);
      if (exclusive) { miniboss.state = 'recover'; miniboss.timer = 0.5; miniboss.vx = miniboss.vy = 0; }
      else updateMiniBossAi(miniboss, dt, { player: p, elapsed: w.elapsed, difficulty: w.difficulty,
        canCommit: () => canCommit(miniboss), emit: event => this.emit(event), damagePlayer: () => this.damagePlayer(undefined, 'miniLaser'),
        shoot: (e, angle, speed, radius, color, options) => this.enemyShoot(e, angle, speed, radius, color, options) });
      if (w.status === 'playing') moveAndCollide(miniboss);
    }
    // New mines are deliberately skipped until the next step; all movement and damage clocks stay at 60 Hz.
    const count = w.enemies.length;
    for (let i = 0; i < count && w.status === 'playing'; i++) {
      const e = w.enemies[i];
      if (e.hp <= 0 || e === boss || e === miniboss) continue;
      prepare(e);
      if (e.type === 'node') continue; // Spell emitters are controlled by their parent, once per tick.
      if (e.season2) {
        updateSeason2Ai(e, dt, this.season2Context((kind, intent) => canCommit(e, kind, intent)));
        if (w.status === 'playing' && e.hp > 0) { moveAndCollide(e); refreshWeakpoint(e); }
        continue;
      }
      const distance = Math.hypot(p.x - e.x, p.y - e.y);
      const decide = distance < 1250 || ((w.tick + e.id) & 1) === 0;
      updateEnemyAi(e, dt, decide, {
        player: p, elapsed: w.elapsed, wave: w.wave, difficulty: w.difficulty, allowAttack: !exclusive,
        canCommit: intent => canCommit(e, undefined, intent),
        shoot: (enemy, angle, speed, radius, color, options) => this.enemyShoot(enemy, angle, speed, radius, color, options),
        emit: event => this.emit(event),
        plantMine: (x, y) => {
          if (exclusive || w.bossStage) return;
          if (this.isWaveBlocked() && this.enemyCount - 1 + w.indicators.length >= this.holdAddLimit()) return;
          if (this.enemyCount >= BALANCE.limits.enemies - 1 && w.indicators.some(i => i.type === 'miniboss')) return;
          const mineRadius = ENEMIES.mine.radius * (w.mode === 'endless' ? Math.min(3, 1 + Math.max(0, w.wave - 5) * 0.05) : 1);
          x = clamp(x, mineRadius, WORLD.width - mineRadius); y = clamp(y, mineRadius, WORLD.height - mineRadius);
          if (Math.hypot(x - p.x, y - p.y) < BALANCE.ai.mineSafeDistance) return;
          if (w.enemies.some(other => other.hp > 0 && other.type === 'mine' && Math.hypot(x - other.x, y - other.y) < BALANCE.ai.mineSpacing)) return;
          this.spawnEnemy('mine', x, y);
        },
      });
      if (w.status === 'playing') { moveAndCollide(e); refreshWeakpoint(e); }
    }
  }

  private enemyShoot(e: Enemy, angle: number, speed: number, radius: number, color: number, options?: EnemyShotOptions): void {
    this.enemyShootAt(e, e.x, e.y, angle, speed, radius, color, options);
  }
  private enemyShootAt(e: Enemy, x: number, y: number, angle: number, speed: number, radius: number, color: number, options?: EnemyShotOptions): void {
    const difficulty = difficultyConfig(this.state.difficulty);
    const bullet = this.addBullet(x, y, angle, speed * difficulty.bulletSpeed, 'enemy', difficulty.damage, radius, color);
    if (bullet) {
      bullet.sourceId = e.id;
      bullet.friendlyDamage = options?.friendlyDamage; bullet.friendlyHits = options?.friendlyHits;
      bullet.attackGroup = options?.attackGroup;
      bullet.shape = options?.shape;
      bullet.turnRate = options?.turnRate ?? 0; bullet.turnDelay = Math.max(0, options?.turnDelay ?? 0);
      bullet.turnDuration = Math.max(0, options?.turnDuration ?? 0);
      bullet.acceleration = (options?.acceleration ?? 0) * difficulty.bulletSpeed;
      bullet.maxSpeed = Math.max(bullet.speed, (options?.maxSpeed ?? speed) * difficulty.bulletSpeed);
      if (options?.program) {
        let variants = this.scaledPrograms.get(options.program);
        if (!variants) { variants = {}; this.scaledPrograms.set(options.program, variants); }
        variants[this.state.difficulty] ??= options.program.map(phase => ({ ...phase, speed: phase.speed === undefined ? undefined : phase.speed * difficulty.bulletSpeed }));
        bullet.program = variants[this.state.difficulty];
        bullet.life = options.program.reduce((total, phase) => total + phase.duration, 0);
      }
      // One muzzle flash / sound per emitter per tick, even for a dense flower burst.
      if (!this.shotFeedback.has(e.id)) {
        this.shotFeedback.add(e.id);
        this.emit({ type: 'enemyShot', x: e.x, y: e.y, color, angle, enemyType: e.type });
      }
    }
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
    b.shape = undefined; b.motionAge = 0; b.turnRate = 0; b.turnDelay = 0; b.turnDuration = 0; b.acceleration = 0; b.maxSpeed = speed;
    b.program = undefined; b.programIndex = 0; b.programAge = 0; b.programEntered = false; b.programSpeed = speed; b.programAngle = angle;
    b.sourceId = undefined; b.grazed = false; b.homingTime = undefined; b.turnSpeed = 5; b.bornTick = this.state.tick; b.attackGroup = undefined;
    b.friendlyDamage = undefined; b.friendlyHits = undefined;
    b.returnOriginX = b.returnOriginY = b.returnAt = undefined; b.returning = false; b.returnHitIds = undefined; b.moduleId = undefined;
    this.state.bullets.push(b);
    return b;
  }

  private rebuildGrid(): void {
    this.grid.clear(); this.maxEnemyRadius = this.maxEnemyMotion = 0;
    for (const e of this.state.enemies) if (e.hp > 0) {
      refreshWeakpoint(e);
      this.grid.insert(e);
      this.maxEnemyRadius = Math.max(this.maxEnemyRadius, e.radius, e.weakpoint ? Math.hypot(e.weakpoint.x - e.x, e.weakpoint.y - e.y) + e.weakpoint.radius : 0);
      this.maxEnemyMotion = Math.max(this.maxEnemyMotion, Math.abs(e.x - e.prevX), Math.abs(e.y - e.prevY));
    }
  }

  private nearestEnemy(x: number, y: number, range: number, excluded?: Set<number>): Enemy | null {
    this.grid.query(x - range - this.maxEnemyRadius, y - range - this.maxEnemyRadius, x + range + this.maxEnemyRadius, y + range + this.maxEnemyRadius, this.candidates);
    let closest: Enemy | null = null, best = range * range;
    for (const e of this.candidates) {
      if (e.hp <= 0 || (e.disabledUntil ?? 0) > this.state.elapsed || excluded?.has(e.id)) continue;
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
        const movable = e.state === 'chase' || e.state === 'recover';
        const otherMovable = other.state === 'chase' || other.state === 'recover';
        if (!movable && !otherMovable) continue;
        const dx = e.x - other.x, dy = e.y - other.y, distance = Math.hypot(dx, dy), overlap = e.radius + other.radius - distance;
        if (overlap <= 0) continue;
        const force = Math.min(overlap * 0.3, 50 * dt), nx = distance > EPSILON ? dx / distance : Math.cos(e.id), ny = distance > EPSILON ? dy / distance : Math.sin(e.id);
        // Committed attacks keep the same origin as their warning. Neighbours yield around them.
        if (movable) { e.x = clamp(e.x + nx * force, e.radius, WORLD.width - e.radius); e.y = clamp(e.y + ny * force, e.radius, WORLD.height - e.radius); }
        if (otherMovable) { other.x = clamp(other.x - nx * force, other.radius, WORLD.width - other.radius); other.y = clamp(other.y - ny * force, other.radius, WORLD.height - other.radius); }
      }
    }
  }

  private updateBullets(dt: number): void {
    const bullets = this.state.bullets, p = this.state.player;
    let keep = 0;
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      if (this.pendingCardClear && (b.owner === 'enemy' ? this.pendingCardClear.sources.has(b.sourceId ?? -1) : (b.bornTick ?? 0) <= this.pendingCardClear.tick)) { this.bulletPool.release(b); continue; }
      // Preserve unprocessed objects for terminal cleanup without moving or resolving them.
      if (this.state.status !== 'playing') { bullets[keep++] = b; continue; }
      b.prevX = b.x; b.prevY = b.y;
      if (b.owner === 'player' && b.returnAt !== undefined) {
        b.motionAge = (b.motionAge ?? 0) + dt;
        if (!b.returning && b.motionAge > b.returnAt + EPSILON) {
          b.returning = true; b.kind = 'module'; b.hitIds.clear(); b.remainingHits = 1;
          const back = Math.atan2((b.returnOriginY ?? b.prevY) - b.y, (b.returnOriginX ?? b.prevX) - b.x);
          b.vx = Math.cos(back) * b.speed; b.vy = Math.sin(back) * b.speed;
        }
      }
      const motion = advanceProjectileMotion(b, dt);
      if (b.homingTime !== undefined) { b.homingTime = Math.max(0, b.homingTime - dt); if (b.homingTime <= EPSILON) b.homing = false; }
      if (b.homing) {
        let target = b.targetId === null ? null : this.byId.get(b.targetId) ?? null;
        if (target && (target.hp <= 0 || (target.disabledUntil ?? 0) > this.state.elapsed || b.hitIds.has(target.id) || Math.hypot(target.x - b.x, target.y - b.y) > b.lockRange + target.radius)) target = null;
        if (!target && ((this.state.tick + b.id) % 4 === 0 || b.targetId !== null)) target = this.nearestEnemy(b.x, b.y, b.lockRange, b.hitIds);
        b.targetId = target?.id ?? null;
        if (target) {
          const angle = Math.atan2(b.vy, b.vx), desired = Math.atan2(target.y - b.y, target.x - b.x);
          const turn = (b.turnSpeed ?? 5) * dt;
          const turned = angle + clamp(angleDelta(angle, desired), -turn, turn);
          b.vx = Math.cos(turned) * b.speed; b.vy = Math.sin(turned) * b.speed;
        }
      }
      b.x += motion?.dx ?? b.vx * dt; b.y += motion?.dy ?? b.vy * dt; b.life -= dt;
      let dead = b.life <= 0;
      if (!dead && b.owner === 'player' && b.remainingHits > 0) {
        const padding = this.maxEnemyRadius + this.maxEnemyMotion + b.radius;
        this.grid.query(Math.min(b.prevX, b.x) - padding, Math.min(b.prevY, b.y) - padding, Math.max(b.prevX, b.x) + padding, Math.max(b.prevY, b.y) + padding, this.candidates);
        this.impacts.length = 0;
        for (const e of this.candidates) {
          if (e.hp <= 0 || (e.disabledUntil ?? 0) > this.state.elapsed || b.hitIds.has(e.id)) continue;
          const time = segmentCircleHit(b.prevX - e.prevX, b.prevY - e.prevY, b.x - e.x, b.y - e.y, 0, 0, b.radius + e.radius);
          const weak = e.weakpoint;
          const weakTime = weak && weak.hp > 0 ? segmentCircleHit(b.prevX, b.prevY, b.x, b.y, weak.x, weak.y, b.radius + weak.radius) : null;
          if (weakTime !== null && (time === null || weakTime <= time + EPSILON)) this.impacts.push({ enemy: e, time: weakTime, weakpoint: true });
          else if (time !== null) this.impacts.push({ enemy: e, time });
        }
        this.impacts.sort((a, c) => a.time - c.time || a.enemy.id - c.enemy.id);
        for (const impact of this.impacts) {
          if (impact.enemy.hp <= 0) continue;
          b.hitIds.add(impact.enemy.id);
          const enemy = impact.enemy, hpBefore = enemy.hp, cardIndex = enemy.spell?.cardIndex;
          if (impact.weakpoint && enemy.weakpoint) {
            const weak = enemy.weakpoint;
            if (b.kind === 'normal') this.markEnemy(enemy);
            this.emit({ type: 'hit', x: weak.x, y: weak.y, angle: Math.atan2(b.vy, b.vx), amount: Math.min(weak.hp, b.damage), hitResult: 'weakpoint', targetId: enemy.id });
            if (interruptEnemy(enemy, b.damage, this.state.elapsed, event => this.emit(event))) this.threats.cancel(enemy.id);
          } else {
            this.damageEnemy(enemy, b.damage, { x: b.prevX, y: b.prevY, kind: b.kind, angle: Math.atan2(b.vy, b.vx), impactX: b.prevX + (b.x - b.prevX) * impact.time, impactY: b.prevY + (b.y - b.prevY) * impact.time });
            if (this.state.status === 'playing' && enemy.hp < hpBefore && enemy.spell?.cardIndex === cardIndex && enemy.role !== 'hazard') this.applyBulletModules(b, enemy, enemy.hp <= 0);
          }
          b.remainingHits--;
          if (b.remainingHits <= 0) { dead = b.returnAt === undefined; break; }
          if (this.state.status !== 'playing') break;
        }
      } else if (!dead && b.owner === 'enemy' && this.state.status === 'playing') {
        const radius = b.radius + BALANCE.player.hitRadius;
        const playerHit = p.invincible <= EPSILON ? segmentCircleHit(b.prevX - p.prevX, b.prevY - p.prevY, b.x - p.x, b.y - p.y, 0, 0, radius) : null;
        if ((b.friendlyHits ?? 0) > 0) this.resolveHeavyShot(b, playerHit ?? 1);
        if (playerHit !== null) {
          this.damagePlayer(b.damage, 'enemyProjectile'); dead = true;
        } else if (p.invincible <= EPSILON && this.has('graze') && !b.grazed && this.grazeCount < MODULE_VALUES.graze.rate
          && segmentCircleHit(b.prevX - p.prevX, b.prevY - p.prevY, b.x - p.x, b.y - p.y, 0, 0, radius + 24) !== null
          && segmentCircleHit(b.prevX - p.prevX, b.prevY - p.prevY, b.x - p.x, b.y - p.y, 0, 0, radius + 6) === null) {
          b.grazed = true; this.grazeCount++; p.heat = Math.max(0, p.heat - this.value('graze', MODULE_VALUES.graze.heat));
          const refund = Math.max(0, Math.min(this.value('graze', MODULE_VALUES.graze.recharge), this.value('graze', MODULE_VALUES.graze.refundCap) - this.grazeRefund, p.dashCooldown));
          p.dashCooldown -= refund; this.grazeRefund += refund;
        }
      }
      dead ||= b.x < -b.radius || b.y < -b.radius || b.x > WORLD.width + b.radius || b.y > WORLD.height + b.radius;
      const arena = this.state.arena;
      if (arena && b.owner === 'enemy') dead ||= b.x < arena.x - b.radius || b.y < arena.y - b.radius || b.x > arena.x + arena.width + b.radius || b.y > arena.y + arena.height + b.radius;
      if (dead) this.bulletPool.release(b); else bullets[keep++] = b;
    }
    bullets.length = keep;
  }

  private resolveHeavyShot(b: Bullet, before: number): void {
    const padding = this.maxEnemyRadius + this.maxEnemyMotion + b.radius;
    this.grid.query(Math.min(b.prevX, b.x) - padding, Math.min(b.prevY, b.y) - padding, Math.max(b.prevX, b.x) + padding, Math.max(b.prevY, b.y) + padding, this.candidates);
    this.impacts.length = 0;
    for (const enemy of this.candidates) {
      if (enemy.hp <= 0 || enemy.role !== 'mob' || enemy.id === b.sourceId || b.hitIds.has(enemy.id)) continue;
      const time = segmentCircleHit(b.prevX - enemy.prevX, b.prevY - enemy.prevY, b.x - enemy.x, b.y - enemy.y, 0, 0, b.radius + enemy.radius);
      if (time !== null && time <= before) this.impacts.push({ enemy, time });
    }
    this.impacts.sort((a, c) => a.time - c.time || a.enemy.id - c.enemy.id);
    for (const { enemy } of this.impacts) {
      if ((b.friendlyHits ?? 0) <= 0) break;
      b.hitIds.add(enemy.id); b.friendlyHits!--;
      this.damageEnemy(enemy, b.friendlyDamage ?? 8, { x: b.prevX, y: b.prevY, kind: 'heavy', angle: Math.atan2(b.vy, b.vx) });
    }
  }

  private applyBulletModules(b: Bullet, enemy: Enemy, killed: boolean): void {
    const multiplier = buildDamageMultiplier(this.state.build);
    if (b.kind === 'normal') this.markEnemy(enemy);
    if (b.kind === 'normal' && this.has('ricochet') && this.ricochetTimer <= EPSILON) {
      const target = this.state.enemies.filter(e => e.id !== enemy.id && !b.hitIds.has(e.id) && this.validCommandTarget(e) && Math.hypot(e.x - enemy.x, e.y - enemy.y) <= 220 + e.radius)
        .sort((a, c) => Math.hypot(a.x - enemy.x, a.y - enemy.y) - Math.hypot(c.x - enemy.x, c.y - enemy.y) || a.id - c.id)[0];
      if (target) {
        this.ricochetTimer = MODULE_VALUES.ricochet.cooldown;
        const extra = this.addBullet(enemy.x, enemy.y, Math.atan2(target.y - enemy.y, target.x - enemy.x), 900, 'player', b.damage * this.value('ricochet', MODULE_VALUES.ricochet.ratio), 4, 0xa5f8df, 'module', 1, true, 260);
        if (extra) { extra.targetId = target.id; for (const id of b.hitIds) extra.hitIds.add(id); }
      }
    }
    if (b.kind === 'normal' && killed && this.has('shatter') && this.shatterTimer <= EPSILON) {
      this.shatterTimer = MODULE_VALUES.shatter.cooldown;
      this.moduleEvent('shatter');
      for (let i = 0; i < 6; i++) {
        const fragment = this.addBullet(enemy.x, enemy.y, i * TAU / 6, 600, 'player', this.value('shatter', MODULE_VALUES.shatter.damage) * multiplier, 3, 0xc6fdff, 'module');
        if (fragment) fragment.life = 220 / 600;
      }
    }
    if (b.kind === 'special' && this.has('chain')) {
      const targets = this.state.enemies.filter(e => e.id !== enemy.id && !b.hitIds.has(e.id) && e.hp > 0 && (e.disabledUntil ?? 0) <= this.state.elapsed && Math.hypot(e.x - enemy.x, e.y - enemy.y) <= 220 + e.radius)
        .sort((a, c) => Math.hypot(a.x - enemy.x, a.y - enemy.y) - Math.hypot(c.x - enemy.x, c.y - enemy.y)).slice(0, this.value('chain', MODULE_VALUES.chain.targets));
      for (const target of targets) { b.hitIds.add(target.id); this.damageEnemy(target, 5 * multiplier, { x: enemy.x, y: enemy.y, kind: 'chain' }); }
    }
    if (b.kind !== 'drone') return;
    if (this.has('slow')) this.slowEnemy(enemy, this.value('slow', MODULE_VALUES.slow.amount), 0.8);
    if (this.has('droneBurst')) {
      const hits = this.value('droneBurst', MODULE_VALUES.droneBurst.hits);
      this.burstHits = Math.min(hits, this.burstHits + 1);
      if (this.burstHits >= hits && this.burstTimer <= EPSILON) {
        this.burstHits = 0; this.burstTimer = MODULE_VALUES.droneBurst.cooldown;
        this.moduleEvent('droneBurst');
        if (this.evolved('triangleAssault') && this.state.companions.length) {
          for (const drone of this.state.companions) this.addBullet(drone.x, drone.y, Math.atan2(enemy.y - drone.y, enemy.x - drone.x), 900, 'player', 18 / this.state.companions.length * multiplier, 5, 0xffffff, 'module', 2);
        } else this.addBullet(b.prevX, b.prevY, Math.atan2(b.vy, b.vx), 900, 'player', this.value('droneBurst', MODULE_VALUES.droneBurst.damage) * multiplier, 5, 0xffffff, 'module', 2);
      }
    }
  }

  private markEnemy(enemy: Enemy): void {
    if (!this.has('orbitBlade') || !this.validCommandTarget(enemy)) return;
    const p = this.state.player;
    if (p.markTargetId === enemy.id) p.markTime = MODULE_VALUES.orbitBlade.markDuration;
    else if (this.markRetarget <= EPSILON) { p.markTargetId = enemy.id; p.markTime = MODULE_VALUES.orbitBlade.markDuration; this.markRetarget = MODULE_VALUES.orbitBlade.markCooldown; }
  }

  damageEnemy(enemy: Enemy, amount: number, source: { x: number; y: number; kind?: string; angle?: number; impactX?: number; impactY?: number } = this.state.player): void {
    if (this.state.status !== 'playing' || enemy.hp <= 0 || amount <= 0 || (enemy.disabledUntil ?? 0) > this.state.elapsed || enemy.spell?.stage === 'intro') return;
    const shield = shieldDamageMultiplier(enemy, source.x, source.y, this.state.elapsed);
    const damage = Math.min(enemy.hp, (enemy.type === 'dasher' && enemy.state === 'charge' ? Math.ceil(amount * 1.3) : amount) * shield);
    enemy.hp = Math.max(0, enemy.hp - damage); enemy.hitTime = 0.09;
    this.emit({ type: 'hit', x: source.impactX ?? enemy.x, y: source.impactY ?? enemy.y, angle: source.angle ?? Math.atan2(enemy.y - source.y, enemy.x - source.x), amount: damage, damageSource: source.kind ?? 'direct', hitResult: shield < 1 ? 'shield' : 'body', targetId: enemy.id, enemyType: enemy.type, color: ENEMIES[enemy.type].color });
    if (shield < 1 && (source.kind === 'beam' || source.kind === 'heavy') && breakShield(enemy, this.state.elapsed, event => this.emit(event))) this.threats.cancel(enemy.id);
    if (enemy.type === 'boss' && enemy.hp < enemy.maxHp * 0.3 && !enemy.lowHpSpoken) {
      enemy.lowHpSpoken = true; this.emit({ type: 'bossLow', x: enemy.x, y: enemy.y, enemyType: 'boss', targetId: enemy.id });
    }
    if (enemy.hp > 0) return;
    if (enemy.spell) {
      const sources = new Set([enemy.id, ...enemy.spell.partIds]);
      const cardHp = enemy.maxHp;
      if (advanceSpellCard(enemy, this.state.difficulty)) {
        this.emit({ type: 'card', text: 'cleared', x: enemy.x, y: enemy.y, amount: enemy.spell!.cardIndex, enemyType: 'boss', encounterId: enemy.encounterId });
        this.pendingCardClear = { sources, tick: this.state.tick };
        this.state.score += Math.round(cardHp * 10 * difficultyConfig(this.state.difficulty).score);
        if (!this.stepping) this.flushCardCleanup();
        return;
      }
    }
    if (enemy.type === 'node') {
      enemy.hp = enemy.maxHp; enemy.disabledUntil = this.state.elapsed + 5;
      this.state.hazards = this.state.hazards.filter(h => h.sourceId !== enemy.id);
      this.emit({ type: 'kill', hitResult: 'part', x: enemy.x, y: enemy.y, targetId: enemy.id, enemyType: enemy.type, color: ENEMIES.node.color, amount: enemy.radius });
      return;
    }
    if (enemy.season2) onSeason2Death(enemy, this.season2Context());
    this.byId.delete(enemy.id); this.enemyCount--; if (enemy.type === 'mine') this.mineCount--;
    this.threats.cancel(enemy.id);
    this.bladeTimes.delete(enemy.id);
    this.state.hazards = this.state.hazards.filter(h => h.sourceId !== enemy.id);
    this.state.kills++;
    this.emit({ type: 'kill', hitResult: enemy.role === 'part' ? 'part' : 'body', x: enemy.x, y: enemy.y, enemyType: enemy.type, targetId: enemy.id, color: ENEMIES[enemy.type].color, amount: enemy.radius });
    if ((enemy.type === 'mine' || enemy.type === 'core') && source.kind !== 'device' && source.kind !== 'contact') this.detonateDevice(enemy);
    if (enemy.role === 'part' || enemy.type === 'core') return;
    if (enemy.type !== 'mine') this.state.score += Math.round(enemy.maxHp * 10 * difficultyConfig(this.state.difficulty).score);
    if (enemy.role === 'boss' || enemy.role === 'miniboss') {
      if (enemy.type === 'miniboss') this.state.minibossDefeated = true;
      this.state.bossStage = this.state.bossPending = false;
      for (const part of this.state.enemies) if (part.parentId === enemy.id) this.retirePart(part);
      if (this.state.mode === 'story') {
        this.state.pendingWave = 0;
        this.handleCampaignActions(this.director.defeatEncounter(enemy.encounterId as EncounterId));
      } else {
        this.pendingEncounterCleanup = true;
        this.state.wave = this.state.pendingWave || this.state.wave + 1;
        this.state.pendingWave = 0; this.state.waveTime = 0; this.state.spawnTimer = 1;
        this.emit({ type: 'wave', x: enemy.x, y: enemy.y, amount: this.state.wave });
      }
      if (!this.stepping) {
        if (this.pendingEncounterCleanup) { this.pendingEncounterCleanup = false; this.clearCombat(); this.state.arena = null; this.settlePickups(); }
        if ((this.state.status as WorldState['status']) === 'complete') { this.clearCombat(); this.settlePickups(); } else this.openUpgrade();
      }
    } else if (enemy.role === 'mob') this.dropLoot(enemy);
  }

  private detonateDevice(device: Enemy): void {
    const targets = this.state.enemies.filter(e => e.hp > 0 && e.role === 'mob' && Math.hypot(e.x - device.x, e.y - device.y) <= 140 + e.radius)
      .sort((a, b) => Math.hypot(a.x - device.x, a.y - device.y) - Math.hypot(b.x - device.x, b.y - device.y) || a.id - b.id).slice(0, 6);
    this.emit({ type: 'attack', text: 'deviceBurst', x: device.x, y: device.y, amount: 140, color: 0xffcb69 });
    for (const target of targets) this.damageEnemy(target, 6, { x: device.x, y: device.y, kind: 'device' });
  }

  private flushCardCleanup(): void {
    const cleanup = this.pendingCardClear;
    if (!cleanup) return;
    this.pendingCardClear = null;
    let keep = 0;
    for (const b of this.state.bullets) {
      const old = b.owner === 'enemy' ? cleanup.sources.has(b.sourceId ?? -1) : (b.bornTick ?? 0) <= cleanup.tick;
      if (old) this.bulletPool.release(b); else this.state.bullets[keep++] = b;
    }
    this.state.bullets.length = keep;
    this.state.beams.length = 0;
    for (const e of this.state.enemies) if (e.role === 'part' && cleanup.sources.has(e.id)) this.retirePart(e);
    this.state.hazards = this.state.hazards.filter(h => !cleanup.sources.has(h.sourceId));
  }

  private damagePlayer(damage: number = difficultyConfig(this.state.difficulty).damage, source = 'body'): void {
    const p = this.state.player;
    if (p.invincible > EPSILON || this.state.status !== 'playing') return;
    p.hp = Math.max(0, p.hp - damage); p.invincible = BALANCE.player.hitInvincible;
    const resonance = p.level === BALANCE.xp.cap;
    const available = resonance ? this.state.build.resonanceXp : p.xp;
    const loss = Math.min(available, Math.floor((resonance ? RESONANCE.xpPerRank : xpNeeded(p.level)) * BALANCE.xp.loss));
    if (resonance) this.state.build.resonanceXp -= loss;
    else p.xp -= loss;
    this.emit({ type: 'damage', x: p.x, y: p.y, amount: damage, damageSource: source, color: 0xff6584 });
    if (loss > 0) this.emit({ type: 'xpLoss', x: p.x, y: p.y, amount: loss, text: resonance ? '共鸣经验' : '经验' });
    if (p.hp <= 0 && this.has('revive') && !this.reviveUsed) { this.reviveUsed = true; p.hp = this.value('revive', MODULE_VALUES.revive.hp); p.invincible = this.value('revive', MODULE_VALUES.revive.invincible); this.moduleEvent('revive'); }
    if (p.hp <= 0) { this.state.status = 'failed'; p.perfectWindow = 0; p.markTargetId = null; p.markTime = 0; this.clearInput(); this.emit({ type: 'failure', x: p.x, y: p.y, amount: this.state.score }); }
  }

  private dropLoot(enemy: Enemy): void {
    const drop = BALANCE.drops;
    this.addPickup('xp', enemy.x, enemy.y, BALANCE.xp.pickup);
    let type: PickupType = 'xp';
    if (this.random.next() < drop.blackHole) type = 'blackHole';
    else if (this.random.next() < (enemy.type === 'minelayer' ? drop.minelayerSupply : drop.supply)) type = 'supply';
    else if (['dasher', 'sniper', 'weaver', 'sampler', 'repairer'].includes(enemy.type) && this.random.next() < drop.coolant) type = 'coolant';
    else if (this.random.next() < drop.bomb) type = 'bomb';
    else if (this.random.next() < drop.miniBomb) type = 'miniBomb';
    else if (this.random.next() < drop.hp) type = 'hp';
    if (type !== 'xp') this.addPickup(type, enemy.x, enemy.y, 1);
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
      const range = blackHole ? 6000 : this.magnetTime > 0 ? this.value('magnet', MODULE_VALUES.magnet.range) : 150;
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
    else if (pickup.type === 'bomb') {
      const accepted = Math.min(value, Math.max(0, BALANCE.player.maxBombs - p.bombs));
      p.bombs += accepted; this.gainXp((value - accepted) * BALANCE.player.bombOverflowXp);
    }
    else if (pickup.type === 'supply') {
      for (let unit = 0; unit < Math.floor(value); unit++) if (!this.recoverSkills(1)) this.gainXp(20);
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
    if (!Number.isFinite(value) || value <= 0) return;
    const p = this.state.player;
    p.xp += value;
    while (p.level < BALANCE.xp.cap && p.xp >= xpNeeded(p.level)) {
      p.xp -= xpNeeded(p.level); p.level++;
      enqueueUpgrade(this.state.build, 'level', `level:${p.level}`);
      this.emit({ type: 'levelup', x: p.x, y: p.y, amount: p.level, color: 0xffcb69 });
    }
    if (p.level >= BALANCE.xp.cap) {
      addResonanceXp(this.state.build, p.xp, p.level); p.xp = 0;
    }
  }

  /** Clear enemies before redeeming effects, so settlement cannot generate kill rewards. */
  private settlePickups(): void {
    const p = this.state.player;
    const existing = this.state.pickups.splice(0);
    for (const pickup of existing) if (!this.collectPickup(pickup)) {
      pickup.x = p.x; pickup.y = p.y; this.state.pickups.push(pickup);
    }
  }

  private pruneEnemies(): void {
    let keep = 0;
    for (const e of this.state.enemies) if (e.hp > 0) this.state.enemies[keep++] = e;
    this.state.enemies.length = keep;
  }

  private clearCombat(): void {
    this.threats.clear();
    this.state.player.markTargetId = null; this.state.player.markTime = 0;
    this.state.enemies.length = 0;
    for (const b of this.state.bullets) this.bulletPool.release(b);
    this.state.bullets.length = 0;
    this.state.indicators.length = 0;
    this.state.beams.length = 0;
    this.state.hazards.length = 0;
    this.state.playerAreas.length = 0; this.returnBladeHits.clear(); this.returningVolley.clear();
    this.byId.clear(); this.grid.clear(); this.bladeTimes.clear();
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
    this.reset('endless', 20260911, 'normal');
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
