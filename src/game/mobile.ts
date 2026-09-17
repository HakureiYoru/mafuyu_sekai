import { VIEW } from './config';
import type { ControlMode, ResolvedControlMode } from './types';

export function resolveControlMode(mode: ControlMode): ResolvedControlMode {
  if (mode !== 'auto') return mode;
  return window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(hover: none)').matches ? 'touch' : 'keyboardMouse';
}

/** The visual viewport follows mobile browser chrome; never rotate the canvas in CSS. */
export function viewportSize(): { width: number; height: number } {
  const width = window.visualViewport?.width ?? window.innerWidth;
  const height = window.visualViewport?.height ?? window.innerHeight;
  return { width: Number.isFinite(width) && width > 0 ? width : VIEW.width,
    height: Number.isFinite(height) && height > 0 ? height : VIEW.height };
}
