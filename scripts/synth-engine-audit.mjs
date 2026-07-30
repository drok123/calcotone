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
requireText(processorSource, "topology: 'TRANSISTOR LADDER'", 'Transistor ladder topology');
requireText(processorSource, "topology: 'KORG-35 HP/LP'", 'MS-20 topology');
requireText(processorSource, "topology: '6-OP PHASE MODULATION'", 'DX-style six-operator topology');
requireText(processorSource, 'function polyBlep(', 'Band-limited analog oscillators');
requireText(processorSource, 'this.dcBlock(', 'Synth DC protection');
requireText(processorSource, 'Math.tanh(outL * 1.08)', 'Synth output safety saturation');
requireText(audioEngine, 'this.synth = new SynthEngine(this.context, this.graph.input)', 'AudioEngine synth ownership');
requireText(audioEngine, 'public triggerSynthNote(', 'AudioEngine note API');
requireText(audioEngine, 'this.synth?.dispose()', 'Synth teardown');
requireText(audioEngine, "['Synth circuit', `synth-circuit-processor.js?v=${WORKLET_BUILD_VERSION}`]", 'Synth worklet loading');
requireText(audioEngine, 'synth: SynthTelemetryStats', 'Synth telemetry in DSP profiler');

requireText(rail, '16-STEP PIANO ROLL', 'Readable sequencer heading');
requireText(rail, 'const SYNTH_PRESETS: Record<SynthMachine', 'Machine-aware hardware presets');
requireText(rail, 'aria-label="Synth hardware preset"', 'Hardware preset selector');
requireText(rail, "setPresetId('custom')", 'Manual panel edit state');
requireText(rail, 'aria-label="Sequencer tempo"', 'Sequencer BPM selector');
requireText(rail, 'const stepSeconds = 60 / bpm / 4', 'Tempo-driven sixteenth-note clock');
requireText(rail, 'piano-roll-step-numbers', 'Visible step numbering');
requireText(rail, 'nextChainPosition', 'Functional chained playback');
requireText(rail, 'onTriggerNote(71 - pitch, stepSeconds * .72)', 'Tempo-scaled piano-roll note trigger');
requireText(css, '.piano-roll-step-numbers span:nth-child(4n + 1)', 'Quarter-note beat emphasis');
requireText(css, '.piano-roll-row button.playhead', 'Readable playhead');
requireText(css, 'grid-template-rows: 18px 58px 16px', 'Full-size Rail C knob typography');
requireText(rail, 'moduleId="synth"', 'Synth layout surface');
requireText(rail, 'moduleId="chaos"', 'Chaos layout surface');
requireText(rail, 'moduleId="pressure"', 'Pressure layout surface');
requireText(rail, 'faceplate-pressure-slot', 'Editable Pressure buttons');
requireText(faceplate, "export type RailCFaceplateId = 'synth' | 'chaos' | 'pressure'", 'Rail C layout ownership');
requireText(faceplate, 'setRailCFaceplateControl(', 'Persistent Rail C control movement');
requireText(faceplate, 'linkedModules: boolean', 'Linked/independent editor state');
requireText(layoutEditor, "'MODULES LINKED' : 'INDEPENDENT'", 'Independent layout editor toggle');

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
  runInNewContext(processorSource, {
    sampleRate: SAMPLE_RATE,
    AudioWorkletProcessor: MockAudioWorkletProcessor,
    registerProcessor(name, candidate) {
      if (name === 'calcotone-synth-circuit-processor') Processor = candidate;
    },
  });
}
if (!Processor) failures.push('Synth circuit processor did not register');

function renderMachine(machine, quality) {
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'enabled', value: true } });
  processor.port.onmessage({ data: { type: 'machine', value: machine } });
  processor.port.onmessage({ data: { type: 'parameters', values: [.61, .53, .67, .46, .58, .31] } });
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
  const blocks = Math.ceil(SAMPLE_RATE * 2.5 / BLOCK_SIZE);
  for (let block = 0; block < blocks; block += 1) {
    const channels = [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)];
    processor.process([], [channels]);
    for (const channel of channels) {
      for (let i = 0; i < channel.length; i += 1) {
        const value = channel[i];
        if (!Number.isFinite(value)) {
          failures.push(`${machine} ${quality}x produced a non-finite sample`);
          return null;
        }
        if (Math.abs(value) > 1.001) {
          failures.push(`${machine} ${quality}x exceeded bounded output (${Math.abs(value).toFixed(4)})`);
          return null;
        }
        peak = Math.max(peak, Math.abs(value));
        if (block < 240) {
          sum += value * value;
          dc += value;
          derivative += Math.abs(value - previous);
          previous = value;
          samples += 1;
        }
        if (block > blocks - 40) {
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
  return { rms, peak, derivative: derivative / Math.max(1, samples), tailRms };
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
}

if (failures.length) {
  console.error('\nCALCOTONE synth engine audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log(`CALCOTONE synth engine audit passed (${machines.length} circuit topologies × 3 quality modes, polyphonic DSP, functional 16-step chain).`);
