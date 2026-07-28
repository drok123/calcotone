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

const driftClassic = read('public/drift-classic-processor.js');
const driftStage = read('src/audio/models/DriftClassicStage.ts');
const randomBridge = read('src/randomTransferBridge.ts');
const randomCapture = read('src/features/random/randomCapture.ts');
const randomDspScheduler = read('src/features/random/randomDspScheduler.ts');
const randomUiFlow = read('src/features/random/randomUiFlow.ts');
const randomRuntime = randomBridge + randomCapture + randomDspScheduler + randomUiFlow;
const enginePatch = read('src/engineStabilityPatch.ts');
const enginePolicy = read('src/features/engine/engineStabilityPolicy.ts');
const inputMatrix = read('src/audio/InputMatrix.ts');
const haloPatch = read('src/haloStabilityPatch.ts');
const artifactPatch = read('src/artifactStabilityPatch.ts');
const reverb = read('src/audio/effects/Reverb.ts');
const chorus = read('src/audio/effects/Chorus.ts');
const grain = read('src/audio/effects/Bitcrusher.ts');
const viewport = read('src/components/effects/ModuleViewport.tsx');
const ascii = read('src/components/ascii/AsciiArtEngine.tsx');
const media = read('src/audio/effects/Media.ts');
const ember = read('src/audio/effects/Saturation.ts');
const main = read('src/main.tsx');
const scheduler = read('src/components/effects/viewportScheduler.ts');
const engine = read('src/audio/AudioEngine.ts');
const knob = read('src/components/controls/Knob.tsx');

// Drift classic stays wet-only, allocation-conscious, and coefficient-throttled.
requireText(driftClassic, 'this.result = [0, 0]', 'Drift reusable stereo result');
requireText(driftClassic, 'return this.result', 'Drift no per-sample stereo allocation');
forbidText(driftClassic, 'return [bL, bR]', 'Bi-Phase per-sample allocation');
forbidText(driftClassic, 'return [pL, pR]', 'Small Stone per-sample allocation');
requireText(driftClassic, 'this.coefficientCountdown = 7', 'Drift coefficient refresh interval');
requireText(driftClassic, 'updateCascadeCoefficients', 'Drift cached all-pass coefficients');
requireText(driftClassic, 'cascadeWithCoefficients', 'Drift cached coefficient processing');
forbidText(driftClassic, 'left * (1 - wet)', 'Drift classic duplicate dry mix');
requireText(driftStage, "const WORKLET_VERSION = '1.0.3-realtime-optimized'", 'Drift optimized cache bust');

// MUSICAL RANDOM plans every destination at once, lets React/knob CSS own the visible motion,
// then commits each active machine to DSP exactly once in a staggered order. Expensive topology
// changes are not allowed to land on the same audio quantum or pull the signal toward silence.
requireText(randomBridge, "import { flushCapturedRandom } from './features/random/randomDspScheduler'", 'RANDOM scheduler module wiring');
requireText(randomBridge, "from './features/random/randomCapture'", 'RANDOM capture module wiring');
requireText(randomCapture, 'installRandomCapture', 'RANDOM capture installation');
requireText(randomCapture, 'beginRandomCapture', 'RANDOM capture begin');
requireText(randomCapture, 'finishRandomCapture', 'RANDOM capture finish');
requireText(randomDspScheduler, 'RANDOM_DSP_STAGGER_MS = 18', 'RANDOM DSP staggering');
requireText(randomDspScheduler, 'RANDOM_DISCRETE_SETTLE_MS = 54', 'RANDOM discrete settle window');
requireText(randomDspScheduler, 'RANDOM_HALO_TOPOLOGY_SETTLE_MS = 620', 'RANDOM Halo topology settle window');
requireText(randomDspScheduler, 'RANDOM_ATMOS_TOPOLOGY_SETTLE_MS = 940', 'RANDOM Atmos topology settle window');
requireText(randomDspScheduler, 'applyRandomBatch(effect, targets);', 'RANDOM single destination commit');
requireText(randomDspScheduler, 'chain = chain.then(() => commitOneBatch(engine, effectId, values, engineIsUsable, revealModule))', 'RANDOM serialized module commit');
requireText(randomDspScheduler, 'Pure parameter moves keep the existing smoothed DSP path', 'RANDOM parameter/topology decoupling');
requireText(randomBridge, "document.documentElement.classList.toggle('random-morphing', busy)", 'RANDOM visual morph state');
requireText(randomDspScheduler, 'await yieldForUiPaint();', 'RANDOM UI paint yield');
requireText(randomDspScheduler, 'revealModule(effectId);', 'RANDOM per-module reveal');
requireText(randomUiFlow, "RANDOM_UI_MODULE_EVENT = 'calcotone:random-ui-module'", 'RANDOM typed UI stream event');
requireText(randomBridge, 'releasePlanningHold();', 'RANDOM short planning hold release');
if (randomBridge.indexOf('releasePlanningHold();') > randomBridge.indexOf('void flushCapturedRandom(')) {
  failures.push('RANDOM planning hold must end before staged DSP begins');
}
requireText(knob, 'transform 165ms cubic-bezier(0.2, 0.82, 0.22, 1)', 'RANDOM-friendly knob travel');
forbidText(randomRuntime, 'RANDOM_MORPH_STEPS', 'Removed repeated RANDOM DSP morph');
forbidText(randomRuntime, 'Promise.all(orderedJobs)', 'Removed simultaneous RANDOM module burst');
forbidText(randomRuntime, 'RANDOM_TOPOLOGY_SAFE_MIX', 'Removed RANDOM signal-collapse guard');
forbidText(randomRuntime, "new Map([['mix', RANDOM_TOPOLOGY_SAFE_MIX]])", 'Removed RANDOM forced near-dry dip');
forbidText(randomRuntime, 'for (const entry of active) engine.setEffectBypassed(entry.id, true)', 'RANDOM bypass-all burst');
requireText(randomDspScheduler, "if (effectId === 'delay') return RANDOM_HALO_TOPOLOGY_SETTLE_MS", 'RANDOM Halo topology wait');
requireText(randomDspScheduler, "if (effectId === 'reverb') return RANDOM_ATMOS_TOPOLOGY_SETTLE_MS", 'RANDOM Atmos topology wait');
forbidText(randomRuntime, 'directSetEffectBypassed.call(engine, effectId, bypassed)', 'RANDOM power mutation');

// Global engine quality should become more transparent as quality increases, and hidden diagnostics
// must not keep doing FFT work while the DSP panel is closed. Shutdown also waits for any pending
// click-safe reorder so the route fade cannot dereference graph/context after teardown.
requireText(main, "import './engineStabilityPatch'", 'Engine stability patch load');
requireText(enginePatch, "from './features/engine/engineStabilityPolicy'", 'Engine stability policy wiring');
requireText(enginePolicy, "mode === 'studio' ? -0.75", 'Studio transparent limiter threshold');
requireText(enginePolicy, "mode === 'studio' ? 4", 'Studio transparent limiter ratio');
requireText(enginePatch, "document.querySelector('.dsp-profiler')", 'Profiler visibility guard');
requireText(enginePolicy, 'const stats = grainStats(engine)', 'Adaptive Grain-only health read');
requireText(enginePolicy, 'spectralCentroidHz: 0', 'Hidden profiler avoids spectrum work');
requireText(enginePatch, 'await internal.routeTransition.catch(() => undefined)', 'Route transition teardown serialization');
requireText(enginePatch, 'prototype.stop = stableStop', 'Route-safe stop patch install');
requireText(enginePatch, 'prototype.stop = originalStop', 'Route-safe stop HMR restore');
requireText(enginePatch, 'import.meta.hot.dispose(uninstall)', 'Engine patch HMR teardown');

// Input mode changes are natively click-smoothed and sum-mono must not add ~3 dB on correlated stereo.
forbidText(main, "import './inputStabilityPatch'", 'Removed input monkey patch');
requireText(inputMatrix, "case 'sum-mono':", 'Native sum-mono routing');
requireText(inputMatrix, 'll = 0.5;', 'Native unity-safe left sum');
requireText(inputMatrix, 'rr = 0.5;', 'Native unity-safe right sum');
requireText(inputMatrix, 'parameter.setTargetAtTime(value, now, 0.018)', 'Input routing smoothing');

// Halo mode changes keep the outgoing network fed until retirement, limit overlap, and keep
// pitch-grain schedulers from waking forever or catch-up bursting after an idle period.
requireText(main, "import './haloStabilityPatch'", 'Halo stability patch load');
requireText(haloPatch, 'this.input.connect(previous.network.input)', 'Halo live-fed outgoing crossfade');
requireText(haloPatch, 'while (this.retiring.size > 1)', 'Halo retired-network cap');
requireText(haloPatch, 'PITCH_SCHEDULER_MS = 72', 'Halo lower-rate pitch scheduler');
requireText(haloPatch, 'PITCH_SLEEP_THRESHOLD', 'Halo pitch scheduler sleep');
requireText(haloPatch, 'shifter.nextGrainTime = shifter.context.currentTime + 0.02', 'Halo no grain catch-up burst');
requireText(haloPatch, 'import.meta.hot.dispose(uninstall)', 'Halo patch HMR teardown');

// Artifact keeps transport/noise branches out of sampler modes, but ATR-102 must retain
// its mechanism-specific wow/flutter/hiss path. Curve caches remain explicitly bounded.
requireText(main, "import './artifactStabilityPatch'", 'Artifact stability patch load');
requireText(artifactPatch, 'function canSuspendTransport', 'Artifact transport ownership');
requireText(artifactPatch, 'ARTIFACT_SAMPLER_MODES.some', 'Artifact sampler transport sleep');
forbidText(artifactPatch, "|| mode === 'Ampex ATR-102'", 'Artifact ATR-102 transport must stay live');
requireText(artifactPatch, 'cassetteNoise.disconnect', 'Artifact noise branch detach');
requireText(artifactPatch, 'leftDepth.disconnect', 'Artifact modulation branch detach');
requireText(artifactPatch, '__calcotoneArtifactBranchesAttached === undefined', 'Artifact initial branch-state guard');
requireText(artifactPatch, 'import.meta.hot.dispose(uninstall)', 'Artifact patch HMR teardown');
requireText(media, 'const MAX_CURVE_CACHE = 384', 'Artifact bounded curve cache');
requireText(media, 'if (cache.size >= MAX_CURVE_CACHE)', 'Artifact curve cache eviction');

// Ember, Drift and Grain own mechanism routing natively; the shared monkey patch must stay gone.
forbidText(main, "import './moduleStabilityPatch'", 'Removed module branch monkey patch');
requireText(ember, 'private genericAttached = true', 'Ember native generic branch state');
requireText(ember, 'this.setGenericBranchAttached(!(namedTube || magnetic))', 'Ember native dedicated-branch ownership');
requireText(ember, 'this.hp.disconnect(this.shaper)', 'Ember native generic shaper detach');
requireText(chorus, 'private standardAttached = true', 'Drift native standard branch state');
requireText(chorus, 'this.setStandardBranchAttached(false)', 'Drift native classic ownership');
requireText(chorus, 'this.input.disconnect(this.preamp)', 'Drift native standard branch detach');
requireText(chorus, '}, 72);', 'Drift fade-before-detach timing');
requireText(grain, 'this.processor.connect(this.wetGain)', 'Grain single owned DSP path');
forbidText(grain, 'bloomFilter', 'Removed Grain universal Bloom branch');
forbidText(grain, 'setBloomBranchAttached', 'Removed Grain hardware branch switching');

// Atmos owns its stability natively: initialize once, ignore redundant writes afterward,
// keep the outgoing field live-fed during crossfade, and allow only one retiring field.
forbidText(main, "import './atmosStabilityPatch'", 'Removed Atmos monkey patch');
requireText(reverb, 'private initialized = false', 'Atmos native initialization boundary');
requireText(reverb, 'if (this.initialized && this.parameterValues.get(parameterId) === value) return', 'Atmos native redundant-write guard');
requireText(reverb, 'const MAX_RETIRED_REVERB_NETWORKS = 1', 'Atmos native retiring-field cap');
forbidText(reverb, 'this.input.disconnect(previous.network.input)', 'Atmos outgoing feed preserved during switch');
requireText(reverb, 'this.input.disconnect(entry.network.input)', 'Atmos disconnects field only at retirement');

// Ember's generic waveshaper cache must remain bounded during long RANDOM/XY sessions.
requireText(ember, 'const MAX_CURVE_CACHE = 192', 'Ember bounded curve cache');
requireText(ember, 'if (curveCache.size >= MAX_CURVE_CACHE)', 'Ember curve cache eviction');

// Visual identity is deterministic ASCII. Every surface shares the budgeted scheduler,
 // sleeps while offscreen, and never owns a decoder or animation loop.
forbidText(main, "import './videoStabilityPatch'", 'Removed video repair monkey patch');
forbidText(main, "import './components/effects/VideoColorStability.css'", 'Retired video stylesheet');
requireText(viewport, '<AsciiArtEngine kind="module" module={module}', 'Module ASCII wiring');
requireText(ascii, 'subscribeViewportAnimation(render)', 'ASCII shared scheduler');
requireText(ascii, 'IntersectionObserver', 'ASCII offscreen suspension');
requireText(ascii, '1000 / 18', 'ASCII bounded active cadence');
requireText(ascii, 'Math.min(1.35, window.devicePixelRatio', 'ASCII pixel-density cap');
forbidText(ascii, 'requestAnimationFrame(', 'Independent ASCII animation loop');
forbidText(viewport, '<video', 'Module decoder');
forbidText(viewport, '.mp4', 'Module video payload');

// Visual scheduling must stay allocation-conscious and HMR-safe.
requireText(scheduler, 'let callbackSnapshot: ViewportRenderCallback[] = []', 'Viewport stable callback snapshot');
forbidText(scheduler, 'const callbacks = [...viewportRenderCallbacks]', 'Viewport per-frame callback allocation');
requireText(scheduler, 'import.meta.hot.dispose(disposeViewportScheduler)', 'Viewport scheduler HMR teardown');

// All-off remains truly raw.
requireText(engine, 'if (!this.hasActiveProcessing())', 'Raw master branch');
requireText(engine, 'this.graph.output.connect(this.analyser)', 'Raw master direct route');

if (failures.length) {
  console.error('\nCALCOTONE realtime audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log('CALCOTONE realtime audit passed.');
