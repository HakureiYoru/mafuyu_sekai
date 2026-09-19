import { afterEach, describe, expect, it, vi } from 'vitest';
import { RENDER_PIXEL_BUDGET, resolveRenderResolution, watchDevicePixelRatio } from './render-resolution';

afterEach(() => vi.unstubAllGlobals());
describe('bounded high-density rendering', () => {
  it('uses a 2560x1440 buffer for 1280x720 desktop at DPR 2 on medium', () => {
    expect(resolveRenderResolution(1280, 720, 2, 'medium', 'keyboardMouse')).toBeCloseTo(1.6);
  });
  it('raises touch low quality to a bounded 720p buffer, not 540p', () => {
    expect(resolveRenderResolution(844, 475, 3, 'low', 'touch')).toBeCloseTo(0.8);
  });
  it('does not supersample a normal-density display', () => {
    expect(resolveRenderResolution(1600, 900, 1, 'high', 'keyboardMouse')).toBe(1);
  });
  it('fits the smaller viewport dimension without changing the logical aspect ratio', () => {
    expect(resolveRenderResolution(1200, 450, 1, 'high', 'keyboardMouse')).toBe(0.5);
  });
  it('caps extreme viewports and DPR at each tier budget', () => {
    for (const mode of ['touch', 'keyboardMouse'] as const) for (const quality of ['low', 'medium', 'high'] as const) {
      const scale = resolveRenderResolution(10000, 10000, 10, quality, mode);
      expect(1600 * 900 * scale * scale).toBeLessThanOrEqual(RENDER_PIXEL_BUDGET[mode][quality] + 0.01);
    }
  });
  it('sanitizes hidden or invalid viewport measurements', () => {
    for (const value of [0, -1, NaN, Infinity]) {
      const scale = resolveRenderResolution(value, value, value, 'low', 'touch');
      expect(Number.isFinite(scale)).toBe(true); expect(scale).toBeGreaterThan(0);
    }
  });
  it('re-arms the DPR query and removes its listener on disposal', () => {
    const first = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const second = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const matchMedia = vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
    const browser = { devicePixelRatio: 1, matchMedia };
    vi.stubGlobal('window', browser);
    const changed = vi.fn(), stop = watchDevicePixelRatio(changed);
    const handler = first.addEventListener.mock.calls[0][1] as () => void;
    browser.devicePixelRatio = 2; handler();
    expect(first.removeEventListener).toHaveBeenCalledWith('change', handler);
    expect(matchMedia).toHaveBeenLastCalledWith('(resolution: 2dppx)'); expect(changed).toHaveBeenCalledTimes(1);
    stop(); expect(second.removeEventListener).toHaveBeenCalledWith('change', handler);
    handler(); expect(changed).toHaveBeenCalledTimes(1);
  });
});
