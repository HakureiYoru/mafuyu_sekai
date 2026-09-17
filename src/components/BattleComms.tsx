import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, RefObject } from 'react';
import { ASSET_URLS } from '../game/config';
import type { CommsMessage, HudSnapshot } from '../game/types';

type Speaker = 'EMU' | 'MAFUYU';
type Placement = { layout: 'sides' | 'compact'; small: boolean; left: number; right: number; bottom: number };
const INITIAL_PLACEMENT: Placement = { layout: 'compact', small: true, left: 0, right: 0, bottom: 0 };
const SPEAKERS: Speaker[] = ['EMU', 'MAFUYU'];
const NAMES = { EMU: '凤笑梦', MAFUYU: '朝比奈真冬' };
const POSES = ['emu-happy', 'emu-cheer', 'emu-surprised', 'emu-hurt', 'mafuyu-cold', 'mafuyu-annoyed', 'mafuyu-shadow', 'mafuyu-rage'];
const spriteUrl = (pose: string) => `${import.meta.env.BASE_URL}assets/comms/${pose}.webp`;
const MOTIONS: Record<CommsMessage['gesture'], { frames: Keyframe[]; duration: number }> = {
  none: { frames: [], duration: 0 },
  hop: { frames: [{ transform: 'translateY(0)' }, { transform: 'translateY(-10px) rotate(-4deg)', offset: .4 }, { transform: 'translateY(0) rotate(2deg)', offset: .75 }, { transform: 'none' }], duration: 480 },
  flinch: { frames: [{ transform: 'none' }, { transform: 'translateX(4px) rotate(5deg)', offset: .3 }, { transform: 'translateX(-2px) rotate(-2deg)', offset: .65 }, { transform: 'none' }], duration: 360 },
  tilt: { frames: [{ transform: 'none' }, { transform: 'rotate(-5deg)', offset: .4 }, { transform: 'none' }], duration: 420 },
  tremble: { frames: [{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)', offset: .15 }, { transform: 'translateX(3px)', offset: .3 }, { transform: 'translateX(-2px)', offset: .5 }, { transform: 'translateX(2px)', offset: .7 }, { transform: 'translateX(0)' }], duration: 380 },
};

/** Only resize/layout changes are observed; the battle keeps its existing size. */
export function useCommsPlacement(hud: RefObject<HTMLDivElement | null>): Placement {
  const [placement, setPlacement] = useState(INITIAL_PLACEMENT);
  useLayoutEffect(() => {
    const host = document.getElementById('game-host');
    const shell = document.getElementById('game-shell');
    if (!host || !shell || !hud.current) return;
    const measure = () => {
      const field = host.getBoundingClientRect(), frame = shell.getBoundingClientRect();
      const left = Math.max(0, field.left - frame.left), right = Math.max(0, frame.right - field.right);
      const next: Placement = {
        layout: Math.min(left, right) >= 104 ? 'sides' : 'compact',
        small: Math.min(left, right) < 160 || frame.width < 1000 || frame.height < 680,
        left, right, bottom: frame.bottom - field.bottom + Math.min(24, field.height * .05),
      };
      setPlacement(previous => Object.keys(next).every(key => previous[key as keyof Placement] === next[key as keyof Placement]) ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host); observer.observe(shell);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [hud]);
  return placement;
}

function Sprite({ speaker, mood, compact = false }: { speaker: Speaker; mood: CommsMessage['mood']; compact?: boolean }) {
  const url = spriteUrl(`${speaker.toLowerCase()}-${mood}`);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const fallback = compact || failedUrl === url;
  return <img
    src={fallback ? ASSET_URLS[speaker === 'EMU' ? 'player' : 'enemy'] : url}
    alt={NAMES[speaker]}
    className={`comms-sprite ${fallback ? 'is-avatar' : ''}`}
    data-testid={`comms-sprite-${speaker.toLowerCase()}`}
    data-fallback={fallback}
    draggable={false}
    decoding="async"
    onError={fallback ? undefined : () => setFailedUrl(url)}
  />;
}

function Bubble({ message, previous, reduced }: { message: CommsMessage; previous?: boolean; reduced: boolean }) {
  return <div className={`comms-bubble ${previous ? 'is-previous' : 'is-current'}`} data-testid={previous ? 'comms-previous' : 'comms-current'} data-speaker={message.speaker} data-message-id={message.id} data-conversation-id={message.conversationId ?? ''}>
    <span className="comms-bubble-name">{NAMES[message.speaker as Speaker] ?? message.speaker}</span>
    <p className="comms-bubble-text">{previous || reduced ? message.fullText : message.text}<span className="comms-bubble-cursor" aria-hidden="true">{!previous && !reduced && message.text.length < message.fullText.length ? '▏' : ''}</span></p>
  </div>;
}

function Actor({ speaker, message, previous, frozen, reduced, played }: { speaker: Speaker; message: CommsMessage | null; previous: boolean; frozen: boolean; reduced: boolean; played: RefObject<Map<Speaker, number>> }) {
  const figure = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const mood = message?.mood ?? (speaker === 'EMU' ? 'happy' : 'cold');
  const gesture = previous ? 'none' : message?.gesture ?? 'none';
  const messageId = message?.id;
  useLayoutEffect(() => {
    if (!figure.current || messageId === undefined || gesture === 'none' || reduced || played.current.get(speaker) === messageId) return;
    played.current.set(speaker, messageId);
    const motion = MOTIONS[gesture];
    const next = figure.current.animate(motion.frames, { duration: motion.duration, easing: 'ease-out' });
    animation.current = next;
    return () => { next.cancel(); animation.current = null; };
  }, [messageId, gesture, reduced, played, speaker]);
  useLayoutEffect(() => {
    const motion = animation.current;
    if (!motion || motion.playState === 'finished') return;
    if (frozen) motion.pause();
    else if (motion.playState === 'paused') motion.play();
  }, [frozen, messageId, gesture]);
  return <div className={`comms-actor comms-${speaker.toLowerCase()} ${message && !previous ? 'is-speaking' : ''}`} data-testid={`comms-${speaker.toLowerCase()}`} data-expression={mood}>
    {message && <Bubble message={message} previous={previous} reduced={reduced} />}
    <div ref={figure} className="comms-figure" data-motion={gesture} data-message-id={messageId ?? ''}>
      <Sprite speaker={speaker} mood={mood} />
      {!reduced && message && !previous && <span className={`comms-emote emote-${mood}`} aria-hidden="true">{mood === 'cheer' ? '✦' : mood === 'surprised' ? '!' : mood === 'rage' ? '╬' : mood === 'annoyed' ? '…' : ''}</span>}
    </div>
  </div>;
}

export function BattleComms({ snapshot: s, placement, portalHost, collapsed }: { snapshot: HudSnapshot; placement: Placement; portalHost: RefObject<HTMLDivElement | null>; collapsed: boolean }) {
  const played = useRef(new Map<Speaker, number>());
  const [systemReduced, setSystemReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystemReduced(preference.matches);
    preference.addEventListener('change', update);
    // Decorative resources never delay the main game loading pipeline.
    const images = (s.controlMode === 'touch' ? [] : POSES).map(pose => { const image = new window.Image(); image.decoding = 'async'; image.fetchPriority = 'low'; image.src = spriteUrl(pose); return image; });
    return () => { preference.removeEventListener('change', update); images.forEach(image => { image.onload = null; image.onerror = null; }); };
  }, [s.controlMode]);
  // Do not replay a shout that happened while the communications were hidden.
  useEffect(() => { if (collapsed && s.comms) played.current.set(s.comms.speaker as Speaker, s.comms.id); }, [collapsed, s.comms?.id, s.comms]);
  if (collapsed) return null;
  const reduced = s.settings.reducedMotion || systemReduced;
  const current = s.comms;
  const previous = current?.conversationId && s.commsPrevious?.conversationId === current.conversationId && s.commsPrevious.speaker !== current.speaker ? s.commsPrevious : null;
  const frozen = s.phase !== 'playing';
  const layout = s.controlMode === 'touch' ? 'compact' : placement.layout;
  const shared = { 'data-testid': 'comms-root', 'data-layout': layout, 'data-frozen': frozen, 'data-quality': s.settings.quality, 'data-reduced': reduced } as const;
  if (layout === 'compact' || !portalHost.current) return <aside {...shared} className="bubble-comms bubble-comms-compact" aria-label="双人战斗通讯">
    <div className="comms-avatar-pair">{SPEAKERS.map(speaker => <div key={speaker} className={current?.speaker === speaker ? 'is-speaking' : ''} data-testid={`comms-${speaker.toLowerCase()}`} data-expression={current?.speaker === speaker ? current.mood : speaker === 'EMU' ? 'happy' : 'cold'}><Sprite speaker={speaker} mood={speaker === 'EMU' ? 'happy' : 'cold'} compact /></div>)}</div>
    {current && <Bubble message={current} reduced={reduced} />}
  </aside>;
  const style = { '--comms-left-gap': `${placement.left}px`, '--comms-right-gap': `${placement.right}px`, '--comms-bottom': `${placement.bottom}px` } as CSSProperties;
  return createPortal(<aside {...shared} className={`bubble-comms bubble-comms-sides ${placement.small ? 'is-small' : ''}`} style={style} aria-label="双人战斗通讯">
    {SPEAKERS.map(speaker => {
      const message = current?.speaker === speaker ? current : previous?.speaker === speaker ? previous : null;
      return <div key={speaker} className={`comms-gutter comms-gutter-${speaker.toLowerCase()}`}><Actor speaker={speaker} message={message} previous={message !== null && message === previous} frozen={frozen} reduced={reduced} played={played} /></div>;
    })}
  </aside>, portalHost.current);
}
