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
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

const dynamics = read('src/audio/SignalLab.ts');
const artifact = read('src/audio/effects/Media.ts');
const effectModule = read('src/components/effects/EffectModule.tsx');
const railC = read('src/components/effects/RailCModules.tsx');
const railCArtwork = read('src/components/ascii/RailCHardwareDisplay.tsx');
const loopBridge = read('src/loopBridge.tsx');
const loopStore = read('src/components/signal/loopStore.ts');
const loopWorklet = read('public/loop-processor.js');
const randomRegistry = read('src/features/random/railCRandomRegistry.ts');
const routing = read('src/routing/serialRouting.ts');
const nativeArtifact = read('native/src/artifact_parity_processor.cpp');
const nativeLoop = read('native/src/loop_processor.cpp');
const nativeProcessor = read('native/src/native_processor.cpp');
const main = read('src/main.tsx');
const vite = read('vite.config.ts');

// The former Pressure hardware models remain calibrated DSP, but their visible
// owner is now Artifact's DYNAMICS family rather than a post-rack Pressure unit.
requireText(dynamics, "['fet', 'opto', 'varimu', 'vca']", 'Artifact dynamics machine list');
requireText(dynamics, "this.detectorFilter.type = 'highpass'", 'Artifact dynamics detector DC protection');
requireText(dynamics, 'this.detectorFilter.frequency.value = 42', 'Artifact dynamics detector cutoff');
requireText(dynamics, "this.gainElement.oversample = '4x'", 'Artifact dynamics nonlinear oversampling');
requireText(dynamics, 'Math.cos(activeMix * Math.PI * 0.5)', 'Artifact dynamics equal-power dry law');
requireText(dynamics, 'Math.sin(activeMix * Math.PI * 0.5)', 'Artifact dynamics equal-power wet law');
requireText(dynamics, 'const correlatedNormalization = Math.max(1, dryMix + wetMix)', 'Artifact dynamics correlated-path normalization');
requireText(dynamics, 'const soft = Math.tanh(shifted * gain) / gain', 'Artifact dynamics unit-slope saturation');
requireText(dynamics, 'function pressureMakeupGain(', 'Artifact dynamics topology makeup calibration');
requireText(dynamics, 'Math.min(2.5,', 'Artifact dynamics makeup ceiling');
requireText(dynamics, 'Math.round(character * 48)', 'Artifact dynamics bounded curve refresh');

for (const mode of ['compressor-fet','compressor-opto','compressor-varimu','compressor-vca']) {
  requireText(artifact, `'${mode}'`, `Artifact ${mode} mode`);
}
requireText(artifact, "{ label: 'DYNAMICS', modes: ARTIFACT_DYNAMICS_MODES }", 'Artifact DYNAMICS dropdown group');
requireText(artifact, 'private readonly dynamics: SignalLab', 'Artifact owns browser hardware dynamics engine');
requireText(artifact, 'const dynamicsMode = artifactDynamicsMode(this.mode)', 'Artifact dynamics mode routing');
requireText(artifact, 'this.dynamics.setState({', 'Artifact dynamics parameter routing');
requireText(effectModule, "if (mode === 'compressor-fet') return 'FET 76'", 'Artifact FET 76 label');
requireText(effectModule, "if (mode === 'compressor-opto') return 'OPTO 2A'", 'Artifact OPTO 2A label');
requireText(effectModule, "if (mode === 'compressor-varimu') return 'VARI-MU'", 'Artifact VARI-MU label');
requireText(effectModule, "if (mode === 'compressor-vca') return 'VCA BUS'", 'Artifact VCA BUS label');
requireText(effectModule, "ARTIFACT_DYNAMICS_MODES.some", 'Artifact dynamics macro presentation');
requireText(nativeArtifact, 'PressureParityProcessor dynamics', 'Native Artifact reuses calibrated hardware dynamics processor');
requireText(nativeArtifact, 'requested_mode >= 14U', 'Native Artifact dynamics index boundary');
requireText(nativeArtifact, 'requested_mode - 14U', 'Native Artifact dynamics model mapping');
requireText(nativeArtifact, 'std::clamp(std::round(value), 0.F, 17.F)', 'Native Artifact eighteen-mode ceiling');

// Rail C legacy layout id "pressure" now renders LOOP. Preserve the exact
// approved geometry key while changing the visible/product behavior.
requireText(railC, 'name="Loop"', 'Loop rail module heading');
requireText(railC, 'aria-label="Loop track"', 'Loop track selector');
for (const label of ['REC', 'DUB', 'PLAY', 'CLEAR']) requireText(railC, `'${label}'`, `Loop ${label} transport control`);
requireText(railC, "const knobLabels = ['Track', 'Loop', 'Overdub', 'Fade']", 'Loop four macro controls');
requireText(railC, 'kind="loop"', 'Loop hardware artwork mount');
requireText(railCArtwork, 'loop: {', 'Loop hardware artwork profile');
requireText(railCArtwork, "title: 'L O O P'", 'Loop display identity');
requireText(loopStore, 'export const LOOP_TRACK_COUNT = 8', 'Loop eight-track contract');
requireText(loopStore, "STORAGE_KEY = 'calcotone.loop-state.v1'", 'Loop settings persistence');
requireText(loopStore, "transport: 'empty'", 'Loop transport does not persist audio state');
requireText(loopWorklet, 'const TRACKS = 8', 'Browser Loop eight-track buffer');
requireText(loopWorklet, 'const MAX_SECONDS = 60', 'Browser Loop bounded memory');
requireText(nativeLoop, 'kLoopTrackCount', 'Native Loop fixed track count');
requireText(nativeLoop, 'LoopCommand::Record', 'Native Loop record command');
requireText(nativeLoop, 'LoopCommand::Overdub', 'Native Loop overdub command');

// LOOP is a post-rack sidecar: live rack output feeds its capture/playback
// engine and only final safety/output follows. It is neither RANDOM nor serial.
forbidText(vite, 'signalLabUiTransform()', 'Retired Pressure placement transform');
requireText(main, "import './loopBridge'", 'Loop bridge startup wiring');
forbidText(main, "import './pressureBridge'", 'Retired Pressure bridge startup wiring');
requireText(loopBridge, 'graph.output.connect(loop.input)', 'Rack feeds Loop capture');
requireText(loopBridge, 'loop.output.connect(dcBlock)', 'Loop return feeds protected master chain');
requireText(loopBridge, 'sharedVisualSpectrum?.connect(analyser)', 'Loop restores shared visual tap');
requireText(nativeProcessor, 'sum_dual_mono(', 'Native post-rack stereo sum before Loop');
requireText(nativeProcessor, 'loop.process(output, frames)', 'Native post-rack Loop processing');
requireText(nativeProcessor, 'apply_output_safety(', 'Native final safety follows Loop');
forbidText(nativeProcessor, 'pressure_one.process', 'Retired live post-rack Pressure processing');
requireText(randomRegistry, "RAIL_C_RANDOM_ORDER = ['stomp', 'chaos']", 'Loop excluded from RANDOM order');
forbidText(railC, "useRailCRandomController('pressure'", 'Loop has no RANDOM controller');
requireText(routing, "LOOP_MODULE_ID = 'pressure'", 'Loop approved-layout compatibility key');
requireText(routing, 'sourceId === LOOP_MODULE_ID || targetId === LOOP_MODULE_ID', 'Loop locked outside routing moves');

// Retain quantitative safety checks on the compressor transfer now owned by Artifact.
const modes = ['fet', 'opto', 'varimu', 'vca'];
const styles = ['soft', 'punch', 'glue', 'crush'];
function gainElementSample(mode, character, drive, x) {
  const modeDrive = mode === 'fet' ? 4.8 : mode === 'varimu' ? 3.1 : mode === 'opto' ? 2.3 : 1.8;
  const gain = 1 + drive * modeDrive;
  const asym = mode === 'varimu' ? 0.055 + character * 0.075 : mode === 'fet' ? 0.02 + character * 0.035 : 0.006 + character * 0.014;
  const nonlinearMix = mode === 'fet' ? 0.16 + drive * 0.24
    : mode === 'varimu' ? 0.12 + drive * 0.18
      : mode === 'opto' ? 0.08 + drive * 0.14
        : 0.025 + character * 0.045;
  const shifted = x + Math.max(0, x) * asym;
  const soft = Math.tanh(shifted * gain) / gain;
  let y = shifted + (soft - shifted) * nonlinearMix;
  if (mode === 'opto') y *= 0.996 - Math.abs(x) * character * 0.018;
  if (mode === 'vca') y = x * (1 - character * 0.018) + y * character * 0.018;
  return y;
}

for (const mode of modes) {
  for (const drive of [0, .25, .5, .72, 1]) {
    const epsilon = 1e-4;
    const slope = (gainElementSample(mode, .65, drive, epsilon)
      - gainElementSample(mode, .65, drive, -epsilon)) / (2 * epsilon);
    if (!Number.isFinite(slope) || slope < .92 || slope > 1.08) {
      failures.push(`Artifact dynamics ${mode} small-signal gain is not normalized (${slope.toFixed(3)}×)`);
    }
  }
}

for (let step = 0; step <= 100; step += 1) {
  const mix = step / 100;
  const dry = Math.cos(mix * Math.PI * .5);
  const wet = Math.sin(mix * Math.PI * .5);
  const normalization = Math.max(1, dry + wet);
  const correlatedGain = (dry + wet) / normalization;
  if (Math.abs(correlatedGain - 1) > 1e-9) failures.push(`Artifact dynamics mix law gained at ${mix.toFixed(2)}`);
}

for (const style of styles) {
  const gains = modes.map((mode) => {
    const effectiveDrive = .5;
    const threshold = -8 - effectiveDrive * (mode === 'fet' ? 30 : mode === 'opto' ? 23 : mode === 'varimu' ? 20 : 26);
    const ratioBase = mode === 'fet' ? 4 : mode === 'opto' ? 2.1 : mode === 'varimu' ? 2.4 : 3.2;
    const ratioStyle = style === 'soft' ? .72 : style === 'punch' ? 1.18 : style === 'crush' ? 2.8 : .92;
    const ratio = Math.min(20, Math.max(1.2, ratioBase * ratioStyle + .5 * (mode === 'fet' ? 3.2 : 1.4)));
    const reduction = Math.max(0, -18 - threshold) * (1 - 1 / ratio);
    const recovery = style === 'crush' ? .32 : style === 'soft' ? .42 : style === 'punch' ? .52 : .48;
    const trim = mode === 'fet' ? -.5 : mode === 'varimu' ? .4 : mode === 'vca' ? -.1 : 0;
    const makeupDb = Math.max(-.75, Math.min(2.5, reduction * recovery + effectiveDrive * .6 + trim));
    return Math.pow(10, makeupDb / 20);
  });
  const spreadDb = 20 * Math.log10(Math.max(...gains) / Math.min(...gains));
  if (spreadDb > 1.5) failures.push(`Artifact dynamics ${style} topology makeup spread is ${spreadDb.toFixed(2)} dB`);
}

if (failures.length) {
  console.error('\nCALCOTONE Loop/Artifact dynamics audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log('CALCOTONE Loop/Artifact dynamics audit passed (standalone 8-track Loop + four Artifact compressor topologies).');
