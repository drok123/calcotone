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

type DedicatedHardware = 'bbd' | 'tape' | 'converter' | null;

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
  private bbdStage: BBDStage | null = null;
  private tapeStage: TapeTransportStage | null = null;
  private converterStage: EarlyConverterStage | null = null;
  private springStage: SpringTankStage | null = null;
  private activeDedicatedHardware: DedicatedHardware = null;
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

    // Default wet path is intentionally small. Specialty hardware is created only
    // for modes that actually need it, rather than keeping BBD/tape/converter/spring
    // networks alive inside every effect instance.
    this.wetGain.connect(this.behaviorStage.input);
    this.behaviorStage.connect(this.wetDcBlock);
    this.wetDcBlock.connect(this.wetLimiter);
    this.wetLimiter.connect(this.processedBus);

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

  private rebuildHardwarePath(): void {
    if (this.disposed) return;

    // This is called only when the selected physical hardware family changes.
    // Normal parameter motion never reconnects the audio graph.
    try { this.wetGain.disconnect(); } catch { /* already disconnected */ }
    try { this.bbdStage?.output.disconnect(); } catch { /* already disconnected */ }
    try { this.tapeStage?.output.disconnect(); } catch { /* already disconnected */ }
    try { this.converterStage?.output.disconnect(); } catch { /* already disconnected */ }
    try { this.springStage?.output.disconnect(); } catch { /* already disconnected */ }

    let source: AudioNode = this.wetGain;
    if (this.activeDedicatedHardware === 'bbd' && this.bbdStage) {
      source.connect(this.bbdStage.input);
      source = this.bbdStage.output;
    } else if (this.activeDedicatedHardware === 'tape' && this.tapeStage) {
      source.connect(this.tapeStage.input);
      source = this.tapeStage.output;
    } else if (this.activeDedicatedHardware === 'converter' && this.converterStage) {
      source.connect(this.converterStage.input);
      source = this.converterStage.output;
    }

    if (this.springStage) {
      source.connect(this.springStage.input);
      source = this.springStage.output;
    }

    source.connect(this.behaviorStage.input);
  }

  private selectDedicatedHardware(next: DedicatedHardware): void {
    if (this.activeDedicatedHardware === next) return;

    if (next !== 'bbd' && this.bbdStage) {
      this.bbdStage.dispose();
      this.bbdStage = null;
    }
    if (next !== 'tape' && this.tapeStage) {
      this.tapeStage.dispose();
      this.tapeStage = null;
    }
    if (next !== 'converter' && this.converterStage) {
      this.converterStage.dispose();
      this.converterStage = null;
    }

    if (next === 'bbd' && !this.bbdStage) {
      this.bbdStage = new BBDStage(this.context);
      this.bbdStage.setEnabled(true);
    }
    if (next === 'tape' && !this.tapeStage) {
      this.tapeStage = new TapeTransportStage(this.context);
      this.tapeStage.setEnabled(true);
    }
    if (next === 'converter' && !this.converterStage) {
      this.converterStage = new EarlyConverterStage(this.context);
      this.converterStage.setEnabled(true);
    }

    this.activeDedicatedHardware = next;
    this.rebuildHardwarePath();
  }

  public configureBehavior(
    profile: BehaviorMemoryProfile,
    amount: number,
    motion: number,
    memory: number,
    color: number,
  ): void {
    if (this.bypassed && profile !== 'bypass') return;
    const dedicated: DedicatedHardware = profile === 'charge'
      ? 'bbd'
      : profile === 'magnetic' || profile === 'transport'
        ? 'tape'
        : profile === 'converter'
          ? 'converter'
          : null;

    this.selectDedicatedHardware(dedicated);
    this.behaviorStage.configure(dedicated ? 'bypass' : profile, amount, motion, memory, color);

    if (dedicated === 'bbd' && this.bbdStage) {
      const virtualDelaySeconds = 0.008 + memory * 0.48;
      this.bbdStage.configure(virtualDelaySeconds, amount, color, motion);
    } else if (dedicated === 'tape' && this.tapeStage) {
      const speed = Math.max(0, Math.min(1, 0.72 + color * 0.22 - motion * 0.08));
      this.tapeStage.configure(speed, motion, color, amount);
    } else if (dedicated === 'converter' && this.converterStage) {
      const bits = 9 + (1 - amount) * 5;
      this.converterStage.configure(bits, color, amount);
    }
  }

  public configureSpringHardware(enabled: boolean, decay: number, size: number, color: number, drive: number): void {
    if (this.bypassed && enabled) return;
    if (enabled) {
      if (!this.springStage) {
        this.springStage = new SpringTankStage(this.context);
        this.springStage.setEnabled(true);
        this.rebuildHardwarePath();
      }
      this.springStage.configure(decay, size, color, drive);
      return;
    }

    if (this.springStage) {
      this.springStage.dispose();
      this.springStage = null;
      this.rebuildHardwarePath();
    }
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
    this.bbdStage?.dispose();
    this.bbdStage = null;
    this.tapeStage?.dispose();
    this.tapeStage = null;
    this.converterStage?.dispose();
    this.converterStage = null;
    this.springStage?.dispose();
    this.springStage = null;
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
