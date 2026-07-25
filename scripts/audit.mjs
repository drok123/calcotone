import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const failures = [];

function pathOf(relative) { return resolve(root, relative); }
function read(relative) {
  const path = pathOf(relative);
  if (!existsSync(path)) {
    failures.push(`Missing required file: ${relative}`);
    return '';
  }
  return readFileSync(path, 'utf8');
}
function requireText(source, needle, label) {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
}
function forbidText(source, needle, label) {
  if (source.includes(needle)) failures.push(`${label}: forbidden stale structure ${JSON.stringify(needle)}`);
}
function extractOrder(source, exportName) {
  const escaped = exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`export\\s+const\\s+${escaped}[^=]*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!match) {
    failures.push(`Could not parse ${exportName}`);
    return [];
  }
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1]);
}
function extractUiParameters(source, moduleId) {
  const escaped = moduleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const moduleMatch = source.match(new RegExp(`id:\\s*['"]${escaped}['"][\\s\\S]*?parameters:\\s*\\[([\\s\\S]*?)\\]\\s*,?\\n\\s*}`));
  if (!moduleMatch) {
    failures.push(`Could not parse UI parameters for ${moduleId}`);
    return [];
  }
  return [...moduleMatch[1].matchAll(/id:\s*['"]([^'"]+)['"]/g)].map((item) => item[1]);
}

const app = read('src/App.tsx');
const effect = read('src/audio/effects/Effect.ts');
const graph = read('src/audio/AudioGraph.ts');
const dreamBuffer = read('src/audio/DreamBuffer.ts');
const registry = read('src/audio/PhysicalBehaviorRegistry.ts');
const factory = read('src/audio/EffectFactory.ts');
const randomBatch = read('src/perf/randomBatch.ts');
const randomBridge = read('src/randomTransferBridge.ts');
const viewport = read('src/components/effects/ModuleViewport.tsx');
const visualEngine = read('src/visual/VisualEngine.ts');
const recorder = read('src/audio/WavRecorder.ts');
const emberEffect = read('src/audio/effects/Saturation.ts');
const driftEffect = read('src/audio/effects/Chorus.ts');
const haloEffect = read('src/audio/effects/Delay.ts');
const atmosEffect = read('src/audio/effects/Reverb.ts');
const grainEffect = read('src/audio/effects/Bitcrusher.ts');
const mediaEffect = read('src/audio/effects/Media.ts');
const tubeStage = read('src/audio/models/TubeColorStage.ts');
const magneticStage = read('src/audio/models/MagneticCoreStage.ts');
const behaviorStage = read('src/audio/models/BehaviorMemoryStage.ts');
const tubeProcessor = read('public/ember-tube-processor.js');
const magneticProcessor = read('public/magnetic-core-processor.js');
const behaviorProcessor = read('public/behavior-memory-processor.js');
const dreamProcessor = read('public/dream-buffer-processor.js');

for (const file of [
  'public/grain-processor.js',
  'public/dream-buffer-processor.js',
  'public/ember-tube-processor.js',
  'public/magnetic-core-processor.js',
  'public/behavior-memory-processor.js',
]) read(file);

requireText(effect, 'this.wetGain.connect(this.behaviorStage.input)', 'BaseEffect physical chassis');
requireText(effect, 'this.behaviorStage.dispose()', 'BaseEffect physical chassis');
requireText(effect, 'isProcessingSuspended()', 'Effect bypass suspension');
requireText(effect, 'this.processingSuspended = true', 'Effect bypass suspension');
requireText(effect, 'this.routingInvalidator?.()', 'Effect bypass routing refresh');
requireText(effect, 'getNormalizedParameterValue(parameterId: string)', 'Allocation-free parameter read');
requireText(graph, '!effect.isProcessingSuspended()', 'AudioGraph suspended-effect filter');
requireText(graph, 'private serialEdges', 'AudioGraph serial-edge ownership');
requireText(dreamBuffer, 'this.disconnectSourceFeed(id)', 'Dream source suspension');
requireText(dreamBuffer, 'this.disconnectRouteFeed(route)', 'Dream route suspension');
requireText(dreamProcessor, 'this.silentFrames >= this.maxHeadOffset', 'Dream idle tail flush');

requireText(factory, 'attachPhysicalBehavior(effect)', 'EffectFactory physical registry attachment');
requireText(registry, 'effect.getNormalizedParameterValue(id)', 'Physical registry allocation-free reads');
requireText(registry, "if (parameterId !== 'mix') syncPhysicalBehavior(effect)", 'Physical registry mix bypass');
requireText(randomBatch, 'syncPhysicalBehavior(effect)', 'RANDOM physical registry sync');
requireText(randomBridge, 'beginViewportPerformanceHold()', 'RANDOM viewport hold');
requireText(randomBridge, 'engine.setEffectBypassed(entry.id, entry.bypassed)', 'RANDOM transactional restore');
requireText(randomBridge, '.finally(() => {', 'RANDOM transactional cleanup');
requireText(randomBridge, 'import.meta.hot.dispose', 'RANDOM HMR cleanup');
requireText(randomBridge, "document.removeEventListener('click', onRandomizerClick, true)", 'RANDOM HMR listener cleanup');

requireText(tubeStage, "ember-tube-processor.js?v=", 'Tube worklet loader');
requireText(magneticStage, "magnetic-core-processor.js?v=", 'Magnetic worklet loader');
requireText(behaviorStage, "behavior-memory-processor.js?v=", 'Behavior worklet loader');
for (const [source, label] of [
  [tubeStage, 'Tube worklet suspend/resume'],
  [magneticStage, 'Magnetic worklet suspend/resume'],
  [behaviorStage, 'Behavior worklet suspend/resume'],
]) {
  requireText(source, "postMessage({ type: 'reset' })", label);
  requireText(source, 'this.processor.connect(this.processedGain)', label);
  requireText(source, 'this.processor.disconnect(this.processedGain)', label);
}
for (const [source, label] of [
  [tubeProcessor, 'Tube processor reset handler'],
  [magneticProcessor, 'Magnetic processor reset handler'],
  [behaviorProcessor, 'Behavior processor reset handler'],
]) {
  requireText(source, "event.data?.type === 'reset'", label);
  requireText(source, 'resetState()', label);
}

requireText(grainEffect, 'stats.cpuLoad = Number.NaN', 'Grain fake timing guard');
requireText(visualEngine, 'if (!running || !analyser)', 'Idle visual sleep');
requireText(visualEngine, 'const reactInterval = 1000 / 20', 'React visual cadence cap');
requireText(recorder, 'this.disconnectNodes();', 'Recorder processor-error cleanup');
requireText(app, 'auditUiAgainstEngine(engine, modules)', 'Runtime UI/DSP control self-check');

// Every visible front-panel knob must correspond to a real effect parameter definition.
const controlContracts = [
  ['saturation', emberEffect, ['drive','tone','heat','character','dynamics','mix']],
  ['chorus', driftEffect, ['rate','depth','shape','spread','motion','mix']],
  ['delay', haloEffect, ['time','feedback','color','character','width','mix']],
  ['reverb', atmosEffect, ['decay','size','color','diffusion','motion','mix']],
  ['bitcrusher', grainEffect, ['bits','density','pitch','chaos','bloom','mix']],
  ['media', mediaEffect, ['wear','wow','noise','tone','mix']],
];
for (const [moduleId, source, expected] of controlContracts) {
  const uiParameters = extractUiParameters(app, moduleId);
  if (uiParameters.join('|') !== expected.join('|')) {
    failures.push(`${moduleId}: UI control contract changed (${uiParameters.join(', ')})`);
  }
  for (const parameterId of expected) {
    if (!source.includes(`id: '${parameterId}'`) && !source.includes(`id:'${parameterId}'`)) {
      failures.push(`${moduleId}.${parameterId}: visible knob has no effect parameter definition`);
    }
  }
}

// Artifact's nonlinear stages must stay bounded/cached; live XY should not allocate a new
// 2K-4K waveshaper curve for every pointer event.
requireText(mediaEffect, 'const MAX_CURVE_CACHE = 384', 'Artifact bounded curve cache');
requireText(mediaEffect, 'function cacheCurve(', 'Artifact curve cache');
requireText(mediaEffect, 'this.setPreampCurve(getOpAmpCurve', 'Artifact cached op-amp stage');
requireText(mediaEffect, 'this.setSaturatorCurve(getSaturationCurve', 'Artifact cached media saturation');
requireText(mediaEffect, 'if (this.parameterValues.get(parameterId) === next) return', 'Artifact duplicate-value guards');
forbidText(mediaEffect, 'this.preampStage.curve = makeOpAmpCurve', 'Artifact stale live curve allocation');
forbidText(mediaEffect, 'this.saturator.curve = makeSaturationCurve', 'Artifact stale live curve allocation');

forbidText(randomBridge, 'randomProfiler', 'RANDOM bridge');
forbidText(randomBatch, '__calcotoneRandomProfiler', 'RANDOM batch');
if (existsSync(pathOf('src/perf/randomProfiler.ts'))) failures.push('Removed random profiler file has returned');

const videoTags = (viewport.match(/<video\b/g) ?? []).length;
if (videoTags > 1) failures.push(`ModuleViewport has ${videoTags} <video> elements; expected at most one decoder`);

const modeSources = [
  ['src/audio/effects/Saturation.ts', 'EMBER_MODE_ORDER'],
  ['src/audio/effects/Chorus.ts', 'DRIFT_MODE_ORDER'],
  ['src/audio/effects/Delay.ts', 'DELAY_ALGORITHM_ORDER'],
  ['src/audio/effects/Reverb.ts', 'REVERB_ALGORITHM_ORDER'],
  ['src/audio/effects/Bitcrusher.ts', 'GRAIN_MODE_ORDER'],
  ['src/audio/effects/Media.ts', 'MEDIA_MODE_ORDER'],
];
for (const [file, exportName] of modeSources) {
  const source = read(file);
  const modes = extractOrder(source, exportName);
  for (const mode of modes) {
    if (!registry.includes(`case '${mode}'`)) failures.push(`PhysicalBehaviorRegistry missing ${exportName} mode: ${mode}`);
  }
}

if (failures.length) {
  console.error('\nCALCOTONE structural audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log('CALCOTONE structural audit passed.');
