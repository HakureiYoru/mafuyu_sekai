import { describe, expect, it, vi } from 'vitest';
import { LeaderboardClient } from './client';
import { boardKey, cleanNickname, validResult, type Board, type RunResult } from './protocol';
import { sign, verify } from '../../server/leaderboard';

const board: Board = { difficulty: 'normal', mode: 'story', controls: 'keyboardMouse' };
const result: RunResult = { ...board, rules: 'v6.2', runId: 'valid-run-123', score: 2500, elapsed: 100, progression: 80, wave: 1, outcome: 'failed' };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const storage = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } } as Storage; };
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };

describe('arcade boundaries and identity', () => {
  it('uses eight separate boards and Unicode nicknames without controls/markup', () => {
    const keys = ['normal', 'hard'].flatMap(difficulty => ['story', 'endless'].flatMap(mode => ['touch', 'keyboardMouse'].map(controls => boardKey({ difficulty, mode, controls } as Board))));
    expect(new Set(keys).size).toBe(8);
    expect(cleanNickname(' 笑梦😀 ')).toBe('笑梦😀'); expect(cleanNickname('😀'.repeat(12))).not.toBeNull();
    for (const name of ['', 'x'.repeat(13), '<script>', '冬\n梦', '冬\u202e梦']) expect(cleanNickname(name)).toBeNull();
  });
  it('rejects old rules, malformed scores and impossible progression/time', () => {
    expect(validResult(result)).toBe(true);
    for (const change of [{ score: NaN }, { score: 1.2 }, { rules: 'v6' }, { elapsed: 2 }, { progression: 400 }, { outcome: 'complete' }, { mode: 'endless' }]) expect(validResult({ ...result, ...change })).toBe(false);
  });
  it('signatures bind the entire claim and expire; no unsigned identity is accepted', () => {
    const claims = { id: 'user', issued: 100, expires: 200 };
    const token = sign(claims, 'server secret');
    expect(verify(token, 'server secret', 150)).toEqual(claims);
    expect(verify(token, 'other secret', 150)).toBeNull(); expect(verify(token, 'server secret', 201)).toBeNull();
    expect(verify(token.replace(/.$/, 'x'), 'server secret', 150)).toBeNull();
    expect(verify('bad', 'server secret', 150)).toBeNull();
  });
});
describe('run results survive asynchronous credentials and retries', () => {
  it('freezes story before endless, classifies any touch use, and avoids duplicate settlement', async () => {
    let grant!: (res: Response) => void;
    const client = new LeaderboardClient(vi.fn(() => new Promise<Response>(resolve => { grant = resolve; })), storage());
    client.start(board, true); client.markTouch(); client.finish(result); client.finish(result);
    client.finish({ ...result, mode: 'endless', elapsed: 1200, score: 20000 });
    grant(response({ runId: result.runId, token: 'signed', expiresAt: Date.now() + 60000 })); await flush();
    expect(client.getSnapshot().pending).toHaveLength(2);
    expect(client.getSnapshot().pending.map(p => [p.result.mode, p.result.score, p.result.controls])).toEqual([['story', 2500, 'touch'], ['endless', 20000, 'touch']]);
    expect(Object.isFrozen(client.getSnapshot().pending[0].result)).toBe(true);
  });
  it('retains failed submissions through refresh, prevents double clicks and retries the same ticket', async () => {
    const store = storage();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ runId: result.runId, token: 'signed', expiresAt: Date.now() + 60000 })).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(response({ improved: true }));
    const client = new LeaderboardClient(request, store); client.start(board, true); client.finish(result); await flush();
    await Promise.all([client.submit(client.getSnapshot().pending[0], '笑梦'), client.submit(client.getSnapshot().pending[0], '笑梦')]);
    expect(request).toHaveBeenCalledTimes(2);
    const refreshed = new LeaderboardClient(request, store);
    expect(refreshed.getSnapshot().pending[0].submitted).toBe(false);
    await refreshed.submit(refreshed.getSnapshot().pending[0], '笑梦');
    expect(refreshed.getSnapshot().pending[0].submitted).toBe(true);
  });
  it('never requests ranked credentials for tests and still starts offline', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    const client = new LeaderboardClient(request, null); client.start(board, false); client.finish(result); await flush(); expect(request).not.toHaveBeenCalled();
    client.start(board, true); client.finish(result); await flush(); expect(client.getSnapshot().pending).toHaveLength(0);
    expect(client.getSnapshot().notice).toContain('本地成绩');
  });
});
