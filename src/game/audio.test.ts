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
  state = 'suspended';
  onstatechange: (() => void) | null = null;
  decodeCount = 0;
  sampleRate = 8000;
  destination = {};
  gains: Gain[] = [];
  sources: Source[] = [];
  constructor() { Context.current = this; }
  createGain() { const gain = new Gain(); this.gains.push(gain); return gain; }
  createDynamicsCompressor() { return { threshold: new Param(), ratio: new Param(), connect() {} }; }
  createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  async decodeAudioData(_bytes: ArrayBuffer) { this.decodeCount++; return this.createBuffer(1, 16); }
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

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const response = (length = 8) => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(length) }) as Response;
function delayedAssets() {
  audio.destroy();
  const shot = deferred<Response>(), music = deferred<Response>();
  const fetcher = vi.fn((url: string) => url.endsWith('shot.wav') ? shot.promise : music.promise);
  vi.stubGlobal('fetch', fetcher); audio = new GameAudio(DEFAULT_GAME_SETTINGS);
  return { shot, music, fetcher };
}

describe('mobile unlock with independent late audio assets', () => {
  it('reports a system interruption while active, without treating ordinary pause suspension as another interruption', async () => {
    audio.destroy();
    const interrupted = vi.fn(() => audio.pause());
    audio = new GameAudio(DEFAULT_GAME_SETTINGS, interrupted);
    await audio.preload(); audio.play();
    const context = Context.current;
    await vi.waitFor(() => expect(context.sources.some(source => source.loop)).toBe(true));
    context.state = 'interrupted'; context.onstatechange?.();
    expect(interrupted).toHaveBeenCalledTimes(1); expect(context.state).toBe('suspended');
    context.onstatechange?.(); expect(interrupted).toHaveBeenCalledTimes(1);
    audio.play(); await Promise.resolve();
    expect(context.state).toBe('running'); expect(context.sources.filter(source => source.loop)).toHaveLength(1);
    audio.pause(); context.onstatechange?.(); expect(interrupted).toHaveBeenCalledTimes(1);
  });
  it('unlocks immediately and decodes late shots without waiting for music, exactly once per asset', async () => {
    const assets = delayedAssets(), loading = audio.preload(); audio.play();
    const context = Context.current; expect(context.state).toBe('running'); expect(context.sources).toHaveLength(0);
    expect(audio.preload()).toBe(loading); expect(assets.fetcher).toHaveBeenCalledTimes(2);
    assets.shot.resolve(response());
    await vi.waitFor(() => { audio.handle([{ type: 'shot', x: 0, y: 0 }]); expect(audio.voiceCount).toBe(1); });
    expect(context.sources.some(source => source.loop)).toBe(false); expect(context.decodeCount).toBe(1);
    assets.music.resolve(response(16)); await loading;
    expect(context.sources.filter(source => source.loop)).toHaveLength(1); expect(context.decodeCount).toBe(2);
    audio.play(); audio.play(); await audio.preload();
    expect(context.decodeCount).toBe(2); expect(context.sources.filter(source => source.loop)).toHaveLength(1);
  });

  it('does not start late music or effects during pause and resumes the cached assets on the next gesture', async () => {
    const assets = delayedAssets(), loading = audio.preload(); audio.play(); audio.pause();
    const context = Context.current;
    assets.music.resolve(response(16)); assets.shot.resolve(response()); await loading;
    audio.handle([{ type: 'shot', x: 0, y: 0 }, { type: 'damage', x: 0, y: 0 }]);
    expect(context.sources).toHaveLength(0); expect(audio.voiceCount).toBe(0);
    audio.play(); await Promise.resolve();
    expect(context.sources.filter(source => source.loop)).toHaveLength(1); expect(context.decodeCount).toBe(2);
  });

  it('retries interrupted or rejected resume calls without creating a second music loop', async () => {
    const context = Context.current;
    context.state = 'interrupted';
    const resume = vi.spyOn(context, 'resume').mockRejectedValueOnce(new Error('user gesture required'));
    audio.play(); await Promise.resolve();
    audio.handle([{ type: 'shot', x: 0, y: 0 }]); expect(audio.voiceCount).toBe(0);
    audio.play(); await Promise.resolve();
    expect(resume).toHaveBeenCalledTimes(2); expect(context.state).toBe('running');
    audio.handle([{ type: 'shot', x: 0, y: 0 }]); expect(audio.voiceCount).toBe(1);
    expect(context.sources.filter(source => source.loop)).toHaveLength(1);
  });

  it('does not let an in-flight resume override a later pause', async () => {
    const context = Context.current, resumed = deferred<void>();
    vi.spyOn(context, 'resume').mockImplementationOnce(async () => { await resumed.promise; context.state = 'running'; });
    audio.play(); audio.pause(); resumed.resolve();
    await vi.waitFor(() => expect(context.state).toBe('suspended'));
    await Promise.resolve(); await Promise.resolve();
    expect(context.state).toBe('suspended'); expect(context.sources.filter(source => source.loop)).toHaveLength(1);
    audio.handle([{ type: 'damage', x: 0, y: 0 }]); expect(audio.voiceCount).toBe(0);
  });

  it('deduplicates an in-flight decode across repeated play gestures and ignores its completion after destroy', async () => {
    const assets = delayedAssets(), decoded = deferred<ReturnType<Context['createBuffer']>>();
    const loading = audio.preload(); audio.play(); const context = Context.current;
    const decode = vi.spyOn(context, 'decodeAudioData').mockImplementation(() => decoded.promise);
    assets.music.resolve(response(16));
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
    audio.play(); audio.play(); expect(decode).toHaveBeenCalledTimes(1);
    audio.destroy(); decoded.resolve(context.createBuffer(1, 16)); assets.shot.resolve(response()); await loading;
    audio.play(); audio.handle([{ type: 'damage', x: 0, y: 0 }]);
    expect(context.state).toBe('closed'); expect(context.sources).toHaveLength(0); expect(context.onstatechange).toBeNull();
    expect(audio.voiceCount).toBe(0);
  });

  it('settles aborted or failed asset loading without an unhandled rejection or a blocked usable asset', async () => {
    const assets = delayedAssets(), loading = audio.preload(); audio.play();
    assets.shot.reject(new DOMException('Aborted', 'AbortError')); assets.music.resolve(response(16));
    await expect(loading).resolves.toBeUndefined();
    expect(Context.current.sources.filter(source => source.loop)).toHaveLength(1);
    const again = delayedAssets(), pending = audio.preload(); audio.destroy();
    again.shot.reject(new DOMException('Aborted', 'AbortError')); again.music.reject(new Error('offline'));
    await expect(pending).resolves.toBeUndefined();
  });

  it('retries a rejected asset decode on a later user gesture without decoding the successful asset twice', async () => {
    const assets = delayedAssets(), loading = audio.preload(); audio.play();
    const context = Context.current;
    const decode = vi.spyOn(context, 'decodeAudioData').mockRejectedValueOnce(new Error('temporary decoder failure'));
    assets.shot.resolve(response());
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
    assets.music.resolve(response(16)); await loading;
    expect(context.sources.filter(source => source.loop)).toHaveLength(1);
    audio.play();
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(3));
    audio.handle([{ type: 'shot', x: 0, y: 0 }]); expect(audio.voiceCount).toBe(1);
    audio.play(); expect(decode).toHaveBeenCalledTimes(3);
    expect(context.sources.filter(source => source.loop)).toHaveLength(1);
  });
});
