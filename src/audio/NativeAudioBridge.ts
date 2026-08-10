export interface NativeAudioHealth {
  engine: 'calcotone-native';
  protocol: number;
  sampleRate: number;
  inputPeriodFrames: number;
  outputBufferFrames: number;
  inputChannels: number;
  outputChannels: number;
  estimatedPathMs: number;
  underruns: number;
  overruns: number;
  ringFrames: number;
  fifoTargetFrames: number;
  ringHighWaterFrames: number;
  clockCorrections: number;
  fifoReadRatio: number;
  captureDiscontinuities: number;
  captureTimestampErrors: number;
  captureSilentPackets: number;
  captureApiErrors: number;
  renderApiErrors: number;
  renderDeadlineMisses: number;
  maxRenderMicros: number;
  inputClips: number;
  outputClips: number;
  inputPeak: number;
  outputPeak: number;
  preLimiterPeak: number;
  audioMode: 'exclusive' | 'mixed' | 'shared';
  transport: 'wasapi' | 'ks-wavert' | 'asio';
  requestedBackend: 'auto' | 'wasapi' | 'ks-wavert';
  captureDevice: string;
  renderDevice: string;
  requestedBufferFrames: number;
  ksAvailable: boolean;
  ksFilterCount: number;
  ksPinCount: number;
  tunerHz: number;
  tunerLevel: number;
  loopTransport?: number;
  loopTrack?: number;
  loopTrackMask?: number;
  loopFrames?: number;
  loopRawFrames?: number;
  loopPosition?: number;
  loopTrimStart?: number;
  loopTrimEnd?: number;
  loopWaveform?: number[];
}

const NATIVE_ORIGIN = 'http://127.0.0.1:48157';
const PROFILE_SELECTOR_PARAMETERS = new Set(['mode', 'algorithm']);
const STACK_PROFILE_SELECTORS = new Set(['model', 'cab']);
const STACK_PROFILE_PARAMETERS = new Set(['drive', 'tone', 'sag', 'mix']);
let nativeBackendEngaged = false;

/** True only while the current Calcotone UI has successfully activated the native engine. */
export function isNativeBackendEngaged(): boolean {
  return nativeBackendEngaged;
}

export class NativeAudioBridge {
  private connected = false;
  private lastProbeFailure = 'Native host was not detected.';
  private commandQueue: Promise<boolean> = Promise.resolve(true);
  // Native machine selectors can change topology as well as coefficients. Keep the
  // latest desired operating point beside the transport queue so selecting a new
  // machine commits one coherent profile instead of waiting for the next knob write.
  private readonly parameterSnapshot = new Map<string, Map<string, string>>();
  private readonly stackSnapshot = new Map<string, string>();

  public isConnected(): boolean { return this.connected; }
  public getLastProbeFailure(): string { return this.lastProbeFailure; }

  private request(url: string, init: RequestInit): Request {
    return new Request(url, {
      ...init,
      mode: 'cors',
      credentials: 'omit',
    });
  }

  private resetDesiredState(): void {
    this.parameterSnapshot.clear();
    this.stackSnapshot.clear();
  }

  private rememberDesiredState(line: string): void {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'param' && parts.length >= 4) {
      const moduleId = parts[1]!;
      const parameterId = parts[2]!;
      if (PROFILE_SELECTOR_PARAMETERS.has(parameterId)) return;
      let snapshot = this.parameterSnapshot.get(moduleId);
      if (!snapshot) {
        snapshot = new Map<string, string>();
        this.parameterSnapshot.set(moduleId, snapshot);
      }
      snapshot.set(parameterId, parts.slice(3).join(' '));
      return;
    }

    const name = parts[0];
    if (name && STACK_PROFILE_PARAMETERS.has(name) && parts.length >= 2) {
      this.stackSnapshot.set(name, parts.slice(1).join(' '));
    }
  }

  private profileReplayLines(line: string): string[] {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'param' && parts.length >= 4 && PROFILE_SELECTOR_PARAMETERS.has(parts[2]!)) {
      const moduleId = parts[1]!;
      const snapshot = this.parameterSnapshot.get(moduleId);
      return snapshot
        ? [...snapshot.entries()].map(([parameterId, value]) => `param ${moduleId} ${parameterId} ${value}`)
        : [];
    }

    const name = parts[0];
    if (name && STACK_PROFILE_SELECTORS.has(name)) {
      return [...this.stackSnapshot.entries()].map(([parameterId, value]) => `${parameterId} ${value}`);
    }
    return [];
  }

  public async probe(timeoutMs = 8_000): Promise<NativeAudioHealth | null> {
    if (window.self !== window.top) {
      this.lastProbeFailure = 'Open the Calcotone preview in a separate tab; embedded previews cannot reach the native host.';
      return null;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(this.request(`${NATIVE_ORIGIN}/health`, {
        cache: 'no-store',
        signal: controller.signal,
      }));
      if (!response.ok) {
        this.lastProbeFailure = `Native bridge rejected the connection (HTTP ${response.status}).`;
        return null;
      }
      const health = await response.json() as NativeAudioHealth;
      if (health.engine !== 'calcotone-native' || health.protocol !== 1) {
        this.lastProbeFailure = 'Native host protocol did not match this Calcotone build.';
        return null;
      }
      this.connected = true;
      this.lastProbeFailure = '';
      this.resetDesiredState();
      return health;
    } catch (error) {
      this.connected = false;
      nativeBackendEngaged = false;
      this.lastProbeFailure = error instanceof DOMException && error.name === 'AbortError'
        ? 'Native bridge timed out.'
        : 'Native bridge was unreachable.';
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  public async command(name: string, value: number): Promise<boolean> {
    if (!Number.isFinite(value)) return false;
    const sent = await this.commandLine(`${name} ${value}`);
    if (name === 'active' && sent) nativeBackendEngaged = value >= 0.5;
    return sent;
  }

  public async readHealth(): Promise<NativeAudioHealth | null> {
    if (!this.connected) return null;
    try {
      const response = await fetch(this.request(`${NATIVE_ORIGIN}/health`, { cache: 'no-store' }));
      if (!response.ok) return null;
      return await response.json() as NativeAudioHealth;
    } catch {
      return null;
    }
  }

  public async commandLine(line: string): Promise<boolean> {
    if (!this.connected || !line.trim()) return false;
    // Remember synchronously, before the queued request runs. Random/preset flows enqueue
    // a selector followed by their knob values in one call stack, so the selector replay
    // sees the final desired snapshot rather than briefly restoring the previous recipe.
    this.rememberDesiredState(line);
    const operation = this.commandQueue.then(() => this.sendCommand(line)).then(async (sent) => {
      if (!sent) return false;
      for (const replay of this.profileReplayLines(line)) {
        if (!await this.sendCommand(replay)) return false;
      }
      return true;
    });
    this.commandQueue = operation.catch(() => false);
    return operation;
  }

  public async fetchRecording(): Promise<Blob> {
    const response = await fetch(this.request(`${NATIVE_ORIGIN}/calcotone-recording.wav?cache=${Date.now()}`, { cache: 'no-store' }));
    if (!response.ok) throw new Error(`Native recording download failed (${response.status}).`);
    return response.blob();
  }

  private async sendCommand(line: string): Promise<boolean> {
    try {
      const response = await fetch(this.request(`${NATIVE_ORIGIN}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: line,
      }));
      if (!response.ok) throw new Error(`Native command failed (${response.status}).`);
      const result = await response.json() as { ok?: boolean };
      return result.ok === true;
    } catch {
      return false;
    }
  }

  public disconnect(): void {
    this.connected = false;
    nativeBackendEngaged = false;
    this.resetDesiredState();
  }
}