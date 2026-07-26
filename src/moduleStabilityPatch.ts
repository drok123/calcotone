import { SaturationEffect, type EmberMode } from './audio/effects/Saturation';
import { ChorusEffect, type DriftMode } from './audio/effects/Chorus';
import { BitcrusherEffect } from './audio/effects/Bitcrusher';

type EmberInternals = {
  mode: EmberMode;
  hp: BiquadFilterNode;
  shaper: WaveShaperNode;
};
type EmberPrototype = { apply: (this: EmberInternals, now?: number) => void };
type EmberState = EmberInternals & { __calcotoneGenericAttached?: boolean };

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

const emberProto = SaturationEffect.prototype as unknown as EmberPrototype;
const driftProto = ChorusEffect.prototype as unknown as DriftPrototype;
const grainProto = BitcrusherEffect.prototype as unknown as GrainPrototype;

const originalEmberApply = emberProto.apply;
const originalDriftApply = driftProto.apply;
const originalGrainBody = grainProto.updateWetBodyGain;

function emberUsesDedicatedBranch(mode: EmberMode): boolean {
  return mode === 'transformer' || mode === 'goldlion' || mode === 'mullard'
    || mode === 'telefunken' || mode === 'bugleboy' || mode === 'rcablack';
}

function stableEmberApply(this: EmberInternals, now?: number): void {
  originalEmberApply.call(this, now);
  const state = this as EmberState;
  if (state.__calcotoneGenericAttached === undefined) state.__calcotoneGenericAttached = true;
  const shouldAttach = !emberUsesDedicatedBranch(state.mode);
  if (shouldAttach === state.__calcotoneGenericAttached) return;
  if (shouldAttach) state.hp.connect(state.shaper);
  else {
    try { state.hp.disconnect(state.shaper); } catch { /* already detached */ }
  }
  state.__calcotoneGenericAttached = shouldAttach;
}

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
  emberProto.apply = stableEmberApply;
  driftProto.apply = stableDriftApply;
  grainProto.updateWetBodyGain = stableGrainBody;
}

function uninstall(): void {
  if (!globalState.__calcotoneModuleStabilityPatch) return;
  emberProto.apply = originalEmberApply;
  driftProto.apply = originalDriftApply;
  grainProto.updateWetBodyGain = originalGrainBody;
  delete globalState.__calcotoneModuleStabilityPatch;
}

install();
if (import.meta.hot) import.meta.hot.dispose(uninstall);
