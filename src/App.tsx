import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { ASSET_URLS, BALANCE } from './game/config';
import type { GameSettings, HudSnapshot, ModuleId, RuntimeControls, UpgradeChoiceId } from './game/types';
import changelog from 'virtual:changelog';
import { MODULES, EVOLUTIONS, choiceView, buildModuleViews } from './game/upgrades';
import { evolutionPaths, choiceEvolutionHints } from './game/upgrade-guidance';
import { compactChoiceDescription } from './game/upgrade-copy';
import { BINDING_LABELS, DEFAULT_KEYBINDINGS, isBindableKey, keyLabel, rebindKey } from './game/settings';
import type { BindingAction } from './game/settings';
import { BattleComms, useCommsPlacement } from './components/BattleComms';
import { ModulePreview } from './components/ModulePreview';
import { Leaderboard, ScoreEntry } from './components/Leaderboard';
import { TouchControls } from './components/TouchControls';

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

const buildLayers = (s: HudSnapshot) => s.modules.reduce((total, id) => total + (s.moduleRanks[id] ?? 1), 0);
const rankLabel = (rank: number) => rank <= 5 ? ['I', 'II', 'III', 'IV', 'V'][Math.max(0, rank - 1)] : `Lv.${rank}`;
const snapshotBuild = (s: HudSnapshot) => ({ modules: [...s.modules], ranks: s.moduleRanks, evolutions: [...s.evolutions] });

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
    const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, summary, a[href], [tabindex="0"]') ?? []);
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

function ControlsGuide({ settings, compact = false, touch = false }: { settings: GameSettings; compact?: boolean; touch?: boolean }) {
  if (touch) return <div className="touch-guide"><p>左侧摇杆移动，自动瞄准射击；点敌人可切换目标。</p><p>冲刺后自动接贯穿炮。慢移、停火可随时切换。</p></div>;
  const key = (action: BindingAction) => keyLabel(settings.keybindings[action]);
  return <div className={`controls-guide ${compact ? 'compact' : ''}`}>
    <div><span className="keycaps">{(['moveUp', 'moveLeft', 'moveDown', 'moveRight'] as const).map(action => <kbd key={action}>{key(action)}</kbd>)}</span><span>移动 · {key('focus')} 慢速瞄准</span></div>
    <div><span className="keycaps"><kbd>鼠标左键</kbd></span><span>瞄准 · 射击</span></div>
    <div><span className="keycaps"><kbd>{key('dash')}</kbd><span className="key-or">/</span><kbd>右键</kbd></span><span>无敌冲刺 · 随后左键释放贯穿炮</span></div>
    <div><span className="keycaps"><kbd>{key('bomb')}</kbd><kbd>Esc</kbd></span><span>炸弹 · 暂停</span></div>
  </div>;
}

function FullscreenButton({ runtime }: { runtime: RuntimeControls }) {
  const [notice, setNotice] = useState('');
  return <div className="fullscreen-control"><button type="button" className="text-button" onClick={() => {
    setNotice('');
    void runtime.requestFullscreen().catch((error: unknown) => setNotice(error instanceof Error ? error.message : '未能进入全屏，可直接横屏游玩。'));
  }}>全屏游玩</button>{notice && <p role="status">{notice}</p>}</div>;
}

function SaveNotice({ snapshot: s }: { snapshot: HudSnapshot }) {
  return <p className={`save-notice save-${s.saveStatus}`} role="status">{s.saveMessage || (s.saveStatus === 'session' ? '浏览器暂时无法保存，进度仅保留在当前页面。' : s.saveStatus === 'saved' ? '通关与纪录已保存于此浏览器' : '每局从 Lv1 开始 · 成绩自动保存在此浏览器')}</p>;
}

function Menu({ runtime, snapshot: s, openSettings, openChangelog, openLeaderboard }: { runtime: RuntimeControls; snapshot: HudSnapshot; openSettings: () => void; openChangelog: () => void; openLeaderboard: () => void }) {
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
      <button className="menu-start" disabled={s.orientationBlocked} onClick={() => runtime.start()}>{s.orientationBlocked ? '横屏后开始' : '开始游戏'}</button>
      {s.orientationBlocked && <p className="orientation-notice" role="status">请横过手机，给弹幕多一点空间。</p>}
      <div className="menu-links"><button className="menu-settings" onClick={openSettings}>体验设置</button><button className="menu-settings" onClick={openLeaderboard}>排行榜</button></div>{runtime.leaderboard && <ScoreEntry client={runtime.leaderboard} />}
      {s.controlMode === 'touch' ? <><ControlsGuide settings={s.settings} touch /><FullscreenButton runtime={runtime} /></> : <div className="menu-instructions" aria-label="基本操作"><p>{(['moveUp', 'moveLeft', 'moveDown', 'moveRight'] as const).map(action => keyLabel(s.settings.keybindings[action])).join(' / ')} 移动 · 左键射击</p><p>{keyLabel(s.settings.keybindings.dash)} / 右键冲刺 · 随后左键贯穿炮</p><p>{keyLabel(s.settings.keybindings.focus)} 慢移 · {keyLabel(s.settings.keybindings.bomb)} 炸弹 · Esc 暂停</p></div>}
      <span className="menu-best">{s.difficulty === 'hard' ? '困难' : '普通'}纪录 {s.bestScore.toLocaleString('en-US')}</span>
      {s.historicalBestScore > 0 && <span className="menu-history">旧版历史纪录 {s.historicalBestScore.toLocaleString('en-US')}</span>}
      <SaveNotice snapshot={s} />
      <button className="menu-version" onClick={openChangelog}>{latest.version} · 更新日志</button>
    </div>
  </section>;
}

function TouchHud({ snapshot: s, runtime }: { snapshot: HudSnapshot; runtime: RuntimeControls }) {
  const hud = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const bossMax = s.bossMaxHp || s.minibossMaxHp;
  const bossHp = s.bossMaxHp > 0 ? s.bossHp : s.minibossHp;
  const elite = (s.eliteMaxHp ?? 0) > 0;
  const title = bossMax ? s.cardName || s.minibossAction.split(' · ')[0] : elite ? s.eliteName : s.stageName;
  return <div ref={hud} className="hud touch-hud" aria-label="战斗状态">
    <div className="touch-hud-top">
      <div className="touch-stage"><strong>{s.mode === 'endless' ? '无尽' : `${Math.floor(s.progression / 360 * 100)}%`}</strong><span>{formatTime(s.elapsed)}</span></div>
      <div className="touch-encounter"><strong>{title}</strong>{bossMax ? <Meter value={bossHp} max={bossMax} className="meter-violet" label="首领生命" /> : elite ? <Meter value={s.eliteHp ?? 0} max={s.eliteMaxHp} className="meter-elite" label="精英生命" /> : <Meter value={s.waveProgress} label="战役推进进度" />}{bossMax > 0 && <span className="touch-boss-action" aria-label="首领行动">{s.bossMaxHp > 0 ? s.bossAction : s.minibossAction.split(' · ').slice(1).join(' · ')}</span>}</div>
      <button type="button" className="touch-comms-toggle" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? '展开战斗通讯' : '收起战斗通讯'} aria-expanded={!collapsed}>对话</button>
      <button type="button" className="icon-button" onClick={() => runtime.pause()} aria-label="暂停游戏"><Icon name="pause" /></button>
    </div>
    <div className="touch-hud-bottom">
      <div className="touch-health"><strong aria-label="生命">♥ {s.hp}/{s.maxHp}</strong><span aria-label="备用血药">血药 {s.hpReserve}</span></div>
      <div className="touch-growth"><span>Lv.{s.level} · 子机 {s.companions}</span><Meter value={s.level >= 10 ? s.resonanceXp ?? 0 : s.xp} max={s.level >= 10 ? 600 : s.xpNeeded} className="meter-violet" label="武器成长" /></div>
      <div className={`touch-heat ${s.overheated ? 'is-hot' : ''}`}><span>{!s.touch.autoFireEnabled ? '已停火' : s.touch.cooling ? '散热中' : '自动射击'} · {Math.round(s.heat)}%</span><Meter value={s.heat} max={100} className="meter-heat" label="武器热量" /></div>
    </div>
    <div className={`touch-comms ${collapsed ? 'is-collapsed' : ''}`}><BattleComms snapshot={s} placement={{ layout: 'compact', small: true, left: 0, right: 0, bottom: 0 }} portalHost={hud} collapsed={collapsed} /></div>
  </div>;
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
        {(s.eliteMaxHp ?? 0) > 0 && <div className="elite-health" aria-label="波内精英"><span>{s.eliteName} · 必须击败</span><Meter value={s.eliteHp ?? 0} max={s.eliteMaxHp} className="meter-elite" label="精英生命" /></div>}
        {bossMax > 0 ? <><div><strong>{s.cardName || s.minibossAction.split(' · ')[0]}</strong><span>{s.cardCount > 0 ? `${s.cardIndex} / ${s.cardCount}` : '首领战'} · {Math.ceil(100 * bossHp / bossMax)}%</span></div><Meter value={bossHp} max={bossMax} className="meter-violet" label={s.bossMaxHp > 0 ? '真冬生命' : '迷你首领生命'} /><p aria-label={s.bossMaxHp > 0 ? '首领行动' : '迷你首领行动'}>{s.bossMaxHp > 0 ? s.bossAction : s.minibossAction.split(' · ').slice(1).join(' · ')}</p></> : <><strong className="battle-announcement" role="status">{s.announcement || (s.arena ? '固定竞技场 · 注意场地边界' : '跑起来！捡经验，别捡弹幕。')}</strong><span>{formatTime(s.elapsed)} · SCORE {String(s.score).padStart(7, '0')}</span></>}
      </div>
      <div className="battle-actions"><span className="battle-score">{String(s.score).padStart(7, '0')}<small>{formatTime(s.elapsed)}</small></span><span className="battle-bombs">✦ {s.bombs}<small>炸弹 / {key('bomb')}</small></span><button className="icon-button" onClick={() => runtime.pause()} aria-label="暂停游戏"><Icon name="pause" /></button><button className="icon-button" onClick={openSettings} aria-label="暂停并打开设置"><Icon name="settings" /></button></div>
    </div>
    <div className="battle-bottom">
      <div className="battle-player"><div className="compact-heading"><img src={ASSET_URLS.player} alt="玩家头像" /><strong>LV. {String(s.level).padStart(2, '0')}</strong><span>{s.hp} / {s.maxHp} HP</span><span className="support-status" aria-label="子机支援">子机 {s.companions} / {BALANCE.companion.max}</span></div><div className="health-segments" role="meter" aria-label="生命" aria-valuenow={s.hp} aria-valuemin={0} aria-valuemax={s.maxHp}>{Array.from({ length: s.maxHp }, (_, i) => <span key={i} className={i < s.hp ? 'filled' : ''} />)}</div><div className="compact-growth health-reserve"><span aria-label="备用血药">血药 ×{s.hpReserve}</span><span title="每份恢复 1 HP，致命伤不会消耗血药复活">受伤自动补血</span></div><div className="compact-growth"><span>{s.level >= 10 ? `共鸣 +${Math.min(4, s.resonance) * 5}% · 继续强化` : '武器成长'}</span><span>{s.level >= 10 ? `${Math.floor(s.resonanceXp ?? 0)} / 600` : `${Math.floor(s.xp)} / ${s.xpNeeded}`}</span></div><Meter value={s.level >= 10 ? s.resonanceXp ?? 0 : s.xp} max={s.level >= 10 ? 600 : s.xpNeeded} className="meter-violet" label="武器成长" /></div>
      <div className="battle-comms"><button className="compact-comms-toggle" onClick={() => setCommsCollapsed(value => !value)} aria-label={commsCollapsed ? '展开战斗通讯' : '收起战斗通讯'} aria-expanded={!commsCollapsed}>{commsCollapsed ? '展开通讯' : '战斗通讯'}<span aria-hidden="true">{commsCollapsed ? '+' : '−'}</span></button><BattleComms snapshot={s} placement={commsPlacement} portalHost={hud} collapsed={commsCollapsed} /><div className="module-summary" aria-label="已装配模块"><strong>{s.modules.length}</strong> 种 · <strong>{buildLayers(s)}</strong> 层 · {s.evolutions.length} 进化</div><div className="module-recent" aria-label="最近强化">{s.recentUpgrade ? (() => {
        const item = s.recentUpgrade.id.startsWith('evolution:') ? EVOLUTIONS[s.recentUpgrade.id.slice(10) as keyof typeof EVOLUTIONS] : MODULES[s.recentUpgrade.id as ModuleId];
        const rank = s.moduleRanks[s.recentUpgrade.id as ModuleId];
        return item ? <span key={s.recentUpgrade.sequence}>＋ {item.name}{rank ? ` ${rankLabel(rank)}` : ' ✦'}</span> : '继续收集经验，强化没有层数上限';
      })() : '继续收集经验，强化没有层数上限'}</div><div className="module-live" aria-label="模块即时状态">{activeModules.map(module => <span key={module.id} className={`module-${module.status}`}>{MODULES[module.id].name} · {module.status === 'consumed' ? '已用尽' : module.status === 'active' ? '生效中' : `${module.remaining.toFixed(1)}s`}</span>)}</div></div>
      <div className="battle-weapon"><div className={`compact-resource ${s.overheated ? 'is-hot' : ''}`}><span>{s.overheated ? '过热 · 松开射击' : '热量'} <strong>{Math.round(s.heat)}%</strong></span><Meter value={s.heat} max={100} className="meter-heat" label="武器热量" /></div><div className="weapon-skills"><div className={`skill-chip ${s.dashCharges > 0 ? 'is-ready' : ''}`}><kbd>{key('dash')}</kbd><span>冲刺 <strong>{s.dashCharges > 0 ? s.modules.includes('doubleDash') ? `${s.dashCharges}/2` : '就绪' : `${s.dashCooldown.toFixed(1)}s`}</strong></span></div><div className={`skill-chip ${perfect ? 'is-beam-ready' : ''}`}><kbd>左键</kbd><span>贯穿炮 <strong>{perfect ? `${s.perfectWindow.toFixed(2)}s` : '冲刺后射击'}</strong></span></div></div></div>
    </div>
  </div>;
}

function EvolutionRecipes({ snapshot: s, expanded = false, moduleId }: { snapshot: HudSnapshot; expanded?: boolean; moduleId?: ModuleId }) {
  const paths = evolutionPaths(snapshotBuild(s)).filter(path => !moduleId || path.primary === moduleId || path.partner === moduleId);
  return <details className="evolution-recipes" open={expanded}><summary>进化组合 <span>已获得 {s.evolutions.length} 种</span></summary><p>主模块 II ＋ 搭配 I 凑齐配方后，在精英或首领奖励中选到进化卡才会进化。</p><div>{paths.map(path => <p key={path.id} className={`recipe-path is-${path.status}`} data-evolution={path.id}>
    <strong>{path.name}<small>{path.status === 'evolved' ? '已进化' : path.status === 'ready' ? '配方齐全' : path.status === 'progress' ? `还差 ${path.stepsRemaining} 次强化` : '尚未开始'}</small></strong>
    <span className="evolution-requirements"><span className={path.primaryRank >= 2 ? 'is-met' : ''}>{MODULES[path.primary].name} II · {path.primaryRank ? `已有 ${rankLabel(path.primaryRank)}` : '未获得'}</span><span className={path.partnerRank >= 1 ? 'is-met' : ''}>{MODULES[path.partner].name} I · {path.partnerRank ? `已有 ${rankLabel(path.partnerRank)}` : '未获得'}</span></span>
    <span className="recipe-next">{path.status === 'evolved' ? '主模块仍可继续升层' : path.status === 'ready' ? s.upgradeChoices.includes(`evolution:${path.id}`) ? '本次可选进化卡' : '等待精英／首领奖励中的进化卡' : `还缺：${path.missing.join('、')}`}</span>
  </p>)}</div></details>;
}

function UpgradeChoice({ snapshot: s, runtime }: { snapshot: HudSnapshot; runtime: RuntimeControls }) {
  const [inspection, setInspection] = useState<'build' | UpgradeChoiceId | null>(null);
  const returnButton = useRef<HTMLButtonElement>(null);
  const inspectionTrigger = useRef<'build' | UpgradeChoiceId | null>(null);
  const triggerButtons = useRef(new Map<'build' | UpgradeChoiceId, HTMLButtonElement>());
  useEffect(() => {
    if (inspection) returnButton.current?.focus();
    else if (inspectionTrigger.current) triggerButtons.current.get(inspectionTrigger.current)?.focus();
  }, [inspection]);
  const rememberTrigger = (target: 'build' | UpgradeChoiceId, node: HTMLButtonElement | null) => {
    if (node) triggerButtons.current.set(target, node);
    else triggerButtons.current.delete(target);
  };
  const inspect = (target: 'build' | UpgradeChoiceId) => { inspectionTrigger.current = target; setInspection(target); };
  const build = snapshotBuild(s), touch = s.controlMode === 'touch';
  const paths = evolutionPaths(build);
  const directions = paths.filter(path => path.status === 'ready' || path.status === 'progress').slice(0, 2);
  const inspected = inspection && inspection !== 'build' ? choiceView(build, inspection) : null;
  const inspectedModule = inspected ? inspected.kind === 'evolution' ? EVOLUTIONS[inspected.id.slice(10) as keyof typeof EVOLUTIONS].primary : inspected.kind === 'resource' ? null : inspected.id as ModuleId : null;
  const press = useRef<{ pointerId: number; x: number; y: number; dragged: boolean } | null>(null);
  const trackDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = press.current;
    if (start && start.pointerId === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) start.dragged = true;
  };
  const branches = { main: '主炮', drone: '子机', resource: '机动与资源' };
  const kinds = { module: '新模块', rank: '继续升层', evolution: '组合进化', resource: '补给' };
  return <Dialog title={inspection === 'build' ? '本局构筑与组合' : inspected ? inspected.name : s.choiceSource === 'boss' ? '首领奖励' : s.choiceSource === 'elite' ? '精英奖励' : '选择强化'} eyebrow={`${s.modules.length} 种模块 · ${buildLayers(s)} 层 · ${s.evolutions.length} 种进化`} className={`upgrade-dialog ${inspection ? 'is-inspecting' : ''}`}>
    {inspection ? <div className="upgrade-inspection" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setInspection(null); }
      if (/^(Digit|Numpad)[123]$/.test(event.code)) { event.preventDefault(); event.stopPropagation(); }
    }}>
      <button ref={returnButton} className="text-button upgrade-inspection-back" onClick={() => setInspection(null)}>← 返回选卡</button>
      {inspected ? <>
        <p className="dialog-description">{kinds[inspected.kind]}{inspected.rank !== null ? ` · ${rankLabel(inspected.rank)}` : ''} · 查看详情不会选择强化</p>
        {inspectedModule && <ModulePreview id={inspectedModule} rank={inspected.rank ?? s.moduleRanks[inspectedModule] ?? 1} evolved={inspected.kind === 'evolution'} reducedMotion={s.settings.reducedMotion} />}
        <p className="upgrade-full-description">{inspected.description}</p>
        {choiceEvolutionHints(build, inspected.id).map(hint => <p key={hint.id} className={`upgrade-combo-hint hint-${hint.status}`}><strong>{hint.name}</strong> · {hint.text}</p>)}
        {inspectedModule && <EvolutionRecipes snapshot={s} moduleId={inspectedModule} expanded />}
      </> : <><PausedModules snapshot={s} expanded={false} recipesExpanded /><button className="text-button centered" onClick={() => runtime.returnToMenu()}>结束本局，返回主菜单</button></>}
    </div> : <>
    <p className="upgrade-intro">{touch ? '战斗已暂停 · 点卡片选择，点详情查看说明' : '战斗已暂停 · 按 1 / 2 / 3 或点击卡片选择'}{s.orientationBlocked ? ' · 横屏后继续' : ''}</p>
    <section className="upgrade-paths" aria-label="当前组合方向">
      {directions.length ? directions.map(path => <div key={path.id} className={`upgrade-path is-${path.status}`}><strong>{path.name}</strong><span>{path.status === 'ready' ? s.upgradeChoices.includes(`evolution:${path.id}`) ? '配方齐全 · 本次可选进化' : '配方齐全 · 等精英／首领进化卡' : `还缺 ${path.missing.join('、')}`}</span></div>) : <div className="upgrade-path"><strong>{s.evolutions.length ? '继续拓展组合' : '从这次选择开始组合'}</strong><span>主模块 II ＋ 搭配 I，精英／首领奖励选进化卡</span></div>}
    </section>
    <div className="upgrade-cards" onPointerDownCapture={event => {
      press.current = event.pointerType === 'touch' ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dragged: false } : null;
    }} onPointerMoveCapture={trackDrag} onPointerUpCapture={trackDrag} onPointerCancelCapture={() => { if (press.current) press.current.dragged = true; }} onClickCapture={event => {
      // Preserve native scrolling; even at a scroll boundary, dragging a card is not a choice.
      if (event.detail !== 0 && press.current?.dragged) { event.preventDefault(); event.stopPropagation(); }
      press.current = null;
    }}>{s.upgradeChoices.map((id, index) => {
      const item = choiceView(build, id);
      const previewId = item.kind === 'evolution' ? EVOLUTIONS[id.slice(10) as keyof typeof EVOLUTIONS].primary : item.kind === 'resource' ? null : id as ModuleId;
      const hints = choiceEvolutionHints(build, id), visibleHints = hints.slice(0, touch ? 1 : 2);
      return <div key={s.upgradeOfferId + ':' + id} className="upgrade-option"><button className={`upgrade-card branch-${item.branch} choice-${item.kind}`} data-choice={id} onClick={() => runtime.chooseUpgrade(id, s.upgradeOfferId ?? undefined)}><span className="upgrade-branch">{branches[item.branch]} · {kinds[item.kind]}<kbd>{index + 1}</kbd></span><strong>{item.name}{item.rank !== null && <small className="upgrade-rank">{item.kind === 'rank' ? `${rankLabel(item.rank - 1)} → ${rankLabel(item.rank)}` : rankLabel(item.rank)}</small>}</strong>{previewId && <ModulePreview id={previewId} rank={item.rank ?? s.moduleRanks[previewId] ?? 1} evolved={item.kind === 'evolution'} reducedMotion={s.settings.reducedMotion} />}{item.flavor && <small className="module-flavor">{item.flavor}</small>}<p className="upgrade-description">{touch ? compactChoiceDescription(build, id) : item.description}</p><span className="upgrade-combo">{visibleHints.length ? visibleHints.map(hint => <span key={hint.id} className={`upgrade-combo-hint hint-${hint.status}`}><strong>{hint.name}</strong><span>{hint.text}</span></span>) : <span className="upgrade-combo-hint"><span>{item.kind === 'resource' ? '补充本局资源' : '继续强化现有能力'}</span></span>}</span><span className="upgrade-confirm">选择强化 <Icon name="arrow" /></span></button><button className="text-button upgrade-detail" aria-label={`查看${item.name}详情`} ref={node => rememberTrigger(id, node)} onClick={() => inspect(id)}>详情{hints.length > visibleHints.length ? ` · ${hints.length} 条组合` : ''}</button></div>;
    })}</div>
    <div className="upgrade-toolbar"><button className="text-button upgrade-browse" ref={node => rememberTrigger('build', node)} onClick={() => inspect('build')}>本局构筑与组合</button><button className="button button-secondary button-small" disabled={s.rerollsRemaining === 0} onClick={() => runtime.rerollUpgrades()}>重抽 · {s.rerollsRemaining}</button></div>
    </>}
  </Dialog>;
}

function Settings({ settings, controlMode, setSettings, onClose }: { settings: GameSettings; controlMode: HudSnapshot['controlMode']; setSettings: (settings: Partial<GameSettings>) => void; onClose: () => void }) {
  const [binding, setBinding] = useState<BindingAction | null>(null);
  const [bindingNotice, setBindingNotice] = useState('点击动作后按下新按键；重复按键会交换。');
  const slider = (key: 'masterVolume' | 'musicVolume' | 'sfxVolume' | 'screenShake', label: string) => <label className="setting-slider"><span>{label}</span><input aria-label={label} type="range" min="0" max="1" step="0.05" value={settings[key]} onChange={event => setSettings({ [key]: Number(event.target.value) })} /><output>{Math.round(settings[key] * 100)}%</output></label>;
  return <Dialog title="游戏设置" eyebrow="SETTINGS" onClose={onClose} className="settings-dialog">
    <div className="settings-section"><div className="setting-section-title">操作方式</div><div className="segmented-options control-mode-options" role="group" aria-label="操作方式">{([{ value: 'auto', label: '自动' }, { value: 'keyboardMouse', label: '键盘鼠标' }, { value: 'touch', label: '触屏' }] as const).map(option => <button key={option.value} aria-pressed={settings.controlMode === option.value} onClick={() => setSettings({ controlMode: option.value })}>{option.label}</button>)}</div>{controlMode === 'touch' && <p className="setting-note">横屏游玩 · 自动瞄准射击，点敌人切换目标。</p>}</div>
    {controlMode === 'touch' && <div className="settings-section"><div className="setting-section-title">触屏帧率</div><div className="segmented-options" role="group" aria-label="触屏帧率">{([60, 30] as const).map(rate => <button key={rate} aria-pressed={settings.touchFrameRate === rate} onClick={() => setSettings({ touchFrameRate: rate })}>{rate === 60 ? '60 帧 · 流畅' : '30 帧 · 省电'}</button>)}</div><p className="setting-note">只调整画面刷新，游戏速度和操作判定保持一致。</p></div>}
    <div className="settings-section"><div className="setting-section-title">画面品质<span>选择适合设备的流畅度与细节</span></div><div className="quality-options" role="group" aria-label="画面品质">{([{ value: 'low', label: '轻量', note: '优先流畅' }, { value: 'medium', label: '均衡', note: '推荐体验' }, { value: 'high', label: '细腻', note: '更多光影' }] as const).map(item => <button className={settings.quality === item.value ? 'selected' : ''} key={item.value} aria-pressed={settings.quality === item.value} onClick={() => setSettings({ quality: item.value })}><strong>{item.label}</strong><span>{item.note}</span><span className="quality-check">{settings.quality === item.value ? '✓' : '○'}</span></button>)}</div></div>
    <div className="settings-section"><div className="setting-section-title"><Icon name="sound" />声音</div>{slider('masterVolume', '主音量')}{slider('musicVolume', '背景音乐')}{slider('sfxVolume', '战斗音效')}</div>
    <div className="settings-section"><div className="setting-section-title">动效与反馈</div>{slider('screenShake', '镜头震动')}<label className="setting-switch"><span><strong>减弱动态效果</strong><small>保留危险边界，减少晃动与闪光</small></span><input type="checkbox" checked={settings.reducedMotion} onChange={event => setSettings({ reducedMotion: event.target.checked })} /><span className="switch-track" aria-hidden="true" /></label><div className="damage-number-setting"><span>伤害数字</span><div className="segmented-options" role="group" aria-label="伤害数字">{([{ value: 'all', label: '全部' }, { value: 'important', label: '重要命中' }, { value: 'off', label: '关闭' }] as const).map(option => <button key={option.value} aria-pressed={settings.damageNumbers === option.value} onClick={() => setSettings({ damageNumbers: option.value })}>{option.label}</button>)}</div><small>重要命中保留弱点、部件与高伤害数字；状态提示始终显示。</small></div></div>
    {controlMode === 'keyboardMouse' && <div className="settings-section"><div className="setting-section-title">键盘操作<button className="text-button" onClick={() => { setSettings({ keybindings: { ...DEFAULT_KEYBINDINGS } }); setBinding(null); setBindingNotice('已恢复默认按键。'); }}>恢复默认</button></div><div className="keybind-grid">{(Object.keys(BINDING_LABELS) as BindingAction[]).map(action => <button key={action} className={binding === action ? 'is-listening' : ''} aria-label={`改键：${BINDING_LABELS[action]}`} aria-pressed={binding === action} onClick={() => { setBinding(action); setBindingNotice(`请按下「${BINDING_LABELS[action]}」的新按键；Esc 取消。`); }} onBlur={() => { if (binding === action) setBinding(null); }} onKeyDown={event => {
      if (binding !== action) return;
      if (event.code === 'Tab') { setBinding(null); return; }
      event.preventDefault(); event.stopPropagation();
      if (event.code === 'Escape') { setBinding(null); setBindingNotice('已取消改键。'); return; }
      if (!isBindableKey(event.code) || event.altKey || event.metaKey || (event.ctrlKey && !event.code.startsWith('Control'))) { setBindingNotice('此键由菜单或系统使用，请换一个按键。'); return; }
      const displaced = (Object.keys(BINDING_LABELS) as BindingAction[]).find(other => other !== action && settings.keybindings[other] === event.code);
      setSettings({ keybindings: rebindKey(settings.keybindings, action, event.code) }); setBinding(null);
      setBindingNotice(`${BINDING_LABELS[action]} → ${keyLabel(event.code)}${displaced ? `；已与${BINDING_LABELS[displaced]}交换` : ''}。`);
    }}><span>{BINDING_LABELS[action]}</span><kbd>{binding === action ? '请按键…' : keyLabel(settings.keybindings[action])}</kbd></button>)}</div><p className="binding-notice" role="status">{bindingNotice}</p><p className="binding-fixed">鼠标左键固定射击 · 右键固定冲刺 · Esc 暂停 · 1 / 2 / 3 选卡</p></div>}
    <div className="settings-footer"><span>设置自动保存于此设备</span><button className="button button-primary button-small" onClick={onClose}>完成 <Icon name="arrow" /></button></div>
  </Dialog>;
}

function PausedModules({ snapshot: s, expanded = true, recipesExpanded = false }: { snapshot: HudSnapshot; expanded?: boolean; recipesExpanded?: boolean }) {
  const labels = { ready: '就绪', active: '生效中', cooldown: '冷却', consumed: '本局已消耗' };
  return <><details className="paused-modules" open={expanded}><summary>本局模块 <span>{s.modules.length} 种 · {buildLayers(s)} 层</span></summary><div>{buildModuleViews({ modules: [...s.modules], ranks: s.moduleRanks, evolutions: [...s.evolutions] }).map(item => {
    const state = s.moduleStates.find(module => module.id === item.id);
    return <article key={item.id}><div><strong>{item.name} {rankLabel(item.rank)}{item.evolution ? ' ✦' : ''}</strong><span className={`module-${state?.status ?? 'ready'}`}>{state ? `${labels[state.status]}${state.remaining > 0 ? ` · ${state.remaining.toFixed(1)}s` : ''}` : '持续生效'}</span></div><p>{item.description}</p>{item.flavor && <small className="module-flavor">{item.flavor}</small>}</article>;
  })}</div>{!s.modules.length && <p className="upgrade-owned">收集经验升级，选择本局强化。</p>}</details><EvolutionRecipes snapshot={s} expanded={recipesExpanded} /></>;
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

function RotatePrompt({ runtime, openSettings }: { runtime: RuntimeControls; openSettings: () => void }) {
  return <Dialog title="请横屏游玩" eyebrow="战斗已暂停" className="rotate-dialog">
    <svg className="rotate-phone" viewBox="0 0 96 80" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="32" y="10" width="32" height="56" rx="6" transform="rotate(-25 48 38)" /><path d="M42 53h8M17 46a33 33 0 0 1 48-31m0-9v10h-10M79 30a33 33 0 0 1-48 31m0 9V60h10" /></svg>
    <p className="dialog-description">横过手机后，点继续。<br />笑梦：「换个方向！Wonderhoy！」</p>
    <div className="dialog-actions"><button className="button button-secondary" onClick={openSettings}>体验设置</button><button className="text-button centered" onClick={() => runtime.returnToMenu()}>返回主菜单</button></div>
  </Dialog>;
}

export default function App({ runtime }: { runtime: RuntimeControls }) {
  const subscribe = useCallback((listener: () => void) => runtime.subscribe(listener), [runtime]);
  const getSnapshot = useCallback(() => runtime.getSnapshot(), [runtime]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const debug = new URLSearchParams(window.location.search).get('debug') === '1';
  const openSettings = () => { if (snapshot.phase === 'playing') runtime.pause(); setSettingsOpen(true); };
  const inRun = ['playing', 'paused', 'upgrade', 'failed', 'complete'].includes(snapshot.phase);
  useEffect(() => {
    if (!['paused', 'menu', 'failed', 'complete'].includes(snapshot.phase)) setSettingsOpen(false);
  }, [snapshot.phase]);
  return <div className={`app phase-${snapshot.phase} control-${snapshot.controlMode} ${snapshot.settings.reducedMotion ? 'reduce-motion' : ''}`}>
    {inRun && (snapshot.controlMode === 'touch' ? <TouchHud snapshot={snapshot} runtime={runtime} /> : <Hud snapshot={snapshot} runtime={runtime} openSettings={openSettings} />)}
    {snapshot.controlMode === 'touch' && snapshot.phase === 'playing' && !snapshot.orientationBlocked && <TouchControls snapshot={snapshot} runtime={runtime} />}
    {snapshot.phase === 'menu' && <Menu runtime={runtime} snapshot={snapshot} openSettings={openSettings} openChangelog={() => setChangelogOpen(true)} openLeaderboard={() => setLeaderboardOpen(true)} />}
    {leaderboardOpen && runtime.leaderboard && <Dialog title="街机排行榜" eyebrow="WONDERHOY ARCADE" onClose={() => setLeaderboardOpen(false)} className="leaderboard-dialog"><Leaderboard client={runtime.leaderboard} initial={{ difficulty: snapshot.difficulty, mode: snapshot.mode, controls: snapshot.controlMode }} /></Dialog>}
    {snapshot.phase === 'loading' && <section className="screen-overlay loading-screen" aria-label="加载游戏"><span className="loading-mark" aria-hidden="true">✦</span><div className="eyebrow">凤小梦大战朝比奈真冬</div><h1>加载中……</h1><div className="loading-progress"><Meter value={snapshot.loading} label="资源加载进度" /><span>{Math.round(snapshot.loading * 100)}%</span></div><p>笑梦：Wonderhoy！！ 真冬：……还没开始就这么吵。</p></section>}
    {snapshot.phase === 'upgrade' && <UpgradeChoice key={snapshot.upgradeOfferId} snapshot={snapshot} runtime={runtime} />}
    {!settingsOpen && snapshot.phase === 'paused' && (snapshot.orientationBlocked ? <RotatePrompt runtime={runtime} openSettings={openSettings} /> : <Dialog title="先别喊了。" eyebrow="PAUSED" onClose={() => runtime.resume()}><p className="dialog-description">真冬：「……终于安静了。」战斗已暂停。</p><RunResults snapshot={snapshot} /><div className="dialog-actions"><button className="button button-primary" onClick={() => runtime.resume()}><Icon name="play" />继续游戏 {snapshot.controlMode === 'keyboardMouse' && <kbd>ESC</kbd>}</button><button className="button button-secondary" onClick={openSettings}><Icon name="settings" />体验设置</button>{snapshot.controlMode === 'touch' && <FullscreenButton runtime={runtime} />}<button className="text-button centered" onClick={() => runtime.returnToMenu()}>结束本局，返回主菜单</button></div><PausedModules snapshot={snapshot} /><ControlsGuide settings={snapshot.settings} compact touch={snapshot.controlMode === 'touch'} /></Dialog>)}
    {!settingsOpen && snapshot.phase === 'failed' && <Dialog title="……终于闭嘴了。" eyebrow="SILENCE." className="result-dialog failure-dialog"><div className="result-emblem" aria-hidden="true">✧</div><p className="dialog-description">笑梦：「呜哇……」本局结束，再次挑战从 Lv1 开始。</p><RunResults snapshot={snapshot} /><SaveNotice snapshot={snapshot} />{runtime.leaderboard && <ScoreEntry client={runtime.leaderboard} />}<div className="result-detail"><span>{snapshot.stageName} · 推进 {Math.floor(snapshot.progression / 360 * 100)}%</span><span>最高纪录 {snapshot.bestScore.toLocaleString('en-US')}</span></div><div className="dialog-actions"><button className="button button-primary" disabled={snapshot.orientationBlocked} onClick={() => runtime.restart()}><Icon name="restart" />再次挑战</button><button className="button button-secondary" onClick={() => runtime.returnToMenu()}>返回主菜单</button></div></Dialog>}
    {!settingsOpen && snapshot.phase === 'complete' && <Dialog title="Wonderhoy——！！" eyebrow="ONE MORE WONDERHOY!" className="result-dialog complete-dialog"><div className="result-emblem" aria-hidden="true">✦</div><p className="dialog-description">真冬：「为什么……还没停……」继续无尽会保留本局构筑。</p><RunResults snapshot={snapshot} /><SaveNotice snapshot={snapshot} />{runtime.leaderboard && <ScoreEntry client={runtime.leaderboard} />}<div className="dialog-actions"><button className="button button-secondary" disabled={snapshot.orientationBlocked} onClick={() => runtime.continueEndless()}><Icon name="spark" />继续 · 无尽挑战<Icon name="arrow" /></button><button className="button button-secondary" disabled={snapshot.orientationBlocked} onClick={() => runtime.restart()}><Icon name="restart" />重新开始</button><button className="text-button centered" onClick={() => runtime.returnToMenu()}>返回主菜单</button></div></Dialog>}
    {snapshot.phase === 'error' && <Dialog title="游戏暂时遇到问题" eyebrow="PLEASE RETRY" className="error-dialog"><p className="dialog-description">{snapshot.error || '游戏加载遇到了问题，请重新连接。'}</p><div className="dialog-actions"><button className="button button-primary" onClick={() => runtime.start()}><Icon name="restart" />重新连接</button><button className="text-button centered" onClick={() => window.location.reload()}>刷新页面</button></div></Dialog>}
    {settingsOpen && <Settings settings={snapshot.settings} controlMode={snapshot.controlMode} setSettings={settings => runtime.setSettings(settings)} onClose={() => setSettingsOpen(false)} />}
    {changelogOpen && snapshot.phase === 'menu' && <Changelog onClose={() => setChangelogOpen(false)} />}
    {debug && <aside className="debug-panel" aria-label="性能信息"><strong>PERFORMANCE</strong><span>渲染 {snapshot.stats.renderFps.toFixed(0)} FPS · 模拟 {snapshot.stats.simulationHz.toFixed(0)} Hz</span><span>P95 {snapshot.stats.frameP95.toFixed(1)}ms · P99 {snapshot.stats.frameP99.toFixed(1)}ms</span><span>更新 {snapshot.stats.updateMs.toFixed(2)}ms · 渲染 {snapshot.stats.renderMs.toFixed(2)}ms</span><span>敌人 {snapshot.stats.enemies} · 子弹 {snapshot.stats.bullets} · 粒子 {snapshot.stats.particles}</span><span>道具 {snapshot.stats.pickups} · 音频 {snapshot.stats.voices} · 纹理 {snapshot.stats.textures}</span></aside>}
  </div>;
}
