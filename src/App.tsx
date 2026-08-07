import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
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
import { NativeAudioBridge, type NativeAudioHealth } from './audio/NativeAudioBridge';
import { NativeVisualSpectrum } from './visual/NativeVisualSpectrum';
import { nativeWaveToRecordedWav } from './audio/NativeRecording';
import { SIGNAL_LAB_MODES, SIGNAL_LAB_STYLES, type SignalLabState } from './audio/SignalLab';
import { getPressureState } from './components/signal/pressureStore';
import type { InputMode } from './audio/InputMatrix';
import {
  runGpuCabinetExperiment,
  type GpuCabinetExperimentReport,
} from './audio/GpuCabinetExperiment';
import { REVERB_ALGORITHM_ORDER, type ReverbAlgorithm } from './audio/effects/Reverb';
import { MEDIA_MODE_ORDER, type MediaMode } from './audio/effects/Media';
import { EMBER_MODE_ORDER, type EmberMode } from './audio/effects/Saturation';
import { DRIFT_MODE_ORDER, type DriftMode } from './audio/effects/Chorus';
import { GRAIN_MODE_ORDER, type GrainMode } from './audio/effects/Bitcrusher';
import {
  STACK_AMP_MODELS,
  STACK_CABINETS,
  type StackAmpModel,
  type StackCabinet,
  type StackInputSource,
} from './audio/effects/StackAmp';
import {
  DELAY_ALGORITHM_ORDER,
  type DelayAlgorithm,
} from './audio/effects/Delay';
import { useVisualEngine } from './visual/VisualEngine';
import type { VisualSpectrumSource } from './visual/SharedVisualSpectrum';
import { EffectModule } from './components/effects/EffectModule';
import { RailCModule } from './components/effects/RailCModules';
import {
  RANDOMIZATION_PROFILE_OPTIONS,
  RANDOM_MUTATION_AMOUNT,
  type RandomizationProfile,
} from './features/random/randomProfiles';
import { LinearControl } from './components/controls/LinearControl';
import { LevelMeter } from './components/meters/LevelMeter';
import { SpectrumWaterfall } from './components/meters/SpectrumWaterfall';
import { RecorderPanel, type RecordedTake } from './components/recorder/RecorderPanel';
import { FaceplateLayoutEditor } from './components/layout/FaceplateLayoutEditor';
import type { ModuleState, XYAssignment, XYAxis } from './ui/types';
import { clamp } from './ui/math';
import { shapeMotionSource } from './ui/motion';
import {
  moveRackModule,
  nudgeRackModule,
  restoreRackRail,
  serialOrderFromRack,
  shuffledRackOrder,
  type RackOrders,
  type RackRail,
} from './routing/serialRouting';
import {
  RANDOM_UI_COMPLETE_EVENT,
  RANDOM_UI_EFFECT_ORDER,
  RANDOM_UI_MODULE_EVENT,
  completeRandomUiFlow,
  revealRandomUiModule,
  type RandomUiCompleteDetail,
  type RandomUiModuleDetail,
} from './features/random/randomUiFlow';
import {
  getActiveRailCRandomModuleIds,
  randomizeRailCModule,
  setRailCRandomOrder,
  type RailCRandomModuleId,
} from './features/random/railCRandomRegistry';

const APP_NAME = 'CALCOTONE';
const DESIGN_WIDTH = 2560;
const DESIGN_HEIGHT = 1440;
const DELAY_ALGORITHMS: DelayAlgorithm[] = [...DELAY_ALGORITHM_ORDER];

const REVERB_ALGORITHMS: ReverbAlgorithm[] = [...REVERB_ALGORITHM_ORDER];

const DEFAULT_RAIL_A_ORDER = ['saturation', 'chorus', 'delay'] as const;
const DEFAULT_RAIL_B_ORDER = ['reverb', 'bitcrusher', 'media'] as const;
const DEFAULT_RAIL_C_ORDER = ['stomp', 'chaos', 'pressure'] as const;
const DEFAULT_RACK_ORDERS: RackOrders = {
  A: [...DEFAULT_RAIL_A_ORDER],
  B: [...DEFAULT_RAIL_B_ORDER],
  C: [...DEFAULT_RAIL_C_ORDER],
};
const RAIL_C_MODULE_NAMES: Record<RailCRandomModuleId, string> = {
  stomp: 'Stomp',
  chaos: 'Stack',
  pressure: 'Pressure',
};
type RoutingRail = RackRail;


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

interface RandomUiPlan {
  finalModules: ModuleState[];
  finalMessage: string;
  revealed: Set<string>;
  targets: Map<string, ModuleState>;
  railCTargets: Set<RailCRandomModuleId>;
  totalTargets: number;
  profile: RandomizationProfile;
}

interface RandomFlowProgress {
  current: number;
  total: number;
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
    grainMode: 'smear',
    enabled: false,
    available: true,
    parameters: [
      { id: 'bits', label: 'Window', value: 0.75, display: '540 ms' },
      { id: 'density', label: 'Overlap', value: 0.42, display: '42%' },
      { id: 'pitch', label: 'Pitch Drift', value: 0.38, display: '±0.7 st' },
      { id: 'chaos', label: 'Motion', value: 0.16, display: '16%' },
      { id: 'bloom', label: 'Memory', value: 0.36, display: '36%' },
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

function chooseMusicalDifferent<T>(values: readonly T[], current: T | undefined): T {
  const alternatives = values.filter((value) => value !== current);
  return chooseMusical(alternatives.length ? alternatives : values);
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

type ProfileModuleRecipe = {
  mode?: string;
  parameters: Record<string, MusicalRange>;
};

function normalizedDelayTime(seconds: number): number {
  return clamp(Math.pow((clamp(seconds, 0.05, 0.6) - 0.03) / 3.97, 1 / 1.4), 0, 1);
}

function normalizedReverbDecay(seconds: number): number {
  return clamp(Math.log(clamp(seconds, 0.5, 6) / 0.35) / Math.log(16 / 0.35), 0, 1);
}

const DELAY_SYNC_SECONDS = [0.0625, 0.0833, 0.125, 0.1875, 0.25, 0.375, 0.5] as const;
const DELAY_SYNC_VALUES = DELAY_SYNC_SECONDS.map(normalizedDelayTime);

const RANDOM_PROFILE_RECIPES: Partial<Record<RandomizationProfile, Record<string, ProfileModuleRecipe>>> = {
  bass: {
    saturation: { mode: 'console', parameters: { drive:[.18,.34], tone:[.34,.58], heat:[.12,.30], character:[.28,.52], dynamics:[.42,.68], mix:[.14,.26] } },
    chorus: { mode: 'dimensiond', parameters: { rate:[.06,.10], depth:[.12,.24], shape:[.18,.30], spread:[.72,.92], motion:[.10,.22], mix:[.08,.18] } },
    delay: { mode: 'EP-3 Echoplex', parameters: { time:[normalizedDelayTime(.08),normalizedDelayTime(.125)], feedback:[.10,.22], color:[.32,.52], character:[.12,.28], width:[.34,.56], mix:[.10,.22] } },
    reverb: { mode: 'room', parameters: { decay:[normalizedReverbDecay(.6),normalizedReverbDecay(1.3)], size:[.24,.48], color:[.28,.52], diffusion:[.42,.68], motion:[.02,.14], mix:[.08,.20] } },
    bitcrusher: { mode: 'smear', parameters: { bits:[.55,.82], density:[.28,.48], pitch:[0,.10], chaos:[.02,.14], bloom:[.12,.28], mix:[.05,.16] } },
    media: { mode: 'tascam424', parameters: { wear:[.16,.34], wow:[.10,.18], noise:[.02,.10], tone:[.28,.48], mix:[.14,.28] } },
  },
  pad: {
    saturation: { mode: 'velvet', parameters: { drive:[.10,.24], tone:[.46,.72], heat:[.12,.28], character:[.18,.42], dynamics:[.48,.74], mix:[.12,.26] } },
    chorus: { mode: 'ensemble', parameters: { rate:[.04,.13], depth:[.38,.68], shape:[.34,.68], spread:[.82,.98], motion:[.12,.32], mix:[.24,.44] } },
    delay: { mode: 'tape', parameters: { time:[normalizedDelayTime(.1875),normalizedDelayTime(.5)], feedback:[.38,.58], color:[.26,.52], character:[.18,.38], width:[.68,.94], mix:[.28,.50] } },
    reverb: { mode: 'cloud', parameters: { decay:[normalizedReverbDecay(3),normalizedReverbDecay(6)], size:[.70,.96], color:[.34,.68], diffusion:[.78,.98], motion:[.08,.28], mix:[.34,.50] } },
    bitcrusher: { mode: 'clouds', parameters: { bits:[.46,.72], density:[.56,.78], pitch:[0,.16], chaos:[.18,.38], bloom:[.52,.78], mix:[.18,.34] } },
    media: { mode: 'reel', parameters: { wear:[.12,.30], wow:[.08,.22], noise:[0,.10], tone:[.44,.68], mix:[.12,.28] } },
  },
  lead: {
    saturation: { mode: 'tube', parameters: { drive:[.20,.42], tone:[.52,.78], heat:[.18,.38], character:[.34,.58], dynamics:[.32,.56], mix:[.18,.34] } },
    chorus: { mode: 'ce1', parameters: { rate:[.08,.14], depth:[.20,.38], shape:[.40,.66], spread:[.68,.88], motion:[.14,.30], mix:[.12,.28] } },
    delay: { mode: 'EP-3 Echoplex', parameters: { time:[normalizedDelayTime(.125),normalizedDelayTime(.25)], feedback:[.20,.42], color:[.42,.68], character:[.14,.32], width:[.48,.76], mix:[.16,.34] } },
    reverb: { mode: 'plate', parameters: { decay:[normalizedReverbDecay(1.2),normalizedReverbDecay(3)], size:[.40,.68], color:[.46,.74], diffusion:[.62,.86], motion:[.04,.18], mix:[.14,.32] } },
    bitcrusher: { mode: 'smear', parameters: { bits:[.58,.86], density:[.28,.52], pitch:[0,.12], chaos:[.04,.18], bloom:[.14,.34], mix:[.04,.16] } },
    media: { mode: 'Neve 1073', parameters: { wear:[.18,.34], wow:[.14,.22], noise:[.02,.10], tone:[.30,.48], mix:[.14,.28] } },
  },
  'retro-ambient': {
    saturation: { mode: 'mullard', parameters: { drive:[.12,.18], tone:[.40,.60], heat:[.18,.30], character:[.42,.58], dynamics:[.48,.64], mix:[.12,.20] } },
    chorus: { mode: 'ce1', parameters: { rate:[.07,.12], depth:[.24,.38], shape:[.40,.62], spread:[.76,.92], motion:[.12,.26], mix:[.18,.30] } },
    delay: { mode: 're201', parameters: { time:[normalizedDelayTime(.1875),normalizedDelayTime(.375)], feedback:[.48,.56], color:[.30,.50], character:[.22,.38], width:[.62,.84], mix:[.32,.46] } },
    reverb: { mode: 'lexicon224', parameters: { decay:[normalizedReverbDecay(3.2),normalizedReverbDecay(5.5)], size:[.62,.86], color:[.34,.56], diffusion:[.72,.90], motion:[.10,.24], mix:[.36,.44] } },
    bitcrusher: { mode: 'clouds', parameters: { bits:[.52,.72], density:[.48,.68], pitch:[0,.12], chaos:[.14,.30], bloom:[.48,.68], mix:[.12,.26] } },
    media: { mode: 'Ampex ATR-102', parameters: { wear:[.18,.34], wow:[.20,.52], noise:[0,.08], tone:[.42,.58], mix:[.16,.30] } },
  },
  'lofi-tape': {
    saturation: { mode: 'sp1200', parameters: { drive:[.20,.38], tone:[.12,.32], heat:[.14,.30], character:[.42,.62], dynamics:[.34,.54], mix:[.18,.32] } },
    chorus: { mode: 'vibrato', parameters: { rate:[.05,.12], depth:[.12,.28], shape:[.28,.48], spread:[.42,.68], motion:[.18,.34], mix:[.08,.20] } },
    delay: { mode: 'tape', parameters: { time:[normalizedDelayTime(.125),normalizedDelayTime(.25)], feedback:[.24,.44], color:[.18,.38], character:[.24,.44], width:[.38,.64], mix:[.16,.30] } },
    reverb: { mode: 'room', parameters: { decay:[normalizedReverbDecay(.8),normalizedReverbDecay(2.2)], size:[.32,.58], color:[.18,.42], diffusion:[.48,.72], motion:[.04,.16], mix:[.12,.26] } },
    bitcrusher: { mode: 'beads', parameters: { bits:[.62,.70], density:[.34,.56], pitch:[.02,.16], chaos:[.12,.30], bloom:[.18,.38], mix:[.12,.28] } },
    media: { mode: 'cassette', parameters: { wear:[.38,.62], wow:[.24,.46], noise:[.10,.22], tone:[.22,.42], mix:[.28,.46] } },
  },
  'gritty-drive': {
    saturation: { mode: 'furnace', parameters: { drive:[.40,.70], tone:[.28,.54], heat:[.36,.66], character:[.46,.72], dynamics:[.40,.68], mix:[.34,.50] } },
    chorus: { mode: 'smallstone', parameters: { rate:[.08,.18], depth:[.12,.30], shape:[.44,.70], spread:[.48,.74], motion:[.16,.34], mix:[.08,.18] } },
    delay: { mode: 'EP-3 Echoplex', parameters: { time:[normalizedDelayTime(.075),normalizedDelayTime(.095)], feedback:[.08,.18], color:[.28,.48], character:[.26,.46], width:[.28,.48], mix:[.12,.24] } },
    reverb: { mode: 'room', parameters: { decay:[normalizedReverbDecay(.5),normalizedReverbDecay(1.5)], size:[.24,.50], color:[.30,.54], diffusion:[.40,.66], motion:[.02,.12], mix:[.08,.20] } },
    bitcrusher: { mode: 'scatter', parameters: { bits:[.44,.68], density:[.32,.54], pitch:[.04,.22], chaos:[.18,.42], bloom:[.12,.30], mix:[.10,.24] } },
    media: { mode: 'API 1608', parameters: { wear:[.24,.42], wow:[.16,.24], noise:[.04,.12], tone:[.38,.58], mix:[.16,.30] } },
  },
};

function applyProfileMode(module: ModuleState, mode: string | undefined): ModuleState {
  if (!mode) return module;
  if (module.id === 'saturation') return { ...module, emberMode: mode as EmberMode };
  if (module.id === 'chorus') return { ...module, driftMode: mode as DriftMode };
  if (module.id === 'delay') return { ...module, delayAlgorithm: mode as DelayAlgorithm };
  if (module.id === 'reverb') return { ...module, algorithm: mode as ReverbAlgorithm };
  if (module.id === 'bitcrusher') return { ...module, grainMode: mode as GrainMode };
  if (module.id === 'media') return { ...module, mediaMode: mode as MediaMode };
  return module;
}

function guardRandomParameter(moduleId: string, parameterId: string, value: number): number {
  let safe = clamp(value, 0, 1);
  if (moduleId === 'delay' && parameterId === 'time') {
    safe = DELAY_SYNC_VALUES.reduce((nearest, candidate) =>
      Math.abs(candidate - safe) < Math.abs(nearest - safe) ? candidate : nearest
    );
  }
  if (moduleId === 'delay' && parameterId === 'feedback') safe = Math.min(safe, .82);
  if (moduleId === 'reverb' && parameterId === 'decay') {
    safe = clamp(safe, normalizedReverbDecay(.5), normalizedReverbDecay(6));
  }
  if (moduleId === 'bitcrusher' && parameterId === 'bits') safe = Math.max(safe, 1 / 6);
  if (parameterId === 'mix') {
    safe = Math.min(safe, moduleId === 'delay' || moduleId === 'reverb' ? .72 : .50);
  }
  return safe;
}

interface SweetSpotRecipe {
  name: string;
  parameters: Record<string, MusicalRange>;
}

// Named hardware modes do not use the generic full-module random ranges. Each recipe
// represents a recognizable operating point, then MUSICAL RANDOM adds a small amount
// of variation around that center so the result stays in the machine's useful zone.
const HARDWARE_SWEET_SPOTS: Record<string, readonly SweetSpotRecipe[]> = {
  'saturation:goldlion': [
    { name: 'OPEN COLOR', parameters: { drive:[0.16,0.30], tone:[0.60,0.78], heat:[0.14,0.30], character:[0.46,0.58], dynamics:[0.34,0.50], mix:[0.18,0.30] } },
  ],
  'saturation:mullard': [
    { name: 'WARM MIDRANGE', parameters: { drive:[0.18,0.32], tone:[0.42,0.62], heat:[0.28,0.44], character:[0.50,0.64], dynamics:[0.48,0.64], mix:[0.20,0.34] } },
  ],
  'saturation:telefunken': [
    { name: 'CLEAN DETAIL', parameters: { drive:[0.14,0.26], tone:[0.64,0.82], heat:[0.10,0.22], character:[0.44,0.54], dynamics:[0.30,0.46], mix:[0.16,0.28] } },
  ],
  'saturation:bugleboy': [
    { name: 'AIRY COLOR', parameters: { drive:[0.17,0.30], tone:[0.60,0.80], heat:[0.20,0.34], character:[0.54,0.66], dynamics:[0.38,0.54], mix:[0.18,0.31] } },
  ],
  'saturation:rcablack': [
    { name: 'THICK COLOR', parameters: { drive:[0.18,0.33], tone:[0.38,0.58], heat:[0.30,0.48], character:[0.56,0.70], dynamics:[0.52,0.68], mix:[0.20,0.34] } },
  ],

  'chorus:ce1': [
    { name: 'CLASSIC MID INTENSITY', parameters: { rate:[0.09,0.11], depth:[0.27,0.31], shape:[0.46,0.66], spread:[0.80,0.86], motion:[0.16,0.30], mix:[0.20,0.34] } },
  ],
  'chorus:dimensiond': [
    { name: 'MODE 2 WIDTH', parameters: { rate:[0.08,0.10], depth:[0.24,0.28], shape:[0.18,0.25], spread:[0.88,0.94], motion:[0.16,0.20], mix:[0.16,0.29] } },
    { name: 'MODE 3 MOTION', parameters: { rate:[0.18,0.20], depth:[0.22,0.26], shape:[0.31,0.39], spread:[0.88,0.94], motion:[0.16,0.20], mix:[0.16,0.29] } },
  ],
  'chorus:phase90': [
    { name: 'SCRIPT SLOW BURN', parameters: { rate:[0.05,0.13], depth:[0.42,0.66], shape:[0.16,0.38], spread:[0.08,0.30], motion:[0.16,0.34], mix:[0.14,0.28] } },
    { name: 'BLOCK SWOOSH', parameters: { rate:[0.18,0.34], depth:[0.58,0.82], shape:[0.62,0.82], spread:[0.22,0.48], motion:[0.20,0.42], mix:[0.16,0.30] } },
  ],
  'chorus:instantphaser': [
    { name: 'PS101 PSEUDO STEREO', parameters: { rate:[0.05,0.15], depth:[0.46,0.74], shape:[0.24,0.48], spread:[0.82,1.00], motion:[0.22,0.48], mix:[0.16,0.32] } },
    { name: 'DEEP DRUM WASH', parameters: { rate:[0.10,0.24], depth:[0.66,0.88], shape:[0.42,0.66], spread:[0.42,0.58], motion:[0.34,0.62], mix:[0.18,0.34] } },
  ],
  'chorus:schulte': [
    { name: 'KRAUTROCK DRIFT', parameters: { rate:[0.03,0.10], depth:[0.58,0.86], shape:[0.34,0.58], spread:[0.38,0.68], motion:[0.48,0.78], mix:[0.16,0.32] } },
    { name: 'OPTICAL TIDE', parameters: { rate:[0.08,0.20], depth:[0.46,0.72], shape:[0.22,0.46], spread:[0.68,0.92], motion:[0.36,0.66], mix:[0.14,0.30] } },
  ],
  'chorus:pn2': [
    { name: 'TRIANGLE PAN', parameters: { rate:[0.08,0.24], depth:[0.52,0.78], shape:[0.04,0.28], spread:[0.64,0.92], motion:[0.20,0.46], mix:[0.16,0.30] } },
    { name: 'SQUARE CHOP', parameters: { rate:[0.18,0.40], depth:[0.72,0.94], shape:[0.74,0.96], spread:[0.56,0.86], motion:[0.68,0.92], mix:[0.12,0.26] } },
  ],

  'delay:re201': [
    { name: 'MODE 3 SYNCOPATED', parameters: { time:[0.20,0.36], feedback:[0.24,0.40], color:[0.45,0.62], character:[0.14,0.30], width:[0.31,0.39], mix:[0.18,0.30] } },
    { name: 'MODE 6 DUB', parameters: { time:[0.14,0.28], feedback:[0.38,0.56], color:[0.38,0.55], character:[0.22,0.38], width:[0.74,0.82], mix:[0.20,0.34] } },
  ],
  'delay:EP-3 Echoplex': [
    { name: 'TAPE SLAP', parameters: { time:[0.055,0.095], feedback:[0.10,0.22], color:[0.48,0.68], character:[0.12,0.28], width:[0.38,0.58], mix:[0.16,0.28] } },
    { name: 'WARM LEAD ECHO', parameters: { time:[0.14,0.25], feedback:[0.28,0.44], color:[0.38,0.58], character:[0.20,0.36], width:[0.44,0.66], mix:[0.18,0.32] } },
  ],
  'delay:Binson Echorec': [
    { name: 'DRUM RHYTHM', parameters: { time:[0.11,0.22], feedback:[0.24,0.40], color:[0.52,0.72], character:[0.08,0.22], width:[0.48,0.68], mix:[0.16,0.28] } },
    { name: 'SWELLS', parameters: { time:[0.18,0.30], feedback:[0.38,0.52], color:[0.42,0.62], character:[0.18,0.32], width:[0.62,0.82], mix:[0.20,0.34] } },
  ],
  'delay:Deluxe Memory Man': [
    { name: 'CHORUS ECHO', parameters: { time:[0.10,0.20], feedback:[0.22,0.38], color:[0.34,0.52], character:[0.25,0.42], width:[0.58,0.78], mix:[0.18,0.30] } },
    { name: 'DARK BBD', parameters: { time:[0.16,0.28], feedback:[0.30,0.48], color:[0.20,0.38], character:[0.16,0.30], width:[0.45,0.66], mix:[0.20,0.34] } },
  ],
  'delay:AMS DMX 15-80 S': [
    { name: 'DIGITAL DOUBLE', parameters: { time:[0.06,0.12], feedback:[0.12,0.24], color:[0.58,0.78], character:[0.10,0.22], width:[0.68,0.88], mix:[0.14,0.26] } },
    { name: 'PITCH SPACE', parameters: { time:[0.18,0.34], feedback:[0.24,0.42], color:[0.52,0.72], character:[0.30,0.50], width:[0.72,0.92], mix:[0.18,0.30] } },
  ],

  'reverb:emt140': [
    { name: 'PLATE A · 3.0 S', parameters: { decay:[0.48,0.52], size:[0.49,0.51], color:[0.52,0.68], diffusion:[0.68,0.84], motion:[0.00,0.00], mix:[0.18,0.30] } },
  ],
  'reverb:lexicon224': [
    { name: 'ROOM A STYLE', parameters: { decay:[0.60,0.68], size:[0.48,0.64], color:[0.36,0.54], diffusion:[0.68,0.86], motion:[0.14,0.28], mix:[0.16,0.30] } },
    { name: 'VOCAL PLATE STYLE', parameters: { decay:[0.46,0.58], size:[0.18,0.34], color:[0.55,0.74], diffusion:[0.42,0.62], motion:[0.08,0.20], mix:[0.18,0.32] } },
  ],

  'bitcrusher:clouds': [
    { name: 'DIFFUSE CLOUD', parameters: { bits:[0.34,0.58], density:[0.58,0.76], pitch:[0.00,0.16], chaos:[0.26,0.48], bloom:[0.46,0.66], mix:[0.20,0.34] } },
    { name: 'FROZEN DISSOLVE', parameters: { bits:[0.58,0.82], density:[0.48,0.68], pitch:[0.08,0.28], chaos:[0.48,0.72], bloom:[0.68,0.84], mix:[0.22,0.38] } },
  ],
  'bitcrusher:beads': [
    { name: 'CLEAN STEREO STREAM', parameters: { bits:[0.22,0.48], density:[0.42,0.66], pitch:[0.00,0.20], chaos:[0.16,0.38], bloom:[0.16,0.34], mix:[0.18,0.32] } },
    { name: 'RANDOM CLOCK', parameters: { bits:[0.12,0.34], density:[0.28,0.52], pitch:[0.18,0.42], chaos:[0.54,0.78], bloom:[0.22,0.42], mix:[0.18,0.34] } },
  ],
  'bitcrusher:morphagene': [
    { name: 'SPLICED REEL', parameters: { bits:[0.28,0.52], density:[0.42,0.66], pitch:[0.08,0.28], chaos:[0.22,0.46], bloom:[0.42,0.68], mix:[0.20,0.36] } },
    { name: 'VARI-SPEED GENES', parameters: { bits:[0.12,0.34], density:[0.56,0.76], pitch:[0.38,0.62], chaos:[0.44,0.70], bloom:[0.26,0.48], mix:[0.18,0.34] } },
  ],
  'bitcrusher:arbhar': [
    { name: 'SIX LAYER STRATA', parameters: { bits:[0.30,0.58], density:[0.44,0.68], pitch:[0.00,0.18], chaos:[0.24,0.48], bloom:[0.52,0.78], mix:[0.20,0.36] } },
    { name: 'ONSET SPRAY', parameters: { bits:[0.12,0.30], density:[0.60,0.82], pitch:[0.14,0.36], chaos:[0.56,0.80], bloom:[0.32,0.58], mix:[0.18,0.34] } },
  ],
  'bitcrusher:particle2': [
    { name: 'REVERSE BUBBLES', parameters: { bits:[0.18,0.38], density:[0.34,0.58], pitch:[0.18,0.42], chaos:[0.46,0.72], bloom:[0.28,0.48], mix:[0.20,0.36] } },
    { name: 'SHIMMER REPEATS', parameters: { bits:[0.32,0.56], density:[0.48,0.70], pitch:[0.42,0.68], chaos:[0.18,0.40], bloom:[0.48,0.68], mix:[0.20,0.36] } },
  ],
  'bitcrusher:microcosm': [
    { name: 'MOSAIC CASCADE', parameters: { bits:[0.28,0.48], density:[0.44,0.66], pitch:[0.20,0.42], chaos:[0.24,0.48], bloom:[0.46,0.68], mix:[0.20,0.36] } },
    { name: 'GLITCH SEQUENCE', parameters: { bits:[0.52,0.74], density:[0.54,0.78], pitch:[0.36,0.62], chaos:[0.52,0.76], bloom:[0.32,0.56], mix:[0.18,0.34] } },
  ],

  'saturation:sp1200': [
    { name: 'FILTERED DRUM BUS', parameters: { drive:[0.42,0.62], tone:[0.05,0.20], heat:[0.12,0.28], character:[0.46,0.66], dynamics:[0.32,0.50], mix:[0.18,0.32] } },
  ],
  'saturation:mpc60': [
    { name: 'CLASSIC 40K', parameters: { drive:[0.40,0.58], tone:[0.50,0.50], heat:[0.28,0.46], character:[0.54,0.72], dynamics:[0.34,0.52], mix:[0.18,0.30] } },
  ],
  'saturation:mirage': [
    { name: 'CLASSIC 29K', parameters: { drive:[0.38,0.58], tone:[0.80,0.88], heat:[0.18,0.34], character:[0.48,0.68], dynamics:[0.34,0.52], mix:[0.18,0.30] } },
  ],
  'saturation:s950': [
    { name: 'VARIABLE CLOCK', parameters: { drive:[0.34,0.56], tone:[0.34,0.72], heat:[0.12,0.30], character:[0.46,0.74], dynamics:[0.30,0.50], mix:[0.18,0.31] } },
  ],
  'saturation:emulator2': [
    { name: 'COMPANDED FILTER', parameters: { drive:[0.34,0.54], tone:[0.50,0.50], heat:[0.22,0.42], character:[0.42,0.70], dynamics:[0.36,0.56], mix:[0.18,0.31] } },
  ],
  'saturation:fairlightiix': [
    { name: 'EARLY DIGITAL', parameters: { drive:[0.30,0.50], tone:[0.30,0.74], heat:[0.20,0.38], character:[0.44,0.72], dynamics:[0.34,0.54], mix:[0.18,0.31] } },
  ],

  'media:tascam424': [
    { name: 'ELASTIC DI', parameters: { wear:[0.28,0.42], wow:[0.14,0.19], noise:[0.09,0.13], tone:[0.30,0.44], mix:[0.22,0.36] } },
    { name: 'PUSHED PREAMP', parameters: { wear:[0.40,0.54], wow:[0.13,0.18], noise:[0.08,0.13], tone:[0.46,0.58], mix:[0.24,0.38] } },
  ],
  'media:Neve 1073': [
    { name: 'IRON THICKENER', parameters: { wear:[0.22,0.36], wow:[0.16,0.23], noise:[0.10,0.16], tone:[0.22,0.38], mix:[0.22,0.38] } },
    { name: 'PUSHED CHANNEL', parameters: { wear:[0.35,0.50], wow:[0.17,0.26], noise:[0.10,0.18], tone:[0.34,0.50], mix:[0.20,0.34] } },
  ],
  'media:SSL 4000E': [
    { name: 'BUS EDGE', parameters: { wear:[0.16,0.28], wow:[0.14,0.20], noise:[0.12,0.20], tone:[0.22,0.38], mix:[0.18,0.32] } },
    { name: 'VCA PUSH', parameters: { wear:[0.28,0.42], wow:[0.14,0.20], noise:[0.14,0.22], tone:[0.38,0.54], mix:[0.20,0.34] } },
  ],
  'media:API 1608': [
    { name: 'PUNCH BUS', parameters: { wear:[0.20,0.34], wow:[0.18,0.26], noise:[0.12,0.20], tone:[0.24,0.40], mix:[0.20,0.34] } },
    { name: 'OUTPUT IRON', parameters: { wear:[0.28,0.42], wow:[0.17,0.24], noise:[0.11,0.18], tone:[0.40,0.56], mix:[0.20,0.34] } },
  ],
  'media:Ampex ATR-102': [
    { name: '7.5 IPS THICK', parameters: { wear:[0.24,0.40], wow:[0.10,0.13], noise:[0.04,0.12], tone:[0.42,0.54], mix:[0.24,0.42] } },
    { name: '15 IPS GLUE', parameters: { wear:[0.22,0.38], wow:[0.24,0.56], noise:[0.02,0.10], tone:[0.46,0.58], mix:[0.24,0.42] } },
    { name: '30 IPS CLEAN', parameters: { wear:[0.16,0.30], wow:[0.68,0.84], noise:[0.00,0.06], tone:[0.48,0.56], mix:[0.20,0.36] } },
  ],
  'media:Neve BCM10': [
    { name: 'CLEAN CLASS-A', parameters: { wear:[0.14,0.28], wow:[0.14,0.21], noise:[0.07,0.14], tone:[0.24,0.40], mix:[0.18,0.30] } },
    { name: 'IRON BUS', parameters: { wear:[0.28,0.46], wow:[0.16,0.25], noise:[0.08,0.16], tone:[0.40,0.58], mix:[0.20,0.34] } },
  ],
};

function withMusicalRandomMode(module: ModuleState): ModuleState {
  if (module.id === 'saturation') return { ...module, emberMode: chooseMusicalDifferent(MUSICAL_EMBER_MODES, module.emberMode) };
  if (module.id === 'chorus') return { ...module, driftMode: chooseMusicalDifferent(MUSICAL_DRIFT_MODES, module.driftMode) };
  if (module.id === 'delay') return { ...module, delayAlgorithm: chooseMusicalDifferent(MUSICAL_HALO_MODES, module.delayAlgorithm) };
  if (module.id === 'reverb') return { ...module, algorithm: chooseMusicalDifferent(MUSICAL_ATMOS_MODES, module.algorithm) };
  if (module.id === 'bitcrusher') return { ...module, grainMode: chooseMusicalDifferent(MUSICAL_GRAIN_MODES, module.grainMode) };
  if (module.id === 'media') return { ...module, mediaMode: chooseMusicalDifferent(MUSICAL_MEDIA_MODES, module.mediaMode) };
  return module;
}

function hardwareSweetSpotKey(module: ModuleState): string | null {
  const mode = module.id === 'saturation' ? module.emberMode
    : module.id === 'chorus' ? module.driftMode
    : module.id === 'delay' ? module.delayAlgorithm
    : module.id === 'reverb' ? module.algorithm
    : module.id === 'bitcrusher' ? module.grainMode
    : module.id === 'media' ? module.mediaMode
    : undefined;
  return mode ? `${module.id}:${mode}` : null;
}

function chooseHardwareSweetSpot(module: ModuleState): SweetSpotRecipe | null {
  const key = hardwareSweetSpotKey(module);
  const recipes = key ? HARDWARE_SWEET_SPOTS[key] : undefined;
  return recipes?.length ? chooseMusical(recipes) : null;
}

const MUSICAL_EMBER_MODES: readonly EmberMode[] = [...EMBER_MODE_ORDER];
const MUSICAL_DRIFT_MODES: readonly DriftMode[] = [...DRIFT_MODE_ORDER];
const MUSICAL_HALO_MODES: readonly DelayAlgorithm[] = [...DELAY_ALGORITHM_ORDER];
const MUSICAL_ATMOS_MODES: readonly ReverbAlgorithm[] = [...REVERB_ALGORITHM_ORDER];
const MUSICAL_GRAIN_MODES: readonly GrainMode[] = [...GRAIN_MODE_ORDER];
const MUSICAL_MEDIA_MODES: readonly MediaMode[] = [...MEDIA_MODE_ORDER];

export default function App() {
  const nativeShell = new URLSearchParams(window.location.search).has('native-shell');
  const diagnosticAudio = import.meta.env.DEV
    && new URLSearchParams(window.location.search).has('diagnostic-audio');
  const engineRef = useRef<AudioEngine | null>(null);
  const nativeBridgeRef = useRef(new NativeAudioBridge());
  const backendRef = useRef<'web' | 'native' | null>(null);
  const [engineState, setEngineState] = useState<AudioEngineState>('idle');
  const [audioBackend, setAudioBackend] = useState<'native' | 'web' | null>(null);
  const [nativeTransport, setNativeTransport] = useState<'wasapi' | 'ks-wavert' | 'asio' | null>(null);
  const [canvasScale, setCanvasScale] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [appFullscreen, setAppFullscreen] = useState(false);
  const [modules, setModules] = useState<ModuleState[]>(INITIAL_MODULES);
  const [railAOrder, setRailAOrder] = useState<string[]>([...DEFAULT_RAIL_A_ORDER]);
  const [railBOrder, setRailBOrder] = useState<string[]>([...DEFAULT_RAIL_B_ORDER]);
  const [railCOrder, setRailCOrder] = useState<string[]>([...DEFAULT_RAIL_C_ORDER]);
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
    nativeShell
      ? 'CALCOTONE desktop is ready. Start the native audio engine.'
      : 'Start the audio engine when your interface is ready.'
  );
  const [randomFlowProgress, setRandomFlowProgress] =
    useState<RandomFlowProgress | null>(null);
  const [randomProfile, setRandomProfile] = useState<Exclude<RandomizationProfile, 'mutate'>>('smart');
  const [inputDevice, setInputDevice] = useState('No input connected');
  const [latency, setLatency] = useState('—');
  const [sampleRate, setSampleRate] = useState('—');
  const [nativeTuner, setNativeTuner] = useState({ hz: 0, level: 0 });
  const [nativeHealth, setNativeHealth] = useState<NativeAudioHealth | null>(null);
  const [xyPosition] = useState({ x: 50, y: 50 });
  const [analyser, setAnalyser] = useState<VisualSpectrumSource | null>(null);
  const [performanceMode, setPerformanceMode] =
    useState<PerformanceMode>('live');
  const [profiler, setProfiler] = useState<DspProfilerSnapshot | null>(null);
  const [profilerOpen, setProfilerOpen] = useState(false);
  const [gpuExperimentRunning, setGpuExperimentRunning] = useState(false);
  const [gpuExperiment, setGpuExperiment] = useState<GpuCabinetExperimentReport | null>(null);
  const [adaptiveMode, setAdaptiveMode] = useState(true);
  const [explainMode, setExplainMode] = useState(false);
  const [xyAssignments, setXyAssignments] = useState<XYAssignment[]>(
    INITIAL_XY_ASSIGNMENTS
  );
  const [patchDraft, setPatchDraft] = useState<PatchDraft | null>(null);
  const [persistentPatchLines, setPersistentPatchLines] = useState<
    PersistentPatchLine[]
  >([]);

  useEffect(() => {
    if (engineState !== 'running' || audioBackend !== 'native') {
      setNativeTuner({ hz: 0, level: 0 });
      setNativeHealth(null);
      return;
    }
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      const health = await nativeBridgeRef.current.readHealth();
      if (!cancelled && health) {
        setNativeTuner({ hz: health.tunerHz || 0, level: health.tunerLevel || 0 });
        setNativeHealth(health);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 80);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [audioBackend, engineState]);

  useEffect(() => {
    const syncNativePressure = (event: Event): void => {
      if (backendRef.current !== 'native') return;
      const state = (event as CustomEvent<SignalLabState>).detail ?? getPressureState();
      const bridge = nativeBridgeRef.current;
      void bridge.commandLine(`moduleBypass pressure ${state.enabled ? 0 : 1}`);
      void bridge.commandLine(`param pressure mode ${SIGNAL_LAB_MODES.indexOf(state.mode)}`);
      void bridge.commandLine(`param pressure style ${SIGNAL_LAB_STYLES.indexOf(state.style)}`);
      for (const key of ['drive', 'time', 'character', 'mix'] as const)
        void bridge.commandLine(`param pressure ${key} ${state[key]}`);
    };
    window.addEventListener('calcotone:pressure-change', syncNativePressure);
    return () => window.removeEventListener('calcotone:pressure-change', syncNativePressure);
  }, []);
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
  const randomUiPlanRef = useRef<RandomUiPlan | null>(null);
  const randomFlowActiveRef = useRef(false);
  const offlineRandomTimersRef = useRef<number[]>([]);

  const setStompEnabled = useCallback((enabled: boolean) => {
    if (backendRef.current === 'native') void nativeBridgeRef.current.commandLine(`moduleBypass stomp ${enabled ? 0 : 1}`);
  }, []);

  const setStompMode = useCallback((mode: number) => {
    if (backendRef.current === 'native') void nativeBridgeRef.current.commandLine(`param stomp mode ${mode}`);
  }, []);

  const setStompInputSource = useCallback((source: StackInputSource) => {
    if (backendRef.current !== 'native') return;
    const index = source === 'input-1' ? 0 : source === 'input-2' ? 1 : 2;
    void nativeBridgeRef.current.command('stompInput', index);
  }, []);

  const setStompParameters = useCallback((values: readonly number[]) => {
    if (backendRef.current !== 'native') return;
    for (const [index, parameter] of ['drive','tone','level','character','body','mix'].entries()) {
      const value = values[index];
      if (value !== undefined) void nativeBridgeRef.current.commandLine(`param stomp ${parameter} ${value}`);
    }
  }, []);

  const setStackEnabled = useCallback((enabled: boolean) => {
    if (backendRef.current === 'native') {
      void nativeBridgeRef.current.command('bypass', enabled ? 0 : 1);
      return;
    }
    engineRef.current?.setEffectBypassed('chaos', !enabled);
  }, []);

  const setStackModel = useCallback((model: StackAmpModel) => {
    const index = STACK_AMP_MODELS.indexOf(model);
    if (index < 0) return;
    if (backendRef.current === 'native') void nativeBridgeRef.current.command('model', index);
    else engineRef.current?.setEffectParameter('chaos', 'model', index);
  }, []);

  const setStackCabinet = useCallback((cabinet: StackCabinet) => {
    const index = STACK_CABINETS.indexOf(cabinet);
    if (index < 0) return;
    if (backendRef.current === 'native') void nativeBridgeRef.current.command('cab', index);
    else engineRef.current?.setEffectParameter('chaos', 'cabinet', index);
  }, []);

  const setStackInputSource = useCallback((source: StackInputSource) => {
    if (backendRef.current !== 'native') return;
    const index = source === 'input-1' ? 0 : source === 'input-2' ? 1 : 2;
    void nativeBridgeRef.current.command('stackInput', index);
  }, []);

  const setStackParameters = useCallback((values: readonly number[]) => {
    if (backendRef.current === 'native') {
      for (const [index, parameterId] of ['drive', 'tone', 'sag', 'mix'].entries()) {
        const value = values[index];
        if (value !== undefined) void nativeBridgeRef.current.command(parameterId, value);
      }
      return;
    }
    const engine = engineRef.current;
    if (!engine?.getEffect('chaos')) return;
    for (const [index, parameterId] of ['drive', 'tone', 'sag', 'mix'].entries()) {
      const value = values[index];
      if (value !== undefined) engine.setEffectParameter('chaos', parameterId, value);
    }
  }, []);

  useEffect(() => {
    setRailCRandomOrder([...railAOrder, ...railBOrder, ...railCOrder]);
  }, [railAOrder, railBOrder, railCOrder]);

  function getEngine(): AudioEngine {
    if (!engineRef.current) {
      engineRef.current = new AudioEngine();
    }

    return engineRef.current;
  }

  function railForModule(moduleId: string): RoutingRail | null {
    if (railAOrder.includes(moduleId)) return 'A';
    if (railBOrder.includes(moduleId)) return 'B';
    if (railCOrder.includes(moduleId)) return 'C';
    return null;
  }

  function getModuleById(moduleId: string): ModuleState | undefined {
    return modules.find((module) => module.id === moduleId);
  }


  async function applyRoutingOrder(nextA: string[], nextB: string[], nextC: string[]): Promise<void> {
    const order = serialOrderFromRack({ A: nextA, B: nextB, C: nextC });
    if (backendRef.current === 'native') {
      await nativeBridgeRef.current.commandLine(`order ${order.join(' ')}`);
      setMessage(`Native routing updated · A ${formatRailOrder(nextA)} · B ${formatRailOrder(nextB)} · C ${formatRailOrder(nextC)}`);
      return;
    }
    const engine = engineRef.current;
    if (!engine || engineState !== 'running') return;

    try {
      await engine.reorderEffectsClickSafe(order);
      setMessage(
        `Routing updated · A ${formatRailOrder(nextA)} · B ${formatRailOrder(nextB)} · C ${formatRailOrder(nextC)}`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Signal routing could not be updated.');
    }
  }

  function reorderWithinRail(sourceId: string, targetId: string): void {
    if (sourceId === targetId) return;
    const next = moveRackModule(
      { A: railAOrder, B: railBOrder, C: railCOrder },
      sourceId,
      targetId,
    );
    setRailAOrder(next.A);
    setRailBOrder(next.B);
    setRailCOrder(next.C);
    void applyRoutingOrder(next.A, next.B, next.C);
  }

  function nudgeModuleWithinRail(moduleId: string, direction: -1 | 1): void {
    const next = nudgeRackModule(
      { A: railAOrder, B: railBOrder, C: railCOrder },
      moduleId,
      direction,
    );
    setRailAOrder(next.A);
    setRailBOrder(next.B);
    setRailCOrder(next.C);
    void applyRoutingOrder(next.A, next.B, next.C);
  }

  function resetRailOrder(rail: RoutingRail): void {
    const next = restoreRackRail(
      { A: railAOrder, B: railBOrder, C: railCOrder },
      rail,
      DEFAULT_RACK_ORDERS,
    );
    setRailAOrder(next.A);
    setRailBOrder(next.B);
    setRailCOrder(next.C);

    setDraggedModuleId(null);
    setDragOverModuleId(null);

    if (engineState === 'running') {
      void applyRoutingOrder(next.A, next.B, next.C);
    } else {
      setMessage(`Rail ${rail} reset to factory order. Applies on power-up.`);
    }
  }

  function randomizeSignalOrder(): void {
    const next = shuffledRackOrder({ A: railAOrder, B: railBOrder, C: railCOrder });
    setRailAOrder(next.A);
    setRailBOrder(next.B);
    setRailCOrder(next.C);
    setDraggedModuleId(null);
    setDragOverModuleId(null);

    if (engineState === 'running') {
      void applyRoutingOrder(next.A, next.B, next.C);
    } else {
      setMessage(
        `Signal randomized · A ${formatRailOrder(next.A)} · B ${formatRailOrder(next.B)} · C ${formatRailOrder(next.C)} · applies on power-up`
      );
    }
  }

  async function startAudio(): Promise<void> {
    try {
      setEngineState('starting');
      setMessage('Looking for the native low-latency engine...');
      const native = await nativeBridgeRef.current.probe();
      if (native) {
        backendRef.current = 'native';
        setAudioBackend('native');
        setNativeTransport(native.transport ?? 'wasapi');
        await Promise.all([
          nativeBridgeRef.current.command('active', 1),
          nativeBridgeRef.current.command('inputGain', inputGain),
          nativeBridgeRef.current.command('outputGain', outputGain),
          nativeBridgeRef.current.command('quality', performanceMode === 'studio' ? 4 : performanceMode === 'balanced' ? 2 : 1),
        ]);
        const nativeSync: Promise<boolean>[] = [];
        for (const module of modules) {
          nativeSync.push(nativeBridgeRef.current.commandLine(`moduleBypass ${module.id} ${module.enabled ? 0 : 1}`));
          for (const parameter of module.parameters) {
            nativeSync.push(nativeBridgeRef.current.commandLine(
              `param ${module.id} ${parameter.id} ${toDspParameterValue(module.id, parameter.id, parameter.value)}`
            ));
          }
          if (module.id === 'saturation' && module.emberMode) nativeSync.push(nativeBridgeRef.current.commandLine(`param saturation mode ${EMBER_MODE_ORDER.indexOf(module.emberMode)}`));
          if (module.id === 'chorus' && module.driftMode) nativeSync.push(nativeBridgeRef.current.commandLine(`param chorus mode ${DRIFT_MODE_ORDER.indexOf(module.driftMode)}`));
          if (module.id === 'delay' && module.delayAlgorithm) nativeSync.push(nativeBridgeRef.current.commandLine(`param delay algorithm ${DELAY_ALGORITHMS.indexOf(module.delayAlgorithm)}`));
          if (module.id === 'reverb' && module.algorithm) nativeSync.push(nativeBridgeRef.current.commandLine(`param reverb algorithm ${REVERB_ALGORITHMS.indexOf(module.algorithm)}`));
          if (module.id === 'bitcrusher' && module.grainMode) nativeSync.push(nativeBridgeRef.current.commandLine(`param bitcrusher mode ${GRAIN_MODE_ORDER.indexOf(module.grainMode)}`));
          if (module.id === 'media' && module.mediaMode) nativeSync.push(nativeBridgeRef.current.commandLine(`param media mode ${MEDIA_MODE_ORDER.indexOf(module.mediaMode)}`));
        }
        const pressure = getPressureState();
        nativeSync.push(nativeBridgeRef.current.commandLine(`moduleBypass pressure ${pressure.enabled ? 0 : 1}`));
        nativeSync.push(nativeBridgeRef.current.commandLine(`param pressure mode ${SIGNAL_LAB_MODES.indexOf(pressure.mode)}`));
        nativeSync.push(nativeBridgeRef.current.commandLine(`param pressure style ${SIGNAL_LAB_STYLES.indexOf(pressure.style)}`));
        for (const key of ['drive', 'time', 'character', 'mix'] as const)
          nativeSync.push(nativeBridgeRef.current.commandLine(`param pressure ${key} ${pressure[key]}`));
        nativeSync.push(nativeBridgeRef.current.commandLine(`order ${serialOrderFromRack({ A: railAOrder, B: railBOrder, C: railCOrder }).join(' ')}`));
        await Promise.all(nativeSync);
        setInputDevice(native.captureDevice || 'Windows native input');
        setLatency(`${native.estimatedPathMs.toFixed(1)} ms ${native.transport ?? 'wasapi'} ${native.audioMode ?? 'shared'} path`);
        setSampleRate(`${native.sampleRate} Hz`);
        setChannelInfo({ input: `${native.inputChannels} ch native`, output: `${native.outputChannels} ch native` });
        setAnalyser(new NativeVisualSpectrum());
        setEngineState('running');
        const fallback = native.requestedBackend === 'ks-wavert' && native.transport !== 'ks-wavert'
          ? ` · KS/WaveRT probe ${native.ksAvailable ? 'eligible' : 'unavailable'}; WASAPI fallback active`
          : '';
        setMessage(`Native ${native.transport.toUpperCase()} audio is active · ${native.captureDevice} → ${native.renderDevice} · ${native.inputPeriodFrames}/${native.outputBufferFrames} frames${fallback}.`);
        return;
      }

      if (nativeShell) {
        throw new Error(`Native desktop connection failed: ${nativeBridgeRef.current.getLastProbeFailure()}`);
      }

      backendRef.current = 'web';
      setAudioBackend('web');
      setNativeTransport(null);
      const engine = getEngine();
      setMessage(diagnosticAudio
        ? 'Starting the built-in DSP diagnostic signal...'
        : 'Requesting access to the audio input...');

      await engine.start({ performanceMode, inputMode, diagnosticSignal: diagnosticAudio });
      engine.loadPreset(DEFAULT_PRESET);
      engine.reorderEffects(serialOrderFromRack({ A: railAOrder, B: railBOrder, C: railCOrder }));
      engine.setInputGain(inputGain);
      engine.setInputMode(inputMode);
      engine.setInputWidth(inputWidth);
      engine.setInputPolarity(invertLeft, invertRight);
      engine.setOutputGain(outputGain);
      engine.setAdaptiveMode(adaptiveMode);
      syncModuleParameters(engine, modules);
      auditUiAgainstEngine(engine, modules);
      engine.setPerformanceMode(performanceMode);

      const latencyInfo = engine.getLatencyReport();
      const track = engine.getInputStream()?.getAudioTracks()[0];
      const context = engine.getContext();

      setInputDevice(diagnosticAudio ? 'Built-in DSP diagnostic signal' : track?.label || 'Default audio input');
      setLatency(
        latencyInfo.estimatedRoundTrip !== null
          ? `${latencyInfo.pathEstimateComplete ? '' : '≥'}${(latencyInfo.estimatedRoundTrip * 1000).toFixed(1)} ms`
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
      setAnalyser(engine.getVisualSpectrumSource());
      setEngineState('running');
      setMessage(
        `WEB AUDIO FALLBACK · ${nativeBridgeRef.current.getLastProbeFailure()}`
      );
    } catch (error) {
      // engine.start() is transactional internally, but failures after it returns
      // (preset construction, UI/DSP audit, later startup sync) must also tear
      // down the opened MediaStream/AudioContext before showing ERROR.
      try {
        await engineRef.current?.stop();
      } catch (cleanupError) {
        console.error('CALCOTONE startup cleanup failed.', cleanupError);
      }
      setAnalyser(null);
      backendRef.current = null;
      setAudioBackend(null);
      setNativeTransport(null);
      setEngineState('error');
      setMessage(
        error instanceof Error
          ? error.message
          : 'The audio engine could not start.'
      );
    }
  }

  async function testGpuCabinet(): Promise<void> {
    if (engineState === 'running' || engineState === 'starting') {
      setMessage('Stop the audio engine before running the GPU cabinet deadline test.');
      return;
    }
    setGpuExperimentRunning(true);
    setGpuExperiment(null);
    setMessage('Testing WebGPU cabinet convolution against realtime audio deadlines...');
    try {
      const report = await runGpuCabinetExperiment();
      setGpuExperiment(report);
      setMessage(`GPU CAB TEST · ${report.verdict.toUpperCase()} · ${report.message}`);
    } catch (error) {
      setGpuExperiment({
        supported: false,
        verdict: 'unsupported',
        message: error instanceof Error ? error.message : 'WebGPU cabinet test failed.',
        taps: 1024,
        sampleRate: 48_000,
        batches: [],
      });
      setMessage(error instanceof Error ? `GPU CAB TEST · ${error.message}` : 'GPU CAB TEST failed.');
    } finally {
      setGpuExperimentRunning(false);
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

  async function startRecording(): Promise<void> {
    if (backendRef.current === 'native' && engineState === 'running') {
      const started = await nativeBridgeRef.current.commandLine('recordStart');
      if (!started) { setRecordingState('error'); setMessage('Native recorder could not start.'); return; }
      if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
      setRecordedTake(null); setRecordingSeconds(0); setRecordingState('recording');
      beginRecordingTimer(120);
      setMessage('Recording the final native stereo output at 24-bit PCM.');
      return;
    }
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
    if (backendRef.current === 'native' && recordingState === 'recording') {
      clearRecordingTimer();
      try {
        if (!await nativeBridgeRef.current.commandLine('recordStop')) throw new Error('Native recording could not be finalized.');
        const take = await nativeWaveToRecordedWav(await nativeBridgeRef.current.fetchRecording());
        const completeTake: RecordedTake = { ...take, createdAt: new Date() };
        const url = URL.createObjectURL(take.blob);
        setRecordedTake(completeTake);
        setPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return url; });
        setRecordingSeconds(take.durationSeconds); setRecordingState('ready');
        setMessage(reachedLimit ? 'Maximum native take captured and ready to save.' : 'Native take captured in lossless 24-bit stereo WAV format.');
      } catch (error) {
        setRecordingState('error');
        setMessage(error instanceof Error ? error.message : 'Native recording could not be finalized.');
      }
      return;
    }
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
    if (backendRef.current === 'native') void nativeBridgeRef.current.commandLine('recordCancel');
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
    if (backendRef.current === 'native') {
      if (recordingState === 'recording') await finishRecording();
      await nativeBridgeRef.current.command('active', 0);
      nativeBridgeRef.current.disconnect();
      backendRef.current = null;
      setAudioBackend(null);
      setNativeTransport(null);
      setAnalyser(null);
      setEngineState('stopped');
      setInputDevice('No input connected');
      setLatency('—');
      setSampleRate('—');
      setChannelInfo({ input: '—', output: '—' });
      setMessage('Native audio output muted.');
      return;
    }
    const engine = engineRef.current;

    if (!engine) {
      return;
    }

    if (engine.isRecording()) {
      await finishRecording();
    }
    clearRecordingTimer();
    await engine.stop();
    backendRef.current = null;
    setAudioBackend(null);
    setNativeTransport(null);
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
    if (backendRef.current === 'native') void nativeBridgeRef.current.command('inputGain', value);
    else engineRef.current?.setInputGain(value);
  }

  function updateOutputGain(value: number): void {
    setOutputGain(value);
    if (backendRef.current === 'native') void nativeBridgeRef.current.command('outputGain', value);
    else engineRef.current?.setOutputGain(value);
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
      const dspValue = toDspParameterValue(moduleId, parameterId, value);
      if (backendRef.current === 'native') void nativeBridgeRef.current.commandLine(`param ${moduleId} ${parameterId} ${dspValue}`);
      else setEffectParameterIfLoaded(engineRef.current, moduleId, parameterId, dspValue);
    }
  }

  function updateDelayAlgorithm(algorithm: DelayAlgorithm): void {
    setModules((currentModules) =>
      currentModules.map((module) =>
        module.id === 'delay' ? { ...module, delayAlgorithm: algorithm } : module
      )
    );
    const index = DELAY_ALGORITHMS.indexOf(algorithm);
    if (backendRef.current === 'native') void nativeBridgeRef.current.commandLine(`param delay algorithm ${index}`);
    else setEffectParameterIfLoaded(engineRef.current, 'delay', 'algorithm', index);
    setMessage(`Halo changed to ${algorithm}. Existing repeats will fade naturally.`);
  }

  function updateReverbAlgorithm(algorithm: ReverbAlgorithm): void {
    setModules((currentModules) =>
      currentModules.map((module) =>
        module.id === 'reverb' ? { ...module, algorithm } : module
      )
    );
    const index = REVERB_ALGORITHMS.indexOf(algorithm);
    if (backendRef.current === 'native') void nativeBridgeRef.current.commandLine(`param reverb algorithm ${index}`);
    else setEffectParameterIfLoaded(engineRef.current, 'reverb', 'algorithm', index);
    setMessage(`Atmos changed to ${algorithm}. Existing tails will fade naturally.`);
  }

  function updateEmberMode(mode: EmberMode): void {
    setModules((current) => current.map((module) => module.id === 'saturation' ? { ...module, emberMode: mode } : module));
    const index = EMBER_MODE_ORDER.indexOf(mode);
    if (backendRef.current === 'native') void nativeBridgeRef.current.commandLine(`param saturation mode ${index}`);
    else setEffectParameterIfLoaded(engineRef.current, 'saturation', 'mode', index);
    setMessage(`Ember changed to ${mode}.`);
  }

  function updateDriftMode(mode: DriftMode): void {
    setModules((current) => current.map((module) => module.id === 'chorus' ? { ...module, driftMode: mode } : module));
    const index = DRIFT_MODE_ORDER.indexOf(mode);
    if (backendRef.current === 'native') void nativeBridgeRef.current.commandLine(`param chorus mode ${index}`);
    else setEffectParameterIfLoaded(engineRef.current, 'chorus', 'mode', index);
    setMessage(`Drift changed to ${mode}.`);
  }

  function updateGrainMode(mode: GrainMode): void {
    setModules((current) => current.map((module) => module.id === 'bitcrusher' ? { ...module, grainMode: mode } : module));
    const index = GRAIN_MODE_ORDER.indexOf(mode);
    if (backendRef.current === 'native') void nativeBridgeRef.current.commandLine(`param bitcrusher mode ${index}`);
    else setEffectParameterIfLoaded(engineRef.current, 'bitcrusher', 'mode', index);
    setMessage(`Grain changed to ${mode}.`);
  }

  function updateMediaMode(mode: MediaMode): void {
    setModules((currentModules) =>
      currentModules.map((module) =>
        module.id === 'media' ? { ...module, mediaMode: mode } : module
      )
    );
    const index = MEDIA_MODE_ORDER.indexOf(mode);
    if (backendRef.current === 'native') void nativeBridgeRef.current.commandLine(`param media mode ${index}`);
    else setEffectParameterIfLoaded(engineRef.current, 'media', 'mode', index);
    setMessage(`Artifact changed to ${mode}.`);
  }


  function randomizeActiveModules(profile: RandomizationProfile = randomProfile): void {
    const activeModules = modules.filter((module) => module.enabled && module.available);
    const activeRailC = getActiveRailCRandomModuleIds();
    const activeCount = activeModules.length + activeRailC.length;
    if (activeCount === 0) {
      setMessage('Turn on at least one module before using MUSICAL RANDOM.');
      return;
    }

    const sweetSpotsUsed: string[] = [];
    const nextModules = modules.map((module) => {
      if (!module.enabled || !module.available) return module;

      // Pick the module mode first. Hardware recipes depend on the selected machine,
      // so its operating point must be chosen before the knobs are randomized.
      const profileRecipe = RANDOM_PROFILE_RECIPES[profile]?.[module.id];
      const modeModule = profile === 'mutate'
        ? module
        : profileRecipe
          ? applyProfileMode(module, profileRecipe.mode)
          : withMusicalRandomMode(module);
      const sweetSpot = profile === 'smart' ? chooseHardwareSweetSpot(modeModule) : null;
      if (sweetSpot) sweetSpotsUsed.push(`${modeModule.name}: ${sweetSpot.name}`);

      const genericRanges = MUSICAL_RANDOM_RANGES[modeModule.id] ?? {};
      const nextParameters = modeModule.parameters.map((parameter) => {
        const range = profileRecipe?.parameters[parameter.id]
          ?? sweetSpot?.parameters[parameter.id]
          ?? genericRanges[parameter.id];
        if (!range) return parameter;

        // Hardware recipes are intentionally tighter and more center-biased than the
        // creative modes: variation around a known good setting, not a lottery ticket.
        let next = profile === 'mutate'
          ? parameter.value + (Math.random() * 2 - 1) * RANDOM_MUTATION_AMOUNT
          : randomMusicalValue(range, sweetSpot || profileRecipe ? 0.60 : 0.35);

        // Extra guardrails for parameters where combinations can get unruly.
        if (modeModule.id === 'delay' && parameter.id === 'feedback') {
          next = Math.min(next, (modeModule.delayAlgorithm === 'constellation' || modeModule.delayAlgorithm === 'scatter') ? 0.56 : 0.68);
        }
        if (modeModule.id === 'reverb' && parameter.id === 'decay' && modeModule.algorithm === 'freeze') {
          next = Math.max(0.48, next);
        }
        if (modeModule.id === 'bitcrusher' && parameter.id === 'chaos') {
          next = Math.min(next, 0.52);
        }
        if (modeModule.id === 'media' && modeModule.mediaMode === 'Neve BCM10') {
          if (parameter.id === 'tone') next = Math.min(next, 0.68);
          if (parameter.id === 'wear') next = Math.min(next, 0.72);
          if (parameter.id === 'mix') next = Math.min(next, 0.38);
        }
        if (parameter.id === 'mix') {
          // Wet/dry is deliberately conservative so a randomized patch stays playable.
          next = Math.min(next, 0.52);
        }

        next = guardRandomParameter(modeModule.id, parameter.id, next);
        return {
          ...parameter,
          value: next,
          display: formatParameterValue(modeModule.id, parameter.id, next),
        };
      });

      return { ...modeModule, parameters: nextParameters };
    });

    const sweetSpotSummary = sweetSpotsUsed.length
      ? ` · Sweet spots: ${sweetSpotsUsed.join(' · ')}`
      : '';
    const profileLabel = profile === 'mutate'
      ? 'MUTATE 10%'
      : RANDOMIZATION_PROFILE_OPTIONS.find((option) => option.id === profile)?.label ?? 'Smart Patch';
    const finalMessage = `${profileLabel.toUpperCase()} reshaped ${activeCount} active module${activeCount === 1 ? '' : 's'} with guarded 350 ms morphing${sweetSpotSummary}.`;
    const targets = new Map(
      nextModules
        .filter((module) => module.enabled && module.available)
        .map((module) => [module.id, module])
    );
    const totalTargets = targets.size + activeRailC.length;

    for (const timer of offlineRandomTimersRef.current) window.clearTimeout(timer);
    offlineRandomTimersRef.current = [];
    randomUiPlanRef.current = {
      finalModules: nextModules,
      finalMessage,
      revealed: new Set(),
      targets,
      railCTargets: new Set(activeRailC),
      totalTargets,
      profile,
    };
    randomFlowActiveRef.current = true;
    setRandomFlowProgress({ current: 0, total: totalTargets });
    setMessage(`RANDOM FLOW queued · ${totalTargets} module packet${totalTargets === 1 ? '' : 's'}.`);

    if (engineState === 'running') {
      if (backendRef.current === 'native') {
        for (const module of nextModules) {
          if (!module.enabled) continue;
          if (module.id === 'saturation' && module.emberMode) void nativeBridgeRef.current.commandLine(`param saturation mode ${EMBER_MODE_ORDER.indexOf(module.emberMode)}`);
          if (module.id === 'chorus' && module.driftMode) void nativeBridgeRef.current.commandLine(`param chorus mode ${DRIFT_MODE_ORDER.indexOf(module.driftMode)}`);
          if (module.id === 'delay' && module.delayAlgorithm) void nativeBridgeRef.current.commandLine(`param delay algorithm ${DELAY_ALGORITHMS.indexOf(module.delayAlgorithm)}`);
          if (module.id === 'reverb' && module.algorithm) void nativeBridgeRef.current.commandLine(`param reverb algorithm ${REVERB_ALGORITHMS.indexOf(module.algorithm)}`);
          if (module.id === 'media' && module.mediaMode) void nativeBridgeRef.current.commandLine(`param media mode ${MEDIA_MODE_ORDER.indexOf(module.mediaMode)}`);
          if (module.id === 'bitcrusher' && module.grainMode) void nativeBridgeRef.current.commandLine(`param bitcrusher mode ${GRAIN_MODE_ORDER.indexOf(module.grainMode)}`);
          for (const parameter of module.parameters)
            void nativeBridgeRef.current.commandLine(`param ${module.id} ${parameter.id} ${toDspParameterValue(module.id, parameter.id, parameter.value)}`);
        }

        // Native DSP receives the new values immediately, but it does not emit the
        // browser transfer scheduler's RANDOM reveal events. Drive the same serial UI
        // packet flow locally so every controlled select and Rail C controller lands
        // on the exact state that is actually sounding.
        const orderedTargets = [
          ...RANDOM_UI_EFFECT_ORDER.filter((effectId) => targets.has(effectId)),
          ...activeRailC,
        ];
        for (const [index, effectId] of orderedTargets.entries()) {
          offlineRandomTimersRef.current.push(
            window.setTimeout(() => revealRandomUiModule(effectId), 48 + index * 96)
          );
        }
        offlineRandomTimersRef.current.push(
          window.setTimeout(() => completeRandomUiFlow(), 72 + orderedTargets.length * 96)
        );
        return;
      }
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
    } else {
      // Without live DSP there is no transfer scheduler to drive the UI. Preserve
      // the same serial reveal locally so RANDOM never falls back to a visual burst.
      const orderedTargets = [
        ...RANDOM_UI_EFFECT_ORDER.filter((effectId) => targets.has(effectId)),
        ...activeRailC,
      ];
      for (const [index, effectId] of orderedTargets.entries()) {
        offlineRandomTimersRef.current.push(
          window.setTimeout(() => revealRandomUiModule(effectId), 48 + index * 96)
        );
      }
      offlineRandomTimersRef.current.push(
        window.setTimeout(() => completeRandomUiFlow(), 72 + orderedTargets.length * 96)
      );
    }
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

    if (backendRef.current === 'native') void nativeBridgeRef.current.commandLine(`moduleBypass ${moduleId} ${nextEnabled ? 0 : 1}`);
    else engineRef.current?.setEffectBypassed(moduleId, !nextEnabled);
    setMessage(`${module.name} ${nextEnabled ? 'enabled' : 'bypassed'}.`);
  }

  function applyXYAssignments(
    x: number,
    y: number,
    moduleSource: ModuleState[] = modules
  ): void {
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
      const module = moduleSource.find((candidate) => candidate.id === moduleId);
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
        const dspValue = toDspParameterValue(moduleId, parameterId, modulatedValue);
        if (backendRef.current === 'native') {
          void nativeBridgeRef.current.commandLine(`param ${moduleId} ${parameterId} ${dspValue}`);
        } else {
          setEffectParameterIfLoaded(engineRef.current, moduleId, parameterId, dspValue);
        }
      }
    }
  }

  useEffect(() => {
    const revealModule = (event: Event): void => {
      const detail = (event as CustomEvent<RandomUiModuleDetail>).detail;
      const effectId = detail?.effectId;
      const plan = randomUiPlanRef.current;
      if (!effectId || !plan || plan.revealed.has(effectId)) return;
      const target = plan.targets.get(effectId);
      const railCId = plan.railCTargets.has(effectId as RailCRandomModuleId)
        ? effectId as RailCRandomModuleId
        : null;
      if (!target && !railCId) return;

      const railCSummary = railCId ? randomizeRailCModule(railCId, plan.profile) : null;
      const targetName = target?.name ?? (railCId ? RAIL_C_MODULE_NAMES[railCId] : effectId);

      plan.revealed.add(effectId);
      const current = plan.revealed.size;
      const total = plan.totalTargets;
      if (target) {
        setModules((currentModules) =>
          currentModules.map((module) => module.id === effectId ? target : module)
        );
      }
      setRandomFlowProgress({ current, total });
      setMessage(`RANDOM FLOW ${current}/${total} · ${targetName}${railCSummary ? ` · ${railCSummary}` : ''}`);
    };

    const finishFlow = (event: Event): void => {
      const detail = (event as CustomEvent<RandomUiCompleteDetail>).detail;
      const plan = randomUiPlanRef.current;
      if (!plan) return;

      const revealedEverything = plan.revealed.size === plan.totalTargets;
      if (!revealedEverything && detail?.completed !== false) {
        setModules(plan.finalModules);
      }

      randomUiPlanRef.current = null;
      randomFlowActiveRef.current = false;
      setRandomFlowProgress(null);

      if (detail?.completed === false) {
        setMessage(`RANDOM FLOW interrupted after ${plan.revealed.size}/${plan.totalTargets} modules.`);
        return;
      }

      setMessage(plan.finalMessage);
      if (revealedEverything) {
        applyXYAssignments(
          xyPosition.x / 100,
          xyPosition.y / 100,
          plan.finalModules
        );
      }
    };

    window.addEventListener(RANDOM_UI_MODULE_EVENT, revealModule);
    window.addEventListener(RANDOM_UI_COMPLETE_EVENT, finishFlow);
    return () => {
      window.removeEventListener(RANDOM_UI_MODULE_EVENT, revealModule);
      window.removeEventListener(RANDOM_UI_COMPLETE_EVENT, finishFlow);
    };
  }, [engineState, xyAssignments, xyPosition.x, xyPosition.y]);

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
    if (backendRef.current === 'native') {
      void nativeBridgeRef.current.command('quality', mode === 'studio' ? 4 : mode === 'balanced' ? 2 : 1);
    } else {
      engineRef.current?.setPerformanceMode(mode);
    }
    setMessage(
      `${mode.charAt(0).toUpperCase() + mode.slice(1)} quality selected.${engineState === 'running' && backendRef.current === 'web' ? ' Restart audio to apply its device-buffer policy.' : ''}`
    );
  }

  useEffect(() => {
    if (engineState !== 'running') return;
    if (randomFlowActiveRef.current) return;
    applyXYAssignments(xyPosition.x / 100, xyPosition.y / 100);
  }, [xyAssignments, modules, xyPosition.x, xyPosition.y, engineState]);

  useEffect(() => {
    return () => {
      clearRecordingTimer();
      for (const timer of offlineRandomTimersRef.current) window.clearTimeout(timer);
      offlineRandomTimersRef.current = [];
      engineRef.current?.cancelRecording();
      void engineRef.current?.stop();
      if (backendRef.current === 'native') void nativeBridgeRef.current.command('active', 0);
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
  }, [xyAssignments, railAOrder, railBOrder, railCOrder]);

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
    if (appFullscreen) {
      setAppFullscreen(false);
      return;
    }
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        return;
      }
    } catch {
      // WebView2 may reject the browser Fullscreen API. Fall through to the
      // native-safe viewport mode so the hardware control always works.
    }
    setAppFullscreen(true);
    setMessage('CALCOTONE fullscreen workspace enabled.');
  }

  const fullscreenActive = isFullscreen || appFullscreen;
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
      if (profilerOpen) setProfiler(engineRef.current?.getProfilerSnapshot() ?? null);
    };
    if (!profilerOpen) setProfiler(null);
    refresh();
    const timer = window.setInterval(refresh, 500);
    return () => window.clearInterval(timer);
  }, [isRunning, profilerOpen]);

  return (
    <div className={`app-shell ${appFullscreen ? 'app-fullscreen' : ''}`}>
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
          <div className="performance-mode top-quality-controls" role="group" aria-label="Processing quality">
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

          <div className="control-strip-actions">
            <div className="top-random-actions" aria-label="Rack randomization controls">
              <label className="random-profile-selector">
                <span className="sr-only">Randomization profile</span>
                <select
                  aria-label="Randomization profile"
                  value={randomProfile}
                  onChange={(event) => setRandomProfile(event.target.value as Exclude<RandomizationProfile, 'mutate'>)}
                  title="Choose a coordinated effects randomization archetype"
                >
                  {RANDOMIZATION_PROFILE_OPTIONS.map((option) => (
                    <option value={option.id} key={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="profiler-toggle randomizer-toggle" onClick={() => randomizeActiveModules(randomProfile)} title="Morph active modules into the selected guarded profile">
                RANDOM
                {randomFlowProgress && (
                  <span className="randomizer-flow-count" aria-hidden="true">
                    {randomFlowProgress.current}/{randomFlowProgress.total}
                  </span>
                )}
              </button>
              <button type="button" className="profiler-toggle randomizer-toggle mutate-randomizer-toggle" onClick={() => randomizeActiveModules('mutate')} title="Drift every active control by at most 10% while preserving machines and patch identity">MUTATE 10%</button>
              <button type="button" className="profiler-toggle signal-randomizer-toggle" onClick={randomizeSignalOrder} title="Randomize the order of both three-module signal rails">SIGNAL RANDOM</button>
            </div>
            <span className={`audio-backend-badge ${audioBackend ?? 'detecting'}`} title="Active audio processing backend">
              <i aria-hidden="true" />
              {audioBackend === 'native' ? 'NATIVE WASAPI' : audioBackend === 'web' ? 'WEB AUDIO' : 'AUDIO AUTO'}
            </span>
            <button type="button" className={`profiler-toggle ${explainMode ? 'active' : ''}`} aria-pressed={explainMode} onClick={() => setExplainMode((value) => !value)}>EXPLAIN</button>
            <FaceplateLayoutEditor />
            <button type="button" className={`profiler-toggle ${profilerOpen ? 'active' : ''}`} aria-pressed={profilerOpen} onClick={() => setProfilerOpen((open) => !open)}>DSP</button>
          </div>
        </section>

        {profilerOpen && (
          <aside className="dsp-profiler" aria-label="DSP profiler">
            <strong>DSP PROFILER</strong>
            <span>CALLBACK <b title="Portable AudioWorklet wall-clock timing is disabled to protect audio stability">N/A</b></span>
            <span>TIMING <b title="AudioWorkletGlobalScope does not guarantee a wall-clock performance timer">AUDIO SAFE</b></span>
            <button
              type="button"
              className="gpu-cabinet-test"
              disabled={gpuExperimentRunning || isRunning}
              onClick={() => void testGpuCabinet()}
              title={isRunning ? 'Stop audio before benchmarking GPU dispatch/readback' : 'Benchmark 1024-tap cabinet convolution on CPU and WebGPU'}
            >
              {gpuExperimentRunning ? 'GPU TESTING…' : 'GPU CAB TEST'}
            </button>
            <span>GPU CAB <b className={gpuExperiment?.verdict === 'too-jittery' ? 'warn' : ''}>{gpuExperiment?.verdict.toUpperCase() ?? 'NOT TESTED'}</b></span>
            {gpuExperiment?.batches.map((batch) => (
              <span key={`gpu-${batch.blocks}`} title={`CPU ${batch.cpuMs.toFixed(2)} ms · max error ${batch.maxError.toExponential(2)}`}>
                GPU {batch.blocks}×128 <b className={batch.realtimeSafe ? '' : 'warn'}>{batch.gpuMs.toFixed(2)} / {batch.algorithmicLatencyMs.toFixed(2)} ms</b>
              </span>
            ))}
            <span>INPUT LAT <b>{profiler?.inputLatencyMs === null || !profiler ? 'N/A' : `${profiler.inputLatencyMs.toFixed(1)} ms`}</b></span>
            <span>OUTPUT LAT <b>{profiler ? `${(profiler.baseLatencyMs + profiler.outputLatencyMs).toFixed(1)} ms` : '—'}</b></span>
            <span title={profiler?.pathEstimateComplete ? 'Browser-reported input + graph + output estimate' : 'Lower bound: the browser did not report input latency'}>
              EST. RTT <b className={profiler?.latencyStatus === 'slow' ? 'warn' : ''}>{profiler ? `${profiler.pathEstimateComplete ? '' : '≥'}${profiler.estimatedRoundTripMs.toFixed(1)} ms` : '—'}</b>
            </span>
            <span>RATE MATCH <b>{profiler?.sampleRateMatched === null || !profiler ? 'N/A' : profiler.sampleRateMatched ? 'YES' : 'NO'}</b></span>
            <span>GRAIN <b>{profiler ? `${profiler.grain.activeVoices}/${profiler.grain.maxVoices}` : '0/0'}</b></span>
            <span>STOMP <b>{audioBackend === 'native' ? 'NATIVE' : 'OFFLINE'}</b></span>
            <span>TOPOLOGY <b>SPICE HYBRID PEDAL</b></span>
            <span>SHAPER <b>HERMITE LUT</b></span>
            <span>FILTER <b>TPT STATE</b></span>
            <span>STOMP OS <b>2× MIDPOINT</b></span>
            <span>MODELS <b>14</b></span>
            <span title={profiler ? `Requested ${profiler.requestedRenderSize}; context API ${profiler.renderSizeHintSupported ? 'available' : 'unavailable'}` : undefined}>
              QUANTUM <b>{profiler?.renderQuantumFrames ? `${profiler.renderQuantumFrames}f` : '—'}</b>
            </span>
            <span>DEVICE MEMORY <b>ACTIVE</b></span>
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
                    disabled={audioBackend === 'native'}
                    onChange={(event: ReactChangeEvent<HTMLSelectElement>) =>
                      updateInputMode(event.target.value as InputMode)
                    }
                  >
                    <option value="mono-to-stereo">{audioBackend === 'native' ? 'Dual Mono → Stereo' : 'Mono 1 → Stereo'}</option>
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
              </div>
            </div>

            <div className="io-utility-dock">
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
            </div>
          </aside>

          <section className="modules-section" aria-label="Effects modules">
            <div className="module-grid routing-grid">
              {([
                ['A', railAOrder],
                ['B', railBOrder],
                ['C', railCOrder],
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
                      const slotLabel = `${rail}${order.indexOf(moduleId) + 1}`;
                      const routingProps = {
                        slotLabel,
                        routingDragging: draggedModuleId === moduleId,
                        routingDropTarget: dragOverModuleId === moduleId,
                        onRoutingDragStart: (event: ReactDragEvent<HTMLDivElement>) => {
                          setDraggedModuleId(moduleId);
                          setDragOverModuleId(null);
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', moduleId);
                        },
                        onRoutingDragOver: (event: ReactDragEvent<HTMLElement>) => {
                          if (!draggedModuleId) return;
                          const sourceRail = railForModule(draggedModuleId);
                          if (!sourceRail) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          setDragOverModuleId(moduleId);
                        },
                        onRoutingDrop: (event: ReactDragEvent<HTMLElement>) => {
                          event.preventDefault();
                          const sourceId = draggedModuleId || event.dataTransfer.getData('text/plain');
                          if (sourceId) reorderWithinRail(sourceId, moduleId);
                          setDraggedModuleId(null);
                          setDragOverModuleId(null);
                        },
                        onRoutingDragEnd: () => {
                          setDraggedModuleId(null);
                          setDragOverModuleId(null);
                        },
                        onRoutingNudge: (direction: -1 | 1) =>
                          nudgeModuleWithinRail(moduleId, direction),
                      };

                      const module = getModuleById(moduleId);
                      if (!module) {
                        return (
                          <RailCModule
                            key={moduleId}
                            moduleId={moduleId}
                            modules={modules}
                            assignments={xyAssignments}
                            visualState={visualState}
                            running={isRunning}
                            onStompEnabledChange={setStompEnabled}
                            onStompModeChange={setStompMode}
                            onStompInputSourceChange={setStompInputSource}
                            onStompParametersChange={setStompParameters}
                            onStackEnabledChange={setStackEnabled}
                            onStackModelChange={setStackModel}
                            onStackCabinetChange={setStackCabinet}
                            onStackInputSourceChange={setStackInputSource}
                            onStackParametersChange={setStackParameters}
                            nativeBackendActive={audioBackend === 'native'}
                            tunerHz={nativeTuner.hz}
                            tunerLevel={nativeTuner.level}
                            {...routingProps}
                          />
                        );
                      }

                      return (
                        <EffectModule
                          key={module.id}
                          module={module}
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
                          {...routingProps}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </section>

        </section>

        <footer className="footer-bar">
          <p role="status" aria-live="polite">{message}</p>
          <div className="footer-engine-status" aria-label="Engine information">
            <div>
              <span>ENGINE</span>
              <strong className={isRunning ? 'active' : ''}>{engineState}</strong>
            </div>
            <div>
              <span>BACKEND</span>
              <strong className={audioBackend === 'native' ? 'native-backend' : audioBackend === 'web' ? 'web-backend' : ''}>
                {audioBackend === 'native' ? `NATIVE ${(nativeTransport ?? 'wasapi').toUpperCase()}` : audioBackend === 'web' ? 'WEB AUDIO' : 'AUTO'}
              </strong>
            </div>
            <div>
              <span>INPUT</span>
              <strong>{inputDevice}</strong>
            </div>
            <div>
              <span>EST. RTT</span>
              <strong>{latency}</strong>
            </div>
            <div>
              <span>SAMPLE RATE</span>
              <strong>{sampleRate}</strong>
            </div>
            <div>
              <span>CHANNELS</span>
              <strong>{channelInfo.input} → {channelInfo.output}</strong>
            </div>
            <div title={nativeHealth ? `FIFO ${nativeHealth.ringFrames}/${nativeHealth.fifoTargetFrames} · ratio ${nativeHealth.fifoReadRatio.toFixed(6)} · capture discontinuities ${nativeHealth.captureDiscontinuities} · capture/render API errors ${nativeHealth.captureApiErrors}/${nativeHealth.renderApiErrors} · deadline misses ${nativeHealth.renderDeadlineMisses} · input/output peak ${nativeHealth.inputPeak.toFixed(3)}/${nativeHealth.outputPeak.toFixed(3)} · limiter samples ${nativeHealth.outputClips}` : undefined}>
              <span>NATIVE I/O</span>
              <strong className={nativeHealth && (nativeHealth.underruns + nativeHealth.overruns + nativeHealth.captureDiscontinuities + nativeHealth.captureApiErrors + nativeHealth.renderApiErrors + nativeHealth.renderDeadlineMisses > 0) ? 'warn' : ''}>
                {nativeHealth ? `FIFO ${nativeHealth.ringFrames}/${nativeHealth.fifoTargetFrames} · ${nativeHealth.fifoReadRatio.toFixed(4)}×` : '—'}
              </strong>
            </div>
          </div>
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
              className={`footer-safe-toggle footer-fullscreen-toggle ${fullscreenActive ? 'active' : ''}`}
              onClick={() => void toggleFullscreen()}
              aria-pressed={fullscreenActive}
              title={fullscreenActive ? 'Exit fullscreen' : 'Enter fullscreen'}
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
    return `${Math.round(18 + value * 742)} ms`;
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
    stomp: 'STOMP',
    chaos: 'CHAOS',
    pressure: 'PRESSURE',
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
  let printable = '';
  for (const character of value.trim()) {
    printable += character.charCodeAt(0) < 32 ? '-' : character;
  }
  return printable
    .replace(/\.wav$/i, '')
    .replace(/[<>:"/\\|?*]/g, '-')
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
