import type { ReverbAlgorithm } from '../audio/effects/Reverb';
import type { MediaMode } from '../audio/effects/Media';
import type { EmberMode } from '../audio/effects/Saturation';
import type { DriftMode } from '../audio/effects/Chorus';
import type { GrainMode } from '../audio/effects/Bitcrusher';
import type { DelayAlgorithm } from '../audio/effects/Delay';

export interface ModuleParameter { id: string; label: string; value: number; display: string; }
export interface ModuleState {
  id: string; algorithm?: ReverbAlgorithm; delayAlgorithm?: DelayAlgorithm; mediaMode?: MediaMode; emberMode?: EmberMode; driftMode?: DriftMode; grainMode?: GrainMode;
  name: string; enabled: boolean; available: boolean; parameters: ModuleParameter[];
}
