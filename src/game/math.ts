import type { Vec2 } from './types';

export const TAU = Math.PI * 2;
export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function normalize(x: number, y: number): Vec2 {
  const length = Math.hypot(x, y);
  return length > 0.000001 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
}
export function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** First segment/circle impact in [0,1], or null. Handles start-inside and zero-length segments. */
export function segmentCircleHit(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, radius: number): number | null {
  const dx = bx - ax, dy = by - ay, ox = ax - cx, oy = ay - cy;
  const c = ox * ox + oy * oy - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a <= 1e-12) return null;
  const b = ox * dx + oy * dy;
  const discriminant = b * b - a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / a;
  return t >= 0 && t <= 1 ? t : null;
}

export interface BeamGeometry { x: number; y: number; endX: number; endY: number; angle: number; length: number; width: number; corners: number[] }
/** Both telegraph rendering and damage use this exact oriented rectangle. */
export function beamGeometry(x: number, y: number, angle: number, length: number, width: number): BeamGeometry {
  const dx = Math.cos(angle), dy = Math.sin(angle), nx = -dy * width / 2, ny = dx * width / 2;
  const endX = x + dx * length, endY = y + dy * length;
  return { x, y, endX, endY, angle, length, width, corners: [x + nx, y + ny, endX + nx, endY + ny, endX - nx, endY - ny, x - nx, y - ny] };
}
export function pointInBeam(x: number, y: number, radius: number, beam: BeamGeometry): boolean {
  const dx = x - beam.x, dy = y - beam.y;
  const along = dx * Math.cos(beam.angle) + dy * Math.sin(beam.angle);
  const across = -dx * Math.sin(beam.angle) + dy * Math.cos(beam.angle);
  const nearX = clamp(along, 0, beam.length), nearY = clamp(across, -beam.width / 2, beam.width / 2);
  return (along - nearX) ** 2 + (across - nearY) ** 2 <= radius ** 2;
}

export class SeededRandom {
  constructor(private seed = 12345) {}
  next(): number {
    let value = this.seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  }
}

/** Center-based grid; callers expand bounds by the largest candidate radius when needed. */
export class SpatialGrid<T extends Vec2> {
  private readonly cells = new Map<number, T[]>();
  private readonly spare: T[][] = [];
  constructor(readonly cellSize = 160) {}
  clear(): void {
    for (const bucket of this.cells.values()) { bucket.length = 0; this.spare.push(bucket); }
    this.cells.clear();
  }
  private key(x: number, y: number): number { return (x + 32768) * 65536 + y + 32768; }
  insert(value: T): void {
    const key = this.key(Math.floor(value.x / this.cellSize), Math.floor(value.y / this.cellSize));
    let bucket = this.cells.get(key);
    if (!bucket) { bucket = this.spare.pop() ?? []; this.cells.set(key, bucket); }
    bucket.push(value);
  }
  query(minX: number, minY: number, maxX: number, maxY: number, output: T[]): T[] {
    output.length = 0;
    for (let x = Math.floor(minX / this.cellSize); x <= Math.floor(maxX / this.cellSize); x++) {
      for (let y = Math.floor(minY / this.cellSize); y <= Math.floor(maxY / this.cellSize); y++) {
        const bucket = this.cells.get(this.key(x, y));
        if (bucket) for (let i = 0; i < bucket.length; i++) output.push(bucket[i]);
      }
    }
    return output;
  }
}
