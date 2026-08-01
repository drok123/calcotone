import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
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
import type {
  SynthArchetype,
  SynthMachine,
  SynthSequencerNote,
  SynthSequencerState,
  SynthSequencerStep,
} from '../../audio/SynthEngine';
import {
  RANDOM_MORPH_SECONDS,
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
  overlayActive?: boolean;
  children: ReactNode;
};

function RailModuleFrame({
  id,
  name,
  enabled,
  onToggle,
  headerControl,
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
const SYNTH_TEMPOS = [30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 128, 130, 140, 150, 160, 174, 180] as const;
const INITIAL_PATTERN_PITCHES: number[][] = [
  [9, -1, 9, -1, 7, -1, 9, -1, 4, -1, 7, -1, 9, 7, 4, -1],
  [9, 9, -1, 7, 4, -1, 7, -1, 2, -1, 4, -1, 7, 4, 2, -1],
  [9, -1, 4, -1, 7, -1, 2, -1, 9, -1, 7, 4, 2, -1, 4, -1],
  [4, -1, 7, -1, 9, -1, 7, -1, 2, 4, -1, 7, 9, -1, 4, -1],
];
const INITIAL_PATTERNS: SynthSequencerNote[][][] = INITIAL_PATTERN_PITCHES.map((pattern) =>
  pattern.map((pitch) => pitch < 0 ? [] : [{ pitch, length: 1 }])
);

function cloneSynthPatterns(
  patterns: readonly (readonly (readonly SynthSequencerNote[])[])[]
): SynthSequencerNote[][][] {
  return patterns.map((pattern) =>
    pattern.map((notes) => notes.map((note) => ({ ...note })))
  );
}

// Rack exchanges move a module between separate rail containers, which remounts
// its React subtree. Keep performance state outside that subtree so moving the
// physical chassis never resets the panel or sequencer.
const SYNTH_RACK_STATE = {
  enabled: false,
  machine: 'model-d' as SynthMachine,
  values: [0.58, 0.46, 0.26, 0.54, 0.22, 0.08],
  presetId: 'panel-init',
  archetype: 'panel' as SynthArchetype,
  patterns: cloneSynthPatterns(INITIAL_PATTERNS),
  patternIndex: 0,
  chain: [0, 1, 2, 3],
  chainArmed: false,
  chainPosition: 0,
  bpm: 100,
  playing: false,
  playhead: 0,
};

type SynthModuleProps = RailInteractionProps & {
  engineRunning: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onMachineChange: (machine: SynthMachine) => void;
  onArchetypeChange: (archetype: SynthArchetype) => void;
  onParametersChange: (values: readonly number[], morphSeconds?: number) => void;
  onTriggerNote: (midi: number, durationSeconds: number) => void;
  onSequencerChange: (state: SynthSequencerState) => void;
  onSequencerStepListenerChange: (
    listener: ((position: SynthSequencerStep) => void) | null
  ) => void;
};

function SynthModule({
  engineRunning,
  onEnabledChange,
  onMachineChange,
  onArchetypeChange,
  onParametersChange,
  onTriggerNote,
  onSequencerChange,
  onSequencerStepListenerChange,
  ...props
}: SynthModuleProps) {
  const [enabled, setEnabled] = useState(SYNTH_RACK_STATE.enabled);
  const [machine, setMachine] = useState<SynthMachine>(SYNTH_RACK_STATE.machine);
  const [values, setValues] = useState(() => [...SYNTH_RACK_STATE.values]);
  const [presetId, setPresetId] = useState(SYNTH_RACK_STATE.presetId);
  const [archetype, setArchetype] = useState<SynthArchetype>(SYNTH_RACK_STATE.archetype);
  const [patterns, setPatterns] = useState<SynthSequencerNote[][][]>(() => cloneSynthPatterns(SYNTH_RACK_STATE.patterns));
  const [patternIndex, setPatternIndex] = useState(SYNTH_RACK_STATE.patternIndex);
  const [chain, setChain] = useState(() => [...SYNTH_RACK_STATE.chain]);
  const [chainArmed, setChainArmed] = useState(SYNTH_RACK_STATE.chainArmed);
  const [chainPosition, setChainPosition] = useState(SYNTH_RACK_STATE.chainPosition);
  const [bpm, setBpm] = useState(SYNTH_RACK_STATE.bpm);
  const [playing, setPlaying] = useState(SYNTH_RACK_STATE.playing);
  const [playhead, setPlayhead] = useState(SYNTH_RACK_STATE.playhead);
  const [sequencerExpanded, setSequencerExpanded] = useState(false);
  const patternsRef = useRef(patterns);
  const patternIndexRef = useRef(patternIndex);
  const chainRef = useRef(chain);
  const chainArmedRef = useRef(chainArmed);
  const chainPositionRef = useRef(chainPosition);
  const playheadRef = useRef(playhead);
  const noteLengthDragCleanupRef = useRef<(() => void) | null>(null);
  const parameterMorphSecondsRef = useRef(0.04);

  SYNTH_RACK_STATE.enabled = enabled;
  SYNTH_RACK_STATE.machine = machine;
  SYNTH_RACK_STATE.values = values;
  SYNTH_RACK_STATE.presetId = presetId;
  SYNTH_RACK_STATE.archetype = archetype;
  SYNTH_RACK_STATE.patterns = patterns;
  SYNTH_RACK_STATE.patternIndex = patternIndex;
  SYNTH_RACK_STATE.chain = chain;
  SYNTH_RACK_STATE.chainArmed = chainArmed;
  SYNTH_RACK_STATE.chainPosition = chainPosition;
  SYNTH_RACK_STATE.bpm = bpm;
  SYNTH_RACK_STATE.playing = playing;
  SYNTH_RACK_STATE.playhead = playhead;

  const definition = SYNTH_MACHINES.find((candidate) => candidate.id === machine) ?? SYNTH_MACHINES[0];
  const machinePresets = SYNTH_PRESETS[machine];
  const notes = patterns[patternIndex] ?? patterns[0];

  useEffect(() => { patternsRef.current = patterns; }, [patterns]);
  useEffect(() => { patternIndexRef.current = patternIndex; }, [patternIndex]);
  useEffect(() => { chainRef.current = chain; }, [chain]);
  useEffect(() => { chainArmedRef.current = chainArmed; }, [chainArmed]);
  useEffect(() => { chainPositionRef.current = chainPosition; }, [chainPosition]);
  useEffect(() => { playheadRef.current = playhead; }, [playhead]);
  useEffect(() => () => noteLengthDragCleanupRef.current?.(), []);
  useEffect(() => {
    if (!sequencerExpanded) return;
    const collapseOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setSequencerExpanded(false);
    };
    window.addEventListener('keydown', collapseOnEscape);
    return () => window.removeEventListener('keydown', collapseOnEscape);
  }, [sequencerExpanded]);

  useEffect(() => {
    onEnabledChange(enabled);
  }, [enabled, engineRunning, onEnabledChange]);

  useEffect(() => {
    onMachineChange(machine);
  }, [machine, engineRunning, onMachineChange]);

  useEffect(() => {
    onArchetypeChange(archetype);
  }, [archetype, engineRunning, onArchetypeChange]);

  useEffect(() => {
    onParametersChange(values, parameterMorphSecondsRef.current);
    parameterMorphSecondsRef.current = 0.04;
  }, [values, engineRunning, onParametersChange]);

  useEffect(() => {
    if (!engineRunning) return;
    onSequencerChange({
      patterns,
      patternIndex,
      chain,
      chainArmed,
      chainPosition,
      bpm,
      playing: playing && enabled,
      startStep: playheadRef.current,
    });
  }, [
    patterns,
    patternIndex,
    chain,
    chainArmed,
    chainPosition,
    bpm,
    playing,
    enabled,
    engineRunning,
    onSequencerChange,
  ]);

  useEffect(() => {
    if (!engineRunning) return;
    onSequencerStepListenerChange((position) => {
      playheadRef.current = position.step;
      setPlayhead(position.step);
      if (patternIndexRef.current !== position.patternIndex) {
        patternIndexRef.current = position.patternIndex;
        setPatternIndex(position.patternIndex);
      }
      if (chainPositionRef.current !== position.chainPosition) {
        chainPositionRef.current = position.chainPosition;
        setChainPosition(position.chainPosition);
      }
    });
    return () => onSequencerStepListenerChange(null);
  }, [engineRunning, onSequencerStepListenerChange]);

  function toggleCell(step: number, pitch: number): void {
    const adding = !(notes[step] ?? []).some((note) => note.pitch === pitch);
    setPatterns((current) => current.map((pattern, index) => {
      if (index !== patternIndex) return pattern;
      const next = [...pattern];
      const stepNotes = [...(next[step] ?? [])];
      const noteIndex = stepNotes.findIndex((note) => note.pitch === pitch);
      if (noteIndex >= 0) {
        stepNotes.splice(noteIndex, 1);
      } else {
        stepNotes.push({ pitch, length: 1 });
        stepNotes.sort((left, right) => left.pitch - right.pitch);
      }
      next[step] = stepNotes;
      return next;
    }));
    if (adding && enabled) onTriggerNote(71 - pitch, 60 / bpm / 4 * .92);
  }

  function setNoteLength(pattern: number, step: number, pitch: number, length: number): void {
    const nextLength = Math.min(16 - step, Math.max(1, Math.round(length)));
    setPatterns((current) => current.map((steps, index) => {
      if (index !== pattern) return steps;
      return steps.map((stepNotes, stepIndex) => {
        if (stepIndex !== step) return stepNotes;
        return stepNotes.map((note) =>
          note.pitch === pitch ? { ...note, length: nextLength } : note
        );
      });
    }));
  }

  function beginNoteLengthDrag(
    event: ReactPointerEvent<HTMLSpanElement>,
    step: number,
    pitch: number,
    length: number
  ): void {
    if (event.button !== 0) return;
    const row = event.currentTarget.closest<HTMLElement>('.piano-roll-row');
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    noteLengthDragCleanupRef.current?.();

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const stepWidth = row.getBoundingClientRect().width / 16;
    const activePattern = patternIndex;
    const move = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== pointerId) return;
      pointerEvent.preventDefault();
      const delta = Math.round((pointerEvent.clientX - startX) / Math.max(1, stepWidth));
      setNoteLength(activePattern, step, pitch, length + delta);
    };
    const finish = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== pointerId) return;
      cleanup();
    };
    const cleanup = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      noteLengthDragCleanupRef.current = null;
    };
    noteLengthDragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
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
    setArchetype('panel');
    parameterMorphSecondsRef.current = RANDOM_MORPH_SECONDS;
    setValues([...nextPreset.values]);
  }

  function selectPreset(nextPresetId: string): void {
    const nextPreset = machinePresets.find((preset) => preset.id === nextPresetId);
    if (!nextPreset) return;
    setPresetId(nextPreset.id);
    setArchetype('panel');
    parameterMorphSecondsRef.current = RANDOM_MORPH_SECONDS;
    setValues([...nextPreset.values]);
  }

  function randomizeSynth(profile: RandomizationProfile): string | null {
    if (profile === 'mutate') {
      parameterMorphSecondsRef.current = RANDOM_MORPH_SECONDS;
      setPresetId('custom');
      setValues((current) => current.map((value) => clamp01(
        value + (Math.random() * 2 - 1) * RANDOM_MUTATION_AMOUNT
      )));
      return 'Mutate 10% · anchored panel';
    }

    const requestedArchetype: SynthArchetype = profile === 'bass'
      ? 'bass'
      : profile === 'pad' || profile === 'retro-ambient'
        ? 'pad'
        : profile === 'lead' || profile === 'gritty-drive'
          ? 'lead'
          : 'panel';
    const pools: Record<Exclude<SynthArchetype, 'panel'>, readonly SynthMachine[]> = {
      bass: ['model-d', 'sh-101', 'dx7', 'ms-20', 'fairlight'],
      pad: ['juno-106', 'prophet-5', 'polysix', 'ob-xa', 'ppg-wave', 'calcotone'],
      lead: ['model-d', 'sh-101', 'prophet-5', 'dx7', 'ms-20', 'cz-101'],
    };

    if (requestedArchetype === 'panel' && profile === 'smart') {
      const nextMachine = SYNTH_MACHINES[Math.floor(Math.random() * SYNTH_MACHINES.length)];
      if (!nextMachine) return null;
      const presets = SYNTH_PRESETS[nextMachine.id];
      const nextPreset = presets[Math.floor(Math.random() * presets.length)];
      if (!nextPreset) return null;
      parameterMorphSecondsRef.current = RANDOM_MORPH_SECONDS;
      setMachine(nextMachine.id);
      setPresetId(nextPreset.id);
      setArchetype('panel');
      setValues([...nextPreset.values]);
      return `${nextMachine.label} · ${nextPreset.label} · 350 ms morph`;
    }

    const effectiveArchetype = requestedArchetype === 'panel'
      ? profile === 'lofi-tape' ? 'lead' : 'pad'
      : requestedArchetype;
    const machinePool = profile === 'lofi-tape'
      ? ['fairlight', 'juno-106', 'cz-101'] as const
      : pools[effectiveArchetype];
    const nextMachine = machinePool[Math.floor(Math.random() * machinePool.length)];
    if (!nextMachine) return null;
    const ranges: Record<Exclude<SynthArchetype, 'panel'>, readonly MusicalRange[]> = {
      bass: [[.24,.56],[.12,.38],[.10,.42],[.04,.28],[.28,.66],[.46,.54]],
      pad: [[.34,.76],[.46,.82],[.08,.36],[.78,1],[.18,.56],[.08,.30]],
      lead: [[.38,.82],[.34,.74],[.18,.52],[.34,.68],[.30,.72],[.42,.58]],
    };
    const nextValues = ranges[effectiveArchetype].map(([minimum, maximum]) =>
      centeredRandom(minimum, maximum)
    );
    parameterMorphSecondsRef.current = RANDOM_MORPH_SECONDS;
    setMachine(nextMachine);
    setPresetId('custom');
    setArchetype(effectiveArchetype);
    setValues(nextValues);
    const machineLabel = SYNTH_MACHINES.find((candidate) => candidate.id === nextMachine)?.label ?? nextMachine;
    return `${machineLabel} · ${effectiveArchetype.toUpperCase()} · 350 ms morph`;
  }

  function changeTempoFromWheel(event: ReactWheelEvent<HTMLSelectElement>): void {
    event.preventDefault();
    if (event.deltaY === 0) return;
    setBpm((current) => {
      const currentIndex = SYNTH_TEMPOS.findIndex((tempo) => tempo === current);
      const direction = event.deltaY < 0 ? 1 : -1;
      const nextIndex = Math.min(
        SYNTH_TEMPOS.length - 1,
        Math.max(0, (currentIndex < 0 ? 0 : currentIndex) + direction)
      );
      return SYNTH_TEMPOS[nextIndex];
    });
  }

  useRailCRandomController('synth', enabled, randomizeSynth);

  return (
    <RailModuleFrame
      {...props}
      id="synth"
      name="Synth"
      enabled={enabled}
      onToggle={() => setEnabled((current) => !current)}
      overlayActive={sequencerExpanded}
      headerControl={(
        <div className="synth-header-controls">
          <div className="synth-transport-controls">
            <button
              type="button"
              className={`synth-play-button ${playing ? 'active' : ''}`}
              aria-pressed={playing}
              onClick={() => setPlaying((current) => !current)}
            >
              {playing ? 'STOP' : 'PLAY'}
            </button>
            <label className="synth-tempo-selector">
              <span>BPM</span>
              <select
                aria-label="Sequencer tempo"
                value={bpm}
                onChange={(event) => setBpm(Number(event.target.value))}
                onWheel={changeTempoFromWheel}
                title="Scroll up to raise BPM · scroll down to lower BPM"
              >
                {SYNTH_TEMPOS.map((tempo) => <option key={tempo} value={tempo}>{tempo}</option>)}
              </select>
            </label>
          </div>
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
        </div>
      )}
    >
      <RailCFaceplateSurface
        moduleId="synth"
        knobRowClass="synth-knob-row"
        viewport={(
          <div className={`synth-roll dsp-viewport ${enabled ? 'active' : 'is-off'}`}>
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
                  const activeNote = (notes[step] ?? []).find((note) => note.pitch === pitchIndex);
                  const active = Boolean(activeNote);
                  const noteLength = activeNote?.length ?? 1;
                  return (
                    <div
                      role="gridcell"
                      key={`${pitch}-${step}`}
                      className={`piano-roll-cell ${active ? 'has-note' : ''} ${playhead === step && playing ? 'playhead' : ''}`}
                    >
                      <button
                        type="button"
                        className="piano-roll-cell-hit"
                        aria-label={`Step ${step + 1}, ${pitch}${active ? `, note active, ${noteLength} step${noteLength === 1 ? '' : 's'} long` : ''}`}
                        aria-pressed={active}
                        onClick={() => toggleCell(step, pitchIndex)}
                      />
                      {activeNote && (
                        <span
                          className="piano-roll-note"
                          style={{ width: `calc(${noteLength * 100}% + ${noteLength - 1}px)` }}
                        >
                          <span
                            className="piano-roll-note-handle"
                            role="slider"
                            tabIndex={0}
                            aria-label={`${pitch} note length at step ${step + 1}`}
                            aria-valuemin={1}
                            aria-valuemax={16 - step}
                            aria-valuenow={noteLength}
                            aria-valuetext={`${noteLength} sixteenth-note step${noteLength === 1 ? '' : 's'}`}
                            onPointerDown={(event) => beginNoteLengthDrag(event, step, pitchIndex, noteLength)}
                            onKeyDown={(event) => {
                              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                                event.preventDefault();
                                event.stopPropagation();
                                setNoteLength(
                                  patternIndex,
                                  step,
                                  pitchIndex,
                                  noteLength + (event.key === 'ArrowRight' ? 1 : -1)
                                );
                              }
                            }}
                          />
                        </span>
                      )}
                    </div>
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
          <button
            type="button"
            className={`sequencer-expand-button ${sequencerExpanded ? 'active' : ''}`}
            aria-label={sequencerExpanded ? 'Restore compact sequencer' : 'Expand sequencer to fill Synth module'}
            aria-pressed={sequencerExpanded}
            aria-expanded={sequencerExpanded}
            title={sequencerExpanded ? 'Restore module view · Esc' : 'Expand sequencer over the Synth module'}
            onClick={() => setSequencerExpanded((current) => !current)}
          >
            {sequencerExpanded ? 'BACK' : 'FULL'}
          </button>
          <button type="button" onClick={() => setPatterns((current) => current.map((pattern, index) => index === patternIndex ? Array.from({ length: 16 }, () => []) : pattern))}>CLEAR</button>
          <strong>
            {chain.map((index, position) => `${position === chainPosition && chainArmed ? '[' : ''}${index + 1}${position === chainPosition && chainArmed ? ']' : ''}`).join(' › ')}
          </strong>
        </div>
          </div>
        )}
        knobs={definition.controls.map((label, index) => (
          <Knob
            key={`${machine}-${label}`}
            label={label}
            value={values[index]}
            effectiveValue={values[index]}
            display={`${Math.round(values[index] * 100)}%`}
            patchTarget={`synth.${index}`}
            onChange={(value) => {
              setPresetId('custom');
              setArchetype('panel');
              parameterMorphSecondsRef.current = 0.04;
              setValues((current) => current.map((item, valueIndex) => valueIndex === index ? value : item));
            }}
            onReset={() => {
              setPresetId('custom');
              setArchetype('panel');
              parameterMorphSecondsRef.current = RANDOM_MORPH_SECONDS;
              setValues((current) => current.map((item, valueIndex) => valueIndex === index ? 0.5 : item));
            }}
            onPatchStart={() => undefined}
            onPatchMove={() => undefined}
            onPatchEnd={() => undefined}
            onPatchDisconnect={() => undefined}
          />
        ))}
      />
    </RailModuleFrame>
  );
}

type ChaosMode = 'chaos-pad' | 'performance-fx';

const CHAOS_RACK_STATE = {
  enabled: true,
  mode: 'chaos-pad' as ChaosMode,
  effect: 'grain-delay',
  values: [0.42, 0.34, 0.52, 0.68],
};

const CHAOS_PROGRAMS: Record<ChaosMode, readonly { id: string; label: string }[]> = {
  'chaos-pad': [
    { id: 'grain-delay', label: 'Grain Delay' },
    { id: 'dub-space', label: 'Dub Space' },
    { id: 'spectral-freeze', label: 'Spectral Freeze' },
    { id: 'pitch-vortex', label: 'Pitch Vortex' },
    { id: 'filter-feedback', label: 'Filter Feedback' },
  ],
  'performance-fx': [
    { id: 'djfx-looper', label: 'DJFX Looper' },
    { id: 'vinyl-brake', label: 'Vinyl Brake' },
    { id: 'scatter', label: 'Scatter' },
    { id: 'isolator', label: 'Isolator' },
    { id: 'stutter', label: 'Stutter' },
  ],
};

function ChaosModule({
  motionPadProps,
  ...props
}: RailInteractionProps & {
  motionPadProps: MotionPadProps;
}) {
  const [enabled, setEnabled] = useState(CHAOS_RACK_STATE.enabled);
  const [mode, setMode] = useState<ChaosMode>(CHAOS_RACK_STATE.mode);
  const [effect, setEffect] = useState(CHAOS_RACK_STATE.effect);
  const [values, setValues] = useState(() => [...CHAOS_RACK_STATE.values]);
  CHAOS_RACK_STATE.enabled = enabled;
  CHAOS_RACK_STATE.mode = mode;
  CHAOS_RACK_STATE.effect = effect;
  CHAOS_RACK_STATE.values = values;
  const labels = mode === 'chaos-pad'
    ? ['Depth', 'Feedback', 'Drift', 'Mix']
    : ['Scatter', 'Rate', 'Color', 'Mix'];

  function randomizeChaos(profile: RandomizationProfile): string | null {
    if (profile === 'mutate') {
      setValues((current) => current.map((value) => clamp01(
        value + (Math.random() * 2 - 1) * RANDOM_MUTATION_AMOUNT
      )));
      return 'Mutate 10% · current performance program';
    }
    const modes: readonly ChaosMode[] = ['chaos-pad', 'performance-fx'];
    const nextMode = modes[Math.floor(Math.random() * modes.length)];
    if (!nextMode) return null;
    const programs = CHAOS_PROGRAMS[nextMode];
    const nextProgram = programs[Math.floor(Math.random() * programs.length)];
    if (!nextProgram) return null;
    setMode(nextMode);
    setEffect(nextProgram.id);
    setValues([
      centeredRandom(0.18, 0.78),
      centeredRandom(0.16, 0.64),
      centeredRandom(0.22, 0.82),
      centeredRandom(0.28, 0.62),
    ]);
    return `${nextMode === 'chaos-pad' ? 'Chaos Pad' : 'Performance FX'} · ${nextProgram.label}`;
  }

  useRailCRandomController('chaos', enabled, randomizeChaos);

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
              {CHAOS_PROGRAMS[mode].map((program) => (
                <option value={program.id} key={program.id}>{program.label}</option>
              ))}
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
            <MotionPad {...motionPadProps} />
          </div>
        )}
        knobs={labels.map((label, index) => (
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
  const meter = Math.max(1, Math.round((state.enabled ? visualState.level : 0) * 18));
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
  assignments,
  motionPadProps,
  visualState,
  running,
  onSynthEnabledChange,
  onSynthMachineChange,
  onSynthArchetypeChange,
  onSynthParametersChange,
  onSynthTriggerNote,
  onSynthSequencerChange,
  onSynthSequencerStepListenerChange,
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
  onSynthArchetypeChange: (archetype: SynthArchetype) => void;
  onSynthParametersChange: (values: readonly number[], morphSeconds?: number) => void;
  onSynthTriggerNote: (midi: number, durationSeconds: number) => void;
  onSynthSequencerChange: (state: SynthSequencerState) => void;
  onSynthSequencerStepListenerChange: (
    listener: ((position: SynthSequencerStep) => void) | null
  ) => void;
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
        onArchetypeChange={onSynthArchetypeChange}
        onParametersChange={onSynthParametersChange}
        onTriggerNote={onSynthTriggerNote}
        onSequencerChange={onSynthSequencerChange}
        onSequencerStepListenerChange={onSynthSequencerStepListenerChange}
      />
    );
  }
  if (moduleId === 'chaos') return <ChaosModule {...interaction} motionPadProps={motionPadProps} />;
  if (moduleId === 'pressure') return <PressureModule {...interaction} running={running} visualState={visualState} />;
  return null;
}
