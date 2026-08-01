const workletLoads = new WeakMap<AudioContext, Promise<void>>();
const WORKLET_VERSION = '1.0.0-tpt-ada-lut';

async function ensureWorklet(context: AudioContext): Promise<void> {
  const existing = workletLoads.get(context);
  if (existing) return existing;
  const promise = (async () => {
    if (!context.audioWorklet || typeof window === 'undefined') {
      throw new Error('AudioWorklet is unavailable for the CALCOTONE analog signal chain.');
    }
    const moduleUrl = new URL(
      `${import.meta.env.BASE_URL}analog-signal-chain-processor.js?v=${WORKLET_VERSION}`,
      window.location.origin,
    ).toString();
    await context.audioWorklet.addModule(moduleUrl);
  })();
  workletLoads.set(context, promise);
  return promise;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

export interface AnalogSignalChainSettings {
  inputGain: number;
  drive: number;
  asymmetry: number;
  shapeMode: 'ada' | 'lut';
  cutoffHz: number;
  dcCutoffHz: number;
  outputGain: number;
}

export class AnalogSignalChainStage {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private readonly context: AudioContext;
  private readonly bypassGain: GainNode;
  private readonly processedGain: GainNode;
  private processor: AudioWorkletNode | null = null;
  private initializePromise: Promise<void> | null = null;
  private enabled = false;
  private disposed = false;
  private settings: AnalogSignalChainSettings = {
    inputGain: 1,
    drive: 1,
    asymmetry: 0,
    shapeMode: 'ada',
    cutoffHz: 18_000,
    dcCutoffHz: 12,
    outputGain: 1,
  };

  public constructor(context: AudioContext) {
    this.context = context;
    this.input = context.createGain();
    this.output = context.createGain();
    this.bypassGain = context.createGain();
    this.processedGain = context.createGain();
    this.input.connect(this.bypassGain);
    this.bypassGain.connect(this.output);
    this.processedGain.connect(this.output);
    this.bypassGain.gain.value = 1;
    this.processedGain.gain.value = 0;
  }

  public connect(destination: AudioNode): void {
    this.output.connect(destination);
  }

  public disconnect(): void {
    this.output.disconnect();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled && !this.processor) void this.ensureProcessor();
    this.syncRouting();
  }

  public configure(settings: Partial<AnalogSignalChainSettings>): void {
    this.settings = { ...this.settings, ...settings };
    if (this.enabled && !this.processor) void this.ensureProcessor();
    this.syncParameters();
  }

  public setLookupTable(values: Float32Array): void {
    if (values.length < 16) throw new Error('Analog signal-chain LUT requires at least 16 samples.');
    this.processor?.port.postMessage({ type: 'lut', values }, [values.buffer]);
  }

  public reset(): void {
    this.processor?.port.postMessage({ type: 'reset' });
  }

  public dispose(): void {
    this.disposed = true;
    this.processor?.disconnect();
    this.input.disconnect();
    this.bypassGain.disconnect();
    this.processedGain.disconnect();
    this.output.disconnect();
    this.processor = null;
  }

  private async ensureProcessor(): Promise<void> {
    if (this.processor || this.disposed) return;
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = (async () => {
      try {
        await ensureWorklet(this.context);
        if (this.disposed || this.processor) return;
        const processor = new AudioWorkletNode(this.context, 'calcotone-analog-signal-chain-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 2,
          channelCountMode: 'explicit',
          channelInterpretation: 'speakers',
        });
        processor.onprocessorerror = () => console.error('CALCOTONE analog signal-chain AudioWorklet stopped unexpectedly.');
        this.processor = processor;
        this.input.connect(processor);
        processor.connect(this.processedGain);
        this.syncParameters();
        this.syncRouting();
      } catch (error) {
        console.warn('CALCOTONE analog signal chain could not initialize; bypass remains active.', error);
      } finally {
        this.initializePromise = null;
      }
    })();
    return this.initializePromise;
  }

  private syncRouting(): void {
    const now = this.context.currentTime;
    const active = this.enabled && this.processor !== null;
    this.bypassGain.gain.setTargetAtTime(active ? 0 : 1, now, 0.015);
    this.processedGain.gain.setTargetAtTime(active ? 1 : 0, now, 0.015);
  }

  private syncParameters(): void {
    if (!this.processor) return;
    const now = this.context.currentTime;
    const set = (name: string, value: number) => this.processor?.parameters.get(name)?.setTargetAtTime(value, now, 0.012);
    set('inputGain', clamp(this.settings.inputGain, 0, 8));
    set('drive', clamp(this.settings.drive, 1, 12));
    set('asymmetry', clamp(this.settings.asymmetry, -0.25, 0.25));
    set('shapeMode', this.settings.shapeMode === 'lut' ? 1 : 0);
    set('cutoff', clamp(this.settings.cutoffHz, 10, this.context.sampleRate * 0.475));
    set('dcCutoff', clamp(this.settings.dcCutoffHz, 2, 80));
    set('outputGain', clamp(this.settings.outputGain, 0, 2));
  }
}
