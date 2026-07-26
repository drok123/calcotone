import { AudioEngine, type DspProfilerSnapshot, type EngineHealth, type PerformanceMode } from './audio/AudioEngine';
import type { Effect } from './audio/effects/Effect';
import type { GrainProfilerStats } from './audio/effects/Bitcrusher';

type EngineInternals = AudioEngine & {
  limiter: DynamicsCompressorNode | null;
  context: AudioContext | null;
  adaptiveAction: string;
  overloadWindows: number;
  recoveryWindows: number;
  lastOverrunCount: number;
  dreamBuffer: { getStats(): DspProfilerSnapshot['dreamBuffer'] } | null;
};

type GrainEffect = Effect & { getProfilerStats(): GrainProfilerStats };
type EnginePrototype = {
  start: AudioEngine['start'];
  setPerformanceMode: AudioEngine['setPerformanceMode'];
  updateAdaptivePerformance: AudioEngine['updateAdaptivePerformance'];
  getProfilerSnapshot: AudioEngine['getProfilerSnapshot'];
};

type PatchGlobal = typeof globalThis & { __calcotoneEngineStabilityPatch?: boolean };

const prototype = AudioEngine.prototype as unknown as EnginePrototype;
const originalStart = prototype.start;
const originalSetPerformanceMode = prototype.setPerformanceMode;
const originalUpdateAdaptivePerformance = prototype.updateAdaptivePerformance;
const originalGetProfilerSnapshot = prototype.getProfilerSnapshot;
const globalState = globalThis as PatchGlobal;

function grainStats(engine: AudioEngine): GrainProfilerStats {
  const grain = engine.getEffect('bitcrusher');
  return grain && 'getProfilerStats' in grain
    ? (grain as GrainEffect).getProfilerStats()
    : { averageCallbackMs: 0, worstCallbackMs: 0, callbackBudgetMs: 0, cpuLoad: 0, callbackJitterMs: 0, activeVoices: 0, maxVoices: 0, effectiveVoiceLimit: 0, overruns: 0, droppedSpawns: 0 };
}

function configureTransparentLimiter(engine: AudioEngine, mode: PerformanceMode): void {
  const internal = engine as EngineInternals;
  const limiter = internal.limiter;
  const context = internal.context;
  if (!limiter || !context) return;

  // Quality modes should buy transparency, not progressively stronger compression.
  const threshold = mode === 'studio' ? -0.75 : mode === 'balanced' ? -1.0 : -1.2;
  const ratio = mode === 'studio' ? 4 : mode === 'balanced' ? 5 : 6;
  limiter.threshold.setValueAtTime(threshold, context.currentTime);
  limiter.ratio.setValueAtTime(ratio, context.currentTime);
}

async function stableStart(this: AudioEngine, options?: Parameters<AudioEngine['start']>[0]): Promise<void> {
  await originalStart.call(this, options);
  configureTransparentLimiter(this, this.getPerformanceMode());
}

function stableSetPerformanceMode(this: AudioEngine, mode: PerformanceMode): void {
  originalSetPerformanceMode.call(this, mode);
  configureTransparentLimiter(this, mode);
}

function stableAdaptivePerformance(this: AudioEngine): void {
  if (!this.getAdaptiveMode() || this.getState() !== 'running') return;
  const internal = this as EngineInternals;
  const stats = grainStats(this);
  const newOverrun = stats.overruns > internal.lastOverrunCount;
  internal.lastOverrunCount = stats.overruns;
  const stressed = stats.cpuLoad > 0.76 || newOverrun;
  const relaxed = stats.cpuLoad < 0.38 && !newOverrun;
  internal.overloadWindows = stressed ? internal.overloadWindows + 1 : 0;
  internal.recoveryWindows = relaxed ? internal.recoveryWindows + 1 : 0;

  if (internal.overloadWindows >= 2) {
    const mode = this.getPerformanceMode();
    if (mode === 'studio') {
      this.setPerformanceMode('balanced');
      internal.adaptiveAction = 'STUDIO → BALANCED';
    } else if (mode === 'balanced') {
      this.setPerformanceMode('live');
      internal.adaptiveAction = 'BALANCED → LIVE';
    } else {
      internal.adaptiveAction = 'LIVE · VOICE GUARD';
    }
    internal.overloadWindows = 0;
    internal.recoveryWindows = 0;
    return;
  }

  if (internal.recoveryWindows >= 12) {
    const mode = this.getPerformanceMode();
    if (mode === 'live') {
      this.setPerformanceMode('balanced');
      internal.adaptiveAction = 'LIVE → BALANCED';
    } else if (mode === 'balanced') {
      this.setPerformanceMode('studio');
      internal.adaptiveAction = 'BALANCED → STUDIO';
    } else {
      internal.adaptiveAction = 'FULL QUALITY';
    }
    internal.recoveryWindows = 0;
  }
}

function stableProfilerSnapshot(this: AudioEngine): DspProfilerSnapshot {
  // When the panel is visible, preserve the full spectrum diagnostics.
  if (typeof document !== 'undefined' && document.querySelector('.dsp-profiler')) {
    return originalGetProfilerSnapshot.call(this);
  }

  const internal = this as EngineInternals;
  const context = this.getContext();
  const stats = grainStats(this);
  const health: EngineHealth = !context || context.state !== 'running'
    ? 'offline'
    : stats.cpuLoad >= 0.82 || stats.overruns > 0
      ? 'critical'
      : stats.cpuLoad >= 0.58
        ? 'warm'
        : 'healthy';

  return {
    contextState: context?.state ?? 'offline',
    sampleRate: context?.sampleRate ?? 0,
    baseLatencyMs: (context?.baseLatency ?? 0) * 1000,
    outputLatencyMs: (context?.outputLatency ?? 0) * 1000,
    grain: stats,
    health,
    spectralCentroidHz: 0,
    spectralEnergy: 0,
    adaptiveMode: this.getAdaptiveMode(),
    adaptiveAction: internal.adaptiveAction,
    dreamBuffer: internal.dreamBuffer?.getStats() ?? { fillRatio: 0, historySeconds: 8, inputPeak: 0, captures: 0, activeRoutes: 0 },
  };
}

function install(): void {
  if (globalState.__calcotoneEngineStabilityPatch) return;
  globalState.__calcotoneEngineStabilityPatch = true;
  prototype.start = stableStart;
  prototype.setPerformanceMode = stableSetPerformanceMode;
  prototype.updateAdaptivePerformance = stableAdaptivePerformance;
  prototype.getProfilerSnapshot = stableProfilerSnapshot;
}

function uninstall(): void {
  if (!globalState.__calcotoneEngineStabilityPatch) return;
  prototype.start = originalStart;
  prototype.setPerformanceMode = originalSetPerformanceMode;
  prototype.updateAdaptivePerformance = originalUpdateAdaptivePerformance;
  prototype.getProfilerSnapshot = originalGetProfilerSnapshot;
  delete globalState.__calcotoneEngineStabilityPatch;
}

install();
if (import.meta.hot) import.meta.hot.dispose(uninstall);
