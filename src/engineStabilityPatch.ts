import { AudioEngine, type DspProfilerSnapshot, type PerformanceMode } from './audio/AudioEngine';
import {
  buildHiddenProfilerSnapshot,
  configureTransparentLimiter,
  engineInternals,
  runAdaptivePerformance,
} from './features/engine/engineStabilityPolicy';

type EnginePrototype = {
  start: AudioEngine['start'];
  stop: AudioEngine['stop'];
  setPerformanceMode: AudioEngine['setPerformanceMode'];
  updateAdaptivePerformance: AudioEngine['updateAdaptivePerformance'];
  getProfilerSnapshot: AudioEngine['getProfilerSnapshot'];
};

type PatchGlobal = typeof globalThis & { __calcotoneEngineStabilityPatch?: boolean };

const prototype = AudioEngine.prototype as unknown as EnginePrototype;
const originalStart = prototype.start;
const originalStop = prototype.stop;
const originalSetPerformanceMode = prototype.setPerformanceMode;
const originalUpdateAdaptivePerformance = prototype.updateAdaptivePerformance;
const originalGetProfilerSnapshot = prototype.getProfilerSnapshot;
const globalState = globalThis as PatchGlobal;

async function stableStart(this: AudioEngine, options?: Parameters<AudioEngine['start']>[0]): Promise<void> {
  await originalStart.call(this, options);
  configureTransparentLimiter(this, this.getPerformanceMode());
}

async function stableStop(this: AudioEngine): Promise<void> {
  const internal = engineInternals(this);
  // A click-safe reorder fades out and waits before touching graph/context again.
  // Let that transition finish before stop() disposes either object so shutdown
  // can never null the engine out from underneath the pending reorder.
  await internal.routeTransition.catch(() => undefined);
  await originalStop.call(this);
}

function stableSetPerformanceMode(this: AudioEngine, mode: PerformanceMode): void {
  originalSetPerformanceMode.call(this, mode);
  configureTransparentLimiter(this, mode);
}

function stableAdaptivePerformance(this: AudioEngine): void {
  runAdaptivePerformance(this);
}

function stableProfilerSnapshot(this: AudioEngine): DspProfilerSnapshot {
  // When the panel is visible, preserve the full spectrum diagnostics.
  if (typeof document !== 'undefined' && document.querySelector('.dsp-profiler')) {
    return originalGetProfilerSnapshot.call(this);
  }
  return buildHiddenProfilerSnapshot(this);
}

function install(): void {
  if (globalState.__calcotoneEngineStabilityPatch) return;
  globalState.__calcotoneEngineStabilityPatch = true;
  prototype.start = stableStart;
  prototype.stop = stableStop;
  prototype.setPerformanceMode = stableSetPerformanceMode;
  prototype.updateAdaptivePerformance = stableAdaptivePerformance;
  prototype.getProfilerSnapshot = stableProfilerSnapshot;
}

function uninstall(): void {
  if (!globalState.__calcotoneEngineStabilityPatch) return;
  prototype.start = originalStart;
  prototype.stop = originalStop;
  prototype.setPerformanceMode = originalSetPerformanceMode;
  prototype.updateAdaptivePerformance = originalUpdateAdaptivePerformance;
  prototype.getProfilerSnapshot = originalGetProfilerSnapshot;
  delete globalState.__calcotoneEngineStabilityPatch;
}

install();
if (import.meta.hot) import.meta.hot.dispose(uninstall);
