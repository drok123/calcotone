import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const source = readFileSync(resolve(process.cwd(), 'public/drift-classic-processor.js'), 'utf8');
const nativeWrapper = readFileSync(resolve(process.cwd(), 'native/src/drift_parity_processor.cpp'), 'utf8');
const nativeStandard = readFileSync(resolve(process.cwd(), 'native/src/drift_standard_processor.cpp'), 'utf8');
const nativeClassic = readFileSync(resolve(process.cwd(), 'native/src/drift_classic_processor.cpp'), 'utf8');
const failures = [];
const reports = [];
const requireText = (needle) => { if (!source.includes(needle)) failures.push(`Drift realtime contract: missing ${JSON.stringify(needle)}`); };
const requireNative = (needle) => { if (!nativeWrapper.includes(needle)) failures.push(`Native Drift realtime contract: missing ${JSON.stringify(needle)}`); };
const requireStandard = (needle) => { if (!nativeStandard.includes(needle)) failures.push(`Native Drift Standard contract: missing ${JSON.stringify(needle)}`); };
const requireClassic = (needle) => { if (!nativeClassic.includes(needle)) failures.push(`Native Drift Classic contract: missing ${JSON.stringify(needle)}`); };

for (const token of [
  'const DRIFT_TANH_LUT = new Float32Array(2048)',
  'function driftTanh(value)',
  'return driftTanh(input * drive) / Math.max(1e-6, drive)',
  'this.leslieShape = -1',
  'leslieCrossoverCoefficient(shape)',
  'if (shape !== this.leslieShape)',
  'const crossover = this.leslieCrossoverCoefficient(shape)',
]) requireText(token);

for (const token of [
  'constexpr std::size_t kControlPeriod = 32U',
  'glide_amount = 1.F - std::exp',
  'void snapshot_targets() noexcept',
  'target_snapshot[i] = target[i].load(std::memory_order_relaxed)',
  'value[i] += (target_snapshot[i] - value[i]) * glide_amount',
  'if (refresh_control) refresh_routing_and_mix()',
  'dry_gain = std::cos(mix * kPi * .5F)',
  'wet_gain = std::sin(mix * kPi * .5F)',
]) requireNative(token);

for (const token of [
  'constexpr std::size_t kControlPeriod = 32U',
  'constexpr std::size_t kTanhTableSize = 4097U',
  'float fast_tanh(float value) noexcept',
  'settings = calculate_settings(mode, rate, depth, shape, spread, motion)',
  'input_tone[channel].configure(FilterType::Lowpass',
  'highpass[voice].configure(FilterType::Highpass',
  'lowpass[voice].configure(FilterType::Lowpass',
  'pan_left[voice] = std::cos(angle)',
  'pan_right[voice] = std::sin(angle)',
  'rotation_sine[voice] = std::sin(increment)',
  'rotation_cosine[voice] = std::cos(increment)',
  'return fast_tanh(shifted * preamp_gain) * preamp_normalization',
  'if (++write == delay[0].size()) write = 0U',
]) requireStandard(token);

for (const token of [
  'constexpr std::size_t kTanhTableSize = 4097U',
  'constexpr int kLeslieControlPeriod = 32',
  'double fast_tanh(double value) noexcept',
  'return fast_tanh(input * drive) / std::max(1e-6, drive)',
  'void refresh_leslie_control(double depth, double shape, double spread) noexcept',
  'leslie_crossover = 1.0 - std::exp',
  'leslie_offset_sine[index] = std::sin(offsets[index])',
  'leslie_offset_cosine[index] = std::cos(offsets[index])',
  'if (++delay_index == delay_l.size()) delay_index = 0U',
]) requireClassic(token);

const nativeProcessStart = nativeWrapper.indexOf('  void process(float* data, std::size_t frames) noexcept');
const nativeProcessEnd = nativeWrapper.indexOf('\n  }\n};', nativeProcessStart);
const nativeProcess = nativeProcessStart >= 0 && nativeProcessEnd > nativeProcessStart
  ? nativeWrapper.slice(nativeProcessStart, nativeProcessEnd)
  : '';
if (!nativeProcess) failures.push('Native Drift process() boundary missing');
else {
  if (nativeProcess.includes('std::exp(')) failures.push('Native Drift sample loop recomputes smoothing exponential');
  if (nativeProcess.includes('target[i].load(')) failures.push('Native Drift sample loop loads atomic targets directly');
  if (nativeProcess.includes('std::cos(mix')) failures.push('Native Drift sample loop recalculates mix cosine directly');
  if (nativeProcess.includes('std::sin(mix')) failures.push('Native Drift sample loop recalculates mix sine directly');
}

const standardProcessStart = nativeStandard.indexOf('  std::array<float, 2> process_sample(');
const standardProcessEnd = nativeStandard.indexOf('\n  }\n\n  void set_mode', standardProcessStart);
const standardProcess = standardProcessStart >= 0 && standardProcessEnd > standardProcessStart
  ? nativeStandard.slice(standardProcessStart, standardProcessEnd)
  : '';
if (!standardProcess) failures.push('Native Drift Standard process_sample() boundary missing');
else {
  for (const token of [
    'calculate_settings(', '.configure(', 'std::tanh(', 'std::sin(', 'std::cos(',
    'std::asin(', 'std::pow(', 'std::exp(', '% delay[0].size()',
  ]) {
    if (standardProcess.includes(token)) failures.push(`Native Drift Standard sample loop must not evaluate ${token}`);
  }
}
if (nativeStandard.includes('std::asin(std::sin(phase))')) failures.push('Native Drift Standard triangle LFO still uses sin+asin');
if (nativeStandard.includes('write = (write + 1U) % delay[0].size()')) failures.push('Native Drift Standard write cursor still uses modulo');
if (nativeStandard.includes('std::tanh(shifted * gain)')) failures.push('Native Drift Standard preamp still uses runtime tanh');

const classicLeslieStart = nativeClassic.indexOf('  std::array<float, 2> process_leslie(');
const classicLeslieEnd = nativeClassic.indexOf('\n  }\n\n  std::array<float, 2> process_phase90', classicLeslieStart);
const classicLeslie = classicLeslieStart >= 0 && classicLeslieEnd > classicLeslieStart
  ? nativeClassic.slice(classicLeslieStart, classicLeslieEnd)
  : '';
if (!classicLeslie) failures.push('Native Drift Classic Leslie boundary missing');
else {
  if (classicLeslie.includes('std::exp(')) failures.push('Native Drift Classic Leslie still computes crossover exp per sample');
  if (classicLeslie.includes('std::sin(rotor_horn_phase +')) failures.push('Native Drift Classic Leslie repeats horn phase-offset sin per sample');
  if (classicLeslie.includes('std::sin(rotor_drum_phase +')) failures.push('Native Drift Classic Leslie repeats drum phase-offset sin per sample');
}
if (nativeClassic.includes('std::tanh(input * drive)')) failures.push('Native Drift Classic phaser clipping still uses runtime tanh');
if (nativeClassic.includes('delay_index = (delay_index + 1U) % delay_l.size()')) failures.push('Native Drift Classic delay cursor still uses modulo');
if (nativeClassic.includes('static_cast<std::size_t>(floored) % buffer.size()')) failures.push('Native Drift Classic delay read still uses modulo');

const clipStart = source.indexOf('  normalizedSoftClip(');
const clipEnd = source.indexOf('  leslieCrossoverCoefficient(', clipStart);
if (clipStart < 0 || clipEnd < 0) failures.push('Drift clip audit: function boundaries missing');
else if (source.slice(clipStart, clipEnd).includes('Math.tanh(')) failures.push('Drift clip audit: runtime Math.tanh remains');

class MockAudioWorkletProcessor {
  constructor() { this.port = { onmessage: null, postMessage() {}, close() {} }; }
}
let tanhCalls = 0;
let expCalls = 0;
const instrumentedMath = Object.create(Math);
instrumentedMath.tanh = (value) => { tanhCalls += 1; return Math.tanh(value); };
instrumentedMath.exp = (value) => { expCalls += 1; return Math.exp(value); };
let Processor = null;
runInNewContext(source, {
  sampleRate: SAMPLE_RATE,
  Math: instrumentedMath,
  Float32Array,
  Float64Array,
  Number,
  Array,
  AudioWorkletProcessor: MockAudioWorkletProcessor,
  registerProcessor(name, registered) {
    if (name === 'calcotone-drift-classic-processor') Processor = registered;
  },
});
if (!Processor) failures.push('Drift worklet did not register');

function renderModel(model, blocks = 24) {
  const processor = new Processor();
  const parameters = {
    model: new Float32Array([model]),
    rate: new Float32Array([.44]),
    depth: new Float32Array([.71]),
    shape: new Float32Array([.63]),
    spread: new Float32Array([.68]),
    motion: new Float32Array([.57]),
  };
  const beforeTanh = tanhCalls;
  const beforeExp = expCalls;
  let peak = 0;
  let energy = 0;
  for (let block = 0; block < blocks; block += 1) {
    const inL = new Float32Array(BLOCK_SIZE);
    const inR = new Float32Array(BLOCK_SIZE);
    const outL = new Float32Array(BLOCK_SIZE);
    const outR = new Float32Array(BLOCK_SIZE);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const absolute = block * BLOCK_SIZE + frame;
      const value = Math.sin(absolute / SAMPLE_RATE * Math.PI * 2 * 503) * .38;
      inL[frame] = value;
      inR[frame] = value * .93;
    }
    processor.process([[inL, inR]], [[outL, outR]], parameters);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      if (!Number.isFinite(outL[frame]) || !Number.isFinite(outR[frame])) failures.push(`Drift model ${model}: non-finite sample`);
      peak = Math.max(peak, Math.abs(outL[frame]), Math.abs(outR[frame]));
      energy += outL[frame] * outL[frame] + outR[frame] * outR[frame];
    }
  }
  const runtimeTanh = tanhCalls - beforeTanh;
  const runtimeExp = expCalls - beforeExp;
  const rms = Math.sqrt(energy / (blocks * BLOCK_SIZE * 2));
  reports.push(`model=${model} tanh=${runtimeTanh} exp=${runtimeExp} peak=${peak.toFixed(4)} rms=${rms.toFixed(5)}`);
  if (peak <= .001 || rms <= .0001) failures.push(`Drift model ${model}: rendered silence`);
  return { runtimeTanh, runtimeExp };
}

if (Processor) {
  if (tanhCalls !== 2048) failures.push(`Drift LUT setup expected 2048 tanh calls, found ${tanhCalls}`);
  const phase90 = renderModel(5);
  const instant = renderModel(6);
  const leslie = renderModel(4, 40);
  if (phase90.runtimeTanh !== 0) failures.push(`Drift Phase 90 made ${phase90.runtimeTanh} runtime tanh calls`);
  if (instant.runtimeTanh !== 0) failures.push(`Drift Instant Phaser made ${instant.runtimeTanh} runtime tanh calls`);
  if (leslie.runtimeExp > 1) failures.push(`Drift Leslie static crossover made ${leslie.runtimeExp} runtime exp calls`);
}

for (const report of reports) console.log(report);
if (failures.length) {
  console.error(`Drift realtime audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Drift realtime audit passed · browser and native wrapper/Standard/Classic hot paths are amortized');
