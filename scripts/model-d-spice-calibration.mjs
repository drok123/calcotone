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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROCESSOR_PATH = resolve(ROOT, 'public/synth-circuit-processor.js');
const NETLIST_PATH = resolve(ROOT, 'circuits/model-d/model-d-ladder-template.cir');
const SAMPLE_RATE = 48_000;
const OVERSAMPLE = 4;
const INTERNAL_RATE = SAMPLE_RATE * OVERSAMPLE;
const OUTPUT_STEP = 1 / INTERNAL_RATE;
const MAX_STEP = OUTPUT_STEP / 4;
const START_TIME = .08;
const STOP_TIME = .18;
const TAU = Math.PI * 2;
const BOLTZMANN_CONSTANT = 1.380649e-23;
const ELECTRON_CHARGE = 1.602176634e-19;
const CAPACITANCE = 68e-9;
const PROFILE_CUTOFF = 5400;
const PROFILE_RESONANCE = .67;
const PROFILE_DRIVE = 2.1;
const SIGNAL_VOLTAGE = .12;

const CASES = [
  { id: 'low-clean', color: .18, resonance: .05, contour: .5, character: .25, amplitude: .08, frequency: 110, temperatureC: 27 },
  { id: 'low-resonant', color: .18, resonance: .86, contour: .5, character: .25, amplitude: .08, frequency: 110, temperatureC: 27 },
  { id: 'mid-clean', color: .5, resonance: .08, contour: .5, character: .4, amplitude: .08, frequency: 440, temperatureC: 27 },
  { id: 'mid-resonant', color: .5, resonance: .78, contour: .5, character: .4, amplitude: .08, frequency: 440, temperatureC: 27 },
  { id: 'high-clean', color: .82, resonance: .08, contour: .5, character: .4, amplitude: .08, frequency: 1760, temperatureC: 27 },
  { id: 'drive-warm', color: .5, resonance: .45, contour: .5, character: .55, amplitude: .45, frequency: 220, temperatureC: 27 },
  { id: 'drive-hot', color: .5, resonance: .45, contour: .5, character: .95, amplitude: .9, frequency: 220, temperatureC: 42 },
];

const LIMITS = {
  gainDb: 3,
  phaseDegrees: 35,
  peakDb: 3,
  thdAbsolute: .12,
  dcAbsolute: .02,
};

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nCALCOTONE Model D SPICE calibration failed:\n\n${message}\n`);
  process.exitCode = 1;
}

function main() {
  const requireNgspice = process.argv.includes('--require-ngspice');
  const jsonOutput = process.argv.includes('--json');
  const processorSource = readRequired(PROCESSOR_PATH);
  const netlistTemplate = readRequired(NETLIST_PATH);
  validateAssets(processorSource, netlistTemplate);
  for (const testCase of CASES) {
    fillTemplate(netlistTemplate, netlistReplacements(testCase, `/tmp/${testCase.id}.data`));
  }
  const Processor = loadProcessor(processorSource);
  const realtimeResults = CASES.map((testCase) => ({
    case: testCase,
    metrics: renderRealtimeProbe(Processor, testCase),
  }));

  validateRealtimeResults(realtimeResults);

  const ngspiceVersion = detectNgspice();
  if (!ngspiceVersion) {
    if (requireNgspice) {
      fail('ngspice is required but was not found on PATH. Install ngspice and rerun npm run audit:spice:strict.');
    }
    if (jsonOutput) {
      console.log(JSON.stringify({
        status: 'worklet-only',
        reason: 'ngspice-not-found',
        realtime: serializeResults(realtimeResults),
      }, null, 2));
    } else {
      printRealtimeTable(realtimeResults);
      console.log('\nCALCOTONE SPICE calibration probe passed; ngspice is not installed, so circuit comparison was skipped.');
      console.log('Run npm run audit:spice:strict on a machine with ngspice to enforce the offline reference tolerances.');
    }
    return;
  }

  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'calcotone-model-d-spice-'));
  try {
    const spiceResults = CASES.map((testCase) => ({
      case: testCase,
      metrics: renderNgspiceProbe(testCase, temporaryDirectory, netlistTemplate),
    }));
    const comparisons = realtimeResults.map((realtime, index) =>
      compareMetrics(realtime.case, realtime.metrics, spiceResults[index].metrics));
    const failures = comparisons.flatMap((comparison) => comparison.failures);

    if (jsonOutput) {
      console.log(JSON.stringify({
        status: failures.length ? 'failed' : 'passed',
        ngspiceVersion,
        realtime: serializeResults(realtimeResults),
        spice: serializeResults(spiceResults),
        comparisons,
      }, null, 2));
    } else {
      printComparisonTable(comparisons);
    }

    if (failures.length) {
      fail(`Model D SPICE calibration exceeded ${failures.length} tolerance${failures.length === 1 ? '' : 's'}:\n${failures.map((failure) => ` - ${failure}`).join('\n')}`);
    }
    if (!jsonOutput) {
      console.log(`\nCALCOTONE Model D SPICE calibration passed (${CASES.length} probes against ${ngspiceVersion}).`);
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function readRequired(path) {
  if (!existsSync(path)) fail(`Missing calibration asset: ${path}`);
  return readFileSync(path, 'utf8');
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
  if (!ProcessorClass) fail('Synth circuit processor did not register for the calibration probe.');
  return ProcessorClass;
}

function renderRealtimeProbe(ProcessorClass, testCase) {
  const processor = new ProcessorClass();
  const parameters = [0, testCase.color, testCase.resonance, testCase.contour, testCase.character, 0];
  processor.port.onmessage({ data: { type: 'enabled', value: true } });
  processor.port.onmessage({ data: { type: 'machine', value: 'model-d' } });
  processor.port.onmessage({ data: { type: 'parameters', values: parameters } });
  processor.port.onmessage({ data: { type: 'quality', factor: OVERSAMPLE } });
  processor.port.onmessage({ data: { type: 'note-on', midi: 60, durationSeconds: 1, velocity: 1 } });

  const voice = processor.voices[0];
  voice.parameters = parameters;
  voice.temperatureK = testCase.temperatureC + 273.15;
  voice.thermalVoltage = thermalVoltage(voice.temperatureK);
  voice.ladderCapacitances.fill(CAPACITANCE);
  voice.ladderMismatch.fill(0);
  voice.ladderCurrents.fill(0);
  voice.poles.fill(0);
  voice.supplySag = 0;

  const samples = [];
  const times = [];
  const totalSamples = Math.ceil(STOP_TIME * INTERNAL_RATE);
  const dt = 1 / INTERNAL_RATE;
  for (let index = 0; index < totalSamples; index += 1) {
    const time = index * dt;
    const input = Math.sin(TAU * testCase.frequency * time) * testCase.amplitude;
    const output = processor.spiceLadder(voice, input, dt);
    if (time >= START_TIME) {
      times.push(time);
      samples.push(output);
    }
  }
  return analyzeSignal(times, samples, testCase);
}

function renderNgspiceProbe(testCase, temporaryDirectory, netlistTemplate) {
  const outputPath = join(temporaryDirectory, `${testCase.id}.data`);
  const logPath = join(temporaryDirectory, `${testCase.id}.log`);
  const circuitPath = join(temporaryDirectory, `${testCase.id}.cir`);
  const netlist = fillTemplate(netlistTemplate, netlistReplacements(testCase, outputPath));
  writeFileSync(circuitPath, netlist, 'utf8');

  const run = spawnSync('ngspice', ['-b', '-o', logPath, circuitPath], {
    cwd: temporaryDirectory,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (run.status !== 0 || !existsSync(outputPath)) {
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : run.stderr || run.stdout;
    fail(`ngspice failed for ${testCase.id}:\n${log}`);
  }
  const { times, samples } = parseWrdata(readFileSync(outputPath, 'utf8'), testCase.id);
  return analyzeSignal(times, samples, testCase);
}

function netlistReplacements(testCase, outputPath) {
  const values = circuitValues(testCase);
  return {
    JUNCTION_VOLTAGE: spiceNumber(values.junctionVoltage),
    TAIL_CURRENT: spiceNumber(values.tailCurrent),
    CAPACITANCE: spiceNumber(CAPACITANCE),
    FEEDBACK: spiceNumber(values.feedback),
    DRIVE_SCALE: spiceNumber(values.driveScale),
    SIGNAL_VOLTAGE: spiceNumber(values.signalVoltage),
    INPUT_AMPLITUDE: spiceNumber(testCase.amplitude),
    INPUT_FREQUENCY: spiceNumber(testCase.frequency),
    OUTPUT_STEP: spiceNumber(OUTPUT_STEP),
    STOP_TIME: spiceNumber(STOP_TIME),
    START_TIME: spiceNumber(START_TIME),
    MAX_STEP: spiceNumber(MAX_STEP),
    OUTPUT_PATH: outputPath.replaceAll('\\', '/'),
  };
}

function circuitValues(testCase) {
  const cutoff = clamp(
    PROFILE_CUTOFF * (.055 + testCase.color * testCase.color * 1.22) * (.7 + testCase.contour * .35),
    45,
    SAMPLE_RATE * .34,
  );
  const feedback = clamp(PROFILE_RESONANCE * (.20 + testCase.resonance * 1.32), 0, .95) * 3.82;
  const signalVoltage = SIGNAL_VOLTAGE * (.82 + testCase.character * .36);
  const driveScale = PROFILE_DRIVE * (.68 + testCase.character * 1.82);
  const junctionVoltage = thermalVoltage(testCase.temperatureC + 273.15) * 1.08;
  const tailCurrent = 2 * junctionVoltage * CAPACITANCE * TAU * cutoff;
  return { cutoff, feedback, signalVoltage, driveScale, junctionVoltage, tailCurrent };
}

function fillTemplate(template, replacements) {
  let output = template;
  for (const [name, value] of Object.entries(replacements)) {
    output = output.replaceAll(`{{${name}}}`, String(value));
  }
  const unresolved = output.match(/\{\{[A-Z_]+\}\}/g);
  if (unresolved) fail(`Unresolved SPICE template tokens: ${unresolved.join(', ')}`);
  return output;
}

function parseWrdata(text, caseId) {
  const times = [];
  const samples = [];
  for (const line of text.split(/\r?\n/)) {
    const values = line.trim().split(/\s+/).map(Number);
    if (values.length < 2 || !values.every(Number.isFinite)) continue;
    times.push(values[0]);
    samples.push(values.at(-1));
  }
  if (samples.length < 1024) fail(`ngspice returned only ${samples.length} usable samples for ${caseId}.`);
  return { times, samples };
}

function analyzeSignal(times, samples, testCase) {
  if (times.length !== samples.length || samples.length < 1024) {
    fail(`Invalid calibration signal for ${testCase.id}.`);
  }
  let sum = 0;
  let sumSquares = 0;
  let peak = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) fail(`${testCase.id} produced a non-finite calibration sample.`);
    sum += sample;
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const dc = sum / samples.length;
  const rms = Math.sqrt(sumSquares / samples.length);
  const fundamental = harmonicAmplitude(times, samples, testCase.frequency);
  let harmonicPower = 0;
  for (let harmonic = 2; harmonic <= 6; harmonic += 1) {
    const amplitude = harmonicAmplitude(times, samples, testCase.frequency * harmonic).amplitude;
    harmonicPower += amplitude * amplitude;
  }
  const thd = Math.sqrt(harmonicPower) / Math.max(1e-12, fundamental.amplitude);
  const gainDb = 20 * Math.log10(Math.max(1e-12, fundamental.amplitude) / testCase.amplitude);
  return {
    rms,
    peak,
    dc,
    gainDb,
    phaseDegrees: fundamental.phaseRadians * 180 / Math.PI,
    thd,
  };
}

function harmonicAmplitude(times, samples, frequency) {
  let sinProjection = 0;
  let cosProjection = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const angle = TAU * frequency * times[index];
    sinProjection += samples[index] * Math.sin(angle);
    cosProjection += samples[index] * Math.cos(angle);
  }
  const scale = 2 / samples.length;
  const sinAmplitude = sinProjection * scale;
  const cosAmplitude = cosProjection * scale;
  return {
    amplitude: Math.hypot(sinAmplitude, cosAmplitude),
    phaseRadians: Math.atan2(cosAmplitude, sinAmplitude),
  };
}

function compareMetrics(testCase, realtime, spice) {
  const gainDb = Math.abs(realtime.gainDb - spice.gainDb);
  const phaseDegrees = angularDistance(realtime.phaseDegrees, spice.phaseDegrees);
  const peakDb = Math.abs(20 * Math.log10(Math.max(1e-12, realtime.peak) / Math.max(1e-12, spice.peak)));
  const thdAbsolute = Math.abs(realtime.thd - spice.thd);
  const dcAbsolute = Math.abs(realtime.dc - spice.dc);
  const failures = [];
  if (gainDb > LIMITS.gainDb) failures.push(`${testCase.id} gain differs by ${gainDb.toFixed(2)} dB`);
  if (phaseDegrees > LIMITS.phaseDegrees) failures.push(`${testCase.id} phase differs by ${phaseDegrees.toFixed(1)}°`);
  if (peakDb > LIMITS.peakDb) failures.push(`${testCase.id} peak differs by ${peakDb.toFixed(2)} dB`);
  if (thdAbsolute > LIMITS.thdAbsolute) failures.push(`${testCase.id} THD differs by ${(thdAbsolute * 100).toFixed(1)} points`);
  if (dcAbsolute > LIMITS.dcAbsolute) failures.push(`${testCase.id} DC differs by ${dcAbsolute.toFixed(4)}`);
  return { id: testCase.id, realtime, spice, errors: { gainDb, phaseDegrees, peakDb, thdAbsolute, dcAbsolute }, failures };
}

function validateRealtimeResults(results) {
  for (const { case: testCase, metrics } of results) {
    if (metrics.peak > 1.001) fail(`${testCase.id} realtime probe exceeded bounded output (${metrics.peak.toFixed(4)}).`);
    if (metrics.rms < 1e-5) fail(`${testCase.id} realtime probe is silent.`);
    if (Math.abs(metrics.dc) > .03) fail(`${testCase.id} realtime probe has excessive DC (${metrics.dc.toFixed(4)}).`);
    if (!Object.values(metrics).every(Number.isFinite)) fail(`${testCase.id} realtime metrics contain a non-finite value.`);
  }
}

function validateAssets(processor, netlist) {
  const processorRequirements = [
    'const MODEL_D_CAPACITANCE_F = 68e-9',
    'const MODEL_D_SIGNAL_VOLTAGE = .12',
    'const ideality = 1.08',
    'const iterations = this.quality >= 4 ? 2 : 1',
    'spiceLadder(voice, input, dt)',
  ];
  const netlistRequirements = [
    '.func pair(x)',
    'Bpair1 0 stage1',
    'Bpair4 0 stage4',
    'C1 stage1 0',
    'C4 stage4 0',
    '.options method=trap',
    'wrdata {{OUTPUT_PATH}} v(output)',
  ];
  for (const requirement of processorRequirements) {
    if (!processor.includes(requirement)) fail(`Realtime solver contract is missing ${JSON.stringify(requirement)}.`);
  }
  for (const requirement of netlistRequirements) {
    if (!netlist.includes(requirement)) fail(`SPICE fixture contract is missing ${JSON.stringify(requirement)}.`);
  }
}

function detectNgspice() {
  const result = spawnSync('ngspice', ['-v'], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT' || result.status !== 0) return null;
  const firstLine = `${result.stdout || ''}${result.stderr || ''}`.split(/\r?\n/).find(Boolean);
  return firstLine?.trim() || 'ngspice';
}

function printRealtimeTable(results) {
  console.log('\nModel D realtime calibration probes');
  console.log('case             gain       phase      peak       THD');
  for (const result of results) {
    const metrics = result.metrics;
    console.log(
      `${result.case.id.padEnd(16)} ${formatSigned(metrics.gainDb, 7)} dB `
      + `${formatSigned(metrics.phaseDegrees, 7)}° `
      + `${metrics.peak.toFixed(4).padStart(8)} `
      + `${(metrics.thd * 100).toFixed(2).padStart(7)}%`,
    );
  }
}

function printComparisonTable(comparisons) {
  console.log('\nModel D realtime ↔ ngspice calibration');
  console.log('case             Δgain    Δphase    Δpeak     ΔTHD   result');
  for (const comparison of comparisons) {
    const errors = comparison.errors;
    console.log(
      `${comparison.id.padEnd(16)} ${errors.gainDb.toFixed(2).padStart(6)} dB `
      + `${errors.phaseDegrees.toFixed(1).padStart(7)}° `
      + `${errors.peakDb.toFixed(2).padStart(7)} dB `
      + `${(errors.thdAbsolute * 100).toFixed(1).padStart(6)}pt `
      + `${comparison.failures.length ? 'FAIL' : 'PASS'}`,
    );
  }
}

function serializeResults(results) {
  return results.map((result) => ({ id: result.case.id, ...result.metrics }));
}

function angularDistance(left, right) {
  return Math.abs((((left - right) + 540) % 360) - 180);
}

function thermalVoltage(temperatureK) {
  return BOLTZMANN_CONSTANT * temperatureK / ELECTRON_CHARGE;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function spiceNumber(value) {
  return Number(value).toExponential(12);
}

function formatSigned(value, width) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`.padStart(width);
}

function fail(message) {
  throw new Error(message);
}
