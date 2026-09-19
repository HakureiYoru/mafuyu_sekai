/** Keep random new games separate from explicitly seeded replays and simulation tests. */
const randomWord = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
export function createRunSeed(previous: number, sample: () => number = randomWord): number {
  const seed = (sample() >>> 0) || 1;
  // Avoid a zero PRNG state and guarantee that consecutive normal starts differ,
  // even in the exceptionally rare case of a repeated random word.
  return seed === (previous >>> 0) ? seed === 0xffffffff ? 1 : seed + 1 : seed;
}
