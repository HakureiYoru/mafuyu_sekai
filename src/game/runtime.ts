import { BALANCE, DEFAULT_SETTINGS, MINIBOSS_ENCOUNTER, VIEW, xpNeeded } from './config';
import { FixedClock } from './clock';
import { InputController } from './input';
import { GameAudio } from './audio';
import { Dialogue } from './dialogue';
import { GameSimulation } from './simulation';
import type { GameRenderer } from './renderer';
import type { CombatEvent, Difficulty, GamePhase, GameSettings, HudSnapshot, PerformanceStats, RuntimeControls, WorldState } from './types';

const SETTINGS_KEY = 'mafuyu-sekai:settings:v3';
const BEST_KEY = 'mafuyu-sekai:best:v3';
const DIFFICULTY_KEY = 'mafuyu-sekai:difficulty:v3';
const bestKey = (difficulty: Difficulty) => difficulty === 'normal' ? BEST_KEY : `${BEST_KEY}:hard`;
function loadDifficulty(): Difficulty { try { return localStorage.getItem(DIFFICULTY_KEY) === 'hard' ? 'hard' : 'normal'; } catch { return 'normal'; } }
const clampVolume = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
export function validateSettings(raw: Partial<GameSettings>): GameSettings {
  return {
    quality: ['low', 'medium', 'high'].includes(raw.quality ?? '') ? raw.quality! : DEFAULT_SETTINGS.quality,
    masterVolume: clampVolume(raw.masterVolume, DEFAULT_SETTINGS.masterVolume), musicVolume: clampVolume(raw.musicVolume, DEFAULT_SETTINGS.musicVolume),
    sfxVolume: clampVolume(raw.sfxVolume, DEFAULT_SETTINGS.sfxVolume), screenShake: clampVolume(raw.screenShake, DEFAULT_SETTINGS.screenShake),
    reducedMotion: typeof raw.reducedMotion === 'boolean' ? raw.reducedMotion : DEFAULT_SETTINGS.reducedMotion,
  };
}
function loadSettings() {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (raw && typeof raw === 'object') return validateSettings(raw);
  } catch { /* Private mode or invalid previous preferences: defaults are safe. */ }
  return { ...DEFAULT_SETTINGS, reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches };
}
function loadBest(difficulty: Difficulty) { try { const best = Number(localStorage.getItem(bestKey(difficulty))); return Number.isFinite(best) && best > 0 ? best : 0; } catch { return 0; } }
const emptyStats = (): PerformanceStats => ({ fps: 0, frameP95: 0, frameP99: 0, updateMs: 0, renderMs: 0, enemies: 0, bullets: 0, particles: 0, pickups: 0, voices: 0, textures: 0 });

export class GameRuntime implements RuntimeControls {
  private difficulty = loadDifficulty();
  private simulation = new GameSimulation(12345, this.difficulty);
  private renderer: GameRenderer | null = null;
  private input: InputController;
  private audio: GameAudio;
  private dialogue = new Dialogue();
  private clock = new FixedClock();
  private settings = loadSettings();
  private phase: GamePhase = 'loading';
  private progress = 0;
  private error: string | null = null;
  private bestScores = { normal: loadBest('normal'), hard: loadBest('hard') };
  private listeners = new Set<() => void>();
  private snapshot!: HudSnapshot;
  private raf: number | null = null;
  private disposed = false;
  private initialising = false;
  private initialised = false;
  private lastFrame = 0;
  private lastHud = -1000;
  private lastStats = 0;
  private frameTimes: number[] = [];
  private stats = emptyStats();
  private announcement = '';
  private announcementUntil = 0;
  private debug = new URLSearchParams(window.location.search).has('debug');
  private abort = new AbortController();
  private resizeObserver: ResizeObserver;
  private contextLost = false;

  constructor(private host: HTMLElement) {
    this.audio = new GameAudio(this.settings);
    this.input = new InputController(host, () => this.phase === 'playing', () => this.pause(), () => {
      if (this.phase === 'playing') this.pause(); else if (this.phase === 'paused') this.resume();
    });
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.renderer || this.disposed) return;
      try { this.renderer.resize(); if (this.phase !== 'playing') this.renderer.render(this.simulation.state, 1, 0); } catch (error) { this.fail(error); }
    });
    this.resizeObserver.observe(host);
    host.addEventListener('webglcontextlost', event => { event.preventDefault(); this.contextLost = true; this.fail(new Error('图形设备暂时不可用，请重试以重新加载画面。')); }, { capture: true, signal: this.abort.signal });
    host.addEventListener('webglcontextrestored', () => { this.contextLost = false; }, { capture: true, signal: this.abort.signal });
    window.addEventListener('pagehide', () => this.pause(), { signal: this.abort.signal });
    this.publish();
  }
  async init() {
    if (this.initialising || this.disposed) return;
    this.initialising = true; this.phase = 'loading'; this.error = null; this.progress = 0.05; this.publish();
    try {
      const { GameRenderer: Renderer } = await import('./renderer');
      if (this.disposed) return;
      const renderer = new Renderer(this.host, this.settings);
      this.renderer = renderer;
      await Promise.all([
        renderer.init(ratio => { if (!this.disposed) { this.progress = 0.1 + ratio * 0.85; this.publish(); } }),
        this.audio.preload(),
      ]);
      if (this.disposed) { renderer.destroy(); return; }
      this.initialised = true; this.progress = 1; this.phase = 'menu';
      renderer.render(this.simulation.state, 1, 0);
      if (this.debug) this.installDebug();
      this.publish();
    } catch (error) { this.renderer?.destroy(); this.renderer = null; this.fail(error); }
    finally { this.initialising = false; }
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };

  start = () => {
    if (this.disposed) return;
    if (!this.initialised || this.phase === 'error') { void this.retry(); return; }
    this.stopLoop(); this.audio.stop(); this.audio.play();
    this.simulation.reset('story', undefined, this.difficulty); this.input.clear(); this.renderer?.resetEffects(); this.dialogue.start();
    this.phase = 'playing'; this.error = null; this.announce('WAVE 01  /  光源接入');
    this.resetMetrics(); this.publish(); this.schedule();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  restart = () => this.start();
  pause = () => {
    if (this.phase !== 'playing') return;
    this.phase = 'paused'; this.input.clear(); this.simulation.clearInput(); this.stopLoop(); this.audio.pause(); this.publish();
  };
  resume = () => {
    if (this.phase !== 'paused' || this.disposed) return;
    this.phase = 'playing'; this.input.clear(); this.simulation.clearInput(); this.audio.play(); this.publish(); this.schedule();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  continueEndless = () => {
    if (this.phase !== 'complete') return;
    this.simulation.continueEndless(); this.renderer?.resetEffects(); this.input.clear(); this.audio.play();
    this.phase = 'playing'; this.announce('ENDLESS  /  越过世界的边界'); this.publish(); this.schedule();
  };
  returnToMenu = () => {
    if (this.phase === 'loading' || this.disposed) return;
    if (this.phase === 'playing' || this.phase === 'paused') this.saveBest();
    this.stopLoop(); this.audio.stop(); this.input.clear(); this.dialogue.reset(); this.simulation.reset('story', undefined, this.difficulty);
    this.renderer?.resetEffects(); this.phase = 'menu'; this.announcement = '';
    this.renderer?.render(this.simulation.state, 1, 0); this.publish();
  };
  setSettings = (partial: Partial<GameSettings>) => {
    this.settings = validateSettings({ ...this.settings, ...partial });
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* Preferences still apply for this session. */ }
    this.audio.setSettings(this.settings); this.renderer?.setSettings(this.settings);
    if (this.phase !== 'playing') this.renderer?.render(this.simulation.state, 1, 0);
    this.publish();
  };
  setDifficulty = (difficulty: Difficulty) => {
    if (this.phase !== 'menu' || !['normal', 'hard'].includes(difficulty)) return;
    this.difficulty = difficulty;
    this.simulation.reset('story', undefined, difficulty);
    try { localStorage.setItem(DIFFICULTY_KEY, difficulty); } catch { /* Session selection still works. */ }
    this.publish();
  };
  private async retry() {
    if (this.initialising) return;
    this.stopLoop(); this.audio.stop(); this.renderer?.destroy(); this.renderer = null;
    this.initialised = false; this.contextLost = false;
    await this.init();
  }
  private schedule() {
    if (this.raf !== null || this.disposed || this.phase !== 'playing') return;
    this.clock.reset(); this.lastFrame = 0;
    this.raf = requestAnimationFrame(this.frame);
  }
  private frame = (timestamp: number) => {
    this.raf = null;
    if (this.disposed || this.phase !== 'playing' || !this.renderer) return;
    try {
      const delta = this.lastFrame ? Math.min(0.1, (timestamp - this.lastFrame) / 1000) : 0;
      if (this.lastFrame && timestamp - this.lastFrame < 250) { this.frameTimes.push(timestamp - this.lastFrame); if (this.frameTimes.length > 600) this.frameTimes.shift(); }
      this.lastFrame = timestamp;
      let urgent = false;
      const updateStart = performance.now();
      const alpha = this.clock.advance(timestamp, dt => {
        const camera = this.simulation.state.camera;
        const player = this.simulation.state.player;
        const previousReady = player.dashCooldown <= 0, previousOverheated = player.overheated, previousWindow = player.perfectWindow > 0;
        const events = this.simulation.step(this.input.read(camera.x - VIEW.width / 2, camera.y - VIEW.height / 2), dt);
        urgent ||= previousReady !== (player.dashCooldown <= 0) || previousOverheated !== player.overheated || previousWindow !== (player.perfectWindow > 0);
        this.dialogue.update(dt); this.processEvents(events);
        urgent ||= events.some(event => ['damage', 'dash', 'bomb', 'levelup', 'leveldown', 'boss', 'complete', 'failure', 'support'].includes(event.type) || event.enemyType === 'miniboss' || event.type === 'attack' && event.enemyType === 'boss');
        const status = this.simulation.state.status;
        if (status !== 'playing') {
          this.phase = status;
          this.input.clear(); this.saveBest(); this.audio.finish();
          return false;
        }
      });
      this.stats.updateMs = performance.now() - updateStart;
      const renderStart = performance.now();
      this.renderer.render(this.simulation.state, this.phase === 'playing' ? alpha : 1, delta);
      this.stats.renderMs = performance.now() - renderStart;
      if (timestamp - this.lastStats > 1000) this.updateStats(timestamp);
      if (urgent || timestamp - this.lastHud >= 1000 / 15 || this.phase !== 'playing') { this.lastHud = timestamp; this.publish(); }
      if (this.phase === 'playing') this.raf = requestAnimationFrame(this.frame);
      else this.clock.reset();
    } catch (error) { this.fail(error); }
  };
  private processEvents(events: CombatEvent[]) {
    this.renderer?.handleEvents(events); this.audio.handle(events); this.dialogue.handle(events, this.simulation.state.score);
    for (const event of events) {
      if (event.type === 'wave') this.announce(`WAVE ${String(this.simulation.state.wave).padStart(2, '0')}  /  信号深入`);
      else if (event.type === 'boss') this.announce('MAFUYU  /  核心信号出现');
      else if (event.type === 'levelup') this.announce(`WEAPON LEVEL ${this.simulation.state.player.level}  /  光芒增强`, 1.5);
      else if (event.type === 'support') this.announce(event.text === 'arrival' ? '支援模块到达 · 靠近拾取' : `子机接入 ${event.amount ?? this.simulation.state.companions.length}/3 · 自动掩护`, 2.5);
      else if (event.type === 'attack' && event.enemyType === 'boss' && event.text === 'phase') this.announce(`共鸣阶段 ${event.amount} · 攻势变化`, 1.6);
      else if (event.type === 'attack' && event.enemyType === 'miniboss' && event.text === 'arrival') this.announce('ECHO / 游猎回声入侵', 1.6);
      else if (event.type === 'kill' && event.enemyType === 'miniboss') this.announce('回声击破 · 支援补给已掉落', 2);
    }
  }
  private announce(text: string, duration = 2.5) { this.announcement = text; this.announcementUntil = this.simulation.state.elapsed + duration; }
  private saveBest() {
    const { difficulty, score } = this.simulation.state;
    this.bestScores[difficulty] = Math.max(this.bestScores[difficulty], score);
    try { localStorage.setItem(bestKey(difficulty), `${this.bestScores[difficulty]}`); } catch { /* Session record remains available. */ }
  }
  private stopLoop() { if (this.raf !== null) cancelAnimationFrame(this.raf); this.raf = null; this.clock.reset(); this.lastFrame = 0; }
  private resetMetrics() { this.frameTimes = []; this.lastStats = 0; this.lastHud = -1000; this.stats = emptyStats(); }
  private updateStats(timestamp: number) {
    this.lastStats = timestamp;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
    const mean = this.frameTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, this.frameTimes.length);
    this.stats.fps = mean > 0 ? 1000 / mean : 0; this.stats.frameP95 = percentile(0.95); this.stats.frameP99 = percentile(0.99);
  }
  private publish() {
    const state = this.simulation.state, player = state.player;
    const boss = state.enemies.find(enemy => enemy.type === 'boss');
    const miniboss = state.enemies.find(enemy => enemy.type === 'miniboss');
    const graphics = this.renderer?.getStats() ?? { particles: 0, textures: 0 };
    this.snapshot = {
      phase: this.phase, loading: this.progress, error: this.error, mode: state.mode,
      score: state.score, bestScore: this.bestScores[state.difficulty], difficulty: state.difficulty, wave: state.wave, waveProgress: state.waveTime / BALANCE.spawn.waveDuration,
      minibossHp: miniboss?.hp ?? 0, minibossMaxHp: miniboss?.maxHp ?? 0, minibossAction: miniboss ? miniBossAction(miniboss.state) : '',
      elapsed: state.elapsed, kills: state.kills, hp: player.hp, maxHp: player.maxHp, bombs: player.bombs,
      level: player.level, xp: player.xp, xpNeeded: xpNeeded(player.level), ammo: player.ammo, maxAmmo: BALANCE.ammo.max,
      heat: player.heat, overheated: player.overheated, dashCooldown: player.dashCooldown, perfectWindow: player.perfectWindow,
      bossHp: boss?.hp ?? 0, bossMaxHp: boss?.maxHp ?? 0, bossStage: state.bossStage || state.bossPending,
      bossPhase: boss?.boss?.phase ?? 1, bossAction: boss ? bossAction(boss.state, boss.boss?.skill) : '', focus: player.focus,
      companions: state.companions?.length ?? 0,
      comms: this.dialogue.getMessage(this.settings.reducedMotion), announcement: state.elapsed < this.announcementUntil ? this.announcement : '',
      settings: { ...this.settings }, stats: { ...this.stats, ...graphics, enemies: state.enemies.length, bullets: state.bullets.length, pickups: state.pickups.length, voices: this.audio.voiceCount },
    };
    for (const listener of this.listeners) listener();
    if (this.debug) {
      this.host.dataset.phase = this.phase;
      this.host.dataset.tick = String(state.tick);
      this.host.dataset.raf = String(this.raf === null ? 0 : 1);
    }
  }
  private fail(error: unknown) {
    this.stopLoop(); this.input.clear(); this.audio.stop(); this.phase = 'error';
    this.error = error instanceof Error ? error.message : '游戏遇到了一个问题，请重新加载。';
    console.error('Game stopped safely:', error); this.publish();
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true; this.stopLoop(); this.abort.abort(); this.resizeObserver.disconnect();
    this.input.destroy(); this.audio.destroy(); this.renderer?.destroy(); this.renderer = null; this.listeners.clear();
    if (this.debug) Reflect.deleteProperty(window, '__MAFUYU_DEBUG__');
  }
  private installDebug() {
    (window as DebugWindow).__MAFUYU_DEBUG__ = {
      snapshot: () => this.getSnapshot(),
      state: () => this.simulation.state,
      stress: () => { this.start(); this.simulation.debugStress(); this.renderer?.debugStress(); this.resetMetrics(); this.publish(); },
      scenario: (name: DebugScenario) => {
        this.start();
        const state = this.simulation.state;
        state.player.invincible = 3600;
        if (name === 'boss' || name === 'boss-laser' || name === 'boss-nova' || name === 'boss-bombard') {
          state.wave = 5;
          const boss = this.simulation.spawnEnemy('boss', 2000, 2000)!;
          state.player.x = state.player.prevX = 2520; state.player.y = state.player.prevY = 2000;
          state.player.level = 5;
          state.pickups.push({ id: 900001, type: 'support', x: state.player.x, y: state.player.y, value: 3, age: 0 });
          if (name !== 'boss') {
            boss.timer = 0;
            boss.boss!.cycle = name === 'boss-nova' ? 1 : 5;
            boss.laserCooldown = name === 'boss-laser' ? 0 : 14;
          }
        }
        if (name === 'boss-warning') { state.wave = 5; state.waveTime = BALANCE.spawn.waveDuration - 1 / 60; }
        if (name === 'miniboss' || name === 'miniboss-arrival') {
          state.wave = 3; state.player.level = 3;
          if (name === 'miniboss-arrival') state.waveTime = MINIBOSS_ENCOUNTER.time - 1 / 60;
          else this.simulation.spawnEnemy('miniboss', 2460, 1830);
          state.pickups.push({ id: 900001, type: 'support', x: state.player.x, y: state.player.y, value: 2, age: 0 });
        }
        if (name === 'arsenal') {
          state.wave = 4; state.player.level = 5; state.spawnTimer = 3600;
          state.pickups.push({ id: 900001, type: 'support', x: 2000, y: 2000, value: 3, age: 0 });
          for (const [index, type] of (['hp', 'ammo', 'coolant', 'bomb', 'miniBomb', 'blackHole', 'support'] as const).entries()) {
            state.pickups.push({ id: 900010 + index, type, x: 1630 + index * 90, y: 2240, value: 1, age: 0 });
          }
          for (let i = 0; i < 4; i++) this.simulation.spawnEnemy('basic', 2450 + i * 180, 2000);
          this.simulation.spawnEnemy('mine', 1770, 1870);
          this.simulation.spawnEnemy('mine', 1870, 1800);
          this.simulation.spawnEnemy('sniper', 2470, 1700);
        }
        if (name === 'enemy-tactics') {
          state.wave = 5; state.spawnTimer = 3600; state.player.level = 5;
          state.pickups.push({ id: 900001, type: 'support', x: 2000, y: 2000, value: 3, age: 0 });
          this.simulation.spawnEnemy('dasher', 1710, 2000);
          this.simulation.spawnEnemy('sniper', 2460, 1810);
          this.simulation.spawnEnemy('sprayer', 1540, 2180);
          this.simulation.spawnEnemy('minelayer', 2320, 2240);
          for (let i = 0; i < 3; i++) this.simulation.spawnEnemy('basic', 1850 + i * 160, 1660);
        }
        if (name === 'failed' || name === 'complete') { state.status = name; this.phase = name; this.stopLoop(); this.audio.stop(); this.publish(); }
      },
      lifecycle: () => ({ rafActive: this.raf !== null, phase: this.phase, listeners: this.listeners.size, disposed: this.disposed, contextLost: this.contextLost }),
      pause: this.pause, resume: this.resume, restart: this.restart, settings: this.setSettings, difficulty: this.setDifficulty,
    };
  }
}
export interface DebugControls {
  snapshot(): HudSnapshot; state(): WorldState; stress(): void; scenario(name: DebugScenario): void;
  lifecycle(): { rafActive: boolean; phase: GamePhase; listeners: number; disposed: boolean; contextLost: boolean };
  pause(): void; resume(): void; restart(): void; settings(settings: Partial<GameSettings>): void;
  difficulty(difficulty: Difficulty): void;
}
export type DebugScenario = 'boss' | 'boss-laser' | 'boss-nova' | 'boss-bombard' | 'miniboss' | 'miniboss-arrival' | 'enemy-tactics' | 'failed' | 'complete' | 'boss-warning' | 'arsenal';
type DebugWindow = Window & { __MAFUYU_DEBUG__?: DebugControls };

function bossAction(state: string, skill?: string): string {
  if (state === 'phaseShift') return '阶段转换 · 准备下一轮';
  if (state === 'recover' || state === 'chase') return '攻击间隙 · 可以反击';
  if (skill === 'laser') return state === 'laserWarmup' ? '扫射方向已锁定 · 离开紫色扇区' : '激光扫射 · 留在扇区外';
  if (skill === 'nova') return '环弹 · 薄荷色扇区是弹幕缺口';
  if (skill === 'bombard') return '地面连爆 · 离开标记圆圈';
  if (skill === 'volley') return '锁定扇射 · 向两侧移动';
  return '观察预告 · 保持走位';
}
function miniBossAction(state: string): string {
  if (state === 'charge') return '突进锁向 · 横向避开';
  if (state === 'dash') return '高速突进';
  if (state === 'laserWarmup') return '激光锁定 · 离开橙色走廊';
  if (state === 'laser') return '远程激光';
  if (state === 'phaseShift') return '回声加速 · 准备连招';
  if (state === 'recover') return '出招间隙 · 集火反击';
  return '游猎回声 · 注意侧翼';
}
