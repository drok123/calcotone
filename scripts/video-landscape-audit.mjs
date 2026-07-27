import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (relative) => {
  const file = resolve(root, relative);
  if (!existsSync(file)) { failures.push(`Missing required file: ${relative}`); return ''; }
  return readFileSync(file, 'utf8');
};
const requireText = (source, needle, label) => { if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`); };
const forbidText = (source, needle, label) => { if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`); };

const engine = read('src/components/motion/VideoLandscapeEngine.tsx');
const catalog = read('src/components/motion/VideoLandscapeCatalog.ts');
const css = read('src/components/motion/VideoLandscapeEngine.css');
const field = read('src/components/motion/XYSignalField.tsx');
const temporal = read('src/components/video/TemporalVideo.tsx');

for (const world of ['base','cyber','storm','solar','dream','night']) {
  requireText(catalog, `${world}: 'xy-worlds/cyber-mountain/${world}.mp4'`, `XY ${world} asset slot`);
}
requireText(catalog, 'import.meta.env.BASE_URL', 'XY deployment-safe asset base');
requireText(catalog, 'dominantVisualModule', 'XY dominant-module selector');
requireText(catalog, 'visualContribution', 'XY contribution weighting');
requireText(catalog, 'worldForModule', 'XY dropdown world map');
requireText(catalog, 'PROFILE_OFFSET', 'XY dropdown color identities');

// Every current dropdown entry needs an explicit stable color offset. Duplicate names
// across modules are allowed because the module base grade still distinguishes them.
const effectFiles = [
  ['src/audio/effects/Saturation.ts', 'EMBER_MODE_ORDER'],
  ['src/audio/effects/Chorus.ts', 'DRIFT_MODE_ORDER'],
  ['src/audio/effects/Delay.ts', 'DELAY_ALGORITHM_ORDER'],
  ['src/audio/effects/Reverb.ts', 'REVERB_ALGORITHM_ORDER'],
  ['src/audio/effects/Bitcrusher.ts', 'GRAIN_MODE_ORDER'],
  ['src/audio/effects/Media.ts', 'MEDIA_MODE_ORDER'],
];
for (const [relative, orderName] of effectFiles) {
  const source = read(relative);
  const match = source.match(new RegExp(`export const ${orderName}[^=]*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!match) { failures.push(`Cannot parse ${orderName}`); continue; }
  const modes = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1].toLowerCase());
  for (const mode of modes) {
    const single = `${mode}: [`;
    const quoted = `'${mode}': [`;
    if (!catalog.includes(single) && !catalog.includes(quoted)) failures.push(`XY color identity missing dropdown mode: ${mode}`);
  }
}

requireText(engine, 'syncVideo(incoming, outgoing)', 'XY normalized phase transition');
requireText(engine, 'failedWorlds', 'XY failed-world quarantine');
requireText(engine, 'visibilitychange', 'XY visibility resume');
requireText(engine, 'onCanPlay', 'XY decoder readiness gate');
requireText(engine, 'onError', 'XY decoder error fallback');
requireText(engine, 'const IDLE_PLAYBACK_RATE = 0.40', 'XY 0.4x idle playback');
requireText(engine, 'const DRAG_PLAYBACK_RATE = 0.40', 'XY 0.4x drag playback');
requireText(engine, 'playbackRate = dragging ? DRAG_PLAYBACK_RATE : IDLE_PLAYBACK_RATE', 'XY gesture playback response');
requireText(engine, '<TemporalVideo', 'XY temporal smoothing renderer');
requireText(temporal, 'requestVideoFrameCallback', 'XY frame-synchronized temporal capture');
requireText(temporal, 'easeFrameBlend', 'XY temporal interpolation');
requireText(field, 'if (videoAvailableRef.current) return;', 'Dream renderer suspension under video');
requireText(field, "uses-dream-fallback", 'Dream visual fallback state');

// Source exposure/contrast is authored in the generated clips. Runtime may change
// hue/saturation/tint, but it must never pump brightness or contrast.
requireText(css, 'hue-rotate(var(--grade-hue', 'XY restrained hue grade');
requireText(css, 'saturate(var(--grade-sat', 'XY restrained saturation grade');
forbidText(css, 'brightness(', 'XY video brightness mutation');
forbidText(css, 'contrast(', 'XY video contrast mutation');
forbidText(engine, 'Math.random()', 'XY random visual state');
forbidText(catalog, 'Math.random()', 'XY random dropdown identity');

if (failures.length) {
  console.error('\nCALCOTONE XY video landscape audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}
console.log('CALCOTONE XY video landscape audit passed.');
