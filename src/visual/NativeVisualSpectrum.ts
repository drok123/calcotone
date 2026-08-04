import type { VisualSpectrumSource } from './SharedVisualSpectrum';

const NATIVE_SPECTRUM_URL = 'http://127.0.0.1:48157/spectrum';

export class NativeVisualSpectrum implements VisualSpectrumSource {
  public readonly frequencyBinCount = 128;
  private readonly bins = new Uint8Array(this.frequencyBinCount);
  private requestPending = false;
  private lastRequestAt = 0;

  public getByteFrequencyData(target: Uint8Array): void {
    target.set(this.bins.subarray(0, Math.min(target.length, this.bins.length)));
    if (target.length > this.bins.length) target.fill(0, this.bins.length);

    const now = performance.now();
    if (this.requestPending || now - this.lastRequestAt < 30) return;
    this.lastRequestAt = now;
    this.requestPending = true;
    void fetch(NATIVE_SPECTRUM_URL, { cache: 'no-store', mode: 'cors', credentials: 'omit' })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json() as { bins?: number[] };
        if (!Array.isArray(payload.bins)) return;
        const length = Math.min(this.bins.length, payload.bins.length);
        for (let index = 0; index < length; index += 1) {
          this.bins[index] = Math.max(0, Math.min(255, Math.round(payload.bins[index] ?? 0)));
        }
        if (length < this.bins.length) this.bins.fill(0, length);
      })
      .catch(() => undefined)
      .finally(() => { this.requestPending = false; });
  }
}
