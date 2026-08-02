import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const failures = [];

class MockAudioWorkletProcessor {
  constructor() {
    this.port = { onmessage: null, postMessage() {}, close() {} };
  }
}

let Processor = null;
const source = readFileSync(resolve(process.cwd(), 'public/stack-amp-processor.js'), 'utf8');
runInNewContext(source, {
  sampleRate: SAMPLE_RATE,
  Float32Array,
  Math,
  Number,
  AudioWorkletProcessor: MockAudioWorkletProcessor,
  registerProcessor(name, value) {
    if (name === 'calcotone-stack-amp-processor') Processor = value;
  },
});

if (!Processor) {
  console.error('STACK amp audit failed: processor did not register');
  process.exit(1);
}

const parameter = (value) => new Float32Array([value]);

function render(model, cabinet, quality, drive = 0.58) {
  const processor = new Processor();
  processor.port.onmessage?.({ data: { type: 'quality', quality } });
  const parameters = {
    model: parameter(model), cabinet: parameter(cabinet), drive: parameter(drive),
    tone: parameter(0.53), sag: parameter(0.42),
  };
  let energy = 0;
  let peak = 0;
  let samples = 0;
  const fingerprint = new Float64Array(4);
  for (let block = 0; block < 56; block += 1) {
    const input = [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)];
    const output = [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)];
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const absoluteFrame = block * BLOCK_SIZE + frame;
      const time = absoluteFrame / SAMPLE_RATE;
      const transient = absoluteFrame % 6000 < 80 ? Math.exp(-(absoluteFrame % 6000) / 22) * 0.22 : 0;
      const value = Math.sin(time * Math.PI * 2 * 193) * 0.24
        + Math.sin(time * Math.PI * 2 * 1319) * 0.09 + transient;
      input[0][frame] = value;
      input[1][frame] = value * 0.97;
    }
    processor.process([input], [output], parameters);
    for (let channel = 0; channel < 2; channel += 1) {
      for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
        const value = output[channel][frame];
        if (!Number.isFinite(value)) failures.push(`model ${model}/cab ${cabinet}/${quality}x produced non-finite output`);
        peak = Math.max(peak, Math.abs(value));
        if (block >= 12) {
          energy += value * value;
          fingerprint[(frame >> 5) & 3] += Math.abs(value);
          samples += 1;
        }
      }
    }
  }
  return { rms: Math.sqrt(energy / Math.max(1, samples)), peak, fingerprint };
}

const modelReports = [];
for (const quality of [1, 2, 4]) {
  for (let model = 0; model < 6; model += 1) {
    const cabinets = quality === 2 ? [0, 1, 2, 3, 4] : [2];
    for (const cabinet of cabinets) {
      const result = render(model, cabinet, quality);
      if (result.peak > 1.151) failures.push(`model ${model}/cab ${cabinet}/${quality}x peak escaped guard (${result.peak.toFixed(4)})`);
      if (result.rms < 0.004) failures.push(`model ${model}/cab ${cabinet}/${quality}x collapsed toward silence (${result.rms.toFixed(5)})`);
      if (quality === 2 && cabinet === 2) modelReports.push(result.rms);
    }
  }
}

const quiet = render(5, 2, 2, 0.08);
const driven = render(5, 2, 2, 0.82);
if (driven.rms < quiet.rms * 0.72) failures.push(`drive compensation collapsed level (${quiet.rms.toFixed(4)} → ${driven.rms.toFixed(4)})`);
const modelSpread = Math.max(...modelReports) - Math.min(...modelReports);
if (modelSpread < 0.004) failures.push(`amp studies are insufficiently distinct (RMS spread ${modelSpread.toFixed(5)})`);
if (modelSpread > 0.16) failures.push(`amp study makeup is poorly matched (RMS spread ${modelSpread.toFixed(5)})`);

for (const token of ['SHAPER_LUT', 'hermite(', 'tptLowpass(', 'sagEnvelope', 'transformerMemory', 'coefficientGlide', 'driveMakeup']) {
  if (!source.includes(token)) failures.push(`processor missing ${token}`);
}

if (failures.length) {
  console.error(`STACK amp audit failed (${failures.length})`);
  for (const failure of new Set(failures)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`STACK amp audit passed · 42 model/cab/quality paths · RMS ${modelReports.map((value) => value.toFixed(4)).join('/')} · drive ${quiet.rms.toFixed(4)}→${driven.rms.toFixed(4)}`);
