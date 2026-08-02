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
const railCRandom = read('src/features/random/railCRandomRegistry.ts');
const randomProfiles = read('src/features/random/randomProfiles.ts');
const railCModules = read('src/components/effects/RailCModules.tsx');
const app = read('src/App.tsx');
const randomRuntime = randomBridge + randomCapture + randomDspScheduler + randomUiFlow + railCRandom + randomProfiles;
const inputMatrix = read('src/audio/InputMatrix.ts');
const haloPatch = read('src/haloStabilityPatch.ts');
const reverb = read('src/audio/effects/Reverb.ts');
const chorus = read('src/audio/effects/Chorus.ts');
const grain = read('src/audio/effects/Bitcrusher.ts');
const viewport = read('src/components/effects/ModuleViewport.tsx');
const ascii = read('src/components/ascii/AsciiArtEngine.tsx');
const pressureDisplay = read('src/components/ascii/PressureStyleDisplay.tsx');
const media = read('src/audio/effects/Media.ts');
const ember = read('src/audio/effects/Saturation.ts');
const main = read('src/main.tsx');
const scheduler = read('src/components/effects/viewportScheduler.ts');
const engine = read('src/audio/AudioEngine.ts');
const baseEffect = read('src/audio/effects/Effect.ts');
const physicalRegistry = read('src/audio/PhysicalBehaviorRegistry.ts');
const knob = read('src/components/controls/Knob.tsx');
const stackAmp = read('src/audio/effects/StackAmp.ts');
const stackProcessor = read('public/stack-amp-processor.js');

// Drift classic stays wet-only, allocation-conscious, and coefficient-throttled.
requireText(driftClassic, 'this.result = [0, 0]', 'Drift reusable stereo result');
requireText(driftClassic, 'return this.result', 'Drift no per-sample stereo allocation');
forbidText(driftClassic, 'return [bL, bR]', 'Bi-Phase per-sample allocation');
forbidText(driftClassic, 'return [pL, pR]', 'Small Stone per-sample allocation');
requireText(driftClassic, 'this.coefficientCountdown = 7', 'Drift coefficient refresh interval');
requireText(driftClassic, 'updateCascadeCoefficients', 'Drift cached all-pass coefficients');
requireText(driftClassic, 'cascadeWithCoefficients', 'Drift cached coefficient processing');
forbidText(driftClassic, 'left * (1 - wet)', 'Drift classic duplicate dry mix');
requireText(driftStage, "const WORKLET_VERSION = '1.1.0-classic-phase-pan'", 'Drift optimized cache bust');

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
requireText(railCRandom, "RAIL_C_RANDOM_ORDER = ['synth', 'chaos', 'pressure']", 'Rail C RANDOM order');
requireText(railCRandom, 'return serialOrder.filter(', 'Rail C active-module planning');
requireText(randomBridge, 'const railCModuleIds = getActiveRailCRandomModuleIds()', 'Rail C bridge planning');
requireText(randomDspScheduler, 'for (const moduleId of deferredModuleIds)', 'Rail C serialized scheduler');
requireText(randomDspScheduler, 'commitDeferredModule(moduleId, engineIsUsable, revealModule)', 'Rail C serialized commit');
requireText(app, 'railCTargets: new Set(activeRailC)', 'Rail C UI transaction targets');
requireText(app, 'randomizeRailCModule(railCId, plan.profile)', 'Rail C profile-aware reveal-time randomization');
requireText(railCModules, "useRailCRandomController('synth', enabled, randomizeSynth)", 'Synth RANDOM controller');
requireText(railCModules, "useRailCRandomController('chaos', enabled, randomizeChaos)", 'Chaos RANDOM controller');
requireText(railCModules, "useRailCRandomController('pressure', state.enabled, randomizePressureProfile)", 'Pressure profile-aware RANDOM controller');
if (randomBridge.indexOf('releasePlanningHold();') > randomBridge.indexOf('void flushCapturedRandom(')) {
  failures.push('RANDOM planning hold must end before staged DSP begins');
}
requireText(randomProfiles, 'RANDOM_MORPH_SECONDS = 0.35', 'RANDOM 350 ms morph window');
requireText(randomProfiles, 'RANDOM_MUTATION_AMOUNT = 0.10', 'RANDOM 10 percent drift amount');
for (const profile of ['bass', 'pad', 'lead', 'retro-ambient', 'lofi-tape', 'gritty-drive', 'mutate']) {
  requireText(randomProfiles, `'${profile}'`, `${profile} RANDOM profile`);
}
requireText(app, 'DELAY_SYNC_SECONDS', 'Tempo-safe delay subdivisions');
requireText(app, "parameterId === 'feedback') safe = Math.min(safe, .82)", 'Delay feedback safety cap');
requireText(app, "normalizedReverbDecay(.5), normalizedReverbDecay(6)", 'Reverb decay safety range');
requireText(app, "moduleId === 'delay' || moduleId === 'reverb' ? .72 : .50", 'Insert wet-mix safety cap');
requireText(reverb, 'Math.min(0.05, this.config.predelay[0]', 'Reverb pre-delay ceiling');
requireText(knob, 'transform 350ms cubic-bezier(0.2, 0.82, 0.22, 1)', 'RANDOM-friendly knob travel');
forbidText(randomRuntime, 'RANDOM_MORPH_STEPS', 'Removed repeated RANDOM DSP morph');
forbidText(randomRuntime, 'Promise.all(orderedJobs)', 'Removed simultaneous RANDOM module burst');
forbidText(randomRuntime, 'RANDOM_TOPOLOGY_SAFE_MIX', 'Removed RANDOM signal-collapse guard');
forbidText(randomRuntime, "new Map([['mix', RANDOM_TOPOLOGY_SAFE_MIX]])", 'Removed RANDOM forced near-dry dip');
forbidText(randomRuntime, 'for (const entry of active) engine.setEffectBypassed(entry.id, true)', 'RANDOM bypass-all burst');
requireText(randomDspScheduler, "if (effectId === 'delay') return RANDOM_HALO_TOPOLOGY_SETTLE_MS", 'RANDOM Halo topology wait');
requireText(randomDspScheduler, "if (effectId === 'reverb') return RANDOM_ATMOS_TOPOLOGY_SETTLE_MS", 'RANDOM Atmos topology wait');
forbidText(randomRuntime, 'directSetEffectBypassed.call(engine, effectId, bypassed)', 'RANDOM power mutation');

// STACK replaces the UI-only Chaos controller with a real serial amp/cab insert.
requireText(stackAmp, "public readonly id = 'chaos'", 'STACK preserves rack slot identity');
requireText(stackAmp, "setTargetAtTime(value, now, 0.018)", 'STACK parameter smoothing');
requireText(stackProcessor, 'SHAPER_LUT', 'STACK nonlinear LUT');
requireText(stackProcessor, 'coefficientGlide', 'STACK click-safe topology glide');
forbidText(stackProcessor, 'const target = [...model, ...cabinet]', 'STACK per-quantum target allocation');

// Global engine quality should become more transparent as quality increases, and hidden diagnostics
// must not keep doing FFT work while the DSP panel is closed. Shutdown also waits for any pending
// click-safe reorder so the route fade cannot dereference graph/context after teardown.
forbidText(main, "import './engineStabilityPatch'", 'Retired engine prototype patch');
requireText(engine, 'const stats = this.getGrainProfilerStats()', 'Adaptive Grain-only health read');
requireText(engine, "this.performanceMode === 'studio' ? -0.75", 'Studio transparent limiter threshold');
requireText(engine, "this.performanceMode === 'studio' ? 4", 'Studio transparent limiter ratio');
requireText(engine, 'await this.routeTransition.catch(() => undefined)', 'Route transition teardown serialization');
requireText(app, 'if (profilerOpen) setProfiler(', 'Hidden profiler publish guard');
requireText(app, '}, [isRunning, profilerOpen]);', 'Profiler visibility lifecycle');

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

// Artifact keeps transport/noise branches out of console paths, but ATR-102 must retain
// its mechanism-specific wow/flutter/hiss path. Curve caches remain explicitly bounded.
forbidText(main, "import './artifactStabilityPatch'", 'Retired Artifact monkey patch');
requireText(media, 'private transportAttached = true', 'Artifact native transport ownership');
requireText(media, 'this.setTransportAttached(!ARTIFACT_CONSOLE_MODES.some', 'Artifact console transport sleep');
requireText(media, 'this.cassetteNoise.disconnect(this.cassetteNoiseGain)', 'Artifact native noise branch detach');
requireText(media, 'this.leftDepth.disconnect(this.leftDelay.delayTime)', 'Artifact native modulation branch detach');
requireText(media, 'const MAX_CURVE_CACHE = 384', 'Artifact bounded curve cache');
requireText(media, 'if (cache.size >= MAX_CURVE_CACHE)', 'Artifact curve cache eviction');

// Bypass teardown and startup latency are native owners; no prototype patch may
// silently rewrite AudioContext or hardware behavior at module import time.
forbidText(main, "import './realtimeStabilityPatch'", 'Retired realtime prototype patch');
requireText(engine, "if (mode === 'balanced') return 'balanced'", 'Balanced audio scheduling policy');
requireText(engine, "return 'interactive'", 'Live interactive scheduling policy');
requireText(engine, "latency: { ideal: 0 }", 'Low-latency input request');
requireText(engine, "sampleRate: { ideal: this.context.sampleRate }", 'Input/context sample-rate match request');
requireText(baseEffect, "if (this.bypassed && profile !== 'bypass') return", 'Bypassed behavior-stage allocation guard');
requireText(baseEffect, 'if (this.bypassed && enabled) return', 'Bypassed spring allocation guard');
requireText(physicalRegistry, "effect.configureBehavior('bypass', 0, 0, 0, 0.5)", 'Native bypass hardware teardown');
requireText(physicalRegistry, 'if (!bypassed) syncPhysicalBehavior(effect)', 'Native behavior restoration');

// Ember, Drift and Grain own mechanism routing natively; the shared monkey patch must stay gone.
forbidText(main, "import './moduleStabilityPatch'", 'Removed module branch monkey patch');
requireText(ember, 'private genericAttached = true', 'Ember native generic branch state');
requireText(ember, 'this.setGenericBranchAttached(!(namedTube || magnetic || digitalCapture))', 'Ember native dedicated-branch ownership');
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
requireText(viewport, '<PressureStyleDisplay module={module}', 'Module ASCII wiring');
requireText(ascii, 'subscribeViewportAnimation(render)', 'ASCII shared scheduler');
requireText(ascii, 'IntersectionObserver', 'ASCII offscreen suspension');
requireText(ascii, '1000 / 18', 'ASCII bounded active cadence');
requireText(ascii, 'Math.min(1.35, window.devicePixelRatio', 'ASCII pixel-density cap');
requireText(pressureDisplay, 'subscribeViewportAnimation(render)', 'Module display shared scheduler');
requireText(pressureDisplay, 'if (canvas.width !== pixelWidth)', 'Module display resize allocation guard');
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
