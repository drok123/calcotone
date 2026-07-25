export type TubeColorModel =
  | 'bypass'
  | 'goldlion'
  | 'mullard'
  | 'telefunken'
  | 'bugleboy'
  | 'rcablack';

export const TUBE_COLOR_MODEL_ORDER: readonly TubeColorModel[] = [
  'bypass',
  'goldlion',
  'mullard',
  'telefunken',
  'bugleboy',
  'rcablack',
];

const MODEL_INDEX: Record<TubeColorModel, number> = {
  bypass: 0,
  goldlion: 1,
  mullard: 2,
  telefunken: 3,
  bugleboy: 4,
  rcablack: 5,
};

const tubeWorkletLoads = new WeakMap<AudioContext, Promise<void>>();
const TUBE_WORKLET_VERSION = '9.1.3-full-suspend';

async function ensureTubeWorklet(context: AudioContext): Promise<void> {
  const existing = tubeWorkletLoads.get(context);
  if (existing) return existing;

  const promise = (async () => {
    if (!context.audioWorklet || typeof window === 'undefined') {
      throw new Error('AudioWorklet is unavailable for the CALCOTONE tube coloration stage.');
    }
    const moduleUrl = new URL(
      `${import.meta.env.BASE_URL}ember-tube-processor.js?v=${TUBE_WORKLET_VERSION}`,
      window.location.origin,
    ).toString();
    await context.audioWorklet.addModule(moduleUrl);
  })();

  tubeWorkletLoads.set(context, promise);
  return promise;
}

/** Reusable small-signal tube coloration stage. */
export class TubeColorStage {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private readonly context: AudioContext;
  private readonly bypassGain: GainNode;
  private readonly processedGain: GainNode;
  private processor: AudioWorkletNode | null = null;
  private processorConnected = false;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private quality = 2;
  private model: TubeColorModel = 'bypass';
  private drive = 0.14;
  private heat = 0.18;
  private character = 0.22;
  private dynamics = 0.38;
  private readonly values = new Map<string, number>();

  public constructor(context: AudioContext) {
    this.context = context;
    this.input = context.createGain();
    this.output = context.createGain();
    this.bypassGain = context.createGain();
    this.processedGain = context.createGain();

    this.bypassGain.gain.value = 1;
    this.processedGain.gain.value = 0;
    this.input.connect(this.bypassGain);
    this.bypassGain.connect(this.output);
    this.processedGain.connect(this.output);

    void this.initialize();
  }

  public connect(destination: AudioNode): void {
    this.output.connect(destination);
  }

  public setModel(model: TubeColorModel): void {
    if (this.model === model) return;
    this.model = model;
    this.syncModel();
  }

  public setParameters(drive: number, heat: number, character: number, dynamics: number): void {
    this.drive = clamp01(drive);
    this.heat = clamp01(heat);
    this.character = clamp01(character);
    this.dynamics = clamp01(dynamics);
    this.syncParameters();
  }

  public setQuality(factor: number): void {
    const next = factor >= 4 ? 4 : 2;
    if (this.quality === next) return;
    this.quality = next;
    this.processor?.port.postMessage({ type: 'quality', factor: this.quality });
  }

  private async initialize(): Promise<void> {
    try {
      await ensureTubeWorklet(this.context);
      if (this.disposed) return;

      const processor = new AudioWorkletNode(this.context, 'calcotone-ember-tube-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      processor.onprocessorerror = () => {
        console.error('CALCOTONE tube coloration AudioWorklet stopped unexpectedly.');
      };
      processor.port.postMessage({ type: 'quality', factor: this.quality });
      this.processor = processor;
      this.syncParameters();
      this.syncModel();
    } catch (error) {
      console.warn('CALCOTONE tube coloration stage could not initialize; dry fallback remains active.', error);
    }
  }

  private connectProcessor(): void {
    if (!this.processor || this.processorConnected || this.disposed) return;
    this.processor.port.postMessage({ type: 'reset' });
    this.input.connect(this.processor);
    this.processor.connect(this.processedGain);
    this.processorConnected = true;
  }

  private disconnectProcessor(): void {
    if (!this.processor || !this.processorConnected) return;
    try { this.input.disconnect(this.processor); } catch { /* already disconnected */ }
    try { this.processor.disconnect(this.processedGain); } catch { /* already disconnected */ }
    this.processorConnected = false;
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer === null) return;
    clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
  }

  private syncModel(): void {
    const now = this.context.currentTime;
    const modelIndex = MODEL_INDEX[this.model];
    const processed = Boolean(this.processor && modelIndex > 0);

    this.clearDisconnectTimer();
    if (processed) this.connectProcessor();
    this.setProcessorParameter('model', modelIndex, now, true);
    this.bypassGain.gain.setTargetAtTime(processed ? 0 : 1, now, 0.018);
    this.processedGain.gain.setTargetAtTime(processed ? 1 : 0, now, 0.018);

    if (!processed && this.processorConnected) {
      this.disconnectTimer = setTimeout(() => {
        this.disconnectTimer = null;
        if (!this.disposed && this.model === 'bypass') this.disconnectProcessor();
      }, 72);
    }
  }

  private syncParameters(): void {
    const now = this.context.currentTime;
    this.setProcessorParameter('drive', this.drive, now);
    this.setProcessorParameter('heat', this.heat, now);
    this.setProcessorParameter('character', this.character, now);
    this.setProcessorParameter('dynamics', this.dynamics, now);
  }

  private setProcessorParameter(name: string, value: number, now: number, discrete = false): void {
    if (this.values.get(name) === value) return;
    const parameter = this.processor?.parameters.get(name);
    if (!parameter) return;
    this.values.set(name, value);
    if (discrete) parameter.setValueAtTime(value, now);
    else parameter.setTargetAtTime(value, now, 0.012);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearDisconnectTimer();
    this.disconnectProcessor();
    if (this.processor) {
      this.processor.onprocessorerror = null;
      this.processor.port.close();
      this.processor.disconnect();
      this.processor = null;
    }
    this.values.clear();
    this.input.disconnect();
    this.output.disconnect();
    this.bypassGain.disconnect();
    this.processedGain.disconnect();
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
