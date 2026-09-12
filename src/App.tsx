import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ASSET_URLS, BALANCE } from './game/config';
import type { GameSettings, HudSnapshot, RuntimeControls } from './game/types';
import changelog from 'virtual:changelog';
import { MODULES } from './game/upgrades';

type IconName = 'play' | 'pause' | 'settings' | 'arrow' | 'close' | 'sound' | 'spark' | 'restart';

function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    play: <path d="m8 5 11 7-11 7Z" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    sound: <><path d="m11 5-5 4H3v6h3l5 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
    spark: <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" />,
    restart: <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" /></>,
  };
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function Meter({ value, max = 1, className = '', label }: { value: number; max?: number; className?: string; label: string }) {
  const ratio = Math.max(0, Math.min(1, value / Math.max(1, max)));
  return <div className={`meter ${className}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.max(0, Math.min(max, value))}>
    <span className="meter-fill" style={{ transform: `scaleX(${ratio})` }} />
  </div>;
}

function Dialog({ children, title, eyebrow, onClose, className = '' }: { children: ReactNode; title: string; eyebrow: string; onClose?: () => void; className?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>('button:not([disabled]), input, select, [tabindex="0"]');
    (first ?? panel.current)?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="screen-overlay dialog-overlay" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose?.(); }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, a[href], [tabindex="0"]') ?? []);
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <div className={`dialog panel ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel} tabIndex={-1}>
      <div className="dialog-heading">
        <div><span className="eyebrow">{eyebrow}</span><h2 id={titleId}>{title}</h2></div>
        {onClose && <button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><Icon name="close" /></button>}
      </div>
      {children}
    </div>
  </div>;
}

function ControlsGuide({ compact = false }: { compact?: boolean }) {
  return <div className={`controls-guide ${compact ? 'compact' : ''}`}>
    <div><span className="keycaps"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>移动 · Shift 精准慢移</span></div>
    <div><span className="keycaps"><kbd>鼠标左键</kbd></span><span>瞄准 · 射击</span></div>
    <div><span className="keycaps"><kbd>R</kbd><span className="key-or">/</span><kbd>右键</kbd></span><span>冲刺后释放贯穿炮</span></div>
    <div><span className="keycaps"><kbd>空格</kbd></span><span>释放炸弹</span></div>
  </div>;
}

function SaveNotice({ snapshot: s }: { snapshot: HudSnapshot }) {
  return <p className={`save-notice save-${s.saveStatus}`} role="status">{s.saveMessage || (s.saveStatus === 'session' ? '浏览器暂时无法保存，进度仅保留在当前页面。' : s.saveStatus === 'saved' ? '通关与纪录已保存于此浏览器' : '通关后自动保存成长并解锁第二季')}</p>;
}

function Menu({ runtime, snapshot: s, openSettings, openChangelog }: { runtime: RuntimeControls; snapshot: HudSnapshot; openSettings: () => void; openChangelog: () => void }) {
  const latest = changelog[0];
  return <section className="menu-screen" aria-label="主菜单" style={{ '--scene-image': `url("${ASSET_URLS.bg}")` } as CSSProperties}>
    <div className="menu-simple">
      <h1 className="menu-title">MAFUYU SEKAI</h1>
      <div className="season-options" role="group" aria-label="选择季度">
        <button aria-pressed={s.seasonId === 's1'} onClick={() => runtime.setSeason('s1')}>第一季<span>失落的共鸣</span></button>
        <button aria-pressed={s.seasonId === 's2'} disabled={!s.season2Unlocked} onClick={() => runtime.setSeason('s2')}>第二季<span>{s.season2Unlocked ? '镜界复奏' : '通关第一季解锁'}</span></button>
      </div>
      <div className="difficulty-options" role="group" aria-label="游戏难度">
        <button aria-pressed={s.difficulty === 'normal'} onClick={() => runtime.setDifficulty('normal')}>普通</button>
        <button aria-pressed={s.difficulty === 'hard'} onClick={() => runtime.setDifficulty('hard')}>困难</button>
      </div>
      <p className="season-description">{s.seasonId === 's2' && s.carryover ? `继承 Lv.${s.carryover.level} · 子机 ${s.carryover.companions}/3 · 六段镜界与七次模块选择` : '五波街区 · 游猎回声 · 六张终章符卡'}</p>
      {s.difficulty === 'hard' && <p className="difficulty-note">更快敌人 · 密集攻势 · 受到伤害 ×2</p>}
      <button className="menu-start" onClick={() => runtime.start()}>开始游戏</button>
      <button className="menu-settings" onClick={openSettings}>体验设置</button>
      <div className="menu-instructions" aria-label="基本操作"><p>WASD 移动 · 鼠标左键 射击</p><p>R 或右键 冲刺 · 空格 炸弹</p><p>Shift 精准慢移 · Esc 暂停</p></div>
      <span className="menu-best">{s.difficulty === 'hard' ? '困难' : '普通'}纪录 {s.bestScore.toLocaleString('en-US')}</span>
      <SaveNotice snapshot={s} />
      <button className="menu-version" onClick={openChangelog}>{latest.version} · 更新日志</button>
    </div>
  </section>;
}

function Hud({ snapshot: s, runtime, openSettings }: { snapshot: HudSnapshot; runtime: RuntimeControls; openSettings: () => void }) {
  const [commsCollapsed, setCommsCollapsed] = useState(false);
  const perfect = s.perfectWindow > 0;
  const bossHp = s.bossMaxHp > 0 ? s.bossHp : s.minibossHp;
  const bossMax = s.bossMaxHp || s.minibossMaxHp;
  return <div className={`hud battle-hud ${s.phase !== 'playing' ? 'hud-inactive' : ''}`} aria-label="战斗状态">
    <div className="battle-top">
      <div className="stage-summary"><div><span className="status-dot" /><strong>{s.mode === 'endless' ? '无尽' : s.seasonId === 's2' ? '第二季' : '第一季'} · {s.difficulty === 'hard' ? '困难' : '普通'}</strong><span>{String(s.wave).padStart(2, '0')} / {s.mode === 'endless' ? '∞' : s.stageCount}</span></div><span className="stage-title">{s.stageName}{s.waveBlocked ? ' · 击败首领后继续' : ''}</span><Meter value={s.waveProgress} label="当前波次进度" /></div>
      <div className="encounter-summary">
        {bossMax > 0 ? <><div><strong>{s.cardName || (s.seasonId === 's1' ? 'ECHO' : s.minibossAction.split(' · ')[0])}</strong><span>{s.cardCount > 0 ? `${s.cardIndex} / ${s.cardCount}` : '首领战'} · {Math.ceil(100 * bossHp / bossMax)}%</span></div><Meter value={bossHp} max={bossMax} className="meter-violet" label={s.bossMaxHp > 0 ? '真冬生命' : '游猎回声生命'} /><p aria-label={s.bossMaxHp > 0 ? '首领行动' : '迷你首领行动'}>{s.bossMaxHp > 0 ? s.bossAction : s.minibossAction}</p></> : <><strong className="battle-announcement" role="status">{s.announcement || (s.arena ? '固定竞技场 · 注意场地边界' : '保持移动，收集共鸣')}</strong><span>{formatTime(s.elapsed)} · SCORE {String(s.score).padStart(7, '0')}</span></>}
      </div>
      <div className="battle-actions"><span className="battle-score">{String(s.score).padStart(7, '0')}<small>{formatTime(s.elapsed)}</small></span><span className="battle-bombs">✦ {s.bombs}<small>炸弹 / 空格</small></span><button className="icon-button" onClick={() => runtime.pause()} aria-label="暂停游戏"><Icon name="pause" /></button><button className="icon-button" onClick={openSettings} aria-label="暂停并打开设置"><Icon name="settings" /></button></div>
    </div>
    <div className="battle-bottom">
      <div className="battle-player"><div className="compact-heading"><img src={ASSET_URLS.player} alt="玩家头像" /><strong>LV. {String(s.level).padStart(2, '0')}</strong><span>{s.hp} / {s.maxHp} HP</span><span className="support-status" aria-label="子机支援">子机 {s.companions} / {BALANCE.companion.max}</span></div><div className="health-segments" role="meter" aria-label="生命" aria-valuenow={s.hp} aria-valuemin={0} aria-valuemax={s.maxHp}>{Array.from({ length: s.maxHp }, (_, i) => <span key={i} className={i < s.hp ? 'filled' : ''} />)}</div><div className="compact-growth"><span>{s.level >= 10 && s.seasonId === 's2' ? `共鸣 ${s.resonance} / 4 · 伤害 +${s.resonance * 5}%` : '武器成长'}</span><span>{s.level >= 10 ? 'MAX' : `${Math.floor(s.xp)} / ${s.xpNeeded}`}</span></div><Meter value={s.level >= 10 ? 1 : s.xp} max={s.level >= 10 ? 1 : s.xpNeeded} className="meter-violet" label="武器成长" /></div>
      <div className="battle-comms"><button className="compact-comms-toggle" onClick={() => setCommsCollapsed(value => !value)} aria-expanded={!commsCollapsed}>{commsCollapsed ? '展开通讯' : '通讯'}<span>{s.comms?.speaker ?? 'SYSTEM'} {commsCollapsed ? '+' : '−'}</span></button>{!commsCollapsed && <p>{s.comms?.text || s.announcement || '听见你的共鸣。'}</p>}<div className="module-summary" aria-label="已装配模块" title={s.modules.map(id => MODULES[id].name).join(' · ')}>{s.modules.length ? `${s.modules.length} / 7 模块 · ${s.modules.map(id => MODULES[id].name).join(' · ')}` : s.seasonId === 's2' ? '镜界模块将在段落结束后选择' : '冲刺结束后射击，释放贯穿炮'}</div></div>
      <div className="battle-weapon"><div className="compact-resource"><span>弹药 <strong>{Math.floor(s.ammo)} / {s.maxAmmo}</strong></span><Meter value={s.ammo} max={s.maxAmmo} label="弹药" /></div><div className={`compact-resource ${s.overheated ? 'is-hot' : ''}`}><span>{s.overheated ? '过热 · 松开射击' : '热量'} <strong>{Math.round(s.heat)}%</strong></span><Meter value={s.heat} max={100} className="meter-heat" label="武器热量" /></div><div className={`compact-dash ${perfect ? 'is-perfect' : ''}`}><strong>{perfect ? '贯穿炮就绪 · 现在射击' : s.dashCharges > 0 ? `冲刺就绪${s.modules.includes('doubleDash') ? ` ${s.dashCharges}/2` : ''}` : `冲刺 ${s.dashCooldown.toFixed(1)}秒`}</strong><kbd>R / 右键</kbd></div><Meter value={BALANCE.dash.cooldown - s.dashCooldown} max={BALANCE.dash.cooldown} className="dash-meter" label="冲刺冷却" /></div>
    </div>
  </div>;
}

function UpgradeChoice({ snapshot: s, runtime }: { snapshot: HudSnapshot; runtime: RuntimeControls }) {
  const branches = { main: '主炮', drone: '子机', resource: '机动与资源' };
  return <Dialog title={s.modules.length === 0 ? '带上新的共鸣' : '为下一程，选择强化'} eyebrow={`MIRROR RESONANCE / ${s.modules.length + 1} OF 7`} className="upgrade-dialog"><p className="dialog-description">战斗已暂停。按 1 / 2 / 3 或点击选择一个模块，本季挑战中持续生效。</p><div className="upgrade-cards">{s.upgradeChoices.map((id, index) => { const item = MODULES[id]; return <button key={id} className={`upgrade-card branch-${item.branch}`} onClick={() => runtime.chooseUpgrade(id)}><span className="upgrade-branch">{branches[item.branch]}<kbd>{index + 1}</kbd></span><strong>{item.name}</strong><p>{item.description}</p><span className="upgrade-confirm">选择模块 <Icon name="arrow" /></span></button>; })}</div><p className="upgrade-owned">{s.modules.length ? `已装配：${s.modules.map(id => MODULES[id].name).join(' · ')}` : '继承等级是本季下限，模块不会因受伤而丢失。'}</p><button className="text-button centered" onClick={() => runtime.returnToMenu()}>结束本局，返回主菜单</button></Dialog>;
}

function Settings({ settings, setSettings, onClose }: { settings: GameSettings; setSettings: (settings: Partial<GameSettings>) => void; onClose: () => void }) {
  const slider = (key: 'masterVolume' | 'musicVolume' | 'sfxVolume' | 'screenShake', label: string) => <label className="setting-slider"><span>{label}</span><input aria-label={label} type="range" min="0" max="1" step="0.05" value={settings[key]} onChange={event => setSettings({ [key]: Number(event.target.value) })} /><output>{Math.round(settings[key] * 100)}%</output></label>;
  return <Dialog title="调整你的体验" eyebrow="PREFERENCES" onClose={onClose} className="settings-dialog">
    <div className="settings-section"><div className="setting-section-title">画面品质<span>选择适合设备的流畅度与细节</span></div><div className="quality-options" role="group" aria-label="画面品质">{([{ value: 'low', label: '轻量', note: '优先流畅' }, { value: 'medium', label: '均衡', note: '推荐体验' }, { value: 'high', label: '细腻', note: '更多光影' }] as const).map(item => <button className={settings.quality === item.value ? 'selected' : ''} key={item.value} aria-pressed={settings.quality === item.value} onClick={() => setSettings({ quality: item.value })}><strong>{item.label}</strong><span>{item.note}</span><span className="quality-check">{settings.quality === item.value ? '✓' : '○'}</span></button>)}</div></div>
    <div className="settings-section"><div className="setting-section-title"><Icon name="sound" />声音</div>{slider('masterVolume', '主音量')}{slider('musicVolume', '背景音乐')}{slider('sfxVolume', '战斗音效')}</div>
    <div className="settings-section"><div className="setting-section-title">动效与反馈</div>{slider('screenShake', '镜头震动')}<label className="setting-switch"><span><strong>减弱动态效果</strong><small>减少镜头震动、闪光与持续动画</small></span><input type="checkbox" checked={settings.reducedMotion} onChange={event => setSettings({ reducedMotion: event.target.checked })} /><span className="switch-track" aria-hidden="true" /></label></div>
    <div className="settings-footer"><span>设置自动保存于此设备</span><button className="button button-primary button-small" onClick={onClose}>完成 <Icon name="arrow" /></button></div>
  </Dialog>;
}

function RunResults({ snapshot }: { snapshot: HudSnapshot }) {
  return <div className="run-results"><div><span>本局得分</span><strong>{snapshot.score.toLocaleString('en-US')}</strong></div><div><span>击破敌人</span><strong>{snapshot.kills}</strong></div><div><span>共鸣时间</span><strong>{formatTime(snapshot.elapsed)}</strong></div></div>;
}

function Changelog({ onClose }: { onClose: () => void }) {
  return <Dialog title="共鸣，持续更新" eyebrow="RELEASE NOTES" onClose={onClose} className="changelog-dialog">
    <p className="dialog-description">本次更新与最近的世界记录。</p>
    <div className="changelog-entries">{changelog.slice(0, 4).map((release, index) => <section className={`changelog-entry ${index === 0 ? 'latest' : ''}`} key={release.version}>
      <div className="changelog-meta"><span>{release.version}{index === 0 && <b>当前版本</b>}</span><time dateTime={release.date}>{release.date}</time></div>
      <h3>{release.title}</h3>
      <ul>{release.highlights.map(highlight => <li key={highlight}>{highlight}</li>)}</ul>
    </section>)}</div>
    <button className="button button-secondary changelog-done" onClick={onClose}>返回世界</button>
  </Dialog>;
}

export default function App({ runtime }: { runtime: RuntimeControls }) {
  const subscribe = useCallback((listener: () => void) => runtime.subscribe(listener), [runtime]);
  const getSnapshot = useCallback(() => runtime.getSnapshot(), [runtime]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const debug = new URLSearchParams(window.location.search).get('debug') === '1';
  const openSettings = () => { if (snapshot.phase === 'playing') runtime.pause(); setSettingsOpen(true); };
  const inRun = ['playing', 'paused', 'upgrade', 'failed', 'complete'].includes(snapshot.phase);
  useEffect(() => {
    if (!['paused', 'menu', 'failed', 'complete'].includes(snapshot.phase)) setSettingsOpen(false);
  }, [snapshot.phase]);
  return <div className={`app phase-${snapshot.phase} ${snapshot.settings.reducedMotion ? 'reduce-motion' : ''}`}>
    {inRun && <Hud snapshot={snapshot} runtime={runtime} openSettings={openSettings} />}
    {snapshot.phase === 'menu' && <Menu runtime={runtime} snapshot={snapshot} openSettings={openSettings} openChangelog={() => setChangelogOpen(true)} />}
    {snapshot.phase === 'loading' && <section className="screen-overlay loading-screen" aria-label="加载游戏"><span className="loading-mark" aria-hidden="true">✦</span><div className="eyebrow">MAFUYU SEKAI</div><h1>正在连接世界</h1><div className="loading-progress"><Meter value={snapshot.loading} label="资源加载进度" /><span>{Math.round(snapshot.loading * 100)}%</span></div><p>让共鸣，再次响起。</p></section>}
    {snapshot.phase === 'upgrade' && <UpgradeChoice snapshot={snapshot} runtime={runtime} />}
    {!settingsOpen && snapshot.phase === 'paused' && <Dialog title="稍作停留" eyebrow="TAKE A BREATH" onClose={() => runtime.resume()}><p className="dialog-description">世界正在等你。准备好后，继续共鸣。</p><RunResults snapshot={snapshot} /><div className="dialog-actions"><button className="button button-primary" onClick={() => runtime.resume()}><Icon name="play" />继续游戏 <kbd>ESC</kbd></button><button className="button button-secondary" onClick={openSettings}><Icon name="settings" />体验设置</button><button className="text-button centered" onClick={() => runtime.returnToMenu()}>结束本局，返回主菜单</button></div><ControlsGuide compact /></Dialog>}
    {!settingsOpen && snapshot.phase === 'failed' && <Dialog title="这次共鸣，暂时中断" eyebrow="RESONANCE LOST" className="result-dialog failure-dialog"><div className="result-emblem" aria-hidden="true">✧</div><p className="dialog-description">{snapshot.seasonId === 's2' ? '本季模块已归零。再次挑战将恢复第一季通关成长，从镜界入口开始。' : '每一次靠近，都是下一次前进的起点。'}</p><RunResults snapshot={snapshot} /><div className="result-detail"><span>{snapshot.stageName} · 第 {snapshot.wave} 段</span><span>最高纪录 {snapshot.bestScore.toLocaleString('en-US')}</span></div><div className="dialog-actions"><button className="button button-primary" onClick={() => runtime.restart()}><Icon name="restart" />再次挑战</button><button className="button button-secondary" onClick={() => runtime.returnToMenu()}>返回主菜单</button></div></Dialog>}
    {!settingsOpen && snapshot.phase === 'complete' && <Dialog title="你的声音，抵达了这里" eyebrow="RESONANCE RESTORED" className="result-dialog complete-dialog"><div className="result-emblem" aria-hidden="true">✦</div><p className="dialog-description">{snapshot.seasonId === 's2' ? '镜界复奏完成。两个世界，都留下了你的共鸣。' : snapshot.season2Unlocked ? '第一季通关成长已保留，镜界复奏现已开放。' : '世界重归平静。让这份共鸣在无尽挑战中继续。'}</p><RunResults snapshot={snapshot} /><SaveNotice snapshot={snapshot} /><div className="dialog-actions">{snapshot.seasonId === 's1' && snapshot.season2Unlocked && <button className="button button-primary" onClick={() => runtime.continueSeason()}>进入第二季 · 镜界复奏<Icon name="arrow" /></button>}<button className="button button-secondary" onClick={() => runtime.continueEndless()}><Icon name="spark" />继续 · 无尽挑战<Icon name="arrow" /></button><button className="button button-secondary" onClick={() => runtime.restart()}><Icon name="restart" />重新开始</button><button className="text-button centered" onClick={() => runtime.returnToMenu()}>返回主菜单</button></div></Dialog>}
    {snapshot.phase === 'error' && <Dialog title="世界暂时无法连接" eyebrow="CONNECTION INTERRUPTED" className="error-dialog"><p className="dialog-description">{snapshot.error || '游戏加载遇到了问题，请重新连接。'}</p><div className="dialog-actions"><button className="button button-primary" onClick={() => runtime.start()}><Icon name="restart" />重新连接</button><button className="text-button centered" onClick={() => window.location.reload()}>刷新页面</button></div></Dialog>}
    {settingsOpen && <Settings settings={snapshot.settings} setSettings={settings => runtime.setSettings(settings)} onClose={() => setSettingsOpen(false)} />}
    {changelogOpen && snapshot.phase === 'menu' && <Changelog onClose={() => setChangelogOpen(false)} />}
    {debug && <aside className="debug-panel" aria-label="性能信息"><strong>PERFORMANCE</strong><span>FPS {snapshot.stats.fps.toFixed(0)} · P95 {snapshot.stats.frameP95.toFixed(1)}ms · P99 {snapshot.stats.frameP99.toFixed(1)}ms</span><span>更新 {snapshot.stats.updateMs.toFixed(2)}ms · 渲染 {snapshot.stats.renderMs.toFixed(2)}ms</span><span>敌人 {snapshot.stats.enemies} · 子弹 {snapshot.stats.bullets} · 粒子 {snapshot.stats.particles}</span><span>道具 {snapshot.stats.pickups} · 音频 {snapshot.stats.voices} · 纹理 {snapshot.stats.textures}</span></aside>}
  </div>;
}
