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

const viewport = read('src/components/effects/ModuleViewport.tsx');

const videoTags = (viewport.match(/<video\b/g) ?? []).length;
if (videoTags !== 1) failures.push(`ModuleViewport must own exactly one decoder template; found ${videoTags}`);

// The viewport stays full-frame. Black bars/masks and sliced duplicate layers are not allowed.
forbidText(viewport, 'module-video-void-mask', 'Viewport black-mask overlay');
forbidText(viewport, 'module-video-fx-a', 'Viewport sliced overlay A');
forbidText(viewport, 'module-video-fx-b', 'Viewport sliced overlay B');
forbidText(viewport, 'module-video-fx-c', 'Viewport sliced overlay C');
forbidText(viewport, 'PING_PONG_FILES', 'Dead ping-pong asset dependency');

// Decoder recovery must handle stalls/no-frame states, not only a formal error event.
requireText(viewport, 'preload="auto"', 'Viewport eager media preload');
requireText(viewport, "video.addEventListener('stalled', scheduleRecovery)", 'Viewport stalled recovery');
requireText(viewport, "video.addEventListener('waiting', scheduleRecovery)", 'Viewport waiting recovery');
requireText(viewport, "video.addEventListener('error', reload)", 'Viewport media-error recovery');
requireText(viewport, 'video.videoWidth === 0', 'Viewport no-frame recovery');
requireText(viewport, 'video.load()', 'Viewport decoder reload');
requireText(viewport, 'const videoUrl = key ? assetUrl(VIDEO_FILES[key]) : null', 'Viewport direct known-good source');
requireText(viewport, 'visibilitychange', 'Viewport resume-after-background recovery');

for (const name of ['ember', 'drift', 'drift-alt', 'halo', 'artifact', 'atmos', 'grain']) {
  const file = `public/visuals/${name}.mp4`;
  if (!existsSync(resolve(root, file))) failures.push(`Missing visual asset: ${file}`);
}

if (failures.length) {
  console.error('\nCALCOTONE visual audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log('CALCOTONE visual audit passed.');
