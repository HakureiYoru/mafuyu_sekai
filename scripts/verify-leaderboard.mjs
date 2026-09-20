import assert from 'node:assert/strict';
import { request } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Use preview/local only. Public boards must never receive diagnostic scores.
const baseURL = process.env.ARCADE_TEST_URL ?? 'http://127.0.0.1:5187';
if (baseURL === 'https://mafuyu-sekai.vercel.app') throw new Error('Use an isolated preview deployment for submissions');
const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};
const proxy = process.env.ARCADE_TEST_PROXY ? { server: process.env.ARCADE_TEST_PROXY } : undefined;
const contextOptions = { baseURL, extraHTTPHeaders: headers, proxy };
const a = await request.newContext(contextOptions), b = await request.newContext(contextOptions);
const selection = { difficulty: 'normal', mode: 'story', controls: 'keyboardMouse' };
const checks = [];
async function start(ctx, board = selection) {
  const res = await ctx.post('/api/run', { data: board }); assert.equal(res.status(), 200, await res.text());
  assert.equal(res.headers()['x-arcade-environment'], 'preview', 'Refusing test scores outside an isolated preview'); return res.json();
}
async function submit(ctx, ticket, score, extras = {}, name = '测试·笑梦') {
  const result = { ...selection, rules: 'v6.2', runId: ticket.runId, score, elapsed: 2, progression: 1, wave: 1, outcome: 'quit', ...extras };
  const res = await ctx.post('/api/submit', { data: { token: ticket.token, nickname: name, result } });
  return { status: res.status(), data: await res.json() };
}
async function board(ctx, data = selection) { const r = await ctx.get(`/api/leaderboard?${new URLSearchParams(data)}`); assert.equal(r.status(), 200, await r.text()); return r.json(); }
try {
  const ticket = await start(a);
  const repeated = await Promise.all(Array.from({ length: 4 }, () => submit(a, ticket, 2000)));
  assert(repeated.every(r => r.status === 200));
  let mine = await board(a); assert.equal(mine.own.score, 2000); const achieved = mine.own.achievedAt;
  assert.equal(mine.entries.filter(e => e.achievedAt === achieved).length, 1); checks.push('concurrent idempotent submission');
  await submit(a, await start(a), 1000); mine = await board(a); assert.equal(mine.own.score, 2000); assert.equal(mine.own.achievedAt, achieved); checks.push('low score preserves best and original time');
  await submit(a, await start(a), 3000, {}, '改名·笑梦'); mine = await board(a); assert.equal(mine.own.nickname, '改名·笑梦'); checks.push('new best and renamed entry');
  await submit(b, await start(b), 3000, {}, '改名·笑梦');
  const other = await board(b); assert(other.own.rank > mine.own.rank); checks.push('duplicate names, server-first tie ordering, cross-browser read');
  const reload = await request.newContext({ ...contextOptions, storageState: await a.storageState() });
  assert.equal((await board(reload)).own.score, 3000); await reload.dispose(); checks.push('identity survives reload');
  for (const difficulty of ['normal', 'hard']) for (const mode of ['story', 'endless']) for (const controls of ['keyboardMouse', 'touch']) {
    if (difficulty === 'normal' && mode === 'story' && controls === 'keyboardMouse') continue;
    assert.equal((await board(b, { difficulty, mode, controls })).own, null);
  } checks.push('eight isolated boards');
  const fresh = await start(b);
  assert.equal((await submit(b, fresh, -1)).status, 400);
  assert.equal((await submit(b, fresh, 1000, {}, '<script>')).status, 400);
  assert.equal((await submit(b, fresh, 1000, { elapsed: 5000 })).status, 400);
  assert.equal((await submit(a, fresh, 1000)).status, 401); checks.push('invalid input, impossible duration, stolen ticket rejected');
  const statuses = await Promise.all(Array.from({ length: 14 }, () => b.post('/api/run', { data: selection }).then(r => r.status())));
  assert(statuses.includes(429)); checks.push('identity/IP rate limiting');
  const report = { date: new Date().toISOString(), target: baseURL, checks, publicScoresWritten: false };
  await mkdir('docs/validation', { recursive: true }); await writeFile('docs/validation/v6.2-leaderboard.json', JSON.stringify(report, null, 2)); console.log(report);
} catch (error) {
  const message = String(error).replaceAll(process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '\u0000', '[redacted]');
  console.error(message); process.exitCode = 1;
} finally { await a.dispose(); await b.dispose(); }
