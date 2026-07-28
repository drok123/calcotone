import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const HARDWARE_MODES = [
  ['Clouds', 6],
  ['Beads', 7],
  ['Morphagene', 8],
  ['Arbhar', 9],
  ['Particle 2', 10],
  ['Microcosm', 11],
];
const source = readFileSync(resolve(process.cwd(), 'public/grain-processor.js'), 'utf8');
let GrainProcessor = null;

class MockAudioWorkletProcessor {
  constructor() {
    this.port = {
      onmessage: null,
      postMessage() {},
      close() {},
    };
  }
}

runInNewContext(source, {
  sampleRate: SAMPLE_RATE,
  AudioWorkletProcessor: MockAudioWorkletProcessor,
  registerProcessor(name, processor) {
    if (name === 'calcotone-grain-processor') GrainProcessor = processor;
  },
});

if (!GrainProcessor) {
  console.error('CALCOTONE Grain hardware audit failed: worklet did not register.');
  process.exit(1);
}

const failures = [];
const signatures = new Map();
const reports = [];

for (const [name, mode] of HARDWARE_MODES) {
  const processor = new GrainProcessor();
  const inputL = new Float32Array(BLOCK_SIZE);
  const inputR = new Float32Array(BLOCK_SIZE);
  const outputL = new Float32Array(BLOCK_SIZE);
  const outputR = new Float32Array(BLOCK_SIZE);
  const parameters = {
    mode: new Float32Array([mode]),
    bits: new Float32Array([10]),
    density: new Float32Array([0.58]),
    pitch: new Float32Array([0.34]),
    chaos: new Float32Array([0.42]),
    bloom: new Float32Array([0.52]),
  };
  let sumSquares = 0;
  let roughness = 0;
  let stereoDifference = 0;
  let peak = 0;
  let measuredSamples = 0;
  let previous = 0;

  for (let block = 0; block < 1_600; block += 1) {
    for (let sample = 0; sample < BLOCK_SIZE; sample += 1) {
      const frame = block * BLOCK_SIZE + sample;
      const time = frame / SAMPLE_RATE;
      const pulseFrame = frame % 12_000;
      const pulse = pulseFrame < 96 ? Math.exp(-pulseFrame / 24) * 0.34 : 0;
      inputL[sample] = Math.sin(time * Math.PI * 2 * 173) * 0.22
        + Math.sin(time * Math.PI * 2 * 311) * 0.11
        + pulse;
      inputR[sample] = Math.sin(time * Math.PI * 2 * 181) * 0.20
        + Math.sin(time * Math.PI * 2 * 337) * 0.10
        + pulse * 0.86;
    }

    processor.process([[inputL, inputR]], [[outputL, outputR]], parameters);
    if (block < 420) continue;

    for (let sample = 0; sample < BLOCK_SIZE; sample += 1) {
      const left = outputL[sample];
      const right = outputR[sample];
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        failures.push(`${name}: produced a non-finite sample`);
        break;
      }
      const mono = (left + right) * 0.5;
      sumSquares += mono * mono;
      roughness += Math.abs(mono - previous);
      stereoDifference += Math.abs(left - right);
      peak = Math.max(peak, Math.abs(left), Math.abs(right));
      previous = mono;
      measuredSamples += 1;
    }
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, measuredSamples));
  const averageRoughness = roughness / Math.max(1, measuredSamples);
  const averageStereoDifference = stereoDifference / Math.max(1, measuredSamples);
  if (rms < 0.002) failures.push(`${name}: output is effectively silent (${rms.toFixed(6)} RMS)`);
  if (peak > 1.75) failures.push(`${name}: output exceeded the safety ceiling (${peak.toFixed(3)})`);
  if (averageStereoDifference < 0.0005) failures.push(`${name}: stereo mechanism collapsed (${averageStereoDifference.toFixed(6)})`);

  const signature = `${rms.toFixed(5)}:${averageRoughness.toFixed(5)}:${averageStereoDifference.toFixed(5)}`;
  const collision = signatures.get(signature);
  if (collision) failures.push(`${name}: DSP signature duplicates ${collision}`);
  signatures.set(signature, name);
  reports.push(`${name} ${signature} peak=${peak.toFixed(3)}`);
}

if (failures.length) {
  console.error('\nCALCOTONE Grain hardware audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(`CALCOTONE Grain hardware audit passed (${reports.join(' · ')}).`);
