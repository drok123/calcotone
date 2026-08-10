import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { VisualAudioState } from '../../visual/VisualEngine';
import type { ModuleState } from '../../ui/types';
import { Knob } from '../controls/Knob';
import {
  SIGNAL_LAB_LABELS,
  SIGNAL_LAB_MODES,
  SIGNAL_LAB_STYLES,
  type SignalLabMode,
  type SignalLabStyle,
} from '../../audio/SignalLab';
import {
  STACK_AMP_MODELS,
  STACK_CABINETS,
  STACK_INPUT_SOURCES,
  type StackAmpModel,
  type StackCabinet,
  type StackInputSource,
} from '../../audio/effects/StackAmp';
import {
  RANDOM_MUTATION_AMOUNT,
  type RandomizationProfile,
} from '../../features/random/randomProfiles';
import {
  randomizePressure,
  setPressureState,
  usePressureState,
} from '../signal/pressureStore';
import {
  registerRailCRandomController,
  type RailCRandomModuleId,
} from '../../features/random/railCRandomRegistry';
import {
  beginFaceplateGesture,
  endFaceplateGesture,
  setFaceplateGuides,
  setRailCFaceplateControl,
  setRailCFaceplateViewportHeight,
  snapRailCFaceplatePoint,
  useFaceplateLayoutEditor,
  type RailCFaceplateId,
} from '../../ui/faceplateLayout';
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

function useRailCRandomController(
  moduleId: RailCRandomModuleId,
  enabled: boolean,
  randomize: (profile: RandomizationProfile) => string | null
): void {
  const enabledRef = useRef(enabled);
  const randomizeRef = useRef(randomize);
  enabledRef.current = enabled;
  randomizeRef.current = randomize;

  useEffect(
    () => registerRailCRandomController(moduleId, {
      isEnabled: () => enabledRef.current,
      randomize: (profile) => randomizeRef.current(profile),
    }),
    [moduleId]
  );
}

function centeredRandom(minimum: number, maximum: number): number {
  const centerBiased = (Math.random() + Math.random()) * 0.5;
  return minimum + (maximum - minimum) * centerBiased;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5));
}

type MusicalRange = readonly [number, number];

type FrameProps = RailInteractionProps & {
  id: string;
  name: string;
  enabled: boolean;
  onToggle: () => void;
  headerControl: ReactNode;
  titleAccessory?: ReactNode;
  overlayActive?: boolean;
  children: ReactNode;
};

function RailModuleFrame({
  id,
  name,
  enabled,
  onToggle,
  headerControl,
  titleAccessory,
  overlayActive = false,
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
  const faceplateEditor = useFaceplateLayoutEditor();
  return (
    <article
      className={`effect-module rail-c-module module-${id} ${enabled ? 'enabled' : ''} ${overlayActive ? 'module-overlay-active' : ''} ${routingDragging ? 'routing-dragging' : ''} ${routingDropTarget ? 'routing-drop-target' : ''} ${faceplateEditor.layout.custom ? 'faceplate-layout-custom' : ''} ${faceplateEditor.editing ? 'faceplate-layout-editing' : ''}`}
      style={{ '--module-activity': enabled ? 1 : 0 } as CSSProperties}
      onDragOver={onRoutingDragOver}
      onDrop={onRoutingDrop}
    >
      <header className="module-header">
        <div
          className="module-title module-drag-handle"
          draggable={!faceplateEditor.editing}
          role="button"
          tabIndex={faceplateEditor.editing ? -1 : 0}
          aria-label={`${name}, signal slot ${slotLabel}. Drag to reorder or exchange rack rails; use left and right arrow keys within this rail.`}
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
          title="Drag to any rack slot · or focus and use ← / → within this rail"
        >
          <span className="module-number" aria-hidden="true">{slotLabel}</span>
          <span className="module-jewel" aria-hidden="true" />
          <h3>{name}</h3>
          {titleAccessory}
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

function RailCFaceplateSurface({
  moduleId,
  viewport,
  knobs,
  buttons = [],
  knobRowClass,
}: {
  moduleId: RailCFaceplateId;
  viewport: ReactNode;
  knobs: ReactNode[];
  buttons?: ReactNode[];
  knobRowClass: string;
}) {
  const editor = useFaceplateLayoutEditor();
  const layout = editor.layout.railC[moduleId];

  function beginControlDrag(
    kind: 'knob' | 'button',
    index: number,
    event: ReactPointerEvent<HTMLDivElement>
  ): void {
    if (!editor.editing || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const surface = event.currentTarget.closest<HTMLElement>('.rail-c-faceplate-stage');
    if (!surface) return;
    const pointerId = event.pointerId;
    const bounds = surface.getBoundingClientRect();
    const scale = bounds.width / Math.max(1, surface.offsetWidth);
    beginFaceplateGesture();
    document.body.classList.add('faceplate-layout-dragging');

    const move = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== pointerId) return;
      pointerEvent.preventDefault();
      const raw = {
        x: (pointerEvent.clientX - bounds.left) / Math.max(1, bounds.width),
        y: (pointerEvent.clientY - bounds.top) / Math.max(.01, scale),
      };
      const snapped = snapRailCFaceplatePoint(
        moduleId,
        kind,
        index,
        raw,
        surface.offsetWidth,
        pointerEvent.altKey
      );
      setRailCFaceplateControl(moduleId, kind, index, snapped.point);
      setFaceplateGuides(snapped.guides);
    };

    const finish = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== pointerId) return;
      pointerEvent.preventDefault();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.classList.remove('faceplate-layout-dragging');
      setFaceplateGuides({ x: null, y: null });
      endFaceplateGesture();
    };

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish, { passive: false });
    window.addEventListener('pointercancel', finish, { passive: false });
  }

  function beginViewportResize(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (!editor.editing || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const shell = event.currentTarget.parentElement;
    if (!shell) return;
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const startHeight = layout.viewportHeight;
    const bounds = shell.getBoundingClientRect();
    const scale = bounds.height / Math.max(1, shell.offsetHeight);
    beginFaceplateGesture();
    document.body.classList.add('faceplate-layout-resizing');

    const move = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== pointerId) return;
      pointerEvent.preventDefault();
      let height = startHeight + (pointerEvent.clientY - startY) / Math.max(.01, scale);
      if (editor.snapEnabled && !pointerEvent.altKey) {
        height = Math.round(height / editor.layout.snap) * editor.layout.snap;
      }
      setRailCFaceplateViewportHeight(moduleId, height);
    };

    const finish = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== pointerId) return;
      pointerEvent.preventDefault();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.classList.remove('faceplate-layout-resizing');
      endFaceplateGesture();
    };

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish, { passive: false });
    window.addEventListener('pointercancel', finish, { passive: false });
  }

  return (
    <div className="faceplate-layout-stage rail-c-faceplate-stage" style={{ height: `${layout.stageHeight}px` }}>
      <div className={`faceplate-viewport-shell ${editor.editing ? 'is-editing' : ''}`} style={{ height: `${layout.viewportHeight}px` }}>
        {viewport}
        {editor.editing && (
          <button
            type="button"
            className="faceplate-viewport-resize"
            onPointerDown={beginViewportResize}
            aria-label={`Resize ${moduleId} window`}
            title="Drag the screen edge · hold Alt to bypass snapping"
          >
            <span aria-hidden="true" />
          </button>
        )}
      </div>
      <div className={`knob-row faceplate-control-surface rail-c-control-surface ${knobRowClass} ${editor.editing ? 'is-editing' : ''}`} style={{ top: 0, height: `${layout.stageHeight}px` }}>
        {editor.editing && editor.guides.x !== null && (
          <span className="faceplate-guide faceplate-guide-x" style={{ left: `${editor.guides.x * 100}%` }} aria-hidden="true" />
        )}
        {editor.editing && editor.guides.y !== null && (
          <span className="faceplate-guide faceplate-guide-y" style={{ top: `${editor.guides.y}px` }} aria-hidden="true" />
        )}
        {knobs.map((knob, index) => {
          const point = layout.knobs[index];
          return (
            <div
              key={`knob-${index}`}
              className="faceplate-knob-slot"
              style={{ '--faceplate-x': `${point.x * 100}%`, '--faceplate-y': `${point.y}px` } as CSSProperties}
              onPointerDownCapture={editor.editing ? (event) => beginControlDrag('knob', index, event) : undefined}
              title={editor.editing ? `Move ${moduleId} control independently` : undefined}
            >
              {knob}
            </div>
          );
        })}
      </div>
      {buttons.length > 0 && (
        <div className="pressure-style-strip rail-c-button-surface" role="group" aria-label="Pressure operating style">
          {buttons.map((button, index) => {
            const point = layout.buttons[index];
            return (
              <div
                key={`button-${index}`}
                className="faceplate-pressure-slot"
                style={{ '--faceplate-x': `${point.x * 100}%`, '--faceplate-y': `${point.y}px` } as CSSProperties}
                onPointerDownCapture={editor.editing ? (event) => beginControlDrag('button', index, event) : undefined}
                title={editor.editing ? 'Move Pressure style button independently' : undefined}
              >
                {button}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const STOMP_MODE_LABELS = [
  '808 Overdrive', 'RAT Distortion', 'Big Muff', 'Fuzz Face', 'DS-1 Distortion',
  'Blues Driver', 'Gold Horse', 'Swedish Chainsaw', 'Metal Zone', 'Octavia',
  'Rangemaster', 'Cry Baby Wah', 'Whammy Octave', 'Dyna Comp',
] as const;

const STOMP_CONTROL_LABELS: readonly (readonly string[])[] = [
  ['Drive','Tone','Level','Diodes','Body','Mix'], ['Distort','Filter','Level','Slew','Body','Mix'],
  ['Sustain','Tone','Volume','Stages','Body','Mix'], ['Fuzz','Tone','Volume','Bias','Body','Mix'],
  ['Distort','Tone','Level','Diodes','Body','Mix'], ['Gain','Tone','Level','Touch','Body','Mix'],
  ['Gain','Treble','Output','Blend','Body','Mix'], ['Distort','High','Level','Chains','Low','Mix'],
  ['Distort','High','Level','Contour','Low','Mix'], ['Fuzz','Tone','Level','Octave','Body','Mix'],
  ['Boost','Tone','Level','Bias','Body','Mix'], ['Sweep','Tone','Level','Envelope','Q','Mix'],
  ['Drive','Tone','Level','Octave','Body','Mix'], ['Sustain','Tone','Output','Attack','Release','Mix'],
];

type StompPreset = { id: string; label: string; values: readonly number[] };
const STOMP_PRESETS: readonly StompPreset[][] = STOMP_MODE_LABELS.map((label, mode) => [
  { id: 'classic', label: `${label} · Classic`, values: mode === 13 ? [.48,.52,.62,.28,.58,1] : [.38,.54,.68,.42,.52,1] },
  { id: 'pushed', label: `${label} · Pushed`, values: mode === 11 ? [.62,.48,.72,.78,.68,.9] : [.72,.48,.62,.66,.58,.88] },
  { id: 'subtle', label: `${label} · Edge`, values: [.22,.62,.72,.28,.46,.46] },
]);

const STOMP_RACK_STATE = { enabled: false, mode: 0, inputSource: 'input-2' as StackInputSource, presetId: 'classic', values: [.38,.54,.68,.42,.52,1] };

type StompModuleProps = RailInteractionProps & {
  engineRunning: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onModeChange: (mode: number) => void;
  onInputSourceChange: (source: StackInputSource) => void;
  onParametersChange: (values: readonly number[]) => void;
};

function StompModule({ engineRunning, onEnabledChange, onModeChange, onInputSourceChange, onParametersChange, ...props }: StompModuleProps) {
  const [enabled, setEnabled] = useState(STOMP_RACK_STATE.enabled);
  const [mode, setMode] = useState(STOMP_RACK_STATE.mode);
  const [presetId, setPresetId] = useState(STOMP_RACK_STATE.presetId);
  const [inputSource, setInputSource] = useState(STOMP_RACK_STATE.inputSource);
  const [values, setValues] = useState(() => [...STOMP_RACK_STATE.values]);
  STOMP_RACK_STATE.enabled=enabled; STOMP_RACK_STATE.mode=mode; STOMP_RACK_STATE.inputSource=inputSource; STOMP_RACK_STATE.presetId=presetId; STOMP_RACK_STATE.values=values;

  useEffect(() => { onEnabledChange(enabled); }, [enabled, engineRunning, onEnabledChange]);
  useEffect(() => { onModeChange(mode); }, [mode, engineRunning, onModeChange]);
  useEffect(() => { onInputSourceChange(inputSource); }, [inputSource, engineRunning, onInputSourceChange]);
  useEffect(() => { onParametersChange(values); }, [values, engineRunning, onParametersChange]);

  function selectMode(next: number): void {
    const safe = Math.max(0, Math.min(STOMP_MODE_LABELS.length - 1, next));
    const preset = STOMP_PRESETS[safe]![0]!;
    setMode(safe); setPresetId(preset.id); setValues([...preset.values]);
  }
  function selectPreset(id: string): void {
    const preset = STOMP_PRESETS[mode]?.find((candidate) => candidate.id === id);
    if (!preset) return; setPresetId(id); setValues([...preset.values]);
  }
  function randomizeStomp(profile: RandomizationProfile): string | null {
    const pool = profile === 'bass' ? [0,2,3,6,10,13] : profile === 'pad' || profile === 'retro-ambient' ? [5,6,9,11,12,13] : profile === 'lead' ? [0,1,4,5,6,9,12] : [0,1,2,3,4,5,6,7,8,9,10,11,12,13];
    const nextMode = profile === 'mutate' ? mode : pool[Math.floor(Math.random()*pool.length)]!;
    const amount = profile === 'mutate' ? RANDOM_MUTATION_AMOUNT : 1;
    const next = values.map((value, index) => {
      const ranges: readonly MusicalRange[] = [[.16,.76],[.24,.78],[.48,.78],[.18,.72],[.28,.74],[.42,1]];
      const [low, high] = ranges[index]!;
      const target = centeredRandom(low, high);
      return clamp01(value + (target - value) * amount);
    });
    setMode(nextMode); setPresetId('custom'); setValues(next);
    return `${STOMP_MODE_LABELS[nextMode]} · ${profile === 'mutate' ? 'mutated' : 'pedal roll'}`;
  }
  useRailCRandomController('stomp', enabled, randomizeStomp);

  const controls = STOMP_CONTROL_LABELS[mode] ?? STOMP_CONTROL_LABELS[0]!;
  return (
    <RailModuleFrame
      {...props}
      id="stomp"
      name="Stomp"
      enabled={enabled}
      onToggle={() => setEnabled((current) => !current)}
      headerControl={
        <div className="chaos-selector-pair stomp-selector-pair">
          <label className="algorithm-selector chaos-mode-selector"><span className="sr-only">Stomp pedal</span>
            <select aria-label="Stomp pedal" value={mode} onChange={(event) => selectMode(Number(event.target.value))}>
              {STOMP_MODE_LABELS.map((label,index)=><option key={label} value={index}>{label}</option>)}
            </select>
          </label>
          <label className="algorithm-selector chaos-program-selector"><span className="sr-only">Stomp preset</span>
            <select aria-label="Stomp preset" value={presetId} onChange={(event)=>selectPreset(event.target.value)}>
              {presetId==='custom'&&<option value="custom">Custom</option>}
              {STOMP_PRESETS[mode]!.map((preset)=><option key={preset.id} value={preset.id}>{preset.label}</option>)}
            </select>
          </label>
          <label className="algorithm-selector chaos-input-selector"><span className="sr-only">Stomp input</span>
            <select aria-label="Stomp input" value={inputSource} onChange={(event)=>setInputSource(event.target.value as StackInputSource)}>
              {STACK_INPUT_SOURCES.map((source)=><option key={source} value={source}>{STACK_INPUT_LABELS[source]}</option>)}
            </select>
          </label>
        </div>
      }
    >
      <RailCFaceplateSurface
        moduleId="stomp"
        knobRowClass="synth-knob-row stomp-knob-row"
        viewport={<div className={`stomp-display dsp-viewport ${enabled?'active':'is-off'}`}><span className="stomp-led"/><strong>STOMP</strong><small>{STOMP_MODE_LABELS[mode]}</small><div className="stomp-circuit-lines" aria-hidden="true"/></div>}
        knobs={controls.map((label,index)=><Knob key={`${mode}-${label}`} label={label} value={values[index]!} display={`${Math.round(values[index]!*100)}%`} onChange={(value)=>{setPresetId('custom');setValues((current)=>current.map((item,i)=>i===index?value:item));}} onReset={()=>{setPresetId('custom');setValues((current)=>current.map((item,i)=>i===index?0.5:item));}}/>) }
      />
    </RailModuleFrame>
  );
}

const CHAOS_RACK_STATE = {
  enabled: true,
  model: 'calcotone' as StackAmpModel,
  cabinet: '4x12' as StackCabinet,
  inputSource: 'input-2' as StackInputSource,
  values: [0.36, 0.52, 0.34, 0.62],
};

const STACK_MODEL_LABELS: Record<StackAmpModel, string> = {
  blackface: 'Blackface', ac30: 'Vox AC30', plexi: 'Marshall Plexi',
  svt: 'Ampeg SVT', 'model-t': 'Sunn Model T', calcotone: 'CALCOTONE Hybrid',
};

const STACK_CABINET_LABELS: Record<StackCabinet, string> = {
  '1x12': '1×12 Open', '2x12': '2×12 Blue', '4x12': '4×12 Green',
  '8x10': '8×10 Bass', direct: 'Direct / No Cab',
};

const STACK_INPUT_LABELS: Record<StackInputSource, string> = {
  'input-1': 'Input 1 · Tablet',
  'input-2': 'Input 2 · Guitar',
  both: 'Both Inputs',
};

function StackTuner({ frequency, level }: { frequency: number; level: number }) {
  const active = Number.isFinite(frequency) && frequency >= 38 && frequency <= 1_400 && level >= .0025;
  if (!active) return <span className="stack-tuner is-idle" aria-label="Guitar tuner waiting for signal"><b>--</b><i>TUNER</i></span>;
  const midiFloat = 69 + 12 * Math.log2(frequency / 440);
  const midi = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midi) * 100);
  const notes = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
  const note = `${notes[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  const inTune = Math.abs(cents) <= 4;
  return (
    <span className={`stack-tuner ${inTune ? 'is-tuned' : cents < 0 ? 'is-flat' : 'is-sharp'}`} aria-label={`${note}, ${Math.abs(cents)} cents ${cents < 0 ? 'flat' : cents > 0 ? 'sharp' : 'in tune'}`} title={`${frequency.toFixed(1)} Hz`}>
      <b>{note}</b><i>{cents > 0 ? '+' : ''}{cents}¢</i>
    </span>
  );
}

function ChaosModule({
  running,
  visualState,
  onEnabledChange,
  onModelChange,
  onCabinetChange,
  onInputSourceChange,
  onParametersChange,
  nativeBackendActive,
  tunerHz,
  tunerLevel,
  ...props
}: RailInteractionProps & {
  running: boolean;
  visualState: VisualAudioState;
  onEnabledChange: (enabled: boolean) => void;
  onModelChange: (model: StackAmpModel) => void;
  onCabinetChange: (cabinet: StackCabinet) => void;
  onInputSourceChange: (source: StackInputSource) => void;
  onParametersChange: (values: readonly number[]) => void;
  nativeBackendActive: boolean;
  tunerHz: number;
  tunerLevel: number;
}) {
  const [enabled, setEnabled] = useState(CHAOS_RACK_STATE.enabled);
  const [model, setModel] = useState<StackAmpModel>(CHAOS_RACK_STATE.model);
  const [cabinet, setCabinet] = useState<StackCabinet>(CHAOS_RACK_STATE.cabinet);
  const [inputSource, setInputSource] = useState<StackInputSource>(CHAOS_RACK_STATE.inputSource);
  const [values, setValues] = useState(() => [...CHAOS_RACK_STATE.values]);
  CHAOS_RACK_STATE.enabled = enabled;
  CHAOS_RACK_STATE.model = model;
  CHAOS_RACK_STATE.cabinet = cabinet;
  CHAOS_RACK_STATE.inputSource = inputSource;
  CHAOS_RACK_STATE.values = values;
  const labels = ['Gain', 'Tone', 'Sag', 'Mix'];

  useEffect(() => {
    if (!running) return;
    onEnabledChange(enabled);
    onModelChange(model);
    onCabinetChange(cabinet);
    onInputSourceChange(inputSource);
    onParametersChange(values);
  }, [cabinet, enabled, inputSource, model, onCabinetChange, onEnabledChange, onInputSourceChange, onModelChange, onParametersChange, running, values]);

  function randomizeChaos(profile: RandomizationProfile): string | null {
    if (profile === 'mutate') {
      setValues((current) => current.map((value) => clamp01(
        value + (Math.random() * 2 - 1) * RANDOM_MUTATION_AMOUNT
      )));
      return 'Mutate 10% · current STACK';
    }
    const modelPool: readonly StackAmpModel[] = profile === 'bass' ? ['svt', 'model-t']
      : profile === 'lead' || profile === 'gritty-drive' ? ['plexi', 'model-t', 'calcotone']
      : profile === 'pad' || profile === 'retro-ambient' ? ['blackface', 'ac30', 'calcotone']
      : STACK_AMP_MODELS;
    const nextModel = modelPool[Math.floor(Math.random() * modelPool.length)] ?? 'calcotone';
    const cabinetPool: readonly StackCabinet[] = nextModel === 'svt' ? ['8x10', 'direct']
      : nextModel === 'blackface' ? ['1x12', '2x12']
      : nextModel === 'ac30' ? ['2x12', '1x12']
      : ['4x12', '2x12'];
    const nextCabinet = cabinetPool[Math.floor(Math.random() * cabinetPool.length)] ?? '4x12';
    setModel(nextModel);
    setCabinet(nextCabinet);
    const driveRange: MusicalRange = profile === 'gritty-drive' ? [0.52, 0.74] : profile === 'pad' ? [0.12, 0.32] : [0.24, 0.58];
    setValues([
      centeredRandom(...driveRange),
      centeredRandom(0.32, 0.72),
      centeredRandom(0.18, 0.62),
      centeredRandom(0.42, 0.72),
    ]);
    return `STACK · ${STACK_MODEL_LABELS[nextModel]} · ${STACK_CABINET_LABELS[nextCabinet]}`;
  }

  useRailCRandomController('chaos', enabled, randomizeChaos);

  return (
    <RailModuleFrame
      {...props}
      id="chaos"
      name="Stack"
      titleAccessory={<StackTuner frequency={tunerHz} level={tunerLevel} />}
      enabled={enabled}
      onToggle={() => setEnabled((current) => !current)}
      headerControl={(
        <div className="chaos-selector-pair">
          <label className="algorithm-selector chaos-mode-selector">
            <span className="sr-only">STACK amplifier</span>
            <select
              aria-label="STACK amplifier"
              value={model}
              onChange={(event) => setModel(event.target.value as StackAmpModel)}
            >
              {STACK_AMP_MODELS.map((candidate) => <option value={candidate} key={candidate}>{STACK_MODEL_LABELS[candidate]}</option>)}
            </select>
          </label>
          <label className="algorithm-selector chaos-program-selector">
            <span className="sr-only">STACK cabinet</span>
            <select aria-label="STACK cabinet" value={cabinet} onChange={(event) => setCabinet(event.target.value as StackCabinet)}>
              {STACK_CABINETS.map((candidate) => (
                <option value={candidate} key={candidate}>{STACK_CABINET_LABELS[candidate]}</option>
              ))}
            </select>
          </label>
          <label className="algorithm-selector chaos-input-selector" title={nativeBackendActive ? 'Choose which mono-to-stereo interface lane enters STACK' : 'Input assignment activates when the native WASAPI host is connected'}>
            <span className="sr-only">STACK input source</span>
            <select
              aria-label="STACK input source"
              value={inputSource}
              disabled={!nativeBackendActive}
              onChange={(event) => setInputSource(event.target.value as StackInputSource)}
            >
              {STACK_INPUT_SOURCES.map((candidate) => <option value={candidate} key={candidate}>{STACK_INPUT_LABELS[candidate]}</option>)}
            </select>
          </label>
        </div>
      )}
    >
      <RailCFaceplateSurface
        moduleId="chaos"
        knobRowClass="chaos-knob-row"
        viewport={(
          <div className={`chaos-pad-shell dsp-viewport ${enabled ? 'active' : 'is-off'}`}>
            <div className="stack-amp-readout" aria-hidden="true">
              <strong>{STACK_MODEL_LABELS[model]}</strong>
              <pre>{`┌─ PRE ─┬─ POWER ─┬─ ${cabinet.toUpperCase()} ─┐\n│  ▸▸▸  │  ≋ SAG  │  ◉  ◉  ◉  ◉ │\n└───────┴─────────┴────────────┘`}</pre>
              <i style={{ '--stack-level': `${Math.round((enabled ? visualState.level : 0) * 100)}%` } as CSSProperties} />
            </div>
          </div>
        )}
        knobs={labels.map((label, index) => (
          <Knob
            key={label}
            label={label}
            value={values[index]}
            display={`${Math.round(values[index] * 100)}%`}
            onChange={(value) => setValues((current) => current.map((item, valueIndex) => valueIndex === index ? value : item))}
            onReset={() => setValues((current) => current.map((item, valueIndex) => valueIndex === index ? [0.36, 0.52, 0.34, 0.62][index]! : item))}
          />
        ))}
      />
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
  const meter = Math.max(0, Math.round((state.enabled ? visualState.level : 0) * 18));
  const meterText = `${'█'.repeat(meter)}${'░'.repeat(18 - meter)}`;

  function randomizePressureProfile(profile: RandomizationProfile): string | null {
    if (profile !== 'mutate') return randomizePressure();
    setPressureState({
      drive: clamp01(state.drive + (Math.random() * 2 - 1) * RANDOM_MUTATION_AMOUNT),
      time: clamp01(state.time + (Math.random() * 2 - 1) * RANDOM_MUTATION_AMOUNT),
      character: clamp01(state.character + (Math.random() * 2 - 1) * RANDOM_MUTATION_AMOUNT),
      mix: Math.min(.82, clamp01(state.mix + (Math.random() * 2 - 1) * RANDOM_MUTATION_AMOUNT)),
    });
    return 'Mutate 10% · current dynamics profile';
  }

  useRailCRandomController('pressure', state.enabled, randomizePressureProfile);

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
      <RailCFaceplateSurface
        moduleId="pressure"
        knobRowClass="pressure-rail-knobs"
        viewport={(
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
        )}
        knobs={([
          ['Drive', 'drive'],
          ['Time', 'time'],
          ['Character', 'character'],
          ['Mix', 'mix'],
        ] as const).map(([label, key]) => (
          <Knob
            key={key}
            label={label}
            value={state[key]}
            display={`${Math.round(state[key] * 100)}%`}
            onChange={(value) => setPressureState({ [key]: value })}
            onReset={() => setPressureState({ [key]: key === 'mix' ? 0.72 : key === 'time' ? 0.46 : key === 'drive' ? 0.42 : 0.38 })}
          />
        ))}
        buttons={SIGNAL_LAB_STYLES.map((style) => (
          <button type="button" key={style} className={state.style === style ? 'active' : ''} aria-pressed={state.style === style} onClick={() => setPressureState({ style: style as SignalLabStyle })}>
            {style.toUpperCase()}
          </button>
        ))}
      />
    </RailModuleFrame>
  );
}

export function RailCModule({
  moduleId,
  modules,
  visualState,
  running,
  onStompEnabledChange,
  onStompModeChange,
  onStompInputSourceChange,
  onStompParametersChange,
  onStackEnabledChange,
  onStackModelChange,
  onStackCabinetChange,
  onStackInputSourceChange,
  onStackParametersChange,
  nativeBackendActive,
  tunerHz,
  tunerLevel,
  ...interaction
}: RailInteractionProps & {
  moduleId: string;
  modules: ModuleState[];
  visualState: VisualAudioState;
  running: boolean;
  onStompEnabledChange: (enabled: boolean) => void;
  onStompModeChange: (mode: number) => void;
  onStompInputSourceChange: (source: StackInputSource) => void;
  onStompParametersChange: (values: readonly number[]) => void;
  onStackEnabledChange: (enabled: boolean) => void;
  onStackModelChange: (model: StackAmpModel) => void;
  onStackCabinetChange: (cabinet: StackCabinet) => void;
  onStackInputSourceChange: (source: StackInputSource) => void;
  onStackParametersChange: (values: readonly number[]) => void;
  nativeBackendActive: boolean;
  tunerHz: number;
  tunerLevel: number;
}) {
  void modules;
  if (moduleId === 'stomp') {
    return <StompModule {...interaction} engineRunning={running} onEnabledChange={onStompEnabledChange} onModeChange={onStompModeChange} onInputSourceChange={onStompInputSourceChange} onParametersChange={onStompParametersChange} />;
  }
  if (moduleId === 'chaos') return (
    <ChaosModule
      {...interaction}
      running={running}
      visualState={visualState}
      onEnabledChange={onStackEnabledChange}
      onModelChange={onStackModelChange}
      onCabinetChange={onStackCabinetChange}
      onInputSourceChange={onStackInputSourceChange}
      onParametersChange={onStackParametersChange}
      nativeBackendActive={nativeBackendActive}
      tunerHz={tunerHz}
      tunerLevel={tunerLevel}
    />
  );
  if (moduleId === 'pressure') return <PressureModule {...interaction} running={running} visualState={visualState} />;
  return null;
}
