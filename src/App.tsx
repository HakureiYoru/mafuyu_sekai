import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ASSET_URLS, BALANCE } from './game/config';
import type { GameSettings, HudSnapshot, RuntimeControls } from './game/types';
import changelog from 'virtual:changelog';
import { MODULES, EVOLUTIONS, choiceView, buildModuleViews } from './game/upgrades';
import { BINDING_LABELS, DEFAULT_KEYBINDINGS, isBindableKey, keyLabel, rebindKey } from './game/settings';
import type { BindingAction } from './game/settings';
import { BattleComms, useCommsPlacement } from './components/BattleComms';

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

function ControlsGuide({ settings, compact = false }: { settings: GameSettings; compact?: boolean }) {
  const key = (action: BindingAction) => keyLabel(settings.keybindings[action]);
  return <div className={`controls-guide ${compact ? 'compact' : ''}`}>
    <div><span className="keycaps">{(['moveUp', 'moveLeft', 'moveDown', 'moveRight'] as const).map(action => <kbd key={action}>{key(action)}</kbd>)}</span><span>移动 · {key('focus')} 慢速瞄准</span></div>
    <div><span className="keycaps"><kbd>鼠标左键</kbd></span><span>瞄准 · 射击</span></div>
    <div><span className="keycaps"><kbd>{key('dash')}</kbd><span className="key-or">/</span><kbd>右键</kbd></span><span>无敌冲刺 · 随后左键释放贯穿炮</span></div>
    <div><span className="keycaps"><kbd>{key('bomb')}</kbd><kbd>Esc</kbd></span><span>炸弹 · 暂停</span></div>
  </div>;
}

function SaveNotice({ snapshot: s }: { snapshot: HudSnapshot }) {
  return <p className={`save-notice save-${s.saveStatus}`} role="status">{s.saveMessage || (s.saveStatus === 'session' ? '浏览器暂时无法保存，进度仅保留在当前页面。' : s.saveStatus === 'saved' ? '通关与纪录已保存于此浏览器' : '每局从 Lv1 开始 · 成绩自动保存在此浏览器')}</p>;
}

function Menu({ runtime, snapshot: s, openSettings, openChangelog }: { runtime: RuntimeControls; snapshot: HudSnapshot; openSettings: () => void; openChangelog: () => void }) {
  const latest = changelog[0];
  return <section className="menu-screen" aria-label="主菜单" style={{ '--scene-image': `url("${ASSET_URLS.bg}")` } as CSSProperties}>
    <div className="menu-simple">
      <h1 className="menu-title">凤小梦大战朝比奈真冬</h1>
      <p className="menu-tagline">笑梦：Wonderhoy！！ 真冬：……闭嘴。</p>
      <div className="difficulty-options" role="group" aria-label="游戏难度">
        <button aria-pressed={s.difficulty === 'normal'} onClick={() => runtime.setDifficulty('normal')}>普通</button>
        <button aria-pressed={s.difficulty === 'hard'} onClick={() => runtime.setDifficulty('hard')}>困难</button>
      </div>
      {s.difficulty === 'hard' && <p className="difficulty-note">真冬失控了 · 敌人更快 · 受到伤害 ×2</p>}
      <button className="menu-start" onClick={() => runtime.start()}>开始游戏</button>
      <button className="menu-settings" onClick={openSettings}>体验设置</button>
      <div className="menu-instructions" aria-label="基本操作"><p>{(['moveUp', 'moveLeft', 'moveDown', 'moveRight'] as const).map(action => keyLabel(s.settings.keybindings[action])).join(' / ')} 移动 · 左键射击</p><p>{keyLabel(s.settings.keybindings.dash)} / 右键冲刺 · 随后左键贯穿炮</p><p>{keyLabel(s.settings.keybindings.focus)} 慢移 · {keyLabel(s.settings.keybindings.bomb)} 炸弹 · Esc 暂停</p></div>
      <span className="menu-best">{s.difficulty === 'hard' ? '困难' : '普通'}纪录 {s.bestScore.toLocaleString('en-US')}</span>
      {s.historicalBestScore > 0 && <span className="menu-history">旧版历史纪录 {s.historicalBestScore.toLocaleString('en-US')}</span>}
      <SaveNotice snapshot={s} />
      <button className="menu-version" onClick={openChangelog}>{latest.version} · 更新日志</button>
    </div>
  </section>;
}

function Hud({ snapshot: s, runtime, openSettings }: { snapshot: HudSnapshot; runtime: RuntimeControls; openSettings: () => void }) {
  const [commsCollapsed, setCommsCollapsed] = useState(false);
  const hud = useRef<HTMLDivElement>(null);
  const commsPlacement = useCommsPlacement(hud);
  const perfect = s.perfectWindow > 0;
  const bossHp = s.bossMaxHp > 0 ? s.bossHp : s.minibossHp;
  const bossMax = s.bossMaxHp || s.minibossMaxHp;
  const key = (action: BindingAction) => keyLabel(s.settings.keybindings[action]);
  const activeModules = s.moduleStates.filter(module => module.status === 'active' || module.status === 'cooldown' || module.status === 'consumed').slice(0, 3);
  return <div ref={hud} className={`hud battle-hud ${s.phase !== 'playing' ? 'hud-inactive' : ''}`} data-comms-layout={commsPlacement.layout} aria-label="战斗状态">
    <div className="battle-top">
      <div className="stage-summary"><div><span className="status-dot" /><strong>{s.mode === 'endless' ? '无尽' : '战役'} · {s.difficulty === 'hard' ? '困难' : '普通'}</strong><span>{s.mode === 'endless' ? '∞' : `${Math.floor(s.progression / 360 * 100)}%`}</span></div><span className="stage-title">{s.stageName}{s.waveBlocked ? ' · 击败首领后继续' : ''}</span><Meter value={s.waveProgress} label="战役推进进度" /></div>
      <div className="encounter-summary">
        {bossMax > 0 ? <><div><strong>{s.cardName || s.minibossAction.split(' · ')[0]}</strong><span>{s.cardCount > 0 ? `${s.cardIndex} / ${s.cardCount}` : '首领战'} · {Math.ceil(100 * bossHp / bossMax)}%</span></div><Meter value={bossHp} max={bossMax} className="meter-violet" label={s.bossMaxHp > 0 ? '真冬生命' : '迷你首领生命'} /><p aria-label={s.bossMaxHp > 0 ? '首领行动' : '迷你首领行动'}>{s.bossMaxHp > 0 ? s.bossAction : s.minibossAction.split(' · ').slice(1).join(' · ')}</p></> : <><strong className="battle-announcement" role="status">{s.announcement || (s.arena ? '固定竞技场 · 注意场地边界' : '跑起来！捡经验，别捡弹幕。')}</strong><span>{formatTime(s.elapsed)} · SCORE {String(s.score).padStart(7, '0')}</span></>}
      </div>
      <div className="battle-actions"><span className="battle-score">{String(s.score).padStart(7, '0')}<small>{formatTime(s.elapsed)}</small></span><span className="battle-bombs">✦ {s.bombs}<small>炸弹 / {key('bomb')}</small></span><button className="icon-button" onClick={() => runtime.pause()} aria-label="暂停游戏"><Icon name="pause" /></button><button className="icon-button" onClick={openSettings} aria-label="暂停并打开设置"><Icon name="settings" /></button></div>
    </div>
    <div className="battle-bottom">
      <div className="battle-player"><div className="compact-heading"><img src={ASSET_URLS.player} alt="玩家头像" /><strong>LV. {String(s.level).padStart(2, '0')}</strong><span>{s.hp} / {s.maxHp} HP</span><span className="support-status" aria-label="子机支援">子机 {s.companions} / {BALANCE.companion.max}</span></div><div className="health-segments" role="meter" aria-label="生命" aria-valuenow={s.hp} aria-valuemin={0} aria-valuemax={s.maxHp}>{Array.from({ length: s.maxHp }, (_, i) => <span key={i} className={i < s.hp ? 'filled' : ''} />)}</div><div className="compact-growth"><span>{s.level >= 10 ? `共鸣 ${s.resonance} / 4 · 伤害 +${s.resonance * 5}%` : '武器成长'}</span><span>{s.level >= 10 ? 'MAX' : `${Math.floor(s.xp)} / ${s.xpNeeded}`}</span></div><Meter value={s.level >= 10 ? 1 : s.xp} max={s.level >= 10 ? 1 : s.xpNeeded} className="meter-violet" label="武器成长" /></div>
      <div className="battle-comms"><button className="compact-comms-toggle" onClick={() => setCommsCollapsed(value => !value)} aria-label={commsCollapsed ? '展开战斗通讯' : '收起战斗通讯'} aria-expanded={!commsCollapsed}>{commsCollapsed ? '展开通讯' : '战斗通讯'}<span aria-hidden="true">{commsCollapsed ? '+' : '−'}</span></button><BattleComms snapshot={s} placement={commsPlacement} portalHost={hud} collapsed={commsCollapsed} /><div className="module-summary" aria-label="已装配模块">{s.modules.length} / 6 模块 · {s.evolutions.length} / 2 进化</div><div className="module-slots" aria-label="六个模块栏位">{Array.from({ length: 6 }, (_, i) => {
        const id = s.modules[i], evolved = id && s.evolutions.map(key => EVOLUTIONS[key]).find(item => item.primary === id);
        return <span key={i} className={evolved ? 'is-evolved' : id ? 'is-equipped' : ''} title={id ? evolved?.name ?? MODULES[id].name : '空模块栏位'}>{id ? <>{evolved?.name ?? MODULES[id].name}<b>{evolved ? '✦' : (s.moduleRanks[id] ?? 1) === 2 ? 'II' : 'I'}</b></> : '—'}</span>;
      })}</div><div className="module-live" aria-label="模块即时状态">{activeModules.map(module => <span key={module.id} className={`module-${module.status}`}>{MODULES[module.id].name} · {module.status === 'consumed' ? '已用尽' : module.status === 'active' ? '生效中' : `${module.remaining.toFixed(1)}s`}</span>)}</div></div>
      <div className="battle-weapon"><div className={`compact-resource ${s.overheated ? 'is-hot' : ''}`}><span>{s.overheated ? '过热 · 松开射击' : '热量'} <strong>{Math.round(s.heat)}%</strong></span><Meter value={s.heat} max={100} className="meter-heat" label="武器热量" /></div><div className="weapon-skills"><div className={`skill-chip ${s.dashCharges > 0 ? 'is-ready' : ''}`}><kbd>{key('dash')}</kbd><span>冲刺 <strong>{s.dashCharges > 0 ? s.modules.includes('doubleDash') ? `${s.dashCharges}/2` : '就绪' : `${s.dashCooldown.toFixed(1)}s`}</strong></span></div><div className={`skill-chip ${perfect ? 'is-beam-ready' : ''}`}><kbd>左键</kbd><span>贯穿炮 <strong>{perfect ? `${s.perfectWindow.toFixed(2)}s` : '冲刺后射击'}</strong></span></div></div></div>
    </div>
  </div>;
}

function EvolutionRecipes({ snapshot: s }: { snapshot: HudSnapshot }) {
  return <details className="evolution-recipes"><summary>进化组合 <span>{s.evolutions.length} / 2</span></summary><p>主模块 II＋搭配模块 I，在首领奖励中选择进化；仍占原有栏位。</p><div>{Object.values(EVOLUTIONS).map(item => <p key={item.id} className={s.evolutions.includes(item.id) ? 'is-evolved' : ''}><strong>{item.name}</strong><span>{MODULES[item.primary].name} II ＋ {MODULES[item.partner].name} I</span></p>)}</div></details>;
}

function UpgradeChoice({ snapshot: s, runtime }: { snapshot: HudSnapshot; runtime: RuntimeControls }) {
  const branches = { main: '主炮', drone: '子机', resource: '机动与资源' };
  const kinds = { module: '新模块', rank: '升至 II', evolution: '组合进化', resource: '补给' };
  return <Dialog title={s.choiceSource === 'boss' ? '首领奖励' : '选择强化'} eyebrow={`已装配 ${s.modules.length} / 6 · 已进化 ${s.evolutions.length} / 2`} className="upgrade-dialog">
    <p className="dialog-description">笑梦：「哇！变强！」战斗已暂停，按 1 / 2 / 3 或点击选择后继续。</p>
    <div className="upgrade-cards">{s.upgradeChoices.map((id, index) => {
      const item = choiceView({ modules: [...s.modules], ranks: s.moduleRanks }, id);
      return <button key={s.upgradeOfferId + ':' + id} className={`upgrade-card branch-${item.branch} choice-${item.kind}`} onClick={() => runtime.chooseUpgrade(id, s.upgradeOfferId ?? undefined)}><span className="upgrade-branch">{branches[item.branch]} · {kinds[item.kind]}<kbd>{index + 1}</kbd></span><strong>{item.name}</strong>{item.flavor && <small className="module-flavor">{item.flavor}</small>}<p>{item.description}</p><span className="upgrade-confirm">选择强化 <Icon name="arrow" /></span></button>;
    })}</div>
    <div className="upgrade-toolbar"><span>{s.modules.length ? `已装配：${buildModuleViews({ modules: [...s.modules], ranks: s.moduleRanks, evolutions: [...s.evolutions] }).map(item => item.name + (item.evolution ? ' ✦' : item.rank === 2 ? ' II' : ' I')).join(' · ')}` : '模块在本局持续生效，受伤不会丢失。'}</span><button className="button button-secondary button-small" disabled={s.rerollsRemaining === 0} onClick={() => runtime.rerollUpgrades()}>重抽 · {s.rerollsRemaining}</button></div>
    <EvolutionRecipes snapshot={s} />
    <button className="text-button centered" onClick={() => runtime.returnToMenu()}>结束本局，返回主菜单</button>
  </Dialog>;
}

function Settings({ settings, setSettings, onClose }: { settings: GameSettings; setSettings: (settings: Partial<GameSettings>) => void; onClose: () => void }) {
  const [binding, setBinding] = useState<BindingAction | null>(null);
  const [bindingNotice, setBindingNotice] = useState('点击动作后按下新按键；重复按键会交换。');
  const slider = (key: 'masterVolume' | 'musicVolume' | 'sfxVolume' | 'screenShake', label: string) => <label className="setting-slider"><span>{label}</span><input aria-label={label} type="range" min="0" max="1" step="0.05" value={settings[key]} onChange={event => setSettings({ [key]: Number(event.target.value) })} /><output>{Math.round(settings[key] * 100)}%</output></label>;
  return <Dialog title="游戏设置" eyebrow="SETTINGS" onClose={onClose} className="settings-dialog">
    <div className="settings-section"><div className="setting-section-title">画面品质<span>选择适合设备的流畅度与细节</span></div><div className="quality-options" role="group" aria-label="画面品质">{([{ value: 'low', label: '轻量', note: '优先流畅' }, { value: 'medium', label: '均衡', note: '推荐体验' }, { value: 'high', label: '细腻', note: '更多光影' }] as const).map(item => <button className={settings.quality === item.value ? 'selected' : ''} key={item.value} aria-pressed={settings.quality === item.value} onClick={() => setSettings({ quality: item.value })}><strong>{item.label}</strong><span>{item.note}</span><span className="quality-check">{settings.quality === item.value ? '✓' : '○'}</span></button>)}</div></div>
    <div className="settings-section"><div className="setting-section-title"><Icon name="sound" />声音</div>{slider('masterVolume', '主音量')}{slider('musicVolume', '背景音乐')}{slider('sfxVolume', '战斗音效')}</div>
    <div className="settings-section"><div className="setting-section-title">动效与反馈</div>{slider('screenShake', '镜头震动')}<label className="setting-switch"><span><strong>减弱动态效果</strong><small>保留危险边界，减少晃动与闪光</small></span><input type="checkbox" checked={settings.reducedMotion} onChange={event => setSettings({ reducedMotion: event.target.checked })} /><span className="switch-track" aria-hidden="true" /></label><div className="damage-number-setting"><span>伤害数字</span><div className="segmented-options" role="group" aria-label="伤害数字">{([{ value: 'all', label: '全部' }, { value: 'important', label: '重要命中' }, { value: 'off', label: '关闭' }] as const).map(option => <button key={option.value} aria-pressed={settings.damageNumbers === option.value} onClick={() => setSettings({ damageNumbers: option.value })}>{option.label}</button>)}</div><small>重要命中保留弱点、部件与高伤害数字；状态提示始终显示。</small></div></div>
    <div className="settings-section"><div className="setting-section-title">键盘操作<button className="text-button" onClick={() => { setSettings({ keybindings: { ...DEFAULT_KEYBINDINGS } }); setBinding(null); setBindingNotice('已恢复默认按键。'); }}>恢复默认</button></div><div className="keybind-grid">{(Object.keys(BINDING_LABELS) as BindingAction[]).map(action => <button key={action} className={binding === action ? 'is-listening' : ''} aria-label={`改键：${BINDING_LABELS[action]}`} aria-pressed={binding === action} onClick={() => { setBinding(action); setBindingNotice(`请按下「${BINDING_LABELS[action]}」的新按键；Esc 取消。`); }} onBlur={() => { if (binding === action) setBinding(null); }} onKeyDown={event => {
      if (binding !== action) return;
      if (event.code === 'Tab') { setBinding(null); return; }
      event.preventDefault(); event.stopPropagation();
      if (event.code === 'Escape') { setBinding(null); setBindingNotice('已取消改键。'); return; }
      if (!isBindableKey(event.code) || event.altKey || event.metaKey || (event.ctrlKey && !event.code.startsWith('Control'))) { setBindingNotice('此键由菜单或系统使用，请换一个按键。'); return; }
      const displaced = (Object.keys(BINDING_LABELS) as BindingAction[]).find(other => other !== action && settings.keybindings[other] === event.code);
      setSettings({ keybindings: rebindKey(settings.keybindings, action, event.code) }); setBinding(null);
      setBindingNotice(`${BINDING_LABELS[action]} → ${keyLabel(event.code)}${displaced ? `；已与${BINDING_LABELS[displaced]}交换` : ''}。`);
    }}><span>{BINDING_LABELS[action]}</span><kbd>{binding === action ? '请按键…' : keyLabel(settings.keybindings[action])}</kbd></button>)}</div><p className="binding-notice" role="status">{bindingNotice}</p><p className="binding-fixed">鼠标左键固定射击 · 右键固定冲刺 · Esc 暂停 · 1 / 2 / 3 选卡</p></div>
    <div className="settings-footer"><span>设置自动保存于此设备</span><button className="button button-primary button-small" onClick={onClose}>完成 <Icon name="arrow" /></button></div>
  </Dialog>;
}

function PausedModules({ snapshot: s }: { snapshot: HudSnapshot }) {
  const labels = { ready: '就绪', active: '生效中', cooldown: '冷却', consumed: '本局已消耗' };
  return <><details className="paused-modules" open><summary>本局模块 <span>{s.modules.length} / 6</span></summary><div>{buildModuleViews({ modules: [...s.modules], ranks: s.moduleRanks, evolutions: [...s.evolutions] }).map(item => {
    const state = s.moduleStates.find(module => module.id === item.id);
    return <article key={item.id}><div><strong>{item.name} {item.evolution ? '✦' : item.rank === 2 ? 'II' : 'I'}</strong><span className={`module-${state?.status ?? 'ready'}`}>{state ? `${labels[state.status]}${state.remaining > 0 ? ` · ${state.remaining.toFixed(1)}s` : ''}` : '持续生效'}</span></div><p>{item.description}</p>{item.flavor && <small className="module-flavor">{item.flavor}</small>}</article>;
  })}</div>{!s.modules.length && <p className="upgrade-owned">收集经验升级，选择本局强化。</p>}</details><EvolutionRecipes snapshot={s} /></>;
}

function RunResults({ snapshot }: { snapshot: HudSnapshot }) {
  return <div className="run-results"><div><span>本局得分</span><strong>{snapshot.score.toLocaleString('en-US')}</strong></div><div><span>击破敌人</span><strong>{snapshot.kills}</strong></div><div><span>本局用时</span><strong>{formatTime(snapshot.elapsed)}</strong></div></div>;
}

function Changelog({ onClose }: { onClose: () => void }) {
  return <Dialog title="更新日志" eyebrow="RELEASE NOTES" onClose={onClose} className="changelog-dialog">
    <p className="dialog-description">笑梦又变强了。真冬更烦了。</p>
    <div className="changelog-entries">{changelog.slice(0, 4).map((release, index) => <section className={`changelog-entry ${index === 0 ? 'latest' : ''}`} key={release.version}>
      <div className="changelog-meta"><span>{release.version}{index === 0 && <b>当前版本</b>}</span><time dateTime={release.date}>{release.date}</time></div>
      <h3>{release.title}</h3>
      <ul>{release.highlights.map(highlight => <li key={highlight}>{highlight}</li>)}</ul>
    </section>)}</div>
    <button className="button button-secondary changelog-done" onClick={onClose}>返回游戏</button>
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
    {snapshot.phase === 'loading' && <section className="screen-overlay loading-screen" aria-label="加载游戏"><span className="loading-mark" aria-hidden="true">✦</span><div className="eyebrow">凤小梦大战朝比奈真冬</div><h1>加载中……</h1><div className="loading-progress"><Meter value={snapshot.loading} label="资源加载进度" /><span>{Math.round(snapshot.loading * 100)}%</span></div><p>笑梦：Wonderhoy！！ 真冬：……还没开始就这么吵。</p></section>}
    {snapshot.phase === 'upgrade' && <UpgradeChoice snapshot={snapshot} runtime={runtime} />}
    {!settingsOpen && snapshot.phase === 'paused' && <Dialog title="先别喊了。" eyebrow="PAUSED" onClose={() => runtime.resume()}><p className="dialog-description">真冬：「……终于安静了。」战斗已暂停。</p><RunResults snapshot={snapshot} /><div className="dialog-actions"><button className="button button-primary" onClick={() => runtime.resume()}><Icon name="play" />继续游戏 <kbd>ESC</kbd></button><button className="button button-secondary" onClick={openSettings}><Icon name="settings" />体验设置</button><button className="text-button centered" onClick={() => runtime.returnToMenu()}>结束本局，返回主菜单</button></div><PausedModules snapshot={snapshot} /><ControlsGuide settings={snapshot.settings} compact /></Dialog>}
    {!settingsOpen && snapshot.phase === 'failed' && <Dialog title="……终于闭嘴了。" eyebrow="SILENCE." className="result-dialog failure-dialog"><div className="result-emblem" aria-hidden="true">✧</div><p className="dialog-description">笑梦：「呜哇……」本局结束，再次挑战从 Lv1 开始。</p><RunResults snapshot={snapshot} /><SaveNotice snapshot={snapshot} /><div className="result-detail"><span>{snapshot.stageName} · 推进 {Math.floor(snapshot.progression / 360 * 100)}%</span><span>最高纪录 {snapshot.bestScore.toLocaleString('en-US')}</span></div><div className="dialog-actions"><button className="button button-primary" onClick={() => runtime.restart()}><Icon name="restart" />再次挑战</button><button className="button button-secondary" onClick={() => runtime.returnToMenu()}>返回主菜单</button></div></Dialog>}
    {!settingsOpen && snapshot.phase === 'complete' && <Dialog title="Wonderhoy——！！" eyebrow="ONE MORE WONDERHOY!" className="result-dialog complete-dialog"><div className="result-emblem" aria-hidden="true">✦</div><p className="dialog-description">真冬：「为什么……还没停……」继续无尽会保留本局构筑。</p><RunResults snapshot={snapshot} /><SaveNotice snapshot={snapshot} /><div className="dialog-actions"><button className="button button-secondary" onClick={() => runtime.continueEndless()}><Icon name="spark" />继续 · 无尽挑战<Icon name="arrow" /></button><button className="button button-secondary" onClick={() => runtime.restart()}><Icon name="restart" />重新开始</button><button className="text-button centered" onClick={() => runtime.returnToMenu()}>返回主菜单</button></div></Dialog>}
    {snapshot.phase === 'error' && <Dialog title="游戏暂时遇到问题" eyebrow="PLEASE RETRY" className="error-dialog"><p className="dialog-description">{snapshot.error || '游戏加载遇到了问题，请重新连接。'}</p><div className="dialog-actions"><button className="button button-primary" onClick={() => runtime.start()}><Icon name="restart" />重新连接</button><button className="text-button centered" onClick={() => window.location.reload()}>刷新页面</button></div></Dialog>}
    {settingsOpen && <Settings settings={snapshot.settings} setSettings={settings => runtime.setSettings(settings)} onClose={() => setSettingsOpen(false)} />}
    {changelogOpen && snapshot.phase === 'menu' && <Changelog onClose={() => setChangelogOpen(false)} />}
    {debug && <aside className="debug-panel" aria-label="性能信息"><strong>PERFORMANCE</strong><span>FPS {snapshot.stats.fps.toFixed(0)} · P95 {snapshot.stats.frameP95.toFixed(1)}ms · P99 {snapshot.stats.frameP99.toFixed(1)}ms</span><span>更新 {snapshot.stats.updateMs.toFixed(2)}ms · 渲染 {snapshot.stats.renderMs.toFixed(2)}ms</span><span>敌人 {snapshot.stats.enemies} · 子弹 {snapshot.stats.bullets} · 粒子 {snapshot.stats.particles}</span><span>道具 {snapshot.stats.pickups} · 音频 {snapshot.stats.voices} · 纹理 {snapshot.stats.textures}</span></aside>}
  </div>;
}
