/** Fullscreen failure is visible; optional orientation-lock failure is not fatal. */
export async function requestGameFullscreen(shell: HTMLElement): Promise<void> {
  if (document.fullscreenElement !== shell) {
    if (typeof shell.requestFullscreen !== 'function') {
      throw new Error('当前浏览器不支持全屏，可直接横屏游玩。');
    }
    try {
      // Call synchronously up to the first await, preserving the user's activation.
      await shell.requestFullscreen();
    } catch {
      throw new Error('浏览器未允许进入全屏，可直接横屏游玩或再次尝试。');
    }
  }
  const orientation = window.screen?.orientation as (ScreenOrientation & { lock?: (value: string) => Promise<void> }) | undefined;
  if (document.fullscreenElement === shell && typeof orientation?.lock === 'function') {
    try { await orientation.lock('landscape'); } catch { /* Fullscreen remains useful without orientation lock. */ }
  }
}
