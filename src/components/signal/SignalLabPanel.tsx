import type { ChangeEvent as ReactChangeEvent } from 'react';
import { Knob } from '../controls/Knob';
import {
  SIGNAL_LAB_LABELS,
  SIGNAL_LAB_MODES,
  SIGNAL_LAB_STYLES,
  type SignalLabMode,
  type SignalLabState,
  type SignalLabStyle,
} from '../../audio/SignalLab';

const NOOP = () => undefined;

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
    <section className={`signal-lab pressure-panel ${state.enabled ? 'is-enabled' : ''}`} aria-label="Pressure hardware dynamics">
      <div className="signal-lab-heading pressure-heading">
        <div>
          <strong>PRESSURE</strong>
          <small>HARDWARE DYNAMICS</small>
        </div>
        <span className={`jewel-light ${running && state.enabled ? 'active' : ''}`} aria-hidden="true" />
        <button type="button" className={state.enabled ? 'active' : ''} aria-pressed={state.enabled} onClick={() => onChange({ enabled: !state.enabled })}>
          {state.enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      <label className="pressure-machine">
        <span>Machine</span>
        <select value={state.mode} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onChange({ mode: event.target.value as SignalLabMode })}>
          {SIGNAL_LAB_MODES.map((mode) => <option value={mode} key={mode}>{SIGNAL_LAB_LABELS[mode]}</option>)}
        </select>
      </label>

      <div className="pressure-knobs">
        <Knob label="Drive" value={state.drive} effectiveValue={state.drive} display={`${Math.round(state.drive * 100)}%`} patchTarget="pressure.drive" onChange={(drive) => onChange({ drive })} onReset={() => onChange({ drive: 0.42 })} onPatchStart={NOOP} onPatchMove={NOOP} onPatchEnd={NOOP} onPatchDisconnect={NOOP} />
        <Knob label="Time" value={state.time} effectiveValue={state.time} display={`${Math.round(state.time * 100)}%`} patchTarget="pressure.time" onChange={(time) => onChange({ time })} onReset={() => onChange({ time: 0.46 })} onPatchStart={NOOP} onPatchMove={NOOP} onPatchEnd={NOOP} onPatchDisconnect={NOOP} />
        <Knob label="Character" value={state.character} effectiveValue={state.character} display={`${Math.round(state.character * 100)}%`} patchTarget="pressure.character" onChange={(character) => onChange({ character })} onReset={() => onChange({ character: 0.38 })} onPatchStart={NOOP} onPatchMove={NOOP} onPatchEnd={NOOP} onPatchDisconnect={NOOP} />
        <Knob label="Mix" value={state.mix} effectiveValue={state.mix} display={`${Math.round(state.mix * 100)}%`} patchTarget="pressure.mix" onChange={(mix) => onChange({ mix })} onReset={() => onChange({ mix: 0.72 })} onPatchStart={NOOP} onPatchMove={NOOP} onPatchEnd={NOOP} onPatchDisconnect={NOOP} />
      </div>

      <div className="pressure-styles" role="group" aria-label="Pressure operating style">
        {SIGNAL_LAB_STYLES.map((style) => (
          <button key={style} type="button" className={state.style === style ? 'active' : ''} aria-pressed={state.style === style} onClick={() => onChange({ style: style as SignalLabStyle })}>
            {style.toUpperCase()}
          </button>
        ))}
      </div>
    </section>
  );
}
