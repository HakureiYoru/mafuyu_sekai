import { describe, expect, it } from 'vitest';
import { createRunSeed } from './run-seed';

describe('new-run seeds', () => {
  it('uses the sampled unsigned value', () => expect(createRunSeed(12345, () => 123456)).toBe(123456));
  it('never starts the random generator at zero', () => expect(createRunSeed(12345, () => 0)).toBe(1));
  it('does not repeat the previous seed on a random collision', () => expect(createRunSeed(42, () => 42)).toBe(43));
  it('wraps a collision at uint32 max without returning zero', () => expect(createRunSeed(0xffffffff, () => 0xffffffff)).toBe(1));
  it('uses real browser-compatible crypto by default', () => {
    const seed = createRunSeed(12345);
    expect(Number.isInteger(seed)).toBe(true); expect(seed).toBeGreaterThan(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff); expect(seed).not.toBe(12345);
  });
});
