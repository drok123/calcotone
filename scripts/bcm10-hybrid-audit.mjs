import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import {
  BCM10_CAPTURE_REVISION,
  bcm10CaptureFingerprint,
  bcm10CaptureTransfer,
  bcm10OperatingPoint,
} from '../src/audio/models/Bcm10Calibration.ts';
import {
  summingBusOperatingPoint,
  summingBusTransfer,
} from '../src/audio/models/HardwareCalibration.ts';

const failures = [];
const mediaSource = readFileSync(resolve(process.cwd(), 'src/audio/effects/Media.ts'), 'utf8');
const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

for (const contract of [
  "| 'Neve BCM10'",
  "'Ampex ATR-102','Neve BCM10'",
  "if (this.mode === 'Neve BCM10')",
  'bcm10OperatingPoint(this.wear, this.wow, this.noise, this.tone)',
  'getBcm10CaptureCurve(point.captureDrive, point.captureColor)',
  'getSummingCurve(point.busCompression, point.busAsymmetry)',
  'this.setCrossfeed(point.crossfeed, now)',
]) {
  if (!mediaSource.includes(contract)) failures.push(`Artifact BCM10 integration is missing ${JSON.stringify(contract)}`);
}

const orderMatch = mediaSource.match(/export const MEDIA_MODE_ORDER:[\s\S]*?\];/);
if (!orderMatch || orderMatch[0].indexOf("'Neve BCM10'") < orderMatch[0].indexOf("'Ampex ATR-102'")) {
  failures.push('BCM10 must be appended after every existing Artifact mode to preserve preset indices');
}

const captures = bcm10CaptureFingerprint();
if (captures.length !== 4) failures.push(`BCM10 capture lattice has ${captures.length} corners instead of 4`);
for (const [index, capture] of captures.entries()) {
  if (capture.length !== 2049) failures.push(`BCM10 capture corner ${index} has ${capture.length} samples instead of 2049`);
  for (const sample of capture) {
    if (!Number.isFinite(sample) || Math.abs(sample) > 1.001) {
      failures.push(`BCM10 capture corner ${index} contains an invalid or unbounded sample`);
      break;
    }
  }
}

const bcm10RecipeStart = appSource.indexOf("'media:Neve BCM10': [");
const bcm10RecipeEnd = bcm10RecipeStart < 0 ? -1 : appSource.indexOf('\n  ],', bcm10RecipeStart);
if (bcm10RecipeStart < 0 || bcm10RecipeEnd < 0) {
  failures.push('BCM10 is missing mode-specific musical randomization recipes');
} else {
  const recipe = appSource.slice(bcm10RecipeStart, bcm10RecipeEnd);
  for (const safeRange of [
    'wear:[0.14,0.28]', 'tone:[0.24,0.40]', 'mix:[0.18,0.30]',
    'wear:[0.28,0.46]', 'tone:[0.40,0.58]', 'mix:[0.20,0.34]',
  ]) {
    if (!recipe.includes(safeRange)) failures.push(`BCM10 SMART random recipe lost safe range ${safeRange}`);
  }
}
// MUTATE preserves the currently selected machine, so this guard applies when
// the user is already on BCM10. SMART mode is protected by the dedicated ranges above.
if (!appSource.includes("modeModule.mediaMode === 'Neve BCM10'")) {
  failures.push('BCM10 MUTATE path is missing mode-specific drive/mix guardrails');
}
if (!readFileSync(resolve(process.cwd(), 'src/audio/models/Bcm10Calibration.ts'), 'utf8').includes('const a0 = -0.5 * y0')) {
  failures.push('BCM10 capture lookup is missing cubic Hermite interpolation');
}

const clean = bcm10OperatingPoint(0.05, 0.16, 0.1, 0.18);
const driven = bcm10OperatingPoint(0.9, 0.75, 0.8, 0.92);
if (!(driven.inputGain > clean.inputGain)) failures.push('BCM10 tone/loading controls do not raise channel drive');
if (!(driven.busCompression > clean.busCompression)) failures.push('BCM10 live 1272 bus does not increase compression with loading/drive');
if (!(driven.crossfeed > clean.crossfeed)) failures.push('BCM10 channel convergence does not respond to loading/drive');
if (!(driven.lowpassHz < clean.lowpassHz)) failures.push('BCM10 transformer bandwidth does not narrow under loading');

const lowCapture = renderTransfer(0.12, 0.2);
const highCapture = renderTransfer(0.9, 0.85);
const captureDistance = normalizedDistance(lowCapture, highCapture);
if (captureDistance < 0.025) failures.push(`BCM10 capture lattice corners collapsed (${captureDistance.toFixed(4)})`);

const bcm10Default = bcm10OperatingPoint(0.162, 0.16, 0.1, 0.62);
const neveDefault = summingBusOperatingPoint('Neve 1073', 0.162, 0.16, 0.1, 0.62);
const bcm10Composite = renderComposite(bcm10Default);
const neveComposite = renderNeve(neveDefault);
const modelDistance = normalizedDistance(bcm10Composite, neveComposite);
if (modelDistance < 0.018) failures.push(`BCM10 collapsed into the existing Neve 1073 path (${modelDistance.toFixed(4)})`);

let worstSmallSignalGainError = 0;
let loudestProgramGain = 0;
let worstDcOffset = 0;
for (const wear of [0, 0.5, 1]) {
  for (const tone of [0, 0.5, 1]) {
    const point = bcm10OperatingPoint(wear, 0.16, 0.1, tone);
    const smallSignalGain = centralSlope(point);
    const quiet = sineMetrics(point, 0.01);
    const program = sineMetrics(point, 0.5);
    worstSmallSignalGainError = Math.max(
      worstSmallSignalGainError,
      Math.abs(smallSignalGain - 1),
      Math.abs(quiet.rmsGain - 1),
    );
    loudestProgramGain = Math.max(loudestProgramGain, program.rmsGain);
    worstDcOffset = Math.max(worstDcOffset, Math.abs(program.mean));
    if (!isMonotonic(point)) failures.push(`BCM10 transfer is not monotonic at wear=${wear}, tone=${tone}`);
  }
}
if (worstSmallSignalGainError > 0.025) {
  failures.push(`BCM10 low-level auto-trim deviates by ${(worstSmallSignalGainError * 100).toFixed(2)}%`);
}
if (loudestProgramGain > 1.01) {
  failures.push(`BCM10 program path still adds gain (${(20 * Math.log10(loudestProgramGain)).toFixed(2)} dB)`);
}
if (worstDcOffset > 0.004) {
  failures.push(`BCM10 asymmetric stages produce excessive DC (${worstDcOffset.toFixed(5)})`);
}

for (const mix of [0, 0.25, 0.5, 0.75, 1]) {
  const mixed = mixedSineMetrics(bcm10Default, 0.01, mix);
  if (Math.abs(mixed.rmsGain - 1) > 0.025) {
    failures.push(`BCM10 Mix=${mix} changes low-level gain to ${mixed.rmsGain.toFixed(3)}`);
  }
}

const startedAt = performance.now();
let checksum = 0;
for (let pass = 0; pass < 120; pass += 1) {
  const drive = (pass % 17) / 16;
  const color = (pass % 11) / 10;
  for (let index = 0; index < 4096; index += 1) {
    checksum += bcm10CaptureTransfer(index / 2047.5 - 1, drive, color);
  }
}
const elapsedMilliseconds = performance.now() - startedAt;
if (!Number.isFinite(checksum)) failures.push('BCM10 capture interpolation produced a non-finite checksum');
if (elapsedMilliseconds > 450) failures.push(`BCM10 capture interpolation exceeded its offline audit budget (${elapsedMilliseconds.toFixed(1)} ms)`);

if (failures.length) {
  console.error('\nCALCOTONE BCM10 hybrid audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log(
  `CALCOTONE BCM10 hybrid audit passed (${BCM10_CAPTURE_REVISION}; `
  + `capture distance=${captureDistance.toFixed(3)}, model distance=${modelDistance.toFixed(3)}, `
  + `level error=${(worstSmallSignalGainError * 100).toFixed(2)}%, `
  + `lookup=${elapsedMilliseconds.toFixed(1)} ms).`,
);

function renderTransfer(drive, color) {
  const output = new Float32Array(4096);
  for (let index = 0; index < output.length; index += 1) {
    const input = index / (output.length - 1) * 2 - 1;
    output[index] = bcm10CaptureTransfer(input, drive, color);
  }
  return output;
}

function renderComposite(point) {
  const output = new Float32Array(4096);
  for (let index = 0; index < output.length; index += 1) {
    const input = index / (output.length - 1) * 2 - 1;
    const channel = bcm10CaptureTransfer(input * point.inputGain, point.captureDrive, point.captureColor);
    output[index] = summingBusTransfer(channel, point.busCompression, point.busAsymmetry) * point.outputGain;
  }
  return output;
}

function compositeSample(input, point) {
  const channel = bcm10CaptureTransfer(input * point.inputGain, point.captureDrive, point.captureColor);
  return summingBusTransfer(channel, point.busCompression, point.busAsymmetry) * point.outputGain;
}

function centralSlope(point) {
  const epsilon = 1e-5;
  return (compositeSample(epsilon, point) - compositeSample(-epsilon, point)) / (2 * epsilon);
}

function sineMetrics(point, amplitude) {
  let inputEnergy = 0;
  let outputEnergy = 0;
  let outputSum = 0;
  const length = 16_384;
  for (let index = 0; index < length; index += 1) {
    const input = Math.sin(index * Math.PI * 2 / 257) * amplitude;
    const output = compositeSample(input, point);
    inputEnergy += input * input;
    outputEnergy += output * output;
    outputSum += output;
  }
  return {
    rmsGain: Math.sqrt(outputEnergy / Math.max(1e-12, inputEnergy)),
    mean: outputSum / length,
  };
}

function mixedSineMetrics(point, amplitude, mix) {
  let inputEnergy = 0;
  let outputEnergy = 0;
  const length = 16_384;
  for (let index = 0; index < length; index += 1) {
    const input = Math.sin(index * Math.PI * 2 / 257) * amplitude;
    const output = input * (1 - mix) + compositeSample(input, point) * mix;
    inputEnergy += input * input;
    outputEnergy += output * output;
  }
  return { rmsGain: Math.sqrt(outputEnergy / Math.max(1e-12, inputEnergy)) };
}

function isMonotonic(point) {
  let previous = compositeSample(-1, point);
  for (let index = 1; index <= 4096; index += 1) {
    const current = compositeSample(index / 2048 - 1, point);
    if (current + 1e-6 < previous) return false;
    previous = current;
  }
  return true;
}

function renderNeve(point) {
  const output = new Float32Array(4096);
  for (let index = 0; index < output.length; index += 1) {
    const input = index / (output.length - 1) * 2 - 1;
    const pre = summingBusTransfer(input, point.preCompression, point.asymmetry);
    output[index] = summingBusTransfer(pre, point.postCompression, point.asymmetry * 0.55);
  }
  return output;
}

function normalizedDistance(left, right) {
  let difference = 0;
  let reference = 0;
  for (let index = 0; index < left.length; index += 1) {
    const delta = left[index] - right[index];
    difference += delta * delta;
    reference += left[index] * left[index] + right[index] * right[index];
  }
  return Math.sqrt(difference / Math.max(1e-12, reference * 0.5));
}
