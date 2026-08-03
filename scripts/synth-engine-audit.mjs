import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = process.cwd();
const failures = [];
const read = (relative) => {
  const path = resolve(root, relative);
  if (!existsSync(path)) {
    failures.push(`Missing required file: ${relative}`);
    return '';
  }
  return readFileSync(path, 'utf8');
};
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};

const synth = read('src/audio/SynthEngine.ts');
const processorSource = read('public/synth-circuit-processor.js');
const audioEngine = read('src/audio/AudioEngine.ts');
const rail = read('src/components/effects/RailCModules.tsx');
const css = read('src/components/effects/RailCModules.css');
const faceplate = read('src/ui/faceplateLayout.ts');
const layoutEditor = read('src/components/layout/FaceplateLayoutEditor.tsx');

const machines = [
  'model-d',
  'juno-106',
  'sh-101',
  'prophet-5',
  'dx7',
  'ms-20',
  'polysix',
  'ob-xa',
  'fairlight',
  'ppg-wave',
  'cz-101',
  'calcotone',
];

for (const machine of machines) {
  requireText(synth, `'${machine}'`, `${machine} DSP profile`);
  requireText(rail, `id: '${machine}'`, `${machine} hardware selector`);
}

requireText(processorSource, 'const MAX_VOICES = 10', 'Synth polyphony guard');
requireText(synth, 'this.output.connect(destination)', 'Synth effect-chain routing');
requireText(synth, "'calcotone-synth-circuit-processor'", 'Synth AudioWorklet controller');
requireText(synth, 'public setQualityMode(', 'Synth quality scaling');
requireText(synth, 'public setSequencerState(', 'Audio-thread sequencer controller');
requireText(synth, 'public setArchetype(', 'Synth archetype controller');
requireText(synth, 'morphSeconds: Math.min(0.5', 'Synth parameter morph ceiling');
requireText(processorSource, "topology: '4× BJT-C SPICE LADDER'", 'Component-level transistor ladder topology');
requireText(processorSource, 'function bjtDifferentialPair(', 'Shockley-derived BJT differential pair');
requireText(processorSource, 'function solveBjtCapacitorStage(', 'Implicit capacitor/Newton solver');
requireText(
  processorSource,
  'voice.spiceCompanionScales[pole] = dt / (2 * voice.ladderCapacitances[pole])',
  'Cached trapezoidal capacitor companion',
);
requireText(processorSource, 'this.renderQuantumFrames = left.length', 'Variable render-quantum handling');
requireText(processorSource, "topology: 'KORG-35 HP/LP'", 'MS-20 topology');
requireText(processorSource, "topology: '6-OP PHASE MODULATION'", 'DX-style six-operator topology');
requireText(processorSource, 'function polyBlep(', 'Band-limited analog oscillators');
requireText(processorSource, 'this.dcBlock(', 'Synth DC protection');
requireText(processorSource, 'OUTPUT_SATURATION_NORMALIZATION', 'Synth output safety saturation');
requireText(processorSource, 'while (this.frameCounter >= this.sequencer.nextStepFrame', 'Sample-clock sequencer');
requireText(processorSource, 'sequence.stepFrames = sampleRate * 15 / sequence.bpm', 'Fractional-frame tempo clock');
requireText(processorSource, 'sequence.bpm = clamp(data.bpm, 30, 180)', '30 BPM sequencer floor');
requireText(processorSource, 'for (let noteIndex = 0; noteIndex < notes.length; noteIndex += 1)', 'Polyphonic chord triggering');
requireText(processorSource, 'note.length * .92', 'Per-note sequencer duration');
requireText(processorSource, 'voice.panL', 'Cached constant-power voice pan');
requireText(processorSource, 'compactVoices()', 'Allocation-free voice retirement');
requireText(processorSource, 'advanceParameterMorph(left.length)', 'Block-rate synth parameter interpolation');
requireText(processorSource, "voice.archetype === 'pad'", 'Pad envelope anchor');
requireText(processorSource, 'Math.max(.018', 'Click-safe synth release floor');
requireText(processorSource, 'const TANH_LUT = new Float32Array(1024)', 'Synth nonlinear transfer LUT');
requireText(processorSource, 'function interpolateHermite(', 'Cubic Hermite LUT interpolation');
requireText(processorSource, 'voice.ladderTptAlpha = ladderTptG / (1 + ladderTptG)', 'TPT ladder coefficient');
requireText(processorSource, 'voice.otaTptAlpha = otaTptG / (1 + otaTptG)', 'TPT OTA coefficient');
requireText(processorSource, 'voice.poles[pole] = lowpass + v', 'Trapezoidal integrator state update');
requireText(processorSource, 'return Math.tanh(clamp(normalizedVoltage, -12, 12))', 'Exact SPICE junction transfer preserved');
if (processorSource.includes('this.voices = this.voices.filter(')) {
  failures.push('Synth realtime loop still allocates a filtered voice array');
}
requireText(audioEngine, 'this.synth = new SynthEngine(this.context, this.graph.input)', 'AudioEngine synth ownership');
requireText(audioEngine, 'public triggerSynthNote(', 'AudioEngine note API');
requireText(audioEngine, 'this.synth?.dispose()', 'Synth teardown');
requireText(audioEngine, "['Synth circuit', `synth-circuit-processor.js?v=${WORKLET_BUILD_VERSION}`]", 'Synth worklet loading');
requireText(audioEngine, 'synth: SynthTelemetryStats', 'Synth telemetry in DSP profiler');
requireText(audioEngine, 'renderSizeHint: this.requestedRenderSize', 'Render-size negotiation');
requireText(audioEngine, 'renderQuantumSize?: number', 'Actual render-quantum telemetry');

requireText(rail, 'const SYNTH_PRESETS: Record<SynthMachine', 'Machine-aware hardware presets');
requireText(rail, 'const SYNTH_TEMPOS = [30,', '30 BPM selector floor');
requireText(rail, 'aria-label="Synth hardware preset"', 'Hardware preset selector');
requireText(rail, "setPresetId('custom')", 'Manual panel edit state');
requireText(rail, 'aria-label="Sequencer tempo"', 'Sequencer BPM selector');
requireText(rail, 'onWheel={changeTempoFromWheel}', 'Sequencer BPM wheel control');
requireText(rail, 'event.deltaY < 0 ? 1 : -1', 'BPM wheel direction');
requireText(rail, 'onSequencerChange({', 'Audio-thread sequencer state handoff');
requireText(rail, 'stepNotes.push({ pitch, length: 1 })', 'Polyphonic chord editing');
requireText(rail, 'beginNoteLengthDrag(', 'Draggable per-note length');
requireText(rail, 'role="slider"', 'Keyboard-accessible note length handle');
requireText(rail, 'synth-header-controls', 'Header transport placement');
requireText(rail, 'overlayActive={sequencerExpanded}', 'In-module sequencer overlay state');
requireText(rail, "sequencerExpanded ? 'BACK' : 'FULL'", 'Reversible sequencer fullscreen control');
requireText(rail, "event.key !== 'Escape'", 'Sequencer overlay Escape shortcut');
requireText(rail, 'piano-roll-step-numbers', 'Visible step numbering');
requireText(rail, 'onSequencerStepListenerChange((position)', 'Worklet-driven visual playhead');
for (const removedLabel of ['16-STEP PIANO ROLL', 'START ENGINE', '1/16 NOTES']) {
  if (rail.includes(removedLabel)) failures.push(`Removed sequencer label is still visible: ${removedLabel}`);
}
if (rail.includes('window.setInterval(')) {
  failures.push('Synth sequencer timing must not depend on a main-thread interval');
}
requireText(css, '.piano-roll-step-numbers span:nth-child(4n + 1)', 'Quarter-note beat emphasis');
requireText(css, '.piano-roll-cell.playhead', 'Readable playhead');
requireText(css, '.piano-roll-note-handle', 'Visible note-length handle');
requireText(css, '.module-synth.module-overlay-active .faceplate-viewport-shell', 'Full-module sequencer overlay');
requireText(css, '.synth-pattern-strip .sequencer-expand-button', 'Sequencer fullscreen button styling');
requireText(css, 'grid-template-rows: 18px 58px 16px', 'Full-size Rail C knob typography');
requireText(rail, 'moduleId="stomp"', 'STOMP replacement layout surface');
requireText(rail, 'moduleId="chaos"', 'Chaos layout surface');
requireText(rail, 'moduleId="pressure"', 'Pressure layout surface');
requireText(rail, 'faceplate-pressure-slot', 'Editable Pressure buttons');
requireText(faceplate, "export type RailCFaceplateId = 'stomp' | 'chaos' | 'pressure'", 'Rail C layout ownership');
requireText(faceplate, 'setRailCFaceplateControl(', 'Persistent Rail C control movement');
requireText(faceplate, 'linkedModules: boolean', 'Linked/independent editor state');
requireText(layoutEditor, "'MODULES LINKED' : 'INDEPENDENT'", 'Independent layout editor toggle');
requireText(rail, "useRailCRandomController('stomp', enabled, randomizeStomp)", 'STOMP MUSICAL RANDOM registration');
requireText(rail, 'const presets = SYNTH_PRESETS[nextMachine.id]', 'Machine-scoped random hardware preset');

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;

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
if (processorSource) {
  const workletContext = {
    sampleRate: SAMPLE_RATE,
    AudioWorkletProcessor: MockAudioWorkletProcessor,
    registerProcessor(name, candidate) {
      if (name === 'calcotone-synth-circuit-processor') Processor = candidate;
    },
  };
  runInNewContext(`${processorSource}\nglobalThis.__calcotoneFastTanh = fastTanh;`, workletContext);
  const fastTanh = workletContext.__calcotoneFastTanh;
  if (typeof fastTanh !== 'function') {
    failures.push('Synth Hermite LUT reader was not exposed to the audit');
  } else {
    let maximumError = 0;
    let previous = -1;
    for (let index = 0; index <= 20_000; index += 1) {
      const x = -10 + index / 1000;
      const actual = fastTanh(x);
      maximumError = Math.max(maximumError, Math.abs(actual - Math.tanh(x)));
      if (actual + 1e-7 < previous) failures.push(`Synth tanh LUT lost monotonicity at ${x.toFixed(3)}`);
      previous = actual;
    }
    if (maximumError > 2e-5) failures.push(`Synth tanh LUT error ${maximumError.toExponential(3)} exceeds Hermite tolerance`);
  }
}
if (!Processor) failures.push('Synth circuit processor did not register');

if (Processor) {
  const morphProcessor = new Processor();
  const initial = morphProcessor.parameters[0];
  morphProcessor.port.onmessage({
    data: { type: 'parameters', values: [.9, .8, .7, .6, .5, .4], morphSeconds: .35 },
  });
  morphProcessor.process([], [[new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)]]);
  if (!(morphProcessor.parameters[0] > initial && morphProcessor.parameters[0] < .9)) {
    failures.push('Synth 350 ms morph did not advance gradually on the audio thread');
  }
  const morphBlocks = Math.ceil(SAMPLE_RATE * .35 / BLOCK_SIZE) + 1;
  for (let block = 1; block < morphBlocks; block += 1) {
    morphProcessor.process([], [[new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)]]);
  }
  if (Math.abs(morphProcessor.parameters[0] - .9) > 1e-9) {
    failures.push('Synth parameter morph did not land exactly on its target');
  }

  morphProcessor.port.onmessage({ data: { type: 'enabled', value: true } });
  morphProcessor.port.onmessage({ data: { type: 'archetype', value: 'pad' } });
  morphProcessor.port.onmessage({ data: { type: 'note-on', midi: 60, durationSeconds: .2, velocity: .7 } });
  const padVoice = morphProcessor.voices[0];
  if (!padVoice || padVoice.attackSeconds < .5 || padVoice.releaseMultiplier <= 0 || padVoice.releaseMultiplier >= 1) {
    failures.push('Pad archetype envelope anchors were not applied to new voices');
  }

  for (const machine of ['juno-106', 'ob-xa', 'ms-20', 'calcotone']) {
    const sweepProcessor = new Processor();
    sweepProcessor.port.onmessage({ data: { type: 'enabled', value: true } });
    sweepProcessor.port.onmessage({ data: { type: 'machine', value: machine } });
    sweepProcessor.port.onmessage({ data: { type: 'quality', factor: 1 } });
    sweepProcessor.port.onmessage({ data: { type: 'note-on', midi: 84, durationSeconds: 1.4, velocity: 1 } });
    for (let block = 0; block < 620; block += 1) {
      if (block % 4 === 0) {
        const sweep = (Math.sin(block * .19) + 1) * .5;
        sweepProcessor.port.onmessage({
          data: { type: 'parameters', values: [.74, sweep, 1, .82, .92, .48], morphSeconds: .004 },
        });
      }
      const channels = [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)];
      sweepProcessor.process([], [channels]);
      for (const channel of channels) {
        for (const sample of channel) {
          if (!Number.isFinite(sample) || Math.abs(sample) > 1.001) {
            failures.push(`${machine} TPT audio-rate cutoff sweep became unstable`);
            block = 620;
            break;
          }
        }
      }
    }
  }
}

function renderMachine(
  machine,
  quality,
  blockSize = BLOCK_SIZE,
  parameters = [.61, .53, .67, .46, .58, .31],
) {
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'enabled', value: true } });
  processor.port.onmessage({ data: { type: 'machine', value: machine } });
  processor.port.onmessage({ data: { type: 'parameters', values: parameters } });
  processor.port.onmessage({ data: { type: 'quality', factor: quality } });
  processor.port.onmessage({ data: { type: 'note-on', midi: 55, durationSeconds: .22, velocity: .82 } });
  processor.port.onmessage({ data: { type: 'note-on', midi: 62, durationSeconds: .22, velocity: .68 } });

  let sum = 0;
  let dc = 0;
  let derivative = 0;
  let peak = 0;
  let previous = 0;
  let samples = 0;
  let tailSum = 0;
  let tailSamples = 0;
  const blocks = Math.ceil(SAMPLE_RATE * 2.5 / blockSize);
  const totalFrames = blocks * blockSize;
  for (let block = 0; block < blocks; block += 1) {
    const channels = [new Float32Array(blockSize), new Float32Array(blockSize)];
    processor.process([], [channels]);
    for (const channel of channels) {
      for (let i = 0; i < channel.length; i += 1) {
        const value = channel[i];
        const frame = block * blockSize + i;
        if (!Number.isFinite(value)) {
          failures.push(`${machine} ${quality}x produced a non-finite sample`);
          return null;
        }
        if (Math.abs(value) > 1.001) {
          failures.push(`${machine} ${quality}x exceeded bounded output (${Math.abs(value).toFixed(4)})`);
          return null;
        }
        peak = Math.max(peak, Math.abs(value));
        if (frame < Math.min(totalFrames, 30_720)) {
          sum += value * value;
          dc += value;
          derivative += Math.abs(value - previous);
          previous = value;
          samples += 1;
        }
        if (frame >= totalFrames - 5_120) {
          tailSum += value * value;
          tailSamples += 1;
        }
      }
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, samples));
  const dcMean = dc / Math.max(1, samples);
  const tailRms = Math.sqrt(tailSum / Math.max(1, tailSamples));
  if (rms < .0002) failures.push(`${machine} ${quality}x is silent (${rms.toFixed(6)} RMS)`);
  if (Math.abs(dcMean) > .025) failures.push(`${machine} ${quality}x has excessive DC (${dcMean.toFixed(5)})`);
  if (tailRms > .00015) failures.push(`${machine} ${quality}x release did not decay (${tailRms.toFixed(6)} RMS)`);
  const telemetry = processor.port.messages.findLast?.((message) => message.type === 'telemetry')
    ?? [...processor.port.messages].reverse().find((message) => message.type === 'telemetry');
  if (telemetry && telemetry.renderQuantumFrames !== blockSize) {
    failures.push(`${machine} ${quality}x reported ${telemetry.renderQuantumFrames} frames for a ${blockSize}-frame render quantum`);
  }
  return { rms, peak, derivative: derivative / Math.max(1, samples), tailRms, telemetry };
}

function auditSequencerClock(blockSize, bpm) {
  const processor = new Processor();
  const silentPattern = Array.from({ length: 16 }, () => []);
  processor.port.onmessage({ data: { type: 'enabled', value: true } });
  processor.port.onmessage({
    data: {
      type: 'sequencer-state',
      patterns: Array.from({ length: 4 }, () => [...silentPattern]),
      patternIndex: 0,
      chain: [0, 1, 2, 3],
      chainArmed: true,
      chainPosition: 0,
      bpm,
      playing: true,
      startStep: 0,
    },
  });

  const requiredSteps = 40;
  const stepFrames = SAMPLE_RATE * 15 / bpm;
  const totalFrames = Math.ceil(stepFrames * requiredSteps);
  for (let rendered = 0; rendered < totalFrames; rendered += blockSize) {
    const frames = Math.min(blockSize, totalFrames - rendered);
    processor.process([], [[new Float32Array(frames), new Float32Array(frames)]]);
  }
  const steps = processor.port.messages
    .filter((message) => message.type === 'sequencer-step')
    .slice(0, requiredSteps);
  if (steps.length !== requiredSteps) {
    failures.push(`Sequencer ${bpm} BPM/${blockSize}-frame quantum emitted ${steps.length}/${requiredSteps} steps`);
    return;
  }
  for (let index = 0; index < steps.length; index += 1) {
    const expectedFrame = Math.ceil(index * stepFrames - 1e-9);
    if (steps[index].frame !== expectedFrame) {
      failures.push(
        `Sequencer ${bpm} BPM/${blockSize}-frame quantum step ${index} landed at frame ${steps[index].frame}, expected ${expectedFrame}`,
      );
      break;
    }
    const expectedPattern = Math.floor(index / 16) % 4;
    if (steps[index].patternIndex !== expectedPattern) {
      failures.push(
        `Sequencer chain step ${index} used pattern ${steps[index].patternIndex}, expected ${expectedPattern}`,
      );
      break;
    }
  }
}

function auditChordDurations() {
  const processor = new Processor();
  const chordPattern = Array.from({ length: 16 }, () => []);
  chordPattern[0] = [
    { pitch: 9, length: 4 },
    { pitch: 5, length: 2 },
    { pitch: 2, length: 1 },
  ];
  processor.port.onmessage({ data: { type: 'enabled', value: true } });
  processor.port.onmessage({
    data: {
      type: 'sequencer-state',
      patterns: Array.from({ length: 4 }, (_, index) =>
        index === 0
          ? chordPattern.map((notes) => notes.map((note) => ({ ...note })))
          : Array.from({ length: 16 }, () => [])
      ),
      patternIndex: 0,
      chain: [0],
      chainArmed: false,
      chainPosition: 0,
      bpm: 30,
      playing: true,
      startStep: 0,
    },
  });
  processor.process([], [[new Float32Array(1), new Float32Array(1)]]);
  if (processor.voices.length !== 3) {
    failures.push(`Sequencer chord produced ${processor.voices.length}/3 voices`);
    return;
  }
  const expectedDurations = [1.84, .92, .46];
  for (let index = 0; index < expectedDurations.length; index += 1) {
    if (Math.abs(processor.voices[index].duration - expectedDurations[index]) > 1e-9) {
      failures.push(
        `Sequencer chord voice ${index} duration was ${processor.voices[index].duration}, expected ${expectedDurations[index]}`,
      );
    }
  }
}

if (Processor) {
  const signatures = new Set();
  for (const machine of machines) {
    for (const quality of [1, 2, 4]) {
      const result = renderMachine(machine, quality);
      if (quality === 2 && result) {
        signatures.add(`${result.rms.toFixed(4)}:${result.derivative.toFixed(4)}:${result.peak.toFixed(3)}`);
      }
    }
  }
  if (signatures.size < 8) {
    failures.push(`Machine topology signatures are insufficiently distinct (${signatures.size}/12)`);
  }
  for (const blockSize of [64, 128, 256, 512]) {
    const result = renderMachine('model-d', 2, blockSize);
    if (result?.telemetry?.solver !== 'BJT-C NEWTON') {
      failures.push(`Model D ${blockSize}-frame render did not report its BJT-C solver`);
    }
  }
  renderMachine('model-d', 4, 256, [.61, .82, 1, .52, .92, .31]);
  for (const blockSize of [64, 128, 256, 512]) {
    auditSequencerClock(blockSize, 174);
    auditSequencerClock(blockSize, 30);
  }
  auditChordDurations();
}

if (failures.length) {
  console.error('\nCALCOTONE synth engine audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log(`CALCOTONE synth engine audit passed (${machines.length} circuit topologies × 3 quality modes, 30–174 BPM sample-clock chain, polyphonic per-note lengths, 64–512-frame render quanta, allocation-free voice retirement, component-level Model D stress test).`);
