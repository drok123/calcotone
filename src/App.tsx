import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
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
import { EffectModule } from './components/effects/EffectModule';
import { MotionPad } from './components/motion/MotionPad';
import { LinearControl } from './components/controls/LinearControl';
import { LevelMeter } from './components/meters/LevelMeter';
import { SpectrumWaterfall } from './components/meters/SpectrumWaterfall';
import { RecorderPanel, type RecordedTake } from './components/recorder/RecorderPanel';
import type { ModuleState, MotionCurve, MotionSmoothing, XYAssignment, XYAxis } from './ui/types';
import { clamp } from './ui/math';
import { shapeMotionSource, getEffectiveMotionValue } from './ui/motion';

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


const INITIAL_XY_ASSIGNMENTS: XYAssignment[] = [];


interface PersistentPatchLine {
  id: string;
  axis: XYAxis;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
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
      100 - ((event.clientY - bounds.top) / bounds.height) * 100,
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

    if (axis) {
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

    // Give cable drops a forgiving magnetic capture zone around the pad. The
    // visible X/Y jacks are the actual destinations; the closest socket wins.
    const captureMargin = Math.max(28, Math.min(pad.width, pad.height) * 0.12);
    if (
      pointerX < pad.left - captureMargin ||
      pointerX > pad.right + captureMargin ||
      pointerY < pad.top - captureMargin ||
      pointerY > pad.bottom + captureMargin
    ) return null;

    const xSocket = { x: pad.left + pad.width * 0.18, y: pad.top + pad.height * 0.82 };
    const ySocket = { x: pad.left + pad.width * 0.82, y: pad.top + pad.height * 0.18 };
    const xDistance = Math.hypot(pointerX - xSocket.x, pointerY - xSocket.y);
    const yDistance = Math.hypot(pointerX - ySocket.x, pointerY - ySocket.y);
    return xDistance <= yDistance ? 'x' : 'y';
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
                          onParameterReset={(parameterId) =>
                            updateParameter(module.id, parameterId, getDefaultParameterValue(module.id, parameterId))
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

            <MotionPad
              padRef={xyPadRef}
              modules={modules}
              assignments={xyAssignments}
              position={xyPosition}
              dragging={xyDragging}
              patchActive={Boolean(patchDraft)}
              hoverAxis={patchDraft?.hoverAxis ?? null}
              onDraggingChange={setXyDragging}
              onPadPointer={handleXYPad}
              onDisconnect={disconnectPatch}
              onRouteChange={updateMotionRoute}
            />


            <RecorderPanel
              state={recordingState}
              name={recordingName}
              seconds={recordingSeconds}
              take={recordedTake}
              previewUrl={previewUrl}
              running={isRunning}
              onNameChange={setRecordingName}
              onNameCommit={() => setRecordingName((current) => sanitizeFileName(current))}
              onStart={startRecording}
              onFinish={() => void finishRecording()}
              onSave={saveRecording}
              onDiscard={discardRecording}
              formatDuration={formatDuration}
              formatBytes={formatBytes}
              formatPeak={formatPeak}
            />

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



function getDefaultParameterValue(moduleId: string, parameterId: string): number {
  return INITIAL_MODULES.find((module) => module.id === moduleId)?.parameters.find(
    (parameter) => parameter.id === parameterId
  )?.value ?? 0.5;
}
