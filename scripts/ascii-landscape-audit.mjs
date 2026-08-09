import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';

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

const engine = read('src/components/ascii/AsciiArtEngine.tsx');
const pressureDisplay = read('src/components/ascii/PressureStyleDisplay.tsx');
const viewport = read('src/components/effects/ModuleViewport.tsx');
const field = read('src/components/motion/XYSignalField.tsx');
const scheduler = read('src/components/effects/viewportScheduler.ts');

const effectFiles = [
  ['saturation', 'src/audio/effects/Saturation.ts', 'EMBER_MODE_ORDER'],
  ['chorus', 'src/audio/effects/Chorus.ts', 'DRIFT_MODE_ORDER'],
  ['delay', 'src/audio/effects/Delay.ts', 'DELAY_ALGORITHM_ORDER'],
  ['reverb', 'src/audio/effects/Reverb.ts', 'REVERB_ALGORITHM_ORDER'],
  ['bitcrusher', 'src/audio/effects/Bitcrusher.ts', 'GRAIN_MODE_ORDER'],
  ['media', 'src/audio/effects/Media.ts', 'MEDIA_MODE_ORDER'],
];

function hashAsciiScene(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const identities = new Map();
let dropdownModeCount = 0;
for (const [moduleId, relative, orderName] of effectFiles) {
  const source = read(relative);
  const match = source.match(new RegExp(`export const ${orderName}[^=]*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!match) { failures.push(`Cannot parse ${orderName}`); continue; }
  const modes = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1]);
  dropdownModeCount += modes.length;
  for (const mode of modes) {
    const key = `${moduleId}:${mode}`;
    const normalizedKey = key.toLowerCase();
    const seed = hashAsciiScene(key);
    const collision = identities.get(seed);
    if (collision) failures.push(`ASCII identity collision: ${collision} and ${key}`);
    identities.set(seed, key);
    requireText(engine, `'${normalizedKey}':`, `${key} named ASCII variant`);
  }
}
if (dropdownModeCount !== 95) {
  failures.push(`Expected 95 dropdown ASCII identities; found ${dropdownModeCount}`);
}
requireText(engine, 'export function moduleModeKey', 'Exact module/mode identity');
requireText(engine, 'return `${module.id}:${moduleMode(module)}`', 'Module-qualified dropdown key');
requireText(engine, 'hashAsciiScene(key)', 'Deterministic per-mode seed');
requireText(engine, 'export const MODE_ART_VARIANTS', 'Explicit dropdown art table');
requireText(engine, 'export const ASCII_LOOP_SECONDS = 18', 'Perfect ASCII loop duration');
requireText(engine, 'loopAngleForTime(time)', 'Modulo ASCII loop phase');
requireText(engine, 'sampleModeAccent(layer, x, y, loopAngle)', 'Semantic dropdown motif layer');
for (const moduleId of ['saturation', 'chorus', 'delay', 'reverb', 'bitcrusher', 'media']) {
  requireText(engine, `case '${moduleId}'`, `${moduleId} ASCII composition`);
  requireText(pressureDisplay, `case '${moduleId}'`, `${moduleId} Pressure-style field`);
  requireText(pressureDisplay, `${moduleId}: {`, `${moduleId} Pressure-style display profile`);
}
for (const pressureMode of ['fet', 'opto', 'varimu', 'vca']) {
  requireText(engine, `case '${pressureMode}'`, `Pressure ${pressureMode} ASCII composition`);
}
requireText(engine, 'subscribeViewportAnimation(render)', 'Shared landscape scheduler');
requireText(engine, 'IntersectionObserver', 'Offscreen landscape suspension');
requireText(engine, 'canvasPixelRatio(width, height, 6_400_000)', 'Bounded high-DPI landscape canvas');
requireText(engine, 'profile.reference1440p ? 30 : 24', 'Adaptive landscape cadence');
forbidText(engine, 'requestAnimationFrame(', 'Per-surface landscape animation loop');
forbidText(engine, 'Math.random()', 'Nondeterministic landscape art');
forbidText(engine, 'audio.driftPhase', 'Unbounded non-looping landscape phase');
requireText(pressureDisplay, '╔', 'Pressure-style framed display');
requireText(pressureDisplay, "'█'.repeat(active)", 'Pressure-style block meter');
requireText(pressureDisplay, 'moduleModeLabel(module)', 'Readable mode display');
requireText(pressureDisplay, "MODULE_ART_OFF_WHITE = '#f2ead8'", 'Unified off-white module artwork');
requireText(pressureDisplay, 'context.fillStyle = textRow ? profile.primary : MODULE_ART_OFF_WHITE', 'Module text-only accent palette');
requireText(pressureDisplay, 'subscribeViewportAnimation(render)', 'Shared module display scheduler');
requireText(pressureDisplay, 'IntersectionObserver', 'Offscreen module display suspension');
requireText(pressureDisplay, 'canvasPixelRatio(width, height, 5_400_000)', 'Bounded high-DPI module canvas');
requireText(pressureDisplay, 'display.reference1440p ? 30 : 24', 'Adaptive active module cadence');
forbidText(pressureDisplay, 'requestAnimationFrame(', 'Per-surface module animation loop');
forbidText(pressureDisplay, 'Math.random()', 'Nondeterministic module display');
forbidText(viewport, 'viewport-caption', 'Duplicate module artwork label');
requireText(viewport, '<AsciiArtEngine kind="module" module={module}', 'High-fidelity module renderer');
forbidText(viewport, 'PressureStyleDisplay', 'Retired low-density core module renderer');
requireText(field, 'kind="landscape"', 'XY ASCII landscape renderer');
requireText(scheduler, 'function frameBudget(): number', 'Adaptive shared visual frame budget');
requireText(scheduler, 'const HEAVY_FRAME_MS = 10.5', 'Visual overload fallback threshold');
requireText(scheduler, 'targetInterval = reducedInterval()', 'Automatic visual-rate fallback');

const retired = [
  'src/components/video/TemporalVideo.tsx',
  'src/components/video/TemporalVideo.css',
  'src/components/motion/VideoLandscapeEngine.tsx',
  'src/components/motion/VideoLandscapeEngine.css',
  'src/components/motion/VideoLandscapeCatalog.ts',
  'src/components/effects/ModuleViewportVideo.css',
  'src/components/effects/VideoColorStability.css',
  'build/dreamFieldCompositionTransform.ts',
  'public/visuals/ember.mp4',
  'public/visuals/drift.mp4',
  'public/visuals/drift-alt.mp4',
  'public/visuals/halo.mp4',
  'public/visuals/artifact.mp4',
  'public/visuals/atmos.mp4',
  'public/visuals/grain.mp4',
];
for (const relative of retired) {
  if (existsSync(resolve(root, relative))) failures.push(`Retired decoder path still exists: ${relative}`);
}

function collectSource(directory) {
  const entries = readdirSync(resolve(root, directory), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return collectSource(relative);
    return ['.ts', '.tsx', '.css'].includes(extname(entry.name)) ? [relative] : [];
  });
}
const runtimeSource = collectSource('src').map((relative) => read(relative)).join('\n');
for (const token of ['<video', 'TemporalVideo', 'requestVideoFrameCallback', 'VideoLandscapeEngine', '.mp4']) {
  forbidText(runtimeSource, token, 'Decoder-free runtime');
}

if (failures.length) {
  console.error('\nCALCOTONE ASCII landscape audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}
console.log(`CALCOTONE ASCII landscape audit passed (${dropdownModeCount} deterministic dropdown identities; high-fidelity spectacle module displays; zero decoders).`);
