import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const SAMPLE_RATE = 48_000;
const QUALITY = 4;
const FRAME_LENGTH = 8_192;
const WARMUP_FRAMES = 12_288;
const CROSSFADE_FRAMES = 256;
const ROOT_NOTES = Array.from({ length: 9 }, (_, index) => 36 + index * 6);
const VARIANT_SEEDS = [0x13ac9, 0x4de31];
const BASE_PARAMETERS = [.58, .46, .26, .54, .22, .08];
const TAPS = [
  { id: 'tone', source: BASE_PARAMETERS[0], motion: BASE_PARAMETERS[5] },
  { id: 'source-00', source: 0, motion: 0 },
  { id: 'source-10', source: 1, motion: 0 },
  { id: 'source-01', source: 0, motion: 1 },
  { id: 'source-11', source: 1, motion: 1 },
];

const root = process.cwd();
const processorPath = resolve(root, 'public/synth-circuit-processor.js');
const outputPath = resolve(root, 'public/synth-captures/model-d-panel-init.f32');
const manifestPath = resolve(root, 'public/synth-captures/model-d-panel-init.json');
const Processor = loadProcessor(readFileSync(processorPath, 'utf8'));
const totalFrames = TAPS.length * ROOT_NOTES.length * VARIANT_SEEDS.length * FRAME_LENGTH;
const samples = new Float32Array(totalFrames);
const entries = [];
let writeFrame = 0;

for (const tap of TAPS) {
  for (const rootMidi of ROOT_NOTES) {
    for (let variant = 0; variant < VARIANT_SEEDS.length; variant += 1) {
      const parameters = [...BASE_PARAMETERS];
      parameters[0] = tap.source;
      parameters[5] = tap.motion;
      const rendered = renderCapture(
        Processor,
        rootMidi,
        VARIANT_SEEDS[variant],
        parameters,
        tap.id === 'tone' ? 'tone' : 'source',
      );
      samples.set(rendered, writeFrame);
      entries.push({
        tap: tap.id,
        rootMidi,
        variant,
        offsetFrames: writeFrame,
        frameLength: FRAME_LENGTH,
      });
      writeFrame += rendered.length;
    }
  }
}

const pcm = encodeFloat32Le(samples);
const sha256 = createHash('sha256').update(pcm).digest('hex');
const manifest = {
  version: 1,
  machine: 'model-d',
  preset: 'panel-init',
  format: 'float32-le',
  sampleRate: SAMPLE_RATE,
  quality: QUALITY,
  frameLength: FRAME_LENGTH,
  crossfadeFrames: CROSSFADE_FRAMES,
  variants: VARIANT_SEEDS.length,
  parameters: BASE_PARAMETERS,
  sourceCorners: ['source-00', 'source-10', 'source-01', 'source-11'],
  profileLevel: .17,
  sha256,
  byteLength: pcm.byteLength,
  entries,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, pcm);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `CALCOTONE capture bank built (${entries.length} deterministic Model D captures, `
  + `${(pcm.byteLength / 1024 / 1024).toFixed(2)} MiB float32 PCM, ${sha256.slice(0, 12)}).`,
);

function renderCapture(ProcessorClass, rootMidi, seed, parameters, tap) {
  const processor = new ProcessorClass();
  processor.port.onmessage({ data: { type: 'enabled', value: true } });
  processor.port.onmessage({ data: { type: 'machine', value: 'model-d' } });
  processor.port.onmessage({ data: { type: 'parameters', values: parameters } });
  processor.port.onmessage({ data: { type: 'quality', factor: QUALITY } });
  processor.port.onmessage({
    data: {
      type: 'note-on',
      midi: rootMidi,
      durationSeconds: 12,
      velocity: 1,
      seed,
    },
  });
  const voice = processor.voices[0];
  if (!voice) throw new Error(`Capture voice failed to start for MIDI ${rootMidi}.`);
  renderFrames(processor, voice, WARMUP_FRAMES, tap);
  return renderFrames(processor, voice, FRAME_LENGTH, tap);
}

function renderFrames(processor, voice, frames, tap) {
  const output = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let sub = 0; sub < QUALITY; sub += 1) {
      sum += tap === 'tone'
        ? processor.renderVoice(voice)
        : processor.analogSource(voice);
    }
    output[frame] = sum / QUALITY;
  }
  return output;
}

function encodeFloat32Le(values) {
  const output = Buffer.allocUnsafe(values.length * Float32Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < values.length; index += 1) {
    output.writeFloatLE(values[index], index * Float32Array.BYTES_PER_ELEMENT);
  }
  return output;
}

function loadProcessor(source) {
  class MockAudioWorkletProcessor {
    constructor() {
      this.port = {
        messages: [],
        onmessage: null,
        postMessage: (message) => this.port.messages.push(message),
        close() {},
      };
    }
  }
  let ProcessorClass = null;
  runInNewContext(source, {
    sampleRate: SAMPLE_RATE,
    AudioWorkletProcessor: MockAudioWorkletProcessor,
    registerProcessor(name, candidate) {
      if (name === 'calcotone-synth-circuit-processor') ProcessorClass = candidate;
    },
  });
  if (!ProcessorClass) throw new Error('Synth circuit processor did not register for capture rendering.');
  return ProcessorClass;
}
