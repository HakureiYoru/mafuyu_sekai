import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Redis } from '@upstash/redis';
import { ONLINE_RULES, boardKey, cleanNickname, validBoard, validResult, type Board, type RunResult } from '../src/leaderboard/protocol.js';

type Request = IncomingMessage & { body?: unknown };
type Claims = { id: string; runId?: string; rules?: string; audience?: string; difficulty?: string; controls?: string; issued: number; expires: number };
const TTL = 86400;
const COOKIE = 'mafuyu_arcade';
export function sign(claims: Claims, secret: string): string {
  const value = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
}
export function verify(token: string, secret: string, now = Date.now()): Claims | null {
  try {
    const [body, signature] = token.split('.');
    const expected = createHmac('sha256', secret).update(body).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as Claims;
    return typeof claims.id === 'string' && Number.isFinite(claims.expires) && claims.expires > now ? claims : null;
  } catch { return null; }
}
// A single transaction preserves the first attainment time, personal best and per-mode idempotency.
export const COMMIT_SCORE = `
local prior = redis.call('GET', KEYS[4])
if prior then return prior end
local old = redis.call('HGET', KEYS[2], ARGV[1])
local entry = cjson.decode(ARGV[2])
local improved = true
if old then
 local previous = cjson.decode(old)
 if previous.score >= entry.score then
  improved = false
  previous.nickname = entry.nickname
  redis.call('HSET', KEYS[2], ARGV[1], cjson.encode(previous))
 else redis.call('ZREM', KEYS[1], previous.member) end
end
if improved then
 entry.member = ARGV[3]
 redis.call('HSET', KEYS[2], ARGV[1], cjson.encode(entry))
 redis.call('HSET', KEYS[3], ARGV[3], ARGV[1])
 redis.call('ZADD', KEYS[1], -entry.score, ARGV[3])
 if old then redis.call('HDEL', KEYS[3], cjson.decode(old).member) end
end
local result = cjson.encode({saved=true, improved=improved})
redis.call('SET', KEYS[4], result, 'EX', ARGV[4])
return result`;
const LIMIT = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n`;
function environment() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  const secret = process.env.LEADERBOARD_SIGNING_SECRET;
  if (!url || !token || !secret || process.env.LEADERBOARD_DISABLED === '1') throw new Error('unavailable');
  // Preview builds never write to public boards, even when sharing a free database.
  const namespace = `arcade:${ONLINE_RULES}:${process.env.VERCEL_ENV === 'production' ? 'production' : 'preview'}`;
  return { redis: new Redis({ url, token, automaticDeserialization: false }), secret, namespace };
}
function respond(res: ServerResponse, status: number, value: unknown) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.statusCode = status; res.end(JSON.stringify(value));
}
export function handler(action: 'run' | 'submit' | 'board') {
  return async (req: Request, res: ServerResponse) => {
    if (req.method !== (action === 'board' ? 'GET' : 'POST')) { respond(res, 405, { error: '不支持的请求' }); return; }
    try {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) { respond(res, 403, { error: '请从游戏页面提交' }); return; }
      if (Number(req.headers['content-length'] ?? 0) > 8192) { respond(res, 413, { error: '请求过大' }); return; }
      const { redis, secret, namespace: ns } = environment();
      res.setHeader('X-Arcade-Environment', process.env.VERCEL_ENV === 'production' ? 'production' : 'preview');
      const cookie = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      const identity = cookie ? verify(cookie, secret) : null;
      const ip = String(req.headers['x-vercel-forwarded-for'] ?? req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0];
      const ipHash = createHmac('sha256', secret).update(ip).digest('hex').slice(0, 24);
      const counts = await Promise.all([
        redis.eval<number[], number>(LIMIT, [`${ns}:rate:ip:${action}:${ipHash}`], [60]),
        identity ? redis.eval<number[], number>(LIMIT, [`${ns}:rate:id:${action}:${identity.id}`], [60]) : 0,
      ]);
      if (counts[0] > (action === 'board' ? 60 : 30) || counts[1] > (action === 'board' ? 30 : 12)) {
        res.setHeader('Retry-After', '60'); respond(res, 429, { error: '太快啦，等一分钟再试' }); return;
      }
      const body = typeof req.body === 'string' ? JSON.parse(req.body) as Record<string, unknown> : req.body as Record<string, unknown> | undefined;
      if (action === 'run') {
        if (!body || !validBoard({ ...body, mode: 'story' })) { respond(res, 400, { error: '开局设置无效' }); return; }
        const now = Date.now(), id = identity?.id ?? randomUUID();
        if (!identity) res.setHeader('Set-Cookie', `${COOKIE}=${sign({ id, issued: now, expires: now + 365 * TTL * 1000 }, secret)}; Path=/; Max-Age=${365 * TTL}; HttpOnly; SameSite=Lax${process.env.VERCEL ? '; Secure' : ''}`);
        const claims: Claims = { id, runId: randomUUID(), rules: ONLINE_RULES, audience: ns, difficulty: String(body.difficulty), controls: String(body.controls), issued: now, expires: now + TTL * 1000 };
        respond(res, 200, { token: sign(claims, secret), runId: claims.runId, expiresAt: claims.expires }); return;
      }
      if (action === 'submit') {
        const claims = typeof body?.token === 'string' ? verify(body.token, secret) : null;
        const result = body?.result, nickname = cleanNickname(body?.nickname);
        if (!claims || claims.rules !== ONLINE_RULES || claims.audience !== ns || !identity || claims.id !== identity.id) { respond(res, 401, { error: '本局凭证已过期或身份不可用，请开始新的一局' }); return; }
        if (!nickname || !validResult(result) || result.runId !== claims.runId || result.difficulty !== claims.difficulty
          || claims.controls === 'touch' && result.controls !== 'touch'
          || result.elapsed > (Date.now() - claims.issued) / 1000 + 8) { respond(res, 400, { error: '成绩或昵称不符合本榜规则' }); return; }
        const board = `${ns}:${boardKey(result)}`, time = Date.now();
        const entry = { ...result, nickname, achievedAt: time };
        const status = await redis.eval<(string | number)[], string>(COMMIT_SCORE, [`${board}:order`, `${board}:entries`, `${board}:owners`, `${ns}:submitted:${claims.runId}:${result.mode}`], [identity.id, JSON.stringify(entry), `${String(time).padStart(13, '0')}:${identity.id}`, TTL]);
        respond(res, 200, JSON.parse(status)); return;
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      const selection = Object.fromEntries(url.searchParams);
      if (!validBoard(selection)) { respond(res, 400, { error: '榜单不存在' }); return; }
      const board = `${ns}:${boardKey(selection as Board)}`;
      const [members, ownRaw, total] = await Promise.all([
        redis.zrange<string[]>(`${board}:order`, 0, 99),
        identity ? redis.hget<string>(`${board}:entries`, identity.id) : null,
        redis.zcard(`${board}:order`),
      ]);
      // Raw Redis mode deliberately returns HMGET arrays, not the SDK's deserialized field map.
      const owners = members.length ? await redis.hmget(`${board}:owners`, ...members) as unknown as (string | null)[] : [];
      const ids = owners.filter((id): id is string => !!id);
      const entries = ids.length ? await redis.hmget(`${board}:entries`, ...ids) as unknown as (string | null)[] : [];
      const publicEntry = (raw: string, rank: number) => {
        const e = JSON.parse(raw) as RunResult & { nickname: string; achievedAt: number };
        // Anonymous IDs, run credentials and internal sorted-set members stay private.
        return { rules: e.rules, difficulty: e.difficulty, mode: e.mode, controls: e.controls, score: e.score, elapsed: e.elapsed,
          progression: e.progression, wave: e.wave, outcome: e.outcome, nickname: e.nickname, achievedAt: e.achievedAt, rank };
      };
      const ownMember = ownRaw ? (JSON.parse(ownRaw) as { member: string }).member : null;
      const rank = ownMember ? await redis.zrank(`${board}:order`, ownMember) : null;
      respond(res, 200, { entries: entries.flatMap((raw, i) => raw ? [publicEntry(raw, i + 1)] : []),
        own: ownRaw && rank !== null ? publicEntry(ownRaw, rank + 1) : null, total });
    } catch { respond(res, 503, { error: '排行榜暂时连不上，本地成绩照常保存，请稍后重试' }); }
  };
}
