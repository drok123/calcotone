import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (relative) => {
  const path = resolve(root, relative);
  if (!existsSync(path)) { failures.push(`Missing required file: ${relative}`); return ''; }
  return readFileSync(path, 'utf8');
};
const requireText = (source, needle, label) => { if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`); };
const forbidText = (source, needle, label) => { if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`); };

const viewport = read('src/components/effects/ModuleViewport.tsx');
const temporal = read('src/components/video/TemporalVideo.tsx');
const temporalCss = read('src/components/video/TemporalVideo.css');
const main = read('src/main.tsx');
const signalArt = read('src/components/motion/SignalFieldArt.ts');
const xyField = read('src/components/motion/XYSignalField.tsx');
const motionPad = read('src/components/motion/MotionPad.tsx');
const signalTransform = read('build/signalLabUiTransform.ts');

const videoTags = (temporal.match(/<video\b/g) ?? []).length;
if (videoTags !== 1) failures.push(`TemporalVideo must own exactly one decoder template; found ${videoTags}`);
forbidText(viewport, 'module-video-void-mask', 'Viewport black-mask overlay');
forbidText(viewport, 'module-video-fx-a', 'Viewport sliced overlay A');
forbidText(viewport, 'module-video-fx-b', 'Viewport sliced overlay B');
forbidText(viewport, 'module-video-fx-c', 'Viewport sliced overlay C');
forbidText(viewport, 'PING_PONG_FILES', 'Dead ping-pong asset dependency');
requireText(viewport, '<TemporalVideo', 'Viewport temporal smoothing renderer');
requireText(temporal, 'preload={preload}', 'Viewport eager media preload support');
requireText(viewport, "video.addEventListener('stalled', scheduleRecovery)", 'Viewport stalled recovery');
requireText(viewport, "video.addEventListener('waiting', scheduleRecovery)", 'Viewport waiting recovery');
requireText(viewport, "video.addEventListener('error', reload)", 'Viewport media-error recovery');
requireText(viewport, 'video.videoWidth === 0', 'Viewport no-frame recovery');
requireText(viewport, 'video.load()', 'Viewport decoder reload');
requireText(viewport, 'const videoUrl = key ? assetUrl(VIDEO_FILES[key]) : null', 'Viewport direct known-good source');
requireText(viewport, 'visibilitychange', 'Viewport resume-after-background recovery');
requireText(viewport, 'const MODULE_PLAYBACK_RATE = 0.40', 'Viewport glacial module playback');
requireText(viewport, 'video.playbackRate = MODULE_PLAYBACK_RATE', 'Viewport playback-rate enforcement');
requireText(temporal, 'requestVideoFrameCallback', 'Frame-synchronized temporal capture');
requireText(temporal, 'easeFrameBlend', 'Temporal frame interpolation');
requireText(temporal, "output.globalCompositeOperation = 'copy'", 'Opaque temporal base frame');
requireText(temporal, 'output.globalAlpha = blend', 'Current-frame temporal blend');
requireText(temporal, 'SEEK_DISCONTINUITY_SECONDS', 'Loop and seek discontinuity guard');
requireText(temporal, 'presentCurrentImmediately()', 'Discontinuity snap without crossfade');
forbidText(temporal, 'output.clearRect(', 'Visible temporal canvas clearing');
requireText(temporalCss, '.temporal-video-source', 'Decoder fallback styling');
requireText(temporalCss, "opacity: 1 !important", 'Visible decoder fallback frame');
requireText(temporalCss, ".temporal-video-canvas[data-ready='true']", 'Temporal canvas readiness gate');
forbidText(main, "import './videoStabilityPatch'", 'Removed video repair monkey patch');
requireText(viewport, "return (module.driftMode ?? 'chorus') === 'rotary' ? 'drift-alt' : 'drift';", 'Native Drift stable video selection');
forbidText(viewport, "['liquid', 'orbit', 'doppler', 'rotary'].includes(mode) ? 'drift-alt' : 'drift'", 'Old unstable Drift video mapping');

// SIGNAL art must inherit the Dream landscape rather than behave like an unrelated overlay.
requireText(signalArt, 'scenePalette(modules', 'Signal art derives landscape palette');
requireText(signalArt, 'landscapeVocabulary(modules', 'Signal art derives landscape vocabulary');
requireText(signalArt, "'architectural' | 'mechanical' | 'fluid' | 'organic'", 'Signal art vocabulary families');
requireText(signalArt, "case 'octaver'", 'Signal Octave composition');
requireText(signalArt, "case 'ringmod'", 'Signal Ring Mod composition');
requireText(signalArt, "case 'tremolo'", 'Signal Tremolo composition');
requireText(signalArt, "case 'autopan'", 'Signal Auto Pan composition');
requireText(signalArt, "case 'wavefolder'", 'Signal Wavefolder composition');
requireText(signalArt, "ctx.globalCompositeOperation = 'screen'", 'Signal art integrated luminosity');
forbidText(signalArt, "strokeStyle = 'black'", 'Signal black-line overlay');
forbidText(signalArt, 'Math.random()', 'Signal per-frame random spaghetti');
requireText(xyField, 'if (signal?.enabled) drawSignalFieldArt', 'Signal artwork only while enabled');
requireText(motionPad, 'signalLab={signalLab}', 'MotionPad forwards Signal visual state');
requireText(signalTransform, 'signalLab={signalLabState}', 'App forwards Signal state to XY');

for (const name of ['ember', 'drift', 'drift-alt', 'halo', 'artifact', 'atmos', 'grain']) {
  const file = `public/visuals/${name}.mp4`;
  if (!existsSync(resolve(root, file))) failures.push(`Missing visual asset: ${file}`);
}
if (failures.length) {
  console.error('\nCALCOTONE visual audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error(''); process.exit(1);
}
console.log('CALCOTONE visual audit passed.');
