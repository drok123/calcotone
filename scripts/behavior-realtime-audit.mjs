import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const source = readFileSync(resolve(process.cwd(), 'public/behavior-memory-processor.js'), 'utf8');
const failures = [];
const reports = [];
const requireText = (needle) => { if (!source.includes(needle)) failures.push(`Behavior realtime contract: missing ${JSON.stringify(needle)}`); };

for (const token of [
  'const BEHAVIOR_TANH_LUT = new Float32Array(2048)',
  'function behaviorTanh(value)',
  'residual = behaviorTanh(s.velocity * 3.2)',
  'residual = behaviorTanh(shear * viscosity)',
  'const target = behaviorTanh(field * (1.08 + color * 1.72))',
  'const soft = behaviorTanh((input + thermalBias) * (1.015 + color * 0.18)) - input',
]) requireText(token);

const sampleStart = source.indexOf('  processSample(');
const sampleEnd = source.indexOf('  process(inputs, outputs, parameters)', sampleStart);
if (sampleStart < 0 || sampleEnd < 0) failures.push('Behavior render audit: processSample boundaries missing');
else if (source.slice(sampleStart, sampleEnd).includes('Math.tanh(')) failures.push('Behavior render audit: runtime Math.tanh remains');

class MockAudioWorkletProcessor {
  constructor() { this.port = { onmessage: null, postMessage() {}, close() {} }; }
}
let tanhCalls = 0;
const instrumentedMath = Object.create(Math);
instrumentedMath.tanh = (value) => { tanhCalls += 1; return Math.tanh(value); };
let Processor = null;
runInNewContext(source, {
  sampleRate: SAMPLE_RATE,
  Math: instrumentedMath,
  Float32Array,
  Number,
  Array,
  AudioWorkletProcessor: MockAudioWorkletProcessor,
  registerProcessor(name, registered) {
    if (name === 'calcotone-behavior-memory-processor') Processor = registered;
  },
});
if (!Processor) failures.push('Behavior memory worklet did not register');

function renderProfile(profile) {
  const processor = new Processor();
  const parameters = {
    profile: new Float32Array([profile]),
    amount: new Float32Array([.58]),
    motion: new Float32Array([.49]),
    memory: new Float32Array([.67]),
    color: new Float32Array([.62]),
  };
  const beforeTanh = tanhCalls;
  let peak = 0;
  let energy = 0;
  for (let block = 0; block < 32; block += 1) {
    const inL = new Float32Array(BLOCK_SIZE);
    const inR = new Float32Array(BLOCK_SIZE);
    const outL = new Float32Array(BLOCK_SIZE);
    const outR = new Float32Array(BLOCK_SIZE);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const absolute = block * BLOCK_SIZE + frame;
      const value = Math.sin(absolute / SAMPLE_RATE * Math.PI * 2 * 337) * .41;
      inL[frame] = value;
      inR[frame] = value * .96;
    }
    processor.process([[inL, inR]], [[outL, outR]], parameters);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      if (!Number.isFinite(outL[frame]) || !Number.isFinite(outR[frame])) failures.push(`Behavior profile ${profile}: non-finite sample`);
      peak = Math.max(peak, Math.abs(outL[frame]), Math.abs(outR[frame]));
      energy += outL[frame] * outL[frame] + outR[frame] * outR[frame];
    }
  }
  const runtimeTanh = tanhCalls - beforeTanh;
  const rms = Math.sqrt(energy / (32 * BLOCK_SIZE * 2));
  reports.push(`profile=${profile} runtimeTanh=${runtimeTanh} peak=${peak.toFixed(4)} rms=${rms.toFixed(5)}`);
  if (runtimeTanh !== 0) failures.push(`Behavior profile ${profile}: ${runtimeTanh} runtime Math.tanh calls`);
  if (peak <= .001 || rms <= .0001) failures.push(`Behavior profile ${profile}: rendered silence`);
}

if (Processor) {
  if (tanhCalls !== 2048) failures.push(`Behavior LUT setup expected 2048 tanh calls, found ${tanhCalls}`);
  for (const profile of [2, 3, 5, 6, 8, 10, 12]) renderProfile(profile);
}

for (const report of reports) console.log(report);
if (failures.length) {
  console.error(`Behavior realtime audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Behavior realtime audit passed · nonlinear memory profiles use LUT tanh with zero runtime Math.tanh calls');
