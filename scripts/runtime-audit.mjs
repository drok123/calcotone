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
const haloPatch = read('src/haloStabilityPatch.ts');
const artifactPatch = read('src/artifactStabilityPatch.ts');
const media = read('src/audio/effects/Media.ts');
const main = read('src/main.tsx');
const scheduler = read('src/components/effects/viewportScheduler.ts');
const engine = read('src/audio/AudioEngine.ts');

// One dry/wet owner: classic modulation processors must return wet-only material.
requireText(driftClassic, 'return [bL, bR]', 'Bi-Phase wet-only output');
requireText(driftClassic, 'return [pL, pR]', 'Small Stone wet-only output');
requireText(driftClassic, 'return [vibeL * tremL, vibeR * tremR]', 'Uni-Vibe wet-only output');
forbidText(driftClassic, 'left * (1 - wet)', 'Drift classic duplicate dry mix');
requireText(driftStage, "const WORKLET_VERSION = '1.0.2-wet-only'", 'Drift classic cache bust');

// MUSICAL RANDOM must morph rather than bypassing the rack and blasting one transaction.
requireText(randomBridge, 'RANDOM_MORPH_STEPS', 'RANDOM staged morph');
requireText(randomBridge, 'smoothstep(step / RANDOM_MORPH_STEPS)', 'RANDOM eased motion');
requireText(randomBridge, 'await morphOneBatch', 'RANDOM module staging');
forbidText(randomBridge, 'for (const entry of active) engine.setEffectBypassed(entry.id, true)', 'RANDOM bypass-all burst');

// Topology-changing RANDOM moves must keep an audible dry bridge and must never power modules off.
requireText(randomBridge, 'RANDOM_TOPOLOGY_SAFE_MIX', 'RANDOM topology dry bridge');
requireText(randomBridge, "effectId === 'delay' || effectId === 'reverb'", 'RANDOM topology-sensitive modes');
requireText(randomBridge, "applyRandomBatch(effect, new Map([['mix', RANDOM_TOPOLOGY_SAFE_MIX]]))", 'RANDOM pre-switch mix guard');
requireText(randomBridge, 'Musical RANDOM never changes module power', 'RANDOM power-layout preservation');
forbidText(randomBridge, 'directSetEffectBypassed.call(engine, effectId, bypassed)', 'RANDOM power mutation');

// Halo mode changes keep the outgoing network fed until retirement, limit overlap, and keep
// pitch-grain schedulers from waking forever or catch-up bursting after an idle period.
requireText(main, "import './haloStabilityPatch'", 'Halo stability patch load');
requireText(haloPatch, 'this.input.connect(previous.network.input)', 'Halo live-fed outgoing crossfade');
requireText(haloPatch, 'while (this.retiring.size > 1)', 'Halo retired-network cap');
requireText(haloPatch, 'PITCH_SCHEDULER_MS = 72', 'Halo lower-rate pitch scheduler');
requireText(haloPatch, 'PITCH_SLEEP_THRESHOLD', 'Halo pitch scheduler sleep');
requireText(haloPatch, 'shifter.nextGrainTime = shifter.context.currentTime + 0.02', 'Halo no grain catch-up burst');
requireText(haloPatch, 'import.meta.hot.dispose(uninstall)', 'Halo patch HMR teardown');

// Artifact keeps transport/noise branches out of static insert/summing modes, but ATR-102 must
// retain its mechanism-specific wow/flutter/hiss path. Curve caches remain explicitly bounded.
requireText(main, "import './artifactStabilityPatch'", 'Artifact stability patch load');
requireText(artifactPatch, 'function canSuspendTransport', 'Artifact transport ownership');
requireText(artifactPatch, "mode === 'tascam424'", 'Artifact Tascam transport sleep');
requireText(artifactPatch, "mode === 'Neve 1073'", 'Artifact Neve transport sleep');
requireText(artifactPatch, "mode === 'SSL 4000E'", 'Artifact SSL transport sleep');
requireText(artifactPatch, "mode === 'API 1608'", 'Artifact API transport sleep');
forbidText(artifactPatch, "|| mode === 'Ampex ATR-102'", 'Artifact ATR-102 transport must stay live');
requireText(artifactPatch, 'cassetteNoise.disconnect', 'Artifact noise branch detach');
requireText(artifactPatch, 'leftDepth.disconnect', 'Artifact modulation branch detach');
requireText(artifactPatch, '__calcotoneArtifactBranchesAttached === undefined', 'Artifact initial branch-state guard');
requireText(artifactPatch, 'import.meta.hot.dispose(uninstall)', 'Artifact patch HMR teardown');
requireText(media, 'const MAX_CURVE_CACHE = 384', 'Artifact bounded curve cache');
requireText(media, 'if (cache.size >= MAX_CURVE_CACHE)', 'Artifact curve cache eviction');

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
