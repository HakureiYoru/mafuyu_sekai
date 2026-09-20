import { ONLINE_RULES, validResult, type Board, type BoardResponse, type RunResult, type RunTicket } from './protocol';

const KEY = 'mafuyu:online:pending:v6.3';
export interface PendingScore { result: RunResult; ticket: RunTicket; submitted: boolean }
export interface OnlineState { pending: readonly PendingScore[]; notice: string; busy: boolean }
export class LeaderboardClient {
  private state: OnlineState = { pending: [], notice: '', busy: false };
  private listeners = new Set<() => void>();
  private ticket: Promise<RunTicket | null> = Promise.resolve(null);
  private sequence = 0;
  private finalized = new Set<string>();
  private usedTouch = false;
  constructor(private request: typeof fetch = (input, init) => fetch(input, init), private storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage) {
    try {
      const saved = JSON.parse(this.storage?.getItem(KEY) ?? '[]') as PendingScore[];
      this.state.pending = Array.isArray(saved) ? saved.filter(p => validResult(p.result) && p.ticket?.expiresAt > Date.now() && typeof p.ticket.token === 'string').slice(-8) : [];
    } catch { /* Storage refusal never prevents play. */ }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.state;
  private update(partial: Partial<OnlineState>) {
    this.state = { ...this.state, ...partial };
    try { this.storage?.setItem(KEY, JSON.stringify(this.state.pending)); } catch { /* Session-only retry. */ }
    this.listeners.forEach(listener => listener());
  }
  private async json<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.request(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000) });
    const data = await res.json() as T & { error?: string };
    if (!res.ok) throw new Error(data.error ?? '排行榜暂时连不上，请稍后重试');
    return data;
  }
  start(board: Board, ranked: boolean) {
    this.sequence++; this.finalized.clear(); this.usedTouch = board.controls === 'touch';
    const sequence = this.sequence;
    this.update({ notice: ranked ? '' : '练习、调试及指定种子局不计入联网榜' });
    this.ticket = ranked ? this.json<RunTicket>('/api/run', board).catch(() => {
      if (sequence === this.sequence) this.update({ notice: '本局未取得联网凭证，本地成绩照常保存' });
      return null;
    }) : Promise.resolve(null);
  }
  markTouch() { this.usedTouch = true; }
  finish(value: Omit<RunResult, 'runId' | 'rules' | 'controls'>) {
    if (this.finalized.has(value.mode)) return;
    this.finalized.add(value.mode);
    const controls = this.usedTouch ? 'touch' : 'keyboardMouse';
    // Capture this run's promise and value before restart/endless can mutate either.
    const frozen = Object.freeze({ ...value, controls, rules: ONLINE_RULES });
    void this.ticket.then(ticket => {
      if (!ticket) return;
      const result = Object.freeze({ ...frozen, runId: ticket.runId });
      if (!validResult(result)) return;
      this.update({ pending: [...this.state.pending.filter(p => p.ticket.expiresAt > Date.now()), { result, ticket, submitted: false }].slice(-8) });
    });
  }
  async submit(pending: PendingScore, nickname: string) {
    if (this.state.busy) return;
    this.update({ busy: true, notice: '' });
    try {
      const result = await this.json<{ improved: boolean }>('/api/submit', { token: pending.ticket.token, result: pending.result, nickname });
      this.update({ pending: this.state.pending.map(p => p.result.runId === pending.result.runId && p.result.mode === pending.result.mode ? { ...p, submitted: true } : p),
        notice: result.improved ? 'Wonderhoy！成绩上榜啦！' : '成绩已登记，本榜保留你的最高分' });
    } catch (error) { this.update({ notice: error instanceof Error ? error.message : '未能提交，成绩已保留，可以重试' }); }
    finally { this.update({ busy: false }); }
  }
  load(board: Board): Promise<BoardResponse> { return this.json(`/api/leaderboard?${new URLSearchParams(board)}`); }
  nickname() { try { return this.storage?.getItem('mafuyu:arcade:nickname') ?? ''; } catch { return ''; } }
  remember(name: string) { try { this.storage?.setItem('mafuyu:arcade:nickname', name); } catch { /* Optional preference. */ } }
}
