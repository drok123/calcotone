import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ChangeEvent as ReactChangeEvent,
  type DragEvent as ReactDragEvent,
} from 'react';

import './App.css';
import {
  AudioEngine,
  type AudioEngineState,
  type PerformanceMode,
  type DspProfilerSnapshot,
} from './audio/AudioEngine';
import { DEFAULT_PRESET } from './audio/Preset';
import type { InputMode } from './audio/InputMatrix';
import type { RecordedWav } from './audio/WavRecorder';
import type { ReverbAlgorithm } from './audio/effects/Reverb';
import { MEDIA_MODE_ORDER, type MediaMode } from './audio/effects/Media';
import { EMBER_MODE_ORDER, type EmberMode } from './audio/effects/Saturation';
import { DRIFT_MODE_ORDER, type DriftMode } from './audio/effects/Chorus';
import { GRAIN_MODE_ORDER, type GrainMode } from './audio/effects/Bitcrusher';
import {
  DELAY_ALGORITHM_ORDER,
  type DelayAlgorithm,
} from './audio/effects/Delay';
import { useVisualEngine, type VisualAudioState } from './visual/VisualEngine';

const APP_NAME = 'CALCOTONE';
const DESIGN_WIDTH = 2560;
const DESIGN_HEIGHT = 1440;
const DELAY_ALGORITHMS: DelayAlgorithm[] = [...DELAY_ALGORITHM_ORDER];

const REVERB_ALGORITHMS: ReverbAlgorithm[] = [
  'room',
  'plate',
  'hall',
  'cinema',
  'cloud',
  'freeze',
  'celestial',
  'aurora',
  'nebula',
  'abyss',
];

const DEFAULT_RAIL_A_ORDER = ['saturation', 'chorus', 'delay'] as const;
const DEFAULT_RAIL_B_ORDER = ['reverb', 'bitcrusher', 'media'] as const;
type RoutingRail = 'A' | 'B';

interface ModuleParameter {
  id: string;
  label: string;
  value: number;
  display: string;
}

interface ModuleState {
  id: string;
  algorithm?: ReverbAlgorithm;
  delayAlgorithm?: DelayAlgorithm;
  mediaMode?: MediaMode;
  emberMode?: EmberMode;
  driftMode?: DriftMode;
  grainMode?: GrainMode;
  name: string;
  enabled: boolean;
  available: boolean;
  parameters: ModuleParameter[];
}

type XYAxis = 'x' | 'y';

type MotionCurve = 'linear' | 'soft' | 'exponential' | 'stepped';
type MotionSmoothing = 'fast' | 'medium' | 'slow';

interface XYAssignment {
  id: string;
  axis: XYAxis;
  target: string;
  depth: number;
  inverted: boolean;
  min: number;
  max: number;
  curve: MotionCurve;
  smoothing: MotionSmoothing;
}

const INITIAL_XY_ASSIGNMENTS: XYAssignment[] = [];


interface PersistentPatchLine {
  id: string;
  axis: XYAxis;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface RecordedTake extends RecordedWav {
  createdAt: Date;
}

interface PatchDraft {
  target: string;
  label: string;
  startX: number;
  startY: number;
  pointerX: number;
  pointerY: number;
  hoverAxis: XYAxis | null;
}

const INITIAL_MODULES: ModuleState[] = [
  {
    id: 'saturation',
    name: 'Ember',
    emberMode: 'velvet',
    enabled: false,
    available: true,
    parameters: [
      { id: 'drive', label: 'Drive', value: 0.14, display: '14%' },
      { id: 'tone', label: 'Tone', value: 0.522, display: '9.5 kHz' },
      { id: 'heat', label: 'Heat', value: 0.18, display: '18%' },
      { id: 'character', label: 'Character', value: 0.22, display: '22%' },
      { id: 'dynamics', label: 'Dynamics', value: 0.38, display: '38%' },
      { id: 'mix', label: 'Mix', value: 0.22, display: '22%' },
    ],
  },
  {
    id: 'chorus',
    name: 'Drift',
    driftMode: 'chorus',
    enabled: false,
    available: true,
    parameters: [
      { id: 'rate', label: 'Rate', value: 0.094, display: '0.28 Hz' },
      { id: 'depth', label: 'Depth', value: 0.275, display: '2.2 ms' },
      { id: 'shape', label: 'Shape', value: 0.35, display: '35%' },
      { id: 'spread', label: 'Spread', value: 0.62, display: '62%' },
      { id: 'motion', label: 'Motion', value: 0.32, display: '32%' },
      { id: 'mix', label: 'Mix', value: 0.14, display: '14%' },
    ],
  },
  {
    id: 'delay',
    name: 'Halo',
    delayAlgorithm: 'tape',
    enabled: false,
    available: true,
    parameters: [
      { id: 'time', label: 'Time', value: 0.1692, display: '360 ms' },
      { id: 'feedback', label: 'Feedback', value: 0.244, display: '22%' },
      { id: 'color', label: 'Color', value: 0.42, display: '42%' },
      { id: 'character', label: 'Character', value: 0.14, display: '14%' },
      { id: 'width', label: 'Width', value: 0.58, display: '58%' },
      { id: 'mix', label: 'Mix', value: 0.14, display: '14%' },
    ],
  },
  {
    id: 'reverb',
    name: 'Atmos',
    algorithm: 'hall',
    enabled: false,
    available: true,
    parameters: [
      { id: 'decay', label: 'Decay', value: 0.504, display: '2.4 s' },
      { id: 'size', label: 'Size', value: 0.52, display: '52%' },
      { id: 'color', label: 'Color', value: 0.42, display: '42%' },
      { id: 'diffusion', label: 'Diffuse', value: 0.74, display: '74%' },
      { id: 'motion', label: 'Motion', value: 0.18, display: '18%' },
      { id: 'mix', label: 'Mix', value: 0.13, display: '13%' },
    ],
  },
  {
    id: 'bitcrusher',
    name: 'Grain',
    grainMode: 'reconstruct',
    enabled: false,
    available: true,
    parameters: [
      { id: 'bits', label: 'Bits', value: 0.75, display: '13 bit' },
      { id: 'density', label: 'Density', value: 0.42, display: '42%' },
      { id: 'pitch', label: 'Pitch', value: 0.38, display: '±5 st' },
      { id: 'chaos', label: 'Chaos', value: 0.16, display: '16%' },
      { id: 'bloom', label: 'Bloom', value: 0.36, display: '36%' },
      { id: 'mix', label: 'Mix', value: 0.12, display: '12%' },
    ],
  },
  {
    id: 'media',
    name: 'Artifact',
    mediaMode: 'cassette',
    enabled: false,
    available: true,
    parameters: [
      { id: 'wear', label: 'Wear', value: 0.162, display: '16%' },
      { id: 'wow', label: 'Wow', value: 0.16, display: '16%' },
      { id: 'noise', label: 'Noise', value: 0.1, display: '10%' },
      { id: 'tone', label: 'Tone', value: 0.62, display: '62%' },
      { id: 'mix', label: 'Mix', value: 0.26, display: '26%' },
    ],
  },
];


type MusicalRange = readonly [number, number];


function randomMusicalValue(range: MusicalRange, centerBias = 0.35): number {
  // Blend one uniform draw with the average of two draws. This still reaches extremes,
  // but lands in useful middle territory more often than raw full-range randomness.
  const uniform = Math.random();
  const centered = (Math.random() + Math.random()) * 0.5;
  const t = uniform * (1 - centerBias) + centered * centerBias;
  return range[0] + (range[1] - range[0]) * t;
}

function chooseMusical<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)]!;
}

function shuffledSignalOrder(current: readonly string[]): string[] {
  const next = [...current];

  // Fisher-Yates keeps every routing permutation equally reachable.
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  // A randomize button that appears to do nothing feels broken. With three
  // modules there are five alternative orders, so force a visible change.
  if (next.length > 1 && next.every((id, index) => id === current[index])) {
    next.push(next.shift()!);
  }

  return next;
}

const MUSICAL_RANDOM_RANGES: Record<string, Record<string, MusicalRange>> = {
  saturation: {
    drive: [0.08, 0.78],
    tone: [0.22, 0.82],
    heat: [0.05, 0.72],
    character: [0.08, 0.78],
    dynamics: [0.18, 0.82],
    mix: [0.10, 0.62],
  },
  chorus: {
    rate: [0.025, 0.58],
    depth: [0.08, 0.78],
    shape: [0.12, 0.88],
    spread: [0.28, 0.98],
    motion: [0.08, 0.78],
    mix: [0.08, 0.48],
  },
  delay: {
    time: [0.08, 0.82],
    feedback: [0.10, 0.58],
    color: [0.16, 0.88],
    character: [0.04, 0.66],
    width: [0.30, 0.96],
    mix: [0.08, 0.46],
  },
  reverb: {
    decay: [0.18, 0.78],
    size: [0.28, 0.94],
    color: [0.14, 0.88],
    diffusion: [0.38, 0.96],
    motion: [0.04, 0.58],
    mix: [0.08, 0.48],
  },
  bitcrusher: {
    bits: [0.34, 0.92],
    density: [0.18, 0.82],
    pitch: [0.00, 0.64],
    chaos: [0.02, 0.56],
    bloom: [0.12, 0.76],
    mix: [0.06, 0.42],
  },
  media: {
    wow: [0.02, 0.58],
    wear: [0.04, 0.68],
    noise: [0.00, 0.34],
    tone: [0.24, 0.88],
    mix: [0.08, 0.46],
  },
};

const MUSICAL_EMBER_MODES: readonly EmberMode[] = ['velvet','tube','console','transformer','furnace','exciter','broken'];
const MUSICAL_DRIFT_MODES: readonly DriftMode[] = ['chorus','ensemble','dimension','vibrato','rotary','doppler','liquid','orbit'];
const MUSICAL_HALO_MODES: readonly DelayAlgorithm[] = ['clean','tape','bbd','pingpong','diffuse','scatter','constellation'];
const MUSICAL_ATMOS_MODES: readonly ReverbAlgorithm[] = ['room','plate','hall','cinema','cloud','freeze','celestial','aurora','nebula','abyss'];
const MUSICAL_GRAIN_MODES: readonly GrainMode[] = [...GRAIN_MODE_ORDER];
const MUSICAL_MEDIA_MODES: readonly MediaMode[] = ['cassette','reel','vinyl','vhs','radio','wax','broken','archive'];

export default function App() {
  const engineRef = useRef<AudioEngine | null>(null);
  const [engineState, setEngineState] = useState<AudioEngineState>('idle');
  const [canvasScale, setCanvasScale] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [modules, setModules] = useState<ModuleState[]>(INITIAL_MODULES);
  const [railAOrder, setRailAOrder] = useState<string[]>([...DEFAULT_RAIL_A_ORDER]);
  const [railBOrder, setRailBOrder] = useState<string[]>([...DEFAULT_RAIL_B_ORDER]);
  const [draggedModuleId, setDraggedModuleId] = useState<string | null>(null);
  const [dragOverModuleId, setDragOverModuleId] = useState<string | null>(null);
  const [inputGain, setInputGain] = useState(1);
  const [inputMode, setInputMode] = useState<InputMode>('mono-to-stereo');
  const [inputWidth, setInputWidth] = useState(1);
  const [invertLeft, setInvertLeft] = useState(false);
  const [invertRight, setInvertRight] = useState(false);
  const [channelInfo, setChannelInfo] = useState({ input: '—', output: '—' });
  const [outputGain, setOutputGain] = useState(0.72);
  const [message, setMessage] = useState(
    'Open the preview in a separate tab, then start the audio engine.'
  );
  const [inputDevice, setInputDevice] = useState('No input connected');
  const [latency, setLatency] = useState('—');
  const [sampleRate, setSampleRate] = useState('—');
  const [xyPosition, setXyPosition] = useState({ x: 50, y: 50 });
  const [xyDragging, setXyDragging] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [performanceMode, setPerformanceMode] =
    useState<PerformanceMode>('live');
  const [profiler, setProfiler] = useState<DspProfilerSnapshot | null>(null);
  const [profilerOpen, setProfilerOpen] = useState(false);
  const [adaptiveMode, setAdaptiveMode] = useState(true);
  const [explainMode, setExplainMode] = useState(false);
  const [xyAssignments, setXyAssignments] = useState<XYAssignment[]>(
    INITIAL_XY_ASSIGNMENTS
  );
  const [patchDraft, setPatchDraft] = useState<PatchDraft | null>(null);
  const [persistentPatchLines, setPersistentPatchLines] = useState<
    PersistentPatchLine[]
  >([]);
  const [recordingState, setRecordingState] = useState<
    'idle' | 'recording' | 'ready' | 'error'
  >('idle');
  const [recordingName, setRecordingName] = useState('calcotone-sample');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedTake, setRecordedTake] = useState<RecordedTake | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const xyPadRef = useRef<HTMLDivElement | null>(null);
  const patchDraftRef = useRef<PatchDraft | null>(null);
  const motionValueRef = useRef(new Map<string, number>());

  function getEngine(): AudioEngine {
    if (!engineRef.current) {
      engineRef.current = new AudioEngine();
    }

    return engineRef.current;
  }

  function railForModule(moduleId: string): RoutingRail | null {
    if (railAOrder.includes(moduleId)) return 'A';
    if (railBOrder.includes(moduleId)) return 'B';
    return null;
  }

  function getModuleById(moduleId: string): ModuleState | undefined {
    return modules.find((module) => module.id === moduleId);
  }


  async function applyRoutingOrder(nextA: string[], nextB: string[]): Promise<void> {
    const engine = engineRef.current;
    if (!engine || engineState !== 'running') return;

    try {
      await engine.reorderEffectsClickSafe([...nextA, ...nextB]);
      setMessage(
        `Routing updated · A ${formatRailOrder(nextA)} · B ${formatRailOrder(nextB)}`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Signal routing could not be updated.');
    }
  }

  function reorderWithinRail(sourceId: string, targetId: string): void {
    if (sourceId === targetId) return;
    const sourceRail = railForModule(sourceId);
    const targetRail = railForModule(targetId);

    if (!sourceRail || sourceRail !== targetRail) {
      setMessage('Modules stay on their three-slot rail in this routing version.');
      return;
    }

    const current = sourceRail === 'A' ? railAOrder : railBOrder;
    const next = [...current];
    const from = next.indexOf(sourceId);
    const to = next.indexOf(targetId);
    if (from < 0 || to < 0) return;

    next.splice(from, 1);
    next.splice(to, 0, sourceId);

    const nextA = sourceRail === 'A' ? next : railAOrder;
    const nextB = sourceRail === 'B' ? next : railBOrder;

    if (sourceRail === 'A') setRailAOrder(next);
    else setRailBOrder(next);

    void applyRoutingOrder(nextA, nextB);
  }

  function nudgeModuleWithinRail(moduleId: string, direction: -1 | 1): void {
    const rail = railForModule(moduleId);
    if (!rail) return;

    const current = rail === 'A' ? railAOrder : railBOrder;
    const index = current.indexOf(moduleId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return;

    const next = [...current];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];

    const nextA = rail === 'A' ? next : railAOrder;
    const nextB = rail === 'B' ? next : railBOrder;

    if (rail === 'A') setRailAOrder(next);
    else setRailBOrder(next);

    void applyRoutingOrder(nextA, nextB);
  }

  function resetRailOrder(rail: RoutingRail): void {
    const nextA = rail === 'A' ? [...DEFAULT_RAIL_A_ORDER] : railAOrder;
    const nextB = rail === 'B' ? [...DEFAULT_RAIL_B_ORDER] : railBOrder;

    if (rail === 'A') setRailAOrder(nextA);
    else setRailBOrder(nextB);

    setDraggedModuleId(null);
    setDragOverModuleId(null);

    if (engineState === 'running') {
      void applyRoutingOrder(nextA, nextB);
    } else {
      setMessage(`Rail ${rail} reset to factory order. Applies on power-up.`);
    }
  }

  function randomizeSignalOrder(): void {
    let nextA = shuffledSignalOrder(railAOrder);
    let nextB = shuffledSignalOrder(railBOrder);

    // Extremely defensive: make sure the combined topology changes even if
    // future rail sizes/memberships alter the shuffle behavior.
    const unchangedA = nextA.every((id, index) => id === railAOrder[index]);
    const unchangedB = nextB.every((id, index) => id === railBOrder[index]);
    if (unchangedA && unchangedB) {
      nextA = [...railAOrder.slice(1), railAOrder[0]];
    }

    setRailAOrder(nextA);
    setRailBOrder(nextB);
    setDraggedModuleId(null);
    setDragOverModuleId(null);

    if (engineState === 'running') {
      void applyRoutingOrder(nextA, nextB);
    } else {
      setMessage(
        `Signal randomized · A ${formatRailOrder(nextA)} · B ${formatRailOrder(nextB)} · applies on power-up`
      );
    }
  }

  async function startAudio(): Promise<void> {
    const engine = getEngine();

    try {
      setEngineState('starting');
      setMessage('Requesting access to the audio input...');

      await engine.start({ performanceMode, inputMode });
      engine.loadPreset(DEFAULT_PRESET);
      engine.reorderEffects([...railAOrder, ...railBOrder]);
      engine.setInputGain(inputGain);
      engine.setInputMode(inputMode);
      engine.setInputWidth(inputWidth);
      engine.setInputPolarity(invertLeft, invertRight);
      engine.setOutputGain(outputGain);
      engine.setAdaptiveMode(adaptiveMode);
      syncModuleParameters(engine, modules);
      auditUiAgainstEngine(engine, modules);
      engine.setPerformanceMode(performanceMode);

      const latencyInfo = engine.getLatency();
      const totalLatency =
        (latencyInfo.baseLatency ?? 0) + (latencyInfo.outputLatency ?? 0);
      const track = engine.getInputStream()?.getAudioTracks()[0];
      const context = engine.getContext();

      setInputDevice(track?.label || 'Default audio input');
      setLatency(
        totalLatency > 0
          ? `${(totalLatency * 1000).toFixed(1)} ms`
          : 'Not reported'
      );
      setSampleRate(context ? `${context.sampleRate} Hz` : '—');
      const diagnostics = engine.getChannelDiagnostics();
      setChannelInfo({
        input: diagnostics.inputChannels
          ? `${diagnostics.inputChannels} ch`
          : 'Unknown',
        output: diagnostics.destinationChannels
          ? `${diagnostics.destinationChannels} ch`
          : 'Unknown',
      });
      setAnalyser(engine.getAnalyser());
      setEngineState('running');
      setMessage(
        'Audio is active. All six effect modules and the spectrum display are live.'
      );
    } catch (error) {
      // engine.start() is transactional internally, but failures after it returns
      // (preset construction, UI/DSP audit, later startup sync) must also tear
      // down the opened MediaStream/AudioContext before showing ERROR.
      try {
        await engine.stop();
      } catch (cleanupError) {
        console.error('CALCOTONE startup cleanup failed.', cleanupError);
      }
      setAnalyser(null);
      setEngineState('error');
      setMessage(
        error instanceof Error
          ? error.message
          : 'The audio engine could not start.'
      );
    }
  }

  function clearRecordingTimer(): void {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    recordingStartedAtRef.current = null;
  }

  function beginRecordingTimer(maxDurationSeconds: number): void {
    clearRecordingTimer();
    recordingStartedAtRef.current = performance.now();
    recordingTimerRef.current = window.setInterval(() => {
      const startedAt = recordingStartedAtRef.current;
      if (startedAt === null) return;
      const elapsed = Math.min(
        maxDurationSeconds,
        (performance.now() - startedAt) / 1000
      );
      setRecordingSeconds(elapsed);
      if (elapsed >= maxDurationSeconds) {
        void finishRecording(true);
      }
    }, 100);
  }

  function startRecording(): void {
    const engine = engineRef.current;
    if (!engine || engineState !== 'running') {
      setMessage('Start the audio engine before recording a sample.');
      return;
    }

    try {
      const info = engine.startRecording();
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
      setRecordedTake(null);
      setRecordingSeconds(0);
      setRecordingState('recording');
      beginRecordingTimer(info.maxDurationSeconds);
      setMessage(
        `Recording final stereo output at ${info.sampleRate} Hz / 24-bit WAV.`
      );
    } catch (error) {
      setRecordingState('error');
      setMessage(
        error instanceof Error ? error.message : 'Recording could not start.'
      );
    }
  }

  async function finishRecording(reachedLimit = false): Promise<void> {
    const engine = engineRef.current;
    if (!engine?.isRecording()) return;

    clearRecordingTimer();
    try {
      const take = await engine.stopRecording();
      const completeTake: RecordedTake = { ...take, createdAt: new Date() };
      const url = URL.createObjectURL(take.blob);
      setRecordedTake(completeTake);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return url;
      });
      setRecordingSeconds(take.durationSeconds);
      setRecordingState('ready');
      setMessage(
        reachedLimit
          ? 'Maximum two-minute sample captured and ready to save.'
          : 'Sample captured in lossless 24-bit stereo WAV format.'
      );
    } catch (error) {
      setRecordingState('error');
      setMessage(
        error instanceof Error
          ? error.message
          : 'Recording could not be finalized.'
      );
    }
  }

  function discardRecording(): void {
    engineRef.current?.cancelRecording();
    clearRecordingTimer();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setRecordedTake(null);
    setRecordingSeconds(0);
    setRecordingState('idle');
    setMessage('Recorded sample discarded.');
  }

  function saveRecording(): void {
    if (!recordedTake) {
      setMessage('Record a sample before saving.');
      return;
    }

    const safeName = sanitizeFileName(recordingName) || 'calcotone-sample';
    const url = URL.createObjectURL(recordedTake.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeName}.wav`;
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`${safeName}.wav saved as 24-bit stereo PCM.`);
  }

  async function stopAudio(): Promise<void> {
    const engine = engineRef.current;

    if (!engine) {
      return;
    }

    if (engine.isRecording()) {
      await finishRecording();
    }
    clearRecordingTimer();
    await engine.stop();
    setAnalyser(null);
    setEngineState('stopped');
    setInputDevice('No input connected');
    setLatency('—');
    setSampleRate('—');
    setChannelInfo({ input: '—', output: '—' });
    setMessage('Audio engine stopped.');
  }

  async function toggleAudio(): Promise<void> {
    if (engineState === 'running') {
      await stopAudio();
    } else {
      await startAudio();
    }
  }

  function updateInputMode(mode: InputMode): void {
    setInputMode(mode);
    engineRef.current?.setInputMode(mode);
    setMessage(
      mode === 'mono-to-stereo'
        ? 'Input 1 is duplicated to both channels before the stereo effects rack.'
        : `Input routing changed to ${mode.replaceAll('-', ' ')}.`
    );
  }

  function updateInputWidth(value: number): void {
    setInputWidth(value);
    engineRef.current?.setInputWidth(value);
  }

  function updatePolarity(left: boolean, right: boolean): void {
    setInvertLeft(left);
    setInvertRight(right);
    engineRef.current?.setInputPolarity(left, right);
    const active = [left ? 'L' : '', right ? 'R' : ''].filter(Boolean).join(' + ');
    setMessage(active ? `Polarity inverted on ${active}.` : 'Input polarity normal.');
  }

  function updateInputGain(value: number): void {
    setInputGain(value);
    engineRef.current?.setInputGain(value);
  }

  function updateOutputGain(value: number): void {
    setOutputGain(value);
    engineRef.current?.setOutputGain(value);
  }

  function toggleAdaptiveMode(): void {
    const next = !adaptiveMode;
    setAdaptiveMode(next);
    engineRef.current?.setAdaptiveMode(next);
    setMessage(`SAFE mode ${next ? 'enabled' : 'disabled'}.`);
  }

  function updateParameter(
    moduleId: string,
    parameterId: string,
    value: number
  ): void {
    setModules((currentModules) =>
      currentModules.map((module) =>
        module.id !== moduleId
          ? module
          : {
              ...module,
              parameters: module.parameters.map((parameter) =>
                parameter.id !== parameterId
                  ? parameter
                  : {
                      ...parameter,
                      value,
                      display: formatParameterValue(
                        moduleId,
                        parameterId,
                        value
                      ),
                    }
              ),
            }
      )
    );

    if (engineState === 'running') {
      setEffectParameterIfLoaded(
        engineRef.current,
        moduleId,
        parameterId,
        toDspParameterValue(moduleId, parameterId, value)
      );
    }
  }

  function updateDelayAlgorithm(algorithm: DelayAlgorithm): void {
    setModules((currentModules) =>
      currentModules.map((module) =>
        module.id === 'delay' ? { ...module, delayAlgorithm: algorithm } : module
      )
    );
    setEffectParameterIfLoaded(
      engineRef.current,
      'delay',
      'algorithm',
      DELAY_ALGORITHMS.indexOf(algorithm)
    );
    setMessage(`Halo changed to ${algorithm}. Existing repeats will fade naturally.`);
  }

  function updateReverbAlgorithm(algorithm: ReverbAlgorithm): void {
    setModules((currentModules) =>
      currentModules.map((module) =>
        module.id === 'reverb' ? { ...module, algorithm } : module
      )
    );
    setEffectParameterIfLoaded(
      engineRef.current,
      'reverb',
      'algorithm',
      REVERB_ALGORITHMS.indexOf(algorithm)
    );
    setMessage(`Atmos changed to ${algorithm}. Existing tails will fade naturally.`);
  }

  function updateEmberMode(mode: EmberMode): void {
    setModules((current) => current.map((module) => module.id === 'saturation' ? { ...module, emberMode: mode } : module));
    setEffectParameterIfLoaded(engineRef.current, 'saturation', 'mode', EMBER_MODE_ORDER.indexOf(mode));
    setMessage(`Ember changed to ${mode}.`);
  }

  function updateDriftMode(mode: DriftMode): void {
    setModules((current) => current.map((module) => module.id === 'chorus' ? { ...module, driftMode: mode } : module));
    setEffectParameterIfLoaded(engineRef.current, 'chorus', 'mode', DRIFT_MODE_ORDER.indexOf(mode));
    setMessage(`Drift changed to ${mode}.`);
  }

  function updateGrainMode(mode: GrainMode): void {
    setModules((current) => current.map((module) => module.id === 'bitcrusher' ? { ...module, grainMode: mode } : module));
    setEffectParameterIfLoaded(engineRef.current, 'bitcrusher', 'mode', GRAIN_MODE_ORDER.indexOf(mode));
    setMessage(`Grain changed to ${mode}.`);
  }

  function updateMediaMode(mode: MediaMode): void {
    setModules((currentModules) =>
      currentModules.map((module) =>
        module.id === 'media' ? { ...module, mediaMode: mode } : module
      )
    );
    setEffectParameterIfLoaded(
      engineRef.current,
      'media',
      'mode',
      MEDIA_MODE_ORDER.indexOf(mode)
    );
    setMessage(`Artifact changed to ${mode}.`);
  }


  function randomizeActiveModules(): void {
    const activeModules = modules.filter((module) => module.enabled && module.available);
    if (activeModules.length === 0) {
      setMessage('Turn on at least one module before using MUSICAL RANDOM.');
      return;
    }

    const nextModules = modules.map((module) => {
      if (!module.enabled || !module.available) return module;

      const ranges = MUSICAL_RANDOM_RANGES[module.id] ?? {};
      const nextParameters = module.parameters.map((parameter) => {
        const range = ranges[parameter.id];
        if (!range) return parameter;

        let next = randomMusicalValue(range);

        // Extra guardrails for parameters where combinations can get unruly.
        if (module.id === 'delay' && parameter.id === 'feedback') {
          next = Math.min(next, (module.delayAlgorithm === 'constellation' || module.delayAlgorithm === 'scatter') ? 0.56 : 0.68);
        }
        if (module.id === 'reverb' && parameter.id === 'decay' && module.algorithm === 'freeze') {
          next = Math.max(0.48, next);
        }
        if (module.id === 'bitcrusher' && parameter.id === 'chaos') {
          next = Math.min(next, 0.52);
        }
        if (parameter.id === 'mix') {
          // Wet/dry is deliberately conservative so a randomized patch stays playable.
          next = Math.min(next, 0.52);
        }

        next = clamp(next, 0, 1);
        return {
          ...parameter,
          value: next,
          display: formatParameterValue(module.id, parameter.id, next),
        };
      });

      if (module.id === 'saturation') {
        return { ...module, emberMode: chooseMusical(MUSICAL_EMBER_MODES), parameters: nextParameters };
      }
      if (module.id === 'chorus') {
        return { ...module, driftMode: chooseMusical(MUSICAL_DRIFT_MODES), parameters: nextParameters };
      }
      if (module.id === 'delay') {
        return { ...module, delayAlgorithm: chooseMusical(MUSICAL_HALO_MODES), parameters: nextParameters };
      }
      if (module.id === 'reverb') {
        return { ...module, algorithm: chooseMusical(MUSICAL_ATMOS_MODES), parameters: nextParameters };
      }
      if (module.id === 'bitcrusher') {
        return { ...module, grainMode: chooseMusical(MUSICAL_GRAIN_MODES), parameters: nextParameters };
      }
      if (module.id === 'media') {
        return { ...module, mediaMode: chooseMusical(MUSICAL_MEDIA_MODES), parameters: nextParameters };
      }
      return { ...module, parameters: nextParameters };
    });

    setModules(nextModules);

    if (engineState === 'running') {
      const engine = engineRef.current;
      for (const module of nextModules) {
        if (!module.enabled) continue;

        if (module.id === 'saturation' && module.emberMode) {
          setEffectParameterIfLoaded(engine, 'saturation', 'mode', EMBER_MODE_ORDER.indexOf(module.emberMode));
        }
        if (module.id === 'chorus' && module.driftMode) {
          setEffectParameterIfLoaded(engine, 'chorus', 'mode', DRIFT_MODE_ORDER.indexOf(module.driftMode));
        }
        if (module.id === 'delay' && module.delayAlgorithm) {
          setEffectParameterIfLoaded(engine, 'delay', 'algorithm', DELAY_ALGORITHMS.indexOf(module.delayAlgorithm));
        }
        if (module.id === 'reverb' && module.algorithm) {
          setEffectParameterIfLoaded(engine, 'reverb', 'algorithm', REVERB_ALGORITHMS.indexOf(module.algorithm));
        }
        if (module.id === 'media' && module.mediaMode) {
          setEffectParameterIfLoaded(engine, 'media', 'mode', MEDIA_MODE_ORDER.indexOf(module.mediaMode));
        }
        if (module.id === 'bitcrusher' && module.grainMode) {
          setEffectParameterIfLoaded(engine, 'bitcrusher', 'mode', GRAIN_MODE_ORDER.indexOf(module.grainMode));
        }

        for (const parameter of module.parameters) {
          setEffectParameterIfLoaded(
            engine,
            module.id,
            parameter.id,
            toDspParameterValue(module.id, parameter.id, parameter.value)
          );
        }
      }
    }

    setMessage(`MUSICAL RANDOM reshaped ${activeModules.length} active module${activeModules.length === 1 ? '' : 's'}.`);
  }

  function toggleModule(moduleId: string): void {
    const module = modules.find((candidate) => candidate.id === moduleId);

    if (!module || !module.available) {
      return;
    }

    const nextEnabled = !module.enabled;

    setModules((currentModules) =>
      currentModules.map((candidate) =>
        candidate.id === moduleId
          ? { ...candidate, enabled: nextEnabled }
          : candidate
      )
    );

    engineRef.current?.setEffectBypassed(moduleId, !nextEnabled);
    setMessage(`${module.name} ${nextEnabled ? 'enabled' : 'bypassed'}.`);
  }

  function handleXYPad(event: ReactPointerEvent<HTMLDivElement>): void {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = clamp(
      ((event.clientX - bounds.left) / bounds.width) * 100,
      0,
      100
    );
    const y = clamp(
      ((event.clientY - bounds.top) / bounds.height) * 100,
      0,
      100
    );

    setXyPosition({ x, y });
  }

  function applyXYAssignments(x: number, y: number): void {
    const activeTargets = new Set(xyAssignments.map((assignment) => assignment.target));
    for (const target of motionValueRef.current.keys()) {
      if (!activeTargets.has(target)) motionValueRef.current.delete(target);
    }

    for (const assignment of xyAssignments) {
      if (!assignment.target) continue;

      const source = assignment.axis === 'x' ? x : y;
      const shaped = shapeMotionSource(
        assignment.inverted ? 1 - source : source,
        assignment.curve ?? 'linear'
      );
      const [moduleId, parameterId] = assignment.target.split('.');
      const module = modules.find((candidate) => candidate.id === moduleId);
      const parameter = module?.parameters.find(
        (candidate) => candidate.id === parameterId
      );

      if (!module || !parameter) continue;

      // The knob remains the center/base value. Depth determines how far the cable
      // can pull the destination around that base setting.
      const bipolar = shaped * 2 - 1;
      const targetValue = clamp(
        parameter.value + bipolar * 0.5 * assignment.depth,
        assignment.min ?? 0,
        assignment.max ?? 1
      );
      const previousValue = motionValueRef.current.get(assignment.target) ?? targetValue;
      const smoothing = assignment.smoothing ?? 'medium';
      const response = smoothing === 'fast' ? 0.72 : smoothing === 'slow' ? 0.16 : 0.36;
      const modulatedValue = previousValue + (targetValue - previousValue) * response;
      motionValueRef.current.set(assignment.target, modulatedValue);

      if (engineState === 'running') {
        setEffectParameterIfLoaded(
          engineRef.current,
          moduleId,
          parameterId,
          toDspParameterValue(moduleId, parameterId, modulatedValue)
        );
      }
    }
  }

  function beginPatch(
    target: string,
    label: string,
    startX: number,
    startY: number,
    pointerX: number,
    pointerY: number
  ): void {
    const draft = {
      target,
      label,
      startX,
      startY,
      pointerX,
      pointerY,
      hoverAxis: detectPatchAxis(pointerX, pointerY),
    };
    patchDraftRef.current = draft;
    setPatchDraft(draft);
    setMessage(`${label}: choose X or Y on the motion pad.`);
  }

  function movePatch(pointerX: number, pointerY: number): void {
    const current = patchDraftRef.current;
    if (!current) return;
    const next = {
      ...current,
      pointerX,
      pointerY,
      hoverAxis: detectPatchAxis(pointerX, pointerY),
    };
    patchDraftRef.current = next;
    setPatchDraft(next);
  }

  function finishPatch(pointerX: number, pointerY: number): void {
    const draft = patchDraftRef.current;
    if (!draft) return;

    const axis = detectPatchAxis(pointerX, pointerY);
    const pad = xyPadRef.current?.getBoundingClientRect();
    const droppedOnPad =
      pad &&
      pointerX >= pad.left &&
      pointerX <= pad.right &&
      pointerY >= pad.top &&
      pointerY <= pad.bottom;

    if (droppedOnPad && axis) {
      const id = `xy-${draft.target.replace('.', '-')}`;
      setXyAssignments((current) => [
        ...current.filter((assignment) => assignment.target !== draft.target),
        {
          id,
          axis,
          target: draft.target,
          depth: 0.5,
          inverted: false,
          min: 0,
          max: 1,
          curve: 'soft',
          smoothing: 'medium',
        },
      ]);

      const [moduleId] = draft.target.split('.');
      setModules((current) =>
        current.map((module) =>
          module.id === moduleId ? { ...module, enabled: true } : module
        )
      );
      engineRef.current?.setEffectBypassed(moduleId, false);
      setMessage(`${draft.label} → ${axis.toUpperCase()}.`);
    } else {
      setMessage(`Patch from ${draft.label} cancelled.`);
    }

    patchDraftRef.current = null;
    setPatchDraft(null);
  }

  function detectPatchAxis(pointerX: number, pointerY: number): XYAxis | null {
    const pad = xyPadRef.current?.getBoundingClientRect();
    if (!pad) return null;
    if (
      pointerX < pad.left ||
      pointerX > pad.right ||
      pointerY < pad.top ||
      pointerY > pad.bottom
    ) {
      return null;
    }

    const normalizedX = (pointerX - pad.left) / pad.width - 0.5;
    const normalizedY = (pointerY - pad.top) / pad.height - 0.5;
    return Math.abs(normalizedX) >= Math.abs(normalizedY) ? 'x' : 'y';
  }

  function disconnectPatch(target: string): void {
    setXyAssignments((current) =>
      current.filter((assignment) => assignment.target !== target)
    );
    motionValueRef.current.delete(target);

    const [moduleId, parameterId] = target.split('.');
    const module = modules.find((candidate) => candidate.id === moduleId);
    const parameter = module?.parameters.find(
      (candidate) => candidate.id === parameterId
    );
    if (parameter && engineState === 'running') {
      setEffectParameterIfLoaded(
        engineRef.current,
        moduleId,
        parameterId,
        toDspParameterValue(moduleId, parameterId, parameter.value)
      );
    }
    setMessage('Patch removed.');
  }


  function updateMotionRoute(
    id: string,
    patch: Partial<Omit<XYAssignment, 'id' | 'target'>>
  ): void {
    setXyAssignments((current) =>
      current.map((assignment) => {
        if (assignment.id !== id) return assignment;
        const next = { ...assignment, ...patch };
        if (next.min > next.max) {
          if (patch.min !== undefined) next.max = next.min;
          else next.min = next.max;
        }
        return next;
      })
    );
  }

  function refreshPersistentPatchLines(): void {
    const pad = xyPadRef.current?.getBoundingClientRect();
    if (!pad) {
      setPersistentPatchLines([]);
      return;
    }

    const lines = xyAssignments.flatMap((assignment) => {
      const source = document.querySelector<HTMLElement>(
        `[data-patch-target="${assignment.target}"]`
      );
      if (!source) return [];
      const sourceBounds = source.getBoundingClientRect();
      const endX = assignment.axis === 'x'
        ? pad.left + pad.width * 0.18
        : pad.left + pad.width * 0.82;
      const endY = assignment.axis === 'x'
        ? pad.top + pad.height * 0.82
        : pad.top + pad.height * 0.18;
      return [
        {
          id: assignment.id,
          axis: assignment.axis,
          startX: sourceBounds.left + sourceBounds.width / 2,
          startY: sourceBounds.top + sourceBounds.height / 2,
          endX,
          endY,
        },
      ];
    });
    setPersistentPatchLines(lines);
  }

  function changePerformanceMode(mode: PerformanceMode): void {
    setPerformanceMode(mode);
    engineRef.current?.setPerformanceMode(mode);
    setMessage(`${mode.charAt(0).toUpperCase() + mode.slice(1)} quality selected.`);
  }

  useEffect(() => {
    if (engineState !== 'running') return;
    applyXYAssignments(xyPosition.x / 100, xyPosition.y / 100);
  }, [xyAssignments, modules, xyPosition.x, xyPosition.y, engineState]);

  useEffect(() => {
    return () => {
      clearRecordingTimer();
      engineRef.current?.cancelRecording();
      void engineRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(refreshPersistentPatchLines);
    const observer = new ResizeObserver(refreshPersistentPatchLines);
    if (xyPadRef.current) observer.observe(xyPadRef.current);
    window.addEventListener('resize', refreshPersistentPatchLines);
    window.addEventListener('scroll', refreshPersistentPatchLines, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', refreshPersistentPatchLines);
      window.removeEventListener('scroll', refreshPersistentPatchLines, true);
    };
  }, [xyAssignments, modules, railAOrder, railBOrder]);

  useLayoutEffect(() => {
    const fitCanvas = (): void => {
      const nextScale = Math.min(
        window.innerWidth / DESIGN_WIDTH,
        window.innerHeight / DESIGN_HEIGHT
      );
      setCanvasScale(Math.max(0.1, nextScale));
    };

    fitCanvas();
    window.addEventListener('resize', fitCanvas);
    document.addEventListener('fullscreenchange', fitCanvas);
    return () => {
      window.removeEventListener('resize', fitCanvas);
      document.removeEventListener('fullscreenchange', fitCanvas);
    };
  }, []);

  useEffect(() => {
    const handleFullscreenChange = (): void => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    handleFullscreenChange();
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      setMessage('Fullscreen was blocked by the browser. Use the preview in its own tab.');
    }
  }

  const isRunning = engineState === 'running';
  const visualState = useVisualEngine(
    analyser,
    isRunning,
    performanceMode === 'live' ? 30 : 45
  );

  useEffect(() => {
    if (!isRunning) {
      setProfiler(null);
      return;
    }
    const refresh = () => {
      engineRef.current?.updateAdaptivePerformance();
      setProfiler(engineRef.current?.getProfilerSnapshot() ?? null);
    };
    refresh();
    const timer = window.setInterval(refresh, 500);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  return (
    <div className="app-shell">
      <div
        className="canvas-stage"
        style={{ '--canvas-scale': canvasScale } as CSSProperties}
      >
      <main className={`workstation ${isRunning ? 'is-live' : ''} ${engineState === 'starting' ? 'is-starting' : ''} ${explainMode ? 'explain-mode' : ''}`}>
        <span className="case-screw screw-one" aria-hidden="true" />
        <span className="case-screw screw-two" aria-hidden="true" />
        <span className="case-screw screw-three" aria-hidden="true" />
        <span className="case-screw screw-four" aria-hidden="true" />

        <header className="topbar">
          <button
            type="button"
            className={`brand brand-power ${isRunning ? 'running' : ''}`}
            disabled={engineState === 'starting'}
            onClick={() => void toggleAudio()}
            aria-label={isRunning ? 'Power off CALCOTONE' : 'Power on CALCOTONE'}
          >
            <div className="brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="brand-power-label">
              <h1>{APP_NAME}</h1>
              <small>CT-86 · STEREO PROCESSOR</small>
            </div>
          </button>

          <div className="topbar-actions" />
        </header>

        <section className="status-strip control-strip">
          <button type="button" className="profiler-toggle randomizer-toggle" onClick={randomizeActiveModules} title="Randomize only active modules within musically guarded ranges">RANDOM</button>
          <button type="button" className="profiler-toggle signal-randomizer-toggle" onClick={randomizeSignalOrder} title="Randomize the order of both three-module signal rails">SIGNAL RANDOM</button>
          <button type="button" className={`profiler-toggle ${explainMode ? 'active' : ''}`} aria-pressed={explainMode} onClick={() => setExplainMode((value) => !value)}>EXPLAIN</button>
          <button type="button" className={`profiler-toggle ${profilerOpen ? 'active' : ''}`} aria-pressed={profilerOpen} onClick={() => setProfilerOpen((open) => !open)}>DSP</button>
        </section>

        {profilerOpen && (
          <aside className="dsp-profiler" aria-label="DSP profiler">
            <strong>DSP PROFILER</strong>
            <span>CALLBACK <b title="Portable AudioWorklet wall-clock timing is disabled to protect audio stability">N/A</b></span>
            <span>TIMING <b title="AudioWorkletGlobalScope does not guarantee a wall-clock performance timer">AUDIO SAFE</b></span>
            <span>GRAIN <b>{profiler ? `${profiler.grain.activeVoices}/${profiler.grain.maxVoices}` : '0/0'}</b></span>
            <span>GUARD <b>{profiler ? `${profiler.grain.effectiveVoiceLimit}/${profiler.grain.maxVoices}` : '0/0'}</b></span>
            <span>OVERRUN <b className={profiler && profiler.grain.overruns > 0 ? 'warn' : ''}>{profiler?.grain.overruns ?? 0}</b></span>
            <span>DROP <b>{profiler?.grain.droppedSpawns ?? 0}</b></span>
            <span>HEALTH <b className={profiler?.health === 'critical' ? 'warn' : ''}>{profiler?.health ?? 'offline'}</b></span>
            <span>CENTROID <b>{profiler ? `${Math.round(profiler.spectralCentroidHz)} Hz` : '0 Hz'}</b></span>
            <span>MEMORY <b>{profiler ? `${Math.round(profiler.dreamBuffer.fillRatio * 100)}%` : '0%'}</b></span>
            <span>MEM PEAK <b>{profiler ? profiler.dreamBuffer.inputPeak.toFixed(2) : '0.00'}</b></span>
            <span>LINKS <b>{profiler?.dreamBuffer.activeRoutes ?? 0}</b></span>
            <span>SAFE <b>{profiler?.adaptiveAction ?? 'OFFLINE'}</b></span>
          </aside>
        )}

        <section className="main-grid">
          <aside className="io-panel">
            <div className="panel-heading">
              <h2>I/O</h2>
              <span className={`jewel-light ${isRunning ? 'active' : ''}`} aria-hidden="true" />
            </div>

            <div className="io-unified-box">
              <div className="io-control-section">
                <label className="input-mode-control">
                  <span>Input Mode</span>
                  <select
                    value={inputMode}
                    onChange={(event: ReactChangeEvent<HTMLSelectElement>) =>
                      updateInputMode(event.target.value as InputMode)
                    }
                  >
                    <option value="mono-to-stereo">Mono 1 → Stereo</option>
                    <option value="stereo">True Stereo</option>
                    <option value="left">Left → Stereo</option>
                    <option value="right">Right → Stereo</option>
                    <option value="sum-mono">L + R → Stereo</option>
                    <option value="swap">Swap L / R</option>
                  </select>
                </label>

                <LinearControl
                  label="Input Width"
                  value={inputWidth}
                  min={0}
                  max={2}
                  step={0.01}
                  display={`${Math.round(inputWidth * 100)}%`}
                  onChange={updateInputWidth}
                />

                <div className="polarity-row">
                  <button
                    type="button"
                    className={invertLeft ? 'active' : ''}
                    aria-pressed={invertLeft}
                    onClick={() => updatePolarity(!invertLeft, invertRight)}
                  >
                    Ø Left
                  </button>
                  <button
                    type="button"
                    className={invertRight ? 'active' : ''}
                    aria-pressed={invertRight}
                    onClick={() => updatePolarity(invertLeft, !invertRight)}
                  >
                    Ø Right
                  </button>
                </div>

                <LinearControl
                  label="Input Gain"
                  value={inputGain}
                  min={0}
                  max={1.5}
                  step={0.01}
                  display={`${inputGain.toFixed(2)}×`}
                  onChange={updateInputGain}
                />

                <LinearControl
                  label="Output Gain"
                  value={outputGain}
                  min={0}
                  max={1.2}
                  step={0.01}
                  display={`${outputGain.toFixed(2)}×`}
                  onChange={updateOutputGain}
                />
              </div>

              <div className="io-meter-section">
                <div className="meter-pair" aria-label="Signal energy meters">
                  <LevelMeter label="LOW" level={isRunning ? visualState.low : 0} />
                  <LevelMeter label="HIGH" level={isRunning ? visualState.high : 0} />
                </div>

                <div
                  className="output-meter"
                  aria-label={`Output activity ${Math.round((isRunning ? visualState.level : 0) * 100)} percent`}
                >
                  {Array.from({ length: 8 }).map((_, index) => {
                    const lit = isRunning && index < Math.round(clamp(visualState.level, 0, 1) * 8);
                    return <span key={index} className={lit ? 'lit' : ''} />;
                  })}
                </div>
              </div>

              <div className="io-spectrum-section">
                <SpectrumWaterfall analyser={analyser} running={isRunning} />

                <div className="engine-info-grid" aria-label="Engine information">
                  <div>
                    <span>Engine</span>
                    <strong className={isRunning ? 'active' : ''}>{engineState}</strong>
                  </div>
                  <div>
                    <span>Input</span>
                    <strong>{inputDevice}</strong>
                  </div>
                  <div>
                    <span>Latency</span>
                    <strong>{latency}</strong>
                  </div>
                  <div>
                    <span>Sample Rate</span>
                    <strong>{sampleRate}</strong>
                  </div>
                  <div className="wide">
                    <span>Channels</span>
                    <strong>{channelInfo.input} → {channelInfo.output}</strong>
                  </div>
                </div>
              </div>
            </div>
          </aside>

          <section className="modules-section" aria-label="Effects modules">
            <div className="module-grid routing-grid">
              {([
                ['A', railAOrder],
                ['B', railBOrder],
              ] as const).map(([rail, order]) => (
                <section className={`module-rail rail-${rail.toLowerCase()}`} key={rail} aria-label={`Signal rail ${rail}`}>
                  <div className="rail-track">
                    <span className="rail-id">RAIL {rail}</span>
                    <strong>{formatRailOrder(order)}</strong>
                    <button
                      type="button"
                      onClick={() => resetRailOrder(rail)}
                      title={`Restore factory order for Rail ${rail}`}
                    >
                      RESET {rail}
                    </button>
                  </div>

                  <div className="rail-modules">
                    {order.map((moduleId) => {
                      const module = getModuleById(moduleId);
                      if (!module) return null;
                      return (
                        <EffectModule
                          key={module.id}
                          module={module}
                          slotLabel={`${rail}${order.indexOf(module.id) + 1}`}
                          onToggle={() => toggleModule(module.id)}
                          onParameterChange={(parameterId, value) =>
                            updateParameter(module.id, parameterId, value)
                          }
                          onDelayAlgorithmChange={updateDelayAlgorithm}
                          onAlgorithmChange={updateReverbAlgorithm}
                          onMediaModeChange={updateMediaMode}
                          onEmberModeChange={updateEmberMode}
                          onDriftModeChange={updateDriftMode}
                          onGrainModeChange={updateGrainMode}
                          visualState={visualState}
                          assignments={xyAssignments}
                          xyPosition={xyPosition}
                          onPatchStart={beginPatch}
                          onPatchMove={movePatch}
                          onPatchEnd={finishPatch}
                          onPatchDisconnect={disconnectPatch}
                          routingDragging={draggedModuleId === module.id}
                          routingDropTarget={dragOverModuleId === module.id}
                          onRoutingDragStart={(event) => {
                            setDraggedModuleId(module.id);
                            setDragOverModuleId(null);
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', module.id);
                          }}
                          onRoutingDragOver={(event) => {
                            if (!draggedModuleId || railForModule(draggedModuleId) !== rail) return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                            setDragOverModuleId(module.id);
                          }}
                          onRoutingDrop={(event) => {
                            event.preventDefault();
                            const sourceId = draggedModuleId || event.dataTransfer.getData('text/plain');
                            if (sourceId) reorderWithinRail(sourceId, module.id);
                            setDraggedModuleId(null);
                            setDragOverModuleId(null);
                          }}
                          onRoutingDragEnd={() => {
                            setDraggedModuleId(null);
                            setDragOverModuleId(null);
                          }}
                          onRoutingNudge={(direction) =>
                            nudgeModuleWithinRail(module.id, direction)
                          }
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </section>

          <aside className="performance-panel">
            <div className="panel-heading motion-heading">
              <h2>MOTION</h2>
              <span className={`jewel-light ${xyAssignments.length > 0 ? 'active' : ''}`} aria-hidden="true" />
            </div>

            <div className="performance-mode" role="group" aria-label="Processing quality">
              {(['live', 'balanced', 'studio'] as PerformanceMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={performanceMode === mode ? 'active' : ''}
                  aria-pressed={performanceMode === mode}
                  onClick={() => changePerformanceMode(mode)}
                >
                  <span className="mode-led" aria-hidden="true" />
                  {mode}
                </button>
              ))}
            </div>

            <div
              ref={xyPadRef}
              className={`xy-pad ${xyDragging ? 'is-dragging' : ''} ${patchDraft ? 'patch-target-active' : ''} ${
                patchDraft?.hoverAxis ? `hover-axis-${patchDraft.hoverAxis}` : ''
              }`}
              onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setXyDragging(true);
                handleXYPad(event);
              }}
              onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  handleXYPad(event);
                }
              }}
              onPointerUp={(event: ReactPointerEvent<HTMLDivElement>) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                setXyDragging(false);
              }}
              onPointerCancel={() => setXyDragging(false)}
            >
              <XYSignalField modules={modules} assignments={xyAssignments} position={xyPosition} dragging={xyDragging || Boolean(patchDraft)} />
              <div className="xy-grid horizontal" />
              <div className="xy-grid vertical" />
              <span className="xy-axis-mark x" aria-hidden="true">X</span>
              <span className="xy-axis-mark y" aria-hidden="true">Y</span>
              <div
                className="xy-cursor"
                style={{ '--x': `${xyPosition.x}%`, '--y': `${xyPosition.y}%` } as CSSProperties}
              />
            </div>

            <div className="xy-values" aria-label="Motion coordinates">
              <div><span>X</span><strong>{Math.round(xyPosition.x)}</strong></div>
              <div><span>Y</span><strong>{Math.round(100 - xyPosition.y)}</strong></div>
            </div>

            <section className="motion-route-inspector" aria-label="Motion patches">
              <div className="route-inspector-heading">
                <strong>PATCHES</strong>
                <span className="route-count"><i />{xyAssignments.length}</span>
              </div>
              {xyAssignments.length === 0 ? (
                <p className="empty-routes">Drag any knob jack to the pad.</p>
              ) : (
                <div className="motion-route-list">
                  {xyAssignments.map((assignment) => {
                    const [moduleId, parameterId] = assignment.target.split('.');
                    const module = modules.find((item) => item.id === moduleId);
                    const parameter = module?.parameters.find((item) => item.id === parameterId);
                    const effective = parameter
                      ? getEffectiveMotionValue(parameter.value, assignment, xyPosition)
                      : 0;
                    return (
                      <article className={`motion-route axis-${assignment.axis}`} key={assignment.id}>
                        <header>
                          <b>{assignment.axis.toUpperCase()}</b>
                          <div>
                            <strong>{module?.name ?? moduleId} · {parameter?.label ?? parameterId}</strong>
                            <span>{Math.round((parameter?.value ?? 0) * 100)} → {Math.round(effective * 100)}</span>
                          </div>
                          <button type="button" onClick={() => disconnectPatch(assignment.target)} aria-label="Disconnect patch">×</button>
                        </header>
                        <label className="route-depth">
                          <span>DEPTH</span>
                          <input type="range" min="0" max="1" step="0.01" value={assignment.depth} onChange={(event: ReactChangeEvent<HTMLInputElement>) => updateMotionRoute(assignment.id, { depth: Number(event.target.value) })} />
                          <strong>{Math.round(assignment.depth * 100)}</strong>
                        </label>
                        <div className="route-axis" role="group" aria-label="Motion axis">
                          <button type="button" className={assignment.axis === 'x' ? 'active' : ''} aria-pressed={assignment.axis === 'x'} onClick={() => updateMotionRoute(assignment.id, { axis: 'x' })}>X</button>
                          <button type="button" className={assignment.axis === 'y' ? 'active' : ''} aria-pressed={assignment.axis === 'y'} onClick={() => updateMotionRoute(assignment.id, { axis: 'y' })}>Y</button>
                        </div>
                        <details>
                          <summary>MORE</summary>
                          <div className="route-controls">
                            <label><span>MIN {Math.round((assignment.min ?? 0) * 100)}</span><input type="range" min="0" max="1" step="0.01" value={assignment.min ?? 0} onChange={(event: ReactChangeEvent<HTMLInputElement>) => updateMotionRoute(assignment.id, { min: Number(event.target.value) })} /></label>
                            <label><span>MAX {Math.round((assignment.max ?? 1) * 100)}</span><input type="range" min="0" max="1" step="0.01" value={assignment.max ?? 1} onChange={(event: ReactChangeEvent<HTMLInputElement>) => updateMotionRoute(assignment.id, { max: Number(event.target.value) })} /></label>
                          </div>
                          <div className="route-options">
                            <select aria-label="Motion curve" value={assignment.curve ?? 'soft'} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => updateMotionRoute(assignment.id, { curve: event.target.value as MotionCurve })}><option value="linear">Linear</option><option value="soft">Soft</option><option value="exponential">Expo</option><option value="stepped">Steps</option></select>
                            <select aria-label="Motion response" value={assignment.smoothing ?? 'medium'} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => updateMotionRoute(assignment.id, { smoothing: event.target.value as MotionSmoothing })}><option value="fast">Fast</option><option value="medium">Medium</option><option value="slow">Slow</option></select>
                            <button type="button" className={assignment.inverted ? 'active' : ''} aria-pressed={assignment.inverted} title="Invert this motion source" onClick={() => updateMotionRoute(assignment.id, { inverted: !assignment.inverted })}>INV</button>
                          </div>
                        </details>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className={`sample-recorder state-${recordingState}`}>
              <div className="recorder-heading">
                <div className="recorder-title">
                  <span className={`record-led ${recordingState === 'recording' ? 'active' : recordedTake ? 'ready' : ''}`} aria-hidden="true" />
                  <strong>RECORDER</strong>
                  <small>{recordingState === 'recording' ? 'RECORDING' : recordedTake ? 'TAKE READY' : isRunning ? 'ARMED' : 'STANDBY'}</small>
                </div>
                <time>{formatDuration(recordingSeconds)}</time>
              </div>

              <input
                className="sample-name"
                type="text"
                aria-label="Sample name"
                maxLength={64}
                value={recordingName}
                disabled={recordingState === 'recording'}
                onChange={(event: ReactChangeEvent<HTMLInputElement>) => setRecordingName(event.target.value)}
                onBlur={() => setRecordingName((current) => sanitizeFileName(current))}
                placeholder="calcotone-sample"
              />

              <div className="recorder-controls">
                {recordingState === 'recording' ? (
                  <button type="button" className="record-stop" onClick={() => void finishRecording()}>STOP</button>
                ) : (
                  <button type="button" className="record-start" disabled={!isRunning} title={isRunning ? 'Record the final stereo output' : 'Power on CALCOTONE to record'} onClick={startRecording}>REC</button>
                )}
                <button type="button" disabled={!recordedTake || recordingState === 'recording'} onClick={saveRecording}>SAVE</button>
                <button
                  type="button"
                  className={recordingState === 'recording' ? 'record-cancel' : ''}
                  disabled={!recordedTake && recordingState !== 'recording'}
                  onClick={discardRecording}
                  title={recordingState === 'recording' ? 'Cancel the current recording' : 'Clear the captured take'}
                >
                  {recordingState === 'recording' ? 'CANCEL' : 'CLEAR'}
                </button>
              </div>

              {previewUrl && recordedTake && (
                <div className="take-preview">
                  <audio controls preload="metadata" src={previewUrl} />
                  <div>
                    <span>{recordedTake.sampleRate} Hz · {recordedTake.bitDepth}-bit · Stereo</span>
                    <span>{formatBytes(recordedTake.blob.size)} · Peak {formatPeak(recordedTake.peak)}</span>
                  </div>
                </div>
              )}
            </section>
          </aside>
        </section>

        <footer className="footer-bar">
          <p role="status" aria-live="polite">{message}</p>
          <div className="footer-actions">
            <span><i className={isRunning ? 'active' : ''} />{isRunning ? 'LIVE' : 'STANDBY'}</span>
            <span><i className={xyAssignments.length ? 'active' : ''} />{xyAssignments.length} PATCHES</span>
            <span><i className={recordingState === 'recording' ? 'recording' : recordedTake ? 'active' : ''} />{recordingState === 'recording' ? `REC ${formatDuration(recordingSeconds)}` : recordedTake ? 'TAKE READY' : 'REC READY'}</span>
            <button
              type="button"
              className={`footer-safe-toggle ${adaptiveMode ? 'active' : ''}`}
              onClick={toggleAdaptiveMode}
              aria-pressed={adaptiveMode}
              title={adaptiveMode ? 'Safe mode enabled — click to disable adaptive DSP protection' : 'Safe mode disabled — click to enable adaptive DSP protection'}
            >
              <i aria-hidden="true" />
              SAFE
            </button>
            <button
              type="button"
              className={`footer-safe-toggle footer-fullscreen-toggle ${isFullscreen ? 'active' : ''}`}
              onClick={() => void toggleFullscreen()}
              aria-pressed={isFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              <i aria-hidden="true" />
              FULLSCREEN
            </button>
          </div>
        </footer>
      </main>
      </div>

        {persistentPatchLines.length > 0 && (
          <svg className="persistent-patch-layer" aria-hidden="true">
            {persistentPatchLines.map((line) => (
              <path
                key={line.id}
                className={`axis-${line.axis}`}
                d={createPatchPath(
                  line.startX,
                  line.startY,
                  line.endX,
                  line.endY
                )}
              />
            ))}
          </svg>
        )}

        {patchDraft && (
          <svg className="live-patch-layer" aria-hidden="true">
            <path
              d={createPatchPath(
                patchDraft.startX,
                patchDraft.startY,
                patchDraft.pointerX,
                patchDraft.pointerY
              )}
            />
            <circle cx={patchDraft.startX} cy={patchDraft.startY} r="6" />
            <circle cx={patchDraft.pointerX} cy={patchDraft.pointerY} r="7" />
          </svg>
        )}

    </div>
  );
}

function EffectModule({
  module,
  slotLabel,
  onToggle,
  onParameterChange,
  onDelayAlgorithmChange,
  onAlgorithmChange,
  onMediaModeChange,
  onEmberModeChange,
  onDriftModeChange,
  onGrainModeChange,
  visualState,
  assignments,
  xyPosition,
  onPatchStart,
  onPatchMove,
  onPatchEnd,
  onPatchDisconnect,
  routingDragging,
  routingDropTarget,
  onRoutingDragStart,
  onRoutingDragOver,
  onRoutingDrop,
  onRoutingDragEnd,
  onRoutingNudge,
}: {
  module: ModuleState;
  slotLabel: string;
  onToggle: () => void;
  onParameterChange: (parameterId: string, value: number) => void;
  onDelayAlgorithmChange: (algorithm: DelayAlgorithm) => void;
  onAlgorithmChange: (algorithm: ReverbAlgorithm) => void;
  onMediaModeChange: (mode: MediaMode) => void;
  onEmberModeChange: (mode: EmberMode) => void;
  onDriftModeChange: (mode: DriftMode) => void;
  onGrainModeChange: (mode: GrainMode) => void;
  visualState: VisualAudioState;
  assignments: XYAssignment[];
  xyPosition: { x: number; y: number };
  onPatchStart: (
    target: string,
    label: string,
    startX: number,
    startY: number,
    pointerX: number,
    pointerY: number
  ) => void;
  onPatchMove: (pointerX: number, pointerY: number) => void;
  onPatchEnd: (pointerX: number, pointerY: number) => void;
  onPatchDisconnect: (target: string) => void;
  routingDragging: boolean;
  routingDropTarget: boolean;
  onRoutingDragStart: (event: ReactDragEvent<HTMLDivElement>) => void;
  onRoutingDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  onRoutingDrop: (event: ReactDragEvent<HTMLElement>) => void;
  onRoutingDragEnd: () => void;
  onRoutingNudge: (direction: -1 | 1) => void;
}) {
  const moduleStyle = {
    '--module-activity': module.enabled ? 1 : 0,
    '--module-low': visualState.low,
    '--module-mid': visualState.mid,
    '--module-high': visualState.high,
    '--module-delay': `${(Number(slotLabel.slice(1)) - 1) * 65}ms`,
  } as CSSProperties;

  return (
    <article
      className={`effect-module module-${module.id} ${
        module.enabled ? 'enabled' : ''
      } ${!module.available ? 'unavailable' : ''} ${
        routingDragging ? 'routing-dragging' : ''
      } ${routingDropTarget ? 'routing-drop-target' : ''}`}
      style={moduleStyle}
      onDragOver={onRoutingDragOver}
      onDrop={onRoutingDrop}
    >
      <header className="module-header">
        <div
          className="module-title module-drag-handle"
          draggable={module.available}
          role="button"
          tabIndex={module.available ? 0 : -1}
          aria-label={`${module.name}, signal slot ${slotLabel}. Drag or use left and right arrow keys to reorder.`}
          onDragStart={onRoutingDragStart}
          onDragEnd={onRoutingDragEnd}
          onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
            if (!module.available) return;
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              onRoutingNudge(-1);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              onRoutingNudge(1);
            }
          }}
          title="Drag horizontally · or focus and use ← / → to reorder"
        >
          <span className="module-number" aria-hidden="true">{slotLabel}</span>
          <span className="module-jewel" aria-hidden="true" />
          <h3>{module.name}</h3>
          <span className="module-route-cue" aria-hidden="true">↔</span>
        </div>

        <div className="module-header-control">
          {module.id === 'delay' && (
            <label className="algorithm-selector halo-algorithm-selector">
              <span className="sr-only">Mode</span>
              <select
                aria-label="Halo mode"
                value={module.delayAlgorithm ?? 'tape'}
                onChange={(event: ReactChangeEvent<HTMLSelectElement>) =>
                  onDelayAlgorithmChange(event.target.value as DelayAlgorithm)
                }
              >
                {DELAY_ALGORITHMS.map((algorithm) => (
                  <option key={algorithm} value={algorithm}>
                    {formatAlgorithmName(algorithm)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {module.id === 'saturation' && (
            <label className="algorithm-selector"><span className="sr-only">Ember mode</span><select aria-label="Ember mode" value={module.emberMode ?? 'velvet'} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onEmberModeChange(event.target.value as EmberMode)}>{EMBER_MODE_ORDER.map((mode) => <option key={mode} value={mode}>{mode.charAt(0).toUpperCase()+mode.slice(1)}</option>)}</select></label>
          )}
          {module.id === 'chorus' && (
            <label className="algorithm-selector"><span className="sr-only">Drift mode</span><select aria-label="Drift mode" value={module.driftMode ?? 'chorus'} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onDriftModeChange(event.target.value as DriftMode)}>{DRIFT_MODE_ORDER.map((mode) => <option key={mode} value={mode}>{mode.charAt(0).toUpperCase()+mode.slice(1)}</option>)}</select></label>
          )}

          {module.id === 'bitcrusher' && (
            <label className="algorithm-selector grain-mode-selector">
              <span className="sr-only">Grain mode</span>
              <select
                aria-label="Grain mode"
                value={module.grainMode ?? 'reconstruct'}
                onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onGrainModeChange(event.target.value as GrainMode)}
              >
                {GRAIN_MODE_ORDER.map((mode) => (
                  <option key={mode} value={mode}>{mode.charAt(0).toUpperCase()+mode.slice(1)}</option>
                ))}
              </select>
            </label>
          )}

          {module.id === 'reverb' && (
            <label className="algorithm-selector">
              <span className="sr-only">Space</span>
              <select
                aria-label="Atmos space"
                value={module.algorithm ?? 'hall'}
                onChange={(event: ReactChangeEvent<HTMLSelectElement>) =>
                  onAlgorithmChange(event.target.value as ReverbAlgorithm)
                }
              >
                {REVERB_ALGORITHMS.map((algorithm) => (
                  <option key={algorithm} value={algorithm}>
                    {algorithm.charAt(0).toUpperCase() + algorithm.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {module.id === 'media' && (
            <label className="algorithm-selector media-mode-selector">
              <span className="sr-only">Format</span>
              <select
                aria-label="Artifact format"
                value={module.mediaMode ?? 'cassette'}
                onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onMediaModeChange(event.target.value as MediaMode)}
              >
                {MEDIA_MODE_ORDER.map((mode) => <option key={mode} value={mode}>{mode.charAt(0).toUpperCase()+mode.slice(1)}</option>)}
              </select>
            </label>
          )}
        </div>

        <button
          type="button"
          className="module-toggle"
          disabled={!module.available}
          onClick={onToggle}
          aria-label={`${module.enabled ? 'Bypass' : 'Enable'} ${module.name}`}
          aria-pressed={module.enabled}
        >
          <span />
        </button>
      </header>

      <ModuleViewport module={module} visualState={visualState} />

      <div className="knob-row">
        {module.parameters.map((parameter) => {
          const assignment = assignments.find(
            (candidate) => candidate.target === `${module.id}.${parameter.id}`
          );
          const effectiveValue = assignment
            ? getEffectiveMotionValue(parameter.value, assignment, xyPosition)
            : parameter.value;
          return (
          <Knob
            key={parameter.id}
            label={parameter.label}
            value={parameter.value}
            effectiveValue={effectiveValue}
            display={parameter.display}
            disabled={!module.available}
            patchTarget={`${module.id}.${parameter.id}`}
            assignment={assignment}
            onReset={() => onParameterChange(parameter.id, getDefaultParameterValue(module.id, parameter.id))}
            onChange={(value) => onParameterChange(parameter.id, value)}
            onPatchStart={(startX, startY, pointerX, pointerY) =>
              onPatchStart(
                `${module.id}.${parameter.id}`,
                `${module.name} ${parameter.label}`,
                startX,
                startY,
                pointerX,
                pointerY
              )
            }
            onPatchMove={onPatchMove}
            onPatchEnd={onPatchEnd}
            onPatchDisconnect={() =>
              onPatchDisconnect(`${module.id}.${parameter.id}`)
            }
          />
          );
        })}
      </div>

      {!module.available && (
        <div className="coming-soon">DSP not connected</div>
      )}
    </article>
  );
}


type ViewportRenderCallback = (time: number) => void;

const viewportRenderCallbacks = new Set<ViewportRenderCallback>();
let viewportAnimationFrame = 0;

function runViewportAnimationFrame(time: number): void {
  viewportRenderCallbacks.forEach((callback) => callback(time));
  viewportAnimationFrame = requestAnimationFrame(runViewportAnimationFrame);
}

function subscribeViewportAnimation(callback: ViewportRenderCallback): () => void {
  viewportRenderCallbacks.add(callback);
  if (viewportRenderCallbacks.size === 1) {
    viewportAnimationFrame = requestAnimationFrame(runViewportAnimationFrame);
  }
  return () => {
    viewportRenderCallbacks.delete(callback);
    if (viewportRenderCallbacks.size === 0 && viewportAnimationFrame) {
      cancelAnimationFrame(viewportAnimationFrame);
      viewportAnimationFrame = 0;
    }
  };
}

type OrbitalBody = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  radius: number;
  speed: number;
  trail: { x: number; y: number }[];
};

function XYSignalField({
  modules,
  assignments,
  position,
  dragging,
}: {
  modules: ModuleState[];
  assignments: XYAssignment[];
  position: { x: number; y: number };
  dragging: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modulesRef = useRef(modules);
  const assignmentsRef = useRef(assignments);
  const positionRef = useRef(position);
  const draggingRef = useRef(dragging);
  modulesRef.current = modules;
  assignmentsRef.current = assignments;
  positionRef.current = position;
  draggingRef.current = dragging;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;

    let width = 1;
    let height = 1;
    let dpr = Math.min(1.5, window.devicePixelRatio || 1);
    let lastTime = performance.now();
    let attractX = .5;
    let attractY = .5;
    let disturbance = 0;

    const BODY_COUNT = 11;
    const bodies: OrbitalBody[] = Array.from({ length: BODY_COUNT }, (_, i) => ({
      x: .5,
      y: .5,
      vx: 0,
      vy: 0,
      phase: (i / BODY_COUNT) * Math.PI * 2 + Math.sin(i * 2.31) * .18,
      radius: .22 + (i % 4) * .064,
      speed: .26 + i * .034,
      trail: [],
    }));

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const w = Math.round(width * dpr);
      const h = Math.round(height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const valueOf = (module: ModuleState | undefined, id: string, fallback = 0) =>
      module?.parameters.find((parameter) => parameter.id === id)?.value ?? fallback;

    const render: ViewportRenderCallback = (stamp) => {
      const dt = Math.min(.033, Math.max(.001, (stamp - lastTime) / 1000));
      lastTime = stamp;
      const t = stamp / 1000;
      const active = modulesRef.current.filter((module) => module.enabled && module.available);
      const byId = (id: string) => active.find((module) => module.id === id);

      const ember = byId('saturation');
      const drift = byId('chorus');
      const halo = byId('delay');
      const atmos = byId('reverb');
      const grain = byId('bitcrusher');
      const artifact = byId('media');

      const emberMix = valueOf(ember, 'mix');
      const drive = valueOf(ember, 'drive');
      const heat = valueOf(ember, 'heat');
      const driftMix = valueOf(drift, 'mix');
      const driftRate = valueOf(drift, 'rate');
      const driftDepth = valueOf(drift, 'depth');
      const spread = valueOf(drift, 'spread');
      const haloMix = valueOf(halo, 'mix');
      const haloTime = valueOf(halo, 'time');
      const feedback = valueOf(halo, 'feedback');
      const haloWidth = valueOf(halo, 'width');
      const atmosMix = valueOf(atmos, 'mix');
      const size = valueOf(atmos, 'size');
      const decay = valueOf(atmos, 'decay');
      const diffusion = valueOf(atmos, 'diffusion');
      const grainMix = valueOf(grain, 'mix');
      const density = valueOf(grain, 'density');
      const grainPitch = valueOf(grain, 'pitch');
      const chaos = valueOf(grain, 'chaos');
      const wear = valueOf(artifact, 'wear');
      const wow = valueOf(artifact, 'wow');
      const noise = valueOf(artifact, 'noise');
      const artifactMix = valueOf(artifact, 'mix');
      const activeMixes = [emberMix, driftMix, haloMix, atmosMix, grainMix, artifactMix].filter((value) => value > 0);
      const mixEnergy = activeMixes.length
        ? activeMixes.reduce((sum, value) => sum + value, 0) / activeMixes.length
        : 0;

      const targetX = positionRef.current.x / 100;
      const targetY = 1 - positionRef.current.y / 100;
      const follow = draggingRef.current ? .18 : .055;
      attractX += (targetX - attractX) * follow;
      attractY += (targetY - attractY) * follow;
      disturbance += ((draggingRef.current ? 1 : 0) - disturbance) * (draggingRef.current ? .12 : .025);

      const centerX = width * .5;
      const centerY = height * .5;
      const cursorX = attractX * width;
      const cursorY = attractY * height;
      const baseScale = Math.min(width, height);
      const sculptureScale = 1.10 + mixEnergy * .34;
      const atmosExpansion = atmos ? 1 + size * atmosMix * 1.05 : 1;
      const driftSpin = drift ? (.10 + driftRate * .42) * driftMix : 0;
      const trailLength = Math.round(62 + (halo ? (36 + haloTime * 108 + feedback * 94) * haloMix : 0) + decay * atmosMix * 42);
      const trailAlpha = .32 + haloMix * .34 + atmosMix * .14;

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      // Quiet instrument field. The sculpture, not a grid, owns the visual hierarchy.
      context.strokeStyle = 'rgba(185,205,193,.025)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(width * .5, 0); context.lineTo(width * .5, height);
      context.moveTo(0, height * .5); context.lineTo(width, height * .5);
      context.stroke();

      const moduleColor = (moduleId: string): [number, number, number] =>
        moduleId === 'saturation' ? [241,153,66] :
        moduleId === 'chorus' ? [68,214,232] :
        moduleId === 'delay' ? [166,112,255] :
        moduleId === 'reverb' ? [72,133,255] :
        moduleId === 'bitcrusher' ? [236,88,207] :
        moduleId === 'media' ? [214,139,72] :
        [128,160,142];

      const visualOwners = active.length ? active : modulesRef.current.slice(0, 1);
      const ownerForBody = (bodyIndex: number) =>
        visualOwners[bodyIndex % Math.max(1, visualOwners.length)];

      const moduleLineColor = (
        moduleId: string,
        alpha: number,
        variation = 0
      ) => {
        const [baseR, baseG, baseB] = moduleColor(moduleId);
        const scale = 1 + Math.sin(variation) * 0.05;
        const r = Math.round(Math.max(0, Math.min(255, baseR * scale)));
        const g = Math.round(Math.max(0, Math.min(255, baseG * scale)));
        const b = Math.round(Math.max(0, Math.min(255, baseB * scale)));
        return `rgba(${r},${g},${b},${Math.max(0,Math.min(1,alpha))})`;
      };

      bodies.forEach((body, i) => {
        const owner = ownerForBody(i);
        const ownerId = owner?.id ?? 'saturation';
        const direction = i % 2 ? -1 : 1;
        const phase = body.phase + t * body.speed * (1 + driftSpin * 1.7) * direction;
        const eccentric = 1 + Math.sin(t * .13 + i * 1.7) * .055;
        const radius = body.radius * baseScale * sculptureScale * atmosExpansion * eccentric;
        const wide = 1 + spread * driftMix * (i % 2 ? .18 : -.08);

        let homeX = centerX + Math.cos(phase) * radius * wide;
        let homeY = centerY + Math.sin(phase * (1 + driftDepth * driftMix * .09)) * radius * .56;

        // Ember changes trajectory material: tension and harmonic faceting.
        if (ember) {
          const facets = 7 + Math.round(heat * 5);
          const snap = Math.round(phase / (Math.PI * 2 / facets)) * (Math.PI * 2 / facets);
          const amount = emberMix * (.08 + drive * .30);
          homeX += (centerX + Math.cos(snap) * radius - homeX) * amount;
          homeY += (centerY + Math.sin(snap) * radius * .56 - homeY) * amount;
        }

        // Artifact damages the continuity rather than drawing an Artifact object.
        if (artifact) {
          const mode = artifact.mediaMode ?? 'cassette';
          const modeScale = mode === 'vinyl' ? .65 : mode === 'vhs' ? 1.15 : mode === 'broken' ? 1.45 : 1;
          homeX += Math.sin(t * (.7 + wow * 1.2) + i * 2.1) * baseScale * .018 * artifactMix * modeScale;
          homeY += Math.cos(t * (.46 + wear) + i * 1.3) * baseScale * .012 * artifactMix * modeScale;
          if (mode === 'vinyl') homeX += Math.sin(t * 1.9 + i) * baseScale * .004 * wear;
          if (mode === 'vhs') homeX += Math.sin(t * 3.1 + i * .4) * baseScale * .012 * artifactMix;
        }

        // XY is an external gravitational disturbance, not the sculpture's permanent center.
        const dx = cursorX - body.x;
        const dy = cursorY - body.y;
        const dist = Math.max(18, Math.hypot(dx, dy));
        const gravity = (.010 + disturbance * .082) * (1 / (1 + dist / (baseScale * .40)));
        let fx = (homeX - body.x) * (.040 + diffusion * atmosMix * .018);
        let fy = (homeY - body.y) * (.040 + diffusion * atmosMix * .018);
        fx += dx * gravity;
        fy += dy * gravity;

        // Drift bends the entire orbital system.
        if (drift) {
          const ox = body.x - centerX;
          const oy = body.y - centerY;
          const od = Math.max(20, Math.hypot(ox, oy));
          fx += (-oy / od) * driftDepth * driftMix * 5.2;
          fy += (ox / od) * driftDepth * driftMix * 5.2;
        }

        // Grain creates tiny physical emissions from existing bodies.
        if (grain) {
          const jitter = chaos * grainMix * .58;
          fx += Math.sin(t * (2.1 + grainPitch * 2.8) + i * 4.1) * jitter;
          fy += Math.cos(t * (1.7 + grainPitch * 2.2) + i * 3.3) * jitter;
        }

        body.vx = (body.vx + fx * dt * 60) * (.885 - disturbance * .025);
        body.vy = (body.vy + fy * dt * 60) * (.885 - disturbance * .025);
        body.x += body.vx * dt * 60;
        body.y += body.vy * dt * 60;

        body.trail.unshift({ x: body.x, y: body.y });
        if (body.trail.length > trailLength) body.trail.length = trailLength;

        // Halo turns motion history into separated ghost reflections.
        const ghostStride = halo ? Math.max(4, Math.round(5 + haloTime * 13)) : 9999;
        const ghostCount = halo ? 1 + Math.round(feedback * haloMix * 4) : 0;

        for (let ghost = ghostCount; ghost >= 0; ghost--) {
          const offset = ghost * ghostStride;
          if (offset >= body.trail.length - 2) continue;
          const points = body.trail.slice(offset);
          const ghostOffset = ghost && halo ? (i % 2 ? -1 : 1) * haloWidth * haloMix * ghost * (3.4 + diffusion * atmosMix * 2.8) : 0;
          context.beginPath();
          points.forEach((point, index) => {
            if (index === 0) context.moveTo(point.x + ghostOffset, point.y);
            else context.lineTo(point.x + ghostOffset, point.y);
          });
          const fade = ghost === 0 ? 1 : Math.max(.12, .52 - ghost * .09);
          const vinylLoss = artifact?.mediaMode === 'vinyl' ? 1 - artifactMix * (.18 + wear * .30) : 1;
          const staticLoss = artifact ? 1 - noise * artifactMix * .22 : 1;
          const alpha = (trailAlpha + mixEnergy * .20) * fade * vinylLoss * staticLoss;
          const phaseShift = ghost * .9 + haloTime * 2.1;

          // Wide diffused under-stroke creates the psychedelic light-volume without audio flashing.
          context.save();
          context.strokeStyle = moduleLineColor(ownerId, alpha * (.20 + diffusion * atmosMix * .28), i + phaseShift);
          context.lineWidth = ghost === 0 ? 4.4 + diffusion * atmosMix * 5.6 : 2.8 + diffusion * atmosMix * 3.2;
          context.globalCompositeOperation = 'lighter';
          context.globalAlpha = .72;
          context.stroke();
          context.restore();

          // Brighter filament core.
          context.strokeStyle = moduleLineColor(ownerId, alpha, i + phaseShift);
          context.lineWidth = ghost === 0 ? 1.65 + diffusion * atmosMix * 1.35 : 1.05;
          context.stroke();
        }

      });

      // Grain contributes a dedicated particle field instead of cutting holes into the light trails.
      if (grain && grainMix > .01) {
        const particleCount = Math.round(18 + density * grainMix * 54);
        for (let p = 0; p < particleCount; p++) {
          const seed = p * 12.9898;
          const orbit = t * (.16 + grainPitch * .42) + seed;
          const ring = .12 + ((p % 9) / 9) * (.30 + density * .18);
          const chaosPush = chaos * grainMix * .09;
          const px =
            centerX +
            Math.cos(orbit * (1 + (p % 3) * .06)) * baseScale * ring * sculptureScale +
            Math.sin(seed * 1.7 + t * 1.1) * baseScale * chaosPush;
          const py =
            centerY +
            Math.sin(orbit * .83 + p * .31) * baseScale * ring * .62 * sculptureScale +
            Math.cos(seed * 1.13 - t * .9) * baseScale * chaosPush * .7;

          // XY disturbance gently bends the particle cloud too.
          const pdx = cursorX - px;
          const pdy = cursorY - py;
          const pd = Math.max(18, Math.hypot(pdx, pdy));
          const particleGravity = disturbance * grainMix * .14 * (1 / (1 + pd / (baseScale * .3)));
          const gx = px + pdx * particleGravity;
          const gy = py + pdy * particleGravity;

          const sparkle = .45 + .55 * Math.sin(t * (.34 + (p % 5) * .03) + seed);
          const sizePx = .8 + (p % 4) * .32 + grainMix * .7;
          context.fillStyle = moduleLineColor('bitcrusher', .10 + grainMix * (.16 + sparkle * .10), seed * .03);
          context.fillRect(gx - sizePx * .5, gy - sizePx * .5, sizePx, sizePx);
        }
      }

      // The XY control remains unmistakable, but visually secondary to the sculpture.
      context.save();
      if (draggingRef.current) {
        context.setLineDash([3, 6]);
        context.strokeStyle = 'rgba(235,248,240,.13)';
        context.lineWidth = .75;
        context.beginPath(); context.moveTo(cursorX, 0); context.lineTo(cursorX, height); context.stroke();
        context.beginPath(); context.moveTo(0, cursorY); context.lineTo(width, cursorY); context.stroke();
        context.setLineDash([]);
      }
      context.strokeStyle = 'rgba(248,255,251,.92)';
      context.lineWidth = 1;
      context.beginPath(); context.arc(cursorX, cursorY, 4.5 + disturbance * 2.5, 0, Math.PI * 2); context.stroke();
      context.beginPath();
      context.moveTo(cursorX - 10, cursorY); context.lineTo(cursorX - 6, cursorY);
      context.moveTo(cursorX + 6, cursorY); context.lineTo(cursorX + 10, cursorY);
      context.moveTo(cursorX, cursorY - 10); context.lineTo(cursorX, cursorY - 6);
      context.moveTo(cursorX, cursorY + 6); context.lineTo(cursorX, cursorY + 10);
      context.stroke();
      context.restore();
    };

    const unsubscribe = subscribeViewportAnimation(render);
    return () => {
      unsubscribe();
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="xy-signal-field" aria-hidden="true" />;
}

function ModuleViewport({
  module,
  visualState,
}: {
  module: ModuleState;
  visualState: VisualAudioState;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const moduleRef = useRef(module);
  moduleRef.current = module;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;

    let cssWidth = 1;
    let cssHeight = 1;
    let pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);

    const resizeCanvas = (): void => {
      const rect = canvas.getBoundingClientRect();
      cssWidth = Math.max(1, rect.width);
      cssHeight = Math.max(1, rect.height);
      pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
      const nextWidth = Math.max(1, Math.round(cssWidth * pixelRatio));
      const nextHeight = Math.max(1, Math.round(cssHeight * pixelRatio));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
    };

    resizeCanvas();
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);

    const render: ViewportRenderCallback = (time) => {
      const currentModule = moduleRef.current;
      if (!currentModule.enabled) return;

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const currentParams: Record<string, number> = {};
      for (const parameter of currentModule.parameters) {
        currentParams[parameter.id] = parameter.value;
      }

      drawModuleViewport(
        context,
        cssWidth,
        cssHeight,
        currentModule,
        visualState,
        currentParams,
        time / 1000
      );
    };

    const unsubscribe = subscribeViewportAnimation(render);
    return () => {
      unsubscribe();
      resizeObserver.disconnect();
    };
  }, [module.id, module.mediaMode]);

  return (
    <div className={`dsp-viewport viewport-${module.id} ${module.enabled ? 'active' : ''}`}>
      <div className="viewport-glass" aria-hidden="true" />
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="viewport-caption">{getViewportCaption(module)}</span>
    </div>
  );
}

function getViewportCaption(module: ModuleState): string {
  if (module.id === 'delay') return formatAlgorithmName(module.delayAlgorithm ?? 'tape');
  if (module.id === 'reverb') return (module.algorithm ?? 'hall').toUpperCase();
  if (module.id === 'media') return (module.mediaMode ?? 'cassette').toUpperCase();
  if (module.id === 'bitcrusher') return (module.grainMode ?? 'reconstruct').toUpperCase();
  if (module.id === 'chorus') return 'PHASE CURRENT';
  if (module.id === 'saturation') return 'THERMAL REACTOR';
  return 'THERMAL CORE';
}

function drawModuleViewport(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  module: ModuleState,
  _audio: VisualAudioState,
  params: Record<string, number>,
  time: number
) {
  ctx.clearRect(0, 0, width, height);
  if (!module.enabled) {
    ctx.fillStyle = 'rgb(0,0,0)';
    ctx.fillRect(0, 0, width, height);
    return;
  }

  // Visual Worlds are deliberately non-reactive: audio level/transients never alter brightness,
  // opacity, color, bloom or animation speed. Motion is driven only by time and module parameters.
  const activity = .42;
  const transient = 0;
  const cx = width / 2;
  const cy = height / 2;
  const mode = module.id === 'saturation' ? (module.emberMode ?? 'velvet')
    : module.id === 'chorus' ? (module.driftMode ?? 'chorus')
    : module.id === 'delay' ? (module.delayAlgorithm ?? 'tape')
    : module.id === 'reverb' ? (module.algorithm ?? 'hall')
    : module.id === 'media' ? (module.mediaMode ?? 'cassette')
    : 'grain';

  const accent = module.id === 'saturation' ? [241, 153, 66]
    : module.id === 'chorus' ? [88, 205, 220]
    : module.id === 'delay' ? [161, 126, 255]
    : module.id === 'reverb' ? [86, 145, 255]
    : module.id === 'media' ? [202, 145, 91]
    : [223, 105, 197];
  const moduleMix = Math.max(0, Math.min(1, params.mix ?? 0.5));
  const lineWhiten = 0.10 + moduleMix * 0.70;
  const rgba = (alpha: number, whiten = false) => {
    const blend = whiten ? lineWhiten : 0;
    const red = Math.round(accent[0] + (255 - accent[0]) * blend);
    const green = Math.round(accent[1] + (255 - accent[1]) * blend);
    const blue = Math.round(accent[2] + (255 - accent[2]) * blend);
    return `rgba(${red},${green},${blue},${Math.max(0, Math.min(1, alpha))})`;
  };

  const bg = ctx.createRadialGradient(cx, cy, 4, cx, cy, width * .7);
  bg.addColorStop(0, rgba(.045 + activity * .12));
  bg.addColorStop(.58, 'rgba(4,7,11,.985)');
  bg.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const project = (x: number, y: number, z: number) => {
    const depth = 1 + z * .32;
    return [cx + x * depth, cy + y * depth - z * 8] as const;
  };
  const line = (a=.35, w=1.25) => { ctx.strokeStyle=rgba(a, true); ctx.lineWidth=w; };
  const cube = (scale = 1, alpha=.28) => {
    const points = [
      [-55,-35,-1],[55,-35,-1],[55,35,-1],[-55,35,-1],
      [-55,-35,1],[55,-35,1],[55,35,1],[-55,35,1],
    ].map(([x,y,z]) => project(x * scale, y * scale, z));
    const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    line(alpha + activity*.18, 1.25);
    edges.forEach(([a,b]) => { ctx.beginPath(); ctx.moveTo(...points[a]); ctx.lineTo(...points[b]); ctx.stroke(); });
  };
  const dot=(x:number,y:number,r=1.6,a=.6)=>{
    ctx.save();
    ctx.fillStyle=rgba(a);
    ctx.shadowColor=rgba(Math.min(.8,a));
    ctx.shadowBlur=3+r*1.8;
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
    ctx.restore();
  };
  const wave=(y:number,amp:number,freq:number,phase:number,a=.45)=>{
    line(a,1.35);ctx.beginPath();
    for(let x=-58;x<=58;x+=2){const p=project(x,y+Math.sin(x*freq+phase)*amp,Math.sin(x*.025+phase)*.35);x===-58?ctx.moveTo(...p):ctx.lineTo(...p);}
    ctx.stroke();
  };

  // EMBER — mode-specific circuitry: every algorithm gets its own electronic topology.
  if (module.id === 'saturation') {
    const heat=params.heat??.25, drive=params.drive??.2, char=params.character??.3;
    cube(1,.24);

    const node=(x:number,y:number,a=.55,r=1.25)=>dot(x,y,r,a);
    const trace=(points:[number,number][],a=.34,w=1.05)=>{
      line(a,w);ctx.beginPath();
      points.forEach(([x,y],i)=>i===0?ctx.moveTo(x,y):ctx.lineTo(x,y));
      ctx.stroke();
    };
    const resistor=(x:number,y:number,len=18,a=.42)=>{
      line(a,1.05);ctx.beginPath();ctx.moveTo(x-len/2,y);
      for(let i=0;i<=6;i++){const xx=x-len/2+(i/6)*len, yy=y+(i===0||i===6?0:(i%2?3:-3));ctx.lineTo(xx,yy);}
      ctx.stroke();
    };
    const coil=(x:number,y:number,turns=5,a=.4)=>{
      line(a,1.05);ctx.beginPath();
      for(let i=0;i<=turns*8;i++){const p=i/(turns*8),xx=x-18+p*36,yy=y+Math.sin(p*Math.PI*2*turns)*3.2;i===0?ctx.moveTo(xx,yy):ctx.lineTo(xx,yy);}
      ctx.stroke();
    };

    if(mode==='tube'){
      // Three valve stages with heater rails and animated plate current.
      for(let i=-1;i<=1;i++){
        const x=cx+i*32;
        line(.42,1.15);ctx.strokeRect(x-8,cy-22,16,44);
        line(.30,1);ctx.beginPath();ctx.moveTo(x-5,cy-11);ctx.lineTo(x+5,cy-11);ctx.moveTo(x-5,cy);ctx.lineTo(x+5,cy);ctx.moveTo(x-5,cy+11);ctx.lineTo(x+5,cy+11);ctx.stroke();
        const pulse=(Math.sin(time*.7+i)+1)*.5;
        node(x,cy-17+pulse*34,.40+heat*.28,1.15+drive*.7);
      }
      trace([[cx-48,cy+27],[cx+48,cy+27]],.25,1);
      trace([[cx-48,cy-27],[cx+48,cy-27]],.25,1);
    } else if(mode==='transformer'){
      // Coupled windings and a moving magnetic flux bridge.
      coil(cx-25,cy-8,6,.44);coil(cx+25,cy-8,6,.44);
      coil(cx-25,cy+9,6,.32);coil(cx+25,cy+9,6,.32);
      const flux=Math.sin(time*.42)*(3+heat*4);
      trace([[cx-4,cy-24+flux],[cx+4,cy-24-flux],[cx+4,cy+24+flux],[cx-4,cy+24-flux],[cx-4,cy-24+flux]],.25+drive*.22,1.1);
      node(cx-49,cy-8,.45);node(cx+49,cy-8,.45);
    } else if(mode==='console'){
      // Console bus: parallel channel strips feeding a summing backbone.
      for(let row=-3;row<=3;row++){
        const y=cy+row*8;
        trace([[cx-49,y],[cx-30,y],[cx-24,y+(row%2?3:-3)],[cx-10,y+(row%2?3:-3)]],.24+Math.abs(row)*.025);
        resistor(cx,y+(row%2?3:-3),18,.34+drive*.18);
        trace([[cx+10,y+(row%2?3:-3)],[cx+22,y],[cx+37,y],[cx+37,cy]],.27);
        node(cx-30,y,.35,1);node(cx+22,y,.35,1);
      }
      trace([[cx+37,cy-30],[cx+37,cy+30],[cx+49,cy+30]],.48,1.3);
    } else if(mode==='exciter'){
      // Harmonic multiplier lattice: signal branches into progressively finer paths.
      trace([[cx-50,cy],[cx-34,cy]],.48,1.3);
      for(let branch=-3;branch<=3;branch++){
        const y=cy+branch*8;
        const phase=Math.sin(time*.65+branch)*char*3;
        trace([[cx-34,cy],[cx-22,y],[cx+8,y+phase],[cx+22,cy]],.25+Math.abs(branch)*.035,1);
        node(cx-22,y,.34+heat*.18,1.05);
      }
      resistor(cx+31,cy,17,.48);trace([[cx+39,cy],[cx+50,cy]],.48,1.3);
    } else if(mode==='broken'){
      // Damaged board: interrupted traces, floating nodes and intermittent bridges.
      for(let i=0;i<12;i++){
        const row=(i%6)-2.5, y=cy+row*10;
        const x0=cx-48+(i%2)*7, gap=8+((i*7)%13);
        trace([[x0,y],[cx-gap,y]],.22+(i%4)*.055);
        trace([[cx+gap,y+(i%2?4:-4)],[cx+46,y+(i%2?4:-4)]],.22+(i%3)*.06);
        node(cx-gap,y,.25+(i%4)*.06,1);
        if(Math.sin(time*.5+i*2.7)>.45) trace([[cx-gap,y],[cx+gap,y+(i%2?4:-4)]],.16+char*.22,.8);
      }
    } else if(mode==='furnace'){
      // High-current power stage: rectifier-like diamonds and hot bus rails.
      trace([[cx-50,cy-25],[cx+50,cy-25]],.34,1.2);
      trace([[cx-50,cy+25],[cx+50,cy+25]],.34,1.2);
      for(let i=-3;i<=3;i++){
        const x=cx+i*14, wobble=Math.sin(time*.45+i)*heat*3;
        trace([[x,cy-25],[x-6,cy-10+wobble],[x,cy],[x+6,cy+10-wobble],[x,cy+25]],.30+drive*.22,1.15);
        node(x,cy,.38+heat*.30,1.1+heat*.6);
      }
    } else {
      // Velvet: a soft discrete ladder with gently breathing bias paths.
      for(let row=-2;row<=2;row++){
        const y=cy+row*11;
        const breathe=Math.sin(time*.28+row)*heat*2.5;
        trace([[cx-48,y],[cx-30,y],[cx-24,y+breathe]],.25);
        resistor(cx-14,y+breathe,18,.32+drive*.15);
        trace([[cx-5,y+breathe],[cx+13,y+breathe],[cx+20,y],[cx+45,y]],.27);
        node(cx-30,y,.30);node(cx+20,y,.30);
      }
      trace([[cx-40,cy-28],[cx-40,cy+28]],.18);
      trace([[cx+34,cy-28],[cx+34,cy+28]],.18);
    }
  }

  // DRIFT — a phase-current instrument: streamlines, stereo orbits and directional flow.
  else if (module.id === 'chorus') {
    const depth=params.depth??.3, rate=.35+(params.rate??.2)*1.7, spread=params.spread??.5, motion=params.motion??.3;
    cube(1,.24);
    // Drift remains fluid, but its flow now occupies the same visual volume as every other module.
    const fieldLeft=cx-50, fieldWidth=100;
    for(let i=0;i<8;i++){
      ctx.beginPath();
      for(let localX=0;localX<=fieldWidth;localX+=4){
        const x=fieldLeft+localX;
        const p=localX/fieldWidth;
        const base=cy+(i-3.5)*8;
        let y=base+Math.sin(p*Math.PI*2.4+time*rate+i*.62)*(3+depth*8);
        if(mode==='liquid') y+=Math.sin(p*Math.PI*5-time*.23+i)*5*motion;
        if(mode==='dimension') y+=(p-.5)*(i-3.5)*4*spread;
        localX===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
      }
      line(.19+i*.035,1.15);ctx.stroke();
    }
    if(mode==='rotary'||mode==='orbit'){
      const rings=mode==='orbit'?5:3;
      for(let i=0;i<rings;i++){const a=time*rate*(i%2?-.10:.12);line(.28+i*.045,1.2);ctx.beginPath();ctx.ellipse(cx,cy,18+i*8,9+i*4,a,0,Math.PI*2);ctx.stroke();const pa=time*rate+i*1.2;dot(cx+Math.cos(pa)*(18+i*8),cy+Math.sin(pa)*(9+i*4),1.4,.55);}
    } else if(mode==='doppler'){
      const sourceX=cx+Math.sin(time*rate*.7)*35;dot(sourceX,cy,2.4,.72);for(let i=0;i<6;i++){const rr=10+i*10+(time*rate*9)%10;line(.38-i*.04,1.1);ctx.beginPath();ctx.arc(sourceX,cy,rr,Math.PI*.72,Math.PI*1.28);ctx.stroke();}
    } else if(mode==='vibrato'){
      line(.62,1.4);ctx.beginPath();for(let x=0;x<=width;x+=3){const y=cy+Math.sin(x*.07+time*rate*1.7)*(5+depth*12);x===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.stroke();
    } else if(mode==='ensemble'){
      for(let i=0;i<5;i++){const pa=time*(.14+i*.011)+i*1.25;dot(cx+Math.cos(pa)*(22+i*5),cy+Math.sin(pa*.93)*(10+i*2),1.3,.42+i*.05);}
    }
  }

  // HALO — an echo/reflection tunnel: repeated fronts, nested depth planes and bounce paths.
  else if (module.id === 'delay') {
    const fb=params.feedback??.3, character=params.character??.2;
    cube(1,.24);
    // Halo's echo tunnel is contained inside the same chassis instead of becoming its own outer box.
    for(let i=0;i<5;i++){
      const k=i/4;
      const w=84*(1-k*.66),h=48*(1-k*.66);
      const ox=Math.sin(time*.035+i*.7)*1.5*character;
      line(.16+(1-k)*.20,1.05);ctx.strokeRect(cx-w/2+ox,cy-h/2,w,h);
    }
    if(mode==='pingpong'){
      let x=cx-43,y=cy-22;for(let i=0;i<8;i++){const nx=i%2?cx-35+i*3:cx+35-i*3;const ny=cy-22+i*6.2;line(.52-i*.04,1.25);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(nx,ny);ctx.stroke();dot(nx,ny,1.3,.55-i*.035);x=nx;y=ny;}
    } else if(mode==='diffuse'||mode==='constellation'){
      const count=mode==='constellation'?18:13;for(let i=0;i<count;i++){const a=i*2.399+time*.055,r=10+(i%6)*7;const x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r*.5;dot(x,y,1.2+(i%3)*.25,.32+(i%5)*.05);if(mode==='constellation'&&i>1&&i%2===0){line(.20,1);ctx.beginPath();ctx.moveTo(cx+Math.cos((i-2)*2.399+time*.055)*(10+((i-2)%6)*7),cy+Math.sin((i-2)*2.399+time*.055)*(10+((i-2)%6)*7)*.5);ctx.lineTo(x,y);ctx.stroke();}}
    } else if(mode==='scatter'){
      for(let i=0;i<16;i++){const a=i*4.13+time*.10;line(.20+(i%4)*.055,1);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.sin(a*1.7)*48,cy+Math.cos(a*.83)*25);ctx.stroke();}
    } else {
      // Clean/Tape/BBD: visible repeated echo fronts travelling down the tunnel.
      const count=5+Math.round(fb*5);
      for(let i=0;i<count;i++){const phase=(time*.10+i/count)%1;const w=12+phase*85,h=7+phase*49;line((1-phase)*.50,1.15);ctx.beginPath();ctx.ellipse(cx,cy,w/2,h/2,0,0,Math.PI*2);ctx.stroke();}
      if(mode==='bbd'){line(.18,1);for(let x=cx-42;x<=cx+42;x+=12){ctx.beginPath();ctx.moveTo(x,cy-25);ctx.lineTo(x,cy+25);ctx.stroke();}}
    }
  }

  // ATMOS — algorithms become different abstract architectural spaces.
  else if (module.id === 'reverb') {
    const size=.55+(params.size??.5)*.45, motion=params.motion??.2;
    if(mode==='room'||mode==='hall'||mode==='cinema'){
      // Keep the outer Atmos chassis-space identical to Ember/Drift.
      // Algorithm/Size differences live inside the frame instead of deforming the cube itself.
      cube(1,.24);
      const interiorScale = mode==='room' ? .68*size : mode==='hall' ? .82*size : .92*size;
      const columns=mode==='cinema'?7:mode==='hall'?5:3;
      line(.25,1.15);
      for(let i=0;i<columns;i++){
        const x=(-45+i*(90/Math.max(1,columns-1)))*interiorScale;
        const a=project(x,-30*interiorScale,-.72),b=project(x,30*interiorScale,.72);
        ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();
      }
    } else if(mode==='plate'){
      line(.55,1.4);ctx.strokeRect(cx-48*size,cy-27*size,96*size,54*size);for(let i=0;i<7;i++)wave((i-3)*6,2+motion*5,.09,time*.3+i,.26+i*.04);
    } else if(mode==='cloud'||mode==='nebula'){
      const n=mode==='nebula'?30:20;for(let i=0;i<n;i++){const a=i*2.399+time*(.03+motion*.05),r=8+(i%8)*7*size;dot(cx+Math.cos(a)*r,cy+Math.sin(a*1.13)*r*.48,1+(i%3)*.35,.22+(i%6)*.055);}
    } else if(mode==='freeze'){
      cube(1,.24);for(let i=0;i<9;i++){line(.22+i*.035,1.1);ctx.beginPath();ctx.ellipse(cx,cy,8+i*6,4+i*3,Math.sin(i)*.15,0,Math.PI*2);ctx.stroke();}
    } else if(mode==='celestial'){
      cube(1,.24);for(let i=-3;i<=3;i++){const yy=cy+i*9+Math.sin(time*.15+i)*3;line(.28+Math.abs(i)*.025,1.2);ctx.beginPath();ctx.moveTo(cx-50,yy);ctx.lineTo(cx+50,yy-10*Math.sin(i));ctx.stroke();}dot(cx,cy-4,3,.8);
    } else if(mode==='aurora'){
      cube(1,.24);for(let i=0;i<9;i++){ctx.beginPath();for(let x=-55;x<=55;x+=3){const y=(i-4)*7+Math.sin(x*.045+time*.28+i*.5)*(5+motion*8);x===-55?ctx.moveTo(cx+x,cy+y):ctx.lineTo(cx+x,cy+y);}line(.2+i*.035,1.25);ctx.stroke();}
    } else {
      // Abyss: descending perspective planes.
      for(let i=0;i<8;i++){const k=i/7, y=cy-28+k*58, half=52*(1-k*.72);line(.45-k*.32,1.2);ctx.beginPath();ctx.moveTo(cx-half,y);ctx.lineTo(cx+half,y);ctx.stroke();if(i<7){ctx.beginPath();ctx.moveTo(cx-half,y);ctx.lineTo(cx-52*(1-(k+1/7)*.72),cy-28+(k+1/7)*58);ctx.stroke();}}
    }
    // A restrained live wave makes the space breathe with actual signal.
    for(let i=0;i<4;i++){const phase=(time*(.12+motion*.18)+i*.21)%1;line((1-phase)*(.28+activity*.3),1.1);ctx.beginPath();ctx.ellipse(cx,cy,phase*58*size,phase*30*size,0,0,Math.PI*2);ctx.stroke();}
  }

  // ARTIFACT — cassette/vinyl stay literal; other media modes use subtle linework.
  else if (module.id === 'media') {
    cube(.94,.2);
    const wear=params.wear??.25;
    if(mode==='cassette'){
      // Minimal cassette blueprint: module accent washes the glass, bright linework carries the form.
      const shellW=104, shellH=58, left=cx-shellW/2, top=cy-shellH/2;
      ctx.fillStyle=rgba(.075 + activity*.055);
      ctx.fillRect(left,top,shellW,shellH);
      line(.64,1.45);
      ctx.strokeRect(left+.5,top+.5,shellW-1,shellH-1);
      line(.30,1.05);
      ctx.strokeRect(cx-38,cy-17,76,27);
      const spin=time*(1.2+wear*1.8);
      for(const rx of [-24,24]){
        line(.58,1.35);
        ctx.beginPath();ctx.arc(cx+rx,cy-4,11,0,Math.PI*2);ctx.stroke();
        ctx.beginPath();ctx.arc(cx+rx,cy-4,4,0,Math.PI*2);ctx.stroke();
        for(let i=0;i<6;i++){
          const a=spin+i*Math.PI/3;
          ctx.beginPath();
          ctx.moveTo(cx+rx+Math.cos(a)*5,cy-4+Math.sin(a)*5);
          ctx.lineTo(cx+rx+Math.cos(a)*9,cy-4+Math.sin(a)*9);
          ctx.stroke();
        }
      }
      line(.42,1.2);
      ctx.beginPath();
      ctx.moveTo(cx-13,cy-4);ctx.lineTo(cx+13,cy-4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx-38,cy+18);ctx.lineTo(cx-27,cy+28);ctx.lineTo(cx+27,cy+28);ctx.lineTo(cx+38,cy+18);
      ctx.stroke();
      for(let i=-1;i<=1;i++) dot(cx+i*13,cy+23,1.35,.55);
      line(.24+wear*.22,1);
      for(let i=0;i<4;i++){
        const y=top+8+i*5;
        ctx.beginPath();ctx.moveTo(left+8,y);ctx.lineTo(left+30,y);ctx.stroke();
      }
    } else if(mode==='vinyl'){
      // Stylized turntable world: record/platter live inside the same perspective chamber.
      cube(1,.24);
      const spin=time*(.72+wear*.42);
      const platterY=cy+5;
      ctx.save();
      ctx.translate(cx-7,platterY);
      ctx.scale(1,.48);
      for(let r=11;r<=44;r+=5){
        line(.18+r/150, r===44?1.45:1);
        ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();
      }
      // Rotating label geometry gives motion without flashing or audio reaction.
      line(.58,1.35);
      ctx.beginPath();ctx.arc(0,0,11,0,Math.PI*2);ctx.stroke();
      for(let i=0;i<4;i++){
        const a=spin+i*Math.PI/2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a)*4,Math.sin(a)*4);
        ctx.lineTo(Math.cos(a)*10,Math.sin(a)*10);
        ctx.stroke();
      }
      ctx.restore();

      // Spindle.
      dot(cx-7,platterY,1.7,.7);

      // Tonearm, pivot and cartridge.
      const armPhase=.04*Math.sin(time*.16);
      const pivotX=cx+43,pivotY=cy-23;
      line(.52,1.4);
      ctx.beginPath();ctx.arc(pivotX,pivotY,6,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pivotX-2,pivotY+4);
      ctx.lineTo(cx+18+armPhase*22,cy+4);
      ctx.lineTo(cx+11+armPhase*18,cy+10);
      ctx.stroke();
      ctx.save();
      ctx.translate(cx+12+armPhase*18,cy+9);
      ctx.rotate(-.35);
      line(.66,1.35);
      ctx.strokeRect(-5,-2,10,4);
      ctx.restore();

      // Sparse perspective deck rails inside the cube.
      line(.24,1);
      const deckA=project(-48,25,-.72),deckB=project(48,25,-.72);
      const deckC=project(48,32,.58),deckD=project(-48,32,.58);
      ctx.beginPath();ctx.moveTo(...deckA);ctx.lineTo(...deckB);ctx.lineTo(...deckC);ctx.lineTo(...deckD);ctx.closePath();ctx.stroke();
    } else if(mode==='reel'){
      for(const x of [-28,28]){line(.52,1.4);ctx.beginPath();ctx.arc(cx+x,cy-4,18,0,Math.PI*2);ctx.stroke();for(let i=0;i<3;i++){const a=time*(.5+wear)+i*Math.PI*2/3;ctx.beginPath();ctx.moveTo(cx+x,cy-4);ctx.lineTo(cx+x+Math.cos(a)*14,cy-4+Math.sin(a)*14);ctx.stroke();}}
      line(.4,1.3);ctx.beginPath();ctx.moveTo(cx-28,cy+14);ctx.quadraticCurveTo(cx,cy+28,cx+28,cy+14);ctx.stroke();
    } else if(mode==='vhs'){
      for(let y=-28;y<=28;y+=8){line(.22+((y+28)/56)*.2,1);ctx.beginPath();ctx.moveTo(cx-52,cy+y+Math.sin(time*3+y)*wear*3);ctx.lineTo(cx+52,cy+y);ctx.stroke();}
      const scan=((time*.35)%1)*56-28;line(.72,1.5);ctx.beginPath();ctx.moveTo(cx-50,cy+scan);ctx.lineTo(cx+50,cy+scan);ctx.stroke();
    } else if(mode==='radio'){
      line(.5,1.3);ctx.beginPath();ctx.moveTo(cx-50,cy+12);ctx.lineTo(cx+50,cy+12);ctx.stroke();for(let i=0;i<13;i++){const x=cx-48+i*8;const h=5+(i%4)*4;line(.25+(i%3)*.08,1);ctx.beginPath();ctx.moveTo(x,cy+12);ctx.lineTo(x,cy+12-h);ctx.stroke();}const needle=cx-45+((Math.sin(time*.18)+1)/2)*90;line(.75,1.5);ctx.beginPath();ctx.moveTo(needle,cy-20);ctx.lineTo(needle,cy+18);ctx.stroke();
    } else if(mode==='wax'){
      for(let r=8;r<=48;r+=5){line(.18+r/180,1);ctx.beginPath();ctx.ellipse(cx,cy,r,r*.55,Math.sin(r)*.02,0,Math.PI*2);ctx.stroke();}
      for(let i=0;i<6;i++)dot(cx+Math.sin(i*8.3+time*.04)*44,cy+Math.cos(i*4.7)*23,1,.35+wear*.25);
    } else if(mode==='broken'){
      let px=cx-52,py=cy;for(let i=1;i<=15;i++){const x=cx-52+i*(104/15),y=cy+Math.sin(i*9.13+time*.8)*24*wear+((i%4)-2)*5;line(.3+(i%3)*.09,1.3);ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(x,y);ctx.stroke();px=x;py=y;}if(transient>.08)dot(px,py,2.5,.9);
    } else {
      // Archive: sparse aging waveform + vertical dropout scars.
      wave(0,7,.055,time*.08,.48);for(let i=0;i<8;i++){const x=cx-48+i*14+Math.sin(i*3.7)*3;line(.18+wear*.25,1);ctx.beginPath();ctx.moveTo(x,cy-28);ctx.lineTo(x,cy+28);ctx.stroke();}
    }
  }

  // GRAIN keeps its particle identity; no algorithm dropdown to distinguish.
  else {
    cube(1,.22);
    const density=params.density??.4, count=18+Math.round(density*46);
    for(let i=0;i<count;i++){const seed=i*12.9898,orbit=time*(.18+(params.chaos??.2)*.55)+seed,x=Math.sin(seed*1.7+orbit)*(20+(i%7)*6),y=Math.cos(seed*.9+orbit*1.2)*(12+(i%5)*6),z=Math.sin(seed+orbit*.7),p=project(x,y,z),sz=1+((i%4)/3)*(1+(params.bloom??.3)*2);ctx.fillStyle=rgba(.14+activity*.5+(z+1)*.08);ctx.fillRect(p[0]-sz/2,p[1]-sz/2,sz,sz);}
  }

  ctx.strokeStyle = 'rgba(255,255,255,.028)';
  ctx.lineWidth = 1;
  for (let y = 6; y < height; y += 6) { ctx.beginPath(); ctx.moveTo(0,y+.5); ctx.lineTo(width,y+.5); ctx.stroke(); }
}
function Knob({
  label,
  value,
  effectiveValue,
  display,
  disabled = false,
  assignment,
  patchTarget,
  onChange,
  onReset,
  onPatchStart,
  onPatchMove,
  onPatchEnd,
  onPatchDisconnect,
}: {
  label: string;
  value: number;
  effectiveValue: number;
  display: string;
  disabled?: boolean;
  assignment?: XYAssignment;
  patchTarget: string;
  onChange: (value: number) => void;
  onReset: () => void;
  onPatchStart: (startX: number, startY: number, pointerX: number, pointerY: number) => void;
  onPatchMove: (pointerX: number, pointerY: number) => void;
  onPatchEnd: (pointerX: number, pointerY: number) => void;
  onPatchDisconnect: () => void;
}) {
  const rotation = -135 + value * 270;
  const effectiveRotation = -135 + effectiveValue * 270;
  const valueRef = useRef(value);
  const dragRef = useRef({ pointerId: -1, startX: 0, startY: 0, startValue: 0, moved: false });
  const dragFrameRef = useRef<number | null>(null);
  const pendingDragRef = useRef<{ x: number; y: number; fine: boolean } | null>(null);
  const patchRef = useRef({ pointerId: -1, x: 0, y: 0, moved: false });
  const lastClickAtRef = useRef(0);
  const cleanupDragRef = useRef<(() => void) | null>(null);
  const cleanupPatchRef = useRef<(() => void) | null>(null);
  const [isAdjusting, setIsAdjusting] = useState(false);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => () => {
    cleanupDragRef.current?.();
    cleanupPatchRef.current?.();
  }, []);


  function handlePointerDown(event: ReactPointerEvent<HTMLSpanElement>): void {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cleanupDragRef.current?.();

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startValue: valueRef.current,
      moved: false,
    };
    pendingDragRef.current = null;
    document.body.classList.add('knob-is-dragging');
    setIsAdjusting(true);

    const applyPending = (): void => {
      dragFrameRef.current = null;
      const pending = pendingDragRef.current;
      if (!pending) return;
      pendingDragRef.current = null;

      // Absolute-from-grab-point mapping prevents event-to-event acceleration,
      // magnetic snapping and release momentum from making the knob "bounce".
      const vertical = dragRef.current.startY - pending.y;
      const horizontal = pending.x - dragRef.current.startX;
      const travel = vertical + horizontal * 0.10;
      const sensitivity = pending.fine ? 0.00115 : 0.00315;
      const next = clamp(dragRef.current.startValue + travel * sensitivity, 0, 1);

      dragRef.current.moved = dragRef.current.moved || Math.abs(travel) > 1.5;
      if (Math.abs(next - valueRef.current) >= 0.00008) {
        valueRef.current = next;
        onChange(next);
      }
    };

    const move = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== dragRef.current.pointerId) return;
      pointerEvent.preventDefault();
      pendingDragRef.current = {
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
        fine: pointerEvent.shiftKey,
      };
      if (dragFrameRef.current === null) {
        dragFrameRef.current = requestAnimationFrame(applyPending);
      }
    };

    const finish = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== dragRef.current.pointerId) return;
      pointerEvent.preventDefault();

      // Commit the last pointer sample before ending the gesture.
      pendingDragRef.current = {
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
        fine: pointerEvent.shiftKey,
      };
      if (dragFrameRef.current !== null) {
        cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
      applyPending();

      if (!dragRef.current.moved) {
        const now = performance.now();
        if (now - lastClickAtRef.current <= 360) {
          onReset();
          lastClickAtRef.current = 0;
        } else {
          lastClickAtRef.current = now;
        }
      } else {
        lastClickAtRef.current = 0;
      }
      cleanupDragRef.current?.();
    };

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish, { passive: false });
    window.addEventListener('pointercancel', finish, { passive: false });
    cleanupDragRef.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (dragFrameRef.current !== null) cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
      pendingDragRef.current = null;
      cleanupDragRef.current = null;
      document.body.classList.remove('knob-is-dragging');
      setIsAdjusting(false);
    };
  }

  function handlePatchPointerDown(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cleanupPatchRef.current?.();
    const bounds = event.currentTarget.getBoundingClientRect();
    patchRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    document.body.classList.add('patch-is-dragging');
    onPatchStart(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
      event.clientX,
      event.clientY
    );

    const move = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== patchRef.current.pointerId) return;
      pointerEvent.preventDefault();
      const distance = Math.hypot(pointerEvent.clientX - patchRef.current.x, pointerEvent.clientY - patchRef.current.y);
      patchRef.current.moved = patchRef.current.moved || distance > 3;
      onPatchMove(pointerEvent.clientX, pointerEvent.clientY);
    };

    const finish = (pointerEvent: PointerEvent, cancelled = false): void => {
      if (pointerEvent.pointerId !== patchRef.current.pointerId) return;
      pointerEvent.preventDefault();
      if (!cancelled && patchRef.current.moved) {
        onPatchEnd(pointerEvent.clientX, pointerEvent.clientY);
      } else {
        onPatchEnd(-1, -1);
        if (!cancelled && assignment) onPatchDisconnect();
      }
      cleanupPatchRef.current?.();
    };

    const up = (pointerEvent: PointerEvent): void => finish(pointerEvent, false);
    const cancelPatch = (pointerEvent: PointerEvent): void => finish(pointerEvent, true);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up, { passive: false });
    window.addEventListener('pointercancel', cancelPatch, { passive: false });
    cleanupPatchRef.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelPatch);
      cleanupPatchRef.current = null;
      document.body.classList.remove('patch-is-dragging');
    };
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLSpanElement>): void {
    if (disabled) return;
    const step = event.shiftKey ? 0.005 : 0.025;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault();
      onChange(Math.min(1, value + step));
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault();
      onChange(Math.max(0, value - step));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onChange(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      onChange(1);
    } else if (event.key === '0' || event.key === 'Enter') {
      event.preventDefault();
      onReset();
    }
  }

  return (
    <div className={`knob-control ${assignment ? 'xy-assigned' : ''} ${isAdjusting ? 'is-adjusting' : ''}`}>
      <span className="knob-value" aria-hidden={!isAdjusting}>{display}</span>
      <span
        className="knob-shell"
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={display}
        aria-disabled={disabled}
        title="Drag vertically · Shift for fine control · Double-click to reset"
        style={{ '--effective-rotation': `${effectiveRotation}deg`, '--base-rotation': `${rotation}deg` } as CSSProperties}
      >
        <span className="knob-modulation-ring" aria-hidden="true" />
        <span className="knob-effective-marker" aria-hidden="true" />
        <span className="knob-face" style={{ transform: `rotate(${rotation}deg)` }} aria-hidden="true">
          <span className="knob-indicator" />
        </span>
      </span>
      <button
        type="button"
        className={`knob-patch-jack ${assignment ? `assigned axis-${assignment.axis}` : ''}`}
        data-patch-target={patchTarget}
        onPointerDown={handlePatchPointerDown}
        disabled={disabled}
        aria-label={assignment ? `${label} patched to ${assignment.axis.toUpperCase()}. Click to disconnect or drag to repatch.` : `Patch ${label} to motion`}
        title={assignment ? `Patched to ${assignment.axis.toUpperCase()} · click to disconnect · drag to repatch` : 'Drag this jack to the motion pad'}
      >
        <span aria-hidden="true" />
        {assignment && <b>{assignment.axis.toUpperCase()}</b>}
      </button>
      <span className="knob-label">{label}</span>
    </div>
  );
}

function LinearControl({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="linear-control">
      <span className="linear-header">
        <span>{label}</span>
        <strong>{display}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event: ReactChangeEvent<HTMLInputElement>) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function LevelMeter({ label, level }: { label: string; level: number }) {
  const safeLevel = clamp(Number.isFinite(level) ? level : 0, 0, 1);
  const litSegments = Math.round(safeLevel * 16);

  return (
    <div
      className="level-meter"
      aria-label={`${label} energy ${Math.round(safeLevel * 100)} percent`}
      title={`${label} spectral energy`}
    >
      <small aria-hidden="true">{label}</small>
      {Array.from({ length: 16 }).map((_, index) => (
        <span key={index} className={index < litSegments ? 'lit' : ''} />
      ))}
    </div>
  );
}

function SpectrumWaterfall({
  analyser,
  running,
}: {
  analyser: AnalyserNode | null;
  running: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;

    const drawingContext = canvasElement.getContext('2d');
    if (!drawingContext) return;

    const canvas = canvasElement;
    const context = drawingContext;

    let animationFrame = 0;
    let lastSampleTime = 0;
    const historyLength = 24;
    const pointCount = 36;
    const history: number[][] = Array.from({ length: historyLength }, () =>
      Array(pointCount).fill(0)
    );
    const frequencyData = analyser
      ? new Uint8Array(analyser.frequencyBinCount)
      : null;

    function resizeCanvas(): void {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(bounds.width * ratio));
      const height = Math.max(1, Math.round(bounds.height * ratio));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }

    function collectSpectrum(): number[] {
      if (!analyser || !frequencyData || !running) {
        return Array(pointCount).fill(0);
      }

      analyser.getByteFrequencyData(frequencyData);
      const values: number[] = [];

      for (let point = 0; point < pointCount; point += 1) {
        const normalized = point / Math.max(1, pointCount - 1);
        const startIndex = Math.floor(
          normalized ** 2 * (frequencyData.length - 1)
        );
        const nextNormalized = (point + 1) / pointCount;
        const endIndex = Math.max(
          startIndex + 1,
          Math.floor(nextNormalized ** 2 * frequencyData.length)
        );

        let total = 0;
        let samples = 0;
        for (
          let index = startIndex;
          index < endIndex && index < frequencyData.length;
          index += 1
        ) {
          total += frequencyData[index];
          samples += 1;
        }

        values.push((samples > 0 ? total / samples : 0) / 255);
      }

      return values;
    }

    function projectPoint(
      frequencyPosition: number,
      depthPosition: number,
      amplitude: number,
      width: number,
      height: number
    ): { x: number; y: number } {
      const horizonY = height * 0.19;
      const frontY = height * 0.88;
      const depthScale = 0.35 + depthPosition * 0.65;
      const halfWidth = width * 0.47 * depthScale;
      const centerX = width / 2;
      const baseY = horizonY + depthPosition * (frontY - horizonY);
      const x = centerX + (frequencyPosition - 0.5) * halfWidth * 2;
      const amplitudeHeight = height * 0.34 * amplitude * depthScale;
      return { x, y: baseY - amplitudeHeight };
    }

    function drawBackground(width: number, height: number): void {
      context.fillStyle = '#06110c';
      context.fillRect(0, 0, width, height);
      context.strokeStyle = 'rgba(72, 255, 145, 0.13)';
      context.lineWidth = 1;

      const horizonY = height * 0.19;
      const frontY = height * 0.88;
      const centerX = width / 2;

      for (let index = 0; index <= 12; index += 1) {
        const position = index / 12;
        const frontX = width * 0.03 + position * width * 0.94;
        const horizonX = centerX + (position - 0.5) * width * 0.34;
        context.beginPath();
        context.moveTo(frontX, frontY);
        context.lineTo(horizonX, horizonY);
        context.stroke();
      }

      for (let index = 0; index <= 18; index += 1) {
        const normalized = index / 18;
        const curved = normalized ** 1.65;
        const y = horizonY + curved * (frontY - horizonY);
        const widthAtDepth = width * (0.34 + curved * 0.6);
        context.beginPath();
        context.moveTo(centerX - widthAtDepth / 2, y);
        context.lineTo(centerX + widthAtDepth / 2, y);
        context.stroke();
      }

      context.strokeStyle = 'rgba(119, 255, 172, 0.48)';
      context.lineWidth = Math.max(1, width / 500);
      context.strokeRect(1, 1, width - 2, height - 2);
    }

    function drawSpectrum(width: number, height: number): void {
      for (let rowIndex = 0; rowIndex < history.length; rowIndex += 1) {
        const depthPosition = rowIndex / Math.max(1, history.length - 1);
        const row = history[history.length - 1 - rowIndex];
        const opacity = 0.22 + depthPosition * 0.78;

        context.strokeStyle = `rgba(92, 255, 154, ${0.22 + opacity * 0.7})`;
        context.lineWidth = 1 + depthPosition * 1.2;
        context.beginPath();

        for (let pointIndex = 0; pointIndex < row.length; pointIndex += 1) {
          const frequencyPosition = pointIndex / Math.max(1, row.length - 1);
          const point = projectPoint(
            frequencyPosition,
            depthPosition,
            row[pointIndex],
            width,
            height
          );

          if (pointIndex === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        }

        context.stroke();
      }
    }

    function drawLabels(width: number, height: number): void {
      const fontSize = Math.max(8, Math.round(width / 42));
      context.fillStyle = 'rgba(137, 255, 180, 0.88)';
      context.font = `700 ${fontSize}px "Courier New", monospace`;
      context.textBaseline = 'top';
      context.textAlign = 'left';
      context.fillText('SPECTRUM', width * 0.045, height * 0.045);
      context.textAlign = 'right';
      context.fillText(
        running ? 'LIVE' : 'STANDBY',
        width * 0.955,
        height * 0.045
      );
      context.textBaseline = 'bottom';
      context.textAlign = 'left';
      context.fillText('LOW', width * 0.045, height * 0.955);
      context.textAlign = 'right';
      context.fillText('HIGH', width * 0.955, height * 0.955);
    }

    function draw(timestamp: number): void {
      resizeCanvas();

      if (timestamp - lastSampleTime > 42) {
        history.shift();
        history.push(collectSpectrum());
        lastSampleTime = timestamp;
      }

      context.clearRect(0, 0, canvas.width, canvas.height);
      drawBackground(canvas.width, canvas.height);
      drawSpectrum(canvas.width, canvas.height);
      drawLabels(canvas.width, canvas.height);
      animationFrame = window.requestAnimationFrame(draw);
    }

    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);
    animationFrame = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [analyser, running]);

  return (
    <section className="spectrum-unit">
      <header className="spectrum-header">
        <strong>SPECTRUM</strong>
        <span className={`spectrum-status ${running ? 'active' : ''}`}><i />{running ? 'LIVE' : 'HOLD'}</span>
      </header>
      <div className="spectrum-screen">
        <canvas
          ref={canvasRef}
          aria-label="Live three-dimensional audio spectrum waterfall"
        />
      </div>

    </section>
  );
}

function setEffectParameterIfLoaded(
  engine: AudioEngine | null | undefined,
  effectId: string,
  parameterId: string,
  value: number
): boolean {
  if (!engine?.getEffect(effectId)) {
    return false;
  }

  engine.setEffectParameter(effectId, parameterId, value);
  return true;
}


function auditUiAgainstEngine(engine: AudioEngine, modules: ModuleState[]): void {
  const failures: string[] = [];
  for (const module of modules) {
    const effect = engine.getEffect(module.id);
    if (!effect) {
      failures.push(`${module.id}: DSP module missing`);
      continue;
    }
    if (effect.isBypassed() === module.enabled) {
      failures.push(`${module.id}: power/bypass state mismatch`);
    }
    for (const parameter of module.parameters) {
      const actual = effect.getParameter(parameter.id);
      if (!actual) {
        failures.push(`${module.id}.${parameter.id}: parameter missing`);
        continue;
      }
      const expected = toDspParameterValue(module.id, parameter.id, parameter.value);
      const tolerance = Math.max(1e-5, Math.abs(expected) * 1e-4);
      if (!Number.isFinite(actual.value) || Math.abs(actual.value - expected) > tolerance) {
        failures.push(`${module.id}.${parameter.id}: UI ${expected} != DSP ${actual.value}`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`CALCOTONE startup self-check failed: ${failures.join('; ')}`);
  }
}

function syncModuleParameters(
  engine: AudioEngine,
  modules: ModuleState[]
): void {
  for (const module of modules) {
    // UI state is authoritative at startup. Presets construct the graph, but a
    // user may have changed module power before pressing Power. Restore that
    // state explicitly so the illuminated hardware always matches the DSP.
    engine.setEffectBypassed(module.id, !module.enabled);

    if (module.id === 'saturation' && module.emberMode) setEffectParameterIfLoaded(engine, 'saturation', 'mode', EMBER_MODE_ORDER.indexOf(module.emberMode));
    if (module.id === 'chorus' && module.driftMode) setEffectParameterIfLoaded(engine, 'chorus', 'mode', DRIFT_MODE_ORDER.indexOf(module.driftMode));
    if (module.id === 'delay' && module.delayAlgorithm) {
      setEffectParameterIfLoaded(
        engine,
        'delay',
        'algorithm',
        DELAY_ALGORITHMS.indexOf(module.delayAlgorithm)
      );
    }
    if (module.id === 'reverb' && module.algorithm) {
      setEffectParameterIfLoaded(
        engine,
        'reverb',
        'algorithm',
        REVERB_ALGORITHMS.indexOf(module.algorithm)
      );
    }
    if (module.id === 'media' && module.mediaMode) {
      setEffectParameterIfLoaded(
        engine,
        'media',
        'mode',
        MEDIA_MODE_ORDER.indexOf(module.mediaMode)
      );
    }
    if (module.id === 'bitcrusher' && module.grainMode) {
      setEffectParameterIfLoaded(
        engine,
        'bitcrusher',
        'mode',
        GRAIN_MODE_ORDER.indexOf(module.grainMode)
      );
    }
    for (const parameter of module.parameters) {
      setEffectParameterIfLoaded(
        engine,
        module.id,
        parameter.id,
        toDspParameterValue(module.id, parameter.id, parameter.value)
      );
    }
  }
}

function toDspParameterValue(
  moduleId: string,
  parameterId: string,
  value: number
): number {
  value = clamp(Number.isFinite(value) ? value : 0, 0, 1);
  if (moduleId === 'saturation' && parameterId === 'tone') {
    return 200 + value * 17_800;
  }

  if (moduleId === 'chorus' && parameterId === 'rate') {
    return 0.05 + value * 2.45;
  }

  if (moduleId === 'chorus' && parameterId === 'depth') {
    return value * 0.008;
  }

  if (moduleId === 'delay' && parameterId === 'time') {
    // Halo Time is intentionally front-loaded toward musically obvious echoes.
    // The first third now spans roughly 30–880 ms, while the top end reaches 4 seconds.
    return 0.03 + Math.pow(value, 1.4) * 3.97;
  }

  if (moduleId === 'delay' && parameterId === 'feedback') {
    return value * 0.9;
  }

  if (moduleId === 'reverb' && parameterId === 'decay') {
    return 0.35 * Math.pow(16 / 0.35, value);
  }

  if (moduleId === 'bitcrusher' && parameterId === 'bits') {
    return Math.round(4 + value * 12);
  }

  return value;
}

function formatParameterValue(
  moduleId: string,
  parameterId: string,
  value: number
): string {
  const dspValue = toDspParameterValue(moduleId, parameterId, value);

  if (moduleId === 'saturation' && parameterId === 'tone') {
    return dspValue >= 1000
      ? `${(dspValue / 1000).toFixed(1)} kHz`
      : `${Math.round(dspValue)} Hz`;
  }

  if (moduleId === 'chorus' && parameterId === 'rate') {
    return `${dspValue.toFixed(2)} Hz`;
  }

  if (moduleId === 'chorus' && parameterId === 'depth') {
    return `${(dspValue * 1000).toFixed(1)} ms`;
  }

  if (moduleId === 'delay' && parameterId === 'time') {
    return dspValue >= 1
      ? `${dspValue.toFixed(dspValue < 2 ? 2 : 1)} s`
      : `${Math.round(dspValue * 1000)} ms`;
  }

  if (moduleId === 'delay' && parameterId === 'feedback') {
    return `${Math.round(dspValue * 100)}%`;
  }

  if (moduleId === 'reverb' && parameterId === 'decay') {
    return `${dspValue.toFixed(dspValue < 10 ? 1 : 0)} s`;
  }

  if (moduleId === 'bitcrusher' && parameterId === 'bits') {
    return `${Math.round(dspValue)} bit`;
  }

  if (moduleId === 'bitcrusher' && parameterId === 'pitch') {
    return `±${Math.round(value * 12)} st`;
  }

  return `${Math.round(value * 100)}%`;
}

function formatAlgorithmName(algorithm: string): string {
  if (algorithm === 'bbd') return 'BBD';
  if (algorithm === 'pingpong') return 'Ping Pong';
  return algorithm.charAt(0).toUpperCase() + algorithm.slice(1);
}

function formatRailOrder(order: readonly string[]): string {
  const names: Record<string, string> = {
    saturation: 'EMBER',
    chorus: 'DRIFT',
    delay: 'HALO',
    reverb: 'ATMOS',
    bitcrusher: 'GRAIN',
    media: 'ARTIFACT',
  };
  return order.map((id) => names[id] ?? id.toUpperCase()).join(' → ');
}

function createPatchPath(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): string {
  const bend = Math.max(70, Math.abs(endX - startX) * 0.42);
  const controlOneX = startX + (endX >= startX ? bend : -bend);
  const controlTwoX = endX - (endX >= startX ? bend : -bend);
  return `M ${startX} ${startY} C ${controlOneX} ${startY}, ${controlTwoX} ${endY}, ${endX} ${endY}`;
}

function sanitizeFileName(value: string): string {
  return value
    .trim()
    .replace(/\.wav$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 64);
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder
    .toFixed(1)
    .padStart(4, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatPeak(peak: number): string {
  if (peak <= 0) return '-∞ dBFS';
  return `${(20 * Math.log10(peak)).toFixed(1)} dBFS`;
}


function shapeMotionSource(value: number, curve: MotionCurve): number {
  const safe = clamp(value, 0, 1);
  if (curve === 'soft') return safe * safe * (3 - 2 * safe);
  if (curve === 'exponential') return safe * safe;
  if (curve === 'stepped') return Math.round(safe * 4) / 4;
  return safe;
}

function getEffectiveMotionValue(
  baseValue: number,
  assignment: XYAssignment,
  position: { x: number; y: number }
): number {
  const source = assignment.axis === 'x' ? position.x / 100 : position.y / 100;
  const shaped = shapeMotionSource(
    assignment.inverted ? 1 - source : source,
    assignment.curve ?? 'linear'
  );
  return clamp(
    baseValue + (shaped * 2 - 1) * 0.5 * assignment.depth,
    assignment.min ?? 0,
    assignment.max ?? 1
  );
}

function getDefaultParameterValue(moduleId: string, parameterId: string): number {
  return INITIAL_MODULES.find((module) => module.id === moduleId)?.parameters.find(
    (parameter) => parameter.id === parameterId
  )?.value ?? 0.5;
}
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
