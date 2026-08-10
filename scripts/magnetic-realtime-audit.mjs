import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const source = readFileSync(resolve(process.cwd(), 'public/magnetic-core-processor.js'), 'utf8');
const failures = [];
const reports = [];
const requireText = (needle) => { if (!source.includes(needle)) failures.push(`Magnetic realtime contract: missing ${JSON.stringify(needle)}`); };

for (const token of [
  'const MAGNETIC_TANH_LUT = new Float32Array(4096)',
  'function magneticHermite(',
  'function magneticTanh(value)',
  'const targetFlux = magneticTanh(',
  'const remanentTarget = magneticTanh(',
  'const core = magneticTanh(',
]) requireText(token);

const processStart = source.indexOf('  processChannel(');
const processEnd = source.indexOf('  process(inputs, outputs, parameters)', processStart);
if (processStart < 0 || processEnd < 0) failures.push('Magnetic render audit: processChannel boundaries missing');
else if (source.slice(processStart, processEnd).includes('Math.tanh(')) failures.push('Magnetic render audit: Math.tanh remains in processChannel');

class MockAudioWorkletProcessor {
  constructor() {
    this.port = { onmessage: null, postMessage() {}, close() {} };
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
  AudioWorkletProcessor: MockAudioWorkletProcessor,
  registerProcessor(name, registered) {
    if (name === 'calcotone-magnetic-core-processor') Processor = registered;
  },
});
if (!Processor) failures.push('Magnetic worklet did not register');

if (Processor) {
  const setupTanhCalls = tanhCalls;
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'quality', factor: 4 } });
  const parameters = {
    drive: new Float32Array([.82]),
    heat: new Float32Array([.73]),
    character: new Float32Array([.67]),
    dynamics: new Float32Array([.58]),
  };
  let peak = 0;
  let energy = 0;
  for (let block = 0; block < 180; block += 1) {
    const inL = new Float32Array(BLOCK_SIZE);
    const inR = new Float32Array(BLOCK_SIZE);
    const outL = new Float32Array(BLOCK_SIZE);
    const outR = new Float32Array(BLOCK_SIZE);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const absolute = block * BLOCK_SIZE + frame;
      const time = absolute / SAMPLE_RATE;
      const value = Math.sin(time * Math.PI * 2 * 181) * .46 + Math.sin(time * Math.PI * 2 * 3107) * .12;
      inL[frame] = value;
      inR[frame] = value * .96;
    }
    processor.process([[inL, inR]], [[outL, outR]], parameters);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const left = outL[frame];
      const right = outR[frame];
      if (!Number.isFinite(left) || !Number.isFinite(right)) failures.push('Magnetic worklet produced non-finite output');
      peak = Math.max(peak, Math.abs(left), Math.abs(right));
      energy += left * left + right * right;
    }
  }
  const renderTanhCalls = tanhCalls - setupTanhCalls;
  const rms = Math.sqrt(energy / (180 * BLOCK_SIZE * 2));
  reports.push(`setup tanh=${setupTanhCalls} render tanh=${renderTanhCalls} peak=${peak.toFixed(4)} rms=${rms.toFixed(5)}`);
  if (setupTanhCalls !== 4096) failures.push(`Magnetic LUT setup expected 4096 tanh calls, found ${setupTanhCalls}`);
  if (renderTanhCalls !== 0) failures.push(`Magnetic render path made ${renderTanhCalls} Math.tanh calls`);
  if (peak <= .001 || rms <= .0001) failures.push('Magnetic worklet rendered silence');
  if (peak > 1.201) failures.push(`Magnetic worklet exceeded output bound (${peak.toFixed(4)})`);
}

for (const report of reports) console.log(report);
if (failures.length) {
  console.error(`Magnetic realtime audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Magnetic realtime audit passed · 4x hysteresis rendering uses LUT nonlinearities with zero runtime Math.tanh calls');
