import type { CombatEvent, GameSettings } from './types';

interface Voice { source: AudioBufferSourceNode; gain: GainNode; priority: number }
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private music: AudioBufferSourceNode | null = null;
  private musicWanted = false;
  private buffers = new Map<string, AudioBuffer>();
  private encoded = new Map<string, ArrayBuffer>();
  private voices = new Set<Voice>();
  private last = new Map<string, number>();
  private abort = new AbortController();
  private preparing: Promise<void> | null = null;
  private disposed = false;
  constructor(private settings: GameSettings) {}
  async preload() {
    await Promise.allSettled([['shot', 'sound/shot.wav'], ['music', 'assets/music/bg.mp3']].map(async ([key, path]) => {
      const result = await fetch(`${import.meta.env.BASE_URL}${path}`, { signal: this.abort.signal });
      if (!result.ok) throw new Error(`Audio ${key}: ${result.status}`);
      this.encoded.set(key, await result.arrayBuffer());
    }));
  }
  /** Invoked synchronously from a user gesture, including the first ctx.resume(). */
  play() {
    this.musicWanted = true;
    if (this.disposed) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain(); this.musicBus = this.context.createGain(); this.sfxBus = this.context.createGain();
        this.limiter = this.context.createDynamicsCompressor();
        this.limiter.threshold.value = -8; this.limiter.ratio.value = 8;
        this.musicBus.connect(this.master); this.sfxBus.connect(this.master);
        this.master.connect(this.limiter); this.limiter.connect(this.context.destination);
        this.synthesise(); this.setSettings(this.settings);
      }
      void this.context.resume().catch(() => {});
      this.preparing ??= this.decode();
      void this.preparing.then(() => { if (!this.disposed && this.musicWanted) this.startMusic(); });
    } catch { /* Audio unavailable: the complete game remains playable silently. */ }
  }
  private async decode() {
    const context = this.context;
    if (!context) return;
    await Promise.allSettled([...this.encoded].map(async ([key, bytes]) => { this.buffers.set(key, await context.decodeAudioData(bytes.slice(0))); }));
    this.encoded.clear();
  }
  private synthesise() {
    if (!this.context) return;
    const sampleRate = this.context.sampleRate;
    const make = (key: string, seconds: number, generator: (time: number, progress: number) => number) => {
      const buffer = this.context!.createBuffer(1, Math.ceil(sampleRate * seconds), sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < channel.length; i++) channel[i] = generator(i / sampleRate, i / channel.length);
      this.buffers.set(key, buffer);
    };
    let noiseSeed = 781;
    const noise = () => { noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0; return noiseSeed / 2147483648 - 1; };
    make('impact', 0.075, (t, p) => (Math.sin(t * 1100) * 0.3 + noise() * 0.22) * (1 - p) ** 3);
    make('kill', 0.23, (t, p) => (noise() * 0.5 + Math.sin(t * 360 * (1 - p)) * 0.3) * (1 - p) ** 3);
    make('bomb', 0.8, (t, p) => (noise() * 0.35 + Math.sin(t * 210 * (1 - p)) * 0.4) * (1 - p) ** 3);
    make('dash', 0.2, (t, p) => (Math.sin(t * (2500 - p * 1800)) * 0.2 + noise() * 0.1) * Math.sin(p * Math.PI));
    make('damage', 0.3, (t, p) => (Math.sin(t * 580) + Math.sin(t * 410)) * 0.2 * (1 - p) ** 2);
    make('pickup', 0.16, (t, p) => Math.sin(t * (p < 0.45 ? 4000 : 6200)) * 0.18 * (1 - p) ** 2);
    make('levelup', 0.45, (t, p) => Math.sin(t * [3200, 4000, 4800, 6400][Math.min(3, Math.floor(p * 4))]) * 0.2 * (1 - p));
    make('warning', 0.5, (t, p) => Math.sin(t * 1700) * (Math.sin(p * Math.PI * 4) > 0 ? 0.2 : 0) * (1 - p));
    make('beam', 0.42, (t, p) => (Math.sin(t * (2800 - 1800 * p)) * 0.22 + Math.sin(t * 310) * 0.26 + noise() * 0.18) * Math.min(1, p * 35) * (1 - p) ** 1.6);
    make('support', 0.38, (t, p) => (Math.sin(t * (p < 0.5 ? 3600 : 5400)) * 0.18 + Math.sin(t * 1800) * 0.08) * Math.sin(p * Math.PI));
    make('drone', 0.06, (t, p) => Math.sin(t * (4600 - 1600 * p)) * 0.15 * (1 - p) ** 2);
  }
  private startMusic() {
    const buffer = this.buffers.get('music');
    if (this.music || !this.context || !this.musicBus || !buffer) return;
    const source = this.context.createBufferSource(); source.buffer = buffer; source.loop = true;
    source.connect(this.musicBus); source.start(); this.music = source;
  }
  private sound(name: string, volume: number, priority: number, minGap: number) {
    const context = this.context, buffer = this.buffers.get(name);
    if (!context || context.state !== 'running' || !this.sfxBus || !buffer) return;
    if (context.currentTime - (this.last.get(name) ?? -100) < minGap) return;
    if (this.voices.size >= 24) {
      let lowest: Voice | null = null;
      for (const voice of this.voices) if (!lowest || voice.priority < lowest.priority) lowest = voice;
      if (!lowest || lowest.priority >= priority) return;
      this.stopVoice(lowest);
    }
    this.last.set(name, context.currentTime);
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; gain.gain.value = volume;
    source.connect(gain); gain.connect(this.sfxBus);
    const voice = { source, gain, priority }; this.voices.add(voice);
    source.onended = () => { source.onended = null; source.disconnect(); gain.disconnect(); this.voices.delete(voice); };
    source.start();
  }
  handle(events: CombatEvent[]) {
    for (const event of events) {
      if (event.type === 'shot') {
        if (event.text === 'drone') this.sound('drone', 0.18, 0, 0.12);
        else this.sound('shot', 0.24, 2, 0.035);
      }
      else if (event.type === 'beam') this.sound('beam', 0.8, 4, 0.15);
      else if (event.type === 'support') this.sound('support', 0.6, 3, 0.4);
      else if (event.type === 'enemyShot') this.sound('shot', 0.065, 0, 0.1);
      else if (event.type === 'hit') this.sound('impact', 0.25, 1, 0.045);
      else if (event.type === 'kill') this.sound('kill', 0.35, 1, 0.075);
      else if (event.type === 'dash') this.sound('dash', 0.6, 3, 0.1);
      else if (event.type === 'bomb') this.sound('bomb', 0.8, 4, 0.2);
      else if (event.type === 'damage') this.sound('damage', 0.8, 5, 0.1);
      else if (event.type === 'pickup') this.sound('pickup', 0.4, 1, 0.12);
      else if (event.type === 'levelup' || event.type === 'complete') this.sound('levelup', 0.65, 4, 0.1);
      else if (event.type === 'boss') this.sound('warning', 0.7, 5, 0.2);
    }
  }
  setSettings(settings: GameSettings) {
    this.settings = settings;
    const now = this.context?.currentTime ?? 0;
    this.master?.gain.setTargetAtTime(settings.masterVolume, now, 0.035);
    this.musicBus?.gain.setTargetAtTime(settings.musicVolume, now, 0.035);
    this.sfxBus?.gain.setTargetAtTime(settings.sfxVolume, now, 0.035);
  }
  private stopVoice(voice: Voice) { voice.source.onended = null; try { voice.source.stop(); } catch { /* already ended */ } voice.source.disconnect(); voice.gain.disconnect(); this.voices.delete(voice); }
  pause() { for (const voice of [...this.voices]) this.stopVoice(voice); void this.context?.suspend().catch(() => {}); }
  finish() {
    this.musicWanted = false;
    if (this.music) { try { this.music.stop(); } catch { /* already stopped */ } this.music.disconnect(); this.music = null; }
  }
  stop() {
    this.finish();
    for (const voice of [...this.voices]) this.stopVoice(voice);
    this.last.clear();
  }
  get voiceCount() { return this.voices.size; }
  destroy() { this.disposed = true; this.abort.abort(); this.stop(); void this.context?.close().catch(() => {}); this.buffers.clear(); this.encoded.clear(); }
}
