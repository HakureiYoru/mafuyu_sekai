export const ONLINE_RULES = 'v6.3' as const;
export type Board = { difficulty: 'normal' | 'hard'; mode: 'story' | 'endless'; controls: 'keyboardMouse' | 'touch' };
export type RunResult = Readonly<Board & { rules: typeof ONLINE_RULES; runId: string; score: number; elapsed: number; progression: number; wave: number; outcome: 'failed' | 'complete' | 'quit' }>;
export type RankedEntry = Omit<RunResult, 'runId'> & { nickname: string; achievedAt: number; rank: number };
export type BoardResponse = { entries: RankedEntry[]; own: RankedEntry | null; total: number };
export type RunTicket = { token: string; runId: string; expiresAt: number };
export function validBoard(value: unknown): value is Board {
  if (!value || typeof value !== 'object') return false;
  const b = value as Board;
  return ['normal', 'hard'].includes(b.difficulty) && ['story', 'endless'].includes(b.mode) && ['keyboardMouse', 'touch'].includes(b.controls);
}
export const boardKey = (board: Board) => `${board.difficulty}:${board.mode}:${board.controls}`;
export function cleanNickname(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFKC').trim();
  return [...name].length >= 1 && [...name].length <= 12 && !/[\p{C}<>]/u.test(name) ? name : null;
}
export function validResult(value: unknown): value is RunResult {
  if (!validBoard(value)) return false;
  const r = value as RunResult;
  return r.rules === ONLINE_RULES && typeof r.runId === 'string' && /^[\w-]{10,80}$/.test(r.runId)
    && ['failed', 'complete', 'quit'].includes(r.outcome)
    && Number.isSafeInteger(r.score) && r.score >= 0 && r.score <= 100_000_000
    && Number.isFinite(r.elapsed) && r.elapsed >= 1 && r.elapsed <= 86400
    && Number.isFinite(r.progression) && r.progression >= 0 && r.progression <= 360
    && Number.isInteger(r.wave) && r.wave >= 1 && r.wave <= 10000
    && r.elapsed + 1 >= r.progression && r.score <= 5000 + r.elapsed * 5000
    && (r.mode !== 'endless' || r.elapsed >= 360)
    && (r.outcome !== 'complete' || r.mode === 'story' && r.progression === 360 && r.elapsed >= 360);
}
