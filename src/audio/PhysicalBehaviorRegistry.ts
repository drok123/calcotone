import type { Effect } from './effects/Effect';
import { EMBER_MODE_ORDER } from './effects/Saturation';
import { DRIFT_MODE_ORDER } from './effects/Chorus';
import { DELAY_ALGORITHM_ORDER } from './effects/Delay';
import { REVERB_ALGORITHM_ORDER } from './effects/Reverb';
import { GRAIN_MODE_ORDER } from './effects/Bitcrusher';
import { MEDIA_MODE_ORDER } from './effects/Media';
import type { BehaviorMemoryProfile } from './models/BehaviorMemoryStage';

interface BehaviorSpec {
  profile: BehaviorMemoryProfile;
  amount: number;
  motion: number;
  memory: number;
  color: number;
}

const BYPASS: BehaviorSpec = { profile: 'bypass', amount: 0, motion: 0, memory: 0, color: 0.5 };
const attached = new WeakSet<Effect>();

function value(effect: Effect, id: string, fallback = 0): number {
  const raw = effect.getParameterValue(id);
  if (raw === undefined) return fallback;
  const parameter = effect.getParameter(id);
  if (!parameter) return fallback;
  const span = parameter.max - parameter.min;
  return span > 0 ? Math.max(0, Math.min(1, (raw - parameter.min) / span)) : 0;
}

function index(effect: Effect, id: string, fallback = 0): number {
  return Math.round(effect.getParameterValue(id) ?? fallback);
}

function spec(profile: BehaviorMemoryProfile, amount: number, motion: number, memory: number, color: number): BehaviorSpec {
  return { profile, amount, motion, memory, color };
}

/**
 * Wrap an effect instance once so ordinary parameter writes refresh its physical
 * behavior model. Mix changes are intentionally excluded because no physical
 * profile depends on wet/dry balance; this keeps the highest-rate UI path cheap.
 */
export function attachPhysicalBehavior(effect: Effect): Effect {
  if (attached.has(effect)) return effect;
  attached.add(effect);
  const originalSetParameter = effect.setParameter.bind(effect);
  effect.setParameter = (parameterId: string, parameterValue: number): void => {
    originalSetParameter(parameterId, parameterValue);
    if (parameterId !== 'mix') syncPhysicalBehavior(effect);
  };
  syncPhysicalBehavior(effect);
  return effect;
}

/**
 * Central behavioral-simulation registry.
 *
 * These are deliberately conservative theory-crafted relationships: known hardware
 * mechanisms where a mode represents hardware, and physically-inspired state models
 * for creative modes that never had a literal historical circuit.
 */
export function syncPhysicalBehavior(effect: Effect): void {
  let behavior = BYPASS;

  if (effect.id === 'saturation') {
    const mode = EMBER_MODE_ORDER[index(effect, 'mode')] ?? 'velvet';
    const drive = value(effect, 'drive', 0.14);
    const heat = value(effect, 'heat', 0.18);
    const character = value(effect, 'character', 0.22);
    const dynamics = value(effect, 'dynamics', 0.38);
    switch (mode) {
      case 'velvet': behavior = spec('elastic', 0.07 + drive * 0.08, heat, 0.55 + dynamics * 0.3, character); break;
      case 'tube': behavior = spec('console', 0.045 + drive * 0.045, heat, 0.72, character); break;
      case 'console': behavior = spec('console', 0.07 + drive * 0.07, dynamics, 0.7, character); break;
      case 'transformer': behavior = BYPASS; break;
      case 'furnace': behavior = spec('console', 0.11 + drive * 0.10, heat, 0.82, character); break;
      case 'exciter': behavior = spec('converter', 0.055 + character * 0.07, heat, 0.28, character); break;
      case 'broken': behavior = spec('fracture', 0.09 + drive * 0.12, heat, 0.88, character); break;
      case 'goldlion': case 'mullard': case 'telefunken': case 'bugleboy': case 'rcablack': behavior = BYPASS; break;
    }
  } else if (effect.id === 'chorus') {
    const mode = DRIFT_MODE_ORDER[index(effect, 'mode')] ?? 'chorus';
    const rate = value(effect, 'rate', 0.2);
    const depth = value(effect, 'depth', 0.25);
    const shape = value(effect, 'shape', 0.35);
    const motion = value(effect, 'motion', 0.32);
    switch (mode) {
      case 'chorus': behavior = spec('elastic', 0.065 + depth * 0.055, rate, 0.58 + shape * 0.2, motion); break;
      case 'ensemble': behavior = spec('elastic', 0.085 + depth * 0.055, rate, 0.78, shape); break;
      case 'dimension': behavior = spec('elastic', 0.06 + shape * 0.045, rate, 0.86, motion); break;
      case 'vibrato': behavior = spec('elastic', 0.07 + depth * 0.04, rate, 0.42, shape); break;
      case 'rotary': behavior = spec('rotor', 0.085 + motion * 0.065, rate, 0.78, shape); break;
      case 'doppler': behavior = spec('orbital', 0.075 + motion * 0.055, rate, 0.6, shape); break;
      case 'liquid': behavior = spec('fluid', 0.09 + motion * 0.065, rate, 0.82, shape); break;
      case 'orbit': behavior = spec('orbital', 0.085 + motion * 0.07, rate, 0.88, shape); break;
      case 'ce1': behavior = spec('elastic', 0.045 + shape * 0.035, motion, 0.68, 0.42); break;
      case 'dimensiond': behavior = spec('elastic', 0.04 + shape * 0.03, 0.18, 0.9, 0.48); break;
    }
  } else if (effect.id === 'delay') {
    const mode = DELAY_ALGORITHM_ORDER[index(effect, 'algorithm')] ?? 'tape';
    const feedback = value(effect, 'feedback', 0.22);
    const character = value(effect, 'character', 0.14);
    const color = value(effect, 'color', 0.42);
    const width = value(effect, 'width', 0.58);
    switch (mode) {
      case 'clean': behavior = spec('elastic', 0.025 + feedback * 0.025, width, 0.32, color); break;
      case 'tape': behavior = spec('magnetic', 0.065 + character * 0.075, character, 0.82, color); break;
      case 'bbd': behavior = spec('charge', 0.075 + character * 0.075, feedback, 0.83, color); break;
      case 'pingpong': behavior = spec('elastic', 0.035 + feedback * 0.035, width, 0.48, color); break;
      case 'diffuse': behavior = spec('acoustic', 0.06 + character * 0.055, width, 0.82, color); break;
      case 'scatter': behavior = spec('fracture', 0.065 + character * 0.075, width, 0.72, color); break;
      case 'constellation': behavior = spec('orbital', 0.075 + character * 0.08, width, 0.86, color); break;
      case 're201': behavior = spec('transport', 0.065 + character * 0.07, character, 0.86, color); break;
      case 'EP-3 Echoplex': behavior = spec('magnetic', 0.07 + character * 0.075, character, 0.84, color); break;
      case 'Binson Echorec': behavior = spec('rotor', 0.065 + character * 0.06, character, 0.88, color); break;
      case 'Deluxe Memory Man': behavior = spec('charge', 0.075 + character * 0.065, feedback, 0.88, color); break;
      case 'AMS DMX 15-80 S': behavior = spec('converter', 0.055 + character * 0.055, width, 0.62, color); break;
    }
  } else if (effect.id === 'reverb') {
    const mode = REVERB_ALGORITHM_ORDER[index(effect, 'algorithm', 2)] ?? 'hall';
    const decay = value(effect, 'decay', 0.35);
    const size = value(effect, 'size', 0.52);
    const diffusion = value(effect, 'diffusion', 0.74);
    const motion = value(effect, 'motion', 0.18);
    const color = value(effect, 'color', 0.42);
    switch (mode) {
      case 'room': behavior = spec('acoustic', 0.035 + diffusion * 0.035, size, 0.58 + decay * 0.2, color); break;
      case 'plate': behavior = spec('elastic', 0.06 + diffusion * 0.045, motion, 0.88, color); break;
      case 'hall': behavior = spec('acoustic', 0.05 + diffusion * 0.04, size, 0.84, color); break;
      case 'cinema': behavior = spec('acoustic', 0.055 + size * 0.045, motion, 0.9, color); break;
      case 'cloud': behavior = spec('fluid', 0.06 + motion * 0.065, motion, 0.92, color); break;
      case 'freeze': behavior = spec('acoustic', 0.075 + decay * 0.05, motion, 0.99, color); break;
      case 'celestial': behavior = spec('orbital', 0.065 + motion * 0.06, motion, 0.94, color); break;
      case 'aurora': behavior = spec('fluid', 0.065 + motion * 0.065, motion, 0.9, color); break;
      case 'nebula': behavior = spec('fluid', 0.075 + diffusion * 0.055, motion, 0.96, color); break;
      case 'abyss': behavior = spec('acoustic', 0.07 + size * 0.055, motion, 0.97, color * 0.7); break;
      case 'emt140': behavior = spec('elastic', 0.065 + decay * 0.04, motion, 0.94, color); break;
      case 'lexicon224': behavior = spec('converter', 0.055 + diffusion * 0.045, motion, 0.78, color); break;
    }
  } else if (effect.id === 'bitcrusher') {
    const mode = GRAIN_MODE_ORDER[index(effect, 'mode')] ?? 'reconstruct';
    const density = value(effect, 'density', 0.42);
    const pitch = value(effect, 'pitch', 0.38);
    const chaos = value(effect, 'chaos', 0.16);
    const bloom = value(effect, 'bloom', 0.36);
    switch (mode) {
      case 'reconstruct': behavior = spec('granular', 0.045 + density * 0.04, pitch, 0.62, bloom); break;
      case 'shatter': behavior = spec('fracture', 0.065 + chaos * 0.075, pitch, 0.68, bloom); break;
      case 'smear': behavior = spec('fluid', 0.055 + density * 0.055, pitch, 0.9, bloom); break;
      case 'prism': behavior = spec('orbital', 0.055 + pitch * 0.055, chaos, 0.78, bloom); break;
      case 'stutter': behavior = spec('charge', 0.055 + density * 0.05, chaos, 0.72, bloom); break;
      case 'ruin': behavior = spec('fracture', 0.085 + chaos * 0.09, pitch, 0.9, bloom); break;
      case 'sp1200': behavior = spec('converter', 0.055 + density * 0.045, chaos, 0.72, bloom); break;
      case 'mpc60': behavior = spec('converter', 0.045 + density * 0.04, chaos, 0.62, bloom); break;
      case 'mirage': behavior = spec('converter', 0.065 + density * 0.05, pitch, 0.78, bloom); break;
    }
  } else if (effect.id === 'media') {
    const mode = MEDIA_MODE_ORDER[index(effect, 'mode')] ?? 'cassette';
    const wear = value(effect, 'wear', 0.162);
    const wow = value(effect, 'wow', 0.16);
    const noise = value(effect, 'noise', 0.1);
    const tone = value(effect, 'tone', 0.62);
    switch (mode) {
      case 'cassette': behavior = spec('transport', 0.065 + wear * 0.07, wow, 0.86, tone); break;
      case 'reel': behavior = spec('magnetic', 0.065 + wear * 0.065, wow, 0.9, tone); break;
      case 'vinyl': behavior = spec('rotor', 0.045 + wear * 0.055, wow, 0.78, tone); break;
      case 'vhs': behavior = spec('transport', 0.07 + wear * 0.07, wow, 0.84, tone); break;
      case 'radio': behavior = spec('converter', 0.04 + noise * 0.045, wow, 0.48, tone); break;
      case 'wax': behavior = spec('rotor', 0.06 + wear * 0.065, wow, 0.9, tone); break;
      case 'broken': behavior = spec('fracture', 0.09 + wear * 0.09, wow, 0.92, tone); break;
      case 'archive': behavior = spec('transport', 0.055 + wear * 0.055, wow, 0.93, tone); break;
      case 'tascam424': behavior = spec('console', 0.055 + wear * 0.055, wow, 0.76, tone); break;
      case 'Neve 1073': behavior = spec('magnetic', 0.045 + wear * 0.045, wow, 0.82, tone); break;
      case 'SSL 4000E': behavior = spec('console', 0.045 + wear * 0.045, wow, 0.72, tone); break;
      case 'API 1608': behavior = spec('console', 0.045 + wear * 0.045, wow, 0.68, tone); break;
      case 'Ampex ATR-102': behavior = spec('magnetic', 0.065 + wear * 0.065, wow, 0.94, tone); break;
    }
  }

  effect.configureBehavior(behavior.profile, behavior.amount, behavior.motion, behavior.memory, behavior.color);
}
