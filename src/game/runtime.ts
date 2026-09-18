import { DEFAULT_SETTINGS, ENEMIES, VIEW, xpNeeded } from './config';
import { FixedClock, RenderGate } from './clock';
import { InputController } from './input';
import { TouchInputController } from './touch-input';
import { resolveControlMode, viewportSize } from './mobile';
import { GameAudio } from './audio';
import { Dialogue } from './dialogue';
import { GameSimulation } from './simulation';
import { CAMPAIGN_STAGES } from './campaign';
import { ELITE_GROUPS } from './elite-ai';
import { PROFILE_KEY, PROFILE_BACKUP_KEY, SaveRepository } from './profile';
import { SPELL_CARDS, spellCardDefinition } from './spellcards';
import { MODULES, EVOLUTIONS } from './upgrades';
import { keyLabel, normalizeSettings } from './settings';
import type { GameRenderer } from './renderer';
import type { CombatEvent, Difficulty, EnemyType, GamePhase, GameSettings, HudSnapshot, ModuleId, EvolutionId, UpgradeChoiceId, PerformanceStats, RunStartOptions, RuntimeControls, SeasonId, WorldState, ResolvedControlMode, TouchAction } from './types';

const SETTINGS_KEY = 'mafuyu-sekai:settings:v3';
const DIFFICULTY_KEY = 'mafuyu-sekai:difficulty:v3';
function loadDifficulty(): Difficulty { try { return localStorage.getItem(DIFFICULTY_KEY) === 'hard' ? 'hard' : 'normal'; } catch { return 'normal'; } }
export function validateSettings(raw: Partial<GameSettings>): GameSettings {
  return normalizeSettings(raw);
}
function loadSettings() {
  const defaults = { ...DEFAULT_SETTINGS, quality: resolveControlMode('auto') === 'touch' ? 'low' as const : DEFAULT_SETTINGS.quality,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches };
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (raw && typeof raw === 'object') return normalizeSettings(raw, defaults);
  } catch { /* Private mode or invalid previous preferences: defaults are safe. */ }
  return normalizeSettings(defaults);
}
const emptyStats = (): PerformanceStats => ({ fps: 0, renderFps: 0, simulationHz: 0, frameP95: 0, frameP99: 0, updateMs: 0, renderMs: 0, enemies: 0, bullets: 0, particles: 0, pickups: 0, voices: 0, textures: 0 });

export class GameRuntime implements RuntimeControls {
  private difficulty = loadDifficulty();
  private saves = new SaveRepository();
  private saveMessage = '';
  private runId = '';
  private practiceRun = false;
  private simulation = new GameSimulation(12345, this.difficulty);
  private renderer: GameRenderer | null = null;
  private input: InputController;
  private touch: TouchInputController;
  private shell: HTMLElement;
  private audio: GameAudio;
  private dialogue = new Dialogue();
  private clock = new FixedClock();
  private renderGate = new RenderGate();
  private settings = loadSettings();
  private controlMode: ResolvedControlMode = resolveControlMode(this.settings.controlMode);
  private orientationBlocked = false;
  private viewport = viewportSize();
  private phase: GamePhase = 'loading';
  private progress = 0;
  private error: string | null = null;
  private listeners = new Set<() => void>();
  private snapshot!: HudSnapshot;
  private raf: number | null = null;
  private disposed = false;
  private initialising = false;
  private initialised = false;
  private lastRender: number | null = null;
  private statsTick = 0;
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
    this.shell = host.parentElement instanceof HTMLElement ? host.parentElement : host;
    this.audio = new GameAudio(this.settings, () => this.pause());
    this.input = new InputController(host, () => this.phase === 'playing' && this.controlMode === 'keyboardMouse', () => this.pause(), () => {
      if (this.phase === 'playing') this.pause(); else if (this.phase === 'paused') this.resume();
    }, this.settings.keybindings);
    this.touch = new TouchInputController(this.shell, host, {
      enabled: () => this.controlMode === 'touch', active: () => this.phase === 'playing' && !this.orientationBlocked,
      world: () => this.simulation.state, query: (rect, output) => this.simulation.queryTouchTargets(rect, output),
      interrupt: () => this.pause(), change: () => { if (this.snapshot) this.publish(); },
    });
    this.updateViewport(false);
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.renderer || this.disposed) return;
      try { this.renderer.resize(); if (this.phase !== 'playing') this.renderer.render(this.simulation.state, 1, 0); } catch (error) { this.fail(error); }
    });
    this.resizeObserver.observe(host);
    window.addEventListener('resize', this.onViewportChange, { signal: this.abort.signal });
    window.addEventListener('orientationchange', this.onOrientationChange, { signal: this.abort.signal });
    window.visualViewport?.addEventListener('resize', this.onViewportChange, { signal: this.abort.signal });
    window.visualViewport?.addEventListener('scroll', this.onViewportChange, { signal: this.abort.signal });
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
      renderer.setControlMode(this.controlMode);
      void this.audio.preload().catch(() => { /* Music arriving later must not block play. */ });
      await renderer.init(ratio => { if (!this.disposed) { this.progress = 0.1 + ratio * 0.85; this.publish(); } });
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

  private clearInputs(): void { this.input.clear(); this.touch.clear(); this.simulation.clearInput(); this.renderer?.setTouchAim(null); }
  private onViewportChange = () => this.updateViewport(true);
  private onOrientationChange = () => {
    if (this.controlMode === 'touch') { this.clearInputs(); this.pause(); }
    this.updateViewport(true);
  };
  private updateViewport(notify: boolean): void {
    const viewport = viewportSize(), wasPortrait = this.viewport.height > this.viewport.width;
    const rotated = wasPortrait !== (viewport.height > viewport.width);
    const wasBlocked = this.orientationBlocked;
    this.viewport = viewport;
    this.orientationBlocked = this.controlMode === 'touch' && viewport.height > viewport.width;
    this.shell.dataset.controlMode = this.controlMode;
    this.shell.dataset.orientationBlocked = String(this.orientationBlocked);
    this.shell.style?.setProperty('--viewport-width', `${viewport.width}px`);
    this.shell.style?.setProperty('--viewport-height', `${viewport.height}px`);
    if (notify && this.controlMode === 'touch' && (rotated || wasBlocked !== this.orientationBlocked)) {
      this.clearInputs();
      if (this.phase === 'playing') this.pause();
    }
    if (notify) this.publish();
  }
  private refreshControlMode(): void {
    this.controlMode = resolveControlMode(this.settings.controlMode);
    this.renderer?.setControlMode(this.controlMode);
    this.updateViewport(false);
  }
  private guardOrientation(): void { if (this.phase === 'playing' && this.orientationBlocked) this.phase = 'paused'; }
  touchAction = (action: TouchAction): void => {
    if (action.type === 'clear') { this.touch.clear(); return; }
    if (this.phase !== 'playing' || this.controlMode !== 'touch' || this.orientationBlocked) return;
    this.touch.command(action); this.publish();
  };
  requestFullscreen = async (): Promise<void> => {
    try {
      if (!document.fullscreenElement && this.shell.requestFullscreen) await this.shell.requestFullscreen();
      const orientation = window.screen?.orientation as (ScreenOrientation & { lock?: (value: string) => Promise<void> }) | undefined;
      if (document.fullscreenElement && orientation?.lock) await orientation.lock('landscape');
    } catch { /* Optional enhancement: browser landscape remains playable without it. */ }
  };

  start = (options: Partial<RunStartOptions> = {}) => {
    if (this.disposed) return;
    if (!this.initialised || this.phase === 'error') { void this.retry(); return; }
    this.refreshControlMode();
    if (this.orientationBlocked) { this.publish(); return; }
    this.saves.mergeExternal();
    this.difficulty = options.difficulty === 'hard' || options.difficulty === 'normal' ? options.difficulty : this.difficulty;
    this.runId = crypto.randomUUID(); this.practiceRun = false;
    this.stopLoop(); this.audio.stop();
    this.simulation.reset('story', options.seed, this.difficulty, { difficulty: this.difficulty });
    this.clearInputs(); this.touch.reset(); this.renderer?.resetEffects(); this.dialogue.start();
    this.phase = this.simulation.state.status; this.error = null;
    if (this.phase === 'playing') this.audio.play();
    this.announce('Wonderhoy——！！');
    this.resetMetrics(); this.publish(); this.schedule();
    this.renderer?.render(this.simulation.state, 1, 0);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  restart = () => this.start();
  pause = () => {
    if (this.phase !== 'playing') return;
    this.phase = 'paused'; this.clearInputs(); this.stopLoop(); this.audio.pause(); this.publish();
  };
  resume = () => {
    if (this.phase !== 'paused' || this.disposed || this.orientationBlocked) return;
    this.phase = 'playing'; this.clearInputs(); this.audio.play(); this.publish(); this.schedule();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  continueEndless = () => {
    if (this.phase !== 'complete') return;
    this.simulation.continueEndless(); this.renderer?.resetEffects(); this.clearInputs(); this.dialogue.startEndless();
    this.phase = this.simulation.state.status;
    this.guardOrientation();
    if (this.phase === 'playing') this.audio.play(); else this.audio.pause();
    this.announce('无尽开始 / Wonderhoy 还没停'); this.renderer?.render(this.simulation.state, 1, 0); this.publish(); this.schedule();
  };
  returnToMenu = () => {
    if (this.phase === 'loading' || this.disposed) return;
    if (this.phase === 'playing' || this.phase === 'paused' || this.phase === 'upgrade') this.saveBest();
    this.stopLoop(); this.audio.stop(); this.clearInputs(); this.touch.reset(); this.dialogue.reset(); this.resetPreview();
    this.renderer?.resetEffects(); this.phase = 'menu'; this.announcement = '';
    this.renderer?.render(this.simulation.state, 1, 0); this.publish();
  };
  setSettings = (partial: Partial<GameSettings>) => {
    const canChangeControls = this.phase === 'menu' || this.phase === 'paused' || this.phase === 'loading';
    if (!canChangeControls) partial = { ...partial, controlMode: this.settings.controlMode };
    this.settings = validateSettings({ ...this.settings, ...partial });
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* Preferences still apply for this session. */ }
    this.audio.setSettings(this.settings); this.renderer?.setSettings(this.settings);
    this.input.setBindings(this.settings.keybindings);
    this.clearInputs();
    if (canChangeControls) this.refreshControlMode();
    this.renderGate.reset();
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
    this.stopLoop(); this.clearInputs();
    this.phase = this.simulation.state.status;
    this.guardOrientation();
    if (this.phase === 'playing') this.audio.play();
    this.publish(); this.schedule();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  rerollUpgrades = () => {
    if (this.phase !== 'upgrade' || this.disposed || !this.simulation.rerollUpgrades()) return;
    this.clearInputs(); this.publish();
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
    if (this.raf !== null || this.disposed || this.phase !== 'playing' || this.orientationBlocked) return;
    this.clock.reset(); this.renderGate.reset(); this.lastRender = null;
    this.lastStats = 0; this.statsTick = this.simulation.state.tick;
    this.raf = requestAnimationFrame(this.frame);
  }
  private frame = (timestamp: number) => {
    this.raf = null;
    if (this.disposed || this.phase !== 'playing' || !this.renderer) return;
    try {
      if (!this.lastStats) { this.lastStats = timestamp; this.statsTick = this.simulation.state.tick; }
      let urgent = false;
      const updateStart = performance.now();
      const alpha = this.clock.advance(timestamp, dt => {
        const camera = this.simulation.state.camera;
        const player = this.simulation.state.player;
        const previousReady = player.dashCooldown <= 0, previousOverheated = player.overheated, previousWindow = player.perfectWindow > 0, previousCharges = this.simulation.dashCharges;
        const previousMiniboss = this.simulation.state.enemies.find(enemy => enemy.role === 'miniboss');
        const previousMiniState = previousMiniboss?.state;
        const action = this.controlMode === 'touch' ? this.touch.read(dt) : this.input.read(camera.x - VIEW.width / 2, camera.y - VIEW.height / 2);
        const events = this.simulation.step(action, dt);
        urgent ||= previousReady !== (player.dashCooldown <= 0) || previousOverheated !== player.overheated || previousWindow !== (player.perfectWindow > 0)
          || previousCharges !== this.simulation.dashCharges || previousMiniState !== previousMiniboss?.state;
        this.dialogue.update(dt); this.processEvents(events);
        urgent ||= events.some(event => ['damage', 'dash', 'bomb', 'levelup', 'xpLoss', 'boss', 'complete', 'failure', 'support', 'card', 'upgrade', 'shieldBreak', 'interrupt'].includes(event.type)
          || event.type === 'attack' && (event.text === 'arrival' || event.text === 'core-exposed' || event.text?.startsWith('elite-arrival:')));
        const status = this.simulation.state.status;
        if (status !== 'playing') {
          this.phase = status;
          this.clearInputs();
          if (status === 'upgrade') this.audio.pause();
          else { this.saveBest(); this.audio.finish(); }
          return false;
        }
      });
      this.stats.updateMs = performance.now() - updateStart;
      if (this.phase !== 'playing' || this.renderGate.ready(timestamp, this.controlMode === 'touch' ? this.settings.touchFrameRate : null)) {
        const delta = this.lastRender !== null ? Math.min(0.1, (timestamp - this.lastRender) / 1000) : 0;
        if (this.lastRender !== null && timestamp - this.lastRender < 250) {
          this.frameTimes.push(timestamp - this.lastRender); if (this.frameTimes.length > 600) this.frameTimes.shift();
        }
        this.lastRender = timestamp;
        const renderStart = performance.now();
        this.renderer.setTouchAim(this.controlMode === 'touch' ? this.touch.aim : null);
        this.renderer.render(this.simulation.state, this.phase === 'playing' ? alpha : 1, delta);
        this.stats.renderMs = performance.now() - renderStart;
      }
      if (timestamp - this.lastStats > 1000) this.updateStats(timestamp);
      if (urgent || timestamp - this.lastHud >= 1000 / 15 || this.phase !== 'playing') { this.lastHud = timestamp; this.publish(); }
      if (this.phase === 'playing') this.raf = requestAnimationFrame(this.frame);
      else this.clock.reset();
    } catch (error) { this.fail(error); }
  };
  private processEvents(events: CombatEvent[]) {
    this.renderer?.handleEvents(events); this.audio.handle(events); this.dialogue.handle(events, this.simulation.state.score);
    for (const event of events) {
      if (event.type === 'wave' && this.simulation.state.mode === 'endless') this.announce('无尽 · 第 ' + this.simulation.state.wave + ' 波');
      else if (event.type === 'boss') this.announce(event.encounterId === 's2:final' ? 'LACUNA / 空白崩坏' : ENEMIES.boss.label);
      else if (event.type === 'card') this.announce(event.text === 'cleared' ? `符卡 ${event.amount ?? ''} 击破` : `符卡 ${event.amount ?? ''} / ${event.text ?? ''}`, event.text === 'cleared' ? 0.55 : 1.6);
      else if (event.type === 'levelup') this.announce(`武器 Lv${this.simulation.state.player.level} / 哇！更强了！`, 1.5);
      else if (event.type === 'support') this.announce(event.text === 'arrival' ? '小笑梦到场 · 靠近拾取子机' : event.text === 'catchup' ? `后台补给 · 武装提升至 Lv${event.amount ?? this.simulation.state.player.level}` : `小笑梦报到 ${event.amount ?? this.simulation.state.companions.length}/3 · 子机自动掩护`, 2.5);
      else if (event.type === 'attack' && event.enemyType === 'boss' && event.text === 'phase') this.announce(`第 ${event.amount} 阶段 · 压抑崩裂`, 1.6);
      else if (event.type === 'attack' && event.text === 'arrival' && ['miniboss', 'palisade', 'reprise'].includes(event.enemyType ?? '')) this.announce(ENEMIES[event.enemyType!].label, 1.6);
      else if (event.type === 'kill' && event.enemyType === 'miniboss') this.announce(this.simulation.state.mode === 'story' ? 'ECHO 击破 · 首领补给已领取' : 'ECHO 击破 · 下一波继续', 2);
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
  private stopLoop() { if (this.raf !== null) cancelAnimationFrame(this.raf); this.raf = null; this.clock.reset(); this.renderGate.reset(); this.lastRender = null; }
  private resetMetrics() { this.frameTimes = []; this.lastStats = 0; this.lastHud = -1000; this.stats = emptyStats(); }
  private updateStats(timestamp: number) {
    this.stats.simulationHz = (this.simulation.state.tick - this.statsTick) * 1000 / Math.max(1, timestamp - this.lastStats);
    this.statsTick = this.simulation.state.tick;
    this.lastStats = timestamp;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
    const mean = this.frameTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, this.frameTimes.length);
    this.stats.fps = mean > 0 ? 1000 / mean : 0; this.stats.frameP95 = percentile(0.95); this.stats.frameP99 = percentile(0.99);
    this.stats.renderFps = this.stats.fps;
  }
  private publish() {
    const state = this.simulation.state, player = state.player;
    const boss = state.enemies.find(enemy => enemy.role === 'boss' || enemy.type === 'boss');
    const miniboss = state.enemies.find(enemy => enemy.role === 'miniboss' || enemy.type === 'miniboss');
    const profile = this.saves.getProfile(), legacy = this.saves.getLegacyHistory(), legacyV5 = this.saves.getLegacyV5History();
    const elite = state.enemies.find(enemy => enemy.role === 'elite' && enemy.hp > 0);
    const card = boss?.spell ? spellCardDefinition(boss, state.difficulty) : null;
    const graphics = this.renderer?.getStats() ?? { particles: 0, textures: 0 };
    this.snapshot = {
      controlMode: this.controlMode, orientationBlocked: this.orientationBlocked, touch: { ...this.touch.hud },
      phase: this.phase, loading: this.progress, error: this.error, mode: state.mode,
      score: state.score, bestScore: profile.bestScores.v6[state.difficulty][state.mode], historicalBestScore: Math.max(legacy.bestScores.s1[state.difficulty], legacy.bestScores.s2[state.difficulty], legacyV5.bestScores[state.difficulty].story, legacyV5.bestScores[state.difficulty].endless), difficulty: state.difficulty, wave: state.wave, waveProgress: state.campaign.progression / 360, progression: state.campaign.progression,
      minibossHp: miniboss?.hp ?? 0, minibossMaxHp: miniboss?.maxHp ?? 0, minibossAction: miniboss ? `${ENEMIES[miniboss.type].label} · ${miniboss.type === 'miniboss' ? miniBossAction(miniboss.state) : miniboss.state === 'recover' ? '收招休息 · 集火反击' : miniboss.type === 'palisade' ? miniboss.season2?.lostArms.length === 2 ? '双扇弹幕 · 中间留有通路' : '优先破坏侧臂，穿过弹墙间隙' : '留意停驻弹的原路折返'}` : '',
      waveBlocked: this.simulation.isWaveBlocked(),
      elapsed: state.elapsed, kills: state.kills, hp: player.hp, maxHp: player.maxHp, hpReserve: player.hpReserve, bombs: player.bombs,
      level: player.level, xp: player.xp, xpNeeded: xpNeeded(player.level),
      moduleStates: this.simulation.moduleStates,
      recentUpgrade: this.simulation.recentUpgrade, eliteName: elite?.elite ? ELITE_GROUPS[elite.elite.stage - 1][elite.elite.variant].name : '', eliteHp: elite?.hp ?? 0, eliteMaxHp: elite?.maxHp ?? 0,
      heat: player.heat, overheated: player.overheated, dashCooldown: player.dashCooldown, perfectWindow: player.perfectWindow,
      bossHp: boss?.hp ?? 0, bossMaxHp: boss?.maxHp ?? 0, bossStage: state.bossStage || state.bossPending,
      bossPhase: boss?.spell ? Math.floor(boss.spell.cardIndex / 2) + 1 : 1, bossAction: boss?.spell ? boss.spell.stage === 'intro' ? '符卡切换 · 留意下一轮预告' : `${this.controlMode === 'touch' ? '点击慢移' : keyLabel(this.settings.keybindings.focus) + ' 慢移'} · 跟随弹幕变化换位` : '', focus: player.focus,
      companions: state.companions?.length ?? 0,
      comms: this.dialogue.getMessage(this.settings.reducedMotion), commsPrevious: this.dialogue.getPreviousMessage(), announcement: state.elapsed < this.announcementUntil ? this.announcement : '',
      settings: { ...this.settings }, stats: { ...this.stats, ...graphics, enemies: state.enemies.length, bullets: state.bullets.length, pickups: state.pickups.length, voices: this.audio.voiceCount },
      saveStatus: this.saves.status === 'session-only' ? 'session' : Object.keys(profile.clears).length || Object.values(profile.bestScores.v6).some(scores => scores.story || scores.endless) ? 'saved' : 'empty',
      saveMessage: this.saves.error ?? this.saveMessage,
      stageName: CAMPAIGN_STAGES[state.wave - 1]?.name ?? '无尽的空白', stageCount: CAMPAIGN_STAGES.length,
      cardName: card?.name ?? '', cardIndex: boss?.spell ? boss.spell.cardIndex + 1 : 0, cardCount: boss?.spell ? SPELL_CARDS[boss.spell.season][state.difficulty].length : 0,
      moduleRanks: { ...state.build.ranks }, evolutions: [...state.build.evolutions], rerollsRemaining: state.build.rerollsRemaining, choiceSource: state.build.pendingRewards[0]?.source ?? null, upgradeOfferId: state.build.offerId,
      arena: !!state.arena, modules: [...state.build.modules], upgradeChoices: [...state.build.choices], resonance: state.build.resonance, resonanceXp: state.build.resonanceXp, dashCharges: this.simulation.dashCharges,
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
    this.stopLoop(); this.clearInputs(); this.audio.stop(); this.phase = 'error';
    this.error = error instanceof Error ? error.message : '游戏遇到了一个问题，请重新加载。';
    console.error('Game stopped safely:', error); this.publish();
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true; this.stopLoop(); this.abort.abort(); this.resizeObserver.disconnect();
    this.input.destroy(); this.touch.destroy(); this.audio.destroy(); this.renderer?.destroy(); this.renderer = null; this.listeners.clear();
    if (this.debug) Reflect.deleteProperty(window, '__MAFUYU_DEBUG__');
  }
  private installDebug() {
    (window as DebugWindow).__MAFUYU_DEBUG__ = {
      snapshot: () => this.getSnapshot(),
      state: () => this.simulation.state,
      resources: () => this.simulation.resourceCounts,
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
      touch: this.touchAction,
      pause: this.pause, resume: this.resume, restart: this.restart, settings: this.setSettings, difficulty: this.setDifficulty,
      start: this.start, upgrade: this.chooseUpgrade, reroll: this.rerollUpgrades, menu: this.returnToMenu,
      advanceStage: () => { const state = this.simulation.state; if (state.campaign.phase !== 'stage') return; state.waveTime = state.campaign.stageElapsed = (CAMPAIGN_STAGES[state.campaign.stage - 1]?.duration ?? 60) - 1 / 60; state.campaign.progression = CAMPAIGN_STAGES.slice(0, state.campaign.stage - 1).reduce((sum, stage) => sum + stage.duration, 0) + state.waveTime; },
      damageEnemy: (id, amount) => { const enemy = this.simulation.state.enemies.find(item => item.id === id); if (enemy) this.simulation.damageEnemy(enemy, amount); },
      practice: options => {
        this.stopLoop(); this.audio.stop(); this.clearInputs(); this.touch.reset(); this.refreshControlMode(); this.renderer?.resetEffects();
        const season = options?.season ?? 's2';
        this.practiceRun = true; this.runId = crypto.randomUUID();
        this.simulation.reset(options?.mode ?? 'endless', 20260912, this.difficulty, { difficulty: this.difficulty });
        const state = this.simulation.state;
        state.seasonId = season; state.player.level = 8;
        state.pickups.push({ id: 900001, type: 'support', x: state.player.x, y: state.player.y, value: 3, age: 0 });
        state.build.modules = [...new Set(options?.modules ?? [])].filter(id => id in MODULES);
        state.build.ranks = Object.fromEntries(state.build.modules.map(id => [id, Math.max(1, Math.floor(Number.isFinite(options?.ranks?.[id]) ? options!.ranks![id]! : 1))]));
        state.build.evolutions = [...new Set(options?.evolutions ?? [])].filter(id => {
          const recipe = EVOLUTIONS[id];
          return recipe && (state.build.ranks[recipe.primary] ?? 0) >= 2 && state.build.modules.includes(recipe.partner);
        });
        this.simulation.refreshBuild();
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
        this.phase = state.status; this.guardOrientation(); this.dialogue.start(); this.resetMetrics(); this.publish();
        if (this.phase === 'playing') this.audio.play(); this.schedule();
      },
    };
  }
}
export interface DebugControls {
  touch(action: TouchAction): void;
  resources(): GameSimulation['resourceCounts'];
  snapshot(): HudSnapshot; state(): WorldState; stress(): void; scenario(name: DebugScenario): void;
  lifecycle(): { rafActive: boolean; phase: GamePhase; listeners: number; disposed: boolean; contextLost: boolean };
  pause(): void; resume(): void; restart(): void; settings(settings: Partial<GameSettings>): void;
  difficulty(difficulty: Difficulty): void;
  start(options?: Partial<RunStartOptions>): void; upgrade(id: UpgradeChoiceId, offerId?: string): void; reroll(): void; menu(): void;
  advanceStage(): void; damageEnemy(id: number, amount: number): void;
  practice(options?: { season?: SeasonId; mode?: 'story' | 'endless'; modules?: ModuleId[]; ranks?: Partial<Record<ModuleId, number>>; evolutions?: EvolutionId[]; cardIndex?: number; encounter?: EnemyType }): void;
}
export type DebugScenario = 'boss' | 'boss-laser' | 'boss-nova' | 'boss-bombard' | 'miniboss' | 'miniboss-arrival' | 'enemy-tactics' | 'failed' | 'complete' | 'boss-warning' | 'arsenal';
type DebugWindow = Window & { __MAFUYU_DEBUG__?: DebugControls };

function miniBossAction(state: string): string {
  if (state === 'charge') return '突进路线锁定 · 横向避开';
  if (state === 'aim') return '落地收招 · 趁机输出';
  if (state === 'dash') return '追猎突进 · 留意落点弹幕';
  if (state === 'laserWarmup') return '激光锁定 · 离开橙色走廊';
  if (state === 'laser') return '连锁激光 · 继续换位';
  if (state === 'phaseShift') return '狂躁加速 · 准备连招';
  if (state === 'recover') return '出招间隙 · 集火反击';
  return '阴影逼近 · 注意侧翼';
}
