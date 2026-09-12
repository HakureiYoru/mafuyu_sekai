import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameAudio } from './audio';
import { DEFAULT_GAME_SETTINGS } from './settings';

class Param {
  value = 1;
  ramps: { value: number; time: number }[] = [];
  cancelled: number[] = [];
  setTargetAtTime(value: number) { this.value = value; }
  setValueAtTime(value: number) { this.value = value; }
  cancelAndHoldAtTime(time: number) { this.cancelled.push(time); }
  cancelScheduledValues(time: number) { this.cancelled.push(time); this.ramps.length = 0; }
  linearRampToValueAtTime(value: number, time: number) { this.ramps.push({ value, time }); }
}
class Gain {
  gain = new Param();
  destinations: unknown[] = [];
  connect(destination: unknown) { this.destinations.push(destination); }
  disconnect() { this.destinations.length = 0; }
}
class Source {
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  destination: Gain | null = null;
  connect(destination: Gain) { this.destination = destination; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
  disconnect() { this.destination = null; }
}
class Context {
  static current: Context;
  currentTime = 10;
  state = 'running';
  sampleRate = 8000;
  destination = {};
  gains: Gain[] = [];
  sources: Source[] = [];
  constructor() { Context.current = this; }
  createGain() { const gain = new Gain(); this.gains.push(gain); return gain; }
  createDynamicsCompressor() { return { threshold: new Param(), ratio: new Param(), connect() {} }; }
  createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  async decodeAudioData() { return this.createBuffer(1, 16); }
  createBufferSource() { const source = new Source(); this.sources.push(source); return source; }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; }
}

let audio: GameAudio;
beforeEach(async () => {
  vi.stubGlobal('AudioContext', Context);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
  audio = new GameAudio(DEFAULT_GAME_SETTINGS);
  await audio.preload(); audio.play();
  await vi.waitFor(() => expect(Context.current.sources.some(source => source.loop)).toBe(true));
});
afterEach(() => { audio.destroy(); vi.unstubAllGlobals(); });

describe('event mixing and bounded Web Audio lifecycle', () => {
  it('never lets an enemy shot consume the player first-shot limiter', () => {
    audio.handle([{ type: 'enemyShot', x: 0, y: 0 }, { type: 'shot', x: 0, y: 0 }, { type: 'shot', x: 0, y: 0 }]);
    expect(audio.voiceCount).toBe(2);
    expect(Context.current.sources.filter(source => source.started && !source.loop).map(source => source.destination?.gain.value)).toEqual([0.065, 0.24]);
  });

  it('keeps 24 voices maximum and preempts low-priority fire for danger', () => {
    for (let i = 0; i < 40; i++) { Context.current.currentTime += 0.11; audio.handle([{ type: 'enemyShot', x: 0, y: 0 }]); }
    expect(audio.voiceCount).toBe(24);
    const previous = Context.current.sources.length;
    audio.handle([{ type: 'damage', x: 0, y: 0 }]);
    expect(audio.voiceCount).toBe(24);
    expect(Context.current.sources.length).toBe(previous + 1);
    expect(Context.current.sources.some(source => !source.loop && source.stopped)).toBe(true);
  });

  it('ducks music by 4 dB in 30 ms and recovers in 250 ms without changing SFX or saved volume', () => {
    const context = Context.current;
    const music = context.gains[1], duck = context.gains[2], sfx = context.gains[3];
    audio.handle([{ type: 'damage', x: 0, y: 0 }]);
    expect(duck.gain.ramps).toEqual([{ value: 10 ** (-4 / 20), time: 10.03 }, { value: 1, time: 10.28 }]);
    expect(music.gain.value).toBe(DEFAULT_GAME_SETTINGS.musicVolume);
    expect(sfx.gain.value).toBe(DEFAULT_GAME_SETTINGS.sfxVolume);
    expect(music.destinations).toEqual([duck]);
    context.currentTime = 10.2;
    audio.handle([{ type: 'attack', enemyType: 'sampler', text: 'windup', x: 0, y: 0 }]);
    expect(duck.gain.cancelled).toEqual([10, 10.2]);
    expect(duck.gain.ramps.at(-1)?.time).toBeCloseTo(10.48);
  });

  it('clears voices, duck automation and throttle history when paused or restarted', () => {
    audio.handle([{ type: 'damage', x: 0, y: 0 }, { type: 'shot', x: 0, y: 0 }]);
    audio.pause();
    expect(audio.voiceCount).toBe(0);
    expect(Context.current.gains[2].gain.ramps).toEqual([]);
    expect(Context.current.gains[2].gain.value).toBe(1);
    audio.play(); audio.handle([{ type: 'shot', x: 0, y: 0 }]);
    expect(audio.voiceCount).toBe(1);
    audio.stop(); expect(audio.voiceCount).toBe(0);
    expect(Context.current.sources.every(source => source.stopped)).toBe(true);
  });

  it('gives shield, weakpoint and interruption distinct buffered sounds', () => {
    audio.handle([{ type: 'hit', hitResult: 'shield', x: 0, y: 0 }, { type: 'hit', hitResult: 'weakpoint', x: 0, y: 0 }, { type: 'interrupt', x: 0, y: 0 }]);
    const sources = Context.current.sources.filter(source => !source.loop && source.started);
    expect(sources).toHaveLength(3);
    expect(new Set(sources.map(source => source.buffer)).size).toBe(3);
  });

  it('plays device explosions without an enemyType and separates card completion from a danger announcement', () => {
    audio.handle([{ type: 'attack', text: 'deviceBurst', x: 0, y: 0 }, { type: 'card', text: 'cleared', amount: 1, x: 0, y: 0 }, { type: 'card', text: '第2符卡', x: 0, y: 0 }]);
    const sources = Context.current.sources.filter(source => !source.loop && source.started);
    expect(sources).toHaveLength(3);
    expect(new Set(sources.map(source => source.buffer)).size).toBe(3);
  });
});
