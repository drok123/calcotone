/* Lock-free, allocation-free mono visual tap. Audio never waits for the UI. */
const VISUAL_HEADER_WORDS = 4;
const WRITE_INDEX = 0;
const AVAILABLE_SAMPLES = 1;
const WRITE_SEQUENCE = 2;

class CalcotoneVisualizerRingProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const sharedBuffer = options?.processorOptions?.sharedBuffer;
    const capacity = options?.processorOptions?.capacity | 0;
    this.header = typeof SharedArrayBuffer !== 'undefined' && sharedBuffer instanceof SharedArrayBuffer
      ? new Int32Array(sharedBuffer, 0, VISUAL_HEADER_WORDS)
      : null;
    this.samples = this.header && capacity > 0
      ? new Float32Array(sharedBuffer, VISUAL_HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT, capacity)
      : null;
    this.capacity = this.samples?.length ?? 0;
  }

  process(inputs) {
    if (!this.header || !this.samples || this.capacity === 0) return true;
    const input = inputs[0];
    const left = input?.[0];
    if (!left?.length) return true;
    const right = input[1] ?? left;

    // Odd sequence means a write is active; even means readers may snapshot.
    Atomics.add(this.header, WRITE_SEQUENCE, 1);
    let writeIndex = Atomics.load(this.header, WRITE_INDEX);
    for (let frame = 0; frame < left.length; frame += 1) {
      this.samples[writeIndex] = (left[frame] + right[frame]) * 0.5;
      writeIndex += 1;
      if (writeIndex === this.capacity) writeIndex = 0;
    }
    Atomics.store(this.header, WRITE_INDEX, writeIndex);
    const available = Atomics.load(this.header, AVAILABLE_SAMPLES);
    Atomics.store(this.header, AVAILABLE_SAMPLES, Math.min(this.capacity, available + left.length));
    Atomics.add(this.header, WRITE_SEQUENCE, 1);
    return true;
  }
}

registerProcessor('calcotone-visualizer-ring-processor', CalcotoneVisualizerRingProcessor);
