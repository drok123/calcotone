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
const extractOrder = (source, constName) => {
  const match = source.match(new RegExp(`export const ${constName}[^=]*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!match) {
    failures.push(`Could not parse ${constName}`);
    return [];
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
};
const requireOrder = (source, constName, expected, label) => {
  const actual = extractOrder(source, constName);
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    failures.push(`${label}: order mismatch\n   expected ${JSON.stringify(expected)}\n   actual   ${JSON.stringify(actual)}`);
  }
  if (new Set(actual).size !== actual.length) failures.push(`${label}: duplicate dropdown entries`);
};
const requireObjectKey = (source, key, label) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:${escaped}|'${escaped}')\\s*:\\s*\\{`);
  if (!pattern.test(source)) failures.push(`${label}: missing config key ${JSON.stringify(key)}`);
};

const ember = read('src/audio/effects/Saturation.ts');
const drift = read('src/audio/effects/Chorus.ts');
const driftClassic = read('public/drift-classic-processor.js');
const halo = read('src/audio/effects/Delay.ts');
const atmos = read('src/audio/effects/Reverb.ts');
const grain = read('src/audio/effects/Bitcrusher.ts');
const grainProcessor = read('public/grain-processor.js');
const artifact = read('src/audio/effects/Media.ts');
const emberDigitalCapture = read('public/ember-digital-capture-processor.js');
const app = read('src/App.tsx');
const nativeBridge = read('src/audio/NativeAudioBridge.ts');
const railC = read('src/components/effects/RailCModules.tsx');
const loopStore = read('src/components/signal/loopStore.ts');
const railCArtwork = read('src/components/ascii/RailCHardwareDisplay.tsx');
const loopArtwork = read('src/components/ascii/LoopTrackMatrixDisplay.tsx');

const EMBER = ['velvet','tube','console','transformer','furnace','exciter','broken','goldlion','mullard','telefunken','bugleboy','rcablack','sp1200','mpc60','mirage','s950','emulator2','fairlightiix'];
const DRIFT = ['chorus','ensemble','dimension','vibrato','rotary','doppler','liquid','orbit','ce1','dimensiond','mxrflanger','electricmistress','adaflanger','bf2','biphase','smallstone','univibe','leslie','phase90','instantphaser','schulte','pn2'];
const HALO = ['clean','tape','bbd','pingpong','diffuse','scatter','constellation','re201','EP-3 Echoplex','Binson Echorec','Deluxe Memory Man','AMS DMX 15-80 S'];
const ATMOS = ['room','plate','hall','cinema','cloud','freeze','celestial','aurora','nebula','abyss','emt140','lexicon224','rmx16','quantec','springtank','bloom','veil'];
const GRAIN = ['mosaic','scatter','smear','prism','slice','freeze','clouds','beads','morphagene','arbhar','particle2','microcosm'];
const ARTIFACT = ['cassette','reel','vinyl','vhs','radio','wax','broken','archive','tascam424','Neve 1073','SSL 4000E','API 1608','Ampex ATR-102','Neve BCM10'];
const ARTIFACT_DYNAMICS = ['compressor-fet','compressor-opto','compressor-varimu','compressor-vca'];

requireOrder(ember, 'EMBER_MODE_ORDER', EMBER, 'Ember dropdown');
requireOrder(drift, 'DRIFT_MODE_ORDER', DRIFT, 'Drift dropdown');
requireOrder(halo, 'DELAY_ALGORITHM_ORDER', HALO, 'Halo dropdown');
requireOrder(atmos, 'REVERB_ALGORITHM_ORDER', ATMOS, 'Atmos dropdown');
requireOrder(grain, 'GRAIN_MODE_ORDER', GRAIN, 'Grain dropdown');
requireOrder(artifact, 'MEDIA_MODE_ORDER', ARTIFACT, 'Artifact dropdown');

// Ember: named tubes and transformer must use dedicated stages; generic modes share only the intentional shaper path.
for (const tube of ['goldlion','mullard','telefunken','bugleboy','rcablack']) requireText(ember, `${tube}: '${tube}'`, `Ember ${tube} dedicated tube mapping`);
requireText(ember, "const magnetic = this.mode === 'transformer'", 'Ember transformer ownership');
requireText(ember, "'calcotone-ember-digital-capture-processor'", 'Ember digital-capture worklet branch');
for (const mode of [0,1,2,3,4,5]) requireText(emberDigitalCapture, `mode === ${mode}`, `Ember digital-capture model ${mode}`);
requireText(emberDigitalCapture, 'quantizeNonlinear12', 'Ember MPC60 nonlinear converter');
requireText(emberDigitalCapture, 'quantizeCompanded8', 'Ember vintage 8-bit companding');
requireText(ember, 'this.setDigitalCaptureParameter(\'mode\', digitalCaptureMode, now, true)', 'Ember digital-capture model routing');
requireText(ember, 'this.setGenericBranchAttached(!(namedTube || magnetic || digitalCapture))', 'Ember inactive generic branch suspension');
forbidText(ember, 'CONSOLE_PATHS', 'Ember console path ownership');
requireText(ember, 'const MAX_CURVE_CACHE = 192', 'Ember bounded curve cache');

// Drift: standard modulation and dedicated classic hardware must remain mutually exclusive.
for (const mode of ['mxrflanger','electricmistress','adaflanger','bf2']) requireText(drift, mode, `Drift ${mode} implementation`);
for (const mode of ['biphase','smallstone','univibe','leslie','phase90','instantphaser','schulte','pn2']) requireText(drift, `mode === '${mode}'`, `Drift ${mode} classic mapping`);
requireText(drift, 'this.setStandardBranchAttached(false)', 'Drift classic standard-network suspension');
requireText(driftClassic, 'this.coefficientCountdown = 7', 'Drift classic coefficient throttling');
requireText(driftClassic, 'this.result = [0, 0]', 'Drift classic reusable result buffer');
forbidText(driftClassic, 'return [bL, bR]', 'Bi-Phase per-sample array allocation');
forbidText(driftClassic, 'return [pL, pR]', 'Small Stone per-sample array allocation');
forbidText(driftClassic, 'return [vibeL * tremL, vibeR * tremR]', 'Uni-Vibe per-sample array allocation');
for (const engine of ['processPhase90','processInstantPhaser','processSchulte','processPn2']) requireText(driftClassic, engine, `Drift ${engine} engine`);
requireText(driftClassic, 'Math.cos(angle) * Math.SQRT2', 'PN-2 equal-power pan law');

// Halo: every non-RE-201 entry owns a config; RE-201 stays a dedicated network.
for (const mode of HALO.filter((mode) => mode !== 're201')) requireObjectKey(halo, mode, `Halo ${mode}`);
requireText(halo, "algorithm === 're201'", 'Halo RE-201 dedicated path');
requireText(halo, 'class DualGrainPitchShifter', 'Halo pitch mechanism');

// Atmos: every dropdown entry owns a reverb configuration and network changes are bounded/live-fed natively.
for (const mode of ATMOS) requireObjectKey(atmos, mode, `Atmos ${mode}`);
requireText(atmos, 'const MAX_RETIRED_REVERB_NETWORKS = 1', 'Atmos retiring network cap');
forbidText(atmos, 'this.input.disconnect(previous.network.input)', 'Atmos premature outgoing disconnect');

// Grain: live-memory algorithms and granular hardware studies share bounded
// resources. Converter quantization and classic sampler playback belong to Ember.
requireText(grainProcessor, 'this.voices = Array.from({ length: 8 }', 'Grain bounded voice pool');
requireText(grainProcessor, 'spawnGranularVoice(', 'Grain granular memory engine');
requireText(grainProcessor, 'processSlice(', 'Grain deterministic slice engine');
requireText(grainProcessor, 'processFreeze(', 'Grain crossfaded freeze engine');
for (const [mode, mechanism] of [
  [6, 'Clouds study'],
  [7, 'Beads study'],
  [8, 'Morphagene study'],
  [9, 'Arbhar study'],
  [10, 'Particle 2 study'],
  [11, 'Microcosm study'],
]) requireText(grainProcessor, `mode === ${mode}`, `Grain ${mechanism}`);
requireText(grainProcessor, 'applyHardwareCharacter(', 'Grain hardware character stage');
requireText(grainProcessor, 'maxValue: 11', 'Grain hardware mode worklet range');
requireText(grain, 'this.processor.connect(this.wetGain)', 'Grain single owned DSP path');
forbidText(grainProcessor, 'processHardware(', 'Grain must not contain sampler hardware');
forbidText(grainProcessor, 'quantizeNonlinear12', 'Grain must not contain converter quantization');

// Artifact: media, tape, transmission, and console paths retain mechanism-specific paths.
requireText(artifact, "this.mode === 'Ampex ATR-102'", 'Artifact ATR-102 implementation');
requireText(artifact, "this.mode === 'tascam424'", 'Artifact TASCAM 424 path');
for (const mode of ['Neve 1073','SSL 4000E','API 1608','Neve BCM10']) requireText(artifact, `this.mode === '${mode}'`, `Artifact ${mode} console path`);
requireText(artifact, 'summingBusOperatingPoint(this.mode', 'Artifact calibrated summing-bus routing');
requireText(artifact, 'this.tascamPreamp.configure({', 'Artifact worklet op-amp path');
requireText(artifact, 'this.tascamChannel.configure({', 'Artifact worklet channel path');
requireText(artifact, 'getBcm10CaptureCurve(', 'Artifact BCM10 captured 1073N/Marinair stage');
requireText(artifact, 'getSummingCurve(point.busCompression, point.busAsymmetry)', 'Artifact BCM10 live 1272 summing stage');
forbidText(artifact, 'AudioWorkletNode', 'Artifact digital-capture ownership');
requireText(artifact, 'const MAX_CURVE_CACHE = 384', 'Artifact bounded curve caches');

// RANDOM must keep controlled dropdown state synchronized with native DSP and visibly move when alternatives exist.
requireText(app, 'chooseMusicalDifferent(MUSICAL_EMBER_MODES, module.emberMode)', 'Core random mode changes');
requireText(app, 'Native DSP receives the new values immediately', 'Native RANDOM UI synchronization');
requireText(app, 'window.setTimeout(() => revealRandomUiModule(effectId), 48 + index * 96)', 'Native RANDOM serial reveal');
requireText(railC, 'chooseDifferent(pool, mode)', 'Stomp random mode changes');
requireText(railC, 'chooseDifferent(modelPool, model)', 'Stack random model changes');
requireText(loopStore, 'export const LOOP_TRACK_COUNT = 8', 'Loop eight-buffer backend contract');
requireText(loopStore, 'export const LOOP_VISIBLE_TRACK_COUNT = 4', 'Loop four-track faceplate contract');
forbidText(railC, "useRailCRandomController('pressure'", 'Loop RANDOM isolation');
for (const mode of ARTIFACT_DYNAMICS) requireText(artifact, `'${mode}'`, `Artifact ${mode} dynamics dropdown`);

// A selector is not allowed to leave native topology and controls in different generations.
// The bridge snapshots the latest desired knob state and replays it immediately after mode,
// algorithm, model, or cabinet changes while preserving the serialized command queue.
requireText(nativeBridge, "const PROFILE_SELECTOR_PARAMETERS = new Set(['mode', 'algorithm'])", 'Native selector classification');
requireText(nativeBridge, "const STACK_PROFILE_SELECTORS = new Set(['model', 'cab'])", 'Native Stack selector classification');
requireText(nativeBridge, 'private readonly parameterSnapshot', 'Native module profile snapshot');
requireText(nativeBridge, 'private readonly stackSnapshot', 'Native Stack profile snapshot');
requireText(nativeBridge, 'this.rememberDesiredState(line)', 'Native desired-state capture');
requireText(nativeBridge, 'this.profileReplayLines(line)', 'Native selector profile replay');
requireText(nativeBridge, '.then(() => this.sendCommand(line))', 'Native FIFO selector commit');

// Stomp/Stack retain the shared high-DPI hardware renderer. Loop owns a dedicated
// four-clock matrix so all four performance tracks stay visible at the same time.
for (const kind of ['stomp', 'stack']) requireText(railCArtwork, `${kind}: {`, `Rail C ${kind} artwork profile`);
for (const kind of ['stomp', 'stack']) requireText(railC, `kind=\"${kind}\"`, `Rail C ${kind} artwork mount`);
requireText(railCArtwork, 'subscribeViewportAnimation(render)', 'Rail C artwork shared scheduler');
requireText(railCArtwork, 'canvasPixelRatio(width, height, 5_400_000)', 'Rail C artwork high-DPI backing');
requireText(railC, '<LoopTrackMatrixDisplay', 'Loop four-track artwork mount');
requireText(loopArtwork, 'LOOP_VISIBLE_TRACK_COUNT', 'Loop four-track artwork cardinality');
requireText(loopArtwork, 'subscribeViewportAnimation(render)', 'Loop artwork shared scheduler');
requireText(loopArtwork, 'canvasPixelRatio(width, height, 5_400_000)', 'Loop artwork high-DPI backing');

if (failures.length) {
  console.error('\nCALCOTONE dropdown audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log(`CALCOTONE dropdown audit passed (${EMBER.length + DRIFT.length + HALO.length + ATMOS.length + GRAIN.length + ARTIFACT.length + ARTIFACT_DYNAMICS.length} modes checked with immediate native profile commits).`);
