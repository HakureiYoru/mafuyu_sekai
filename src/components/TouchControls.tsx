import type { MouseEvent } from 'react';
import type { HudSnapshot, RuntimeControls, TouchAction } from '../game/types';

/** Pointer ownership lives in TouchInputController; React only handles keyboard activation. */
export function TouchControls({ snapshot: s, runtime }: { snapshot: HudSnapshot; runtime: RuntimeControls }) {
  const disabled = s.phase !== 'playing' || s.orientationBlocked;
  const activate = (action: TouchAction) => (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0 && !disabled) runtime.touchAction(action);
  };
  const firing = s.touch.autoFireEnabled;
  return <div className="touch-controls" data-testid="touch-controls" aria-label="触屏操作" aria-hidden={disabled}>
    <div className="touch-stick-zone" data-touch-control="stick" data-testid="touch-stick" role="group" aria-label="拖动摇杆移动">
      <div className="touch-stick-base" aria-hidden="true"><span className="touch-stick-axis" /><span className="touch-stick-knob" /></div>
      <span className="touch-stick-label" aria-hidden="true">移动</span>
    </div>
    <div className="touch-action-zone">
      <div className="touch-action-primary">
        <button type="button" className={`touch-action touch-dash ${s.dashCharges > 0 ? 'is-ready' : ''} ${s.perfectWindow > 0 ? 'is-empowered' : ''}`} data-touch-control="dash" disabled={disabled} onClick={activate({ type: 'dash' })} aria-label="冲刺">
          <svg viewBox="0 0 32 32" aria-hidden="true"><path d="m7 7 11 9L7 25m10-18 11 9-11 9" /></svg>
          <strong>冲刺</strong><span>{s.dashCharges > 0 ? s.dashCharges > 1 ? `${s.dashCharges} 次` : '就绪' : `${s.dashCooldown.toFixed(1)}s`}</span>
        </button>
        <button type="button" className="touch-action touch-bomb" data-touch-control="bomb" disabled={disabled} onClick={activate({ type: 'bomb' })} aria-label={`炸弹，剩余 ${s.bombs} 枚`}>
          <svg viewBox="0 0 32 32" aria-hidden="true"><path d="m16 3 4 9 9 4-9 4-4 9-4-9-9-4 9-4Z" /></svg><strong>炸弹</strong><span>× {s.bombs}</span>
        </button>
      </div>
      <div className="touch-action-secondary">
        <button type="button" className="touch-action touch-focus" data-touch-control="focus" disabled={disabled} onClick={activate({ type: 'focus' })} aria-label="慢移" aria-pressed={s.touch.focus}>慢移<span>{s.touch.focus ? '开' : '关'}</span></button>
        <button type="button" className="touch-action touch-fire" data-touch-control="fire" disabled={disabled} onClick={activate({ type: 'fire' })} aria-label="自动射击" aria-pressed={firing}>{firing ? '停火' : '开火'}<span>{firing ? s.touch.cooling ? '散热中' : '自动' : '已停火'}</span></button>
      </div>
    </div>
  </div>;
}
