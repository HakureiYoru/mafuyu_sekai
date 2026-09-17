import type { CarryoverSnapshot, Difficulty, SeasonId } from './types';

export const PROFILE_KEY = 'mafuyu-sekai:profile:v2';
export const PROFILE_BACKUP_KEY = `${PROFILE_KEY}:backup`;
export const PROFILE_VERSION = 2;
export type ProfileStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const LEGACY_PROFILE_KEY = 'mafuyu-sekai:profile:v1';
export const RULESET = 'v5';
export type RunMode = 'story' | 'endless';
export interface CompletionInput {
  runId: string; difficulty: Difficulty; encounterId: string; score: number; source: 'gameplay'; completedAt?: number;
}
export interface CompletionRecord extends Omit<CompletionInput, 'completedAt'> { completedAt: number; ruleset: typeof RULESET }
export interface LegacyCompletionRecord {
  runId: string; season: SeasonId; difficulty: Difficulty; encounterId: string; score: number;
  completedAt: number; source: 'gameplay'; carryover: CarryoverSnapshot;
}
export interface LegacyHistory {
  clears: number; records: Record<string, LegacyCompletionRecord>;
  bestScores: Record<SeasonId, Record<Difficulty, number>>;
}
export interface SaveProfile {
  version: 2; revision: number; clears: Record<string, CompletionRecord>;
  bestScores: Record<typeof RULESET, Record<Difficulty, Record<RunMode, number>>>;
}
export type SaveStatus = 'saved' | 'session-only';
export interface SaveResult { profile: SaveProfile; status: SaveStatus; changed: boolean; error: string | null }

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const seasonId = (value: unknown): value is SeasonId => value === 's1' || value === 's2';
const difficultyId = (value: unknown): value is Difficulty => value === 'normal' || value === 'hard';
const clone = <T>(value: T): T => structuredClone(value);

export function emptyProfile(): SaveProfile {
  return { version: PROFILE_VERSION, revision: 0, clears: {}, bestScores: { v5: { normal: { story: 0, endless: 0 }, hard: { story: 0, endless: 0 } } } };
}

// Frozen v4 thresholds: live balance changes cannot invalidate historical records.
const LEGACY_XP = [140, 220, 320, 440, 580, 740, 920, 1120, 1340, 1340];
const legacyXpNeeded = (level: number) => LEGACY_XP[level - 1];
export function validCarryover(value: unknown): value is CarryoverSnapshot {
  if (!object(value) || !integer(value.level, 1, 10) || !integer(value.companions, 0, 3)
    || typeof value.xp !== 'number' || !Number.isFinite(value.xp) || value.xp < 0) return false;
  return value.level === 10 ? value.xp <= legacyXpNeeded(10) : value.xp < legacyXpNeeded(value.level);
}

export function validateLegacyProfile(value: unknown): LegacyHistory | null {
  if (!object(value) || value.version !== 1 || !integer(value.revision, 0) || !object(value.clears)) return null;
  const history: LegacyHistory = { clears: 0, records: {}, bestScores: { s1: { normal: 0, hard: 0 }, s2: { normal: 0, hard: 0 } } };
  if (object(value.bestScores)) for (const season of ['s1', 's2'] as const) {
    const scores = value.bestScores[season];
    if (object(scores)) for (const difficulty of ['normal', 'hard'] as const) if (integer(scores[difficulty], 0)) history.bestScores[season][difficulty] = scores[difficulty];
  }
  for (const record of Object.values(value.clears)) {
    if (!object(record) || !seasonId(record.season) || !difficultyId(record.difficulty) || record.source !== 'gameplay'
      || record.encounterId !== (record.season === 's1' ? 's1:mafuyu' : 's2:final') || typeof record.runId !== 'string'
      || !record.runId.length || record.runId.length > 160 || !integer(record.completedAt, 0) || !integer(record.score, 0) || !validCarryover(record.carryover)) continue;
    const key = record.season + ':' + record.runId;
    const normalized: LegacyCompletionRecord = { runId: record.runId, season: record.season, difficulty: record.difficulty,
      encounterId: record.season === 's1' ? 's1:mafuyu' : 's2:final', score: record.score, completedAt: record.completedAt, source: 'gameplay', carryover: { ...record.carryover } };
    if (!history.records[key] || JSON.stringify(normalized) < JSON.stringify(history.records[key])) history.records[key] = normalized;
    history.bestScores[record.season][record.difficulty] = Math.max(history.bestScores[record.season][record.difficulty], record.score);
  }
  history.clears = Object.keys(history.records).length;
  return history;
}
function validCompletion(value: unknown): value is CompletionRecord {
  return object(value) && value.ruleset === RULESET && typeof value.runId === 'string' && value.runId.length > 0 && value.runId.length <= 160
    && difficultyId(value.difficulty) && value.source === 'gameplay' && value.encounterId === 's2:final'
    && integer(value.score, 0) && integer(value.completedAt, 0);
}
function normalizeRecord(record: CompletionRecord): CompletionRecord {
  return { runId: record.runId, ruleset: RULESET, difficulty: record.difficulty, encounterId: 's2:final',
    score: record.score, source: 'gameplay', completedAt: record.completedAt };
}
function derive(profile: SaveProfile): SaveProfile {
  const ordered: Record<string, CompletionRecord> = {};
  for (const key of Object.keys(profile.clears).sort()) {
    const record = profile.clears[key]; ordered[key] = record;
    profile.bestScores.v5[record.difficulty].story = Math.max(profile.bestScores.v5[record.difficulty].story, record.score);
  }
  profile.clears = ordered; return profile;
}
export function validateProfile(value: unknown): SaveProfile | null {
  if (!object(value) || value.version !== PROFILE_VERSION || !integer(value.revision, 0) || !object(value.clears)) return null;
  const profile = emptyProfile(); profile.revision = value.revision;
  for (const record of Object.values(value.clears)) if (validCompletion(record)) profile.clears[RULESET + ':' + record.runId] = normalizeRecord(record);
  const scores = object(value.bestScores) ? value.bestScores.v5 : null;
  if (object(scores)) for (const difficulty of ['normal', 'hard'] as const) {
    const modes = scores[difficulty];
    if (object(modes)) for (const mode of ['story', 'endless'] as const) if (integer(modes[mode], 0)) profile.bestScores.v5[difficulty][mode] = modes[mode];
  }
  return derive(profile);
}
export function mergeProfiles(a: SaveProfile, b: SaveProfile): SaveProfile {
  const merged = emptyProfile(); merged.revision = Math.max(a.revision, b.revision);
  for (const source of [a, b]) {
    for (const difficulty of ['normal', 'hard'] as const) for (const mode of ['story', 'endless'] as const)
      merged.bestScores.v5[difficulty][mode] = Math.max(merged.bestScores.v5[difficulty][mode], source.bestScores.v5[difficulty][mode]);
    for (const [key, record] of Object.entries(source.clears)) {
      const existing = merged.clears[key];
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
  private legacy: LegacyHistory = { clears: 0, records: {}, bestScores: { s1: { normal: 0, hard: 0 }, s2: { normal: 0, hard: 0 } } };
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
  getLegacyHistory(): LegacyHistory { return clone(this.legacy); }

  load(): SaveProfile {
    this.current = mergeProfiles(this.current, this.readDisk());
    return this.getProfile();
  }

  recordScore(mode: RunMode, difficulty: Difficulty, score: number): SaveResult {
    if ((mode !== 'story' && mode !== 'endless') || !difficultyId(difficulty) || !integer(score, 0)) return this.result(false);
    const next = this.getProfile(); next.bestScores.v5[difficulty][mode] = Math.max(next.bestScores.v5[difficulty][mode], score);
    return this.commit(next);
  }

  recordCompletion(input: CompletionInput): SaveResult {
    const record = { ...input, ruleset: RULESET, completedAt: input.completedAt ?? Date.now() };
    if (!validCompletion(record)) return this.result(false);
    const latest = mergeProfiles(this.current, this.readDisk());
    const key = RULESET + ':' + record.runId;
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

  private readLegacy(): void {
    if (!this.storage) return;
    for (const key of [LEGACY_PROFILE_KEY, LEGACY_PROFILE_KEY + ':backup']) {
      try {
        const history = validateLegacyProfile(JSON.parse(this.storage.getItem(key) ?? 'null'));
        if (!history) continue;
        for (const [id, record] of Object.entries(history.records)) {
          const previous = this.legacy.records[id];
          if (!previous || JSON.stringify(record) < JSON.stringify(previous)) this.legacy.records[id] = record;
        }
        this.legacy.clears = Object.keys(this.legacy.records).length;
        for (const season of ['s1', 's2'] as const) for (const difficulty of ['normal', 'hard'] as const)
          this.legacy.bestScores[season][difficulty] = Math.max(this.legacy.bestScores[season][difficulty], history.bestScores[season][difficulty]);
      } catch { /* A corrupt legacy profile must not invalidate current records. */ }
    }
    for (const difficulty of ['normal', 'hard'] as const) {
      const raw = this.storage.getItem('mafuyu-sekai:best:v3' + (difficulty === 'hard' ? ':hard' : '')), score = raw === null ? 0 : Number(raw);
      if (integer(score, 0)) this.legacy.bestScores.s1[difficulty] = Math.max(this.legacy.bestScores.s1[difficulty], score);
    }
  }

  private readDisk(): SaveProfile {
    this.copiesHealthy = true;
    if (!this.storage) return emptyProfile();
    this.readFailed = false;
    try {
      this.readLegacy();
      const primary = this.parse(this.storage.getItem(PROFILE_KEY));
      const backup = this.parse(this.storage.getItem(PROFILE_BACKUP_KEY));
      if (primary || backup) {
        const merged = mergeProfiles(primary ?? emptyProfile(), backup ?? emptyProfile());
        const content = fingerprint(merged);
        this.copiesHealthy = !!primary && !!backup && fingerprint(primary) === content && fingerprint(backup) === content;
        return merged;
      }
      return emptyProfile();
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
      // Mirror only after the primary succeeded, including the very first completed run.
      try { this.storage.setItem(PROFILE_BACKUP_KEY, serialized); }
      catch { this.error = '主存档已保存，备份暂时无法更新。'; }
    } catch { this.unavailable('存档写入失败，进度仅保留在本次会话；请保留此页面后重试保存。'); }
    return this.result(changed);
  }

  private unavailable(error: string): void { this.status = 'session-only'; this.error = '未保存到浏览器：' + error; }
  private result(changed: boolean): SaveResult { return { profile: this.getProfile(), status: this.status, changed, error: this.error }; }
}
