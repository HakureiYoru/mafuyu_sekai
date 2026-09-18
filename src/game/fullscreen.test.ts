import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestGameFullscreen } from './fullscreen';

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const doc: { fullscreenElement: Element | null } = { fullscreenElement: null };
  const lock = vi.fn(async () => {});
  const shell = { requestFullscreen: vi.fn(async () => { doc.fullscreenElement = shell as unknown as HTMLElement; }) };
  vi.stubGlobal('document', doc); vi.stubGlobal('window', { screen: { orientation: { lock } } });
  return { doc, lock, shell, element: shell as unknown as HTMLElement };
}
describe('fullscreen feedback', () => {
  it('reports unavailable fullscreen instead of silently resolving', async () => {
    fixture(); await expect(requestGameFullscreen({} as HTMLElement)).rejects.toThrow('不支持全屏');
  });
  it('reports rejected requests without trying orientation lock', async () => {
    const f = fixture(); f.shell.requestFullscreen.mockRejectedValue(new Error('NotAllowedError'));
    await expect(requestGameFullscreen(f.element)).rejects.toThrow('未允许进入全屏');
    expect(f.lock).not.toHaveBeenCalled();
  });
  it('enters fullscreen and attempts landscape lock', async () => {
    const f = fixture(); await requestGameFullscreen(f.element);
    expect(f.shell.requestFullscreen).toHaveBeenCalledTimes(1); expect(f.lock).toHaveBeenCalledWith('landscape');
  });
  it('does not request fullscreen again for the current shell', async () => {
    const f = fixture(); f.doc.fullscreenElement = f.element; await requestGameFullscreen(f.element);
    expect(f.shell.requestFullscreen).not.toHaveBeenCalled();
  });
  it('does not misreport successful fullscreen as failure when lock is rejected', async () => {
    const f = fixture(); f.lock.mockRejectedValue(new Error('NotSupportedError'));
    await expect(requestGameFullscreen(f.element)).resolves.toBeUndefined();
    expect(f.doc.fullscreenElement).toBe(f.element);
  });
  it('works without an orientation API', async () => {
    const f = fixture(); vi.stubGlobal('window', {});
    await expect(requestGameFullscreen(f.element)).resolves.toBeUndefined();
  });
});
