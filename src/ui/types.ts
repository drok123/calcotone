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
export type XYAxis = 'x' | 'y';
export type MotionCurve = 'linear' | 'soft' | 'exponential' | 'stepped';
export type MotionSmoothing = 'fast' | 'medium' | 'slow';
export interface XYAssignment { id: string; axis: XYAxis; target: string; depth: number; inverted: boolean; min: number; max: number; curve: MotionCurve; smoothing: MotionSmoothing; }
