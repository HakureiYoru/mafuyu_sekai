import { VIEW } from './config';
import type { GameSettings, ResolvedControlMode } from './types';

/** Physical-pixel budgets, independent of particle/star counts. No supersampling. */
export const RENDER_PIXEL_BUDGET = {
  touch: { low: 1280 * 720, medium: 1600 * 900, high: 1920 * 1080 },
  keyboardMouse: { low: 1920 * 1080, medium: 2560 * 1440, high: 2880 * 1620 },
} as const;
const positive = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;

export function resolveRenderResolution(width: number, height: number, devicePixelRatio: number,
  quality: GameSettings['quality'], mode: ResolvedControlMode): number {
  const cssScale = Math.min(positive(width, 1) / VIEW.width, positive(height, 1) / VIEW.height);
  const density = Math.min(positive(devicePixelRatio, 1), mode === 'touch' ? 2 : 2.5);
  const budgetScale = Math.sqrt(RENDER_PIXEL_BUDGET[mode][quality] / (VIEW.width * VIEW.height));
  return Math.max(1 / VIEW.height, Math.min(cssScale * density, budgetScale));
}

/** DPR can change without a ResizeObserver event when moving between monitors. */
export function watchDevicePixelRatio(onChange: () => void): () => void {
  let query: MediaQueryList | undefined;
  let disposed = false;
  const listen = () => {
    query?.removeEventListener?.('change', changed);
    query = window.matchMedia(`(resolution: ${positive(window.devicePixelRatio, 1)}dppx)`);
    query.addEventListener?.('change', changed);
  };
  const changed = () => {
    if (disposed) return;
    listen();
    onChange();
  };
  listen();
  return () => { disposed = true; query?.removeEventListener?.('change', changed); };
}
