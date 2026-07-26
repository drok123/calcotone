import { MediaEffect, type MediaMode } from './audio/effects/Media';

type ArtifactInternals = {
  mode: MediaMode;
  cassetteNoise: AudioBufferSourceNode;
  vinylNoise: AudioBufferSourceNode;
  cassetteNoiseGain: GainNode;
  vinylNoiseGain: GainNode;
  leftDepth: GainNode;
  rightDepth: GainNode;
  leftDelay: DelayNode;
  rightDelay: DelayNode;
  applyCharacter(): void;
};

type ArtifactPrototype = {
  applyCharacter: (this: ArtifactInternals) => void;
};

type ArtifactPatchState = ArtifactInternals & {
  __calcotoneArtifactBranchesAttached?: boolean;
};

type ArtifactPatchGlobal = typeof globalThis & {
  __calcotoneArtifactStabilityPatch?: boolean;
};

const prototype = MediaEffect.prototype as unknown as ArtifactPrototype;
const originalApplyCharacter = prototype.applyCharacter;
const globalState = globalThis as ArtifactPatchGlobal;

function canSuspendTransport(mode: MediaMode): boolean {
  // ATR-102 still owns wow/flutter + hiss as part of its mechanism, so it must stay live.
  return mode === 'tascam424'
    || mode === 'Neve 1073'
    || mode === 'SSL 4000E'
    || mode === 'API 1608';
}

function detachUnusedBranches(effect: ArtifactPatchState): void {
  if (effect.__calcotoneArtifactBranchesAttached === false) return;
  try { effect.cassetteNoise.disconnect(effect.cassetteNoiseGain); } catch { /* already detached */ }
  try { effect.vinylNoise.disconnect(effect.vinylNoiseGain); } catch { /* already detached */ }
  try { effect.leftDepth.disconnect(effect.leftDelay.delayTime); } catch { /* already detached */ }
  try { effect.rightDepth.disconnect(effect.rightDelay.delayTime); } catch { /* already detached */ }
  effect.__calcotoneArtifactBranchesAttached = false;
}

function attachMediaBranches(effect: ArtifactPatchState): void {
  if (effect.__calcotoneArtifactBranchesAttached === true) return;
  effect.cassetteNoise.connect(effect.cassetteNoiseGain);
  effect.vinylNoise.connect(effect.vinylNoiseGain);
  effect.leftDepth.connect(effect.leftDelay.delayTime);
  effect.rightDepth.connect(effect.rightDelay.delayTime);
  effect.__calcotoneArtifactBranchesAttached = true;
}

function stableApplyCharacter(this: ArtifactInternals): void {
  const effect = this as ArtifactPatchState;
  // MediaEffect's constructor builds these four connections before its first applyCharacter().
  // Treat an unseen instance as already attached so the default cassette initialization cannot
  // accidentally duplicate source/modulation edges.
  if (effect.__calcotoneArtifactBranchesAttached === undefined) {
    effect.__calcotoneArtifactBranchesAttached = true;
  }

  originalApplyCharacter.call(this);
  if (canSuspendTransport(effect.mode)) detachUnusedBranches(effect);
  else attachMediaBranches(effect);
}

function install(): void {
  if (globalState.__calcotoneArtifactStabilityPatch) return;
  globalState.__calcotoneArtifactStabilityPatch = true;
  prototype.applyCharacter = stableApplyCharacter;
}

function uninstall(): void {
  if (!globalState.__calcotoneArtifactStabilityPatch) return;
  prototype.applyCharacter = originalApplyCharacter;
  delete globalState.__calcotoneArtifactStabilityPatch;
}

install();

if (import.meta.hot) {
  import.meta.hot.dispose(uninstall);
}
