import {
  hasNativeDesktopTransport,
  nativeDesktopRequest,
  resetNativeDesktopTransport,
} from './NativeDesktopTransport';

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

export const NATIVE_HEALTH_EVENT = 'calcotone-native-health';

const NATIVE_ORIGIN = 'http://127.0.0.1:48157';
const PROFILE_SELECTOR_PARAMETERS = new Set(['mode', 'algorithm']);
const STACK_PROFILE_SELECTORS = new Set(['model', 'cab']);
const STACK_PROFILE_PARAMETERS = new Set(['drive', 'tone', 'sag', 'mix']);
const CONTINUOUS_COMMANDS = new Set(['inputGain', 'outputGain', 'drive', 'tone', 'sag', 'mix']);
const DESKTOP_HEALTH_INTERVAL_MS = 50;
const HTTP_HEALTH_INTERVAL_MS = 160;
const HEALTH_STALE_MS = 400;
let nativeBackendEngaged = false;

/** True only while the current Calcotone UI has successfully activated the native engine. */
export function isNativeBackendEngaged(): boolean {
  return nativeBackendEngaged;
}

function validHealth(health: NativeAudioHealth | null): health is NativeAudioHealth {
  return health?.engine === 'calcotone-native' && health.protocol === 1;
}

function publishHealth(health: NativeAudioHealth): void {
  window.dispatchEvent(new CustomEvent<NativeAudioHealth>(NATIVE_HEALTH_EVENT, { detail: health }));
}

export class NativeAudioBridge {
  private connected = false;
  private lastProbeFailure = 'Native host was not detected.';
  private commandQueue: Promise<boolean> = Promise.resolve(true);
  private healthCache: NativeAudioHealth | null = null;
  private healthCacheAt = 0;
  private healthRequest: Promise<NativeAudioHealth | null> | null = null;
  private healthTimer: number | null = null;
  private readonly commandGenerations = new Map<string, number>();
  private readonly appliedContinuousState = new Map<string, string>();
  // Native machine selectors can change topology as well as coefficients. Keep the
  // latest desired operating point beside the transport queue so selecting a new
  // machine commits one coherent profile instead of waiting for the next knob write.
  private readonly parameterSnapshot = new Map<string, Map<string, string>>();
  private readonly stackSnapshot = new Map<string, string>();
  // Loop settings are published as a complete UI snapshot, but each native bridge
  // line is an idempotent setter. Remember the latest requested line per field so a
  // fader move does not resend the other twelve unchanged Loop controls every tick.
  private readonly loopCommandState = new Map<string, string>();

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
    this.loopCommandState.clear();
    this.commandGenerations.clear();
    this.appliedContinuousState.clear();
  }

  private loopStateKey(line: string): string | null {
    // This classifier sits on every native control gesture, not just Loop. Avoid the
    // regex split/allocation path for the overwhelmingly common non-Loop commands.
    const paramPrefix = 'loopParam ';
    if (line.startsWith(paramPrefix)) {
      const end = line.indexOf(' ', paramPrefix.length);
      if (end > paramPrefix.length) return `loopParam:${line.slice(paramPrefix.length, end)}`;
      return null;
    }
    const levelPrefix = 'loopTrackLevel ';
    if (line.startsWith(levelPrefix)) {
      const end = line.indexOf(' ', levelPrefix.length);
      if (end > levelPrefix.length) return `loopTrackLevel:${line.slice(levelPrefix.length, end)}`;
    }
    return null;
  }

  private commandCoalesceKey(line: string): string | null {
    const parameterPrefix = 'param ';
    if (line.startsWith(parameterPrefix)) {
      const moduleEnd = line.indexOf(' ', parameterPrefix.length);
      if (moduleEnd < 0) return null;
      const parameterStart = moduleEnd + 1;
      const parameterEnd = line.indexOf(' ', parameterStart);
      if (parameterEnd < 0) return null;
      const parameterId = line.slice(parameterStart, parameterEnd);
      if (PROFILE_SELECTOR_PARAMETERS.has(parameterId)) return null;
      return `param:${line.slice(parameterPrefix.length, moduleEnd)}:${parameterId}`;
    }
    const loopKey = this.loopStateKey(line);
    if (loopKey) return loopKey;
    const separator = line.indexOf(' ');
    if (separator <= 0) return null;
    const name = line.slice(0, separator);
    return CONTINUOUS_COMMANDS.has(name) ? `control:${name}` : null;
  }

  private rememberDesiredState(line: string): void {
    // Most native commands are neither module parameter writes nor Stack profile
    // values. Keep them on a no-allocation prefix path instead of regex-splitting
    // every knob/transport command into a temporary array.
    const parameterPrefix = 'param ';
    if (line.startsWith(parameterPrefix)) {
      const moduleEnd = line.indexOf(' ', parameterPrefix.length);
      if (moduleEnd < 0) return;
      const parameterStart = moduleEnd + 1;
      const parameterEnd = line.indexOf(' ', parameterStart);
      if (parameterEnd < 0) return;
      const moduleId = line.slice(parameterPrefix.length, moduleEnd);
      const parameterId = line.slice(parameterStart, parameterEnd);
      if (PROFILE_SELECTOR_PARAMETERS.has(parameterId)) return;
      const value = line.slice(parameterEnd + 1);
      if (!value) return;
      let snapshot = this.parameterSnapshot.get(moduleId);
      if (!snapshot) {
        snapshot = new Map<string, string>();
        this.parameterSnapshot.set(moduleId, snapshot);
      }
      snapshot.set(parameterId, value);
      return;
    }

    const separator = line.indexOf(' ');
    if (separator <= 0) return;
    const name = line.slice(0, separator);
    if (STACK_PROFILE_PARAMETERS.has(name)) {
      const value = line.slice(separator + 1);
      if (value) this.stackSnapshot.set(name, value);
    }
  }

  private profileReplayLines(line: string): string[] {
    const parameterPrefix = 'param ';
    if (line.startsWith(parameterPrefix)) {
      const moduleEnd = line.indexOf(' ', parameterPrefix.length);
      if (moduleEnd < 0) return [];
      const parameterStart = moduleEnd + 1;
      const parameterEnd = line.indexOf(' ', parameterStart);
      if (parameterEnd < 0) return [];
      const parameterId = line.slice(parameterStart, parameterEnd);
      if (!PROFILE_SELECTOR_PARAMETERS.has(parameterId)) return [];
      const moduleId = line.slice(parameterPrefix.length, moduleEnd);
      const snapshot = this.parameterSnapshot.get(moduleId);
      return snapshot
        ? [...snapshot.entries()].map(([storedParameterId, value]) => `param ${moduleId} ${storedParameterId} ${value}`)
        : [];
    }

    const separator = line.indexOf(' ');
    if (separator <= 0) return [];
    const name = line.slice(0, separator);
    if (STACK_PROFILE_SELECTORS.has(name)) {
      return [...this.stackSnapshot.entries()].map(([parameterId, value]) => `${parameterId} ${value}`);
    }
    return [];
  }

  private markApplied(line: string): void {
    const key = this.commandCoalesceKey(line);
    if (key) this.appliedContinuousState.set(key, line);
  }

  private acceptHealth(health: NativeAudioHealth): NativeAudioHealth {
    this.healthCache = health;
    this.healthCacheAt = performance.now();
    publishHealth(health);
    return health;
  }

  private async requestHealth(signal?: AbortSignal): Promise<NativeAudioHealth | null> {
    const direct = nativeDesktopRequest<NativeAudioHealth>('health', '', 500);
    if (direct) {
      const health = await direct;
      return validHealth(health) ? health : null;
    }
    try {
      const response = await fetch(this.request(`${NATIVE_ORIGIN}/health`, {
        cache: 'no-store',
        ...(signal ? { signal } : {}),
      }));
      if (!response.ok) return null;
      const health = await response.json() as NativeAudioHealth;
      return validHealth(health) ? health : null;
    } catch {
      return null;
    }
  }

  private refreshHealth(): Promise<NativeAudioHealth | null> {
    if (!this.connected) return Promise.resolve(null);
    if (this.healthRequest) return this.healthRequest;
    this.healthRequest = this.requestHealth()
      .then((health) => health ? this.acceptHealth(health) : null)
      .finally(() => { this.healthRequest = null; });
    return this.healthRequest;
  }

  private stopHealthMonitor(): void {
    if (this.healthTimer !== null) window.clearInterval(this.healthTimer);
    this.healthTimer = null;
  }

  private startHealthMonitor(): void {
    this.stopHealthMonitor();
    const interval = hasNativeDesktopTransport() ? DESKTOP_HEALTH_INTERVAL_MS : HTTP_HEALTH_INTERVAL_MS;
    this.healthTimer = window.setInterval(() => { void this.refreshHealth(); }, interval);
  }

  public async probe(timeoutMs = 8_000): Promise<NativeAudioHealth | null> {
    if (window.self !== window.top) {
      this.lastProbeFailure = 'Open the Calcotone preview in a separate tab; embedded previews cannot reach the native host.';
      return null;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const health = await this.requestHealth(controller.signal);
      if (!health) {
        this.lastProbeFailure = hasNativeDesktopTransport()
          ? 'Native desktop bridge did not return a compatible engine response.'
          : 'Native bridge was unreachable.';
        return null;
      }
      this.connected = true;
      this.lastProbeFailure = '';
      this.resetDesiredState();
      this.acceptHealth(health);
      this.startHealthMonitor();
      return health;
    } catch (error) {
      this.connected = false;
      nativeBackendEngaged = false;
      this.healthCache = null;
      this.healthCacheAt = 0;
      this.stopHealthMonitor();
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
    const now = performance.now();
    if (this.healthCache && now - this.healthCacheAt < HEALTH_STALE_MS) return this.healthCache;
    return this.refreshHealth();
  }

  public async commandLine(line: string): Promise<boolean> {
    const trimmed = line.trim();
    if (!this.connected || !trimmed) return false;
    const loopKey = this.loopStateKey(trimmed);
    if (loopKey && this.loopCommandState.get(loopKey) === trimmed) return true;
    if (loopKey) this.loopCommandState.set(loopKey, trimmed);

    // Remember synchronously, before the queued request runs. Random/preset flows enqueue
    // a selector followed by their knob values in one call stack, so the selector replay
    // sees the final desired snapshot rather than briefly restoring the previous recipe.
    line = trimmed;
    this.rememberDesiredState(line);
    const coalesceKey = this.commandCoalesceKey(line);
    const generation = coalesceKey ? (this.commandGenerations.get(coalesceKey) ?? 0) + 1 : 0;
    if (coalesceKey) this.commandGenerations.set(coalesceKey, generation);

    // Preserve one globally ordered stream, but discard obsolete or already-applied
    // continuous values before they hit native. A fast drag therefore costs at most the
    // command already in flight plus the newest value, and selector replay does not make
    // the queued final knob snapshot cross the bridge a second time.
    const operation = this.commandQueue.then(async () => {
      if (coalesceKey && this.commandGenerations.get(coalesceKey) !== generation) return true;
      if (coalesceKey && this.appliedContinuousState.get(coalesceKey) === line) return true;
      const sent = await this.sendCommand(line);
      if (!sent) {
        // A failed setter must be retryable. Only clear it if no newer value for the
        // same field has superseded this queued request.
        if (loopKey && this.loopCommandState.get(loopKey) === trimmed) this.loopCommandState.delete(loopKey);
        return false;
      }
      if (coalesceKey) this.appliedContinuousState.set(coalesceKey, line);
      for (const replay of this.profileReplayLines(line)) {
        if (!await this.sendCommand(replay)) return false;
        // Replays are intentionally never skipped: selecting a new hardware model can
        // reset coefficients even when the numeric knob value is unchanged. Recording
        // them as applied only suppresses the redundant queued write that follows.
        this.markApplied(replay);
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
    const direct = nativeDesktopRequest<{ ok?: boolean }>('command', line, 750);
    if (direct) {
      const result = await direct;
      return result?.ok === true;
    }
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
    this.healthCache = null;
    this.healthCacheAt = 0;
    this.healthRequest = null;
    this.stopHealthMonitor();
    this.resetDesiredState();
    resetNativeDesktopTransport();
  }
}
