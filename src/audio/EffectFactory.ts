import type { Effect } from './effects/Effect';
import { SaturationEffect } from './effects/Saturation';
import { ChorusEffect } from './effects/Chorus';
import { DelayEffect } from './effects/Delay';
import { BitcrusherEffect } from './effects/Bitcrusher';
import { ReverbEffect } from './effects/Reverb';
import { MediaEffect } from './effects/Media';
import { StackAmpEffect } from './effects/StackAmp';
import { attachPhysicalBehavior } from './PhysicalBehaviorRegistry';

export type EffectId =
  | 'saturation'
  | 'chorus'
  | 'delay'
  | 'bitcrusher'
  | 'reverb'
  | 'media'
  | 'chaos'
  | 'bypass';

export function createEffect(
  effectId: EffectId,
  context: AudioContext
): Effect | null {
  let effect: Effect | null = null;
  switch (effectId) {
    case 'saturation':
      effect = new SaturationEffect(context);
      break;
    case 'chorus':
      effect = new ChorusEffect(context);
      break;
    case 'delay':
      effect = new DelayEffect(context);
      break;
    case 'bitcrusher':
      effect = new BitcrusherEffect(context);
      break;
    case 'reverb':
      effect = new ReverbEffect(context);
      break;
    case 'media':
      effect = new MediaEffect(context);
      break;
    case 'chaos':
      effect = new StackAmpEffect(context);
      break;
    case 'bypass':
      return null;
    default: {
      const exhaustiveCheck: never = effectId;
      throw new Error(`Unsupported effect: ${String(exhaustiveCheck)}`);
    }
  }
  return attachPhysicalBehavior(effect);
}
