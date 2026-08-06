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
const css = read('src/highDefinition1440.css');

for (const token of [
  "import './highDefinition1440.css'",
  "import { installDisplayProfile } from './ui/displayProfile'",
  'installDisplayProfile()',
]) {
  if (!main.includes(token)) failures.push(`main entry is missing ${token}`);
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
  '@keyframes hd-optics-drift',
  'text-rendering: geometricPrecision',
  '.ascii-art-engine.is-active',
  ':focus-visible',
]) {
  if (!css.includes(token)) failures.push(`1440p stylesheet is missing ${token}`);
}

if (failures.length) {
  console.error(`1440p UI audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('1440p UI fidelity audit passed · adaptive DPI, 45/30 FPS scheduling, crisp typography, module/spectrum canvas contracts');
