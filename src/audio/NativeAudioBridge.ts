export interface NativeAudioHealth {
  engine: 'calcotone-native';
  protocol: number;
  sampleRate: number;
  inputPeriodFrames: number;
  outputBufferFrames: number;
  estimatedPathMs: number;
  underruns: number;
  overruns: number;
}

const NATIVE_ORIGIN = 'http://127.0.0.1:48157';

export class NativeAudioBridge {
  private connected = false;

  public isConnected(): boolean { return this.connected; }

  public async probe(timeoutMs = 350): Promise<NativeAudioHealth | null> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${NATIVE_ORIGIN}/health`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const health = await response.json() as NativeAudioHealth;
      if (health.engine !== 'calcotone-native' || health.protocol !== 1) return null;
      this.connected = true;
      return health;
    } catch {
      this.connected = false;
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  public async command(name: string, value: number): Promise<boolean> {
    if (!this.connected || !Number.isFinite(value)) return false;
    try {
      const response = await fetch(`${NATIVE_ORIGIN}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: `${name} ${value}`,
      });
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
