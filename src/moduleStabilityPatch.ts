import { ChorusEffect, type DriftMode } from './audio/effects/Chorus';
import { BitcrusherEffect } from './audio/effects/Bitcrusher';

type DriftInternals = {
  mode: DriftMode;
  input: GainNode;
  preamp: WaveShaperNode;
};
type DriftPrototype = { apply: (this: DriftInternals) => void };
type DriftState = DriftInternals & { __calcotoneStandardAttached?: boolean };

type GrainInternals = {
  mode: string;
  processor: AudioWorkletNode;
  bloomFilter: BiquadFilterNode;
};
type GrainPrototype = { updateWetBodyGain: (this: GrainInternals, now: number) => void };
type GrainState = GrainInternals & { __calcotoneBloomAttached?: boolean };

type PatchGlobal = typeof globalThis & { __calcotoneModuleStabilityPatch?: boolean };
const globalState = globalThis as PatchGlobal;

const driftProto = ChorusEffect.prototype as unknown as DriftPrototype;
const grainProto = BitcrusherEffect.prototype as unknown as GrainPrototype;

const originalDriftApply = driftProto.apply;
const originalGrainBody = grainProto.updateWetBodyGain;

function driftUsesClassicBranch(mode: DriftMode): boolean {
  return mode === 'biphase' || mode === 'smallstone' || mode === 'univibe' || mode === 'leslie';
}

function stableDriftApply(this: DriftInternals): void {
  originalDriftApply.call(this);
  const state = this as DriftState;
  if (state.__calcotoneStandardAttached === undefined) state.__calcotoneStandardAttached = true;
  const shouldAttach = !driftUsesClassicBranch(state.mode);
  if (shouldAttach === state.__calcotoneStandardAttached) return;
  if (shouldAttach) state.input.connect(state.preamp);
  else {
    try { state.input.disconnect(state.preamp); } catch { /* already detached */ }
  }
  state.__calcotoneStandardAttached = shouldAttach;
}

function grainUsesBloom(mode: string): boolean {
  return !['sp1200','mpc60','mirage','s950','emulator2','fairlightiix'].includes(mode);
}

function stableGrainBody(this: GrainInternals, now: number): void {
  originalGrainBody.call(this, now);
  const state = this as GrainState;
  if (state.__calcotoneBloomAttached === undefined) state.__calcotoneBloomAttached = true;
  const shouldAttach = grainUsesBloom(state.mode);
  if (shouldAttach === state.__calcotoneBloomAttached) return;
  if (shouldAttach) state.processor.connect(state.bloomFilter);
  else {
    try { state.processor.disconnect(state.bloomFilter); } catch { /* already detached */ }
  }
  state.__calcotoneBloomAttached = shouldAttach;
}

function install(): void {
  if (globalState.__calcotoneModuleStabilityPatch) return;
  globalState.__calcotoneModuleStabilityPatch = true;
  driftProto.apply = stableDriftApply;
  grainProto.updateWetBodyGain = stableGrainBody;
}

function uninstall(): void {
  if (!globalState.__calcotoneModuleStabilityPatch) return;
  driftProto.apply = originalDriftApply;
  grainProto.updateWetBodyGain = originalGrainBody;
  delete globalState.__calcotoneModuleStabilityPatch;
}

install();
if (import.meta.hot) import.meta.hot.dispose(uninstall);
