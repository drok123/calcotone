import type { AudioEngine } from '../../audio/AudioEngine';
import type { Effect } from '../../audio/effects/Effect';
import { applyRandomBatch } from '../../perf/randomBatch';

const RANDOM_DSP_STAGGER_MS = 18;
const RANDOM_DISCRETE_SETTLE_MS = 28;
const RANDOM_TOPOLOGY_SETTLE_MS = 76;
const RANDOM_BATCH_ORDER = [
  'saturation',
  'chorus',
  'bitcrusher',
  'media',
  'delay',
  'reverb',
] as const;

export type RandomParameterBatches = Map<string, Map<string, number>>;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function discreteParameterFor(effectId: string): string | null {
  switch (effectId) {
    case 'saturation':
    case 'chorus':
    case 'bitcrusher':
    case 'media':
      return 'mode';
    case 'delay':
    case 'reverb':
      return 'algorithm';
    default:
      return null;
  }
}

function isTopologySensitive(effectId: string): boolean {
  return effectId === 'delay' || effectId === 'reverb';
}

function discreteTargetChanges(
  effectId: string,
  effect: Effect,
  targets: Map<string, number>
): boolean {
  const discreteId = discreteParameterFor(effectId);
  if (!discreteId) return false;
  const target = targets.get(discreteId);
  const current = effect.getParameterValue(discreteId);
  return target !== undefined && current !== undefined && Math.round(target) !== Math.round(current);
}

async function commitOneBatch(
  engine: AudioEngine,
  effectId: string,
  targets: Map<string, number>,
  engineIsUsable: () => boolean
): Promise<void> {
  if (!targets.size || !engineIsUsable()) return;
  const effect = engine.getEffect(effectId);
  if (!effect) return;

  const discreteChanging = discreteTargetChanges(effectId, effect, targets);

  // The UI already owns the visible 165 ms knob animation. Audio does not need to chase that
  // animation with repeated JS writes. Commit the destination once so expensive apply()/network
  // rebuild paths execute a single time per machine.
  applyRandomBatch(effect, targets);

  // Delay/reverb algorithm changes crossfade live-fed old/new networks internally. Give that
  // transition room to establish before the next machine is touched instead of dropping Mix to
  // near-dry or rebuilding several topologies at the same instant.
  await sleep(
    discreteChanging
      ? isTopologySensitive(effectId)
        ? RANDOM_TOPOLOGY_SETTLE_MS
        : RANDOM_DISCRETE_SETTLE_MS
      : RANDOM_DSP_STAGGER_MS
  );
}

export function flushCapturedRandom(
  engine: AudioEngine,
  batches: RandomParameterBatches,
  engineIsUsable: () => boolean
): Promise<void> {
  // RANDOM is planned atomically, but committed to DSP one machine at a time. This prevents six
  // expensive apply/network-rebuild paths from landing on the same audio quantum while the UI is
  // still free to animate every knob toward its destination together.
  const committed = new Set<string>();
  let chain = Promise.resolve();

  for (const effectId of RANDOM_BATCH_ORDER) {
    const values = batches.get(effectId);
    if (!values) continue;
    committed.add(effectId);
    chain = chain.then(() => commitOneBatch(engine, effectId, values, engineIsUsable));
  }

  for (const [effectId, values] of batches) {
    if (committed.has(effectId)) continue;
    chain = chain.then(() => commitOneBatch(engine, effectId, values, engineIsUsable));
  }

  // Musical RANDOM never changes module power. The user's active rack is the continuity anchor;
  // RANDOM reshapes machines inside that rack without introducing a bypass burst or all-off state.
  return chain;
}
