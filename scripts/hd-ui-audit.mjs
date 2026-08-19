import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n?/g, '\n');
const failures = [];

const main = read('src/main.tsx');
const profile = read('src/ui/displayProfile.ts');
const scheduler = read('src/components/effects/viewportScheduler.ts');
const moduleDisplay = read('src/components/ascii/PressureStyleDisplay.tsx');
const railDisplay = read('src/components/ascii/RailCHardwareDisplay.tsx');
const ascii = read('src/components/ascii/AsciiArtEngine.tsx');
const spectrum = read('src/components/meters/SpectrumWaterfall.tsx');
const hdCss = read('src/highDefinition1440.css');
const faceplateCss = read('src/approvedFaceplate.css');
const powerCss = read('src/components/effects/ModulePowerState.css');

for (const token of [
  "import './highDefinition1440.css'",
  "import { installDisplayProfile } from './ui/displayProfile'",
  'installDisplayProfile()',
  "import './approvedFaceplate.css'",
  "import './components/effects/ModulePowerState.css'",
]) {
  if (!main.includes(token)) failures.push(`main entry is missing ${token}`);
}

const appImport = main.indexOf("import App from './App.tsx'");
const faceplateImport = main.indexOf("import './approvedFaceplate.css'");
const powerImport = main.indexOf("import './components/effects/ModulePowerState.css'");
if (appImport < 0 || faceplateImport < appImport) {
  failures.push('approved faceplate stylesheet must load after the App dependency graph');
}
if (powerImport < faceplateImport) {
  failures.push('module power-state material layer must load after the approved faceplate without replacing its geometry');
}

for (const token of [
  'width >= 2200 && height >= 1200',
  'visualFps: reference1440p ? 45 : 30',
  'canvasScaleLimit: reference1440p ? 2.5 : 2',
  'maximumPixels = 4_800_000',
  "root.dataset.displayProfile = profile.reference1440p ? '1440p' : 'standard'",
]) {
  if (!profile.includes(token)) failures.push(`display profile is missing ${token}`);
}

for (const token of [
  "import { getDisplayProfile } from '../../ui/displayProfile'",
  'const MAX_VISUAL_FPS = 20',
  'const INTERACTION_VISUAL_FPS = 10',
  'Math.min(getDisplayProfile().visualFps, MAX_VISUAL_FPS)',
  'getDisplayProfile().reference1440p ? 15 : 12',
  'targetInterval = Math.max(preferred, reducedInterval())',
  'interactionPriorityCount > 0',
]) {
  if (!scheduler.includes(token)) failures.push(`viewport scheduler is missing ${token}`);
}

const maxVisualFpsInit = scheduler.indexOf('const MAX_VISUAL_FPS = 20');
const interactionPriorityInit = scheduler.indexOf('let interactionPriorityCount = 0');
const firstPreferredIntervalCall = scheduler.indexOf('let targetInterval = preferredInterval()');
if (
  maxVisualFpsInit < 0 ||
  interactionPriorityInit < 0 ||
  firstPreferredIntervalCall < 0 ||
  maxVisualFpsInit > firstPreferredIntervalCall ||
  interactionPriorityInit > firstPreferredIntervalCall
) {
  failures.push('viewport scheduler constants and interaction state must initialize before preferredInterval() is called at module scope (prevents startup TDZ / black screen)');
}

for (const [name, source, tokens] of [
  ['module display', moduleDisplay, [
    'canvasPixelRatio(width, height, 5_400_000)',
    'display.reference1440p ? 30 : 24',
    'subscribeDisplayProfile(resize)',
    'type GraphScratch = {',
    'const graphCharacters = scratch.characters',
    'const graphAccents = scratch.accents',
    "const graphScratchRef = useRef<GraphScratch>({ characters: [], accents: [] })",
    'drawDisplay(context, width, height, dpr, moduleRef.current, audioRef.current, stamp, graphScratchRef.current)',
    "graphCharacters.fill(' ')",
    "graphAccents.fill(' ')",
  ]],
  ['Rail C hardware display', railDisplay, [
    'type RailScratch = {',
    'const chars = scratch.chars',
    'const accents = scratch.accents',
    "const scratchRef = useRef<RailScratch>({ chars: [], accents: [] })",
    'drawRailSpectacle(context, width, height, dpr, props, stamp, scratch)',
    'draw(context, width, height, dpr, current, stamp, scratchRef.current)',
    "chars.fill(' ')",
    "accents.fill(' ')",
  ]],
  ['ASCII engine', ascii, [
    'canvasPixelRatio(width, height, 6_400_000)',
    'profile.reference1440p ? 30 : 24',
    "import { canvasPixelRatio, getDisplayProfile } from '../../ui/displayProfile'",
    'const time = audio.time > 0 ? audio.time : stamp / 1000',
    "const characters = new Array<string>(columns).fill(' ')",
    "const accents = isModule ? new Array<string>(columns).fill(' ') : null",
    "characters.fill(' ')",
    "accents?.fill(' ')",
  ]],
  ['spectrum', spectrum, [
    'canvasPixelRatio(cssWidth, cssHeight, 5_600_000)',
    'const pointCount = 48',
    'subscribeViewportAnimation(render)',
    'const rowDepth = new Float32Array(historyLength)',
    'const rowLineWidth = new Float32Array(historyLength)',
    'const rowStrokeStyle = new Array<string>(historyLength)',
    'const x = centerX + (frequencyPosition - 0.5) * halfWidth * 2',
    'const y = baseY - amplitudeScale * row[pointIndex]',
  ]],
]) {
  for (const token of tokens) {
    if (!source.includes(token)) failures.push(`${name} is missing ${token}`);
  }
}

for (const retired of [
  "const graphCharacters = new Array<string>(innerWidth).fill(' ')",
  "const graphAccents = new Array<string>(innerWidth).fill(' ')",
  "const chars = Array.from({ length: innerWidth }, () => ' ')",
  "const accents = Array.from({ length: innerWidth }, () => ' ')",
]) {
  if (moduleDisplay.includes(retired)) failures.push(`module display must not allocate animated row buffers via ${retired}`);
}
for (const retired of [
  "const chars = Array.from({ length: columns }, () => ' ')",
  "const accents = Array.from({ length: columns }, () => ' ')",
  "const chars = Array.from({ length: innerWidth }, () => ' ')",
  "const accents = Array.from({ length: innerWidth }, () => ' ')",
]) {
  if (railDisplay.includes(retired)) failures.push(`Rail C hardware display must not allocate animated row buffers via ${retired}`);
}
for (const retired of [
  "const characters = Array.from({ length: columns }, () => ' ')",
  "const accents = isModule ? Array.from({ length: columns }, () => ' ') : null",
  'const time = stamp / 1000',
]) {
  if (ascii.includes(retired)) failures.push(`ASCII engine must not regress to ${retired}`);
}
for (const retired of [
  'function projectPoint(',
  'const point = projectPoint(',
]) {
  if (spectrum.includes(retired)) failures.push(`spectrum must not allocate projected point objects via ${retired}`);
}

for (const token of [
  "html[data-display-profile='1440p']",
  'text-rendering: geometricPrecision',
  ':focus-visible',
]) {
  if (!hdCss.includes(token)) failures.push(`1440p raster stylesheet is missing ${token}`);
}

for (const token of [
  'width:64px!important;height:64px!important',
  'width:46px!important;height:46px!important',
  'min-height:88px!important;grid-template-rows:66px 18px!important;gap:3px!important',
  '.faceplate-knob-slot>.knob-control{width:68px}',
  '.rail-c-control-surface .faceplate-knob-slot{width:68px}',
  '.faceplate-layout-stage{position:relative;display:block;width:100%;min-width:0;flex:0 0 auto;overflow:hidden}',
  '.faceplate-viewport-shell{position:absolute;inset:0 0 auto;display:block;width:100%;min-width:0;overflow:hidden}',
  '.faceplate-viewport-shell>.dsp-viewport{width:100%;height:100%!important;min-width:0;margin:0!important;flex:none!important}',
  '.rail-c-module.faceplate-layout-custom .faceplate-viewport-shell>.synth-roll',
  '.rail-c-module.faceplate-layout-custom .faceplate-viewport-shell>.chaos-pad-shell',
  '2026-08-06-uploaded-approved-faceplate-1440p-v1',
]) {
  if (!faceplateCss.includes(token)) failures.push(`approved faceplate stylesheet is missing ${token}`);
}

for (const token of [
  '.knob-shell',
  '.knob-face',
  '.knob-control',
  '.faceplate-viewport-shell',
  '.faceplate-knob-slot',
  '@keyframes hd-optics-drift',
  'animation: hd-optics-drift',
  'transform: translateZ(0)',
  "html[data-display-profile='1440p'] :where(button, select, input)",
  "html[data-display-profile='1440p'] :where(.knob-label, .knob-value)",
]) {
  if (hdCss.includes(token)) failures.push(`1440p raster stylesheet must not own approved faceplate geometry via ${token}`);
}

// Power selection should read like the Live/Balanced/Studio hardware buttons:
// dark/white standby -> gray/white selected, with the display waking on power.
for (const token of [
  '.effect-module:not(.enabled)',
  '.effect-module.enabled',
  '.rail-c-module:not(.enabled)',
  '.rail-c-module.enabled',
  '--module-power-on-top: #a19d90',
  '--module-power-on-mid: #89867b',
  '--module-power-on-bottom: #74726a',
  '--module-power-on-ink: #fffaf0',
  '.effect-module .knob-indicator',
  '.rail-c-module .knob-indicator',
  'background: #fffaf0 !important',
  'opacity: 0.055 !important',
  'filter: brightness(0.18) saturate(0.18) !important',
  'filter: none !important',
]) {
  if (!powerCss.includes(token)) failures.push(`module power-state stylesheet is missing ${token}`);
}
const powerCssWithoutComments = powerCss.replace(/\/\*[\s\S]*?\*\//g, '');
for (const property of ['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'position', 'inset', 'top', 'right', 'bottom', 'left', 'transform', 'margin', 'padding']) {
  const escaped = property.replace('-', '\\-');
  if (new RegExp(`(?:^|[;{]\\s*)${escaped}\\s*:`, 'm').test(powerCssWithoutComments)) {
    failures.push(`module power-state stylesheet must not own approved geometry via ${property}`);
  }
}

if (failures.length) {
  console.error(`1440p UI audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('1440p UI fidelity audit passed · sharp raster targets remain intact while interaction-safe visual fallback, persistent animated buffers, audio-timed ASCII, and allocation-free spectrum projection stay locked');
