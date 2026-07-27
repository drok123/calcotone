import type { AudioEngine } from '../../audio/AudioEngine';
import type { Effect } from '../../audio/effects/Effect';
import { applyRandomBatch } from '../../perf/randomBatch';

const RANDOM_DSP_STAGGER_MS = 18;
const RANDOM_DISCRETE_SETTLE_MS = 56;
const RANDOM_TOPOLOGY_SETTLE_MS = 118;
// BaseEffect's wet/dry control uses a 25 ms setTargetAtTime time constant. A 48 ms wait
// still leaves roughly 15% of the previous wet path audible, which is enough for a topology
// mutation to leak through as a tiny click. Give the exponential ramp enough time to become
// effectively silent, then hold a short dead window before touching the graph.
const RANDOM_DRY_RAMP_MS = 126;
const RANDOM_SILENT_GUARD_MS = 18;
const RANDOM_WET_RECOVERY_MS = 58;
const RANDOM_BATCH_ORDER = [
  'saturation',
  'chorus',
  'bitcrusher',
  'media',
  'delay',
  'reverb',
] as const;

export type RandomParameterBatches = Map<string, Map<string, number>>;

type EffectWithWetDry = Effect & {
  setWetDryMix?: (value: number) => void;
};

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

function targetMix(effect: Effect, targets: Map<string, number>): number {
  const requested = targets.get('mix');
  if (requested !== undefined && Number.isFinite(requested)) return Math.max(0, Math.min(1, requested));
  const current = effect.getParameterValue('mix');
  return Number.isFinite(current) ? Math.max(0, Math.min(1, current as number)) : 1;
}

function setWetDry(effect: Effect, value: number): void {
  const wetDry = effect as EffectWithWetDry;
  if (typeof wetDry.setWetDryMix === 'function') {
    wetDry.setWetDryMix(value);
    return;
  }
  effect.setParameter('mix', value);
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

  if (!discreteChanging) {
    // Pure parameter moves keep the existing smoothed DSP path. No topology handoff is needed.
    applyRandomBatch(effect, targets);
    await sleep(RANDOM_DSP_STAGGER_MS);
    return;
  }

  // A machine/algorithm change is an audio transaction, not just a parameter write.
  // First crossfade this effect to its dry path while the old network is still healthy.
  const destinationMix = targetMix(effect, targets);
  setWetDry(effect, 0);
  await sleep(RANDOM_DRY_RAMP_MS);
  if (!engineIsUsable()) return;

  // Deliberately leave a tiny fully-dry guard window. This prevents node creation/disposal,
  // oscillator startup, worklet activation, and feedback-network rewiring from landing on the
  // trailing edge of the wet ramp where even a few percent of the old signal would expose it.
  await sleep(RANDOM_SILENT_GUARD_MS);
  if (!engineIsUsable()) return;

  // Keep the effect dry while the destination machine and all of its parameters are installed.
  // applyRandomBatch normally writes Mix too, so force its transaction copy to zero and restore
  // the real destination only after the new network has initialized.
  const stagedTargets = new Map(targets);
  if (targets.has('mix') || effect.getParameterValue('mix') !== undefined) stagedTargets.set('mix', 0);
  applyRandomBatch(effect, stagedTargets);

  await sleep(isTopologySensitive(effectId) ? RANDOM_TOPOLOGY_SETTLE_MS : RANDOM_DISCRETE_SETTLE_MS);
  if (!engineIsUsable()) return;

  // Restore the randomized wet/dry target through the effect's normal smoothing. By this point
  // every discrete graph mutation happened while that module was effectively inaudible.
  effect.setParameter('mix', destinationMix);
  await sleep(RANDOM_WET_RECOVERY_MS);
}

export function flushCapturedRandom(
  engine: AudioEngine,
  batches: RandomParameterBatches,
  engineIsUsable: () => boolean
): Promise<void> {
  // RANDOM is planned atomically but committed as a sequence of click-safe effect transactions.
  // Discrete machine changes temporarily crossfade only that effect to dry, install the new DSP,
  // then recover its destination mix. Pure parameter changes retain their normal smoothing.
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

  return chain;
}
