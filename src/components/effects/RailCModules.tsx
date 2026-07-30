import {
  useEffect,
  useRef,
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
import type { SynthMachine } from '../../audio/SynthEngine';
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

type SynthPreset = {
  id: string;
  label: string;
  values: readonly [number, number, number, number, number, number];
};

const SYNTH_PRESETS: Record<SynthMachine, readonly SynthPreset[]> = {
  'model-d': [
    { id: 'panel-init', label: 'Panel · Init', values: [.58, .46, .26, .54, .22, .08] },
    { id: 'panel-bass', label: 'Panel · Fat Bass', values: [.34, .31, .22, .56, .62, .04] },
    { id: 'panel-lead', label: 'Panel · Singing Lead', values: [.67, .62, .48, .71, .42, .28] },
    { id: 'panel-brass', label: 'Panel · Brass Stack', values: [.52, .44, .18, .34, .28, .11] },
  ],
  'juno-106': [
    { id: 'factory-a11', label: 'Original · A-11', values: [.62, .36, .58, .54, .78, .24] },
    { id: 'factory-a24', label: 'Original · A-24', values: [.42, .68, .38, .73, .84, .38] },
    { id: 'factory-b35', label: 'Original · B-35', values: [.28, .81, .82, .34, .48, .14] },
    { id: 'factory-b72', label: 'Original · B-72', values: [.71, .52, .31, .66, .91, .42] },
  ],
  'sh-101': [
    { id: 'panel-init', label: 'Panel · Init', values: [.54, .42, .46, .33, .52, .08] },
    { id: 'panel-acid', label: 'Panel · Acid Sequence', values: [.82, .38, .78, .74, .44, .2] },
    { id: 'panel-sub', label: 'Panel · Rubber Sub', values: [.18, .76, .27, .42, .62, .03] },
    { id: 'panel-perc', label: 'Panel · Snap Perc', values: [.68, .57, .64, .16, .24, .01] },
  ],
  'prophet-5': [
    { id: 'original-11', label: 'Original · Program 11', values: [.58, .34, .48, .38, .52, .2] },
    { id: 'original-12', label: 'Original · Program 12', values: [.74, .62, .24, .69, .42, .64] },
    { id: 'original-23', label: 'Original · Program 23', values: [.37, .29, .58, .76, .35, .46] },
    { id: 'original-35', label: 'Original · Program 35', values: [.66, .72, .36, .52, .28, .78] },
  ],
  'dx7': [
    { id: 'rom-brass1', label: 'ROM 1 · BRASS 1', values: [.18, .26, .62, .42, .72, .68] },
    { id: 'rom-epiano1', label: 'ROM 1 · E.PIANO 1', values: [.42, .48, .38, .66, .84, .72] },
    { id: 'rom-bass1', label: 'ROM 1 · BASS 1', values: [.12, .34, .72, .22, .68, .38] },
    { id: 'rom-marimba', label: 'ROM 1 · MARIMBA', values: [.64, .58, .34, .18, .78, .82] },
  ],
  'ms-20': [
    { id: 'panel-init', label: 'Panel · Init', values: [.55, .08, .46, .42, .38, .16] },
    { id: 'panel-bass', label: 'Panel · Screaming Bass', values: [.68, .18, .34, .82, .52, .42] },
    { id: 'panel-lead', label: 'Panel · Razor Lead', values: [.48, .04, .62, .72, .66, .54] },
    { id: 'panel-drum', label: 'Panel · Filter Drum', values: [.16, .72, .21, .91, .18, .36] },
  ],
  'polysix': [
    { id: 'factory-11', label: 'Original · Program 11', values: [.58, .38, .44, .54, .72, .18] },
    { id: 'factory-19', label: 'Original 19 · Strings', values: [.72, .34, .28, .79, .92, .38] },
    { id: 'factory-25', label: 'Original · Program 25', values: [.36, .61, .52, .44, .76, .68] },
    { id: 'factory-31', label: 'Original · Program 31', values: [.64, .72, .34, .26, .48, .82] },
  ],
  'ob-xa': [
    { id: 'factory-a1', label: 'Factory · A1', values: [.56, .62, .42, .68, .64, .72] },
    { id: 'factory-b3', label: 'Factory · B3', values: [.74, .48, .24, .56, .38, .86] },
    { id: 'factory-c5', label: 'Factory · C5', values: [.34, .72, .58, .78, .42, .62] },
    { id: 'factory-d7', label: 'Factory · D7', values: [.68, .36, .31, .42, .72, .44] },
  ],
  'fairlight': [
    { id: 'library-arr1', label: 'CMI Library · ARR1', values: [.32, .08, .5, .72, .64, .46] },
    { id: 'library-orch5', label: 'CMI Library · ORCH5', values: [.68, .18, .47, .76, .58, .72] },
    { id: 'library-sararr', label: 'CMI Library · SARARR', values: [.54, .22, .56, .81, .72, .84] },
    { id: 'library-vox', label: 'CMI Library · VOX', values: [.76, .12, .52, .88, .66, .62] },
  ],
  'ppg-wave': [
    { id: 'factory-11', label: 'Factory · 1.1', values: [.18, .34, .62, .54, .48, .72] },
    { id: 'factory-24', label: 'Factory · 2.4', values: [.64, .78, .38, .66, .52, .84] },
    { id: 'factory-37', label: 'Factory · 3.7', values: [.82, .42, .72, .36, .68, .58] },
    { id: 'factory-58', label: 'Factory · 5.8', values: [.44, .61, .28, .82, .34, .76] },
  ],
  'cz-101': [
    { id: 'factory-a1', label: 'Factory · A-1', values: [.22, .58, .48, .52, .18, .32] },
    { id: 'factory-a4', label: 'Factory · A-4', values: [.72, .34, .62, .38, .66, .52] },
    { id: 'factory-b2', label: 'Factory · B-2', values: [.48, .76, .28, .68, .42, .74] },
    { id: 'factory-b7', label: 'Factory · B-7', values: [.84, .42, .72, .24, .78, .46] },
  ],
  'calcotone': [
    { id: 'dream-circuit', label: 'CALCOTONE · Dream Circuit', values: [.58, .46, .26, .54, .22, .08] },
    { id: 'glass-engine', label: 'CALCOTONE · Glass Engine', values: [.76, .68, .24, .82, .36, .78] },
    { id: 'rusted-orbit', label: 'CALCOTONE · Rusted Orbit', values: [.34, .28, .72, .44, .81, .62] },
    { id: 'neon-memory', label: 'CALCOTONE · Neon Memory', values: [.62, .78, .38, .68, .54, .86] },
  ],
};

const PITCHES = ['B4', 'A#4', 'A4', 'G#4', 'G4', 'F#4', 'F4', 'E4', 'D#4', 'D4', 'C#4', 'C4'] as const;
const INITIAL_PATTERNS: number[][] = [
  [9, -1, 9, -1, 7, -1, 9, -1, 4, -1, 7, -1, 9, 7, 4, -1],
  [9, 9, -1, 7, 4, -1, 7, -1, 2, -1, 4, -1, 7, 4, 2, -1],
  [9, -1, 4, -1, 7, -1, 2, -1, 9, -1, 7, 4, 2, -1, 4, -1],
  [4, -1, 7, -1, 9, -1, 7, -1, 2, 4, -1, 7, 9, -1, 4, -1],
];

type SynthModuleProps = RailInteractionProps & {
  engineRunning: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onMachineChange: (machine: SynthMachine) => void;
  onParametersChange: (values: readonly number[]) => void;
  onTriggerNote: (midi: number, durationSeconds: number) => void;
};

function SynthModule({
  engineRunning,
  onEnabledChange,
  onMachineChange,
  onParametersChange,
  onTriggerNote,
  ...props
}: SynthModuleProps) {
  const [enabled, setEnabled] = useState(false);
  const [machine, setMachine] = useState<SynthMachine>('model-d');
  const [values, setValues] = useState([0.58, 0.46, 0.26, 0.54, 0.22, 0.08]);
  const [presetId, setPresetId] = useState('panel-init');
  const [patterns, setPatterns] = useState<number[][]>(() => INITIAL_PATTERNS.map((pattern) => [...pattern]));
  const [patternIndex, setPatternIndex] = useState(0);
  const [chain, setChain] = useState([0, 1, 2, 3]);
  const [chainArmed, setChainArmed] = useState(false);
  const [chainPosition, setChainPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const patternsRef = useRef(patterns);
  const patternIndexRef = useRef(patternIndex);
  const chainRef = useRef(chain);
  const chainArmedRef = useRef(chainArmed);
  const chainPositionRef = useRef(chainPosition);

  const definition = SYNTH_MACHINES.find((candidate) => candidate.id === machine) ?? SYNTH_MACHINES[0];
  const machinePresets = SYNTH_PRESETS[machine];
  const notes = patterns[patternIndex] ?? patterns[0];

  useEffect(() => { patternsRef.current = patterns; }, [patterns]);
  useEffect(() => { patternIndexRef.current = patternIndex; }, [patternIndex]);
  useEffect(() => { chainRef.current = chain; }, [chain]);
  useEffect(() => { chainArmedRef.current = chainArmed; }, [chainArmed]);
  useEffect(() => { chainPositionRef.current = chainPosition; }, [chainPosition]);

  useEffect(() => {
    onEnabledChange(enabled);
  }, [enabled, engineRunning, onEnabledChange]);

  useEffect(() => {
    onMachineChange(machine);
  }, [machine, engineRunning, onMachineChange]);

  useEffect(() => {
    onParametersChange(values);
  }, [values, engineRunning, onParametersChange]);

  useEffect(() => {
    if (!playing || !enabled) return;
    const playStep = (pattern: readonly number[], step: number) => {
      const pitch = pattern[step];
      if (pitch >= 0) onTriggerNote(71 - pitch, .11);
    };
    playStep(patternsRef.current[patternIndexRef.current], playhead);
    const timer = window.setInterval(() => {
      setPlayhead((current) => {
        const next = (current + 1) % 16;
        let nextPattern = patternIndexRef.current;
        if (next === 0 && chainArmedRef.current && chainRef.current.length > 0) {
          const nextChainPosition = (chainPositionRef.current + 1) % chainRef.current.length;
          nextPattern = chainRef.current[nextChainPosition];
          chainPositionRef.current = nextChainPosition;
          patternIndexRef.current = nextPattern;
          setChainPosition(nextChainPosition);
          setPatternIndex(nextPattern);
        }
        playStep(patternsRef.current[nextPattern], next);
        return next;
      });
    }, 150);
    return () => window.clearInterval(timer);
  }, [playing, enabled, engineRunning, onTriggerNote]);

  function toggleCell(step: number, pitch: number): void {
    setPatterns((current) => current.map((pattern, index) => {
      if (index !== patternIndex) return pattern;
      const next = [...pattern];
      next[step] = next[step] === pitch ? -1 : pitch;
      return next;
    }));
    if (enabled) onTriggerNote(71 - pitch, .11);
  }

  function selectPattern(index: number): void {
    patternIndexRef.current = index;
    setPatternIndex(index);
    setPlayhead(0);
    if (chainArmed) {
      setChain((current) => {
        const next = [...current, index].slice(-8);
        chainRef.current = next;
        return next;
      });
    }
  }

  function selectMachine(nextMachine: SynthMachine): void {
    const nextPreset = SYNTH_PRESETS[nextMachine][0];
    setMachine(nextMachine);
    setPresetId(nextPreset.id);
    setValues([...nextPreset.values]);
  }

  function selectPreset(nextPresetId: string): void {
    const nextPreset = machinePresets.find((preset) => preset.id === nextPresetId);
    if (!nextPreset) return;
    setPresetId(nextPreset.id);
    setValues([...nextPreset.values]);
  }

  return (
    <RailModuleFrame
      {...props}
      id="synth"
      name="Synth"
      enabled={enabled}
      onToggle={() => setEnabled((current) => !current)}
      headerControl={(
        <div className="synth-selector-pair">
          <label className="algorithm-selector synth-machine-selector">
            <span className="sr-only">Synth machine</span>
            <select aria-label="Synth machine" value={machine} onChange={(event) => selectMachine(event.target.value as SynthMachine)}>
              {SYNTH_MACHINES.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
            </select>
          </label>
          <label className="algorithm-selector synth-preset-selector">
            <span className="sr-only">Synth hardware preset</span>
            <select aria-label="Synth hardware preset" value={presetId} onChange={(event) => selectPreset(event.target.value)}>
              {presetId === 'custom' && <option value="custom">CUSTOM PANEL</option>}
              {machinePresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
            </select>
          </label>
        </div>
      )}
    >
      <div className={`synth-roll dsp-viewport ${enabled ? 'active' : 'is-off'}`}>
        <div className="synth-roll-toolbar">
          <div>
            <strong>16-STEP PIANO ROLL</strong>
            <span>P{String(patternIndex + 1).padStart(2, '0')} · 100 BPM · 1/16</span>
          </div>
          <span className={`synth-engine-badge ${engineRunning ? 'online' : ''}`}>
            {engineRunning ? 'DSP ONLINE' : 'START ENGINE'}
          </span>
          <button type="button" className={playing ? 'active' : ''} aria-pressed={playing} onClick={() => setPlaying((current) => !current)}>
            {playing ? 'STOP' : 'PLAY'}
          </button>
        </div>
        <div className="piano-roll-grid" role="grid" aria-label="16-step piano roll">
          <div className="piano-roll-corner" aria-hidden="true">NOTE</div>
          <div className="piano-roll-step-numbers" aria-hidden="true">
            {Array.from({ length: 16 }, (_, step) => (
              <span key={step} className={playhead === step && playing ? 'playhead' : ''}>{step + 1}</span>
            ))}
          </div>
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
          <strong>
            {chain.map((index, position) => `${position === chainPosition && chainArmed ? '[' : ''}${index + 1}${position === chainPosition && chainArmed ? ']' : ''}`).join(' › ')}
          </strong>
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
            onChange={(value) => {
              setPresetId('custom');
              setValues((current) => current.map((item, valueIndex) => valueIndex === index ? value : item));
            }}
            onReset={() => {
              setPresetId('custom');
              setValues((current) => current.map((item, valueIndex) => valueIndex === index ? 0.5 : item));
            }}
            onPatchStart={() => undefined}
            onPatchMove={() => undefined}
            onPatchEnd={() => undefined}
            onPatchDisconnect={() => undefined}
          />
        ))}
      </div>
      <div className="prototype-status">INTERNAL INSTRUMENT · ROUTED THROUGH CORE EFFECTS</div>
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
  onSynthEnabledChange,
  onSynthMachineChange,
  onSynthParametersChange,
  onSynthTriggerNote,
  ...interaction
}: RailInteractionProps & {
  moduleId: string;
  modules: ModuleState[];
  assignments: XYAssignment[];
  motionPadProps: MotionPadProps;
  visualState: VisualAudioState;
  running: boolean;
  onSynthEnabledChange: (enabled: boolean) => void;
  onSynthMachineChange: (machine: SynthMachine) => void;
  onSynthParametersChange: (values: readonly number[]) => void;
  onSynthTriggerNote: (midi: number, durationSeconds: number) => void;
}) {
  void modules;
  void assignments;
  if (moduleId === 'synth') {
    return (
      <SynthModule
        {...interaction}
        engineRunning={running}
        onEnabledChange={onSynthEnabledChange}
        onMachineChange={onSynthMachineChange}
        onParametersChange={onSynthParametersChange}
        onTriggerNote={onSynthTriggerNote}
      />
    );
  }
  if (moduleId === 'chaos') return <ChaosModule {...interaction} motionPadProps={motionPadProps} />;
  if (moduleId === 'pressure') return <PressureModule {...interaction} running={running} visualState={visualState} />;
  return null;
}
