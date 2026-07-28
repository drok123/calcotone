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
const appCss = read('src/App.css');
const hardwarePalette = read('src/components/layout/CharcoalHardwarePass.css');
const vite = read('vite.config.ts');
const main = read('src/main.tsx');

requireText(viewport, '<AsciiArtEngine kind="module" module={module}', 'Module ASCII surface');
requireText(viewport, 'moduleModeKey(module)', 'Dropdown-driven module scene');
requireText(viewport, 'is-reconfiguring', 'Dropdown reconfiguration transition');
forbidText(viewport, 'viewport-caption', 'Duplicate module artwork label');
forbidText(viewport, '<TemporalVideo', 'Module decoder');
forbidText(viewport, '.mp4', 'Module media asset');

requireText(field, '<AsciiArtEngine', 'XY ASCII surface');
requireText(field, 'kind="landscape"', 'XY combined landscape');
requireText(field, 'pressure={signalLab}', 'Existing Pressure state reaches ASCII world');
forbidText(field, 'DreamFieldEngine', 'Retired Dream fallback');
forbidText(field, 'VideoLandscapeEngine', 'XY decoder world');

requireText(ascii, 'hashAsciiScene', 'Deterministic scene identity');
requireText(ascii, 'moduleModeKey', 'Per-dropdown scene identity');
requireText(ascii, 'export const MODE_ART_VARIANTS', 'Named dropdown art variants');
requireText(ascii, 'export const ASCII_LOOP_SECONDS = 18', 'Closed ASCII loop duration');
requireText(ascii, 'loopAngleForTime(time)', 'Modulo loop phase');
requireText(ascii, 'sampleModeAccent(layer, x, y, loopAngle)', 'Module-inspired dropdown accent');
requireText(ascii, 'subscribeViewportAnimation(render)', 'Shared viewport scheduler');
requireText(ascii, 'getLatestVisualAudioState()', 'Non-React audio snapshot');
requireText(ascii, 'IntersectionObserver', 'Offscreen renderer sleep');
requireText(ascii, '1000 / 18', 'Bounded ASCII cadence');
requireText(ascii, 'const horizontalScale = width / gridWidth', 'Edge-to-edge ASCII width fit');
requireText(ascii, 'const verticalScale = height / gridHeight', 'Edge-to-edge ASCII height fit');
requireText(ascii, 'dpr * horizontalScale', 'Measured ASCII canvas transform');
forbidText(ascii, 'requestAnimationFrame(', 'Independent ASCII animation loop');
forbidText(ascii, 'Math.random()', 'Random per-frame artwork');
forbidText(ascii, 'audio.driftPhase', 'Unbounded ASCII drift phase');
forbidText(appCss, '.viewport-caption', 'Retired duplicate artwork label styles');
requireText(asciiCss, 'repeating-linear-gradient', 'ASCII scanline optics');
requireText(asciiCss, '@media (prefers-reduced-motion: reduce)', 'Reduced motion support');


requireText(hardwarePalette, '--calcotone-cream-ink: #101315', 'Patches-charcoal ink on cream');
requireText(hardwarePalette, '.spectrum-header {', 'Cream Spectrum title/LIVE box');
requireText(hardwarePalette, '.sample-recorder {', 'Cream Recorder chassis');
requireText(hardwarePalette, '.level-meter span.lit', 'Cream level-meter illumination');
requireText(hardwarePalette, '.output-meter span.lit', 'Cream output-meter illumination');
requireText(hardwarePalette, '.knob-patch-jack.assigned', 'Dark metallic knob jacks');
requireText(hardwarePalette, '.xy-patch-destination.axis-y i', 'Dark metallic XY sockets');
requireText(hardwarePalette, '.pressure-panel .knob-label', 'Charcoal Pressure labels');
requireText(hardwarePalette, '.effect-module .module-header h3', 'Charcoal module titles');
requireText(hardwarePalette, '.effect-module .knob-label', 'Charcoal module control legends');
requireText(hardwarePalette, '.effect-module .module-route-cue', 'Charcoal module route cue');
requireText(hardwarePalette, '.effect-module .coming-soon', 'Charcoal module fallback text');
const hardwarePolishImport = main.indexOf("import './components/layout/HardwarePolishPass.css'");
const charcoalPassImport = main.indexOf("import './components/layout/CharcoalHardwarePass.css'");
if (hardwarePolishImport < 0 || charcoalPassImport < 0 || charcoalPassImport < hardwarePolishImport) {
  failures.push('Hardware palette cascade: CharcoalHardwarePass must load after HardwarePolishPass');
}

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
