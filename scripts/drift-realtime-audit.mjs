import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const source = readFileSync(resolve(process.cwd(), 'public/drift-classic-processor.js'), 'utf8');
const failures = [];
const reports = [];
const requireText = (needle) => { if (!source.includes(needle)) failures.push(`Drift realtime contract: missing ${JSON.stringify(needle)}`); };

for (const token of [
  'const DRIFT_TANH_LUT = new Float32Array(2048)',
  'function driftTanh(value)',
  'return driftTanh(input * drive) / Math.max(1e-6, drive)',
  'this.leslieShape = -1',
  'leslieCrossoverCoefficient(shape)',
  'if (shape !== this.leslieShape)',
  'const crossover = this.leslieCrossoverCoefficient(shape)',
]) requireText(token);

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
console.log('Drift realtime audit passed · nonlinear phasers use LUT tanh and Leslie caches its static crossover coefficient');
