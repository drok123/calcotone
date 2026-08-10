import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const source = readFileSync(resolve(process.cwd(), 'public/ember-digital-capture-processor.js'), 'utf8');
const failures = [];
const reports = [];
const requireText = (needle) => { if (!source.includes(needle)) failures.push(`Digital capture contract: missing ${JSON.stringify(needle)}`); };

for (const token of [
  'const CAPTURE_TANH_LUT = new Float32Array(2048)',
  'function captureTanh(value)',
  'poleCoefficient(cutoff)',
  'onePoleWithCoefficient(value, coefficient, state, index)',
  'fourPoleWithCoefficient(value, coefficient, resonance, state)',
  'const coefficientL = this.poleCoefficient(cutoff)',
  'this.fourPoleWithCoefficient(outL, coefficientL',
]) requireText(token);

const modelStart = source.indexOf('  processModel(');
const modelEnd = source.indexOf('  process(inputs, outputs, parameters)', modelStart);
if (modelStart < 0 || modelEnd < 0) failures.push('Digital capture audit: processModel boundaries missing');
else if (source.slice(modelStart, modelEnd).includes('Math.tanh(')) failures.push('Digital capture audit: render-time Math.tanh remains');

class MockAudioWorkletProcessor {
  constructor() { this.port = { onmessage: null, postMessage() {}, close() {} }; }
}
let expCalls = 0;
let tanhCalls = 0;
const instrumentedMath = Object.create(Math);
instrumentedMath.exp = (value) => { expCalls += 1; return Math.exp(value); };
instrumentedMath.tanh = (value) => { tanhCalls += 1; return Math.tanh(value); };
let Processor = null;
runInNewContext(source, {
  sampleRate: SAMPLE_RATE,
  Math: instrumentedMath,
  Float32Array,
  Number,
  AudioWorkletProcessor: MockAudioWorkletProcessor,
  registerProcessor(name, registered) {
    if (name === 'calcotone-ember-digital-capture-processor') Processor = registered;
  },
});
if (!Processor) failures.push('Digital capture worklet did not register');

function renderMode(mode, filter = .63) {
  const processor = new Processor();
  const parameters = {
    mode: new Float32Array([mode]),
    drive: new Float32Array([.71]),
    clock: new Float32Array([.52]),
    character: new Float32Array([.66]),
    filter: new Float32Array([filter]),
  };
  const setupTanh = tanhCalls;
  const beforeExp = expCalls;
  let peak = 0;
  for (let block = 0; block < 8; block += 1) {
    const inL = new Float32Array(BLOCK_SIZE);
    const inR = new Float32Array(BLOCK_SIZE);
    const outL = new Float32Array(BLOCK_SIZE);
    const outR = new Float32Array(BLOCK_SIZE);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const absolute = block * BLOCK_SIZE + frame;
      const value = Math.sin(absolute / SAMPLE_RATE * Math.PI * 2 * 431) * .37;
      inL[frame] = value;
      inR[frame] = value * .95;
    }
    processor.process([[inL, inR]], [[outL, outR]], parameters);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      if (!Number.isFinite(outL[frame]) || !Number.isFinite(outR[frame])) failures.push(`Digital capture mode ${mode}: non-finite sample`);
      peak = Math.max(peak, Math.abs(outL[frame]), Math.abs(outR[frame]));
    }
  }
  const renderExp = expCalls - beforeExp;
  const renderTanh = tanhCalls - setupTanh;
  reports.push(`mode=${mode} exp/sample=${(renderExp / (8 * BLOCK_SIZE)).toFixed(3)} runtimeTanh=${renderTanh} peak=${peak.toFixed(4)}`);
  if (renderTanh !== 0) failures.push(`Digital capture mode ${mode}: ${renderTanh} runtime Math.tanh calls`);
  if (peak <= .0001) failures.push(`Digital capture mode ${mode}: rendered silence`);
  return renderExp / (8 * BLOCK_SIZE);
}

if (Processor) {
  if (tanhCalls !== 2048) failures.push(`Digital capture LUT expected 2048 setup tanh calls, found ${tanhCalls}`);
  const mode1Exp = renderMode(1);
  const mode2Exp = renderMode(2);
  const mode4Exp = renderMode(4);
  if (mode1Exp > 1.05) failures.push(`Digital capture mode 1 coefficient cost too high (${mode1Exp.toFixed(3)} exp/sample)`);
  if (mode2Exp > 2.05) failures.push(`Digital capture mode 2 coefficient cost too high (${mode2Exp.toFixed(3)} exp/sample)`);
  if (mode4Exp > 2.05) failures.push(`Digital capture mode 4 coefficient cost too high (${mode4Exp.toFixed(3)} exp/sample)`);
}

for (const report of reports) console.log(report);
if (failures.length) {
  console.error(`Digital capture realtime audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Digital capture realtime audit passed · pole coefficients are hoisted and render nonlinearities are LUT-backed');
