export type BehaviorMemoryProfile =
  | 'bypass'
  | 'elastic'
  | 'rotor'
  | 'fluid'
  | 'orbital'
  | 'charge'
  | 'magnetic'
  | 'acoustic'
  | 'granular'
  | 'transport'
  | 'console'
  | 'converter'
  | 'fracture';

const PROFILE_INDEX: Record<BehaviorMemoryProfile, number> = {
  bypass: 0,
  elastic: 1,
  rotor: 2,
  fluid: 3,
  orbital: 4,
  charge: 5,
  magnetic: 6,
  acoustic: 7,
  granular: 8,
  transport: 9,
  console: 10,
  converter: 11,
  fracture: 12,
};

const workletLoads = new WeakMap<AudioContext, Promise<void>>();
const WORKLET_VERSION = '1.1.0-deep-physical-memory';

async function ensureWorklet(context: AudioContext): Promise<void> {
  const existing = workletLoads.get(context);
  if (existing) return existing;
  const promise = (async () => {
    if (!context.audioWorklet || typeof window === 'undefined') {
      throw new Error('AudioWorklet is unavailable for the CALCOTONE physical behavior stage.');
    }
    const moduleUrl = new URL(
      `${import.meta.env.BASE_URL}behavior-memory-processor.js?v=${WORKLET_VERSION}`,
      window.location.origin,
    ).toString();
    await context.audioWorklet.addModule(moduleUrl);
  })();
  workletLoads.set(context, promise);
  return promise;
}

/**
 * Small stateful residual stage used to give otherwise mathematical algorithms
 * physical memory. Profiles are behavioral studies, not calibrated component models.
 * The stage stays dry-safe while its AudioWorklet loads and fully removes bypassed
 * processors from the live render graph after their crossfade completes.
 */
export class BehaviorMemoryStage {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private readonly context: AudioContext;
  private readonly bypassGain: GainNode;
  private readonly processedGain: GainNode;
  private processor: AudioWorkletNode | null = null;
  private processorConnected = false;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private profile: BehaviorMemoryProfile = 'bypass';
  private amount = 0;
  private motion = 0.3;
  private memory = 0.4;
  private color = 0.5;
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

  public configure(
    profile: BehaviorMemoryProfile,
    amount: number,
    motion: number,
    memory: number,
    color: number,
  ): void {
    this.profile = profile;
    this.amount = clamp01(amount);
    this.motion = clamp01(motion);
    this.memory = clamp01(memory);
    this.color = clamp01(color);
    this.sync();
  }

  private async initialize(): Promise<void> {
    try {
      await ensureWorklet(this.context);
      if (this.disposed) return;
      const processor = new AudioWorkletNode(this.context, 'calcotone-behavior-memory-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      processor.onprocessorerror = () => console.error('CALCOTONE physical behavior AudioWorklet stopped unexpectedly.');
      this.processor = processor;
      this.sync();
    } catch (error) {
      console.warn('CALCOTONE physical behavior stage could not initialize; dry fallback remains active.', error);
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

  private sync(): void {
    const now = this.context.currentTime;
    const enabled = Boolean(this.processor && this.profile !== 'bypass' && this.amount > 0.0001);

    this.clearDisconnectTimer();
    if (enabled) this.connectProcessor();

    this.bypassGain.gain.setTargetAtTime(enabled ? 0 : 1, now, 0.018);
    this.processedGain.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.018);
    this.setParameter('profile', PROFILE_INDEX[this.profile], now, true);
    this.setParameter('amount', this.amount, now);
    this.setParameter('motion', this.motion, now);
    this.setParameter('memory', this.memory, now);
    this.setParameter('color', this.color, now);

    if (!enabled && this.processorConnected) {
      this.disconnectTimer = setTimeout(() => {
        this.disconnectTimer = null;
        const stillDisabled = this.profile === 'bypass' || this.amount <= 0.0001;
        if (!this.disposed && stillDisabled) this.disconnectProcessor();
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
