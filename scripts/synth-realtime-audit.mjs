import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const failures = [];
const reports = [];
const source = readFileSync(resolve(process.cwd(), 'public/synth-circuit-processor.js'), 'utf8');
const controller = readFileSync(resolve(process.cwd(), 'src/audio/SynthEngine.ts'), 'utf8');

const requireText = (text, needle, label) => {
  if (!text.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (text, needle, label) => {
  if (text.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

for (const token of [
  'this.voices = Array.from({ length: MAX_VOICES }, () => this.createVoiceSlot())',
  'this.activeVoiceIndices = new Uint8Array(MAX_VOICES)',
  'this.activeVoiceCount = 0',
  'createVoiceSlot()',
  'const captureSourceOffsets = new Int32Array(4)',
  'findFreeVoiceIndex()',
  'this.activeVoiceIndices[this.activeVoiceCount++] = voiceIndex',
  'voice.opPhases.fill(0)',
  'voice.poles.fill(0)',
  'voice.captureSourceOffsets.fill(-1)',
  'this.noteOn(\n          71 - note.pitch',
  'this.sequencerStepMessage = {',
  'this.telemetryMessage = {',
  'const message = this.telemetryMessage',
  'fastTanh(input * voice.spiceDrive)',
  'return fastTanh(voice.poles[3] / signalVoltage * 1.18)',
  'return fastTanh(clamp(normalizedVoltage, -12, 12))',
  "data.type === 'chord-on'",
  'const HALF_BAND_15 = new Float64Array([',
  'class HalfBandDecimator2',
  'this.decimator2x = new HalfBandDecimator2()',
  'this.decimator4xStage1 = new HalfBandDecimator2()',
  'this.decimator4xStage2 = new HalfBandDecimator2()',
  'this.resetDecimators()',
  'this.decimator2x.push(normalizedSubL, normalizedSubR)',
  'this.decimator4xStage1.push(normalizedSubL, normalizedSubR)',
  'this.decimator4xStage2.push(',
  'voiceNormalization = Math.sqrt(Math.max(1, normalizationVoiceCount) * .72)',
]) requireText(source, token, 'Synth realtime contract');

for (const token of [
  'this.voices = []',
  'this.voices.splice(',
  'this.voices.push(',
  'const ladderCapacitances = new Float64Array(4);\n    const ladderMismatch = new Float64Array(4);\n    for (let pole = 0; pole < 4; pole += 1) {\n      ladderCapacitances[pole] = MODEL_D_CAPACITANCE_F * (1 + componentDrift',
  'this.noteOn({',
  'const buses = [this.hybridBusL, this.hybridBusR]',
  'sumL += subL',
  'sumR += subR',
  'normalization = quality * Math.sqrt',
]) forbidText(source, token, 'Synth retired allocation/box-decimation path');

const halfBandMatch = source.match(/const HALF_BAND_15 = new Float64Array\(\[([\s\S]*?)\]\);/);
if (!halfBandMatch) {
  failures.push('Synth half-band contract: coefficient table not found');
} else {
  const coefficients = halfBandMatch[1]
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
  if (coefficients.length !== 15) failures.push(`Synth half-band contract: expected 15 taps, found ${coefficients.length}`);
  const sum = coefficients.reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) > 1e-9) failures.push(`Synth half-band contract: DC gain must equal 1, found ${sum}`);
  if (Math.abs((coefficients[7] ?? 0) - .5) > 1e-12) failures.push('Synth half-band contract: center tap must remain 0.5');
  for (const index of [1, 3, 5, 9, 11, 13]) {
    if (Math.abs(coefficients[index] ?? 1) > 1e-12) failures.push(`Synth half-band contract: odd tap ${index} must be zero`);
  }
  for (let index = 0; index < coefficients.length; index += 1) {
    const mirror = coefficients.length - 1 - index;
    if (Math.abs(coefficients[index] - coefficients[mirror]) > 1e-12) {
      failures.push(`Synth half-band contract: taps ${index}/${mirror} are not symmetric`);
      break;
    }
  }
}

const tanhCalls = source.match(/Math\.tanh\(/g)?.length ?? 0;
if (tanhCalls !== 2) failures.push(`Synth tanh LUT contract: expected exactly 2 setup-time Math.tanh calls, found ${tanhCalls}`);

const noteStart = source.indexOf('  noteOn(');
const noteEnd = source.indexOf('  refreshVoiceCoefficients(', noteStart);
if (noteStart < 0 || noteEnd < 0) failures.push('Synth noteOn allocation audit: function boundaries missing');
else {
  const noteBody = source.slice(noteStart, noteEnd);
  forbidText(noteBody, 'new Float', 'Synth noteOn typed-array allocation');
  forbidText(noteBody, 'new Int', 'Synth noteOn typed-array allocation');
  forbidText(noteBody, '.push(', 'Synth noteOn dynamic collection growth');
  forbidText(noteBody, '.splice(', 'Synth noteOn dynamic collection mutation');
}

const hybridStart = source.indexOf('  refreshHybridBuses(');
const hybridEnd = source.indexOf('  resetDecimators()', hybridStart);
if (hybridStart < 0 || hybridEnd < 0) failures.push('Synth hybrid-bus allocation audit: function boundaries missing');
else {
  const hybridBody = source.slice(hybridStart, hybridEnd);
  forbidText(hybridBody, '[this.hybridBusL, this.hybridBusR]', 'Synth hybrid-bus scratch allocation');
  forbidText(hybridBody, '.map(', 'Synth hybrid-bus scratch allocation');
}

for (const token of [
  'if (enabled === this.enabled) return',
  'if (machine === this.machine) return',
  'if (archetype === this.archetype) return',
  'if (factor === this.qualityFactor) return',
  'if (mode === this.renderMode) return',
  'private readonly parameterMessage = {',
  'if (!changed) return',
  'this.processor.port.postMessage(this.parameterMessage)',
]) requireText(controller, token, 'Synth controller diff contract');
forbidText(controller, 'values: Array.from({ length: 6 }', 'Synth controller parameter payload allocation');

class MockAudioWorkletProcessor {
  constructor() {
    this.port = {
      messages: [],
      onmessage: null,
      postMessage: (message) => this.port.messages.push({ ...message }),
      close() {},
    };
  }
}

let Processor = null;
const vmContext = {
  sampleRate: SAMPLE_RATE,
  AudioWorkletProcessor: MockAudioWorkletProcessor,
  registerProcessor(name, registered) {
    if (name === 'calcotone-synth-circuit-processor') Processor = registered;
  },
};
runInNewContext(source, vmContext);
if (!Processor) failures.push('Synth worklet did not register');

function renderScenario(quality, machine) {
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'enabled', value: true } });
  processor.port.onmessage({ data: { type: 'quality', factor: quality } });
  processor.port.onmessage({ data: { type: 'machine', value: machine } });
  processor.port.onmessage({ data: { type: 'parameters', values: [.58, .46, .26, .54, .22, .08], morphSeconds: 0 } });
  processor.port.onmessage({ data: { type: 'note-on', midi: 48, durationSeconds: .18, velocity: .74 } });
  processor.port.onmessage({ data: { type: 'chord-on', notes: [55, 59, 62], durationSeconds: .22, velocity: .62 } });

  let peak = 0;
  let energy = 0;
  for (let block = 0; block < 120; block += 1) {
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    processor.process([], [[left, right]]);
    for (let sample = 0; sample < BLOCK_SIZE; sample += 1) {
      const l = left[sample];
      const r = right[sample];
      if (!Number.isFinite(l) || !Number.isFinite(r)) {
        failures.push(`Synth ${machine} ${quality}x: non-finite sample`);
        return;
      }
      peak = Math.max(peak, Math.abs(l), Math.abs(r));
      energy += l * l + r * r;
    }
  }
  const rms = Math.sqrt(energy / (120 * BLOCK_SIZE * 2));
  reports.push(`${machine} ${quality}x peak=${peak.toFixed(4)} rms=${rms.toFixed(5)}`);
  if (peak <= 0.001 || rms <= 0.0001) failures.push(`Synth ${machine} ${quality}x: rendered silence`);
  if (peak > 1.05) failures.push(`Synth ${machine} ${quality}x: peak exceeded limiter contract (${peak.toFixed(4)})`);
  if (processor.voices.length !== 10) failures.push(`Synth ${machine} ${quality}x: voice pool size changed (${processor.voices.length})`);
  if (processor.activeVoiceCount > 10) failures.push(`Synth ${machine} ${quality}x: active voice count exceeded pool`);
}

if (Processor) {
  for (const quality of [1, 2, 4]) renderScenario(quality, 'model-d');
  for (const machine of ['dx7', 'ms-20', 'ppg-wave', 'calcotone']) renderScenario(2, machine);

  const qualitySwitch = new Processor();
  qualitySwitch.port.onmessage({ data: { type: 'enabled', value: true } });
  qualitySwitch.port.onmessage({ data: { type: 'note-on', midi: 52, durationSeconds: .4, velocity: .7 } });
  for (const factor of [1, 2, 4, 2, 1]) {
    qualitySwitch.port.onmessage({ data: { type: 'quality', factor } });
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    qualitySwitch.process([], [[left, right]]);
    for (let sample = 0; sample < BLOCK_SIZE; sample += 1) {
      if (!Number.isFinite(left[sample]) || !Number.isFinite(right[sample])) {
        failures.push(`Synth quality switch ${factor}x: non-finite sample`);
        break;
      }
    }
  }

  const sequencer = new Processor();
  sequencer.port.onmessage({ data: { type: 'enabled', value: true } });
  sequencer.port.onmessage({
    data: {
      type: 'sequencer-state',
      patterns: Array.from({ length: 4 }, (_, pattern) => Array.from({ length: 16 }, (_, step) =>
        pattern === 0 && step === 0 ? [{ pitch: 0, length: 1 }, { pitch: 4, length: 1 }] : [])),
      patternIndex: 0,
      chain: [0],
      chainArmed: false,
      chainPosition: 0,
      bpm: 120,
      playing: true,
      startStep: 0,
    },
  });
  for (let block = 0; block < 220; block += 1) {
    sequencer.process([], [[new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)]]);
  }
  const steps = sequencer.port.messages.filter((message) => message.type === 'sequencer-step');
  if (steps.length === 0) failures.push('Synth sequencer: no step telemetry emitted');
  if (sequencer.voices.length !== 10) failures.push('Synth sequencer: fixed voice pool was resized');
  reports.push(`sequencer steps=${steps.length} pool=${sequencer.voices.length} active=${sequencer.activeVoiceCount}`);
}

for (const report of reports) console.log(report);
if (failures.length) {
  console.error(`Synth realtime audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Synth realtime audit passed · fixed voice pool, allocation-free hybrid refresh, LUT nonlinearities and half-band 1x/2x/4x rendering are intact');
