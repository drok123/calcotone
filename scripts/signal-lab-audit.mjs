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

const core = read('src/audio/SignalLab.ts');
const railC = read('src/components/effects/RailCModules.tsx');
const railCArtwork = read('src/components/ascii/RailCHardwareDisplay.tsx');
const pressureBridge = read('src/pressureBridge.tsx');
const pressureStore = read('src/components/signal/pressureStore.ts');
const app = read('src/App.tsx');
const main = read('src/main.tsx');
const vite = read('vite.config.ts');

requireText(core, "['fet', 'opto', 'varimu', 'vca']", 'Pressure machine list');
requireText(core, "this.detectorFilter.type = 'highpass'", 'Pressure detector DC protection');
requireText(core, 'this.detectorFilter.frequency.value = 42', 'Pressure detector cutoff');
requireText(core, "this.gainElement.oversample = '4x'", 'Pressure nonlinear oversampling');
requireText(core, 'const activeMix = this.state.enabled ? this.state.mix : 0', 'Pressure true bypass mix');
requireText(core, 'Math.cos(activeMix * Math.PI * 0.5)', 'Pressure equal-power dry law');
requireText(core, 'Math.sin(activeMix * Math.PI * 0.5)', 'Pressure equal-power wet law');
requireText(core, 'const correlatedNormalization = Math.max(1, dryMix + wetMix)', 'Pressure correlated-path normalization');
requireText(core, 'const soft = Math.tanh(shifted * gain) / gain', 'Pressure unit-slope saturation');
requireText(core, 'function pressureMakeupGain(', 'Pressure topology makeup calibration');
requireText(core, 'Math.min(2.5,', 'Pressure makeup ceiling');
requireText(core, 'Math.round(character * 48)', 'Pressure bounded curve refresh');

requireText(railC, 'name="Pressure"', 'Pressure rail module heading');
requireText(railC, 'aria-label="Pressure machine"', 'Pressure machine control');
requireText(railC, "['Drive', 'drive']", 'Pressure Drive control');
requireText(railC, "['Time', 'time']", 'Pressure Time control');
requireText(railC, "['Character', 'character']", 'Pressure Character control');
requireText(railC, "['Mix', 'mix']", 'Pressure Mix control');
requireText(railC, 'SIGNAL_LAB_STYLES.map', 'Pressure hardware style controls');
requireText(railC, 'className={`pressure-ascii dsp-viewport', 'Pressure ASCII screen');

// Pressure now owns a normal Rail C chassis while live DSP remains owned by the
// fixed post-rack bridge.
forbidText(vite, 'signalLabUiTransform()', 'Retired Pressure placement transform');
requireText(app, "['C', railCOrder]", 'Rail C workstation placement');
requireText(app, '<RailCModule', 'Rail C module renderer');
requireText(main, "import './pressureBridge'", 'Pressure bridge startup wiring');
forbidText(main, "import './signalLabEngineBridge'", 'Retired movable Signal bridge startup');
requireText(pressureBridge, 'function applyPostRackPressure(engine: AudioEngine)', 'Fixed post-rack Pressure owner');
requireText(pressureBridge, 'graph.output.connect(pressure.input)', 'Rack feeds Pressure');
requireText(pressureBridge, 'pressure.output.connect(dcBlock)', 'Pressure feeds protected master chain');
requireText(pressureBridge, 'sharedVisualSpectrum?.connect(analyser)', 'Pressure restores shared visual tap');
requireText(pressureBridge, 'restoreMasterChain(engine)', 'Pressure bypass restores master topology');
requireText(pressureBridge, "window.addEventListener('calcotone:pressure-change'", 'Pressure state event wiring');
requireText(railCArtwork, 'const activity = props.enabled ? clamp01(', 'Pressure/Rail C bypass artwork activity reaches zero');
forbidText(pressureBridge, 'mountPressurePanel', 'Retired out-of-rail Pressure mount');
requireText(pressureStore, "STORAGE_KEY = 'calcotone.pressure-state.v1'", 'Pressure state persistence');
requireText(pressureStore, 'if (!state.enabled) return null', 'RANDOM respects Pressure power');
requireText(pressureStore, 'drive: Math.min(0.72, randomIn(recipe.drive))', 'Pressure RANDOM drive ceiling');
requireText(pressureStore, 'mix: Math.min(0.82, randomIn(recipe.mix))', 'Pressure RANDOM mix ceiling');

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
      failures.push(`Pressure ${mode} small-signal gain is not normalized (${slope.toFixed(3)}×)`);
    }
  }
}

for (let step = 0; step <= 100; step += 1) {
  const mix = step / 100;
  const dry = Math.cos(mix * Math.PI * .5);
  const wet = Math.sin(mix * Math.PI * .5);
  const normalization = Math.max(1, dry + wet);
  const correlatedGain = (dry + wet) / normalization;
  if (Math.abs(correlatedGain - 1) > 1e-9) failures.push(`Pressure mix law gained at ${mix.toFixed(2)}`);
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
  if (spreadDb > 1.5) failures.push(`Pressure ${style} topology makeup spread is ${spreadDb.toFixed(2)} dB`);
}

if (failures.length) {
  console.error('\nCALCOTONE Pressure/layout audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log('CALCOTONE Pressure/layout audit passed (current DSP in Rail C).');
