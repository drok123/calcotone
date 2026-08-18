import { REVERB_ALGORITHM_ORDER, type ReverbAlgorithm } from '../../audio/effects/Reverb';
import { MEDIA_MODE_ORDER, type MediaMode } from '../../audio/effects/Media';
import { EMBER_MODE_ORDER, type EmberMode } from '../../audio/effects/Saturation';
import { DRIFT_MODE_ORDER, type DriftMode } from '../../audio/effects/Chorus';
import {
  GRAIN_MODE_ORDER,
  MICROCOSM_PROGRAM_ORDER,
  type GrainMode,
} from '../../audio/effects/Bitcrusher';
import { DELAY_ALGORITHM_ORDER, type DelayAlgorithm } from '../../audio/effects/Delay';
import type { ModuleState } from '../../ui/types';
import { RANDOM_MUTATION_AMOUNT, type RandomizationProfile } from './randomProfiles';

export const CORE_RANDOM_MODULE_IDS = [
  'saturation',
  'chorus',
  'delay',
  'reverb',
  'bitcrusher',
  'media',
] as const;

export type CoreRandomModuleId = (typeof CORE_RANDOM_MODULE_IDS)[number];

type CoreRandomController = {
  isAvailable: () => boolean;
  randomize: (profile: RandomizationProfile) => string | null;
};

type MusicalRange = readonly [number, number];
type ProfileModuleRecipe = {
  mode?: string;
  parameters: Record<string, MusicalRange>;
};

const controllers = new Map<CoreRandomModuleId, CoreRandomController>();

export function isCoreRandomModuleId(moduleId: string): moduleId is CoreRandomModuleId {
  return CORE_RANDOM_MODULE_IDS.some((candidate) => candidate === moduleId);
}

export function registerCoreRandomController(
  moduleId: CoreRandomModuleId,
  controller: CoreRandomController
): () => void {
  controllers.set(moduleId, controller);
  return () => {
    if (controllers.get(moduleId) === controller) controllers.delete(moduleId);
  };
}

export function randomizeCoreModule(
  moduleId: CoreRandomModuleId,
  profile: RandomizationProfile = 'smart'
): string | null {
  const controller = controllers.get(moduleId);
  if (!controller?.isAvailable()) return null;
  return controller.randomize(profile);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function randomMusicalValue(range: MusicalRange, centerBias = .35): number {
  const uniform = Math.random();
  const centered = (Math.random() + Math.random()) * .5;
  const t = uniform * (1 - centerBias) + centered * centerBias;
  return range[0] + (range[1] - range[0]) * t;
}

function chooseDifferent<T>(values: readonly T[], current: T | undefined): T {
  const alternatives = values.filter((value) => value !== current);
  const pool = alternatives.length ? alternatives : values;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

function normalizedDelayTime(seconds: number): number {
  const bounded = Math.max(.05, Math.min(.6, seconds));
  return clamp01(Math.pow((bounded - .03) / 3.97, 1 / 1.4));
}

function normalizedReverbDecay(seconds: number): number {
  const bounded = Math.max(.5, Math.min(6, seconds));
  return clamp01(Math.log(bounded / .35) / Math.log(16 / .35));
}

const DELAY_SYNC_VALUES = [.0625, .0833, .125, .1875, .25, .375, .5].map(normalizedDelayTime);

const MUSICAL_RANDOM_RANGES: Record<CoreRandomModuleId, Record<string, MusicalRange>> = {
  saturation: { drive:[.08,.78], tone:[.22,.82], heat:[.05,.72], character:[.08,.78], dynamics:[.18,.82], mix:[.10,.62] },
  chorus: { rate:[.025,.58], depth:[.08,.78], shape:[.12,.88], spread:[.28,.98], motion:[.08,.78], mix:[.08,.48] },
  delay: { time:[.08,.82], feedback:[.10,.58], color:[.16,.88], character:[.04,.66], width:[.30,.96], mix:[.08,.46] },
  reverb: { decay:[.18,.78], size:[.28,.94], color:[.14,.88], diffusion:[.38,.96], motion:[.04,.58], mix:[.08,.48] },
  bitcrusher: { bits:[.34,.92], density:[.18,.82], pitch:[0,.64], chaos:[.02,.56], bloom:[.12,.76], mix:[.06,.42] },
  media: { wow:[.02,.58], wear:[.04,.68], noise:[0,.34], tone:[.24,.88], mix:[.08,.46] },
};

const RANDOM_PROFILE_RECIPES: Partial<Record<RandomizationProfile, Record<CoreRandomModuleId, ProfileModuleRecipe>>> = {
  bass: {
    saturation: { mode:'console', parameters:{ drive:[.18,.34], tone:[.34,.58], heat:[.12,.30], character:[.28,.52], dynamics:[.42,.68], mix:[.14,.26] } },
    chorus: { mode:'dimensiond', parameters:{ rate:[.06,.10], depth:[.12,.24], shape:[.18,.30], spread:[.72,.92], motion:[.10,.22], mix:[.08,.18] } },
    delay: { mode:'EP-3 Echoplex', parameters:{ time:[normalizedDelayTime(.08),normalizedDelayTime(.125)], feedback:[.10,.22], color:[.32,.52], character:[.12,.28], width:[.34,.56], mix:[.10,.22] } },
    reverb: { mode:'room', parameters:{ decay:[normalizedReverbDecay(.6),normalizedReverbDecay(1.3)], size:[.24,.48], color:[.28,.52], diffusion:[.42,.68], motion:[.02,.14], mix:[.08,.20] } },
    bitcrusher: { mode:'smear', parameters:{ bits:[.55,.82], density:[.28,.48], pitch:[0,.10], chaos:[.02,.14], bloom:[.12,.28], mix:[.05,.16] } },
    media: { mode:'tascam424', parameters:{ wear:[.16,.34], wow:[.10,.18], noise:[.02,.10], tone:[.28,.48], mix:[.14,.28] } },
  },
  pad: {
    saturation: { mode:'velvet', parameters:{ drive:[.10,.24], tone:[.46,.72], heat:[.12,.28], character:[.18,.42], dynamics:[.48,.74], mix:[.12,.26] } },
    chorus: { mode:'ensemble', parameters:{ rate:[.04,.13], depth:[.38,.68], shape:[.34,.68], spread:[.82,.98], motion:[.12,.32], mix:[.24,.44] } },
    delay: { mode:'tape', parameters:{ time:[normalizedDelayTime(.1875),normalizedDelayTime(.5)], feedback:[.38,.58], color:[.26,.52], character:[.18,.38], width:[.68,.94], mix:[.28,.50] } },
    reverb: { mode:'cloud', parameters:{ decay:[normalizedReverbDecay(3),normalizedReverbDecay(6)], size:[.70,.96], color:[.34,.68], diffusion:[.78,.98], motion:[.08,.28], mix:[.34,.50] } },
    bitcrusher: { mode:'clouds', parameters:{ bits:[.46,.72], density:[.56,.78], pitch:[0,.16], chaos:[.18,.38], bloom:[.52,.78], mix:[.18,.34] } },
    media: { mode:'reel', parameters:{ wear:[.12,.30], wow:[.08,.22], noise:[0,.10], tone:[.44,.68], mix:[.12,.28] } },
  },
  lead: {
    saturation: { mode:'tube', parameters:{ drive:[.20,.42], tone:[.52,.78], heat:[.18,.38], character:[.34,.58], dynamics:[.32,.56], mix:[.18,.34] } },
    chorus: { mode:'ce1', parameters:{ rate:[.08,.14], depth:[.20,.38], shape:[.40,.66], spread:[.68,.88], motion:[.14,.30], mix:[.12,.28] } },
    delay: { mode:'EP-3 Echoplex', parameters:{ time:[normalizedDelayTime(.125),normalizedDelayTime(.25)], feedback:[.20,.42], color:[.42,.68], character:[.14,.32], width:[.48,.76], mix:[.16,.34] } },
    reverb: { mode:'plate', parameters:{ decay:[normalizedReverbDecay(1.2),normalizedReverbDecay(3)], size:[.40,.68], color:[.46,.74], diffusion:[.62,.86], motion:[.04,.18], mix:[.14,.32] } },
    bitcrusher: { mode:'smear', parameters:{ bits:[.58,.86], density:[.28,.52], pitch:[0,.12], chaos:[.04,.18], bloom:[.14,.34], mix:[.04,.16] } },
    media: { mode:'Neve 1073', parameters:{ wear:[.18,.34], wow:[.14,.22], noise:[.02,.10], tone:[.30,.48], mix:[.14,.28] } },
  },
  'retro-ambient': {
    saturation: { mode:'mullard', parameters:{ drive:[.12,.18], tone:[.40,.60], heat:[.18,.30], character:[.42,.58], dynamics:[.48,.64], mix:[.12,.20] } },
    chorus: { mode:'ce1', parameters:{ rate:[.07,.12], depth:[.24,.38], shape:[.40,.62], spread:[.76,.92], motion:[.12,.26], mix:[.18,.30] } },
    delay: { mode:'re201', parameters:{ time:[normalizedDelayTime(.1875),normalizedDelayTime(.375)], feedback:[.48,.56], color:[.30,.50], character:[.22,.38], width:[.62,.84], mix:[.32,.46] } },
    reverb: { mode:'lexicon224', parameters:{ decay:[normalizedReverbDecay(3.2),normalizedReverbDecay(5.5)], size:[.62,.86], color:[.34,.56], diffusion:[.72,.90], motion:[.10,.24], mix:[.36,.44] } },
    bitcrusher: { mode:'clouds', parameters:{ bits:[.52,.72], density:[.48,.68], pitch:[0,.12], chaos:[.14,.30], bloom:[.48,.68], mix:[.12,.26] } },
    media: { mode:'Ampex ATR-102', parameters:{ wear:[.18,.34], wow:[.20,.52], noise:[0,.08], tone:[.42,.58], mix:[.16,.30] } },
  },
  'lofi-tape': {
    saturation: { mode:'sp1200', parameters:{ drive:[.20,.38], tone:[.12,.32], heat:[.14,.30], character:[.42,.62], dynamics:[.34,.54], mix:[.18,.32] } },
    chorus: { mode:'vibrato', parameters:{ rate:[.05,.12], depth:[.12,.28], shape:[.28,.48], spread:[.42,.68], motion:[.18,.34], mix:[.08,.20] } },
    delay: { mode:'tape', parameters:{ time:[normalizedDelayTime(.125),normalizedDelayTime(.25)], feedback:[.24,.44], color:[.18,.38], character:[.24,.44], width:[.38,.64], mix:[.16,.30] } },
    reverb: { mode:'room', parameters:{ decay:[normalizedReverbDecay(.8),normalizedReverbDecay(2.2)], size:[.32,.58], color:[.18,.42], diffusion:[.48,.72], motion:[.04,.16], mix:[.12,.26] } },
    bitcrusher: { mode:'beads', parameters:{ bits:[.62,.70], density:[.34,.56], pitch:[.02,.16], chaos:[.12,.30], bloom:[.18,.38], mix:[.12,.28] } },
    media: { mode:'cassette', parameters:{ wear:[.38,.62], wow:[.24,.46], noise:[.10,.22], tone:[.22,.42], mix:[.28,.46] } },
  },
  'gritty-drive': {
    saturation: { mode:'furnace', parameters:{ drive:[.40,.70], tone:[.28,.54], heat:[.36,.66], character:[.46,.72], dynamics:[.40,.68], mix:[.34,.50] } },
    chorus: { mode:'smallstone', parameters:{ rate:[.08,.18], depth:[.12,.30], shape:[.44,.70], spread:[.48,.74], motion:[.16,.34], mix:[.08,.18] } },
    delay: { mode:'EP-3 Echoplex', parameters:{ time:[normalizedDelayTime(.075),normalizedDelayTime(.095)], feedback:[.08,.18], color:[.28,.48], character:[.26,.46], width:[.28,.48], mix:[.12,.24] } },
    reverb: { mode:'room', parameters:{ decay:[normalizedReverbDecay(.5),normalizedReverbDecay(1.5)], size:[.24,.50], color:[.30,.54], diffusion:[.40,.66], motion:[.02,.12], mix:[.08,.20] } },
    bitcrusher: { mode:'scatter', parameters:{ bits:[.44,.68], density:[.32,.54], pitch:[.04,.22], chaos:[.18,.42], bloom:[.12,.30], mix:[.10,.24] } },
    media: { mode:'API 1608', parameters:{ wear:[.24,.42], wow:[.16,.24], noise:[.04,.12], tone:[.38,.58], mix:[.16,.30] } },
  },
};

function withSmartMode(module: ModuleState): ModuleState {
  if (module.id === 'saturation') return { ...module, emberMode: chooseDifferent(EMBER_MODE_ORDER, module.emberMode) };
  if (module.id === 'chorus') return { ...module, driftMode: chooseDifferent(DRIFT_MODE_ORDER, module.driftMode) };
  if (module.id === 'delay') return { ...module, delayAlgorithm: chooseDifferent(DELAY_ALGORITHM_ORDER, module.delayAlgorithm) };
  if (module.id === 'reverb') return { ...module, algorithm: chooseDifferent(REVERB_ALGORITHM_ORDER, module.algorithm) };
  if (module.id === 'bitcrusher') {
    const grainMode = chooseDifferent(GRAIN_MODE_ORDER, module.grainMode);
    return {
      ...module,
      grainMode,
      microcosmProgram: grainMode === 'microcosm'
        ? MICROCOSM_PROGRAM_ORDER[Math.floor(Math.random() * MICROCOSM_PROGRAM_ORDER.length)]!
        : module.microcosmProgram,
      microcosmHold: false,
    };
  }
  if (module.id === 'media') return { ...module, mediaMode: chooseDifferent(MEDIA_MODE_ORDER, module.mediaMode) };
  return module;
}

function applyProfileMode(module: ModuleState, mode: string | undefined): ModuleState {
  if (!mode) return module;
  if (module.id === 'saturation') return { ...module, emberMode: mode as EmberMode };
  if (module.id === 'chorus') return { ...module, driftMode: mode as DriftMode };
  if (module.id === 'delay') return { ...module, delayAlgorithm: mode as DelayAlgorithm };
  if (module.id === 'reverb') return { ...module, algorithm: mode as ReverbAlgorithm };
  if (module.id === 'bitcrusher') return { ...module, grainMode: mode as GrainMode, microcosmHold: false };
  if (module.id === 'media') return { ...module, mediaMode: mode as MediaMode };
  return module;
}

function guardParameter(module: ModuleState, parameterId: string, value: number): number {
  let safe = clamp01(value);
  if (module.id === 'delay' && parameterId === 'time') {
    safe = DELAY_SYNC_VALUES.reduce((nearest, candidate) =>
      Math.abs(candidate - safe) < Math.abs(nearest - safe) ? candidate : nearest
    );
  }
  if (module.id === 'delay' && parameterId === 'feedback') {
    safe = Math.min(safe, module.delayAlgorithm === 'constellation' || module.delayAlgorithm === 'scatter' ? .56 : .68);
  }
  if (module.id === 'reverb' && parameterId === 'decay') {
    safe = Math.max(normalizedReverbDecay(.5), Math.min(normalizedReverbDecay(6), safe));
    if (module.algorithm === 'freeze') safe = Math.max(.48, safe);
  }
  if (module.id === 'bitcrusher' && parameterId === 'bits') safe = Math.max(safe, 1 / 6);
  if (module.id === 'bitcrusher' && parameterId === 'chaos') safe = Math.min(safe, .52);
  if (module.id === 'media' && module.mediaMode === 'Neve BCM10') {
    if (parameterId === 'tone') safe = Math.min(safe, .68);
    if (parameterId === 'wear') safe = Math.min(safe, .72);
    if (parameterId === 'mix') safe = Math.min(safe, .38);
  }
  if (parameterId === 'mix') safe = Math.min(safe, .52);
  return safe;
}

export function buildTargetedCoreRandom(
  module: ModuleState,
  profile: RandomizationProfile
): ModuleState {
  if (!isCoreRandomModuleId(module.id) || !module.available) return module;
  const recipe = RANDOM_PROFILE_RECIPES[profile]?.[module.id];
  const modeModule = profile === 'mutate'
    ? module
    : recipe
      ? applyProfileMode(module, recipe.mode)
      : withSmartMode(module);
  const genericRanges = MUSICAL_RANDOM_RANGES[module.id];
  const parameters = modeModule.parameters.map((parameter) => {
    const range = recipe?.parameters[parameter.id] ?? genericRanges[parameter.id];
    if (!range) return parameter;
    const raw = profile === 'mutate'
      ? parameter.value + (Math.random() * 2 - 1) * RANDOM_MUTATION_AMOUNT
      : randomMusicalValue(range, recipe ? .60 : .35);
    const value = guardParameter(modeModule, parameter.id, raw);
    return { ...parameter, value };
  });
  return {
    ...modeModule,
    parameters,
    ...(modeModule.id === 'bitcrusher' ? { microcosmHold: false } : {}),
  };
}
