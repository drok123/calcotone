export interface DreamBufferStats {
  fillRatio: number;
  historySeconds: number;
  inputPeak: number;
  captures: number;
  activeRoutes: number;
  memoryAgeSeconds?: [number, number, number];
  memoryIntent?: [number, number, number];
}

export type DreamHead = 'now' | 'echo' | 'ghost';
type LegacyDreamHead = 'short' | 'medium' | 'long';
type DreamHeadInput = DreamHead | LegacyDreamHead;

interface DreamRoute {
  readonly head: DreamHead;
  readonly destination: AudioNode;
  readonly gain: GainNode;
  readonly highpass: BiquadFilterNode;
  readonly lowpass: BiquadFilterNode;
  readonly saturator: WaveShaperNode;
  amount: number;
  connected: boolean;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Shared stereo acoustic memory for the Dream Engine.
 *
 * V12 separates the system conceptually into:
 * CAPTURE -> MEMORY -> AGE HEADS (NOW / ECHO / GHOST) -> RECALL -> SAFETY.
 * The AudioWorklet owns the fixed-size ring, content-aware memory tags, and moving
 * interpolated heads; this class owns bounded sends, recall routing, filtering,
 * suspension, diagnostics, and the protected return.
 */
export class DreamBuffer {
  public readonly node: AudioWorkletNode;
  public readonly now: GainNode;
  public readonly echo: GainNode;
  public readonly ghost: GainNode;
  public readonly returnMix: GainNode;

  private readonly nowFilter: BiquadFilterNode;
  private readonly echoFilter: BiquadFilterNode;
  private readonly ghostFilter: BiquadFilterNode;
  private readonly returnClipper: WaveShaperNode;
  private readonly safetyCurve: Float32Array<ArrayBuffer>;

  private readonly context: AudioContext;
  private readonly sendGains = new Map<string, GainNode>();
  private readonly sources = new Map<string, AudioNode>();
  private readonly sourceConnected = new Set<string>();
  private readonly sourceDisconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly routes = new Map<string, DreamRoute>();
  private stats: Omit<DreamBufferStats, 'activeRoutes'> = {
    fillRatio: 0,
    historySeconds: 8,
    inputPeak: 0,
    captures: 0,
    memoryAgeSeconds: [0.07, 0.48, 4.2],
    memoryIntent: [0.18, 0.16, 0.08],
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

    this.now = context.createGain();
    this.echo = context.createGain();
    this.ghost = context.createGain();
    this.returnMix = context.createGain();
    this.nowFilter = context.createBiquadFilter();
    this.echoFilter = context.createBiquadFilter();
    this.ghostFilter = context.createBiquadFilter();
    this.returnClipper = context.createWaveShaper();

    this.now.gain.value = 0.013;
    this.echo.gain.value = 0.008;
    this.ghost.gain.value = 0.0045;
    this.returnMix.gain.value = 0.58;

    for (const filter of [this.nowFilter, this.echoFilter, this.ghostFilter]) {
      filter.type = 'bandpass';
      filter.Q.value = 0.52;
    }
    this.nowFilter.frequency.value = 4300;
    this.echoFilter.frequency.value = 2450;
    this.ghostFilter.frequency.value = 1120;
    this.returnClipper.curve = this.safetyCurve;
    this.returnClipper.oversample = '2x';

    this.node.connect(this.now, 0, 0);
    this.node.connect(this.echo, 1, 0);
    this.node.connect(this.ghost, 2, 0);
    this.now.connect(this.nowFilter);
    this.echo.connect(this.echoFilter);
    this.ghost.connect(this.ghostFilter);
    this.nowFilter.connect(this.returnMix);
    this.echoFilter.connect(this.returnMix);
    this.ghostFilter.connect(this.returnMix);
    this.returnMix.connect(this.returnClipper);

    this.node.port.onmessage = (event: MessageEvent<Partial<Omit<DreamBufferStats, 'activeRoutes'>> & { type?: string }>) => {
      if (event.data?.type !== 'profile') return;
      const nextAges = event.data.memoryAgeSeconds;
      const nextIntent = event.data.memoryIntent;
      this.stats = {
        fillRatio: Number(event.data.fillRatio ?? this.stats.fillRatio),
        historySeconds: Number(event.data.historySeconds ?? this.stats.historySeconds),
        inputPeak: Number(event.data.inputPeak ?? this.stats.inputPeak),
        captures: Number(event.data.captures ?? this.stats.captures),
        memoryAgeSeconds: Array.isArray(nextAges) && nextAges.length >= 3
          ? [Number(nextAges[0]) || 0, Number(nextAges[1]) || 0, Number(nextAges[2]) || 0]
          : this.stats.memoryAgeSeconds,
        memoryIntent: Array.isArray(nextIntent) && nextIntent.length >= 3
          ? [clamp01(Number(nextIntent[0])), clamp01(Number(nextIntent[1])), clamp01(Number(nextIntent[2]))]
          : this.stats.memoryIntent,
      };
    };
    this.node.onprocessorerror = () => {
      console.error('CALCOTONE Dream Buffer AudioWorklet stopped unexpectedly.');
    };
  }

  public attachSource(id: string, source: AudioNode, amount: number): void {
    this.detachSource(id);
    const gain = this.context.createGain();
    const safeAmount = Math.max(0, Math.min(0.5, amount));
    gain.gain.value = safeAmount;
    gain.connect(this.node);
    this.sources.set(id, source);
    this.sendGains.set(id, gain);
    if (safeAmount > 0.0001) this.connectSource(id);
  }

  private connectSource(id: string): void {
    if (this.sourceConnected.has(id)) return;
    const source = this.sources.get(id);
    const gain = this.sendGains.get(id);
    if (!source || !gain) return;
    source.connect(gain);
    this.sourceConnected.add(id);
  }

  private disconnectSourceFeed(id: string): void {
    if (!this.sourceConnected.has(id)) return;
    const source = this.sources.get(id);
    const gain = this.sendGains.get(id);
    if (source && gain) {
      try { source.disconnect(gain); } catch { /* already disconnected */ }
    }
    this.sourceConnected.delete(id);
  }

  private clearSourceDisconnectTimer(id: string): void {
    const timer = this.sourceDisconnectTimers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.sourceDisconnectTimers.delete(id);
  }

  public detachSource(id: string): void {
    this.clearSourceDisconnectTimer(id);
    this.disconnectSourceFeed(id);
    this.sendGains.get(id)?.disconnect();
    this.sources.delete(id);
    this.sendGains.delete(id);
  }

  public setSendAmount(id: string, amount: number): void {
    const gain = this.sendGains.get(id);
    if (!gain) return;
    const safeAmount = Math.max(0, Math.min(0.5, amount));
    this.clearSourceDisconnectTimer(id);
    if (safeAmount > 0.0001) this.connectSource(id);
    gain.gain.setTargetAtTime(safeAmount, this.context.currentTime, 0.04);
    if (safeAmount <= 0.0001 && this.sourceConnected.has(id)) {
      const timer = setTimeout(() => {
        this.sourceDisconnectTimers.delete(id);
        this.disconnectSourceFeed(id);
      }, 180);
      this.sourceDisconnectTimers.set(id, timer);
    }
  }

  public attachRoute(id: string, headInput: DreamHeadInput, destination: AudioNode, amount: number): void {
    this.detachRoute(id);
    const head = normalizeDreamHead(headInput);

    const gain = this.context.createGain();
    const highpass = this.context.createBiquadFilter();
    const lowpass = this.context.createBiquadFilter();
    const saturator = this.context.createWaveShaper();
    const safeAmount = clampRouteAmount(amount);

    gain.gain.value = safeAmount;
    highpass.type = 'highpass';
    highpass.frequency.value = head === 'ghost' ? 170 : head === 'echo' ? 125 : 90;
    highpass.Q.value = 0.55;
    lowpass.type = 'lowpass';
    lowpass.frequency.value = head === 'ghost' ? 3600 : head === 'echo' ? 6500 : 9800;
    lowpass.Q.value = 0.5;
    saturator.curve = this.safetyCurve;
    saturator.oversample = 'none';

    gain.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(saturator);

    const route: DreamRoute = {
      head,
      destination,
      gain,
      highpass,
      lowpass,
      saturator,
      amount: safeAmount,
      connected: false,
      disconnectTimer: null,
    };
    this.routes.set(id, route);
    if (safeAmount > 0.0001) this.connectRoute(route);
  }

  private connectRoute(route: DreamRoute): void {
    if (route.connected) return;
    const outputIndex = route.head === 'now' ? 0 : route.head === 'echo' ? 1 : 2;
    this.node.connect(route.gain, outputIndex, 0);
    route.saturator.connect(route.destination);
    route.connected = true;
  }

  private disconnectRouteFeed(route: DreamRoute): void {
    if (!route.connected) return;
    try { this.node.disconnect(route.gain); } catch { /* already disconnected */ }
    try { route.saturator.disconnect(route.destination); } catch { /* already disconnected */ }
    route.connected = false;
  }

  public setRouteAmount(id: string, amount: number): void {
    const route = this.routes.get(id);
    if (!route) return;
    route.amount = clampRouteAmount(amount);
    if (route.disconnectTimer !== null) {
      clearTimeout(route.disconnectTimer);
      route.disconnectTimer = null;
    }
    if (route.amount > 0.0001) this.connectRoute(route);
    route.gain.gain.setTargetAtTime(route.amount, this.context.currentTime, 0.06);
    if (route.amount <= 0.0001 && route.connected) {
      route.disconnectTimer = setTimeout(() => {
        route.disconnectTimer = null;
        if (route.amount <= 0.0001) this.disconnectRouteFeed(route);
      }, 240);
    }
  }

  public detachRoute(id: string): void {
    const route = this.routes.get(id);
    if (!route) return;
    if (route.disconnectTimer !== null) clearTimeout(route.disconnectTimer);
    this.disconnectRouteFeed(route);
    route.gain.disconnect();
    route.highpass.disconnect();
    route.lowpass.disconnect();
    route.saturator.disconnect();
    this.routes.delete(id);
  }

  public detachAllRoutes(): void {
    for (const id of [...this.routes.keys()]) this.detachRoute(id);
  }

  public connectReturn(destination: AudioNode): void {
    this.returnClipper.connect(destination);
  }

  public getStats(): DreamBufferStats {
    const ages = this.stats.memoryAgeSeconds;
    const intent = this.stats.memoryIntent;
    return {
      ...this.stats,
      memoryAgeSeconds: ages ? [...ages] as [number, number, number] : undefined,
      memoryIntent: intent ? [...intent] as [number, number, number] : undefined,
      activeRoutes: [...this.routes.values()].filter((route) => route.connected).length,
    };
  }

  public dispose(): void {
    this.detachAllRoutes();
    for (const id of [...this.sendGains.keys()]) this.detachSource(id);
    for (const timer of this.sourceDisconnectTimers.values()) clearTimeout(timer);
    this.sourceDisconnectTimers.clear();
    this.node.onprocessorerror = null;
    this.node.port.close();
    this.node.disconnect();
    this.now.disconnect();
    this.echo.disconnect();
    this.ghost.disconnect();
    this.nowFilter.disconnect();
    this.echoFilter.disconnect();
    this.ghostFilter.disconnect();
    this.returnMix.disconnect();
    this.returnClipper.disconnect();
  }
}

function normalizeDreamHead(head: DreamHeadInput): DreamHead {
  if (head === 'short') return 'now';
  if (head === 'medium') return 'echo';
  if (head === 'long') return 'ghost';
  return head;
}

function clampRouteAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0.06, value));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
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
