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
  return effect.getNormalizedParameterValue(id) ?? fallback;
}

function index(effect: Effect, id: string, fallback = 0): number {
  return Math.round(effect.getParameterValue(id) ?? fallback);
}

function mix(a: number, b: number, amount: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, amount));
}

function spec(profile: BehaviorMemoryProfile, amount: number, motion: number, memory: number, color: number): BehaviorSpec {
  return {
    profile,
    amount: Math.max(0, Math.min(1, amount)),
    motion: Math.max(0, Math.min(1, motion)),
    memory: Math.max(0, Math.min(1, memory)),
    color: Math.max(0, Math.min(1, color)),
  };
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
 * for creative modes that never had a literal historical circuit. Dedicated hardware
 * worklets remain BYPASS here to avoid double-simulating the same mechanism.
 */
export function syncPhysicalBehavior(effect: Effect): void {
  let behavior = BYPASS;

  if (effect.id === 'saturation') {
    const mode = EMBER_MODE_ORDER[index(effect, 'mode')] ?? 'velvet';
    const drive = value(effect, 'drive', 0.14);
    const heat = value(effect, 'heat', 0.18);
    const character = value(effect, 'character', 0.22);
    const dynamics = value(effect, 'dynamics', 0.38);
    const tone = value(effect, 'tone', 0.52);
    switch (mode) {
      case 'velvet': behavior = spec('elastic', 0.065 + drive * 0.085, heat, 0.48 + dynamics * 0.38, mix(character, tone, 0.28)); break;
      case 'tube': behavior = spec('console', 0.04 + drive * 0.05, heat, 0.66 + dynamics * 0.16, character); break;
      case 'console': behavior = spec('console', 0.065 + drive * 0.075, mix(dynamics, heat, 0.22), 0.62 + dynamics * 0.22, mix(character, tone, 0.18)); break;
      case 'transformer': behavior = BYPASS; break;
      case 'furnace': behavior = spec('console', 0.105 + drive * 0.11, heat, 0.76 + dynamics * 0.18, character); break;
      case 'exciter': behavior = spec('converter', 0.05 + character * 0.075, mix(heat, drive, 0.25), 0.24 + dynamics * 0.18, mix(character, tone, 0.2)); break;
      case 'broken': behavior = spec('fracture', 0.085 + drive * 0.13, mix(heat, character, 0.2), 0.82 + dynamics * 0.14, character); break;
      case 'goldlion': case 'mullard': case 'telefunken': case 'bugleboy': case 'rcablack': behavior = BYPASS; break;
    }
  } else if (effect.id === 'chorus') {
    const mode = DRIFT_MODE_ORDER[index(effect, 'mode')] ?? 'chorus';
    const rate = value(effect, 'rate', 0.2);
    const depth = value(effect, 'depth', 0.25);
    const shape = value(effect, 'shape', 0.35);
    const spread = value(effect, 'spread', 0.62);
    const motion = value(effect, 'motion', 0.32);
    const physicalMotion = mix(rate, motion, 0.42);
    switch (mode) {
      case 'chorus': behavior = spec('elastic', 0.06 + depth * 0.06, physicalMotion, 0.54 + shape * 0.24, mix(motion, spread, 0.3)); break;
      case 'ensemble': behavior = spec('elastic', 0.08 + depth * 0.06, physicalMotion, 0.72 + spread * 0.18, shape); break;
      case 'dimension': behavior = spec('elastic', 0.055 + shape * 0.05, mix(rate, spread, 0.2), 0.8 + spread * 0.16, motion); break;
      case 'vibrato': behavior = spec('elastic', 0.065 + depth * 0.045, rate, 0.38 + shape * 0.12, shape); break;
      case 'rotary': behavior = spec('rotor', 0.08 + motion * 0.07, mix(rate, spread, 0.16), 0.7 + depth * 0.18, shape); break;
      case 'doppler': behavior = spec('orbital', 0.07 + motion * 0.06, mix(rate, spread, 0.18), 0.54 + depth * 0.16, shape); break;
      case 'liquid': behavior = spec('fluid', 0.085 + motion * 0.07, mix(rate, depth, 0.35), 0.74 + spread * 0.18, shape); break;
      case 'orbit': behavior = spec('orbital', 0.08 + motion * 0.075, mix(rate, spread, 0.42), 0.82 + depth * 0.14, shape); break;
      case 'ce1': behavior = spec('elastic', 0.04 + shape * 0.04, mix(rate, motion, 0.35), 0.62 + depth * 0.16, mix(0.42, spread, 0.18)); break;
      case 'dimensiond': behavior = spec('elastic', 0.038 + shape * 0.034, mix(rate, motion, 0.22), 0.84 + spread * 0.12, mix(0.48, depth, 0.14)); break;
    }
  } else if (effect.id === 'delay') {
    const mode = DELAY_ALGORITHM_ORDER[index(effect, 'algorithm')] ?? 'tape';
    const time = value(effect, 'time', 0.36);
    const feedback = value(effect, 'feedback', 0.22);
    const character = value(effect, 'character', 0.14);
    const color = value(effect, 'color', 0.42);
    const width = value(effect, 'width', 0.58);
    const storedEnergy = Math.min(1, feedback * 0.78 + time * 0.22);
    switch (mode) {
      case 'clean': behavior = spec('elastic', 0.022 + feedback * 0.03, width, 0.26 + storedEnergy * 0.22, color); break;
      case 'tape': behavior = spec('magnetic', 0.06 + character * 0.08, mix(character, width, 0.12), 0.72 + storedEnergy * 0.22, color); break;
      case 'bbd': behavior = spec('charge', 0.07 + character * 0.08, mix(feedback, width, 0.18), 0.72 + storedEnergy * 0.24, color); break;
      case 'pingpong': behavior = spec('elastic', 0.03 + feedback * 0.04, width, 0.42 + storedEnergy * 0.16, color); break;
      case 'diffuse': behavior = spec('acoustic', 0.055 + character * 0.06, width, 0.74 + storedEnergy * 0.2, color); break;
      case 'scatter': behavior = spec('fracture', 0.06 + character * 0.08, mix(width, feedback, 0.25), 0.64 + storedEnergy * 0.18, color); break;
      case 'constellation': behavior = spec('orbital', 0.07 + character * 0.085, width, 0.78 + storedEnergy * 0.18, color); break;
      case 're201': behavior = spec('transport', 0.06 + character * 0.075, mix(character, width, 0.16), 0.76 + storedEnergy * 0.2, color); break;
      case 'EP-3 Echoplex': behavior = spec('magnetic', 0.065 + character * 0.08, character, 0.76 + storedEnergy * 0.18, color); break;
      case 'Binson Echorec': behavior = spec('rotor', 0.06 + character * 0.065, mix(character, width, 0.18), 0.82 + feedback * 0.12, color); break;
      case 'Deluxe Memory Man': behavior = spec('charge', 0.07 + character * 0.07, feedback, 0.78 + storedEnergy * 0.18, color); break;
      case 'AMS DMX 15-80 S': behavior = spec('converter', 0.05 + character * 0.06, width, 0.54 + storedEnergy * 0.14, color); break;
    }
  } else if (effect.id === 'reverb') {
    const mode = REVERB_ALGORITHM_ORDER[index(effect, 'algorithm', 2)] ?? 'hall';
    const decay = value(effect, 'decay', 0.35);
    const size = value(effect, 'size', 0.52);
    const diffusion = value(effect, 'diffusion', 0.74);
    const motion = value(effect, 'motion', 0.18);
    const color = value(effect, 'color', 0.42);
    const storedEnergy = Math.min(1, decay * 0.68 + diffusion * 0.32);
    switch (mode) {
      case 'room': behavior = spec('acoustic', 0.03 + diffusion * 0.04, size, 0.5 + storedEnergy * 0.32, color); break;
      case 'plate': behavior = spec('elastic', 0.055 + diffusion * 0.05, motion, 0.78 + storedEnergy * 0.18, color); break;
      case 'hall': behavior = spec('acoustic', 0.045 + diffusion * 0.045, size, 0.74 + storedEnergy * 0.22, color); break;
      case 'cinema': behavior = spec('acoustic', 0.05 + size * 0.05, mix(motion, size, 0.16), 0.8 + storedEnergy * 0.16, color); break;
      case 'cloud': behavior = spec('fluid', 0.055 + motion * 0.07, motion, 0.82 + storedEnergy * 0.14, color); break;
      case 'freeze': behavior = spec('acoustic', 0.07 + decay * 0.055, motion, 0.94 + storedEnergy * 0.05, color); break;
      case 'celestial': behavior = spec('orbital', 0.06 + motion * 0.065, motion, 0.86 + storedEnergy * 0.1, color); break;
      case 'aurora': behavior = spec('fluid', 0.06 + motion * 0.07, motion, 0.8 + storedEnergy * 0.14, color); break;
      case 'nebula': behavior = spec('fluid', 0.07 + diffusion * 0.06, motion, 0.88 + storedEnergy * 0.1, color); break;
      case 'abyss': behavior = spec('acoustic', 0.065 + size * 0.06, motion, 0.9 + storedEnergy * 0.08, color * 0.7); break;
      case 'emt140': behavior = spec('elastic', 0.06 + decay * 0.045, mix(motion, size, 0.08), 0.86 + diffusion * 0.1, color); break;
      case 'lexicon224': behavior = spec('converter', 0.05 + diffusion * 0.05, motion, 0.68 + storedEnergy * 0.16, color); break;
    }
  } else if (effect.id === 'bitcrusher') {
    const mode = GRAIN_MODE_ORDER[index(effect, 'mode')] ?? 'reconstruct';
    const bits = value(effect, 'bits', 0.75);
    const density = value(effect, 'density', 0.42);
    const pitch = value(effect, 'pitch', 0.38);
    const chaos = value(effect, 'chaos', 0.16);
    const bloom = value(effect, 'bloom', 0.36);
    const converterStress = 1 - bits;
    switch (mode) {
      case 'reconstruct': behavior = spec('granular', 0.04 + density * 0.045, pitch, 0.54 + bloom * 0.18, bloom); break;
      case 'shatter': behavior = spec('fracture', 0.06 + chaos * 0.08, pitch, 0.6 + density * 0.16, bloom); break;
      case 'smear': behavior = spec('fluid', 0.05 + density * 0.06, pitch, 0.82 + bloom * 0.14, bloom); break;
      case 'prism': behavior = spec('orbital', 0.05 + pitch * 0.06, chaos, 0.7 + density * 0.16, bloom); break;
      case 'stutter': behavior = spec('charge', 0.05 + density * 0.055, chaos, 0.64 + bloom * 0.16, bloom); break;
      case 'ruin': behavior = spec('fracture', 0.08 + chaos * 0.095, pitch, 0.82 + density * 0.12, bloom); break;
      case 'sp1200': behavior = spec('converter', 0.045 + converterStress * 0.035 + density * 0.025, chaos, 0.62 + bloom * 0.14, bloom); break;
      case 'mpc60': behavior = spec('converter', 0.035 + converterStress * 0.025 + density * 0.02, chaos, 0.54 + bloom * 0.12, bloom); break;
      case 'mirage': behavior = spec('converter', 0.055 + converterStress * 0.045 + density * 0.025, pitch, 0.7 + bloom * 0.14, bloom); break;
    }
  } else if (effect.id === 'media') {
    const mode = MEDIA_MODE_ORDER[index(effect, 'mode')] ?? 'cassette';
    const wear = value(effect, 'wear', 0.162);
    const wow = value(effect, 'wow', 0.16);
    const noise = value(effect, 'noise', 0.1);
    const tone = value(effect, 'tone', 0.62);
    const ageMemory = Math.min(1, wear * 0.72 + noise * 0.28);
    switch (mode) {
      case 'cassette': behavior = spec('transport', 0.06 + wear * 0.075 + noise * 0.015, wow, 0.76 + ageMemory * 0.2, tone); break;
      case 'reel': behavior = spec('magnetic', 0.06 + wear * 0.07, wow, 0.8 + ageMemory * 0.16, tone); break;
      case 'vinyl': behavior = spec('rotor', 0.04 + wear * 0.06 + noise * 0.01, wow, 0.68 + ageMemory * 0.16, tone); break;
      case 'vhs': behavior = spec('transport', 0.065 + wear * 0.075 + noise * 0.015, wow, 0.74 + ageMemory * 0.18, tone); break;
      case 'radio': behavior = spec('converter', 0.035 + noise * 0.05 + wear * 0.015, wow, 0.42 + ageMemory * 0.14, tone); break;
      case 'wax': behavior = spec('rotor', 0.055 + wear * 0.07 + noise * 0.012, wow, 0.8 + ageMemory * 0.16, tone); break;
      case 'broken': behavior = spec('fracture', 0.085 + wear * 0.095 + noise * 0.02, wow, 0.84 + ageMemory * 0.14, tone); break;
      case 'archive': behavior = spec('transport', 0.05 + wear * 0.06 + noise * 0.015, wow, 0.84 + ageMemory * 0.12, tone); break;
      case 'tascam424': behavior = spec('console', 0.05 + wear * 0.06, mix(wow, noise, 0.18), 0.68 + ageMemory * 0.12, tone); break;
      case 'Neve 1073': behavior = spec('magnetic', 0.04 + wear * 0.05, mix(wow, noise, 0.12), 0.74 + ageMemory * 0.12, tone); break;
      case 'SSL 4000E': behavior = spec('console', 0.04 + wear * 0.05, mix(wow, noise, 0.16), 0.64 + ageMemory * 0.12, tone); break;
      case 'API 1608': behavior = spec('console', 0.04 + wear * 0.05, mix(wow, noise, 0.14), 0.6 + ageMemory * 0.12, tone); break;
      case 'Ampex ATR-102': behavior = spec('magnetic', 0.06 + wear * 0.07, wow, 0.84 + ageMemory * 0.12, tone); break;
    }
  }

  effect.configureBehavior(behavior.profile, behavior.amount, behavior.motion, behavior.memory, behavior.color);
}
