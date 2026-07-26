export type DriftClassicModel = 'bypass' | 'biphase' | 'smallstone' | 'univibe' | 'leslie';

const MODEL_INDEX: Record<DriftClassicModel, number> = {
  bypass: 0,
  biphase: 1,
  smallstone: 2,
  univibe: 3,
  leslie: 4,
};

const workletLoads = new WeakMap<AudioContext, Promise<void>>();
const WORKLET_VERSION = '1.0.2-wet-only';

async function ensureWorklet(context: AudioContext): Promise<void> {
  const existing = workletLoads.get(context);
  if (existing) return existing;
  const promise = (async () => {
    if (!context.audioWorklet || typeof window === 'undefined') {
      throw new Error('AudioWorklet is unavailable for the CALCOTONE Drift classic stage.');
    }
    const moduleUrl = new URL(
      `${import.meta.env.BASE_URL}drift-classic-processor.js?v=${WORKLET_VERSION}`,
      window.location.origin,
    ).toString();
    await context.audioWorklet.addModule(moduleUrl);
  })();
  workletLoads.set(context, promise);
  return promise;
}

export class DriftClassicStage {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private readonly context: AudioContext;
  private readonly bypassGain: GainNode;
  private readonly processedGain: GainNode;
  private processor: AudioWorkletNode | null = null;
  private connected = false;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private model: DriftClassicModel = 'bypass';
  private rate = 0.28;
  private depth = 0.275;
  private shape = 0.35;
  private spread = 0.62;
  private motion = 0.32;
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

  public configure(model: DriftClassicModel, rate: number, depth: number, shape: number, spread: number, motion: number): void {
    const modelChanged = this.model !== model;
    this.model = model;
    this.rate = clamp01(rate);
    this.depth = clamp01(depth);
    this.shape = clamp01(shape);
    this.spread = clamp01(spread);
    this.motion = clamp01(motion);
    if (modelChanged && this.processor && this.connected && model !== 'bypass') {
      this.processor.port.postMessage({ type: 'reset' });
    }
    this.sync();
  }

  private async initialize(): Promise<void> {
    try {
      await ensureWorklet(this.context);
      if (this.disposed) return;
      const processor = new AudioWorkletNode(this.context, 'calcotone-drift-classic-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      processor.onprocessorerror = () => console.error('CALCOTONE Drift classic AudioWorklet stopped unexpectedly.');
      this.processor = processor;
      this.sync();
    } catch (error) {
      console.warn('CALCOTONE Drift classic stage could not initialize; dry fallback remains active.', error);
    }
  }

  private connectProcessor(): void {
    if (!this.processor || this.connected || this.disposed) return;
    this.processor.port.postMessage({ type: 'reset' });
    this.input.connect(this.processor);
    this.processor.connect(this.processedGain);
    this.connected = true;
  }

  private disconnectProcessor(): void {
    if (!this.processor || !this.connected) return;
    try { this.input.disconnect(this.processor); } catch { /* already disconnected */ }
    try { this.processor.disconnect(this.processedGain); } catch { /* already disconnected */ }
    this.connected = false;
  }

  private clearTimer(): void {
    if (this.disconnectTimer === null) return;
    clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
  }

  private sync(): void {
    const now = this.context.currentTime;
    const enabled = Boolean(this.processor && this.model !== 'bypass');
    this.clearTimer();
    if (enabled) this.connectProcessor();

    this.bypassGain.gain.setTargetAtTime(enabled ? 0 : 1, now, 0.018);
    this.processedGain.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.018);
    this.setParameter('model', MODEL_INDEX[this.model], now, true);
    this.setParameter('rate', this.rate, now);
    this.setParameter('depth', this.depth, now);
    this.setParameter('shape', this.shape, now);
    this.setParameter('spread', this.spread, now);
    this.setParameter('motion', this.motion, now);

    if (!enabled && this.connected) {
      this.disconnectTimer = setTimeout(() => {
        this.disconnectTimer = null;
        if (!this.disposed && this.model === 'bypass') this.disconnectProcessor();
      }, 72);
    }
  }

  private setParameter(name: string, value: number, now: number, discrete = false): void {
    if (this.values.get(name) === value) return;
    const parameter = this.processor?.parameters.get(name);
    if (!parameter) return;
    this.values.set(name, value);
    if (discrete) parameter.setValueAtTime(value, now);
    else parameter.setTargetAtTime(value, now, 0.018);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
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
