import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const WARMUP_SECONDS = .025;
const MEASURED_SECONDS = .1;
const processorPath = resolve(process.cwd(), 'public/synth-circuit-processor.js');
const baselineArgument = process.argv.find((argument) => argument.startsWith('--baseline-ref='));
const baselineRef = baselineArgument?.slice('--baseline-ref='.length);
const machineArgument = process.argv.find((argument) => argument.startsWith('--machine='));
const machine = machineArgument?.slice('--machine='.length) || 'model-d';

const current = benchmark(readFileSync(processorPath, 'utf8'), machine);

let comparison = '';
if (baselineRef) {
  const baselineSource = readBaseline(baselineRef);
  const baseline = benchmark(baselineSource, machine);
  const speedup = baseline.elapsedMilliseconds / current.elapsedMilliseconds;
  comparison = speedup >= 1
    ? `; ${speedup.toFixed(2)}× baseline throughput versus ${baselineRef}`
    : `; ${(1 / speedup).toFixed(2)}× slower than ${baselineRef}`;
}

console.log(
  `CALCOTONE synth VM stress probe completed (${machine} 10 voices, 4× oversampling: `
  + `${current.elapsedMilliseconds.toFixed(1)} ms for ${Math.round(MEASURED_SECONDS * 1_000)} ms of audio`
  + `${comparison}).`,
);

function benchmark(source, targetMachine) {
  const Processor = loadProcessor(source);
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'enabled', value: true } });
  processor.port.onmessage({ data: { type: 'machine', value: targetMachine } });
  processor.port.onmessage({ data: { type: 'parameters', values: [.61, .82, 1, .52, .92, .31] } });
  processor.port.onmessage({ data: { type: 'quality', factor: 4 } });
  for (let voice = 0; voice < 10; voice += 1) {
    processor.port.onmessage({
      data: {
        type: 'note-on',
        midi: 42 + voice * 3,
        durationSeconds: 4,
        velocity: .82,
      },
    });
  }

  const channels = [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)];
  renderBlocks(processor, channels, Math.ceil(WARMUP_SECONDS * SAMPLE_RATE / BLOCK_SIZE));
  const startedAt = performance.now();
  renderBlocks(processor, channels, Math.ceil(MEASURED_SECONDS * SAMPLE_RATE / BLOCK_SIZE));
  const elapsedMilliseconds = performance.now() - startedAt;
  for (const channel of channels) {
    for (const sample of channel) {
      if (!Number.isFinite(sample)) throw new Error('Synth performance probe produced a non-finite sample.');
    }
  }
  return {
    elapsedMilliseconds,
    realtimeFactor: MEASURED_SECONDS / (elapsedMilliseconds / 1_000),
  };
}

function renderBlocks(processor, channels, blocks) {
  for (let block = 0; block < blocks; block += 1) {
    processor.process([], [channels]);
  }
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
  let Processor = null;
  runInNewContext(source, {
    sampleRate: SAMPLE_RATE,
    AudioWorkletProcessor: MockAudioWorkletProcessor,
    registerProcessor(name, candidate) {
      if (name === 'calcotone-synth-circuit-processor') Processor = candidate;
    },
  });
  if (!Processor) throw new Error('Synth circuit processor did not register for the performance probe.');
  return Processor;
}

function readBaseline(ref) {
  const result = spawnSync('git', ['show', `${ref}:public/synth-circuit-processor.js`], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout) {
    throw new Error(`Could not load synth processor from baseline ref ${ref}: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}
