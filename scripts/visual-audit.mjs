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
const railC = read('src/components/effects/RailCModules.tsx');
const railDisplay = read('src/components/ascii/RailCHardwareDisplay.tsx');
const loopDisplay = read('src/components/ascii/LoopTrackMatrixDisplay.tsx');
const railCCss = read('src/components/effects/RailCModules.css');
const app = read('src/App.tsx');
const appCss = read('src/App.css');
const hardwarePalette = read('src/components/layout/CharcoalHardwarePass.css');
const faceplate = read('src/ui/faceplateLayout.ts');
const vite = read('vite.config.ts');
const main = read('src/main.tsx');

requireText(viewport, '<AsciiArtEngine kind="module" module={module}', 'High-fidelity module ASCII surface');
requireText(viewport, 'module-spectacle-ascii', 'Dedicated module spectacle surface');
forbidText(viewport, 'PressureStyleDisplay', 'Retired low-density core module renderer');
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
requireText(ascii, 'profile.reference1440p ? 30 : 24', 'Adaptive ASCII cadence');
requireText(ascii, '1000 / profile.visualFps', 'Responsive landscape dragging cadence');
requireText(ascii, 'canvasPixelRatio(width, height, 6_400_000)', 'High-DPI ASCII canvas');
requireText(ascii, 'const horizontalScale = width / gridWidth', 'Edge-to-edge ASCII width fit');
requireText(ascii, 'const verticalScale = height / gridHeight', 'Edge-to-edge ASCII height fit');
requireText(ascii, "const MODULE_SHADE_RAMP = ' .:-=+*#%@'", 'High-fidelity ASCII density ramp');
requireText(ascii, 'const MODULE_BAYER_4', 'Ordered module ASCII dithering');
requireText(ascii, 'function moduleEdgeGlyph', 'Edge-aware ASCII reconstruction');
requireText(ascii, 'const supersampled = (center * 3 + left + right + up + down) / 7', 'Five-tap module supersampling');
requireText(ascii, "MODULE_ART_OFF_WHITE = '#f2ead8'", 'Calcotone off-white spectacle base');
requireText(ascii, 'Math.max(84, Math.min(136, Math.floor(width / 3.15)))', '1440p high-density module grid');
requireText(ascii, 'dpr * horizontalScale', 'Measured ASCII canvas transform');
requireText(pressureDisplay, 'subscribeViewportAnimation(render)', 'Shared module display scheduler');
requireText(pressureDisplay, 'display.reference1440p ? 30 : 24', 'Adaptive module display cadence');
requireText(pressureDisplay, 'canvasPixelRatio(width, height, 5_400_000)', 'High-DPI module display');
requireText(pressureDisplay, 'IntersectionObserver', 'Offscreen module display sleep');
requireText(pressureDisplay, 'if (canvas.width !== pixelWidth)', 'Module display resize allocation guard');
requireText(pressureDisplay, "MODULE_ART_OFF_WHITE = '#f2ead8'", 'Unified off-white module artwork');
requireText(pressureDisplay, 'context.fillStyle = textRow ? profile.primary : MODULE_ART_OFF_WHITE', 'Accent-only module text palette');
requireText(pressureDisplay, '(column + row + seed) % 17 === 0', 'Sparse animated accent details');
forbidText(ascii, 'requestAnimationFrame(', 'Independent ASCII animation loop');
forbidText(ascii, 'Math.random()', 'Random per-frame artwork');
forbidText(ascii, 'audio.driftPhase', 'Unbounded ASCII drift phase');
forbidText(appCss, '.viewport-caption', 'Retired duplicate artwork label styles');
requireText(asciiCss, 'repeating-linear-gradient', 'ASCII scanline optics');
requireText(asciiCss, '@media (prefers-reduced-motion: reduce)', 'Reduced motion support');

const approvedFaceplateGeometry = [
  '{ x: 0.09523809523809523, y: 224 }',
  '{ x: 0.21428571428571427, y: 224 }',
  '{ x: 0.3333333333333333, y: 224 }',
  '{ x: 0.6785714285714286, y: 224 }',
  '{ x: 0.7976190476190477, y: 224 }',
  '{ x: 0.9166666666666666, y: 224 }',
  'version: 2',
  'custom: true',
  'viewportHeight: 168',
  'stageHeight: 304',
  'snap: 8',
];
let faceplateGeometryCursor = faceplate.indexOf('const MASTER_KNOBS');
for (const field of approvedFaceplateGeometry) {
  const fieldPosition = faceplate.indexOf(field, faceplateGeometryCursor + 1);
  if (fieldPosition < 0) {
    failures.push(`Approved faceplate geometry/order: missing ${JSON.stringify(field)}`);
    break;
  }
  faceplateGeometryCursor = fieldPosition;
}
requireText(faceplate, "const FACTORY_LAYOUT_REVISION = '2026-08-06-uploaded-approved-faceplate-1440p-v1'", 'Shared web layout revision');
requireText(faceplate, 'window.localStorage.getItem(FACTORY_LAYOUT_REVISION_KEY) !== FACTORY_LAYOUT_REVISION', 'Stale saved-layout replacement');
requireText(faceplate, 'return cloneLayout(FACTORY_FACEPLATE_LAYOUT)', 'Factory layout fallback');
forbidText(faceplate, 'AUTO_FACEPLATE_LAYOUT', 'Automatic layout can override approved geometry');
requireText(faceplate, 'Math.max(...knobs.map((point) => point.y)) + 46', 'Exact saved-layout floor preservation');
requireText(faceplate, 'pressure: {\n      viewportHeight: 168', 'Pressure web-reference viewport integration');
requireText(faceplate, '{ x: 0.3391812865497076, y: 216 }', 'Pressure uploaded-approved knob integration');
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

// Rail C is definitively Stomp → Stack → Loop (legacy layout key pressure). Synth and the old Chaos XY
// surface are retired from this rack and must not return through stale source or CSS.
forbidText(vite, 'signalLabUiTransform()', 'Retired Signal panel placement transform');
forbidText(vite, 'dreamFieldCompositionTransform()', 'Obsolete Dream visual transform');
forbidText(railC, '<MotionPad', 'Retired Chaos XY surface');
requireText(app, "const DEFAULT_RAIL_C_ORDER = ['stomp', 'chaos', 'pressure']", 'Three-module Rail C');
forbidText(railC, '16-step piano roll', 'Retired Synth piano roll');
forbidText(railC, 'toggleCell(step, pitchIndex)', 'Retired Synth note editor');
forbidText(railC, 'setChain((current)', 'Retired Synth pattern chaining');
requireText(railC, 'aria-label="STACK amplifier"', 'Stack amplifier selector');
requireText(railC, 'aria-label="STACK cabinet"', 'Stack cabinet selector');
requireText(railC, 'kind="stomp"', 'Stomp shared hardware artwork');
requireText(railC, 'kind="stack"', 'Stack shared hardware artwork');
requireText(railC, '<LoopTrackMatrixDisplay', 'Loop canonical four-track artwork');
requireText(loopDisplay, 'LOOP_VISIBLE_TRACK_COUNT', 'Loop four-track display contract');
requireText(loopDisplay, 'loopTrackProgress(track, stamp)', 'Loop independent orbit playheads');
requireText(loopDisplay, 'const outerRim = clamp01', 'Loop retained mechanical ring language');
requireText(loopDisplay, 'const innerGroove = clamp01', 'Loop retained inner groove language');
requireText(loopDisplay, 'const indexTick = Math.max', 'Loop retained clock index detail');
requireText(loopDisplay, 'const cellWidth = Math.floor(columns / 2)', 'Loop 2x2 track matrix');
requireText(loopDisplay, 'subscribeViewportAnimation(render)', 'Loop shared viewport scheduler');
requireText(railDisplay, "const RAIL_SHADE_RAMP = ' .:-=+*#%@'", 'Rail C spectacle density ramp');
requireText(railDisplay, 'function railSpectacleSample', 'Stomp/Stack dedicated spectacle fields');
requireText(railDisplay, 'function drawRailSpectacle', 'Stomp/Stack high-density rasterizer');
requireText(railDisplay, 'const value = (center * 3 + left + right + up + down) / 7', 'Rail C five-tap supersampling');
requireText(railDisplay, "if (props.kind === 'stomp' || props.kind === 'stack')", 'Stomp/Stack spectacle routing');
requireText(railC, 'pressure-ascii dsp-viewport', 'Loop approved-geometry ASCII display');
forbidText(railCCss, '.module-synth', 'Retired Synth module CSS');
forbidText(railCCss, '.synth-', 'Retired Synth control CSS');
forbidText(railCCss, '.piano-roll-', 'Retired piano-roll CSS');
requireText(railCCss, '@keyframes pressure-scan', 'Pressure ASCII display motion');
requireText(main, "import './loopBridge'", 'Standalone Loop bridge installed');
forbidText(main, "import './pressureBridge'", 'Retired Pressure post-rack bridge');
forbidText(main, "import './components/effects/VideoColorStability.css'", 'Retired video color pass');

if (failures.length) {
  console.error('\nCALCOTONE visual audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}
console.log('CALCOTONE visual audit passed (six ASCII effects plus Stomp, Stack, and four-track Loop).');
