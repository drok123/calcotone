import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n?/g, '\n');
const failures = [];

const main = read('src/main.tsx');
const profile = read('src/ui/displayProfile.ts');
const scheduler = read('src/components/effects/viewportScheduler.ts');
const moduleDisplay = read('src/components/ascii/PressureStyleDisplay.tsx');
const ascii = read('src/components/ascii/AsciiArtEngine.tsx');
const spectrum = read('src/components/meters/SpectrumWaterfall.tsx');
const hdCss = read('src/highDefinition1440.css');
const faceplateCss = read('src/approvedFaceplate.css');

for (const token of [
  "import './highDefinition1440.css'",
  "import { installDisplayProfile } from './ui/displayProfile'",
  'installDisplayProfile()',
  "import './approvedFaceplate.css'",
]) {
  if (!main.includes(token)) failures.push(`main entry is missing ${token}`);
}

const appImport = main.indexOf("import App from './App.tsx'");
const faceplateImport = main.indexOf("import './approvedFaceplate.css'");
if (appImport < 0 || faceplateImport < appImport) {
  failures.push('approved faceplate stylesheet must load after the App dependency graph');
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
  'return 1000 / getDisplayProfile().visualFps',
  'getDisplayProfile().reference1440p ? 30 : 20',
  'targetInterval = reducedInterval()',
]) {
  if (!scheduler.includes(token)) failures.push(`viewport scheduler is missing ${token}`);
}

for (const [name, source, tokens] of [
  ['module display', moduleDisplay, [
    'canvasPixelRatio(width, height, 5_400_000)',
    'display.reference1440p ? 30 : 24',
    'subscribeDisplayProfile(resize)',
  ]],
  ['ASCII engine', ascii, [
    'canvasPixelRatio(width, height, 6_400_000)',
    'profile.reference1440p ? 30 : 24',
    "import { canvasPixelRatio, getDisplayProfile } from '../../ui/displayProfile'",
  ]],
  ['spectrum', spectrum, [
    'canvasPixelRatio(cssWidth, cssHeight, 5_600_000)',
    'const pointCount = 48',
    'subscribeViewportAnimation(render)',
  ]],
]) {
  for (const token of tokens) {
    if (!source.includes(token)) failures.push(`${name} is missing ${token}`);
  }
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
  '.chaos-pad-shell .xy-pad{min-height:158px;height:158px',
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

if (failures.length) {
  console.error(`1440p UI audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('1440p UI fidelity audit passed · adaptive DPI/FPS separated from the unconditional uploaded faceplate contract');
