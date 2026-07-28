import { useEffect, useRef } from 'react';
import type { SignalLabState } from '../../audio/SignalLab';
import type { ModuleState } from '../../ui/types';
import { getLatestVisualAudioState, type VisualAudioState } from '../../visual/VisualEngine';
import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';
import './AsciiArtEngine.css';

type AsciiKind = 'module' | 'landscape';

export interface AsciiArtEngineProps {
  kind: AsciiKind;
  module?: ModuleState;
  modules?: ModuleState[];
  position?: { x: number; y: number };
  dragging?: boolean;
  pressure?: SignalLabState;
  patchCount?: number;
  className?: string;
}

interface SceneLayer {
  id: string;
  key: string;
  seed: number;
  weight: number;
}

interface PreparedScene extends AsciiArtEngineProps {
  active: boolean;
  label: string;
  sceneKey: string;
  layers: SceneLayer[];
}

interface ModuleTheme {
  primary: string;
  secondary: string;
  glyphs: string;
}

const THEMES: Record<string, ModuleTheme> = {
  saturation: { primary: '#ffbf69', secondary: '#fff1cf', glyphs: ' .:+=xX#@' },
  chorus: { primary: '#79d7e7', secondary: '#e4fbff', glyphs: ' .~-:=+*#' },
  delay: { primary: '#d6d9ff', secondary: '#fff0bd', glyphs: ' .:|/\\+X#' },
  reverb: { primary: '#c5b6ff', secondary: '#e7fbff', glyphs: ' .^/\\AVM#' },
  bitcrusher: { primary: '#9ee38d', secondary: '#ffe28a', glyphs: ' .`:+*%#@' },
  media: { primary: '#e7d4ad', secondary: '#e59abb', glyphs: ' ._-+=[]#' },
  landscape: { primary: '#b8e2d3', secondary: '#f3ead4', glyphs: ' .,:;+=x#@' },
};

type ModeMotif =
  | 'bloom' | 'tubes' | 'channels' | 'coil' | 'flame' | 'spark' | 'fracture'
  | 'waves' | 'voices' | 'depth' | 'vibrato' | 'rotor' | 'doppler' | 'liquid' | 'orbit' | 'comb' | 'phase'
  | 'echo' | 'reels' | 'steps' | 'pingpong' | 'diffuse' | 'scatter' | 'stars' | 'drum' | 'memory' | 'digital'
  | 'room' | 'plate' | 'hall' | 'aperture' | 'cloud' | 'crystal' | 'aurora' | 'nebula' | 'void'
  | 'blocks' | 'shards' | 'smear' | 'prism' | 'repeat' | 'ruins' | 'pixels'
  | 'cassette' | 'vinyl' | 'tracking' | 'radio' | 'wax' | 'shelves' | 'deck';

interface ModeArtVariant {
  motif: ModeMotif;
  scale: number;
  amount: number;
  bias: number;
}

// Each dropdown is a named visual variation inside its parent module's art
// language. The explicit table makes semantic coverage auditable for all 79
// modes instead of relying on a seed to make nominally different noise.
export const MODE_ART_VARIANTS = {
  'saturation:velvet': { motif: 'bloom', scale: 3.2, amount: 0.34, bias: 0.08 },
  'saturation:tube': { motif: 'tubes', scale: 2.0, amount: 0.38, bias: 0.14 },
  'saturation:console': { motif: 'channels', scale: 5.0, amount: 0.34, bias: 0.20 },
  'saturation:transformer': { motif: 'coil', scale: 4.4, amount: 0.40, bias: 0.26 },
  'saturation:furnace': { motif: 'flame', scale: 4.8, amount: 0.42, bias: 0.32 },
  'saturation:exciter': { motif: 'spark', scale: 7.0, amount: 0.38, bias: 0.38 },
  'saturation:broken': { motif: 'fracture', scale: 5.6, amount: 0.40, bias: 0.44 },
  'saturation:goldlion': { motif: 'tubes', scale: 3.0, amount: 0.37, bias: 0.50 },
  'saturation:mullard': { motif: 'tubes', scale: 4.0, amount: 0.36, bias: 0.56 },
  'saturation:telefunken': { motif: 'tubes', scale: 5.0, amount: 0.35, bias: 0.62 },
  'saturation:bugleboy': { motif: 'tubes', scale: 6.0, amount: 0.34, bias: 0.68 },
  'saturation:rcablack': { motif: 'tubes', scale: 7.0, amount: 0.36, bias: 0.74 },

  'chorus:chorus': { motif: 'waves', scale: 4.0, amount: 0.34, bias: 0.06 },
  'chorus:ensemble': { motif: 'voices', scale: 5.0, amount: 0.40, bias: 0.12 },
  'chorus:dimension': { motif: 'depth', scale: 4.0, amount: 0.37, bias: 0.18 },
  'chorus:vibrato': { motif: 'vibrato', scale: 6.0, amount: 0.36, bias: 0.24 },
  'chorus:rotary': { motif: 'rotor', scale: 5.0, amount: 0.39, bias: 0.30 },
  'chorus:doppler': { motif: 'doppler', scale: 6.0, amount: 0.38, bias: 0.36 },
  'chorus:liquid': { motif: 'liquid', scale: 4.0, amount: 0.38, bias: 0.42 },
  'chorus:orbit': { motif: 'orbit', scale: 5.0, amount: 0.39, bias: 0.48 },
  'chorus:ce1': { motif: 'waves', scale: 7.0, amount: 0.35, bias: 0.54 },
  'chorus:dimensiond': { motif: 'depth', scale: 7.0, amount: 0.38, bias: 0.60 },
  'chorus:mxrflanger': { motif: 'comb', scale: 8.0, amount: 0.38, bias: 0.66 },
  'chorus:electricmistress': { motif: 'comb', scale: 10.0, amount: 0.36, bias: 0.72 },
  'chorus:adaflanger': { motif: 'comb', scale: 12.0, amount: 0.37, bias: 0.78 },
  'chorus:bf2': { motif: 'comb', scale: 14.0, amount: 0.35, bias: 0.84 },
  'chorus:biphase': { motif: 'phase', scale: 4.0, amount: 0.39, bias: 0.90 },
  'chorus:smallstone': { motif: 'phase', scale: 7.0, amount: 0.37, bias: 0.96 },
  'chorus:univibe': { motif: 'liquid', scale: 7.0, amount: 0.38, bias: 1.02 },
  'chorus:leslie': { motif: 'rotor', scale: 8.0, amount: 0.40, bias: 1.08 },

  'delay:clean': { motif: 'echo', scale: 5.0, amount: 0.33, bias: 0.05 },
  'delay:tape': { motif: 'reels', scale: 4.0, amount: 0.39, bias: 0.13 },
  'delay:bbd': { motif: 'steps', scale: 8.0, amount: 0.37, bias: 0.21 },
  'delay:pingpong': { motif: 'pingpong', scale: 6.0, amount: 0.40, bias: 0.29 },
  'delay:diffuse': { motif: 'diffuse', scale: 5.0, amount: 0.36, bias: 0.37 },
  'delay:scatter': { motif: 'scatter', scale: 9.0, amount: 0.38, bias: 0.45 },
  'delay:constellation': { motif: 'stars', scale: 7.0, amount: 0.41, bias: 0.53 },
  'delay:re201': { motif: 'reels', scale: 6.0, amount: 0.40, bias: 0.61 },
  'delay:ep-3 echoplex': { motif: 'reels', scale: 8.0, amount: 0.38, bias: 0.69 },
  'delay:binson echorec': { motif: 'drum', scale: 6.0, amount: 0.41, bias: 0.77 },
  'delay:deluxe memory man': { motif: 'memory', scale: 7.0, amount: 0.39, bias: 0.85 },
  'delay:ams dmx 15-80 s': { motif: 'digital', scale: 10.0, amount: 0.37, bias: 0.93 },

  'reverb:room': { motif: 'room', scale: 4.0, amount: 0.36, bias: 0.04 },
  'reverb:plate': { motif: 'plate', scale: 6.0, amount: 0.37, bias: 0.12 },
  'reverb:hall': { motif: 'hall', scale: 5.0, amount: 0.40, bias: 0.20 },
  'reverb:cinema': { motif: 'aperture', scale: 6.0, amount: 0.39, bias: 0.28 },
  'reverb:cloud': { motif: 'cloud', scale: 4.0, amount: 0.37, bias: 0.36 },
  'reverb:freeze': { motif: 'crystal', scale: 7.0, amount: 0.41, bias: 0.44 },
  'reverb:celestial': { motif: 'stars', scale: 10.0, amount: 0.40, bias: 0.52 },
  'reverb:aurora': { motif: 'aurora', scale: 5.0, amount: 0.41, bias: 0.60 },
  'reverb:nebula': { motif: 'nebula', scale: 6.0, amount: 0.42, bias: 0.68 },
  'reverb:abyss': { motif: 'void', scale: 5.0, amount: 0.40, bias: 0.76 },
  'reverb:emt140': { motif: 'plate', scale: 10.0, amount: 0.38, bias: 0.84 },
  'reverb:lexicon224': { motif: 'digital', scale: 7.0, amount: 0.39, bias: 0.92 },

  'bitcrusher:reconstruct': { motif: 'blocks', scale: 6.0, amount: 0.38, bias: 0.03 },
  'bitcrusher:shatter': { motif: 'shards', scale: 8.0, amount: 0.42, bias: 0.11 },
  'bitcrusher:smear': { motif: 'smear', scale: 6.0, amount: 0.37, bias: 0.19 },
  'bitcrusher:prism': { motif: 'prism', scale: 7.0, amount: 0.40, bias: 0.27 },
  'bitcrusher:stutter': { motif: 'repeat', scale: 10.0, amount: 0.39, bias: 0.35 },
  'bitcrusher:ruin': { motif: 'ruins', scale: 6.0, amount: 0.41, bias: 0.43 },
  'bitcrusher:sp1200': { motif: 'pixels', scale: 5.0, amount: 0.38, bias: 0.51 },
  'bitcrusher:mpc60': { motif: 'pixels', scale: 7.0, amount: 0.38, bias: 0.59 },
  'bitcrusher:mirage': { motif: 'pixels', scale: 9.0, amount: 0.37, bias: 0.67 },
  'bitcrusher:s950': { motif: 'pixels', scale: 11.0, amount: 0.36, bias: 0.75 },
  'bitcrusher:emulator2': { motif: 'pixels', scale: 13.0, amount: 0.37, bias: 0.83 },
  'bitcrusher:fairlightiix': { motif: 'digital', scale: 9.0, amount: 0.40, bias: 0.91 },

  'media:cassette': { motif: 'cassette', scale: 5.0, amount: 0.41, bias: 0.02 },
  'media:reel': { motif: 'reels', scale: 5.0, amount: 0.40, bias: 0.10 },
  'media:vinyl': { motif: 'vinyl', scale: 8.0, amount: 0.39, bias: 0.18 },
  'media:vhs': { motif: 'tracking', scale: 10.0, amount: 0.40, bias: 0.26 },
  'media:radio': { motif: 'radio', scale: 6.0, amount: 0.38, bias: 0.34 },
  'media:wax': { motif: 'wax', scale: 7.0, amount: 0.38, bias: 0.42 },
  'media:broken': { motif: 'fracture', scale: 9.0, amount: 0.40, bias: 0.50 },
  'media:archive': { motif: 'shelves', scale: 6.0, amount: 0.39, bias: 0.58 },
  'media:tascam424': { motif: 'channels', scale: 4.0, amount: 0.41, bias: 0.66 },
  'media:neve 1073': { motif: 'channels', scale: 6.0, amount: 0.38, bias: 0.74 },
  'media:ssl 4000e': { motif: 'channels', scale: 8.0, amount: 0.39, bias: 0.82 },
  'media:api 1608': { motif: 'channels', scale: 10.0, amount: 0.38, bias: 0.90 },
  'media:ampex atr-102': { motif: 'deck', scale: 6.0, amount: 0.42, bias: 0.98 },
} as const satisfies Record<string, ModeArtVariant>;

const TAU = Math.PI * 2;
export const ASCII_LOOP_SECONDS = 18;

export function loopAngleForTime(time: number): number {
  const wrapped = ((time % ASCII_LOOP_SECONDS) + ASCII_LOOP_SECONDS) % ASCII_LOOP_SECONDS;
  return (wrapped / ASCII_LOOP_SECONDS) * TAU;
}


function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function hashAsciiScene(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function moduleMode(module: ModuleState): string {
  switch (module.id) {
    case 'saturation': return module.emberMode ?? 'velvet';
    case 'chorus': return module.driftMode ?? 'chorus';
    case 'delay': return module.delayAlgorithm ?? 'tape';
    case 'reverb': return module.algorithm ?? 'hall';
    case 'bitcrusher': return module.grainMode ?? 'reconstruct';
    case 'media': return module.mediaMode ?? 'cassette';
    default: return 'default';
  }
}

export function moduleModeKey(module: ModuleState): string {
  return `${module.id}:${moduleMode(module)}`;
}

export function moduleModeLabel(module: ModuleState): string {
  return moduleMode(module).replace(/[-_]+/g, ' ').toUpperCase();
}

function moduleWeight(module: ModuleState): number {
  if (!module.enabled || !module.available) return 0;
  const mix = module.parameters.find((parameter) => parameter.id === 'mix')?.value ?? 0.55;
  const character = module.parameters.reduce((total, parameter) => total + parameter.value, 0) /
    Math.max(1, module.parameters.length);
  return 0.36 + clamp01(mix) * 0.42 + clamp01(character) * 0.22;
}

function prepareScene(props: AsciiArtEngineProps): PreparedScene {
  if (props.kind === 'module' && props.module) {
    const key = moduleModeKey(props.module);
    return {
      ...props,
      active: props.module.enabled && props.module.available,
      label: `${props.module.name.toUpperCase()} // ${moduleModeLabel(props.module)}`,
      sceneKey: key,
      layers: [{ id: props.module.id, key, seed: hashAsciiScene(key), weight: 1 }],
    };
  }

  const modules = props.modules ?? [];
  const layers = modules
    .map((module) => {
      const key = moduleModeKey(module);
      return { id: module.id, key, seed: hashAsciiScene(key), weight: moduleWeight(module) };
    })
    .filter((layer) => layer.weight > 0);
  const pressureKey = props.pressure?.enabled
    ? `pressure:${props.pressure.mode}:${props.pressure.style}`
    : 'pressure:off';
  const sceneKey = [...layers.map((layer) => layer.key), pressureKey].join('|') || 'landscape:idle';

  return {
    ...props,
    active: layers.length > 0 || Boolean(props.pressure?.enabled),
    label: props.pressure?.enabled
      ? `MOTION // ${props.pressure.mode.toUpperCase()} ${props.pressure.style.toUpperCase()}`
      : `MOTION // ${props.patchCount ?? 0} PATCH${props.patchCount === 1 ? '' : 'ES'}`,
    sceneKey,
    layers,
  };
}

function hashNoise(x: number, y: number, seed: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 0.000013) * 43758.5453123;
  return value - Math.floor(value);
}

function sampleModeAccent(layer: SceneLayer, x: number, y: number, loopAngle: number): number {
  const variant = MODE_ART_VARIANTS[layer.key.toLowerCase() as keyof typeof MODE_ART_VARIANTS];
  if (!variant) return 0;

  const radius = Math.hypot(x, y);
  const angle = Math.atan2(y, x);
  const sway = Math.sin(loopAngle + variant.bias);
  const counterSway = Math.cos(loopAngle * 2 - variant.bias);
  let accent = 0;

  switch (variant.motif) {
    case 'bloom':
      accent = Math.cos(radius * variant.scale * 2 - sway * 0.24) * (1 - radius * 0.54);
      break;
    case 'tubes':
      accent = Math.cos((x + counterSway * 0.008) * Math.PI * variant.scale) * 0.62
        + Math.cos(y * Math.PI * 1.45) * 0.38;
      break;
    case 'channels':
      accent = Math.cos(x * Math.PI * variant.scale + sway * 0.12) * Math.cos(y * Math.PI * 2) * 0.72
        + Math.cos(y * Math.PI * 5) * 0.22;
      break;
    case 'coil':
      accent = Math.cos(radius * variant.scale * 2 + angle * 2 - sway * 0.26) * (1 - radius * 0.28);
      break;
    case 'flame':
      accent = Math.sin((y + 1) * variant.scale - Math.abs(x) * 3 + sway * 0.30) * (1 - Math.abs(x) * 0.54);
      break;
    case 'spark':
      accent = Math.cos(angle * Math.max(4, Math.round(variant.scale)) + sway * 0.18) * (1 - radius)
        + Math.cos(radius * variant.scale * 2) * 0.34;
      break;
    case 'fracture':
      accent = Math.sin((x + y * 0.72) * variant.scale + counterSway * 0.16)
        * Math.sign(Math.cos((x - y) * variant.scale * 0.72));
      break;
    case 'waves':
      accent = Math.sin(y * variant.scale + Math.sin(x * 3 + sway * 0.18) * 1.3);
      break;
    case 'voices':
      accent = (
        Math.sin(y * variant.scale + x * 2 + sway * 0.16)
        + Math.sin(y * (variant.scale + 1.7) - x * 2 - sway * 0.14)
      ) * 0.52;
      break;
    case 'depth':
      accent = Math.cos((Math.abs(x) + Math.abs(y)) * variant.scale - counterSway * 0.20);
      break;
    case 'vibrato':
      accent = Math.sin(y * variant.scale + Math.sin(x * variant.scale + sway * 0.22) * 0.82);
      break;
    case 'rotor':
      accent = Math.cos(angle * 2 + sway * 0.34) * (1 - radius * 0.38)
        + Math.cos(radius * variant.scale) * 0.25;
      break;
    case 'doppler':
      accent = Math.sin((x + Math.sign(x || 1) * radius * 0.38) * variant.scale - sway * 0.32);
      break;
    case 'liquid':
      accent = Math.cos(radius * variant.scale + Math.sin(angle * 3 + sway * 0.16) * 0.72);
      break;
    case 'orbit':
      accent = Math.cos((radius - 0.46 - sway * 0.018) * variant.scale * 2)
        + Math.cos(angle * 2 - counterSway * 0.18) * 0.24;
      break;
    case 'comb':
      accent = Math.sin(x * variant.scale + y * 2 + sway * 0.14) * Math.cos(y * variant.scale * 0.46);
      break;
    case 'phase':
      accent = Math.cos(radius * variant.scale + angle * 2 + sway * 0.20);
      break;
    case 'echo':
      accent = Math.cos((Math.abs(x) + y * 0.14) * variant.scale * 1.5 - sway * 0.22);
      break;
    case 'reels': {
      const leftReel = Math.cos(Math.hypot(x + 0.42, y) * variant.scale * 1.8 + sway * 0.16);
      const rightReel = Math.cos(Math.hypot(x - 0.42, y) * variant.scale * 1.8 - sway * 0.16);
      accent = (leftReel + rightReel) * 0.56;
      break;
    }
    case 'steps':
      accent = Math.cos((Math.floor((x + 1) * variant.scale) / variant.scale + y * 0.22) * Math.PI * 4 - sway * 0.14);
      break;
    case 'pingpong':
      accent = Math.cos((Math.abs(x - sway * 0.035) + y * 0.16) * variant.scale * 1.35);
      break;
    case 'diffuse':
      accent = Math.cos(radius * variant.scale - sway * 0.12) * Math.exp(-radius * 0.52);
      break;
    case 'scatter':
      accent = Math.sin(x * variant.scale + sway * 0.14) * Math.sin(y * (variant.scale + 2) - counterSway * 0.12);
      break;
    case 'stars':
      accent = Math.cos(angle * Math.max(5, Math.round(variant.scale)) + sway * 0.12)
        * Math.cos(radius * variant.scale * 1.8);
      break;
    case 'drum':
      accent = Math.cos(radius * variant.scale * 1.7 + angle - sway * 0.18);
      break;
    case 'memory':
      accent = Math.cos((Math.abs(x) * 0.72 + Math.abs(y) * 0.28) * variant.scale * 1.5 - counterSway * 0.16);
      break;
    case 'digital':
      accent = Math.cos(Math.floor((x + 1) * variant.scale) + Math.floor((y + 1) * variant.scale * 0.6) + sway * 0.10);
      break;
    case 'room':
      accent = Math.cos((Math.max(Math.abs(x), Math.abs(y)) + sway * 0.012) * variant.scale * 2);
      break;
    case 'plate':
      accent = Math.cos(y * variant.scale + sway * 0.14) * (1 - Math.abs(x) * 0.26);
      break;
    case 'hall':
      accent = Math.cos(x * Math.PI * variant.scale * 0.5) * 0.46
        + Math.cos(Math.hypot(x * 0.72, y + 0.52) * variant.scale - sway * 0.14) * 0.58;
      break;
    case 'aperture':
      accent = Math.cos(angle * 6 + counterSway * 0.12) * (1 - radius * 0.48);
      break;
    case 'cloud':
      accent = Math.sin(x * variant.scale + sway * 0.12) * 0.46
        + Math.cos(y * (variant.scale - 1) - counterSway * 0.10) * 0.54;
      break;
    case 'crystal':
      accent = Math.cos(angle * 8) * Math.cos(radius * variant.scale - sway * 0.12);
      break;
    case 'aurora':
      accent = Math.sin((y + Math.sin(x * 2.4 + sway * 0.16) * 0.24) * variant.scale);
      break;
    case 'nebula':
      accent = Math.cos(radius * variant.scale + angle * 3 - sway * 0.18) * (1 - radius * 0.20);
      break;
    case 'void':
      accent = -Math.cos(radius * variant.scale - counterSway * 0.10) * Math.exp(-radius * 0.72);
      break;
    case 'blocks':
      accent = Math.cos(Math.floor((x + 1) * variant.scale) + Math.floor((y + 1) * variant.scale) - sway * 0.10);
      break;
    case 'shards':
      accent = Math.sin((x + y) * variant.scale + sway * 0.16)
        * Math.cos((x - y) * (variant.scale + 2));
      break;
    case 'smear':
      accent = Math.sin(y * variant.scale + x * 1.2 - sway * 0.18) * (1 - Math.abs(x) * 0.18);
      break;
    case 'prism':
      accent = (
        Math.cos((x + y) * variant.scale + sway * 0.12)
        + Math.cos((x - y) * (variant.scale + 1) - sway * 0.12)
      ) * 0.52;
      break;
    case 'repeat':
      accent = Math.cos(Math.floor((x + 1) * variant.scale) * 0.82 + y * 3 - counterSway * 0.10);
      break;
    case 'ruins':
      accent = Math.sin((y + 1) * variant.scale + sway * 0.10) * (0.46 + Math.abs(x) * 0.42);
      break;
    case 'pixels':
      accent = Math.cos(
        Math.floor((x + 1) * variant.scale)
        + Math.floor((y + 1) * variant.scale * 0.72)
        - sway * 0.08,
      );
      break;
    case 'cassette': {
      const leftSpool = Math.cos(Math.hypot(x + 0.34, y + 0.04) * variant.scale * 2 + sway * 0.12);
      const rightSpool = Math.cos(Math.hypot(x - 0.34, y + 0.04) * variant.scale * 2 - sway * 0.12);
      const tape = Math.cos((Math.abs(x) + y * 0.22) * variant.scale) * 0.28;
      accent = (leftSpool + rightSpool) * 0.48 + tape;
      break;
    }
    case 'vinyl':
      accent = Math.cos(radius * variant.scale * 2 - sway * 0.12) * 0.72
        + Math.cos(angle - counterSway * 0.10) * 0.18;
      break;
    case 'tracking':
      accent = Math.cos(y * variant.scale * 2 + sway * 0.16) * 0.66
        + Math.sin(x * 3 + y * 2) * 0.22;
      break;
    case 'radio':
      accent = Math.cos(radius * variant.scale - sway * 0.16) * Math.cos(angle * 2) * 0.74;
      break;
    case 'wax':
      accent = Math.cos((Math.abs(x) + y * 0.12) * variant.scale * 1.4 - counterSway * 0.12);
      break;
    case 'shelves':
      accent = Math.cos(x * Math.PI * variant.scale) * 0.36 + Math.cos(y * Math.PI * 5 + sway * 0.08) * 0.62;
      break;
    case 'deck':
      accent = Math.cos(x * Math.PI * variant.scale) * Math.cos(y * Math.PI * 3) * 0.46
        + Math.cos(radius * variant.scale + sway * 0.10) * 0.50;
      break;
  }

  return Math.max(-1.25, Math.min(1.25, accent)) * variant.amount;
}

function sampleLayer(
  layer: SceneLayer,
  u: number,
  v: number,
  loopAngle: number,
  audio: VisualAudioState,
): number {
  const variant = layer.seed % 17;
  const seedPhase = ((layer.seed % 4096) / 4096) * TAU;
  const sway = Math.sin(loopAngle + seedPhase);
  const counterSway = Math.cos(loopAngle * 2 - seedPhase);

  // Keep the reactive warp, but make its travel restrained. Audio changes the
  // shape and intensity without driving an unbounded phase that can break the seam.
  const x = u + Math.sin(v * 3.1 + seedPhase) * (0.006 + audio.mid * 0.010) * sway;
  const y = v + Math.cos(u * 4.3 - seedPhase) * (0.004 + audio.low * 0.009) * counterSway;
  const noise = hashNoise(Math.floor((x + 1) * 31), Math.floor((y + 1) * 23), layer.seed);
  let field = 0;

  switch (layer.id) {
    case 'saturation': {
      const radius = Math.hypot(x * (1.02 + variant * 0.008), y * 1.34);
      const rings = Math.cos(radius * (15 + variant * 0.45) - sway * 0.48);
      const flare = Math.cos(Math.atan2(y, x) * (4 + variant % 5) + counterSway * 0.22) * 0.34;
      field = rings * 0.72 + flare + (1 - radius) * 0.45;
      break;
    }
    case 'chorus': {
      const reflection = Math.sin((y + Math.sin(x * (4 + variant * 0.12) + sway * 0.22) * 0.16) * (12 + variant));
      const wake = Math.cos((x * 7 - y * 3) + counterSway * 0.34);
      field = reflection * 0.76 + wake * 0.28 - Math.abs(y) * 0.18;
      break;
    }
    case 'delay': {
      const echo = Math.cos((Math.abs(x) * (11 + variant * 0.32) + y * 3.2) - sway * 0.46);
      const towers = Math.cos((x + y * 0.18) * (8 + variant % 7) + counterSway * 0.14);
      field = echo * 0.62 + towers * 0.34 + (1 - Math.abs(x)) * 0.16;
      break;
    }
    case 'reverb': {
      const mountain = 1 - Math.abs(y + 0.10 - Math.abs(Math.sin(x * (2.4 + variant * 0.08) + sway * 0.16)) * 0.56);
      const vault = Math.cos(Math.hypot(x * 0.78, y + 0.34) * (13 + variant * 0.22) + counterSway * 0.24);
      field = mountain * 0.82 + vault * 0.42 - 0.58;
      break;
    }
    case 'bitcrusher': {
      const rain = Math.sin((y * (18 + variant) + Math.floor((x + 1) * (8 + variant % 4))) - sway * 0.50);
      const fracture = noise > 0.76 - audio.transient * 0.035 ? 0.72 : -0.18;
      field = rain * 0.42 + fracture + Math.cos(x * y * (18 + variant) + counterSway * 0.16) * 0.25;
      break;
    }
    case 'media': {
      const scan = Math.cos(y * (24 + variant) + sway * 0.30);
      const chassis = Math.cos(x * (6 + variant % 6) + counterSway * 0.08)
        * Math.cos(y * (5 + variant % 4) - sway * 0.06);
      const dropout = noise > 0.88 ? -0.9 : 0.12;
      field = scan * 0.32 + chassis * 0.62 + dropout;
      break;
    }
    default:
      field = Math.cos(x * 8 + sway * 0.22) * Math.sin(y * 9 - counterSway * 0.18);
  }

  return (field + sampleModeAccent(layer, x, y, loopAngle)) * layer.weight;
}

function pressureField(state: SignalLabState | undefined, u: number, v: number, loopAngle: number): number {
  if (!state?.enabled) return 0;
  const drive = clamp01(state.drive);
  const character = clamp01(state.character);
  const sway = Math.sin(loopAngle);
  const counterSway = Math.cos(loopAngle * 2);
  switch (state.mode) {
    case 'fet':
      return Math.sin((u + v * 0.18) * (18 + drive * 10) - sway * 0.36) * (0.12 + character * 0.18);
    case 'opto':
      return Math.cos(Math.hypot(u, v) * (11 + character * 7) - counterSway * 0.18) * (0.10 + drive * 0.16);
    case 'varimu':
      return Math.sin(u * 8 + sway * 0.14) * Math.cos(v * 7 - counterSway * 0.12) * (0.12 + character * 0.16);
    case 'vca':
      return Math.cos((Math.abs(u) + Math.abs(v)) * (14 + drive * 8) + sway * 0.12) * (0.10 + character * 0.17);
  }
  return 0;
}

function framedLine(columns: number, label: string): string {
  const content = `[ ${label.slice(0, Math.max(0, columns - 8))} ]`;
  const remaining = Math.max(0, columns - content.length - 2);
  return `+${content}${'-'.repeat(remaining)}+`.slice(0, columns);
}

function drawAscii(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  scene: PreparedScene,
  stamp: number,
): void {
  const theme = scene.kind === 'module' && scene.module
    ? THEMES[scene.module.id] ?? THEMES.landscape
    : THEMES.landscape;
  const audio = getLatestVisualAudioState();
  const time = stamp / 1000;
  const loopAngle = loopAngleForTime(time);
  const columns = Math.max(scene.kind === 'landscape' ? 38 : 30, Math.min(scene.kind === 'landscape' ? 82 : 58, Math.floor(width / 6.6)));
  const cellWidth = width / columns;
  const fontSize = Math.max(7, Math.min(11.5, cellWidth * 1.42));
  const lineHeight = fontSize * 1.12;
  const rows = Math.max(9, Math.floor(height / lineHeight));
  const bodyRows = Math.max(1, rows - 2);
  const seed = hashAsciiScene(scene.sceneKey);
  const glyphs = theme.glyphs;
  const activeGain = scene.active ? 1 : 0.22;
  const cursorX = clamp01((scene.position?.x ?? 50) / 100);
  const cursorY = clamp01((scene.position?.y ?? 50) / 100);

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = '#050706';
  context.fillRect(0, 0, width, height);
  context.font = `600 ${fontSize}px "IBM Plex Mono", "SFMono-Regular", Consolas, monospace`;

  // The canvas already follows the glass, but the glyph grid used to keep its
  // natural font metrics and leave dead bands around wide or resized module
  // windows. Measure the complete character frame and independently scale both
  // axes so its outer ASCII border lands on every edge of the viewport.
  const gridWidth = Math.max(1, context.measureText('M'.repeat(columns)).width);
  const gridHeight = Math.max(1, (rows - 1) * lineHeight + fontSize);
  const horizontalScale = width / gridWidth;
  const verticalScale = height / gridHeight;
  context.setTransform(dpr * horizontalScale, 0, 0, dpr * verticalScale, 0, 0);
  context.textBaseline = 'top';
  context.shadowBlur = scene.active ? 4 : 1;
  context.shadowColor = theme.primary;

  for (let row = 0; row < rows; row += 1) {
    let line: string;
    if (row === 0) {
      line = framedLine(columns, scene.label);
    } else if (row === rows - 1) {
      const footer = `SEED ${(seed >>> 0).toString(16).toUpperCase().padStart(8, '0')} // ${scene.active ? 'ONLINE' : 'STANDBY'}`;
      line = framedLine(columns, footer);
    } else {
      const characters = new Array<string>(columns).fill(' ');
      characters[0] = '|';
      characters[columns - 1] = '|';
      const normalizedY = ((row - 1) / Math.max(1, bodyRows - 1)) * 2 - 1;

      for (let column = 1; column < columns - 1; column += 1) {
        const normalizedX = ((column - 1) / Math.max(1, columns - 3)) * 2 - 1;
        let value = 0;
        let totalWeight = 0;
        for (const layer of scene.layers) {
          value += sampleLayer(layer, normalizedX, normalizedY, loopAngle, audio);
          totalWeight += layer.weight;
        }
        if (totalWeight > 0) value /= Math.max(1, Math.sqrt(totalWeight));
        value += pressureField(scene.pressure, normalizedX, normalizedY, loopAngle);
        value += (hashNoise(column, row, seed) - 0.5) * (0.12 + audio.high * 0.12);

        if (scene.kind === 'landscape') {
          const dx = column / Math.max(1, columns - 1) - cursorX;
          const dy = (row - 1) / Math.max(1, bodyRows - 1) - (1 - cursorY);
          const reticle = Math.min(Math.abs(dx), Math.abs(dy));
          if (reticle < 0.008) value += scene.dragging ? 0.75 : 0.34;
        }

        const normalized = clamp01(0.48 + value * 0.42 + audio.level * 0.08);
        if (normalized < 0.25 || (!scene.active && normalized < 0.56)) continue;
        const glyphIndex = Math.min(glyphs.length - 1, Math.floor(normalized * glyphs.length));
        characters[column] = glyphs[glyphIndex];
      }
      line = characters.join('');
    }

    context.globalAlpha = activeGain * (row === 0 || row === rows - 1 ? 0.86 : 0.52 + audio.level * 0.18);
    context.fillStyle = row % 5 === 0 ? theme.secondary : theme.primary;
    context.fillText(line, 0, row * lineHeight);
  }

  context.globalAlpha = 1;
  context.shadowBlur = 0;
}

export function AsciiArtEngine(props: AsciiArtEngineProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<PreparedScene>(prepareScene(props));
  sceneRef.current = prepareScene(props);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;

    let width = 1;
    let height = 1;
    let dpr = Math.min(1.35, window.devicePixelRatio || 1);
    let visible = true;
    let lastDraw = Number.NEGATIVE_INFINITY;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      dpr = Math.min(1.35, window.devicePixelRatio || 1);
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      lastDraw = Number.NEGATIVE_INFINITY;
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    const visibilityObserver = 'IntersectionObserver' in window
      ? new IntersectionObserver((entries) => {
          visible = entries[0]?.isIntersecting ?? true;
          if (visible) lastDraw = Number.NEGATIVE_INFINITY;
        }, { rootMargin: '80px' })
      : null;
    visibilityObserver?.observe(canvas);

    const render: ViewportRenderCallback = (stamp) => {
      if (!visible) return;
      const scene = sceneRef.current;
      const interval = scene.kind === 'landscape' && scene.dragging
        ? 1000 / 30
        : scene.active
          ? 1000 / 18
          : 250;
      if (stamp - lastDraw < interval) return;
      lastDraw = stamp;
      drawAscii(context, width, height, dpr, scene, stamp);
    };

    const unsubscribe = subscribeViewportAnimation(render);
    return () => {
      unsubscribe();
      resizeObserver.disconnect();
      visibilityObserver?.disconnect();
    };
  }, []);

  const scene = sceneRef.current;
  return (
    <canvas
      ref={canvasRef}
      className={`ascii-art-engine ${scene.active ? 'is-active' : 'is-standby'} ${props.className ?? ''}`}
      data-ascii-scene={scene.sceneKey}
      aria-hidden="true"
    />
  );
}
