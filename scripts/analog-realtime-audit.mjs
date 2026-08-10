import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const source = readFileSync(resolve(process.cwd(), 'public/analog-signal-chain-processor.js'), 'utf8');
const failures = [];
const reports = [];
const requireText = (needle, label) => { if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`); };
const forbidText = (text, needle, label) => { if (text.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`); };

for (const token of [
  'this.adaaAntiderivativeLut = this.makeAntiderivativeLut(ADAA_TABLE_SIZE)',
  'this.adaaTanhLut = this.makeTanhLut(TANH_TABLE_SIZE)',
  'cutoffHz: -1',
  'cutoffCoefficient: 0',
  'lowpassCoefficient(cutoff, state)',
  'if (safe !== state.cutoffHz)',
  'state.cutoffCoefficient = g / (1 + g)',
  'const coefficient = this.lowpassCoefficient(this.value(parameters.cutoff, i), state)',
  ': this.fastTanh((x + previous) * 0.5)',
]) requireText(token, 'Analog realtime contract');

const antiderivativeStart = source.indexOf('  antiderivative(x)');
const antiderivativeEnd = source.indexOf('  fastTanh(x)', antiderivativeStart);
if (antiderivativeStart < 0 || antiderivativeEnd < 0) failures.push('Analog antiderivative audit: function boundaries missing');
else {
  const body = source.slice(antiderivativeStart, antiderivativeEnd);
  forbidText(body, 'Math.exp(', 'Analog render antiderivative exponential');
  forbidText(body, 'Math.log', 'Analog render antiderivative logarithm');
}

class MockAudioWorkletProcessor {
  constructor() {
    this.port = { onmessage: null, postMessage() {}, close() {} };
  }
}

let tanCalls = 0;
const instrumentedMath = Object.create(Math);
instrumentedMath.tan = (value) => { tanCalls += 1; return Math.tan(value); };
let Processor = null;
runInNewContext(source, {
  sampleRate: SAMPLE_RATE,
  Math: instrumentedMath,
  Float32Array,
  Float64Array,
  AudioWorkletProcessor: MockAudioWorkletProcessor,
  registerProcessor(name, registered) {
    if (name === 'calcotone-analog-signal-chain-processor') Processor = registered;
  },
});
if (!Processor) failures.push('Analog signal-chain worklet did not register');

const constant = (value) => new Float32Array([value]);
function render(processor, cutoff, blocks) {
  const parameters = {
    inputGain: constant(1.15),
    drive: constant(2.4),
    asymmetry: constant(.05),
    shapeMode: constant(0),
    cutoff,
    dcCutoff: constant(12),
    outputGain: constant(.82),
  };
  let peak = 0;
  let energy = 0;
  for (let block = 0; block < blocks; block += 1) {
    const inputL = new Float32Array(BLOCK_SIZE);
    const inputR = new Float32Array(BLOCK_SIZE);
    const outputL = new Float32Array(BLOCK_SIZE);
    const outputR = new Float32Array(BLOCK_SIZE);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const absolute = block * BLOCK_SIZE + frame;
      const value = Math.sin(absolute / SAMPLE_RATE * Math.PI * 2 * 317) * .36;
      inputL[frame] = value;
      inputR[frame] = value * .97;
    }
    processor.process([[inputL, inputR]], [[outputL, outputR]], parameters);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const left = outputL[frame];
      const right = outputR[frame];
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        failures.push('Analog signal chain produced non-finite output');
        return { peak, energy };
      }
      peak = Math.max(peak, Math.abs(left), Math.abs(right));
      energy += left * left + right * right;
    }
  }
  return { peak, energy };
}

if (Processor) {
  const processor = new Processor();
  const beforeConstant = tanCalls;
  const constantResult = render(processor, constant(18_000), 80);
  const constantTanCalls = tanCalls - beforeConstant;
  reports.push(`constant cutoff tan calls=${constantTanCalls} peak=${constantResult.peak.toFixed(4)}`);
  if (constantTanCalls > 2) failures.push(`Analog static cutoff: expected <=2 tan calls, found ${constantTanCalls}`);
  if (constantResult.peak <= .001) failures.push('Analog static cutoff rendered silence');

  const sweeping = new Float32Array(BLOCK_SIZE);
  for (let frame = 0; frame < BLOCK_SIZE; frame += 1) sweeping[frame] = 800 + frame * 90;
  const beforeSweep = tanCalls;
  const sweepResult = render(processor, sweeping, 2);
  const sweepTanCalls = tanCalls - beforeSweep;
  reports.push(`a-rate sweep tan calls=${sweepTanCalls} peak=${sweepResult.peak.toFixed(4)}`);
  if (sweepTanCalls < BLOCK_SIZE) failures.push(`Analog a-rate cutoff: automation cache suppressed changing coefficients (${sweepTanCalls})`);
}

for (const report of reports) console.log(report);
if (failures.length) {
  console.error(`Analog realtime audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Analog realtime audit passed · ADAA tables and cutoff coefficient caching preserve finite static/a-rate rendering');
