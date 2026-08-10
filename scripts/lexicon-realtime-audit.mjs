import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const source = readFileSync(resolve(process.cwd(), 'public/lexicon-224-converter.js'), 'utf8');
const failures = [];
const reports = [];
const requireText = (needle) => { if (!source.includes(needle)) failures.push(`Lexicon realtime contract: missing ${JSON.stringify(needle)}`); };

for (const token of [
  'const LEXICON_TANH_LUT = new Float32Array(2048)',
  'const LEXICON_TRANSFORMER_NORMALIZATION = 1 / Math.tanh(1.035)',
  'function lexiconTanh(value)',
  'this.inputFilterCoefficient = this.lowpassCoefficient(8200)',
  'this.outputFilterCoefficient = this.lowpassCoefficient(8800)',
  'lowpassWithCoefficient(value, coefficient, state, stage)',
  'return lexiconTanh(biased * 1.035) * LEXICON_TRANSFORMER_NORMALIZATION',
]) requireText(token);

const inputStart = source.indexOf('  processInput(');
const processStart = source.indexOf('  process(inputs, outputs)', inputStart);
if (inputStart < 0 || processStart < 0) failures.push('Lexicon render audit: process method boundaries missing');
else {
  const body = source.slice(inputStart, processStart);
  if (body.includes('Math.exp(')) failures.push('Lexicon render audit: runtime Math.exp remains');
  if (body.includes('Math.tanh(')) failures.push('Lexicon render audit: runtime Math.tanh remains');
}

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
    if (name === 'calcotone-lexicon224-converter') Processor = registered;
  },
});
if (!Processor) failures.push('Lexicon converter did not register');

function renderRole(role) {
  const beforeExp = expCalls;
  const beforeTanh = tanhCalls;
  const processor = new Processor({ processorOptions: { role } });
  const setupExp = expCalls - beforeExp;
  const setupTanh = tanhCalls - beforeTanh;
  let peak = 0;
  let energy = 0;
  const renderExpStart = expCalls;
  const renderTanhStart = tanhCalls;
  for (let block = 0; block < 48; block += 1) {
    const inL = new Float32Array(BLOCK_SIZE);
    const inR = new Float32Array(BLOCK_SIZE);
    const outL = new Float32Array(BLOCK_SIZE);
    const outR = new Float32Array(BLOCK_SIZE);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const absolute = block * BLOCK_SIZE + frame;
      const value = Math.sin(absolute / SAMPLE_RATE * Math.PI * 2 * 631) * .34;
      inL[frame] = value;
      inR[frame] = value * .96;
    }
    processor.process([[inL, inR]], [[outL, outR]]);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const left = outL[frame];
      const right = outR[frame];
      if (!Number.isFinite(left) || !Number.isFinite(right)) failures.push(`Lexicon ${role}: non-finite sample`);
      peak = Math.max(peak, Math.abs(left), Math.abs(right));
      energy += left * left + right * right;
    }
  }
  const runtimeExp = expCalls - renderExpStart;
  const runtimeTanh = tanhCalls - renderTanhStart;
  const rms = Math.sqrt(energy / (48 * BLOCK_SIZE * 2));
  reports.push(`${role} setupExp=${setupExp} setupTanh=${setupTanh} runtimeExp=${runtimeExp} runtimeTanh=${runtimeTanh} peak=${peak.toFixed(4)} rms=${rms.toFixed(5)}`);
  if (runtimeExp !== 0) failures.push(`Lexicon ${role}: ${runtimeExp} runtime Math.exp calls`);
  if (runtimeTanh !== 0) failures.push(`Lexicon ${role}: ${runtimeTanh} runtime Math.tanh calls`);
  if (peak <= .0001 || rms <= .00001) failures.push(`Lexicon ${role}: rendered silence`);
}

if (Processor) {
  if (tanhCalls !== 2049) failures.push(`Lexicon module setup expected 2049 tanh calls, found ${tanhCalls}`);
  renderRole('input');
  renderRole('output');
}

for (const report of reports) console.log(report);
if (failures.length) {
  console.error(`Lexicon realtime audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Lexicon realtime audit passed · converter filters and transformer rounding use zero runtime exp/tanh calls');
