import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const failures = [];
const reports = [];

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

function loadProcessor(relativePath, registrationName, extraGlobals = {}) {
  const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
  let Processor = null;
  runInNewContext(source, {
    sampleRate: SAMPLE_RATE,
    AudioWorkletProcessor: MockAudioWorkletProcessor,
    registerProcessor(name, registeredProcessor) {
      if (name === registrationName) Processor = registeredProcessor;
    },
    ...extraGlobals,
  });
  if (!Processor) failures.push(`${relativePath}: ${registrationName} did not register`);
  return Processor;
}

function parameter(value) {
  return new Float32Array([value]);
}

function stereoBlock() {
  return [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)];
}

function assertFiniteBlock(label, channels, ceiling = 1.4) {
  for (const channel of channels) {
    for (const sample of channel) {
      if (!Number.isFinite(sample)) {
        failures.push(`${label}: produced a non-finite sample`);
        return;
      }
      if (Math.abs(sample) > ceiling) {
        failures.push(`${label}: exceeded ${ceiling.toFixed(2)} (${Math.abs(sample).toFixed(4)})`);
        return;
      }
    }
  }
}

function rms(sumSquares, sampleCount) {
  return Math.sqrt(sumSquares / Math.max(1, sampleCount));
}

const DigitalCaptureProcessor = loadProcessor(
  'public/ember-digital-capture-processor.js',
  'calcotone-ember-digital-capture-processor',
);
const GrainProcessor = loadProcessor(
  'public/grain-processor.js',
  'calcotone-grain-processor',
);
const TubeProcessor = loadProcessor(
  'public/ember-tube-processor.js',
  'calcotone-ember-tube-processor',
);
const MagneticProcessor = loadProcessor(
  'public/magnetic-core-processor.js',
  'calcotone-magnetic-core-processor',
);
const LexiconProcessor = loadProcessor(
  'public/lexicon-224-converter.js',
  'calcotone-lexicon224-converter',
);
const BehaviorProcessor = loadProcessor(
  'public/behavior-memory-processor.js',
  'calcotone-behavior-memory-processor',
);
const DriftProcessor = loadProcessor(
  'public/drift-classic-processor.js',
  'calcotone-drift-classic-processor',
);
const DreamProcessor = loadProcessor(
  'public/dream-buffer-processor.js',
  'calcotone-dream-buffer',
);

if (DigitalCaptureProcessor) {
  for (let mode = 0; mode < 6; mode += 1) {
    const processor = new DigitalCaptureProcessor();
    const parameters = {
      mode: parameter(mode),
      drive: parameter(mode % 2 ? 1 : 0),
      clock: parameter(mode % 3 / 2),
      character: parameter(mode % 2 ? 0 : 1),
      filter: parameter(mode % 2 ? 1 : 0),
    };
    for (let block = 0; block < 200; block += 1) {
      const input = stereoBlock();
      const output = stereoBlock();
      for (let sample = 0; sample < BLOCK_SIZE; sample += 1) {
        const frame = block * BLOCK_SIZE + sample;
        const time = frame / SAMPLE_RATE;
        input[0][sample] = Math.sin(time * Math.PI * 2 * 317) * 0.36
          + Math.sin(time * Math.PI * 2 * 4_913) * 0.12;
        input[1][sample] = Math.sin(time * Math.PI * 2 * 331) * 0.34
          + Math.sin(time * Math.PI * 2 * 5_071) * 0.11;
      }
      processor.process([[...input]], [[...output]], parameters);
      assertFiniteBlock(`Ember digital capture mode ${mode}`, output, 1.16);
    }
  }

  // SP-1200 output-filter selections must apply the same pole count to both
  // channels. The tiny intentional imaging oscillator is far below this test tone.
  const processor = new DigitalCaptureProcessor();
  const parameters = {
    mode: parameter(0),
    drive: parameter(0.42),
    clock: parameter(0),
    character: parameter(0),
    filter: parameter(0),
  };
  let sumL = 0;
  let sumR = 0;
  let samples = 0;
  for (let block = 0; block < 520; block += 1) {
    const input = stereoBlock();
    const output = stereoBlock();
    for (let sample = 0; sample < BLOCK_SIZE; sample += 1) {
      const frame = block * BLOCK_SIZE + sample;
      const value = Math.sin(frame / SAMPLE_RATE * Math.PI * 2 * 5_100) * 0.42;
      input[0][sample] = value;
      input[1][sample] = value;
    }
    processor.process([[...input]], [[...output]], parameters);
    if (block < 120) continue;
    for (let sample = 0; sample < BLOCK_SIZE; sample += 1) {
      sumL += output[0][sample] * output[0][sample];
      sumR += output[1][sample] * output[1][sample];
      samples += 1;
    }
  }
  const leftRms = rms(sumL, samples);
  const rightRms = rms(sumR, samples);
  const channelRatio = Math.min(leftRms, rightRms) / Math.max(leftRms, rightRms);
  reports.push(`SP-1200 mono symmetry=${channelRatio.toFixed(4)}`);
  if (channelRatio < 0.96) {
    failures.push(`Ember SP-1200: mono filter is channel-asymmetric (${leftRms.toFixed(5)} L, ${rightRms.toFixed(5)} R)`);
  }
}

if (GrainProcessor) {
  for (let mode = 0; mode < 12; mode += 1) {
    const processor = new GrainProcessor();
    const parameters = {
      mode: parameter(mode),
      bits: parameter(mode % 2 ? 4 : 16),
      density: parameter(mode % 3 / 2),
      pitch: parameter(mode % 2),
      chaos: parameter(mode % 2 ? 1 : 0),
      bloom: parameter(mode % 3 / 2),
    };
    for (let block = 0; block < 360; block += 1) {
      const input = stereoBlock();
      const output = stereoBlock();
      for (let sample = 0; sample < BLOCK_SIZE; sample += 1) {
        const frame = block * BLOCK_SIZE + sample;
        const time = frame / SAMPLE_RATE;
        const pulse = frame % 12_000 < 72 ? Math.exp(-(frame % 12_000) / 18) * 0.28 : 0;
        input[0][sample] = Math.sin(time * Math.PI * 2 * 173) * 0.24 + pulse;
        input[1][sample] = Math.sin(time * Math.PI * 2 * 181) * 0.22 + pulse * 0.91;
      }
      processor.process([[...input]], [[...output]], parameters);
      assertFiniteBlock(`Grain mode ${mode}`, output, 1.5);
    }
  }
}

function renderStatefulQuality(Processor, quality, model, label) {
  const processor = new Processor();
  processor.port.onmessage?.({ data: { type: 'quality', factor: quality } });
  const parameters = model === null
    ? {
        drive: parameter(0.76),
        heat: parameter(0.69),
        character: parameter(0.58),
        dynamics: parameter(0.82),
      }
    : {
        model: parameter(model),
        drive: parameter(0.76),
        heat: parameter(0.69),
        character: parameter(0.58),
        dynamics: parameter(0.82),
      };
  let sumSquares = 0;
  let measured = 0;
  for (let block = 0; block < 420; block += 1) {
    const input = stereoBlock();
    const output = stereoBlock();
    for (let sample = 0; sample < BLOCK_SIZE; sample += 1) {
      const frame = block * BLOCK_SIZE + sample;
      const time = frame / SAMPLE_RATE;
      const value = Math.sin(time * Math.PI * 2 * 223) * 0.34
        + Math.sin(time * Math.PI * 2 * 3_917) * 0.15;
      input[0][sample] = value;
      input[1][sample] = value * 0.97;
    }
    processor.process([[...input]], [[...output]], parameters);
    assertFiniteBlock(`${label} ${quality}x`, output, 1.21);
    if (block < 120) continue;
    for (let sample = 0; sample < BLOCK_SIZE; sample += 1) {
      sumSquares += (output[0][sample] * output[0][sample] + output[1][sample] * output[1][sample]) * 0.5;
      measured += 1;
    }
  }
  return rms(sumSquares, measured);
}

if (TubeProcessor) {
  const tubeQualityRms = new Map();
  for (let model = 1; model <= 5; model += 1) {
    for (const quality of [1, 2, 4]) {
      const value = renderStatefulQuality(TubeProcessor, quality, model, `Ember tube ${model}`);
      if (model === 5) tubeQualityRms.set(quality, value);
    }
  }
  const qualityRms = [1, 2, 4].map((quality) => tubeQualityRms.get(quality));
  const qualityRatio = Math.min(...qualityRms) / Math.max(...qualityRms);
  reports.push(`tube quality consistency=${qualityRatio.toFixed(4)}`);
  if (qualityRatio < 0.94) failures.push(`Ember tube: quality modes change level/state behavior (${qualityRms.map((value) => value.toFixed(5)).join(', ')})`);
}

if (MagneticProcessor) {
  const qualityRms = [1, 2, 4].map((quality) => renderStatefulQuality(MagneticProcessor, quality, null, 'Ember transformer quality'));
  const qualityRatio = Math.min(...qualityRms) / Math.max(...qualityRms);
  reports.push(`transformer quality consistency=${qualityRatio.toFixed(4)}`);
  if (qualityRatio < 0.94) failures.push(`Ember transformer: quality modes change level/state behavior (${qualityRms.map((value) => value.toFixed(5)).join(', ')})`);
}

if (LexiconProcessor) {
  for (const role of ['input', 'output']) {
    const processor = new LexiconProcessor({ processorOptions: { role } });
    for (let block = 0; block < 240; block += 1) {
      const input = stereoBlock();
      const output = stereoBlock();
      for (let sample = 0; sample < BLOCK_SIZE; sample += 1) {
        const frame = block * BLOCK_SIZE + sample;
        const time = frame / SAMPLE_RATE;
        input[0][sample] = Math.sin(time * Math.PI * 2 * 241) * 0.38
          + Math.sin(time * Math.PI * 2 * 7_117) * 0.08;
        input[1][sample] = Math.sin(time * Math.PI * 2 * 257) * 0.36
          + Math.sin(time * Math.PI * 2 * 6_911) * 0.07;
      }
      processor.process([[...input]], [[...output]]);
      assertFiniteBlock(`Lexicon 224 ${role} converter`, output, 1.1);
    }
  }
}

if (BehaviorProcessor) {
  for (let profile = 0; profile <= 12; profile += 1) {
    const processor = new BehaviorProcessor();
    const parameters = {
      profile: parameter(profile),
      amount: parameter(1),
      motion: parameter(profile % 2),
      memory: parameter(profile % 3 / 2),
      color: parameter(profile % 2 ? 0 : 1),
    };
    for (let block = 0; block < 160; block += 1) {
      const input = stereoBlock();
      const output = stereoBlock();
      for (let sample = 0; sample < BLOCK_SIZE; sample += 1) {
        const frame = block * BLOCK_SIZE + sample;
        const time = frame / SAMPLE_RATE;
        input[0][sample] = Math.sin(time * Math.PI * 2 * 113) * 0.62
          + Math.sin(time * Math.PI * 2 * 2_917) * 0.14;
        input[1][sample] = Math.sin(time * Math.PI * 2 * 127) * 0.59
          + Math.sin(time * Math.PI * 2 * 3_109) * 0.13;
      }
      processor.process([[...input]], [[...output]], parameters);
      assertFiniteBlock(`Physical behavior profile ${profile}`, output, 1.35);
    }
  }
}

if (DriftProcessor) {
  for (let model = 0; model <= 8; model += 1) {
    const processor = new DriftProcessor();
    const parameters = {
      model: parameter(model),
      rate: parameter(1),
      depth: parameter(1),
      shape: parameter(1),
      spread: parameter(model % 2),
      motion: parameter(1),
    };
    for (let block = 0; block < 240; block += 1) {
      const input = stereoBlock();
      const output = stereoBlock();
      for (let sample = 0; sample < BLOCK_SIZE; sample += 1) {
        const frame = block * BLOCK_SIZE + sample;
        const time = frame / SAMPLE_RATE;
        input[0][sample] = Math.sin(time * Math.PI * 2 * 157) * 0.42;
        input[1][sample] = Math.sin(time * Math.PI * 2 * 163) * 0.40;
      }
      processor.process([[...input]], [[...output]], parameters);
      assertFiniteBlock(`Drift classic model ${model}`, output, 1.201);
    }
  }

  for (const shape of [0, 1]) {
    const processor = new DriftProcessor();
    const parameters = {
      model: parameter(8),
      rate: parameter(0.72),
      depth: parameter(1),
      shape: parameter(shape),
      spread: parameter(1),
      motion: parameter(1),
    };
    let inputEnergy = 0;
    let outputEnergy = 0;
    let maxImbalance = 0;
    for (let block = 0; block < 360; block += 1) {
      const input = stereoBlock();
      const output = stereoBlock();
      for (let sample = 0; sample < BLOCK_SIZE; sample += 1) {
        const frame = block * BLOCK_SIZE + sample;
        const value = Math.sin(frame / SAMPLE_RATE * Math.PI * 2 * 211) * 0.34;
        input[0][sample] = value;
        input[1][sample] = value;
      }
      processor.process([[...input]], [[...output]], parameters);
      assertFiniteBlock(`PN-2 ${shape ? 'square' : 'triangle'} pan`, output, 1.201);
      if (block < 80) continue;
      for (let sample = 0; sample < BLOCK_SIZE; sample += 1) {
        const source = input[0][sample];
        const left = output[0][sample];
        const right = output[1][sample];
        inputEnergy += source * source * 2;
        outputEnergy += left * left + right * right;
        maxImbalance = Math.max(maxImbalance, Math.abs(left * left - right * right));
      }
    }
    const energyRatio = outputEnergy / Math.max(1e-9, inputEnergy);
    if (Math.abs(energyRatio - 1) > 0.015) failures.push(`PN-2 ${shape ? 'square' : 'triangle'} pan changed power by ${((energyRatio - 1) * 100).toFixed(2)}%`);
    if (maxImbalance < 0.08) failures.push(`PN-2 ${shape ? 'square' : 'triangle'} pan did not traverse the stereo field`);
  }
}

function dreamOutputs() {
  return [stereoBlock(), stereoBlock(), stereoBlock()];
}

if (DreamProcessor) {
  const processor = new DreamProcessor();
  const signal = stereoBlock();
  for (let sample = 0; sample < BLOCK_SIZE; sample += 1) {
    signal[0][sample] = Math.sin(sample / SAMPLE_RATE * Math.PI * 2 * 330) * 0.3;
    signal[1][sample] = signal[0][sample] * 0.92;
  }
  for (let block = 0; block < 420; block += 1) {
    const output = dreamOutputs();
    processor.process([[...signal]], output.map((channels) => [...channels]));
  }
  const connectedSilence = stereoBlock();
  const silentBlocks = Math.ceil((processor.maxRecallSeconds * SAMPLE_RATE + BLOCK_SIZE * 2) / BLOCK_SIZE);
  for (let block = 0; block < silentBlocks; block += 1) {
    const output = dreamOutputs();
    processor.process([[...connectedSilence]], output.map((channels) => [...channels]));
  }
  if (processor.samplesWritten !== 0) {
    failures.push(`Dream Buffer: connected silence did not flush history (${processor.samplesWritten} samples remain)`);
  }

  // Simulate the post-idle state on a separately populated ring. A correct
  // availability gate must not expose stale history before a new age head has filled.
  const resumedProcessor = new DreamProcessor();
  for (let block = 0; block < 420; block += 1) {
    const warmOutput = dreamOutputs();
    resumedProcessor.process([[...signal]], warmOutput.map((channels) => [...channels]));
  }
  resumedProcessor.samplesWritten = 0;
  resumedProcessor.silentFrames = 0;
  const resumed = stereoBlock();
  resumed[0][0] = 0.5;
  resumed[1][0] = 0.5;
  const output = dreamOutputs();
  resumedProcessor.process([[...resumed]], output.map((channels) => [...channels]));
  let recalledPeak = 0;
  for (const channels of output) {
    for (const channel of channels) {
      for (const sample of channel) recalledPeak = Math.max(recalledPeak, Math.abs(sample));
    }
  }
  reports.push(`Dream post-flush stale peak=${recalledPeak.toExponential(2)}`);
  if (recalledPeak > 1e-7) failures.push(`Dream Buffer: stale ring content leaked after flush (${recalledPeak.toExponential(3)})`);
}

const bitcrusherSource = readFileSync(resolve(process.cwd(), 'src/audio/effects/Bitcrusher.ts'), 'utf8');
const saturationSource = readFileSync(resolve(process.cwd(), 'src/audio/effects/Saturation.ts'), 'utf8');
const engineSource = readFileSync(resolve(process.cwd(), 'src/audio/AudioEngine.ts'), 'utf8');
const delaySource = readFileSync(resolve(process.cwd(), 'src/audio/effects/Delay.ts'), 'utf8');
const lexiconSource = readFileSync(resolve(process.cwd(), 'public/lexicon-224-converter.js'), 'utf8');

if (!bitcrusherSource.includes("this.setWorkletParameter('mode', next, now, true)")) {
  failures.push('Grain: discrete mode changes are smoothed through intermediate processors');
}
if (!saturationSource.includes("this.setDigitalCaptureParameter('mode', digitalCaptureMode, now, true)")) {
  failures.push('Ember digital capture: discrete model changes are smoothed through intermediate machines');
}
if (!saturationSource.includes('private digitalCaptureConnected = false')) {
  failures.push('Ember digital capture: inactive worklet is not lifecycle-suspended');
}
if (!saturationSource.includes("const factor = value === '4x' ? 4 : value === '2x' ? 2 : 1")) {
  failures.push('Ember: live/balanced/studio quality does not map to 1x/2x/4x processing');
}
if (!engineSource.includes('this.configureEffectQuality(effect)')) {
  failures.push('Audio Engine: newly created effects do not inherit the selected performance mode');
}
if (!delaySource.includes('const MAX_CHARACTER_CURVE_CACHE')) {
  failures.push('Halo: character curve cache is not explicitly bounded');
}
for (const allocation of ['return [wanted, nextHold]', 'return [this.heldL, this.heldR]', 'return [left, right]']) {
  if (lexiconSource.includes(allocation)) {
    failures.push(`Lexicon 224: realtime converter retains a per-sample allocation (${allocation})`);
  }
}

if (failures.length) {
  console.error('\nCALCOTONE DSP worklet audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  if (reports.length) console.error(`\nMeasurements: ${reports.join(' · ')}`);
  console.error('');
  process.exit(1);
}

console.log(`CALCOTONE DSP worklet audit passed (${reports.join(' · ')}).`);
