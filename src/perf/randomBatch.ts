import type { Effect } from '../audio/effects/Effect';
import { EMBER_MODE_ORDER } from '../audio/effects/Saturation';
import { DRIFT_MODE_ORDER } from '../audio/effects/Chorus';
import { DELAY_ALGORITHM_ORDER } from '../audio/effects/Delay';
import { REVERB_ALGORITHM_ORDER } from '../audio/effects/Reverb';
import { MEDIA_MODE_ORDER } from '../audio/effects/Media';

export type RandomBatchValues = ReadonlyMap<string, number>;

type UnsafeEffect = Effect & Record<string, unknown>;

type ProfileModuleTiming = {
  modeMs: number;
  parameterMs: number;
  bypassMs: number;
  writes: number;
};

type ActiveRandomProfile = {
  kind: 'musical' | 'signal';
  dspWriteMs: number;
  modeWriteMs: number;
  parameterWriteMs: number;
  writeCount: number;
  hottestLabel: string;
  hottestMs: number;
  modules: Map<string, ProfileModuleTiming>;
};

type RandomProfilerWindow = Window & {
  __calcotoneRandomProfilerStore?: {
    active: ActiveRandomProfile | null;
  };
};

const MODULE_NAMES: Record<string, string> = {
  saturation: 'Ember',
  chorus: 'Drift',
  delay: 'Halo',
  reverb: 'Atmos',
  bitcrusher: 'Grain',
  media: 'Artifact',
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function value(values: RandomBatchValues, id: string, fallback: number): number {
  return values.has(id) ? values.get(id)! : fallback;
}

function map(effect: UnsafeEffect): Map<string, number> {
  return effect.parameterValues as Map<string, number>;
}

function setMix(effect: UnsafeEffect, mix: number): void {
  (effect.setWetDryMix as (value: number) => void).call(effect, clamp(mix));
}

function recordBatch(effectId: string, elapsedMs: number): void {
  const profile = (window as RandomProfilerWindow).__calcotoneRandomProfilerStore?.active;
  if (!profile || profile.kind !== 'musical') return;

  let timing = profile.modules.get(effectId);
  if (!timing) {
    timing = { modeMs: 0, parameterMs: 0, bypassMs: 0, writes: 0 };
    profile.modules.set(effectId, timing);
  }

  // One batched transaction replaces the old mode + knob write burst. Attribute its
  // wall time to parameter work so the existing HUD remains directly comparable.
  timing.parameterMs += elapsedMs;
  timing.writes += 1;
  profile.parameterWriteMs += elapsedMs;
  profile.dspWriteMs += elapsedMs;
  profile.writeCount += 1;

  if (elapsedMs > profile.hottestMs) {
    profile.hottestMs = elapsedMs;
    profile.hottestLabel = `${MODULE_NAMES[effectId] ?? effectId}.batch`;
  }
}

export function applyRandomBatch(effect: Effect, values: RandomBatchValues): void {
  const started = performance.now();
  const unsafe = effect as UnsafeEffect;

  try {
    switch (effect.id) {
      case 'saturation': {
        const parameterValues = map(unsafe);
        const modeIndex = Math.round(clamp(value(values, 'mode', Number(parameterValues.get('mode') ?? 0)), 0, EMBER_MODE_ORDER.length - 1));
        const drive = clamp(value(values, 'drive', Number(parameterValues.get('drive') ?? 0.14)));
        const toneHz = clamp(value(values, 'tone', Number(parameterValues.get('tone') ?? 9500)), 200, 18_000);
        const heat = clamp(value(values, 'heat', Number(parameterValues.get('heat') ?? 0.18)));
        const character = clamp(value(values, 'character', Number(parameterValues.get('character') ?? 0.22)));
        const dynamics = clamp(value(values, 'dynamics', Number(parameterValues.get('dynamics') ?? 0.38)));
        const mix = clamp(value(values, 'mix', Number(parameterValues.get('mix') ?? 0.22)));

        unsafe.mode = EMBER_MODE_ORDER[modeIndex] ?? 'velvet';
        unsafe.drive = drive;
        unsafe.toneHz = toneHz;
        unsafe.heat = heat;
        unsafe.character = character;
        unsafe.dynamics = dynamics;
        parameterValues.set('mode', modeIndex);
        parameterValues.set('drive', drive);
        parameterValues.set('tone', toneHz);
        parameterValues.set('heat', heat);
        parameterValues.set('character', character);
        parameterValues.set('dynamics', dynamics);
        parameterValues.set('mix', mix);
        setMix(unsafe, mix);
        (unsafe.apply as (now?: number) => void).call(unsafe);
        break;
      }

      case 'chorus': {
        const parameterValues = map(unsafe);
        const modeIndex = Math.round(clamp(value(values, 'mode', Number(parameterValues.get('mode') ?? 0)), 0, DRIFT_MODE_ORDER.length - 1));
        const rate = clamp(value(values, 'rate', Number(parameterValues.get('rate') ?? 0.28)), 0.05, 2.5);
        const depth = clamp(value(values, 'depth', Number(parameterValues.get('depth') ?? 0.0022)), 0, 0.008);
        const shape = clamp(value(values, 'shape', Number(parameterValues.get('shape') ?? 0.35)));
        const spread = clamp(value(values, 'spread', Number(parameterValues.get('spread') ?? 0.62)));
        const motion = clamp(value(values, 'motion', Number(parameterValues.get('motion') ?? 0.32)));
        const mix = clamp(value(values, 'mix', Number(parameterValues.get('mix') ?? 0.14)));

        unsafe.mode = DRIFT_MODE_ORDER[modeIndex] ?? 'chorus';
        unsafe.rate = rate;
        unsafe.depth = depth;
        unsafe.shape = shape;
        unsafe.spread = spread;
        unsafe.motion = motion;
        parameterValues.set('mode', modeIndex);
        parameterValues.set('rate', rate);
        parameterValues.set('depth', depth);
        parameterValues.set('shape', shape);
        parameterValues.set('spread', spread);
        parameterValues.set('motion', motion);
        parameterValues.set('mix', mix);
        setMix(unsafe, mix);
        (unsafe.apply as () => void).call(unsafe);
        break;
      }

      case 'delay': {
        const parameterValues = map(unsafe);
        const currentAlgorithm = String(unsafe.algorithm ?? 'tape');
        const modeIndex = Math.round(clamp(value(values, 'algorithm', DELAY_ALGORITHM_ORDER.indexOf(currentAlgorithm)), 0, DELAY_ALGORITHM_ORDER.length - 1));
        const nextAlgorithm = DELAY_ALGORITHM_ORDER[modeIndex] ?? 'tape';
        const time = clamp(value(values, 'time', Number(parameterValues.get('time') ?? 0.36)), 0.03, 4);
        const feedback = clamp(value(values, 'feedback', Number(parameterValues.get('feedback') ?? 0.22)), 0, 0.9);
        const color = clamp(value(values, 'color', Number(parameterValues.get('color') ?? 0.42)));
        const character = clamp(value(values, 'character', Number(parameterValues.get('character') ?? 0.14)));
        const width = clamp(value(values, 'width', Number(parameterValues.get('width') ?? 0.58)));
        const mix = clamp(value(values, 'mix', Number(parameterValues.get('mix') ?? 0.14)));

        unsafe.time = time;
        unsafe.feedback = feedback;
        unsafe.color = color;
        unsafe.character = character;
        unsafe.width = width;
        parameterValues.set('algorithm', modeIndex);
        parameterValues.set('time', time);
        parameterValues.set('feedback', feedback);
        parameterValues.set('color', color);
        parameterValues.set('character', character);
        parameterValues.set('width', width);
        parameterValues.set('mix', mix);
        setMix(unsafe, mix);

        if (nextAlgorithm !== currentAlgorithm) {
          (unsafe.switchAlgorithm as (algorithm: string) => void).call(unsafe, nextAlgorithm);
        } else {
          (unsafe.updateNetworks as () => void).call(unsafe);
        }
        break;
      }

      case 'reverb': {
        const parameterValues = map(unsafe);
        const currentAlgorithm = String(unsafe.algorithm ?? 'hall');
        const modeIndex = Math.round(clamp(value(values, 'algorithm', REVERB_ALGORITHM_ORDER.indexOf(currentAlgorithm)), 0, REVERB_ALGORITHM_ORDER.length - 1));
        const nextAlgorithm = REVERB_ALGORITHM_ORDER[modeIndex] ?? 'hall';
        const decay = clamp(value(values, 'decay', Number(parameterValues.get('decay') ?? 2.4)), 0.35, 16);
        const size = clamp(value(values, 'size', Number(parameterValues.get('size') ?? 0.52)));
        const color = clamp(value(values, 'color', Number(parameterValues.get('color') ?? 0.42)));
        const diffusion = clamp(value(values, 'diffusion', Number(parameterValues.get('diffusion') ?? 0.74)));
        const motion = clamp(value(values, 'motion', Number(parameterValues.get('motion') ?? 0.18)));
        const mix = clamp(value(values, 'mix', Number(parameterValues.get('mix') ?? 0.13)));

        unsafe.decay = decay;
        unsafe.size = size;
        unsafe.color = color;
        unsafe.diffusion = diffusion;
        unsafe.motion = motion;
        parameterValues.set('algorithm', modeIndex);
        parameterValues.set('decay', decay);
        parameterValues.set('size', size);
        parameterValues.set('color', color);
        parameterValues.set('diffusion', diffusion);
        parameterValues.set('motion', motion);
        parameterValues.set('mix', mix);
        setMix(unsafe, mix);

        if (nextAlgorithm !== currentAlgorithm) {
          (unsafe.switchAlgorithm as (algorithm: string) => void).call(unsafe, nextAlgorithm);
        } else {
          (unsafe.updateNetworks as () => void).call(unsafe);
        }
        break;
      }

      case 'media': {
        const parameterValues = map(unsafe);
        const currentMode = String(unsafe.mode ?? 'cassette');
        const modeIndex = Math.round(clamp(value(values, 'mode', MEDIA_MODE_ORDER.indexOf(currentMode)), 0, MEDIA_MODE_ORDER.length - 1));
        const wear = clamp(value(values, 'wear', Number(parameterValues.get('wear') ?? 0.162)));
        const wow = clamp(value(values, 'wow', Number(parameterValues.get('wow') ?? 0.16)));
        const noise = clamp(value(values, 'noise', Number(parameterValues.get('noise') ?? 0.1)));
        const tone = clamp(value(values, 'tone', Number(parameterValues.get('tone') ?? 0.62)));
        const mix = clamp(value(values, 'mix', Number(parameterValues.get('mix') ?? 0.26)));

        unsafe.mode = MEDIA_MODE_ORDER[modeIndex] ?? 'cassette';
        unsafe.wear = wear;
        unsafe.wow = wow;
        unsafe.noise = noise;
        unsafe.tone = tone;
        unsafe.artifactMix = mix;
        parameterValues.set('mode', modeIndex);
        parameterValues.set('wear', wear);
        parameterValues.set('wow', wow);
        parameterValues.set('noise', noise);
        parameterValues.set('tone', tone);
        parameterValues.set('mix', mix);
        (unsafe.applyMixRouting as () => void).call(unsafe);
        (unsafe.applyCharacter as () => void).call(unsafe);
        break;
      }

      case 'bitcrusher': {
        // Grain's public setters are already lightweight AudioParam/worklet schedules. Keep
        // those semantics intact, but execute them inside this single rack transaction.
        for (const [parameterId, parameterValue] of values) {
          effect.setParameter(parameterId, parameterValue);
        }
        break;
      }

      default:
        for (const [parameterId, parameterValue] of values) {
          effect.setParameter(parameterId, parameterValue);
        }
    }
  } finally {
    recordBatch(effect.id, performance.now() - started);
  }
}
