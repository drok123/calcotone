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
requireText(pressureBridge, 'restoreMasterChain(engine)', 'Pressure bypass restores master topology');
requireText(pressureBridge, "window.addEventListener('calcotone:pressure-change'", 'Pressure state event wiring');
forbidText(pressureBridge, 'mountPressurePanel', 'Retired out-of-rail Pressure mount');
requireText(pressureStore, "STORAGE_KEY = 'calcotone.pressure-state.v1'", 'Pressure state persistence');
requireText(pressureStore, 'if (!state.enabled) return null', 'RANDOM respects Pressure power');

if (failures.length) {
  console.error('\nCALCOTONE Pressure/layout audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log('CALCOTONE Pressure/layout audit passed (current DSP in Rail C).');
