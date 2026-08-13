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
  const moduleMatch = source.match(new RegExp(`id:\\s*['"]${escaped}['"][\\s\\S]*?parameters:\\s*\\[([\\s\\S]*?)\\]\\s*,?\\r?\\n\\s*}`));
  if (!moduleMatch) {
    failures.push(`Could not parse UI parameters for ${moduleId}`);
    return [];
  }
  return [...moduleMatch[1].matchAll(/id:\s*['"]([^'"]+)['"]/g)].map((item) => item[1]);
}

const app = read('src/App.tsx');
const audioEngine = read('src/audio/AudioEngine.ts');
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
const driftClassicStage = read('src/audio/models/DriftClassicStage.ts');
const tubeProcessor = read('public/ember-tube-processor.js');
const magneticProcessor = read('public/magnetic-core-processor.js');
const behaviorProcessor = read('public/behavior-memory-processor.js');
const driftClassicProcessor = read('public/drift-classic-processor.js');
const grainProcessor = read('public/grain-processor.js');
const emberDigitalCaptureProcessor = read('public/ember-digital-capture-processor.js');
const dreamProcessor = read('public/dream-buffer-processor.js');

for (const file of [
  'public/grain-processor.js',
  'public/ember-digital-capture-processor.js',
  'public/dream-buffer-processor.js',
  'public/ember-tube-processor.js',
  'public/magnetic-core-processor.js',
  'public/behavior-memory-processor.js',
  'public/drift-classic-processor.js',
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
requireText(dreamProcessor, 'this.silentFrames >= this.maxRecallSamples + frames', 'Dream idle tail flush');

// All modules OFF must be a truly raw audible route: no master DC filter, waveshaper,
// limiter, or Dream return is allowed to sit between AudioGraph and the output.
requireText(audioEngine, 'private hasActiveProcessing(): boolean', 'Raw master active-state detector');
requireText(audioEngine, 'if (!this.hasActiveProcessing())', 'Raw master all-off branch');
requireText(audioEngine, 'this.graph.output.connect(this.analyser)', 'Raw master direct graph route');
requireText(audioEngine, 'this.analyser.connect(this.outputGain)', 'Raw master analyser/output route');
requireText(audioEngine, 'this.graph.output.connect(this.dcBlock)', 'Processed master safety route');
requireText(audioEngine, 'this.dreamBuffer.connectReturn(this.dcBlock)', 'Dream return stays on processed path');
requireText(audioEngine, 'this.connectMasterChain();', 'Master topology refresh hook');
requireText(audioEngine, 'diagnosticSignal?: boolean', 'Development DSP diagnostic input');
requireText(audioEngine, 'import.meta.env.DEV && options.diagnosticSignal === true', 'Development-only DSP diagnostic guard');
requireText(audioEngine, 'this.disposeDiagnosticInput()', 'DSP diagnostic input cleanup');
requireText(app, "has('diagnostic-audio')", 'DSP diagnostic query switch');

requireText(factory, 'attachPhysicalBehavior(effect)', 'EffectFactory physical registry attachment');
requireText(registry, 'effect.getNormalizedParameterValue(id)', 'Physical registry allocation-free reads');
requireText(registry, "if (parameterId !== 'mix') syncPhysicalBehavior(effect)", 'Physical registry mix bypass');
requireText(randomBatch, 'syncPhysicalBehavior(effect)', 'RANDOM physical registry sync');
requireText(randomBridge, 'beginViewportPerformanceHold()', 'RANDOM viewport hold');
requireText(randomBridge, 'engine.setEffectBypassed(entry.id, entry.bypassed)', 'RANDOM transactional restore');
requireText(randomBridge, '.finally(() => {', 'RANDOM transactional cleanup');
requireText(randomBridge, 'import.meta.hot.dispose', 'RANDOM HMR cleanup');
requireText(randomBridge, "document.removeEventListener('click', onRandomizerClick, true)", 'RANDOM HMR listener cleanup');

requireText(tubeStage, 'ember-tube-processor.js?v=', 'Tube worklet loader');
requireText(magneticStage, 'magnetic-core-processor.js?v=', 'Magnetic worklet loader');
requireText(behaviorStage, 'behavior-memory-processor.js?v=', 'Behavior worklet loader');
requireText(driftClassicStage, 'drift-classic-processor.js?v=', 'Drift classic worklet loader');
for (const [source, label] of [
  [tubeStage, 'Tube worklet suspend/resume'],
  [magneticStage, 'Magnetic worklet suspend/resume'],
  [behaviorStage, 'Behavior worklet suspend/resume'],
  [driftClassicStage, 'Drift classic worklet suspend/resume'],
]) {
  requireText(source, "postMessage({ type: 'reset' })", label);
  requireText(source, 'this.processor.connect(this.processedGain)', label);
  requireText(source, 'this.processor.disconnect(this.processedGain)', label);
}
for (const [source, label] of [
  [tubeProcessor, 'Tube processor reset handler'],
  [magneticProcessor, 'Magnetic processor reset handler'],
  [behaviorProcessor, 'Behavior processor reset handler'],
  [driftClassicProcessor, 'Drift classic processor reset handler'],
]) {
  requireText(source, "event.data?.type === 'reset'", label);
  requireText(source, 'resetState()', label);
}

for (const [needle, label] of [
  ['thermal: 0', 'Behavior thermal memory'],
  ['rail: 1', 'Behavior rail recovery'],
  ['absorption: 0', 'Behavior dielectric/acoustic absorption'],
  ['slew: 0', 'Behavior slew memory'],
  ['fatigue: 0', 'Behavior long-term stress memory'],
  ['s.absorption +=', 'Behavior absorption dynamics'],
  ['s.thermal +=', 'Behavior thermal dynamics'],
  ['s.rail +=', 'Behavior rail dynamics'],
]) requireText(behaviorProcessor, needle, label);

for (const [needle, label] of [
  ['this.dcFluxL = 0', 'Magnetic DC flux memory'],
  ['this.saturationMemoryL = 0', 'Magnetic saturation history'],
  ['const permeability =', 'Magnetic thermal permeability'],
  ['const minorLoop =', 'Magnetic minor-loop behavior'],
  ['const dynamicCoercivity =', 'Magnetic dynamic coercivity'],
]) requireText(magneticProcessor, needle, label);
requireText(registry, "case 'transformer': behavior = BYPASS", 'No double transformer simulation');
requireText(registry, "case 'goldlion': case 'mullard': case 'telefunken': case 'bugleboy': case 'rcablack':", 'No double tube simulation');

requireText(registry, "const spread = value(effect, 'spread'", 'Drift physical spread mapping');
requireText(registry, "const time = value(effect, 'time'", 'Halo stored-energy time mapping');
requireText(registry, 'const storedEnergy = Math.min(1, feedback', 'Halo feedback/time memory coupling');
requireText(registry, 'const ageMemory = Math.min(1, wear', 'Artifact wear/noise aging coupling');

requireText(driftEffect, 'private readonly feedbacks: GainNode[]', 'Drift flange feedback network');
requireText(driftEffect, 'feedback.connect(delay)', 'Drift delayed feedback loop');
requireText(driftEffect, "mode === 'mxrflanger'", 'MXR Flanger mode');
requireText(driftEffect, "mode === 'electricmistress'", 'Electric Mistress mode');
requireText(driftEffect, "mode === 'adaflanger'", 'A/DA Flanger mode');
requireText(driftEffect, "mode === 'bf2'", 'Boss BF-2 mode');
requireText(registry, "case 'mxrflanger': behavior = spec('charge'", 'MXR physical charge memory');

for (const [needle, label] of [
  ["| 'biphase'", 'Bi-Phase mode'],
  ["| 'smallstone'", 'Small Stone mode'],
  ["| 'univibe'", 'Uni-Vibe mode'],
  ["| 'leslie'", 'Leslie mode'],
  ["| 'phase90'", 'MXR Phase 90 mode'],
  ["| 'instantphaser'", 'Eventide PS101 mode'],
  ["| 'schulte'", 'Schulte Compact A mode'],
  ["| 'pn2'", 'BOSS PN-2 mode'],
  ['private readonly classicStage: DriftClassicStage', 'Drift classic branch'],
  ["this.classicStage.configure(classic", 'Drift classic parameter routing'],
]) requireText(driftEffect, needle, label);
requireText(driftClassicProcessor, 'processBiPhase', 'Bi-Phase dual-bank all-pass engine');
requireText(driftClassicProcessor, 'this.cascadeWithCoefficients(inputL, 6', 'Bi-Phase six-stage bank');
requireText(driftClassicProcessor, 'processSmallStone', 'Small Stone phase engine');
requireText(driftClassicProcessor, 'this.cascadeWithCoefficients(xL, 4', 'Small Stone four-stage network');
requireText(driftClassicProcessor, 'processUniVibe', 'Uni-Vibe photo-optical engine');
requireText(driftClassicProcessor, 'const rise =', 'Uni-Vibe asymmetric lamp response');
requireText(driftClassicProcessor, 'processLeslie', 'Leslie rotor engine');
requireText(driftClassicProcessor, 'this.rotorHornSpeed +=', 'Leslie horn motor inertia');
requireText(driftClassicProcessor, 'this.rotorDrumSpeed +=', 'Leslie drum motor inertia');
requireText(driftClassicProcessor, 'processPhase90', 'Phase 90 four-stage FET engine');
requireText(driftClassicProcessor, 'this.cascadeWithCoefficients(inputL, 4', 'Phase 90 four-stage network');
requireText(driftClassicProcessor, 'processInstantPhaser', 'PS101 Main/Aux phase engine');
requireText(driftClassicProcessor, 'stage === 5', 'PS101 six/eight-stage output tap');
requireText(driftClassicProcessor, 'processSchulte', 'Schulte optical phase engine');
requireText(driftClassicProcessor, 'this.schulteFeedbackL +=', 'Schulte filtered feedback memory');
requireText(driftClassicProcessor, 'processPn2', 'PN-2 stereo pan engine');
requireText(driftClassicProcessor, 'Math.cos(angle) * Math.SQRT2', 'PN-2 equal-power pan law');
requireText(registry, "case 'biphase': case 'smallstone': case 'univibe': case 'leslie':", 'No double legacy Drift hardware simulation');
requireText(registry, "case 'phase90': case 'instantphaser': case 'schulte': case 'pn2':", 'No double new Drift hardware simulation');

requireText(grainProcessor, 'this.voices = Array.from({ length: 8 }', 'Grain bounded live-memory voice pool');
requireText(grainProcessor, 'this.processSlice(window, density, pitch, motion, memory)', 'Grain slice mechanism');
requireText(grainProcessor, 'this.processFreeze(window, density, pitch, motion, memory, transient)', 'Grain freeze mechanism');
requireText(grainProcessor, 'applyHardwareCharacter(', 'Grain hardware model stage');
for (const model of ['Clouds study','Beads study','Morphagene study','Arbhar study','Particle 2 study']) {
  requireText(grainProcessor, model, `Grain ${model}`);
}
requireText(grainProcessor, 'MICROCOSM_VARIATION_PATTERNS', 'Grain Microcosm 44-configuration engine');
forbidText(grainProcessor, 'processHardware(', 'Grain sampler hardware path');
forbidText(grainProcessor, 'quantizeNonlinear12', 'Grain converter quantization');
requireText(emberDigitalCaptureProcessor, 'quantizeNonlinear12', 'Ember MPC60 nonlinear converter study');
requireText(emberDigitalCaptureProcessor, 'targetRate = 7500 + clock * 40500', 'Ember S950 variable record clock');
requireText(emberDigitalCaptureProcessor, 'targetRate = 27000', 'Ember Emulator II 27k study');
requireText(emberDigitalCaptureProcessor, 'targetRate = 24000 + clock * 8000', 'Ember Fairlight IIx sample-clock study');
requireText(emberDigitalCaptureProcessor, 'quantizeCompanded8', 'Ember vintage 8-bit companding study');
requireText(registry, "case 'clouds': case 'beads': case 'morphagene': case 'arbhar': case 'particle2': case 'microcosm':", 'No double Grain hardware simulation');
requireText(registry, "case 'sp1200': case 'mpc60': case 'mirage': case 's950': case 'emulator2': case 'fairlightiix':", 'No double sampler converter simulation');
requireText(registry, "case 'tascam424': case 'Neve 1073': case 'SSL 4000E': case 'API 1608':", 'No double Artifact console simulation');

requireText(grainEffect, 'stats.cpuLoad = Number.NaN', 'Grain fake timing guard');
requireText(visualEngine, 'if (!running || !analyser)', 'Idle visual sleep');
requireText(visualEngine, 'const reactInterval = 1000 / 15', 'React visual cadence cap');
requireText(recorder, 'this.disconnectNodes();', 'Recorder processor-error cleanup');
requireText(app, 'auditUiAgainstEngine(engine, modules)', 'Runtime UI/DSP control self-check');

const controlContracts = [
  ['saturation', emberEffect, ['drive','tone','heat','character','dynamics','mix']],
  ['chorus', driftEffect, ['rate','depth','shape','spread','motion','mix']],
  ['delay', haloEffect, ['time','feedback','color','character','width','mix']],
  ['reverb', atmosEffect, ['decay','size','color','diffusion','motion','mix']],
  ['bitcrusher', grainEffect, ['bits','density','pitch','chaos','bloom','mix']],
  ['media', mediaEffect, ['wear','wow','noise','tone','mix']],
];
forbidText(app, "{ id: 'console', label: 'Console'", 'Artifact ghost console control');
forbidText(app, "{ id: 'tube', label: 'Tube'", 'Artifact ghost tube control');
forbidText(app, "{ id: 'chainOrder', label: 'Order'", 'Artifact ghost chain-order control');
forbidText(app, 'isArtifactMatrixParameter', 'Artifact ghost parameter plumbing');

for (const [moduleId, source, expected] of controlContracts) {
  const uiParameters = extractUiParameters(app, moduleId);
  if (uiParameters.join('|') !== expected.join('|')) failures.push(`${moduleId}: UI control contract changed (${uiParameters.join(', ')})`);
  for (const parameterId of expected) {
    if (!source.includes(`id: '${parameterId}'`) && !source.includes(`id:'${parameterId}'`)) failures.push(`${moduleId}.${parameterId}: visible knob has no effect parameter definition`);
  }
}

forbidText(driftEffect, "this.mode === 'ce1' && (id === 'rate'", 'Drift CE-1 dead controls');
forbidText(driftEffect, "this.mode === 'dimensiond' && id !== 'shape'", 'Drift Dimension-D dead controls');
forbidText(driftEffect, "this.mode === 'orbit' && id === 'spread'", 'Drift Orbit dead spread');
requireText(driftEffect, 'const rateTrim = Math.pow', 'Drift hardware rate trims');
requireText(driftEffect, 'const panWidth = Math.min', 'Drift hardware spread trims');
requireText(driftEffect, 'const orbitWidth = Math.min', 'Drift Orbit spread control');

requireText(mediaEffect, 'const MAX_CURVE_CACHE = 384', 'Artifact bounded curve cache');
requireText(mediaEffect, 'function cacheCurve(', 'Artifact curve cache');
requireText(mediaEffect, "this.mode === 'tascam424'", 'Artifact TASCAM console path');
requireText(mediaEffect, 'summingBusOperatingPoint(this.mode', 'Artifact calibrated console summing paths');
forbidText(mediaEffect, 'AudioWorkletNode', 'Artifact digital-capture worklet');
requireText(mediaEffect, 'this.setSaturatorCurve(getSaturationCurve', 'Artifact cached media saturation');
requireText(mediaEffect, 'if (this.parameterValues.get(parameterId) === next) return', 'Artifact duplicate-value guards');
forbidText(mediaEffect, 'this.preampStage.curve = makeOpAmpCurve', 'Artifact stale live curve allocation');
forbidText(mediaEffect, 'this.saturator.curve = makeSaturationCurve', 'Artifact stale live curve allocation');
requireText(emberEffect, "'calcotone-ember-digital-capture-processor'", 'Ember digital-capture worklet');
requireText(emberEffect, "this.setDigitalCaptureParameter('mode', digitalCaptureMode, now, true)", 'Ember digital-capture routing');

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
