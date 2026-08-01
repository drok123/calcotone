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
const pressureDisplay = read('src/components/ascii/PressureStyleDisplay.tsx');
const viewport = read('src/components/effects/ModuleViewport.tsx');
const field = read('src/components/motion/XYSignalField.tsx');
const motionPad = read('src/components/motion/MotionPad.tsx');
const railC = read('src/components/effects/RailCModules.tsx');
const railCCss = read('src/components/effects/RailCModules.css');
const app = read('src/App.tsx');
const appCss = read('src/App.css');
const hardwarePalette = read('src/components/layout/CharcoalHardwarePass.css');
const faceplate = read('src/ui/faceplateLayout.ts');
const vite = read('vite.config.ts');
const main = read('src/main.tsx');

requireText(viewport, '<PressureStyleDisplay module={module}', 'Pressure-style module ASCII surface');
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
requireText(pressureDisplay, 'subscribeViewportAnimation(render)', 'Shared module display scheduler');
requireText(pressureDisplay, '1000 / 18', 'Bounded module display cadence');
requireText(pressureDisplay, 'IntersectionObserver', 'Offscreen module display sleep');
requireText(pressureDisplay, 'if (canvas.width !== pixelWidth)', 'Module display resize allocation guard');
forbidText(ascii, 'requestAnimationFrame(', 'Independent ASCII animation loop');
forbidText(ascii, 'Math.random()', 'Random per-frame artwork');
forbidText(ascii, 'audio.driftPhase', 'Unbounded ASCII drift phase');
forbidText(appCss, '.viewport-caption', 'Retired duplicate artwork label styles');
requireText(asciiCss, 'repeating-linear-gradient', 'ASCII scanline optics');
requireText(asciiCss, '@media (prefers-reduced-motion: reduce)', 'Reduced motion support');

const approvedFaceplateGeometry = [
  'version: 2',
  'custom: true',
  'viewportHeight: 168',
  'stageHeight: 292',
  '{ x: 0.07, y: 246 }',
  '{ x: 0.2099125364431487, y: 246 }',
  '{ x: 0.3498542274052478, y: 246 }',
  '{ x: 0.6530612244897959, y: 246 }',
  '{ x: 0.793002915451895, y: 246 }',
  '{ x: 0.93, y: 246 }',
  'snap: 8',
];
let faceplateGeometryCursor = faceplate.indexOf('export const FACTORY_FACEPLATE_LAYOUT');
for (const field of approvedFaceplateGeometry) {
  const fieldPosition = faceplate.indexOf(field, faceplateGeometryCursor + 1);
  if (fieldPosition < 0) {
    failures.push(`Approved faceplate geometry/order: missing ${JSON.stringify(field)}`);
    break;
  }
  faceplateGeometryCursor = fieldPosition;
}
requireText(faceplate, "const FACTORY_LAYOUT_REVISION = '2026-07-30-banked-knob-faceplate'", 'Approved layout revision');
requireText(faceplate, 'window.localStorage.getItem(FACTORY_LAYOUT_REVISION_KEY) !== FACTORY_LAYOUT_REVISION', 'Stale saved-layout replacement');
requireText(faceplate, 'return cloneLayout(FACTORY_FACEPLATE_LAYOUT)', 'Factory layout fallback');
forbidText(faceplate, 'AUTO_FACEPLATE_LAYOUT', 'Automatic layout can override approved geometry');
requireText(faceplate, 'Math.max(...knobs.map((point) => point.y)) + 46', 'Exact saved-layout floor preservation');
requireText(faceplate, 'viewportHeight: 168', 'Pressure factory viewport integration');
requireText(faceplate, '{ x: 0.14, y: 240 }', 'Pressure factory knob integration');
forbidText(main, "import './approvedFaceplateLayoutPatch'", 'Retired startup layout mutation');

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

// Rail C deliberately mixes the six existing ASCII worlds with a functional
// piano-roll screen, the existing XY signal field, and a conventional Pressure logo.
forbidText(vite, 'signalLabUiTransform()', 'Retired Signal panel placement transform');
forbidText(vite, 'dreamFieldCompositionTransform()', 'Obsolete Dream visual transform');
requireText(motionPad, 'signalLab={signalLab}', 'Existing Signal state forwarded to XY');
requireText(app, "const DEFAULT_RAIL_C_ORDER = ['synth', 'chaos', 'pressure']", 'Three-module Rail C');
requireText(railC, 'aria-label="16-step piano roll"', 'Functional Synth piano roll');
requireText(railC, 'toggleCell(step, pitchIndex)', 'Editable Synth notes');
requireText(railC, 'setChain((current)', 'Synth pattern chaining');
requireText(railC, '<MotionPad {...motionPadProps}', 'Chaos owns the XY surface');
requireText(railC, 'pressure-ascii dsp-viewport', 'Pressure conventional ASCII display');
requireText(railCCss, '.piano-roll-grid', 'Piano-roll screen geometry');
requireText(railCCss, '@keyframes pressure-scan', 'Pressure ASCII display motion');
requireText(main, "import './pressureBridge'", 'Existing Pressure DSP bridge preserved');
forbidText(main, "import './components/effects/VideoColorStability.css'", 'Retired video color pass');

if (failures.length) {
  console.error('\nCALCOTONE visual audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}
console.log('CALCOTONE visual audit passed (six ASCII effects plus functional Rail C displays).');
