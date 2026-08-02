import { clampParameter, type ParameterDefinition } from '../Parameter';
import type { PerformanceMode } from '../AudioEngine';
import { BaseEffect } from './Effect';

export const STACK_AMP_MODELS = ['blackface', 'ac30', 'plexi', 'svt', 'model-t', 'calcotone'] as const;
export type StackAmpModel = (typeof STACK_AMP_MODELS)[number];
export const STACK_CABINETS = ['1x12', '2x12', '4x12', '8x10', 'direct'] as const;
export type StackCabinet = (typeof STACK_CABINETS)[number];

const MODEL: ParameterDefinition = { id: 'model', label: 'Amp', min: 0, max: STACK_AMP_MODELS.length - 1, defaultValue: 5, step: 1 };
const CABINET: ParameterDefinition = { id: 'cabinet', label: 'Cabinet', min: 0, max: STACK_CABINETS.length - 1, defaultValue: 2, step: 1 };
const DRIVE: ParameterDefinition = { id: 'drive', label: 'Gain', min: 0, max: 1, defaultValue: 0.36, step: 0.01 };
const TONE: ParameterDefinition = { id: 'tone', label: 'Tone', min: 0, max: 1, defaultValue: 0.52, step: 0.01 };
const SAG: ParameterDefinition = { id: 'sag', label: 'Sag', min: 0, max: 1, defaultValue: 0.34, step: 0.01 };
const MIX: ParameterDefinition = { id: 'mix', label: 'Mix', min: 0, max: 1, defaultValue: 0.62, step: 0.01 };

export class StackAmpEffect extends BaseEffect {
  public readonly id = 'chaos';
  public readonly name = 'STACK';
  private readonly processor: AudioWorkletNode;
  private readonly workletValues = new Map<string, number>();
  private stackDisposed = false;

  public constructor(context: AudioContext) {
    super(context);
    this.processor = new AudioWorkletNode(context, 'calcotone-stack-amp-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    this.processor.onprocessorerror = () => console.error('CALCOTONE STACK AudioWorklet stopped unexpectedly.');
    this.input.connect(this.processor);
    this.processor.connect(this.wetGain);
    this.initializeParameters([MODEL, CABINET, DRIVE, TONE, SAG, MIX]);
    const now = context.currentTime;
    for (const definition of [MODEL, CABINET, DRIVE, TONE, SAG]) {
      this.setWorkletParameter(definition.id, definition.defaultValue, now, definition.step === 1);
    }
    this.setWetDryMix(MIX.defaultValue);
  }

  public setQualityMode(mode: PerformanceMode): void {
    const quality = mode === 'studio' ? 4 : mode === 'balanced' ? 2 : 1;
    this.processor.port.postMessage({ type: 'quality', quality });
  }

  public setParameter(parameterId: string, value: number): void {
    const definition = [MODEL, CABINET, DRIVE, TONE, SAG, MIX].find((candidate) => candidate.id === parameterId);
    if (!definition) {
      console.warn(`Unknown parameter "${parameterId}" for ${this.name}.`);
      return;
    }
    const next = definition.step === 1
      ? Math.round(clampParameter(value, definition))
      : clampParameter(value, definition);
    if (this.parameterValues.get(parameterId) === next) return;
    this.parameterValues.set(parameterId, next);
    if (parameterId === 'mix') {
      this.setWetDryMix(next);
      return;
    }
    this.setWorkletParameter(parameterId, next, this.context.currentTime, definition.step === 1);
  }

  private setWorkletParameter(name: string, value: number, now: number, discrete: boolean): void {
    if (this.workletValues.get(name) === value) return;
    const parameter = this.processor.parameters.get(name);
    if (!parameter) throw new Error(`STACK processor parameter "${name}" is unavailable.`);
    this.workletValues.set(name, value);
    if (discrete) parameter.setValueAtTime(value, now);
    else parameter.setTargetAtTime(value, now, 0.018);
  }

  public override dispose(): void {
    if (this.stackDisposed) return;
    this.stackDisposed = true;
    this.processor.onprocessorerror = null;
    this.processor.port.close();
    this.processor.disconnect();
    this.workletValues.clear();
    super.dispose();
  }
}
