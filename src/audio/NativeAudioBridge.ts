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
}

const NATIVE_ORIGIN = 'http://127.0.0.1:48157';

export class NativeAudioBridge {
  private connected = false;
  private lastProbeFailure = 'Native host was not detected.';

  public isConnected(): boolean { return this.connected; }
  public getLastProbeFailure(): string { return this.lastProbeFailure; }

  private request(url: string, init: RequestInit): Request {
    return new Request(url, {
      ...init,
      mode: 'cors',
      credentials: 'omit',
    });
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
      return health;
    } catch (error) {
      this.connected = false;
      this.lastProbeFailure = error instanceof DOMException && error.name === 'AbortError'
        ? 'Native bridge timed out. Allow loopback/local-network access if the browser asks.'
        : 'Native bridge was blocked or unreachable. Allow loopback/local-network access in the browser.';
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  public async command(name: string, value: number): Promise<boolean> {
    if (!this.connected || !Number.isFinite(value)) return false;
    try {
      const response = await fetch(this.request(`${NATIVE_ORIGIN}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: `${name} ${value}`,
      }));
      if (!response.ok) throw new Error(`Native command failed (${response.status}).`);
      const result = await response.json() as { ok?: boolean };
      return result.ok === true;
    } catch {
      this.connected = false;
      return false;
    }
  }

  public disconnect(): void { this.connected = false; }
}
