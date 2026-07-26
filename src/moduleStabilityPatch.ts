import { SaturationEffect, type EmberMode } from './audio/effects/Saturation';
import { ChorusEffect, type DriftMode } from './audio/effects/Chorus';
import { BitcrusherEffect } from './audio/effects/Bitcrusher';
import { ReverbEffect } from './audio/effects/Reverb';

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

type AtmosNetworkEntry = { network: { input: AudioNode } };
type AtmosInternals = {
  input: GainNode;
  active: AtmosNetworkEntry;
  retiring: Set<AtmosNetworkEntry>;
};
type AtmosPrototype = {
  switchAlgorithm: (this: AtmosInternals, algorithm: string) => void;
  disposeRetiringNetwork: (this: AtmosInternals, entry: AtmosNetworkEntry) => void;
};

type PatchGlobal = typeof globalThis & { __calcotoneModuleStabilityPatch?: boolean };
const globalState = globalThis as PatchGlobal;

const emberProto = SaturationEffect.prototype as unknown as EmberPrototype;
const driftProto = ChorusEffect.prototype as unknown as DriftPrototype;
const grainProto = BitcrusherEffect.prototype as unknown as GrainPrototype;
const atmosProto = ReverbEffect.prototype as unknown as AtmosPrototype;

const originalEmberApply = emberProto.apply;
const originalDriftApply = driftProto.apply;
const originalGrainBody = grainProto.updateWetBodyGain;
const originalAtmosSwitch = atmosProto.switchAlgorithm;
const originalAtmosDispose = atmosProto.disposeRetiringNetwork;

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

function stableAtmosDispose(this: AtmosInternals, entry: AtmosNetworkEntry): void {
  try { this.input.disconnect(entry.network.input); } catch { /* already detached */ }
  originalAtmosDispose.call(this, entry);
}

function stableAtmosSwitch(this: AtmosInternals, algorithm: string): void {
  const previous = this.active;
  originalAtmosSwitch.call(this, algorithm);
  if (this.active === previous || !this.retiring.has(previous)) return;
  // Keep the outgoing field excited for the full fade instead of crossfading a dying tail
  // against a newly-created reverb that has not built energy yet.
  try { this.input.connect(previous.network.input); } catch { /* already connected */ }
  // A single retiring field is enough for continuity and bounds rapid RANDOM/dropdown overlap.
  while (this.retiring.size > 1) {
    const oldest = this.retiring.values().next().value as AtmosNetworkEntry | undefined;
    if (!oldest || oldest === previous) break;
    stableAtmosDispose.call(this, oldest);
  }
}

function install(): void {
  if (globalState.__calcotoneModuleStabilityPatch) return;
  globalState.__calcotoneModuleStabilityPatch = true;
  emberProto.apply = stableEmberApply;
  driftProto.apply = stableDriftApply;
  grainProto.updateWetBodyGain = stableGrainBody;
  atmosProto.switchAlgorithm = stableAtmosSwitch;
  atmosProto.disposeRetiringNetwork = stableAtmosDispose;
}

function uninstall(): void {
  if (!globalState.__calcotoneModuleStabilityPatch) return;
  emberProto.apply = originalEmberApply;
  driftProto.apply = originalDriftApply;
  grainProto.updateWetBodyGain = originalGrainBody;
  atmosProto.switchAlgorithm = originalAtmosSwitch;
  atmosProto.disposeRetiringNetwork = originalAtmosDispose;
  delete globalState.__calcotoneModuleStabilityPatch;
}

install();
if (import.meta.hot) import.meta.hot.dispose(uninstall);
