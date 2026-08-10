export interface VisualSpectrumSource {
  readonly frequencyBinCount: number;
  getByteFrequencyData(target: Uint8Array): void;
  /** Audio time corresponding to what is being presented to the listener now. */
  getPresentationTimeSeconds?(): number;
}

const HEADER_WORDS = 4;
const WRITE_INDEX = 0;
const AVAILABLE_SAMPLES = 1;
const WRITE_SEQUENCE = 2;
const RING_CAPACITY = 16_384;
const FFT_SIZE = 256;
const FFT_BINS = FFT_SIZE / 2;

export class SharedVisualSpectrum implements VisualSpectrumSource {
  public readonly frequencyBinCount = FFT_BINS;

  private readonly context: AudioContext;
  private readonly node: AudioWorkletNode;
  private readonly silentSink: GainNode;
  private readonly header: Int32Array;
  private readonly ring: Float32Array;
  private readonly timeDomain = new Float32Array(FFT_SIZE);
  private readonly real = new Float32Array(FFT_SIZE);
  private readonly imaginary = new Float32Array(FFT_SIZE);
  private readonly window = new Float32Array(FFT_SIZE);
  private readonly bitReversed = new Uint16Array(FFT_SIZE);
  private readonly cosine = new Float32Array(FFT_SIZE / 2);
  private readonly sine = new Float32Array(FFT_SIZE / 2);
  private hasSnapshot = false;
  private lastSnapshotSequence = -1;

  public static create(context: AudioContext): SharedVisualSpectrum | null {
    if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') return null;
    try {
      return new SharedVisualSpectrum(context);
    } catch (error) {
      console.warn('CALCOTONE shared visual ring unavailable; using native analyser fallback.', error);
      return null;
    }
  }

  private constructor(context: AudioContext) {
    this.context = context;
    const byteLength = HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT
      + RING_CAPACITY * Float32Array.BYTES_PER_ELEMENT;
    const sharedBuffer = new SharedArrayBuffer(byteLength);
    this.header = new Int32Array(sharedBuffer, 0, HEADER_WORDS);
    this.ring = new Float32Array(
      sharedBuffer,
      HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT,
      RING_CAPACITY
    );
    this.node = new AudioWorkletNode(context, 'calcotone-visualizer-ring-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { sharedBuffer, capacity: RING_CAPACITY },
    });
    this.silentSink = context.createGain();
    this.silentSink.gain.value = 0;
    this.node.connect(this.silentSink);
    this.silentSink.connect(context.destination);

    const bitCount = Math.log2(FFT_SIZE);
    for (let index = 0; index < FFT_SIZE; index += 1) {
      this.window[index] = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (FFT_SIZE - 1));
      let reversed = 0;
      let value = index;
      for (let bit = 0; bit < bitCount; bit += 1) {
        reversed = (reversed << 1) | (value & 1);
        value >>>= 1;
      }
      this.bitReversed[index] = reversed;
    }
    for (let index = 0; index < FFT_SIZE / 2; index += 1) {
      const angle = -2 * Math.PI * index / FFT_SIZE;
      this.cosine[index] = Math.cos(angle);
      this.sine[index] = Math.sin(angle);
    }
  }

  public connect(source: AudioNode): void {
    source.connect(this.node);
  }

  public getPresentationTimeSeconds(): number {
    try {
      const timestamp = this.context.getOutputTimestamp?.();
      if (
        timestamp
        && Number.isFinite(timestamp.contextTime)
        && Number.isFinite(timestamp.performanceTime)
        && timestamp.contextTime >= 0
      ) {
        return Math.max(0, timestamp.contextTime + (performance.now() - timestamp.performanceTime) / 1000);
      }
    } catch { /* browser may expose the method before the output clock is ready */ }

    const baseLatency = Number.isFinite(this.context.baseLatency) ? this.context.baseLatency : 0;
    const outputLatency = Number.isFinite(this.context.outputLatency) ? this.context.outputLatency : 0;
    return Math.max(0, this.context.currentTime - baseLatency - outputLatency);
  }

  public getByteFrequencyData(target: Uint8Array): void {
    if (this.readLatestSamples()) {
      this.transform();
      this.hasSnapshot = true;
    }
    if (!this.hasSnapshot) {
      target.fill(0);
      return;
    }
    const length = Math.min(target.length, FFT_BINS);
    for (let bin = 0; bin < length; bin += 1) {
      const magnitude = Math.hypot(this.real[bin], this.imaginary[bin]) / (FFT_SIZE * 0.5);
      const decibels = 20 * Math.log10(Math.max(1e-7, magnitude));
      target[bin] = Math.max(0, Math.min(255, Math.round((decibels + 90) / 78 * 255)));
    }
    if (target.length > length) target.fill(0, length);
  }

  public dispose(): void {
    this.node.disconnect();
    this.silentSink.disconnect();
    this.header.fill(0);
  }

  private readLatestSamples(): boolean {
    if (Atomics.load(this.header, AVAILABLE_SAMPLES) < FFT_SIZE) return false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const sequenceBefore = Atomics.load(this.header, WRITE_SEQUENCE);
      if (sequenceBefore & 1) continue;
      if (sequenceBefore === this.lastSnapshotSequence) return false;
      const writeIndex = Atomics.load(this.header, WRITE_INDEX);
      let readIndex = writeIndex - FFT_SIZE;
      if (readIndex < 0) readIndex += this.ring.length;
      for (let index = 0; index < FFT_SIZE; index += 1) {
        this.timeDomain[index] = this.ring[readIndex];
        readIndex += 1;
        if (readIndex === this.ring.length) readIndex = 0;
      }
      const sequenceAfter = Atomics.load(this.header, WRITE_SEQUENCE);
      if (sequenceBefore === sequenceAfter && !(sequenceAfter & 1)) {
        this.lastSnapshotSequence = sequenceAfter;
        return true;
      }
    }
    return false;
  }

  private transform(): void {
    for (let index = 0; index < FFT_SIZE; index += 1) {
      const destination = this.bitReversed[index];
      this.real[destination] = this.timeDomain[index] * this.window[index];
      this.imaginary[destination] = 0;
    }
    for (let size = 2; size <= FFT_SIZE; size <<= 1) {
      const half = size >> 1;
      const tableStep = FFT_SIZE / size;
      for (let start = 0; start < FFT_SIZE; start += size) {
        for (let offset = 0; offset < half; offset += 1) {
          const tableIndex = offset * tableStep;
          const even = start + offset;
          const odd = even + half;
          const oddReal = this.real[odd] * this.cosine[tableIndex]
            - this.imaginary[odd] * this.sine[tableIndex];
          const oddImaginary = this.real[odd] * this.sine[tableIndex]
            + this.imaginary[odd] * this.cosine[tableIndex];
          const evenReal = this.real[even];
          const evenImaginary = this.imaginary[even];
          this.real[even] = evenReal + oddReal;
          this.imaginary[even] = evenImaginary + oddImaginary;
          this.real[odd] = evenReal - oddReal;
          this.imaginary[odd] = evenImaginary - oddImaginary;
        }
      }
    }
  }
}
