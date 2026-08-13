import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const source = readFileSync(resolve(process.cwd(), 'public/grain-processor.js'), 'utf8');
const failures = [];
const reports = [];
const requireText = (needle) => { if (!source.includes(needle)) failures.push(`Grain realtime contract: missing ${JSON.stringify(needle)}`); };

for (const token of [
  'const GRAIN_TANH_LUT = new Float32Array(4096)',
  'const GRAIN_OUTPUT_TANH_NORM = 1 / Math.tanh(1.02)',
  'function grainTanh(value)',
  'const reelNormalization = 1 / Math.max(1e-6, grainTanh(reelDrive))',
  'let safeL = grainTanh(processedL * 1.02) * GRAIN_OUTPUT_TANH_NORM',
  'let safeR = grainTanh(processedR * 1.02) * GRAIN_OUTPUT_TANH_NORM',
  'const MICROCOSM_VARIATION_PATTERNS = [',
  'const pulseFrames = sampleRate * 240 / (tempo * division)',
  'if (!memoryHeld) this.writeIndex = (this.writeIndex + 1) & this.mask',
]) requireText(token);

const processStart = source.indexOf('  process(inputs, outputs, parameters)');
if (processStart < 0) failures.push('Grain render audit: process function missing');
else if (source.slice(processStart).includes('Math.tanh(')) failures.push('Grain render audit: runtime Math.tanh remains in process path');

class MockAudioWorkletProcessor {
  constructor() {
    this.port = { messages: [], onmessage: null, postMessage: (message) => this.port.messages.push(message), close() {} };
  }
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
    if (name === 'calcotone-grain-processor') Processor = registered;
  },
});
if (!Processor) failures.push('Grain worklet did not register');

function renderMode(mode) {
  const processor = new Processor();
  const parameters = {
    mode: new Float32Array([mode]),
    bits: new Float32Array([13]),
    density: new Float32Array([.66]),
    pitch: new Float32Array([.51]),
    chaos: new Float32Array([.42]),
    bloom: new Float32Array([.58]),
    microcosmProgram: new Float32Array([0]),
    tempo: new Float32Array([120]),
    hold: new Float32Array([0]),
  };
  const beforeTanh = tanhCalls;
  let peak = 0;
  let energy = 0;
  for (let block = 0; block < 240; block += 1) {
    const inL = new Float32Array(BLOCK_SIZE);
    const inR = new Float32Array(BLOCK_SIZE);
    const outL = new Float32Array(BLOCK_SIZE);
    const outR = new Float32Array(BLOCK_SIZE);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const absolute = block * BLOCK_SIZE + frame;
      const value = Math.sin(absolute / SAMPLE_RATE * Math.PI * 2 * 277) * .31
        + Math.sin(absolute / SAMPLE_RATE * Math.PI * 2 * 1267) * .08;
      inL[frame] = value;
      inR[frame] = value * .94;
    }
    processor.process([[inL, inR]], [[outL, outR]], parameters);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const left = outL[frame];
      const right = outR[frame];
      if (!Number.isFinite(left) || !Number.isFinite(right)) failures.push(`Grain mode ${mode}: non-finite sample`);
      peak = Math.max(peak, Math.abs(left), Math.abs(right));
      energy += left * left + right * right;
    }
  }
  const runtimeTanh = tanhCalls - beforeTanh;
  const rms = Math.sqrt(energy / (240 * BLOCK_SIZE * 2));
  reports.push(`mode=${mode} runtimeTanh=${runtimeTanh} peak=${peak.toFixed(4)} rms=${rms.toFixed(5)}`);
  if (runtimeTanh !== 0) failures.push(`Grain mode ${mode}: ${runtimeTanh} runtime Math.tanh calls`);
  if (peak <= .0001 || rms <= .00001) failures.push(`Grain mode ${mode}: rendered silence`);
  if (peak > 1.55) failures.push(`Grain mode ${mode}: unstable peak ${peak.toFixed(4)}`);
}

if (Processor) {
  if (tanhCalls !== 4097) failures.push(`Grain setup expected 4097 Math.tanh calls, found ${tanhCalls}`);
  for (let mode = 0; mode < 12; mode += 1) renderMode(mode);
}

for (const report of reports) console.log(report);
if (failures.length) {
  console.error(`Grain realtime audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Grain realtime audit passed · all 12 modes remain finite with zero runtime Math.tanh calls');
