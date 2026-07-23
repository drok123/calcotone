import type { Effect } from './effects/Effect';
import { SaturationEffect } from './effects/Saturation';
import { ChorusEffect } from './effects/Chorus';
import { DelayEffect } from './effects/Delay';
import { BitcrusherEffect } from './effects/Bitcrusher';
import { ReverbEffect } from './effects/Reverb';
import { MediaEffect } from './effects/Media';

export type EffectId =
  | 'saturation'
  | 'chorus'
  | 'delay'
  | 'bitcrusher'
  | 'reverb'
  | 'media'
  | 'bypass';

export function createEffect(
  effectId: EffectId,
  context: AudioContext
): Effect | null {
  switch (effectId) {
    case 'saturation':
      return new SaturationEffect(context);
    case 'chorus':
      return new ChorusEffect(context);
    case 'delay':
      return new DelayEffect(context);
    case 'bitcrusher':
      return new BitcrusherEffect(context);
    case 'reverb':
      return new ReverbEffect(context);
    case 'media':
      return new MediaEffect(context);
    case 'bypass':
      return null;
    default: {
      const exhaustiveCheck: never = effectId;
      throw new Error(`Unsupported effect: ${String(exhaustiveCheck)}`);
    }
  }
}
