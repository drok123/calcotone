import {
  AudioEngine,
  type DspProfilerSnapshot,
  type EngineHealth,
  type PerformanceMode,
} from '../../audio/AudioEngine';
import type { Effect } from '../../audio/effects/Effect';
import type { GrainProfilerStats } from '../../audio/effects/Bitcrusher';

export type EngineStabilityInternals = {
  limiter: DynamicsCompressorNode | null;
  context: AudioContext | null;
  adaptiveAction: string;
  overloadWindows: number;
  recoveryWindows: number;
  lastOverrunCount: number;
  routeTransition: Promise<void>;
  requestedRenderSize: DspProfilerSnapshot['requestedRenderSize'];
  renderSizeHintSupported: boolean;
  dreamBuffer: { getStats(): DspProfilerSnapshot['dreamBuffer'] } | null;
  synth: { getTelemetry(): DspProfilerSnapshot['synth'] } | null;
};

type GrainEffect = Effect & { getProfilerStats(): GrainProfilerStats };

export function engineInternals(engine: AudioEngine): EngineStabilityInternals {
  return engine as unknown as EngineStabilityInternals;
}

export function grainStats(engine: AudioEngine): GrainProfilerStats {
  const grain = engine.getEffect('bitcrusher');
  return grain && 'getProfilerStats' in grain
    ? (grain as GrainEffect).getProfilerStats()
    : {
        averageCallbackMs: 0,
        worstCallbackMs: 0,
        callbackBudgetMs: 0,
        cpuLoad: 0,
        callbackJitterMs: 0,
        activeVoices: 0,
        maxVoices: 0,
        effectiveVoiceLimit: 0,
        overruns: 0,
        droppedSpawns: 0,
      };
}

export function configureTransparentLimiter(engine: AudioEngine, mode: PerformanceMode): void {
  const internal = engineInternals(engine);
  const limiter = internal.limiter;
  const context = internal.context;
  if (!limiter || !context) return;

  // Quality modes should buy transparency, not progressively stronger compression.
  const threshold = mode === 'studio' ? -0.75 : mode === 'balanced' ? -1.0 : -1.2;
  const ratio = mode === 'studio' ? 4 : mode === 'balanced' ? 5 : 6;
  limiter.threshold.setValueAtTime(threshold, context.currentTime);
  limiter.ratio.setValueAtTime(ratio, context.currentTime);
}

export function runAdaptivePerformance(engine: AudioEngine): void {
  if (!engine.getAdaptiveMode() || engine.getState() !== 'running') return;
  const internal = engineInternals(engine);
  const stats = grainStats(engine);
  const newOverrun = stats.overruns > internal.lastOverrunCount;
  internal.lastOverrunCount = stats.overruns;
  const stressed = stats.cpuLoad > 0.76 || newOverrun;
  const relaxed = stats.cpuLoad < 0.38 && !newOverrun;
  internal.overloadWindows = stressed ? internal.overloadWindows + 1 : 0;
  internal.recoveryWindows = relaxed ? internal.recoveryWindows + 1 : 0;

  if (internal.overloadWindows >= 2) {
    const mode = engine.getPerformanceMode();
    if (mode === 'studio') {
      engine.setPerformanceMode('balanced');
      internal.adaptiveAction = 'STUDIO → BALANCED';
    } else if (mode === 'balanced') {
      engine.setPerformanceMode('live');
      internal.adaptiveAction = 'BALANCED → LIVE';
    } else {
      internal.adaptiveAction = 'LIVE · VOICE GUARD';
    }
    internal.overloadWindows = 0;
    internal.recoveryWindows = 0;
    return;
  }

  if (internal.recoveryWindows >= 12) {
    const mode = engine.getPerformanceMode();
    if (mode === 'live') {
      engine.setPerformanceMode('balanced');
      internal.adaptiveAction = 'LIVE → BALANCED';
    } else if (mode === 'balanced') {
      engine.setPerformanceMode('studio');
      internal.adaptiveAction = 'BALANCED → STUDIO';
    } else {
      internal.adaptiveAction = 'FULL QUALITY';
    }
    internal.recoveryWindows = 0;
  }
}

export function buildHiddenProfilerSnapshot(engine: AudioEngine): DspProfilerSnapshot {
  const internal = engineInternals(engine);
  const context = engine.getContext();
  const stats = grainStats(engine);
  const health: EngineHealth = !context || context.state !== 'running'
    ? 'offline'
    : stats.cpuLoad >= 0.82 || stats.overruns > 0
      ? 'critical'
      : stats.cpuLoad >= 0.58
        ? 'warm'
        : 'healthy';
  const synth = internal.synth?.getTelemetry() ?? {
    activeVoices: 0,
    maxVoices: 10,
    peak: 0,
    oversample: engine.getPerformanceMode() === 'studio' ? 4 : engine.getPerformanceMode() === 'balanced' ? 2 : 1,
    machine: 'model-d' as const,
    topology: '4× BJT-C SPICE LADDER',
    solver: 'BJT-C NEWTON',
    solverIterations: engine.getPerformanceMode() === 'studio' ? 2 : 1,
    temperatureC: 27,
    renderQuantumFrames: 0,
    clippedSamples: 0,
    renderMode: 'circuit' as const,
    captureReady: false,
  };
  const contextQuantum = (context as (AudioContext & { readonly renderQuantumSize?: number }) | null)
    ?.renderQuantumSize;

  return {
    contextState: context?.state ?? 'offline',
    sampleRate: context?.sampleRate ?? 0,
    baseLatencyMs: (context?.baseLatency ?? 0) * 1000,
    outputLatencyMs: (context?.outputLatency ?? 0) * 1000,
    requestedRenderSize: internal.requestedRenderSize,
    renderQuantumFrames: typeof contextQuantum === 'number' && contextQuantum > 0
      ? Math.round(contextQuantum)
      : synth.renderQuantumFrames,
    renderSizeHintSupported: internal.renderSizeHintSupported,
    grain: stats,
    health,
    spectralCentroidHz: 0,
    spectralEnergy: 0,
    adaptiveMode: engine.getAdaptiveMode(),
    adaptiveAction: internal.adaptiveAction,
    dreamBuffer: internal.dreamBuffer?.getStats() ?? {
      fillRatio: 0,
      historySeconds: 8,
      inputPeak: 0,
      captures: 0,
      activeRoutes: 0,
    },
    synth,
  };
}
