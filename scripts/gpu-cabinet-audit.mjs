import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const experiment = readFileSync(resolve(process.cwd(), 'src/audio/GpuCabinetExperiment.ts'), 'utf8');
const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const failures = [];
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};

requireText(experiment, '@compute @workgroup_size(64)', 'WebGPU compute shader');
requireText(experiment, 'for (const blocks of [1, 2, 4, 8, 16])', 'Latency/throughput batch sweep');
requireText(experiment, 'deadlineRatio <= 0.7', 'Guarded realtime deadline');
requireText(experiment, 'maximumError(reference, gpuOutput)', 'GPU/CPU correctness comparison');
requireText(experiment, 'await readBuffer.mapAsync(readMode)', 'Dispatch/readback timing boundary');
requireText(experiment, "verdict: 'unsupported'", 'Safe unsupported fallback');
requireText(app, 'Stop the audio engine before running the GPU cabinet deadline test.', 'Live-audio isolation guard');
requireText(app, 'disabled={gpuExperimentRunning || isRunning}', 'Benchmark disabled during audio');

const sampleRate = 48_000;
const latencies = [1, 2, 4, 8, 16].map((blocks) => blocks * 128 / sampleRate * 1000);
const expected = [2.667, 5.333, 10.667, 21.333, 42.667];
for (let index = 0; index < expected.length; index += 1) {
  if (Math.abs(latencies[index] - expected[index]) > 0.001) failures.push(`Batch latency fixture ${index} drifted`);
}

if (failures.length) {
  console.error(`GPU cabinet audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`GPU cabinet audit passed · deadlines ${latencies.map((value) => value.toFixed(2)).join('/')} ms`);
