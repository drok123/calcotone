import type { ParameterDefinition, ParameterState } from '../Parameter';
import { normalizeParameter } from '../Parameter';

export interface Effect {
  readonly id: string;
  readonly name: string;
  readonly input: AudioNode;
  readonly output: AudioNode;
  connect(destination: AudioNode): AudioNode;
  disconnect(): void;
  setParameter(parameterId: string, value: number): void;
  getParameter(parameterId: string): ParameterState | undefined;
  getParameters(): ParameterState[];
  setBypassed(bypassed: boolean): void;
  isBypassed(): boolean;
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
  private readonly wetDcBlock: BiquadFilterNode;
  private readonly wetLimiter: DynamicsCompressorNode;

  private readonly bypassDryGain: GainNode;
  private readonly bypassProcessedGain: GainNode;
  private mix = 1;

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
    this.wetDcBlock = context.createBiquadFilter();
    this.wetLimiter = context.createDynamicsCompressor();
    this.bypassDryGain = context.createGain();
    this.bypassProcessedGain = context.createGain();

    this.input.channelCountMode = 'max';
    this.output.channelCountMode = 'max';

    // Mix stage: original dry + protected processed wet.
    this.wetDcBlock.type = 'highpass';
    this.wetDcBlock.frequency.value = 18;
    this.wetDcBlock.Q.value = 0.5;
    this.wetLimiter.threshold.value = -8;
    this.wetLimiter.knee.value = 10;
    this.wetLimiter.ratio.value = 6;
    this.wetLimiter.attack.value = 0.003;
    this.wetLimiter.release.value = 0.12;
    this.input.connect(this.dryGain);
    this.dryGain.connect(this.processedBus);
    this.wetGain.connect(this.wetDcBlock);
    this.wetDcBlock.connect(this.wetLimiter);
    this.wetLimiter.connect(this.processedBus);

    // Independent bypass stage. Bypass never changes the stored wet/dry mix.
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

  public setBypassed(bypassed: boolean): void {
    this.bypassed = bypassed;
    const now = this.context.currentTime;
    const smoothing = 0.028;
    this.bypassDryGain.gain.cancelScheduledValues(now);
    this.bypassProcessedGain.gain.cancelScheduledValues(now);
    this.bypassDryGain.gain.setTargetAtTime(bypassed ? 1 : 0, now, smoothing);
    this.bypassProcessedGain.gain.setTargetAtTime(
      bypassed ? 0 : 1,
      now,
      smoothing
    );
  }

  public isBypassed(): boolean {
    return this.bypassed;
  }

  public getParameter(parameterId: string): ParameterState | undefined {
    const definition = this.parameterDefinitions.find(
      (parameter) => parameter.id === parameterId
    );
    if (!definition) return undefined;
    const value =
      this.parameterValues.get(parameterId) ?? definition.defaultValue;
    return {
      ...definition,
      value,
      normalizedValue: normalizeParameter(value, definition),
    };
  }

  public getParameters(): ParameterState[] {
    return this.parameterDefinitions.map((definition) => {
      const value =
        this.parameterValues.get(definition.id) ?? definition.defaultValue;
      return {
        ...definition,
        value,
        normalizedValue: normalizeParameter(value, definition),
      };
    });
  }

  public abstract setParameter(parameterId: string, value: number): void;

  public dispose(): void {
    this.input.disconnect();
    this.output.disconnect();
    this.dryGain.disconnect();
    this.wetGain.disconnect();
    this.processedBus.disconnect();
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
    for (const definition of definitions)
      this.parameterValues.set(definition.id, definition.defaultValue);
  }
}
