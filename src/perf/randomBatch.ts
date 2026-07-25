import type { Effect } from '../audio/effects/Effect';
import { EMBER_MODE_ORDER } from '../audio/effects/Saturation';
import { DRIFT_MODE_ORDER } from '../audio/effects/Chorus';
import { DELAY_ALGORITHM_ORDER } from '../audio/effects/Delay';
import { REVERB_ALGORITHM_ORDER } from '../audio/effects/Reverb';
import { MEDIA_MODE_ORDER } from '../audio/effects/Media';
import { syncPhysicalBehavior } from '../audio/PhysicalBehaviorRegistry';

export type RandomBatchValues = ReadonlyMap<string, number>;

type UnsafeEffect = Effect & Record<string, unknown>;

const clamp = (input: number, min = 0, max = 1): number =>
  Math.max(min, Math.min(max, Number.isFinite(input) ? input : min));

function requested(values: RandomBatchValues, id: string, fallback: number): number {
  return values.has(id) ? values.get(id)! : fallback;
}

function parameterMap(effect: UnsafeEffect): Map<string, number> {
  return effect.parameterValues as Map<string, number>;
}

function setMix(effect: UnsafeEffect, mix: number): void {
  (effect.setWetDryMix as (value: number) => void).call(effect, clamp(mix));
}

function currentIndex(list: readonly string[], current: unknown, fallback = 0): number {
  const found = list.indexOf(String(current));
  return found >= 0 ? found : fallback;
}

export function applyRandomBatch(effect: Effect, values: RandomBatchValues): void {
  const unsafe = effect as UnsafeEffect;

  switch (effect.id) {
    case 'saturation': {
      const params = parameterMap(unsafe);
      const modeIndex = Math.round(clamp(requested(values, 'mode', Number(params.get('mode') ?? 0)), 0, EMBER_MODE_ORDER.length - 1));
      const drive = clamp(requested(values, 'drive', Number(params.get('drive') ?? 0.14)));
      const tone = clamp(requested(values, 'tone', Number(params.get('tone') ?? 9500)), 200, 18_000);
      const heat = clamp(requested(values, 'heat', Number(params.get('heat') ?? 0.18)));
      const character = clamp(requested(values, 'character', Number(params.get('character') ?? 0.22)));
      const dynamics = clamp(requested(values, 'dynamics', Number(params.get('dynamics') ?? 0.38)));
      const mix = clamp(requested(values, 'mix', Number(params.get('mix') ?? 0.22)));
      unsafe.mode = EMBER_MODE_ORDER[modeIndex] ?? 'velvet';
      unsafe.drive = drive; unsafe.toneHz = tone; unsafe.heat = heat; unsafe.character = character; unsafe.dynamics = dynamics;
      params.set('mode', modeIndex); params.set('drive', drive); params.set('tone', tone); params.set('heat', heat); params.set('character', character); params.set('dynamics', dynamics); params.set('mix', mix);
      setMix(unsafe, mix);
      (unsafe.apply as (now?: number) => void).call(unsafe);
      break;
    }

    case 'chorus': {
      const params = parameterMap(unsafe);
      const modeIndex = Math.round(clamp(requested(values, 'mode', Number(params.get('mode') ?? 0)), 0, DRIFT_MODE_ORDER.length - 1));
      const rate = clamp(requested(values, 'rate', Number(params.get('rate') ?? 0.28)), 0.05, 2.5);
      const depth = clamp(requested(values, 'depth', Number(params.get('depth') ?? 0.0022)), 0, 0.008);
      const shape = clamp(requested(values, 'shape', Number(params.get('shape') ?? 0.35)));
      const spread = clamp(requested(values, 'spread', Number(params.get('spread') ?? 0.62)));
      const motion = clamp(requested(values, 'motion', Number(params.get('motion') ?? 0.32)));
      const mix = clamp(requested(values, 'mix', Number(params.get('mix') ?? 0.14)));
      unsafe.mode = DRIFT_MODE_ORDER[modeIndex] ?? 'chorus';
      unsafe.rate = rate; unsafe.depth = depth; unsafe.shape = shape; unsafe.spread = spread; unsafe.motion = motion;
      params.set('mode', modeIndex); params.set('rate', rate); params.set('depth', depth); params.set('shape', shape); params.set('spread', spread); params.set('motion', motion); params.set('mix', mix);
      setMix(unsafe, mix);
      (unsafe.apply as () => void).call(unsafe);
      break;
    }

    case 'delay': {
      const params = parameterMap(unsafe);
      const oldAlgorithm = String(unsafe.algorithm ?? 'tape');
      const fallback = currentIndex(DELAY_ALGORITHM_ORDER, oldAlgorithm);
      const modeIndex = Math.round(clamp(requested(values, 'algorithm', fallback), 0, DELAY_ALGORITHM_ORDER.length - 1));
      const nextAlgorithm = DELAY_ALGORITHM_ORDER[modeIndex] ?? 'tape';
      const time = clamp(requested(values, 'time', Number(params.get('time') ?? 0.36)), 0.03, 4);
      const feedback = clamp(requested(values, 'feedback', Number(params.get('feedback') ?? 0.22)), 0, 0.9);
      const color = clamp(requested(values, 'color', Number(params.get('color') ?? 0.42)));
      const character = clamp(requested(values, 'character', Number(params.get('character') ?? 0.14)));
      const width = clamp(requested(values, 'width', Number(params.get('width') ?? 0.58)));
      const mix = clamp(requested(values, 'mix', Number(params.get('mix') ?? 0.14)));
      unsafe.time = time; unsafe.feedback = feedback; unsafe.color = color; unsafe.character = character; unsafe.width = width;
      params.set('algorithm', modeIndex); params.set('time', time); params.set('feedback', feedback); params.set('color', color); params.set('character', character); params.set('width', width); params.set('mix', mix);
      setMix(unsafe, mix);
      if (nextAlgorithm !== oldAlgorithm) (unsafe.switchAlgorithm as (algorithm: string) => void).call(unsafe, nextAlgorithm);
      else (unsafe.updateNetworks as () => void).call(unsafe);
      break;
    }

    case 'reverb': {
      const params = parameterMap(unsafe);
      const oldAlgorithm = String(unsafe.algorithm ?? 'hall');
      const fallback = currentIndex(REVERB_ALGORITHM_ORDER, oldAlgorithm, 2);
      const modeIndex = Math.round(clamp(requested(values, 'algorithm', fallback), 0, REVERB_ALGORITHM_ORDER.length - 1));
      const nextAlgorithm = REVERB_ALGORITHM_ORDER[modeIndex] ?? 'hall';
      const decay = clamp(requested(values, 'decay', Number(params.get('decay') ?? 2.4)), 0.35, 16);
      const size = clamp(requested(values, 'size', Number(params.get('size') ?? 0.52)));
      const color = clamp(requested(values, 'color', Number(params.get('color') ?? 0.42)));
      const diffusion = clamp(requested(values, 'diffusion', Number(params.get('diffusion') ?? 0.74)));
      const motion = clamp(requested(values, 'motion', Number(params.get('motion') ?? 0.18)));
      const mix = clamp(requested(values, 'mix', Number(params.get('mix') ?? 0.13)));
      unsafe.decay = decay; unsafe.size = size; unsafe.color = color; unsafe.diffusion = diffusion; unsafe.motion = motion;
      params.set('algorithm', modeIndex); params.set('decay', decay); params.set('size', size); params.set('color', color); params.set('diffusion', diffusion); params.set('motion', motion); params.set('mix', mix);
      setMix(unsafe, mix);
      if (nextAlgorithm !== oldAlgorithm) (unsafe.switchAlgorithm as (algorithm: string) => void).call(unsafe, nextAlgorithm);
      else (unsafe.updateNetworks as () => void).call(unsafe);
      break;
    }

    case 'media': {
      const params = parameterMap(unsafe);
      const oldMode = String(unsafe.mode ?? 'cassette');
      const fallback = currentIndex(MEDIA_MODE_ORDER, oldMode);
      const modeIndex = Math.round(clamp(requested(values, 'mode', fallback), 0, MEDIA_MODE_ORDER.length - 1));
      const wear = clamp(requested(values, 'wear', Number(params.get('wear') ?? 0.162)));
      const wow = clamp(requested(values, 'wow', Number(params.get('wow') ?? 0.16)));
      const noise = clamp(requested(values, 'noise', Number(params.get('noise') ?? 0.1)));
      const tone = clamp(requested(values, 'tone', Number(params.get('tone') ?? 0.62)));
      const mix = clamp(requested(values, 'mix', Number(params.get('mix') ?? 0.26)));
      unsafe.mode = MEDIA_MODE_ORDER[modeIndex] ?? 'cassette';
      unsafe.wear = wear; unsafe.wow = wow; unsafe.noise = noise; unsafe.tone = tone; unsafe.artifactMix = mix;
      params.set('mode', modeIndex); params.set('wear', wear); params.set('wow', wow); params.set('noise', noise); params.set('tone', tone); params.set('mix', mix);
      (unsafe.applyMixRouting as () => void).call(unsafe);
      (unsafe.applyCharacter as () => void).call(unsafe);
      break;
    }

    case 'bitcrusher':
      for (const [parameterId, parameterValue] of values) effect.setParameter(parameterId, parameterValue);
      break;

    default:
      for (const [parameterId, parameterValue] of values) effect.setParameter(parameterId, parameterValue);
  }

  syncPhysicalBehavior(effect);
}
