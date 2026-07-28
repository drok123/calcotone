import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (relative) => {
  const file = resolve(root, relative);
  if (!existsSync(file)) { failures.push(`Missing required file: ${relative}`); return ''; }
  return readFileSync(file, 'utf8');
};
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

const ascii = read('src/components/ascii/AsciiArtEngine.tsx');
const asciiCss = read('src/components/ascii/AsciiArtEngine.css');
const viewport = read('src/components/effects/ModuleViewport.tsx');
const field = read('src/components/motion/XYSignalField.tsx');
const motionPad = read('src/components/motion/MotionPad.tsx');
const app = read('src/App.tsx');
const vite = read('vite.config.ts');
const main = read('src/main.tsx');

requireText(viewport, '<AsciiArtEngine kind="module" module={module}', 'Module ASCII surface');
requireText(viewport, 'moduleModeKey(module)', 'Dropdown-driven module scene');
requireText(viewport, 'is-reconfiguring', 'Dropdown reconfiguration transition');
forbidText(viewport, '<TemporalVideo', 'Module decoder');
forbidText(viewport, '.mp4', 'Module media asset');

requireText(field, '<AsciiArtEngine', 'XY ASCII surface');
requireText(field, 'kind="landscape"', 'XY combined landscape');
requireText(field, 'pressure={signalLab}', 'Existing Pressure state reaches ASCII world');
forbidText(field, 'DreamFieldEngine', 'Retired Dream fallback');
forbidText(field, 'VideoLandscapeEngine', 'XY decoder world');

requireText(ascii, 'hashAsciiScene', 'Deterministic scene identity');
requireText(ascii, 'moduleModeKey', 'Per-dropdown scene identity');
requireText(ascii, 'subscribeViewportAnimation(render)', 'Shared viewport scheduler');
requireText(ascii, 'getLatestVisualAudioState()', 'Non-React audio snapshot');
requireText(ascii, 'IntersectionObserver', 'Offscreen renderer sleep');
requireText(ascii, '1000 / 18', 'Bounded ASCII cadence');
forbidText(ascii, 'requestAnimationFrame(', 'Independent ASCII animation loop');
forbidText(ascii, 'Math.random()', 'Random per-frame artwork');
requireText(asciiCss, 'repeating-linear-gradient', 'ASCII scanline optics');
requireText(asciiCss, '@media (prefers-reduced-motion: reduce)', 'Reduced motion support');

// Preserve the restored UI/Pressure ownership. This transplant may consume the existing
// Signal state visually, but it must not move or replace the panel, store, or App subscription model.
requireText(vite, 'signalLabUiTransform()', 'Restored Signal panel placement');
forbidText(vite, 'dreamFieldCompositionTransform()', 'Obsolete Dream visual transform');
requireText(motionPad, 'signalLab={signalLab}', 'Existing Signal state forwarded to XY');
forbidText(app, 'usePressureState', 'No new workstation-wide Pressure subscription');
requireText(main, "import './pressureBridge'", 'Existing Pressure DSP bridge preserved');
forbidText(main, "import './components/effects/VideoColorStability.css'", 'Retired video color pass');

if (failures.length) {
  console.error('\nCALCOTONE visual audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}
console.log('CALCOTONE visual audit passed (ASCII-only visuals on the restored UI/Pressure layout).');
