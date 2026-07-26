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

// A playable full-frame video is the default. Decorative geometry may tint/scale it,
// but black bars and masks are not allowed to cover the picture.
forbidText(viewport, 'module-video-void-mask', 'Viewport black-mask overlay');
forbidText(viewport, 'module-video-fx-a', 'Viewport sliced overlay A');
forbidText(viewport, 'module-video-fx-b', 'Viewport sliced overlay B');
forbidText(viewport, 'module-video-fx-c', 'Viewport sliced overlay C');

// Decoder recovery must handle stalls/no-frame states, not only a formal error event.
requireText(viewport, 'preload="auto"', 'Viewport eager media preload');
requireText(viewport, "video.addEventListener('stalled', scheduleRecovery)", 'Viewport stalled recovery');
requireText(viewport, "video.addEventListener('waiting', scheduleRecovery)", 'Viewport waiting recovery');
requireText(viewport, 'video.videoWidth === 0', 'Viewport no-frame recovery');
requireText(viewport, 'setUsingFallback(true)', 'Viewport fallback switch');
requireText(viewport, 'const videoUrl = key ? assetUrl(VIDEO_FILES[key]) : null', 'Viewport reliable primary loop');
requireText(viewport, 'const fallbackVideoUrl = key ? assetUrl(PING_PONG_FILES[key]) : null', 'Viewport ping-pong fallback');
requireText(viewport, 'visibilitychange', 'Viewport resume-after-background recovery');

for (const name of ['ember', 'drift', 'drift-alt', 'halo', 'artifact', 'atmos', 'grain']) {
  for (const suffix of ['', '-pingpong']) {
    const file = `public/visuals/${name}${suffix}.mp4`;
    if (!existsSync(resolve(root, file))) failures.push(`Missing visual asset: ${file}`);
  }
}

if (failures.length) {
  console.error('\nCALCOTONE visual audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log('CALCOTONE visual audit passed.');
