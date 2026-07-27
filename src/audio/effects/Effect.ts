import type { ParameterDefinition, ParameterState } from '../Parameter';
import { normalizeParameter } from '../Parameter';
import { BehaviorMemoryStage, type BehaviorMemoryProfile } from '../models/BehaviorMemoryStage';
import { BBDStage } from '../models/BBDStage';
import { TapeTransportStage } from '../models/TapeTransportStage';
import { EarlyConverterStage } from '../models/EarlyConverterStage';
import { SpringTankStage } from '../models/SpringTankStage';

export interface Effect {
  readonly id: string;
  readonly name: string;
  readonly input: AudioNode;
  readonly output: AudioNode;
  connect(destination: AudioNode): AudioNode;
  disconnect(): void;
  setParameter(parameterId: string, value: number): void;
  getParameter(parameterId: string): ParameterState | undefined;
  getParameterValue(parameterId: string): number | undefined;
  getNormalizedParameterValue(parameterId: string): number | undefined;
  getParameters(): ParameterState[];
  setBypassed(bypassed: boolean): void;
  isBypassed(): boolean;
  isProcessingSuspended(): boolean;
  setRoutingInvalidator(callback: (() => void) | null): void;
  configureBehavior(profile: BehaviorMemoryProfile, amount: number, motion: number, memory: number, color: number): void;
  configureSpringHardware(enabled: boolean, decay: number, size: number, color: number, drive: number): void;
  dispose(): void;
}

export abstract class BaseEffect implements Effect {
  public abstract readonly id: string;
  public abstract readonly name: string;
  public readonly input: GainNode;
  public readonly output: GainNode;

  protected readonly context: AudioContext;
  protected readonly dryGain: GainNode;
  protected readonly wetGain: GainNode;
  protected readonly processedBus: GainNode;
  private readonly behaviorStage: BehaviorMemoryStage;
  private readonly bbdStage: BBDStage;
  private readonly tapeStage: TapeTransportStage;
  private readonly converterStage: EarlyConverterStage;
  private readonly springStage: SpringTankStage;
  private readonly wetDcBlock: BiquadFilterNode;
  private readonly wetLimiter: DynamicsCompressorNode;

  private readonly bypassDryGain: GainNode;
  private readonly bypassProcessedGain: GainNode;
  private mix = 1;
  private routingInvalidator: (() => void) | null = null;
  private processingSuspended = false;
  private bypassSuspendTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  protected bypassed = false;
  protected parameterDefinitions: ParameterDefinition[] = [];
  protected parameterValues = new Map<string, number>();

  protected constructor(context: AudioContext) {
    this.context = context;
    this.input = context.createGain();
    this.output = context.createGain();
    this.dryGain = context.createGain();
    this.wetGain = context.createGain();
    this.processedBus = context.createGain();
    this.behaviorStage = new BehaviorMemoryStage(context);
    this.bbdStage = new BBDStage(context);
    this.tapeStage = new TapeTransportStage(context);
    this.converterStage = new EarlyConverterStage(context);
    this.springStage = new SpringTankStage(context);
    this.wetDcBlock = context.createBiquadFilter();
    this.wetLimiter = context.createDynamicsCompressor();
    this.bypassDryGain = context.createGain();
    this.bypassProcessedGain = context.createGain();

    this.input.channelCountMode = 'max';
    this.output.channelCountMode = 'max';

    this.wetDcBlock.type = 'highpass';
    this.wetDcBlock.frequency.value = 18;
    this.wetDcBlock.Q.value = 0.5;
    this.wetLimiter.threshold.value = -0.5;
    this.wetLimiter.knee.value = 0.5;
    this.wetLimiter.ratio.value = 20;
    this.wetLimiter.attack.value = 0.001;
    this.wetLimiter.release.value = 0.06;
    this.input.connect(this.dryGain);
    this.dryGain.connect(this.processedBus);

    // Shared hardware mechanism chain. Inactive stages gate their process inputs,
    // so bypassed mechanisms are effectively free apart from a few gain nodes.
    this.wetGain.connect(this.bbdStage.input);
    this.bbdStage.connect(this.tapeStage.input);
    this.tapeStage.connect(this.converterStage.input);
    this.converterStage.connect(this.springStage.input);
    this.springStage.connect(this.behaviorStage.input);
    this.behaviorStage.connect(this.wetDcBlock);
    this.wetDcBlock.connect(this.wetLimiter);
    this.wetLimiter.connect(this.processedBus);

    this.bbdStage.setEnabled(false);
    this.tapeStage.setEnabled(false);
    this.converterStage.setEnabled(false);
    this.springStage.setEnabled(false);

    this.input.connect(this.bypassDryGain);
    this.processedBus.connect(this.bypassProcessedGain);
    this.bypassDryGain.connect(this.output);
    this.bypassProcessedGain.connect(this.output);

    this.bypassDryGain.gain.value = 0;
    this.bypassProcessedGain.gain.value = 1;
    this.setWetDryMix(1);
  }

  public connect(destination: AudioNode): AudioNode {
    return this.output.connect(destination);
  }

  public disconnect(): void {
    this.output.disconnect();
  }

  public setRoutingInvalidator(callback: (() => void) | null): void {
    this.routingInvalidator = callback;
  }

  public setBypassed(bypassed: boolean): void {
    if (this.disposed) return;
    const now = this.context.currentTime;
    const smoothing = 0.028;

    if (this.bypassSuspendTimer !== null) {
      clearTimeout(this.bypassSuspendTimer);
      this.bypassSuspendTimer = null;
    }

    if (bypassed && this.routingInvalidator === null) {
      this.bypassed = true;
      this.processingSuspended = true;
      this.bypassDryGain.gain.cancelScheduledValues(now);
      this.bypassProcessedGain.gain.cancelScheduledValues(now);
      this.bypassDryGain.gain.setValueAtTime(1, now);
      this.bypassProcessedGain.gain.setValueAtTime(0, now);
      return;
    }

    if (!bypassed && this.processingSuspended) {
      this.processingSuspended = false;
      this.routingInvalidator?.();
    }

    this.bypassed = bypassed;
    this.bypassDryGain.gain.cancelScheduledValues(now);
    this.bypassProcessedGain.gain.cancelScheduledValues(now);
    this.bypassDryGain.gain.setTargetAtTime(bypassed ? 1 : 0, now, smoothing);
    this.bypassProcessedGain.gain.setTargetAtTime(bypassed ? 0 : 1, now, smoothing);

    if (bypassed && !this.processingSuspended) {
      this.bypassSuspendTimer = setTimeout(() => {
        this.bypassSuspendTimer = null;
        if (this.disposed || !this.bypassed || this.processingSuspended) return;
        this.processingSuspended = true;
        this.routingInvalidator?.();
      }, 120);
    }
  }

  public isBypassed(): boolean {
    return this.bypassed;
  }

  public isProcessingSuspended(): boolean {
    return this.processingSuspended;
  }

  public getParameter(parameterId: string): ParameterState | undefined {
    const definition = this.parameterDefinitions.find((parameter) => parameter.id === parameterId);
    if (!definition) return undefined;
    const value = this.parameterValues.get(parameterId) ?? definition.defaultValue;
    return { ...definition, value, normalizedValue: normalizeParameter(value, definition) };
  }

  public getParameterValue(parameterId: string): number | undefined {
    return this.parameterValues.get(parameterId);
  }

  public getNormalizedParameterValue(parameterId: string): number | undefined {
    const definition = this.parameterDefinitions.find((parameter) => parameter.id === parameterId);
    if (!definition) return undefined;
    const value = this.parameterValues.get(parameterId) ?? definition.defaultValue;
    return normalizeParameter(value, definition);
  }

  public getParameters(): ParameterState[] {
    return this.parameterDefinitions.map((definition) => {
      const value = this.parameterValues.get(definition.id) ?? definition.defaultValue;
      return { ...definition, value, normalizedValue: normalizeParameter(value, definition) };
    });
  }

  public configureBehavior(
    profile: BehaviorMemoryProfile,
    amount: number,
    motion: number,
    memory: number,
    color: number,
  ): void {
    const bbd = profile === 'charge';
    const tape = profile === 'magnetic' || profile === 'transport';
    const converter = profile === 'converter';
    const dedicatedHardware = bbd || tape || converter;

    // Once a real mechanism owns the profile, the old generic residual must get out
    // of the way or the sound is effectively modeled twice.
    this.behaviorStage.configure(dedicatedHardware ? 'bypass' : profile, amount, motion, memory, color);

    this.bbdStage.setEnabled(bbd);
    this.tapeStage.setEnabled(tape);
    this.converterStage.setEnabled(converter);

    if (bbd) {
      const virtualDelaySeconds = 0.008 + memory * 0.48;
      this.bbdStage.configure(virtualDelaySeconds, amount, color, motion);
    }
    if (tape) {
      const speed = Math.max(0, Math.min(1, 0.72 + color * 0.22 - motion * 0.08));
      this.tapeStage.configure(speed, motion, color, amount);
    }
    if (converter) {
      const bits = 9 + (1 - amount) * 5;
      this.converterStage.configure(bits, color, amount);
    }
  }

  public configureSpringHardware(enabled: boolean, decay: number, size: number, color: number, drive: number): void {
    this.springStage.setEnabled(enabled);
    if (enabled) this.springStage.configure(decay, size, color, drive);
  }

  public abstract setParameter(parameterId: string, value: number): void;

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.bypassSuspendTimer !== null) {
      clearTimeout(this.bypassSuspendTimer);
      this.bypassSuspendTimer = null;
    }
    this.routingInvalidator = null;
    this.input.disconnect();
    this.output.disconnect();
    this.dryGain.disconnect();
    this.wetGain.disconnect();
    this.processedBus.disconnect();
    this.bbdStage.dispose();
    this.tapeStage.dispose();
    this.converterStage.dispose();
    this.springStage.dispose();
    this.behaviorStage.dispose();
    this.wetDcBlock.disconnect();
    this.wetLimiter.disconnect();
    this.bypassDryGain.disconnect();
    this.bypassProcessedGain.disconnect();
    this.parameterValues.clear();
  }

  protected setWetDryMix(mix: number): void {
    this.mix = Math.min(1, Math.max(0, mix));
    const now = this.context.currentTime;
    const dry = Math.cos(this.mix * 0.5 * Math.PI);
    const wet = Math.sin(this.mix * 0.5 * Math.PI);
    this.dryGain.gain.setTargetAtTime(dry, now, 0.025);
    this.wetGain.gain.setTargetAtTime(wet, now, 0.025);
  }

  protected initializeParameters(definitions: ParameterDefinition[]): void {
    this.parameterDefinitions = definitions;
    for (const definition of definitions) this.parameterValues.set(definition.id, definition.defaultValue);
  }
}
