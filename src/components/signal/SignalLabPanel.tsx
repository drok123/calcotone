import type { ChangeEvent as ReactChangeEvent } from 'react';
import { LinearControl } from '../controls/LinearControl';
import {
  SIGNAL_LAB_LABELS,
  SIGNAL_LAB_MODES,
  type SignalLabMode,
  type SignalLabState,
} from '../../audio/SignalLab';

export function SignalLabPanel({
  state,
  running,
  onChange,
}: {
  state: SignalLabState;
  running: boolean;
  onChange: (next: Partial<SignalLabState>) => void;
}) {
  return (
    <section className={`signal-lab ${state.enabled ? 'is-enabled' : ''}`} aria-label="Signal Lab">
      <div className="signal-lab-heading">
        <div>
          <strong>SIGNAL</strong>
          <small>UTILITY PROCESSOR</small>
        </div>
        <span className={`jewel-light ${running && state.enabled ? 'active' : ''}`} aria-hidden="true" />
        <button type="button" className={state.enabled ? 'active' : ''} aria-pressed={state.enabled} onClick={() => onChange({ enabled: !state.enabled })}>
          {state.enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="signal-lab-row">
        <label>
          <span>Machine</span>
          <select value={state.mode} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onChange({ mode: event.target.value as SignalLabMode })}>
            {SIGNAL_LAB_MODES.map((mode) => <option value={mode} key={mode}>{SIGNAL_LAB_LABELS[mode]}</option>)}
          </select>
        </label>
        <div className="signal-lab-position" role="group" aria-label="Signal insert position">
          <button type="button" className={state.position === 'pre' ? 'active' : ''} onClick={() => onChange({ position: 'pre' })}>PRE</button>
          <button type="button" className={state.position === 'post' ? 'active' : ''} onClick={() => onChange({ position: 'post' })}>POST</button>
        </div>
      </div>

      <div className="signal-lab-controls">
        <LinearControl label="Amount" value={state.amount} min={0} max={1} step={0.01} display={`${Math.round(state.amount * 100)}%`} onChange={(amount) => onChange({ amount })} />
        <LinearControl label="Tone" value={state.tone} min={0} max={1} step={0.01} display={`${Math.round(state.tone * 100)}%`} onChange={(tone) => onChange({ tone })} />
        <LinearControl label="Motion" value={state.motion} min={0} max={1} step={0.01} display={`${Math.round(state.motion * 100)}%`} onChange={(motion) => onChange({ motion })} />
        <LinearControl label="Mix" value={state.mix} min={0} max={1} step={0.01} display={`${Math.round(state.mix * 100)}%`} onChange={(mix) => onChange({ mix })} />
      </div>
    </section>
  );
}
