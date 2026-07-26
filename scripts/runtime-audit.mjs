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
