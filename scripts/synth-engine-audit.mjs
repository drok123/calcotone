import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
const audioEngine = read('src/audio/AudioEngine.ts');
const rail = read('src/components/effects/RailCModules.tsx');
const css = read('src/components/effects/RailCModules.css');

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

requireText(synth, "type VoiceFamily = 'analog' | 'fm' | 'sample' | 'wavetable' | 'phase'", 'Distinct synth voice families');
requireText(synth, 'const MAX_VOICES = 10', 'Synth polyphony guard');
requireText(synth, 'this.output.connect(destination)', 'Synth effect-chain routing');
requireText(synth, 'scheduleEnvelope(', 'Synth amplitude envelope');
requireText(synth, 'this.createFmVoice(', 'DX-style FM voice');
requireText(synth, 'this.createSampleVoice(', 'Fairlight-style sampled voice');
requireText(synth, 'this.createSubtractiveVoice(', 'Analog and wavetable voice');
requireText(audioEngine, 'this.synth = new SynthEngine(this.context, this.graph.input)', 'AudioEngine synth ownership');
requireText(audioEngine, 'public triggerSynthNote(', 'AudioEngine note API');
requireText(audioEngine, 'this.synth?.dispose()', 'Synth teardown');

requireText(rail, '16-STEP PIANO ROLL', 'Readable sequencer heading');
requireText(rail, 'const SYNTH_PRESETS: Record<SynthMachine', 'Machine-aware hardware presets');
requireText(rail, 'aria-label="Synth hardware preset"', 'Hardware preset selector');
requireText(rail, "setPresetId('custom')", 'Manual panel edit state');
requireText(rail, 'piano-roll-step-numbers', 'Visible step numbering');
requireText(rail, 'nextChainPosition', 'Functional chained playback');
requireText(rail, 'onTriggerNote(71 - pitch, .11)', 'Piano-roll note trigger');
requireText(css, '.piano-roll-step-numbers span:nth-child(4n + 1)', 'Quarter-note beat emphasis');
requireText(css, '.piano-roll-row button.playhead', 'Readable playhead');

if (failures.length) {
  console.error('\nCALCOTONE synth engine audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log(`CALCOTONE synth engine audit passed (${machines.length} machines, polyphonic DSP, functional 16-step chain).`);
