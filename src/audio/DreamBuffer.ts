export interface DreamBufferStats {
  fillRatio: number;
  historySeconds: number;
  inputPeak: number;
  captures: number;
  activeRoutes: number;
}

export type DreamHead = 'short' | 'medium' | 'long';

interface DreamRoute {
  readonly head: DreamHead;
  readonly destination: AudioNode;
  readonly gain: GainNode;
  readonly highpass: BiquadFilterNode;
  readonly lowpass: BiquadFilterNode;
  readonly saturator: WaveShaperNode;
  amount: number;
}

/**
 * Shared stereo memory core for the Dream Engine.
 *
 * Halo, Atmos and Grain write into one realtime circular history. The buffer
 * exposes three decorrelated read heads. A very quiet master-memory return is
 * kept separate from protected cross-module routes so the two jobs can be
 * tuned, bypassed and debugged independently.
 */
export class DreamBuffer {
  public readonly node: AudioWorkletNode;
  public readonly short: GainNode;
  public readonly medium: GainNode;
  public readonly long: GainNode;
  public readonly returnMix: GainNode;

  private readonly shortFilter: BiquadFilterNode;
  private readonly mediumFilter: BiquadFilterNode;
  private readonly longFilter: BiquadFilterNode;
  private readonly returnClipper: WaveShaperNode;
  private readonly safetyCurve: Float32Array<ArrayBuffer>;

  private readonly context: AudioContext;
  private readonly sendGains = new Map<string, GainNode>();
  private readonly sources = new Map<string, AudioNode>();
  private readonly routes = new Map<string, DreamRoute>();
  private stats: Omit<DreamBufferStats, 'activeRoutes'> = {
    fillRatio: 0,
    historySeconds: 8,
    inputPeak: 0,
    captures: 0,
  };

  public constructor(context: AudioContext) {
    this.context = context;
    this.safetyCurve = createMemorySafetyCurve();
    this.node = new AudioWorkletNode(context, 'calcotone-dream-buffer', {
      numberOfInputs: 1,
      numberOfOutputs: 3,
      outputChannelCount: [2, 2, 2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });

    this.short = context.createGain();
    this.medium = context.createGain();
    this.long = context.createGain();
    this.returnMix = context.createGain();
    this.shortFilter = context.createBiquadFilter();
    this.mediumFilter = context.createBiquadFilter();
    this.longFilter = context.createBiquadFilter();
    this.returnClipper = context.createWaveShaper();

    // Keep the old parallel "memory air" deliberately subtle. Cross-module
    // interaction is handled by independent guarded routes below.
    this.short.gain.value = 0.014;
    this.medium.gain.value = 0.009;
    this.long.gain.value = 0.006;
    this.returnMix.gain.value = 0.62;

    for (const filter of [this.shortFilter, this.mediumFilter, this.longFilter]) {
      filter.type = 'bandpass';
      filter.Q.value = 0.52;
    }
    this.shortFilter.frequency.value = 4100;
    this.mediumFilter.frequency.value = 2350;
    this.longFilter.frequency.value = 1280;
    this.returnClipper.curve = this.safetyCurve;
    this.returnClipper.oversample = '2x';

    this.node.connect(this.short, 0, 0);
    this.node.connect(this.medium, 1, 0);
    this.node.connect(this.long, 2, 0);
    this.short.connect(this.shortFilter);
    this.medium.connect(this.mediumFilter);
    this.long.connect(this.longFilter);
    this.shortFilter.connect(this.returnMix);
    this.mediumFilter.connect(this.returnMix);
    this.longFilter.connect(this.returnMix);
    this.returnMix.connect(this.returnClipper);

    this.node.port.onmessage = (event: MessageEvent<Omit<DreamBufferStats, 'activeRoutes'> & { type?: string }>) => {
      if (event.data?.type !== 'profile') return;
      const { type: _type, ...stats } = event.data;
      this.stats = stats;
    };
    this.node.onprocessorerror = () => {
      console.error('CALCOTONE Dream Buffer AudioWorklet stopped unexpectedly.');
    };
  }

  public attachSource(id: string, source: AudioNode, amount: number): void {
    this.detachSource(id);
    const gain = this.context.createGain();
    gain.gain.value = Math.max(0, Math.min(0.5, amount));
    source.connect(gain);
    gain.connect(this.node);
    this.sources.set(id, source);
    this.sendGains.set(id, gain);
  }

  public detachSource(id: string): void {
    const source = this.sources.get(id);
    const gain = this.sendGains.get(id);
    if (source && gain) {
      try { source.disconnect(gain); } catch { /* already disconnected */ }
      gain.disconnect();
    }
    this.sources.delete(id);
    this.sendGains.delete(id);
  }

  public setSendAmount(id: string, amount: number): void {
    const gain = this.sendGains.get(id);
    if (!gain) return;
    gain.gain.setTargetAtTime(Math.max(0, Math.min(0.5, amount)), this.context.currentTime, 0.04);
  }

  /**
   * Attach one protected Dream-memory read head to a module input.
   * Route amounts are intentionally hard-capped: these are texture couplings,
   * not conventional feedback knobs.
   */
  public attachRoute(
    id: string,
    head: DreamHead,
    destination: AudioNode,
    amount: number,
  ): void {
    this.detachRoute(id);

    const gain = this.context.createGain();
    const highpass = this.context.createBiquadFilter();
    const lowpass = this.context.createBiquadFilter();
    const saturator = this.context.createWaveShaper();
    const safeAmount = clampRouteAmount(amount);

    gain.gain.value = safeAmount;
    highpass.type = 'highpass';
    highpass.frequency.value = head === 'long' ? 150 : head === 'medium' ? 120 : 95;
    highpass.Q.value = 0.55;
    lowpass.type = 'lowpass';
    lowpass.frequency.value = head === 'long' ? 4200 : head === 'medium' ? 6500 : 9200;
    lowpass.Q.value = 0.5;
    saturator.curve = this.safetyCurve;
    // Cross-routes are deliberately 1x: the tiny gain plus the downstream
    // module's own protection makes oversampling here wasted callback budget.
    saturator.oversample = 'none';

    const outputIndex = head === 'short' ? 0 : head === 'medium' ? 1 : 2;
    this.node.connect(gain, outputIndex, 0);
    gain.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(saturator);
    saturator.connect(destination);

    this.routes.set(id, {
      head,
      destination,
      gain,
      highpass,
      lowpass,
      saturator,
      amount: safeAmount,
    });
  }

  public setRouteAmount(id: string, amount: number): void {
    const route = this.routes.get(id);
    if (!route) return;
    route.amount = clampRouteAmount(amount);
    route.gain.gain.setTargetAtTime(route.amount, this.context.currentTime, 0.06);
  }

  public detachRoute(id: string): void {
    const route = this.routes.get(id);
    if (!route) return;
    try { this.node.disconnect(route.gain); } catch { /* already disconnected */ }
    route.gain.disconnect();
    route.highpass.disconnect();
    route.lowpass.disconnect();
    route.saturator.disconnect();
    this.routes.delete(id);
  }

  public detachAllRoutes(): void {
    for (const id of [...this.routes.keys()]) this.detachRoute(id);
  }

  /** Connect the protected, parallel memory return into the master safety path. */
  public connectReturn(destination: AudioNode): void {
    this.returnClipper.connect(destination);
  }

  public getStats(): DreamBufferStats {
    return { ...this.stats, activeRoutes: this.routes.size };
  }

  public dispose(): void {
    this.detachAllRoutes();
    for (const id of [...this.sendGains.keys()]) this.detachSource(id);
    this.node.onprocessorerror = null;
    this.node.port.close();
    this.node.disconnect();
    this.short.disconnect();
    this.medium.disconnect();
    this.long.disconnect();
    this.shortFilter.disconnect();
    this.mediumFilter.disconnect();
    this.longFilter.disconnect();
    this.returnMix.disconnect();
    this.returnClipper.disconnect();
  }
}

function clampRouteAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0.06, value));
}

function createMemorySafetyCurve(): Float32Array<ArrayBuffer> {
  const size = 1024;
  const curve = new Float32Array(size);
  const drive = 1.35;
  const norm = Math.tanh(drive);
  for (let index = 0; index < size; index += 1) {
    const x = (index / (size - 1)) * 2 - 1;
    curve[index] = Math.tanh(x * drive) / norm;
  }
  return curve;
}
