import { InputMatrix, type InputMode } from './audio/InputMatrix';

type InputInternals = {
  routeLL: GainNode;
  routeLR: GainNode;
  routeRL: GainNode;
  routeRR: GainNode;
  setGain(parameter: AudioParam, value: number, immediate: boolean): void;
};
type InputPrototype = { setMode: (this: InputMatrix, mode: InputMode) => void };
type PatchGlobal = typeof globalThis & { __calcotoneInputStabilityPatch?: boolean };

const prototype = InputMatrix.prototype as unknown as InputPrototype;
const originalSetMode = prototype.setMode;
const globalState = globalThis as PatchGlobal;

function stableSetMode(this: InputMatrix, mode: InputMode): void {
  originalSetMode.call(this, mode);
  if (mode !== 'sum-mono') return;
  const internal = this as unknown as InputInternals;
  // Average coherent stereo rather than using an equal-power sum that can add ~3 dB.
  for (const route of [internal.routeLL, internal.routeLR, internal.routeRL, internal.routeRR]) {
    internal.setGain(route.gain, 0.5, false);
  }
}

function install(): void {
  if (globalState.__calcotoneInputStabilityPatch) return;
  globalState.__calcotoneInputStabilityPatch = true;
  prototype.setMode = stableSetMode;
}

function uninstall(): void {
  if (!globalState.__calcotoneInputStabilityPatch) return;
  prototype.setMode = originalSetMode;
  delete globalState.__calcotoneInputStabilityPatch;
}

install();
if (import.meta.hot) import.meta.hot.dispose(uninstall);
