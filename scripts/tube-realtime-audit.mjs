import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const source = readFileSync(resolve(process.cwd(), 'public/ember-tube-processor.js'), 'utf8');
const failures = [];
const reports = [];
const requireText = (needle) => { if (!source.includes(needle)) failures.push(`Tube realtime contract: missing ${JSON.stringify(needle)}`); };

for (const token of [
  'const TUBE_TANH_LUT = new Float32Array(4096)',
  'function tubeHermite(',
  'function tubeTanh(value)',
  'const zero = tubeTanh(effectiveBias * curve)',
  'let shaped = (tubeTanh((stageInput + effectiveBias) * curve) - zero) / localSlope',
  'const harmonicTilt = tubeTanh(shaped * (1 + profile.harmonicDrive * (0.4 + drive)))',
  'const TUBE_PROFILES = [',
]) requireText(token);

const channelStart = source.indexOf('  processChannel(');
const channelEnd = source.indexOf('  process(inputs, outputs, parameters)', channelStart);
if (channelStart < 0 || channelEnd < 0) failures.push('Tube render audit: processChannel boundaries missing');
else if (source.slice(channelStart, channelEnd).includes('Math.tanh(')) failures.push('Tube render audit: Math.tanh remains in processChannel');

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
  AudioWorkletProcessor: MockAudioWorkletProcessor,
  registerProcessor(name, registered) {
    if (name === 'calcotone-ember-tube-processor') Processor = registered;
  },
});
if (!Processor) failures.push('Tube worklet did not register');

function renderModel(model) {
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'quality', factor: 4 } });
  const parameters = {
    model: new Float32Array([model]),
    drive: new Float32Array([.72]),
    heat: new Float32Array([.64]),
    character: new Float32Array([.58]),
    dynamics: new Float32Array([.76]),
  };
  const beforeTanh = tanhCalls;
  let peak = 0;
  let energy = 0;
  let harmonic2 = 0;
  let harmonic3 = 0;
  let fundamental = 0;
  const frequency = 375;
  let rendered = 0;
  for (let block = 0; block < 160; block += 1) {
    const inL = new Float32Array(BLOCK_SIZE);
    const inR = new Float32Array(BLOCK_SIZE);
    const outL = new Float32Array(BLOCK_SIZE);
    const outR = new Float32Array(BLOCK_SIZE);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const absolute = block * BLOCK_SIZE + frame;
      const value = Math.sin(absolute / SAMPLE_RATE * Math.PI * 2 * frequency) * .62;
      inL[frame] = value;
      inR[frame] = value * .97;
    }
    processor.process([[inL, inR]], [[outL, outR]], parameters);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const left = outL[frame];
      const right = outR[frame];
      if (!Number.isFinite(left) || !Number.isFinite(right)) failures.push(`Tube model ${model}: non-finite output`);
      peak = Math.max(peak, Math.abs(left), Math.abs(right));
      energy += left * left + right * right;
      if (block >= 32) {
        const time = rendered / SAMPLE_RATE;
        fundamental += left * Math.sin(Math.PI * 2 * frequency * time);
        harmonic2 += left * Math.sin(Math.PI * 2 * frequency * 2 * time);
        harmonic3 += left * Math.sin(Math.PI * 2 * frequency * 3 * time);
        rendered += 1;
      }
    }
  }
  const runtimeTanh = tanhCalls - beforeTanh;
  const rms = Math.sqrt(energy / (160 * BLOCK_SIZE * 2));
  const harmonicRatio = (Math.abs(harmonic2) + Math.abs(harmonic3)) / Math.max(1e-9, Math.abs(fundamental));
  reports.push(`model=${model} runtimeTanh=${runtimeTanh} peak=${peak.toFixed(4)} rms=${rms.toFixed(5)} harmonics=${harmonicRatio.toFixed(4)}`);
  if (runtimeTanh !== 0) failures.push(`Tube model ${model}: ${runtimeTanh} runtime Math.tanh calls`);
  if (peak <= .001 || rms <= .0001) failures.push(`Tube model ${model}: rendered silence`);
  if (peak > 1.201) failures.push(`Tube model ${model}: output bound exceeded (${peak.toFixed(4)})`);
  return harmonicRatio;
}

if (Processor) {
  if (tanhCalls !== 4096) failures.push(`Tube LUT setup expected 4096 tanh calls, found ${tanhCalls}`);
  const ratios = [];
  for (let model = 1; model <= 5; model += 1) ratios.push(renderModel(model));
  if (Math.max(...ratios) - Math.min(...ratios) < .0002) failures.push('Tube electrical profiles collapsed to indistinguishable harmonic response');
}

for (const report of reports) console.log(report);
if (failures.length) {
  console.error(`Tube realtime audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Tube realtime audit passed · 4x tube rendering uses LUT nonlinearities with zero runtime Math.tanh calls and distinct profiles');
