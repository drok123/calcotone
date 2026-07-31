import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const WARMUP_SECONDS = .04;
const MEASURED_SECONDS = .075;
const BASE_PARAMETERS = [.58, .46, .26, .54, .22, .08];
const PARAMETER_NAMES = ['SOURCE', 'COLOR', 'RESONANCE', 'CONTOUR', 'CHARACTER', 'MOTION'];
const CAPTURE_SEED = 0x13ac9;
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
  "export type SynthRenderMode = 'auto' | 'circuit' | 'capture' | 'hybrid'",
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
if (pcm.byteLength > 8 * 1024 * 1024) {
  failures.push(`Capture bank grew beyond the 8 MiB phase-four load budget (${formatBytes(pcm.byteLength)})`);
}
const digest = createHash('sha256').update(pcm).digest('hex');
if (manifest.sha256 !== digest) failures.push('Capture PCM digest does not match its manifest');
const tapNames = new Set(manifest.entries.map((entry) => entry.tap));
for (const tap of ['tone', 'source-00', 'source-10', 'source-01', 'source-11']) {
  if (!tapNames.has(tap)) failures.push(`Capture bank is missing ${tap}`);
}

const Processor = loadProcessor(processorSource);
const installStartedAt = performance.now();
const installProbe = createProcessor({ mode: 'hybrid', quality: 2, voices: 0 });
const installMilliseconds = performance.now() - installStartedAt;
if (!installProbe.captureBank || installProbe.captureBank.entries.length !== manifest.entries.length) {
  failures.push('Capture bank did not install completely');
}
if (installMilliseconds > 250) {
  failures.push(`Capture bank install exceeded 250 ms (${installMilliseconds.toFixed(1)} ms)`);
}

const benchmarkMatrix = new Map();
for (const quality of [1, 2, 4]) {
  for (const mode of ['circuit', 'capture', 'hybrid']) {
    const result = benchmarkMode(mode, quality);
    benchmarkMatrix.set(`${mode}-${quality}`, result);
    assertHealthy(result, `${mode}/${quality}× chord`);
  }
  const circuit = benchmarkMatrix.get(`circuit-${quality}`);
  const capture = benchmarkMatrix.get(`capture-${quality}`);
  const hybrid = benchmarkMatrix.get(`hybrid-${quality}`);
  if (capture.elapsedMilliseconds >= circuit.elapsedMilliseconds * .65) {
    failures.push(
      `Capture/${quality}× was not materially faster than circuit `
      + `(${capture.elapsedMilliseconds.toFixed(1)} ms vs ${circuit.elapsedMilliseconds.toFixed(1)} ms)`,
    );
  }
  if (hybrid.elapsedMilliseconds >= circuit.elapsedMilliseconds * .82) {
    failures.push(
      `Hybrid/${quality}× was not materially faster than circuit `
      + `(${hybrid.elapsedMilliseconds.toFixed(1)} ms vs ${circuit.elapsedMilliseconds.toFixed(1)} ms)`,
    );
  }
}

const automatic = renderScenario({ mode: 'auto', quality: 2, voices: 1, seconds: .05 });
const fallback = renderAutoWithoutBank();
assertHealthy(automatic, 'automatic hybrid');
assertHealthy(fallback, 'automatic circuit fallback');
if (automatic.telemetry?.renderMode !== 'hybrid' || automatic.telemetry?.captureReady !== true) {
  failures.push('Auto mode did not select the ready Model D hybrid capture path');
}
if (fallback.telemetry?.renderMode !== 'circuit' || fallback.telemetry?.captureReady !== false) {
  failures.push('Auto mode did not preserve circuit fallback while the capture bank was unavailable');
}

const onsetResults = ['circuit', 'capture', 'hybrid'].map((mode) => {
  const result = renderScenario({ mode, quality: 4, voices: 1, seconds: .03 });
  const onset = firstAudibleFrame(result.left);
  if (onset < 0 || onset > Math.ceil(SAMPLE_RATE * .012)) {
    failures.push(`${mode} note onset exceeded the 12 ms timing budget (${onset} frames)`);
  }
  return { mode, onset };
});
const onsetSpread = Math.max(...onsetResults.map(({ onset }) => onset))
  - Math.min(...onsetResults.map(({ onset }) => onset));
if (onsetSpread > 64) failures.push(`A/B note-on timing diverged by ${onsetSpread} frames`);

for (const mode of ['capture', 'hybrid']) {
  const sustained = renderScenario({
    mode,
    quality: 4,
    voices: 1,
    seconds: 1.15,
    noteDuration: 4,
    midiStart: 60,
  });
  assertHealthy(sustained, `${mode} long sustain`);
  const tail = sustained.left.subarray(Math.floor(sustained.left.length * .78));
  if (rms(tail) < sustained.rms * .22) failures.push(`${mode} long sustain collapsed before note release`);
  if (maxDelta(tail) > Math.max(.08, rms(tail) * 10)) {
    failures.push(`${mode} sustain exposed an audible capture-loop discontinuity`);
  }
}

const retrigger = rapidRetriggerStress();
assertHealthy(retrigger, 'rapid retrigger');
if (retrigger.maxVoices > 24) failures.push(`Rapid retrigger exceeded the 24-voice ceiling (${retrigger.maxVoices})`);

const fidelity = compareFidelity();
if (fidelity.captureSpectralSimilarity < .72) {
  failures.push(`Full Capture spectral similarity fell below 0.72 (${fidelity.captureSpectralSimilarity.toFixed(3)})`);
}
if (fidelity.hybridSpectralSimilarity < .60) {
  failures.push(`Hybrid spectral similarity fell below 0.60 (${fidelity.hybridSpectralSimilarity.toFixed(3)})`);
}
if (fidelity.captureNullResidual > 1.25) {
  failures.push(`Full Capture aligned null residual exceeded 1.25 (${fidelity.captureNullResidual.toFixed(3)})`);
}

const knobSweep = [];
for (let parameterIndex = 0; parameterIndex < PARAMETER_NAMES.length; parameterIndex += 1) {
  const lowParameters = [...BASE_PARAMETERS];
  const highParameters = [...BASE_PARAMETERS];
  lowParameters[parameterIndex] = .04;
  highParameters[parameterIndex] = .96;
  const low = renderScenario({
    mode: 'hybrid',
    quality: 2,
    voices: 1,
    seconds: .18,
    warmupSeconds: .20,
    parameters: lowParameters,
    midiStart: 60,
  });
  const high = renderScenario({
    mode: 'hybrid',
    quality: 2,
    voices: 1,
    seconds: .18,
    warmupSeconds: .20,
    parameters: highParameters,
    midiStart: 60,
  });
  assertHealthy(low, `${PARAMETER_NAMES[parameterIndex]} low sweep`);
  assertHealthy(high, `${PARAMETER_NAMES[parameterIndex]} high sweep`);
  const distance = normalizedWaveDistance(low.left, high.left);
  knobSweep.push({ name: PARAMETER_NAMES[parameterIndex], distance });
  if (distance < .075) {
    failures.push(`${PARAMETER_NAMES[parameterIndex]} did not materially affect Hybrid Capture (${distance.toFixed(3)})`);
  }
}

if (failures.length > 0) {
  console.error('\nCALCOTONE synth hybrid phase-four audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

const q4Circuit = benchmarkMatrix.get('circuit-4');
const q4Capture = benchmarkMatrix.get('capture-4');
const q4Hybrid = benchmarkMatrix.get('hybrid-4');
console.log(
  `CALCOTONE synth hybrid phase-four audit passed (10 voices/4×: circuit `
  + `${q4Circuit.elapsedMilliseconds.toFixed(1)} ms, capture ${q4Capture.elapsedMilliseconds.toFixed(1)} ms, `
  + `hybrid ${q4Hybrid.elapsedMilliseconds.toFixed(1)} ms for ${Math.round(MEASURED_SECONDS * 1_000)} ms audio; `
  + `spectral ${fidelity.captureSpectralSimilarity.toFixed(3)}/${fidelity.hybridSpectralSimilarity.toFixed(3)}; `
  + `null ${fidelity.captureNullResidual.toFixed(3)}; install ${installMilliseconds.toFixed(1)} ms; `
  + `${manifest.entries.length} captures/${formatBytes(pcm.byteLength)}; `
  + `controls ${knobSweep.map(({ name, distance }) => `${name}:${distance.toFixed(2)}`).join(' ')}).`,
);

function createProcessor({
  mode = 'hybrid',
  quality = 2,
  parameters = BASE_PARAMETERS,
  voices = 1,
  midiStart = 42,
  noteDuration = 4,
  installBank = true,
} = {}) {
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'enabled', value: true } });
  processor.port.onmessage({ data: { type: 'machine', value: 'model-d' } });
  processor.port.onmessage({ data: { type: 'parameters', values: parameters } });
  processor.port.onmessage({ data: { type: 'quality', factor: quality } });
  if (installBank) {
    processor.port.onmessage({
      data: {
        type: 'capture-bank',
        manifest,
        samples: pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength),
      },
    });
  }
  processor.port.onmessage({ data: { type: 'render-mode', value: mode } });
  for (let voice = 0; voice < voices; voice += 1) {
    processor.port.onmessage({
      data: {
        type: 'note-on',
        midi: midiStart + voice * 3,
        durationSeconds: noteDuration,
        velocity: .82,
        seed: CAPTURE_SEED + voice * 97,
      },
    });
  }
  return processor;
}

function benchmarkMode(mode, quality) {
  const processor = createProcessor({ mode, quality, voices: 10 });
  renderProcessor(processor, WARMUP_SECONDS);
  processor.telemetryCountdown = 1;
  const startedAt = performance.now();
  const measured = renderProcessor(processor, MEASURED_SECONDS);
  return {
    ...measured,
    mode,
    quality,
    elapsedMilliseconds: performance.now() - startedAt,
    telemetry: readTelemetry(processor),
  };
}

function renderScenario({
  mode,
  quality,
  parameters = BASE_PARAMETERS,
  voices,
  seconds,
  warmupSeconds = 0,
  midiStart = 42,
  noteDuration = 4,
}) {
  const processor = createProcessor({
    mode,
    quality,
    parameters,
    voices,
    midiStart,
    noteDuration,
  });
  if (warmupSeconds > 0) renderProcessor(processor, warmupSeconds);
  processor.telemetryCountdown = 1;
  return {
    ...renderProcessor(processor, seconds, true),
    mode,
    processor,
    telemetry: readTelemetry(processor),
  };
}

function renderAutoWithoutBank() {
  const processor = createProcessor({
    mode: 'auto',
    quality: 1,
    voices: 1,
    midiStart: 60,
    noteDuration: 1,
    installBank: false,
  });
  processor.telemetryCountdown = 1;
  return {
    ...renderProcessor(processor, .025, true),
    mode: 'auto-fallback',
    telemetry: readTelemetry(processor),
  };
}

function rapidRetriggerStress() {
  const processor = createProcessor({ mode: 'hybrid', quality: 2, voices: 0 });
  let maxVoices = 0;
  let sum = 0;
  let peak = 0;
  let sampleCount = 0;
  for (let trigger = 0; trigger < 64; trigger += 1) {
    processor.port.onmessage({
      data: {
        type: 'note-on',
        midi: 36 + (trigger * 5) % 49,
        durationSeconds: .035,
        velocity: .45 + (trigger % 5) * .1,
        seed: CAPTURE_SEED + trigger * 131,
      },
    });
    const block = renderProcessor(processor, BLOCK_SIZE / SAMPLE_RATE, true);
    maxVoices = Math.max(maxVoices, processor.voices.length);
    sum += block.rms * block.rms * block.samples;
    peak = Math.max(peak, block.peak);
    sampleCount += block.samples;
  }
  return {
    mode: 'hybrid rapid retrigger',
    rms: Math.sqrt(sum / Math.max(1, sampleCount)),
    peak,
    samples: sampleCount,
    maxVoices,
  };
}

function compareFidelity() {
  const modes = {};
  for (const mode of ['circuit', 'capture', 'hybrid']) {
    modes[mode] = renderScenario({
      mode,
      quality: 4,
      voices: 1,
      seconds: .17,
      warmupSeconds: .256,
      midiStart: 60,
      noteDuration: 4,
    });
  }
  const circuitSpectrum = spectralFingerprint(modes.circuit.left);
  const captureSpectrum = spectralFingerprint(modes.capture.left);
  const hybridSpectrum = spectralFingerprint(modes.hybrid.left);
  return {
    captureSpectralSimilarity: cosineSimilarity(circuitSpectrum, captureSpectrum),
    hybridSpectralSimilarity: cosineSimilarity(circuitSpectrum, hybridSpectrum),
    captureNullResidual: alignedNullResidual(modes.circuit.left, modes.capture.left),
  };
}

function renderProcessor(processor, seconds, retainAudio = false) {
  const blocks = Math.ceil(seconds * SAMPLE_RATE / BLOCK_SIZE);
  const retainedFrames = retainAudio ? blocks * BLOCK_SIZE : 0;
  const leftOutput = retainAudio ? new Float32Array(retainedFrames) : null;
  const rightOutput = retainAudio ? new Float32Array(retainedFrames) : null;
  let sum = 0;
  let peak = 0;
  let signature = 0;
  let samples = 0;
  let writeFrame = 0;
  for (let block = 0; block < blocks; block += 1) {
    const channels = [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)];
    processor.process([], [channels]);
    if (retainAudio) {
      leftOutput.set(channels[0], writeFrame);
      rightOutput.set(channels[1], writeFrame);
      writeFrame += BLOCK_SIZE;
    }
    for (const channel of channels) {
      for (let index = 0; index < channel.length; index += 1) {
        const value = channel[index];
        if (!Number.isFinite(value)) {
          return {
            rms: NaN,
            peak: NaN,
            signature: NaN,
            samples,
            left: leftOutput,
            right: rightOutput,
          };
        }
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
    samples,
    left: leftOutput,
    right: rightOutput,
  };
}

function assertHealthy(result, label) {
  if (!Number.isFinite(result.rms) || result.rms < .00001) {
    failures.push(`${label} render is silent or invalid (${result.rms})`);
  }
  if (!Number.isFinite(result.peak) || result.peak > 1.001) {
    failures.push(`${label} render exceeded its bounded output (${result.peak})`);
  }
}

function firstAudibleFrame(samples) {
  for (let index = 0; index < samples.length; index += 1) {
    if (Math.abs(samples[index]) >= 1e-5) return index;
  }
  return -1;
}

function rms(samples) {
  let sum = 0;
  for (const value of samples) sum += value * value;
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function maxDelta(samples) {
  let maximum = 0;
  for (let index = 1; index < samples.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(samples[index] - samples[index - 1]));
  }
  return maximum;
}

function normalizedWaveDistance(a, b) {
  const length = Math.min(a.length, b.length);
  let error = 0;
  let energy = 0;
  for (let index = 0; index < length; index += 1) {
    const difference = a[index] - b[index];
    error += difference * difference;
    energy += (a[index] * a[index] + b[index] * b[index]) * .5;
  }
  return Math.sqrt(error / Math.max(1e-12, energy));
}

function spectralFingerprint(samples) {
  const length = Math.min(4096, samples.length);
  const start = Math.max(0, samples.length - length);
  const frequencies = [55, 110, 220, 440, 880, 1760, 3520, 7040, 12_000];
  return frequencies.map((frequency) => {
    const omega = 2 * Math.PI * frequency / SAMPLE_RATE;
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < length; index += 1) {
      const window = .5 - .5 * Math.cos(2 * Math.PI * index / Math.max(1, length - 1));
      const sample = samples[start + index] * window;
      real += sample * Math.cos(omega * index);
      imaginary -= sample * Math.sin(omega * index);
    }
    return Math.log1p(Math.hypot(real, imaginary));
  });
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let energyA = 0;
  let energyB = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    dot += a[index] * b[index];
    energyA += a[index] * a[index];
    energyB += b[index] * b[index];
  }
  return dot / Math.max(1e-12, Math.sqrt(energyA * energyB));
}

function alignedNullResidual(reference, candidate) {
  const length = Math.min(4096, reference.length, candidate.length);
  const referenceStart = reference.length - length;
  const candidateStart = candidate.length - length;
  let best = Infinity;
  for (let lag = -384; lag <= 384; lag += 4) {
    let cross = 0;
    let candidateEnergy = 0;
    let referenceEnergy = 0;
    for (let index = 0; index < length; index += 1) {
      const candidateIndex = index + lag;
      if (candidateIndex < 0 || candidateIndex >= length) continue;
      const a = reference[referenceStart + index];
      const b = candidate[candidateStart + candidateIndex];
      cross += a * b;
      candidateEnergy += b * b;
      referenceEnergy += a * a;
    }
    const gain = cross / Math.max(1e-12, candidateEnergy);
    let error = 0;
    for (let index = 0; index < length; index += 1) {
      const candidateIndex = index + lag;
      if (candidateIndex < 0 || candidateIndex >= length) continue;
      const difference = reference[referenceStart + index]
        - candidate[candidateStart + candidateIndex] * gain;
      error += difference * difference;
    }
    best = Math.min(best, Math.sqrt(error / Math.max(1e-12, referenceEnergy)));
  }
  return best;
}

function readTelemetry(processor) {
  return processor.port.messages.findLast?.((message) => message.type === 'telemetry')
    ?? [...processor.port.messages].reverse().find((message) => message.type === 'telemetry');
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
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
