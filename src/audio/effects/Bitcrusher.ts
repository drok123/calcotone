import { clampParameter, type ParameterDefinition } from '../Parameter';
import type { PerformanceMode } from '../AudioEngine';
import { BaseEffect } from './Effect';

export type GrainMode =
  | 'mosaic'
  | 'scatter'
  | 'smear'
  | 'prism'
  | 'slice'
  | 'freeze'
  | 'clouds'
  | 'beads'
  | 'morphagene'
  | 'arbhar'
  | 'particle2'
  | 'microcosm';

// The first six legacy indices retain their conceptual destination:
// reconstruct→mosaic, shatter→scatter, smear→smear, prism→prism,
// stutter→slice, and ruin→freeze. Sampler hardware is migrated to Artifact.
export const GRAIN_MODE_ORDER: GrainMode[] = [
  'mosaic','scatter','smear','prism','slice','freeze',
  'clouds','beads','morphagene','arbhar','particle2','microcosm',
];

export const GRAIN_MODE_GROUPS = [
  { label: 'LIVE MEMORY', modes: ['smear','scatter','slice','prism','freeze','mosaic'] },
  { label: 'GRANULAR HARDWARE', modes: ['clouds','beads','morphagene','arbhar','particle2','microcosm'] },
] as const satisfies ReadonlyArray<{ label: string; modes: readonly GrainMode[] }>;

export interface GrainProfilerStats {
  averageCallbackMs: number;
  worstCallbackMs: number;
  callbackBudgetMs: number;
  cpuLoad: number;
  callbackJitterMs: number;
  activeVoices: number;
  maxVoices: number;
  effectiveVoiceLimit: number;
  overruns: number;
  droppedSpawns: number;
}

const MODE: ParameterDefinition = { id: 'mode', label: 'Mode', min: 0, max: GRAIN_MODE_ORDER.length - 1, defaultValue: 2, step: 1 };
// Keep the historical parameter id so patch cables and serialized presets remain valid.
// Grain now interprets it as a continuous analysis/window control, never as bit depth.
const WINDOW: ParameterDefinition = { id: 'bits', label: 'Window', min: 4, max: 16, defaultValue: 13, step: 1 };
const DENSITY: ParameterDefinition = { id: 'density', label: 'Density', min: 0, max: 1, defaultValue: 0.42, step: 0.01 };
const PITCH: ParameterDefinition = { id: 'pitch', label: 'Pitch', min: 0, max: 1, defaultValue: 0.38, step: 0.01 };
const CHAOS: ParameterDefinition = { id: 'chaos', label: 'Chaos', min: 0, max: 1, defaultValue: 0.16, step: 0.01 };
const BLOOM: ParameterDefinition = { id: 'bloom', label: 'Bloom', min: 0, max: 1, defaultValue: 0.36, step: 0.01 };
const MIX: ParameterDefinition = { id: 'mix', label: 'Mix', min: 0, max: 1, defaultValue: 0.12, step: 0.01 };

export class BitcrusherEffect extends BaseEffect {
  public readonly id = 'bitcrusher';
  public readonly name = 'Grain Dissector';

  private readonly processor: AudioWorkletNode;
  private readonly workletValues = new Map<string, number>();
  private profilerStats: GrainProfilerStats = { averageCallbackMs: 0, worstCallbackMs: 0, callbackBudgetMs: 0, cpuLoad: 0, callbackJitterMs: 0, activeVoices: 0, maxVoices: 0, effectiveVoiceLimit: 0, overruns: 0, droppedSpawns: 0 };

  public constructor(context: AudioContext) {
    super(context);
    this.processor = new AudioWorkletNode(context, 'calcotone-grain-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });

    this.input.connect(this.processor);
    this.processor.connect(this.wetGain);

    this.processor.port.onmessage = (event: MessageEvent<GrainProfilerStats & { type?: string }>) => {
      if (event.data?.type === 'profile') {
        const { type: _type, ...stats } = event.data;
        this.profilerStats = stats;
      }
    };
    this.processor.onprocessorerror = () => console.error('CALCOTONE Grain AudioWorklet stopped unexpectedly.');

    this.initializeParameters([MODE, WINDOW, DENSITY, PITCH, CHAOS, BLOOM, MIX]);
    const now = this.context.currentTime;
    this.setWorkletParameter('mode', MODE.defaultValue, now, true);
    this.setWorkletParameter('bits', WINDOW.defaultValue, now);
    this.setWorkletParameter('density', DENSITY.defaultValue, now);
    this.setWorkletParameter('pitch', PITCH.defaultValue, now);
    this.setWorkletParameter('chaos', CHAOS.defaultValue, now);
    this.setWorkletParameter('bloom', BLOOM.defaultValue, now);
    this.setWetDryMix(MIX.defaultValue);
  }

  public getProfilerStats(): GrainProfilerStats {
    const stats = { ...this.profilerStats };
    if (stats.callbackBudgetMs > 0 && stats.averageCallbackMs === 0 && stats.worstCallbackMs === 0) {
      stats.cpuLoad = Number.NaN;
      stats.callbackJitterMs = Number.NaN;
    }
    return stats;
  }

  public setQualityMode(mode: PerformanceMode): void {
    const maxVoices = mode === 'studio' ? 8 : mode === 'balanced' ? 7 : 6;
    this.processor.port.postMessage({ type: 'quality', maxVoices });
  }

  public setParameter(parameterId: string, value: number): void {
    const now = this.context.currentTime;
    switch (parameterId) {
      case 'mode': {
        const next = Math.round(clampParameter(value, MODE));
        if (this.parameterValues.get(parameterId) === next) return;
        this.parameterValues.set(parameterId, next);
        this.setWorkletParameter('mode', next, now, true);
        return;
      }
      case 'bits': {
        const next = Math.round(clampParameter(value, WINDOW));
        if (this.parameterValues.get(parameterId) === next) return;
        this.parameterValues.set(parameterId, next);
        this.setWorkletParameter('bits', next, now);
        return;
      }
      case 'density': {
        const next = clampParameter(value, DENSITY);
        if (this.parameterValues.get(parameterId) === next) return;
        this.parameterValues.set(parameterId, next);
        this.setWorkletParameter('density', next, now);
        return;
      }
      case 'pitch': {
        const next = clampParameter(value, PITCH);
        if (this.parameterValues.get(parameterId) === next) return;
        this.parameterValues.set(parameterId, next);
        this.setWorkletParameter('pitch', next, now);
        return;
      }
      case 'chaos': {
        const next = clampParameter(value, CHAOS);
        if (this.parameterValues.get(parameterId) === next) return;
        this.parameterValues.set(parameterId, next);
        this.setWorkletParameter('chaos', next, now);
        return;
      }
      case 'bloom': {
        const next = clampParameter(value, BLOOM);
        if (this.parameterValues.get(parameterId) === next) return;
        this.parameterValues.set(parameterId, next);
        this.setWorkletParameter('bloom', next, now);
        return;
      }
      case 'mix': {
        const next = clampParameter(value, MIX);
        if (this.parameterValues.get(parameterId) === next) return;
        this.parameterValues.set(parameterId, next);
        this.setWetDryMix(next);
        return;
      }
      default:
        console.warn(`Unknown parameter "${parameterId}" for ${this.name}.`);
    }
  }

  private setWorkletParameter(name: string, value: number, now: number, discrete = false): void {
    if (this.workletValues.get(name) === value) return;
    const parameter = this.processor.parameters.get(name);
    if (!parameter) throw new Error(`Grain processor parameter "${name}" is unavailable.`);
    this.workletValues.set(name, value);
    if (discrete) parameter.setValueAtTime(value, now);
    else parameter.setTargetAtTime(value, now, 0.012);
  }

  public override dispose(): void {
    this.processor.onprocessorerror = null;
    this.processor.port.close();
    this.processor.disconnect();
    this.workletValues.clear();
    super.dispose();
  }
}
