import { useEffect, useState, useSyncExternalStore } from 'react';
import '../leaderboard/leaderboard.css';
import { ASSET_URLS } from '../game/config';
import type { LeaderboardClient } from '../leaderboard/client';
import { cleanNickname, type Board, type BoardResponse, type RankedEntry } from '../leaderboard/protocol';

const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const status = { failed: '倒下了', complete: '通关', quit: '主动结束' };
export function ScoreEntry({ client }: { client: LeaderboardClient }) {
  const online = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [name, setName] = useState(() => client.nickname());
  const pending = [...online.pending].reverse().find(p => !p.submitted);
  return <div className="score-entry">
    {pending && <form onSubmit={event => { event.preventDefault(); const nickname = cleanNickname(name); if (!nickname) return; client.remember(nickname); void client.submit(pending, nickname); }}>
      <label htmlFor="arcade-name">留下分数 <span>{pending.result.mode === 'story' ? '剧情' : '无尽'} · {pending.result.score.toLocaleString()}</span></label>
      <div><input id="arcade-name" autoComplete="nickname" placeholder="你的街机 ID（1–12 字）" value={name} onChange={event => setName(event.target.value)} aria-label="排行榜昵称" />
        <button className="button button-secondary" disabled={online.busy || !cleanNickname(name)}>{online.busy ? '提交中…' : '留名'}</button></div>
    </form>}
    {online.notice && <p role="status">{online.notice}</p>}
  </div>;
}
export function Leaderboard({ client, initial }: { client: LeaderboardClient; initial: Board }) {
  const [board, setBoard] = useState(initial), [data, setData] = useState<BoardResponse | null>(null);
  const [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true; setData(null); setError('');
    void client.load(board).then(result => { if (alive) setData(result); }).catch(() => { if (alive) setError('暂时连不上排行榜，请稍后重试。'); });
    return () => { alive = false; };
  }, [board, client, revision]);
  const row = (entry: RankedEntry, own = false) => <li className={own ? 'arcade-own' : ''} key={`${entry.rank}:${own}`}>
    <span className="arcade-rank">{entry.rank}</span><img src={ASSET_URLS.player} alt="" />
    <div className="arcade-name"><strong>{own ? '你 · ' : ''}{entry.nickname}</strong><small>{entry.mode === 'endless' ? `无尽 ${entry.wave} 波` : `推进 ${Math.floor(entry.progression / 3.6)}%`} · {status[entry.outcome]} · {time(entry.elapsed)}</small></div>
    <b>{entry.score.toLocaleString()}</b></li>;
  return <div className="arcade-board">
    <div className="arcade-filters">{(['difficulty', 'mode', 'controls'] as const).map(key => <select key={key} aria-label={{ difficulty: '榜单难度', mode: '榜单模式', controls: '榜单操作' }[key]} value={board[key]} onChange={event => setBoard({ ...board, [key]: event.target.value })}>
      {(key === 'difficulty' ? [['normal', '普通'], ['hard', '困难']] : key === 'mode' ? [['story', '剧情'], ['endless', '无尽']] : [['keyboardMouse', '键鼠'], ['touch', '触屏']]).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </select>)}<button className="text-button" onClick={() => setRevision(value => value + 1)}>刷新</button></div>
    {error ? <p role="status">{error}</p> : !data ? <p role="status">正在连接街机厅…</p> : <>
      {data.own && <ol className="arcade-list own-list">{row(data.own, true)}</ol>}
      <ol className="arcade-list">{data.entries.map(entry => row(entry))}</ol>
      {!data.entries.length && <p>还没有成绩。来当第一个 Wonderhoy！</p>}
      <p className="arcade-note">共 {data.total} 位玩家 · 展示前 100 名 · 同分先到先得</p></>}
    <p className="arcade-note">免注册休闲榜，每个浏览器保留各榜最高分。清除浏览器数据会失去原身份；不提供严格防作弊保证。</p>
  </div>;
}
