import { ReverbEffect } from './audio/effects/Reverb';

type AtmosParameterState = {
  parameterValues: Map<string, number>;
  setParameter(parameterId: string, value: number): void;
};

type AtmosPrototype = {
  setParameter: (this: AtmosParameterState, parameterId: string, value: number) => void;
};

type AtmosPatchGlobal = typeof globalThis & {
  __calcotoneAtmosStabilityPatch?: boolean;
};

const prototype = ReverbEffect.prototype as unknown as AtmosPrototype;
const originalSetParameter = prototype.setParameter;
const globalState = globalThis as AtmosPatchGlobal;

function stableSetParameter(this: AtmosParameterState, parameterId: string, value: number): void {
  // ReverbNetwork.update touches every active delay line, diffuser, filter, feedback path and LFO.
  // Avoid retraversing that graph when UI/XY/RANDOM settling writes the exact value already stored.
  const previous = this.parameterValues.get(parameterId);
  if (previous === value) return;
  originalSetParameter.call(this, parameterId, value);
}

function install(): void {
  if (globalState.__calcotoneAtmosStabilityPatch) return;
  globalState.__calcotoneAtmosStabilityPatch = true;
  prototype.setParameter = stableSetParameter;
}

function uninstall(): void {
  if (!globalState.__calcotoneAtmosStabilityPatch) return;
  prototype.setParameter = originalSetParameter;
  delete globalState.__calcotoneAtmosStabilityPatch;
}

install();
if (import.meta.hot) import.meta.hot.dispose(uninstall);
