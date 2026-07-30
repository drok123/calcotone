import {
  useEffect,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import type { VisualAudioState } from '../../visual/VisualEngine';
import type { ModuleState, XYAssignment } from '../../ui/types';
import type { MotionPadProps } from '../motion/MotionPad';
import { MotionPad } from '../motion/MotionPad';
import { Knob } from '../controls/Knob';
import {
  SIGNAL_LAB_LABELS,
  SIGNAL_LAB_MODES,
  SIGNAL_LAB_STYLES,
  type SignalLabMode,
  type SignalLabStyle,
} from '../../audio/SignalLab';
import {
  setPressureState,
  usePressureState,
} from '../signal/pressureStore';
import './RailCModules.css';

type RailInteractionProps = {
  slotLabel: string;
  routingDragging: boolean;
  routingDropTarget: boolean;
  onRoutingDragStart: (event: ReactDragEvent<HTMLDivElement>) => void;
  onRoutingDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  onRoutingDrop: (event: ReactDragEvent<HTMLElement>) => void;
  onRoutingDragEnd: () => void;
  onRoutingNudge: (direction: -1 | 1) => void;
};

type FrameProps = RailInteractionProps & {
  id: string;
  name: string;
  enabled: boolean;
  onToggle: () => void;
  headerControl: ReactNode;
  children: ReactNode;
};

function RailModuleFrame({
  id,
  name,
  enabled,
  onToggle,
  headerControl,
  children,
  slotLabel,
  routingDragging,
  routingDropTarget,
  onRoutingDragStart,
  onRoutingDragOver,
  onRoutingDrop,
  onRoutingDragEnd,
  onRoutingNudge,
}: FrameProps) {
  return (
    <article
      className={`effect-module rail-c-module module-${id} ${enabled ? 'enabled' : ''} ${routingDragging ? 'routing-dragging' : ''} ${routingDropTarget ? 'routing-drop-target' : ''}`}
      style={{ '--module-activity': enabled ? 1 : 0 } as CSSProperties}
      onDragOver={onRoutingDragOver}
      onDrop={onRoutingDrop}
    >
      <header className="module-header">
        <div
          className="module-title module-drag-handle"
          draggable
          role="button"
          tabIndex={0}
          aria-label={`${name}, signal slot ${slotLabel}. Drag or use left and right arrow keys to reorder.`}
          onDragStart={onRoutingDragStart}
          onDragEnd={onRoutingDragEnd}
          onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              onRoutingNudge(-1);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              onRoutingNudge(1);
            }
          }}
        >
          <span className="module-number" aria-hidden="true">{slotLabel}</span>
          <span className="module-jewel" aria-hidden="true" />
          <h3>{name}</h3>
          <span className="module-route-cue" aria-hidden="true">↔</span>
        </div>
        <div className="module-header-control">{headerControl}</div>
        <button
          type="button"
          className="module-toggle"
          onClick={onToggle}
          aria-label={`${enabled ? 'Bypass' : 'Enable'} ${name}`}
          aria-pressed={enabled}
        >
          <span />
        </button>
      </header>
      {children}
    </article>
  );
}

type SynthMachine = 'model-d' | 'juno-106' | 'sh-101' | 'prophet-5' | 'dx7' | 'ms-20' | 'polysix' | 'ob-xa' | 'fairlight' | 'ppg-wave' | 'cz-101' | 'calcotone';

const SYNTH_MACHINES: readonly {
  id: SynthMachine;
  label: string;
  controls: readonly string[];
}[] = [
  { id: 'model-d', label: 'Moog Model D', controls: ['Osc Mix', 'Cutoff', 'Resonance', 'Contour', 'Drive', 'Glide'] },
  { id: 'juno-106', label: 'Roland Juno-106', controls: ['Shape', 'Sub', 'Filter', 'Envelope', 'Chorus', 'Detune'] },
  { id: 'sh-101', label: 'Roland SH-101', controls: ['Shape', 'Sub', 'Cutoff', 'Resonance', 'Envelope', 'Glide'] },
  { id: 'prophet-5', label: 'Sequential Prophet-5', controls: ['Shape', 'Poly Mod', 'Cutoff', 'Resonance', 'Envelope', 'Unison'] },
  { id: 'dx7', label: 'Yamaha DX7', controls: ['Algorithm', 'Ratio', 'Feedback', 'Envelope', 'Velocity', 'Brightness'] },
  { id: 'ms-20', label: 'Korg MS-20', controls: ['Osc Mix', 'High Pass', 'Low Pass', 'Peak', 'Envelope', 'Patch'] },
  { id: 'polysix', label: 'Korg Polysix', controls: ['Shape', 'Sub', 'Cutoff', 'Resonance', 'Ensemble', 'Unison'] },
  { id: 'ob-xa', label: 'Oberheim OB-Xa', controls: ['Osc Mix', 'Spread', 'Cutoff', 'Resonance', 'Envelope', 'Unison'] },
  { id: 'fairlight', label: 'Fairlight CMI', controls: ['Sample', 'Start', 'Tune', 'Loop', 'Filter', 'Character'] },
  { id: 'ppg-wave', label: 'PPG Wave 2.3', controls: ['Table', 'Position', 'Sweep', 'Filter', 'Envelope', 'Motion'] },
  { id: 'cz-101', label: 'Casio CZ-101', controls: ['Wave', 'DCW', 'DCA', 'Envelope', 'Ring', 'Detune'] },
  { id: 'calcotone', label: 'CALCOTONE Circuit', controls: ['Source', 'Fold', 'Color', 'Motion', 'Chaos', 'Space'] },
] as const;

const PITCHES = ['B4', 'A#4', 'A4', 'G#4', 'G4', 'F#4', 'F4', 'E4', 'D#4', 'D4', 'C#4', 'C4'] as const;
const INITIAL_PATTERNS: number[][] = [
  [9, -1, 9, -1, 7, -1, 9, -1, 4, -1, 7, -1, 9, 7, 4, -1],
  [9, 9, -1, 7, 4, -1, 7, -1, 2, -1, 4, -1, 7, 4, 2, -1],
  [9, -1, 4, -1, 7, -1, 2, -1, 9, -1, 7, 4, 2, -1, 4, -1],
  [4, -1, 7, -1, 9, -1, 7, -1, 2, 4, -1, 7, 9, -1, 4, -1],
];

function SynthModule(props: RailInteractionProps) {
  const [enabled, setEnabled] = useState(false);
  const [machine, setMachine] = useState<SynthMachine>('model-d');
  const [values, setValues] = useState([0.58, 0.46, 0.26, 0.54, 0.22, 0.08]);
  const [patterns, setPatterns] = useState<number[][]>(() => INITIAL_PATTERNS.map((pattern) => [...pattern]));
  const [patternIndex, setPatternIndex] = useState(0);
  const [chain, setChain] = useState([0, 0, 1, 2]);
  const [chainArmed, setChainArmed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);

  const definition = SYNTH_MACHINES.find((candidate) => candidate.id === machine) ?? SYNTH_MACHINES[0];
  const notes = patterns[patternIndex] ?? patterns[0];

  useEffect(() => {
    if (!playing || !enabled) return;
    const timer = window.setInterval(() => {
      setPlayhead((current) => (current + 1) % 16);
    }, 150);
    return () => window.clearInterval(timer);
  }, [playing, enabled]);

  function toggleCell(step: number, pitch: number): void {
    setPatterns((current) => current.map((pattern, index) => {
      if (index !== patternIndex) return pattern;
      const next = [...pattern];
      next[step] = next[step] === pitch ? -1 : pitch;
      return next;
    }));
  }

  function selectPattern(index: number): void {
    setPatternIndex(index);
    setPlayhead(0);
    if (chainArmed) setChain((current) => [...current, index].slice(-8));
  }

  return (
    <RailModuleFrame
      {...props}
      id="synth"
      name="Synth"
      enabled={enabled}
      onToggle={() => setEnabled((current) => !current)}
      headerControl={(
        <label className="algorithm-selector synth-machine-selector">
          <span className="sr-only">Synth machine</span>
          <select aria-label="Synth machine" value={machine} onChange={(event) => setMachine(event.target.value as SynthMachine)}>
            {SYNTH_MACHINES.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
          </select>
        </label>
      )}
    >
      <div className={`synth-roll dsp-viewport ${enabled ? 'active' : 'is-off'}`}>
        <div className="synth-roll-toolbar">
          <div>
            <strong>16 STEP SEQUENCE</strong>
            <span>P{String(patternIndex + 1).padStart(2, '0')} · 100 BPM</span>
          </div>
          <button type="button" className={playing ? 'active' : ''} aria-pressed={playing} onClick={() => setPlaying((current) => !current)}>
            {playing ? 'STOP' : 'PLAY'}
          </button>
        </div>
        <div className="piano-roll-grid" role="grid" aria-label="16-step piano roll">
          <div className="piano-roll-keys" aria-hidden="true">
            {PITCHES.map((pitch) => <span key={pitch} className={pitch.includes('#') ? 'sharp' : ''}>{pitch}</span>)}
          </div>
          <div className="piano-roll-cells">
            {PITCHES.map((pitch, pitchIndex) => (
              <div className="piano-roll-row" role="row" key={pitch}>
                {Array.from({ length: 16 }, (_, step) => {
                  const active = notes[step] === pitchIndex;
                  return (
                    <button
                      type="button"
                      role="gridcell"
                      key={`${pitch}-${step}`}
                      className={`${active ? 'has-note' : ''} ${playhead === step && playing ? 'playhead' : ''}`}
                      aria-label={`Step ${step + 1}, ${pitch}${active ? ', note active' : ''}`}
                      aria-pressed={active}
                      onClick={() => toggleCell(step, pitchIndex)}
                    >
                      {active && <span />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="synth-pattern-strip">
          <span>PATTERN</span>
          {[0, 1, 2, 3].map((index) => (
            <button type="button" key={index} className={patternIndex === index ? 'active' : ''} aria-pressed={patternIndex === index} onClick={() => selectPattern(index)}>
              {index + 1}
            </button>
          ))}
          <button type="button" className={chainArmed ? 'active chain-button' : 'chain-button'} aria-pressed={chainArmed} onClick={() => setChainArmed((current) => !current)}>CHAIN</button>
          <button type="button" onClick={() => setPatterns((current) => current.map((pattern, index) => index === patternIndex ? Array(16).fill(-1) : pattern))}>CLEAR</button>
          <strong>{chain.map((index) => index + 1).join(' › ')}</strong>
        </div>
      </div>
      <div className="knob-row synth-knob-row">
        {definition.controls.map((label, index) => (
          <Knob
            key={`${machine}-${label}`}
            label={label}
            value={values[index]}
            effectiveValue={values[index]}
            display={`${Math.round(values[index] * 100)}%`}
            patchTarget={`synth.${index}`}
            onChange={(value) => setValues((current) => current.map((item, valueIndex) => valueIndex === index ? value : item))}
            onReset={() => setValues((current) => current.map((item, valueIndex) => valueIndex === index ? 0.5 : item))}
            onPatchStart={() => undefined}
            onPatchMove={() => undefined}
            onPatchEnd={() => undefined}
            onPatchDisconnect={() => undefined}
          />
        ))}
      </div>
      <div className="prototype-status">UI ENGINE · SYNTH DSP NEXT PASS</div>
    </RailModuleFrame>
  );
}

type ChaosMode = 'chaos-pad' | 'performance-fx';

function ChaosModule({
  motionPadProps,
  ...props
}: RailInteractionProps & {
  motionPadProps: MotionPadProps;
}) {
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<ChaosMode>('chaos-pad');
  const [effect, setEffect] = useState('grain-delay');
  const [values, setValues] = useState([0.42, 0.34, 0.52, 0.68]);
  const labels = mode === 'chaos-pad'
    ? ['Depth', 'Feedback', 'Drift', 'Mix']
    : ['Scatter', 'Rate', 'Color', 'Mix'];

  return (
    <RailModuleFrame
      {...props}
      id="chaos"
      name="Chaos"
      enabled={enabled}
      onToggle={() => setEnabled((current) => !current)}
      headerControl={(
        <div className="chaos-selector-pair">
          <label className="algorithm-selector chaos-mode-selector">
            <span className="sr-only">Chaos machine</span>
            <select
              aria-label="Chaos machine"
              value={mode}
              onChange={(event) => {
                const nextMode = event.target.value as ChaosMode;
                setMode(nextMode);
                setEffect(nextMode === 'chaos-pad' ? 'grain-delay' : 'djfx-looper');
              }}
            >
              <option value="chaos-pad">Chaos Pad</option>
              <option value="performance-fx">Performance FX</option>
            </select>
          </label>
          <label className="algorithm-selector chaos-program-selector">
            <span className="sr-only">Chaos program</span>
            <select aria-label="Chaos program" value={effect} onChange={(event) => setEffect(event.target.value)}>
              {mode === 'chaos-pad' ? (
                <>
                  <option value="grain-delay">Grain Delay</option>
                  <option value="dub-space">Dub Space</option>
                  <option value="spectral-freeze">Spectral Freeze</option>
                  <option value="pitch-vortex">Pitch Vortex</option>
                  <option value="filter-feedback">Filter Feedback</option>
                </>
              ) : (
                <>
                  <option value="djfx-looper">DJFX Looper</option>
                  <option value="vinyl-brake">Vinyl Brake</option>
                  <option value="scatter">Scatter</option>
                  <option value="isolator">Isolator</option>
                  <option value="stutter">Stutter</option>
                </>
              )}
            </select>
          </label>
        </div>
      )}
    >
      <div className={`chaos-pad-shell ${enabled ? 'active' : 'is-off'}`}>
        <MotionPad {...motionPadProps} />
      </div>
      <div className="knob-row chaos-knob-row">
        {labels.map((label, index) => (
          <Knob
            key={label}
            label={label}
            value={values[index]}
            effectiveValue={values[index]}
            display={`${Math.round(values[index] * 100)}%`}
            patchTarget={`chaos.${index}`}
            onChange={(value) => setValues((current) => current.map((item, valueIndex) => valueIndex === index ? value : item))}
            onReset={() => setValues((current) => current.map((item, valueIndex) => valueIndex === index ? 0.5 : item))}
            onPatchStart={() => undefined}
            onPatchMove={() => undefined}
            onPatchEnd={() => undefined}
            onPatchDisconnect={() => undefined}
          />
        ))}
      </div>
    </RailModuleFrame>
  );
}

function PressureModule({
  running,
  visualState,
  ...props
}: RailInteractionProps & {
  running: boolean;
  visualState: VisualAudioState;
}) {
  const state = usePressureState();
  const meter = Math.max(1, Math.round((state.enabled ? visualState.level : 0) * 18));
  const meterText = `${'█'.repeat(meter)}${'░'.repeat(18 - meter)}`;

  return (
    <RailModuleFrame
      {...props}
      id="pressure"
      name="Pressure"
      enabled={state.enabled}
      onToggle={() => setPressureState({ enabled: !state.enabled })}
      headerControl={(
        <label className="algorithm-selector pressure-machine-selector">
          <span className="sr-only">Pressure machine</span>
          <select aria-label="Pressure machine" value={state.mode} onChange={(event) => setPressureState({ mode: event.target.value as SignalLabMode })}>
            {SIGNAL_LAB_MODES.map((mode) => <option value={mode} key={mode}>{SIGNAL_LAB_LABELS[mode]}</option>)}
          </select>
        </label>
      )}
    >
      <div className={`pressure-ascii dsp-viewport ${state.enabled ? 'active' : 'is-off'}`} aria-label="Pressure compressor display">
        <pre aria-hidden="true">{`╔══════════════════════════╗
║      P R E S S U R E     ║
║    HARDWARE DYNAMICS     ║
╠══════════════════════════╣
║ IN  ${meterText} ║
║ GR  ${state.enabled && running ? '▾▾▾▾' : '····'}  ${state.style.toUpperCase().padEnd(9, ' ')} ║
╚══════════════════════════╝`}</pre>
        <div className="pressure-scanline" aria-hidden="true" />
      </div>
      <div className="knob-row pressure-rail-knobs">
        {([
          ['Drive', 'drive'],
          ['Time', 'time'],
          ['Character', 'character'],
          ['Mix', 'mix'],
        ] as const).map(([label, key]) => (
          <Knob
            key={key}
            label={label}
            value={state[key]}
            effectiveValue={state[key]}
            display={`${Math.round(state[key] * 100)}%`}
            patchTarget={`pressure.${key}`}
            onChange={(value) => setPressureState({ [key]: value })}
            onReset={() => setPressureState({ [key]: key === 'mix' ? 0.72 : key === 'time' ? 0.46 : key === 'drive' ? 0.42 : 0.38 })}
            onPatchStart={() => undefined}
            onPatchMove={() => undefined}
            onPatchEnd={() => undefined}
            onPatchDisconnect={() => undefined}
          />
        ))}
      </div>
      <div className="pressure-style-strip" role="group" aria-label="Pressure operating style">
        {SIGNAL_LAB_STYLES.map((style) => (
          <button type="button" key={style} className={state.style === style ? 'active' : ''} aria-pressed={state.style === style} onClick={() => setPressureState({ style: style as SignalLabStyle })}>
            {style.toUpperCase()}
          </button>
        ))}
      </div>
    </RailModuleFrame>
  );
}

export function RailCModule({
  moduleId,
  modules,
  assignments,
  motionPadProps,
  visualState,
  running,
  ...interaction
}: RailInteractionProps & {
  moduleId: string;
  modules: ModuleState[];
  assignments: XYAssignment[];
  motionPadProps: MotionPadProps;
  visualState: VisualAudioState;
  running: boolean;
}) {
  void modules;
  void assignments;
  if (moduleId === 'synth') return <SynthModule {...interaction} />;
  if (moduleId === 'chaos') return <ChaosModule {...interaction} motionPadProps={motionPadProps} />;
  if (moduleId === 'pressure') return <PressureModule {...interaction} running={running} visualState={visualState} />;
  return null;
}
