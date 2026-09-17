import { DEFAULT_SETTINGS, VIEW, xpNeeded } from './config';
import { FixedClock } from './clock';
import { InputController } from './input';
import { GameAudio } from './audio';
import { Dialogue } from './dialogue';
import { GameSimulation } from './simulation';
import { CAMPAIGN_STAGES } from './campaign';
import { PROFILE_KEY, PROFILE_BACKUP_KEY, SaveRepository } from './profile';
import { SPELL_CARDS, spellCardDefinition } from './spellcards';
import { MODULES, EVOLUTIONS } from './upgrades';
import { normalizeSettings } from './settings';
import type { GameRenderer } from './renderer';
import type { CombatEvent, Difficulty, EnemyType, GamePhase, GameSettings, HudSnapshot, ModuleId, EvolutionId, UpgradeChoiceId, PerformanceStats, RunStartOptions, RuntimeControls, SeasonId, WorldState } from './types';

const SETTINGS_KEY = 'mafuyu-sekai:settings:v3';
const DIFFICULTY_KEY = 'mafuyu-sekai:difficulty:v3';
function loadDifficulty(): Difficulty { try { return localStorage.getItem(DIFFICULTY_KEY) === 'hard' ? 'hard' : 'normal'; } catch { return 'normal'; } }
export function validateSettings(raw: Partial<GameSettings>): GameSettings {
  return normalizeSettings(raw);
}
function loadSettings() {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (raw && typeof raw === 'object') return validateSettings(raw);
  } catch { /* Private mode or invalid previous preferences: defaults are safe. */ }
  return { ...DEFAULT_SETTINGS, reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches };
}
const emptyStats = (): PerformanceStats => ({ fps: 0, frameP95: 0, frameP99: 0, updateMs: 0, renderMs: 0, enemies: 0, bullets: 0, particles: 0, pickups: 0, voices: 0, textures: 0 });

export class GameRuntime implements RuntimeControls {
  private difficulty = loadDifficulty();
  private saves = new SaveRepository();
  private saveMessage = '';
  private runId = '';
  private practiceRun = false;
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
    }, this.settings.keybindings);
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.renderer || this.disposed) return;
      try { this.renderer.resize(); if (this.phase !== 'playing') this.renderer.render(this.simulation.state, 1, 0); } catch (error) { this.fail(error); }
    });
    this.resizeObserver.observe(host);
    host.addEventListener('webglcontextlost', event => { event.preventDefault(); this.contextLost = true; this.fail(new Error('图形设备暂时不可用，请重试以重新加载画面。')); }, { capture: true, signal: this.abort.signal });
    host.addEventListener('webglcontextrestored', () => { this.contextLost = false; }, { capture: true, signal: this.abort.signal });
    window.addEventListener('pagehide', () => this.pause(), { signal: this.abort.signal });
    window.addEventListener('storage', event => {
      if (event.key !== PROFILE_KEY && event.key !== PROFILE_BACKUP_KEY && event.key !== null) return;
      const result = this.saves.mergeExternal(event.newValue);
      if (result.changed) this.saveMessage = '其他标签页的通关与纪录已同步；当前挑战继续保留。';
      this.publish();
    }, { signal: this.abort.signal });
    window.addEventListener('keydown', event => {
      if (this.phase !== 'upgrade' || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const index = ['Digit1', 'Digit2', 'Digit3'].indexOf(event.code);
      const keypad = ['Numpad1', 'Numpad2', 'Numpad3'].indexOf(event.code);
      const id = this.simulation.state.build.choices[index < 0 ? keypad : index];
      if (!id) return;
      event.preventDefault(); this.chooseUpgrade(id, this.simulation.state.build.offerId ?? undefined);
    }, { signal: this.abort.signal });
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

  start = (options: Partial<RunStartOptions> = {}) => {
    if (this.disposed) return;
    if (!this.initialised || this.phase === 'error') { void this.retry(); return; }
    this.saves.mergeExternal();
    this.difficulty = options.difficulty === 'hard' || options.difficulty === 'normal' ? options.difficulty : this.difficulty;
    this.runId = crypto.randomUUID(); this.practiceRun = false;
    this.stopLoop(); this.audio.stop();
    this.simulation.reset('story', options.seed, this.difficulty, { difficulty: this.difficulty });
    this.input.clear(); this.simulation.clearInput(); this.renderer?.resetEffects(); this.dialogue.start();
    this.phase = this.simulation.state.status; this.error = null;
    if (this.phase === 'playing') this.audio.play();
    this.announce('共鸣开始');
    this.resetMetrics(); this.publish(); this.schedule();
    this.renderer?.render(this.simulation.state, 1, 0);
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
    this.simulation.continueEndless(); this.renderer?.resetEffects(); this.input.clear(); this.simulation.clearInput();
    this.phase = this.simulation.state.status;
    if (this.phase === 'playing') this.audio.play(); else this.audio.pause();
    this.announce('ENDLESS  /  越过世界的边界'); this.renderer?.render(this.simulation.state, 1, 0); this.publish(); this.schedule();
  };
  returnToMenu = () => {
    if (this.phase === 'loading' || this.disposed) return;
    if (this.phase === 'playing' || this.phase === 'paused' || this.phase === 'upgrade') this.saveBest();
    this.stopLoop(); this.audio.stop(); this.input.clear(); this.dialogue.reset(); this.resetPreview();
    this.renderer?.resetEffects(); this.phase = 'menu'; this.announcement = '';
    this.renderer?.render(this.simulation.state, 1, 0); this.publish();
  };
  setSettings = (partial: Partial<GameSettings>) => {
    this.settings = validateSettings({ ...this.settings, ...partial });
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* Preferences still apply for this session. */ }
    this.audio.setSettings(this.settings); this.renderer?.setSettings(this.settings);
    this.input.setBindings(this.settings.keybindings);
    if (this.phase !== 'playing') this.renderer?.render(this.simulation.state, 1, 0);
    this.publish();
  };
  setDifficulty = (difficulty: Difficulty) => {
    if (this.phase !== 'menu' || !['normal', 'hard'].includes(difficulty)) return;
    this.difficulty = difficulty;
    this.resetPreview();
    try { localStorage.setItem(DIFFICULTY_KEY, difficulty); } catch { /* Session selection still works. */ }
    this.publish();
  };
  chooseUpgrade = (id: UpgradeChoiceId, offerId?: string) => {
    if (this.phase !== 'upgrade' || this.disposed || !this.simulation.chooseUpgrade(id, offerId)) return;
    this.stopLoop(); this.input.clear(); this.simulation.clearInput();
    this.phase = this.simulation.state.status;
    if (this.phase === 'playing') this.audio.play();
    this.publish(); this.schedule();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  rerollUpgrades = () => {
    if (this.phase !== 'upgrade' || this.disposed || !this.simulation.rerollUpgrades()) return;
    this.input.clear(); this.simulation.clearInput(); this.publish();
  };
  private resetPreview() {
    this.simulation.reset('story', undefined, this.difficulty, { difficulty: this.difficulty });
  }
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
        const previousReady = player.dashCooldown <= 0, previousOverheated = player.overheated, previousWindow = player.perfectWindow > 0, previousCharges = this.simulation.dashCharges;
        const previousMiniboss = this.simulation.state.enemies.find(enemy => enemy.role === 'miniboss');
        const previousMiniState = previousMiniboss?.state;
        const events = this.simulation.step(this.input.read(camera.x - VIEW.width / 2, camera.y - VIEW.height / 2), dt);
        urgent ||= previousReady !== (player.dashCooldown <= 0) || previousOverheated !== player.overheated || previousWindow !== (player.perfectWindow > 0)
          || previousCharges !== this.simulation.dashCharges || previousMiniState !== previousMiniboss?.state;
        this.dialogue.update(dt); this.processEvents(events);
        urgent ||= events.some(event => ['damage', 'dash', 'bomb', 'levelup', 'xpLoss', 'boss', 'complete', 'failure', 'support', 'card', 'upgrade', 'module', 'beam'].includes(event.type) || ['miniboss', 'palisade', 'reprise'].includes(event.enemyType ?? '') || event.type === 'attack' && event.enemyType === 'boss');
        const status = this.simulation.state.status;
        if (status !== 'playing') {
          this.phase = status;
          this.input.clear(); this.simulation.clearInput();
          if (status === 'upgrade') this.audio.pause();
          else { this.saveBest(); this.audio.finish(); }
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
      if (event.type === 'wave' && this.simulation.state.mode === 'endless') this.announce('无尽共鸣 · ' + this.simulation.state.wave);
      else if (event.type === 'boss') this.announce(this.simulation.state.campaign.activeEncounter === 's2:final' ? 'LACUNA / 镜界终章' : 'MAFUYU / 核心信号出现');
      else if (event.type === 'card') this.announce(event.text === 'cleared' ? `符卡 ${event.amount ?? ''} 击破` : `符卡 ${event.amount ?? ''} / ${event.text ?? ''}`, event.text === 'cleared' ? 0.55 : 1.6);
      else if (event.type === 'levelup') this.announce(`WEAPON LEVEL ${this.simulation.state.player.level}  /  光芒增强`, 1.5);
      else if (event.type === 'support') this.announce(event.text === 'arrival' ? '支援模块到达 · 靠近拾取' : event.text === 'catchup' ? `追赶补给 · 武装保底 Lv${event.amount ?? this.simulation.state.player.level}` : `子机接入 ${event.amount ?? this.simulation.state.companions.length}/3 · 自动掩护`, 2.5);
      else if (event.type === 'attack' && event.enemyType === 'boss' && event.text === 'phase') this.announce(`共鸣阶段 ${event.amount} · 攻势变化`, 1.6);
      else if (event.type === 'attack' && event.enemyType === 'miniboss' && event.text === 'arrival') this.announce('ECHO / 游猎回声入侵', 1.6);
      else if (event.type === 'kill' && event.enemyType === 'miniboss') this.announce('回声击破 · 支援补给已掉落', 2);
      if (event.type === 'complete') this.recordCompletion(event);
    }
  }
  private announce(text: string, duration = 2.5) { this.announcement = text; this.announcementUntil = this.simulation.state.elapsed + duration; }
  private saveBest() {
    if (this.practiceRun) return;
    const { mode, difficulty, score } = this.simulation.state;
    this.saves.recordScore(mode, difficulty, score);
  }
  private recordCompletion(event: CombatEvent) {
    const state = this.simulation.state, final = 's2:final';
    if (this.practiceRun || !this.runId || state.mode !== 'story' || state.status !== 'complete'
      || state.campaign.phase !== 'complete' || event.encounterId !== final
      || !state.campaign.defeatedEncounters.includes(final)) return;
    const result = this.saves.recordCompletion({ runId: this.runId, difficulty: state.difficulty,
      encounterId: final, score: state.score, source: 'gameplay' });
    if (result.changed) this.saveMessage = result.status === 'saved' ? '通关与成绩已保存。下次从 Lv1 开始新的构筑。' : '未保存到浏览器；本次通关暂存于当前页面。';
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
    const boss = state.enemies.find(enemy => enemy.role === 'boss' || enemy.type === 'boss');
    const miniboss = state.enemies.find(enemy => enemy.role === 'miniboss' || enemy.type === 'miniboss');
    const profile = this.saves.getProfile(), legacy = this.saves.getLegacyHistory();
    const card = boss?.spell ? spellCardDefinition(boss, state.difficulty) : null;
    const graphics = this.renderer?.getStats() ?? { particles: 0, textures: 0 };
    this.snapshot = {
      phase: this.phase, loading: this.progress, error: this.error, mode: state.mode,
      score: state.score, bestScore: profile.bestScores.v5[state.difficulty][state.mode], historicalBestScore: Math.max(legacy.bestScores.s1[state.difficulty], legacy.bestScores.s2[state.difficulty]), difficulty: state.difficulty, wave: state.wave, waveProgress: state.campaign.progression / 360, progression: state.campaign.progression,
      minibossHp: miniboss?.hp ?? 0, minibossMaxHp: miniboss?.maxHp ?? 0, minibossAction: miniboss ? miniboss.type === 'miniboss' ? miniBossAction(miniboss.state) : miniboss.type === 'palisade' ? 'PALISADE · 优先破坏侧臂，穿过弹墙间隙' : 'REPRISE · 留意停驻弹的原路折返' : '',
      waveBlocked: this.simulation.isWaveBlocked(),
      elapsed: state.elapsed, kills: state.kills, hp: player.hp, maxHp: player.maxHp, bombs: player.bombs,
      level: player.level, xp: player.xp, xpNeeded: xpNeeded(player.level),
      moduleStates: this.simulation.moduleStates,
      heat: player.heat, overheated: player.overheated, dashCooldown: player.dashCooldown, perfectWindow: player.perfectWindow,
      bossHp: boss?.hp ?? 0, bossMaxHp: boss?.maxHp ?? 0, bossStage: state.bossStage || state.bossPending,
      bossPhase: boss?.spell ? Math.floor(boss.spell.cardIndex / 2) + 1 : 1, bossAction: boss?.spell ? boss.spell.stage === 'intro' ? '符卡切换 · 准备新弹幕' : 'Shift 精准穿行 · 跟随弹幕变化换位' : '', focus: player.focus,
      companions: state.companions?.length ?? 0,
      comms: this.dialogue.getMessage(this.settings.reducedMotion), announcement: state.elapsed < this.announcementUntil ? this.announcement : '',
      settings: { ...this.settings }, stats: { ...this.stats, ...graphics, enemies: state.enemies.length, bullets: state.bullets.length, pickups: state.pickups.length, voices: this.audio.voiceCount },
      saveStatus: this.saves.status === 'session-only' ? 'session' : Object.keys(profile.clears).length || Object.values(profile.bestScores.v5).some(scores => scores.story || scores.endless) ? 'saved' : 'empty',
      saveMessage: this.saves.error ?? this.saveMessage,
      stageName: CAMPAIGN_STAGES[state.wave - 1]?.name ?? '边界之外', stageCount: CAMPAIGN_STAGES.length,
      cardName: card?.name ?? '', cardIndex: boss?.spell ? boss.spell.cardIndex + 1 : 0, cardCount: boss?.spell ? SPELL_CARDS[boss.spell.season][state.difficulty].length : 0,
      moduleRanks: { ...state.build.ranks }, evolutions: [...state.build.evolutions], rerollsRemaining: state.build.rerollsRemaining, choiceSource: state.build.pendingRewards[0]?.source ?? null, upgradeOfferId: state.build.offerId,
      arena: !!state.arena, modules: [...state.build.modules], upgradeChoices: [...state.build.choices], resonance: state.build.resonance, dashCharges: this.simulation.dashCharges,
    };
    this.host.parentElement?.setAttribute('data-in-run', String(['playing', 'paused', 'upgrade', 'failed', 'complete'].includes(this.phase)));
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
      stress: () => { this.start(); this.practiceRun = true; this.simulation.debugStress(); this.renderer?.debugStress(); this.resetMetrics(); this.publish(); },
      scenario: (name: DebugScenario) => {
        this.start(); this.practiceRun = true;
        const state = this.simulation.state;
        state.player.invincible = 3600;
        if (name === 'boss' || name === 'boss-laser' || name === 'boss-nova' || name === 'boss-bombard') {
          state.wave = 5;
          const boss = this.simulation.spawnEnemy('boss', 2000, 2000)!;
          state.player.x = state.player.prevX = 2520; state.player.y = state.player.prevY = 2000;
          state.player.level = 5;
          state.pickups.push({ id: 900001, type: 'support', x: state.player.x, y: state.player.y, value: 3, age: 0 });
          if (name !== 'boss' && boss.spell) { boss.spell.cardIndex = name === 'boss-nova' ? 2 : name === 'boss-bombard' ? 4 : 3; boss.hp = boss.maxHp = spellCardDefinition(boss, state.difficulty).hp; }
        }
        if (name === 'boss-warning') { state.wave = state.campaign.stage = 3; state.campaign.progression = 240 - 1 / 60; state.waveTime = state.campaign.stageElapsed = 60 - 1 / 60; }
        if (name === 'miniboss' || name === 'miniboss-arrival') {
          state.wave = state.campaign.stage = 1; state.player.level = 3;
          state.waveTime = state.campaign.stageElapsed = 90 - 1 / 60; state.campaign.progression = 90 - 1 / 60;
          state.pickups.push({ id: 900001, type: 'support', x: state.player.x, y: state.player.y, value: 2, age: 0 });
        }
        if (name === 'arsenal') {
          state.wave = 4; state.player.level = 5; state.spawnTimer = 3600;
          state.pickups.push({ id: 900001, type: 'support', x: 2000, y: 2000, value: 3, age: 0 });
          for (const [index, type] of (['hp', 'supply', 'coolant', 'bomb', 'miniBomb', 'blackHole', 'support'] as const).entries()) {
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
      start: this.start, upgrade: this.chooseUpgrade, reroll: this.rerollUpgrades, menu: this.returnToMenu,
      advanceStage: () => { const state = this.simulation.state; if (state.campaign.phase !== 'stage') return; state.waveTime = state.campaign.stageElapsed = (CAMPAIGN_STAGES[state.campaign.stage - 1]?.duration ?? 60) - 1 / 60; state.campaign.progression = CAMPAIGN_STAGES.slice(0, state.campaign.stage - 1).reduce((sum, stage) => sum + stage.duration, 0) + state.waveTime; },
      damageEnemy: (id, amount) => { const enemy = this.simulation.state.enemies.find(item => item.id === id); if (enemy) this.simulation.damageEnemy(enemy, amount); },
      practice: options => {
        this.stopLoop(); this.audio.stop(); this.input.clear(); this.renderer?.resetEffects();
        const season = options?.season ?? 's2';
        this.practiceRun = true; this.runId = crypto.randomUUID();
        this.simulation.reset(options?.mode ?? 'endless', 20260912, this.difficulty, { difficulty: this.difficulty });
        const state = this.simulation.state;
        state.seasonId = season; state.player.level = 8;
        state.pickups.push({ id: 900001, type: 'support', x: state.player.x, y: state.player.y, value: 3, age: 0 });
        state.build.modules = [...new Set(options?.modules ?? [])].filter(id => id in MODULES).slice(0, 6);
        state.build.ranks = Object.fromEntries(state.build.modules.map(id => [id, options?.ranks?.[id] === 2 ? 2 : 1]));
        state.build.evolutions = [...new Set(options?.evolutions ?? [])].filter(id => {
          const recipe = EVOLUTIONS[id];
          return recipe && state.build.ranks[recipe.primary] === 2 && state.build.modules.includes(recipe.partner);
        }).slice(0, 2);
        state.build.choiceIndex = state.build.modules.length;
        state.player.invincible = 3600;
        if (options?.cardIndex !== undefined || options?.encounter) {
          const encounter = options.encounter ?? 'boss';
          const id = encounter === 'palisade' ? 's2:palisade' : encounter === 'reprise' ? 's2:reprise' : encounter === 'miniboss' ? 's1:echo' : season === 's1' ? 's1:mafuyu' : 's2:final';
          state.campaign.stage = state.wave = id === 's1:echo' ? 1 : id === 's2:palisade' ? 2 : id === 's1:mafuyu' ? 3 : id === 's2:reprise' ? 4 : 5;
          state.campaign.phase = 'encounter'; state.campaign.activeEncounter = id;
          state.campaign.progression = [90, 180, 240, 300, 360][state.campaign.stage - 1];
          const enemy = this.simulation.spawnEnemy(encounter, 2000, 1800, id);
          if (enemy) enemy.encounterId = id;
          if (enemy?.spell) { enemy.spell.cardIndex = Math.max(0, Math.min(5, Math.floor(options.cardIndex ?? 0))); enemy.hp = enemy.maxHp = spellCardDefinition(enemy, this.difficulty).hp; }
        }
        this.phase = state.status; this.dialogue.start(); this.resetMetrics(); this.publish();
        if (this.phase === 'playing') this.audio.play(); this.schedule();
      },
    };
  }
}
export interface DebugControls {
  snapshot(): HudSnapshot; state(): WorldState; stress(): void; scenario(name: DebugScenario): void;
  lifecycle(): { rafActive: boolean; phase: GamePhase; listeners: number; disposed: boolean; contextLost: boolean };
  pause(): void; resume(): void; restart(): void; settings(settings: Partial<GameSettings>): void;
  difficulty(difficulty: Difficulty): void;
  start(options?: Partial<RunStartOptions>): void; upgrade(id: UpgradeChoiceId, offerId?: string): void; reroll(): void; menu(): void;
  advanceStage(): void; damageEnemy(id: number, amount: number): void;
  practice(options?: { season?: SeasonId; mode?: 'story' | 'endless'; modules?: ModuleId[]; ranks?: Partial<Record<ModuleId, 1 | 2>>; evolutions?: EvolutionId[]; cardIndex?: number; encounter?: EnemyType }): void;
}
export type DebugScenario = 'boss' | 'boss-laser' | 'boss-nova' | 'boss-bombard' | 'miniboss' | 'miniboss-arrival' | 'enemy-tactics' | 'failed' | 'complete' | 'boss-warning' | 'arsenal';
type DebugWindow = Window & { __MAFUYU_DEBUG__?: DebugControls };

function miniBossAction(state: string): string {
  if (state === 'charge') return '连续突进锁向 · 横向避开';
  if (state === 'dash') return '追猎突进 · 留意落点弹幕';
  if (state === 'laserWarmup') return '激光锁定 · 离开橙色走廊';
  if (state === 'laser') return '连锁激光 · 继续换位';
  if (state === 'phaseShift') return '回声加速 · 准备连招';
  if (state === 'recover') return '出招间隙 · 集火反击';
  return '游猎回声 · 注意侧翼';
}
