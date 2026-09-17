import { STEP } from './config';

/** A single scheduler owns simulation. Render refresh never changes game speed. */
export class FixedClock {
  private previous: number | null = null;
  private accumulator = 0;
  advance(timestampMs: number, update: (dt: number) => boolean | void) {
    if (this.previous === null) { this.previous = timestampMs; return 0; }
    const elapsed = Math.max(0, Math.min(0.1, (timestampMs - this.previous) / 1000));
    this.previous = timestampMs;
    this.accumulator = Math.min(0.1, this.accumulator + elapsed);
    let steps = 0;
    while (this.accumulator + 1e-10 >= STEP && steps < 6) {
      this.accumulator = Math.max(0, this.accumulator - STEP);
      steps++;
      if (update(STEP) === false) { this.accumulator = 0; break; }
    }
    return Math.min(1, this.accumulator / STEP);
  }
  reset() { this.previous = null; this.accumulator = 0; }
}

/** Limits presentation only; FixedClock must still receive every host animation frame. */
export class RenderGate {
  private next: number | null = null;
  private rate: number | null = null;
  ready(timestamp: number, rate: number | null): boolean {
    if (rate === null) { this.reset(); return true; }
    if (this.next === null || rate !== this.rate) { this.rate = rate; this.next = timestamp + 1000 / rate; return true; }
    if (timestamp + 1e-6 < this.next) return false;
    const period = 1000 / rate;
    this.next += Math.max(1, Math.floor((timestamp - this.next + 1e-6) / period) + 1) * period;
    return true;
  }
  reset(): void { this.next = this.rate = null; }
}
