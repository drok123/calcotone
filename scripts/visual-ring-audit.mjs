import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = process.cwd();
const failures = [];
const processorSource = readFileSync(resolve(root, 'public/visualizer-ring-processor.js'), 'utf8');
const sharedSource = readFileSync(resolve(root, 'src/visual/SharedVisualSpectrum.ts'), 'utf8');
const visualEngine = readFileSync(resolve(root, 'src/visual/VisualEngine.ts'), 'utf8');
const waterfall = readFileSync(resolve(root, 'src/components/meters/SpectrumWaterfall.tsx'), 'utf8');
const nativeSpectrum = readFileSync(resolve(root, 'src/visual/NativeVisualSpectrum.ts'), 'utf8');
const nativeSpectrumCore = readFileSync(resolve(root, 'native/include/calcotone/native_visual_spectrum.hpp'), 'utf8');
const audioEngine = readFileSync(resolve(root, 'src/audio/AudioEngine.ts'), 'utf8');

const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

requireText(sharedSource, "if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') return null", 'Cross-origin-isolation fallback');
requireText(sharedSource, 'Atomics.load(this.header, WRITE_SEQUENCE)', 'Lock-free reader sequence guard');
requireText(sharedSource, 'sequenceBefore === sequenceAfter', 'Consistent reader snapshot');
requireText(sharedSource, 'private readonly real = new Float32Array(FFT_SIZE)', 'Reusable FFT storage');
requireText(sharedSource, 'lastSnapshotSequence', 'Duplicate FFT snapshot guard');
requireText(sharedSource, 'getOutputTimestamp', 'WebAudio presentation clock');
requireText(visualEngine, 'latestVisualOwner', 'Shared visual snapshot ownership guard');
requireText(visualEngine, 'getPresentationTimeSeconds?.()', 'Audio-clocked visual timeline');
requireText(visualEngine, 'requestAnimationFrame(render)', 'UI animation-frame scheduler');
requireText(waterfall, 'const frequencyData = new Uint8Array(frequencyBinCount)', 'Waterfall reusable frequency buffer');
requireText(waterfall, 'analyser.getByteFrequencyData(frequencyData)', 'Waterfall direct live analyser read');
forbidText(waterfall, 'getLatestVisualSpectrum()', 'Waterfall global snapshot dependency');
requireText(nativeSpectrum, "const NATIVE_SPECTRUM_URL = 'http://127.0.0.1:48157/spectrum'", 'Native spectrum endpoint');
requireText(nativeSpectrum, 'const NATIVE_SPECTRUM_INTERVAL_MS = 50', 'Native spectrum request throttle');
requireText(nativeSpectrum, 'getPresentationTimeSeconds()', 'Native processed-frame visual clock');
requireText(nativeSpectrumCore, 'for (std::size_t size = 2U; size <= kFftSize; size <<= 1U)', 'Native radix-2 FFT stages');
requireText(nativeSpectrumCore, 'reverse_bits(index)', 'Native FFT bit reversal');
requireText(nativeSpectrumCore, 'hann_window()', 'Native reusable Hann window');
requireText(nativeSpectrumCore, 'cosine_table()', 'Native reusable FFT cosine table');
requireText(nativeSpectrumCore, 'sine_table()', 'Native reusable FFT sine table');
requireText(nativeSpectrumCore, 'staging_samples_[staging_write_]', 'Native audio-thread staging ring');
requireText(nativeSpectrumCore, 'snapshot_interval_frames_', 'Native spectrum publication cadence');
requireText(nativeSpectrumCore, 'snapshot_sequence_.fetch_add(1U, std::memory_order_release)', 'Native coherent snapshot generation');
requireText(nativeSpectrumCore, 'if (frames_since_snapshot_ < snapshot_interval_frames_) return', 'Native spectrum batched publication guard');
forbidText(nativeSpectrumCore, 'samples_[write].store', 'Per-sample native atomic spectrum publication');
forbidText(nativeSpectrumCore, 'for (std::size_t sample = 0; sample < kFftSize; ++sample)', 'Quadratic native DFT loop');
requireText(audioEngine, 'this.sharedVisualSpectrum?.connect(this.analyser)', 'Parallel master visual tap');
requireText(audioEngine, 'return this.sharedVisualSpectrum ?? this.analyser', 'Native analyser fallback');

class MockAudioWorkletProcessor {
  constructor() { this.port = { onmessage: null, postMessage() {} }; }
}

let Processor = null;
runInNewContext(processorSource, {
  AudioWorkletProcessor: MockAudioWorkletProcessor,
  SharedArrayBuffer,
  Int32Array,
  Float32Array,
  Atomics,
  registerProcessor(name, candidate) {
    if (name === 'calcotone-visualizer-ring-processor') Processor = candidate;
  },
});

if (!Processor) {
  failures.push('Visualizer ring processor did not register');
} else {
  const headerWords = 4;
  const capacity = 256;
  const sharedBuffer = new SharedArrayBuffer(
    headerWords * Int32Array.BYTES_PER_ELEMENT + capacity * Float32Array.BYTES_PER_ELEMENT
  );
  const header = new Int32Array(sharedBuffer, 0, headerWords);
  const ring = new Float32Array(sharedBuffer, headerWords * Int32Array.BYTES_PER_ELEMENT, capacity);
  const processor = new Processor({ processorOptions: { sharedBuffer, capacity } });
  let expectedLast = 0;
  for (let block = 0; block < 9; block += 1) {
    const left = new Float32Array(64);
    const right = new Float32Array(64);
    for (let frame = 0; frame < 64; frame += 1) {
      left[frame] = block + frame / 100;
      right[frame] = left[frame] + .2;
      expectedLast = left[frame] + .1;
    }
    processor.process([[left, right]], [[]]);
  }
  const writeIndex = Atomics.load(header, 0);
  const lastIndex = (writeIndex - 1 + capacity) % capacity;
  if (Math.abs(ring[lastIndex] - expectedLast) > 1e-5) failures.push('Ring wraparound lost the newest mono sample');
  if (Atomics.load(header, 1) !== capacity) failures.push('Ring available count did not saturate at capacity');
  if (Atomics.load(header, 2) & 1) failures.push('Ring write sequence remained in the active/odd state');
}

if (failures.length) {
  console.error('\nCALCOTONE visual ring audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('CALCOTONE visual ring audit passed (lock-free browser ring, batched native snapshot, radix-2 FFT, audio presentation clocks, analyser fallback).');
