import { xpNeeded } from './config';
import type { EncounterId } from './campaign';
import type { CarryoverSnapshot, Difficulty, SeasonId } from './types';

export const PROFILE_KEY = 'mafuyu-sekai:profile:v1';
export const PROFILE_BACKUP_KEY = `${PROFILE_KEY}:backup`;
export const PROFILE_VERSION = 1;
export type ProfileStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface CompletionInput {
  runId: string; season: SeasonId; difficulty: Difficulty; encounterId: EncounterId;
  score: number; carryover: CarryoverSnapshot; source: 'gameplay'; completedAt?: number;
}
export interface CompletionRecord extends Omit<CompletionInput, 'completedAt'> { completedAt: number }
export interface SaveProfile {
  version: 1; revision: number;
  clears: Record<string, CompletionRecord>;
  carryover: CarryoverSnapshot | null;
  bestScores: Record<SeasonId, Record<Difficulty, number>>;
}
export type SaveStatus = 'saved' | 'session-only';
export interface SaveResult { profile: SaveProfile; status: SaveStatus; changed: boolean; error: string | null }

const finalEncounter = { s1: 's1:mafuyu', s2: 's2:final' } as const;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const seasonId = (value: unknown): value is SeasonId => value === 's1' || value === 's2';
const difficultyId = (value: unknown): value is Difficulty => value === 'normal' || value === 'hard';
const clone = <T>(value: T): T => structuredClone(value);

export function emptyProfile(): SaveProfile {
  return { version: PROFILE_VERSION, revision: 0, clears: {}, carryover: null, bestScores: { s1: { normal: 0, hard: 0 }, s2: { normal: 0, hard: 0 } } };
}

export function validCarryover(value: unknown): value is CarryoverSnapshot {
  if (!object(value) || !integer(value.level, 1, 10) || !integer(value.companions, 0, 3)
    || typeof value.xp !== 'number' || !Number.isFinite(value.xp) || value.xp < 0) return false;
  return value.level === 10 ? value.xp <= xpNeeded(10) : value.xp < xpNeeded(value.level);
}

/** Whole snapshots are compared, never combined into an equipment state the player did not earn. */
export function compareCarryover(a: CarryoverSnapshot, b: CarryoverSnapshot): number {
  return a.level - b.level || a.companions - b.companions || a.xp - b.xp;
}

function validCompletion(value: unknown): value is CompletionRecord {
  return object(value) && typeof value.runId === 'string' && value.runId.length > 0 && value.runId.length <= 160
    && seasonId(value.season) && difficultyId(value.difficulty) && value.source === 'gameplay'
    && value.encounterId === finalEncounter[value.season] && integer(value.score, 0)
    && integer(value.completedAt, 0) && validCarryover(value.carryover);
}

function normalizeRecord(record: CompletionRecord): CompletionRecord {
  return { runId: record.runId, season: record.season, difficulty: record.difficulty, encounterId: record.encounterId,
    score: record.score, source: 'gameplay', completedAt: record.completedAt,
    carryover: { level: record.carryover.level, xp: record.carryover.xp, companions: record.carryover.companions } };
}

function derive(profile: SaveProfile): SaveProfile {
  profile.carryover = null;
  const ordered: Record<string, CompletionRecord> = {};
  for (const key of Object.keys(profile.clears).sort()) {
    const record = profile.clears[key];
    ordered[key] = record;
    profile.bestScores[record.season][record.difficulty] = Math.max(profile.bestScores[record.season][record.difficulty], record.score);
    if (record.season === 's1' && (!profile.carryover || compareCarryover(record.carryover, profile.carryover) > 0)) profile.carryover = { ...record.carryover };
  }
  profile.clears = ordered;
  return profile;
}

export function validateProfile(value: unknown): SaveProfile | null {
  if (!object(value) || value.version !== PROFILE_VERSION || !integer(value.revision, 0) || !object(value.clears)) return null;
  const profile = emptyProfile(); profile.revision = value.revision;
  for (const record of Object.values(value.clears)) if (validCompletion(record)) {
    profile.clears[`${record.season}:${record.runId}`] = normalizeRecord(record);
  }
  if (object(value.bestScores)) for (const season of ['s1', 's2'] as const) {
    const scores = value.bestScores[season];
    if (object(scores)) for (const difficulty of ['normal', 'hard'] as const) {
      if (integer(scores[difficulty], 0)) profile.bestScores[season][difficulty] = scores[difficulty];
    }
  }
  // A cached unlock or carryover property is never accepted as completion evidence.
  return derive(profile);
}

export function mergeProfiles(a: SaveProfile, b: SaveProfile): SaveProfile {
  const merged = emptyProfile(); merged.revision = Math.max(a.revision, b.revision);
  for (const source of [a, b]) {
    for (const season of ['s1', 's2'] as const) for (const difficulty of ['normal', 'hard'] as const) {
      merged.bestScores[season][difficulty] = Math.max(merged.bestScores[season][difficulty], source.bestScores[season][difficulty]);
    }
    for (const [key, record] of Object.entries(source.clears)) {
      const existing = merged.clears[key];
      // Conflicting copies of an immutable run resolve identically regardless of tab merge order.
      if (!existing || JSON.stringify(record) < JSON.stringify(existing)) merged.clears[key] = clone(record);
    }
  }
  return derive(merged);
}

function fingerprint(profile: SaveProfile): string {
  return JSON.stringify({ clears: profile.clears, bestScores: profile.bestScores });
}

/** DOM-independent persistence boundary. Runtime forwards storage events; no simulation state is serialized. */
export class SaveRepository {
  private current = emptyProfile();
  private storage: ProfileStorage | null;
  private futureVersion = false;
  private readFailed = false;
  private copiesHealthy = true;
  status: SaveStatus = 'saved';
  error: string | null = null;

  constructor(storage?: ProfileStorage | null) {
    if (storage !== undefined) this.storage = storage;
    else {
      try { this.storage = typeof localStorage === 'undefined' ? null : localStorage; }
      catch { this.storage = null; }
    }
    if (!this.storage) this.unavailable('浏览器存储不可用，进度仅保留在本次会话。');
    this.load();
  }

  getProfile(): SaveProfile { return clone(this.current); }
  isUnlocked(season: SeasonId): boolean { return season === 's1' || this.current.carryover !== null; }

  load(): SaveProfile {
    this.current = mergeProfiles(this.current, this.readDisk());
    return this.getProfile();
  }

  recordScore(season: SeasonId, difficulty: Difficulty, score: number): SaveResult {
    if (!seasonId(season) || !difficultyId(difficulty) || !integer(score, 0)) return this.result(false);
    const next = this.getProfile(); next.bestScores[season][difficulty] = Math.max(next.bestScores[season][difficulty], score);
    return this.commit(next);
  }

  recordCompletion(input: CompletionInput): SaveResult {
    const record = { ...input, completedAt: input.completedAt ?? Date.now() };
    if (!validCompletion(record)) return this.result(false);
    const latest = mergeProfiles(this.current, this.readDisk());
    if (record.season === 's2' && !latest.carryover) return this.result(false);
    const key = `${record.season}:${record.runId}`;
    if (!latest.clears[key]) latest.clears[key] = normalizeRecord(record);
    return this.commit(derive(latest));
  }

  mergeExternal(raw?: string | null): SaveResult {
    const external = raw === undefined ? this.readDisk() : this.parse(raw);
    return external ? this.commit(mergeProfiles(this.current, external)) : this.result(false);
  }

  private parse(raw: string | null): SaveProfile | null {
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      if (object(value) && typeof value.version === 'number' && value.version > PROFILE_VERSION) {
        this.futureVersion = true; this.unavailable('存档来自较新的版本；当前进度仅保留在本次会话，原存档未覆盖。');
        return null;
      }
      return validateProfile(value);
    } catch { return null; }
  }

  private readDisk(): SaveProfile {
    this.copiesHealthy = true;
    if (!this.storage) return emptyProfile();
    this.readFailed = false;
    try {
      const primary = this.parse(this.storage.getItem(PROFILE_KEY));
      const backup = this.parse(this.storage.getItem(PROFILE_BACKUP_KEY));
      if (primary || backup) {
        const merged = mergeProfiles(primary ?? emptyProfile(), backup ?? emptyProfile());
        const content = fingerprint(merged);
        this.copiesHealthy = !!primary && !!backup && fingerprint(primary) === content && fingerprint(backup) === content;
        return merged;
      }
      const legacy = emptyProfile();
      for (const difficulty of ['normal', 'hard'] as const) {
        const raw = this.storage.getItem(`mafuyu-sekai:best:v3${difficulty === 'hard' ? ':hard' : ''}`);
        const score = raw === null ? 0 : Number(raw);
        if (integer(score, 0)) legacy.bestScores.s1[difficulty] = score;
      }
      return legacy;
    } catch {
      this.readFailed = true;
      this.unavailable('无法读取浏览器存档，进度仅保留在本次会话。');
      return emptyProfile();
    }
  }

  private commit(incoming: SaveProfile): SaveResult {
    const disk = this.readDisk(), before = fingerprint(this.current);
    const merged = mergeProfiles(mergeProfiles(this.current, disk), incoming);
    const changed = fingerprint(merged) !== before;
    this.current = merged;
    if (!this.storage || this.futureVersion || this.readFailed) return this.result(changed);
    if (fingerprint(merged) === fingerprint(disk) && this.status === 'saved' && this.copiesHealthy) return this.result(changed);
    merged.revision = Math.max(merged.revision, disk.revision) + 1;
    try {
      // Backup contains the last validated durable state, never the uncommitted candidate.
      try { this.storage.setItem(PROFILE_BACKUP_KEY, JSON.stringify(disk)); } catch { /* A backup failure must not prevent an atomic primary write. */ }
      const serialized = JSON.stringify(merged);
      this.storage.setItem(PROFILE_KEY, serialized);
      this.status = 'saved'; this.error = null;
      // Mirror only after the primary succeeded, including the very first unlock.
      try { this.storage.setItem(PROFILE_BACKUP_KEY, serialized); }
      catch { this.error = '主存档已保存，备份暂时无法更新。'; }
    } catch { this.unavailable('存档写入失败，进度仅保留在本次会话；请保留此页面后重试保存。'); }
    return this.result(changed);
  }

  private unavailable(error: string): void { this.status = 'session-only'; this.error = error; }
  private result(changed: boolean): SaveResult { return { profile: this.getProfile(), status: this.status, changed, error: this.error }; }
}
