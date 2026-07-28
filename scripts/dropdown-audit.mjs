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
const artifactSampler = read('public/artifact-sampler-processor.js');

const EMBER = ['velvet','tube','console','transformer','furnace','exciter','broken','goldlion','mullard','telefunken','bugleboy','rcablack','tascam424','neve1073','ssl4000e','api1608'];
const DRIFT = ['chorus','ensemble','dimension','vibrato','rotary','doppler','liquid','orbit','ce1','dimensiond','mxrflanger','electricmistress','adaflanger','bf2','biphase','smallstone','univibe','leslie'];
const HALO = ['clean','tape','bbd','pingpong','diffuse','scatter','constellation','re201','EP-3 Echoplex','Binson Echorec','Deluxe Memory Man','AMS DMX 15-80 S'];
const ATMOS = ['room','plate','hall','cinema','cloud','freeze','celestial','aurora','nebula','abyss','emt140','lexicon224'];
const GRAIN = ['mosaic','scatter','smear','prism','slice','freeze'];
const ARTIFACT = ['cassette','reel','vinyl','vhs','radio','wax','broken','archive','sp1200','mpc60','mirage','s950','Ampex ATR-102','emulator2','fairlightiix'];

requireOrder(ember, 'EMBER_MODE_ORDER', EMBER, 'Ember dropdown');
requireOrder(drift, 'DRIFT_MODE_ORDER', DRIFT, 'Drift dropdown');
requireOrder(halo, 'DELAY_ALGORITHM_ORDER', HALO, 'Halo dropdown');
requireOrder(atmos, 'REVERB_ALGORITHM_ORDER', ATMOS, 'Atmos dropdown');
requireOrder(grain, 'GRAIN_MODE_ORDER', GRAIN, 'Grain dropdown');
requireOrder(artifact, 'MEDIA_MODE_ORDER', ARTIFACT, 'Artifact dropdown');

// Ember: named tubes and transformer must use dedicated stages; generic modes share only the intentional shaper path.
for (const tube of ['goldlion','mullard','telefunken','bugleboy','rcablack']) requireText(ember, `${tube}: '${tube}'`, `Ember ${tube} dedicated tube mapping`);
requireText(ember, "const magnetic = this.mode === 'transformer'", 'Ember transformer ownership');
for (const mode of ['tascam424','neve1073','ssl4000e','api1608']) requireText(ember, `${mode}: {`, `Ember ${mode} console path`);
requireText(ember, 'const consolePath = CONSOLE_PATHS[this.mode]', 'Ember console path ownership');
requireText(ember, 'this.setGenericBranchAttached(!(namedTube || magnetic))', 'Ember inactive generic branch suspension');
requireText(ember, 'const MAX_CURVE_CACHE = 192', 'Ember bounded curve cache');

// Drift: standard modulation and dedicated classic hardware must remain mutually exclusive.
for (const mode of ['mxrflanger','electricmistress','adaflanger','bf2']) requireText(drift, mode, `Drift ${mode} implementation`);
for (const mode of ['biphase','smallstone','univibe','leslie']) requireText(drift, `mode === '${mode}'`, `Drift ${mode} classic mapping`);
requireText(drift, 'this.setStandardBranchAttached(false)', 'Drift classic standard-network suspension');
requireText(driftClassic, 'this.coefficientCountdown = 7', 'Drift classic coefficient throttling');
requireText(driftClassic, 'this.result = [0, 0]', 'Drift classic reusable result buffer');
forbidText(driftClassic, 'return [bL, bR]', 'Bi-Phase per-sample array allocation');
forbidText(driftClassic, 'return [pL, pR]', 'Small Stone per-sample array allocation');
forbidText(driftClassic, 'return [vibeL * tremL, vibeR * tremR]', 'Uni-Vibe per-sample array allocation');

// Halo: every non-RE-201 entry owns a config; RE-201 stays a dedicated network.
for (const mode of HALO.filter((mode) => mode !== 're201')) requireObjectKey(halo, mode, `Halo ${mode}`);
requireText(halo, "algorithm === 're201'", 'Halo RE-201 dedicated path');
requireText(halo, 'class DualGrainPitchShifter', 'Halo pitch mechanism');

// Atmos: every dropdown entry owns a reverb configuration and network changes are bounded/live-fed natively.
for (const mode of ATMOS) requireObjectKey(atmos, mode, `Atmos ${mode}`);
requireText(atmos, 'const MAX_RETIRED_REVERB_NETWORKS = 1', 'Atmos retiring network cap');
forbidText(atmos, 'this.input.disconnect(previous.network.input)', 'Atmos premature outgoing disconnect');

// Grain: every mode is a live-memory mechanism, with bounded shared resources and
// dedicated slice/freeze state. Converter quantization belongs to Artifact.
requireText(grainProcessor, 'this.voices = Array.from({ length: 8 }', 'Grain bounded voice pool');
requireText(grainProcessor, 'spawnGranularVoice(', 'Grain granular memory engine');
requireText(grainProcessor, 'processSlice(', 'Grain deterministic slice engine');
requireText(grainProcessor, 'processFreeze(', 'Grain crossfaded freeze engine');
requireText(grain, 'this.processor.connect(this.wetGain)', 'Grain single owned DSP path');
forbidText(grainProcessor, 'processHardware(', 'Grain must not contain sampler hardware');
forbidText(grainProcessor, 'quantizeNonlinear12', 'Grain must not contain converter quantization');

// Artifact: media, tape, transmission, and six early-sampler converters retain
// mechanism-specific paths.
requireText(artifact, "this.mode === 'Ampex ATR-102'", 'Artifact ATR-102 implementation');
requireText(artifact, "'calcotone-artifact-sampler-processor'", 'Artifact sampler worklet branch');
for (const mode of [0,1,2,3,4,5]) requireText(artifactSampler, `mode === ${mode}`, `Artifact sampler model ${mode}`);
requireText(artifactSampler, 'quantizeNonlinear12', 'Artifact MPC60 nonlinear converter');
requireText(artifactSampler, 'quantizeCompanded8', 'Artifact vintage 8-bit companding');
requireText(artifact, 'const MAX_CURVE_CACHE = 384', 'Artifact bounded curve caches');

if (failures.length) {
  console.error('\nCALCOTONE dropdown audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log(`CALCOTONE dropdown audit passed (${EMBER.length + DRIFT.length + HALO.length + ATMOS.length + GRAIN.length + ARTIFACT.length} modes checked).`);
