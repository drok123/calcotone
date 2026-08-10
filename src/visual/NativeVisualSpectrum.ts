import type { VisualSpectrumSource } from './SharedVisualSpectrum';

const NATIVE_SPECTRUM_URL = 'http://127.0.0.1:48157/spectrum';

export class NativeVisualSpectrum implements VisualSpectrumSource {
  public readonly frequencyBinCount = 128;
  private readonly bins = new Uint8Array(this.frequencyBinCount);
  private requestPending = false;
  private lastRequestAt = 0;
  private audioFrame = 0;
  private audioSampleRate = 48_000;
  private audioFrameReceivedAt = 0;

  public getPresentationTimeSeconds(): number {
    if (this.audioFrame <= 0 || this.audioSampleRate <= 0) return performance.now() / 1000;
    return this.audioFrame / this.audioSampleRate
      + Math.max(0, performance.now() - this.audioFrameReceivedAt) / 1000;
  }

  public getByteFrequencyData(target: Uint8Array): void {
    target.set(this.bins.subarray(0, Math.min(target.length, this.bins.length)));
    if (target.length > this.bins.length) target.fill(0, this.bins.length);

    const now = performance.now();
    if (this.requestPending || now - this.lastRequestAt < 20) return;
    this.lastRequestAt = now;
    this.requestPending = true;
    void fetch(NATIVE_SPECTRUM_URL, { cache: 'no-store', mode: 'cors', credentials: 'omit' })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json() as { bins?: number[]; frame?: number; sampleRate?: number };
        if (Array.isArray(payload.bins)) {
          const length = Math.min(this.bins.length, payload.bins.length);
          for (let index = 0; index < length; index += 1) {
            this.bins[index] = Math.max(0, Math.min(255, Math.round(payload.bins[index] ?? 0)));
          }
          if (length < this.bins.length) this.bins.fill(0, length);
        }
        if (Number.isFinite(payload.frame) && (payload.frame ?? 0) >= 0) {
          this.audioFrame = Math.max(0, Number(payload.frame));
          this.audioSampleRate = Math.max(8_000, Number(payload.sampleRate) || this.audioSampleRate);
          this.audioFrameReceivedAt = performance.now();
        }
      })
      .catch(() => undefined)
      .finally(() => { this.requestPending = false; });
  }
}
