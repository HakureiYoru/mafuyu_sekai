import { describe, expect, it } from 'vitest';
import { emptyProfile, mergeProfiles, PROFILE_BACKUP_KEY, PROFILE_KEY, SaveRepository, validateProfile } from './profile';
import type { CompletionInput, ProfileStorage } from './profile';

class MemoryStorage implements ProfileStorage {
  readonly values = new Map<string, string>();
  failKey: string | null = null;
  failReads = false;
  writes = 0;
  getItem(key: string): string | null { if (this.failReads) throw new Error('denied'); return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { if (this.failKey === key) throw new Error('quota'); this.writes++; this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}
const clear = (runId = 'run-1', overrides: Partial<CompletionInput> = {}): CompletionInput => ({
  runId, season: 's1', difficulty: 'normal', encounterId: 's1:mafuyu', score: 3000,
  carryover: { level: 6, companions: 2, xp: 40 }, source: 'gameplay', completedAt: 1000, ...overrides,
});

describe('versioned campaign completion profiles', () => {
  it('unlocks both second-season difficulties only from a real first-season final encounter', () => {
    const storage = new MemoryStorage(), repo = new SaveRepository(storage);
    expect(repo.isUnlocked('s1')).toBe(true); expect(repo.isUnlocked('s2')).toBe(false);
    repo.recordScore('s1', 'hard', 999999); expect(repo.isUnlocked('s2')).toBe(false);
    expect(repo.recordCompletion(clear('wrong', { encounterId: 's1:echo' })).changed).toBe(false);
    expect(repo.recordCompletion(clear('debug', { source: 'debug' as 'gameplay' })).changed).toBe(false);
    expect(repo.recordCompletion(clear('early-s2', { season: 's2', encounterId: 's2:final' })).changed).toBe(false);
    const result = repo.recordCompletion(clear('hard-clear', { difficulty: 'hard' }));
    expect(result.status).toBe('saved'); expect(repo.isUnlocked('s2')).toBe(true);
    const reload = new SaveRepository(storage); expect(reload.isUnlocked('s2')).toBe(true);
    expect(reload.getProfile().carryover).toEqual({ level: 6, companions: 2, xp: 40 });
    for (const difficulty of ['normal', 'hard'] as const) expect(reload.recordCompletion(clear(`s2-${difficulty}`, { season: 's2', encounterId: 's2:final', difficulty })).changed).toBe(true);
    expect(reload.getProfile().carryover).toEqual(result.profile.carryover);
  });

  it('deduplicates a completion across reloads, without allowing a retry payload to upgrade that run', () => {
    const storage = new MemoryStorage(), repo = new SaveRepository(storage), input = clear();
    repo.recordCompletion(input);
    const before = repo.getProfile(), writes = storage.writes;
    expect(repo.recordCompletion(input).changed).toBe(false); expect(storage.writes).toBe(writes);
    const reloaded = new SaveRepository(storage);
    expect(reloaded.recordCompletion(clear('run-1', { score: 100000, carryover: { level: 10, companions: 3, xp: 600 } })).changed).toBe(false);
    expect(reloaded.getProfile()).toEqual(before); expect(Object.keys(before.clears)).toHaveLength(1);
  });

  it('keeps the strongest whole first-season snapshot by level, then companions, then XP', () => {
    const repo = new SaveRepository(new MemoryStorage());
    repo.recordCompletion(clear());
    repo.recordCompletion(clear('lower-level', { carryover: { level: 5, companions: 3, xp: 500 } }));
    expect(repo.getProfile().carryover).toEqual({ level: 6, companions: 2, xp: 40 });
    repo.recordCompletion(clear('more-drones', { carryover: { level: 6, companions: 3, xp: 0 } }));
    expect(repo.getProfile().carryover).toEqual({ level: 6, companions: 3, xp: 0 });
    repo.recordCompletion(clear('more-xp', { carryover: { level: 6, companions: 3, xp: 100 } }));
    repo.recordCompletion(clear('more-level', { carryover: { level: 7, companions: 1, xp: 0 } }));
    expect(repo.getProfile().carryover).toEqual({ level: 7, companions: 1, xp: 0 });
    repo.recordCompletion(clear('s2-maxed', { season: 's2', encounterId: 's2:final', carryover: { level: 10, companions: 3, xp: 1000 } }));
    repo.recordScore('s2', 'normal', 9000);
    expect(repo.getProfile().carryover).toEqual({ level: 7, companions: 1, xp: 0 });
    const copy = repo.getProfile(); copy.carryover!.level = 1; copy.clears = {};
    expect(repo.getProfile().carryover!.level).toBe(7);
  });

  it('isolates all four leaderboards, imports old scores, and never treats a score as an unlock', () => {
    const storage = new MemoryStorage(); storage.values.set('mafuyu-sekai:best:v3', '120'); storage.values.set('mafuyu-sekai:best:v3:hard', '500');
    const repo = new SaveRepository(storage); expect(repo.isUnlocked('s2')).toBe(false);
    expect(repo.getProfile().bestScores).toEqual({ s1: { normal: 120, hard: 500 }, s2: { normal: 0, hard: 0 } });
    repo.recordScore('s2', 'normal', 240); repo.recordScore('s2', 'hard', 900); repo.recordScore('s1', 'normal', 1);
    expect(repo.getProfile().bestScores).toEqual({ s1: { normal: 120, hard: 500 }, s2: { normal: 240, hard: 900 } });
    expect(repo.isUnlocked('s2')).toBe(false);
    for (const bad of [NaN, Infinity, -1, 0.5]) expect(repo.recordScore('s2', 'normal', bad).changed).toBe(false);
  });
});

describe('save failure recovery and validation', () => {
  for (const key of [PROFILE_KEY, PROFILE_BACKUP_KEY]) for (const fault of ['missing', 'corrupt'] as const) {
    it(`repairs a ${fault} ${key === PROFILE_KEY ? 'primary' : 'backup'} without requiring new progress`, () => {
      const storage = new MemoryStorage(), original = new SaveRepository(storage);
      original.recordCompletion(clear());
      const expected = original.getProfile();
      if (fault === 'missing') storage.removeItem(key); else storage.values.set(key, '{broken');
      const recovered = new SaveRepository(storage), writes = storage.writes;
      expect(recovered.isUnlocked('s2')).toBe(true);
      const result = recovered.mergeExternal();
      expect(result.changed).toBe(false); expect(result.status).toBe('saved');
      expect(storage.writes).toBeGreaterThan(writes);
      const primary = validateProfile(JSON.parse(storage.getItem(PROFILE_KEY)!));
      const backup = validateProfile(JSON.parse(storage.getItem(PROFILE_BACKUP_KEY)!));
      expect(primary).toEqual(backup);
      expect(primary!.clears).toEqual(expected.clears); expect(primary!.carryover).toEqual(expected.carryover);
      const repairedWrites = storage.writes;
      recovered.mergeExternal(storage.getItem(PROFILE_BACKUP_KEY));
      recovered.recordScore('s1', 'normal', 3000);
      expect(storage.writes).toBe(repairedWrites);
    });
  }

  it('repairs a stale valid backup on a repeated score update and leaves a fresh empty browser untouched', () => {
    const storage = new MemoryStorage(), repo = new SaveRepository(storage);
    repo.mergeExternal(); expect(storage.writes).toBe(0);
    repo.recordCompletion(clear());
    const stale = storage.getItem(PROFILE_BACKUP_KEY)!;
    repo.recordScore('s2', 'hard', 9000);
    storage.values.set(PROFILE_BACKUP_KEY, stale);
    expect(repo.recordScore('s2', 'hard', 9000).changed).toBe(false);
    expect(storage.getItem(PROFILE_BACKUP_KEY)).toBe(storage.getItem(PROFILE_KEY));
    expect(new SaveRepository(storage).getProfile().bestScores.s2.hard).toBe(9000);
  });

  it('does not repair over a future-version sibling or after storage reads are denied', () => {
    for (const key of [PROFILE_KEY, PROFILE_BACKUP_KEY]) {
      const storage = new MemoryStorage(), repo = new SaveRepository(storage);
      repo.recordCompletion(clear());
      const future = JSON.stringify({ version: 99, revision: 20, important: true });
      storage.values.set(key, future);
      const writes = storage.writes, protectedRepo = new SaveRepository(storage);
      expect(protectedRepo.isUnlocked('s2')).toBe(true);
      expect(protectedRepo.mergeExternal().status).toBe('session-only');
      expect(storage.writes).toBe(writes); expect(storage.getItem(key)).toBe(future);
    }
    const storage = new MemoryStorage(), repo = new SaveRepository(storage);
    repo.recordCompletion(clear()); storage.removeItem(PROFILE_BACKUP_KEY);
    const writes = storage.writes; storage.failReads = true;
    expect(repo.mergeExternal().status).toBe('session-only');
    expect(storage.writes).toBe(writes); expect(storage.values.has(PROFILE_BACKUP_KEY)).toBe(false);
    storage.failReads = false; expect(repo.mergeExternal().status).toBe('saved');
    expect(storage.getItem(PROFILE_BACKUP_KEY)).toBe(storage.getItem(PROFILE_KEY));
  });

  it('backs up the first earned unlock immediately, and a backup-only failure does not discard a durable clear', () => {
    const storage = new MemoryStorage(), repo = new SaveRepository(storage);
    repo.recordCompletion(clear());
    storage.values.set(PROFILE_KEY, 'broken');
    expect(new SaveRepository(storage).isUnlocked('s2')).toBe(true);
    storage.failKey = PROFILE_BACKUP_KEY;
    const result = repo.recordCompletion(clear('new', { carryover: { level: 9, companions: 2, xp: 0 } }));
    expect(result.status).toBe('saved'); expect(result.error).toContain('备份');
    expect(new SaveRepository(storage).getProfile().carryover!.level).toBe(9);
  });

  it('keeps the last validated backup when primary data is corrupt and repairs it on the next commit', () => {
    const storage = new MemoryStorage(), repo = new SaveRepository(storage);
    repo.recordCompletion(clear()); repo.recordScore('s2', 'hard', 9000);
    storage.values.set(PROFILE_KEY, '{broken');
    const recovered = new SaveRepository(storage);
    expect(recovered.isUnlocked('s2')).toBe(true); expect(recovered.getProfile().carryover!.level).toBe(6);
    recovered.recordScore('s2', 'normal', 200);
    expect(new SaveRepository(storage).getProfile().bestScores.s2.normal).toBe(200);
    expect(validateProfile(JSON.parse(storage.getItem(PROFILE_BACKUP_KEY)!))!.carryover!.level).toBe(6);
  });

  it('retains new progress in memory after quota failure, leaves the durable record intact, and retries successfully', () => {
    const storage = new MemoryStorage(), repo = new SaveRepository(storage);
    repo.recordCompletion(clear()); const durable = storage.getItem(PROFILE_KEY);
    storage.failKey = PROFILE_KEY;
    const failed = repo.recordCompletion(clear('stronger', { carryover: { level: 8, companions: 3, xp: 0 } }));
    expect(failed.status).toBe('session-only'); expect(failed.error).toBeTruthy(); expect(failed.profile.carryover!.level).toBe(8);
    expect(storage.getItem(PROFILE_KEY)).toBe(durable); expect(new SaveRepository(storage).getProfile().carryover!.level).toBe(6);
    storage.failKey = null;
    expect(repo.recordScore('s1', 'normal', 3000).status).toBe('saved');
    expect(new SaveRepository(storage).getProfile().carryover!.level).toBe(8);
  });

  it('handles absent storage and read-denied storage without claiming persistence or overwriting unseen data', () => {
    const memory = new SaveRepository(null);
    expect(memory.recordCompletion(clear()).status).toBe('session-only'); expect(memory.isUnlocked('s2')).toBe(true);
    const storage = new MemoryStorage(); storage.values.set(PROFILE_KEY, 'existing'); storage.failReads = true;
    const blocked = new SaveRepository(storage);
    expect(blocked.recordCompletion(clear()).status).toBe('session-only'); expect(storage.writes).toBe(0);
    expect(storage.values.get(PROFILE_KEY)).toBe('existing');
  });

  it('does not overwrite a future-version profile and rejects forged cached unlocks or invalid snapshot fields', () => {
    const storage = new MemoryStorage(), future = JSON.stringify({ version: 99, revision: 20, important: true });
    storage.values.set(PROFILE_KEY, future);
    const repo = new SaveRepository(storage); expect(repo.recordCompletion(clear()).status).toBe('session-only');
    expect(storage.values.get(PROFILE_KEY)).toBe(future); expect(storage.writes).toBe(0);
    const fake = { ...emptyProfile(), carryover: { level: 10, companions: 3, xp: 0 }, unlocked: ['s2'] };
    expect(validateProfile(fake)!.carryover).toBeNull();
    for (const carryover of [{ level: 11, companions: 3, xp: 0 }, { level: 4, companions: 4, xp: 0 }, { level: 4, companions: 1, xp: -1 }, { level: 2, companions: 1, xp: 1000 }]) {
      expect(validateProfile({ ...emptyProfile(), clears: { test: clear('test', { carryover }) } })!.carryover).toBeNull();
    }
    expect(validateProfile(null)).toBeNull(); expect(validateProfile({ ...emptyProfile(), revision: Infinity })).toBeNull();
  });
});

describe('cross-tab progress convergence', () => {
  it('merges the latest disk profile before a stale tab writes, preserving both score and completion changes', () => {
    const storage = new MemoryStorage(), a = new SaveRepository(storage), b = new SaveRepository(storage);
    a.recordCompletion(clear('a'));
    b.recordScore('s2', 'hard', 5000);
    expect(b.isUnlocked('s2')).toBe(true);
    a.mergeExternal(storage.getItem(PROFILE_KEY));
    expect(a.getProfile()).toEqual(b.getProfile());
    expect(a.getProfile().bestScores.s2.hard).toBe(5000);
    const writes = storage.writes; a.mergeExternal(storage.getItem(PROFILE_KEY)); expect(storage.writes).toBe(writes);
  });

  it('combines disjoint simultaneous clears deterministically and does not mix their growth fields', () => {
    const a = new SaveRepository(new MemoryStorage()), b = new SaveRepository(new MemoryStorage());
    a.recordCompletion(clear('a', { carryover: { level: 8, companions: 1, xp: 20 } }));
    b.recordCompletion(clear('b', { difficulty: 'hard', score: 9000, carryover: { level: 7, companions: 3, xp: 500 } }));
    const merged = mergeProfiles(a.getProfile(), b.getProfile());
    expect(mergeProfiles(b.getProfile(), a.getProfile())).toEqual(merged);
    expect(Object.keys(merged.clears)).toHaveLength(2); expect(merged.carryover).toEqual({ level: 8, companions: 1, xp: 20 });
    expect(merged.bestScores.s1).toEqual({ normal: 3000, hard: 9000 });
    a.mergeExternal(JSON.stringify(b.getProfile())); b.mergeExternal(JSON.stringify(a.getProfile()));
    expect(a.getProfile().clears).toEqual(b.getProfile().clears); expect(a.getProfile().carryover).toEqual(b.getProfile().carryover);
  });
});
