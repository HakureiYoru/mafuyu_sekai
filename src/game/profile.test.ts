import { describe, expect, it } from 'vitest';
import { emptyProfile, mergeProfiles, PROFILE_BACKUP_KEY, PROFILE_KEY, SaveRepository, validateProfile, validateLegacyProfile, validCarryover, LEGACY_PROFILE_KEY, LEGACY_V5_PROFILE_KEY, validateLegacyV5Profile } from './profile';
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
  runId, difficulty: 'normal', encounterId: 's2:final', score: 3000, source: 'gameplay', completedAt: 1000, ...overrides,
});

describe('versioned campaign completion profiles', () => {
  it('records only the unified final encounter without any legacy unlock prerequisite', () => {
    const storage = new MemoryStorage(), repo = new SaveRepository(storage);
    repo.recordScore('story', 'hard', 999999);
    expect(repo.getProfile().clears).toEqual({});
    expect(repo.recordCompletion(clear('wrong', { encounterId: 's1:mafuyu' })).changed).toBe(false);
    expect(repo.recordCompletion(clear('debug', { source: 'debug' as 'gameplay' })).changed).toBe(false);
    expect(repo.recordCompletion(clear('normal-clear')).status).toBe('saved');
    expect(repo.recordCompletion(clear('hard-clear', { difficulty: 'hard' })).changed).toBe(true);
    expect(Object.keys(new SaveRepository(storage).getProfile().clears)).toHaveLength(2);
  });

  it('deduplicates a completion across reloads, without allowing a retry payload to upgrade that run', () => {
    const storage = new MemoryStorage(), repo = new SaveRepository(storage), input = clear();
    repo.recordCompletion(input);
    const before = repo.getProfile(), writes = storage.writes;
    expect(repo.recordCompletion(input).changed).toBe(false); expect(storage.writes).toBe(writes);
    const reloaded = new SaveRepository(storage);
    expect(reloaded.recordCompletion(clear('run-1', { score: 100000 })).changed).toBe(false);
    expect(reloaded.getProfile()).toEqual(before); expect(Object.keys(before.clears)).toHaveLength(1);
  });

  it('isolates rule, difficulty and mode scores while keeping old history read-only', () => {
    const storage = new MemoryStorage();
    const old = JSON.stringify({ version: 1, revision: 2, clears: { legacy: { runId: 'old', season: 's1', difficulty: 'normal', encounterId: 's1:mafuyu', score: 5000, carryover: { level: 2, xp: 219, companions: 3 }, source: 'gameplay', completedAt: 1 } }, bestScores: { s1: { normal: 6000, hard: 100 }, s2: { normal: 8000, hard: 300 } } });
    storage.values.set(LEGACY_PROFILE_KEY, '{broken'); storage.values.set(LEGACY_PROFILE_KEY + ':backup', old);
    storage.values.set('mafuyu-sekai:best:v3', '9000');
    const repo = new SaveRepository(storage);
    expect(repo.getLegacyHistory()).toMatchObject({ clears: 1, bestScores: { s1: { normal: 9000, hard: 100 }, s2: { normal: 8000, hard: 300 } } });
    expect(repo.getProfile()).toEqual(emptyProfile());
    repo.recordScore('story', 'normal', 100); repo.recordScore('endless', 'normal', 200);
    repo.recordScore('story', 'hard', 300); repo.recordScore('endless', 'hard', 400);
    expect(repo.getProfile().bestScores.v6).toEqual({ normal: { story: 100, endless: 200 }, hard: { story: 300, endless: 400 } });
    expect(storage.getItem(LEGACY_PROFILE_KEY)).toBe('{broken'); expect(storage.getItem(LEGACY_PROFILE_KEY + ':backup')).toBe(old);
    expect(storage.getItem('mafuyu-sekai:best:v3')).toBe('9000');
    for (const bad of [NaN, Infinity, -1, .5]) expect(repo.recordScore('story', 'normal', bad).changed).toBe(false);
  });
  it('freezes legacy XP validation independently of current balance and rejects invented clears', () => {
    expect(validCarryover({ level: 2, xp: 219, companions: 3 })).toBe(true);
    expect(validCarryover({ level: 2, xp: 220, companions: 3 })).toBe(false);
    expect(validCarryover({ level: 10, xp: 1340, companions: 3 })).toBe(true);
    const forged = { version: 1, revision: 0, clears: {}, carryover: { level: 10, xp: 0, companions: 3 }, unlocked: ['s2'] };
    expect(validateLegacyProfile(forged)?.clears).toBe(0);
  });
  it('unions disjoint legacy primary and backup records without double-counting or writing either file', () => {
    const storage = new MemoryStorage();
    const record = (runId: string) => ({ runId, season: 's1', difficulty: 'normal', encounterId: 's1:mafuyu', score: 100,
      source: 'gameplay', completedAt: 1000, carryover: { level: 2, xp: 219, companions: 1 } });
    const primary = JSON.stringify({ version: 1, revision: 3, clears: { a: record('a'), common: record('common') } });
    const backup = JSON.stringify({ version: 1, revision: 2, clears: { b: record('b'), common: record('common') } });
    storage.values.set(LEGACY_PROFILE_KEY, primary); storage.values.set(LEGACY_PROFILE_KEY + ':backup', backup);
    const repo = new SaveRepository(storage); repo.load(); repo.recordCompletion(clear());
    const history = repo.getLegacyHistory();
    expect(history.clears).toBe(3); expect(Object.keys(history.records).sort()).toEqual(['s1:a', 's1:b', 's1:common']);
    history.records['s1:a'].carryover.level = 10;
    expect(repo.getLegacyHistory().records['s1:a'].carryover.level).toBe(2);
    expect(storage.getItem(LEGACY_PROFILE_KEY)).toBe(primary); expect(storage.getItem(LEGACY_PROFILE_KEY + ':backup')).toBe(backup);
    expect(Object.keys(repo.getProfile().clears)).toHaveLength(1);
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
      expect(Object.keys(recovered.getProfile().clears).length > 0).toBe(true);
      const result = recovered.mergeExternal();
      expect(result.changed).toBe(false); expect(result.status).toBe('saved');
      expect(storage.writes).toBeGreaterThan(writes);
      const primary = validateProfile(JSON.parse(storage.getItem(PROFILE_KEY)!));
      const backup = validateProfile(JSON.parse(storage.getItem(PROFILE_BACKUP_KEY)!));
      expect(primary).toEqual(backup);
      expect(primary!.clears).toEqual(expected.clears);
      const repairedWrites = storage.writes;
      recovered.mergeExternal(storage.getItem(PROFILE_BACKUP_KEY));
      recovered.recordScore('story', 'normal', 3000);
      expect(storage.writes).toBe(repairedWrites);
    });
  }

  it('repairs a stale valid backup on a repeated score update and leaves a fresh empty browser untouched', () => {
    const storage = new MemoryStorage(), repo = new SaveRepository(storage);
    repo.mergeExternal(); expect(storage.writes).toBe(0);
    repo.recordCompletion(clear());
    const stale = storage.getItem(PROFILE_BACKUP_KEY)!;
    repo.recordScore('endless', 'hard', 9000);
    storage.values.set(PROFILE_BACKUP_KEY, stale);
    expect(repo.recordScore('endless', 'hard', 9000).changed).toBe(false);
    expect(storage.getItem(PROFILE_BACKUP_KEY)).toBe(storage.getItem(PROFILE_KEY));
    expect(new SaveRepository(storage).getProfile().bestScores.v6.hard.endless).toBe(9000);
  });

  it('does not repair over a future-version sibling or after storage reads are denied', () => {
    for (const key of [PROFILE_KEY, PROFILE_BACKUP_KEY]) {
      const storage = new MemoryStorage(), repo = new SaveRepository(storage);
      repo.recordCompletion(clear());
      const future = JSON.stringify({ version: 99, revision: 20, important: true });
      storage.values.set(key, future);
      const writes = storage.writes, protectedRepo = new SaveRepository(storage);
      expect(Object.keys(protectedRepo.getProfile().clears).length > 0).toBe(true);
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
    expect(Object.keys(new SaveRepository(storage).getProfile().clears).length > 0).toBe(true);
    storage.failKey = PROFILE_BACKUP_KEY;
    const result = repo.recordCompletion(clear('new', { score: 9000 }));
    expect(result.status).toBe('saved'); expect(result.error).toContain('备份');
    expect(Object.keys(new SaveRepository(storage).getProfile().clears)).toHaveLength(2);
  });

  it('keeps the last validated backup when primary data is corrupt and repairs it on the next commit', () => {
    const storage = new MemoryStorage(), repo = new SaveRepository(storage);
    repo.recordCompletion(clear()); repo.recordScore('endless', 'hard', 9000);
    storage.values.set(PROFILE_KEY, '{broken');
    const recovered = new SaveRepository(storage);
    expect(Object.keys(recovered.getProfile().clears).length > 0).toBe(true); expect(Object.keys(recovered.getProfile().clears)).toHaveLength(1);
    recovered.recordScore('endless', 'normal', 200);
    expect(new SaveRepository(storage).getProfile().bestScores.v6.normal.endless).toBe(200);
    expect(Object.keys(validateProfile(JSON.parse(storage.getItem(PROFILE_BACKUP_KEY)!))!.clears)).toHaveLength(1);
  });

  it('retains new progress in memory after quota failure, leaves the durable record intact, and retries successfully', () => {
    const storage = new MemoryStorage(), repo = new SaveRepository(storage);
    repo.recordCompletion(clear()); const durable = storage.getItem(PROFILE_KEY);
    storage.failKey = PROFILE_KEY;
    const failed = repo.recordCompletion(clear('stronger', { score: 8000 }));
    expect(failed.status).toBe('session-only'); expect(failed.error).toBeTruthy(); expect(Object.keys(failed.profile.clears)).toHaveLength(2);
    expect(storage.getItem(PROFILE_KEY)).toBe(durable); expect(Object.keys(new SaveRepository(storage).getProfile().clears)).toHaveLength(1);
    storage.failKey = null;
    expect(repo.recordScore('story', 'normal', 3000).status).toBe('saved');
    expect(Object.keys(new SaveRepository(storage).getProfile().clears)).toHaveLength(2);
  });

  it('handles absent storage and read-denied storage without claiming persistence or overwriting unseen data', () => {
    const memory = new SaveRepository(null);
    expect(memory.recordCompletion(clear()).status).toBe('session-only'); expect(Object.keys(memory.getProfile().clears).length > 0).toBe(true);
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
    expect(validateProfile({ ...emptyProfile(), carryover: { level: 10, companions: 3, xp: 0 }, unlocked: ['s2'] })!.clears).toEqual({});
    for (const score of [-1, NaN, Infinity, .5]) expect(validateProfile({ ...emptyProfile(), clears: { test: { ...clear('test', { score }), ruleset: 'v6' } } })!.clears).toEqual({});
    expect(validateProfile(null)).toBeNull(); expect(validateProfile({ ...emptyProfile(), revision: Infinity })).toBeNull();
  });
});

describe('cross-tab progress convergence', () => {
  it('keeps v5 primary and backup history intact while writing only v6 scores', () => {
    const storage = new MemoryStorage();
    const historical = (id: string, score: number) => JSON.stringify({ version: 2, revision: 7,
      clears: { [id]: { ...clear(id, { score }), ruleset: 'v5' } },
      bestScores: { v5: { normal: { story: score, endless: 18000 }, hard: { story: 40000, endless: 23000 } } } });
    const primary = historical('old-a', 9000), backup = historical('old-b', 8000);
    storage.values.set(LEGACY_V5_PROFILE_KEY, primary); storage.values.set(LEGACY_V5_PROFILE_KEY + ':backup', backup);
    const repo = new SaveRepository(storage);
    expect(repo.getProfile()).toEqual(emptyProfile());
    expect(repo.getLegacyV5History()).toMatchObject({ clears: 2, bestScores: { normal: { story: 9000, endless: 18000 } } });
    repo.recordCompletion(clear('current'));
    expect(repo.getProfile().version).toBe(3); expect(repo.getProfile().bestScores.v6.normal.story).toBe(3000);
    expect(Object.keys(repo.getProfile().clears)).toEqual(['v6:current']);
    expect(storage.getItem(LEGACY_V5_PROFILE_KEY)).toBe(primary); expect(storage.getItem(LEGACY_V5_PROFILE_KEY + ':backup')).toBe(backup);
    const history = repo.getLegacyV5History(); history.records['v5:old-a'].score = 0;
    expect(repo.getLegacyV5History().records['v5:old-a'].score).toBe(9000);
  });

  it('recovers malformed v5 history from backup without accepting v5 data as v6 progress', () => {
    const storage = new MemoryStorage(), backup = JSON.stringify({ version: 2, revision: 1,
      clears: { valid: { ...clear('old'), ruleset: 'v5' }, forged: { ...clear('fake'), ruleset: 'v6' } } });
    storage.values.set(LEGACY_V5_PROFILE_KEY, '{bad'); storage.values.set(LEGACY_V5_PROFILE_KEY + ':backup', backup);
    const repo = new SaveRepository(storage);
    expect(repo.getLegacyV5History().clears).toBe(1); expect(repo.getProfile().clears).toEqual({});
    expect(validateProfile(JSON.parse(backup))).toBeNull(); expect(validateLegacyV5Profile(emptyProfile())).toBeNull();
    repo.mergeExternal(backup); expect(repo.getProfile().clears).toEqual({});
    expect(storage.getItem(LEGACY_V5_PROFILE_KEY)).toBe('{bad');
  });

  it('reloads historical v5 scores changed by another tab without importing combat progress', () => {
    const storage = new MemoryStorage(), repo = new SaveRepository(storage);
    storage.values.set(LEGACY_V5_PROFILE_KEY, JSON.stringify({ version: 2, revision: 1, clears: {}, bestScores: { v5: { hard: { endless: 80000 } } } }));
    repo.load(); expect(repo.getLegacyV5History().bestScores.hard.endless).toBe(80000);
    expect(repo.getProfile()).toEqual(emptyProfile());
  });

  it('merges the latest disk profile before a stale tab writes, preserving both score and completion changes', () => {
    const storage = new MemoryStorage(), a = new SaveRepository(storage), b = new SaveRepository(storage);
    a.recordCompletion(clear('a'));
    b.recordScore('endless', 'hard', 5000);
    expect(Object.keys(b.getProfile().clears).length > 0).toBe(true);
    a.mergeExternal(storage.getItem(PROFILE_KEY));
    expect(a.getProfile()).toEqual(b.getProfile());
    expect(a.getProfile().bestScores.v6.hard.endless).toBe(5000);
    const writes = storage.writes; a.mergeExternal(storage.getItem(PROFILE_KEY)); expect(storage.writes).toBe(writes);
  });

  it('combines disjoint simultaneous clears deterministically', () => {
    const a = new SaveRepository(new MemoryStorage()), b = new SaveRepository(new MemoryStorage());
    a.recordCompletion(clear('a')); b.recordCompletion(clear('b', { difficulty: 'hard', score: 9000 }));
    const merged = mergeProfiles(a.getProfile(), b.getProfile());
    expect(mergeProfiles(b.getProfile(), a.getProfile())).toEqual(merged);
    expect(Object.keys(merged.clears)).toHaveLength(2);
    expect(merged.bestScores.v6).toEqual({ normal: { story: 3000, endless: 0 }, hard: { story: 9000, endless: 0 } });
    a.mergeExternal(JSON.stringify(b.getProfile())); b.mergeExternal(JSON.stringify(a.getProfile()));
    expect(a.getProfile().clears).toEqual(b.getProfile().clears);
  });
});
