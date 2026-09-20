import type { ModuleId } from '../game/types';

type Shape = 'needle' | 'wing' | 'focus' | 'shatter' | 'chain' | 'beam' | 'orbit' | 'return' | 'ring' | 'dash' | 'star' | 'wave' | 'crescent' | 'note' | 'sweep' | 'triangle' | 'decoy' | 'wind' | 'lane' | 'shield';
const SHAPES: Record<ModuleId, Shape> = {
  piercing: 'needle', wingShots: 'wing', precision: 'focus', shatter: 'shatter', chain: 'chain', prism: 'beam',
  droneHoming: 'orbit', droneBurst: 'triangle', slow: 'ring', division: 'triangle', intercept: 'shield', orbitBlade: 'sweep',
  doubleDash: 'dash', vent: 'wind', reserveAmmo: 'ring', graze: 'shield', revive: 'shield', magnet: 'ring',
  ricochet: 'chain', rearSpark: 'wing', crossOrbit: 'orbit', returnWing: 'return', brakeField: 'ring', dashEcho: 'dash',
  pulseChamber: 'wave', anchorStars: 'star', crescentMagazine: 'crescent', beamCircuit: 'beam', droneSpotlight: 'focus',
  droneNotes: 'note', dronePlectrum: 'sweep', droneConduit: 'triangle', decoyEcho: 'decoy', slipstream: 'wind', dashLane: 'lane', counterPulse: 'shield',
};

/** A short declarative illustration of the attack shape; no simulation or frame loop. */
export function ModulePreview({ id, rank, evolved = false, reducedMotion }: { id: ModuleId; rank: number; evolved?: boolean; reducedMotion: boolean }) {
  const shape = SHAPES[id], stage = rank >= 5 ? 3 : rank >= 3 ? 2 : 1;
  return <svg className={`module-preview preview-${shape} ${evolved ? 'is-evolved' : ''}`} viewBox="0 0 240 74" aria-hidden="true" data-preview-module={id} data-preview-stage={stage} data-static={reducedMotion}>
    <path className="preview-guide" d="M12 57H228M42 11V64M197 11V64" />
    <g className="preview-player"><path d="m35 35 7-8 7 8-7 8Z" /><circle cx="42" cy="35" r="3" /></g>
    <g className="preview-target"><circle cx="199" cy="35" r="10" /><path d="M193 29l12 12m0-12-12 12" /></g>
    <g className="preview-action">
      {shape === 'needle' && <><path d="M58 35h146m-12-4 12 4-12 4" /><path className="preview-highlight" d={`M${110 - stage * 14} 35h${82 + stage * 14}`} />{Array.from({ length: stage + 1 }, (_, i) => <path key={i} d={`M${105 + i * 28} 23v24`} />)}</>}
      {shape === 'wing' && <>{[-1, 1].map(side => <g key={side}><path d={`M46 ${35 + side * 13}h15`} />{Array.from({ length: id === 'wingShots' ? stage : 1 }, (_, lane) => <path key={lane} className={lane === 0 ? 'preview-highlight' : undefined} d={`M65 ${35 + side * 13}L139 ${35 + side * (12 + lane * 8)}h48`} />)}</g>)}<path d="M61 35h98" /></>}
      {shape === 'focus' && <><path d="m56 18 78 17-78 17m78-17h57" /><circle cx="159" cy="35" r={9 + stage * 2} /><path className="preview-highlight" d="M154 35h41" /></>}
      {shape === 'shatter' && <><path d="M56 35h90" />{Array.from({ length: 6 }, (_, i) => <path key={i} transform={`rotate(${i * 60} 161 35)`} d="M167 35h16" />)}<circle cx="161" cy="35" r="4" /></>}
      {shape === 'chain' && <><path d="m58 35 60-14 44 31 35-17" /><circle cx="118" cy="21" r="4" /><circle cx="162" cy="52" r="4" /></>}
      {shape === 'beam' && <><path className="preview-highlight" d="M56 35h159" /><path d="m60 23 131 8m-131 16 131-8" />{stage > 1 && <path d="M78 17h113M78 53h113" />}</>}
      {shape === 'orbit' && <><ellipse cx="111" cy="35" rx={41 + stage * 5} ry="22" />{[0, 120, 240].map(angle => <g key={angle} transform={`rotate(${angle} 111 35)`}><circle cx="160" cy="35" r="5" /><path d="M170 35h18" /></g>)}</>}
      {shape === 'return' && <><path d="M59 25h103q35 0 35 13t-35 13H79m10-5-10 5 10 5" /><path className="preview-highlight" d="M105 25h43" /></>}
      {shape === 'ring' && <>{[12, 21, 30].slice(0, stage + 1).map(r => <ellipse key={r} cx="123" cy="35" rx={r * 1.4} ry={r * .75} />)}<path d="M60 35h16m94 0h15" /></>}
      {shape === 'dash' && <><path d="m59 35 44-15 21 30 38-30 27 15" />{[71, 112, 159].map(x => <path key={x} d={`m${x} 29 6 6-6 6`} />)}<circle cx="189" cy="35" r="13" /></>}
      {shape === 'wave' && <>{Array.from({ length: stage + 1 }, (_, i) => <path key={i} d={`M${92 + i * 29} 14q23 21 0 42`} />)}<path d="M58 35h22" /></>}
      {shape === 'star' && <><path d="M58 35h58" /><path d="m150 11 7 17 20 7-20 7-7 17-7-17-20-7 20-7Z" />{stage > 1 && <circle cx="150" cy="35" r="26" />}</>}
      {shape === 'crescent' && <>{Array.from({ length: stage }, (_, i) => <path key={i} d={`M${111 + i * 28} 12q37 23 0 46q18-23 0-46Z`} />)}</>}
      {shape === 'note' && <>{Array.from({ length: stage }, (_, i) => <g key={i} transform={`translate(${85 + i * 42} 0)`}><path d="M0 42V21l14-3v20" /><ellipse cx="-4" cy="44" rx="6" ry="4" /><ellipse cx="10" cy="40" rx="6" ry="4" /></g>)}</>}
      {shape === 'sweep' && <><path d="M122 10a27 27 0 1 1-23 42" /><path className="preview-highlight" d="M141 14a30 30 0 0 1 10 38" /><circle cx="122" cy="35" r="5" /></>}
      {shape === 'triangle' && <><path d="m103 57 36-45 37 45Z" />{[[103, 57], [139, 12], [176, 57]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="5" />)}<path className="preview-highlight" d="m112 51 27-34 28 34" /></>}
      {shape === 'decoy' && <><path className="preview-muted" d="m84 35 10-12 10 12-10 12Zm37 0 10-12 10 12-10 12Z" /><path d="M111 35h6m29 0h34m-7-5 8 5-8 5" /></>}
      {shape === 'wind' && <><path d="M65 21h97q22 0 14-10M75 35h113M63 49h99q22 0 14 10" /><path className="preview-highlight" d="M98 35h61" /></>}
      {shape === 'lane' && <><path d="M59 20h130M59 50h130" /><path d="m92 28 9 7-9 7m35-14 9 7-9 7m35-14 9 7-9 7" /></>}
      {shape === 'shield' && <><path d="m119 12 26 9v16q0 15-26 22-26-7-26-22V21Z" /><path d="M119 24v24m-12-12h24" />{stage > 1 && <path d="M153 20q18 15 0 30" />}</>}
    </g>
  </svg>;
}
