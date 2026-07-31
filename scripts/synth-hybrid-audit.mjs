import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const WARMUP_SECONDS = .015;
const MEASURED_SECONDS = .075;
const root = process.cwd();
const processorSource = readFileSync(resolve(root, 'public/synth-circuit-processor.js'), 'utf8');
const controllerSource = readFileSync(resolve(root, 'src/audio/SynthEngine.ts'), 'utf8');
const manifest = JSON.parse(readFileSync(
  resolve(root, 'public/synth-captures/model-d-panel-init.json'),
  'utf8',
));
const pcm = readFileSync(resolve(root, 'public/synth-captures/model-d-panel-init.f32'));
const failures = [];

for (const integration of [
  'synth-captures/model-d-panel-init.json',
  'synth-captures/model-d-panel-init.f32',
  'captureDigestMatches(samples, manifest.sha256)',
  "type: 'capture-bank'",
]) {
  if (!controllerSource.includes(integration)) {
    failures.push(`Synth controller is missing capture integration ${JSON.stringify(integration)}`);
  }
}

if (manifest.format !== 'float32-le') failures.push(`Capture format is ${manifest.format}, expected float32-le`);
if (manifest.sampleRate !== SAMPLE_RATE) failures.push(`Capture sample rate is ${manifest.sampleRate}, expected ${SAMPLE_RATE}`);
if (manifest.quality !== 4) failures.push(`Capture quality is ${manifest.quality}, expected 4×`);
if (manifest.byteLength !== pcm.byteLength) {
  failures.push(`Capture manifest declares ${manifest.byteLength} bytes but PCM contains ${pcm.byteLength}`);
}
const digest = createHash('sha256').update(pcm).digest('hex');
if (manifest.sha256 !== digest) failures.push('Capture PCM digest does not match its manifest');
const tapNames = new Set(manifest.entries.map((entry) => entry.tap));
for (const tap of ['tone', 'source-00', 'source-10', 'source-01', 'source-11']) {
  if (!tapNames.has(tap)) failures.push(`Capture bank is missing ${tap}`);
}

const Processor = loadProcessor(processorSource);
const circuit = benchmarkMode('circuit');
const capture = benchmarkMode('capture');
const hybrid = benchmarkMode('hybrid');
const automatic = renderMode('auto', [.58, .46, .26, .54, .22, .08], 1, .05);
const fallback = renderAutoWithoutBank();
const sourceLow = renderMode('hybrid', [0, .46, .26, .54, .22, 0], 1, .05);
const sourceHigh = renderMode('hybrid', [1, .46, .26, .54, .22, 1], 1, .05);

for (const result of [circuit, capture, hybrid, automatic, fallback, sourceLow, sourceHigh]) {
  if (!Number.isFinite(result.rms) || result.rms < .0001) {
    failures.push(`${result.mode} render is silent or invalid (${result.rms})`);
  }
  if (!Number.isFinite(result.peak) || result.peak > 1.001) {
    failures.push(`${result.mode} render exceeded its bounded output (${result.peak})`);
  }
}
if (capture.elapsedMilliseconds >= circuit.elapsedMilliseconds * .45) {
  failures.push(
    `Capture path was not materially faster than circuit `
    + `(${capture.elapsedMilliseconds.toFixed(1)} ms vs ${circuit.elapsedMilliseconds.toFixed(1)} ms)`,
  );
}
if (hybrid.elapsedMilliseconds >= circuit.elapsedMilliseconds * .65) {
  failures.push(
    `Hybrid path was not materially faster than circuit `
    + `(${hybrid.elapsedMilliseconds.toFixed(1)} ms vs ${circuit.elapsedMilliseconds.toFixed(1)} ms)`,
  );
}
if (automatic.telemetry?.renderMode !== 'hybrid' || automatic.telemetry?.captureReady !== true) {
  failures.push('Auto mode did not select the ready Model D hybrid capture path');
}
if (fallback.telemetry?.renderMode !== 'circuit' || fallback.telemetry?.captureReady !== false) {
  failures.push('Auto mode did not preserve circuit fallback while the capture bank was unavailable');
}
if (Math.abs(sourceLow.signature - sourceHigh.signature) < .002) {
  failures.push('Captured oscillator corner interpolation did not respond to Source/Motion controls');
}

if (failures.length > 0) {
  console.error('\nCALCOTONE synth hybrid audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log(
  `CALCOTONE synth hybrid audit passed (10 voices/4×: circuit `
  + `${circuit.elapsedMilliseconds.toFixed(1)} ms, capture ${capture.elapsedMilliseconds.toFixed(1)} ms, `
  + `hybrid ${hybrid.elapsedMilliseconds.toFixed(1)} ms for ${Math.round(MEASURED_SECONDS * 1_000)} ms audio; `
  + `${manifest.entries.length} lossless captures, ${digest.slice(0, 12)}).`,
);

function benchmarkMode(mode) {
  const result = renderMode(mode, [.58, .46, .26, .54, .22, .08], 10, WARMUP_SECONDS);
  const processor = result.processor;
  const startedAt = performance.now();
  const measured = renderProcessor(processor, MEASURED_SECONDS);
  return {
    ...measured,
    mode,
    elapsedMilliseconds: performance.now() - startedAt,
    telemetry: readTelemetry(processor),
  };
}

function renderMode(mode, parameters, voices, seconds) {
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'enabled', value: true } });
  processor.port.onmessage({ data: { type: 'machine', value: 'model-d' } });
  processor.port.onmessage({ data: { type: 'parameters', values: parameters } });
  processor.port.onmessage({ data: { type: 'quality', factor: mode === 'auto' ? 2 : 4 } });
  processor.port.onmessage({
    data: {
      type: 'capture-bank',
      manifest,
      samples: pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength),
    },
  });
  processor.port.onmessage({ data: { type: 'render-mode', value: mode } });
  for (let voice = 0; voice < voices; voice += 1) {
    processor.port.onmessage({
      data: {
        type: 'note-on',
        midi: 42 + voice * 3,
        durationSeconds: 4,
        velocity: .82,
        seed: 0x13ac9 + voice * 97,
      },
    });
  }
  processor.telemetryCountdown = 1;
  const rendered = renderProcessor(processor, seconds);
  return {
    ...rendered,
    mode,
    processor,
    elapsedMilliseconds: 0,
    telemetry: readTelemetry(processor),
  };
}

function renderAutoWithoutBank() {
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'enabled', value: true } });
  processor.port.onmessage({ data: { type: 'machine', value: 'model-d' } });
  processor.port.onmessage({ data: { type: 'quality', factor: 1 } });
  processor.port.onmessage({ data: { type: 'render-mode', value: 'auto' } });
  processor.port.onmessage({
    data: {
      type: 'note-on',
      midi: 60,
      durationSeconds: 1,
      velocity: .82,
      seed: 0x13ac9,
    },
  });
  processor.telemetryCountdown = 1;
  const rendered = renderProcessor(processor, .025);
  return {
    ...rendered,
    mode: 'auto-fallback',
    elapsedMilliseconds: 0,
    telemetry: readTelemetry(processor),
  };
}

function renderProcessor(processor, seconds) {
  const blocks = Math.ceil(seconds * SAMPLE_RATE / BLOCK_SIZE);
  let sum = 0;
  let peak = 0;
  let signature = 0;
  let samples = 0;
  for (let block = 0; block < blocks; block += 1) {
    const channels = [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)];
    processor.process([], [channels]);
    for (const channel of channels) {
      for (let index = 0; index < channel.length; index += 1) {
        const value = channel[index];
        if (!Number.isFinite(value)) return { rms: NaN, peak: NaN, signature: NaN };
        sum += value * value;
        peak = Math.max(peak, Math.abs(value));
        signature += Math.abs(value) * ((index & 7) + 1);
        samples += 1;
      }
    }
  }
  return {
    rms: Math.sqrt(sum / Math.max(1, samples)),
    peak,
    signature: signature / Math.max(1, samples),
  };
}

function readTelemetry(processor) {
  return processor.port.messages.findLast?.((message) => message.type === 'telemetry')
    ?? [...processor.port.messages].reverse().find((message) => message.type === 'telemetry');
}

function loadProcessor(source) {
  class MockAudioWorkletProcessor {
    constructor() {
      this.port = {
        messages: [],
        onmessage: null,
        postMessage: (message) => this.port.messages.push(message),
        close() {},
      };
    }
  }
  let ProcessorClass = null;
  runInNewContext(source, {
    sampleRate: SAMPLE_RATE,
    AudioWorkletProcessor: MockAudioWorkletProcessor,
    registerProcessor(name, candidate) {
      if (name === 'calcotone-synth-circuit-processor') ProcessorClass = candidate;
    },
  });
  if (!ProcessorClass) throw new Error('Synth circuit processor did not register for hybrid audit.');
  return ProcessorClass;
}
