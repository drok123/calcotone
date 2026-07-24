import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const problems = [];

const file = (path) => readFileSync(join(root, path), 'utf8');
const problem = (message) => problems.push(message);
const expect = (condition, message) => {
  if (!condition) problem(message);
};

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function appearsInOrder(source, tokens) {
  let cursor = 0;
  for (const token of tokens) {
    const index = source.indexOf(token, cursor);
    if (index < 0) return false;
    cursor = index + token.length;
  }
  return true;
}

for (const directory of ['src', 'public']) {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) continue;
  for (const path of walk(absolute)) {
    if (statSync(path).size === 0) {
      problem(`zero-byte file: ${relative(root, path)}`);
    }
  }
}

for (const worklet of [
  'grain-processor.js',
  'dream-buffer-processor.js',
  'recorder-processor.js',
  'lexicon-224-converter.js',
]) {
  const path = join(root, 'public', worklet);
  if (!existsSync(path)) {
    problem(`missing AudioWorklet: public/${worklet}`);
    continue;
  }
  try {
    execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
  } catch {
    problem(`invalid AudioWorklet syntax: public/${worklet}`);
  }
  const source = readFileSync(path, 'utf8');
  if (source.includes('performance.now()')) {
    problem(`AudioWorklet assumes performance.now(): public/${worklet}`);
  }
}

const engine = file('src/audio/AudioEngine.ts');
const inputMatrix = file('src/audio/InputMatrix.ts');
const baseEffect = file('src/audio/effects/Effect.ts');
const preset = file('src/audio/Preset.ts');
const graph = file('src/audio/AudioGraph.ts');
const faceplate = file('src/ui/faceplateLayout.ts');
const viewport = file('src/components/effects/ModuleViewport.tsx');
const viewportRoom = file('src/components/effects/viewportRoom.ts');
const viewportCss = file('src/components/effects/ViewportOptics.css');
const moduleViewportCss = file('src/components/effects/ModuleViewport.css');
const visualEngine = file('src/visual/VisualEngine.ts');
const entrypoint = file('src/main.tsx');
const html = file('index.html');
const readme = file('README.md');
const packageJson = JSON.parse(file('package.json'));

expect(packageJson.name === 'calcotone', 'package name regressed to the Vite starter');
expect(packageJson.scripts?.audit === 'node scripts/audit.mjs', 'npm run audit is missing');
expect(typeof packageJson.scripts?.check === 'string', 'npm run check is missing');
expect(/<title>CALCOTONE<\/title>/.test(html), 'browser title is not CALCOTONE');
expect(readme.startsWith('# CALCOTONE'), 'README is still template content');

expect(!/enabled:\s*true/.test(preset), 'default preset powers an effect on at boot');
expect(graph.includes('effect.output.disconnect(destination)'), 'routing reorder may disconnect side paths');
expect(engine.includes('reorderEffectsClickSafe'), 'click-safe routing helper is missing');

expect(
  appearsInOrder(engine, [
    'this.graph.output.connect(this.dcBlock);',
    'this.dcBlock.connect(this.outputGain);',
    'this.outputGain.connect(this.safetyClipper);',
    'this.safetyClipper.connect(this.limiter);',
    'this.limiter.connect(this.analyser);',
  ]),
  'protected master chain changed: rack -> DC -> output gain -> clipper -> limiter -> analyser is required',
);
expect(
  engine.includes('this.analyser.connect(this.context.destination);'),
  'protected analyser output is no longer connected to the speakers',
);
expect(
  engine.includes('new WavRecorder(this.context, this.analyser)'),
  'recorder is no longer tapped from protected post-limiter output',
);
expect(
  /const gain = Math\.min\(1\.2, Math\.max\(0, safeValue\)\)/.test(engine),
  'master Output Gain range is no longer bounded to 0..1.2',
);

const sumMono = inputMatrix.match(/case 'sum-mono':[\s\S]*?break;/)?.[0] ?? '';
expect(
  (sumMono.match(/= 0\.5;/g) ?? []).length === 4,
  'sum-mono is not peak-normalized as 0.5L + 0.5R to both outputs',
);
expect(
  inputMatrix.includes('Number.isFinite(value) ? value : 1'),
  'input width no longer sanitizes non-finite values',
);

expect(
  appearsInOrder(baseEffect, [
    'this.wetGain.connect(this.wetDcBlock);',
    'this.wetDcBlock.connect(this.wetLimiter);',
    'this.wetLimiter.connect(this.processedBus);',
  ]),
  'shared wet-path safety order changed',
);
expect(
  baseEffect.includes('this.wetLimiter.threshold.value = -3;'),
  'shared wet limiter has drifted away from near-ceiling guard behavior',
);
expect(
  !baseEffect.includes('this.wetLimiter.threshold.value = -8;'),
  'old always-active -8 dB wet compressor returned',
);

expect(faceplate.includes('viewportHeight: 264'), 'approved faceplate viewport height changed');
expect(faceplate.includes('stageHeight: 526'), 'approved faceplate stage height changed');
expect((faceplate.match(/y: 348/g) ?? []).length >= 3, 'approved first knob row changed');
expect((faceplate.match(/y: 452/g) ?? []).length >= 3, 'approved second knob row changed');
expect(faceplate.includes('snap: 8'), 'approved faceplate snap changed');
expect(
  moduleViewportCss.includes('.faceplate-layout-custom .faceplate-viewport-shell'),
  'faceplate viewport sizing drifted out of ModuleViewport ownership',
);

expect(viewport.includes('drawViewportRoomBack'), 'module art lost the shared 3D room back pass');
expect(viewport.includes('drawViewportRoomFront'), 'module art lost the shared 3D room front pass');
expect(viewport.includes('getViewportSculptureTransform'), 'module artwork is no longer staged as a room sculpture');
expect(viewport.includes('getLatestVisualAudioState'), 'module viewport no longer reads realtime canvas telemetry');
expect(viewportRoom.includes('drawPerspectivePlane'), '3D room perspective renderer is missing');
expect(viewportRoom.includes("moduleId === 'saturation'"), '3D room lost module-specific visual signatures');
expect(
  viewportCss.includes('animation: none !important') && viewportCss.includes('transform: none !important'),
  'CSS is moving the whole viewport canvas again; canvas renderer must own artwork motion',
);
expect(
  visualEngine.includes('const REACT_TELEMETRY_HZ = 10') &&
    visualEngine.includes('latestVisualAudioState = next'),
  'canvas telemetry is coupled back to full-rate React rendering',
);
expect(!entrypoint.includes('FaceplateResizeFix.css'), 'obsolete faceplate fix stylesheet is still imported');
expect(!entrypoint.includes('PanelContrastRefresh.css'), 'obsolete panel refresh stylesheet is still imported');
expect(!entrypoint.includes('ViewportAccentRing.css'), 'obsolete viewport ring stylesheet is still imported');
expect(entrypoint.includes('PanelTheme.css'), 'PanelTheme is not loaded');
expect(entrypoint.includes('ViewportOptics.css'), 'ViewportOptics is not loaded');

if (problems.length > 0) {
  console.error('CALCOTONE audit FAILED');
  for (const item of problems) console.error(` - ${item}`);
  process.exit(1);
}

console.log('CALCOTONE audit OK');
