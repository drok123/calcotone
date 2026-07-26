import { clampParameter, type ParameterDefinition } from '../Parameter';
import type { PerformanceMode } from '../AudioEngine';
import { BaseEffect } from './Effect';

export type GrainMode =
  | 'reconstruct'
  | 'shatter'
  | 'smear'
  | 'prism'
  | 'stutter'
  | 'ruin'
  | 'sp1200'
  | 'mpc60'
  | 'mirage'
  | 's950'
  | 'emulator2'
  | 'fairlightiix';

// Existing indices stay fixed for preset compatibility; hardware studies append only.
export const GRAIN_MODE_ORDER: GrainMode[] = [
  'reconstruct','shatter','smear','prism','stutter','ruin','sp1200','mpc60','mirage',
  's950','emulator2','fairlightiix',
];

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

const MODE: ParameterDefinition = { id: 'mode', label: 'Mode', min: 0, max: GRAIN_MODE_ORDER.length - 1, defaultValue: 0, step: 1 };
const BITS: ParameterDefinition = { id: 'bits', label: 'Bits', min: 4, max: 16, defaultValue: 13, step: 1, unit: 'bit' };
const DENSITY: ParameterDefinition = { id: 'density', label: 'Density', min: 0, max: 1, defaultValue: 0.42, step: 0.01 };
const PITCH: ParameterDefinition = { id: 'pitch', label: 'Pitch', min: 0, max: 1, defaultValue: 0.38, step: 0.01 };
const CHAOS: ParameterDefinition = { id: 'chaos', label: 'Chaos', min: 0, max: 1, defaultValue: 0.16, step: 0.01 };
const BLOOM: ParameterDefinition = { id: 'bloom', label: 'Bloom', min: 0, max: 1, defaultValue: 0.36, step: 0.01 };
const MIX: ParameterDefinition = { id: 'mix', label: 'Mix', min: 0, max: 1, defaultValue: 0.12, step: 0.01 };

export class BitcrusherEffect extends BaseEffect {
  public readonly id = 'bitcrusher';
  public readonly name = 'Grain Dissector';

  private readonly processor: AudioWorkletNode;
  private readonly bloomFilter: BiquadFilterNode;
  private readonly bloomDelayL: DelayNode;
  private readonly bloomDelayR: DelayNode;
  private readonly bloomMerge: ChannelMergerNode;
  private readonly bloomGain: GainNode;
  private readonly directGain: GainNode;
  private readonly workletValues = new Map<string, number>();
  private mode: GrainMode = 'reconstruct';
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

    this.bloomFilter = context.createBiquadFilter();
    this.bloomFilter.type = 'lowpass';
    this.bloomFilter.frequency.value = 7200;
    this.bloomFilter.Q.value = 0.35;
    this.bloomDelayL = context.createDelay(0.2);
    this.bloomDelayR = context.createDelay(0.2);
    this.bloomDelayL.delayTime.value = 0.031;
    this.bloomDelayR.delayTime.value = 0.047;
    this.bloomMerge = context.createChannelMerger(2);
    this.bloomGain = context.createGain();
    this.directGain = context.createGain();

    this.input.connect(this.processor);
    this.processor.connect(this.directGain);
    this.directGain.connect(this.wetGain);
    this.processor.connect(this.bloomFilter);
    this.bloomFilter.connect(this.bloomDelayL);
    this.bloomFilter.connect(this.bloomDelayR);
    this.bloomDelayL.connect(this.bloomMerge, 0, 0);
    this.bloomDelayR.connect(this.bloomMerge, 0, 1);
    this.bloomMerge.connect(this.bloomGain);
    this.bloomGain.connect(this.wetGain);

    this.processor.port.onmessage = (event: MessageEvent<GrainProfilerStats & { type?: string }>) => {
      if (event.data?.type === 'profile') {
        const { type: _type, ...stats } = event.data;
        this.profilerStats = stats;
      }
    };
    this.processor.onprocessorerror = () => console.error('CALCOTONE Grain AudioWorklet stopped unexpectedly.');

    this.initializeParameters([MODE, BITS, DENSITY, PITCH, CHAOS, BLOOM, MIX]);
    const now = this.context.currentTime;
    this.setWorkletParameter('mode', MODE.defaultValue, now);
    this.setWorkletParameter('bits', BITS.defaultValue, now);
    this.setWorkletParameter('density', DENSITY.defaultValue, now);
    this.setWorkletParameter('pitch', PITCH.defaultValue, now);
    this.setWorkletParameter('chaos', CHAOS.defaultValue, now);
    this.setWorkletParameter('bloom', BLOOM.defaultValue, now);
    this.bloomFilter.frequency.setTargetAtTime(2800 + BLOOM.defaultValue * 7600, now, 0.05);
    this.updateWetBodyGain(now);
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
        this.mode = GRAIN_MODE_ORDER[next] ?? 'reconstruct';
        this.setWorkletParameter('mode', next, now);
        this.updateWetBodyGain(now);
        return;
      }
      case 'bits': {
        const next = Math.round(clampParameter(value, BITS));
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
        this.bloomFilter.frequency.setTargetAtTime(2800 + next * 7600, now, 0.05);
        this.updateWetBodyGain(now);
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

  private isHardwareMode(): boolean {
    return this.mode === 'sp1200' || this.mode === 'mpc60' || this.mode === 'mirage'
      || this.mode === 's950' || this.mode === 'emulator2' || this.mode === 'fairlightiix';
  }

  private updateWetBodyGain(now: number): void {
    const bloom = this.parameterValues.get('bloom') ?? BLOOM.defaultValue;
    const modeIndex = GRAIN_MODE_ORDER.indexOf(this.mode);
    if (this.isHardwareMode()) {
      this.directGain.gain.setTargetAtTime(1.04, now, 0.04);
      this.bloomGain.gain.setTargetAtTime(0, now, 0.04);
      return;
    }
    const modeGain = [1.10, 1.15, 1.12, 1.08, 1.13, 1.17][modeIndex] ?? 1.10;
    this.directGain.gain.setTargetAtTime(modeGain - bloom * 0.04, now, 0.04);
    this.bloomGain.gain.setTargetAtTime(bloom * 0.46, now, 0.04);
  }

  private setWorkletParameter(name: string, value: number, now: number): void {
    if (this.workletValues.get(name) === value) return;
    const parameter = this.processor.parameters.get(name);
    if (!parameter) throw new Error(`Grain processor parameter "${name}" is unavailable.`);
    this.workletValues.set(name, value);
    parameter.setTargetAtTime(value, now, 0.012);
  }

  public override dispose(): void {
    this.processor.onprocessorerror = null;
    this.processor.port.close();
    this.processor.disconnect();
    this.bloomFilter.disconnect();
    this.bloomDelayL.disconnect();
    this.bloomDelayR.disconnect();
    this.bloomMerge.disconnect();
    this.bloomGain.disconnect();
    this.directGain.disconnect();
    this.workletValues.clear();
    super.dispose();
  }
}
