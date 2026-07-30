import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import {
  HARDWARE_CALIBRATION_REVISION,
  atr102OperatingPoint,
  atrTapeTransfer,
  bbdClockTransfer,
  bbdOperatingPoint,
  converterOperatingPoint,
  opAmpTransfer,
  springTankOperatingPoint,
  springTransducerTransfer,
  summingBusOperatingPoint,
  summingBusTransfer,
  tapeTransportOperatingPoint,
  tapeTransportTransfer,
  tascam424OperatingPoint,
  transformerTransfer,
} from '../src/audio/models/HardwareCalibration.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_PATH = resolve(ROOT, 'circuits/modules/static-hardware-stage-template.cir');
const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const START_TIME = 0.04;
const STOP_TIME = 0.10;
const OUTPUT_STEP = 1 / SAMPLE_RATE;
const MAX_STEP = OUTPUT_STEP / 4;
const failures = [];
const reports = [];

const STATIC_CASES = [
  {
    id: 'bbd-clock',
    amplitude: 0.72,
    frequency: 375,
    transfer: (input) => bbdClockTransfer(input, 0.68),
    expression: normalizedTanhExpression(1 + 0.68 * 2.2),
  },
  {
    id: 'tape-transport',
    amplitude: 0.72,
    frequency: 375,
    transfer: (input) => tapeTransportTransfer(input, 0.74, 0.66),
    expression: tapeTransportExpression(0.74, 0.66),
  },
  {
    id: 'spring-transducer',
    amplitude: 0.72,
    frequency: 375,
    transfer: (input) => springTransducerTransfer(input, 0.62),
    expression: springExpression(0.62),
  },
  {
    id: 'tascam-opamp',
    amplitude: 0.72,
    frequency: 375,
    transfer: (input) => opAmpTransfer(input, 4.2, 0.05),
    expression: opAmpExpression(4.2, 0.05),
  },
  {
    id: 'neve-summing',
    amplitude: 0.72,
    frequency: 375,
    transfer: (input) => summingBusTransfer(input, 0.038, 0.018),
    expression: summingExpression(0.038, 0.018),
  },
  {
    id: 'atr-transformer',
    amplitude: 0.72,
    frequency: 375,
    transfer: (input) => transformerTransfer(input, 3.2, 0.018),
    expression: transformerExpression(3.2, 0.018),
  },
  {
    id: 'atr-tape',
    amplitude: 0.72,
    frequency: 375,
    transfer: (input) => atrTapeTransfer(input, 4.6, 0.24),
    expression: atrTapeExpression(4.6, 0.24),
  },
];

try {
  main();
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}

if (failures.length) {
  console.error('\nCALCOTONE module hardware calibration failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exitCode = 1;
} else {
  for (const report of reports) console.log(report);
  console.log(`CALCOTONE module hardware calibration passed (${HARDWARE_CALIBRATION_REVISION}).`);
}

function main() {
  const requireNgspice = process.argv.includes('--require-ngspice');
  const template = readRequired(TEMPLATE_PATH);
  validateTemplate(template);
  validateOperatingPoints();
  validateWorklets();

  const ngspiceVersion = detectNgspice();
  if (!ngspiceVersion) {
    if (requireNgspice) {
      throw new Error('ngspice is required but was not found on PATH. Install ngspice and rerun npm run audit:hardware-spice:strict.');
    }
    reports.push(`static transfer probes=${STATIC_CASES.length} (ngspice comparison skipped: not installed)`);
    return;
  }

  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'calcotone-hardware-spice-'));
  try {
    for (const testCase of STATIC_CASES) {
      const error = renderNgspiceCase(testCase, template, temporaryDirectory);
      reports.push(`${testCase.id} SPICE max-error=${error.toExponential(2)}`);
      if (error > 0.0025) {
        failures.push(`${testCase.id}: realtime transfer differs from ngspice by ${error.toExponential(3)}`);
      }
    }
    reports.push(`ngspice=${ngspiceVersion}`);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function readRequired(path) {
  if (!existsSync(path)) throw new Error(`Missing calibration asset: ${path}`);
  return readFileSync(path, 'utf8');
}

function validateTemplate(template) {
  for (const token of [
    'INPUT_AMPLITUDE',
    'INPUT_FREQUENCY',
    'TRANSFER_EXPRESSION',
    'OUTPUT_STEP',
    'STOP_TIME',
    'START_TIME',
    'MAX_STEP',
    'OUTPUT_PATH',
  ]) {
    if (!template.includes(`{{${token}}}`)) failures.push(`SPICE template is missing {{${token}}}`);
  }
  for (const testCase of STATIC_CASES) fillTemplate(template, replacements(testCase, `/tmp/${testCase.id}.data`));
}

function validateOperatingPoints() {
  const bbdShort = bbdOperatingPoint(0.008, 0.2, 0.7, 0.1);
  const bbdLong = bbdOperatingPoint(0.48, 0.8, 0.3, 0.8);
  assert(bbdLong.bucketCutoffHz < bbdShort.bucketCutoffHz, 'BBD bucket bandwidth must fall as delay/character loss rises');
  assert(bbdLong.compander.ratio > bbdShort.compander.ratio, 'BBD encode ratio must rise with character');

  const tapeClean = tapeTransportOperatingPoint(1, 0, 0.8, 0.1);
  const tapeWorn = tapeTransportOperatingPoint(0.2, 0.9, 0.3, 0.8);
  assert(tapeWorn.headLossHz < tapeClean.headLossHz, 'tape wear/speed must reduce head bandwidth');
  assert(tapeWorn.wowDepthSeconds > tapeClean.wowDepthSeconds, 'tape wear must increase capstan instability');

  const springShort = springTankOperatingPoint(0.1, 0.1, 0.5, 0.2);
  const springLong = springTankOperatingPoint(0.9, 0.9, 0.5, 0.8);
  assert(springLong.feedbackGain > springShort.feedbackGain, 'spring decay must raise tank feedback');
  assert(springLong.tapTimesSeconds[3] > springShort.tapTimesSeconds[3], 'spring size must lengthen dispersive taps');

  const converterLow = converterOperatingPoint(8, 0.2, 0.8);
  const converterHigh = converterOperatingPoint(14, 0.9, 0.1);
  assert(converterLow.curveBits === 8 && converterHigh.curveBits === 14, 'converter word length must retain calibrated bit depth');
  assert(converterHigh.reconstructionHz > converterLow.reconstructionHz, 'converter bandwidth control must move both filters');

  const neve = summingBusOperatingPoint('Neve 1073', 0.7, 0.16, 0.1, 0.6);
  const ssl = summingBusOperatingPoint('SSL 4000E', 0.7, 0.16, 0.1, 0.6);
  const api = summingBusOperatingPoint('API 1608', 0.7, 0.16, 0.1, 0.6);
  assert(neve.asymmetry > api.asymmetry && api.asymmetry > ssl.asymmetry, 'console paths must retain distinct nonlinear asymmetry');

  const tascam = tascam424OperatingPoint(0.7, 0.16, 0.1, 0.8);
  assert(tascam.highpassHz === 28 && tascam.lowpassHz === 19_000, 'TASCAM 424 insert bandwidth drifted');
  assert(tascam.outputGain > 0 && tascam.outputGain <= 1, 'TASCAM 424 auto-trim is outside a stable range');

  const atrSlow = atr102OperatingPoint(0.6, 0.04, 0.3, 0.6);
  const atrFast = atr102OperatingPoint(0.6, 0.9, 0.3, 0.6);
  assert(atrSlow.lowpassHz < atrFast.lowpassHz, 'ATR-102 speed must widen electronics/head bandwidth');
  assert(atrSlow.instabilitySeconds > atrFast.instabilitySeconds, 'ATR-102 slow speed must increase transport instability');

  const mediaSource = readRequired(resolve(ROOT, 'src/audio/effects/Media.ts'));
  const tascamBranch = mediaSource.slice(
    mediaSource.indexOf("if (this.mode === 'tascam424')"),
    mediaSource.indexOf("if (this.mode === 'Neve 1073'"),
  );
  for (const contract of ['this.disableTransport(now)', 'this.setCrossfeed(0, now)']) {
    assert(tascamBranch.includes(contract), `TASCAM 424 contract lost ${contract}`);
  }
  reports.push('operating points=BBD/compander, tape, spring, converter, consoles, TASCAM 424, ATR-102');
}

function validateWorklets() {
  const TubeProcessor = loadProcessor(
    'public/ember-tube-processor.js',
    'calcotone-ember-tube-processor',
  );
  const MagneticProcessor = loadProcessor(
    'public/magnetic-core-processor.js',
    'calcotone-magnetic-core-processor',
  );
  const DriftProcessor = loadProcessor(
    'public/drift-classic-processor.js',
    'calcotone-drift-classic-processor',
  );
  if (!TubeProcessor || !MagneticProcessor || !DriftProcessor) return;

  const tubeMetrics = [];
  for (let model = 1; model <= 5; model += 1) {
    const low = renderWorkletTone(TubeProcessor, {
      model,
      amplitude: 0.08,
      parameters: { drive: 0.72, heat: 0.64, character: 0.58, dynamics: 0.76 },
    });
    const high = renderWorkletTone(TubeProcessor, {
      model,
      amplitude: 0.72,
      parameters: { drive: 0.72, heat: 0.64, character: 0.58, dynamics: 0.76 },
    });
    assertMetrics(`Ember tube ${model} low`, low);
    assertMetrics(`Ember tube ${model} high`, high);
    assert(high.gain <= low.gain * 1.08, `Ember tube ${model} lost its level-dependent compression`);
    tubeMetrics.push(high.thd);
  }
  assert(Math.max(...tubeMetrics) - Math.min(...tubeMetrics) > 0.002, 'named Ember tube profiles collapsed to the same harmonic response');
  reports.push(`Ember tubes THD=${tubeMetrics.map((value) => (value * 100).toFixed(2)).join('/') }%`);

  const magneticLow = renderWorkletTone(MagneticProcessor, {
    model: null,
    amplitude: 0.08,
    parameters: { drive: 0.76, heat: 0.68, character: 0.62, dynamics: 0.72 },
  });
  const magneticHigh = renderWorkletTone(MagneticProcessor, {
    model: null,
    amplitude: 0.72,
    parameters: { drive: 0.76, heat: 0.68, character: 0.62, dynamics: 0.72 },
  });
  assertMetrics('Ember magnetic core low', magneticLow);
  assertMetrics('Ember magnetic core high', magneticHigh);
  assert(magneticHigh.thd > magneticLow.thd, 'magnetic core saturation must add harmonics with level');
  reports.push(`Ember magnetic-core THD=${(magneticLow.thd * 100).toFixed(2)}→${(magneticHigh.thd * 100).toFixed(2)}%`);

  const driftDifferences = [];
  for (let model = 1; model <= 4; model += 1) {
    const difference = renderDriftDifference(DriftProcessor, model);
    assert(Number.isFinite(difference) && difference > 0.002, `Drift model ${model} did not produce a calibrated analog-network response`);
    driftDifferences.push(difference);
  }
  reports.push(`Drift network deltas=${driftDifferences.map((value) => value.toFixed(3)).join('/')}`);
}

function loadProcessor(relativePath, registrationName) {
  const source = readRequired(resolve(ROOT, relativePath));
  let Processor = null;
  class MockAudioWorkletProcessor {
    constructor() {
      this.port = { onmessage: null, postMessage() {}, close() {} };
    }
  }
  runInNewContext(source, {
    sampleRate: SAMPLE_RATE,
    AudioWorkletProcessor: MockAudioWorkletProcessor,
    registerProcessor(name, candidate) {
      if (name === registrationName) Processor = candidate;
    },
  });
  if (!Processor) failures.push(`${relativePath}: ${registrationName} did not register`);
  return Processor;
}

function renderWorkletTone(Processor, options) {
  const processor = new Processor();
  processor.port.onmessage?.({ data: { type: 'quality', factor: 2 } });
  const frequency = 375;
  const parameters = Object.fromEntries(
    Object.entries({
      ...(options.model === null ? {} : { model: options.model }),
      ...options.parameters,
    }).map(([name, value]) => [name, new Float32Array([value])]),
  );
  const samples = [];
  let peak = 0;
  for (let block = 0; block < 180; block += 1) {
    const input = [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)];
    const output = [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)];
    for (let index = 0; index < BLOCK_SIZE; index += 1) {
      const frame = block * BLOCK_SIZE + index;
      const value = Math.sin(frame / SAMPLE_RATE * Math.PI * 2 * frequency) * options.amplitude;
      input[0][index] = value;
      input[1][index] = value;
    }
    processor.process([[...input]], [[...output]], parameters);
    if (block >= 100) {
      for (const sample of output[0]) {
        samples.push(sample);
        peak = Math.max(peak, Math.abs(sample));
      }
    }
  }
  return harmonicMetrics(samples, frequency, options.amplitude, peak);
}

function harmonicMetrics(samples, frequency, inputAmplitude, peak) {
  const bins = [];
  let dc = 0;
  for (const sample of samples) dc += sample;
  dc /= samples.length;
  for (let harmonic = 1; harmonic <= 8; harmonic += 1) {
    let real = 0;
    let imaginary = 0;
    const angular = Math.PI * 2 * frequency * harmonic / SAMPLE_RATE;
    for (let index = 0; index < samples.length; index += 1) {
      real += samples[index] * Math.cos(angular * index);
      imaginary -= samples[index] * Math.sin(angular * index);
    }
    bins.push(2 * Math.hypot(real, imaginary) / samples.length);
  }
  const fundamental = Math.max(1e-9, bins[0]);
  const harmonicPower = bins.slice(1).reduce((sum, value) => sum + value * value, 0);
  return {
    gain: fundamental / Math.max(1e-9, inputAmplitude),
    thd: Math.sqrt(harmonicPower) / fundamental,
    dc,
    peak,
  };
}

function assertMetrics(label, metrics) {
  assert(Object.values(metrics).every(Number.isFinite), `${label} produced non-finite metrics`);
  assert(metrics.peak <= 1.201, `${label} exceeded the realtime output rail (${metrics.peak.toFixed(4)})`);
  assert(metrics.gain > 0.04 && metrics.gain < 2.5, `${label} gain is outside the calibrated range (${metrics.gain.toFixed(4)})`);
  assert(Math.abs(metrics.dc) < 0.08, `${label} DC offset is outside the calibrated range (${metrics.dc.toFixed(4)})`);
}

function renderDriftDifference(Processor, model) {
  const processor = new Processor();
  const parameters = Object.fromEntries(
    Object.entries({ model, rate: 0.64, depth: 0.78, shape: 0.62, spread: 0.7, motion: 0.66 })
      .map(([name, value]) => [name, new Float32Array([value])]),
  );
  let sumSquares = 0;
  let count = 0;
  for (let block = 0; block < 180; block += 1) {
    const input = [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)];
    const output = [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)];
    for (let index = 0; index < BLOCK_SIZE; index += 1) {
      const frame = block * BLOCK_SIZE + index;
      input[0][index] = Math.sin(frame / SAMPLE_RATE * Math.PI * 2 * 613) * 0.42;
      input[1][index] = input[0][index];
    }
    processor.process([[...input]], [[...output]], parameters);
    if (block < 80) continue;
    for (let index = 0; index < BLOCK_SIZE; index += 1) {
      const delta = output[0][index] - input[0][index];
      if (!Number.isFinite(delta) || Math.abs(output[0][index]) > 1.201) return Number.NaN;
      sumSquares += delta * delta;
      count += 1;
    }
  }
  return Math.sqrt(sumSquares / Math.max(1, count));
}

function renderNgspiceCase(testCase, template, temporaryDirectory) {
  const outputPath = join(temporaryDirectory, `${testCase.id}.data`);
  const circuitPath = join(temporaryDirectory, `${testCase.id}.cir`);
  const logPath = join(temporaryDirectory, `${testCase.id}.log`);
  writeFileSync(circuitPath, fillTemplate(template, replacements(testCase, outputPath)), 'utf8');
  const run = spawnSync('ngspice', ['-b', '-o', logPath, circuitPath], {
    cwd: temporaryDirectory,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (run.status !== 0 || !existsSync(outputPath)) {
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : run.stderr || run.stdout;
    throw new Error(`ngspice failed for ${testCase.id}:\n${log}`);
  }
  let maximumError = 0;
  let sampleCount = 0;
  for (const line of readFileSync(outputPath, 'utf8').split(/\r?\n/)) {
    const values = line.trim().split(/\s+/).map(Number);
    if (values.length < 2 || values.some((value) => !Number.isFinite(value))) continue;
    const time = values[0];
    if (time < START_TIME) continue;
    const actual = values.at(-1);
    const input = Math.sin(Math.PI * 2 * testCase.frequency * time) * testCase.amplitude;
    maximumError = Math.max(maximumError, Math.abs(actual - testCase.transfer(input)));
    sampleCount += 1;
  }
  if (sampleCount < 100) throw new Error(`${testCase.id}: ngspice returned too few calibration samples`);
  return maximumError;
}

function replacements(testCase, outputPath) {
  return {
    INPUT_AMPLITUDE: spiceNumber(testCase.amplitude),
    INPUT_FREQUENCY: spiceNumber(testCase.frequency),
    TRANSFER_EXPRESSION: testCase.expression,
    OUTPUT_STEP: spiceNumber(OUTPUT_STEP),
    STOP_TIME: spiceNumber(STOP_TIME),
    START_TIME: spiceNumber(START_TIME),
    MAX_STEP: spiceNumber(MAX_STEP),
    OUTPUT_PATH: outputPath.replaceAll('\\', '/'),
  };
}

function fillTemplate(template, values) {
  let output = template;
  for (const [name, value] of Object.entries(values)) {
    output = output.replaceAll(`{{${name}}}`, String(value));
  }
  const unresolved = output.match(/\{\{[A-Z_]+\}\}/g);
  if (unresolved) throw new Error(`Unresolved SPICE template tokens: ${unresolved.join(', ')}`);
  return output;
}

function normalizedTanhExpression(drive) {
  return `tanh(v(in)*${spiceNumber(drive)})/tanh(${spiceNumber(drive)})`;
}

function tapeTransportExpression(drive, bias) {
  const gain = 1 + drive * 4.4;
  const asymmetry = (bias - 0.5) * 0.12;
  return `tanh((v(in)+max(0,v(in))*${spiceNumber(asymmetry)})*${spiceNumber(gain)})/tanh(${spiceNumber(gain)})`;
}

function springExpression(amount) {
  const gain = 1 + amount * 3.1;
  return `tanh((v(in)+max(0,v(in))*${spiceNumber(amount * 0.05)})*${spiceNumber(gain)})/tanh(${spiceNumber(gain)})`;
}

function opAmpExpression(drive, asymmetry) {
  const safeDrive = Math.max(1, Math.round(drive * 128) / 128);
  const asym = Math.round(asymmetry * 512) / 512;
  const positiveDrive = safeDrive * (1 + asym);
  const negativeDrive = safeDrive * (1 - asym * 0.62);
  return `if(v(in)>=0,tanh(v(in)*${spiceNumber(positiveDrive)})/tanh(${spiceNumber(positiveDrive)}),tanh(v(in)*${spiceNumber(negativeDrive)})/tanh(${spiceNumber(negativeDrive)}))`;
}

function summingExpression(compression, asymmetry) {
  const comp = Math.max(0, Math.min(0.12, Math.round(compression * 512) / 512));
  const asym = Math.max(-0.08, Math.min(0.08, Math.round(asymmetry * 512) / 512));
  return `min(1,max(-1,v(in)-${spiceNumber(comp)}*v(in)^3+${spiceNumber(asym)}*v(in)^2*(1-abs(v(in)))))`;
}

function transformerExpression(drive, asymmetry) {
  const safeDrive = Math.max(1, Math.round(drive * 128) / 128);
  const asym = Math.round(asymmetry * 512) / 512;
  return `min(1,max(-1,0.985*tanh((v(in)+${spiceNumber(asym)}*v(in)^2*if(v(in)>=0,1,-0.42))*${spiceNumber(safeDrive)})/tanh(${spiceNumber(safeDrive)})))`;
}

function atrTapeExpression(drive, bias) {
  const safeDrive = Math.max(1, Math.round(drive * 128) / 128);
  const quantizedBias = Math.round(bias * 256) / 256;
  const even = 0.018 + quantizedBias * 0.012;
  return `min(1,max(-1,(tanh((v(in)+${spiceNumber(quantizedBias * 0.035)}+v(in)^2*${spiceNumber(even)})*${spiceNumber(safeDrive)})/tanh(${spiceNumber(safeDrive)}))*(1-min(0.085,abs(v(in))*${spiceNumber(0.045 * safeDrive)}))))`;
}

function spiceNumber(value) {
  return Number(value).toExponential(12);
}

function detectNgspice() {
  const result = spawnSync('ngspice', ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return (result.stdout || result.stderr).split(/\r?\n/).find((line) => line.trim())?.trim() ?? 'ngspice';
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}
