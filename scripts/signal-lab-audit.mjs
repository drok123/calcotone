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
const transform = read('build/signalLabUiTransform.ts');
const main = read('src/main.tsx');
const vite = read('vite.config.ts');

requireText(core, "'octaver', 'ringmod', 'tremolo', 'autopan', 'wavefolder'", 'real v1 machine list');
forbidText(core, "'freqshift'", 'placeholder frequency shift removed');
requireText(core, 'this.dcBlock.frequency.value = 24', 'octave rectifier DC protection');
requireText(core, 'FOLD_CURVE_CACHE_LIMIT = 64', 'bounded wavefolder curve cache');

requireText(panel, '<strong>SIGNAL</strong>', 'Signal panel heading');
requireText(panel, "onChange({ position: 'pre' })", 'PRE insert control');
requireText(panel, "onChange({ position: 'post' })", 'POST insert control');
requireText(panel, 'label="Amount"', 'Amount control');
requireText(panel, 'label="Mix"', 'Mix control');

requireText(transform, '<SignalLabPanel', 'Signal panel mounted');
requireText(transform, 'UI/visual owner until Signal Lab has a native AudioEngine insert point.', 'safe UI-only mode');
forbidText(transform, 'engine.setSignalLabState(', 'Signal UI must not touch AudioEngine before native insertion');
forbidText(main, "import './signalLabEngineBridge'", 'experimental Signal bridge must stay out of startup');
requireText(vite, 'signalLabUiTransform()', 'Signal UI transform enabled');

if (failures.length) {
  console.error('\nCALCOTONE Signal Lab audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log('CALCOTONE Signal Lab audit passed (UI mounted; audio graph untouched).');
