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
const panel = read('src/components/signal/SignalLabPanel.tsx');
const pressureBridge = read('src/pressureBridge.tsx');
const pressureStore = read('src/components/signal/pressureStore.ts');
const transform = read('build/signalLabUiTransform.ts');
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

requireText(panel, '<strong>PRESSURE</strong>', 'Pressure panel heading');
requireText(panel, '<span>Machine</span>', 'Pressure machine control');
requireText(panel, 'label="Drive"', 'Pressure Drive control');
requireText(panel, 'label="Time"', 'Pressure Time control');
requireText(panel, 'label="Character"', 'Pressure Character control');
requireText(panel, 'label="Mix"', 'Pressure Mix control');
requireText(panel, 'SIGNAL_LAB_STYLES.map', 'Pressure hardware style controls');

// Preserve the restored panel placement while asserting that live DSP remains owned
// by the fixed post-rack bridge.
requireText(vite, 'signalLabUiTransform()', 'Restored Pressure UI placement transform');
requireText(transform, '<SignalLabPanel', 'Pressure panel transform mount');
requireText(main, "import './pressureBridge'", 'Pressure bridge startup wiring');
forbidText(main, "import './signalLabEngineBridge'", 'Retired movable Signal bridge startup');
requireText(pressureBridge, 'function applyPostRackPressure(engine: AudioEngine)', 'Fixed post-rack Pressure owner');
requireText(pressureBridge, 'graph.output.connect(pressure.input)', 'Rack feeds Pressure');
requireText(pressureBridge, 'pressure.output.connect(dcBlock)', 'Pressure feeds protected master chain');
requireText(pressureBridge, 'restoreMasterChain(engine)', 'Pressure bypass restores master topology');
requireText(pressureBridge, "window.addEventListener('calcotone:pressure-change'", 'Pressure state event wiring');
requireText(pressureStore, "STORAGE_KEY = 'calcotone.pressure-state.v1'", 'Pressure state persistence');
requireText(pressureStore, 'if (!state.enabled) return null', 'RANDOM respects Pressure power');

if (failures.length) {
  console.error('\nCALCOTONE Pressure/layout audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log('CALCOTONE Pressure/layout audit passed (current DSP; restored panel placement).');
