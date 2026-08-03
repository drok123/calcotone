import type { AudioEngine } from '../../audio/AudioEngine';
import type { Effect } from '../../audio/effects/Effect';
import { applyRandomBatch } from '../../perf/randomBatch';
import { RANDOM_UI_EFFECT_ORDER } from './randomUiFlow';

const RANDOM_DSP_STAGGER_MS = 18;
const RANDOM_DISCRETE_SETTLE_MS = 54;
const RANDOM_DRY_RAMP_MS = 126;
const RANDOM_SILENT_HOLD_MS = 18;
const RANDOM_WET_RECOVERY_MS = 48;
// Keep RANDOM's transaction alive until topology-heavy effects have completed their
// own internal network crossfades. Halo currently fades for 0.52 s and Atmos for
// 0.82 s; the margins below also give retire/disposal timers room to run before a
// user can launch another topology churn pass.
const RANDOM_HALO_TOPOLOGY_SETTLE_MS = 620;
const RANDOM_ATMOS_TOPOLOGY_SETTLE_MS = 940;
const RANDOM_BATCH_ORDER = RANDOM_UI_EFFECT_ORDER;

export type RandomParameterBatches = Map<string, Map<string, number>>;

type EffectWithWetDry = Effect & {
  setWetDryMix?: (value: number) => void;
};

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function yieldForUiPaint(): Promise<void> {
  if (document.hidden) return sleep(0);
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
  });
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

function topologySettleMs(effectId: string): number {
  if (effectId === 'delay') return RANDOM_HALO_TOPOLOGY_SETTLE_MS;
  if (effectId === 'reverb') return RANDOM_ATMOS_TOPOLOGY_SETTLE_MS;
  return RANDOM_DISCRETE_SETTLE_MS;
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
  engineIsUsable: () => boolean,
  revealModule: (effectId: string) => void
): Promise<void> {
  if (!targets.size || !engineIsUsable()) return;
  const effect = engine.getEffect(effectId);
  if (!effect) return;

  // Reveal one destination packet, finish React's commit, and give the browser a
  // paint opportunity before this module performs any DSP work. RANDOM therefore
  // reads as a flowing sequence instead of one large visual/state burst.
  revealModule(effectId);
  await yieldForUiPaint();
  if (!engineIsUsable()) return;

  const discreteChanging = discreteTargetChanges(effectId, effect, targets);

  if (!discreteChanging) {
    // Pure parameter moves keep the existing smoothed DSP path. No topology handoff is needed.
    applyRandomBatch(effect, targets);
    await sleep(RANDOM_DSP_STAGGER_MS);
    return;
  }

  // A machine/algorithm change is an audio transaction, not just a parameter write.
  // First crossfade this effect fully to its dry path while the old network is still healthy.
  const destinationMix = targetMix(effect, targets);
  setWetDry(effect, 0);
  await sleep(RANDOM_DRY_RAMP_MS);
  if (!engineIsUsable()) return;

  // Give the wet path a genuinely silent floor before allocating/switching topology.
  await sleep(RANDOM_SILENT_HOLD_MS);
  if (!engineIsUsable()) return;

  // Keep the effect dry while the destination machine and all of its parameters are installed.
  // applyRandomBatch normally writes Mix too, so force its transaction copy to zero and restore
  // the real destination only after the new network has completed its internal transition.
  const stagedTargets = new Map(targets);
  if (targets.has('mix') || effect.getParameterValue('mix') !== undefined) stagedTargets.set('mix', 0);
  applyRandomBatch(effect, stagedTargets);

  // Crucially, Halo/Atmos remain inside the RANDOM transaction until their own network
  // crossfades finish. This bounds retiring-network pressure under repeated RANDOM abuse.
  await sleep(topologySettleMs(effectId));
  if (!engineIsUsable()) return;

  // Restore the randomized wet/dry target through the effect's normal smoothing only after
  // topology construction/crossfade has finished.
  effect.setParameter('mix', destinationMix);
  await sleep(RANDOM_WET_RECOVERY_MS);
}

async function commitDeferredModule(
  moduleId: string,
  engineIsUsable: () => boolean,
  revealModule: (effectId: string) => void
): Promise<void> {
  if (!engineIsUsable()) return;
  revealModule(moduleId);
  await yieldForUiPaint();
  if (engineIsUsable()) await sleep(RANDOM_DSP_STAGGER_MS);
}

export function flushCapturedRandom(
  engine: AudioEngine,
  batches: RandomParameterBatches,
  engineIsUsable: () => boolean,
  revealModule: (effectId: string) => void,
  deferredModuleIds: readonly string[] = []
): Promise<void> {
  // RANDOM is planned atomically but committed as a sequence of click-safe effect transactions.
  // Discrete machine changes temporarily crossfade only that effect to dry, install the new DSP,
  // wait for any topology transition to complete, then recover its destination mix.
  const committed = new Set<string>();
  let chain = Promise.resolve();

  for (const effectId of RANDOM_BATCH_ORDER) {
    const values = batches.get(effectId);
    if (!values) continue;
    committed.add(effectId);
    chain = chain.then(() => commitOneBatch(engine, effectId, values, engineIsUsable, revealModule));
  }

  for (const [effectId, values] of batches) {
    if (committed.has(effectId)) continue;
    chain = chain.then(() => commitOneBatch(engine, effectId, values, engineIsUsable, revealModule));
  }

  // Rail C owns stomp/performance state outside the six-effect capture shim. Reveal those
  // controllers after the captured effect packets so their React effects, worklet messages,
  // and Pressure event bridge also land one module at a time.
  for (const moduleId of deferredModuleIds) {
    chain = chain.then(() => commitDeferredModule(moduleId, engineIsUsable, revealModule));
  }

  // The bridge holds RANDOM busy until this promise resolves, so repeated button mashing can no
  // longer outrun Halo/Atmos network retirement and accumulate topology churn.
  return chain;
}
