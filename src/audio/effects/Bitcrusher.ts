import { clampParameter, type ParameterDefinition } from '../Parameter';
import type { PerformanceMode } from '../AudioEngine';
import { BaseEffect } from './Effect';

export type GrainMode = 'reconstruct' | 'shatter' | 'smear' | 'prism' | 'stutter' | 'ruin';
export const GRAIN_MODE_ORDER: GrainMode[] = ['reconstruct','shatter','smear','prism','stutter','ruin'];

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

/**
 * Grain Dissector runs its reconstruction kernel in an AudioWorklet so the
 * browser main thread can render CALCOTONE's interface without interrupting audio.
 */
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

    this.processor.onprocessorerror = () => {
      console.error('CALCOTONE Grain AudioWorklet stopped unexpectedly.');
    };

    this.initializeParameters([MODE, BITS, DENSITY, PITCH, CHAOS, BLOOM, MIX]);
    this.setParameter('mode', MODE.defaultValue);
    this.setParameter('bits', BITS.defaultValue);
    this.setParameter('density', DENSITY.defaultValue);
    this.setParameter('pitch', PITCH.defaultValue);
    this.setParameter('chaos', CHAOS.defaultValue);
    this.setParameter('bloom', BLOOM.defaultValue);
    this.setParameter('mix', MIX.defaultValue);
  }

  public getProfilerStats(): GrainProfilerStats {
    return { ...this.profilerStats };
  }

  public setQualityMode(mode: PerformanceMode): void {
    const maxVoices = mode === 'studio' ? 8 : mode === 'balanced' ? 6 : 4;
    this.processor.port.postMessage({ type: 'quality', maxVoices });
  }

  public setParameter(parameterId: string, value: number): void {
    const now = this.context.currentTime;
    switch (parameterId) {
      case 'mode': {
        const next = Math.round(clampParameter(value, MODE));
        this.parameterValues.set(parameterId, next);
        this.setWorkletParameter('mode', next, now);
        this.updateWetBodyGain(now);
        break;
      }
      case 'bits': {
        const next = Math.round(clampParameter(value, BITS));
        this.parameterValues.set(parameterId, next);
        this.setWorkletParameter('bits', next, now);
        break;
      }
      case 'density': {
        const next = clampParameter(value, DENSITY);
        this.parameterValues.set(parameterId, next);
        this.setWorkletParameter('density', next, now);
        break;
      }
      case 'pitch': {
        const next = clampParameter(value, PITCH);
        this.parameterValues.set(parameterId, next);
        this.setWorkletParameter('pitch', next, now);
        break;
      }
      case 'chaos': {
        const next = clampParameter(value, CHAOS);
        this.parameterValues.set(parameterId, next);
        this.setWorkletParameter('chaos', next, now);
        break;
      }
      case 'bloom': {
        const next = clampParameter(value, BLOOM);
        this.parameterValues.set(parameterId, next);
        this.bloomGain.gain.setTargetAtTime(next * 0.46, now, 0.04);
        this.updateWetBodyGain(now);
        this.bloomFilter.frequency.setTargetAtTime(2800 + next * 7600, now, 0.05);
        break;
      }
      case 'mix': {
        const next = clampParameter(value, MIX);
        this.parameterValues.set(parameterId, next);
        this.setWetDryMix(next);
        break;
      }
      default:
        console.warn(`Unknown parameter "${parameterId}" for ${this.name}.`);
    }
  }

  private updateWetBodyGain(now: number): void {
    const bloom = this.parameterValues.get('bloom') ?? BLOOM.defaultValue;
    const mode = Math.round(this.parameterValues.get('mode') ?? MODE.defaultValue);
    // Grain-owned compensation only: survives HMR because it does not depend on
    // a newly-added BaseEffect prototype method.
    const modeGain = [1.10, 1.15, 1.12, 1.08, 1.13, 1.17][mode] ?? 1.10;
    const direct = modeGain - bloom * 0.04;
    this.directGain.gain.setTargetAtTime(direct, now, 0.04);
  }

  private setWorkletParameter(name: string, value: number, now: number): void {
    const parameter = this.processor.parameters.get(name);
    if (!parameter) {
      throw new Error(`Grain processor parameter "${name}" is unavailable.`);
    }
    parameter.cancelScheduledValues(now);
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
    super.dispose();
  }
}
