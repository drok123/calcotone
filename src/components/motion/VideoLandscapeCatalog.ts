import type { ModuleState } from '../../ui/types';

export type VideoWorld = 'base' | 'cyber' | 'storm' | 'solar' | 'dream' | 'night';

export interface VideoGrade {
  hue: number;
  saturation: number;
  tint: string;
  tintOpacity: number;
}

export interface VideoLandscapeIdentity {
  world: VideoWorld;
  grade: VideoGrade;
  moduleId: string | null;
  mode: string;
}

const WORLD_FILES: Record<VideoWorld, string> = {
  base: 'xy-worlds/cyber-mountain/base.mp4',
  cyber: 'xy-worlds/cyber-mountain/cyber.mp4',
  storm: 'xy-worlds/cyber-mountain/storm.mp4',
  solar: 'xy-worlds/cyber-mountain/solar.mp4',
  dream: 'xy-worlds/cyber-mountain/dream.mp4',
  night: 'xy-worlds/cyber-mountain/night.mp4',
};

const MODULE_GRADES: Record<string, VideoGrade> = {
  saturation: { hue: -8, saturation: 1.055, tint: 'rgb(202 120 69)', tintOpacity: 0.050 },
  chorus: { hue: 8, saturation: 1.025, tint: 'rgb(75 151 178)', tintOpacity: 0.042 },
  delay: { hue: 10, saturation: 1.035, tint: 'rgb(105 133 188)', tintOpacity: 0.046 },
  reverb: { hue: 4, saturation: 0.995, tint: 'rgb(116 139 164)', tintOpacity: 0.043 },
  bitcrusher: { hue: -2, saturation: 0.985, tint: 'rgb(152 133 123)', tintOpacity: 0.040 },
  media: { hue: 15, saturation: 1.045, tint: 'rgb(118 108 177)', tintOpacity: 0.045 },
};

const PROFILE_OFFSET: Record<string, readonly [number, number]> = {
  // Ember
  velvet: [-4, -0.012], tube: [-8, 0.004], console: [4, -0.006], transformer: [-2, 0.010], furnace: [-13, 0.018], exciter: [-16, 0.024], broken: [10, -0.014],
  goldlion: [-19, 0.028], mullard: [-10, -0.002], telefunken: [-15, 0.016], bugleboy: [-5, 0.010], rcablack: [-2, -0.018],
  // Drift
  chorus: [0, 0], ensemble: [-4, 0.008], dimension: [6, -0.004], vibrato: [11, 0.010], rotary: [-7, -0.002], doppler: [2, 0.006], liquid: [-6, 0.012], orbit: [9, 0.008], ce1: [-3, -0.004], dimensiond: [7, -0.006],
  mxrflanger: [14, 0.014], electricmistress: [10, 0.010], adaflanger: [16, 0.016], bf2: [7, 0.008], biphase: [19, 0.012], smallstone: [13, 0.006], univibe: [-9, 0.008], leslie: [-12, -0.004],
  // Halo
  clean: [-5, -0.012], tape: [-16, 0.008], bbd: [-8, -0.004], pingpong: [5, 0.012], diffuse: [14, -0.002], scatter: [19, 0.016], constellation: [8, 0.020], re201: [-13, 0.010],
  'ep-3 echoplex': [-15, 0.006], 'binson echorec': [-9, 0.012], 'deluxe memory man': [-6, -0.004], 'ams dmx 15-80 s': [12, 0.010],
  // Atmos
  room: [-6, -0.010], plate: [5, 0.004], hall: [0, 0], cinema: [-10, 0.006], cloud: [7, -0.002], freeze: [12, -0.014], celestial: [18, 0.012], aurora: [23, 0.018], nebula: [15, 0.010], abyss: [-15, -0.024], emt140: [-9, -0.006], lexicon224: [10, 0.008],
  // Grain
  reconstruct: [2, -0.016], shatter: [-16, 0.020], smear: [14, -0.004], prism: [22, 0.022], stutter: [8, 0.012], ruin: [-11, -0.008], sp1200: [-18, 0.004], mpc60: [-6, 0.012], mirage: [16, 0.006], s950: [8, -0.002], emulator2: [19, 0.012], fairlightiix: [25, 0.016],
  // Artifact
  cassette: [-15, -0.006], reel: [-19, 0.004], vinyl: [15, -0.004], vhs: [23, 0.012], radio: [-4, -0.012], wax: [-12, -0.018], archive: [7, -0.006], tascam424: [-8, 0.004],
  'neve 1073': [-17, 0.008], 'ssl 4000e': [8, 0.002], 'api 1608': [-2, 0.014], 'ampex atr-102': [-20, 0.006],
};

export function assetUrl(path: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
  return `${base}${path.replace(/^\//, '')}`;
}

export function videoUrl(world: VideoWorld): string {
  return assetUrl(WORLD_FILES[world]);
}

export function moduleMode(module: ModuleState): string {
  return String(module.emberMode ?? module.driftMode ?? module.delayAlgorithm ?? module.algorithm ?? module.grainMode ?? module.mediaMode ?? '').toLowerCase();
}

function parameter(module: ModuleState, id: string, fallback = 0): number {
  return module.parameters.find((item) => item.id === id)?.value ?? fallback;
}

export function visualContribution(module: ModuleState): number {
  if (!module.enabled || !module.available) return 0;
  const mix = parameter(module, 'mix', 0);
  if (mix <= 0.0001) return 0;
  let character = 0.5;
  switch (module.id) {
    case 'saturation': character = parameter(module, 'drive') * 0.45 + parameter(module, 'heat') * 0.30 + parameter(module, 'character') * 0.25; break;
    case 'chorus': character = parameter(module, 'depth') * 0.36 + parameter(module, 'motion') * 0.34 + parameter(module, 'spread') * 0.30; break;
    case 'delay': character = parameter(module, 'feedback') * 0.42 + parameter(module, 'time') * 0.20 + parameter(module, 'character') * 0.20 + parameter(module, 'width') * 0.18; break;
    case 'reverb': character = parameter(module, 'size') * 0.32 + parameter(module, 'diffusion') * 0.28 + parameter(module, 'decay') * 0.22 + parameter(module, 'motion') * 0.18; break;
    case 'bitcrusher': character = parameter(module, 'chaos') * 0.36 + parameter(module, 'density') * 0.26 + parameter(module, 'bloom') * 0.22 + (1 - parameter(module, 'bits', 1)) * 0.16; break;
    case 'media': character = parameter(module, 'wear') * 0.38 + parameter(module, 'wow') * 0.28 + parameter(module, 'noise') * 0.18 + (1 - parameter(module, 'tone', 0.5)) * 0.16; break;
  }
  return Math.sqrt(Math.max(0, mix)) * (0.64 + Math.min(1, Math.max(0, character)) * 0.36);
}

export function dominantVisualModule(modules: ModuleState[]): ModuleState | null {
  let best: ModuleState | null = null;
  let bestScore = 0;
  for (const module of modules) {
    const score = visualContribution(module);
    if (score >= bestScore && score > 0) { best = module; bestScore = score; }
  }
  return best;
}

export function worldForModule(module: ModuleState): VideoWorld {
  const mode = moduleMode(module);
  switch (module.id) {
    case 'saturation':
      if (['console','transformer','broken'].includes(mode)) return 'cyber';
      if (mode === 'velvet') return 'base';
      return 'solar';
    case 'chorus':
      if (['dimension','dimensiond','mxrflanger','electricmistress','adaflanger','bf2','biphase','smallstone'].includes(mode)) return 'cyber';
      if (['doppler','orbit','rotary','leslie'].includes(mode)) return 'storm';
      return 'dream';
    case 'delay':
      if (['clean'].includes(mode)) return 'base';
      if (['tape','re201','ep-3 echoplex','binson echorec','deluxe memory man'].includes(mode)) return 'solar';
      if (['scatter','constellation'].includes(mode)) return 'storm';
      if (['ams dmx 15-80 s'].includes(mode)) return 'cyber';
      return 'dream';
    case 'reverb':
      if (['room','hall','emt140'].includes(mode)) return 'base';
      if (['abyss','freeze'].includes(mode)) return 'night';
      if (['celestial','aurora','nebula','cloud'].includes(mode)) return 'storm';
      return 'dream';
    case 'bitcrusher':
      if (['smear','prism'].includes(mode)) return 'dream';
      if (['reconstruct'].includes(mode)) return 'cyber';
      return 'night';
    case 'media':
      if (['vhs','radio','broken','archive','ssl 4000e','api 1608'].includes(mode)) return 'cyber';
      if (['cassette','reel','tascam424','neve 1073','ampex atr-102'].includes(mode)) return 'solar';
      if (['vinyl','wax'].includes(mode)) return 'night';
      return 'cyber';
    default: return 'base';
  }
}

export function gradeForModule(module: ModuleState | null): VideoGrade {
  if (!module) return { hue: 0, saturation: 1, tint: 'rgb(110 150 170)', tintOpacity: 0 };
  const base = MODULE_GRADES[module.id] ?? MODULE_GRADES.reverb;
  const offset = PROFILE_OFFSET[moduleMode(module)] ?? [0, 0];
  return {
    hue: Math.max(-28, Math.min(28, base.hue + offset[0])),
    saturation: Math.max(0.94, Math.min(1.11, base.saturation + offset[1])),
    tint: base.tint,
    tintOpacity: base.tintOpacity,
  };
}

export function landscapeIdentity(modules: ModuleState[]): VideoLandscapeIdentity {
  const dominant = dominantVisualModule(modules);
  return {
    world: dominant ? worldForModule(dominant) : 'base',
    grade: gradeForModule(dominant),
    moduleId: dominant?.id ?? null,
    mode: dominant ? moduleMode(dominant) : 'raw',
  };
}
